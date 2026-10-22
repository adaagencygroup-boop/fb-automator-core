"""Category contracts exercised through the real owner dependency and database."""
import os
import tempfile
import unittest
from datetime import datetime
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..api.router import router, alias_router
from ..context import owner_scope
from ..database.connection import get_db
from ..database.migrations import migrate
from ..database.models import Account, AccountCategory
from ..database.repository import AccountRepository as Accounts
from ..api.schemas import BulkSetCategoryRequest
from ..services import category_service
from ..utils import paths


class CategoryAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = create_engine("sqlite:///" + self.temp.name + "/categories.db", connect_args={"check_same_thread": False})
        event.listen(self.engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
        migrate(self.engine)
        self.old_profiles = paths.PROFILES_DIR
        paths.PROFILES_DIR = self.temp.name + "/profiles"
        self.hwid = patch("modules.module_02_account_manager.security.encryption.get_hwid", return_value="test-hwid")
        self.hwid.start()
        app = FastAPI()
        app.include_router(router)
        app.include_router(alias_router)

        def database():
            with Session(self.engine, expire_on_commit=False) as db:
                yield db

        app.dependency_overrides[get_db] = database
        self.client = TestClient(app).__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.hwid.stop()
        paths.PROFILES_DIR = self.old_profiles
        self.engine.dispose()
        self.temp.cleanup()

    def request(self, method, path="", owner="alice", **kwargs):
        headers = {"X-User-Id": owner} if owner is not None else {}
        return self.client.request(method, "/api/accounts" + path, headers=headers, **kwargs)

    def create(self, owner="alice", **fields):
        response = self.request("POST", "/categories", owner, json={"name": "Main", **fields})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def save(self, uid="123", owner="alice", **fields):
        response = self.request("POST", "/single", owner, json={"uid": uid, **fields})
        self.assertEqual(response.status_code, 200, response.text)

    def test_crud_counts_timestamps_and_partial_update(self):
        category = self.create(name="  Main  ", color="#aBc123")
        self.assertEqual((category["name"], category["user_id"], category["account_count"]), ("Main", "alice", 0))
        self.assertTrue(category["created_at"].endswith("+00:00"))
        self.save(category_id=category["id"])
        with Session(self.engine) as db:
            db.query(AccountCategory).update({"updated_at": datetime(2000, 1, 1)})
            db.commit()
        updated = self.request("PATCH", f"/categories/{category['id']}", json={"color": None}).json()
        self.assertEqual((updated["name"], updated["color"], updated["account_count"]), ("Main", None, 1))
        self.assertGreater(updated["updated_at"], "2000-01-01")
        self.assertEqual(updated["created_at"], category["created_at"])
        self.assertEqual(self.request("GET", "/categories").json(), [updated])

    def test_validation_and_name_uniqueness_including_local_owner(self):
        for payload in ({"name": "   "}, {"name": "x" * 101}, {"name": None}, {"name": "Valid", "color": "red"}):
            self.assertEqual(self.request("POST", "/categories", json=payload).status_code, 422)
        first = self.create()
        self.assertEqual(self.request("POST", "/categories", json={"name": " main "}).status_code, 409)
        self.create(owner="bob")
        self.create(owner=None)
        self.assertEqual(self.request("POST", "/categories", None, json={"name": "MAIN"}).status_code, 409)
        second = self.create(name="Second")
        self.assertEqual(self.request("PATCH", f"/categories/{second['id']}", json={"name": "MAIN"}).status_code, 409)
        self.assertEqual(self.request("PATCH", f"/categories/{first['id']}", json={"name": None}).status_code, 422)
        self.assertEqual(len(self.request("GET", "/categories").json()), 2)

    def test_owner_isolation_for_category_mutations_and_filters(self):
        category = self.create()
        self.assertEqual(self.request("GET", "/categories", "bob").json(), [])
        for method, body in (("PATCH", {"name": "Stolen"}), ("DELETE", None)):
            kwargs = {"json": body} if body else {}
            self.assertEqual(self.request(method, f"/categories/{category['id']}", "bob", **kwargs).status_code, 404)
        self.save(owner="bob")
        self.assertEqual(self.request("POST", "/single", "bob", json={"uid": "123", "category_id": category["id"]}).status_code, 404)
        for endpoint in ("", "/page", "/stats"):
            self.assertEqual(self.request("GET", endpoint, "bob", params={"category_id": category["id"]}).status_code, 404)
        self.assertEqual(self.request("GET", "/categories").json()[0]["name"], "Main")

    def test_patch_owner_body_conflicts_and_authenticated_owner(self):
        category = self.create()
        self.assertEqual(self.request("PATCH", f"/categories/{category['id']}", json={"user_id": "bob", "name": "Bad"}).status_code, 422)
        with patch("modules.module_auth.service.bearer_user", return_value={"id": "alice"}):
            response = self.client.patch(f"/api/accounts/categories/{category['id']}", headers={"Authorization": "Bearer mock"}, json={"user_id": "bob", "name": "Bad"})
            self.assertEqual(response.status_code, 403)
            response = self.client.post("/api/accounts/categories", headers={"Authorization": "Bearer mock"}, json={"name": "Authenticated"})
            self.assertEqual(response.json()["user_id"], "alice")

    def test_bulk_transfer_dedup_unassign_and_rollback(self):
        first = self.create()
        second = self.create(name="Second")
        self.save("123", category_id=first["id"])
        self.save("456")
        self.save("123", owner="bob")
        response = self.request("POST", "/bulk-set-category", json={"uids": ["123", "456", "123"], "category_id": second["id"]})
        self.assertEqual(response.json(), {"updated_count": 2})
        self.assertIsNone(self.request("GET", "/123", "bob").json()["category_id"])
        response = self.request("POST", "/bulk-set-category", json={"uids": ["123", "999999"], "category_id": first["id"]})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.request("GET", "/123").json()["category_id"], second["id"])
        response = self.request("POST", "/bulk-set-category", "bob", json={"uids": ["123"], "category_id": first["id"]})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.request("POST", "/bulk-set-category", json={"uids": ["123", "456"], "category_id": None}).json(), {"updated_count": 2})
        self.assertTrue(all(row["category_id"] is None for row in self.request("GET").json()))

    def test_bulk_validation(self):
        for payload in ({"uids": [], "category_id": None}, {"uids": [str(i) for i in range(101)], "category_id": None}, {"uids": ["../bad"], "category_id": None}, {"uids": ["123"]}, {"uids": ["123"], "category_id": 0}):
            self.assertEqual(self.request("POST", "/bulk-set-category", json=payload).status_code, 422)

    def test_commit_failure_rolls_back_assignment_and_category_deletion(self):
        first = self.create()
        second = self.create(name="Second")
        self.save(category_id=first["id"])
        with Session(self.engine) as db, owner_scope("alice"):
            for operation in (
                lambda: category_service.bulk_set_category(db, BulkSetCategoryRequest(uids=["123"], category_id=second["id"])),
                lambda: category_service.delete_category(db, first["id"]),
            ):
                with patch.object(db, "commit", side_effect=RuntimeError("Database unavailable")):
                    with self.assertRaises(RuntimeError):
                        operation()
                self.assertEqual(Accounts.get_by_uid(db, "123").category_id, first["id"])
                self.assertIsNotNone(db.get(AccountCategory, first["id"]))

    def test_delete_unassigns_without_touching_accounts_or_other_owner(self):
        category = self.create()
        other = self.create(owner="bob")
        self.save(category_id=category["id"], password="secret", email="a@example.com")
        self.save(owner="bob", category_id=other["id"])
        response = self.request("DELETE", f"/categories/{category['id']}")
        self.assertEqual(response.json(), {"deleted": True, "unassigned_count": 1})
        account = self.request("GET", "/123").json()
        self.assertEqual((account["category_id"], account["password"], account["email"]), (None, "secret", "a@example.com"))
        self.assertEqual(self.request("GET", "/123", "bob").json()["category_id"], other["id"])
        self.assertEqual(self.request("DELETE", f"/categories/{category['id']}").status_code, 404)

    def test_import_category_assignment_respects_skip_overwrite_and_omitted_field(self):
        first = self.create(name="First")
        second = self.create(name="Second", color="#2563EB")
        self.save(uid="1234", category_id=first["id"])
        self.save(uid="5678", category_id=first["id"])
        response = self.request("POST", "/import", json={"check_status": False, "skip_existing": True,
            "accounts": [{"uid": "1234", "category_id": second["id"]}, {"uid": "9012", "category_id": second["id"]}]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["skipped_count"], 1)
        self.assertEqual(response.json()["added_count"], 1)
        self.assertEqual(self.request("GET", "/1234").json()["category_id"], first["id"])
        self.assertEqual(self.request("GET", "/9012").json()["category_id"], second["id"])
        response = self.request("POST", "/import", json={"check_status": False, "skip_existing": False,
            "accounts": [{"uid": "1234", "category_id": second["id"]}, {"uid": "5678", "category_id": second["id"]}]})
        self.assertEqual(response.json()["updated_count"], 2)
        for uid in ("1234", "5678"):
            self.assertEqual(self.request("GET", "/" + uid).json()["category_id"], second["id"])
        self.request("POST", "/import", json={"check_status": False, "accounts": [{"uid": "5678", "email": "updated@example.com"}]})
        self.assertEqual(self.request("GET", "/5678").json()["category_id"], second["id"])

    def test_import_reports_partial_failure_for_deleted_category(self):
        deleted = self.create(name="Deleted")
        valid = self.create(name="Valid")
        self.request("DELETE", f"/categories/{deleted['id']}")
        response = self.request("POST", "/import", json={"check_status": False, "accounts": [
            {"uid": "1234", "category_id": deleted["id"]}, {"uid": "5678", "category_id": valid["id"]}]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["added_count"], 1)
        self.assertEqual([error["uid"] for error in response.json()["errors"]], ["1234"])
        self.assertEqual(self.request("GET", "/5678").json()["category_id"], valid["id"])

    def test_single_edit_and_import_preserve_or_clear_assignment(self):
        category = self.create()
        self.save(category_id=category["id"])
        self.save(original_uid="123", email="updated@example.com")
        self.assertEqual(self.request("GET", "/123").json()["category_id"], category["id"])
        self.save(original_uid="123", category_id=None)
        self.assertIsNone(self.request("GET", "/123").json()["category_id"])
        payload = {"accounts": [{"uid": "123", "category_id": category["id"]}, {"uid": "456"}]}
        self.assertEqual(self.request("POST", "/import", json=payload).json()["imported"], 2)
        self.request("POST", "/import", json={"accounts": [{"uid": "123", "email": "keep@example.com"}]})
        self.assertEqual(self.request("GET", "/123").json()["category_id"], category["id"])
        skipped = self.request("POST", "/import", json={"skip_existing": True, "accounts": [{"uid": "123", "category_id": None}]}).json()
        self.assertEqual(skipped["skipped_count"], 1)
        self.assertEqual(self.request("GET", "/123").json()["category_id"], category["id"])
        self.request("POST", "/import", json={"accounts": [{"uid": "123", "category_id": None}]})
        self.assertIsNone(self.request("GET", "/123").json()["category_id"])
        foreign = self.create(owner="bob")
        self.assertEqual(self.request("POST", "/single", json={"uid": "123", "original_uid": "123", "category_id": foreign["id"], "email": "forbidden@example.com"}).status_code, 404)
        self.assertEqual(self.request("GET", "/123").json()["email"], "keep@example.com")
        result = self.request("POST", "/import", json={"accounts": [{"uid": "123", "category_id": foreign["id"]}, {"uid": "789", "category_id": category["id"]}]}).json()
        self.assertEqual((result["imported"], len(result["errors"])), (1, 1))
        self.assertIsNone(self.request("GET", "/123").json()["category_id"])

    def test_filters_pagination_stats_and_legacy_alias(self):
        category = self.create()
        with Session(self.engine) as db, owner_scope("alice"):
            for i in range(13):
                Accounts.upsert(db, {"uid": str(1000 + i), "category_id": category["id"], "email": "filter@example.com"})
            Accounts.update_profile_statuses(db, {"1000": "live", "1001": "die"})
        self.save("999")
        self.save("1000", owner="bob")
        params = {"category_id": category["id"]}
        page = self.request("GET", "/page", params=params).json()
        self.assertEqual((len(page["accounts"]), page["total"], page["has_more"]), (10, 13, True))
        next_page = self.request("GET", "/page", params={**params, "cursor": page["next_cursor"]}).json()
        self.assertEqual((len(next_page["accounts"]), next_page["total"], next_page["has_more"]), (3, 13, False))
        self.assertEqual(self.request("GET", "/stats", params=params).json(), {"total": 13, "live": 1, "die": 1})
        filtered = self.request("GET", "/page", params={**params, "status": "live", "search": "filter@", "active_only": True}).json()
        # Active-only search uses UID/profile/proxy, rather than email.
        self.assertEqual(filtered["total"], 0)
        filtered = self.request("GET", "/page", params={**params, "status": "live", "search": "filter@"}).json()
        self.assertEqual(filtered["total"], 1)
        self.assertEqual(self.request("GET", "/page", params={**params, "login_status": "failed"}).json()["total"], 0)
        self.assertEqual(len(self.request("GET").json()), 14)
        for endpoint in ("", "/page", "/stats"):
            self.assertEqual(self.request("GET", endpoint, params={**params, "uncategorized": True}).status_code, 422)
            self.assertEqual(self.request("GET", endpoint, params={"category_id": 0}).status_code, 422)
        self.assertEqual([a["uid"] for a in self.request("GET", params={"uncategorized": True}).json()], ["999"])
        self.assertEqual(self.request("GET", "/stats", params={"uncategorized": True}).json()["total"], 1)
        self.assertEqual(self.request("GET", "/page", params={"uncategorized": True}).json()["total"], 1)
        alias = self.client.get("/accounts", headers={"X-User-Id": "alice"}, params=params)
        self.assertEqual(len(alias.json()), 13)


class CategoryMigrationTests(unittest.TestCase):
    def make_engine(self):
        engine = create_engine("sqlite:///:memory:")
        event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
        self.addCleanup(engine.dispose)
        return engine

    def test_upgrade_v4_preserves_data_and_is_repeatable(self):
        engine = self.make_engine()
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE account_plugin_schema(version INTEGER PRIMARY KEY)"))
            for version in range(1, 5):
                conn.execute(text("INSERT INTO account_plugin_schema VALUES (:v)"), {"v": version})
            conn.execute(text("CREATE TABLE accounts(id INTEGER PRIMARY KEY, user_id VARCHAR(100), uid VARCHAR(50), password TEXT, credential_encryption_version INTEGER)"))
            conn.execute(text("INSERT INTO accounts VALUES (1,'alice','123','unchanged-ciphertext',2)"))
        migrate(engine)
        migrate(engine)
        with engine.connect() as conn:
            self.assertEqual(tuple(conn.execute(text("SELECT uid,password,credential_encryption_version,category_id FROM accounts")).one()), ("123", "unchanged-ciphertext", 2, None))
            self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM account_plugin_schema")).scalar(), 6)
            foreign_keys = inspect(conn).get_foreign_keys("accounts")
            self.assertTrue(any(fk["referred_table"] == "account_categories" for fk in foreign_keys))
            self.assertIn("ix_accounts_user_category", {idx["name"] for idx in inspect(conn).get_indexes("accounts")})
        with engine.begin() as conn:
            category_id = conn.execute(AccountCategory.__table__.insert().values(user_id="alice", name="Main")).inserted_primary_key[0]
            conn.execute(text("UPDATE accounts SET category_id=:id"), {"id": category_id})
            conn.execute(text("DELETE FROM account_categories WHERE id=:id"), {"id": category_id})
            self.assertIsNone(conn.execute(text("SELECT category_id FROM accounts")).scalar())

    def test_new_database_enforces_fk_and_delete_set_null(self):
        engine = self.make_engine()
        migrate(engine)
        with Session(engine) as db, owner_scope("alice"):
            category = AccountCategory(user_id="alice", name="Main")
            db.add(category)
            db.commit()
            account = Accounts.upsert(db, {"uid": "123", "category_id": category.id})
            category_id = category.id
            db.execute(text("DELETE FROM account_categories WHERE id=:id"), {"id": category_id})
            db.commit()
            db.refresh(account)
            self.assertIsNone(account.category_id)
            account.category_id = category_id
            with self.assertRaises(IntegrityError):
                db.commit()
            db.rollback()

    def test_database_enforces_case_insensitive_names_for_each_owner(self):
        engine = self.make_engine()
        migrate(engine)
        with Session(engine) as db:
            db.add_all([AccountCategory(user_id="alice", name="Main"), AccountCategory(user_id="bob", name="Main"), AccountCategory(user_id=None, name="Main")])
            db.commit()
            for owner in ("alice", None):
                db.add(AccountCategory(user_id=owner, name="MAIN"))
                with self.assertRaises(IntegrityError):
                    db.commit()
                db.rollback()


@unittest.skipUnless(os.getenv("ACCOUNT_TEST_POSTGRES_URL"), "No dedicated PostgreSQL test URL configured")
class PostgreSQLCategoryMigrationTests(CategoryMigrationTests):
    def make_engine(self):
        from .test_database import PostgreSQLMigrationTests
        return PostgreSQLMigrationTests.make_engine(self)
