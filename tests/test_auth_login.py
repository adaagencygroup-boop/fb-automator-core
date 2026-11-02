"""Login regression tests with an isolated database double; no production connection."""
import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from auth_test_support import load_auth_modules


class LoginTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service, cls.router, cls.security, cls.db, _ = load_auth_modules()
        cls.password_hash = cls.security.hash_password("secret123")
        app = FastAPI()
        app.include_router(cls.router.auth_router)
        cls.client = TestClient(app)

    def setUp(self):
        self.db.reset_mock()
        self.db.fetch_one.side_effect = None
        self.user = {
            "id": 42, "username": "member", "password_hash": self.password_hash,
            "status": "approved", "role": "user", "hwid": "device-one",
            "expired_at": self.service.utcnow() + timedelta(days=5),
        }
        self.db.fetch_one.return_value = self.user
        self.client.cookies.clear()

    def assert_login_error(self, status, detail, password="secret123"):
        with patch.object(self.router, "get_hwid", return_value="device-one"):
            response = self.client.post("/api/v1/auth/login", json={"username": "member", "password": password})
        self.assertEqual(response.status_code, status)
        self.assertEqual(response.json()["detail"], detail)
        if detail in ("ACCOUNT_PENDING", "ACCOUNT_BANNED", "ACCOUNT_LOCKED"):
            self.assertTrue(self.client.cookies.get("fb_registration"))
        else:
            self.assertNotIn("set-cookie", response.headers)
        self.db.execute.assert_not_called()

    def test_missing_account(self):
        self.db.fetch_one.return_value = None
        self.assert_login_error(401, "ACCOUNT_NOT_FOUND")

    def test_wrong_password(self):
        self.assert_login_error(401, "INVALID_PASSWORD", "wrong")

    def test_empty_credentials(self):
        for username, password in (("", "secret123"), ("member", "")):
            with patch.object(self.router, "get_hwid", return_value="device-one"):
                response = self.client.post("/api/v1/auth/login", json={"username": username, "password": password})
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("set-cookie", response.headers)
        self.db.execute.assert_not_called()

    def test_admin_login_uses_the_same_cookie_contract(self):
        self.user["role"] = "admin"
        with patch.object(self.router, "get_hwid", return_value="device-one"), patch.object(self.service, "admin_login", return_value={
            "access_token": "legacy-admin-token", "cookie_access": "browser-access",
            "cookie_refresh": "browser-refresh", "role": "admin", "status": "approved",
        }) as admin_login:
            response = self.client.post("/api/v1/auth/login", json={"username": "member", "password": "secret123", "remember_me": False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "admin")
        # Desktop/Tauri cần bearer trong body; cookie vẫn set cho browser.
        self.assertEqual(response.json()["access_token"], "browser-access")
        self.assertEqual(response.json()["refresh_token"], "browser-refresh")
        self.assertNotIn("cookie_access", response.json())
        self.assertEqual(self.client.cookies.get("fb_access"), "browser-access")
        self.assertFalse(admin_login.call_args.args[-1])

    def test_admin_bad_password_and_locked_status(self):
        self.user["role"] = "admin"
        self.assert_login_error(401, "INVALID_PASSWORD", "wrong")
        self.user["status"] = "banned"
        self.assert_login_error(403, "ACCOUNT_BANNED")

    def test_refresh_rejects_revoked_session(self):
        token = self.security.create_refresh_token({"sub": "member"})
        self.db.fetch_one.side_effect = [self.user, None]
        with self.assertRaises(HTTPException) as error:
            self.service.refresh_access_token(token)
        self.assertEqual(error.exception.detail, "SESSION_REVOKED")
        self.db.execute.assert_not_called()

    def test_blocked_statuses(self):
        for status in ("pending", "rejected", "banned", "locked"):
            with self.subTest(status=status):
                self.user["status"] = status
                self.assert_login_error(403, "ACCOUNT_" + status.upper())

    def test_hwid_cannot_be_spoofed_by_request_body(self):
        self.user["hwid"] = "different-device"
        with patch.object(self.router, "get_hwid", return_value="device-one"):
            response = self.client.post("/api/v1/auth/login", json={
                "username": "member", "password": "secret123", "hwid": "different-device",
            })
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "ERR_HWID_MISMATCH")
        self.db.execute.assert_not_called()

    def test_empty_hwid_cannot_bypass_binding(self):
        with self.assertRaises(HTTPException) as error:
            self.service.verify_license("member", "secret123", "", None)
        self.assertEqual(error.exception.detail, "ERR_HWID_MISMATCH")

    def test_success_cookies_and_remember_me(self):
        for remember in (False, True):
            with self.subTest(remember=remember):
                self.db.fetch_one.side_effect = [self.user.copy(), self.user.copy(), {"id": 91}]
                with patch.object(self.router, "get_hwid", return_value="device-one"):
                    response = self.client.post("/api/v1/auth/login", json={
                        "username": " member ", "password": "secret123", "remember_me": remember,
                    })
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["status"], "approved")
                # Bearer trong body (Tauri) + cookie HttpOnly (browser)
                self.assertIn("access_token", response.json())
                self.assertIn("refresh_token", response.json())
                cookies = [c for c in response.headers.get_list("set-cookie") if not c.startswith("fb_registration=")]
                self.assertEqual(len(cookies), 2)
                for cookie in cookies:
                    self.assertIn("HttpOnly", cookie)
                    self.assertIn("SameSite=lax", cookie)
                    self.assertEqual("Max-Age=" in cookie, remember)
                refresh = self.security.decode_token(self.client.cookies.get("fb_refresh"))
                self.assertEqual(refresh["remember_me"], remember)
                # Successful login revokes old sessions before inserting the new one.
                self.assertIn("UPDATE user_sessions", self.db.execute.call_args_list[0].args[0])
                self.db.reset_mock()
                self.db.fetch_one.side_effect = None

    def test_expired_account_still_gets_restricted_session(self):
        self.user["expired_at"] = self.service.utcnow() - timedelta(days=1)
        self.db.fetch_one.side_effect = [self.user, self.user, {"id": 91}]
        with patch.object(self.router, "get_hwid", return_value="device-one"):
            response = self.client.post("/api/v1/auth/login", json={"username": "member", "password": "secret123"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "expired")
        self.assertEqual(response.json()["days_remaining"], 0)
        self.assertFalse(self.service.licensed_for_modules(self.user))
        self.db.fetch_one.side_effect = None

    def test_refresh_keeps_session_cookie_policy(self):
        for remember in (False, True):
            token = self.security.create_refresh_token({"sub": "member", "remember_me": remember})
            self.client.cookies.set("fb_refresh", token, path="/api/v1/auth")
            with patch.object(self.router, "refresh_access_token", return_value="new-access"):
                response = self.client.post("/api/v1/auth/refresh")
            self.assertEqual(response.status_code, 200)
            self.assertEqual("Max-Age=" in response.headers["set-cookie"], remember)

    def test_admin_refresh_returns_bearer_token_from_cookie(self):
        token = self.security.create_refresh_token({"sub": "member", "remember_me": True})
        access = self.security.create_access_token({"sub": "member", "role": "admin", "sid": 91, "typ": "access"})
        self.client.cookies.set("fb_refresh", token, path="/api/v1/auth")
        with patch.object(self.router, "refresh_access_token", return_value=access) as refresh:
            response = self.client.post("/api/v1/auth/refresh", headers={"X-Auth-Client": "admin"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["access_token"], access)
        self.assertEqual(self.client.cookies.get("fb_admin_access"), access)
        refresh.assert_called_once_with(token)

    def test_admin_refresh_rejects_user_role_without_setting_access_cookie(self):
        token = self.security.create_refresh_token({"sub": "member"})
        access = self.security.create_access_token({"sub": "member", "role": "user", "sid": 91})
        self.client.cookies.set("fb_refresh", token, path="/api/v1/auth")
        with patch.object(self.router, "refresh_access_token", return_value=access):
            response = self.client.post("/api/v1/auth/refresh", headers={"X-Auth-Client": "admin"})
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("access_token", response.json())
        self.assertNotIn("set-cookie", response.headers)

    def test_user_refresh_returns_bearer_for_desktop_clients(self):
        token = self.security.create_refresh_token({"sub": "member"})
        self.client.cookies.set("fb_refresh", token, path="/api/v1/auth")
        with patch.object(self.router, "refresh_access_token", return_value="new-access"):
            response = self.client.post("/api/v1/auth/refresh")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ok"], True)
        self.assertEqual(response.json()["access_token"], "new-access")
        self.assertEqual(response.json()["refresh_token"], token)

    def test_revoked_admin_refresh_returns_no_token(self):
        self.client.cookies.set("fb_refresh", "revoked", path="/api/v1/auth")
        with patch.object(self.router, "refresh_access_token", side_effect=HTTPException(401, "SESSION_REVOKED")):
            response = self.client.post("/api/v1/auth/refresh", headers={"X-Auth-Client": "admin"})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("access_token", response.json())
        self.assertNotIn("set-cookie", response.headers)


if __name__ == "__main__":
    unittest.main()
