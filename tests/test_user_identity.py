"""User/admin cookie isolation across periodic profile and refresh requests."""
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from auth_test_support import load_auth_modules


class UserIdentityTests(unittest.TestCase):
    def setUp(self):
        self.s, self.r, self.sec, self.db, _ = load_auth_modules()
        self.db.reset_mock(return_value=True, side_effect=True)
        app = FastAPI()
        app.include_router(self.r.auth_router)
        app.include_router(self.r.admin_router)
        self.client = TestClient(app)
        self.user = {"id": 21, "username": "member", "role": "user", "status": "approved"}
        self.headers = {"X-Auth-Client": "user", "X-Auth-User-Id": "21"}

    def test_user_me_and_refresh_ignore_all_admin_cookies(self):
        user_access = self.sec.create_access_token({"sub": "member", "uid": 21, "sid": 91, "typ": "access"})
        user_refresh = self.sec.create_refresh_token({"sub": "member", "uid": 21})
        self.client.cookies.set("fb_user_access", user_access, path="/")
        self.client.cookies.set("fb_user_refresh", user_refresh, path="/api/v1/auth")
        for name, path in (("fb_admin_access", "/api/v1/"), ("fb_admin_refresh", "/api/v1/"), ("fb_access", "/"), ("fb_refresh", "/api/v1/auth")):
            self.client.cookies.set(name, "admin-cookie", path=path)
        with patch.object(self.s, "_row", return_value=self.user), patch.object(self.db, "fetch_one", return_value={"id": 91}):
            self.assertEqual(self.client.get("/api/v1/auth/me", headers=self.headers).json()["username"], "member")
            refreshed = self.client.post("/api/v1/auth/refresh", headers=self.headers)
            self.assertEqual(refreshed.status_code, 200, refreshed.text)
            self.assertEqual(self.client.get("/api/v1/auth/me", headers=self.headers).json()["username"], "member")
        self.assertEqual(self.client.cookies.get("fb_admin_access"), "admin-cookie")
        self.assertEqual(self.client.cookies.get("fb_access"), "admin-cookie")

    def test_user_refresh_does_not_fall_back_to_legacy_admin_refresh(self):
        self.client.cookies.set("fb_refresh", "admin-cookie", path="/api/v1/auth")
        response = self.client.post("/api/v1/auth/refresh", headers=self.headers)
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("set-cookie", response.headers)

    def test_changed_identity_is_rejected_before_setting_a_cookie(self):
        other_access = self.sec.create_access_token({"sub": "admin", "uid": 1, "role": "admin", "sid": 92})
        self.client.cookies.set("fb_user_refresh", self.sec.create_refresh_token({"uid": 1}), path="/api/v1/auth")
        with patch.object(self.r, "refresh_access_token", return_value=other_access):
            response = self.client.post("/api/v1/auth/refresh", headers=self.headers)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "SESSION_IDENTITY_CHANGED")
        self.assertNotIn("set-cookie", response.headers)
        self.client.cookies.set("fb_user_access", other_access, path="/")
        with patch.object(self.s, "_row", return_value={"id": 1, "username": "admin", "role": "admin", "status": "approved"}):
            response = self.client.get("/api/v1/auth/me", headers=self.headers)
        self.assertEqual(response.json()["detail"], "SESSION_IDENTITY_CHANGED")

    def test_login_uses_separate_user_cookies_and_admin_login_preserves_them(self):
        with patch.object(self.r, "get_hwid", return_value="device"), patch.object(self.r, "login_user", return_value={"access_token": "member-access", "refresh_token": "member-refresh"}):
            response = self.client.post("/api/v1/auth/login", json={"username": "member", "password": "password"}, headers={"X-Auth-Client": "user"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.cookies.get("fb_user_access"), "member-access")
        with patch.object(self.r, "admin_login", return_value={"access_token": "admin-access", "cookie_access": "admin-access", "cookie_refresh": "admin-refresh"}):
            self.client.post("/api/v1/admin/login", json={"username": "admin", "password": "password"})
        self.assertEqual(self.client.cookies.get("fb_user_access"), "member-access")
        self.assertEqual(self.client.cookies.get("fb_user_refresh"), "member-refresh")

    def test_user_logout_only_revokes_its_own_refresh(self):
        self.client.cookies.set("fb_user_refresh", "member-refresh", path="/api/v1/auth", domain="testserver.local")
        self.client.cookies.set("fb_admin_refresh", "admin-refresh", path="/api/v1/")
        self.client.cookies.set("fb_refresh", "legacy-refresh", path="/api/v1/auth")
        with patch.object(self.r, "logout_token") as logout:
            self.client.post("/api/v1/auth/logout", headers=self.headers)
        logout.assert_called_once_with("member-refresh")
        self.assertIsNone(self.client.cookies.get("fb_user_refresh"))
        self.assertEqual(self.client.cookies.get("fb_admin_refresh"), "admin-refresh")
        self.assertEqual(self.client.cookies.get("fb_refresh"), "legacy-refresh")

    def test_cookie_only_stream_keeps_the_authenticated_user_owner(self):
        import asyncio
        from starlette.requests import Request
        import sys
        with patch.dict(sys.modules, {"modules.module_auth.service": self.s}):
            from modules.module_02_account_manager.api.router import scoped_owner
        owner_context = scoped_owner.__globals__["owner_context"]
        access = self.sec.create_access_token({"sub": "member", "uid": 21, "sid": 91, "typ": "access"})
        request = Request({"type": "http", "method": "GET", "path": "/api/accounts/stream", "query_string": b"", "headers": [(b"cookie", f"fb_user_access={access}; fb_access=legacy-admin".encode())]})
        async def check():
            scope = scoped_owner(request)
            try:
                self.assertEqual(await anext(scope), "21")
                self.assertEqual(owner_context.get(), "21")
            finally:
                await scope.aclose()
        with patch.dict(sys.modules, {"modules.module_auth.service": self.s}), patch.object(self.s, "_row", return_value=self.user), patch.object(self.db, "fetch_one", return_value={"id": 91}):
            asyncio.run(check())
