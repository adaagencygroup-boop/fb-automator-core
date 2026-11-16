import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from fastapi import HTTPException
from pydantic import ValidationError
from ..database.connection import Base
from ..database.repository import AccountRepository as Repo
from ..api.schemas import SingleAccountInput
from ..services.account_service import save_single_account
from ..context import owner_scope
from ..utils import paths
from ..automation import browser_manager as browsers
from ..services import browser_service, login_service

class TestUidEdit(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patch = patch.object(paths, "PROFILES_DIR", self.temp.name)
        self.patch.start()
        self.owner = owner_scope("alice")
        self.owner.__enter__()
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.crypto = patch("modules.module_02_account_manager.database.repository.encrypt_data", side_effect=lambda v: "encrypted:" + v)
        self.crypto.start()
        self.account = Repo.upsert(self.db, {"uid": "1234", "cookie": "session", "password": "secret"})
        Repo.update_login_status(self.db, "1234", "logged_in", "Name")
        self.old = paths.profile_path("1234")
        self.old.mkdir(parents=True)
        (self.old / "Cookies").write_text("profile session")

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.crypto.stop()
        self.owner.__exit__(None, None, None)
        self.patch.stop()
        self.temp.cleanup()

    def edit(self, **fields):
        return save_single_account(self.db, SingleAccountInput(uid="5678", original_uid="1234", **fields))

    def assert_original(self):
        self.assertIsNotNone(Repo.get_by_uid(self.db, "1234"))
        self.assertIsNone(Repo.get_by_uid(self.db, "5678"))
        self.assertTrue((self.old / "Cookies").exists())

    def test_preserves_record_session_and_owner(self):
        record_id, last_login = self.account.id, self.account.last_login_at
        with owner_scope("bob"):
            Repo.upsert(self.db, {"uid": "5678", "cookie": "bob"})
        result = self.edit(email="new@example.com", password="newsecret")
        self.assertEqual(result.id, record_id)
        self.assertEqual(len(Repo.get_all(self.db)), 1)
        self.assertEqual((result.cookie, result.profile_name, result.login_status, result.last_login_at), ("session", "Name", "LOGGED_IN", last_login))
        self.assertEqual(result.password, "encrypted:newsecret")
        self.assertEqual(result.profile_path, paths.get_profile_path("5678"))
        self.assertEqual((paths.profile_path("5678") / "Cookies").read_text(), "profile session")
        self.assertFalse(self.old.exists())
        with owner_scope("bob"):
            self.assertEqual(Repo.get_by_uid(self.db, "5678").cookie, "bob")

    def test_conflicts_and_missing(self):
        Repo.upsert(self.db, {"uid": "5678"})
        with self.assertRaises(HTTPException) as error:
            self.edit()
        self.assertEqual(error.exception.status_code, 409)
        Repo.delete(self.db, "5678")
        paths.profile_path("5678").mkdir()
        with self.assertRaises(HTTPException) as error:
            self.edit()
        self.assertEqual(error.exception.status_code, 409)
        self.assert_original()
        with self.assertRaises(HTTPException) as error:
            save_single_account(self.db, SingleAccountInput(uid="9999", original_uid="8888"))
        self.assertEqual(error.exception.status_code, 404)
        for field in ("uid", "original_uid"):
            with self.assertRaises(ValidationError):
                SingleAccountInput(**{"uid": "5678", "original_uid": "1234", field: "../invalid"})

    def test_busy_profiles(self):
        for uid in ("1234", "5678"):
            lock = browsers.get_profile_lock(uid)
            with lock, self.assertRaises(HTTPException) as error:
                self.edit()
            self.assertEqual(error.exception.status_code, 409)
        for pending in (browser_service._open_browser_pending, login_service._login_pending):
            pending.add(paths.account_key("1234"))
            try:
                with self.assertRaises(HTTPException):
                    self.edit()
            finally:
                pending.clear()
        driver = Mock(window_handles=["window"])
        browsers.register_active_driver(driver, "1234")
        try:
            result = self.edit()
            self.assertEqual(result.uid, "5678")
            self.assertTrue(driver.quit.called)
        finally:
            browsers.unregister_active_driver(driver)

    def test_disconnected_driver_cleaned_up_on_edit(self):
        type(driver := Mock()).window_handles = unittest.mock.PropertyMock(side_effect=Exception("chrome not reachable"))
        browsers.register_active_driver(driver, "1234")
        try:
            result = self.edit()
            self.assertEqual(result.uid, "5678")
        finally:
            browsers.unregister_active_driver(driver)

    def test_rollback_failures(self):
        with patch.object(Path, "rename", side_effect=OSError("rename failed")):
            with self.assertRaises(OSError):
                self.edit()
        self.assert_original()
        with patch.object(self.db, "commit", side_effect=RuntimeError("commit failed")):
            with self.assertRaises(RuntimeError):
                self.edit(email="changed")
        self.assert_original()
        self.assertIsNone(Repo.get_by_uid(self.db, "1234").email)

    def test_same_uid_new_account_and_missing_profile(self):
        result = save_single_account(self.db, SingleAccountInput(uid="1234", original_uid="1234", email="same@example.com"))
        self.assertEqual(result.id, self.account.id)
        save_single_account(self.db, SingleAccountInput(uid="9999", password="new"))
        (self.old / "Cookies").unlink()
        self.old.rmdir()
        result = self.edit()
        self.assertEqual(result.profile_path, str(paths.profile_path("5678")))
        self.assertFalse(paths.profile_path("5678").exists())

    def test_restore_failure_is_reported(self):
        rename = Path.rename
        calls = []
        def failing_restore(source, target):
            calls.append(source)
            if len(calls) == 2:
                raise OSError("restore failed")
            return rename(source, target)
        with patch.object(Path, "rename", failing_restore), patch.object(self.db, "commit", side_effect=RuntimeError("commit failed")):
            with self.assertRaises(HTTPException) as error:
                self.edit()
        self.assertEqual(error.exception.status_code, 500)
        self.assertIn("restoring", error.exception.detail)
        self.assertIsNotNone(Repo.get_by_uid(self.db, "1234"))

    def test_http_statuses_survive_router(self):
        import asyncio
        from ..api.router import save_single, save_single_alias
        for handler in (save_single, save_single_alias):
            for status in (404, 409, 422, 500):
                with patch("modules.module_02_account_manager.services.account_service.save_single_account", side_effect=HTTPException(status, "specific error")):
                    with self.assertRaises(HTTPException) as error:
                        asyncio.run(handler(SingleAccountInput(uid="5678"), self.db))
                    self.assertEqual(error.exception.status_code, status)
