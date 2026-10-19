"""Integration checks in a disposable schema on an explicitly configured test DB.

Set MODULE5_TEST_DATABASE_URL; this script never reads DATABASE_URL or production .env.
"""
import copy
import os
import sys
import types
import uuid
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class TestDB:
    is_postgres = True

    def __init__(self, conn):
        self.conn = conn

    @contextmanager
    def session(self):
        with self.conn:
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                yield cur

    def execute(self, query, params=()):
        with self.session() as cur:
            cur.execute(query, params)

    def fetch_one(self, query, params=()):
        with self.session() as cur:
            cur.execute(query, params)
            return cur.fetchone()

    def fetch_all(self, query, params=()):
        with self.session() as cur:
            cur.execute(query, params)
            return cur.fetchall()


def main():
    url = os.getenv("MODULE5_TEST_DATABASE_URL")
    if not url:
        print("BLOCKED: set MODULE5_TEST_DATABASE_URL to a PostgreSQL test database.")
        return 2
    schema = "module5_test_" + uuid.uuid4().hex
    conn = psycopg2.connect(url, connect_timeout=10)
    db = TestDB(conn)
    try:
        db.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        db.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        connection = types.ModuleType("core.database.connection")
        connection.db = db
        with patch.dict(sys.modules, {"core.database.connection": connection}):
            from modules.module_05_page_manager.models import DDL_STATEMENTS, COLUMN_MIGRATIONS
            from modules.module_05_page_manager.meta_migration import migrate_meta_owners
            from modules.module_05_page_manager import meta_sync, owned_data

            db.execute("""CREATE TABLE accounts (id SERIAL PRIMARY KEY, user_id VARCHAR(100), uid VARCHAR(100),
                token TEXT, proxy TEXT, profile_name TEXT, status TEXT DEFAULT 'DIE', login_status TEXT DEFAULT 'ERROR',
                UNIQUE(user_id,uid))""")
            db.execute("INSERT INTO accounts (user_id,uid,token) VALUES ('a','111','a-old'),('b','111','b-old'),('a','222','old')")
            for statement in DDL_STATEMENTS + COLUMN_MIGRATIONS:
                db.execute(statement)
            db.execute("CREATE UNIQUE INDEX custom_page_unique ON pages(page_id)")
            db.execute("""INSERT INTO pages (id,page_id,page_name,account_uid,access_token) VALUES
                (10,'42','Known','222','old-page'),(11,'43','Ambiguous','111','unknown-page')""")
            db.execute("INSERT INTO posting_progress (page_id,post_type,last_folder_index) VALUES ('42','REEL',4),('43','REEL',9)")
            migrate_meta_owners()
            migrate_meta_owners()
            from modules.module_05_page_manager.meta_web_migration import migrate_meta_web
            migrate_meta_web()
            migrate_meta_web()
            assert db.fetch_one("SELECT user_id FROM pages WHERE id=10")["user_id"] == "a"
            assert db.fetch_one("SELECT user_id FROM pages WHERE id=11")["user_id"] is None
            assert db.fetch_one("SELECT user_id FROM posting_progress WHERE page_id='43'")["user_id"] is None
            prepared = {"token": "a-long", "metadata": {"app_id": "test-app", "is_valid": True, "expires_at": 4102444800},
                        "identity": {"id": "asuid-a", "name": "Person A"},
                        "pages": [{"id": "42", "name": "Page A", "access_token": "page-a", "category": "News",
                                   "token_metadata": {"expires_at": 0}}]}
            meta_sync.save("a", "222", prepared)
            other = copy.deepcopy(prepared)
            other["token"] = "b-long"
            other["identity"] = {"id": "asuid-b", "name": "Person B"}
            other["pages"][0]["access_token"] = "page-b"
            meta_sync.save("b", "111", other)
            meta_sync.save("a", "222", prepared)
            assert len(db.fetch_all("SELECT id FROM pages WHERE page_id='42'")) == 2
            assert db.fetch_one("SELECT id FROM pages WHERE user_id='a' AND page_id='42'")["id"] == 10
            db.execute("ALTER TABLE pages ADD CONSTRAINT reject_test_page CHECK (page_name <> 'FAIL')")
            failing = copy.deepcopy(prepared)
            failing["token"] = "must-rollback"
            failing["pages"][0]["access_token"] = "must-rollback"
            failing["pages"].append({**failing["pages"][0], "id": "99", "name": "FAIL"})
            try:
                meta_sync.save("a", "222", failing)
                raise AssertionError("Expected DB constraint failure")
            except psycopg2.IntegrityError:
                pass
            assert db.fetch_one("SELECT token FROM accounts WHERE user_id='a' AND uid='222'")["token"] == "a-long"
            assert db.fetch_one("SELECT access_token FROM pages WHERE user_id='a' AND page_id='42'")["access_token"] == "page-a"
            assert db.fetch_one("SELECT access_token FROM pages WHERE user_id='b' AND page_id='42'")["access_token"] == "page-b"
            for owner in ("a", "b"):
                owned_data.save_progress(owner, "42", "REEL", 5 if owner == "a" else 2)
                owned_data.record_download(owner, "42", "TIKTOK", "same-video", "caption", "url", owner + "/video")
                db.execute("INSERT INTO posting_schedules (user_id,page_id,schedule_type) VALUES (%s,'42','REEL')", (owner,))
            assert owned_data.progress("a", "42", "REEL")["last_folder_index"] == 5
            assert owned_data.progress("b", "42", "REEL")["last_folder_index"] == 2
            assert len(db.fetch_all("SELECT id FROM downloaded_videos WHERE page_id='42'")) == 2
            assert len(db.fetch_all("SELECT id FROM posting_schedules WHERE page_id='42'")) == 2
            with patch.dict(os.environ, {"FACEBOOK_APP_ID": "test-app", "FACEBOOK_APP_SECRET": "dummy",
                                         "FACEBOOK_OAUTH_CALLBACK_URL": "https://test.example/oauth/meta/callback"}):
                state = meta_sync.create_state("a", "222", "web")["state"]
                assert meta_sync.consume_state(state, "a", "web") == "222"
                try:
                    meta_sync.consume_state(state, "a", "web")
                    raise AssertionError("State was reused")
                except ValueError:
                    pass
                from modules.module_05_page_manager import meta_web
                attempt = meta_web.start("a")
                pending = meta_web.connection_status("a")["active_job"]
                assert pending["job_id"] == attempt["job_id"]
                assert db.fetch_one("SELECT account_uid FROM meta_oauth_states WHERE job_id=%s", (attempt["job_id"],))["account_uid"] is None
                meta_web.cancel("a", attempt["job_id"])
                standalone = copy.deepcopy(prepared)
                standalone["metadata"]["app_id"] = "test-app"
                saved = meta_web._save("a", standalone, {})
                row = db.fetch_one("SELECT account_uid, web_connection_id FROM pages WHERE user_id='a' AND page_id='42'")
                assert row["account_uid"] is None and row["web_connection_id"] == saved["connection_id"]
                try:
                    db.execute("UPDATE pages SET web_connection_id = %s WHERE user_id='b' AND page_id='42'", (saved["connection_id"],))
                    raise AssertionError("Cross-owner Page connection should violate FK")
                except psycopg2.IntegrityError:
                    pass
                meta_sync.save("a", "222", prepared)
                assert db.fetch_one("SELECT web_connection_id FROM pages WHERE user_id='a' AND page_id='42'")["web_connection_id"] is None
        print("PASS: PostgreSQL migration, retained IDs, owner isolation, rollback and single-use state.")
        return 0
    finally:
        conn.rollback()
        db.execute("SET search_path TO pg_catalog")
        db.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
