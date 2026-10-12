import unittest
from unittest.mock import patch, MagicMock

# Patch DB connection before module_auth imports it
from core.database.connection import DatabaseManager
if DatabaseManager._instance is None:
    with patch.object(DatabaseManager, "_init_database", return_value=None):
        _dummy = DatabaseManager()
        _dummy._pg_pool = MagicMock()
        _dummy._is_postgres = True

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from ..api.router import router
from ..database.connection import get_db
from ..database.models import Account, Base
from ..database.repository import AccountRepository as Repo
from ..database.migrations import _migrate_unowned_accounts

class TestUserScoping(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(bind=self.engine, expire_on_commit=False)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_migration_v3_assigns_legacy_to_user_1(self):
        acc1 = Account(uid="1001", user_id=None)
        acc2 = Account(uid="1002", user_id="")
        acc3 = Account(uid="1003", user_id="admin")
        acc4 = Account(uid="1004", user_id="2")
        acc5_existing = Account(uid="1005", user_id="1")
        acc5_duplicate = Account(uid="1005", user_id=None)
        self.db.add_all([acc1, acc2, acc3, acc4, acc5_existing, acc5_duplicate])
        self.db.commit()

        with self.engine.begin() as conn:
            conn.exec_driver_sql("CREATE TABLE IF NOT EXISTS account_plugin_schema (version INTEGER PRIMARY KEY)")
            _migrate_unowned_accounts(conn, self.engine)

        self.db.expire_all()
        rows = self.db.query(Account).all()
        by_uid = {r.uid: r.user_id for r in rows}
        self.assertEqual(by_uid["1001"], "1")
        self.assertEqual(by_uid["1002"], "1")
        self.assertEqual(by_uid["1003"], "1")
        self.assertEqual(by_uid["1004"], "2")
        self.assertEqual(by_uid["1005"], "1")
        self.assertEqual(self.db.query(Account).filter(Account.uid == "1005").count(), 1)

    def test_authenticated_token_extracts_user_id(self):
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        client = TestClient(app)

        mock_user = {"id": 42, "username": "cuong", "role": "user"}

        with patch("modules.module_auth.service.bearer_user", return_value=mock_user):
            Repo.upsert(self.db, {"uid": "888888"}, user_id="42")
            Repo.upsert(self.db, {"uid": "999999"}, user_id="99")

            resp = client.get("/api/accounts", headers={"Authorization": "Bearer mock-token"})
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(len(data), 1)
            self.assertEqual(data[0]["uid"], "888888")
            self.assertEqual(data[0]["user_id"], "42")

    def test_conflicting_user_id_raises_403(self):
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        client = TestClient(app)

        mock_user = {"id": 42, "username": "cuong", "role": "user"}

        with patch("modules.module_auth.service.bearer_user", return_value=mock_user):
            resp = client.get("/api/accounts?user_id=99", headers={"Authorization": "Bearer mock-token"})
            self.assertEqual(resp.status_code, 403)
            self.assertIn("Không có quyền", resp.json()["detail"])

    def test_fallback_without_token(self):
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        client = TestClient(app)

        Repo.upsert(self.db, {"uid": "777777"}, user_id="7")
        resp = client.get("/api/accounts", headers={"X-User-Id": "7"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)
        self.assertEqual(resp.json()[0]["uid"], "777777")
