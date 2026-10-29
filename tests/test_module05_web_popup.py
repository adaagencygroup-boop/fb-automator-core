"""Standalone popup jobs, transaction isolation and account/web source switching."""
import copy
import json
import time
import unittest
from unittest.mock import patch

from tests import test_module05_meta as fixtures
from modules.module_05_page_manager import meta_web as web, meta_sync as sync
from modules.module_05_page_manager.routes_oauth_callback import router as callback_router


class WebPopupTests(unittest.TestCase):
    wait = fixtures.SyncTests.wait

    def setUp(self):
        fixtures.SyncTests.setUp(self)
        self.client.app.include_router(callback_router)
        item = patch.object(web, "db", self.db)
        item.start()
        self.addCleanup(item.stop)

    def start(self, owner="a", reason="connect"):
        response = self.client.post("/api/pages/web-oauth/start", headers={"X-User-Id": owner}, json={"reason": reason})
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()

    def complete(self, attempt, owner="a", error=""):
        response = self.client.post("/api/pages/web-oauth/complete", headers={"X-User-Id": owner}, json={
            "state": attempt["state"], "access_token": "raw-secret", "error": error,
        })
        self.assertEqual(response.status_code, 202, response.text)
        return self.wait(owner, attempt["job_id"])

    def connect(self, owner="a"):
        attempt = self.start(owner)
        self.assertEqual(self.complete(attempt, owner)["status"], "AWAITING_CONFIRMATION")
        sync.confirm(owner, attempt["job_id"], True)
        result = self.wait(owner, attempt["job_id"], ("SUCCEEDED", "FAILED"))
        self.assertEqual(result["status"], "SUCCEEDED", result)
        return result

    def test_independent_connection_without_module2_account_and_no_token_response(self):
        self.db.execute("DELETE FROM accounts WHERE user_id='a'")
        result = self.connect()
        self.assertEqual(result["result"]["identity"]["name"], "Facebook Person")
        self.assertEqual(self.db.fetch_one("SELECT COUNT(*) AS c FROM accounts WHERE user_id='a'")["c"], 0)
        page = self.db.fetch_one("SELECT * FROM pages WHERE user_id='a'")
        self.assertIsNone(page["account_uid"])
        self.assertIsNotNone(page["web_connection_id"])
        public = self.client.get("/api/pages/web-connection", headers={"X-User-Id": "a"})
        self.assertTrue(public.json()["connected"])
        self.assertNotIn("secret", public.text)
        self.assertNotIn("access_token", public.text)

    def test_single_active_job_resume_after_reload_and_cancel_invalidates_state(self):
        attempt = self.start()
        duplicate = self.client.post("/api/pages/web-oauth/start", headers={"X-User-Id": "a"}, json={})
        self.assertEqual(duplicate.status_code, 400)
        state = web.connection_status("a")
        self.assertEqual(state["active_job"]["job_id"], attempt["job_id"])
        self.assertEqual(web.connection_status("b")["active_job"], None)
        web.cancel("a", attempt["job_id"])
        response = self.client.post("/api/pages/web-oauth/complete", headers={"X-User-Id": "a"}, json={"state": attempt["state"], "access_token": "raw"})
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(self.db.fetch_one("SELECT * FROM meta_web_connections"))

    def test_owner_app_state_replay_and_restart_boundaries(self):
        attempt = self.start()
        for owner in ("b",):
            response = self.client.post("/api/pages/web-oauth/complete", headers={"X-User-Id": owner}, json={"state": attempt["state"], "access_token": "raw"})
            self.assertEqual(response.status_code, 400)
        with patch.dict("os.environ", {"FACEBOOK_APP_ID": "other-app"}):
            with self.assertRaises(ValueError):
                web.complete("a", attempt["state"], "raw")
        self.complete(attempt)
        with self.assertRaises(ValueError):
            web.complete("a", attempt["state"], "raw")
        web.cancel("a", attempt["job_id"])
        next_attempt = self.start()
        sync._jobs.clear()  # Model engine restart: do not silently create/retry a job.
        response = self.client.post("/api/pages/web-oauth/complete", headers={"X-User-Id": "a"}, json={"state": next_attempt["state"], "access_token": "raw"})
        self.assertEqual(response.status_code, 404)

    def test_expired_oauth_denied_permissions_and_identity_decline(self):
        attempt = self.start()
        self.db.execute("UPDATE meta_oauth_states SET expires_at='2000-01-01'")
        sync._jobs[attempt["job_id"]]["expires"] = 1
        self.assertEqual(sync.status("a", attempt["job_id"])["status"], "FAILED")
        with self.assertRaises(ValueError):
            web.complete("a", attempt["state"], "raw")
        denied = self.start()
        self.assertEqual(self.complete(denied, error="access_denied")["status"], "FAILED")
        declined = self.start()
        self.complete(declined)
        sync.confirm("a", declined["job_id"], False)
        self.assertEqual(sync.status("a", declined["job_id"])["status"], "CANCELLED")
        self.assertIsNone(self.db.fetch_one("SELECT * FROM meta_web_connections"))

    def test_cancel_rejected_while_worker_is_running_or_committing(self):
        attempt = self.start()
        for status in ("QUEUED", "RUNNING", "COMMITTING", "SUCCEEDED"):
            sync._jobs[attempt["job_id"]]["status"] = status
            with self.subTest(status=status), self.assertRaises(ValueError):
                web.cancel("a", attempt["job_id"])
            self.assertEqual(sync._jobs[attempt["job_id"]]["status"], status)

    def test_switch_same_identity_does_not_claim_account_changed(self):
        self.connect()
        before = self.db.fetch_one("SELECT * FROM meta_web_connections")
        attempt = self.start(reason="switch")
        self.assertEqual(attempt["previous_identity"]["name"], "Facebook Person")
        result = self.complete(attempt)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error_code"], "SAME_FACEBOOK_IDENTITY")
        self.assertIn("Meta vẫn trả về", result["error"])
        self.assertEqual(self.db.fetch_one("SELECT * FROM meta_web_connections"), before)

    def test_switch_new_identity_keeps_old_pages_and_connections(self):
        self.connect()
        self.fb.get_user_profile.return_value = {"id": "other-person", "name": "Person B"}
        self.fb.inspect_token.side_effect = lambda token, **kwargs: {**fixtures.META, "user_id": "other-person"}
        self.fb.fetch_managed_pages.return_value = [{"id": "99", "name": "Other Page", "access_token": "other-page-token"}]
        attempt = self.start(reason="switch")
        result = self.complete(attempt)
        self.assertEqual(result["identity"]["name"], "Person B")
        self.assertEqual(web.connection_status("a")["identity"]["name"], "Facebook Person")
        sync.confirm("a", attempt["job_id"], True)
        self.assertEqual(self.wait("a", attempt["job_id"], ("SUCCEEDED", "FAILED"))["status"], "SUCCEEDED")
        self.assertEqual(web.connection_status("a")["identity"]["name"], "Person B")
        self.assertEqual(self.db.fetch_one("SELECT COUNT(*) AS c FROM meta_web_connections")["c"], 2)
        self.assertEqual(self.db.fetch_one("SELECT COUNT(*) AS c FROM pages WHERE user_id='a'")["c"], 2)

    def test_db_failure_rolls_back_current_identity_tokens_and_pages(self):
        self.connect()
        before = self.db.fetch_one("SELECT * FROM meta_web_connections")
        attempt = self.start()
        self.complete(attempt)
        self.db.fail_page = True
        sync.confirm("a", attempt["job_id"], True)
        result = self.wait("a", attempt["job_id"], ("SUCCEEDED", "FAILED"))
        self.assertEqual(result["status"], "FAILED")
        self.assertNotIn("secret", json.dumps(result))
        self.assertEqual(self.db.fetch_one("SELECT * FROM meta_web_connections"), before)
        self.assertEqual(self.db.fetch_one("SELECT access_token FROM pages")["access_token"], "page-secret")

    def test_resync_uses_stored_token_without_exchange_or_identity_confirmation(self):
        self.connect()
        self.fb.exchange_token.reset_mock()
        job = web.resync("a")
        self.assertEqual(self.wait("a", job["job_id"])["status"], "SUCCEEDED")
        self.fb.exchange_token.assert_not_called()
        self.fb.inspect_token.assert_any_call("long-secret")

    def test_token_expiry_is_visible_without_returning_token(self):
        self.connect()
        self.db.execute("UPDATE meta_web_connections SET token_metadata = ?", (json.dumps({"is_valid": True, "expires_at": 1}),))
        self.assertEqual(web.connection_status("a")["token_state"], "expired")

    def test_same_page_between_owners_and_account_web_source_switching(self):
        a = self.connect("a")
        self.connect("b")
        a_id = a["result"]["connection_id"]
        self.assertEqual(self.db.fetch_one("SELECT COUNT(*) AS c FROM pages WHERE page_id='42'")["c"], 2)
        prepared = sync.prepare("a", "111", "raw")
        sync.save("a", "111", prepared)
        row = self.db.fetch_one("SELECT * FROM pages WHERE user_id='a'")
        self.assertEqual(row["account_uid"], "111")
        self.assertIsNone(row["web_connection_id"])
        self.assertIsNotNone(self.db.fetch_one("SELECT web_connection_id FROM pages WHERE user_id='b'")["web_connection_id"])
        resync = web.resync("a")
        self.wait("a", resync["job_id"])
        row = self.db.fetch_one("SELECT * FROM pages WHERE user_id='a'")
        self.assertIsNone(row["account_uid"])
        self.assertEqual(row["web_connection_id"], a_id)

    def test_managed_and_reels_show_standalone_manager_names_without_tokens(self):
        from modules.module_05_page_manager import routes_pages, routes_reels
        self.connect()
        # Use row fixtures for account metadata not present in the minimal SQL fixture.
        for module, path in ((routes_pages, "managed"), (routes_reels, "reels/accounts-pages")):
            with patch.object(module, "db") as db:
                db.fetch_all.side_effect = lambda sql, params: (
                    [{"id": 1, "page_id": "42", "page_name": "Page", "web_connection_id": 1, "account_uid": None}]
                    if "FROM pages" in sql else [{"id": 1, "facebook_name": "Facebook Person"}]
                    if "FROM meta_web_connections" in sql else [])
                response = self.client.get("/api/pages/" + path, headers={"X-User-Id": "a"})
                self.assertEqual(response.status_code, 200)
                self.assertIn("Facebook Person", response.text)
                self.assertNotIn("access_token", response.text)
                if path == "managed":
                    self.assertEqual(response.json()["pages"][0]["manager_kind"], "web")
                else:
                    group = response.json()["accounts"][0]
                    self.assertEqual(group["group_key"], "web:1")
                    self.assertIsNone(group["account_uid"])

    def test_oauth_callback_page_renders_html_with_title_and_script(self):
        res = self.client.get("/oauth/meta/callback")
        self.assertEqual(res.status_code, 200)
        self.assertIn("Facebook Automator Pro", res.text)
        self.assertIn("callback-submit", res.text)
        self.assertEqual(res.headers["cache-control"], "no-store, no-cache, must-revalidate, max-age=0")
        self.assertEqual(res.headers["referrer-policy"], "no-referrer")
        self.assertIn("noindex", res.headers["x-robots-tag"])

    def test_oauth_callback_submit_completes_job_with_valid_state(self):
        attempt = self.start("a")
        res = self.client.post("/api/pages/web-oauth/callback-submit", json={
            "state": attempt["state"],
            "access_token": "raw-secret",
        })
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["success"])
        result = self.wait("a", attempt["job_id"], ("SUCCEEDED", "FAILED"))
        self.assertEqual(result["status"], "SUCCEEDED", result)

    def test_oauth_callback_submit_forwards_facebook_denial_to_job(self):
        attempt = self.start("a")
        res = self.client.post("/api/pages/web-oauth/callback-submit", json={
            "state": attempt["state"],
            "error": "access_denied",
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "FAILED")
        result = self.wait("a", attempt["job_id"], ("FAILED",))
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(self.db.fetch_one("SELECT COUNT(*) AS c FROM meta_web_connections")["c"], 0)

    def test_oauth_callback_submit_with_valid_state_but_no_result_fails_job(self):
        attempt = self.start("a")
        res = self.client.post("/api/pages/web-oauth/callback-submit", json={
            "state": attempt["state"],
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "FAILED")
        result = self.wait("a", attempt["job_id"], ("FAILED",))
        self.assertEqual(result["status"], "FAILED")

    def test_oauth_callback_submit_with_invalid_state_returns_400(self):
        res = self.client.post("/api/pages/web-oauth/callback-submit", json={
            "state": "invalid_or_expired_state",
            "access_token": "raw-secret",
        })
        self.assertEqual(res.status_code, 400)
