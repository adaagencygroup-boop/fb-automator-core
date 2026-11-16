"""Xoay vòng tài khoản (POST_SCAN / FOLLOW) + bỏ bài ghim — các tùy chọn UI trước đây không có tác dụng."""
from __future__ import annotations

import threading
import unittest
from contextlib import ExitStack
from unittest import mock

from core.database.connection import db
from modules.module_11_page_scanner import browser_session, posts_scan, scanner
from modules.module_11_page_scanner.browser_session import (
    AccountBusyError,
    AccountRotation,
    get_active_job_for_account,
    order_accounts_free_first,
    release_account_job,
    try_acquire_account_job,
)


def acc(uid):
    return {"uid": uid, "user_id": "owner_r", "cookie": "", "proxy": None, "status": "LIVE"}


A, B, C = "991000000001", "991000000002", "991000000003"


class _JobsBase(unittest.TestCase):
    def setUp(self):
        browser_session._ACCOUNT_ACTIVE_JOBS.clear()
        self.addCleanup(browser_session._ACCOUNT_ACTIVE_JOBS.clear)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.opened = []
        self.acquire = self.stack.enter_context(
            mock.patch.object(browser_session, "acquire_browser", side_effect=self._fake_acquire)
        )
        self.release = self.stack.enter_context(mock.patch.object(browser_session, "release_browser"))
        self.db_exec = self.stack.enter_context(mock.patch.object(db, "execute"))
        self.fail_uids = set()
        self.logs = []

    def _fake_acquire(self, target_uid, **_k):
        if target_uid in self.fail_uids:
            raise RuntimeError("chrome failed")
        self.opened.append(target_uid)
        return mock.MagicMock(name=f"driver_{target_uid}"), True, None, False

    def _rotation(self, uids, session_id=700):
        try_acquire_account_job(uids[0], session_id, "POST_SCAN")
        rot = AccountRotation(
            session_id, "POST_SCAN", [acc(u) for u in uids], "owner_r",
            log=lambda m, level="info": self.logs.append(m),
        )
        rot.open()
        return rot


class TestAccountRotation(_JobsBase):
    def test_single_account_never_rotates(self):
        rot = self._rotation([A])
        self.assertFalse(rot.can_rotate)
        self.assertFalse(rot.rotate("đủ 50 bài"))
        self.release.assert_not_called()
        self.assertEqual(rot.uid, A)

    def test_rotates_to_next_free_account_and_skips_busy(self):
        try_acquire_account_job(B, 999, "FOLLOW")  # B bận job khác
        rot = self._rotation([A, B, C])
        self.assertTrue(rot.rotate("đủ 50 bài"))
        self.assertEqual(rot.uid, C)
        self.assertEqual(self.opened, [A, C])
        self.assertIsNone(get_active_job_for_account(A))
        self.assertEqual(get_active_job_for_account(C)["session_id"], 700)
        self.assertEqual(rot.count, 0)
        sql, params = self.db_exec.call_args.args
        self.assertIn("SET account_uid", sql)
        self.assertEqual(params, (C, 700))
        self.assertTrue(any(f"{A} → {C}" in m for m in self.logs))

    def test_no_free_account_keeps_current_browser(self):
        try_acquire_account_job(B, 999, "FOLLOW")
        rot = self._rotation([A, B])
        self.assertFalse(rot.rotate("đủ 50 bài"))
        self.assertEqual(rot.uid, A)
        self.release.assert_not_called()
        self.assertIsNotNone(rot.driver)

    def test_failed_chrome_on_new_account_reopens_old_one(self):
        self.fail_uids = {B}
        rot = self._rotation([A, B])
        self.assertFalse(rot.rotate("đủ 50 bài"))
        self.assertEqual(rot.uid, A)
        self.assertEqual(self.opened, [A, A])
        self.assertIsNotNone(rot.driver)
        self.assertIsNone(get_active_job_for_account(B))

    def test_checkpoint_marks_dead_and_never_reuses(self):
        rot = self._rotation([A, B])
        self.assertTrue(rot.rotate("checkpoint", mark_dead=True))
        self.assertEqual(rot.uid, B)
        # B cũng checkpoint → không quay lại A (đã chết) → hết acc, không còn Chrome
        self.assertFalse(rot.rotate("checkpoint", mark_dead=True))
        self.assertIsNone(rot.driver)
        self.assertEqual(rot.dead, {A, B})
        self.assertIsNone(get_active_job_for_account(B))

    def test_release_frees_current_account_job(self):
        rot = self._rotation([A])
        rot.release("COMPLETED", keep_browser=False)
        self.assertIsNone(get_active_job_for_account(A))
        self.release.assert_called_once()


class TestOrderAndResolveAccounts(_JobsBase):
    def test_starts_from_first_free_account(self):
        try_acquire_account_job(A, 999, "FOLLOW")
        ordered = order_accounts_free_first([acc(A), acc(B), acc(C)])
        self.assertEqual([a["uid"] for a in ordered], [B, C, A])

    def test_all_busy_raises_busy(self):
        try_acquire_account_job(A, 998, "FOLLOW")
        try_acquire_account_job(B, 999, "HASHTAG")
        with self.assertRaises(AccountBusyError) as ctx:
            order_accounts_free_first([acc(A), acc(B)])
        self.assertEqual(ctx.exception.active_session_id, 998)

    def test_resolve_dedupes_and_skips_invalid(self):
        def fake_get(uid, owner_key=None):
            if uid == B:
                raise ValueError(f"Tài khoản {uid} đang ở trạng thái DIE")
            return acc(uid) if uid else acc(C)

        with mock.patch.object(scanner, "get_scraping_account", side_effect=fake_get):
            got = scanner.resolve_scan_accounts([A, B, A, " "], None, "owner_r")
            self.assertEqual([a["uid"] for a in got], [A])
            with self.assertRaises(ValueError):
                scanner.resolve_scan_accounts([B], None, "owner_r")
            self.assertEqual([a["uid"] for a in scanner.resolve_scan_accounts(None, A, "owner_r")], [A])
            self.assertEqual([a["uid"] for a in scanner.resolve_scan_accounts([], None, "owner_r")], [C])


class FakeClock:
    def __init__(self):
        self.now = 5_000.0

    def time(self):
        return self.now

    def sleep(self, s):
        self.now += max(0.0, float(s))


def post(key, pinned=False):
    return {
        "post_key": key, "post_url": f"https://www.facebook.com/p/posts/{key}", "content": key,
        "post_type": "text", "published_text": None, "published_at": None, "date_unparsed": False,
        "reaction_count": 0, "comment_count": 0, "share_count": 0, "is_pinned": pinned,
    }


class TestPostScanFlowRotationAndPinned(_JobsBase):
    SESSION_ID = 9201

    def setUp(self):
        super().setUp()
        self.clock = FakeClock()
        with scanner._ACTIVE_SESSIONS_LOCK:
            scanner._ACTIVE_STOP_EVENTS[self.SESSION_ID] = threading.Event()
            scanner._ACTIVE_PAUSE_EVENTS[self.SESSION_ID] = threading.Event()
        self.addCleanup(self._cleanup_events)
        self.upserted = []
        self.flow_logs = []
        p = self.stack.enter_context
        p(mock.patch.object(posts_scan, "time", self.clock))
        p(mock.patch.object(scanner, "time", self.clock))
        p(mock.patch.object(posts_scan, "append_session_log", side_effect=lambda s, m, l="info", **k: self.flow_logs.append(m)))
        p(mock.patch.object(scanner, "append_session_log"))
        p(mock.patch.object(posts_scan, "get_account_usage_today", return_value=0))
        p(mock.patch.object(posts_scan, "bump_account_usage"))
        p(mock.patch.object(posts_scan, "resolve_page_url", side_effect=lambda o, k: (f"https://www.facebook.com/{k}", k)))
        p(mock.patch.object(posts_scan, "existing_post_keys", return_value=set()))
        p(mock.patch.object(posts_scan, "update_session_progress"))
        p(mock.patch.object(posts_scan, "finalize_scan_session"))
        p(mock.patch.object(posts_scan, "upsert_posts_batch", side_effect=self._upsert))
        p(mock.patch("core.browser.human_sleep"))

    def _cleanup_events(self):
        with scanner._ACTIVE_SESSIONS_LOCK:
            scanner._ACTIVE_STOP_EVENTS.pop(self.SESSION_ID, None)
            scanner._ACTIVE_PAUSE_EVENTS.pop(self.SESSION_ID, None)

    def _upsert(self, owner_key, page_key, items, session_id):
        self.upserted.append((page_key, [i["post_key"] for i in items]))
        return len(items), 0

    def _run(self, uids, **kwargs):
        with mock.patch.object(posts_scan, "resolve_scan_accounts", return_value=[acc(u) for u in uids]):
            return posts_scan.run_post_scan_flow(
                session_id=self.SESSION_ID, owner_key="owner_r", account_uids=uids,
                idle_timeout_s=5, page_delay_s=0, scroll_delay_s=0.3, **kwargs,
            )

    def test_skip_pinned_posts(self):
        batches = {"user:p1": [post("pin", pinned=True), post("a"), post("b")]}
        with mock.patch.object(posts_scan, "extract_posts_batch",
                               side_effect=lambda d: batches["user:p1"]):
            self._run([A], page_keys=["user:p1"], skip_pinned_posts=True)
        saved = [k for _p, keys in self.upserted for k in keys]
        self.assertEqual(sorted(saved), ["a", "b"])
        self.assertTrue(any("bỏ bài ghim pin" in m for m in self.flow_logs))

    def test_pinned_kept_when_option_off(self):
        with mock.patch.object(posts_scan, "extract_posts_batch",
                               side_effect=lambda d: [post("pin", pinned=True), post("a")]):
            self._run([A], page_keys=["user:p1"], skip_pinned_posts=False)
        saved = [k for _p, keys in self.upserted for k in keys]
        self.assertEqual(sorted(saved), ["a", "pin"])

    def test_rotates_account_after_n_posts(self):
        page_posts = {"user:p1": [post("p1a"), post("p1b")], "user:p2": [post("p2a")]}
        current = {"page": None}

        def fake_get(url):
            current["page"] = url.rsplit("/", 1)[-1]

        def fake_extract(driver):
            driver.get.side_effect = fake_get
            return page_posts.get(current["page"], [])

        def fake_acquire(target_uid, **_k):
            d = mock.MagicMock(current_url="https://www.facebook.com/page")
            d.get.side_effect = fake_get
            self.opened.append(target_uid)
            return d, True, None, False

        self.acquire.side_effect = fake_acquire
        with mock.patch.object(posts_scan, "extract_posts_batch", side_effect=fake_extract):
            self._run([A, B], page_keys=["user:p1", "user:p2"], rotate_every=2)
        self.assertEqual(self.opened, [A, B])
        self.assertEqual(self.upserted, [("user:p1", ["p1a", "p1b"]), ("user:p2", ["p2a"])])

    def test_checkpoint_rotates_and_retries_same_page(self):
        def fake_acquire(target_uid, **_k):
            url = "https://www.facebook.com/checkpoint/123" if target_uid == A else "https://www.facebook.com/p1"
            self.opened.append(target_uid)
            return mock.MagicMock(current_url=url), True, None, False

        self.acquire.side_effect = fake_acquire
        with mock.patch.object(posts_scan, "extract_posts_batch", side_effect=lambda d: [post("x")]):
            res = self._run([A, B], page_keys=["user:p1"], rotate_on_checkpoint=True)
        self.assertEqual(self.opened, [A, B])
        self.assertEqual(self.upserted, [("user:p1", ["x"])])
        self.assertNotEqual(res["stop_reason"], "CHECKPOINT")

    def test_checkpoint_without_rotation_stops(self):
        self.acquire.side_effect = lambda target_uid, **_k: (
            mock.MagicMock(current_url="https://www.facebook.com/checkpoint/1"), True, None, False
        )
        with mock.patch.object(posts_scan, "extract_posts_batch", return_value=[post("x")]):
            res = self._run([A, B], page_keys=["user:p1"], rotate_on_checkpoint=False)
        self.assertEqual(res["stop_reason"], "CHECKPOINT")
        self.assertEqual(self.upserted, [])


if __name__ == "__main__":
    unittest.main()
