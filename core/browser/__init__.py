"""
core.browser: mở Chrome dùng chung cho mọi module (profile, khóa, dấu vân tay, proxy).
Xem core/browser/README.md.
"""
from core.browser.driver import (
    close_all_active_drivers,
    close_driver_for_uid,
    close_scoped_active_drivers,
    extract_cookies_as_string,
    force_kill_driver,
    get_active_drivers,
    load_cookies,
    open_browser,
    safe_close_driver,
    unregister_active_driver,
    wait_and_find,
)
from core.browser.fingerprint import BrowserConfig
from core.browser.human import human_sleep, human_type
from core.browser.profile import get_profile_lock, get_profile_path
from core.browser.proxy_bridge import (
    ProxyConnectionError,
    ProxyError,
    ProxyFormatError,
    ProxyLeakError,
    parse_proxy,
)

__all__ = [
    "open_browser",
    "close_driver_for_uid",
    "close_scoped_active_drivers",
    "close_all_active_drivers",
    "safe_close_driver",
    "force_kill_driver",
    "get_active_drivers",
    "unregister_active_driver",
    "extract_cookies_as_string",
    "load_cookies",
    "wait_and_find",
    "get_profile_path",
    "get_profile_lock",
    "BrowserConfig",
    "human_type",
    "human_sleep",
    "parse_proxy",
    "ProxyError",
    "ProxyFormatError",
    "ProxyConnectionError",
    "ProxyLeakError",
]
