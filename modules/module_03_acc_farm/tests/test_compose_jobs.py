import threading
import time
import unittest
from unittest import mock

from modules.module_03_acc_farm import compose_jobs


class FakeDraft:
    def __init__(self):
        self.lock = threading.Lock()
        self.posts, self.images, self.owners = [], [], []

    def append(self, post_type, posts, images=()):
        from modules.module_02_account_manager.context import owner_context
        with self.lock:
            self.posts.extend(posts)
            self.images.extend(images)
            self.owners.append(owner_context.get())
        return {}


def _wait(job, timeout=5.0):
    end = time.time() + timeout
    while job.active and time.time() < end:
        time.sleep(0.01)
    return job


class ComposeJobTests(unittest.TestCase):
    def setUp(self):
        compose_jobs._jobs.clear()
        self.draft = FakeDraft()
        patcher = mock.patch.object(compose_jobs.compose_repository, "append_to_compose_draft", self.draft.append)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _start(self, owner="u1", count=5, gen=None, img=None, with_images=False, keys=("k1", "k2")):
        gen = gen or (lambda prompt, key, fb, model: (f"bài {prompt[-40:]} {key}", "mèo"))
        img = img or (lambda kw, pk, used: f"{kw}.jpg")
        return compose_jobs.start_generate_job(
            owner, "status", prompt="viết bài", count=count, keys=list(keys), model="m",
            with_images=with_images, pixabay_key=None, generate_text=gen, fetch_image=img,
        )

    def test_appends_every_post_with_owner(self):
        job = _wait(self._start(count=6, with_images=True))
        self.assertEqual(job.status, compose_jobs.DONE)
        self.assertEqual((job.done, job.failed, job.images_added), (6, 0, 6))
        self.assertEqual(len(self.draft.posts), 6)
        self.assertEqual(len(self.draft.images), 6)
        self.assertEqual(set(self.draft.owners), {"u1"})

    def test_failures_and_missing_images(self):
        calls = {"n": 0}
        lock = threading.Lock()

        def gen(prompt, key, fb, model):
            with lock:
                calls["n"] += 1
                n = calls["n"]
            if n % 2 == 0:
                raise RuntimeError("429 quá tải")
            return (f"bài {n}", "kw")

        job = _wait(self._start(count=4, gen=gen, img=lambda *a: None, with_images=True))
        self.assertEqual(job.status, compose_jobs.DONE)
        # Mỗi bài đều được tìm ảnh ở luồng riêng (kể cả bài AI lỗi) → 4 bài không có ảnh
        self.assertEqual((job.done, job.failed, job.images_missing), (2, 2, 4))
        self.assertIn("429 quá tải", job.errors)

    def test_all_failed(self):
        def gen(*a):
            raise RuntimeError("hỏng")
        job = _wait(self._start(count=2, gen=gen))
        self.assertEqual(job.status, compose_jobs.FAILED)
        self.assertEqual(self.draft.posts, [])

    def test_one_active_job_per_owner(self):
        gate = threading.Event()

        def slow(*a):
            gate.wait(2)
            return ("x", None)

        job = self._start(count=2, gen=slow)
        with self.assertRaises(compose_jobs.JobConflict):
            self._start(count=1)
        other = self._start(owner="u2", count=1)  # người khác vẫn chạy được
        gate.set()
        _wait(job), _wait(other)
        self.assertEqual(compose_jobs.active_job("u1", "status"), None)
        self.assertEqual(compose_jobs.get_job(job.id, "u2"), None)  # không xem được job người khác

    def test_cancel_stops_remaining(self):
        gate = threading.Event()

        def slow(*a):
            gate.wait(2)
            return ("x", None)

        job = self._start(count=30, gen=slow, keys=("k1",))
        compose_jobs.cancel_job(job.id, "u1")
        gate.set()
        _wait(job)
        self.assertEqual(job.status, compose_jobs.CANCELLED)
        self.assertLessEqual(job.done, 1)

    def test_rotates_primary_key(self):
        used = []
        lock = threading.Lock()

        def gen(prompt, key, fb, model):
            with lock:
                used.append(key)
            self.assertNotIn(key, fb)
            return (prompt, None)

        _wait(self._start(count=4, gen=gen, keys=("a", "b")))
        self.assertEqual(sorted(used), ["a", "a", "b", "b"])


if __name__ == "__main__":
    unittest.main()
