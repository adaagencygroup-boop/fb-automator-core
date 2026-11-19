"""
Kiểm thử Module 10 không cần Postgres / Chrome thật.

Chạy: python -m unittest discover -s modules/module_10_group_scan/tests -t .
"""
from __future__ import annotations

import sys
import threading
import time
import types
import unittest
from datetime import date
from unittest import mock

# core.database.connection kết nối Postgres ngay khi import — thay bằng DB giả.
if "core.database.connection" not in sys.modules:
    _fake_conn = types.ModuleType("core.database.connection")

    class _FakeDB:
        def fetch_one(self, *a, **k):
            return None

        def fetch_all(self, *a, **k):
            return []

        def execute(self, *a, **k):
            return None

    _fake_conn.db = _FakeDB()
    sys.modules["core.database.connection"] = _fake_conn

from modules.module_10_group_scan import keyword_check, member_check, models, scan_common  # noqa: E402

TODAY = date(2026, 11, 19)


# ---------------------------------------------------------------------------
# Đồ giả
# ---------------------------------------------------------------------------


class FakeLock:
    def __init__(self, busy=False):
        self.busy = busy
        self.held = False
        self.releases = 0

    def acquire(self, timeout=None):
        if self.busy:
            return False
        self.held = True
        return True

    def release(self):
        if not self.held:
            raise RuntimeError("release unlocked lock")
        self.held = False
        self.releases += 1


class FakeDriver:
    """Feed / danh sách thành viên giả: mỗi lần cuộn hiện thêm `page` mục, DOM luôn đọc lại từ đầu."""

    def __init__(self, uid, feeds=None, page=3, kind="posts"):
        self.uid = uid
        self.feeds = feeds or {}
        self.page = page
        self.kind = kind
        self.url = ""
        self.visible = page
        self.quit_called = False
        self.visits = []

    @property
    def current_url(self):
        if self.quit_called:
            raise RuntimeError("invalid session id")
        return self.url

    page_source = ""
    title = ""

    def get(self, url):
        self.url = url
        self.visible = self.page
        self.visits.append(url)

    def _group(self):
        if "/groups/" not in self.url:
            return ""
        return self.url.split("/groups/")[1].split("/")[0].split("?")[0]

    def execute_script(self, js, *args):
        if self.quit_called:
            raise RuntimeError("invalid session id")
        if js is member_check.SCRAPE_MEMBERS_JS:
            items = self.feeds.get(self._group(), [])[: self.visible]
            key = "posts" if self.kind == "posts" else "members"
            return {key: [dict(i) for i in items], "debug": {"scrapeVersion": "test"}}
        if js is member_check.SCROLL_MEMBERS_JS:
            self.visible += self.page
            return {"type": "container"}
        return None

    def find_elements(self, *a, **k):
        return []

    def quit(self):
        self.quit_called = True


def gid_num(gid):
    return str(abs(hash(gid)) % 9000 + 1000) + "0000"


def member_feed(n, prefix="1000", **extra):
    rows = []
    for i in range(n):
        row = {"uid": f"{prefix}{i:05d}", "name": f"Người {i}", "href": f"https://www.facebook.com/{prefix}{i:05d}"}
        row.update({k: (v(i) if callable(v) else v) for k, v in extra.items()})
        rows.append(row)
    return rows


class SyncThread:
    """Chạy worker ngay trong test thay vì thread nền."""

    def __init__(self, target=None, args=(), kwargs=None, **_):
        self.target, self.args, self.kwargs = target, args, kwargs or {}

    def start(self):
        self.target(*self.args, **self.kwargs)


def no_sleep(seconds, get_control, step=0.5):
    return get_control() == "abort"


class FakePool:
    """Thay open_account_session: ghi lại thứ tự nick được mở, mô phỏng nick hỏng."""

    def __init__(self, feeds, *, bad=(), kind="posts", page=3):
        self.feeds, self.bad, self.kind, self.page = feeds, set(bad), kind, page
        self.opened = []
        self.drivers = []

    def __call__(self, pool, start_index, *, owner, scope, log, exclude=(), should_stop=None, **_):
        excluded = set(exclude)
        for step in range(len(pool)):
            idx = (start_index + step) % len(pool)
            uid = pool[idx]
            if uid in excluded or uid in self.bad:
                continue
            driver = FakeDriver(uid, self.feeds, page=self.page, kind=self.kind)
            self.opened.append(uid)
            self.drivers.append(driver)
            return {"driver": driver, "lock": FakeLock(), "uid": uid, "next_index": idx + 1}
        return None


# ---------------------------------------------------------------------------
# Mốc thời gian
# ---------------------------------------------------------------------------


class TimeParsingTests(unittest.TestCase):
    def age(self, text):
        return scan_common.fb_time_age_days(text, today=TODAY)

    def test_relative_vietnamese(self):
        self.assertEqual(self.age("5 phút"), 0)
        self.assertEqual(self.age("3 giờ"), 0)
        self.assertEqual(self.age("2 ngày"), 2)
        self.assertEqual(self.age("2 tuần"), 14)
        self.assertEqual(self.age("3 tháng"), 90)
        self.assertEqual(self.age("1 năm"), 365)
        self.assertEqual(self.age("Vừa xong"), 0)
        self.assertEqual(self.age("Hôm qua lúc 10:00"), 1)

    def test_relative_english_short_and_long(self):
        self.assertEqual(self.age("5m"), 0)
        self.assertEqual(self.age("3h"), 0)
        self.assertEqual(self.age("2d"), 2)
        self.assertEqual(self.age("1w"), 7)
        self.assertEqual(self.age("2 mos"), 60)
        self.assertEqual(self.age("1y"), 365)
        self.assertEqual(self.age("3 months ago"), 90)
        self.assertEqual(self.age("Yesterday at 9:00 PM"), 1)

    def test_absolute_dates(self):
        self.assertEqual(self.age("5 tháng 11"), 14)
        self.assertEqual(self.age("5 tháng 11 lúc 10:00"), 14)
        self.assertEqual(self.age("20 tháng 12"), (TODAY - date(2025, 12, 20)).days)  # chưa tới → năm trước
        self.assertEqual(self.age("3 tháng 5, 2024"), (TODAY - date(2024, 5, 3)).days)
        self.assertEqual(self.age("March 3"), (TODAY - date(2026, 3, 3)).days)
        self.assertEqual(self.age("November 10, 2026"), 9)
        self.assertEqual(self.age("10 Nov"), 9)
        self.assertEqual(self.age("12/11/2026"), 7)

    def test_join_phrases(self):
        self.assertEqual(self.age("Joined about a week ago"), 7)
        self.assertEqual(self.age("Joined 3 days ago"), 3)
        self.assertEqual(self.age("Đã tham gia vào khoảng 2 tuần trước"), 14)
        self.assertEqual(self.age("Đã tham gia 5 ngày trước"), 5)
        self.assertEqual(self.age("Joined an hour ago"), 0)
        self.assertGreater(self.age("Member since 2019"), 2000)

    def test_unknown(self):
        self.assertIsNone(self.age(""))
        self.assertIsNone(self.age("Bài viết mới"))
        self.assertIsNone(self.age("Thứ Hai"))


# ---------------------------------------------------------------------------
# Hàm dùng chung
# ---------------------------------------------------------------------------


class CommonHelperTests(unittest.TestCase):
    def test_prune_jobs(self):
        lock = threading.Lock()
        now = 10_000.0
        jobs = {
            "running": {"status": "running", "started_at": 0},
            "old_done": {"status": "done", "finished_at": now - 3 * 3600},
            "fresh_done": {"status": "aborted", "finished_at": now - 60},
        }
        jobs.update({f"d{i}": {"status": "error", "finished_at": now - i} for i in range(60)})
        scan_common.prune_jobs(jobs, lock, now=now, keep=50)
        self.assertIn("running", jobs)
        self.assertNotIn("old_done", jobs)
        finished = [j for j in jobs.values() if j["status"] in scan_common.TERMINAL_STATUSES]
        self.assertEqual(len(finished), 50)

    def test_interruptible_sleep_stops_on_abort(self):
        state = {"c": "run"}
        threading.Timer(0.2, lambda: state.update(c="abort")).start()
        started = time.monotonic()
        self.assertTrue(scan_common.interruptible_sleep(30, lambda: state["c"], step=0.05))
        self.assertLess(time.monotonic() - started, 2)

    def test_wait_while_paused(self):
        state = {"c": "pause"}
        threading.Timer(0.15, lambda: state.update(c="run")).start()
        self.assertFalse(scan_common.wait_while_paused(lambda: state["c"], step=0.05))
        state["c"] = "pause"
        threading.Timer(0.15, lambda: state.update(c="abort")).start()
        self.assertTrue(scan_common.wait_while_paused(lambda: state["c"], step=0.05))
        state["c"] = "pause"
        self.assertTrue(scan_common.wait_while_paused(lambda: state["c"], step=0.01, max_wait=0.05))

    def test_session_log_entries_normalizes_all_formats(self):
        out = scan_common.session_log_entries([
            {"time": "10:00:00", "text": "kw", "tone": "warn"},
            {"time": "10:00:01", "message": "member", "level": "SUCCESS"},
            {"time": "10:00:02", "message": ""},
        ])
        self.assertEqual(out, [
            {"time": "10:00:00", "level": "WARNING", "message": "kw"},
            {"time": "10:00:01", "level": "SUCCESS", "message": "member"},
        ])

    def test_resolve_group_identity_scopes_db_lookup_to_owner(self):
        calls = []

        def fetch_one(sql, params):
            calls.append((sql, params))
            return {"group_id": "realslug", "group_url": "https://www.facebook.com/groups/realslug", "group_name": "Nhóm thật"}

        gid, name, url = scan_common.resolve_group_identity({"id": 945, "name": ""}, "alice", fetch_one=fetch_one)
        self.assertEqual((gid, name, url), ("realslug", "Nhóm thật", "https://www.facebook.com/groups/realslug"))
        self.assertIn("owner_username = ?", calls[0][0])
        self.assertEqual(calls[0][1], ("alice", 945))

    def test_resolve_group_identity_without_lookup(self):
        def fetch_one(sql, params):
            raise AssertionError("không được tra DB khi đã có slug + URL")

        gid, _name, url = scan_common.resolve_group_identity(
            {"group_id": "abcgroup", "url": "https://www.facebook.com/groups/abcgroup/", "name": "X"},
            "alice",
            fetch_one=fetch_one,
        )
        self.assertEqual((gid, url), ("abcgroup", "https://www.facebook.com/groups/abcgroup"))

    def test_resolve_group_identity_rejects_db_serial(self):
        gid, _name, _url = scan_common.resolve_group_identity({"id": 945}, "alice", fetch_one=lambda *a: None)
        self.assertEqual(gid, "")


class OpenAccountSessionTests(unittest.TestCase):
    def setUp(self):
        self.locks = {"busy": FakeLock(busy=True)}
        self.created = []
        auto = types.SimpleNamespace(
            get_profile_lock=lambda uid: self.locks.setdefault(uid, FakeLock()),
            create_driver=self._create_driver,
            ensure_logged_in=lambda driver, uid, **k: {"success": uid != "badlogin", "error": "checkpoint"},
        )
        patcher = mock.patch.object(scan_common, "_automation", return_value=auto)
        patcher.start()
        self.addCleanup(patcher.stop)
        check = mock.patch(
            "modules.module_02_account_manager.automation.login_flow._check_logged_in",
            return_value=False,
            create=True,
        )
        check.start()
        self.addCleanup(check.stop)
        self.logs = []

    def _create_driver(self, uid, **kwargs):
        if uid == "crash":
            raise RuntimeError("chrome crash")
        driver = FakeDriver(uid)
        self.created.append(driver)
        return driver

    def creds(self, uid, owner):
        if uid == "missing":
            return None
        if uid == "nosecret":
            return {"cookie": "", "proxy": None, "has_secret": True, "password": "", "two_fa": ""}
        return {"cookie": "c", "proxy": None, "has_secret": False, "password": "", "two_fa": ""}

    def open(self, pool, start=0, **kw):
        return scan_common.open_account_session(
            pool, start, owner="alice", scope="t", log=lambda m, l="info": self.logs.append((l, m)),
            load_credentials=self.creds, **kw,
        )

    def test_skips_every_kind_of_broken_account(self):
        pool = ["busy", "missing", "nosecret", "crash", "badlogin", "good"]
        session = self.open(pool)
        self.assertEqual(session["uid"], "good")
        self.assertEqual(session["next_index"], 6)
        # Mọi khoá đã lấy của nick hỏng đều được nhả; driver của nick đăng nhập lỗi bị đóng.
        for uid in ("missing", "nosecret", "crash", "badlogin"):
            self.assertFalse(self.locks[uid].held, uid)
        self.assertTrue(self.locks["good"].held)
        bad_driver = next(d for d in self.created if d.uid == "badlogin")
        self.assertTrue(bad_driver.quit_called)

    def test_returns_none_when_nothing_works_and_respects_exclude(self):
        self.assertIsNone(self.open(["busy", "missing"]))
        self.assertIsNone(self.open(["good"], exclude={"good"}))
        self.assertEqual(self.open(["a", "b", "c"], start=2)["uid"], "c")
        self.assertEqual(self.open(["a", "b", "c"], start=2, exclude={"c"})["uid"], "a")

    def test_close_session_releases_lock_and_optionally_keeps_browser(self):
        session = self.open(["good"])
        driver, lock = session["driver"], session["lock"]
        scan_common.close_account_session(session, quit_browser=False)
        self.assertFalse(driver.quit_called)
        self.assertFalse(lock.held)
        scan_common.close_account_session(session)  # gọi lại không lỗi
        scan_common.close_account_session(None)


# ---------------------------------------------------------------------------
# Bộ lọc dòng
# ---------------------------------------------------------------------------


class RowFilterTests(unittest.TestCase):
    def test_member_dedupe_off_still_unique_within_group(self):
        group_seen, cross, stats = set(), {"100000000"}, {}
        rows = member_feed(3)
        first = member_check.filter_member_rows(
            rows, group_seen=group_seen, cross_seen=cross, skip_admin=False,
            auto_dedupe=False, new_members_only=False, remaining=50, stats=stats,
        )
        again = member_check.filter_member_rows(
            rows + member_feed(1, prefix="2000"), group_seen=group_seen, cross_seen=cross, skip_admin=False,
            auto_dedupe=False, new_members_only=False, remaining=50, stats=stats,
        )
        self.assertEqual(len(first), 3)  # UID có trong CSDL vẫn lấy vì tắt lọc trùng chéo
        self.assertEqual([r["uid"] for r in again], ["200000000"])

    def test_member_filters(self):
        rows = [
            {"uid": "1", "name": "Admin", "isAdmin": True, "joinedText": "Joined 2 days ago"},
            {"uid": "2", "name": "Mod", "isMod": True},
            {"uid": "3", "name": "Cũ", "joinedText": "Đã tham gia vào 3 tháng trước"},
            {"uid": "4", "name": "Mới", "joinedText": "Joined 3 days ago"},
            {"uid": "5", "name": "Không rõ"},
            {"uid": "6", "name": "Trùng DB", "joinedText": "Joined 1 day ago"},
        ]
        stats = {}
        kept = member_check.filter_member_rows(
            rows, group_seen=set(), cross_seen={"6"}, skip_admin=True, auto_dedupe=True,
            new_members_only=True, remaining=50, stats=stats,
        )
        self.assertEqual([r["uid"] for r in kept], ["4"])
        self.assertEqual(stats, {"admin": 2, "old": 1, "unknown_join": 1, "dup": 1})



# ---------------------------------------------------------------------------
# Worker quét thành viên dùng chung khung test
# ---------------------------------------------------------------------------


class _WorkerCase(unittest.TestCase):
    def setUp(self):
        self.saved = []
        self.session_updates = []
        patches = [
            mock.patch.object(models, "create_scan_session", lambda **k: True),
            mock.patch.object(models, "update_scan_session", lambda sid, **k: self.session_updates.append((sid, k))),
            mock.patch.object(models, "list_known_member_uids", lambda owner, group_id=None: set()),
            mock.patch.object(models, "upsert_scanned_group_member", lambda **k: self.saved.append(k) or True),
            mock.patch.object(member_check, "threading", types.SimpleNamespace(Thread=SyncThread, Lock=threading.Lock)),
            mock.patch.object(member_check, "interruptible_sleep", no_sleep),
            mock.patch.object(
                member_check, "resolve_group_identity",
                lambda grp, owner: (grp["group_id"], grp["name"], f"https://www.facebook.com/groups/{grp['group_id']}"),
            ),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)


# ---------------------------------------------------------------------------
# Worker quét thành viên (10.2)
# ---------------------------------------------------------------------------


class MemberWorkerTests(_WorkerCase):
    def run_scan(self, pool, groups, feeds, **kw):
        fake_pool = FakePool(feeds, bad=kw.pop("bad", ()), kind="members", page=kw.pop("page", 3))
        with mock.patch.object(member_check, "open_account_session", fake_pool), \
                mock.patch.object(member_check, "_diag_members_page", lambda d: {"groupsUser": 1}):
            res = member_check.start_member_scan("alice", pool, groups, delay_min=1, delay_max=1, **kw)
        return member_check.get_member_scan_status(res["job_id"], owner="alice"), fake_pool

    def test_no_duplicates_when_dedupe_off(self):
        job, _ = self.run_scan(["a"], [{"group_id": "g1", "name": "G1"}], {"g1": member_feed(10)},
                               members_limit=8, auto_dedupe=False, new_members_only=False)
        uids = [m["uid"] for m in job["members"]]
        self.assertEqual(len(uids), 8)
        self.assertEqual(len(set(uids)), 8)

    def test_rotation_by_group_count_and_bad_account(self):
        feeds = {f"g{i}": member_feed(3, prefix=f"{i}00") for i in range(4)}
        groups = [{"group_id": f"g{i}", "name": f"G{i}"} for i in range(4)]
        job, pool = self.run_scan(["a", "bad", "c"], groups, feeds, bad=("bad",),
                                  switch_acc_threshold=2, members_limit=3, new_members_only=False)
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["groups_done"], 4)
        self.assertEqual(len(job["members"]), 12)  # không nhóm nào bị bỏ vì nick hỏng
        self.assertEqual(pool.opened, ["a", "c"])
        self.assertTrue(pool.drivers[0].quit_called)
        self.assertTrue(pool.drivers[1].quit_called)  # 10.2 đóng Chrome khi xong

    def test_admin_and_new_member_filters_apply(self):
        feed = member_feed(6, isAdmin=lambda i: i == 0, joinedText=lambda i: "Joined 2 days ago" if i % 2 else "Joined 2 years ago")
        job, _ = self.run_scan(["a"], [{"group_id": "g1", "name": "G1"}], {"g1": feed},
                               members_limit=50, skip_admin=True, new_members_only=True)
        self.assertEqual([m["uid"] for m in job["members"]], ["100000001", "100000003", "100000005"])
        self.assertEqual(job["members"][0]["joined_date"], "Joined 2 days ago")

    def test_abort_while_paused(self):
        res_holder = {}

        def pausing_pool(*a, **k):
            jid = next(iter(j for j, v in member_check._member_jobs.items() if v["status"] == "running"))
            res_holder["jid"] = jid
            self.assertTrue(member_check.set_member_scan_control(jid, "pause", owner="alice"))
            threading.Timer(0.2, lambda: member_check.set_member_scan_control(jid, "abort", owner="alice")).start()
            return FakePool({"g1": member_feed(5)}, kind="members")(*a, **k)

        with mock.patch.object(member_check, "open_account_session", pausing_pool), \
                mock.patch.object(member_check, "_diag_members_page", lambda d: {"groupsUser": 1}):
            res = member_check.start_member_scan("alice", ["a"], [{"group_id": "g1", "name": "G1"}], delay_min=1, delay_max=1)
        job = member_check.get_member_scan_status(res["job_id"], owner="alice")
        self.assertEqual(job["status"], "aborted")
        self.assertEqual(self.session_updates[-1][1]["status"], "ABORTED")


# ---------------------------------------------------------------------------
# Quét thông tin nhóm (10.1) — xoay nick + đóng Chrome
# ---------------------------------------------------------------------------


class KeywordRotationTests(unittest.TestCase):
    def setUp(self):
        self.updates = []
        auto = types.SimpleNamespace(human_sleep=lambda *a, **k: None, human_type=lambda *a, **k: None,
                                     wait_and_find=lambda *a, **k: None)
        patches = [
            mock.patch.dict(sys.modules, {"modules.module_02_account_manager.automation": auto}),
            mock.patch.object(models, "list_known_group_ids", lambda owner: set()),
            mock.patch.object(models, "create_scan_category", lambda *a, **k: {"ok": True}),
            mock.patch.object(models, "create_scan_session", lambda **k: True),
            mock.patch.object(models, "update_scan_session", lambda sid, **k: self.updates.append(k)),
            mock.patch.object(keyword_check, "_search_and_open_groups", lambda *a, **k: None),
            mock.patch.object(
                keyword_check, "_scrape_groups_from_results",
                self._fake_scrape,
            ),
            mock.patch.object(keyword_check, "threading", types.SimpleNamespace(Thread=SyncThread, Lock=threading.Lock)),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    available = None  # số nhóm tối đa trang tìm kiếm có cho mỗi từ khóa (None = vô hạn)

    def _fake_scrape(self, driver, keyword, job_id, hs, max_groups, already=None, stat_offset=0, **k):
        self.scrape_calls.append((driver.uid, keyword, max_groups, stat_offset))
        count = max_groups
        if self.available is not None:
            count = max(0, min(max_groups, self.available - stat_offset))
        return [
            {"href": f"https://www.facebook.com/groups/{keyword}{stat_offset + i}", "name": f"{keyword}{stat_offset + i}"}
            for i in range(count)
        ]

    def run_check(self, pool_obj, uids, keywords=None, **kw):
        self.scrape_calls = []
        keywords = keywords or [{"keyword": "k1", "limit": 2}, {"keyword": "k2", "limit": 2}, {"keyword": "k3", "limit": 2}]
        with mock.patch.object(keyword_check, "open_account_session", pool_obj):
            res = keyword_check.start_keyword_check(
                owner="alice", uid=uids[0], uids=uids, keywords=keywords,
                delay_min=0, delay_max=0, **kw,
            )
        return keyword_check.get_check_status(job_id=res["job_id"], owner="alice")

    def test_rotation_inside_one_keyword(self):
        pool = FakePool({}, kind="groups")
        job = self.run_check(pool, ["a", "b"], keywords=[{"keyword": "big", "limit": 5}], rotate_after=2)
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["count"], 5)
        self.assertEqual(len({g["href"] for g in job["groups"]}), 5)
        # 2 nhóm bằng a → đổi b (2 nhóm) → đổi a (1 nhóm), mỗi lần đổi đều tìm lại từ khóa
        self.assertEqual(pool.opened, ["a", "b", "a"])
        self.assertEqual([(c[0], c[2], c[3]) for c in self.scrape_calls], [("a", 2, 0), ("b", 2, 2), ("a", 1, 4)])
        self.assertEqual(job["keyword_stats"]["big"]["count"], 5)
        self.assertTrue(all(d.quit_called for d in pool.drivers))

    def test_keyword_stops_when_search_results_run_out(self):
        self.available = 3
        try:
            pool = FakePool({}, kind="groups")
            job = self.run_check(pool, ["a", "b"], keywords=[{"keyword": "few", "limit": 10}], rotate_after=2)
        finally:
            self.available = None
        self.assertEqual(job["count"], 3)
        self.assertEqual(job["status"], "done")

    def test_rotation_success_and_browser_closed_at_end(self):
        pool = FakePool({}, kind="groups")
        job = self.run_check(pool, ["a", "b"], rotate_after=2)
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["count"], 6)
        self.assertEqual(pool.opened, ["a", "b", "a"])
        self.assertTrue(all(d.quit_called for d in pool.drivers))  # kể cả nick cuối
        self.assertEqual(self.updates[-1]["status"], "SUCCESS")
        self.assertTrue(self.updates[-1]["logs"])

    def test_failed_rotation_keeps_current_browser(self):
        pool = FakePool({}, bad=("b",), kind="groups")
        job = self.run_check(pool, ["a", "b"], rotate_after=2)
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["count"], 6)
        self.assertEqual(pool.opened, ["a"])
        self.assertEqual(len(pool.drivers), 1)
        self.assertTrue(pool.drivers[0].quit_called)  # chỉ đóng ở cuối phiên
        self.assertTrue(any("Không đổi được nick" in l["text"] for l in job["logs"]))

    def test_public_only_no_join_cannot_be_overridden(self):
        pool = FakePool({}, kind="groups")
        job = self.run_check(pool, ["a"], public_only=False, private_only=True, auto_join=True)
        raw = keyword_check._jobs[job["job_id"]]
        self.assertTrue(raw["public_only"])
        self.assertFalse(raw["private_only"])
        self.assertFalse(raw["auto_join"])
        self.assertTrue(any("chỉ lấy nhóm Public, KHÔNG tham gia nhóm" in l["text"] for l in job["logs"]))

    def test_private_groups_are_filtered(self):
        ok, _ = keyword_check._passes_filters({"type": "public"}, public_only=True)
        self.assertTrue(ok)
        for privacy in ("private", "unknown"):
            ok, reason = keyword_check._passes_filters({"type": privacy}, public_only=True)
            self.assertFalse(ok, privacy)

    def test_auto_join_defaults_off_and_owner_scope(self):
        pool = FakePool({}, kind="groups")
        job = self.run_check(pool, ["a"])
        self.assertTrue(any("KHÔNG tham gia nhóm" in l["text"] for l in job["logs"]))
        self.assertIsNone(keyword_check.get_check_status(job_id=job["job_id"], owner="mallory"))
        self.assertIsNone(keyword_check.get_check_status(uid="a", owner="mallory"))
        with self.assertRaises(ValueError):
            keyword_check.set_job_control(job["job_id"], "abort", owner="mallory")


if __name__ == "__main__":
    unittest.main()
