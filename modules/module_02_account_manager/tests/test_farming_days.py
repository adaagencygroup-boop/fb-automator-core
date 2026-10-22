"""Farming start migration, immutable login timestamps and public contracts."""
import unittest
from datetime import datetime
from unittest.mock import patch
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from ..context import owner_scope
from ..database.migrations import migrate
from ..database.repository import AccountRepository as Repo
from ..services.account_service import serialize
from ..services.operations import account_fields

P = "modules.module_02_account_manager.database.repository.utc_now"


class FarmingDaysTests(unittest.TestCase):
    def test_migration_backfills_old_logins_once_and_leaves_unknown_dates_null(self):
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE accounts (id INTEGER PRIMARY KEY, last_login_at TIMESTAMP)"))
            conn.execute(text("CREATE TABLE account_plugin_schema (version INTEGER PRIMARY KEY)"))
            for version in range(1, 6):
                conn.execute(text("INSERT INTO account_plugin_schema VALUES (:v)"), {"v": version})
            conn.execute(text("INSERT INTO accounts VALUES (1,'2026-10-01 10:00:00'),(2,NULL)"))
        migrate(engine)
        with engine.begin() as conn:
            self.assertEqual(conn.execute(text("SELECT first_login_at FROM accounts WHERE id=1")).scalar(), "2026-10-01 10:00:00")
            self.assertIsNone(conn.execute(text("SELECT first_login_at FROM accounts WHERE id=2")).scalar())
            conn.execute(text("UPDATE accounts SET last_login_at='2026-10-22 10:00:00' WHERE id=1"))
        migrate(engine)
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT first_login_at FROM accounts WHERE id=1")).scalar(), "2026-10-01 10:00:00")

    def test_first_success_is_immutable_across_failures_imports_edits_and_stale_sessions(self):
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        migrate(engine)
        first, later = datetime(2026, 10, 1, 10), datetime(2026, 10, 22, 10)
        with owner_scope("alice"), Session(engine, autoflush=False, expire_on_commit=False) as db, Session(engine, autoflush=False, expire_on_commit=False) as stale_db:
            account = Repo.upsert(db, {"uid": "123"})
            Repo.update_login_status(db, "123", "failed")
            self.assertIsNone(account.first_login_at)
            stale = Repo.get_by_uid(stale_db, "123")
            self.assertIsNone(stale.first_login_at)
            with patch(P, return_value=first):
                Repo.update_login_status(db, "123", "logged_in")
            self.assertEqual(account.first_login_at, first)
            with patch(P, return_value=later):
                Repo.update_login_status(stale_db, "123", "logged_in")
            self.assertEqual(stale.first_login_at, first)
            self.assertEqual(stale.last_login_at, later)
            Repo.upsert(stale_db, {"uid": "123", "email": "updated@example.com", "first_login_at": later})
            Repo.update_login_status(stale_db, "123", "failed")
            self.assertEqual(stale.first_login_at, first)
            self.assertEqual(serialize(stale)["first_login_at"], "2026-10-01T10:00:00+00:00")
            self.assertEqual(account_fields(stale)["first_login_at"], "2026-10-01T10:00:00+00:00")
            with owner_scope("bob"):
                self.assertIsNone(Repo.update_login_status(stale_db, "123", "logged_in"))
