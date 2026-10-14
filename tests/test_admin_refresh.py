"""Admin refresh and browser identity isolation; no production database access."""
import unittest
from datetime import timedelta, timezone
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from auth_test_support import load_auth_modules


class AdminRefreshTests(unittest.TestCase):
    def setUp(self):
        self.s, self.r, self.sec, self.db, _ = load_auth_modules()
        self.db.reset_mock(return_value=True, side_effect=True)
        app = FastAPI()
        app.include_router(self.r.auth_router)
        app.include_router(self.r.admin_router)
        self.client = TestClient(app)
        self.user = {"id": 42, "username": "admin", "role": "admin", "status": "approved"}

    def test_expired_access_is_restored_from_admin_refresh_even_with_user_cookie(self):
        expired = self.sec.create_access_token({"sub": "admin", "role": "admin", "sid": 91}, timedelta(seconds=-1))
        refresh = self.sec.create_refresh_token({"sub": "admin", "uid": 42, "remember_me": True})
        self.client.cookies.set("fb_admin_refresh", refresh, path="/api/v1/")
        self.client.cookies.set("fb_refresh", "other-user-refresh", path="/api/v1/auth")
        with patch.object(self.s, "_row", return_value=self.user), patch.object(self.db, "fetch_one", return_value={"id": 91}):
            self.assertEqual(self.client.get("/api/v1/admin/me", headers={"Authorization": "Bearer " + expired}).status_code, 401)
            result = self.client.post("/api/v1/auth/refresh", headers={"X-Auth-Client": "admin"})
            self.assertEqual(result.status_code, 200, result.text)
            access = result.json()["access_token"]
            claims = self.sec.decode_token(access)
            self.assertEqual(claims["sid"], 91)
            self.assertEqual(claims["role"], "admin")
            self.assertEqual(self.client.get("/api/v1/admin/me", headers={"Authorization": "Bearer " + access}).status_code, 200)
        self.assertEqual(self.client.cookies.get("fb_refresh"), "other-user-refresh")

    def test_admin_login_respects_remember_and_preserves_user_cookies(self):
        for remember in (True, False):
            with self.subTest(remember=remember):
                self.client.cookies.set("fb_access", "user-access", path="/")
                self.client.cookies.set("fb_refresh", "user-refresh", path="/api/v1/auth")
                with patch.object(self.r, "admin_login", return_value={"access_token": "admin-access", "cookie_access": "admin-access", "cookie_refresh": "admin-refresh"}) as login:
                    result = self.client.post("/api/v1/admin/login", json={"username": "admin", "password": "secret", "remember_me": remember})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(login.call_args.args[-1], remember)
                self.assertEqual(self.client.cookies.get("fb_access"), "user-access")
                self.assertEqual(self.client.cookies.get("fb_refresh"), "user-refresh")
                self.assertEqual(self.client.cookies.get("fb_admin_refresh"), "admin-refresh")
                cookies = result.headers.get_list("set-cookie")
                self.assertTrue(all("HttpOnly" in cookie for cookie in cookies))
                self.assertEqual(any("Max-Age=2592000" in cookie for cookie in cookies), remember)

    def test_user_and_admin_logout_do_not_revoke_each_other(self):
        for admin in (True, False):
            with self.subTest(admin=admin):
                self.client.cookies.clear()
                self.client.cookies.set("fb_refresh", "user-refresh", path="/api/v1/auth")
                self.client.cookies.set("fb_admin_refresh", "admin-refresh", path="/api/v1/")
                with patch.object(self.r, "logout_token") as logout:
                    result = self.client.post("/api/v1/auth/logout", headers={"X-Auth-Client": "admin"} if admin else {})
                self.assertEqual(result.status_code, 200)
                logout.assert_called_once_with("admin-refresh" if admin else "user-refresh")
                self.assertEqual(self.client.cookies.get("fb_refresh" if admin else "fb_admin_refresh"), "user-refresh" if admin else "admin-refresh")

    def test_admin_access_is_short_lived_and_bound_to_refresh_session(self):
        self.user["password_hash"] = self.sec.hash_password("Secure1!")
        with patch.object(self.s, "_row", return_value=self.user), patch.object(self.s, "_open_session", return_value=(91, None, "Desktop", "Chrome", "Windows")):
            result = self.s.admin_login("admin", "Secure1!", None)
        self.assertEqual(result["access_token"], result["cookie_access"])
        expiry = self.sec.decode_token(result["access_token"])["exp"]
        self.assertLessEqual(expiry - self.s.utcnow().replace(tzinfo=timezone.utc).timestamp(), 15 * 60)


if __name__ == "__main__":
    unittest.main()
