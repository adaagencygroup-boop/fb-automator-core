"""Deletion checks use an isolated database and temporary local profiles only."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from ..api.router import alias_router, router
from ..context import owner_scope
from ..database.connection import Base, get_db
from ..database.models import Account
from ..database.repository import AccountRepository as Repo
from ..services import account_service as accounts
from ..utils import paths
from ..utils.profile_storage import delete_profiles_by_uid
from ..automation import browser_manager


class AccountDeletionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.db.execute(text("CREATE TABLE pages (id INTEGER PRIMARY KEY, account_uid VARCHAR(100), page_id VARCHAR(100), user_id VARCHAR(100))"))
        self.db.add_all([Account(uid="123", user_id="alice"), Account(uid="456", user_id="alice"), Account(uid="789", user_id="bob")])
        self.db.execute(text("INSERT INTO pages VALUES (1,'123','page1','alice'),(2,'123','page2','alice'),(3,'456','page3','alice'),(4,'789','page4','bob'),(5,NULL,'orphan',NULL)"))
        self.db.commit()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        self.profile_patch = patch.object(paths, "PROFILES_DIR", self.temp.name)
        self.profile_patch.start()
        self.addCleanup(self.profile_patch.stop)
        self.scope = owner_scope("alice")
        self.scope.__enter__()
        self.addCleanup(self.scope.__exit__, None, None, None)
        self.profile = Path(paths.get_profile_path("123"))
        (self.profile / "cookies.txt").write_text("test", encoding="utf-8")

    def pages(self):
        return dict(self.db.execute(text("SELECT id, account_uid FROM pages")).all())

    def assert_account_kept(self, uid="123"):
        self.assertIsNotNone(Repo.get_by_uid(self.db, uid))

    def test_preview_counts_selected_accounts_only(self):
        self.assertEqual(accounts.delete_preview(self.db, ["123", "456"]), {
            "page_counts": {"123": 2, "456": 1}, "pages_total": 3,
        })
        self.assertTrue(self.profile.exists())
        self.assert_account_kept()

    def test_preview_rejects_other_owner(self):
        with self.assertRaises(HTTPException) as caught:
            accounts.delete_preview(self.db, ["789"])
        self.assertEqual(caught.exception.status_code, 404)

    def test_account_only_unlinks_pages_and_removes_profile(self):
        result = accounts.delete_account(self.db, "123")
        self.assertTrue(result["deleted"])
        self.assertEqual(result["pages_unlinked"], 2)
        self.assertEqual(result["pages_deleted"], 0)
        self.assertEqual(result["profiles_deleted"], [str(self.profile)])
        self.assertFalse(self.profile.exists())
        self.assertIsNone(Repo.get_by_uid(self.db, "123"))
        self.assertEqual(self.pages(), {1: None, 2: None, 3: "456", 4: "789", 5: None})

    def test_combined_delete_removes_related_pages_only(self):
        result = accounts.delete_account(self.db, "123", delete_pages=True)
        self.assertEqual(result["pages_deleted"], 2)
        self.assertEqual(result["pages_unlinked"], 0)
        self.assertEqual(self.pages(), {3: "456", 4: "789", 5: None})
        self.assertFalse(self.profile.exists())

    def test_missing_profile_still_deletes_existing_account(self):
        delete_profiles_by_uid("123")
        result = accounts.delete_account(self.db, "123")
        self.assertTrue(result["deleted"])
        self.assertEqual(result["profiles_deleted"], [])
        self.assertEqual(result["pages_unlinked"], 2)

    def test_other_owner_profile_is_preserved(self):
        with owner_scope("bob"):
            other_profile = Path(paths.get_profile_path("123"))
            (other_profile / "cookies.txt").write_text("other owner", encoding="utf-8")
        accounts.delete_account(self.db, "123")
        self.assertTrue((other_profile / "cookies.txt").exists())

    def test_no_fanpage_module_still_allows_account_deletion(self):
        self.db.execute(text("DROP TABLE pages"))
        self.db.commit()
        self.assertEqual(accounts.delete_preview(self.db, ["123"])["pages_total"], 0)
        self.assertEqual(accounts.delete_account(self.db, "123")["pages_unlinked"], 0)

    def test_changed_links_are_rechecked_at_execution(self):
        self.db.execute(text("DELETE FROM pages WHERE account_uid='123'"))
        self.db.commit()
        self.assertEqual(accounts.delete_preview(self.db, ["123"])["pages_total"], 0)
        self.db.execute(text("INSERT INTO pages VALUES (6,'123','new-page','alice')"))
        self.db.commit()
        self.assertEqual(accounts.delete_account(self.db, "123")["pages_unlinked"], 1)
        self.assertIsNone(self.pages()[6])

    def test_profile_failure_preserves_account_and_pages(self):
        with patch.object(accounts, "delete_profiles_by_uid", side_effect=RuntimeError("busy")):
            with self.assertRaises(HTTPException) as caught:
                accounts.delete_account(self.db, "123", delete_pages=True)
        self.assertEqual(caught.exception.status_code, 409)
        self.assert_account_kept()
        self.assertEqual(self.pages()[1], "123")
        self.assertTrue(self.profile.exists())

    def test_busy_profile_lock_blocks_all_deletion(self):
        lock = browser_manager.get_profile_lock("123")
        lock.acquire()
        try:
            with self.assertRaises(HTTPException) as caught:
                accounts.delete_account(self.db, "123", delete_pages=True)
            self.assertEqual(caught.exception.status_code, 409)
        finally:
            lock.release()
        self.assert_account_kept()
        self.assertEqual(self.pages()[1], "123")
        self.assertTrue(self.profile.exists())

    def test_open_chrome_is_closed_and_account_deleted(self):
        driver = Mock(window_handles=[], service=Mock(process=Mock(pid=None)))
        with patch.object(browser_manager, "_active_drivers", {driver: {"uid": "123", "owner": "alice"}}):
            result = accounts.delete_account(self.db, "123")
        self.assertTrue(result["deleted"])
        self.assertIsNone(Repo.get_by_uid(self.db, "123"))
        self.assertFalse(self.profile.exists())

    def test_other_owner_browser_does_not_block_own_deletion(self):
        driver = Mock(window_handles=["window"])
        with patch.object(browser_manager, "_active_drivers", {driver: {"uid": "123", "owner": "bob"}}):
            self.assertTrue(accounts.delete_account(self.db, "123")["deleted"])

    def test_shared_uid_and_page_are_independent_between_owners(self):
        self.db.add(Account(uid="123", user_id="bob"))
        self.db.execute(text("INSERT INTO pages VALUES (6,'123','page1','bob'), (7,'123','unknown',NULL)"))
        self.db.commit()
        self.assertEqual(accounts.delete_preview(self.db, ["123"])["pages_total"], 2)
        result = accounts.delete_account(self.db, "123", delete_pages=True)
        self.assertEqual(result["pages_deleted"], 2)
        self.assertEqual(self.pages()[6], "123")
        self.assertEqual(self.pages()[7], "123")
        with owner_scope("bob"):
            self.assertIsNotNone(Repo.get_by_uid(self.db, "123"))
            self.assertEqual(accounts.delete_preview(self.db, ["123"])["pages_total"], 1)

    def test_database_failure_rolls_back_account_and_pages(self):
        for delete_pages in (False, True):
            with self.subTest(delete_pages=delete_pages):
                with patch.object(self.db, "commit", side_effect=RuntimeError("commit failed")):
                    with self.assertRaisesRegex(RuntimeError, "commit failed"):
                        accounts.delete_account(self.db, "123", delete_pages=delete_pages)
                self.assert_account_kept()
                self.assertEqual(self.pages()[1], "123")
                self.assertFalse(self.profile.exists())

    def test_bulk_failure_keeps_failed_account_and_reports_real_counts(self):
        def remove_profile(uid):
            if uid == "456":
                raise RuntimeError("busy")
            return delete_profiles_by_uid(uid)
        with patch.object(accounts, "delete_profiles_by_uid", side_effect=remove_profile):
            result = accounts.bulk_delete(self.db, ["456", "123"], delete_pages=True)
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["deleted_uids"], ["123"])
        self.assertEqual(result["profiles_deleted"], 1)
        self.assertEqual(result["pages_deleted"], 2)
        self.assertEqual(result["errors"], [{"uid": "456", "error": "busy"}])
        self.assert_account_kept("456")
        self.assertEqual(self.pages(), {3: "456", 4: "789", 5: None})

    def make_client(self):
        app = FastAPI()
        app.include_router(router)
        app.include_router(alias_router)
        def isolated_db():
            yield self.db
        app.dependency_overrides[get_db] = isolated_db
        return TestClient(app)

    def test_http_preview_and_single_delete_option(self):
        with self.make_client() as client:
            for prefix in ("/api/accounts", "/accounts"):
                response = client.post(prefix + "/delete-preview", json={"uids": ["123", "123"], "owner_username": "alice"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["pages_total"], 2)
            response = client.delete("/api/accounts/123?owner_username=alice&delete_pages=true")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["pages_deleted"], 2)

    def test_http_legacy_delete_defaults_to_keep_pages(self):
        with self.make_client() as client:
            response = client.delete("/accounts/123?owner_username=alice")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["pages_unlinked"], 2)
        self.assertIsNone(self.pages()[1])

    def test_http_bulk_alias_deduplicates_and_passes_option(self):
        with self.make_client() as client:
            response = client.post("/accounts/bulk-delete", json={
                "uids": ["123", "123", "456"], "owner_username": "alice", "delete_pages": True,
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted"], 2)
        self.assertEqual(response.json()["pages_deleted"], 3)

    def test_http_invalid_uid_and_delete_option_do_not_delete(self):
        with self.make_client() as client:
            self.assertEqual(client.post("/api/accounts/delete-preview", json={"uids": ["../123"]}).status_code, 422)
            self.assertEqual(client.delete("/api/accounts/123?owner_username=alice&delete_pages=invalid").status_code, 422)
        self.assert_account_kept()
        self.assertTrue(self.profile.exists())


if __name__ == "__main__":
    unittest.main()
