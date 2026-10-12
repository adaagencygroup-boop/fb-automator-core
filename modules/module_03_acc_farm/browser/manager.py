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
from typing import Optional, Dict
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager

from modules.module_03_acc_farm.browser.proxy_bridge import (
    parse_proxy,
    test_proxy_connectivity,
    ProxyBridge,
    verify_chrome_egress_ip,
    ProxyConnectionError,
)

logger = logging.getLogger(__name__)

from modules.module_03_acc_farm.browser.paths import get_profile_path

# ── Quản lý khóa Profile theo UID & Danh sách Driver đang hoạt động ──
_profile_locks = {}
_profile_locks_guard = threading.Lock()

def get_profile_lock(uid: str) -> threading.Lock:
    """Trả về lock đồng bộ theo UID, ngăn ngừa 2 tiến trình/thread truy cập cùng 1 profile Chrome cùng lúc."""
    with _profile_locks_guard:
        uid_str = str(uid)
        if uid_str not in _profile_locks:
            _profile_locks[uid_str] = threading.Lock()
        return _profile_locks[uid_str]

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


_active_drivers_lock = threading.Lock()
_active_drivers = {}  # driver -> {"uid": str(uid), "scope": scope}

def register_active_driver(driver, uid: str = "", scope: str = "creator"):
    """Đăng ký driver đang hoạt động kèm thông tin UID và scope để quản lý theo luồng."""
    with _active_drivers_lock:
        _active_drivers[driver] = {"uid": str(uid), "scope": scope}

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
        _active_bridges[str(uid)] = bridge

def get_active_bridge(uid: str) -> Optional[ProxyBridge]:
    """Lấy proxy bridge đang chạy của UID nếu có."""
    with _active_bridges_lock:
        return _active_bridges.get(str(uid))

def close_bridge_for_uid(uid: str):
    """Đóng an toàn proxy bridge nội bộ của UID nếu có."""
    with _active_bridges_lock:
        bridge = _active_bridges.pop(str(uid), None)
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
            if (isinstance(info, dict) and info.get("uid") == str(uid)) or info == str(uid)
        ]
        for d in to_close:
            _active_drivers.pop(d, None)

    for d in to_close:
        try:
            # Trước khi đóng, thử trích xuất cookie mới nhất và lưu vào DB nếu có c_user!
            try:
                cookies = extract_cookies_as_string(d)
                if cookies and "c_user=" in cookies:
                    from modules.module_03_acc_farm import adapters
                    adapters.save_cookie(uid, cookies)
                    adapters.set_login_status(uid, "logged_in")
                    logger.info(f"[{uid}] Tự động lưu cookies mới nhất vào DB trước khi đóng browser.")
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


# Nhiễu canvas/WebGL cố định theo seed của UID: cùng nick luôn ra cùng một dấu vân tay, khác nick thì khác.
# Không sửa nội dung canvas gốc, chỉ sửa dữ liệu trả ra khi trang đọc pixel.
_FINGERPRINT_NOISE_JS = r"""
(() => {
  const SEED = __SEED__ >>> 0;
  const nativeToString = Function.prototype.toString;
  const patched = new WeakMap();
  const hide = (fn, original) => { patched.set(fn, nativeToString.call(original)); return fn; };
  Function.prototype.toString = hide(function toString() {
    return patched.has(this) ? patched.get(this) : nativeToString.call(this);
  }, nativeToString);

  const delta = (i) => {
    let x = (SEED ^ Math.imul(i + 1, 2654435761)) >>> 0;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return (x % 3) - 1;
  };
  const noise = (data) => {
    for (let i = 0; i < data.length; i += 4) {
      if (((i >> 2) + SEED) % 7 !== 0) continue;
      data[i] = Math.min(255, Math.max(0, data[i] + delta(i)));
    }
  };

  const ctx2d = CanvasRenderingContext2D.prototype;
  const origGetImageData = ctx2d.getImageData;
  ctx2d.getImageData = hide(function getImageData(...args) {
    const img = origGetImageData.apply(this, args);
    try { noise(img.data); } catch (e) {}
    return img;
  }, origGetImageData);

  const noisyCopy = (canvas) => {
    if (!canvas.width || !canvas.height) return null;
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const c = copy.getContext('2d');
    c.drawImage(canvas, 0, 0);
    const img = origGetImageData.call(c, 0, 0, copy.width, copy.height);
    noise(img.data);
    c.putImageData(img, 0, 0);
    return copy;
  };
  const canvasProto = HTMLCanvasElement.prototype;
  const origToDataURL = canvasProto.toDataURL;
  canvasProto.toDataURL = hide(function toDataURL(...args) {
    try { const copy = noisyCopy(this); if (copy) return origToDataURL.apply(copy, args); } catch (e) {}
    return origToDataURL.apply(this, args);
  }, origToDataURL);
  const origToBlob = canvasProto.toBlob;
  canvasProto.toBlob = hide(function toBlob(...args) {
    try { const copy = noisyCopy(this); if (copy) return origToBlob.apply(copy, args); } catch (e) {}
    return origToBlob.apply(this, args);
  }, origToBlob);

  for (const proto of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean).map(c => c.prototype)) {
    const origReadPixels = proto.readPixels;
    proto.readPixels = hide(function readPixels(...args) {
      const result = origReadPixels.apply(this, args);
      try { const px = args[6]; if (px && px.length) noise(px); } catch (e) {}
      return result;
    }, origReadPixels);
  }
})();
"""


def resolve_fingerprint(uid: str, profile_path: str) -> dict:
    """
    Lấy (hoặc tạo lần đầu) chế độ dấu vân tay của UID.
    Profile đã có thư mục Default (đã từng mở Chrome) thì giữ legacy để không đổi dấu vân tay của nick đang dùng.
    Lỗi DB thì ném lỗi, không mở Chrome: tự về legacy sẽ làm nick native mất nhiễu canvas giữa chừng (đổi thiết bị).
    """
    from modules.module_03_acc_farm import repository
    profile_used_before = os.path.isdir(os.path.join(profile_path, "Default"))
    try:
        return repository.get_or_create_fingerprint(uid, profile_used_before)
    except Exception as e:
        logger.warning(f"[{uid}] Không đọc được fingerprint, không mở trình duyệt: {e}")
        raise RuntimeError("Không đọc được dấu vân tay trình duyệt từ CSDL, bỏ qua để tránh đổi thiết bị") from e


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
    allow_direct_fallback: bool = True,
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
        scope: Mục đích ("creator" | "live" | "login" | "farm").
        verify_egress: Kiểm tra Egress IP trong Chrome khi có proxy active.
        allow_direct_fallback: Proxy chết thì chuyển sang IP gốc của máy (False: ném ProxyConnectionError).
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

    # Dấu vân tay theo UID (phải xác định trước khi Chrome tạo thư mục Default cho profile mới)
    fingerprint = resolve_fingerprint(uid, profile_path)
    # Không ép UA cho cả 2 chế độ: UA cố định Chrome/127 lệch với Client Hints (sec-ch-ua) mà Chrome thật vẫn gửi,
    # đó là dấu hiệu bot rõ. Với nick cũ, UA lên phiên bản mới chỉ giống một lần cập nhật Chrome bình thường.

    if headless:
        options.add_argument("--headless=new")
        options.add_argument("--window-size=1920,1080")

    if scope == "farm":
        # Tương tác nuôi nick: không để Chrome hãm timer / tạm dừng video khi cửa sổ bị che hoặc thu nhỏ
        options.add_argument("--disable-background-timer-throttling")
        options.add_argument("--disable-renderer-backgrounding")
        options.add_argument("--disable-backgrounding-occluded-windows")
        options.add_argument("--autoplay-policy=no-user-gesture-required")

    # Đóng driver và bridge cũ của UID này nếu còn mở để giải phóng lock
    close_driver_for_uid(uid)

    # Dọn dẹp lockfile cũ nếu có để tránh xung đột phiên Chrome
    _cleanup_profile_lockfiles(uid)

    # ─── Cấu hình Proxy (nếu có, tự động fallback Direct IP nếu proxy chết) ───
    bridge: Optional[ProxyBridge] = None
    proxy_applied = False
    proxy_mode = "none"
    proxy_egress_ip = None
    if proxy and str(proxy).strip():
        proxy_str = str(proxy).strip()
        try:
            proxy_info = parse_proxy(proxy_str)
            if proxy_info:
                # 1. Pre-flight connectivity testing (HTTP + HTTPS)
                logger.info(f"[{uid}] Pre-flight testing proxy: {proxy_info['server']} (auth={proxy_info['has_auth']})...")
                res = test_proxy_connectivity(proxy_info, timeout=6)
                egress_ip = res.get("egress_ip", "")
                proxy_mode = res.get("mode", "full")
                proxy_egress_ip = egress_ip or None

                # 2. Xử lý Proxy có xác thực qua Local Proxy Bridge
                if proxy_info["has_auth"]:
                    bridge = ProxyBridge(
                        upstream_host=proxy_info["host"],
                        upstream_port=proxy_info["port"],
                        username=proxy_info["username"],
                        password=proxy_info["password"],
                    )
                    bridge_port = bridge.start()
                    register_active_bridge(uid, bridge)
                    options.add_argument(f"--proxy-server=http://127.0.0.1:{bridge_port}")
                    logger.info(f"[{uid}] Authenticated Proxy routed through Local Bridge: 127.0.0.1:{bridge_port}")
                else:
                    proxy_server = proxy_info["server"]
                    options.add_argument(f"--proxy-server={proxy_server}")
                    logger.info(f"[{uid}] Direct Chrome Proxy flag configured: {proxy_server}")

                proxy_applied = True
                try:
                    from modules.module_03_acc_farm import adapters
                    ip_note = "chỉ cho phép Facebook" if proxy_mode == "facebook_only" else f"Egress IP: {egress_ip or 'OK'}"
                    adapters.emit_log("info", f"🌐 [{uid}] Sử dụng Proxy: {proxy_info['host']}:{proxy_info['port']} ({ip_note})", uid=uid)
                except Exception:
                    pass
        except Exception as proxy_err:
            if not allow_direct_fallback:
                close_bridge_for_uid(uid)
                raise ProxyConnectionError(f"Proxy không hoạt động: {proxy_err}") from proxy_err
            # Không ghi chuỗi proxy gốc ra log vì có thể chứa user/pass
            logger.warning(f"[{uid}] Proxy không hoạt động ({proxy_err}). Tự động chuyển sang IP gốc của máy!")
            try:
                from modules.module_03_acc_farm import adapters
                adapters.emit_log("warning", f"⚠️ [{uid}] Proxy không hoạt động ({proxy_err}) — Tự động chuyển sang IP gốc của máy!", uid=uid)
            except Exception:
                pass
            proxy_applied = False
            close_bridge_for_uid(uid)

    driver: Optional[webdriver.Chrome] = None
    try:
        with _chrome_launch_lock:
            driver_path = _get_chromedriver_path()
            try:
                service = Service(driver_path) if driver_path else Service()
                driver = webdriver.Chrome(service=service, options=options)
            except Exception as e:
                if not driver_path:
                    raise
                _reset_chromedriver_path()
                logger.warning(f"[{uid}] Chromedriver cache failed ({e}), falling back to built-in Selenium Manager...")
                driver = webdriver.Chrome(service=Service(), options=options)

        # Đăng ký driver kèm UID và scope
        register_active_driver(driver, uid=uid, scope=scope)

        # Bọc driver.quit để tự động đóng bridge và hủy đăng ký driver
        original_quit = driver.quit
        def quit_with_cleanup(*args, **kwargs):
            try:
                return original_quit(*args, **kwargs)
            finally:
                unregister_active_driver(driver)
                close_bridge_for_uid(uid)

        driver.quit = quit_with_cleanup

        # Giữ plugins thật của Chrome cho mọi profile (mảng số giả [1..5] dễ bị nhận ra).
        # Chỉ profile mới (native) thêm nhiễu canvas/WebGL theo UID; profile cũ giữ nguyên canvas để không đổi thiết bị.
        stealth_js = """
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            Object.defineProperty(navigator, 'languages', {
                get: () => ['vi-VN', 'vi', 'en-US', 'en']
            });
        """
        if fingerprint["mode"] != "legacy":
            stealth_js += _FINGERPRINT_NOISE_JS.replace("__SEED__", str(int(fingerprint["canvas_seed"] or 1)))
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": stealth_js})
        logger.info(f"[{uid}] Fingerprint mode={fingerprint['mode']}")

        if scope == "farm":
            # Page Visibility luôn báo đang hiển thị và chặn sự kiện visibilitychange tới script của trang
            driver.execute_cdp_cmd(
                "Page.addScriptToEvaluateOnNewDocument",
                {
                    "source": """
                        Object.defineProperty(document, 'hidden', { get: () => false });
                        Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
                        const stopVisibility = (e) => e.stopImmediatePropagation();
                        window.addEventListener('visibilitychange', stopVisibility, true);
                        document.addEventListener('visibilitychange', stopVisibility, true);
                    """
                }
            )

        driver.implicitly_wait(0)  # Tắt implicit wait, dùng explicit wait

        driver.proxy_mode = proxy_mode
        driver.proxy_egress_ip = proxy_egress_ip
        driver.fingerprint_mode = fingerprint["mode"]

        # ─── Kiểm tra Egress IP trong chính Chrome nếu proxy active ───
        # Proxy chỉ cho phép Facebook chặn trang đọc IP, kiểm tra sẽ luôn thất bại nên bỏ qua
        if proxy_applied and verify_egress and proxy_mode == "facebook_only":
            logger.info(f"[{uid}] Proxy chỉ cho phép Facebook: bỏ qua kiểm tra Egress IP trong Chrome")
        elif proxy_applied and verify_egress:
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


COOKIE_PERSIST_SECONDS = 365 * 24 * 3600  # Gần với hạn cookie đăng nhập thật của Facebook


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

    # Parse và thêm/ghi đè từng cookie (không dùng delete_all_cookies để giữ các token thiết bị và profile storage).
    # Gắn hạn dùng: cookie không có expiry là cookie phiên, Chrome xóa khi đóng nên lần mở sau profile mất đăng nhập
    # và phải bơm lại (Facebook thấy thiết bị quen vào trạng thái chưa đăng nhập rồi đột nhiên có phiên, mỗi lần chạy).
    expiry = int(time.time()) + COOKIE_PERSIST_SECONDS
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
                    "secure": True,
                    "expiry": expiry,
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
