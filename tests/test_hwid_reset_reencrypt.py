"""Comprehensive tests for preserving & re-encrypting account credentials across HWID reset."""
import os
import sqlite3
import sys
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import types

# Prevent core.database.connection from opening a live PostgreSQL pool during unit tests.
if "core.database.connection" not in sys.modules:
    _stub_conn = types.ModuleType("core.database.connection")
    _stub_conn.db = None
    sys.modules["core.database.connection"] = _stub_conn


class InMemorySQLiteDB:
    """Transactional in-memory SQLite drop-in replacement for DatabaseManager."""

    def __init__(self):
        self._is_postgres = False
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.fail_on_sql_substring = None

    def _normalize_query(self, query: str) -> str:
        return query.replace("%s", "?")

    @contextmanager
    def session(self):
        cursor = self.conn.cursor()

        class GuardedCursor:
            def __init__(self, inner, db_ref):
                self._inner = inner
                self._db = db_ref

            def execute(self, sql, params=()):
                if self._db.fail_on_sql_substring and self._db.fail_on_sql_substring in sql:
                    raise RuntimeError("Simulated DB failure")
                sql = sql.replace("%s", "?").replace(" FOR UPDATE", "")
                return self._inner.execute(sql, params)

            def fetchone(self):
                return self._inner.fetchone()

            def fetchall(self):
                return self._inner.fetchall()

            def close(self):
                return self._inner.close()

        wrapped = GuardedCursor(cursor, self)
        try:
            yield wrapped
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        finally:
            cursor.close()

    def execute(self, query: str, params: tuple = ()):
        norm_q = self._normalize_query(query)
        with self.session() as cursor:
            cursor.execute(norm_q, params)
            return cursor

    def fetch_all(self, query: str, params: tuple = ()):
        norm_q = self._normalize_query(query)
        with self.session() as cursor:
            cursor.execute(norm_q, params)
            return [dict(r) for r in cursor.fetchall()]

    def fetch_one(self, query: str, params: tuple = ()):
        norm_q = self._normalize_query(query)
        with self.session() as cursor:
            cursor.execute(norm_q, params)
            row = cursor.fetchone()
            return dict(row) if row else None

    @property
    def is_postgres(self) -> bool:
        return False


def _create_base_tables(fake_db: InMemorySQLiteDB, auth_schema, include_accounts: bool = True):
    fake_db.execute(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username VARCHAR(100) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role VARCHAR(20) DEFAULT 'user',
            status VARCHAR(20) DEFAULT 'approved',
            last_login TIMESTAMP,
            created_at TIMESTAMP
        )
        """
    )
    with patch.object(auth_schema, "backfill_account_licenses", MagicMock()):
        auth_schema.init_auth_tables()
    if include_accounts:
        fake_db.execute(
            """
            CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id VARCHAR(100),
                uid VARCHAR(50) NOT NULL,
                credential_encryption_version INTEGER NOT NULL DEFAULT 2,
                password TEXT,
                two_fa TEXT,
                pass_mail TEXT
            )
            """
        )


def _fake_request():
    req = MagicMock()
    req.headers = {"user-agent": "UnitTest/1.0"}
    req.client = SimpleNamespace(host="127.0.0.1")
    return req


class TestHwidResetReencrypt(unittest.TestCase):
    HWID_OLD = "a" * 64
    HWID_NEW = "b" * 64
    HWID_OTHER = "c" * 64
    HWID_UNKNOWN = "d" * 64

    def setUp(self):
        self.fake_db = InMemorySQLiteDB()

        # Patch db in both module_auth.service and module_auth.schema
        import modules.module_auth.schema as auth_schema
        import modules.module_auth.service as auth_service
        from modules.module_02_account_manager.security.encryption import _crypt, _decrypt
        from modules.module_auth.security import hash_password

        self.auth_schema = auth_schema
        self.auth_service = auth_service
        self._crypt = _crypt
        self._decrypt = _decrypt
        self.hash_password = hash_password

        self.db_patcher_service = patch.object(auth_service, "db", self.fake_db)
        self.db_patcher_schema = patch.object(auth_schema, "db", self.fake_db)
        self.publish_patcher = patch.object(auth_service, "publish", MagicMock())
        self.actor_patcher = patch.object(
            auth_service,
            "_actor",
            return_value=({"id": 999, "username": "admin", "role": "admin"}, "127.0.0.1", "UnitTest/1.0"),
        )
        self.db_patcher_service.start()
        self.db_patcher_schema.start()
        self.publish_patcher.start()
        self.actor_patcher.start()

        _create_base_tables(self.fake_db, auth_schema, include_accounts=True)

        # Seed users
        self.user_a_id = self._insert_user("alice", "Alice@1234", self.HWID_OLD)
        self.user_b_id = self._insert_user("bob", "Bob@123456", self.HWID_OTHER)

    def tearDown(self):
        self.actor_patcher.stop()
        self.publish_patcher.stop()
        self.db_patcher_schema.stop()
        self.db_patcher_service.stop()
        self.fake_db.conn.close()

    def _insert_user(self, username: str, password: str, hwid: str | None) -> int:
        now = datetime.utcnow()
        exp = now + timedelta(days=30)
        self.fake_db.execute(
            """INSERT INTO users (username, password_hash, contact_info, hwid, role, status, created_at, expired_at)
               VALUES (?, ?, ?, ?, 'user', 'approved', ?, ?)""",
            (username, self.hash_password(password), "0912345678", hwid, now, exp),
        )
        return self.fake_db.fetch_one("SELECT id FROM users WHERE username = ?", (username,))["id"]

    def _insert_account(self, user_id: int, uid: str, password=None, two_fa=None, pass_mail=None, hwid=None):
        hwid = hwid or self.HWID_OLD
        enc_pw = self._crypt(password, hwid) if password else password
        enc_2fa = self._crypt(two_fa, hwid) if two_fa else two_fa
        enc_mail = self._crypt(pass_mail, hwid) if pass_mail else pass_mail
        self.fake_db.execute(
            """INSERT INTO accounts (user_id, uid, credential_encryption_version, password, two_fa, pass_mail)
               VALUES (?, ?, 2, ?, ?, ?)""",
            (str(user_id), uid, enc_pw, enc_2fa, enc_mail),
        )
        return self.fake_db.fetch_one("SELECT id FROM accounts WHERE uid = ?", (uid,))["id"]

    def test_reset_hwid_then_login_new_machine_reencrypts_all_secrets(self):
        acc1_id = self._insert_account(
            self.user_a_id,
            "100001",
            password="P@ssw0rd!TiếngViệt#1",
            two_fa="JBSWY3DPEHPK3PXP",
            pass_mail="MailPass#999",
            hwid=self.HWID_OLD,
        )
        acc2_id = self._insert_account(
            self.user_a_id,
            "100002",
            password="OnlyPassword123",
            two_fa="",
            pass_mail=None,
            hwid=self.HWID_OLD,
        )
        bob_acc_id = self._insert_account(
            self.user_b_id,
            "200001",
            password="BobSecretPassword",
            two_fa="BOB2FASECRET",
            pass_mail="BobMailPass",
            hwid=self.HWID_OTHER,
        )

        # 1. Admin resets HWID of Alice
        res = self.auth_service.reset_hwid(self.user_a_id, "Đổi máy mới", _fake_request())
        self.assertIn("alice", res["message"])

        user_row = self.fake_db.fetch_one("SELECT hwid, previous_hwid FROM users WHERE id = ?", (self.user_a_id,))
        self.assertIsNone(user_row["hwid"])
        self.assertEqual(user_row["previous_hwid"], self.HWID_OLD)

        # Verify passwords are NEVER stored as plaintext in DB after reset
        acc1_mid = self.fake_db.fetch_one("SELECT password, two_fa, pass_mail FROM accounts WHERE id = ?", (acc1_id,))
        self.assertNotEqual(acc1_mid["password"], "P@ssw0rd!TiếngViệt#1")
        self.assertEqual(self._decrypt(acc1_mid["password"], self.HWID_OLD), "P@ssw0rd!TiếngViệt#1")

        # 2. Alice logs in from new machine (HWID_NEW)
        login_res = self.auth_service.verify_license("alice", "Alice@1234", self.HWID_NEW, _fake_request())
        self.assertEqual(login_res["username"], "alice")

        # Verify users table updated & previous_hwid cleared
        user_after = self.fake_db.fetch_one("SELECT hwid, previous_hwid FROM users WHERE id = ?", (self.user_a_id,))
        self.assertEqual(user_after["hwid"], self.HWID_NEW)
        self.assertIsNone(user_after["previous_hwid"])

        # Verify Alice's accounts decrypt with HWID_NEW and fail with HWID_OLD
        acc1_after = self.fake_db.fetch_one("SELECT password, two_fa, pass_mail FROM accounts WHERE id = ?", (acc1_id,))
        self.assertEqual(self._decrypt(acc1_after["password"], self.HWID_NEW), "P@ssw0rd!TiếngViệt#1")
        self.assertEqual(self._decrypt(acc1_after["two_fa"], self.HWID_NEW), "JBSWY3DPEHPK3PXP")
        self.assertEqual(self._decrypt(acc1_after["pass_mail"], self.HWID_NEW), "MailPass#999")
        with self.assertRaises(Exception):
            self._decrypt(acc1_after["password"], self.HWID_OLD)

        acc2_after = self.fake_db.fetch_one("SELECT password, two_fa, pass_mail FROM accounts WHERE id = ?", (acc2_id,))
        self.assertEqual(self._decrypt(acc2_after["password"], self.HWID_NEW), "OnlyPassword123")
        self.assertEqual(acc2_after["two_fa"], "")
        self.assertIsNone(acc2_after["pass_mail"])

        # Verify Bob's account is completely untouched
        bob_after = self.fake_db.fetch_one("SELECT password, two_fa, pass_mail FROM accounts WHERE id = ?", (bob_acc_id,))
        self.assertEqual(self._decrypt(bob_after["password"], self.HWID_OTHER), "BobSecretPassword")
        self.assertEqual(self._decrypt(bob_after["two_fa"], self.HWID_OTHER), "BOB2FASECRET")
        self.assertEqual(self._decrypt(bob_after["pass_mail"], self.HWID_OTHER), "BobMailPass")

    def test_reset_hwid_called_twice_preserves_previous_hwid(self):
        acc_id = self._insert_account(self.user_a_id, "100010", password="KeepMeSafe!", hwid=self.HWID_OLD)

        self.auth_service.reset_hwid(self.user_a_id, "Reset lần 1", _fake_request())
        self.auth_service.reset_hwid(self.user_a_id, "Reset lần 2 nhầm", _fake_request())

        user_row = self.fake_db.fetch_one("SELECT hwid, previous_hwid FROM users WHERE id = ?", (self.user_a_id,))
        self.assertIsNone(user_row["hwid"])
        self.assertEqual(user_row["previous_hwid"], self.HWID_OLD)

        self.auth_service.verify_license("alice", "Alice@1234", self.HWID_NEW, _fake_request())
        acc_after = self.fake_db.fetch_one("SELECT password FROM accounts WHERE id = ?", (acc_id,))
        self.assertEqual(self._decrypt(acc_after["password"], self.HWID_NEW), "KeepMeSafe!")

    def test_reset_hwid_then_login_same_machine_skips_reencrypt(self):
        acc_id = self._insert_account(self.user_a_id, "100020", password="SameMachinePass", hwid=self.HWID_OLD)
        before = self.fake_db.fetch_one("SELECT password FROM accounts WHERE id = ?", (acc_id,))["password"]

        self.auth_service.reset_hwid(self.user_a_id, "Reset test", _fake_request())
        self.auth_service.verify_license("alice", "Alice@1234", self.HWID_OLD, _fake_request())

        after = self.fake_db.fetch_one("SELECT password FROM accounts WHERE id = ?", (acc_id,))["password"]
        self.assertEqual(before, after)
        self.assertEqual(self._decrypt(after, self.HWID_OLD), "SameMachinePass")
        user_row = self.fake_db.fetch_one("SELECT hwid, previous_hwid FROM users WHERE id = ?", (self.user_a_id,))
        self.assertEqual(user_row["hwid"], self.HWID_OLD)
        self.assertIsNone(user_row["previous_hwid"])

    def test_reset_hwid_without_accounts_table_succeeds(self):
        self.fake_db.execute("DROP TABLE accounts")
        self.auth_service.reset_hwid(self.user_a_id, "No accounts table", _fake_request())
        res = self.auth_service.verify_license("alice", "Alice@1234", self.HWID_NEW, _fake_request())
        self.assertEqual(res["username"], "alice")
        user_row = self.fake_db.fetch_one("SELECT hwid, previous_hwid FROM users WHERE id = ?", (self.user_a_id,))
        self.assertEqual(user_row["hwid"], self.HWID_NEW)
        self.assertIsNone(user_row["previous_hwid"])

    def test_undecryptable_and_already_migrated_fields_handled_safely(self):
        valid_old_pw = self._crypt("ValidOldPass", self.HWID_OLD)
        corrupted_2fa = self._crypt("FromUnknownMachine", self.HWID_UNKNOWN)
        already_new_mail = self._crypt("AlreadyNewMailPass", self.HWID_NEW)
        self.fake_db.execute(
            """INSERT INTO accounts (user_id, uid, credential_encryption_version, password, two_fa, pass_mail)
               VALUES (?, '100030', 2, ?, ?, ?)""",
            (str(self.user_a_id), valid_old_pw, corrupted_2fa, already_new_mail),
        )
        acc_id = self.fake_db.fetch_one("SELECT id FROM accounts WHERE uid = '100030'")["id"]

        self.auth_service.reset_hwid(self.user_a_id, "Mixed state", _fake_request())
        self.auth_service.verify_license("alice", "Alice@1234", self.HWID_NEW, _fake_request())

        row = self.fake_db.fetch_one("SELECT password, two_fa, pass_mail FROM accounts WHERE id = ?", (acc_id,))
        self.assertEqual(self._decrypt(row["password"], self.HWID_NEW), "ValidOldPass")
        # Undecryptable field MUST be preserved intact, not wiped
        self.assertEqual(row["two_fa"], corrupted_2fa)
        # Already-migrated field MUST remain decryptable with HWID_NEW
        self.assertEqual(self._decrypt(row["pass_mail"], self.HWID_NEW), "AlreadyNewMailPass")

    def test_edit_user_admin_clear_hwid_then_login_reencrypts(self):
        acc_id = self._insert_account(self.user_a_id, "100040", password="EditClearPass", hwid=self.HWID_OLD)

        self.auth_service.edit_user_admin(self.user_a_id, {"hwid": ""}, _fake_request())
        user_mid = self.fake_db.fetch_one("SELECT hwid, previous_hwid FROM users WHERE id = ?", (self.user_a_id,))
        self.assertIsNone(user_mid["hwid"])
        self.assertEqual(user_mid["previous_hwid"], self.HWID_OLD)

        self.auth_service.verify_license("alice", "Alice@1234", self.HWID_NEW, _fake_request())
        acc_after = self.fake_db.fetch_one("SELECT password FROM accounts WHERE id = ?", (acc_id,))
        self.assertEqual(self._decrypt(acc_after["password"], self.HWID_NEW), "EditClearPass")

    def test_edit_user_admin_replace_hwid_directly_reencrypts_immediately(self):
        acc_id = self._insert_account(
            self.user_a_id, "100050", password="DirectSwapPass", two_fa="SWAP2FA", hwid=self.HWID_OLD
        )

        self.auth_service.edit_user_admin(self.user_a_id, {"hwid": self.HWID_NEW}, _fake_request())
        user_after = self.fake_db.fetch_one("SELECT hwid, previous_hwid FROM users WHERE id = ?", (self.user_a_id,))
        self.assertEqual(user_after["hwid"], self.HWID_NEW)
        self.assertIsNone(user_after["previous_hwid"])

        acc_after = self.fake_db.fetch_one("SELECT password, two_fa FROM accounts WHERE id = ?", (acc_id,))
        self.assertEqual(self._decrypt(acc_after["password"], self.HWID_NEW), "DirectSwapPass")
        self.assertEqual(self._decrypt(acc_after["two_fa"], self.HWID_NEW), "SWAP2FA")

    def test_edit_user_admin_set_hwid_after_reset_reencrypts_from_previous_hwid(self):
        acc_id = self._insert_account(self.user_a_id, "100060", password="ResetThenAdminSet", hwid=self.HWID_OLD)

        self.auth_service.reset_hwid(self.user_a_id, "Reset trước", _fake_request())
        self.auth_service.edit_user_admin(self.user_a_id, {"hwid": self.HWID_NEW}, _fake_request())

        user_after = self.fake_db.fetch_one("SELECT hwid, previous_hwid FROM users WHERE id = ?", (self.user_a_id,))
        self.assertEqual(user_after["hwid"], self.HWID_NEW)
        self.assertIsNone(user_after["previous_hwid"])

        acc_after = self.fake_db.fetch_one("SELECT password FROM accounts WHERE id = ?", (acc_id,))
        self.assertEqual(self._decrypt(acc_after["password"], self.HWID_NEW), "ResetThenAdminSet")

    def test_transaction_rollback_on_failure_leaves_state_consistent(self):
        acc_id = self._insert_account(self.user_a_id, "100070", password="AtomicPass123", hwid=self.HWID_OLD)
        self.auth_service.reset_hwid(self.user_a_id, "Test rollback", _fake_request())

        # Fail right at UPDATE users AFTER accounts have been updated inside the same transaction
        self.fake_db.fail_on_sql_substring = "UPDATE users SET hwid = ?, previous_hwid = NULL"
        with self.assertRaises(RuntimeError):
            self.auth_service.verify_license("alice", "Alice@1234", self.HWID_NEW, _fake_request())
        self.fake_db.fail_on_sql_substring = None

        # Everything must have rolled back cleanly
        user_row = self.fake_db.fetch_one("SELECT hwid, previous_hwid FROM users WHERE id = ?", (self.user_a_id,))
        self.assertIsNone(user_row["hwid"])
        self.assertEqual(user_row["previous_hwid"], self.HWID_OLD)

        acc_mid = self.fake_db.fetch_one("SELECT password FROM accounts WHERE id = ?", (acc_id,))
        self.assertEqual(self._decrypt(acc_mid["password"], self.HWID_OLD), "AtomicPass123")

        # Retrying login now must succeed cleanly
        self.auth_service.verify_license("alice", "Alice@1234", self.HWID_NEW, _fake_request())
        acc_final = self.fake_db.fetch_one("SELECT password FROM accounts WHERE id = ?", (acc_id,))
        self.assertEqual(self._decrypt(acc_final["password"], self.HWID_NEW), "AtomicPass123")

    def test_schema_ensure_user_columns_adds_previous_hwid_and_public_user_hides_it(self):
        # Create a legacy users table without previous_hwid
        legacy_db = InMemorySQLiteDB()
        legacy_db.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(100), hwid VARCHAR(64))")
        with patch.object(self.auth_schema, "db", legacy_db):
            self.auth_schema._ensure_user_columns()
            cols = self.auth_schema._column_names("users")
            self.assertIn("previous_hwid", cols)
        legacy_db.conn.close()

        # public_user must not expose previous_hwid
        self.auth_service.reset_hwid(self.user_a_id, "Check public_user", _fake_request())
        user_row = self.fake_db.fetch_one("SELECT * FROM users WHERE id = ?", (self.user_a_id,))
        pub = self.auth_service.public_user(user_row)
        self.assertNotIn("previous_hwid", pub)

    def test_normal_hwid_mismatch_still_blocked(self):
        from fastapi import HTTPException

        acc_id = self._insert_account(self.user_a_id, "100080", password="BlockedPass", hwid=self.HWID_OLD)
        with self.assertRaises(HTTPException) as ctx:
            self.auth_service.verify_license("alice", "Alice@1234", self.HWID_NEW, _fake_request())
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail, "ERR_HWID_MISMATCH")

        acc_after = self.fake_db.fetch_one("SELECT password FROM accounts WHERE id = ?", (acc_id,))
        self.assertEqual(self._decrypt(acc_after["password"], self.HWID_OLD), "BlockedPass")

    def test_end_to_end_with_module02_encrypt_and_decrypt_data(self):
        import modules.module_02_account_manager.security.encryption as enc_mod

        # Machine 1 saves account via module_02's encrypt_data()
        with patch.object(enc_mod, "get_hwid", return_value=self.HWID_OLD), patch.object(
            enc_mod, "get_legacy_hwid", return_value="e" * 64
        ):
            enc_pw = enc_mod.encrypt_data("FB_Pass_2026!@#")
            enc_2fa = enc_mod.encrypt_data("2FA_SECRET_KEY")
            enc_mail = enc_mod.encrypt_data("Mail_Pass_2026")
            self.fake_db.execute(
                """INSERT INTO accounts (user_id, uid, credential_encryption_version, password, two_fa, pass_mail)
                   VALUES (?, '100090', 2, ?, ?, ?)""",
                (str(self.user_a_id), enc_pw, enc_2fa, enc_mail),
            )

        # Admin resets HWID
        self.auth_service.reset_hwid(self.user_a_id, "Chuyển sang máy 2", _fake_request())

        # Machine 2 logs in and reads via module_02's decrypt_data() & decrypt_secret()
        self.auth_service.verify_license("alice", "Alice@1234", self.HWID_NEW, _fake_request())
        row = self.fake_db.fetch_one("SELECT password, two_fa, pass_mail FROM accounts WHERE uid = '100090'")

        with patch.object(enc_mod, "get_hwid", return_value=self.HWID_NEW), patch.object(
            enc_mod, "get_legacy_hwid", return_value="f" * 64
        ):
            self.assertEqual(enc_mod.decrypt_data(row["password"]), "FB_Pass_2026!@#")
            self.assertEqual(enc_mod.decrypt_data(row["two_fa"]), "2FA_SECRET_KEY")
            self.assertEqual(enc_mod.decrypt_secret(row["pass_mail"]), "Mail_Pass_2026")

    def test_postgres_query_normalization_path(self):
        executed_sql = []

        class MockPGCursor:
            def __init__(self):
                self._step = 0

            def execute(self, sql, params=()):
                executed_sql.append((sql, params))
                self._step += 1

            def fetchone(self):
                return {"ok": 1}

            def fetchall(self):
                return [
                    {
                        "id": 7,
                        "password": self._crypt_pw,
                        "two_fa": None,
                        "pass_mail": "",
                    }
                ]

        pg_cursor = MockPGCursor()
        pg_cursor._crypt_pw = self._crypt("PgPass!123", self.HWID_OLD)

        fake_pg_db = MagicMock()
        fake_pg_db._is_postgres = True
        fake_pg_db._normalize_query.side_effect = lambda q: q.replace("?", "%s")

        with patch.object(self.auth_service, "db", fake_pg_db):
            stats = self.auth_service._reencrypt_user_accounts_for_hwid(
                pg_cursor, self.user_a_id, self.HWID_OLD, self.HWID_NEW
            )

        self.assertEqual(stats["migrated_accounts"], 1)
        self.assertEqual(stats["migrated_fields"], 1)
        self.assertIn("information_schema.tables", executed_sql[0][0])
        self.assertIn("%s", executed_sql[0][0])
        self.assertNotIn("?", executed_sql[0][0])
        self.assertIn("UPDATE accounts SET password = %s WHERE id = %s", executed_sql[2][0])
        new_cipher = executed_sql[2][1][0]
        self.assertEqual(self._decrypt(new_cipher, self.HWID_NEW), "PgPass!123")


if __name__ == "__main__":
    unittest.main(verbosity=2)
