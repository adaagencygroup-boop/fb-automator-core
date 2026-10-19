"""OAuth/transaction regressions. Run with scripts/test_module5_offline.py."""
import copy
import json
import os
import re
import sqlite3
import threading
import time
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.facebook.fb_graph_client import FacebookGraphClient
from modules.module_05_page_manager import meta_sync as sync
from modules.module_05_page_manager.meta_config import REQUIRED_SCOPES
from modules.module_05_page_manager.routes_pages import router
from modules.module_05_page_manager.routes_reels import router as reels_router
from modules.module_05_page_manager.reels_runner import ReelsTaskRunner
from modules.module_02_account_manager.context import owner_scope

ENV = {"FACEBOOK_APP_ID": "app", "FACEBOOK_APP_SECRET": "secret",
       "FACEBOOK_OAUTH_CALLBACK_URL": "https://dashboard.example/oauth/meta/callback"}
META = {"app_id": "app", "user_id": "app-scoped-123", "type": "USER", "is_valid": True,
        "scopes": sorted(REQUIRED_SCOPES), "expires_at": 4102444800}


class IsolatedDB:
    """SQL transaction adapter; exercise actual upserts/rollback on an isolated DB."""
    def __init__(self):
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.fail_page = False
        self.conn.executescript("""
            CREATE TABLE accounts (user_id TEXT, uid TEXT, profile_name TEXT, token TEXT, proxy TEXT,
                status TEXT DEFAULT 'DIE', login_status TEXT DEFAULT 'ERROR', PRIMARY KEY(user_id,uid));
            INSERT INTO accounts (user_id,uid,token) VALUES ('a','111','old-a'),('b','111','old-b'),('a','222','old-2');
            CREATE TABLE pages (id INTEGER PRIMARY KEY, user_id TEXT, page_id TEXT, page_name TEXT, access_token TEXT,
                category TEXT, account_uid TEXT, status TEXT, token_metadata TEXT, updated_at TEXT, reels_folder TEXT, web_connection_id INTEGER,
                UNIQUE(user_id,page_id));
            CREATE TABLE meta_account_connections (user_id TEXT, account_uid TEXT, app_id TEXT,
                app_scoped_user_id TEXT, facebook_name TEXT, token_metadata TEXT, updated_at TEXT,
                PRIMARY KEY(user_id,account_uid,app_id), UNIQUE(user_id,app_id,app_scoped_user_id));
            CREATE TABLE posting_progress (user_id TEXT, page_id TEXT, post_type TEXT, last_folder_index INT,
                last_video_id TEXT, updated_at TEXT, UNIQUE(user_id,page_id,post_type));
            CREATE TABLE posting_history (user_id TEXT,page_id TEXT,account_uid TEXT,post_type TEXT,caption TEXT,
                media_path TEXT,status TEXT,error_message TEXT,post_url TEXT,posted_at TEXT);
            CREATE TABLE meta_oauth_states (state_hash TEXT PRIMARY KEY, user_id TEXT, account_uid TEXT,
                app_id TEXT, flow TEXT, expires_at TEXT, consumed_at TEXT, job_id TEXT);
            CREATE TABLE downloaded_videos (id INTEGER PRIMARY KEY, user_id TEXT, page_id TEXT, source TEXT,
                video_id TEXT, caption TEXT, link TEXT, object_path TEXT, UNIQUE(user_id,page_id,source,video_id));
            CREATE TABLE download_logs (user_id TEXT,page_id TEXT,source TEXT,video_id TEXT,object_path TEXT,status TEXT);
            CREATE TABLE meta_web_connections (id INTEGER PRIMARY KEY, user_id TEXT, app_id TEXT, app_scoped_user_id TEXT,
                facebook_name TEXT, user_access_token TEXT, token_metadata TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id,app_id,app_scoped_user_id));
        """)

    @contextmanager
    def session(self):
        db = self
        class Cursor:
            def execute(self, sql, params=()):
                if db.fail_page and "INSERT INTO pages" in sql:
                    raise sqlite3.OperationalError("write failed secret-token")
                sql = sql.replace("NOW() + INTERVAL '10 minutes'", "datetime('now', '+10 minutes')")
                sql = sql.replace("%s", "?").replace("::jsonb", "").replace(" FOR UPDATE", "").replace("NOW()", "CURRENT_TIMESTAMP")
                sql = re.sub(r"UPDATE (\w+) ([patj]) SET", r"UPDATE \1 AS \2 SET", sql)
                self.cur = db.conn.execute(sql, params)
            def fetchone(self):
                row = self.cur.fetchone()
                return dict(row) if row else None
            def fetchall(self):
                return [dict(row) for row in self.cur.fetchall()]
        with self.lock:
            try:
                yield Cursor()
                self.conn.commit()
            except Exception:
                self.conn.rollback()
                raise

    def fetch_one(self, sql, params=()):
        with self.session() as cur:
            cur.execute(sql, params)
            return cur.fetchone()

    def execute(self, sql, params=()):
        with self.session() as cur:
            cur.execute(sql, params)

    def fetch_all(self, sql, params=()):
        with self.session() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


class GraphTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, ENV)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = FacebookGraphClient()

    def response(self, payload, code=200):
        return MagicMock(status_code=code, json=lambda: payload)

    def test_token_validation_app_scopes_expiry_type(self):
        for override in ({"app_id": "wrong"}, {"is_valid": False}, {"expires_at": 1},
                         {"data_access_expires_at": 1}, {"scopes": ["pages_show_list"]},
                         {"type": "PAGE"}, {"user_id": ""}):
            with self.subTest(override=override), patch.object(self.client.session, "get", return_value=self.response({"data": {**META, **override}})):
                with self.assertRaises(ValueError):
                    self.client.inspect_token("token")

    def test_missing_permissions_named(self):
        with patch.object(self.client, "_get_json", return_value={"data": {**META, "scopes": []}}):
            with self.assertRaises(ValueError) as error:
                self.client.inspect_token("token")
            self.assertTrue(all(scope in str(error.exception) for scope in REQUIRED_SCOPES))

    def test_page_no_fixed_expiry_requires_explicit_zero(self):
        for expiry in (0, None):
            data = {**META, "type": "PAGE"}
            if expiry is None:
                data.pop("expires_at")
            else:
                data["expires_at"] = expiry
            with patch.object(self.client, "_get_json", return_value={"data": data}):
                result = self.client.inspect_token("page", user=False)
                self.assertEqual("expires_at" in result, expiry == 0)

    def test_exchange_configuration_and_failure_never_fallback(self):
        with patch.dict(os.environ, {"FACEBOOK_APP_SECRET": ""}):
            with self.assertRaises(ValueError):
                self.client.exchange_token("short")
        with patch.object(self.client.session, "get", return_value=self.response({"error": {"code": 190, "message": "short"}}, 400)):
            with self.assertRaises(RuntimeError) as error:
                self.client.exchange_token("short")
            self.assertNotIn("short", str(error.exception))

    def test_pagination_deduplicates_and_does_not_exchange(self):
        page = {"id": "42", "name": "Page", "access_token": "page-token"}
        with patch.object(self.client, "exchange_token") as exchange, patch.object(self.client.session, "get", side_effect=[
            self.response({"data": [page], "paging": {"next": "https://graph.facebook.com/v20.0/me/accounts?after=cursor"}}),
            self.response({"data": [page, {**page, "id": "43"}]}),
        ]) as get:
            self.assertEqual([p["id"] for p in self.client.fetch_managed_pages("long")], ["42", "43"])
            exchange.assert_not_called()
            self.assertEqual(get.call_args.kwargs["params"]["after"], "cursor")

    def test_pagination_partial_errors_and_missing_page_token_fail(self):
        page = {"id": "42", "name": "Page", "access_token": "page"}
        for bad in ({"data": [{"id": "bad", "name": "Bad"}]}, {"error": {"code": 190}}):
            with patch.object(self.client.session, "get", side_effect=[
                self.response({"data": [page], "paging": {"next": "https://graph.facebook.com/me/accounts?after=a"}}),
                self.response(bad),
            ]):
                with self.assertRaises((ValueError, RuntimeError)):
                    self.client.fetch_managed_pages("token")
        with patch.object(self.client.session, "get", side_effect=[
            self.response({"data": [page], "paging": {"next": "https://graph.facebook.com/me/accounts?after=a"}}),
            OSError("url?access_token=secret"),
        ]):
            with self.assertRaises(RuntimeError) as error:
                self.client.fetch_managed_pages("token")
            self.assertNotIn("secret", str(error.exception))


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.db = IsolatedDB()
        self.addCleanup(self.db.conn.close)
        self.patches = [patch.dict(os.environ, ENV), patch.object(sync, "db", self.db)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.fb = MagicMock()
        self.fb.inspect_token.side_effect = lambda token, **kwargs: {**copy.deepcopy(META), **({"type": "PAGE", "expires_at": 0} if kwargs else {})}
        self.fb.exchange_token.return_value = "long-secret"
        self.fb.get_user_profile.return_value = {"id": META["user_id"], "name": "Facebook Person"}
        self.fb.fetch_managed_pages.return_value = [{"id": "42", "name": "Page", "access_token": "page-secret", "category": "News"}]
        item = patch.object(sync, "fb_client", self.fb)
        item.start()
        self.addCleanup(item.stop)
        with sync._lock:
            sync._jobs.clear()
        app = FastAPI()
        app.include_router(router, prefix="/api")
        app.include_router(reels_router, prefix="/api")
        self.client = TestClient(app)

    def wait(self, owner, job_id, terminal=("SUCCEEDED", "FAILED", "AWAITING_CONFIRMATION", "CANCELLED")):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            status = sync.status(owner, job_id)
            if status["status"] in terminal:
                return status
            time.sleep(.005)
        self.fail("Worker did not finish")

    def prepared(self, owner="a", uid="111"):
        return sync.prepare(owner, uid, "raw-secret")

    def test_app_scoped_id_link_requires_confirmation_and_no_new_account(self):
        response = self.client.post("/api/pages/sync-by-token", json={"account_uid": "111", "access_token": "raw-secret"}, headers={"X-User-Id": "a"})
        self.assertEqual(response.status_code, 202)
        job = response.json()["job_id"]
        status = self.wait("a", job)
        self.assertEqual(status["status"], "AWAITING_CONFIRMATION")
        self.assertEqual(status["identity"]["id"], META["user_id"])
        self.assertEqual(self.db.fetch_one("SELECT token FROM accounts WHERE user_id='a' AND uid='111'")["token"], "old-a")
        self.assertNotIn("secret", json.dumps(status))
        self.assertEqual(self.client.get(f"/api/pages/sync-jobs/{job}", headers={"X-User-Id": "b"}).status_code, 404)
        self.client.post(f"/api/pages/sync-jobs/{job}/confirm", json={"accept": True}, headers={"X-User-Id": "a"})
        self.assertEqual(self.wait("a", job, ("SUCCEEDED", "FAILED"))["status"], "SUCCEEDED")
        account = self.db.fetch_one("SELECT * FROM accounts WHERE user_id='a' AND uid='111'")
        self.assertEqual((account["token"], account["status"], account["login_status"]), ("long-secret", "DIE", "ERROR"))
        self.assertIsNone(self.db.fetch_one("SELECT uid FROM accounts WHERE uid=?", (META["user_id"],)))
        self.fb.exchange_token.assert_called_once()

    def test_identity_mismatch_exchange_failure_scan_failure_do_not_write(self):
        sync.save("a", "111", self.prepared())
        before = self.db.fetch_one("SELECT * FROM pages")
        self.fb.inspect_token.side_effect = lambda *a, **k: {**META, "user_id": "wrong"}
        self.fb.get_user_profile.return_value = {"id": "wrong", "name": "Wrong Person"}
        with self.assertRaisesRegex(ValueError, "Danh tính"):
            self.prepared()
        self.assertEqual(self.db.fetch_one("SELECT * FROM pages"), before)
        self.fb.exchange_token.side_effect = RuntimeError("exchange failure")
        with self.assertRaises(RuntimeError):
            self.prepared()
        self.assertEqual(self.db.fetch_one("SELECT * FROM pages"), before)

    def test_page_scan_failure_preserves_account_and_pages(self):
        self.fb.fetch_managed_pages.side_effect = RuntimeError("pagination failure")
        job = sync.submit("a", "111", sync.sync_task("a", "111", "raw"))
        self.assertEqual(self.wait("a", job["job_id"])["status"], "FAILED")
        self.assertEqual(self.db.fetch_one("SELECT token FROM accounts WHERE user_id='a' AND uid='111'")["token"], "old-a")
        self.assertIsNone(self.db.fetch_one("SELECT * FROM pages"))

    def test_write_failure_rolls_back_token_connection_and_pages(self):
        prepared = self.prepared()
        self.db.fail_page = True
        with self.assertRaises(sqlite3.OperationalError):
            sync.save("a", "111", prepared)
        self.assertEqual(self.db.fetch_one("SELECT token FROM accounts WHERE user_id='a' AND uid='111'")["token"], "old-a")
        self.assertIsNone(self.db.fetch_one("SELECT * FROM meta_account_connections"))
        self.assertIsNone(self.db.fetch_one("SELECT * FROM pages"))

    def test_two_owners_same_page_and_latest_account_idempotence(self):
        a = self.prepared()
        sync.save("a", "111", a)
        b = self.prepared("b")
        b["pages"][0]["access_token"] = "owner-b-token"
        sync.save("b", "111", b)
        sync.save("a", "111", a)
        self.assertEqual(self.db.fetch_one("SELECT COUNT(*) AS c FROM pages")["c"], 2)
        self.assertEqual(self.db.fetch_one("SELECT access_token FROM pages WHERE user_id='b'")["access_token"], "owner-b-token")
        a["identity"]["id"] = "other-app-scoped"
        sync.save("a", "222", a)
        self.assertEqual(self.db.fetch_one("SELECT account_uid FROM pages WHERE user_id='a'")["account_uid"], "222")
        self.assertEqual(self.db.fetch_one("SELECT account_uid FROM pages WHERE user_id='b'")["account_uid"], "111")

    def test_confirmation_expiry_cancellation_and_duplicate_refusal(self):
        job = sync.submit("a", "111", sync.sync_task("a", "111", "raw"))["job_id"]
        self.wait("a", job)
        with self.assertRaises(ValueError):
            sync.submit("a", "111", lambda j: None)
        with self.assertRaises(KeyError):
            sync.confirm("b", job, True)
        sync.confirm("a", job, False)
        self.assertEqual(sync.status("a", job)["status"], "CANCELLED")
        next_job = sync.submit("a", "111", sync.sync_task("a", "111", "raw"))["job_id"]
        self.wait("a", next_job)
        sync._jobs[next_job]["expires"] = 1
        with self.assertRaises(ValueError):
            sync.confirm("a", next_job, True)
        self.assertNotIn("prepared", sync._jobs[next_job])

    def test_executor_limits_two_workers_and_propagates_each_owner(self):
        from modules.module_02_account_manager.context import owner_context
        release = threading.Event()
        started = []
        lock = threading.Lock()
        def task(job):
            with lock:
                started.append(owner_context.get())
            release.wait(3)
            return {"success": True, "message": "done"}
        jobs = []
        try:
            for owner, uid in (("a", "111"), ("b", "111"), ("a", "222")):
                jobs.append((owner, sync.submit(owner, uid, task)["job_id"]))
            deadline = time.monotonic() + 2
            while len(started) < 2 and time.monotonic() < deadline:
                time.sleep(.005)
            self.assertEqual(len(started), 2)
            self.assertEqual(set(started), {"a", "b"})
            self.assertEqual(sync.status(*jobs[2])["status"], "QUEUED")
        finally:
            release.set()
            for owner, job in jobs:
                self.wait(owner, job, ("SUCCEEDED", "FAILED"))

    def test_state_invalid_expired_reused_and_owner_flow_binding(self):
        first = sync.create_state("a", "111", "web")
        second = sync.create_state("a", "111", "web")
        self.assertNotEqual(first["state"], second["state"])
        from urllib.parse import urlsplit, parse_qs
        query = parse_qs(urlsplit(first["authorization_url"]).query)
        self.assertEqual(set(query["scope"][0].split(",")), REQUIRED_SCOPES)
        for state, owner, flow, uid in (("invalid", "a", "web", None), (first["state"], "b", "web", None),
                                       (first["state"], "a", "profile", None), (first["state"], "a", "web", "222")):
            with self.subTest(state=state, owner=owner, flow=flow, uid=uid), self.assertRaises(ValueError):
                sync.consume_state(state, owner, flow, uid)
        self.assertEqual(sync.consume_state(first["state"], "a", "web"), "111")
        with self.assertRaises(ValueError):
            sync.consume_state(first["state"], "a", "web")
        self.db.execute("UPDATE meta_oauth_states SET expires_at='2000-01-01'")
        with self.assertRaises(ValueError):
            sync.consume_state(second["state"], "a", "web")

    def test_web_callback_denial_consumes_state_and_requires_same_owner(self):
        state = sync.create_state("a", "111", "web")["state"]
        for owner, error in (("b", ""), ("a", "access_denied"), ("a", "")):
            response = self.client.post("/api/pages/sync-by-token", headers={"X-User-Id": owner},
                                        json={"state": state, "error": error, "access_token": "raw"})
            self.assertEqual(response.status_code, 400)
        self.assertIsNone(self.db.fetch_one("SELECT * FROM pages"))

    def test_profile_uid_before_and_after_oauth_and_lock_release(self):
        from urllib.parse import urlencode
        for cookies, returned in ((["wrong"], "success"), (["111", "wrong"], "success"),
                                  (["111", "111"], "success"), (["111"], "denied"),
                                  (["111"], "wrong-state"), (["111"], "checkpoint")):
            with self.subTest(cookies=cookies, returned=returned):
                driver = MagicMock()
                driver.get_cookie.side_effect = [{"value": uid} for uid in cookies]
                def navigate(url):
                    if "/dialog/oauth?" in url:
                        from urllib.parse import urlsplit, parse_qs
                        state = parse_qs(urlsplit(url).query)["state"][0]
                        if returned == "wrong-state":
                            state = "bad"
                        payload = {"state": state, "access_token": "raw"} if returned != "denied" else {"state": state, "error": "access_denied"}
                        driver.current_url = ENV["FACEBOOK_OAUTH_CALLBACK_URL"] + "#" + urlencode(payload)
                        if returned == "checkpoint":
                            driver.current_url = "https://www.facebook.com/checkpoint/"
                driver.get.side_effect = navigate
                lock = threading.Lock()
                with patch("core.browser.open_browser", return_value=driver), patch("core.browser.get_profile_lock", return_value=lock), patch("core.browser.safe_close_driver") as close:
                    if cookies == ["111", "111"]:
                        result = sync.profile_task("a", "111")({})
                        self.assertTrue(result["success"])
                    else:
                        with self.assertRaises(ValueError):
                            sync.profile_task("a", "111")({})
                    close.assert_called_once_with(driver)
                    self.assertFalse(lock.locked())

    def test_profile_busy_does_not_open_or_retry_browser(self):
        lock = MagicMock()
        lock.acquire.return_value = False
        with patch("core.browser.get_profile_lock", return_value=lock), patch("core.browser.open_browser") as open_browser:
            with self.assertRaises(ValueError):
                sync.profile_task("a", "111")({})
            open_browser.assert_not_called()
            lock.release.assert_not_called()

    def test_ai_runner_state_isolated_by_owner(self):
        from modules.module_05_page_manager import ai_job
        with owner_scope("a-test"):
            ai_job._log("Only owner a")
            ai_job._state_for()["running"] = True
        with owner_scope("b-test"):
            self.assertFalse(ai_job.snapshot()["running"])
            self.assertNotIn("Only owner a", json.dumps(ai_job.snapshot()))
            self.assertFalse(ai_job.request_stop())
        with owner_scope("a-test"):
            self.assertTrue(ai_job.request_stop())
            ai_job._state_for()["running"] = False

    def test_reels_owner_progress_history_and_runner_state(self):
        with patch("modules.module_05_page_manager.reels_runner.db", self.db):
            a, b = ReelsTaskRunner("a-test"), ReelsTaskRunner("b-test")
            a._save_progress("42", 9, "a")
            b._save_progress("42", 3, "b")
            a._save_history("42", "111", "caption-a", "video", "SUCCESS", None)
            b._save_history("42", "111", "caption-b", "video", "SUCCESS", None)
            a.log("owner a only")
            self.assertNotIn("owner a only", json.dumps(b.get_status()))
            self.assertEqual(self.db.fetch_one("SELECT last_folder_index FROM posting_progress WHERE user_id='b-test'")["last_folder_index"], 3)
            self.assertEqual(self.db.fetch_one("SELECT caption FROM posting_history WHERE user_id='a-test'")["caption"], "caption-a")

    def test_reels_rejects_foreign_page_and_ignores_client_token(self):
        from modules.module_05_page_manager import routes_reels
        with patch.object(routes_reels, "db", self.db):
            response = self.client.post("/api/pages/reels/start", headers={"X-User-Id": "a"}, json={
                "root_dir": ".", "pages_config": [{"page_id": "foreign", "access_token": "forged"}]})
            self.assertEqual(response.status_code, 404)
            sync.save("a", "111", self.prepared())
            with patch.object(ReelsTaskRunner, "start_job", return_value={"success": True}) as start:
                response = self.client.post("/api/pages/reels/start", headers={"X-User-Id": "a"}, json={
                    "root_dir": ".", "pages_config": [{"page_id": "42", "access_token": "forged", "account_uid": "forged"}]})
                self.assertEqual(response.status_code, 200)
                page = start.call_args.args[0]["pages_config"][0]
                self.assertNotIn("access_token", page)
                self.assertEqual(page["account_uid"], "111")

    def test_downloads_deduplicate_per_owner_and_do_not_use_client_pages(self):
        from modules.module_05_page_manager import owned_data
        with patch.object(owned_data, "db", self.db):
            sync.save("a", "111", self.prepared())
            self.assertEqual(owned_data.pages_for("b", ["42"]), [])
            self.assertEqual(owned_data.pages_for("a", ["42"])[0]["access_token"], "page-secret")
            owned_data.record_download("a", "42", "YOUTUBE", "video", "caption-a", "url", "a/video.mp4")
            owned_data.record_download("a", "42", "YOUTUBE", "video", "caption-a", "url", "a/video.mp4")
            self.assertTrue(owned_data.video_exists("a", "42", "YOUTUBE", "video"))
            self.assertFalse(owned_data.video_exists("b", "42", "YOUTUBE", "video"))
            owned_data.record_download("b", "42", "YOUTUBE", "video", "caption-b", "url", "b/video.mp4")
            owned_data.record_download("a", "42", "YOUTUBE", "failed", "", "url", "", success=False)
            self.assertEqual(self.db.fetch_one("SELECT COUNT(*) AS c FROM downloaded_videos")["c"], 2)
            self.assertEqual(self.db.fetch_one("SELECT COUNT(*) AS c FROM download_logs WHERE user_id='a'")["c"], 3)
            self.assertNotEqual(owned_data.download_root("downloads", "a"), owned_data.download_root("downloads", "b"))
            with self.assertRaises(ValueError):
                owned_data.pages_for(None)

    def test_sync_accounts_endpoint_never_selects_or_returns_raw_tokens(self):
        from modules.module_05_page_manager import routes_pages
        with patch.object(routes_pages, "db") as db:
            db.fetch_all.return_value = [{"uid": "111", "has_token": True, "profile_name": "Profile", "status": "DIE"}]
            response = self.client.get("/api/pages/accounts", headers={"X-User-Id": "a"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["accounts"][0]["has_token"], True)
            self.assertNotIn("token", response.json()["accounts"][0])
            self.assertEqual(db.fetch_all.call_args.args[1], ("a",))

    def test_token_check_does_not_report_live_for_wrong_app_or_missing_scopes(self):
        from modules.module_05_page_manager import routes_pages
        with patch.object(routes_pages, "db") as db, patch.object(routes_pages.requests, "get") as get:
            db.fetch_all.return_value = [{"uid": "111", "token": "raw-secret"}]
            get.return_value = MagicMock(status_code=200, json=lambda: {"id": "123", "name": "Facebook Person"})
            for reason in ("Token thuộc App ID khác.", "Thiếu quyền: pages_messaging"):
                with patch.object(routes_pages.fb_client, "inspect_token", side_effect=ValueError(reason)):
                    response = self.client.post("/api/pages/tokens/verify", headers={"X-User-Id": "a"}, json={})
                    result = response.json()["results"]["111"]
                    self.assertEqual(result["status"], "ERROR")
                    self.assertEqual(result["message"], reason)

    def test_migration_backfills_only_unambiguous_owners_and_preserves_ids(self):
        from modules.module_05_page_manager.meta_migration import _backfill_owners
        self.db.conn.executescript("""
            INSERT INTO pages (id,page_id,account_uid,user_id) VALUES
                (10,'42','222',NULL),(11,'43','111',NULL),(12,'44',NULL,'b'),(13,'45',NULL,NULL),
                (14,'99',NULL,'a'),(15,'99',NULL,'b');
            INSERT INTO posting_progress (page_id,post_type) VALUES ('42','REEL'),('43','REEL'),('99','REEL');
            CREATE TABLE posting_schedules (id INTEGER PRIMARY KEY, user_id TEXT, page_id TEXT, schedule_type TEXT);
            INSERT INTO posting_schedules VALUES (1,NULL,'42','REEL'),(2,NULL,'43','REEL');
            CREATE TABLE page_jobs (id INTEGER PRIMARY KEY, user_id TEXT);
            INSERT INTO page_jobs VALUES (1,NULL),(2,NULL),(3,NULL);
            CREATE TABLE page_job_items (id INTEGER PRIMARY KEY,user_id TEXT,page_id TEXT,job_id INTEGER);
            INSERT INTO page_job_items VALUES (1,NULL,'42',1),(2,NULL,'42',2),(3,NULL,'44',2),(4,NULL,'45',3);
        """)
        before = [row["id"] for row in self.db.fetch_all("SELECT id FROM pages ORDER BY id")]
        with self.db.session() as cur:
            _backfill_owners(cur)
        self.assertEqual([row["id"] for row in self.db.fetch_all("SELECT id FROM pages ORDER BY id")], before)
        self.assertEqual({row["id"]: row["user_id"] for row in self.db.fetch_all("SELECT id,user_id FROM pages")},
                         {10: "a", 11: None, 12: "b", 13: None, 14: "a", 15: "b"})
        self.assertEqual({row["id"]: row["user_id"] for row in self.db.fetch_all("SELECT * FROM posting_schedules")}, {1: "a", 2: None})
        self.assertEqual({row["id"]: row["user_id"] for row in self.db.fetch_all("SELECT * FROM page_jobs")}, {1: "a", 2: None, 3: None})
        self.assertIsNone(self.db.fetch_one("SELECT user_id FROM posting_progress WHERE page_id='99'")["user_id"])


if __name__ == "__main__":
    unittest.main()
