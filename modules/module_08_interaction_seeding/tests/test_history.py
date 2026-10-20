"""Trang Lịch sử: giờ Việt Nam, lọc theo ngày / trạng thái / tìm kiếm, chi tiết, thống kê, lô đang chạy."""
from datetime import datetime

from .helpers import R, SeedingCampaign, SeedingTestCase


class HistoryTests(SeedingTestCase):
    def _camp(self, created_at, status="COMPLETED", ctype="POST", success=1, failed=0, owner=7):
        c = SeedingCampaign(campaign_type=ctype, actions="REACT", account_count=1, status=status, created_by=owner,
                            total_planned=success + failed, total_success=success, total_failed=failed,
                            created_at=created_at)
        self.db.add(c)
        self.db.commit()
        return c.id

    def test_time_shown_in_vietnam_time_with_seconds(self):
        self._camp(datetime(2026, 10, 16, 14, 0, 35))
        self.assertEqual(self.history()[0]["created_at_display"], "16/10/2026 14:00:35 (UTC+7)")

    def test_date_filter_is_a_whole_vietnam_day(self):
        ids = {k: self._camp(ts) for k, ts in {
            "15_late": datetime(2026, 10, 15, 23, 30), "16_early": datetime(2026, 10, 16, 0, 5),
            "16_late": datetime(2026, 10, 16, 23, 59), "17": datetime(2026, 10, 17, 0, 0)}.items()}
        got = {i["id"] for i in self.history(from_date="2026-10-16", to_date="2026-10-16")}
        self.assertEqual(got, {ids["16_early"], ids["16_late"]})

    def test_status_filter_and_owner_scope(self):
        ok = self._camp(datetime(2026, 10, 16, 9), status="COMPLETED")
        bad = self._camp(datetime(2026, 10, 16, 10), status="FAILED", success=0, failed=1)
        self._camp(datetime(2026, 10, 16, 11), owner=99)   # chiến dịch của người khác
        self.assertEqual({i["id"] for i in self.history()}, {ok, bad})
        self.assertEqual([i["id"] for i in self.history(status="COMPLETED")], [ok])
        self.assertEqual([i["id"] for i in self.history(status="FAILED")], [bad])

    def test_search_by_target_name(self):
        self.add_accounts(1)
        self.create("PAGE", ["https://web.facebook.com/QuanAP"], account_count=1)
        self.create("PAGE", ["https://web.facebook.com/KhacHan"], account_count=1)
        names = [i["name"] for i in self.history(search="QuanAP")]
        self.assertEqual(names, ["Page QuanAP"])

    def test_stats_cards(self):
        self._camp(datetime(2026, 10, 16, 9), success=3, failed=1)
        self._camp(datetime(2026, 10, 16, 10), success=0, failed=2, status="FAILED")
        stats = self.api("GET", "/stats")
        self.assertEqual((stats["total_campaigns"], stats["total_success"], stats["total_failed"]), (2, 3, 3))

    def test_detail_reports_selected_actions(self):
        self.add_accounts(2)
        cid = self.create("POST", ["https://web.facebook.com/share/p/AAAA1111"], actions=["REACT", "COMMENT", "SHARE"],
                          reactions=["CARE"], comments=["Hay"], account_count=2)["campaign_ids"][0]
        detail = self.api("GET", f"/campaigns/{cid}/detail")
        self.assertEqual(set(detail["actions"]), {"REACT", "COMMENT", "SHARE"})
        self.assertEqual(detail["reactions"], ["CARE"])
        self.assertEqual(detail["created_at_display"][-7:], "(UTC+7)")


class BatchStateTests(SeedingTestCase):
    def test_batch_is_active_while_next_post_waits(self):
        self.add_accounts(1)
        ids = self.create("POST", ["https://web.facebook.com/share/p/AAAA1111", "https://web.facebook.com/share/p/BBBB2222"],
                          actions=["REACT"], reactions=["LIKE"], account_count=1)["campaign_ids"]
        self.campaign(ids[0]).status = "COMPLETED"
        self.db.commit()
        self.assertTrue(self.api("GET", f"/campaigns/{ids[0]}/detail")["is_batch_active"])
        self.campaign(ids[1]).status = "COMPLETED"
        self.db.commit()
        self.assertFalse(self.api("GET", f"/campaigns/{ids[0]}/detail")["is_batch_active"])

    def test_active_campaign_for_returning_to_the_page(self):
        self.add_accounts(1)
        ids = self.create("POST", ["https://web.facebook.com/share/p/AAAA1111", "https://web.facebook.com/share/p/BBBB2222"],
                          actions=["REACT"], reactions=["LIKE"], account_count=1)["campaign_ids"]
        active = lambda t: self.api("GET", "/campaigns/active", params={"campaign_type": t})["campaign_id"]  # noqa: E731
        self.assertEqual(active("POST"), ids[0])
        self.assertIsNone(active("PAGE"))
        self.campaign(ids[0]).status = "COMPLETED"
        self.db.commit()
        self.assertEqual(active("POST"), ids[1])
        self.user = {"id": 99, "username": "other", "role": "user"}
        self.assertIsNone(active("POST"))
        R._batch_campaign_chains.clear()   # engine khởi động lại: chiến dịch kẹt RUNNING/PENDING không tính
        self.user = {"id": 7, "username": "tester", "role": "user"}
        self.assertIsNone(active("POST"))
