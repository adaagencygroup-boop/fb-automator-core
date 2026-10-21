"""
browser_manager.py (Module 02 wrapper)
Ủy quyền toàn bộ việc khởi tạo Chrome, profile, khóa profile và proxy bridge sang `core.browser` dùng chung.
Giữ nguyên giao diện API và hàm cho Module 02.
"""
import logging
from typing import Optional, Dict, Any, List
from selenium import webdriver

from core.browser import (
    open_browser,
    get_profile_lock as _core_get_profile_lock,
    get_profile_path as _core_get_profile_path,
    close_driver_for_uid as _core_close_driver_for_uid,
    close_all_active_drivers as _core_close_all_active_drivers,
    close_scoped_active_drivers as _core_close_scoped_active_drivers,
    safe_close_driver,
    force_kill_driver,
    extract_cookies_as_string,
    load_cookies,
    wait_and_find,
    human_sleep,
    human_type,
    register_active_driver as _core_register_active_driver,
    unregister_active_driver as _core_unregister_active_driver,
    register_active_bridge as _core_register_active_bridge,
    get_active_bridge as _core_get_active_bridge,
    close_bridge_for_uid as _core_close_bridge_for_uid,
    close_all_active_bridges as _core_close_all_active_bridges,
    parse_proxy,
    test_proxy_connectivity,
    ProxyError,
    ProxyFormatError,
    ProxyConnectionError,
    ProxyLeakError,
)
from core.browser.proxy_bridge import ProxyBridge, verify_chrome_egress_ip, get_direct_ip
from core.browser.driver import _active_drivers, _active_drivers_lock, _active_bridges, _active_bridges_lock

from ..utils.paths import BASE_DIR, PROFILES_DIR, account_key
from ..context import owner_context, owner_scope

logger = logging.getLogger(__name__)


def get_profile_lock(uid: str):
    """Khóa profile theo UID và owner hiện tại, dùng chung lock từ core.browser."""
    return _core_get_profile_lock(uid, owner=owner_context.get())


def get_profile_path(uid: str) -> str:
    """Đường dẫn thư mục profile theo UID và owner hiện tại từ core.browser."""
    return _core_get_profile_path(uid, owner=owner_context.get())


def register_active_driver(driver, uid: str = "", scope: str = "creator"):
    """Đăng ký driver vào registry chung của core.browser."""
    _core_register_active_driver(driver, uid=uid, owner=owner_context.get(), scope=scope)


def unregister_active_driver(driver):
    """Hủy đăng ký driver khỏi registry chung của core.browser."""
    _core_unregister_active_driver(driver)


def register_active_bridge(uid: str, bridge: ProxyBridge):
    _core_register_active_bridge(uid, bridge, owner=owner_context.get())


def get_active_bridge(uid: str) -> Optional[ProxyBridge]:
    return _core_get_active_bridge(uid, owner=owner_context.get())


def close_bridge_for_uid(uid: str):
    _core_close_bridge_for_uid(uid, owner=owner_context.get())


def close_all_active_bridges():
    _core_close_all_active_bridges()


def close_driver_for_uid(uid: str):
    _core_close_driver_for_uid(uid, owner=owner_context.get())


def close_scoped_active_drivers(scope: str = "creator", force: bool = False):
    return _core_close_scoped_active_drivers(scope=scope, force=force)


def close_all_active_drivers():
    _core_close_all_active_drivers()


def create_driver(
    uid: str,
    headless: bool = False,
    detach: bool = False,
    proxy: Optional[str] = None,
    scope: str = "creator",
    verify_egress: bool = True,
    on_log: Optional[Any] = None,
) -> webdriver.Chrome:
    """
    Tạo Chrome WebDriver dùng chung từ core.browser (persistent profile, proxy bridge, stealth).
    Tự động broadcast log proxy và mở Chrome ra SSE Terminal của Module 02.
    """
    owner = owner_context.get()

    def _default_on_log(level: str, msg: str):
        try:
            from ..services.events import broadcast
            broadcast(level, msg, uid=uid)
        except Exception:
            pass
        if on_log:
            try:
                on_log(level, msg)
            except Exception:
                pass

    return open_browser(
        uid=uid,
        owner=owner,
        headless=headless,
        detach=detach,
        proxy=proxy,
        scope=scope,
        allow_direct_fallback=True,
        verify_egress=verify_egress,
        on_log=_default_on_log,
    )
