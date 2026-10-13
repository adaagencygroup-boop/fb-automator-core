import unittest
from unittest.mock import Mock, patch
from ..services.status_service import check_imported

P = "modules.module_02_account_manager.services.status_service"

class BatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_batches_commit_before_broadcast(self):
        uids = [str(i) for i in range(43)]
        actions = []
        with patch(P + ".SessionLocal"), patch(P + ".Repo.get_all", return_value=[Mock(uid=u) for u in uids]), patch(P + ".check_profile_status", return_value="live"), patch(P + ".Repo.update_profile_statuses", side_effect=lambda db, statuses: actions.append(("commit", len(statuses)))), patch(P + ".broadcast", side_effect=lambda *args, **kwargs: actions.append(("event", len(kwargs["extra"]["statuses"]))) if "extra" in kwargs else None):
            await check_imported(uids)
        self.assertEqual(actions, [("commit", 20), ("event", 20), ("commit", 20), ("event", 20), ("commit", 3), ("event", 3)])

    async def test_database_failure_rolls_back_and_closes(self):
        with patch(P + ".SessionLocal") as sessions, patch(P + ".Repo.get_all", side_effect=RuntimeError("database unavailable")), patch(P + ".broadcast") as broadcast:
            await check_imported(["123"])
        sessions.return_value.rollback.assert_called_once()
        sessions.return_value.close.assert_called_once()
        self.assertEqual(broadcast.call_args.args[0], "error")
