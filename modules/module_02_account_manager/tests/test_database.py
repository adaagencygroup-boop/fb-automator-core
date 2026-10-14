import os
import unittest
from unittest.mock import patch
from sqlalchemy import create_engine, inspect, text
from ..database.models import Account
from ..security import encryption
from ..database.migrations import migrate
from ..database.repository import AccountRepository as Repo
from ..context import owner_scope
from sqlalchemy.orm import Session

class MigrationTests(unittest.TestCase):
    def make_engine(self):
        return create_engine("sqlite:///:memory:")

    def test_upgrade_old_schema_preserves_ciphertext_and_is_repeatable(self):
        engine = self.make_engine()
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id VARCHAR(100), uid VARCHAR(50) NOT NULL, password VARCHAR(255), two_fa VARCHAR(100), pass_mail VARCHAR(255))"))
            conn.execute(text("INSERT INTO accounts(id,uid,password) VALUES (1,'123','')"))
        migrate(engine)
        migrate(engine)
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT password FROM accounts")).scalar(), "")
            self.assertEqual(conn.execute(text("SELECT credential_encryption_version FROM accounts")).scalar(), 2)
            self.assertIn("token_hotmail", {c["name"] for c in inspect(conn).get_columns("accounts")})
            self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM account_plugin_schema")).scalar(), 3)
        engine.dispose()


    def test_v2_converts_all_secrets_once_and_records_version(self):
        engine = self.make_engine()
        old_hwid, source_hwid = "old-hwid", "source-hwid"
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id VARCHAR(100), uid VARCHAR(50) NOT NULL, password VARCHAR(255), two_fa VARCHAR(100), pass_mail VARCHAR(255))"))
            conn.execute(text("INSERT INTO accounts(id,uid,password,two_fa,pass_mail) VALUES (1,'123',:p,:f,:m)"), {
                "p": encryption._crypt("password", old_hwid),
                "f": encryption._crypt("2fa", old_hwid),
                "m": encryption._crypt("mail-password", old_hwid),
            })
        with patch.object(encryption, "get_legacy_hwid", return_value=old_hwid), patch.object(encryption, "get_hwid", return_value=source_hwid):
            migrate(engine)
            with engine.connect() as conn:
                row = conn.execute(text("SELECT password,two_fa,pass_mail,credential_encryption_version FROM accounts WHERE id=1")).one()
                self.assertEqual(row[3], 2)
                self.assertEqual([encryption._decrypt(value, source_hwid) for value in row[:3]], ["password", "2fa", "mail-password"])
                converted = row[0]
            with patch.object(encryption, "decrypt_legacy_data", side_effect=AssertionError("converted twice")):
                migrate(engine)
            with engine.connect() as conn:
                self.assertEqual(conn.execute(text("SELECT password FROM accounts WHERE id=1")).scalar(), converted)
        engine.dispose()

    def test_bad_legacy_secret_rolls_back_every_conversion_and_schema_version(self):
        engine = self.make_engine()
        old_hwid = "old-hwid"
        valid = encryption._crypt("valid", old_hwid)
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id VARCHAR(100), uid VARCHAR(50) NOT NULL, password VARCHAR(255), two_fa VARCHAR(100), pass_mail VARCHAR(255))"))
            conn.execute(text("INSERT INTO accounts(id,uid,password) VALUES (1,'123',:secret),(2,'456','corrupt')"), {"secret": valid})
        with patch.object(encryption, "get_legacy_hwid", return_value=old_hwid), patch.object(encryption, "get_hwid", return_value="source-hwid"):
            with self.assertRaisesRegex(RuntimeError, "account id=2"):
                migrate(engine)
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT password FROM accounts WHERE id=1")).scalar(), valid)
            self.assertEqual(conn.execute(text("SELECT password FROM accounts WHERE id=2")).scalar(), "corrupt")
            self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM account_plugin_schema")).scalar(), 0)
        engine.dispose()

    def test_duplicate_local_uids_stop_migration(self):
        engine = self.make_engine()
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id VARCHAR(100), uid VARCHAR(50))"))
            conn.execute(text("INSERT INTO accounts VALUES (1,NULL,'123'),(2,NULL,'123')"))
        with self.assertRaisesRegex(RuntimeError, "Duplicate"):
            migrate(engine)
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM accounts")).scalar(), 2)
        engine.dispose()

    def test_local_uid_uniqueness_and_owner_scope(self):
        engine = self.make_engine()
        migrate(engine)
        with Session(engine) as db, patch("modules.module_02_account_manager.security.encryption.get_hwid", return_value="test"):
            with owner_scope("alice"):
                Repo.upsert(db, {"uid": "123", "password": "alice"})
            with owner_scope("bob"):
                Repo.upsert(db, {"uid": "123", "password": "bob"})
            with owner_scope(None):
                self.assertEqual(Repo.get_all(db), [])
                Repo.upsert(db, {"uid": "123"})
                Repo.upsert(db, {"uid": "123"})
                self.assertEqual(len(Repo.get_all(db)), 1)
            self.assertEqual(db.query(Account).count(), 3)
        engine.dispose()

@unittest.skipUnless(os.getenv("ACCOUNT_TEST_POSTGRES_URL"), "No dedicated PostgreSQL test URL configured")
class PostgreSQLMigrationTests(MigrationTests):
    def make_engine(self):
        # Dedicated temporary schema; never use the application's DATABASE_URL.
        import uuid
        url = os.environ["ACCOUNT_TEST_POSTGRES_URL"]
        admin = create_engine(url)
        schema = "account_test_" + uuid.uuid4().hex
        with admin.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
        def cleanup():
            engine.dispose()
            with admin.begin() as conn:
                conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()
        self.addCleanup(cleanup)
        return engine
