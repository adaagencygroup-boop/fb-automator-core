import tempfile
import unittest
from contextlib import asynccontextmanager
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from ..api.router import router, alias_router
from ..plugin import initialize, shutdown
from ..database import connection
from ..database.repository import AccountRepository as Repo
from ..context import owner_scope
from ..utils.paths import get_profile_path
from ..utils import paths

P = "modules.module_02_account_manager"

class TestAccountAPI(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_profiles = paths.PROFILES_DIR
        self.hwid = patch(P + ".security.encryption.get_hwid", return_value="test-hwid")
        self.hwid.start()
        @asynccontextmanager
        async def lifespan(app):
            initialize("sqlite:///" + self.temp.name + "/test.db", self.temp.name + "/profiles")
            yield
            await shutdown()
        app = FastAPI(lifespan=lifespan)
        app.include_router(router)
        app.include_router(alias_router)
        self.client = TestClient(app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.hwid.stop()
        paths.PROFILES_DIR = self.old_profiles
        self.temp.cleanup()

    def save(self, uid="123", owner="alice", **fields):
        return self.client.post("/api/accounts/single", json={"uid": uid, "owner_username": owner, **fields})

    def test_import_aliases_details_and_owner_isolation(self):
        response = self.client.post("/api/accounts/import", json={"owner_username": "alice", "accounts": [{"uid": "123", "password": "secret", "twofa_secret": "otp", "tokenhotmail": "mailtoken", "clientId": "client"}]})
        res_data = response.json()
        self.assertEqual(res_data["imported"], 1)
        self.assertEqual(res_data["errors"], [])
        self.assertEqual(res_data["checking"], 0)
        self.assertEqual(self.save(owner="bob", password="other").status_code, 200)
        self.assertEqual(self.client.get("/api/accounts").json(), [])
        alice = self.client.get("/api/accounts", headers={"X-Owner-Username": "alice"}).json()[0]
        self.assertEqual((alice["password"], alice["twofa_secret"], alice["client_id"]), ("secret", "otp", "client"))
        self.assertIsNone(alice["status"])
        detail = self.client.get("/api/accounts/123?owner_username=alice").json()
        self.assertEqual(detail["two_fa"], "otp")
        self.assertEqual(self.client.delete("/api/accounts/123").status_code, 404)
        self.assertEqual(self.client.delete("/api/accounts/123?owner_username=alice").status_code, 200)
        self.assertEqual(len(self.client.get("/api/accounts?owner_username=bob").json()), 1)

    def test_reimport_preserves_session_and_encrypts_once(self):
        self.save(password="secret")
        with owner_scope("alice"), connection.SessionLocal() as db:
            Repo.update_login_status(db, "123", "logged_in")
        self.client.post("/api/accounts/import", json={"owner_username": "alice", "accounts": [{"uid": "123", "email": "new@example.com"}]})
        account = self.client.get("/api/accounts?owner_username=alice").json()[0]
        self.assertEqual(account["password"], "secret")
        self.assertEqual((account["status"], account["login_status"]), ("live", "logged_in"))
        self.assertTrue(account["last_login_at"].endswith("+00:00"))

    def test_import_partial_failure_checks_only_committed_accounts(self):
        original = Repo.upsert
        def save(db, data, **kwargs):
            if data["uid"] == "456":
                raise ValueError("test failure")
            return original(db, data, **kwargs)
        with patch.object(Repo, "upsert", side_effect=save), patch(P + ".services.status_service.check_profile_status", return_value="live") as check:
            response = self.client.post("/api/accounts/import", json={"owner_username": "alice", "check_status": True, "accounts": [{"uid": "123"}, {"uid": "456"}]})
        self.assertEqual(response.json()["imported"], 1)
        self.assertEqual(response.json()["checking"], 1)
        check.assert_called_once_with("123")
        self.assertEqual(self.client.get("/api/accounts?owner_username=alice").json()[0]["status"], "live")

    def test_owner_conflicts_validation_and_unknown_account(self):
        response = self.client.post("/api/accounts/single", headers={"X-Owner-Username": "bob"}, json={"uid": "123", "owner_username": "alice"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.save(uid="../escape").status_code, 422)
        self.assertEqual(self.client.post("/api/accounts/login", json={"uids": [], "threads": 0}).status_code, 422)
        self.assertEqual(self.client.post("/api/accounts/open-browser", json={"uid": "999"}).status_code, 404)
        self.assertEqual(self.client.post("/api/accounts/import", json={"accounts": [{"uid": str(i)} for i in range(101)]}).status_code, 422)

    def test_profile_delete_failure_preserves_account_and_other_owner(self):
        self.save()
        self.save(owner="bob")
        with owner_scope("bob"):
            other = get_profile_path("123")
        with patch(P + ".services.account_service.delete_profiles_by_uid", side_effect=RuntimeError("busy")):
            response = self.client.post("/api/accounts/bulk-delete", json={"uids": ["123"], "owner_username": "alice"})
        self.assertEqual(response.json()["deleted"], 0)
        self.assertEqual(len(response.json()["errors"]), 1)
        self.assertEqual(self.client.get("/api/accounts/123?owner_username=alice").status_code, 200)
        from pathlib import Path
        self.assertTrue(Path(other).is_dir())

    def test_login_worker_keeps_owner_and_persists_cookie(self):
        self.save()
        self.save(owner="bob")
        with patch(P + ".automation.login_flow.run_login", return_value={"success": True, "profile_name": "Name", "cookie": "c_user=123"}):
            response = self.client.post("/api/accounts/login", json={"owner_username": "alice", "uids": ["123"], "threads": 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/accounts?owner_username=alice").json()[0]["login_status"], "logged_in")
        self.assertEqual(self.client.get("/api/accounts?owner_username=bob").json()[0]["login_status"], "not_logged_in")

    def test_orphan_profile_delete(self):
        with owner_scope("alice"):
            path = get_profile_path("123")
        response = self.client.delete("/api/accounts/123?owner_username=alice")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["deleted"])
        from pathlib import Path
        self.assertFalse(Path(path).exists())

    def test_check_selected_only_and_commits_before_event(self):
        self.save()
        self.save(uid="456")
        self.save(uid="789", owner="bob")
        with patch(P + ".services.status_service.check_profile_status", return_value="die") as check:
            response = self.client.post("/api/accounts/check-status", json={"owner_username": "alice", "uids": ["123", "789"]})
        self.assertEqual(response.json()["statuses"], {"123": "die"})
        check.assert_called_once_with("123")
        self.assertEqual(self.client.get("/api/accounts?owner_username=alice").json()[1]["status"], "die")

    def test_cookie_sync_only_uses_owner_browser(self):
        from unittest.mock import Mock
        from ..automation.browser_manager import _active_drivers, _active_drivers_lock
        self.save()
        self.save(owner="bob")
        driver = Mock()
        driver.get_cookies.return_value = [{"name": "c_user", "value": "123"}]
        with _active_drivers_lock:
            _active_drivers[driver] = {"uid": "123", "owner": "alice", "scope": "live"}
        try:
            self.assertFalse(self.client.post("/api/accounts/123/sync-cookies?owner_username=bob").json()["success"])
            self.assertTrue(self.client.post("/api/accounts/123/sync-cookies?owner_username=alice").json()["success"])
        finally:
            with _active_drivers_lock:
                _active_drivers.pop(driver, None)

    def test_open_browser_rejects_duplicate_queue(self):
        from ..services.browser_service import _open_browser_pending
        self.save()
        try:
            with patch(P + ".services.browser_service.runtime.submit") as submit:
                first = self.client.post("/api/accounts/open-browser", json={"uid": "123", "owner_username": "alice"})
                second = self.client.post("/api/accounts/open-browser", json={"uid": "123", "owner_username": "alice"})
            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 409)
            submit.assert_called_once()
        finally:
            _open_browser_pending.clear()

    def test_open_browser_passes_target_url(self):
        from ..services.browser_service import _open_browser_pending
        self.save()
        try:
            with patch(P + ".services.browser_service.runtime.submit") as submit:
                resp = self.client.post(
                    "/api/accounts/open-browser",
                    json={
                        "uid": "123",
                        "owner_username": "alice",
                        "target_url": "https://www.facebook.com/123/posts/pfbid123",
                    },
                )
            self.assertEqual(resp.status_code, 200)
            submit.assert_called_once()
            args = submit.call_args[0]
            self.assertEqual(args[1], "123")
            self.assertEqual(args[2], "https://www.facebook.com/123/posts/pfbid123")
        finally:
            _open_browser_pending.clear()

    def test_proxy_endpoint_uses_ported_checker(self):
        with patch(P + ".automation.proxy_bridge.test_proxy_connectivity", return_value={"egress_ip": "192.0.2.1"}):
            response = self.client.post("/api/accounts/test-proxy", json={"proxy": "127.0.0.1:8080"})
        self.assertTrue(response.json()["success"])
        self.assertEqual(response.json()["egress_ip"], "192.0.2.1")

    def test_import_invalid_collection_is_validation_error(self):
        self.assertEqual(self.client.post("/api/accounts/import", json={"accounts": None}).status_code, 422)

    def test_legacy_route_aliases_work(self):
        self.save(uid="999", owner="charlie", password="pw")
        # Test /accounts alias
        resp_list = self.client.get("/accounts", headers={"X-Owner-Username": "charlie"})
        self.assertEqual(resp_list.status_code, 200)
        self.assertEqual(len(resp_list.json()), 1)
        self.assertEqual(resp_list.json()[0]["uid"], "999")

        # Test /tasks/open-browser alias
        with patch(P + ".services.browser_service.runtime.submit") as submit:
            resp_browser = self.client.post("/tasks/open-browser", json={"uid": "999", "owner_username": "charlie"})
            self.assertEqual(resp_browser.status_code, 200)
            self.assertEqual({k: resp_browser.json()[k] for k in ("started", "uid")}, {"started": True, "uid": "999"})
            self.assertTrue(resp_browser.json()["operation_id"])

        # Test /tasks/login alias
        with patch(P + ".services.login_service.login_batch") as login_mock:
            resp_login = self.client.post("/tasks/login", json={"uids": ["999"], "threads": 2, "owner_username": "charlie"})
            self.assertEqual(resp_login.status_code, 200)
            self.assertEqual({k: resp_login.json()[k] for k in ("started", "count")}, {"started": True, "count": 1})
            operation_id = resp_login.json()["operation_id"]
            progress = self.client.get(f"/api/accounts/operations/{operation_id}", headers={"X-Owner-Username": "charlie"})
            self.assertEqual(progress.status_code, 200)
            self.assertEqual(progress.json()["accounts"]["999"]["phase"], "queued")
            other = self.client.get(f"/api/accounts/operations/{operation_id}", headers={"X-Owner-Username": "other"})
            self.assertEqual(other.status_code, 404)

