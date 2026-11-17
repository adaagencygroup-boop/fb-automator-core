"""Quét lại với skip_existing: phải đi qua phần đã có trong kho để tới follower / bài mới phía dưới."""
from __future__ import annotations

import threading
import unittest
from contextlib import ExitStack
from unittest import mock

from core.database.connection import db
from modules.module_11_page_scanner import browser_session, followers_scan, posts_scan, scanner

ACC = {"uid": "992000000001", "user_id": "owner_d", "cookie": "", "proxy": None, "status": "LIVE"}


class FakeClock:
    def __init__(self):
        self.now = 9_000.0

    def time(self):
        return self.now

    def sleep(self, s):
        self.now += max(0.0, float(s))


def scrolling(batches):
    """extract giả: mỗi lần gọi trả batch kế tiếp; hết danh sách thì lặp lại batch cuối (không có gì mới)."""
    state = {"i": 0}

    def _extract(*_a, **_k):
        b = batches[min(state["i"], len(batches) - 1)]
        state["i"] += 1
        return b

    return _extract, state


class _FlowBase(unittest.TestCase):
    SESSION_ID = 0
    MODULE = None

    def setUp(self):
        self.clock = FakeClock()
        browser_session._ACCOUNT_ACTIVE_JOBS.clear()
        self.addCleanup(browser_session._ACCOUNT_ACTIVE_JOBS.clear)
        with scanner._ACTIVE_SESSIONS_LOCK:
            scanner._ACTIVE_STOP_EVENTS[self.SESSION_ID] = threading.Event()
            scanner._ACTIVE_PAUSE_EVENTS[self.SESSION_ID] = threading.Event()
        self.addCleanup(self._cleanup)
        self.saved = []
        self.logs = []
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        p = self.stack.enter_context
        m = self.MODULE
        driver = mock.MagicMock(current_url="https://www.facebook.com/page")
        p(mock.patch.object(browser_session, "acquire_browser", return_value=(driver, False, None, False)))
        p(mock.patch.object(browser_session, "release_browser"))
        p(mock.patch.object(db, "execute"))
        p(mock.patch.object(m, "time", self.clock))
        p(mock.patch.object(scanner, "time", self.clock))
        p(mock.patch.object(scanner, "append_session_log"))
        p(mock.patch.object(m, "append_session_log", side_effect=lambda s, msg, lv="info", **k: self.logs.append(msg)))
        p(mock.patch.object(m, "resolve_scan_accounts", return_value=[dict(ACC)]))
        p(mock.patch.object(m, "get_account_usage_today", return_value=0))
        p(mock.patch.object(m, "bump_account_usage"))
        p(mock.patch.object(m, "resolve_page_url", return_value=("https://www.facebook.com/p", "P")))
        p(mock.patch.object(m, "update_session_progress"))
        p(mock.patch.object(m, "finalize_scan_session"))
        p(mock.patch("core.browser.human_sleep"))

    def _cleanup(self):
        with scanner._ACTIVE_SESSIONS_LOCK:
            scanner._ACTIVE_STOP_EVENTS.pop(self.SESSION_ID, None)
            scanner._ACTIVE_PAUSE_EVENTS.pop(self.SESSION_ID, None)


def post(key, published_at=None):
    return {
        "post_key": key, "post_url": f"https://www.facebook.com/p/posts/{key}", "content": key,
        "post_type": "text", "published_text": None, "published_at": published_at, "date_unparsed": False,
        "reaction_count": 0, "comment_count": 0, "share_count": 0, "is_pinned": False,
    }


class TestPostRescanDepth(_FlowBase):
    SESSION_ID = 9301
    MODULE = posts_scan

    def _run(self, batches, known, **kwargs):
        extract, state = scrolling(batches)
        with mock.patch.object(posts_scan, "extract_posts_batch", side_effect=extract), \
                mock.patch.object(posts_scan, "existing_post_keys", return_value=set(known)), \
                mock.patch.object(posts_scan, "upsert_posts_batch",
                                  side_effect=lambda o, pk, items, s: (self.saved.extend(i["post_key"] for i in items), (len(items), 0))[1]):
            posts_scan.run_post_scan_flow(
                page_keys=["user:p"], session_id=self.SESSION_ID, owner_key="owner_d",
                account_uids=[ACC["uid"]], idle_timeout_s=60, page_delay_s=0, scroll_delay_s=0.3,
                skip_existing=True, **kwargs,
            )
        return state["i"]

    def test_passes_through_known_posts_to_reach_new_ones(self):
        known = [f"k{i}" for i in range(60)]
        batches = [[post(k) for k in known[i:i + 5]] for i in range(0, 60, 5)]  # 12 lượt toàn bài đã có
        batches.append([post("new1"), post("new2")])
        self._run(batches, known)
        self.assertEqual(self.saved, ["new1", "new2"])
        self.assertTrue(any("đã đi qua 50 bài có sẵn" in m for m in self.logs))

    def test_known_posts_outside_date_range_still_stop_early(self):
        old = [f"o{i}" for i in range(100)]
        batches = [[post(k, "2020-01-01") for k in old[i:i + 5]] for i in range(0, 100, 5)]
        batches.append([post("new_old", "2020-01-01")])
        calls = self._run(batches, old, date_from="2026-01-01")
        self.assertEqual(self.saved, [])
        self.assertLessEqual(calls, 9)  # dừng sau 8 lượt không tiến triển, không cuộn hết lịch sử


class TestFollowerRescanDepth(_FlowBase):
    SESSION_ID = 9302
    MODULE = followers_scan

    def test_passes_through_known_followers_to_reach_new_ones(self):
        known = [f"id:{1000 + i}" for i in range(120)]
        batches = [
            {"items": [{"follower_key": k} for k in known[i:i + 10]], "raw_count": 10, "meta": {}}
            for i in range(0, 120, 10)
        ]  # 12 lượt toàn UID đã có
        batches.append({"items": [{"follower_key": "id:9001"}, {"follower_key": "id:9002"}], "raw_count": 2, "meta": {}})
        extract, _state = scrolling(batches)
        with mock.patch.object(followers_scan, "open_followers_list", return_value={"ok": True, "view": {}}), \
                mock.patch.object(followers_scan, "extract_followers_batch", side_effect=extract), \
                mock.patch.object(followers_scan, "scroll_followers_list", return_value={"changed": True}), \
                mock.patch.object(followers_scan, "existing_follower_keys", return_value=set(known)), \
                mock.patch.object(followers_scan, "upsert_followers_batch",
                                  side_effect=lambda o, pk, items, s: (self.saved.extend(i["follower_key"] for i in items), (len(items), 0))[1]):
            followers_scan.run_follower_scan_flow(
                page_keys=["user:p"], session_id=self.SESSION_ID, owner_key="owner_d",
                account_uids=[ACC["uid"]], target_followers=50, max_per_page=50,
                idle_timeout_s=60, page_delay_s=0, scroll_delay_s=0.3, skip_existing=True,
            )
        self.assertEqual(self.saved, ["id:9001", "id:9002"])
        self.assertTrue(any("đã đi qua 100 UID có sẵn" in m for m in self.logs))


if __name__ == "__main__":
    unittest.main()
