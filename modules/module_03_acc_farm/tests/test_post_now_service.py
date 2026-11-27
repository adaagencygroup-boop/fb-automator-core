import random
import unittest
from datetime import datetime, timezone
from unittest import mock

from modules.module_03_acc_farm import post_now_service
from modules.module_03_acc_farm.post_now_service import ComposeInput, PostNowError, start_status_post_now


class FakeRunner:
    def __init__(self, busy=False, session_id=None, remaining=None, fail=False):
        self.busy, self.sid, self.remaining, self.fail = busy, session_id, remaining, fail
        self.started = None

    def is_busy(self):
        return self.busy

    def active_session_id(self):
        return self.sid

    def estimate_remaining_seconds(self):
        return self.remaining

    def start_session_with_existing(self, **kwargs):
        if self.fail:
            raise RuntimeError("runner hỏng")
        self.started = kwargs


class FakeRepo:
    def __init__(self):
        self.posts, self.sessions, self.stopped = [], [], []

    def create_post_session(self, kind):
        self.sessions.append(kind)
        return "sess-1"

    def create_post(self, **kw):
        self.posts.append(kw)
        return kw

    def primary_image_path(self, paths):
        return paths[0] if paths else None

    def stop_all_session_posts(self, sid):
        self.stopped.append(sid)

    def update_post_session(self, sid, status, finished=False):
        self.stopped.append(status)


ACCOUNTS = [{"uid": "u1", "name": "An"}, {"uid": "u2", "name": "Bình"}, {"uid": "u1", "name": "trùng"}]


class PostNowTests(unittest.TestCase):
    def setUp(self):
        self.repo = FakeRepo()
        patcher = mock.patch.object(post_now_service, "post_repository", self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _run(self, compose, runner=None, accounts=ACCOUNTS, exists=lambda p: True):
        runner = runner or FakeRunner()
        res = start_status_post_now(runner, accounts, compose, thread_count=2, min_delay=0, max_delay=5,
                                    rng=random.Random(0), file_exists=exists)
        return res, runner

    def test_each_account_gets_distinct_post_and_images(self):
        compose = ComposeInput(content_text="A\n---\nB\n---\nC", image_mode="MULTI",
                               image_paths=["1.jpg", "2.jpg", "3.jpg", "4.jpg"], min_images=1, max_images=2)
        res, runner = self._run(compose)
        self.assertEqual(res["inserted_count"], 2)  # nick trùng uid bị gộp
        self.assertEqual(len({p["content"] for p in self.repo.posts}), 2)
        imgs = [i for p in self.repo.posts for i in p["image_paths"]]
        self.assertEqual(len(imgs), len(set(imgs)))
        self.assertTrue(all(p["status"] == "PENDING" and p["session_id"] == "sess-1" for p in self.repo.posts))
        self.assertEqual(runner.started["account_count"], 2)
        self.assertEqual(runner.started["min_delay"], 0)
        self.assertEqual([a["uid"] for a in runner.started["accounts"]], sorted(p["account_uid"] for p in self.repo.posts))

    def test_single_content_and_no_images(self):
        res, _ = self._run(ComposeInput(content_text="Chung\n---\nvẫn 1 bài", content_mode="SINGLE"))
        self.assertEqual({p["content"] for p in self.repo.posts}, {"Chung\n---\nvẫn 1 bài"})
        self.assertTrue(all(p["image_paths"] == [] for p in self.repo.posts))

    def test_not_enough_posts_blocks_before_creating_session(self):
        with self.assertRaises(PostNowError) as ctx:
            self._run(ComposeInput(content_text="chỉ 1 bài"))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(self.repo.sessions, [])

    def test_missing_image_file(self):
        compose = ComposeInput(content_text="A\n---\nB", image_mode="SINGLE", image_paths=["C:/mất.jpg"])
        with self.assertRaises(PostNowError) as ctx:
            self._run(compose, exists=lambda p: False)
        self.assertIn("mất.jpg", ctx.exception.message)

    def test_busy_with_campaign_slot(self):
        runner = FakeRunner(busy=True, session_id="s9", remaining=600)
        slot = {"campaign_name": "Nuôi nick sáng", "run_at": datetime(2026, 11, 27, 2, 0, tzinfo=timezone.utc)}
        with mock.patch.object(post_now_service, "_campaign_slot_for_session", return_value=slot):
            with self.assertRaises(PostNowError) as ctx:
                self._run(ComposeInput(content_text="A\n---\nB"), runner=runner)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("Nuôi nick sáng", ctx.exception.message)
        self.assertIn("dự kiến xong", ctx.exception.message)
        self.assertEqual(self.repo.sessions, [])

    def test_busy_plain_session(self):
        runner = FakeRunner(busy=True, session_id="s9", remaining=None)
        with mock.patch.object(post_now_service, "_campaign_slot_for_session", return_value=None):
            with self.assertRaises(PostNowError) as ctx:
                self._run(ComposeInput(content_text="A\n---\nB"), runner=runner)
        self.assertIn("phiên đăng bài khác", ctx.exception.message)

    def test_runner_failure_stops_session(self):
        with self.assertRaises(RuntimeError):
            self._run(ComposeInput(content_text="A\n---\nB"), runner=FakeRunner(fail=True))
        self.assertEqual(self.repo.stopped, ["sess-1", "STOPPED"])


if __name__ == "__main__":
    unittest.main()
