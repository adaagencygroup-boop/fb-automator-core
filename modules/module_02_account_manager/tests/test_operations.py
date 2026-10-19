import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException
from ..context import owner_scope
from ..services import operations
from ..services.browser_service import _confirm_live_session, _watch_open_browser_login

P = "modules.module_02_account_manager"


class OperationTests(unittest.TestCase):
    def test_snapshot_is_scoped_public_ordered_and_expires(self):
        account = SimpleNamespace(login_status="LOGGED_IN", status="LIVE", status_checked_at=datetime.now(),
                                  last_login_at=datetime.now(), profile_name="Name", avatar_url=None,
                                  cookie="secret", password="secret", token="secret")
        with owner_scope("alice"), patch(P + ".services.events.broadcast") as broadcast:
            op = operations.create("login", ["123", "456"])
            with operations.scope(op):
                operations.update("123", "authenticated", account)
                operations.update("123", "completed", account)
                operations.update("456", "failed")
            snapshot = operations.read(op)
            self.assertTrue(snapshot["done"])
            self.assertEqual(snapshot["sequence"], 3)
            self.assertNotIn("cookie", snapshot["accounts"]["123"]["changes"])
            self.assertNotIn("password", snapshot["accounts"]["123"]["changes"])
            self.assertNotIn("token", snapshot["accounts"]["123"]["changes"])
            events = [call.kwargs["extra"] for call in broadcast.call_args_list]
            self.assertEqual([event["sequence"] for event in events], [1, 2, 3])
            self.assertEqual(len({event["event_id"] for event in events}), 3)
            with patch.object(operations.time, "monotonic", return_value=operations.time.monotonic() + 1801):
                with self.assertRaises(HTTPException):
                    operations.read(op)
        with owner_scope("bob"), self.assertRaises(HTTPException):
            operations.read(op)

    def test_status_and_cookie_publish_before_slow_metadata_and_metadata_failure_is_optional(self):
        actions = []
        db = Mock()
        with patch(P + ".database.repository.AccountRepository.update_login_status", side_effect=lambda *a: actions.append("status")), \
             patch(P + ".automation.browser_manager.extract_cookies_as_string", return_value="c_user=123"), \
             patch(P + ".database.repository.AccountRepository.update_cookies", side_effect=lambda *a: actions.append("cookie")), \
             patch(P + ".services.browser_service.operations.publish", side_effect=lambda uid, phase, db: actions.append(phase)), \
             patch(P + ".automation.login_flow._get_account_identity", side_effect=RuntimeError("metadata slow/fails")):
            self.assertEqual(_confirm_live_session(db, Mock(), "123"), {})
        self.assertEqual(actions, ["status", "cookie", "authenticated", "completed"])

    def test_five_minute_timeout_does_not_mark_login_as_failed(self):
        from ..services import runtime
        runtime.stopping.clear()
        with patch(P + ".automation.login_flow._check_logged_in", return_value=False), \
             patch(P + ".services.browser_service.operations.update") as update, \
             patch(P + ".database.repository.AccountRepository.update_login_status") as save:
            _watch_open_browser_login(Mock(current_url="https://www.facebook.com/"), "123", checks=2, interval=0)
        update.assert_called_once_with("123", "timeout")
        save.assert_not_called()

    def test_cookie_changes_from_metadata_profile_restore_are_persisted(self):
        db = Mock()
        with patch(P + ".database.repository.AccountRepository.update_login_status"), \
             patch(P + ".database.repository.AccountRepository.update_identity"), \
             patch(P + ".automation.browser_manager.extract_cookies_as_string", side_effect=["c_user=123; i_user=456", "c_user=123"]), \
             patch(P + ".database.repository.AccountRepository.update_cookies") as save, \
             patch(P + ".services.browser_service.operations.publish"), \
             patch(P + ".automation.login_flow._get_account_identity", return_value={}):
            _confirm_live_session(db, Mock(), "123")
        self.assertEqual([call.args[2] for call in save.call_args_list], ["c_user=123; i_user=456", "c_user=123"])


class BatchOperationTests(unittest.IsolatedAsyncioTestCase):
    async def test_hundred_workers_keep_operation_and_owner_context(self):
        from ..services import runtime
        from ..services.login_service import login_batch
        runtime.initialize()
        try:
            with owner_scope("alice"), patch(P + ".services.events.broadcast"), \
                 patch(P + ".services.login_service.login_one", side_effect=lambda uid: operations.update(uid, "completed")):
                uids = [str(1000 + i) for i in range(100)]
                op = operations.create("login", uids)
                await login_batch(uids, 3, op)
                snapshot = operations.read(op)
                self.assertTrue(snapshot["done"])
                self.assertEqual(snapshot["sequence"], 100)
                self.assertTrue(all(row["phase"] == "completed" for row in snapshot["accounts"].values()))
        finally:
            await runtime.shutdown()
