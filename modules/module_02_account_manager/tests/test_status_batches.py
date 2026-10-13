import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import Mock, patch
from ..services.status_service import check_imported, check_statuses

P = "modules.module_02_account_manager.services.status_service"

class BatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_mixed_results_preserve_existing_status_and_owner(self):
        from datetime import datetime
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        from ..database.models import Base, Account
        from ..context import owner_scope
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.addCleanup(engine.dispose)
        with Session(engine) as db:
            checked = datetime(2025, 1, 1)
            db.add_all([Account(uid="123", user_id="alice", status="LIVE", status_checked_at=checked),
                        Account(uid="456", user_id="alice", status="DIE", status_checked_at=checked),
                        Account(uid="789", user_id="alice"),
                        Account(uid="999", user_id="alice"),
                        Account(uid="123", user_id="bob", status="DIE", status_checked_at=checked)])
            db.commit()
            def check(uid):
                if uid == "999":
                    raise OSError("network unavailable")
                return {"123": "die", "456": None, "789": "live"}[uid]
            with owner_scope("alice"), patch(P + ".check_profile_status", side_effect=check), patch(P + ".broadcast") as event, self.assertLogs(P, level="WARNING"):
                result = await check_statuses(db, ["123", "456", "789", "999", "123", "000"])
            self.assertEqual(result, {"statuses": {"123": "die", "789": "live"}, "live": 1, "die": 1, "inconclusive": 2})
            event.assert_called_once()
            self.assertEqual(event.call_args.kwargs["extra"], {"event": "account_statuses_updated", **result})
            rows = {(a.user_id, a.uid): a for a in db.query(Account).all()}
            self.assertEqual(rows["alice", "456"].status, "DIE")
            self.assertEqual(rows["alice", "456"].status_checked_at, checked)
            self.assertIsNone(rows["alice", "999"].status_checked_at)
            self.assertEqual(rows["bob", "123"].status, "DIE")
            self.assertEqual(rows["bob", "123"].status_checked_at, checked)
            self.assertNotEqual(rows["alice", "123"].status_checked_at, checked)

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


class StatusEndpointTests(unittest.TestCase):
    def test_endpoint_preserves_unchecked_status_and_alias_contract(self):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        from sqlalchemy.pool import StaticPool
        from ..database.models import Base, Account
        from ..api.router import router, alias_router, get_db
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            db.add_all([Account(uid="123", user_id="alice"), Account(uid="456", user_id="bob")])
            db.commit()
        def database():
            with Session(engine) as db:
                yield db
        app = FastAPI()
        app.include_router(router)
        app.include_router(alias_router)
        app.dependency_overrides[get_db] = database
        with TestClient(app) as client, patch(P + ".check_profile_status", return_value=None) as checker, patch(P + ".broadcast"):
            for url in ("/api/accounts/check-status", router.prefix + "/check-status"):
                result = client.post(url, json={"owner_username": "alice", "uids": ["123", "456"]})
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json(), {"statuses": {}, "live": 0, "die": 0, "inconclusive": 1})
            self.assertEqual([call.args for call in checker.call_args_list], [("123",), ("123",)])
        with Session(engine) as db:
            self.assertTrue(all(a.status_checked_at is None for a in db.query(Account).all()))
