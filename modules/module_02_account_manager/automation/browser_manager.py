"""
browser_manager.py
Quản lý Chrome với Persistent Profile — mỗi UID có thư mục User Data riêng.
Tích hợp các tùy chọn stealth để giảm nguy cơ bị Facebook phát hiện bot.
"""
import os
import time
import random
import subprocess
import logging
import threading
from pathlib import Path
from typing import Optional, Dict, Any, List
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

from ..automation.proxy_bridge import (
    parse_proxy,
    test_proxy_connectivity,
    ProxyBridge,
    verify_chrome_egress_ip,
    get_direct_ip,
    ProxyError,
    ProxyFormatError,
    ProxyConnectionError,
    ProxyLeakError,
)

logger = logging.getLogger(__name__)

from ..utils.paths import BASE_DIR, PROFILES_DIR, get_profile_path, account_key
from ..context import owner_context, owner_scope

# ── Quản lý khóa Profile theo UID & Danh sách Driver đang hoạt động ──
_profile_locks = {}
_profile_locks_guard = threading.Lock()

def get_profile_lock(uid: str) -> threading.Lock:
    """Trả về lock đồng bộ theo UID, ngăn ngừa 2 tiến trình/thread truy cập cùng 1 profile Chrome cùng lúc."""
    with _profile_locks_guard:
        uid_str = account_key(uid)
        if uid_str not in _profile_locks:
            _profile_locks[uid_str] = threading.Lock()
        return _profile_locks[uid_str]

_active_drivers_lock = threading.RLock()
_active_drivers = {}  # driver -> {"uid": str(uid), "scope": scope, "owner": owner_context.get()}

def register_active_driver(driver, uid: str = "", scope: str = "creator"):
    """Đăng ký driver đang hoạt động kèm thông tin UID và scope để quản lý theo luồng."""
    with _active_drivers_lock:
        _active_drivers[driver] = {"uid": str(uid), "scope": scope, "owner": owner_context.get()}

def unregister_active_driver(driver):
    """Hủy đăng ký driver sau khi đã đóng."""
    with _active_drivers_lock:
        _active_drivers.pop(driver, None)

# ── Quản lý Local Proxy Bridge theo UID ──
_active_bridges: Dict[str, ProxyBridge] = {}
_active_bridges_lock = threading.Lock()

def register_active_bridge(uid: str, bridge: ProxyBridge):
    """Đăng ký proxy bridge đang chạy cho UID."""
    with _active_bridges_lock:
        _active_bridges[account_key(uid)] = bridge

def get_active_bridge(uid: str) -> Optional[ProxyBridge]:
    """Lấy proxy bridge đang chạy của UID nếu có."""
    with _active_bridges_lock:
        return _active_bridges.get(account_key(uid))

def close_bridge_for_uid(uid: str):
    """Đóng an toàn proxy bridge nội bộ của UID nếu có."""
    with _active_bridges_lock:
        bridge = _active_bridges.pop(account_key(uid), None)
    if bridge:
        try:
            bridge.close()
        except Exception as e:
            logger.warning(f"[{uid}] Lỗi khi đóng ProxyBridge: {e}")

def close_all_active_bridges():
    """Đóng tất cả proxy bridge nội bộ đang chạy."""
    with _active_bridges_lock:
        bridges = list(_active_bridges.values())
        _active_bridges.clear()
    for bridge in bridges:
        try:
            bridge.close()
        except Exception as e:
            logger.warning(f"Lỗi khi đóng ProxyBridge: {e}")

def force_kill_driver(driver):
    """Cưỡng chế kill tiến trình ChromeDriver và toàn bộ tiến trình con Chrome."""
    killed = False
    try:
        pid = driver.service.process.pid
        if pid:
            if os.name == 'nt':
                subprocess.run(
                    ['taskkill', '/F', '/T', '/PID', str(pid)],
                    capture_output=True, timeout=5
                )
            else:
                import signal
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            killed = True
            logger.info(f"Force killed ChromeDriver process tree PID={pid}")
    except Exception as e:
        logger.warning(f"Force kill by PID failed: {e}")
    if not killed:
        try:
            driver.quit()
        except Exception:
            pass


def safe_close_driver(driver):
    """Đóng driver an toàn bằng driver.quit() để Chrome kịp flush cookies & session xuống đĩa. Fallback force_kill_driver nếu treo."""
    try:
        # Nếu dùng detach=True, driver.quit() đôi khi để lại cửa sổ Chrome mở khiến profile bị lock.
        # Ta đóng các window handles trước:
        try:
            for handle in driver.window_handles:
                driver.switch_to.window(handle)
                driver.close()
        except Exception:
            pass
        driver.quit()
        return
    except Exception as e:
        logger.debug(f"driver.quit() exception: {e}")
    force_kill_driver(driver)


def close_driver_for_uid(uid: str):
    """Đóng driver đang chạy của UID nếu có để giải phóng profile lock trước khi mở mới."""
    with _active_drivers_lock:
        to_close = [
            d for d, info in _active_drivers.items()
            if (isinstance(info, dict) and info.get("uid") == str(uid) and info.get("owner") == owner_context.get())
        ]
        for d in to_close:
            _active_drivers.pop(d, None)

    for d in to_close:
        try:
            # Trước khi đóng, thử trích xuất cookie mới nhất và lưu vào DB nếu có c_user!
            try:
                cookies = extract_cookies_as_string(d)
                if cookies and "c_user=" in cookies:
                    from ..database.connection import SessionLocal
                    from ..database.repository import AccountRepository as AccountRepo
                    db_s = SessionLocal()
                    try:
                        AccountRepo.update_cookies(db_s, uid, cookies)
                        AccountRepo.update_login_status(db_s, uid, "logged_in")
                        logger.info(f"[{uid}] Tự động lưu cookies mới nhất vào DB trước khi đóng browser.")
                    finally:
                        db_s.close()
            except Exception as e_ck:
                logger.debug(f"[{uid}] Không thể trích xuất cookies trước khi đóng: {e_ck}")

            safe_close_driver(d)
        except Exception as e:
            logger.warning(f"Lỗi khi đóng driver cũ cho UID {uid}: {e}")

    # Giải phóng Local Proxy Bridge tương ứng của UID
    close_bridge_for_uid(uid)
    _cleanup_profile_lockfiles(uid)


def close_scoped_active_drivers(scope: str = "creator", force: bool = False):
    """Đóng tất cả driver thuộc scope chỉ định (ví dụ khi dừng khẩn cấp Tạo Page)."""
    with _active_drivers_lock:
        to_close = [
            (d, info) for d, info in _active_drivers.items()
            if isinstance(info, dict) and info.get("scope") == scope
        ]
        for d, _info in to_close:
            _active_drivers.pop(d, None)

    affected_uids = []
    for d, info in to_close:
        uid = info.get("uid", "") if isinstance(info, dict) else ""
        if uid:
            affected_uids.append(uid)
        if force:
            force_kill_driver(d)
        else:
            safe_close_driver(d)

    for uid in affected_uids:
        close_bridge_for_uid(uid)

    if force:
        for uid in affected_uids:
            _cleanup_profile_lockfiles(uid)

    return affected_uids


def close_all_active_drivers():
    """Đóng tất cả driver đang mở (khi shutdown toàn bộ hệ thống)."""
    with _active_drivers_lock:
        drivers = list(_active_drivers.keys())
        for d in drivers:
            try:
                safe_close_driver(d)
            except Exception as e:
                logger.warning(f"Lỗi khi force quit browser: {e}")
        _active_drivers.clear()
    close_all_active_bridges()


def extract_cookies_as_string(driver: webdriver.Chrome) -> str:
    """Trích xuất cookies từ driver hiện tại thành chuỗi name=value;... chuẩn."""
    try:
        cookies = driver.get_cookies()
        if cookies:
            return "; ".join([f"{c['name']}={c['value']}" for c in cookies if c.get("name") and c.get("value")])
    except Exception:
        pass
    return ""


def _cleanup_profile_lockfiles(uid: str):
    """Xóa các file lock Chrome còn sót lại sau khi đóng."""
    profile_path = get_profile_path(uid)
    for lf in [
        "lockfile",
        "parent.lock",
        "SingletonLock",
        "SingletonCookie",
        "SingletonSocket",
        "DevToolsActivePort",
    ]:
        p = os.path.join(profile_path, lf)
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass


def create_driver(
    uid: str,
    headless: bool = False,
    detach: bool = False,
    proxy: Optional[str] = None,
    scope: str = "creator",
    verify_egress: bool = True,
) -> webdriver.Chrome:
    """
    Tạo Chrome WebDriver với persistent profile, cấu hình stealth và hỗ trợ Proxy.
    Tự động khởi chạy Local Proxy Bridge (127.0.0.1) cho proxy có username/password.
    Tự động fallback sang Direct IP nếu Proxy chết/lỗi kèm thông báo rõ ràng.

    Args:
        uid: UID Facebook, dùng làm tên thư mục profile.
        headless: Nếu True, chạy Chrome ẩn (không hiển thị).
        detach: Nếu True, giữ cửa sổ Chrome mở trên màn hình sau khi Python kết thúc.
        proxy: Chuỗi Proxy (ví dụ: HOST:PORT hoặc HOST:PORT:USER:PASS hoặc http://user:pass@host:port).
        scope: Mục đích ("creator" | "live" | "login").
        verify_egress: Kiểm tra Egress IP trong Chrome khi có proxy active.
    Returns:
        Selenium WebDriver instance.
    """
    profile_path = get_profile_path(uid)
    options = Options()

    # ─── Persistent Profile ───
    options.add_argument(f"--user-data-dir={profile_path}")
    options.add_argument("--profile-directory=Default")

    if detach:
        options.add_experimental_option("detach", True)

    # ─── Stealth & Anti-Detection ───
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-infobars")
    options.add_argument("--disable-background-mode")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--disable-sync")
    options.add_argument("--disable-extensions")
    options.add_argument("--lang=vi-VN")
    options.add_argument("--window-size=1280,900")

    # Anti-Crash exit flag & tắt thông báo khó chịu
    options.add_experimental_option("prefs", {
        "profile.default_content_setting_values.notifications": 2,
        "credentials_enable_service": False,
        "profile.password_manager_enabled": False,
        "profile.exit_type": "Normal",
        "profile.exited_cleanly": True,
    })

    # User-Agent thật
    options.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/127.0.0.0 Safari/537.36"
    )

    if headless:
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1080")

    # Đóng driver và bridge cũ của UID này nếu còn mở để giải phóng lock
    close_driver_for_uid(uid)

    # Dọn dẹp lockfile cũ nếu có để tránh xung đột phiên Chrome
    _cleanup_profile_lockfiles(uid)

    # ─── Cấu hình Proxy (nếu có, tự động fallback Direct IP nếu proxy chết) ───
    bridge: Optional[ProxyBridge] = None
    proxy_applied = False
    if proxy and str(proxy).strip():
        proxy_str = str(proxy).strip()
        try:
            proxy_info = parse_proxy(proxy_str)
            if proxy_info:
                # 1. Pre-flight connectivity testing (HTTP + HTTPS)
                logger.info(f"[{uid}] Pre-flight testing proxy: {proxy_info['server']} (auth={proxy_info['has_auth']})...")
                res = test_proxy_connectivity(proxy_info, timeout=6)
                egress_ip = res.get("egress_ip", "")

                # 2. Xử lý Proxy qua Local Proxy Bridge nếu có auth hoặc là SOCKS5
                proto = proxy_info.get("protocol", "http")
                if proxy_info["has_auth"] or proto == "socks5":
                    bridge = ProxyBridge(
                        upstream_host=proxy_info["host"],
                        upstream_port=proxy_info["port"],
                        username=proxy_info["username"],
                        password=proxy_info["password"],
                        protocol=proto,
                    )
                    bridge_port = bridge.start()
                    register_active_bridge(uid, bridge)
                    options.add_argument(f"--proxy-server=http://127.0.0.1:{bridge_port}")
                    logger.info(f"[{uid}] Proxy ({proto.upper()}) routed through Local Bridge: 127.0.0.1:{bridge_port}")
                else:
                    proxy_server = proxy_info["server"]
                    options.add_argument(f"--proxy-server={proxy_server}")
                    logger.info(f"[{uid}] Direct Chrome Proxy flag configured: {proxy_server}")

                proxy_applied = True
                try:
                    from ..services.events import broadcast
                    broadcast("info", f"🌐 [{uid}] Sử dụng Proxy ({proto.upper()}): {proxy_info['host']}:{proxy_info['port']} (Egress IP: {egress_ip or 'OK'})", uid=uid)
                except Exception:
                    pass
        except Exception as proxy_err:
            logger.warning(f"[{uid}] Proxy '{proxy_str}' không hoạt động ({proxy_err}). Tự động chuyển sang IP gốc của máy!")
            try:
                from ..services.events import broadcast
                broadcast("warning", f"⚠️ [{uid}] Proxy không hoạt động ({proxy_err}) — Tự động chuyển sang IP gốc của máy!", uid=uid)
            except Exception:
                pass
            proxy_applied = False
            close_bridge_for_uid(uid)

    driver: Optional[webdriver.Chrome] = None
    try:
        try:
            service = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=options)
        except Exception as e:
            logger.warning(f"[{uid}] ChromeDriverManager failed ({e}), falling back to built-in Selenium Manager...")
            service = Service()
            driver = webdriver.Chrome(service=service, options=options)

        # Đăng ký driver kèm UID và scope
        register_active_driver(driver, uid=uid, scope=scope)

        # Bọc driver.quit để tự động đóng bridge và hủy đăng ký driver
        original_quit = driver.quit
        driver_owner = owner_context.get()
        def quit_with_cleanup(*args, **kwargs):
            try:
                return original_quit(*args, **kwargs)
            finally:
                unregister_active_driver(driver)
                with owner_scope(driver_owner):
                    close_bridge_for_uid(uid)

        driver.quit = quit_with_cleanup

        # Xóa webdriver flag trong navigator object
        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": """
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined
                    });
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => [1, 2, 3, 4, 5]
                    });
                    Object.defineProperty(navigator, 'languages', {
                        get: () => ['vi-VN', 'vi', 'en-US', 'en']
                    });
                """
            }
        )

        driver.implicitly_wait(0)  # Tắt implicit wait, dùng explicit wait

        # ─── Kiểm tra Egress IP trong chính Chrome nếu proxy active ───
        if proxy_applied and verify_egress:
            logger.info(f"[{uid}] Đang kiểm tra Egress IP trong Chrome để chống rò rỉ IP thật...")
            try:
                verify_chrome_egress_ip(driver)
            except Exception as leak_err:
                logger.warning(f"[{uid}] Egress verification note: {leak_err}")

        logger.info(f"Chrome driver created successfully for UID={uid}, scope={scope}, profile={profile_path}")
        return driver

    except Exception as exc:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        close_bridge_for_uid(uid)
        logger.error(f"[{uid}] Khởi tạo Chrome thất bại: {exc}")
        raise


def human_type(element, text: str, min_delay: float = 0.03, max_delay: float = 0.09):
    """
    Gõ phím từng ký tự với độ trễ ngẫu nhiên mô phỏng người dùng thật.
    """
    for char in text:
        element.send_keys(char)
        time.sleep(random.uniform(min_delay, max_delay))


def human_sleep(min_s: float = 2.0, max_s: float = 4.5):
    """Dừng ngẫu nhiên trong khoảng [min_s, max_s] giây."""
    time.sleep(random.uniform(min_s, max_s))


def wait_and_find(driver: webdriver.Chrome, locators: list, timeout: int = 15):
    """
    Thử tất cả các locator trong danh sách cho đến khi tìm thấy phần tử trong khoảng timeout.
    """
    from selenium.common.exceptions import TimeoutException

    start_time = time.time()
    while time.time() - start_time < timeout:
        for i, locator in enumerate(locators):
            try:
                elements = driver.find_elements(By.XPATH, locator)
                for el in elements:
                    if el.is_displayed():
                        logger.debug(f"Found element with locator #{i}: {locator[:60]}")
                        return el
            except Exception:
                pass
        time.sleep(0.4)

    raise TimeoutException(f"None of {len(locators)} locators matched after {timeout}s")


def load_cookies(driver: webdriver.Chrome, cookie_string: str):
    """
    Nạp cookie string vào browser sau khi đã truy cập domain facebook.com.
    Cookie string định dạng: name=value; name2=value2
    """
    if not cookie_string or not cookie_string.strip() or "c_user=" not in cookie_string:
        logger.info("load_cookies: cookie_string không có c_user hoặc rỗng, giữ nguyên cookie profile hiện tại.")
        return

    try:
        driver.get("https://www.facebook.com")
        time.sleep(1)
    except Exception as e:
        logger.warning(f"Lỗi truy cập facebook.com khi nạp cookie: {e}")

    # Parse và thêm/ghi đè từng cookie (không dùng delete_all_cookies để giữ các token thiết bị và profile storage)
    for cookie_part in cookie_string.split(";"):
        cookie_part = cookie_part.strip()
        if "=" in cookie_part:
            name, _, value = cookie_part.partition("=")
            try:
                driver.add_cookie({
                    "name": name.strip(),
                    "value": value.strip(),
                    "domain": ".facebook.com",
                    "path": "/",
                })
            except Exception as e:
                logger.warning(f"Failed to add cookie '{name}': {e}")

    # Ép ngôn ngữ Facebook sang Tiếng Việt (locale=vi_VN)
    try:
        driver.add_cookie({
            "name": "locale",
            "value": "vi_VN",
            "domain": ".facebook.com",
            "path": "/",
        })
    except Exception:
        pass

    logger.info(f"Loaded {len(cookie_string.split(';'))} cookies")
