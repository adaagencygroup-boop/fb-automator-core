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
LogCallback = Callable[[str, str], None]
WEBRTC_IP_POLICY = "disable_non_proxied_udp"
def _notify(on_log: Optional[LogCallback], level: str, message: str):
  if on_log:
    try:
      on_log(level, message)
    except Exception as e:
      logger.debug(f"on_log callback error: {e}")
_chromedriver_path: Optional[str] = None
_chromedriver_path_lock = threading.Lock()
_chrome_launch_lock = threading.Lock()
def _get_chromedriver_path() -> Optional[str]:
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
  global _chromedriver_path
  with _chromedriver_path_lock:
    _chromedriver_path = None
_active_drivers_lock = threading.Lock()
_active_drivers: Dict[object, dict] = {}
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
  key = profile_key(uid, owner) if uid is not None else None
  with _active_drivers_lock:
    return [d for d, info in _active_drivers.items()
        if (key is None or info["key"] == key) and (scope is None or info["scope"] == scope)]
_active_bridges: Dict[str, ProxyBridge] = {}
_active_bridges_lock = threading.Lock()
def _register_bridge(key: str, bridge: ProxyBridge):
  with _active_bridges_lock:
    _active_bridges[key] = bridge
def register_active_bridge(uid: str, bridge: ProxyBridge, owner: Optional[str] = None):
  _register_bridge(profile_key(uid, owner), bridge)
def get_active_bridge(uid: str, owner: Optional[str] = None) -> Optional[ProxyBridge]:
  with _active_bridges_lock:
    return _active_bridges.get(profile_key(uid, owner))
def close_bridge_for_uid(uid: str, owner: Optional[str] = None):
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
def _windows_no_window_flags() -> int:
  if os.name != "nt":
    return 0
  return int(getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000))
def force_kill_driver(driver):
  killed = False
  try:
    pid = driver.service.process.pid
    if pid:
      _kill_pids([pid])
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
  try:
    import psutil
  except ImportError:
    psutil = None
  flags = _windows_no_window_flags()
  for pid in pids:
    if not isinstance(pid, int) or pid <= 0:
      continue
    if psutil is not None:
      try:
        proc = psutil.Process(pid)
        children = proc.children(recursive=True)
        for child in children:
          try:
            child.kill()
          except Exception:
            pass
        proc.kill()
        continue
      except Exception:
        pass
    try:
      if os.name == "nt":
        subprocess.run(
          ["taskkill", "/F", "/T", "/PID", str(pid)],
          capture_output=True,
          timeout=5,
          creationflags=flags,
        )
      else:
        os.kill(pid, 9)
    except Exception:
      pass
def safe_close_driver(driver):
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
  if not cmdline or not profile_path:
    return False
  needle = os.path.normcase(os.path.normpath(profile_path))
  if len(needle) < 12:
    return False
  return needle in os.path.normcase(" ".join(cmdline))
def _release_profile_chrome(profile_path: str):
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
  for name in ("lockfile", "parent.lock", "SingletonLock", "SingletonCookie", "SingletonSocket", "DevToolsActivePort"):
    p = os.path.join(profile_path, name)
    if os.path.exists(p):
      try:
        os.remove(p)
      except Exception:
        pass
def close_driver_for_uid(uid: str, owner: Optional[str] = None):
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
def close_scoped_active_drivers(
  scope: str,
  force: bool = False,
  *,
  uids: Optional[Iterable[str]] = None,
  exclude_uids: Optional[Iterable[str]] = None,
) -> List[str]:
  only = {str(u) for u in uids} if uids is not None else None
  skip = {str(u) for u in exclude_uids} if exclude_uids is not None else set()
  with _active_drivers_lock:
    to_close = [
      (d, info) for d, info in _active_drivers.items()
      if info["scope"] == scope
      and (only is None or info["uid"] in only)
      and info["uid"] not in skip
    ]
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
  with _active_drivers_lock:
    drivers = list(_active_drivers.keys())
    _active_drivers.clear()
  for d in drivers:
    try:
      safe_close_driver(d)
    except Exception as e:
      logger.warning(f"Lỗi khi force quit browser: {e}")
  close_all_active_bridges()
def _chrome_hwnds_for_pids(pids) -> list:
  if os.name != "nt" or not pids:
    return []
  try:
    import ctypes
    from ctypes import wintypes
  except Exception:
    return []
  pid_set = {int(p) for p in pids if isinstance(p, int) and p > 0}
  if not pid_set:
    return []
  user32 = ctypes.windll.user32
  found = []
  @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
  def _enum_cb(hwnd, _):
    if not user32.IsWindowVisible(hwnd):
      return True
    class_buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, class_buf, 256)
    if class_buf.value != "Chrome_WidgetWin_1":
      return True
    proc_id = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(proc_id))
    if int(proc_id.value) not in pid_set:
      return True
    rect = wintypes.RECT()
    if user32.GetWindowRect(hwnd, ctypes.byref(rect)):
      w = int(rect.right - rect.left)
      h = int(rect.bottom - rect.top)
      if w < 200 or h < 200:
        return True
      area = w * h
    else:
      area = 0
    found.append((area, int(hwnd)))
    return True
  try:
    user32.EnumWindows(_enum_cb, 0)
  except Exception:
    return []
  found.sort(key=lambda x: x[0], reverse=True)
  return [hwnd for _area, hwnd in found]
def _foreground_hwnd(hwnd: int) -> None:
  if os.name != "nt" or not hwnd:
    return
  try:
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    SW_RESTORE = 9
    HWND_TOPMOST = -1
    HWND_NOTOPMOST = -2
    SWP_SHOWWINDOW = 0x0040
    SWP_NOSIZE = 0x0001
    SWP_NOMOVE = 0x0002
    if user32.IsIconic(hwnd):
      user32.ShowWindow(hwnd, SW_RESTORE)
    fg = user32.GetForegroundWindow()
    fg_pid = wintypes.DWORD(0)
    target_pid = wintypes.DWORD(0)
    fg_tid = user32.GetWindowThreadProcessId(fg, ctypes.byref(fg_pid)) if fg else 0
    cur_tid = kernel32.GetCurrentThreadId()
    target_tid = user32.GetWindowThreadProcessId(hwnd, ctypes.byref(target_pid))
    attached_fg = False
    attached_target = False
    try:
      if fg_tid and fg_tid != cur_tid:
        attached_fg = bool(user32.AttachThreadInput(cur_tid, fg_tid, True))
      if target_tid and target_tid != cur_tid:
        attached_target = bool(user32.AttachThreadInput(cur_tid, target_tid, True))
      user32.SetWindowPos(
        hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW
      )
      user32.SetWindowPos(
        hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW
      )
      user32.BringWindowToTop(hwnd)
      user32.SetForegroundWindow(hwnd)
    finally:
      if attached_target and target_tid:
        try:
          user32.AttachThreadInput(cur_tid, target_tid, False)
        except Exception:
          pass
      if attached_fg and fg_tid:
        try:
          user32.AttachThreadInput(cur_tid, fg_tid, False)
        except Exception:
          pass
  except Exception:
    pass
def bring_chrome_to_front(driver=None, os_focus: bool = False):
  if not driver:
    return
  try:
    driver.switch_to.window(driver.current_window_handle)
  except Exception:
    pass
  try:
    driver.execute_cdp_cmd("Page.bringToFront", {})
  except Exception:
    pass
  if not os_focus or os.name != "nt":
    return
  try:
    pids = _driver_pids(driver)
    hwnds = _chrome_hwnds_for_pids(pids)
    if not hwnds:
      logger.debug("bring_chrome_to_front: không tìm thấy HWND theo PID — bỏ qua OS focus")
      return
    _foreground_hwnd(hwnds[0])
  except Exception as e:
    logger.debug(f"bring_chrome_to_front PID focus lỗi: {e}")
def _list_display_monitors() -> List[tuple]:
  if os.name != "nt":
    return [(0, 0, 1920, 1080)]
  try:
    import ctypes
    from ctypes import wintypes
    class RECT(ctypes.Structure):
      _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
      ]
    monitors: List[tuple] = []
    def _cb(hmon, hdc, lprect, lparam):
      r = lprect.contents
      monitors.append((int(r.left), int(r.top), int(r.right - r.left), int(r.bottom - r.top)))
      return 1
    MonitorEnumProc = ctypes.WINFUNCTYPE(
      ctypes.c_int,
      wintypes.HMONITOR,
      wintypes.HDC,
      ctypes.POINTER(RECT),
      wintypes.LPARAM,
    )
    ctypes.windll.user32.EnumDisplayMonitors(0, 0, MonitorEnumProc(_cb), 0)
    if monitors:
      monitors.sort(key=lambda m: (m[0], m[1]))
      return monitors
  except Exception as e:
    logger.debug(f"_list_display_monitors EnumDisplayMonitors: {e}")
  try:
    import ctypes
    user32 = ctypes.windll.user32
    cx = int(user32.GetSystemMetrics(0) or 1920)
    cy = int(user32.GetSystemMetrics(1) or 1080)
    vx = int(user32.GetSystemMetrics(76) or 0)
    vy = int(user32.GetSystemMetrics(77) or 0)
    vw = int(user32.GetSystemMetrics(78) or cx)
    vh = int(user32.GetSystemMetrics(79) or cy)
    if vw > cx + 200:
      return [(0, 0, cx, cy), (vx + cx if vx <= 0 else vx, vy, max(800, vw - cx), vh)]
    return [(0, 0, cx, cy)]
  except Exception:
    return [(0, 0, 1920, 1080)]
def place_chrome_window_for_slot(
  driver,
  slot: int = 0,
  width: Optional[int] = None,
  height: Optional[int] = None,
) -> None:
  if not driver:
    return
  try:
    slot = max(0, int(slot))
  except Exception:
    slot = 0
  try:
    size = driver.get_window_size() or {}
    w = int(width or size.get("width") or 1100)
    h = int(height or size.get("height") or 800)
  except Exception:
    w, h = 1100, 800
  w = max(800, min(w, 1600))
  h = max(600, min(h, 1200))
  monitors = _list_display_monitors()
  if len(monitors) >= 2:
    mon = monitors[slot % len(monitors)]
    ml, mt, mw, mh = mon
    x = ml + max(20, (mw - w) // 8)
    y = mt + max(20, (mh - h) // 10)
  else:
    ml, mt, mw, mh = monitors[0]
    if slot % 2 == 0:
      x = ml + 20
    else:
      x = ml + max(20, mw // 2 + 10)
      w = min(w, max(800, mw // 2 - 40))
    y = mt + 40
  try:
    driver.set_window_rect(x=int(x), y=int(y), width=int(w), height=int(h))
    logger.info(f"place_chrome_window_for_slot: slot={slot} -> ({x},{y}) {w}x{h} monitors={len(monitors)}")
  except Exception as e:
    logger.debug(f"place_chrome_window_for_slot lỗi: {e}")
    try:
      driver.set_window_position(int(x), int(y))
    except Exception:
      pass
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
  window_slot: Optional[int] = None,
) -> webdriver.Chrome:
  profile_path = get_profile_path(uid, owner)
  key = profile_key(uid, owner)
  for stale_file in ("DevToolsActivePort", "lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"):
    try:
      target_lock = os.path.join(profile_path, stale_file)
      if os.path.exists(target_lock):
        os.remove(target_lock)
    except Exception:
      pass
  config = resolve_browser_config(uid, profile_path)
  w, h = config.window_size
  options = Options()
  options.add_argument(f"--user-data-dir={profile_path}")
  options.add_argument("--profile-directory=Default")
  # Luồng chạy nhiều Chrome cùng lúc / cuộn trang dài: cửa sổ bị che hoặc thu nhỏ vẫn phải chạy trang,
  # nếu không Facebook ngừng tải thêm kết quả khi cuộn (Module 10 quét nhóm / thành viên song song).
  if scope in ("page_scanner", "profile_scan", "post", "group-scan", "group-members", "post-engagement"):
    if scope in ("page_scanner", "profile_scan"):
      options.page_load_strategy = "eager"
    for _arg in (
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-features=CalculateNativeWinOcclusion",
    ):
      options.add_argument(_arg)
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
  options.add_argument(f"--window-size={w},{h}")
  if not headless:
    if scope == "post":
      slot0 = int(window_slot) if window_slot is not None else (abs(hash(f"{owner or ''}:{uid}")) % 2)
      options.add_argument(f"--window-position={40 + slot0 * 120},{40 + slot0 * 40}")
    elif scope in ("group-scan", "group-members", "post-engagement") and window_slot is not None:
      # Mỗi Chrome song song lệch vị trí một chút để thấy được từng cửa sổ (không đè kín nhau).
      slot0 = max(0, int(window_slot)) % 5
      options.add_argument(f"--window-position={50 + slot0 * 140},{50 + slot0 * 60}")
    else:
      options.add_argument("--window-position=50,50")
  options.add_argument(f"--force-webrtc-ip-handling-policy={WEBRTC_IP_POLICY}")
  options.add_experimental_option("prefs", {
    "profile.default_content_setting_values.notifications": 2,
    "profile.default_content_setting_values.clipboard": 1,
    "profile.content_settings.exceptions.clipboard": {
      "https://www.facebook.com,*": {"setting": 1},
      "https://web.facebook.com,*": {"setting": 1},
      "[*.]facebook.com,*": {"setting": 1},
    },
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
    if scope == "page_scanner":
      try:
        driver.set_page_load_timeout(30)
      except Exception:
        pass
    logger.info(f"[{uid}] Fingerprint mode={config.mode}, window={w}x{h}, lang={config.lang_flag}")
    driver.browser_config = config
    driver.fingerprint_mode = config.mode
    driver.proxy_mode = proxy_mode
    driver.proxy_egress_ip = proxy_egress_ip
    driver.profile_path = profile_path
    driver.uid = str(uid)
    driver.owner = owner
    if not headless:
      if scope == "post":
        slot = int(window_slot) if window_slot is not None else (abs(hash(f"{owner or ''}:{uid}")) % 2)
        place_chrome_window_for_slot(driver, slot=slot, width=w, height=h)
      bring_chrome_to_front(driver)
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
def extract_cookies_as_string(driver) -> str:
  try:
    cookies = driver.get_cookies()
    if cookies:
      return "; ".join(f"{c['name']}={c['value']}" for c in cookies if c.get("name") and c.get("value"))
  except Exception:
    pass
  return ""
COOKIE_PERSIST_SECONDS = 365 * 24 * 3600
def load_cookies(driver, cookie_string: str):
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
  try:
    driver.add_cookie({"name": "locale", "value": "vi_VN", "domain": ".facebook.com", "path": "/"})
  except Exception:
    pass
  logger.info(f"Loaded {len(cookie_string.split(';'))} cookies")
create_driver = open_browser
def wait_and_find(driver, locators: list, timeout: int = 15):
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
from core.browser.human import install_os_independent_click
install_os_independent_click()