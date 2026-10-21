"""Mỗi lúc chỉ chạy 1 lô seeding (mọi loại trang), vì các lô dùng chung nick / Chrome profile."""
from unittest.mock import patch

from .helpers import R, SeedingCampaign, SeedingTestCase

POST_URLS = ["https://web.facebook.com/share/p/AAAA1111", "https://web.facebook.com/share/p/BBBB2222"]


class SingleBatchTests(SeedingTestCase):
    def setUp(self):
        super().setUp()
        self.add_accounts(2)
        self.addCleanup(R._running_batches.clear)

    def _start_post_batch(self):
        ids = self.create("POST", POST_URLS, actions=["REACT"], reactions=["LIKE"], account_count=2)["campaign_ids"]
        R._running_batches[ids[0]] = ids   # giả lập bộ chạy lô đang chạy lô Bài viết
        return ids

    def test_other_page_cannot_create_while_a_batch_runs(self):
        ids = self._start_post_batch()
        res = self.create("PROFILE", ["https://web.facebook.com/dhn.integrity"], account_count=2, expect=409)
        self.assertIn(f"Bài viết #{ids[0]}", res["detail"])
        R._running_batches.clear()          # lô Bài viết chạy xong
        self.create("PROFILE", ["https://web.facebook.com/dhn.integrity"], account_count=2)

    def test_campaigns_created_but_never_started_do_not_block(self):
        self.create("POST", POST_URLS, actions=["REACT"], reactions=["LIKE"], account_count=2)
        self.create("PAGE", ["https://web.facebook.com/PageA"], account_count=2)

    def test_another_users_batch_does_not_block(self):
        ids = self._start_post_batch()
        self.db.query(SeedingCampaign).filter(SeedingCampaign.id.in_(ids)).update(
            {SeedingCampaign.created_by: 99}, synchronize_session=False)
        self.db.commit()
        self.create("PAGE", ["https://web.facebook.com/PageA"], account_count=2)

    def test_start_second_batch_is_refused_but_same_batch_is_allowed(self):
        R._running_batches.clear()
        other = self.create("PAGE", ["https://web.facebook.com/PageA"], account_count=2)["campaign_ids"][0]
        ids = self._start_post_batch()
        with patch.object(R, "_execute_campaign_runner", lambda cid: None):
            res = self.api("POST", f"/campaigns/{other}/start", expect=409)
            self.assertIn("Bài viết", res["detail"])
            self.api("POST", f"/campaigns/{ids[1]}/start")   # cùng lô đang chạy: không bị chặn

    def test_stop_from_another_page_stops_the_running_batch(self):
        ids = self._start_post_batch()
        active = self.api("GET", "/campaigns/active")
        self.assertEqual(active["campaign_type"], "POST")
        self.api("POST", f"/campaigns/{active['campaign_id']}/stop")   # bấm "Dừng seeding Bài viết #..." ở trang khác
        self.assertEqual({self.campaign(c).status for c in ids}, {"STOPPED"})
        self.assertIsNone(self.api("GET", "/campaigns/active")["campaign_id"])

    def _other_users_running_campaign(self):
        """Chiến dịch của người khác đang chạy trên MÁY KHÁC (chỉ có trong DB chung, không có trong bộ nhớ máy này)."""
        c = SeedingCampaign(campaign_type="PAGE", actions="FOLLOW", account_count=1, status="RUNNING",
                            created_by=99, total_planned=1)
        self.db.add(c)
        self.db.commit()
        return c.id

    def test_stop_all_stops_own_batches_but_not_teammates_on_other_machines(self):
        ids = self._start_post_batch()
        stuck = SeedingCampaign(campaign_type="PROFILE", actions="FOLLOW", account_count=1, status="RUNNING",
                                created_by=7, total_planned=1)   # của mình, bị kẹt từ lần tắt app trước
        self.db.add(stuck)
        self.db.commit()
        teammate = self._other_users_running_campaign()
        res = self.api("POST", "/stop-all")
        self.assertEqual(set(res["campaign_ids"]), set(ids) | {stuck.id})
        self.assertEqual(self.campaign(teammate).status, "RUNNING")

    def test_admin_stop_all_does_not_touch_other_machines_either(self):
        teammate = self._other_users_running_campaign()
        self.user = {"id": 1, "username": "admin", "role": "admin"}
        self.api("POST", "/stop-all")
        self.assertEqual(self.campaign(teammate).status, "RUNNING")

    def test_runner_marks_batch_running_only_while_it_runs(self):
        ids = self.create("POST", POST_URLS, actions=["REACT"], reactions=["LIKE"], account_count=2)["campaign_ids"]
        seen = []

        def fake_run(cid):
            seen.append(self.api("GET", "/campaigns/active")["campaign_id"])
            if cid == ids[1]:
                raise RuntimeError("lỗi giữa chừng")

        with patch.object(R, "_run_single_campaign", fake_run), patch.object(R.time, "sleep", lambda s: None):
            with self.assertRaises(RuntimeError):
                R._execute_campaign_runner(ids[0])
        self.assertEqual(seen, [ids[0], ids[0]])   # bài 1 chưa đổi trạng thái trong test nên vẫn là chiến dịch đầu
        self.assertEqual(R._running_batches, {})   # lỗi giữa chừng vẫn mở khoá
