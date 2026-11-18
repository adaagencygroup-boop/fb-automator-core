import threading
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.module_07_group_spam.app.services.campaign import (
    CampaignJob,
    CampaignManager,
    FacebookGroupPoster,
    _friendly_automation_error,
    html_to_facebook_text,
    _group_key,
    _group_url,
)


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

    def test_campaign_reports_partial_result(self):
        with patch.object(self.manager, "_load_accounts", return_value=self.accounts):
            started = self.manager.start(self.payload(), "owner-1")
            result = wait_for_job(self.manager, started["job_id"])
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual((result["total"], result["completed"]), (3, 3))
        self.assertEqual((result["success"], result["failed"]), (2, 1))
        self.assertEqual((result["completed_steps"], result["total_steps"]), (6, 6))
        self.assertEqual(len(self.persistence.tasks), 3)
        self.assertEqual(self.persistence.updates[-1][1]["status"], "FAILED")

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

    def test_each_group_action_runs_immediately_after_join(self):
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
        self.assertEqual(events, [("join", "g1"), ("post", "g1"), ("join", "g2"), ("post", "g2")])

    def test_one_account_finishes_before_next_account_starts(self):
        events = []

        class RecordingPoster(FakePoster):
            def join_group(self, group):
                events.append((self.account["uid"], "join", group["key"]))
                return super().join_group(group)

            def post(self, group, content, media):
                events.append((self.account["uid"], "post", group["key"]))
                return super().post(group, content, media)

        manager = CampaignManager(poster_factory=RecordingPoster, persistence=FakePersistence())
        payload = self.payload()
        payload["settings"]["max_posts"] = 4
        with patch.object(manager, "_load_accounts", return_value=self.accounts):
            started = manager.start(payload, "owner-1")
            result = wait_for_job(manager, started["job_id"])

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(events, [
            ("100", "join", "g1"), ("100", "post", "g1"),
            ("100", "join", "g2"), ("100", "post", "g2"),
            ("200", "join", "g1"), ("200", "post", "g1"),
            ("200", "join", "g2"), ("200", "post", "g2"),
        ])

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

    def test_comment_link_is_saved_in_campaign_history(self):
        comment_url = "https://www.facebook.com/groups/159341141325119/posts/2144468799479000/?comment_id=2145171706075376"

        class LinkedCommentPoster(FakePoster):
            def comment(self, group, content, media, *, auto_like=False):
                return {
                    "status": "SUCCESS",
                    "message": "Bình luận bài viết đầu tiên thành công",
                    "result_url": comment_url,
                    "comment_link_captured": True,
                }

        manager = CampaignManager(poster_factory=LinkedCommentPoster, persistence=self.persistence)
        payload = self.payload()
        payload["action_type"] = "COMMENT"
        payload["account_uids"] = ["100"]
        payload["groups"] = [{"key": "g1", "url": "https://facebook.com/groups/g1"}]
        payload["settings"]["max_posts"] = 1
        with patch.object(manager, "_load_accounts", return_value=self.accounts):
            started = manager.start(payload, "owner-1")
            wait_for_job(manager, started["job_id"])

        self.assertEqual(self.persistence.tasks[0][1]["result_url"], comment_url)

    def test_pending_comment_saves_parent_post_link_without_counting_success(self):
        post_url = "https://www.facebook.com/groups/159341141325119/posts/2144468799479000/"
        class PendingCommentPoster(FakePoster):
            def comment(self, group, content, media, *, auto_like=False):
                return {
                    "status": "PENDING_APPROVAL",
                    "message": "Bình luận đang chờ quản trị viên duyệt; chưa có link trực tiếp",
                    "result_url": post_url,
                }

        manager = CampaignManager(poster_factory=PendingCommentPoster, persistence=self.persistence)
        payload = self.payload()
        payload["action_type"] = "COMMENT"
        payload["account_uids"] = ["100"]
        payload["groups"] = [{"key": "g1", "url": "https://facebook.com/groups/g1"}]
        payload["settings"]["max_posts"] = 1
        with patch.object(manager, "_load_accounts", return_value=self.accounts):
            started = manager.start(payload, "owner-1")
            result = wait_for_job(manager, started["job_id"])

        saved = self.persistence.tasks[0][1]
        self.assertEqual((result["status"], result["success"], result["pending_actions"]), ("FAILED", 0, 1))
        self.assertEqual(saved["status"], "PENDING_APPROVAL")
        self.assertEqual(saved["result_url"], post_url)

    def test_parent_post_url_is_derived_from_existing_comment_timestamp(self):
        comment_url = (
            "https://web.facebook.com/groups/159341141325119/posts/2144468799479000/"
            "?comment_id=2145171706075376&__tn__=R-R"
        )

        class Driver:
            def execute_script(self, _script, _anchor):
                return [comment_url]

        poster = FacebookGroupPoster({"uid": "100"}, threading.Event(), lambda *_: None)
        poster.driver = Driver()
        self.assertEqual(
            poster._extract_group_post_permalink(object(), "https://facebook.com/groups/159341141325119"),
            "https://www.facebook.com/groups/159341141325119/posts/2144468799479000/",
        )

    def test_scheduled_campaign_can_be_stopped_before_browser_starts(self):
        payload = self.payload()
        payload["settings"]["schedule_at"] = "2999-01-01T08:00"
        with patch.object(self.manager, "_load_accounts", return_value=self.accounts):
            started = self.manager.start(payload, "owner-1")
            self.manager.stop(started["job_id"], "owner-1")
            result = wait_for_job(self.manager, started["job_id"])
        self.assertEqual(result["status"], "FAILED")
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

    def test_comment_accepts_facebook_aria_placeholder_editor(self):
        class Textbox:
            def __init__(self):
                self.text = ""
                self.content_entries = []
                self.all_selected = False

            def is_displayed(self):
                return True

            def is_enabled(self):
                return True

            def click(self):
                return None

            def get_attribute(self, name):
                return self.text if name in {"textContent", "value"} else None

            def send_keys(self, value):
                if value == "\ue009a":
                    self.all_selected = True
                elif value == "\ue003" and self.all_selected:
                    self.text = ""
                    self.all_selected = False
                elif value == "\ue007":
                    self.text = ""
                else:
                    self.text += str(value)
                    self.content_entries.append(str(value))

        textbox = Textbox()

        class MediaInput:
            def __init__(self):
                self.paths = []

            def get_attribute(self, name):
                return None if name == "multiple" else "image/*"

            def send_keys(self, value):
                self.paths.append(value)

        media_input = MediaInput()

        class Link:
            def get_attribute(self, name):
                return "https://facebook.com/groups/g1/posts/p1" if name == "href" else None

        class Article:
            text = ""

            def is_displayed(self):
                return True

            def find_elements(self, _by, xpath):
                if "/posts/" in xpath:
                    return [Link()]
                if "aria-placeholder" in xpath:
                    return [textbox]
                return []

        article = Article()

        class Body:
            text = ""

        class Driver:
            current_url = "https://facebook.com/groups/g1"

            def get(self, _url):
                return None

            def find_elements(self, _by, _xpath):
                return [article]

            def find_element(self, _by, _value):
                return Body()

            def execute_script(self, script, *args):
                if "document.readyState" in script:
                    return "complete"
                if "node.querySelector" in script:
                    return media_input
                return None

        class FastCancel:
            def is_set(self):
                return False

            def wait(self, _timeout):
                return False

        poster = FacebookGroupPoster({"uid": "100"}, FastCancel(), lambda *_: None)
        poster.driver = Driver()
        content = "Anh quan tâm bài viết này"
        with tempfile.NamedTemporaryFile(suffix=".jpg") as media_file, tempfile.NamedTemporaryFile(suffix=".png") as second_media:
            media_path = str(Path(media_file.name).resolve())
            result = poster.comment(
                {"key": "g1", "url": "https://facebook.com/groups/g1"},
                content,
                [media_path, str(Path(second_media.name).resolve())],
            )

        self.assertEqual(result["status"], "SUCCESS")
        self.assertTrue(result["result_url"].endswith("/posts/p1"))
        self.assertEqual(textbox.content_entries, [content])
        self.assertEqual(media_input.paths, [media_path])

    def test_group_welcome_overlay_is_closed_before_commenting(self):
        class CloseButton:
            def is_displayed(self):
                return True

            def is_enabled(self):
                return True

        close_button = CloseButton()

        class Dialog:
            text = "Hey Tuan, welcome to Chợ Laptop & PC"
            visible = True

            def is_displayed(self):
                return self.visible

            def find_elements(self, _by, _xpath):
                return [close_button]

        dialog = Dialog()

        class Driver:
            def find_elements(self, _by, _xpath):
                return [dialog]

            def execute_script(self, _script, element):
                if element is close_button:
                    dialog.visible = False

        poster = FacebookGroupPoster({"uid": "100"}, threading.Event(), lambda *_: None)
        poster.driver = Driver()

        self.assertTrue(poster._dismiss_group_join_overlays())
        self.assertFalse(dialog.visible)

    def test_click_intercepted_error_is_sanitized_before_history(self):
        raw_error = (
            "Message: element click intercepted: Element <div role='textbox'> is not clickable at point. "
            "Other element would receive the click\nStacktrace:\nvery long selenium stack"
        )
        normalized = _friendly_automation_error(raw_error)
        self.assertEqual(normalized["error_code"], "ELEMENT_CLICK_INTERCEPTED")
        self.assertNotIn("Stacktrace", normalized["message"])

        job = CampaignJob(id="job-error", owner="owner-1", payload={})
        account = {"uid": "100", "id": 1}
        group = {"key": "g1", "url": "https://facebook.com/groups/g1"}
        self.manager._record_result(job, account, group, {
            "status": "FAILED",
            "message": raw_error,
        })
        saved = self.persistence.tasks[-1][1]
        self.assertEqual(saved["error_code"], "ELEMENT_CLICK_INTERCEPTED")
        self.assertNotIn("Stacktrace", saved["message"])

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


    def test_group_dto_compatibility(self):
        from modules.module_07_group_spam.app.schemas.request import GroupDTO
        from modules.module_07_group_spam.app.schemas.response import GroupResponse

        dto = GroupDTO(key="g123", url="https://facebook.com/groups/g123?ref=share", name="Test Group")
        self.assertEqual(_group_key(dto), "g123")
        self.assertEqual(_group_url(dto), "https://facebook.com/groups/g123")

        dto_uid = GroupDTO(id="987654321")
        self.assertEqual(_group_key(dto_uid), "987654321")
        self.assertEqual(_group_url(dto_uid), "https://www.facebook.com/groups/987654321")

        resp = GroupResponse(
            id="resp-1",
            key="resp-key",
            name="Response Group",
            url="facebook.com/groups/resp123",
            uid="resp123",
            frequency="10",
            members="1000",
            privacy="PUBLIC",
            already_posted=False,
        )
        self.assertEqual(_group_key(resp), "resp-key")
        self.assertEqual(_group_url(resp), "https://facebook.com/groups/resp123")

        d = {"url": "https://facebook.com/groups/dict123"}
        self.assertEqual(_group_key(d), "https://facebook.com/groups/dict123")
        self.assertEqual(_group_url(d), "https://facebook.com/groups/dict123")


    def test_join_group_already_joined_button(self):
        class Button:
            def __init__(self, text):
                self.text = text
            def is_displayed(self):
                return True

        class Driver:
            current_url = "https://facebook.com/groups/g1"
            def execute_script(self, _script, *args):
                return "complete"
            def get(self, url):
                pass
            def find_elements(self, by, xpath):
                if "Đã tham gia" in xpath or "Joined" in xpath:
                    return [Button("Đã tham gia")]
                return []

        poster = FacebookGroupPoster({"uid": "100"}, threading.Event(), lambda *_: None)
        poster.driver = Driver()
        result = poster.join_group({"url": "https://facebook.com/groups/g1"})
        self.assertEqual(result["status"], "ALREADY_MEMBER")
        self.assertIn("đã là thành viên", result["message"])


    def test_post_permalink_from_photo_link(self):
        class PhotoLink:
            def get_attribute(self, name):
                if name == "href":
                    return "https://web.facebook.com/photo/?fbid=1086588479681518&set=gm.2139698156722731&idorvanity=159341141325119"
                return None

        class Article:
            text = "demo bài viết"
            def is_displayed(self):
                return True
            def find_elements(self, _by, xpath):
                if "/photo" in xpath:
                    return [PhotoLink()]
                return []

        class Body:
            text = ""

        class Driver:
            current_url = "https://facebook.com/groups/159341141325119"
            def get(self, url):
                pass
            def execute_script(self, script, *args):
                return "complete"
            def find_elements(self, _by, xpath):
                if "role='article'" in xpath:
                    return [Article()]
                if "role='dialog'" in xpath:
                    return []
                return []
            def find_element(self, _by, _value):
                return Body()

        poster = FacebookGroupPoster({"uid": "100"}, threading.Event(), lambda *_: None)
        poster.driver = Driver()

        # Mock open_dialog and click_submit by simulating finding the permalink logic
        articles = poster.driver.find_elements("xpath", "//div[@role='article']")
        self.assertEqual(len(articles), 1)
        links = articles[0].find_elements("xpath", ".//a[contains(@href,'/photo')]")
        href_str = links[0].get_attribute("href")
        import re
        m = re.search(r"set=gm\.(\d+)", href_str)
        self.assertIsNotNone(m)
        self.assertEqual(m.group(1), "2139698156722731")

    def test_extract_comment_share_link_captures_copied_url(self):
        expected_url = "https://www.facebook.com/groups/159341141325119/posts/2144249519500928/?comment_id=998877"

        class Button:
            def __init__(self, label):
                self.label = label
                self.clicked = False

            def is_displayed(self):
                return True

        share_btn = Button("Share")
        copy_btn = Button("Copy link")

        class CommentNode:
            text = "Văn Văn Trinh\nDemo thôi nhé.\n6m Like Reply Share"

            def is_displayed(self):
                return True

            def find_elements(self, _by, xpath):
                if "Share" in xpath:
                    return [share_btn]
                return []

        class RootArticle:
            def find_elements(self, _by, xpath):
                if "role='article'" in xpath:
                    return [CommentNode()]
                return []

        class Driver:
            def __init__(self):
                self.copied = None
                self.menu_open = False

            def find_elements(self, _by, xpath):
                if "Copy link" in xpath and self.menu_open:
                    return [copy_btn]
                return []

            def execute_script(self, script, *args):
                if "arguments[0].click()" in script and args:
                    if args[0] is share_btn:
                        share_btn.clicked = True
                        self.menu_open = True
                    elif args[0] is copy_btn:
                        copy_btn.clicked = True
                        self.copied = expected_url
                if "return window.__fbCopiedCommentLink;" in script:
                    return self.copied
                return None

        poster = FacebookGroupPoster({"uid": "100"}, threading.Event(), lambda *_: None)
        poster.driver = Driver()

        copied_link = poster._extract_comment_share_link(RootArticle(), "Demo thôi nhé.")
        self.assertTrue(share_btn.clicked)
        self.assertTrue(copy_btn.clicked)
        self.assertEqual(copied_link, expected_url)

    def test_extract_comment_link_uses_timestamp_when_share_menu_is_absent(self):
        expected = "https://www.facebook.com/groups/159341141325119/posts/2144468799479000/?comment_id=2145171706075376"

        class Link:
            def __init__(self, href):
                self.href = href

            def get_attribute(self, name):
                return self.href if name == "href" else None

        class Button:
            def __init__(self):
                self.clicked = False

            def is_displayed(self):
                return True

        share = Button()

        class Comment:
            text = "Anh Nguyen\nhay quá\nChia sẻ"

            def is_displayed(self):
                return True

            def find_elements(self, _by, xpath):
                if "a[@href]" in xpath:
                    return [
                        Link("https://web.facebook.com/groups/159341141325119/user/100049941467173/"),
                        Link(expected + "&__tn__=R-R"),
                    ]
                if "Share" in xpath:
                    return [share]
                return []

        class Driver:
            def find_elements(self, _by, xpath):
                return [Comment()] if "role='article'" in xpath else []

            def execute_script(self, script, *args):
                if "arguments[0].click()" in script:
                    args[0].clicked = True
                return None

        poster = FacebookGroupPoster({"uid": "100049941467173"}, threading.Event(), lambda *_: None)
        poster.driver = Driver()
        actual = poster._extract_comment_share_link(Driver(), "hay quá")
        self.assertTrue(share.clicked)
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
