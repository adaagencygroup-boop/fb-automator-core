"""Kho bình luận mẫu, chiến dịch không còn gì để chạy, tìm kiếm theo mã chiến dịch, quyền xem chi tiết."""
from .helpers import SeedingTestCase


class CommentBankTests(SeedingTestCase):
    def test_add_trims_and_removes_duplicates(self):
        res = self.api("POST", "/comments/add", json={"comments": ["  Hay quá ", "Hay quá", "", "Cố lên"]})
        self.assertEqual(res["comments"], ["Hay quá", "Cố lên"])
        res = self.api("POST", "/comments/add", json={"comments": ["Cố lên", "Tuyệt"]})
        self.assertEqual((res["added_count"], res["comments"]), (1, ["Hay quá", "Cố lên", "Tuyệt"]))

    def test_each_user_has_own_bank(self):
        self.api("POST", "/comments/add", json={"comments": ["Của tôi"]})
        self.user = {"id": 99, "username": "other", "role": "user"}
        self.assertEqual(self.api("GET", "/comments")["comments"], [])

    def test_delete_one_and_clear(self):
        self.api("POST", "/comments/add", json={"comments": ["A", "B", "C"]})
        self.api("DELETE", "/comments/delete", params={"content": "B"})
        self.assertEqual(self.api("GET", "/comments")["comments"], ["A", "C"])
        self.api("DELETE", "/comments/clear")
        self.assertEqual(self.api("GET", "/comments")["total"], 0)

    def test_campaign_without_typed_comments_uses_the_bank(self):
        self.add_accounts(2)
        self.api("POST", "/comments/add", json={"comments": ["Từ kho"]})
        cid = self.create("POST", ["https://web.facebook.com/share/p/AAAA1111"], actions=["COMMENT"], comments=[],
                          account_count=2)["campaign_ids"][0]
        self.assertEqual({t.comment.content for t in self.tasks(cid, "COMMENT")}, {"Từ kho"})


class NothingLeftToRunTests(SeedingTestCase):
    def test_campaign_where_every_account_already_followed_finishes_as_failed(self):
        self.add_accounts(2)
        first = self.create("PAGE", ["https://web.facebook.com/PageA"], account_count=2)["campaign_ids"][0]
        for t in self.tasks(first):
            t.status = "SUCCESS"
        self.db.commit()
        cid = self.create("PAGE", ["https://web.facebook.com/PageA"], account_count=2)["campaign_ids"][0]
        self.run_campaign(cid)
        camp = self.campaign(cid)
        self.assertEqual((camp.status, camp.total_success, camp.total_failed), ("FAILED", 0, 2))
        self.assertIsNotNone(camp.finished_at)


class HistoryExtraTests(SeedingTestCase):
    def test_search_by_campaign_number(self):
        self.add_accounts(1)
        a = self.create("PAGE", ["https://web.facebook.com/PageA"], account_count=1)["campaign_ids"][0]
        self.create("PAGE", ["https://web.facebook.com/PageB"], account_count=1)
        self.assertEqual([i["id"] for i in self.history(search=f"#{a}")], [a])

    def test_type_filter(self):
        self.add_accounts(1)
        page = self.create("PAGE", ["https://web.facebook.com/PageA"], account_count=1)["campaign_ids"][0]
        self.create("POST", ["https://web.facebook.com/share/p/AAAA1111"], actions=["SHARE"], account_count=1)
        self.assertEqual([i["id"] for i in self.history(campaign_type="PAGE")], [page])
        self.assertEqual(len(self.history(campaign_type="ALL")), 2)

    def test_detail_of_someone_elses_campaign_is_forbidden(self):
        self.add_accounts(1)
        cid = self.create("PAGE", ["https://web.facebook.com/PageA"], account_count=1)["campaign_ids"][0]
        self.user = {"id": 99, "username": "other", "role": "user"}
        self.api("GET", f"/campaigns/{cid}/detail", expect=403)
        self.api("GET", "/campaigns/999999/detail", expect=404)
