import threading
import time
import unittest
from unittest.mock import patch

from modules.module_07_group_spam.app.services.campaign import CampaignJob, CampaignManager, FacebookGroupPoster, html_to_facebook_text


class FakePersistence:
    def __init__(self):
        self.tasks = []
        self.updates = []

    def initialize_run(self, **kwargs):
        return kwargs.get("requested_campaign_id") or "campaign-1", 1

    def record_task(self, run_id, item):
        self.tasks.append((run_id, item))

    def update_run(self, run_id, **values):
        self.updates.append((run_id, values))


class FakePoster:
    def __init__(self, account, cancel, log):
        self.account = account

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def join_group(self, group):
        if group.get("pending"):
            return {"status": "PENDING_APPROVAL", "message": "Đang chờ duyệt"}
        return {"status": "JOINED", "message": "Tham gia nhóm thành công"}

    def post(self, group, content, media):
        if group.get("fail"):
            raise RuntimeError("Facebook từ chối bài đăng")
        return {"status": "SUCCESS", "message": "Đăng bài thành công"}

    def comment(self, group, content, media, *, auto_like=False):
        if group.get("fail"):
            raise RuntimeError("Facebook từ chối bình luận")
        return {
            "status": "SUCCESS",
            "message": "Bình luận bài viết đầu tiên thành công",
            "result_url": f"{group['url']}/posts/first",
        }


def wait_for_job(manager, job_id, timeout=2):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = manager.get(job_id, "owner-1")
        if job["status"] in {"COMPLETED", "PARTIAL", "STOPPED", "FAILED"}:
            return job
        time.sleep(0.01)
    raise AssertionError("Campaign did not finish")


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.persistence = FakePersistence()
        self.manager = CampaignManager(poster_factory=FakePoster, persistence=self.persistence)
        self.accounts = {
            "100": {"id": 1, "uid": "100", "password": "", "two_fa": "", "cookie": "", "proxy": ""},
            "200": {"id": 2, "uid": "200", "password": "", "two_fa": "", "cookie": "", "proxy": ""},
        }

    def payload(self):
        return {
            "action_type": "POST",
            "account_uids": ["100", "200"],
            "groups": [
                {"key": "g1", "url": "https://facebook.com/groups/g1", "name": "Nhóm 1"},
                {"key": "g2", "url": "https://facebook.com/groups/g2", "name": "Nhóm 2", "fail": True},
            ],
            "posts": ["<p>Xin chào<br>Việt Nam</p>"],
            "media": [],
            "settings": {"threads": 2, "max_posts": 3, "delay_min": 0, "delay_max": 0},
        }

    def test_progress_logs_remain_in_ram_without_line_limit(self):
        job = CampaignJob(id="job-ram", owner="owner-1", payload={})
        for index in range(105):
            job.log("INFO", f"event-{index}")
        self.assertEqual(len(job.public()["logs"]), 105)
        self.assertEqual(job.public()["logs"][0]["message"], "event-0")

    def test_campaign_runs_concurrently_and_reports_partial_result(self):
        with patch.object(self.manager, "_load_accounts", return_value=self.accounts):
            started = self.manager.start(self.payload(), "owner-1")
            result = wait_for_job(self.manager, started["job_id"])
        self.assertEqual(result["status"], "PARTIAL")
        self.assertEqual((result["total"], result["completed"]), (3, 3))
        self.assertEqual((result["success"], result["failed"]), (2, 1))
        self.assertEqual((result["completed_steps"], result["total_steps"]), (6, 6))
        self.assertEqual(len(self.persistence.tasks), 3)
        self.assertEqual(self.persistence.updates[-1][1]["status"], "PARTIAL")

    def test_pending_join_request_does_not_block_posting(self):
        payload = self.payload()
        payload["account_uids"] = ["100"]
        payload["groups"] = [{"key": "g1", "url": "https://facebook.com/groups/g1", "pending": True}]
        with patch.object(self.manager, "_load_accounts", return_value=self.accounts):
            started = self.manager.start(payload, "owner-1")
            result = wait_for_job(self.manager, started["job_id"])
        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(result["pending_approval"], 1)
        self.assertEqual(result["success"], 1)
        self.assertEqual(result["progress"], 100)

    def test_join_flow_finishes_before_posting_flow_starts(self):
        events = []

        class RecordingPoster(FakePoster):
            def join_group(self, group):
                events.append(("join", group["key"]))
                return super().join_group(group)

            def post(self, group, content, media):
                events.append(("post", group["key"]))
                return super().post(group, content, media)

        manager = CampaignManager(poster_factory=RecordingPoster, persistence=FakePersistence())
        payload = self.payload()
        payload["account_uids"] = ["100"]
        payload["groups"] = [
            {"key": "g1", "url": "https://facebook.com/groups/g1"},
            {"key": "g2", "url": "https://facebook.com/groups/g2"},
        ]
        payload["settings"]["max_posts"] = 2
        with patch.object(manager, "_load_accounts", return_value=self.accounts):
            started = manager.start(payload, "owner-1")
            result = wait_for_job(manager, started["job_id"])

        self.assertEqual(result["status"], "COMPLETED")
        self.assertEqual(events, [("join", "g1"), ("join", "g2"), ("post", "g1"), ("post", "g2")])

    def test_comment_campaign_uses_first_post_comment_flow(self):
        payload = self.payload()
        payload["action_type"] = "COMMENT"
        payload["account_uids"] = ["100"]
        payload["groups"] = [{"key": "g1", "url": "https://facebook.com/groups/g1", "name": "Nhóm 1"}]
        payload["settings"]["max_posts"] = 1
        payload["settings"]["auto_like"] = True
        with patch.object(self.manager, "_load_accounts", return_value=self.accounts):
            started = self.manager.start(payload, "owner-1")
            result = wait_for_job(self.manager, started["job_id"])
        self.assertEqual(started["campaign_id"], "campaign-1")
        self.assertEqual(started["action_type"], "COMMENT")
        self.assertEqual(result["status"], "COMPLETED")
        self.assertIn("bình luận", result["message"])
        self.assertEqual(result["success"], 1)
        saved = self.persistence.tasks[0][1]
        self.assertEqual(saved["message"], "Bình luận bài viết đầu tiên thành công")
        self.assertTrue(saved["result_url"].endswith("/posts/first"))

    def test_scheduled_campaign_can_be_stopped_before_browser_starts(self):
        payload = self.payload()
        payload["settings"]["schedule_at"] = "2999-01-01T08:00"
        with patch.object(self.manager, "_load_accounts", return_value=self.accounts):
            started = self.manager.start(payload, "owner-1")
            self.manager.stop(started["job_id"], "owner-1")
            result = wait_for_job(self.manager, started["job_id"])
        self.assertEqual(result["status"], "STOPPED")
        self.assertEqual(result["completed"], 0)

    def test_owner_cannot_read_another_owner_job(self):
        with patch.object(self.manager, "_load_accounts", return_value=self.accounts):
            started = self.manager.start(self.payload(), "owner-1")
            self.assertIsNone(self.manager.get(started["job_id"], "owner-2"))

    def test_editor_html_is_converted_to_facebook_plain_text(self):
        self.assertEqual(html_to_facebook_text("<p>Xin chào<br>Việt Nam</p>"), "Xin chào\nViệt Nam")

    def test_stop_interrupts_wait_and_closes_open_popup(self):
        class Body:
            def __init__(self):
                self.keys = []

            def send_keys(self, key):
                self.keys.append(key)

        class Driver:
            def __init__(self):
                self.body = Body()

            def find_element(self, *_):
                return self.body

            def find_elements(self, *_):
                return []

        cancel = threading.Event()
        cancel.set()
        poster = FacebookGroupPoster({"uid": "100"}, cancel, lambda *_: None)
        poster.driver = Driver()
        with self.assertRaises(InterruptedError):
            poster._wait_until(lambda: False, 10, "timeout")
        self.assertTrue(poster.driver.body.keys)

    def test_selenium_wait_retries_after_stale_element(self):
        cancel = threading.Event()
        poster = FacebookGroupPoster({"uid": "100"}, cancel, lambda *_: None)
        calls = []

        def rerendering_condition():
            calls.append(True)
            if len(calls) == 1:
                raise RuntimeError("stale element reference")
            return "fresh-element"

        self.assertEqual(poster._wait_until(rerendering_condition, 1, "not found"), "fresh-element")
        self.assertEqual(len(calls), 2)
    def test_campaign_log_includes_group_name_link_and_status(self):
        job = CampaignJob(id="job-log-test", owner="owner-1", payload={})
        account = {"uid": "61577080577029", "id": 1, "profile_name": "Test User"}
        group = {"key": "12345", "name": "NHÓM BÁN HÀNG ONLINE", "url": "https://www.facebook.com/groups/12345"}
        result = {"status": "SUCCESS", "message": "Đăng bài thành công"}
        self.manager._record_result(job, account, group, result)
        logs = job.public()["logs"]
        self.assertTrue(any(
            "[61577080577029] NHÓM BÁN HÀNG ONLINE (https://www.facebook.com/groups/12345): Đăng bài thành công" in log["message"]
            for log in logs
        ))


    def test_campaign_completion_records_success_log(self):
        payload = self.payload()
        payload["account_uids"] = ["100"]
        payload["groups"] = [{"key": "g1", "url": "https://facebook.com/groups/g1", "name": "Nhóm 1"}]
        with patch.object(self.manager, "_load_accounts", return_value=self.accounts):
            started = self.manager.start(payload, "owner-1")
            result = wait_for_job(self.manager, started["job_id"])
        self.assertEqual(result["status"], "COMPLETED")
        logs = result["logs"]
        self.assertTrue(any("Chiến dịch đã hoàn thành thành công" in log["message"] for log in logs))


if __name__ == "__main__":
    unittest.main()
