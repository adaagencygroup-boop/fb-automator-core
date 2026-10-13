"""Registration API, atomic notification and admin stream regression coverage."""
import asyncio
import json
import unittest
from queue import Empty
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from psycopg2.errors import UniqueViolation

from auth_test_support import load_auth_modules


class RegistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service, cls.router, cls.security, cls.db, cls.events = load_auth_modules()
        app = FastAPI()
        app.include_router(cls.router.auth_router)
        app.include_router(cls.router.admin_router)
        cls.client = TestClient(app)

    def setUp(self):
        self.db.reset_mock(return_value=True, side_effect=True)
        self.db.fetch_one.return_value = None
        self.cursor = self.db.session.return_value.__enter__.return_value
        self.cursor.fetchone.side_effect = [{"id": 42}, {"id": 101}]
        self.body = {"username": "newmember", "password": "Secure1!", "contact_info": "0987654321", "hwid": "spoofed"}
        self.client.cookies.clear()

    def register(self, **changes):
        with patch.object(self.router, "get_hwid", return_value="engine-device"):
            return self.client.post("/api/v1/auth/register", json={**self.body, **changes})

    def test_success_is_pending_with_hashed_password_and_admin_event(self):
        queue = self.events.subscribe()
        try:
            response = self.register(role="admin", status="approved")
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual(response.json()["status"], "pending")
            cookies = [c for c in response.headers.get_list("set-cookie") if c.startswith("fb_registration=") and "Max-Age=0" not in c]
            self.assertEqual(len(cookies), 1)
            self.assertTrue(cookies[0].startswith("fb_registration="))
            self.assertIn("HttpOnly", cookies[0])
            self.assertNotIn("password", response.json())
            self.assertNotIn("access_token", response.json())
            self.db.session.assert_called_once()
            calls = self.cursor.execute.call_args_list
            self.assertEqual(len(calls), 2)
            self.assertIn("'user', 'pending'", calls[0].args[0])
            params = calls[0].args[1]
            self.assertNotEqual(params[1], self.body["password"])
            self.assertTrue(self.security.verify_password(self.body["password"], params[1]))
            self.assertEqual(params[3], "engine-device")
            self.assertIn("'NEW_REGISTRATION', 'admin'", calls[1].args[0])
            event = queue.get_nowait()
            self.assertEqual(event["type"], "NEW_REGISTRATION")
            self.assertEqual(event["user_id"], 42)
            self.assertEqual(event["id"], 101)
        finally:
            self.events.unsubscribe(queue)

    def test_username_rules(self):
        for username in ("", "ab", "1member", "a" * 26, "member!", "with space"):
            with self.subTest(username=username):
                self.assertEqual(self.register(username=username).status_code, 400)
        self.db.session.assert_not_called()

    def test_password_rules_match_old_project(self):
        for password in ("", "        ", "Short1!", "LongPassword1!", "lowercase1!", "UPPERCASE1!", "NoDigit!!", "NoSpecial1"):
            with self.subTest(password=password):
                self.assertEqual(self.register(password=password).status_code, 400)
        self.db.session.assert_not_called()

    def test_password_length_boundaries(self):
        for password in ("Secure1!", "SecurePass1!"):
            with self.subTest(password=password), patch.object(self.service, "publish"):
                self.cursor.fetchone.side_effect = [{"id": 42}, {"id": 101}]
                self.assertEqual(self.register(password=password).status_code, 201)

    def test_phone_rules(self):
        for phone, message in (
            ("", "Vui lòng nhập số điện thoại liên hệ."),
            ("098765432x", "Số điện thoại chỉ được chứa các chữ số."),
            ("09876543210", "Số điện thoại không được vượt quá 10 chữ số."),
            ("1987654321", "Số điện thoại phải bắt đầu bằng số 0."),
            ("0987", "Số điện thoại phải có đủ 10 chữ số."),
        ):
            with self.subTest(phone=phone):
                response = self.register(contact_info=phone)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["detail"], message)
        self.db.session.assert_not_called()

    def test_duplicate_username(self):
        self.db.fetch_one.return_value = {"id": 1}
        self.assertEqual(self.register().status_code, 409)
        self.db.session.assert_not_called()

    def test_concurrent_duplicate_returns_conflict_without_event(self):
        self.cursor.execute.side_effect = UniqueViolation("duplicate username")
        with patch.object(self.service, "publish") as publish:
            self.assertEqual(self.register().status_code, 409)
            publish.assert_not_called()
        self.assertIs(self.db.session.return_value.__exit__.call_args.args[0], UniqueViolation)

    def test_failed_notification_rolls_back_account_without_event(self):
        self.cursor.execute.side_effect = [None, RuntimeError("notification insert failed")]
        with patch.object(self.service, "publish") as publish:
            with self.assertRaises(RuntimeError):
                self.register()
            publish.assert_not_called()
        self.assertIs(self.db.session.return_value.__exit__.call_args.args[0], RuntimeError)

    def test_admin_stream_rejects_unauthenticated_and_normal_user(self):
        with patch.object(self.router, "bearer_user", side_effect=HTTPException(401, "TOKEN_INVALID")):
            self.assertEqual(self.client.get("/api/v1/admin/notifications/stream").status_code, 401)
        with patch.object(self.router, "bearer_user", return_value={"role": "user"}):
            self.assertEqual(self.client.get("/api/v1/admin/notifications/stream").status_code, 403)

    def test_admin_stream_delivers_committed_registration(self):
        async def check():
            request = MagicMock()
            request.headers = {}
            request.cookies = {}
            async def connected():
                return False
            request.is_disconnected = connected
            with patch.object(self.router, "bearer_user", return_value={"role": "admin"}):
                response = await self.router.notification_stream(request)
            stream = response.body_iterator
            self.assertIn('"connected"', await anext(stream))
            event = {"type": "NEW_REGISTRATION", "user_id": 42}
            self.events.publish(event)
            self.assertEqual(json.loads((await anext(stream))[6:]), event)
            await stream.aclose()
        asyncio.run(check())


if __name__ == "__main__":
    unittest.main()
