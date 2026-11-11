"""Đóng Chrome page_scanner phải theo đúng acc — không giết Chrome của job khác đang chạy."""
from __future__ import annotations

import threading
import unittest
from unittest import mock

from core.browser import driver as core_driver
from modules.module_11_page_scanner import browser_session
from modules.module_11_page_scanner.browser_session import (
    close_browsers_for_stopped_sessions,
    release_account_job,
    try_acquire_account_job,
)
from modules.module_11_page_scanner.scanner import (
    _acquire_page_scanner_browser,
    _release_page_scanner_browser,
)

SCOPE = "page_scanner"
OWNER = "test_owner_scope"
UID_A = "990000000001"
UID_B = "990000000002"
UID_C = "990000000003"


class _ScopeCloseBase(unittest.TestCase):
    def setUp(self):
        core_driver._active_drivers.clear()
        browser_session._ACCOUNT_ACTIVE_JOBS.clear()
        # Không kill tiến trình / dọn file thật khi đóng driver giả
        for name in ("force_kill_driver", "_close_bridge", "_cleanup_profile_lockfiles"):
            p = mock.patch.object(core_driver, name)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.object(core_driver, "get_profile_path", return_value="unused")
        p.start()
        self.addCleanup(p.stop)

    def tearDown(self):
        core_driver._active_drivers.clear()
        browser_session._ACCOUNT_ACTIVE_JOBS.clear()

    def _register(self, uid: str) -> mock.MagicMock:
        d = mock.MagicMock(name=f"driver_{uid}")
        core_driver.register_active_driver(d, uid, owner=OWNER, scope=SCOPE)
        return d

    def _open_uids(self):
        return {
            info["uid"] for info in core_driver._active_drivers.values() if info["scope"] == SCOPE
        }


class TestReleaseClosesOnlyOwnAccount(_ScopeCloseBase):
    def test_release_closes_only_target_uid(self):
        self._register(UID_A)
        self._register(UID_B)
        _release_page_scanner_browser(
            stop_reason="COMPLETED", keep_browser=False, acquired_lock=False, lock=None,
            target_uid=UID_A,
        )
        self.assertEqual(self._open_uids(), {UID_B})

    def test_release_keeps_browser_when_keep_browser_and_normal_end(self):
        self._register(UID_A)
        _release_page_scanner_browser(
            stop_reason="TARGET_REACHED", keep_browser=True, acquired_lock=False, lock=None,
            target_uid=UID_A,
        )
        self.assertEqual(self._open_uids(), {UID_A})

    def test_release_force_closes_on_user_stop_even_with_keep_browser(self):
        self._register(UID_A)
        self._register(UID_B)
        _release_page_scanner_browser(
            stop_reason="USER_STOPPED", keep_browser=True, acquired_lock=False, lock=None,
            target_uid=UID_A,
        )
        self.assertEqual(self._open_uids(), {UID_B})

    def test_release_closes_chrome_before_releasing_lock(self):
        events = []
        lock = threading.Lock()
        lock.acquire()
        real_release = lock.release

        fake_lock = mock.MagicMock()
        fake_lock.release.side_effect = lambda: (events.append("lock"), real_release())
        with mock.patch(
            "core.browser.close_scoped_active_drivers",
            side_effect=lambda **k: events.append("close") or [],
        ):
            _release_page_scanner_browser(
                stop_reason="COMPLETED", keep_browser=False, acquired_lock=True, lock=fake_lock,
                target_uid=UID_A,
            )
        self.assertEqual(events, ["close", "lock"])
        self.assertFalse(lock.locked())


class TestAcquireKeepsBusyAccounts(_ScopeCloseBase):
    def test_acquire_closes_idle_but_keeps_busy_account_browser(self):
        self._register(UID_B)  # acc B đang chạy job FOLLOW
        self._register(UID_C)  # acc C: Chrome giữ lại từ keep_browser, không còn job
        try_acquire_account_job(UID_B, 501, "FOLLOW")
        try_acquire_account_job(UID_A, 502, "HASHTAG")
        self.addCleanup(release_account_job, UID_B, 501)
        self.addCleanup(release_account_job, UID_A, 502)

        new_driver = mock.MagicMock(name="driver_A")
        with mock.patch("core.browser.open_browser", return_value=new_driver), mock.patch(
            "core.browser.load_cookies"
        ):
            driver, created, lock, acquired = _acquire_page_scanner_browser(
                target_uid=UID_A, owner=OWNER, proxy=None, cookie_str="",
                headless=True, allow_direct_fallback=True,
            )
        self.addCleanup(lock.release)

        self.assertIs(driver, new_driver)
        self.assertTrue(created and acquired)
        self.assertEqual(self._open_uids(), {UID_B})


class TestEmergencyStopClosesOnlyStoppedSessions(_ScopeCloseBase):
    def test_stop_closes_stopped_and_idle_but_not_other_running_job(self):
        self._register(UID_A)
        self._register(UID_B)
        self._register(UID_C)
        try_acquire_account_job(UID_A, 10, "HASHTAG")  # phiên đang bị dừng
        try_acquire_account_job(UID_B, 20, "FOLLOW")   # job khác — không được đóng
        self.addCleanup(release_account_job, UID_A, 10)
        self.addCleanup(release_account_job, UID_B, 20)

        closed = close_browsers_for_stopped_sessions(
            account_uids=[UID_A, UID_B, UID_C, None, ""],
            stopped_session_ids=[10],
        )
        self.assertEqual(sorted(closed), [UID_A, UID_C])
        self.assertEqual(self._open_uids(), {UID_B})

    def test_stop_with_no_target_closes_nothing(self):
        self._register(UID_B)
        try_acquire_account_job(UID_B, 20, "FOLLOW")
        self.addCleanup(release_account_job, UID_B, 20)
        self.assertEqual(close_browsers_for_stopped_sessions([UID_B], [99]), [])
        self.assertEqual(self._open_uids(), {UID_B})


if __name__ == "__main__":
    unittest.main()
