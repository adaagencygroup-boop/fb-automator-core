import threading
import time
import unittest
from unittest.mock import patch

from modules.module_07_group_spam.campaign import CampaignManager, FacebookGroupPoster, html_to_facebook_text


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
        self.manager = CampaignManager(poster_factory=FakePoster)
        self.accounts = {
            "100": {"id": 1, "uid": "100", "password": "", "two_fa": "", "cookie": "", "proxy": ""},
            "200": {"id": 2, "uid": "200", "password": "", "two_fa": "", "cookie": "", "proxy": ""},
        }
        self.persist = patch.object(CampaignManager, "_persist_final_results")
        self.persist.start()
        self.addCleanup(self.persist.stop)

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

    def test_campaign_runs_concurrently_and_reports_partial_result(self):
        with patch.object(self.manager, "_load_accounts", return_value=self.accounts):
            started = self.manager.start(self.payload(), "owner-1")
            result = wait_for_job(self.manager, started["job_id"])
        self.assertEqual(result["status"], "PARTIAL")
        self.assertEqual((result["total"], result["completed"]), (3, 3))
        self.assertEqual((result["success"], result["failed"]), (2, 1))
        self.assertEqual((result["completed_steps"], result["total_steps"]), (6, 6))

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


if __name__ == "__main__":
    unittest.main()
