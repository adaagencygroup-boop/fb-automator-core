import random
import unittest
from collections import Counter, defaultdict

from modules.module_03_acc_farm.compose_service import (
    CONTENT_MULTI,
    CONTENT_SINGLE,
    IMAGE_MULTI,
    IMAGE_NONE,
    IMAGE_SINGLE,
    MAX_POST_CHARS,
    allocate_round,
    parse_compose_text,
    text_key,
    validate_plan,
)


def _run_campaign(uids, posts, images, slots, *, image_mode=IMAGE_NONE, lo=1, hi=1, seed=0):
    """Mô phỏng chiến dịch: phân bài từng khung, ghi nhận usage như scheduler sẽ làm."""
    rng = random.Random(seed)
    used_texts, used_images = defaultdict(set), defaultdict(set)
    text_usage, image_usage = Counter(), Counter()
    rounds = []
    for done in range(slots):
        alloc = allocate_round(
            uids, posts, images,
            content_mode=CONTENT_MULTI, image_mode=image_mode, min_images=lo, max_images=hi,
            used_texts=used_texts, used_images=used_images,
            text_usage=text_usage, image_usage=image_usage, remaining_rounds=slots - done, rng=rng,
        )
        for a in alloc.assignments:
            used_texts[a.account_uid].add(a.text_key)
            text_usage[a.text_key] += 1
            for img in a.images:
                used_images[a.account_uid].add(img)
                image_usage[img] += 1
        rounds.append(alloc)
    return rounds


class ParseTests(unittest.TestCase):
    def test_split_keeps_paragraphs(self):
        text = "Chào buổi sáng!\n\nHôm nay trời đẹp.\n---\nBài 2\n  ---  \nBài 3"
        parsed = parse_compose_text(text, CONTENT_MULTI)
        self.assertEqual(parsed.posts, ["Chào buổi sáng!\n\nHôm nay trời đẹp.", "Bài 2", "Bài 3"])

    def test_inline_dashes_are_not_separators(self):
        parsed = parse_compose_text("giá 100k --- rẻ\n----\nabc", CONTENT_MULTI)
        self.assertEqual(parsed.posts, ["giá 100k --- rẻ\n----\nabc"])

    def test_drop_empty_and_merge_duplicates(self):
        text = "A\r\n---\r\n\r\n---\r\n  A  \r\n---\r\nB"
        parsed = parse_compose_text(text, CONTENT_MULTI)
        self.assertEqual(parsed.posts, ["A", "B"])
        self.assertEqual(parsed.empty_dropped, 1)
        self.assertEqual(parsed.duplicates_merged, 1)
        self.assertEqual(parsed.summary(), "Đã nhận 2 bài (bỏ 1 bài rỗng, gộp 1 bài trùng)")

    def test_empty_box(self):
        parsed = parse_compose_text("   \n ", CONTENT_MULTI)
        self.assertEqual(parsed.posts, [])
        self.assertEqual(parsed.empty_dropped, 0)

    def test_single_mode_does_not_split(self):
        parsed = parse_compose_text("A\n---\nB", CONTENT_SINGLE)
        self.assertEqual(parsed.posts, ["A\n---\nB"])

    def test_too_long(self):
        parsed = parse_compose_text("ok\n---\n" + "x" * (MAX_POST_CHARS + 1), CONTENT_MULTI)
        self.assertEqual(parsed.too_long, [2])


class ValidateTests(unittest.TestCase):
    def _check(self, posts=5, images=0, n=3, s=1, c=CONTENT_MULTI, i=IMAGE_NONE, lo=1, hi=1):
        parsed = parse_compose_text("\n---\n".join(f"bài {k}" for k in range(posts)), c)
        pool = [f"img{k}.jpg" for k in range(images)]
        return validate_plan(parsed, pool, account_count=n, slot_count=s,
                             content_mode=c, image_mode=i, min_images=lo, max_images=hi)

    def test_ok(self):
        check = self._check(posts=6, n=3, s=2)
        self.assertTrue(check.ok)
        self.assertEqual(check.warnings, [])

    def test_fewer_posts_than_accounts(self):
        self.assertFalse(self._check(posts=2, n=3).ok)

    def test_fewer_posts_than_slots(self):
        self.assertFalse(self._check(posts=3, n=3, s=4).ok)

    def test_reuse_warning(self):
        check = self._check(posts=4, n=3, s=3)
        self.assertTrue(check.ok)
        self.assertEqual(len(check.warnings), 1)

    def test_single_content_blocks_multi_slots(self):
        self.assertFalse(self._check(c=CONTENT_SINGLE, s=2).ok)
        self.assertTrue(self._check(c=CONTENT_SINGLE, s=1).ok)

    def test_single_image_blocks_multi_slots(self):
        self.assertFalse(self._check(posts=6, n=3, s=2, i=IMAGE_SINGLE, images=1).ok)
        self.assertTrue(self._check(posts=6, n=3, s=1, i=IMAGE_SINGLE, images=1).ok)
        self.assertFalse(self._check(i=IMAGE_SINGLE, images=0).ok)

    def test_multi_images(self):
        # 3 nick × tối đa 2 ảnh = 6 ảnh / lượt
        self.assertFalse(self._check(i=IMAGE_MULTI, images=5, hi=2).ok)
        self.assertTrue(self._check(i=IMAGE_MULTI, images=6, hi=2, posts=3).ok)
        # 4 khung × 2 ảnh = 8 ảnh cho mỗi nick
        self.assertFalse(self._check(posts=12, n=3, s=4, i=IMAGE_MULTI, images=7, hi=2).ok)
        warn = self._check(posts=12, n=3, s=4, i=IMAGE_MULTI, images=8, hi=2)
        self.assertTrue(warn.ok)
        self.assertEqual(len(warn.warnings), 1)

    def test_no_accounts_and_slot_limit(self):
        self.assertFalse(self._check(n=0).ok)
        self.assertFalse(self._check(posts=30, n=1, s=25).ok)


class AllocateTests(unittest.TestCase):
    def test_tight_campaign_never_reuses(self):
        """Kho vừa đủ (số bài = max(nick, khung)): mọi khung đều xếp đủ, không trùng."""
        cases = [(3, 5, 5), (5, 5, 5), (5, 7, 7), (8, 3, 8), (6, 6, 9), (4, 24, 24)]  # (nick, khung, bài)
        for n, s, p in cases:
            uids = [f"u{k}" for k in range(n)]
            posts = [f"bài {k}" for k in range(p)]
            for seed in range(60):
                rounds = _run_campaign(uids, posts, [], s, seed=seed)
                seen = defaultdict(set)
                for alloc in rounds:
                    self.assertEqual(alloc.skipped, {}, (n, s, p, seed))
                    keys = [a.text_key for a in alloc.assignments]
                    self.assertEqual(len(keys), len(set(keys)), "trùng bài trong cùng lượt")
                    for a in alloc.assignments:
                        self.assertNotIn(a.text_key, seen[a.account_uid], "nick đăng lại bài cũ")
                        seen[a.account_uid].add(a.text_key)

    def test_least_used_first(self):
        posts = ["a", "b", "c", "d"]
        usage = {text_key("a"): 3, text_key("b"): 3, text_key("c"): 0, text_key("d"): 0}
        alloc = allocate_round(["u1", "u2"], posts, [], content_mode=CONTENT_MULTI, image_mode=IMAGE_NONE,
                               text_usage=usage, rng=random.Random(1))
        self.assertEqual({a.content for a in alloc.assignments}, {"c", "d"})

    def test_skip_when_exhausted(self):
        used = {"u1": {text_key("a"), text_key("b")}}
        alloc = allocate_round(["u1", "u2"], ["a", "b"], [], content_mode=CONTENT_MULTI,
                               image_mode=IMAGE_NONE, used_texts=used)
        self.assertEqual([a.account_uid for a in alloc.assignments], ["u2"])
        self.assertIn("u1", alloc.skipped)

    def test_single_content_same_for_all(self):
        alloc = allocate_round(["u1", "u2", "u3"], ["chung"], [], content_mode=CONTENT_SINGLE,
                               image_mode=IMAGE_NONE)
        self.assertEqual({a.content for a in alloc.assignments}, {"chung"})
        self.assertEqual(len(alloc.assignments), 3)

    def test_single_image_shared(self):
        alloc = allocate_round(["u1", "u2"], ["a", "b"], ["x.jpg", "y.jpg"], content_mode=CONTENT_MULTI,
                               image_mode=IMAGE_SINGLE)
        self.assertEqual([a.images for a in alloc.assignments], [["x.jpg"], ["x.jpg"]])

    def test_multi_images_tight_campaign(self):
        """Kho ảnh vừa đủ = max(nick, khung) × số ảnh tối đa/bài."""
        for n, s, hi in [(4, 3, 2), (2, 5, 2), (3, 3, 3)]:
            self._tight_images(n, s, hi)

    def _tight_images(self, n, s, hi):
        uids = [f"u{k}" for k in range(n)]
        posts = [f"bài {k}" for k in range(n * s)]
        images = [f"{k}.jpg" for k in range(max(n, s) * hi)]
        for seed in range(60):
            rounds = _run_campaign(uids, posts, images, s, image_mode=IMAGE_MULTI, lo=1, hi=hi, seed=seed)
            seen = defaultdict(set)
            for alloc in rounds:
                self.assertEqual(alloc.skipped, {}, (n, s, hi, seed))
                in_round = [img for a in alloc.assignments for img in a.images]
                self.assertEqual(len(in_round), len(set(in_round)), "trùng ảnh trong cùng lượt")
                for a in alloc.assignments:
                    self.assertTrue(1 <= len(a.images) <= hi)
                    self.assertFalse(seen[a.account_uid] & set(a.images), "nick đăng lại ảnh cũ")
                    seen[a.account_uid].update(a.images)

    def test_images_below_minimum_skips_account(self):
        alloc = allocate_round(["u1", "u2"], ["a", "b"], ["1.jpg", "2.jpg", "3.jpg"], content_mode=CONTENT_MULTI,
                               image_mode=IMAGE_MULTI, min_images=2, max_images=2, rng=random.Random(0))
        self.assertEqual(len(alloc.assignments), 1)
        self.assertEqual(len(alloc.skipped), 1)

    def test_many_accounts_no_recursion_limit(self):
        n = 1500
        uids = [f"u{k}" for k in range(n)]
        posts = [f"bài {k}" for k in range(n)]
        images = [f"{k}.jpg" for k in range(n * 3)]
        alloc = allocate_round(uids, posts, images, content_mode=CONTENT_MULTI, image_mode=IMAGE_MULTI,
                               min_images=3, max_images=3, rng=random.Random(0))
        self.assertEqual(len(alloc.assignments), n)
        self.assertEqual(alloc.skipped, {})


if __name__ == "__main__":
    unittest.main()
