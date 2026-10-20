"""Tạo chiến dịch: chia lượt cảm xúc / bình luận / chia sẻ, kiểm tra đầu vào, thời gian nghỉ, nick đã làm từ trước."""
from collections import Counter

from .helpers import SeedingComment, SeedingTask, SeedingTestCase


def posts(n, prefix="P"):
    return [f"https://web.facebook.com/share/p/{prefix}{i:04d}xx" for i in range(n)]


class AllocationTests(SeedingTestCase):
    def test_50_accounts_4_posts(self):
        self.add_accounts(50)
        res = self.create("POST", posts(4), actions=["REACT", "COMMENT", "SHARE"], reactions=["LIKE", "LOVE"],
                          comments=["A", "B", "C"], account_count=50)
        share_by_uid, share_sizes = Counter(), []
        for cid in res["campaign_ids"]:
            reacts, comments, shares = (self.tasks(cid, a) for a in ("REACT", "COMMENT", "SHARE"))
            self.assertEqual(len(reacts), 50)
            self.assertEqual(len(comments), 25)
            self.assertEqual(len({t.account_uid for t in comments}), 25)
            self.assertTrue(all(t.comment_id for t in comments))
            share_sizes.append(len(shares))
            share_by_uid.update(t.account_uid for t in shares)
        self.assertEqual(sum(share_sizes), 50)
        self.assertTrue(all(10 <= s <= 15 for s in share_sizes), share_sizes)
        self.assertEqual(max(share_by_uid.values()), 1)

    def test_fewer_accounts_than_posts_every_post_still_gets_a_share_without_mass_sharing(self):
        # 2 nick, 5 bài: mỗi bài phải có ít nhất 1 lượt chia sẻ, nhưng không được cho cả 2 nick cùng share 1 bài
        # (tổng lượt share chỉ nên là max(số nick, số bài) = 5).
        self.add_accounts(2)
        res = self.create("POST", posts(5), actions=["SHARE"], account_count=2)
        sizes = [len(self.tasks(cid, "SHARE")) for cid in res["campaign_ids"]]
        self.assertTrue(all(s >= 1 for s in sizes), sizes)
        self.assertEqual(sum(sizes), 5, sizes)

    def test_as_many_accounts_as_posts_every_post_gets_a_share(self):
        self.add_accounts(4)
        for _ in range(20):   # chia ngẫu nhiên -> lặp nhiều lần
            res = self.create("POST", posts(4, prefix="Q"), actions=["SHARE"], account_count=4)
            sizes = [len(self.tasks(cid, "SHARE")) for cid in res["campaign_ids"]]
            self.assertTrue(all(s >= 1 for s in sizes), sizes)
            self.assertEqual(sum(sizes), 4, sizes)

    def test_only_used_comments_are_saved(self):
        self.add_accounts(3)
        res = self.create("POST", posts(1), actions=["COMMENT"], comments=["A", "B", "C", "D", "E"], account_count=3)
        cid = res["campaign_ids"][0]
        used = {t.comment.content for t in self.tasks(cid, "COMMENT")}
        saved = {c.content for c in self.db.query(SeedingComment).filter(SeedingComment.campaign_id == cid)}
        self.assertEqual(saved, used)

    def test_page_campaign_has_only_follow_tasks(self):
        self.add_accounts(3)
        res = self.create("PAGE", ["https://web.facebook.com/PageA"], actions=["FOLLOW"], account_count=3,
                          comments=["không dùng"])
        cid = res["campaign_ids"][0]
        self.assertEqual({t.action for t in self.tasks(cid)}, {"FOLLOW"})
        self.assertEqual(self.db.query(SeedingComment).count(), 0)


class InputValidationTests(SeedingTestCase):
    def setUp(self):
        super().setUp()
        self.add_accounts(2)

    def test_react_needs_a_reaction(self):
        self.create("POST", posts(1), actions=["REACT"], reactions=[], expect=400)

    def test_comment_needs_a_comment(self):
        self.create("POST", posts(1), actions=["COMMENT"], comments=["   "], expect=400)

    def test_no_targets(self):
        self.create("POST", [], actions=["REACT"], reactions=["LIKE"], expect=400)

    def test_delay_from_the_form_is_saved(self):
        res = self.create("PAGE", ["https://web.facebook.com/PageA"], delay_seconds_min=10, delay_seconds_max=20)
        camp = self.campaign(res["campaign_ids"][0])
        self.assertEqual((camp.delay_seconds_min, camp.delay_seconds_max), (10, 20))

    def test_delay_entered_backwards_or_negative_is_fixed(self):
        # Nhập 20 - 10 (ngược) hoặc số âm: lúc chạy random.randint(20, 10) sẽ lỗi và dừng luồng của nick.
        res = self.create("PAGE", ["https://web.facebook.com/PageA"], delay_seconds_min=20, delay_seconds_max=10)
        camp = self.campaign(res["campaign_ids"][0])
        self.assertEqual((camp.delay_seconds_min, camp.delay_seconds_max), (10, 20))
        res = self.create("PAGE", ["https://web.facebook.com/PageB"], delay_seconds_min=-5, delay_seconds_max=3)
        camp = self.campaign(res["campaign_ids"][0])
        self.assertEqual((camp.delay_seconds_min, camp.delay_seconds_max), (0, 3))


class AlreadyDoneTests(SeedingTestCase):
    def test_account_that_already_followed_is_marked_failed_and_counted(self):
        uids = self.add_accounts(2)
        first = self.create("PAGE", ["https://web.facebook.com/PageA"], account_count=2)["campaign_ids"][0]
        done, missed = self.tasks(first)
        done.status, missed.status = "SUCCESS", "FAILED"   # lần trước: nick 1 follow được, nick 2 thất bại
        self.db.commit()

        cid = self.create("PAGE", ["https://web.facebook.com/PageA"], account_count=2)["campaign_ids"][0]
        by_uid = {t.account_uid: t for t in self.tasks(cid)}
        self.assertEqual(by_uid[done.account_uid].status, "FAILED")
        self.assertIn("rồi", by_uid[done.account_uid].error_message)
        other = [u for u in uids if u != done.account_uid][0]
        self.assertEqual(by_uid[other].status, "PENDING")
        camp = self.campaign(cid)
        self.assertEqual((camp.total_planned, camp.total_failed), (2, 1))
        self.assertEqual(self.db.query(SeedingTask).filter(SeedingTask.campaign_id == cid).count(), 2)
