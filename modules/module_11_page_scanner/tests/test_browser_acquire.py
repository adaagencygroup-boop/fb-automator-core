"""Khóa profile phải được nhả khi mở Chrome lỗi (không treo acc tới khi restart app)."""
from __future__ import annotations

import unittest
import uuid
from unittest import mock

from core.browser.profile import get_profile_lock
from core.browser.proxy_bridge import ProxyConnectionError
from modules.module_11_page_scanner.scanner import _acquire_page_scanner_browser

OWNER = "test_owner_acquire"


def _fake_uid() -> str:
    # validate_uid chỉ nhận chữ số ASCII; tiền tố 999 để không trùng UID thật
    return f"999{uuid.uuid4().int % 10**12:012d}"


def _acquire(uid: str):
    return _acquire_page_scanner_browser(
        target_uid=uid,
        owner=OWNER,
        proxy=None,
        cookie_str="c_user=1; xs=abc",
        headless=True,
        allow_direct_fallback=True,
    )


class TestAcquireBrowserReleasesLock(unittest.TestCase):
    def setUp(self):
        patches = [
            mock.patch("core.browser.get_active_drivers", return_value=[]),
            mock.patch("core.browser.close_scoped_active_drivers", return_value=[]),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_lock_released_when_open_browser_fails(self):
        uid = _fake_uid()
        with mock.patch(
            "core.browser.open_browser", side_effect=RuntimeError("chrome failed")
        ):
            with self.assertRaises(RuntimeError):
                _acquire(uid)
        self.assertFalse(get_profile_lock(uid, owner=OWNER).locked())

    def test_lock_released_when_open_browser_raises_non_runtime(self):
        uid = _fake_uid()
        with mock.patch(
            "core.browser.open_browser", side_effect=ProxyConnectionError("proxy dead")
        ):
            with self.assertRaises(ProxyConnectionError):
                _acquire(uid)
        self.assertFalse(get_profile_lock(uid, owner=OWNER).locked())

    def test_driver_closed_and_lock_released_when_cookies_fail(self):
        uid = _fake_uid()
        with mock.patch(
            "core.browser.open_browser", return_value=mock.MagicMock()
        ), mock.patch(
            "core.browser.load_cookies", side_effect=ValueError("bad cookie")
        ), mock.patch("core.browser.close_driver_for_uid") as close_mock:
            with self.assertRaises(ValueError):
                _acquire(uid)
        close_mock.assert_called_once_with(uid, owner=OWNER)
        self.assertFalse(get_profile_lock(uid, owner=OWNER).locked())

    def test_success_returns_held_lock(self):
        uid = _fake_uid()
        fake_driver = mock.MagicMock()
        with mock.patch(
            "core.browser.open_browser", return_value=fake_driver
        ), mock.patch("core.browser.load_cookies"):
            driver, created, lock, acquired = _acquire(uid)
        self.addCleanup(lock.release)
        self.assertIs(driver, fake_driver)
        self.assertTrue(created)
        self.assertTrue(acquired)
        self.assertIs(lock, get_profile_lock(uid, owner=OWNER))
        self.assertTrue(lock.locked())


if __name__ == "__main__":
    unittest.main()
