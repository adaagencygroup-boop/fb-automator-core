"""Automation primitives for Facebook account management and browser automation."""
from .browser_manager import (
    create_driver,
    close_driver_for_uid,
    safe_close_driver,
    get_profile_lock,
    register_active_driver,
    unregister_active_driver,
    extract_cookies_as_string,
    human_type,
    human_sleep,
    wait_and_find,
)
from .login_flow import (
    run_login,
    ensure_logged_in,
    is_checkpoint_url,
)
from .locators import LOGIN

__all__ = [
    "create_driver",
    "close_driver_for_uid",
    "safe_close_driver",
    "get_profile_lock",
    "register_active_driver",
    "unregister_active_driver",
    "extract_cookies_as_string",
    "human_type",
    "human_sleep",
    "wait_and_find",
    "run_login",
    "ensure_logged_in",
    "is_checkpoint_url",
    "LOGIN",
]
