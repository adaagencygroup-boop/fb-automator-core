"""Auth review regressions; all database operations are isolated doubles."""
import unittest
from unittest.mock import patch
from datetime import timedelta
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from auth_test_support import load_auth_modules


class AuthRegressions(unittest.TestCase):
    def setUp(self):
        self.s, self.r, self.sec, self.db, _ = load_auth_modules()
        self.db.reset_mock(return_value=True, side_effect=True)
        app = FastAPI()
        app.include_router(self.r.auth_router)
        app.include_router(self.r.admin_router)
        self.client = TestClient(app)
        self.user = {"id": 42, "username": "member", "role": "admin", "status": "approved"}

    def test_revoked_admin_and_legacy_tokens_are_rejected(self):
        for claims in ({"sid": 9, "typ": "access"}, {}):
            token = self.sec.create_access_token({"sub": "member", "uid": 42, **claims})
            with patch.object(self.s, "_row", return_value=self.user), patch.object(self.db, "fetch_one", return_value=None):
                with self.assertRaises(HTTPException) as error:
                    self.s.bearer_user("Bearer " + token)
                self.assertEqual(error.exception.detail, "SESSION_REVOKED")

    def test_admin_login_token_is_bound_to_browser_session(self):
        self.user["password_hash"] = self.sec.hash_password("oldpass")
        with patch.object(self.s, "_row", return_value=self.user), patch.object(self.s, "_open_session", return_value=(91, None, "Desktop", "Edge", "Windows")):
            data = self.s.admin_login("member", "oldpass", None)
        self.assertEqual(self.sec.decode_token(data["access_token"])["sid"], 91)
        self.assertEqual(self.sec.decode_token(data["cookie_access"])["sid"], 91)

    def test_status_errors_are_distinct_on_access_and_refresh(self):
        access = self.sec.create_access_token({"sub": "member", "sid": 9})
        refresh = self.sec.create_refresh_token({"sub": "member", "uid": 42})
        for status in ("pending", "banned", "locked", "rejected"):
            self.user["status"] = status
            with patch.object(self.s, "_row", return_value=self.user):
                for call in (lambda: self.s.bearer_user("Bearer " + access), lambda: self.s.refresh_access_token(refresh)):
                    with self.assertRaises(HTTPException) as error:
                        call()
                    self.assertEqual(error.exception.detail, "ACCOUNT_" + status.upper())

    def test_current_refresh_wins_over_old_registration_cookie(self):
        self.client.cookies.set("fb_registration", self.s.create_registration_ticket("old", 1, "device"))
        self.client.cookies.set("fb_refresh", self.sec.create_refresh_token({"sub": "member", "uid": 42}))
        with patch.object(self.r, "get_hwid", return_value="device"), patch.object(self.s, "_row_by_id", return_value=self.user) as lookup:
            response = self.client.get("/api/v1/auth/registration-status")
        self.assertEqual(response.json()["username"], "member")
        lookup.assert_called_once_with(42)

    def test_expired_refresh_falls_back_to_registration(self):
        self.client.cookies.set("fb_refresh", self.sec.create_access_token({"typ": "refresh"}, expires_delta=timedelta(seconds=-1)))
        self.client.cookies.set("fb_registration", self.s.create_registration_ticket("member", 42, "device"))
        with patch.object(self.r, "get_hwid", return_value="device"), patch.object(self.s, "_row_by_id", return_value=self.user):
            self.assertEqual(self.client.get("/api/v1/auth/registration-status").status_code, 200)

    def test_login_success_removes_old_status_cookie(self):
        self.client.cookies.set("fb_registration", "old", domain="testserver.local", path="/api/v1/auth")
        with patch.object(self.r, "get_hwid", return_value="device"), patch.object(self.r, "login_user", return_value={"access_token": "access", "refresh_token": "refresh"}):
            self.assertEqual(self.client.post("/api/v1/auth/login", json={"username": "member", "password": "oldpass"}).status_code, 200)
        self.assertIsNone(self.client.cookies.get("fb_registration"))

    def test_pending_login_replaces_previous_authenticated_identity(self):
        for name in ("fb_access", "fb_refresh"):
            self.client.cookies.set(name, "old", domain="testserver.local", path="/" if name == "fb_access" else "/api/v1/auth")
        with patch.object(self.r, "get_hwid", return_value="device"), patch.object(self.r, "login_user", side_effect=HTTPException(403, "ACCOUNT_PENDING")), patch.object(self.r, "pending_login_ticket", return_value="new-ticket"):
            response = self.client.post("/api/v1/auth/login", json={"username": "member", "password": "oldpass"})
        self.assertEqual(response.status_code, 403)
        self.assertIsNone(self.client.cookies.get("fb_refresh"))
        self.assertIsNone(self.client.cookies.get("fb_access"))
        self.assertEqual(self.client.cookies.get("fb_registration"), "new-ticket")

    def test_new_password_rules_match_registration(self):
        for password, valid in (("Secure1!", True), ("Example@123", True), ("secret123", False), ("Ab1!", False), ("TooLongPassword1!", False)):
            for validator in (self.s.validate_password, self.s.validate_registration_password):
                if valid:
                    validator(password)
                else:
                    with self.assertRaises(HTTPException):
                        validator(password)

    def test_change_password_keeps_existing_session_exemption(self):
        # Issue 2 was explicitly excluded from this change.
        self.user["status"] = "banned"
        token = self.sec.create_access_token({"sub": "member", "sid": 9})
        with patch.object(self.s, "_row", return_value=self.user):
            self.assertEqual(self.s.bearer_user("Bearer " + token, require_session=False)["id"], 42)
