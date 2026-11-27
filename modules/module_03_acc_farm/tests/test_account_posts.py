"""Dạng soạn "Từng bài": mỗi nick 1 bài riêng cho mỗi lượt (Đăng ngay / từng khung giờ của chiến dịch)."""
import random
import threading
import time
import unittest
from datetime import timedelta
from unittest import mock

from modules.module_03_acc_farm import campaign_scheduler, campaign_service, compose_jobs, post_now_service
from modules.module_03_acc_farm.compose_service import (
    LAYOUT_ACCOUNTS,
    allocate_account_round,
    normalize_account_posts,
    validate_account_posts,
)
from modules.module_03_acc_farm.post_now_service import ComposeInput, PostNowError, start_status_post_now
from modules.module_03_acc_farm.tests.test_campaign_scheduler import MACHINE, T0, FakeRunner, FakeStore, _campaign
from modules.module_03_acc_farm.tests.test_post_now_service import FakeRepo
from modules.module_03_acc_farm.tests.test_post_now_service import FakeRunner as NowRunner

ACCS = [{"uid": "a", "name": "An"}, {"uid": "b", "name": "Bình"}]


def _entry(content, images=()):
    return {"content": content, "images": list(images)}


class AccountPostsServiceTests(unittest.TestCase):
    def test_normalize(self):
        raw = {"a": ["bài 1", {"content": "bài 2", "images": ["x.jpg", "x.jpg", ""]}], "": ["bỏ"], "b": "một bài"}
        self.assertEqual(
            normalize_account_posts(raw),
            {"a": [_entry("bài 1"), _entry("bài 2", ["x.jpg"])], "b": [_entry("một bài")]},
        )
        self.assertEqual(normalize_account_posts(None), {})

    def test_validate_missing_and_repeat(self):
        posts = {"a": [_entry("A1"), _entry("A1")], "b": [_entry("B1")]}
        check = validate_account_posts(posts, ACCS, 2)
        self.assertFalse(check.ok)
        text = " ".join(check.errors)
        self.assertIn("Bình (khung 2)", text)
        self.assertIn("An (khung 2)", text)  # An lặp lại cùng nội dung ở khung 2
        self.assertTrue(validate_account_posts({"a": [_entry("A")], "b": [_entry("B")]}, ACCS, 1).ok)

    def test_allocate_uses_exact_post_per_account(self):
        alloc = allocate_account_round(["a", "b", "c"], {"a": _entry(" A ", ["1.jpg"]), "b": _entry("B")})
        self.assertEqual([(x.account_uid, x.content, x.images) for x in alloc.assignments],
                         [("a", "A", ["1.jpg"]), ("b", "B", [])])
        self.assertIn("c", alloc.skipped)


class AccountPostNowTests(unittest.TestCase):
    def setUp(self):
        self.repo = FakeRepo()
        patcher = mock.patch.object(post_now_service, "post_repository", self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _compose(self, posts):
        return ComposeInput(layout=LAYOUT_ACCOUNTS, account_posts=posts, content_text="bị bỏ qua\n---\nkhác")

    def test_each_account_posts_its_own_content(self):
        runner = NowRunner()
        res = start_status_post_now(
            runner, ACCS, self._compose({"a": [_entry("Bài của An", ["an.jpg"])], "b": [_entry("Bài của Bình")]}),
            file_exists=lambda p: True,
        )
        self.assertEqual(res["inserted_count"], 2)
        got = {p["account_uid"]: (p["content"], p["image_paths"]) for p in self.repo.posts}
        self.assertEqual(got, {"a": ("Bài của An", ["an.jpg"]), "b": ("Bài của Bình", [])})
        self.assertEqual(runner.started["account_count"], 2)

    def test_blocks_when_an_account_has_no_post(self):
        with self.assertRaises(PostNowError) as ctx:
            start_status_post_now(NowRunner(), ACCS, self._compose({"a": [_entry("A")]}), file_exists=lambda p: True)
        self.assertIn("Bình", ctx.exception.message)
        self.assertEqual(self.repo.posts, [])

    def test_blocks_missing_image_file(self):
        with self.assertRaises(PostNowError) as ctx:
            start_status_post_now(
                NowRunner(), ACCS, self._compose({"a": [_entry("A", ["mat.jpg"])], "b": [_entry("B")]}),
                file_exists=lambda p: False,
            )
        self.assertIn("mat.jpg", ctx.exception.message)


class AccountCampaignCheckTests(unittest.TestCase):
    def test_check_keeps_only_selected_accounts_and_slots(self):
        compose = ComposeInput(
            layout=LAYOUT_ACCOUNTS,
            account_posts={"a": [_entry("A1"), _entry("A2"), _entry("A3")], "b": [_entry("B1"), _entry("B2")], "z": [_entry("Z")]},
        )
        normalized, check = campaign_service.check_compose(compose, 2, 2, file_exists=lambda p: True, accounts=ACCS)
        self.assertTrue(check.ok, check.errors)
        self.assertEqual(set(normalized["account_posts"]), {"a", "b"})
        self.assertEqual([e["content"] for e in normalized["account_posts"]["a"]], ["A1", "A2"])
        self.assertEqual(normalized["parsed"]["count"], 4)


class SlotStore(FakeStore):
    """FakeStore + bài từng nick lưu theo khung."""

    def __init__(self, *a, slot_posts=None, **kw):
        super().__init__(*a, **kw)
        self.slot_posts = slot_posts or {}

    def slot_account_posts(self, sid):
        return {uid: dict(e) for uid, e in self.slot_posts.get(sid, {}).items()}


class AccountSchedulerTests(unittest.TestCase):
    def setUp(self):
        campaign = {**_campaign(n_accounts=2, n_posts=0), "layout": LAYOUT_ACCOUNTS}
        self.store = SlotStore(
            campaign, [T0, T0 + timedelta(hours=1)],
            slot_posts={
                "s0": {"a0": _entry("a0 lúc 9h", ["a0.jpg", "mat.jpg"]), "a1": _entry("a1 lúc 9h")},
                "s1": {"a0": _entry("a0 lúc 10h")},
            },
        )
        self.runner = FakeRunner()
        self.now = {"t": T0}
        for target in ("repo", "post_repository"):
            patcher = mock.patch.object(campaign_scheduler, target, self.store)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.sched = campaign_scheduler.CampaignScheduler(
            self.runner, lambda: MACHINE, clock=lambda: self.now["t"],
            file_exists=lambda p: p != "mat.jpg", rng=random.Random(1),
        )

    def test_slot_posts_exact_content_per_account(self):
        self.sched.tick()
        got = {p["account_uid"]: (p["content"], p["image_paths"]) for p in self.store.posts}
        self.assertEqual(got, {"a0": ("a0 lúc 9h", ["a0.jpg"]), "a1": ("a1 lúc 9h", [])})
        self.assertIn("1 ảnh không còn trên máy", self.store.slots[0]["message"])

    def test_account_without_post_in_slot_is_skipped(self):
        self.sched.tick()  # khung 9h chạy xong rồi sang 10h
        self.store.finish_session(self.runner.sid, {})
        self.runner.busy = False
        self.now["t"] = T0 + timedelta(hours=1)
        self.sched.tick()
        self.sched.tick()
        s1_posts = [p for p in self.store.posts if p["slot_id"] == "s1"]
        self.assertEqual([(p["account_uid"], p["content"]) for p in s1_posts], [("a0", "a0 lúc 10h")])
        self.assertIn("1 nick bị bỏ qua", self.store.slots[1]["message"])


class FakeAccountDraft:
    def __init__(self):
        self.lock = threading.Lock()
        self.fills, self.attached, self.events = [], [], []

    def fill(self, post_type, fills, overwrite=False, reset_images=False):
        with self.lock:
            for uid, idx, content, images in fills:
                self.fills.append((uid, idx, content, list(images), overwrite, reset_images))
                self.events.append(("text", uid, idx))
        return {}

    def attach(self, post_type, uid, index, images):
        with self.lock:
            self.attached.append((uid, index, list(images)))
            self.events.append(("image", uid, index))
        return True


def _wait_job(job, timeout=5.0):
    end = time.time() + timeout
    while job.active and time.time() < end:
        time.sleep(0.01)
    return job


class AccountGenerateJobTests(unittest.TestCase):
    def setUp(self):
        compose_jobs._jobs.clear()
        self.draft = FakeAccountDraft()
        for name, fn in (("fill_account_posts", self.draft.fill), ("attach_account_post_images", self.draft.attach)):
            patcher = mock.patch.object(compose_jobs.compose_repository, name, fn)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _start(self, targets, gen, img, **kw):
        return compose_jobs.start_generate_job(
            "u", "status", prompt="p", count=99, keys=["k1", "k2", "k3"], model="m", with_images=True,
            pixabay_key="pk", generate_text=gen, fetch_image=img, targets=targets, **kw,
        )

    def test_fills_each_target_once_then_attaches_image(self):
        job = _wait_job(self._start(
            [("a", 0), ("b", 0), ("a", 1), ("a", 0)],
            gen=lambda prompt, key, fb, model: (f"bài {prompt[-20:]}", "kw"),
            img=lambda kw, pk, keys: f"{kw}.jpg",
            overwrite=True,
        ))
        self.assertEqual(job.total, 3)
        self.assertEqual(job.status, compose_jobs.DONE)
        self.assertEqual(sorted((u, i) for u, i, *_ in self.draft.fills), [("a", 0), ("a", 1), ("b", 0)])
        # Tạo lại có cào ảnh: bỏ ảnh cũ, bài lưu trước rồi ảnh gắn sau
        self.assertTrue(all(images == [] and ow and reset for *_, images, ow, reset in self.draft.fills))
        self.assertEqual(sorted(self.draft.attached), [("a", 0, ["kw.jpg"]), ("a", 1, ["kw.jpg"]), ("b", 0, ["kw.jpg"])])
        self.assertEqual((job.images_added, job.images_missing, job.images_pending), (3, 0, 0))

    def test_no_keyword_searches_by_content(self):
        seen = []

        def img(kw, pk, keys):
            seen.append(kw)
            return "x.jpg"

        _wait_job(self._start([("a", 0)], gen=lambda *a: ("Cà phê sáng   ở Đà Lạt", None), img=img))
        self.assertEqual(seen, ["Cà phê sáng ở Đà Lạt"])

    def test_writing_continues_while_images_download(self):
        release = threading.Event()

        def slow_img(kw, pk, keys):
            release.wait(2)
            return "slow.jpg"

        job = self._start([(f"n{i}", 0) for i in range(6)], gen=lambda *a: ("bài", "kw"), img=slow_img)
        end = time.time() + 2
        while len(self.draft.fills) < 6 and time.time() < end:
            time.sleep(0.01)
        # Cả 6 bài đã lưu dù chưa ảnh nào tải xong
        self.assertEqual(len(self.draft.fills), 6)
        self.assertEqual(self.draft.attached, [])
        self.assertTrue(job.active)
        release.set()
        _wait_job(job)
        self.assertEqual(job.images_added, 6)
        self.assertIn("Cào được 6 ảnh", job.message)

    def test_image_timeout_keeps_post(self):
        with mock.patch.object(compose_jobs, "IMAGE_TIMEOUT_SECONDS", 0.2):
            job = _wait_job(self._start([("a", 0)], gen=lambda *a: ("bài", "kw"), img=lambda *a: time.sleep(0.6) or "late.jpg"))
        self.assertEqual((job.done, job.images_added, job.images_missing), (1, 0, 1))
        time.sleep(0.6)
        self.assertEqual(self.draft.attached, [])  # ảnh về muộn không gắn

    def test_empty_targets_rejected(self):
        with self.assertRaises(ValueError):
            compose_jobs.start_generate_job(
                "u", "status", prompt="p", count=1, keys=["k"], model="m", with_images=False, pixabay_key=None,
                generate_text=lambda *a: ("x", None), fetch_image=lambda *a: None, targets=[],
            )


if __name__ == "__main__":
    unittest.main()
