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

from modules.module_10_group_scan import keyword_capacity, keyword_check, member_check, models, scan_common  # noqa: E402

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

    def test_weekday_and_recent_join_phrases(self):
        # TODAY = thứ Năm 19/11/2026. Dữ liệu thật trước đây bị coi là "không rõ" → bị lọc nhầm.
        self.assertEqual(self.age("Joined on Monday"), 3)
        self.assertEqual(self.age("Joined last Saturday"), 5)
        self.assertEqual(self.age("Joined on Thursday"), 7)  # cùng thứ hôm nay = tuần trước
        self.assertEqual(self.age("Đã tham gia vào Thứ Hai"), 3)
        self.assertEqual(self.age("Đã tham gia vào Chủ nhật"), 4)
        self.assertEqual(self.age("Joined recently"), 0)
        self.assertEqual(self.age("Thứ Hai, 16 tháng 11"), 3)  # có ngày cụ thể → dùng ngày
        self.assertEqual(scan_common.format_join_date("Joined on Monday", today=TODAY), "16/11/2026")
        self.assertEqual(scan_common.format_join_date("Không rõ", today=TODAY), "Không rõ")

    def test_new_member_filter_keeps_weekday_joins(self):
        rows = [{"uid": "1", "name": "A", "joinedText": "Joined on Monday"},
                {"uid": "2", "name": "B", "joinedText": "Joined last Saturday"},
                {"uid": "3", "name": "C", "joinedText": "Joined 2 months ago"}]
        stats = {}
        kept = member_check.filter_member_rows(
            rows, group_seen=set(), cross_seen=set(), auto_dedupe=False, skip_admin=False,
            new_members_only=True, remaining=50, stats=stats,
        )
        self.assertEqual([r["uid"] for r in kept], ["1", "2"])  # trước đây cả 2 bị loại là "không rõ"
        self.assertNotIn("unknown_join", stats)
        self.assertEqual(stats.get("old"), 1)

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

    def test_interrupted_sessions_only_before_engine_start(self):
        calls = []

        class _DB:
            def fetch_all(self, sql, params=()):
                calls.append(("select", params))
                return [{"session_id": "OLD-1"}]

            def execute(self, sql, params=()):
                calls.append(("update", sql, params))

        with mock.patch.object(models, "db", _DB()):
            self.assertEqual(models.mark_interrupted_sessions("alice"), 1)
            self.assertEqual(models.mark_interrupted_sessions(""), 0)
        select = calls[0]
        self.assertEqual(select[1], ("alice", models._ENGINE_STARTED_UTC))  # chỉ phiên bắt đầu TRƯỚC Engine này
        self.assertIn("INTERRUPTED", calls[1][1])
        self.assertEqual(calls[1][2], ("alice", "OLD-1"))

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

    def run_parallel_scan(self, pool, groups, feeds, **kw):
        """Chạy thật nhiều luồng (quét thành viên song song) và chờ phiên xong."""
        fake_pool = FakePool(feeds, bad=kw.pop("bad", ()), kind="members", page=kw.pop("page", 3))
        real = types.SimpleNamespace(Thread=threading.Thread, Lock=threading.Lock, local=threading.local)
        with mock.patch.object(member_check, "open_account_session", fake_pool),                 mock.patch.object(member_check, "threading", real),                 mock.patch.object(keyword_check, "BROWSER_STAGGER_SEC", 0),                 mock.patch.object(member_check, "_diag_members_page", lambda d: {"groupsUser": 1}):
            res = member_check.start_member_scan("alice", pool, groups, delay_min=1, delay_max=1, **kw)
            deadline = time.time() + 15
            while time.time() < deadline:
                job = member_check.get_member_scan_status(res["job_id"], owner="alice")
                if job["status"] not in {"running", "paused"}:
                    return job, fake_pool
                time.sleep(0.02)
        self.fail("phiên quét thành viên không kết thúc")

    def test_parallel_split_and_bad_account(self):
        # 3 nick (1 hỏng), 4 nhóm → mỗi nick 1 nhóm + 1 dư; phần của nick hỏng được nick khác làm thay.
        feeds = {f"g{i}": member_feed(3, prefix=f"{i}00") for i in range(4)}
        groups = [{"group_id": f"g{i}", "name": f"G{i}"} for i in range(4)]
        job, pool = self.run_parallel_scan(["a", "bad", "c"], groups, feeds, bad=("bad",),
                                           members_limit=3, new_members_only=False)
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["groups_done"], 4)
        self.assertEqual(len(job["members"]), 12)  # không nhóm nào bị bỏ vì nick hỏng
        self.assertEqual(sorted(pool.opened), ["a", "c"])
        self.assertTrue(all(d.quit_called for d in pool.drivers))  # đóng Chrome khi xong
        self.assertTrue({"Thread-01"} <= {l["thread"] for l in job["logs"]})

    def test_parallel_two_nicks_four_groups_two_each(self):
        feeds = {f"g{i}": member_feed(2, prefix=f"{i}00") for i in range(4)}
        groups = [{"group_id": f"g{i}", "name": f"G{i}"} for i in range(4)]
        job, pool = self.run_parallel_scan(["a", "b"], groups, feeds, members_limit=2, new_members_only=False)
        self.assertEqual(job["status"], "done")
        per_nick = {}
        for d in pool.drivers:
            per_nick[d.uid] = len([u for u in d.visits if "/members" in u])
        self.assertEqual(per_nick, {"a": 2, "b": 2})

    def test_member_resume_state_after_stop(self):
        saved = {}
        feeds = {f"g{i}": member_feed(3, prefix=f"{i}00") for i in range(3)}
        groups = [{"group_id": f"g{i}", "name": f"G{i}"} for i in range(3)]
        real_scan = member_check._scan_group_members

        def scan_then_stop(job_id, *a, **k):
            out = real_scan(job_id, *a, **k)
            member_check._set_member_job(job_id, control="abort")  # Dừng khẩn cấp sau nhóm đầu
            return out

        with mock.patch.object(models, "save_resume_state", lambda sid, st: saved.__setitem__(sid, st)), \
                mock.patch.object(member_check, "_scan_group_members", scan_then_stop):
            job, _ = self.run_parallel_scan(["a"], groups, feeds, members_limit=3, new_members_only=False)
        self.assertEqual(job["status"], "aborted")
        state = saved[job["job_id"]]
        self.assertEqual(state["kind"], "group_members")
        # nhóm đầu bị dừng ngay sau khi quét → chưa tính xong (quét nốt khi Chạy tiếp), 2 nhóm sau chưa chạy
        remaining = models.resume_remaining(state)
        self.assertEqual([g["group_id"] for g in remaining], ["g0", "g1", "g2"])
        self.assertEqual(remaining[1]["limit"], 3)

    def test_member_resume_remaining_limits(self):
        state = {
            "kind": "group_members",
            "request": {"members_limit": 50, "groups": [{"group_id": "g0"}, {"group_id": "g1"}, {"group_id": "g2"}]},
            "progress": {"0": {"count": 50, "done": True}, "1": {"count": 20, "done": False}},
        }
        self.assertEqual(models.resume_remaining(state), [{"group_id": "g1", "limit": 30}, {"group_id": "g2", "limit": 50}])

    def test_group_limit_override_used_when_resuming(self):
        feeds = {"g1": member_feed(10)}
        job, _ = self.run_parallel_scan(["a"], [{"group_id": "g1", "name": "G1", "limit": 4}], feeds,
                                        members_limit=50, new_members_only=False)
        self.assertEqual(len(job["members"]), 4)

    def _fake_member_scan(self, simulate_pause):
        calls = []

        def fake(job_id, session, idx, grp, total, cross_seen, lock, *, sink=None, count_offset=0):
            calls.append((session["uid"], grp["group_id"], grp.get("limit"), count_offset))
            limit = int(grp.get("limit") or 5)
            if len(calls) == 1:  # nhóm đầu: quét được 2 thành viên thì Chrome bị tắt
                sink.extend({"uid": f"u{i}", "name": f"U{i}"} for i in range(2))
                if simulate_pause:
                    with member_check._member_jobs_lock:
                        member_check._member_jobs[job_id]["pause_resumes"] = 1
                raise RuntimeError("invalid session id")
            sink.extend({"uid": f"{grp['group_id']}-{count_offset + i}", "name": "x"} for i in range(limit))
            return sink

        return fake, calls

    def test_member_chrome_closed_while_paused_reopens_and_continues_group(self):
        fake, calls = self._fake_member_scan(simulate_pause=True)
        with mock.patch.object(member_check, "_scan_group_members", fake):
            job, pool = self.run_parallel_scan(["a"], [{"group_id": "g0", "name": "G0"}], {}, members_limit=5)
        self.assertEqual(job["status"], "done")
        self.assertEqual(pool.opened, ["a", "a"])                  # mở lại Chrome của chính nick đó
        self.assertEqual(calls[1][2:], (3, 2))                      # quét tiếp 3 thành viên còn thiếu, từ 2/5
        self.assertEqual(len(job["members"]), 5)                    # 2 thành viên trước khi tắt Chrome vẫn giữ

    def test_member_chrome_closed_while_running_stops_not_done(self):
        fake, calls = self._fake_member_scan(simulate_pause=False)
        groups = [{"group_id": "g0", "name": "G0"}, {"group_id": "g1", "name": "G1"}]
        with mock.patch.object(member_check, "_scan_group_members", fake):
            job, pool = self.run_parallel_scan(["a"], groups, {}, members_limit=5)
        self.assertEqual(job["status"], "aborted")                  # không báo Hoàn thành khi còn nhóm chưa xong
        self.assertIn("chưa quét xong", job["error"])
        self.assertEqual(pool.opened, ["a"])                        # tắt Chrome lúc đang chạy → dừng, không mở lại
        self.assertEqual(len(job["members"]), 2)                    # phần đã quét vẫn giữ

    def test_admin_and_new_member_filters_apply(self):
        feed = member_feed(6, isAdmin=lambda i: i == 0, joinedText=lambda i: "Joined 2 days ago" if i % 2 else "Joined 2 years ago")
        job, _ = self.run_scan(["a"], [{"group_id": "g1", "name": "G1"}], {"g1": feed},
                               members_limit=50, skip_admin=True, new_members_only=True)
        self.assertEqual([m["uid"] for m in job["members"]], ["100000001", "100000003", "100000005"])
        # Lưu ngày cụ thể thay vì chữ "Joined 2 days ago".
        from datetime import date as _date, timedelta as _td
        self.assertEqual(job["members"][0]["joined_date"], (_date.today() - _td(days=2)).strftime("%d/%m/%Y"))

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

    def _slow_scrape(self, *a, **k):
        time.sleep(0.3)  # quét thật mất vài phút/từ khóa — đủ để Chrome khác kịp mở
        return self._fake_scrape(*a, **k)

    def run_parallel(self, pool_obj, uids, keywords, scrape=None):
        """Chạy thật nhiều luồng (không SyncThread) và chờ job xong."""
        self.scrape_calls = []
        real = types.SimpleNamespace(Thread=threading.Thread, Lock=threading.Lock)
        with mock.patch.object(keyword_check, "open_account_session", pool_obj), \
                mock.patch.object(keyword_check, "threading", real), \
                mock.patch.object(keyword_check, "BROWSER_STAGGER_SEC", 0), \
                mock.patch.object(keyword_check, "_scrape_groups_from_results", scrape or self._slow_scrape):
            res = keyword_check.start_keyword_check(
                owner="alice", uid=uids[0], uids=uids, keywords=keywords, delay_min=0, delay_max=0,
            )
            deadline = time.time() + 10
            while time.time() < deadline:
                job = keyword_check.get_check_status(job_id=res["job_id"], owner="alice")
                if job["status"] not in {"running", "paused"}:
                    return job
                time.sleep(0.02)
        self.fail("job không kết thúc")

    def test_two_nicks_two_keywords_run_in_parallel(self):
        barrier = threading.Barrier(2, timeout=5)

        def scrape(driver, keyword, job_id, hs, max_groups, **k):
            self.scrape_calls.append((driver.uid, keyword))
            barrier.wait()  # chỉ qua được khi 2 Chrome cùng đang quét
            return [{"href": f"https://www.facebook.com/groups/{keyword}{i}"} for i in range(max_groups)]

        pool = FakePool({}, kind="groups")
        job = self.run_parallel(pool, ["a", "b"], [{"keyword": "k1", "limit": 3}, {"keyword": "k2", "limit": 3}], scrape)
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["count"], 6)
        self.assertEqual(sorted(pool.opened), ["a", "b"])
        self.assertEqual({nick for nick, _ in self.scrape_calls}, {"a", "b"})  # mỗi nick 1 từ khóa
        self.assertTrue(all(d.quit_called for d in pool.drivers))
        self.assertEqual({l["thread"] for l in job["logs"]} >= {"Thread-01", "Thread-02"}, True)

    def test_more_nicks_than_keywords_leaves_extra_nick_closed(self):
        pool = FakePool({}, kind="groups")
        job = self.run_parallel(pool, ["a", "b", "c"], [{"keyword": "k1", "limit": 2}, {"keyword": "k2", "limit": 2}])
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["count"], 4)
        self.assertEqual(sorted(pool.opened), ["a", "b"])

    def test_one_nick_two_keywords_scans_one_after_another(self):
        pool = FakePool({}, kind="groups")
        job = self.run_parallel(pool, ["a"], [{"keyword": "k1", "limit": 2}, {"keyword": "k2", "limit": 2}])
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["count"], 4)
        self.assertEqual(pool.opened, ["a"])  # chỉ 1 Chrome cho 1 nick
        self.assertEqual([c[1] for c in self.scrape_calls], ["k1", "k2"])

    def test_failed_nick_is_replaced_by_spare(self):
        pool = FakePool({}, bad=("b",), kind="groups")
        job = self.run_parallel(pool, ["a", "b", "c"], [{"keyword": "k1", "limit": 2}, {"keyword": "k2", "limit": 2}])
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["count"], 4)
        self.assertEqual(sorted(pool.opened), ["a", "c"])

    def test_at_most_five_browsers(self):
        pool = FakePool({}, kind="groups")
        uids = [f"n{i}" for i in range(7)]
        kws = [{"keyword": f"k{i}", "limit": 1} for i in range(7)]
        job = self.run_parallel(pool, uids, kws)
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["count"], 7)
        self.assertLessEqual(len(pool.opened), 5)

    def _per_nick_scrape(self, slow):
        def scrape(driver, keyword, job_id, hs, max_groups, **k):
            self.scrape_calls.append((driver.uid, keyword))
            time.sleep(0.6 if driver.uid in slow else 0.1)
            return [{"href": f"https://www.facebook.com/groups/{keyword}"}]
        return scrape

    def test_four_items_split_two_each(self):
        pool = FakePool({}, kind="groups")
        kws = [{"keyword": f"k{i}", "limit": 1} for i in range(4)]
        # nick b chậm hơn hẳn nhưng vẫn phải được đúng 2 việc
        job = self.run_parallel(pool, ["a", "b"], kws, self._per_nick_scrape({"b"}))
        self.assertEqual(job["status"], "done")
        by = {}
        for nick, _ in self.scrape_calls:
            by[nick] = by.get(nick, 0) + 1
        self.assertEqual(by, {"a": 2, "b": 2})

    def test_five_items_extra_goes_to_faster_nick(self):
        pool = FakePool({}, kind="groups")
        kws = [{"keyword": f"k{i}", "limit": 1} for i in range(5)]
        job = self.run_parallel(pool, ["a", "b"], kws, self._per_nick_scrape({"b"}))
        self.assertEqual(job["count"], 5)
        by = {}
        for nick, _ in self.scrape_calls:
            by[nick] = by.get(nick, 0) + 1
        self.assertEqual(by, {"a": 3, "b": 2})

    def test_fair_queue_hands_over_work_of_failed_worker(self):
        q = scan_common.FairQueue(range(4), 2)
        self.assertEqual([q.take(0), q.take(1)], [0, 1])
        self.assertIsNone(q.take(2, wait=False))   # hết phần, việc còn lại là của luồng kia
        q.leave(0)                                 # luồng kia không mở được Chrome → trả 2 việc
        self.assertEqual([q.take(2), q.take(3)], [2, 3])
        self.assertEqual(q.remaining(), [])
        q2 = scan_common.FairQueue(range(3), 2)
        x = q2.take(0)
        q2.put_back(x)                             # dừng lúc nghỉ → trả lại, luồng khác lấy được
        q2.leave(1)
        self.assertEqual(sorted([q2.take(0), q2.take(1), q2.take(2)]), [0, 1, 2])

    def test_finished_worker_waits_and_takes_over_late_failure(self):
        # Luồng A xong phần mình trước; luồng B bỏ cuộc SAU đó → A (đang chờ) phải làm thay, không bỏ sót.
        q = scan_common.FairQueue(range(4), 2)
        got = []

        def worker_a():
            taken = 0
            while (item := q.take(taken)) is not None:
                taken += 1
                got.append(item)
            q.leave(taken)

        t = threading.Thread(target=worker_a)
        t.start()
        time.sleep(0.3)          # A đã làm 2 việc của mình và đang chờ
        self.assertEqual(got, [0, 1])
        q.leave(0)               # B không mở được Chrome
        t.join(5)
        self.assertEqual(got, [0, 1, 2, 3])
        self.assertEqual(q.remaining(), [])

    def test_finished_worker_stops_when_others_finish(self):
        q = scan_common.FairQueue(range(4), 2)
        done = []

        def worker(name):
            taken = 0
            while (item := q.take(taken)) is not None:
                taken += 1
                done.append((name, item))
                time.sleep(0.05 if name == "a" else 0.2)
            q.leave(taken)

        ts = [threading.Thread(target=worker, args=(n,)) for n in ("a", "b")]
        for t in ts:
            t.start()
        for t in ts:
            t.join(5)
        self.assertFalse(any(t.is_alive() for t in ts))
        self.assertEqual(sorted(i for _, i in done), [0, 1, 2, 3])
        self.assertEqual(sum(1 for n, _ in done if n == "a"), 2)

    def test_resume_state_saved_and_remaining_after_stop(self):
        # 3 từ khóa: k1 xong 30/30, k2 mới được 5 thì bị Dừng khẩn cấp, k3 chưa chạy.
        saved = {}

        def scrape(driver, keyword, job_id, hs, max_groups, **k):
            if keyword == "k2":
                keyword_check._update_keyword_stat(job_id, keyword, count=5, status="running")
                keyword_check._set_job(job_id, control="abort")
                return [{"href": f"https://www.facebook.com/groups/k2-{i}"} for i in range(5)]
            return [{"href": f"https://www.facebook.com/groups/{keyword}-{i}"} for i in range(max_groups)]

        kws = [{"keyword": "k1", "limit": 30}, {"keyword": "k2", "limit": 30}, {"keyword": "k3", "limit": 20}]
        with mock.patch.object(models, "save_resume_state", lambda sid, st: saved.__setitem__(sid, st)):
            job = self.run_parallel(FakePool({}, kind="groups"), ["a"], kws, scrape)
        self.assertEqual(job["status"], "aborted")
        state = saved[job["job_id"]]
        self.assertEqual(state["kind"], "group_info")
        self.assertEqual(state["request"]["uids"], ["a"])
        self.assertEqual(state["progress"]["k1"], {"count": 30, "done": True})
        self.assertEqual(state["progress"]["k2"], {"count": 5, "done": False})
        self.assertEqual(models.resume_remaining(state), [{"keyword": "k2", "limit": 25}, {"keyword": "k3", "limit": 20}])

    def test_resume_state_links_done_individually(self):
        state = {
            "kind": "group_info",
            "request": {"keywords": [{"keyword": "https://www.facebook.com/groups/1", "limit": 30},
                                     {"keyword": "https://www.facebook.com/groups/2", "limit": 30}]},
            "progress": {"https://www.facebook.com/groups/1": {"count": 1, "done": True}},
        }
        self.assertEqual(models.resume_remaining(state), [{"keyword": "https://www.facebook.com/groups/2", "limit": 30}])
        self.assertEqual(models.resume_remaining(None), [])

    def _dead_on_k3(self, simulate_pause):
        calls = []

        def scrape(driver, keyword, job_id, hs, max_groups, stat_offset=0, **k):
            calls.append((driver.uid, keyword, max_groups, stat_offset))
            if keyword == "k3" and len([c for c in calls if c[1] == "k3"]) == 1:
                keyword_check._update_keyword_stat(job_id, keyword, count=1, status="running")
                if simulate_pause:  # người dùng Tạm dừng → tắt Chrome → bấm Tiếp tục
                    with keyword_check._jobs_lock:
                        keyword_check._jobs[job_id]["pause_resumes"] = 1
                raise RuntimeError("invalid session id")
            return [{"href": f"https://www.facebook.com/groups/{keyword}-{stat_offset + i}"} for i in range(max_groups)]

        return scrape, calls

    def test_chrome_closed_while_paused_reopens_and_continues_same_keyword(self):
        scrape, calls = self._dead_on_k3(simulate_pause=True)
        pool = FakePool({}, kind="groups")
        kws = [{"keyword": f"k{i}", "limit": 5} for i in (1, 2, 3)]
        job = self.run_parallel(pool, ["a"], kws, scrape)
        self.assertEqual(job["status"], "done")
        self.assertEqual(pool.opened, ["a", "a"])                       # mở lại Chrome của chính nick đó
        self.assertEqual([c[1] for c in calls], ["k1", "k2", "k3", "k3"])  # không quét lại k1, k2
        self.assertEqual(calls[-1][2:], (4, 1))                          # quét tiếp 4 nhóm còn thiếu, từ 1/5
        self.assertEqual(job["keyword_stats"]["k3"]["count"], 5)

    def test_chrome_closed_while_running_stops_and_is_not_reported_done(self):
        saved = {}
        scrape, calls = self._dead_on_k3(simulate_pause=False)
        kws = [{"keyword": f"k{i}", "limit": 5} for i in (1, 2, 3)]
        with mock.patch.object(models, "save_resume_state", lambda sid, st: saved.__setitem__(sid, st)):
            job = self.run_parallel(FakePool({}, kind="groups"), ["a"], kws, scrape)
        self.assertEqual(job["status"], "aborted")                    # trước đây báo "done" dù k3 chưa xong
        self.assertIn("chưa quét xong", job["error"])
        self.assertEqual(models.resume_remaining(saved[job["job_id"]]), [{"keyword": "k3", "limit": 4}])

    def test_no_nick_opens_is_error(self):
        pool = FakePool({}, bad=("a", "b"), kind="groups")
        job = self.run_parallel(pool, ["a", "b"], [{"keyword": "k1", "limit": 2}])
        self.assertEqual(job["status"], "error")

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


# ---------------------------------------------------------------------------
# Kiểm tra sức chứa từ khóa (nút Kiểm tra)
# ---------------------------------------------------------------------------


class _SearchDriver:
    """Trang kết quả tìm nhóm giả: mỗi lần cuộn hiện thêm `page` nhóm, hết danh sách thì đứng yên."""

    def __init__(self, rows, page=4, blocked_after=None, stall=0, end_text=False):
        self.rows, self.page, self.visible = rows, page, page
        self.blocked_after = blocked_after
        self.stall = stall          # số lượt cuộn Facebook "đang tải" (spinner) trước khi trả lô mới
        self.end_text = end_text    # trang có chữ "End of results"
        self.scrolls = 0
        self.urls = []

    def get(self, url):
        self.urls.append(url)
        self.visible = self.page

    def find_elements(self, *a, **k):
        return []

    def execute_script(self, js, *args):
        if js is keyword_check.GROUP_RESULTS_JS:
            return [dict(r) for r in self.rows[: self.visible]]
        if js is keyword_capacity._END_OF_RESULTS_JS:
            return {
                "blocked": self.blocked_after is not None and self.scrolls >= self.blocked_after,
                "end": self.end_text,
                "loading": self.stall > 0,
            }
        if js is keyword_capacity._NUDGE_JS:
            return 0
        self.scrolls += 1
        if self.stall > 0:
            self.stall -= 1  # đang tải: lượt cuộn này chưa ra nhóm mới
        else:
            self.visible += self.page
        return None


def _grp(i, meta):
    return {"href": f"https://www.facebook.com/groups/{100000 + i}/", "name": f"Nhóm {i}", "meta": meta}


class KeywordCapacityTests(unittest.TestCase):
    def setUp(self):
        from modules.module_02_account_manager import automation

        p = mock.patch.object(automation, "wait_and_find", lambda *a, **k: None)
        p.start()
        self.addCleanup(p.stop)

    def count(self, driver, **kw):
        return keyword_capacity.count_keyword_groups(
            driver, "marketing", should_stop=lambda: False, sleep=lambda a, b: None, **kw,
        )

    def test_scrolls_until_facebook_stops_and_counts_by_filter(self):
        rows = [_grp(i, "Public · 5K members") for i in range(10)]
        rows += [_grp(10 + i, "Private · 20K members") for i in range(3)]
        rows += [_grp(20 + i, "Public · 300 members") for i in range(2)]
        rows += [rows[0]]  # Facebook lặp lại 1 nhóm → không đếm 2 lần
        driver = _SearchDriver(rows, page=4)
        res = self.count(driver, public_only=True, min_members=1000, known_ids={"100001", "100002"})
        self.assertEqual(res["total"], 15)
        self.assertEqual(res["count"], 10)       # chỉ nhóm công khai, ≥ 1000 thành viên
        self.assertEqual(res["fresh"], 8)        # trừ 2 nhóm đã có trong DB
        self.assertIn("search/groups/?q=marketing", driver.urls[0])
        # Cuộn tới khi hết hẳn rồi thêm NO_GROWTH_ROUNDS lượt không có gì mới mới dừng.
        self.assertGreaterEqual(driver.scrolls, 4)
        self.assertLess(driver.scrolls, 4 + keyword_capacity.NO_GROWTH_ROUNDS + 2)
        self.assertIn("đã xem hết", res["reason"])
        self.assertTrue(res["complete"])

    def test_stops_when_facebook_blocks(self):
        rows = [_grp(i, "Public · 5K members") for i in range(40)]
        res = self.count(_SearchDriver(rows, page=4, blocked_after=2), public_only=True, min_members=None, known_ids=set())
        self.assertIn("chặn", res["reason"])
        self.assertFalse(res["complete"])  # chưa xem hết → không lưu kết quả
        self.assertLess(res["total"], 40)

    def test_slow_loading_is_not_treated_as_end(self):
        rows = [_grp(i, "Public · 5K members") for i in range(30)]
        # Facebook "đang tải" 5 lượt liền trước khi trả lô tiếp → vẫn phải đếm đủ 30.
        res = self.count(_SearchDriver(rows, page=10, stall=5), public_only=True, min_members=None, known_ids=set())
        self.assertEqual(res["total"], 30)

    def test_end_text_needs_two_idle_rounds(self):
        rows = [_grp(i, "Public · 5K members") for i in range(12)]
        driver = _SearchDriver(rows, page=4, end_text=True)
        res = self.count(driver, public_only=True, min_members=None, known_ids=set())
        self.assertEqual(res["total"], 12)  # chữ "End of results" không làm dừng khi vẫn đang ra nhóm mới
        self.assertIn("Facebook báo hết kết quả", res["reason"])

    def test_saved_groups_recomputed_with_current_filter_and_db(self):
        groups = [{"id": "1", "type": "public", "members": 5000}, {"id": "2", "type": "public", "members": 500},
                  {"id": "3", "type": "private", "members": 9000}, {"id": "4", "type": "public", "members": None}]
        f = keyword_capacity.summarize_groups
        self.assertEqual(f(groups, public_only=True, min_members=1000, known_ids=set()), {"total": 4, "count": 1, "fresh": 1})
        self.assertEqual(f(groups, public_only=True, min_members=None, known_ids={"1"}), {"total": 4, "count": 3, "fresh": 2})
        res = self.count(_SearchDriver([_grp(1, "Public · 2K members")], page=4), public_only=True, min_members=None, known_ids=set())
        self.assertEqual(res["groups"], [{"id": "100001", "type": "public", "members": 2000}])

    def test_cached_keywords_skip_browser_and_accounts(self):
        cached = {"a": {"total": 5, "count": 4, "fresh": 4, "status": "done", "cached": True}}
        with mock.patch.object(keyword_capacity, "cached_capacity_stats", lambda *a, **k: dict(cached)):
            res = keyword_capacity.start_capacity_check("bob", [], ["A"])  # không chọn tài khoản vẫn được
            self.assertIsNone(res["job_id"])
            self.assertEqual(res["cached"]["a"]["count"], 4)
            with self.assertRaises(ValueError):  # còn từ khóa chưa kiểm tra thì mới cần tài khoản
                keyword_capacity.start_capacity_check("bob", [], ["a", "b"])
            spawned = []
            with mock.patch.object(keyword_capacity, "threading", types.SimpleNamespace(
                    Thread=lambda **k: types.SimpleNamespace(start=lambda: spawned.append(k)), Lock=threading.Lock)):
                res = keyword_capacity.start_capacity_check("bob", ["u"], ["a", "b"])
                self.assertEqual(res["keywords"], ["b"])  # chỉ quét từ khóa chưa có
                keyword_capacity.stop_capacity_check(res["job_id"], "bob")
                keyword_capacity._set(res["job_id"], status="aborted")
                res = keyword_capacity.start_capacity_check("bob", ["u"], ["a"], force=True)
                self.assertEqual(res["keywords"], ["a"])  # Kiểm tra lại: bỏ kết quả đã lưu
                self.assertEqual(res["cached"], {})
            self.assertEqual(len(spawned), 2)

    def test_capacity_check_opens_one_chrome_per_nick_in_parallel(self):
        barrier = threading.Barrier(2, timeout=5)
        seen = []

        def fake_count(driver, word, **k):
            seen.append((driver.uid, word))
            barrier.wait()  # chỉ qua được khi 2 Chrome cùng đang kiểm tra
            return {"total": 5, "count": 3, "fresh": 3, "reason": "xong", "groups": [], "complete": False}

        pool = FakePool({}, kind="groups")
        with mock.patch.object(keyword_capacity, "open_account_session", pool),                 mock.patch.object(keyword_capacity, "count_keyword_groups", fake_count),                 mock.patch.object(keyword_capacity, "cached_capacity_stats", lambda *a, **k: {}),                 mock.patch.object(keyword_check, "BROWSER_STAGGER_SEC", 0),                 mock.patch.object(models, "list_known_group_ids", lambda owner: set()):
            res = keyword_capacity.start_capacity_check("carol", ["a", "b", "c"], ["k1", "k2"])
            deadline = time.time() + 10
            while time.time() < deadline:
                st = keyword_capacity.get_capacity_status(res["job_id"], "carol")
                if st["status"] in keyword_capacity.TERMINAL_STATUSES:
                    break
                time.sleep(0.02)
        self.assertEqual(st["status"], "done")
        self.assertEqual(sorted(pool.opened), ["a", "b"])  # nick c dư, không mở
        self.assertEqual({w for _, w in seen}, {"k1", "k2"})
        self.assertTrue(all(d.quit_called for d in pool.drivers))
        self.assertTrue({"Kiểm tra 1", "Kiểm tra 2"} <= {l["thread"] for l in st["logs"]})

    def test_real_scan_keeps_scrolling_like_capacity_check(self):
        # Log thật: 15 nhóm đầu (1 riêng tư), Facebook đang tải vài lượt rồi mới hiện lô tiếp → phải đủ 30.
        rows = [_grp(i, "Private · 24K members" if i == 11 else "Public · 5K members") for i in range(60)]
        driver = _SearchDriver(rows, page=15, stall=3)
        with mock.patch.object(models, "upsert_scanned_group", lambda **k: True):
            found = keyword_check._scrape_groups_from_results(
                driver, "đại học phenikaa", "job-x", lambda a, b: None, 30,
                public_only=True, min_members=1000, owner="alice", source_uid="u1",
            )
        self.assertEqual(len(found), 30)
        self.assertNotIn("https://www.facebook.com/groups/100011", [g["href"] for g in found])

    def test_new_nick_scrolls_past_groups_already_taken(self):
        # Log thật: đã lấy 15 nhóm bằng 3 lượt nick, nick mới tìm lại từ đầu, Facebook hiện 4 nhóm/lượt cuộn.
        # Cuộn qua 15 nhóm cũ không được tính là "hết kết quả" → phải lấy đủ 15 nhóm còn lại.
        rows = [_grp(i, "Public · 5K members") for i in range(60)]
        already = [{"href": "https://www.facebook.com/groups/%d" % (100000 + i)} for i in range(40)]
        driver = _SearchDriver(rows, page=4)
        with mock.patch.object(models, "upsert_scanned_group", lambda **k: True):
            found = keyword_check._scrape_groups_from_results(
                driver, "đại học phenikaa", "job-z", lambda a, b: None, 15, already=already,
                public_only=True, owner="alice", source_uid="u2",
            )
        self.assertEqual(len(found), 15)
        self.assertEqual(found[0]["href"], "https://www.facebook.com/groups/100040")

    def test_real_scan_stops_when_results_run_out(self):
        rows = [_grp(i, "Public · 5K members") for i in range(14)]
        driver = _SearchDriver(rows, page=15)
        with mock.patch.object(models, "upsert_scanned_group", lambda **k: True):
            found = keyword_check._scrape_groups_from_results(
                driver, "x", "job-y", lambda a, b: None, 30, public_only=True, owner="alice",
            )
        self.assertEqual(len(found), 14)
        # hết kết quả thật: thử tải lại trang 1 lần rồi dừng (không cuộn mãi)
        self.assertLessEqual(driver.scrolls, 2 * (8 + 1))
        self.assertEqual(len(driver.urls), 1)

    def test_real_scan_reloads_once_when_facebook_stops_loading_early(self):
        # Facebook chỉ hiện 5 nhóm rồi ngừng tải (từ khóa thứ 2 trên cùng Chrome); tải lại trang thì cuộn được tiếp.
        class _StallsUntilReload(_SearchDriver):
            def execute_script(self, js, *args):
                if js is keyword_check.GROUP_RESULTS_JS and not self.urls:
                    return [dict(r) for r in self.rows[:5]]
                return super().execute_script(js, *args)

        rows = [_grp(i, "Public · 5K members") for i in range(40)]
        driver = _StallsUntilReload(rows, page=5)
        with mock.patch.object(models, "upsert_scanned_group", lambda **k: True):
            found = keyword_check._scrape_groups_from_results(
                driver, "phú hà3", "job-r", lambda a, b: None, 20, public_only=True, owner="alice",
            )
        self.assertEqual(len(found), 20)
        self.assertEqual(len(driver.urls), 1)
        self.assertIn("/search/groups/?q=", driver.urls[0])

    def test_closed_browser_stops_immediately(self):
        self.assertTrue(scan_common.is_browser_dead_error(Exception("invalid session id")))
        self.assertTrue(scan_common.is_browser_dead_error(Exception("no such window: target window already closed")))
        self.assertFalse(scan_common.is_browser_dead_error(Exception("stale element reference")))

        class _Closed(_SearchDriver):
            def execute_script(self, js, *args):
                if self.scrolls >= 2:
                    raise Exception("no such window: target window already closed")
                return super().execute_script(js, *args)

        rows = [_grp(i, "Public · 5K members") for i in range(40)]
        with self.assertRaises(Exception):  # không nuốt lỗi rồi cuộn tiếp như trước
            self.count(_Closed(rows, page=4), public_only=True, min_members=None, known_ids=set())

    def test_start_validation_and_owner_scope(self):
        with self.assertRaises(ValueError):
            keyword_capacity.start_capacity_check("alice", [], ["a"])
        with self.assertRaises(ValueError):
            keyword_capacity.start_capacity_check("alice", ["u1"], ["  "])
        with mock.patch.object(keyword_capacity, "threading", types.SimpleNamespace(Thread=lambda **k: types.SimpleNamespace(start=lambda: None), Lock=threading.Lock)):
            res = keyword_capacity.start_capacity_check("alice", ["u1"], ["Marketing", "marketing", "sale"])
        jid = res["job_id"]
        self.assertEqual(res["keywords"], ["marketing", "sale"])
        self.assertIsNone(keyword_capacity.get_capacity_status(jid, "mallory"))
        self.assertFalse(keyword_capacity.stop_capacity_check(jid, "mallory"))
        self.assertEqual(keyword_capacity.get_active_capacity_job("alice"), jid)
        with self.assertRaises(RuntimeError):  # không cho chạy 2 phiên kiểm tra cùng lúc
            keyword_capacity.start_capacity_check("alice", ["u1"], ["x"])
        self.assertTrue(keyword_capacity.stop_capacity_check(jid, "alice"))
        self.assertEqual(keyword_capacity.get_capacity_status(jid, "alice")["status"], "stopping")


class ResumeTrackerTests(unittest.TestCase):
    def test_throttles_count_updates_but_saves_done_immediately(self):
        writes = []
        t = scan_common.ResumeTracker("S1", "group_info", {"keywords": []}, ["a", "b"],
                                      save=lambda sid, st: writes.append(st), min_interval=60)
        t.flush()
        t.update("a", count=3)          # trong 60s → chưa ghi
        self.assertEqual(len(writes), 1)
        t.update("a", count=5, done=True)  # xong 1 mục → ghi ngay
        self.assertEqual(len(writes), 2)
        self.assertEqual(writes[-1]["progress"]["a"], {"count": 5, "done": True})
        t.update("b", count=2)
        t.flush()
        self.assertEqual(writes[-1]["progress"]["b"], {"count": 2, "done": False})
        t.update("b", count=1)          # số đếm không giảm
        t.flush()
        self.assertEqual(writes[-1]["progress"]["b"]["count"], 2)


if __name__ == "__main__":
    unittest.main()


class ResumeEndpointTests(unittest.TestCase):
    """POST /sessions/{id}/resume: chỉ gửi phần còn thiếu, cùng nick & cấu hình, đánh dấu phiên cũ RESUMED."""

    def setUp(self):
        from modules.module_10_group_scan import router

        self.router = router
        self.status_updates = []
        p = mock.patch.object(router, "update_scan_session", lambda sid, **k: self.status_updates.append((sid, k)))
        p.start()
        self.addCleanup(p.stop)

    def info(self, status="INTERRUPTED", scan_type="GROUP_INFO", state=None):
        state = state or {
            "kind": "group_info",
            "request": {"uids": ["a", "b"], "delay_min": 6, "delay_max": 9, "min_members": 1000,
                        "keywords": [{"keyword": "k1", "limit": 30}, {"keyword": "k2", "limit": 30}]},
            "progress": {"k1": {"count": 30, "done": True}, "k2": {"count": 12, "done": False}},
        }
        return {"session_id": "OLD", "scan_type": scan_type, "status": status, "state": state,
                "remaining": models.resume_remaining(state)}

    def call(self, info):
        from modules.module_02_account_manager.context import owner_scope

        sent = {}
        with owner_scope("alice"), \
                mock.patch.object(self.router, "get_resume_info", lambda owner, sid: info), \
                mock.patch.object(self.router, "check_keyword", lambda body, db: sent.update(kw=body) or {"job_id": "NEW"}), \
                mock.patch.object(self.router, "post_start_member_scan", lambda body: sent.update(mem=body) or {"job_id": "NEWM"}):
            res = self.router.resume_session("OLD", db=None)
        return res, sent

    def test_group_info_resumes_only_missing(self):
        res, sent = self.call(self.info())
        body = sent["kw"]
        self.assertEqual(body.uids, ["a", "b"])
        self.assertEqual([(k.keyword, k.limit) for k in body.keywords], [("k2", 18)])
        self.assertEqual((body.delay_min, body.delay_max, body.min_members), (6, 9, 1000))
        self.assertEqual(res["job_id"], "NEW")
        self.assertEqual(self.status_updates, [("OLD", {"status": "RESUMED"})])

    def test_members_resume(self):
        state = {"kind": "group_members",
                 "request": {"uids": ["a"], "members_limit": 40, "delay_min": 5, "delay_max": 10,
                             "groups": [{"group_id": "g0"}, {"group_id": "g1"}]},
                 "progress": {"0": {"count": 40, "done": True}}}
        res, sent = self.call(self.info(scan_type="GROUP_MEMBERS", state=state))
        self.assertEqual(sent["mem"].groups, [{"group_id": "g1", "limit": 40}])
        self.assertEqual(res["job_id"], "NEWM")

    def test_rejects_finished_or_old_sessions(self):
        from fastapi import HTTPException

        for info in (self.info(status="SUCCESS"),
                     {**self.info(), "state": None, "remaining": []},
                     self.info(state={"kind": "group_info", "request": {"keywords": [{"keyword": "k", "limit": 5}]},
                                      "progress": {"k": {"count": 5, "done": True}}})):
            with self.assertRaises(HTTPException) as ctx:
                self.call(info)
            self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(self.status_updates, [])


class LinkLookupTests(unittest.TestCase):
    """Kiểm tra & Lọc trùng lặp (Nhập link / Tải tệp): link nhóm đã quét trước đó không được quét lại."""

    ROWS = [
        {"owner_username": "alice", "group_id": "403125780067434",
         "group_url": "https://www.facebook.com/groups/403125780067434", "group_name": "BTS goods",
         "privacy": "public", "last_seen_at": None},
        {"owner_username": "alice", "group_id": "mekinhdoanh889",
         "group_url": "https://www.facebook.com/groups/mekinhdoanh889/", "group_name": "Mẹ kinh doanh",
         "privacy": "PRIVATE", "last_seen_at": None},
        {"owner_username": "bob", "group_id": "1783064308557158",
         "group_url": "https://www.facebook.com/groups/1783064308557158", "group_name": "Of bob",
         "privacy": "public", "last_seen_at": None},
    ]

    def fake_db(self):
        rows, calls = self.ROWS, []

        class _DB:
            def fetch_all(self, sql, params=()):
                calls.append((sql, params))
                owner, rest = params[0], list(params[1:])
                half = len(rest) // 2
                ids, urls = set(rest[:half]), set(rest[half:])
                return [r for r in rows if r["owner_username"] == owner
                        and (r["group_id"].lower() in ids or r["group_url"].lower().rstrip("/") in urls)]

        return _DB(), calls

    def lookup(self, owner, links):
        db, calls = self.fake_db()
        with mock.patch.object(models, "db", db):
            return models.lookup_scanned_groups(owner, links), calls

    def test_marks_known_links_in_any_url_form(self):
        links = [
            "https://www.facebook.com/groups/403125780067434/?ref=share",
            "facebook.com/groups/403125780067434",
            "https://m.facebook.com/groups/mekinhdoanh889/posts/1",
            "https://www.facebook.com/groups/999999999999999",
        ]
        out, _ = self.lookup("alice", links)
        self.assertEqual(set(out), set(links[:3]))
        self.assertEqual(out[links[0]]["group_name"], "BTS goods")
        self.assertEqual(out[links[2]]["privacy"], "private")  # chuẩn hoá chữ thường → FE gắn nhãn Riêng tư
        self.assertNotIn(links[3], out)  # link mới → được quét

    def test_scoped_to_owner(self):
        out, calls = self.lookup("alice", ["https://www.facebook.com/groups/1783064308557158"])
        self.assertEqual(out, {})  # nhóm của bob không tính là "đã quét" với alice
        self.assertEqual(calls[0][1][0], "alice")

    def test_no_owner_or_no_links_skips_db(self):
        for owner, links in (("", ["https://www.facebook.com/groups/403125780067434"]), ("alice", []), ("alice", ["", "  "])):
            out, calls = self.lookup(owner, links)
            self.assertEqual((out, calls), ({}, []))

    def test_large_lists_are_chunked(self):
        links = [f"https://www.facebook.com/groups/{100000000 + i}" for i in range(1200)] + [
            "https://www.facebook.com/groups/403125780067434"]
        out, calls = self.lookup("alice", links)
        self.assertEqual(len(calls), 3)  # 1201 id → 3 câu truy vấn ≤ 500 id
        self.assertTrue(all(len(p) <= 1 + 2 * 500 for _, p in calls))
        self.assertEqual(list(out), [links[-1]])

    def test_lookup_endpoint(self):
        from modules.module_02_account_manager.context import owner_scope
        from modules.module_10_group_scan import router

        seen = {}
        with owner_scope("alice"), mock.patch.object(
                router, "lookup_scanned_groups", lambda owner, links: seen.update(owner=owner, links=links) or {"x": 1}):
            res = router.lookup_groups(router.GroupLookupRequest(links=["a", "b"]))
        self.assertEqual(res, {"known": {"x": 1}})
        self.assertEqual(seen, {"owner": "alice", "links": ["a", "b"]})


class DeleteSessionTests(unittest.TestCase):
    def test_reports_ok_only_when_a_row_was_deleted(self):
        class _Cur:
            def __init__(self, n):
                self.rowcount = n

        for rowcount, expected in ((1, True), (0, False)):
            with mock.patch.object(models, "db", types.SimpleNamespace(execute=lambda sql, params=(), n=rowcount: _Cur(n))):
                self.assertIs(models.delete_scan_session("bob", "S-ALICE"), expected)
        with mock.patch.object(models, "db", types.SimpleNamespace(execute=lambda sql, params=(): _Cur(0))):
            self.assertEqual(models.delete_scan_sessions_bulk("bob", ["a", "b"]), 0)  # số đã xoá đúng
        self.assertFalse(models.delete_scan_session("", "x"))


class GroupCategoryTests(unittest.TestCase):
    """Danh sách nhóm quét: chọn thư mục nào thì thấy đúng nhóm của thư mục đó (1 nhóm có thể ở nhiều thư mục)."""

    GROUPS = [{"group_id": "111", "keyword": "phenikaa"}, {"group_id": "222", "keyword": "nam sách"},
              {"group_id": "333", "keyword": "ly"}]
    LINKS = [{"group_id": "333", "category_name": "Cẩm Ly"}, {"group_id": "111", "category_name": "Đại học  Phenikaa"},
             {"group_id": "999", "category_name": "ly"}]  # 999: nhóm đã xoá → bỏ qua
    CATS = [{"id": 1, "name": "Phenikaa", "description": ""}, {"id": 2, "name": "phenikaa", "description": ""},
            {"id": 3, "name": "cẩm ly", "description": ""}, {"id": 4, "name": "ly", "description": ""},
            {"id": 5, "name": "trống", "description": ""}]

    def db(self):
        outer = self

        class _DB:
            def fetch_all(self, sql, params=()):
                if "FROM scanned_group_category_groups WHERE owner_username" in sql:
                    return outer.LINKS
                if "SELECT group_id, keyword FROM scanned_groups" in sql:
                    return outer.GROUPS
                if "FROM scanned_group_categories WHERE owner_username" in sql:
                    return outer.CATS
                return []

        return _DB()

    def test_saved_or_moved_folder_replaces_keyword_folder(self):
        with mock.patch.object(models, "db", self.db()):
            keys = models._group_category_keys("alice")
        self.assertEqual(keys["111"], {"đại học phenikaa"})  # đã chuyển → rời thư mục từ khóa "phenikaa"
        self.assertEqual(keys["333"], {"cẩm ly"})
        self.assertEqual(keys["222"], {"nam sách"})  # chưa lưu / chuyển → theo từ khóa quét
        self.assertNotIn("999", keys)

    def test_group_saved_to_several_folders_shows_in_each(self):
        self.LINKS = self.LINKS + [{"group_id": "333", "category_name": "ly"}]
        with mock.patch.object(models, "db", self.db()):
            self.assertEqual(models._group_category_keys("alice")["333"], {"cẩm ly", "ly"})

    def test_folder_counts_match_the_filter(self):
        with mock.patch.object(models, "db", self.db()):
            counts = {c["name"]: c["count"] for c in models.list_scan_categories("alice")}
        self.assertEqual(counts, {"Phenikaa": 0, "phenikaa": 0, "cẩm ly": 1, "ly": 0, "trống": 0})

    def test_group_list_joins_one_category_per_name(self):
        seen = []

        class _DB:
            def fetch_one(self, sql, params=()):
                return {"c": 0}

            def fetch_all(self, sql, params=()):
                seen.append((sql, params))
                return []

        with mock.patch.object(models, "db", _DB()):
            models.list_all_scanned_groups("alice", privacy="public")
        sql, params = seen[0]
        self.assertIn("GROUP BY lower(name)", sql)  # "Phenikaa" + "phenikaa" không nhân đôi dòng
        self.assertEqual(sql.count("?"), len(params))
