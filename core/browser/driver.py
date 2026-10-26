"""
driver.py
Mở / đóng Chrome cho 1 nick: persistent profile chung, dấu vân tay theo nick, proxy (bridge nếu có user/pass).
Mọi module mở Chrome qua đây để 1 nick luôn là 1 thiết bị. Không đăng nhập Facebook ở đây.
"""
import logging
import os
import subprocess
import threading
import time
from typing import Callable, Dict, Iterable, List, Optional

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager

from core.browser.fingerprint import build_init_script, resolve_browser_config
from core.browser.profile import get_profile_path, profile_key
from core.browser.proxy_bridge import (
    ProxyBridge,
    ProxyConnectionError,
    parse_proxy,
    test_proxy_connectivity,
    verify_chrome_egress_ip,
)

logger = logging.getLogger(__name__)

LogCallback = Callable[[str, str], None]  # (level, message)

# WebRTC không được dùng UDP đi thẳng (không qua proxy): STUN không đọc được IP thật của máy
WEBRTC_IP_POLICY = "disable_non_proxied_udp"


def _notify(on_log: Optional[LogCallback], level: str, message: str):
    if on_log:
        try:
            on_log(level, message)
        except Exception as e:
            logger.debug(f"on_log callback error: {e}")


# ── Khởi chạy chromedriver ──
# Gọi ChromeDriverManager().install() mỗi lần mở Chrome ở nhiều luồng từng làm 1 luồng treo hàng chục phút
# (chỉ chạy tiếp khi chromedriver của luồng khác tắt). Chỉ tra đường dẫn 1 lần, và mở Chrome lần lượt.
_chromedriver_path: Optional[str] = None
_chromedriver_path_lock = threading.Lock()
_chrome_launch_lock = threading.Lock()


def _get_chromedriver_path() -> Optional[str]:
    """Đường dẫn chromedriver đã cache; None thì để Selenium Manager tự tìm."""
    global _chromedriver_path
    with _chromedriver_path_lock:
        if _chromedriver_path is None:
            try:
                _chromedriver_path = ChromeDriverManager().install()
            except Exception as e:
                logger.warning(f"ChromeDriverManager failed ({e}), sẽ dùng Selenium Manager")
                return None
        return _chromedriver_path


def _reset_chromedriver_path():
    """Chrome tự cập nhật lên bản mới thì chromedriver cũ không còn khớp: lần sau tra lại."""
    global _chromedriver_path
    with _chromedriver_path_lock:
        _chromedriver_path = None


# ── Danh sách Chrome đang mở (dùng chung mọi module trong cùng tiến trình) ──
_active_drivers_lock = threading.Lock()
_active_drivers: Dict[object, dict] = {}  # driver -> {"uid", "owner", "key", "scope", "on_before_close"}


def register_active_driver(driver, uid: str, owner: Optional[str] = None, scope: str = "default",
                           on_before_close: Optional[Callable] = None):
    with _active_drivers_lock:
        _active_drivers[driver] = {
            "uid": str(uid), "owner": owner, "key": profile_key(uid, owner),
            "scope": scope, "on_before_close": on_before_close,
        }


def unregister_active_driver(driver):
    with _active_drivers_lock:
        _active_drivers.pop(driver, None)


def get_active_drivers(uid: Optional[str] = None, owner: Optional[str] = None,
                       scope: Optional[str] = None) -> List:
    """Danh sách driver đang đăng ký (lọc theo UID + owner và/hoặc scope)."""
    key = profile_key(uid, owner) if uid is not None else None
    with _active_drivers_lock:
        return [d for d, info in _active_drivers.items()
                if (key is None or info["key"] == key) and (scope is None or info["scope"] == scope)]


# ── Local Proxy Bridge theo profile ──
_active_bridges: Dict[str, ProxyBridge] = {}
_active_bridges_lock = threading.Lock()


def _register_bridge(key: str, bridge: ProxyBridge):
    with _active_bridges_lock:
        _active_bridges[key] = bridge


def register_active_bridge(uid: str, bridge: ProxyBridge, owner: Optional[str] = None):
    """Đăng ký proxy bridge đang chạy cho UID."""
    _register_bridge(profile_key(uid, owner), bridge)


def get_active_bridge(uid: str, owner: Optional[str] = None) -> Optional[ProxyBridge]:
    """Lấy proxy bridge đang chạy của UID nếu có."""
    with _active_bridges_lock:
        return _active_bridges.get(profile_key(uid, owner))


def close_bridge_for_uid(uid: str, owner: Optional[str] = None):
    """Đóng proxy bridge của UID nếu có."""
    _close_bridge(profile_key(uid, owner))


def _close_bridge(key: str):
    with _active_bridges_lock:
        bridge = _active_bridges.pop(key, None)
    if bridge:
        try:
            bridge.close()
        except Exception as e:
            logger.warning(f"[{key}] Lỗi khi đóng ProxyBridge: {e}")


def close_all_active_bridges():
    with _active_bridges_lock:
        bridges = list(_active_bridges.values())
        _active_bridges.clear()
    for bridge in bridges:
        try:
            bridge.close()
        except Exception as e:
            logger.warning(f"Lỗi khi đóng ProxyBridge: {e}")


# ── Đóng Chrome ──

def force_kill_driver(driver):
    """Cưỡng chế kill tiến trình ChromeDriver và toàn bộ tiến trình con Chrome."""
    killed = False
    try:
        pid = driver.service.process.pid
        if pid:
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, timeout=5)
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


def _driver_pids(driver):
    """PID của ChromeDriver và Chrome con, lấy trước khi quit. detach=True để Chrome sống sau quit."""
    try:
        pid = driver.service.process.pid
    except Exception:
        return []
    if not isinstance(pid, int) or pid <= 0:
        return []
    pids = [pid]
    try:
        import psutil
        for child in psutil.Process(pid).children(recursive=True):
            if isinstance(child.pid, int):
                pids.append(child.pid)
    except Exception:
        pass
    return pids


def _kill_pids(pids):
    for pid in pids:
        if not isinstance(pid, int) or pid <= 0:
            continue
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, timeout=5)
            else:
                os.kill(pid, 9)
        except Exception:
            pass


def safe_close_driver(driver):
    """Đóng bằng driver.quit() để Chrome kịp ghi cookie, rồi tắt nốt cửa sổ detach còn sống."""
    pids = _driver_pids(driver)
    try:
        try:
            for handle in list(driver.window_handles or []):
                driver.switch_to.window(handle)
                driver.close()
        except Exception:
            pass
        driver.quit()
    except Exception as e:
        logger.debug(f"driver.quit() exception: {e}")
    _kill_pids(pids)


def _command_uses_profile(cmdline, profile_path: str) -> bool:
    """Chỉ khớp profile automation, không khớp Chrome cá nhân của máy."""
    if not cmdline or not profile_path:
        return False
    needle = os.path.normcase(os.path.normpath(profile_path))
    if len(needle) < 12:
        return False
    return needle in os.path.normcase(" ".join(cmdline))


def _release_profile_chrome(profile_path: str):
    """Tắt Chrome/ChromeDriver còn sống trên đúng profile này. quit() không thấy tiến trình mở từ lần trước."""
    try:
        import psutil
    except ImportError:
        return
    victims = []
    for proc in psutil.process_iter(["name", "cmdline"]):
        try:
            name = (proc.info["name"] or "").lower()
            if name not in {"chrome.exe", "chromium.exe", "chromedriver.exe"}:
                continue
            if _command_uses_profile(proc.info["cmdline"], profile_path):
                victims.append(proc)
        except (psutil.Error, OSError):
            continue
    for proc in victims:
        try:
            proc.kill()
        except psutil.Error:
            pass
    if victims:
        psutil.wait_procs(victims, timeout=5)
        logger.info(f"Đã tắt {len(victims)} tiến trình Chrome còn giữ profile")


def _cleanup_profile_lockfiles(profile_path: str):
    """Xóa các file lock Chrome còn sót lại sau khi đóng."""
    for name in ("lockfile", "parent.lock", "SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"):
        p = os.path.join(profile_path, name)
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass


def close_driver_for_uid(uid: str, owner: Optional[str] = None):
    """Đóng Chrome đang mở của profile (gọi on_before_close của từng driver trước khi đóng)."""
    key = profile_key(uid, owner)
    with _active_drivers_lock:
        to_close = [(d, info) for d, info in _active_drivers.items() if info["key"] == key]
        for d, _info in to_close:
            _active_drivers.pop(d, None)

    for d, info in to_close:
        hook = info.get("on_before_close")
        if hook:
            try:
                hook(d)
            except Exception as e:
                logger.debug(f"[{uid}] on_before_close lỗi: {e}")
        try:
            safe_close_driver(d)
        except Exception as e:
            logger.warning(f"Lỗi khi đóng driver cũ cho UID {uid}: {e}")

    _close_bridge(key)
    profile_path = get_profile_path(uid, owner)
    _release_profile_chrome(profile_path)
    _cleanup_profile_lockfiles(profile_path)


def close_scoped_active_drivers(scope: str, force: bool = False) -> List[str]:
    """Đóng mọi driver thuộc scope (vd khi dừng khẩn cấp một tác vụ). Trả về danh sách UID bị đóng."""
    with _active_drivers_lock:
        to_close = [(d, info) for d, info in _active_drivers.items() if info["scope"] == scope]
        for d, _info in to_close:
            _active_drivers.pop(d, None)

    for d, _info in to_close:
        if force:
            force_kill_driver(d)
        else:
            safe_close_driver(d)
    for _d, info in to_close:
        _close_bridge(info["key"])
        if force:
            _cleanup_profile_lockfiles(get_profile_path(info["uid"], info["owner"]))
    return [info["uid"] for _d, info in to_close]


def close_all_active_drivers():
    """Đóng mọi driver đang mở (khi tắt hệ thống)."""
    with _active_drivers_lock:
        drivers = list(_active_drivers.keys())
        _active_drivers.clear()
    for d in drivers:
        try:
            safe_close_driver(d)
        except Exception as e:
            logger.warning(f"Lỗi khi force quit browser: {e}")
    close_all_active_bridges()


def bring_chrome_to_front(driver=None):
    """
    Kích hoạt cửa sổ Chrome lên tiền cảnh (foreground) trên Windows.
    Sử dụng kỹ thuật SetWindowPos HWND_TOPMOST -> HWND_NOTOPMOST để ép hiển thị
    trên tất cả các cửa sổ ứng dụng khác (kể cả IDE / terminal đang active).
    Không phóng to / đổi kích thước: cửa sổ giữ kích thước theo dấu vân tay của nick; cửa sổ đang thu nhỏ thì
    khôi phục về kích thước thường, cửa sổ Chrome khác của người dùng không bị đổi kích thước.
    """
    if driver:
        try:
            driver.switch_to.window(driver.current_window_handle)
        except Exception:
            pass

    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            SW_RESTORE = 9
            HWND_TOPMOST = -1
            HWND_NOTOPMOST = -2
            SWP_SHOWWINDOW = 0x0040
            SWP_NOSIZE = 0x0001
            SWP_NOMOVE = 0x0002

            def _enum_windows_cb(hwnd, _):
                if user32.IsWindowVisible(hwnd):
                    class_buf = ctypes.create_unicode_buffer(256)
                    user32.GetClassNameW(hwnd, class_buf, 256)
                    if class_buf.value == "Chrome_WidgetWin_1":
                        if user32.IsIconic(hwnd):
                            user32.ShowWindow(hwnd, SW_RESTORE)
                        user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
                        user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
                        user32.BringWindowToTop(hwnd)
                        user32.SetForegroundWindow(hwnd)
                return True

            WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
            user32.EnumWindows(WNDPROC(_enum_windows_cb), 0)
        except Exception:
            pass


# ── Mở Chrome ──

def open_browser(
    uid: str,
    owner: Optional[str] = None,
    proxy: Optional[str] = None,
    scope: str = "default",
    headless: bool = False,
    detach: bool = False,
    verify_egress: bool = True,
    allow_direct_fallback: bool = True,
    extra_arguments: Optional[Iterable[str]] = None,
    extra_init_scripts: Optional[Iterable[str]] = None,
    on_log: Optional[LogCallback] = None,
    on_before_close: Optional[Callable] = None,
) -> webdriver.Chrome:
    """
    Mở Chrome với profile chung của nick (owner/uid), dấu vân tay theo nick và proxy.
    Không lấy khóa profile: module gọi tự giữ get_profile_lock(uid, owner) trong lúc dùng Chrome.
    Chrome cũ của cùng profile (cùng tiến trình) bị đóng trước khi mở mới.

    Args:
        owner: chủ sở hữu nick (giống owner của Module 02); None = nick local.
        proxy: HOST:PORT, HOST:PORT:USER:PASS hoặc http://user:pass@host:port.
        scope: nhãn của module/tác vụ, dùng cho close_scoped_active_drivers.
        allow_direct_fallback: proxy chết thì chạy bằng IP thật của máy (False: ném ProxyConnectionError).
            Chạy bằng IP thật làm lộ máy và gom nhiều nick về 1 IP; tác vụ trên nick nên truyền False.
        extra_arguments: cờ Chrome riêng của module (vd không hãm timer khi cửa sổ bị che).
        extra_init_scripts: JS riêng của module, chạy trước mọi trang, sau script dấu vân tay.
        on_log: callback(level, message) để module đưa thông báo proxy lên giao diện.
        on_before_close: callback(driver) gọi khi close_driver_for_uid đóng driver này (vd lưu cookie).

    Driver trả về có thêm: browser_config, fingerprint_mode, proxy_mode ("none" | "full" | "facebook_only"),
    proxy_egress_ip, profile_path, uid, owner.
    """
    profile_path = get_profile_path(uid, owner)
    key = profile_key(uid, owner)

    # Dọn dẹp các tệp lock và DevToolsActivePort cũ nếu tiến trình trước bị tắt đột ngột
    for stale_file in ("DevToolsActivePort", "lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"):
        try:
            target_lock = os.path.join(profile_path, stale_file)
            if os.path.exists(target_lock):
                os.remove(target_lock)
        except Exception:
            pass

    # Phải resolve trước khi Chrome tạo thư mục Default cho profile mới
    config = resolve_browser_config(uid, profile_path)
    w, h = config.window_size

    options = Options()
    options.add_argument(f"--user-data-dir={profile_path}")
    options.add_argument("--profile-directory=Default")
    if detach:
        options.add_experimental_option("detach", True)

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
    options.add_argument(f"--lang={config.lang_flag}")
    # Cửa sổ đúng kích thước theo dấu vân tay của nick; không --start-maximized (cờ đó đè --window-size,
    # mọi nick cùng 1 khung bằng màn hình máy, đã kiểm 2026-10-23)
    options.add_argument(f"--window-size={w},{h}")
    if not headless:
        options.add_argument("--window-position=50,50")
    # WebRTC chỉ đi qua proxy: STUN gửi UDP thẳng ra mạng, để lộ IP thật của máy (chung cho mọi nick trên máy)
    # dù nick có proxy riêng (đã kiểm 2026-10-23: lộ IPv4 + IPv6 của máy)
    options.add_argument(f"--force-webrtc-ip-handling-policy={WEBRTC_IP_POLICY}")
    options.add_experimental_option("prefs", {
        "profile.default_content_setting_values.notifications": 2,
        "credentials_enable_service": False,
        "profile.password_manager_enabled": False,
        "profile.exit_type": "Normal",
        "profile.exited_cleanly": True,
        "webrtc.ip_handling_policy": WEBRTC_IP_POLICY,
        "webrtc.multiple_routes_enabled": False,
        "webrtc.nonproxied_udp_enabled": False,
    })
    if headless:
        options.add_argument("--headless=new")
    for arg in extra_arguments or ():
        options.add_argument(arg)

    close_driver_for_uid(uid, owner)
    _cleanup_profile_lockfiles(profile_path)

    proxy_applied = False
    proxy_mode = "none"
    proxy_egress_ip = None
    if proxy and str(proxy).strip():
        try:
            proxy_info = parse_proxy(str(proxy).strip())
            if proxy_info:
                proto = proxy_info.get("protocol", "http")
                _notify(on_log, "info", f"🌐 [{uid}] Đang kiểm tra kết nối Proxy ({proto.upper()}): {proxy_info['host']}:{proxy_info['port']}...")
                logger.info(f"[{uid}] Pre-flight testing proxy: {proxy_info['server']} (auth={proxy_info['has_auth']})...")
                res = test_proxy_connectivity(proxy_info, timeout=6)
                proxy_mode = res.get("mode", "full")
                proxy_egress_ip = res.get("egress_ip") or None

                # Chrome không nhận user/pass trong --proxy-server hoặc SOCKS5: đi qua bridge 127.0.0.1
                if proxy_info["has_auth"] or proto == "socks5":
                    bridge = ProxyBridge(
                        upstream_host=proxy_info["host"],
                        upstream_port=proxy_info["port"],
                        username=proxy_info["username"],
                        password=proxy_info["password"],
                        protocol=proto,
                    )
                    bridge_port = bridge.start()
                    _register_bridge(key, bridge)
                    options.add_argument(f"--proxy-server=http://127.0.0.1:{bridge_port}")
                else:
                    options.add_argument(f"--proxy-server={proxy_info['server']}")
                proxy_applied = True
                ip_note = "chỉ cho phép Facebook" if proxy_mode == "facebook_only" else f"Egress IP: {proxy_egress_ip or 'OK'}"
                _notify(on_log, "info", f"🌐 [{uid}] Sử dụng Proxy ({proto.upper()}): {proxy_info['host']}:{proxy_info['port']} ({ip_note})")
        except Exception as proxy_err:
            _close_bridge(key)
            if not allow_direct_fallback:
                raise ProxyConnectionError(f"Proxy không hoạt động: {proxy_err}") from proxy_err
            # Không ghi chuỗi proxy gốc ra log vì có thể chứa user/pass
            logger.warning(f"[{uid}] Proxy không hoạt động ({proxy_err}). Chuyển sang IP gốc của máy!")
            _notify(on_log, "warning", f"⚠️ [{uid}] Proxy không hoạt động ({proxy_err}) — Tự động chuyển sang IP gốc của máy!")
            proxy_applied = False
            proxy_mode = "none"
            proxy_egress_ip = None

    driver: Optional[webdriver.Chrome] = None
    try:
        with _chrome_launch_lock:
            driver_path = _get_chromedriver_path()

            def _start_chrome(path):
                service = Service(path) if path else Service()
                return webdriver.Chrome(service=service, options=options)

            try:
                driver = _start_chrome(driver_path)
            except Exception as e:
                exited = "session not created" in str(e).lower() or "chrome instance exited" in str(e).lower()
                if exited:
                    logger.warning(f"[{uid}] Chrome không mở được vì profile đang bị giữ. Đóng Chrome cũ của nick rồi thử lại.")
                    _release_profile_chrome(profile_path)
                    _cleanup_profile_lockfiles(profile_path)
                    time.sleep(0.5)
                    try:
                        driver = _start_chrome(driver_path)
                    except Exception as retry_error:
                        e = retry_error
                        exited = False
                if driver is None and driver_path and not exited:
                    _reset_chromedriver_path()
                    logger.warning(f"[{uid}] Chromedriver cache failed ({e}), falling back to built-in Selenium Manager...")
                    driver = _start_chrome(None)
                elif driver is None:
                    raise e

        register_active_driver(driver, uid, owner=owner, scope=scope, on_before_close=on_before_close)

        # Bọc quit để luôn hủy đăng ký và đóng bridge của profile
        original_quit = driver.quit

        def quit_with_cleanup(*args, **kwargs):
            try:
                return original_quit(*args, **kwargs)
            finally:
                unregister_active_driver(driver)
                _close_bridge(key)

        driver.quit = quit_with_cleanup

        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": build_init_script(config)})
        for script in extra_init_scripts or ():
            driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": script})
        driver.implicitly_wait(0)
        logger.info(f"[{uid}] Fingerprint mode={config.mode}, window={w}x{h}, lang={config.lang_flag}")

        driver.browser_config = config
        driver.fingerprint_mode = config.mode
        driver.proxy_mode = proxy_mode
        driver.proxy_egress_ip = proxy_egress_ip
        driver.profile_path = profile_path
        driver.uid = str(uid)
        driver.owner = owner

        if not headless:
            bring_chrome_to_front(driver)

        # Proxy chỉ cho phép Facebook chặn trang đọc IP nên không kiểm tra được
        if proxy_applied and verify_egress and proxy_mode != "facebook_only":
            try:
                verify_chrome_egress_ip(driver)
            except Exception as leak_err:
                logger.warning(f"[{uid}] Egress verification note: {leak_err}")

        logger.info(f"Chrome opened for UID={uid}, scope={scope}, profile={profile_path}")
        return driver
    except Exception as exc:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        _close_bridge(key)
        logger.error(f"[{uid}] Khởi tạo Chrome thất bại: {exc}")
        raise


# ── Tiện ích trình duyệt ──

def extract_cookies_as_string(driver) -> str:
    """Cookie hiện tại của driver dạng name=value; name2=value2."""
    try:
        cookies = driver.get_cookies()
        if cookies:
            return "; ".join(f"{c['name']}={c['value']}" for c in cookies if c.get("name") and c.get("value"))
    except Exception:
        pass
    return ""


COOKIE_PERSIST_SECONDS = 365 * 24 * 3600  # Gần với hạn cookie đăng nhập thật của Facebook


def load_cookies(driver, cookie_string: str):
    """
    Nạp cookie (name=value; ...) vào facebook.com. Không xóa cookie cũ để giữ token thiết bị của profile.
    Cookie không có expiry là cookie phiên, Chrome xóa khi đóng nên lần mở sau profile mất đăng nhập:
    gắn hạn dùng để profile giữ phiên như trình duyệt thật.
    """
    if not cookie_string or not cookie_string.strip() or "c_user=" not in cookie_string:
        logger.info("load_cookies: cookie không có c_user hoặc rỗng, giữ nguyên cookie của profile.")
        return
    try:
        driver.get("https://www.facebook.com")
        time.sleep(1)
    except Exception as e:
        logger.warning(f"Lỗi truy cập facebook.com khi nạp cookie: {e}")

    expiry = int(time.time()) + COOKIE_PERSIST_SECONDS
    for part in cookie_string.split(";"):
        part = part.strip()
        if "=" not in part:
            continue
        name, _, value = part.partition("=")
        try:
            driver.add_cookie({
                "name": name.strip(), "value": value.strip(),
                "domain": ".facebook.com", "path": "/", "secure": True, "expiry": expiry,
            })
        except Exception as e:
            logger.warning(f"Failed to add cookie '{name}': {e}")

    # Giao diện Facebook tiếng Việt: locator của các module dựa trên nhãn tiếng Việt
    try:
        driver.add_cookie({"name": "locale", "value": "vi_VN", "domain": ".facebook.com", "path": "/"})
    except Exception:
        pass
    logger.info(f"Loaded {len(cookie_string.split(';'))} cookies")


# Alias tương thích ngược cho Module 02
create_driver = open_browser



def wait_and_find(driver, locators: list, timeout: int = 15):
    """Thử lần lượt các XPath tới khi thấy phần tử đang hiển thị hoặc hết timeout."""
    from selenium.common.exceptions import TimeoutException

    start = time.time()
    while time.time() - start < timeout:
        for locator in locators:
            try:
                for el in driver.find_elements(By.XPATH, locator):
                    if el.is_displayed():
                        return el
            except Exception:
                pass
        time.sleep(0.4)
    raise TimeoutException(f"None of {len(locators)} locators matched after {timeout}s")
