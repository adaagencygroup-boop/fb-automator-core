"""Exercise the production license middleware without importing the engine/DB."""
import ast
import json
import unittest
from pathlib import Path
from datetime import timedelta
from unittest.mock import patch
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from auth_test_support import load_auth_modules


class ExpiredDashboardTests(unittest.TestCase):
    def setUp(self):
        self.s, self.r, self.sec, self.db, _ = load_auth_modules()
        self.db.reset_mock(return_value=True, side_effect=True)
        source = ast.parse((Path(__file__).parents[1] / "engine.py").read_text(encoding="utf8"))
        middleware = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == "LicenseMiddleware")
        namespace = {"json": json, "HTTPException": HTTPException, "_PUBLIC_API": set(), "assert_request_module_access": self.r.assert_request_module_access}
        exec(compile(ast.Module(body=[middleware], type_ignores=[]), "engine.py", "exec"), namespace)
        app = FastAPI()
        app.add_middleware(namespace["LicenseMiddleware"])
        app.get("/api/accounts/stats")(lambda: {"total": 12})
        app.get("/api/creator/pages/history")(lambda: [{"status": "SUCCESS"}])
        app.get("/api/accounts")(lambda: [])
        app.post("/api/creator/tasks/start")(lambda: {"started": True})
        app.post("/api/accounts/stats")(lambda: {"mutated": True})
        self.client = TestClient(app)
        self.user = {"id": 21, "username": "member", "role": "user", "status": "expired", "expired_at": self.s.utcnow() - timedelta(days=1)}
        token = self.sec.create_access_token({"sub": "member", "uid": 21, "sid": 91, "typ": "access"})
        self.client.cookies.set("fb_user_access", token)
        self.headers = {"X-Auth-Client": "user"}

    def test_expired_user_can_read_both_dashboard_summaries(self):
        with patch.object(self.s, "_row", return_value=self.user), patch.object(self.db, "fetch_one", return_value={"id": 91}):
            self.assertEqual(self.client.get("/api/accounts/stats", headers=self.headers).json(), {"total": 12})
            self.assertEqual(self.client.get("/api/creator/pages/history", headers=self.headers).status_code, 200)

    def test_expired_user_cannot_open_other_modules_or_write_summary_paths(self):
        with patch.object(self.s, "_row", return_value=self.user), patch.object(self.db, "fetch_one", return_value={"id": 91}):
            for method, path in (("GET", "/api/accounts"), ("POST", "/api/creator/tasks/start"), ("POST", "/api/accounts/stats")):
                response = self.client.request(method, path, headers=self.headers)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json()["detail"], "LICENSE_REQUIRED")

    def test_summaries_still_require_a_valid_session_and_unlocked_account(self):
        with patch.object(self.s, "_row", return_value=self.user), patch.object(self.db, "fetch_one", return_value=None):
            self.assertEqual(self.client.get("/api/accounts/stats", headers=self.headers).status_code, 401)
        self.user["status"] = "banned"
        with patch.object(self.s, "_row", return_value=self.user):
            self.assertEqual(self.client.get("/api/accounts/stats", headers=self.headers).status_code, 401)
        self.client.cookies.clear()
        self.assertEqual(self.client.get("/api/accounts/stats", headers=self.headers).status_code, 401)
