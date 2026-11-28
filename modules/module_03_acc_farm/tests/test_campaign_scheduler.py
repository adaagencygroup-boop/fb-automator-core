import random
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from modules.module_03_acc_farm import campaign_scheduler
from modules.module_03_acc_farm import campaign_repository as real_repo
from modules.module_03_acc_farm.compose_service import text_key

TZ = timezone(timedelta(hours=7))
T0 = datetime(2026, 11, 27, 9, 0, tzinfo=TZ)
MACHINE = "m1"


class FakeRunner:
    def __init__(self):
        self.busy, self.sid, self.starts, self.stops = False, None, [], 0
        self.paused, self.pauses, self.resumes = False, 0, 0

    def is_paused(self):
        return self.paused

    def pause_session(self):
        self.paused, self.pauses = True, self.pauses + 1

    def resume_session(self):
        self.paused, self.resumes = False, self.resumes + 1

    def is_busy(self):
        return self.busy

    def active_session_id(self):
        return self.sid

    def start_session_with_existing(self, **kw):
        self.starts.append(kw)
        self.sid, self.busy = kw["session_id"], True

    def stop_session(self):
        self.stops += 1
        self.busy = False


class FakeStore:
    """Thay campaign_repository + post_repository bằng dữ liệu trong bộ nhớ."""

    WAITING, RUNNING, DONE, MISSED, STOPPED, FAILED = (
        real_repo.WAITING, real_repo.RUNNING, real_repo.DONE, real_repo.MISSED, real_repo.STOPPED, real_repo.FAILED,
    )
    PAUSED_MID_RUN_MESSAGE = real_repo.PAUSED_MID_RUN_MESSAGE
    RESUMED_MID_RUN_MESSAGE = real_repo.RESUMED_MID_RUN_MESSAGE

    def __init__(self, campaign, run_times):
        self.campaign = campaign
        self.slots = [
            {"id": f"s{i}", "campaign_id": campaign["id"], "run_at": t, "status": "WAITING", "session_id": None,
             "message": None, "success_count": 0, "failed_count": 0, "total_count": 0}
            for i, t in enumerate(run_times)
        ]
        self.posts, self.usage, self.sessions = [], [], {}

    # ---- campaign_repository
    def get_campaign(self, cid, owner=None):
        return dict(self.campaign) if cid == self.campaign["id"] else None

    def recover_after_restart(self, machine, missed_before):
        failed = []
        for s in self.slots:
            if s["status"] == "RUNNING":
                s["status"] = "FAILED"
                failed.append({"id": s["id"], "session_id": s["session_id"]})
        missed = 0
        for s in self.slots:
            if s["status"] == "WAITING" and s["run_at"] < missed_before and self.campaign["status"] == "ACTIVE":
                s["status"], missed = "MISSED", missed + 1
        return failed, missed

    def mark_paused_slots_missed(self, now, machine_id=None, campaign_id=None):
        n = 0
        for s in self.slots:
            if s["status"] == "STOPPED" and not s["session_id"] and s["run_at"] < now:
                s.update(status="MISSED", message=real_repo.MISSED_WHILE_PAUSED_MESSAGE)
                n += 1
        return n

    def running_slots(self, machine):
        return [{**s, "campaign_status": self.campaign["status"]} for s in self.slots if s["status"] == "RUNNING"]

    def due_slots(self, machine, now):
        if self.campaign["status"] != "ACTIVE":
            return []
        return sorted((dict(s) for s in self.slots if s["status"] == "WAITING" and s["run_at"] <= now), key=lambda s: s["run_at"])

    def _slot(self, sid):
        return next(s for s in self.slots if s["id"] == sid)

    def set_slot_message(self, sid, msg):
        self._slot(sid)["message"] = msg

    def claim_slot(self, sid, session_id, total, message):
        s = self._slot(sid)
        if s["status"] != "WAITING":
            return False
        s.update(status="RUNNING", session_id=session_id, total_count=total, message=message)
        return True

    def finish_slot(self, sid, status, success, failed, message):
        self._slot(sid).update(status=status, success_count=success, failed_count=failed, message=message)

    def count_waiting_slots(self, cid):
        return sum(1 for s in self.slots if s["status"] == "WAITING")

    def slot_published_uids(self, sid):
        return {p["account_uid"] for p in self.posts if p["slot_id"] == sid and p["status"] == "PUBLISHED"}

    def session_post_counts(self, session_id):
        counts = {}
        for p in self.posts:
            if p["session_id"] == session_id:
                counts[p["status"]] = counts.get(p["status"], 0) + 1
        return counts

    def session_status(self, session_id):
        return self.sessions.get(session_id)

    def load_usage(self, cid):
        return [{"account_uid": u, "kind": k, "item_key": i} for (_, u, k, i) in self.usage]

    def delete_slot_usage(self, sid, uids):
        uids = set(uids)
        self.usage = [row for row in self.usage if not (row[0] == sid and row[1] in uids)]

    def add_usage(self, cid, sid, rows):
        self.usage.extend((sid, u, k, i) for u, k, i in rows)

    def complete_finished_campaigns(self, machine):
        if self.campaign["status"] == "ACTIVE" and not any(s["status"] in ("WAITING", "RUNNING") for s in self.slots):
            self.campaign["status"] = "COMPLETED"

    # ---- post_repository
    def create_post_session(self, kind):
        sid = f"sess{len(self.sessions) + 1}"
        self.sessions[sid] = "RUNNING"
        return sid

    def update_post_session(self, sid, status, finished=False):
        self.sessions[sid] = status

    def create_post(self, **kw):
        self.posts.append({**kw})
        return kw

    def primary_image_path(self, paths):
        return paths[0] if paths else None

    def stop_all_session_posts(self, sid):
        for p in self.posts:
            if p["session_id"] == sid and p["status"] in ("PENDING", "RUNNING"):
                p["status"] = "STOPPED"

    # ---- tiện cho test
    def finish_session(self, sid, statuses):
        """statuses: account_uid -> trạng thái cuối của bài trong phiên."""
        for p in self.posts:
            if p["session_id"] == sid:
                p["status"] = statuses.get(p["account_uid"], "PUBLISHED")
        self.sessions[sid] = "DONE"


def _campaign(n_accounts=3, n_posts=6, status="ACTIVE"):
    return {
        "id": "c1", "owner_key": "u", "machine_id": MACHINE, "name": "Test", "status": status,
        "accounts": [{"uid": f"a{i}", "name": f"Nick {i}"} for i in range(n_accounts)],
        "settings": {"thread_count": 2, "min_delay": 0, "max_delay": 0},
        "content_text": "\n---\n".join(f"Bài {i}" for i in range(n_posts)), "content_mode": "MULTI",
        "image_mode": "NONE", "image_paths": [], "min_images": 1, "max_images": 1,
    }


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        self.store = FakeStore(_campaign(), [T0, T0 + timedelta(hours=1)])
        self.runner = FakeRunner()
        self.now = {"t": T0 - timedelta(minutes=1)}
        for target in ("repo", "post_repository"):
            patcher = mock.patch.object(campaign_scheduler, target, self.store)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.sched = campaign_scheduler.CampaignScheduler(
            self.runner, lambda: MACHINE, clock=lambda: self.now["t"], file_exists=lambda p: True, rng=random.Random(3),
        )

    def _slot(self, i):
        return self.store.slots[i]

    def test_paused_slot_becomes_missed_only_after_its_time(self):
        # Tạm dừng chiến dịch trước cả 2 khung
        self.store.campaign["status"] = "STOPPED"
        for s in self.store.slots:
            s["status"] = "STOPPED"
        self.now["t"] = T0 + timedelta(minutes=10)  # qua giờ khung 1, chưa tới khung 2
        self.sched.tick()
        self.assertEqual(self._slot(0)["status"], "MISSED")
        self.assertIn("tạm dừng", self._slot(0)["message"])
        self.assertEqual(self._slot(1)["status"], "STOPPED")  # vẫn là tạm dừng, Chạy tiếp sẽ chạy đúng giờ
        self.assertIsNone(self.runner.sid)

    def test_slot_stopped_mid_run_stays_stopped(self):
        self.now["t"] = T0
        self.sched.tick()
        self._slot(0).update(status="STOPPED")  # đã có phiên → dừng giữa chừng, không phải bị lỡ
        self.now["t"] = T0 + timedelta(minutes=30)
        self.store.campaign["status"] = "STOPPED"
        self.sched.tick()
        self.assertEqual(self._slot(0)["status"], "STOPPED")

    def test_runs_due_slot_only_when_time_comes(self):
        self.sched.tick()
        self.assertEqual(self.runner.starts, [])
        self.now["t"] = T0 + timedelta(seconds=10)
        self.sched.tick()
        self.assertEqual(self._slot(0)["status"], "RUNNING")
        self.assertEqual(self.runner.starts[0]["account_count"], 3)
        self.assertEqual(self.runner.starts[0]["thread_count"], 2)
        self.assertTrue(all(p["campaign_id"] == "c1" and p["slot_id"] == "s0" for p in self.store.posts))
        self.assertEqual(len({p["content"] for p in self.store.posts}), 3)

    def test_queues_behind_other_session_then_runs_late(self):
        self.runner.busy, self.runner.sid = True, "post-now"
        self.now["t"] = T0 + timedelta(minutes=1)
        self.sched.tick()
        self.assertEqual(self._slot(0)["status"], "WAITING")
        self.assertEqual(self._slot(0)["message"], campaign_scheduler.QUEUED_MESSAGE)
        self.runner.busy = False
        self.now["t"] = T0 + timedelta(minutes=7)
        self.sched.tick()
        self.assertEqual(self._slot(0)["status"], "RUNNING")
        self.assertIn("trễ 7 phút", self._slot(0)["message"])

    def test_finalize_and_rerun_only_failed_accounts(self):
        self.now["t"] = T0
        self.sched.tick()
        sid = self.runner.sid
        self.store.finish_session(sid, {"a2": "FAILED"})
        self.runner.busy = False
        self.sched.tick()
        self.assertEqual((self._slot(0)["status"], self._slot(0)["success_count"], self._slot(0)["failed_count"]), ("DONE", 2, 1))

        # Chạy lại khung 1: chỉ a2, không nhận lại bài mà a2 đã từng được giao ở khung này cũng được (chưa đăng)
        self._slot(0)["status"] = "WAITING"
        self.sched.tick()
        rerun_posts = [p for p in self.store.posts if p["session_id"] == self.runner.sid]
        self.assertEqual([p["account_uid"] for p in rerun_posts], ["a2"])
        self.store.finish_session(self.runner.sid, {})
        self.runner.busy = False
        self.sched.tick()
        self.assertEqual((self._slot(0)["status"], self._slot(0)["success_count"]), ("DONE", 3))

    def test_never_repeats_post_for_same_account_across_slots(self):
        for when in (T0, T0 + timedelta(hours=1)):
            self.now["t"] = when
            self.sched.tick()
            self.store.finish_session(self.runner.sid, {})
            self.runner.busy = False
            self.sched.tick()
        seen = {}
        for p in self.store.posts:
            key = text_key(p["content"])
            self.assertNotIn(key, seen.setdefault(p["account_uid"], set()), "nick đăng lại bài cũ")
            seen[p["account_uid"]].add(key)
        self.assertEqual(self.store.campaign["status"], "COMPLETED")

    def test_all_failed_is_failed_and_stop_is_stopped(self):
        self.now["t"] = T0
        self.sched.tick()
        self.store.finish_session(self.runner.sid, {f"a{i}": "FAILED" for i in range(3)})
        self.runner.busy = False
        self.sched.tick()
        self.assertEqual(self._slot(0)["status"], "FAILED")

        self.now["t"] = T0 + timedelta(hours=1)
        self.sched.tick()
        # Người dùng dừng hẳn phiên (nút Dừng khẩn cấp) → khung "dừng giữa chừng"
        self.store.campaign["status"] = "STOPPED"
        self.store.sessions[self.runner.sid] = "STOPPED"
        self.runner.stop_session()
        self.sched.tick()
        self.assertEqual(self._slot(1)["status"], "STOPPED")
        self.assertTrue(all(p["status"] == "STOPPED" for p in self.store.posts if p["slot_id"] == "s1"))

    def test_pause_campaign_mid_run_pauses_then_resumes_same_session(self):
        self.now["t"] = T0
        self.sched.tick()
        sid = self.runner.sid
        self.store.campaign["status"] = "STOPPED"  # tạm dừng từ API / máy khác
        self.sched.tick()
        self.assertEqual((self.runner.pauses, self.runner.stops), (1, 0))  # chỉ pause, không huỷ bài
        self.assertEqual(self._slot(0)["status"], "RUNNING")
        self.assertEqual(self._slot(0)["message"], real_repo.PAUSED_MID_RUN_MESSAGE)
        self.sched.tick()
        self.assertEqual(self.runner.pauses, 1)  # không pause lặp

        self.store.campaign["status"] = "ACTIVE"  # chạy tiếp
        self.sched.tick()
        self.assertEqual(self.runner.resumes, 1)
        self.assertFalse(self.runner.paused)
        self.assertEqual(self.runner.sid, sid)  # cùng phiên, chạy tiếp từ chỗ dừng
        self.assertEqual(self._slot(0)["message"], real_repo.RESUMED_MID_RUN_MESSAGE)
        self.store.finish_session(sid, {f"a{i}": "PUBLISHED" for i in range(3)})
        self.runner.busy = False
        self.sched.tick()
        self.assertEqual(self._slot(0)["status"], "DONE")

    def test_recover_after_restart(self):
        self.now["t"] = T0
        self.sched.tick()
        running_session = self.runner.sid
        # Backend tắt; bật lại lúc 10:10 → khung 9:00 đang chạy dở = FAILED, khung 10:00 quá 5 phút = MISSED
        self.runner = FakeRunner()
        self.sched.runner = self.runner
        self.now["t"] = T0 + timedelta(hours=1, minutes=10)
        self.sched.recover()
        self.assertEqual([s["status"] for s in self.store.slots], ["FAILED", "MISSED"])
        self.assertEqual(self.store.sessions[running_session], "STOPPED")
        self.assertTrue(all(p["status"] == "STOPPED" for p in self.store.posts))

    def test_recover_keeps_slot_within_grace(self):
        self.now["t"] = T0 + timedelta(minutes=3)
        self.sched.recover()
        self.assertEqual(self._slot(0)["status"], "WAITING")
        self.sched.tick()
        self.assertEqual(self._slot(0)["status"], "RUNNING")

    def test_not_enough_posts_fails_slot(self):
        self.store.campaign["content_text"] = ""
        self.now["t"] = T0
        self.sched.tick()
        self.assertEqual(self._slot(0)["status"], "FAILED")
        self.assertEqual(self.runner.starts, [])

    def test_runner_error_stops_session_and_fails_slot(self):
        def boom(**kw):
            raise RuntimeError("runner hỏng")
        self.runner.start_session_with_existing = boom
        self.now["t"] = T0
        self.sched.tick()
        self.assertEqual(self._slot(0)["status"], "FAILED")
        self.assertIn("runner hỏng", self._slot(0)["message"])
        self.assertTrue(all(p["status"] == "STOPPED" for p in self.store.posts))
        self.assertEqual(self.store.sessions["sess1"], "STOPPED")


if __name__ == "__main__":
    unittest.main()
