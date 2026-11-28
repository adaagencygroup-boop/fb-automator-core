"""Dạng soạn "Từng bài": mỗi nick 1 bài riêng cho mỗi lượt (Đăng ngay / từng khung giờ của chiến dịch)."""
import json
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
            img=lambda kw, pk, used: f"{kw}.jpg",
            make_keywords=lambda prompt, n, keys, model: ["kw"],
            overwrite=True,
        ))
        self.assertEqual(job.total, 3)
        self.assertEqual(job.status, compose_jobs.DONE)
        self.assertEqual(sorted((u, i) for u, i, *_ in self.draft.fills), [("a", 0), ("a", 1), ("b", 0)])
        # Tạo lại có cào ảnh: bỏ ảnh cũ, bài lưu trước rồi ảnh gắn sau
        self.assertTrue(all(images == [] and ow and reset for *_, images, ow, reset in self.draft.fills))
        self.assertEqual(sorted(self.draft.attached), [("a", 0, ["kw.jpg"]), ("a", 1, ["kw.jpg"]), ("b", 0, ["kw.jpg"])])
        self.assertEqual((job.images_added, job.images_missing, job.images_pending), (3, 0, 0))

    def test_keywords_made_once_and_images_fetched_before_text(self):
        kw_calls, seen = [], []
        lock = threading.Lock()
        gate = threading.Event()

        def make_keywords(prompt, n, keys, model):
            kw_calls.append((prompt, n))
            return ["cafe", "tea"]

        def img(kw, pk, used):
            with lock:
                seen.append(kw)
            return f"{kw}-{len(seen)}.jpg"

        def gen(*a):
            gate.wait(2)  # AI viết chậm: ảnh đã tải xong trước khi bài được lưu
            return ("bài", None)

        targets = [("a", 0), ("b", 0), ("c", 0)]
        job = self._start(targets, gen=gen, img=img, make_keywords=make_keywords)
        end = time.time() + 2
        while len(seen) < 3 and time.time() < end:
            time.sleep(0.01)
        self.assertEqual(sorted(seen), ["cafe", "cafe", "tea"])  # từ khoá xoay vòng theo bài
        self.assertEqual(self.draft.attached, [])  # bài chưa lưu → ảnh nằm chờ
        gate.set()
        _wait_job(job)
        self.assertEqual(kw_calls, [("p", 3)])
        self.assertEqual(job.images_added, 3)
        self.assertEqual(sorted(u for u, *_ in self.draft.attached), ["a", "b", "c"])
        for uid, _ in targets:  # ảnh luôn gắn sau khi bài đã lưu
            ev = [e for e in self.draft.events if e[1] == uid]
            self.assertEqual([e[0] for e in ev], ["text", "image"])

    def test_keyword_maker_error_falls_back_to_prompt(self):
        seen = []

        def boom(*a):
            raise RuntimeError("429")

        job = _wait_job(self._start(
            [("a", 0)], gen=lambda *a: ("bài", None), img=lambda kw, pk, used: seen.append(kw) or "x.jpg",
            make_keywords=boom,
        ))
        self.assertEqual(seen, ["p"])
        self.assertEqual(job.images_added, 1)

    def test_image_for_failed_post_is_dropped(self):
        def gen(prompt, *a):
            if "1/2" in prompt:
                raise RuntimeError("hỏng")
            return ("bài", None)

        job = _wait_job(self._start([("a", 0), ("b", 0)], gen=gen, img=lambda *a: "x.jpg"))
        self.assertEqual((job.done, job.failed, job.images_added, job.images_missing), (1, 1, 1, 1))
        self.assertEqual([u for u, *_ in self.draft.attached], ["b"])

    def test_writing_continues_while_images_download(self):
        release = threading.Event()

        def slow_img(kw, pk, used):
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
        self.assertIn("Lấy được 6 ảnh", job.message)

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


class _Resp:
    def __init__(self, status=200, data=None, content=b""):
        self.status_code, self._data, self.content = status, data, content

    def json(self):
        return self._data


class PixabayBatchTests(unittest.TestCase):
    """Cào nhiều ảnh khác nhau trong 1 lần (kho ảnh chung: số nick × số khung giờ)."""

    def _run(self, hits, count, exclude=None, broken=()):
        from modules.module_03_acc_farm import content_service

        def fake_get(url, **kw):
            if "pixabay.com/api" in url:
                return _Resp(data={"hits": hits})
            return _Resp(content=url.encode())

        def fake_save(content, save_dir):
            name = content.decode()
            return None if name in broken else f"{name}.jpg"

        with mock.patch("requests.get", fake_get), mock.patch.object(content_service, "save_optimized_image", fake_save):
            return content_service.search_and_download_pixabay_images("cafe", "pk", "d", count, exclude_ids=exclude)

    def test_downloads_distinct_images_up_to_count(self):
        hits = [{"id": i, "largeImageURL": f"img{i}"} for i in range(10)]
        seen = set()
        got = self._run(hits, 4, exclude=seen)
        self.assertEqual(len(got), 4)
        self.assertEqual(len(set(got)), 4)
        self.assertEqual(len(seen), 4)
        # Lần sau bỏ các ảnh đã tải
        again = self._run(hits, 10, exclude=seen)
        self.assertEqual(len(again), 6)
        self.assertFalse(set(again) & set(got))

    def test_broken_download_is_replaced_by_next_hit(self):
        hits = [{"id": i, "largeImageURL": f"img{i}"} for i in range(5)]
        got = self._run(hits, 3, broken={"img0", "img1"})
        self.assertEqual(len(got), 3)
        self.assertNotIn("img0.jpg", got)


if __name__ == "__main__":
    unittest.main()


class _UrlResp:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _gemini(text):
    return _UrlResp({"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}]})


def _http_error(code):
    import urllib.error
    return urllib.error.HTTPError("u", code, "err", {}, None)


class GeminiFlowTests(unittest.TestCase):
    """Luồng chữ / luồng từ khoá ảnh gọi Gemini."""

    def test_image_keywords_parsed_from_json(self):
        from modules.module_03_acc_farm import content_service
        reply = 'Here:\n["Coffee cup morning", "cafe interior!", "coffee cup morning", "Đà Lạt"]'
        with mock.patch("urllib.request.urlopen", return_value=_gemini(reply)):
            got = content_service.generate_image_keywords("viết về cà phê", 5, ["k1"], "m")
        self.assertEqual(got[:2], ["coffee cup morning", "cafe interior"])
        self.assertEqual(len(got), len(set(got)))

    def test_text_switches_key_on_429_without_trying_other_models(self):
        from modules.module_03_acc_farm import content_service
        calls = []

        def fake_urlopen(req, timeout=None):
            calls.append(req.full_url)
            if "key=bad" in req.full_url:
                raise _http_error(429)
            return _gemini("Bài viết hoàn chỉnh về buổi sáng cà phê thật chill nhé mọi người ☕ #cafe")

        with mock.patch("urllib.request.urlopen", fake_urlopen):
            text, _ = content_service.generate_status_content("p", api_key="bad", fallback_keys=["good"], model="m")
        self.assertIn("cà phê", text)
        self.assertEqual(sum("key=bad" in u for u in calls), 1)  # 429 → bỏ key luôn

    def test_pixabay_only_fetch_broadens_keyword(self):
        from modules.module_03_acc_farm import content_service
        queries = []

        def fake_search(q, pk, save_dir, count, exclude_ids=None):
            queries.append(q)
            return ["x.jpg"] if q == "coffee" else []

        with mock.patch.object(content_service, "search_and_download_pixabay_images", fake_search), \
                mock.patch("urllib.request.urlopen", side_effect=AssertionError("không được gọi Gemini")):
            got = content_service.fetch_pixabay_image("coffee cup sunrise", "pk", "d", set())
        self.assertEqual(got, "x.jpg")
        self.assertEqual(queries, ["coffee cup sunrise", "coffee cup", "coffee"])
        self.assertIsNone(content_service.fetch_pixabay_image("coffee", None))


class GeminiSingleKeyTests(unittest.TestCase):
    """Chỉ có 1 key: 429 ở 1 model vẫn phải thử model khác (hạn mức tính theo từng model)."""

    def test_last_key_429_tries_other_models(self):
        from modules.module_03_acc_farm import content_service
        calls = []

        def fake_urlopen(req, timeout=None):
            calls.append(req.full_url)
            if "gemini-flash-latest" in req.full_url:
                return _gemini("Bài viết hoàn chỉnh cho buổi sáng thật vui vẻ cùng mọi người nhé ☀️ #morning")
            raise _http_error(429)

        with mock.patch("urllib.request.urlopen", fake_urlopen):
            text, _ = content_service.generate_status_content("p", api_key="only", model="gemini-3.8-flash")
        self.assertIn("buổi sáng", text)
        self.assertGreaterEqual(len(calls), 2)

    def test_retries_once_after_overload(self):
        from modules.module_03_acc_farm import content_service
        state = {"n": 0, "round2": False}

        def fake_urlopen(req, timeout=None):
            if state["round2"]:
                return _gemini("Bài viết hoàn chỉnh sau khi Gemini hết quá tải, chúc mọi người ngày mới vui 🌿 #ok")
            raise _http_error(503)

        def fake_sleep(s):
            state["round2"] = True

        with mock.patch("urllib.request.urlopen", fake_urlopen), \
                mock.patch.object(content_service.time, "sleep", fake_sleep):
            text, _ = content_service.generate_status_content("p", api_key="only", model="m")
        self.assertIn("hết quá tải", text)

    def test_keyword_fallback_is_never_unaccented_vietnamese(self):
        from modules.module_03_acc_farm import content_service
        with mock.patch("urllib.request.urlopen", side_effect=_http_error(429)):
            got = content_service.generate_image_keywords("đời buồn quá", 3, ["only"], "m")
        self.assertEqual(got, ["lifestyle daily life"])
