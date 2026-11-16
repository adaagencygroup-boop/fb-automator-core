"""Dừng khẩn cấp đóng Chrome giữa thao tác → phiên STOPPED (không phải FAILED); lỗi thật vẫn FAILED."""
from __future__ import annotations

import threading
import unittest
from contextlib import ExitStack
from unittest import mock

from core.database.connection import db
from modules.module_11_page_scanner import browser_session, posts_scan, scanner

ACC = {"uid": "993000000001", "user_id": "owner_s", "cookie": "", "proxy": None, "status": "LIVE"}


class _Base(unittest.TestCase):
    SESSION_ID = 0

    def setUp(self):
        self.stop_ev = threading.Event()
        with scanner._ACTIVE_SESSIONS_LOCK:
            scanner._ACTIVE_STOP_EVENTS[self.SESSION_ID] = self.stop_ev
            scanner._ACTIVE_PAUSE_EVENTS[self.SESSION_ID] = threading.Event()
        self.addCleanup(self._cleanup)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(mock.patch("core.browser.human_sleep"))
        self.stack.enter_context(mock.patch.object(db, "execute"))

    def _cleanup(self):
        with scanner._ACTIVE_SESSIONS_LOCK:
            scanner._ACTIVE_STOP_EVENTS.pop(self.SESSION_ID, None)
            scanner._ACTIVE_PAUSE_EVENTS.pop(self.SESSION_ID, None)

    def _browser_dies(self, *, after_stop):
        def _boom(*_a, **_k):
            if after_stop:
                self.stop_ev.set()  # router đã gửi stop rồi force-kill Chrome
            raise RuntimeError("invalid session id: browser has closed the connection")
        return _boom


class TestSearchFlowStopRace(_Base):
    SESSION_ID = 9401

    def _run(self, after_stop):
        driver = mock.MagicMock(current_url="https://www.facebook.com/search/pages/?q=kw", page_source="")
        p = self.stack.enter_context
        p(mock.patch.object(scanner, "get_scraping_account", return_value=dict(ACC)))
        p(mock.patch.object(scanner, "_acquire_page_scanner_browser", return_value=(driver, False, None, False)))
        p(mock.patch.object(scanner, "_release_page_scanner_browser"))
        p(mock.patch.object(scanner, "append_session_log"))
        p(mock.patch.object(scanner, "extract_page_cards_from_driver", return_value=[]))
        p(mock.patch.object(scanner, "_dom_scroll_metrics", return_value=(frozenset(), 0, 0)))
        p(mock.patch.object(scanner, "_scroll_results_step", side_effect=self._browser_dies(after_stop=after_stop)))
        p(mock.patch.object(scanner, "time", mock.MagicMock(time=mock.MagicMock(return_value=100.0))))
        finalize = p(mock.patch.object(scanner, "finalize_scan_session"))
        res = scanner.run_page_search_flow(keyword="kw", account_uid=ACC["uid"], owner_key="owner_s", session_id=self.SESSION_ID)
        return res, finalize.call_args.kwargs

    def test_browser_killed_by_stop_is_stopped(self):
        res, fin = self._run(after_stop=True)
        self.assertEqual((fin["status"], fin["stop_reason"]), ("STOPPED", "USER_STOPPED"))
        self.assertIsNone(fin["error_message"])

    def test_real_browser_error_is_still_failed(self):
        res, fin = self._run(after_stop=False)
        self.assertEqual((fin["status"], fin["stop_reason"]), ("FAILED", "ERROR"))


class TestPostFlowStopRace(_Base):
    SESSION_ID = 9402

    def _run(self, after_stop):
        driver = mock.MagicMock(current_url="https://www.facebook.com/p")
        p = self.stack.enter_context
        p(mock.patch.object(browser_session, "acquire_browser", return_value=(driver, False, None, False)))
        p(mock.patch.object(browser_session, "release_browser"))
        p(mock.patch.object(posts_scan, "resolve_scan_accounts", return_value=[dict(ACC)]))
        p(mock.patch.object(posts_scan, "append_session_log"))
        p(mock.patch.object(scanner, "append_session_log"))
        p(mock.patch.object(posts_scan, "get_account_usage_today", return_value=0))
        p(mock.patch.object(posts_scan, "resolve_page_url", return_value=("https://www.facebook.com/p", "P")))
        p(mock.patch.object(posts_scan, "existing_post_keys", return_value=set()))
        p(mock.patch.object(posts_scan, "extract_posts_batch", side_effect=self._browser_dies(after_stop=after_stop)))
        p(mock.patch.object(posts_scan, "time", mock.MagicMock(time=mock.MagicMock(return_value=100.0))))
        finalize = p(mock.patch.object(posts_scan, "finalize_scan_session"))
        posts_scan.run_post_scan_flow(page_keys=["user:p"], session_id=self.SESSION_ID, owner_key="owner_s",
                                      account_uids=[ACC["uid"]], page_delay_s=0)
        args = finalize.call_args.args
        return args[1], args[2]  # status, stop_reason

    def test_browser_killed_by_stop_is_stopped(self):
        self.assertEqual(self._run(after_stop=True), ("STOPPED", "USER_STOPPED"))

    def test_real_browser_error_is_still_failed(self):
        self.assertEqual(self._run(after_stop=False), ("FAILED", "ERROR"))


if __name__ == "__main__":
    unittest.main()
