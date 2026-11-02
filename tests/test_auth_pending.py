"""Status-only registration capability must never grant a workspace session."""
import unittest
from datetime import timedelta
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from auth_test_support import load_auth_modules


class PendingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service, cls.router, cls.security, cls.db, _ = load_auth_modules()
        app = FastAPI()
        app.include_router(cls.router.auth_router)
        cls.client = TestClient(app)

    def setUp(self):
        self.db.reset_mock(return_value=True, side_effect=True)
        self.db.fetch_one.return_value = {"id": 42, "username": "member", "status": "pending", "password_hash": "private", "contact_info": "private"}
        self.client.cookies.clear()
        self.ticket = self.service.create_registration_ticket("member", 42, "engine-device")

    def status(self, ticket=None, device="engine-device", query=""):
        if ticket is not None:
            self.client.cookies.set("fb_registration", ticket, path="/api/v1/auth")
        with patch.object(self.router, "get_hwid", return_value=device):
            return self.client.get("/api/v1/auth/registration-status" + query)

    def test_no_ticket_cannot_query_account_by_username(self):
        response = self.status(query="?username=member")
        self.assertEqual(response.status_code, 401)
        self.db.fetch_one.assert_not_called()

    def test_status_response_is_minimal_and_tracks_admin_decisions(self):
        for status in ("pending", "approved", "rejected", "banned", "locked"):
            self.db.fetch_one.return_value["status"] = status
            response = self.status(self.ticket, query="?username=someoneelse")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                response.json(),
                {"username": "member", "status": status, "user_id": 42},
            )
            self.db.fetch_one.assert_called_with("SELECT * FROM users WHERE id = ?", (42,))

    def test_ticket_cannot_be_used_on_another_device(self):
        self.assertEqual(self.status(self.ticket, device="different-device").status_code, 401)
        self.db.fetch_one.assert_not_called()

    def test_expired_and_forged_tickets_are_rejected(self):
        expired = self.security.create_access_token({"sub": "member", "uid": 42, "typ": "registration", "hwid": "engine-device"}, expires_delta=timedelta(seconds=-1))
        for ticket in (expired, self.ticket + "invalid"):
            self.assertEqual(self.status(ticket).status_code, 401)
        self.db.fetch_one.assert_not_called()

    def test_normal_access_token_cannot_be_used_for_pending_status(self):
        access = self.security.create_access_token({"sub": "member", "uid": 42, "typ": "access", "hwid": "engine-device"})
        self.assertEqual(self.status(access).status_code, 401)
        self.db.fetch_one.assert_not_called()

    def test_registration_ticket_never_authenticates_workspace(self):
        # Even changing the account's role to admin must not bypass token purpose.
        self.db.fetch_one.return_value["role"] = "admin"
        with self.assertRaises(HTTPException) as error:
            self.service.bearer_user("Bearer " + self.ticket)
        self.assertEqual(error.exception.detail, "TOKEN_INVALID")
        self.db.fetch_one.assert_not_called()

    def test_ticket_is_invalid_after_account_deleted_or_renamed(self):
        for user in (None, {"id": 42, "username": "renamed"}):
            self.db.fetch_one.return_value = user
            self.assertEqual(self.status(self.ticket).status_code, 401)

    def test_revoked_refresh_cookie_can_only_read_own_account_status(self):
        token = self.security.create_refresh_token({"sub": "member", "uid": 42})
        self.client.cookies.set("fb_refresh", token, path="/api/v1/auth")
        self.db.fetch_one.return_value["status"] = "banned"
        response = self.status()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"username": "member", "status": "banned", "user_id": 42})
        self.assertNotIn("set-cookie", response.headers)
        self.db.execute.assert_not_called()
        with self.assertRaises(HTTPException):
            self.service.bearer_user("Bearer " + token)

    def test_refresh_cookie_for_another_account_cannot_read_this_user(self):
        token = self.security.create_refresh_token({"sub": "another-user", "uid": 99})
        self.client.cookies.set("fb_refresh", token, path="/api/v1/auth")
        self.assertEqual(self.status().status_code, 401)

    def test_status_reports_hwid_mismatch_until_admin_resets_it(self):
        self.db.fetch_one.return_value.update({"status": "approved", "hwid": "different-device"})
        self.assertTrue(self.status(self.ticket).json()["hwid_mismatch"])
        self.db.fetch_one.return_value["hwid"] = None
        self.assertNotIn("hwid_mismatch", self.status(self.ticket).json())

    def test_status_accepts_registration_token_header_without_cookie(self):
        self.db.fetch_one.return_value["status"] = "pending"
        with patch.object(self.router, "get_hwid", return_value="engine-device"):
            response = self.client.get(
                "/api/v1/auth/registration-status",
                headers={"X-Registration-Token": self.ticket},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "pending")

    def test_claim_approval_issues_workspace_tokens_when_approved(self):
        self.db.fetch_one.side_effect = [
            {"id": 42, "username": "member", "status": "approved", "role": "user", "hwid": "engine-device", "expired_at": None},
            {"id": 42, "username": "member", "status": "approved", "role": "user", "hwid": "engine-device", "expired_at": None},
            {"id": 91},
        ]
        with patch.object(self.router, "get_hwid", return_value="engine-device"):
            response = self.client.post(
                "/api/v1/auth/claim-approval",
                json={"registration_token": self.ticket, "remember_me": True},
            )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["status"], "approved")
        self.assertIn("access_token", body)
        self.assertIn("refresh_token", body)
        self.db.fetch_one.side_effect = None

    def test_claim_approval_rejects_while_still_pending(self):
        self.db.fetch_one.return_value = {
            "id": 42, "username": "member", "status": "pending", "role": "user", "hwid": "engine-device",
        }
        with patch.object(self.router, "get_hwid", return_value="engine-device"):
            response = self.client.post(
                "/api/v1/auth/claim-approval",
                json={"registration_token": self.ticket},
            )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "ACCOUNT_PENDING")


if __name__ == "__main__":
    unittest.main()
