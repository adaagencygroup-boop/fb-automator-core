"""Tạm dừng rồi tiếp tục: thời gian tạm dừng không được tính vào idle / timeout của phiên."""
from __future__ import annotations

import threading
import unittest
from contextlib import ExitStack
from unittest import mock

from modules.module_11_page_scanner import browser_session, posts_scan, scanner


class FakeClock:
    """time giả: sleep() tăng giờ ngay lập tức và chạy các hook (vd gỡ pause khi đủ giờ)."""

    def __init__(self, start: float = 1_000.0):
        self.now = start
        self.hooks = []

    def time(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += max(0.0, float(seconds))
        for hook in list(self.hooks):
            hook(self.now)


ACC = {"uid": "990000000077", "user_id": "owner_t", "cookie": "", "proxy": None}


class _PauseBase(unittest.TestCase):
    SESSION_ID = 0

    def setUp(self):
        self.clock = FakeClock()
        self.stop_ev = threading.Event()
        self.pause_ev = threading.Event()
        with scanner._ACTIVE_SESSIONS_LOCK:
            scanner._ACTIVE_STOP_EVENTS[self.SESSION_ID] = self.stop_ev
            scanner._ACTIVE_PAUSE_EVENTS[self.SESSION_ID] = self.pause_ev
        self.logs = []
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.addCleanup(self._cleanup_events)
        self._patch(scanner, "time", self.clock)
        self._patch(scanner, "append_session_log", side_effect=self._log)
        self.stack.enter_context(mock.patch("core.browser.human_sleep"))

    def _cleanup_events(self):
        with scanner._ACTIVE_SESSIONS_LOCK:
            scanner._ACTIVE_STOP_EVENTS.pop(self.SESSION_ID, None)
            scanner._ACTIVE_PAUSE_EVENTS.pop(self.SESSION_ID, None)

    def _patch(self, target, name, new=mock.DEFAULT, **kwargs):
        return self.stack.enter_context(mock.patch.object(target, name, new, **kwargs))

    def _log(self, session_id, message, level="info", **_k):
        self.logs.append(str(message))

    def pause_for(self, seconds: float) -> None:
        """Bật pause ngay; tự gỡ khi đồng hồ giả trôi đủ `seconds`."""
        self.pause_ev.set()
        resume_at = self.clock.now + seconds
        self.clock.hooks.append(lambda now: self.pause_ev.clear() if now >= resume_at else None)


class TestWaitIfPausedTimed(_PauseBase):
    SESSION_ID = 9101

    def test_not_paused_returns_immediately(self):
        self.assertEqual(scanner._wait_if_paused_timed(self.SESSION_ID, self.stop_ev), (False, 0.0))
        self.assertEqual(self.logs, [])

    def test_reports_paused_seconds_and_logs_resume(self):
        self.pause_for(30)
        stopped, waited = scanner._wait_if_paused_timed(self.SESSION_ID, self.stop_ev)
        self.assertFalse(stopped)
        self.assertAlmostEqual(waited, 30, delta=0.5)
        self.assertTrue(any("Tiếp tục sau 30s" in m for m in self.logs))

    def test_stop_during_pause(self):
        self.pause_ev.set()
        self.clock.hooks.append(lambda now: self.stop_ev.set() if now >= 1_010 else None)
        stopped, waited = scanner._wait_if_paused_timed(self.SESSION_ID, self.stop_ev)
        self.assertTrue(stopped)
        self.assertGreater(waited, 0)

    def test_legacy_wrapper_returns_bool(self):
        self.assertFalse(scanner._wait_if_paused(self.SESSION_ID, self.stop_ev))


class TestPostScanPauseDoesNotTriggerIdle(_PauseBase):
    SESSION_ID = 9102

    def test_long_pause_then_resume_keeps_scanning_page(self):
        driver = mock.MagicMock(current_url="https://www.facebook.com/some.page")
        extract_calls = []

        def fake_extract(_driver):
            extract_calls.append(self.clock.now)
            if len(extract_calls) == 1:
                self.pause_for(60)  # 60s > idle_timeout 5s
            return []

        self._patch(posts_scan, "time", self.clock)
        self._patch(posts_scan, "append_session_log", side_effect=self._log)
        self._patch(posts_scan, "resolve_scan_accounts", return_value=[dict(ACC)])
        self._patch(posts_scan, "try_acquire_account_job")
        self._patch(browser_session, "release_account_job")
        self._patch(browser_session, "acquire_browser", return_value=(driver, False, None, False))
        self._patch(browser_session, "release_browser")
        self._patch(posts_scan, "get_account_usage_today", return_value=0)
        self._patch(posts_scan, "bump_account_usage")
        self._patch(posts_scan, "resolve_page_url", return_value=("https://www.facebook.com/p", "P"))
        self._patch(posts_scan, "existing_post_keys", return_value=set())
        self._patch(posts_scan, "extract_posts_batch", side_effect=fake_extract)
        self._patch(posts_scan, "update_session_progress")
        self._patch(posts_scan, "finalize_scan_session")

        posts_scan.run_post_scan_flow(
            page_keys=["user:p"], account_uid=ACC["uid"], owner_key="owner_t",
            session_id=self.SESSION_ID, idle_timeout_s=5, page_delay_s=0, scroll_delay_s=0.3,
        )

        # Không fix: sau khi tiếp tục, idle 60s ≥ 5s → bỏ Page ngay sau lần extract thứ 2.
        self.assertFalse(any("idle — hết bài mới" in m for m in self.logs), self.logs)
        self.assertTrue(any("list_exhausted" in m for m in self.logs), self.logs)
        self.assertEqual(len(extract_calls), 8)


class TestHashtagPauseDoesNotTriggerIdle(_PauseBase):
    SESSION_ID = 9103

    def test_long_pause_then_resume_keeps_scanning_tag(self):
        driver = mock.MagicMock(current_url="https://www.facebook.com/search/posts/?q=%23tag")
        driver.execute_script.return_value = 0
        extract_calls = []

        def fake_extract(_driver, _tag):
            extract_calls.append(self.clock.now)
            if len(extract_calls) == 1:
                self.pause_for(60)  # 60s > idle_timeout 5s
            return []

        self._patch(scanner, "get_scraping_account", return_value=dict(ACC))
        self._patch(scanner, "_acquire_page_scanner_browser", return_value=(driver, False, None, False))
        self._patch(scanner, "_release_page_scanner_browser")
        self._patch(scanner, "navigate_hashtag_via_search_box", return_value="search_box")
        self._patch(scanner, "extract_hashtag_posts_from_driver", side_effect=fake_extract)
        self._patch(scanner, "_feed_post_keys_and_height", return_value=(frozenset(), 0))
        self._patch(scanner, "_scroll_results_step")
        self._patch(scanner, "_wait_feed_settle_after_scroll")
        self._patch(scanner, "save_batch_pages")
        finalize = self._patch(scanner, "finalize_scan_session")
        self._patch(scanner.db, "execute")

        scanner.run_hashtag_search_flow(
            hashtags=["tag"], account_uid=ACC["uid"], owner_key="owner_t",
            session_id=self.SESSION_ID, idle_timeout_s=5, min_followers=0,
        )

        # Không fix: dừng "Idle 5s…" ngay sau khi tiếp tục (1 lần extract).
        self.assertFalse(any(m.startswith("Idle") for m in self.logs), self.logs)
        self.assertEqual(len(extract_calls), 5)  # dừng do NO_NEW_LIMIT=5 batch rỗng
        self.assertEqual(finalize.call_args.kwargs["stop_reason"], "NO_NEW_RESULTS")


class TestKeywordSearchPauseDoesNotTriggerTimeout(_PauseBase):
    SESSION_ID = 9104

    def test_pause_longer_than_max_duration_does_not_timeout(self):
        driver = mock.MagicMock(current_url="https://www.facebook.com/search/pages/?q=kw")
        driver.page_source = "<html></html>"
        extract_calls = []

        def fake_extract(_driver):
            extract_calls.append(self.clock.now)
            if len(extract_calls) == 1:
                self.pause_for(600)  # 600s > MAX_DURATION_SEC 480
            return []

        self._patch(scanner, "get_scraping_account", return_value=dict(ACC))
        self._patch(scanner, "_acquire_page_scanner_browser", return_value=(driver, False, None, False))
        self._patch(scanner, "_release_page_scanner_browser")
        self._patch(scanner, "extract_page_cards_from_driver", side_effect=fake_extract)
        self._patch(scanner, "_dom_scroll_metrics", return_value=(frozenset(), 0, 0))
        self._patch(scanner, "_scroll_results_step")
        self._patch(scanner, "_wait_dom_settle_after_scroll")
        self._patch(scanner, "save_batch_pages")
        finalize = self._patch(scanner, "finalize_scan_session")
        self._patch(scanner.db, "execute")

        scanner.run_page_search_flow(
            keyword="kw", account_uid=ACC["uid"], owner_key="owner_t", session_id=self.SESSION_ID,
        )

        # Không fix: batch 2 thấy elapsed ≥ 480s → TIMEOUT.
        self.assertEqual(finalize.call_args.kwargs["stop_reason"], "NO_NEW_RESULTS")
        self.assertEqual(len(extract_calls), 5)


if __name__ == "__main__":
    unittest.main()
