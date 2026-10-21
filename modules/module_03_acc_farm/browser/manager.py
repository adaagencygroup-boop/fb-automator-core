# -*- coding: utf-8 -*-
"""
Browser manager bridge for Module 03 (Account Farm & Auto Post).
Connects Module 03 to the unified browser profile and proxy manager from Module 02.
"""

from typing import Optional
from selenium import webdriver
from modules.module_02_account_manager.automation.browser_manager import (
    create_driver,
    get_profile_path,
    close_driver_for_uid,
)


def safe_close_driver(driver: Optional[webdriver.Chrome], uid: Optional[str] = None) -> None:
    """Đóng driver an toàn không quăng ngoại lệ."""
    if not driver:
        return
    try:
        driver.quit()
    except Exception:
        pass
    if uid:
        try:
            close_driver_for_uid(uid)
        except Exception:
            pass


__all__ = [
    "create_driver",
    "safe_close_driver",
    "get_profile_path",
    "close_driver_for_uid",
]
