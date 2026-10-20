"""Danh sách link nhập vào (thêm, lọc trùng, ẩn link đã chạy xong, xóa mà vẫn giữ Lịch sử)."""
from .helpers import SeedingCampaign, SeedingTarget, SeedingTestCase

POST_A = "https://web.facebook.com/share/p/AAAA1111"
POST_B = "https://web.facebook.com/share/p/BBBB2222"


class TargetListTests(SeedingTestCase):
    def test_add_links_removes_duplicates_and_names_them(self):
        res = self.validate("POST", [POST_A, POST_A + "?mibextid=xyz", "AAAA1111", POST_B])
        self.assertEqual([t["display_name"] for t in res["targets"]], ["Bài viết AAAA1111", "Bài viết BBBB2222"])
        self.assertEqual(len(self.list_targets("POST")), 2)

    def test_two_posts_of_the_same_page_are_not_merged(self):
        res = self.validate("POST", [
            "https://web.facebook.com/permalink.php?story_fbid=pfbid0AAA111&id=100064",
            "https://web.facebook.com/permalink.php?story_fbid=pfbid0BBB222&id=100064",
        ])
        self.assertEqual(res["total"], 2)

    def test_user_only_sees_own_links(self):
        self.validate("PAGE", ["https://web.facebook.com/PageCuaToi"])
        self.user = {"id": 99, "username": "other", "role": "user"}
        self.assertEqual(self.list_targets("PAGE"), [])

    def _run_post(self, url, status, success=1, failed=0):
        """Tạo chiến dịch cho 1 link rồi đặt kết quả như đã chạy xong."""
        self.add_accounts(1)
        res = self.create("POST", [url], actions=["REACT"], reactions=["LIKE"], account_count=1)
        cid = res["campaign_ids"][0]
        camp = self.campaign(cid)
        camp.status, camp.total_success, camp.total_failed = status, success, failed
        for ct in camp.campaign_targets:
            ct.success_count, ct.failed_count = success, failed
        for t in camp.tasks:
            t.status = "SUCCESS" if success else "FAILED"
        self.db.commit()
        return cid

    def test_link_that_ran_successfully_is_hidden_but_history_keeps_its_name(self):
        self.validate("POST", [POST_A, POST_B])
        cid = self._run_post(POST_A, "COMPLETED")
        self.assertEqual([t["url"] for t in self.list_targets("POST")], [POST_B])
        self.assertEqual(self.history()[0]["name"], "Bài viết AAAA1111")
        self.assertEqual(self.api("GET", f"/campaigns/{cid}/detail")["name"], "Bài viết AAAA1111")

    def test_delete_link_keeps_history_name_and_tasks(self):
        self.validate("POST", [POST_A])
        cid = self._run_post(POST_A, "FAILED", success=0, failed=1)
        self.api("DELETE", "/targets/by-url", params={"url": POST_A, "target_type": "POST"})
        detail = self.api("GET", f"/campaigns/{cid}/detail")
        self.assertEqual(detail["name"], "Bài viết AAAA1111")
        self.assertEqual(len(detail["tasks"]), 1)
        self.assertEqual(self.history()[0]["name"], "Bài viết AAAA1111")

    def test_clear_all_only_removes_links_that_did_not_finish_successfully(self):
        self.validate("POST", [POST_A, POST_B])
        cid = self._run_post(POST_A, "COMPLETED")
        res = self.api("DELETE", "/targets/clear", params={"target_type": "POST"})
        self.assertEqual(res["deleted"], 1)
        self.db.expire_all()
        self.assertEqual([t.url for t in self.db.query(SeedingTarget).all()], [POST_A])
        self.assertEqual(len(self.campaign(cid).tasks), 1)
        self.assertEqual(self.db.query(SeedingCampaign).count(), 1)
