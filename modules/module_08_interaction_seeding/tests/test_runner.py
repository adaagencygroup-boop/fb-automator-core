"""Chạy chiến dịch: đếm thành công / thất bại, kiểm tra lại sau thao tác, nghỉ giữa thao tác, dừng chiến dịch."""
import threading
from unittest.mock import patch

from .helpers import R, FakeBot, SeedingTestCase

PAGE_A = "https://web.facebook.com/PageA"


class CountingTests(SeedingTestCase):
    def test_two_accounts_failing_at_the_same_moment_count_as_two(self):
        self.add_accounts(2)
        cid = self.create("PAGE", [PAGE_A], account_count=2)["campaign_ids"][0]
        barrier = threading.Barrier(2)

        def follow_fails(url, **kwargs):
            barrier.wait(timeout=10)  # 2 nick thất bại đúng cùng lúc
            return False, "Không tìm thấy nút Follow"

        with patch.object(FakeBot, "execute_follow", lambda self, url, **k: follow_fails(url)):
            self.run_campaign(cid)
        camp = self.campaign(cid)
        self.assertEqual((camp.total_success, camp.total_failed), (0, 2))
        self.assertEqual(camp.campaign_targets[0].failed_count, 2)
        self.assertEqual(camp.status, "FAILED")

    def test_login_failure_counts_once_per_account(self):
        self.add_accounts(1)
        cid = self.create("POST", ["https://web.facebook.com/share/p/AAAA1111"], actions=["REACT", "SHARE"],
                          reactions=["LIKE"], account_count=1)["campaign_ids"][0]
        FakeBot.session_alive = False
        self.run_campaign(cid)
        camp = self.campaign(cid)
        self.assertEqual(camp.total_failed, 1)
        self.assertTrue(all(t.status == "FAILED" for t in self.tasks(cid)))

    def test_chrome_cannot_open_counts_one_failure_and_campaign_is_not_completed(self):
        # Đúng tình huống chiến dịch #172: không đọc được dấu vân tay trình duyệt -> không mở được Chrome
        self.add_accounts(1)
        cid = self.create("POST", ["https://web.facebook.com/share/p/AAAA1111"], actions=["REACT", "COMMENT", "SHARE"],
                          reactions=["LOVE"], comments=["Hay"], account_count=1)["campaign_ids"][0]

        def chrome_fails(**kwargs):
            raise RuntimeError("Không đọc được dấu vân tay trình duyệt từ CSDL, bỏ qua để tránh đổi thiết bị")

        with patch.object(R, "create_driver", chrome_fails):
            self.run_campaign(cid)
        camp = self.campaign(cid)
        self.assertEqual((camp.total_success, camp.total_failed, camp.status), (0, 1, "FAILED"))
        self.assertEqual(camp.campaign_targets[0].failed_count, 1)
        self.assertTrue(all(t.status == "FAILED" and t.error_message.startswith("Lỗi luồng") for t in self.tasks(cid)))

    def test_error_in_the_middle_is_counted_once(self):
        self.add_accounts(1)
        cid = self.create("POST", ["https://web.facebook.com/share/p/AAAA1111"], actions=["REACT", "COMMENT"],
                          reactions=["LIKE"], comments=["Hay"], account_count=1)["campaign_ids"][0]

        def comment_crashes(self, url, **kwargs):
            raise RuntimeError("trình duyệt bị đóng đột ngột")

        with patch.object(FakeBot, "execute_comment", comment_crashes):
            self.run_campaign(cid)
        camp = self.campaign(cid)
        self.assertEqual((camp.total_success, camp.total_failed), (0, 1))
        self.assertEqual([t.status for t in self.tasks(cid)], ["SUCCESS", "FAILED"])

    def test_one_crashed_one_ok(self):
        self.add_accounts(2)
        cid = self.create("PAGE", [PAGE_A], account_count=2)["campaign_ids"][0]
        crashed = []

        def follow(url, **kwargs):
            if not crashed:
                crashed.append(1)
                raise RuntimeError("connection already closed")
            return True, "Thành công"

        with patch.object(FakeBot, "execute_follow", lambda self, url, **k: follow(url)):
            self.run_campaign(cid)
        camp = self.campaign(cid)
        self.assertEqual((camp.total_success, camp.total_failed, camp.status), (1, 1, "COMPLETED"))

    def test_success_and_failure_mix(self):
        self.add_accounts(2)
        cid = self.create("POST", ["https://web.facebook.com/share/p/AAAA1111"], actions=["REACT"],
                          reactions=["LIKE"], account_count=2)["campaign_ids"][0]
        calls = []

        def react(url, **kwargs):
            calls.append(url)
            return (True, "Thành công") if len(calls) == 1 else (False, "Không bấm được")

        with patch.object(FakeBot, "execute_react", lambda self, url, **k: react(url)):
            self.run_campaign(cid)
        camp = self.campaign(cid)
        self.assertEqual((camp.total_success, camp.total_failed, camp.status), (1, 1, "COMPLETED"))


class VerifyAfterActionTests(SeedingTestCase):
    def test_facebook_undo_turns_success_into_failure(self):
        self.add_accounts(1)
        cid = self.create("PAGE", [PAGE_A], account_count=1)["campaign_ids"][0]
        FakeBot.verify = (False, "Facebook đã hoàn tác thao tác Follow")
        self.run_campaign(cid)
        task = self.tasks(cid)[0]
        self.assertEqual(task.status, "FAILED")
        self.assertIn("hoàn tác", task.error_message)
        self.assertEqual(FakeBot.verify_calls, ["FOLLOW"])
        self.assertEqual(self.campaign(cid).total_failed, 1)

    def test_already_done_before_is_not_rechecked(self):
        self.add_accounts(1)
        cid = self.create("POST", ["https://web.facebook.com/share/p/AAAA1111"], actions=["REACT"],
                          reactions=["LIKE"], account_count=1)["campaign_ids"][0]
        FakeBot.results = {"REACT": (True, "Đã Thích từ trước")}
        self.run_campaign(cid)
        self.assertEqual(FakeBot.verify_calls, [])
        self.assertEqual(self.tasks(cid)[0].status, "SUCCESS")


class PauseTests(SeedingTestCase):
    def test_same_post_actions_rest_with_the_configured_delay(self):
        # "Thời gian nghỉ giữa 2 lần tương tác" áp dụng cả giữa Like -> Bình luận -> Chia sẻ trên cùng 1 bài
        self.add_accounts(1)
        cid = self.create("POST", ["https://web.facebook.com/share/p/AAAA1111"], actions=["REACT", "COMMENT", "SHARE"],
                          reactions=["LIKE"], comments=["Hay"], account_count=1,
                          delay_seconds_min=10, delay_seconds_max=20)["campaign_ids"][0]
        sleeps = []
        with patch.object(R.time, "sleep", sleeps.append):
            R._process_account_tasks(cid, self.tasks(cid)[0].account_uid, [t.id for t in self.tasks(cid)], 10, 20)
        self.assertEqual([a for a, _ in FakeBot.calls], ["REACT", "COMMENT", "SHARE"])
        self.assertEqual(len(sleeps), 3, sleeps)
        self.assertTrue(all(10 <= s <= 20 for s in sleeps[:2]), sleeps)   # 2 lần nghỉ giữa 3 thao tác
        self.assertEqual(sleeps[2], 1.5)                                    # xong hết: nghỉ ngắn rồi đóng Chrome
        rest_logs = [m for _, m in self.logs if "trước thao tác tiếp theo trên bài viết này" in m]
        self.assertEqual(len(rest_logs), 2)

    def test_backwards_delay_does_not_crash_the_account_thread(self):
        self.add_accounts(1)
        cid = self.create("POST", ["https://web.facebook.com/share/p/AAAA1111", "https://web.facebook.com/share/p/BBBB2222"],
                          actions=["REACT"], reactions=["LIKE"], account_count=1)["campaign_ids"][0]
        uid = self.tasks(cid)[0].account_uid
        other = self.create("POST", ["https://web.facebook.com/share/p/CCCC3333"], actions=["REACT"],
                            reactions=["LIKE"], account_count=1)["campaign_ids"][0]
        task_ids = [self.tasks(cid)[0].id, self.tasks(other)[0].id]   # 2 bài khác nhau -> có nghỉ dài
        with patch.object(R.time, "sleep", lambda s: None):
            R._process_account_tasks(cid, uid, task_ids, 20, 10)
        self.assertEqual([t.status for t in (self.tasks(cid)[0], self.tasks(other)[0])], ["SUCCESS", "SUCCESS"])


class BatchAndStopTests(SeedingTestCase):
    def _batch(self, n=3, ctype="POST"):
        self.add_accounts(1)
        urls = [f"https://web.facebook.com/share/p/BATCH{i}xx" for i in range(n)] if ctype == "POST" else \
            [f"https://web.facebook.com/Page{i}" for i in range(n)]
        actions = {"actions": ["REACT"], "reactions": ["LIKE"]} if ctype == "POST" else {}
        return self.create(ctype, urls, account_count=1, **actions)["campaign_ids"]

    def test_batch_runs_every_post_and_rests_between_posts(self):
        ids = self._batch(3)
        ran, sleeps = [], []
        with patch.object(R, "_run_single_campaign", ran.append), patch.object(R.time, "sleep", sleeps.append):
            R._execute_campaign_runner(ids[0])
        self.assertEqual(ran, ids)
        self.assertTrue(60 <= len(sleeps) <= 120, len(sleeps))   # 2 lần nghỉ, mỗi lần 30-60 giây

    def test_stop_during_rest_skips_remaining_posts(self):
        ids = self._batch(3)
        ran, ticks = [], []

        def tick(s):
            ticks.append(s)
            if len(ticks) == 2:
                self.api("POST", f"/campaigns/{ids[0]}/stop")

        with patch.object(R, "_run_single_campaign", ran.append), patch.object(R.time, "sleep", tick):
            R._execute_campaign_runner(ids[0])
        self.assertEqual(ran, ids[:1])
        self.assertEqual({self.campaign(i).status for i in ids[1:]}, {"STOPPED"})

    def test_stop_endpoint_marks_whole_batch(self):
        ids = self._batch(2)
        self.api("POST", f"/campaigns/{ids[0]}/stop")
        for cid in ids:
            camp = self.campaign(cid)
            self.assertEqual(camp.status, "STOPPED")
            self.assertTrue(all(t.status == "FAILED" for t in camp.tasks))
            self.assertEqual(camp.total_success + camp.total_failed, camp.total_planned)

    def test_page_batch_has_no_extra_rest(self):
        ids = self._batch(3, ctype="PAGE")
        ran, sleeps = [], []
        with patch.object(R, "_run_single_campaign", ran.append), patch.object(R.time, "sleep", sleeps.append):
            R._execute_campaign_runner(ids[0])
        self.assertEqual((ran, sleeps), (ids, []))
