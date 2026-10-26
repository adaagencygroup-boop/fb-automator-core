from pathlib import Path
import sqlite3
import tempfile
import unittest

from modules.module_07_group_spam.app.services.campaign import _safe_config
from modules.module_07_group_spam.migrations.migration_006_postgres_only import import_legacy_sqlite


MODULE_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = MODULE_ROOT / "migrations"
CLOUD_SCHEMA = MIGRATIONS / "003_v2_campaign_runtime.sql"
POSTGRES_ONLY_SCHEMA = MIGRATIONS / "006_postgres_only.sql"
REMOVE_EVENTS_SCHEMA = MIGRATIONS / "007_remove_cloud_events.sql"
CLOUD_CLEANUP = MIGRATIONS / "004_remove_local_tables_from_cloud.sql"


class Module7V2SchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cloud_sql = CLOUD_SCHEMA.read_text(encoding="utf-8").lower()
        cls.postgres_only_sql = POSTGRES_ONLY_SCHEMA.read_text(encoding="utf-8").lower()
        cls.remove_events_sql = REMOVE_EVENTS_SCHEMA.read_text(encoding="utf-8").lower()
        cls.cleanup_sql = CLOUD_CLEANUP.read_text(encoding="utf-8").lower()

    def test_runtime_has_no_sqlite_database_module_or_schema(self):
        self.assertFalse((MODULE_ROOT / "app" / "local_database.py").exists())
        self.assertFalse((MIGRATIONS / "003_v2_local_runtime.sql").exists())
        self.assertFalse((MIGRATIONS / "005_cloud_first_local.sql").exists())

    def test_cloud_schema_contains_all_module_7_tables(self):
        for table in (
            "cloud_group_campaigns",
            "cloud_group_runs",
            "cloud_group_logs",
        ):
            self.assertIn(f"create table if not exists public.{table}", self.cloud_sql)
            self.assertIn(
                f"alter table public.{table} enable row level security",
                self.cloud_sql,
            )
        self.assertNotIn("create table if not exists public.cloud_group_events", self.cloud_sql)
        self.assertIn("drop table if exists public.cloud_group_events", self.remove_events_sql)

    def test_cloud_runs_store_rerun_configuration(self):
        self.assertIn("run_number integer not null default 1", self.cloud_sql)
        self.assertIn("config_json jsonb not null", self.cloud_sql)
        self.assertIn("unique (campaign_id, run_number)", self.cloud_sql)

    def test_upgrade_schema_backfills_campaigns_and_run_numbers(self):
        self.assertIn("insert into public.cloud_group_campaigns", self.postgres_only_sql)
        self.assertIn("row_number() over", self.postgres_only_sql)
        self.assertIn("fk_cloud_group_runs_campaign", self.postgres_only_sql)

    def test_cloud_cleanup_refuses_to_delete_legacy_runtime_rows(self):
        self.assertIn("if runtime_rows > 0", self.cleanup_sql)
        self.assertIn("cloud cleanup refused", self.cleanup_sql)

    def test_sensitive_config_values_are_removed_recursively(self):
        cleaned = _safe_config({
            "threads": 2,
            "api_key": "secret",
            "nested": {"cookie": "secret-cookie", "model": "gemini"},
        })
        self.assertEqual(cleaned, {"threads": 2, "nested": {"model": "gemini"}})

    def test_legacy_sqlite_is_imported_once_and_left_as_backup(self):
        class FakeDatabase:
            def __init__(self):
                self.calls = []

            def execute(self, query, params=()):
                self.calls.append((query, params))

            def fetch_one(self, query, params=()):
                self.calls.append((query, params))
                return {"campaign_id": params[0]}

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "module_07.db"
            marker = Path(directory) / ".postgres_only_migrated"
            connection = sqlite3.connect(source)
            connection.executescript(
                """
                CREATE TABLE group_campaigns (
                    id TEXT, owner_key TEXT, name TEXT, description TEXT,
                    action_type TEXT, deleted_at TEXT, created_at TEXT, updated_at TEXT
                );
                CREATE TABLE group_runs (
                    id TEXT, campaign_id TEXT, run_number INTEGER, status TEXT,
                    config_json TEXT, total_planned INTEGER, total_success INTEGER,
                    total_failed INTEGER, total_skipped INTEGER, scheduled_at TEXT,
                    started_at TEXT, finished_at TEXT, created_at TEXT, updated_at TEXT
                );
                INSERT INTO group_campaigns VALUES
                    ('campaign-1', 'owner-1', 'Campaign', NULL, 'POST', NULL,
                     '2026-10-26', '2026-10-26');
                INSERT INTO group_runs VALUES
                    ('run-1', 'campaign-1', 1, 'COMPLETED', '{"threads": 2}',
                     1, 1, 0, 0, NULL, '2026-10-26', '2026-10-26',
                     '2026-10-26', '2026-10-26');
                """
            )
            connection.commit()
            connection.close()

            database = FakeDatabase()
            result = import_legacy_sqlite(database, source, marker)
            self.assertEqual(result, {"campaigns": 1, "runs": 1})
            self.assertEqual(len(database.calls), 2)
            self.assertTrue(marker.exists())
            self.assertTrue(source.exists())

            second = import_legacy_sqlite(database, source, marker)
            self.assertEqual(second, {"campaigns": 0, "runs": 0})
            self.assertEqual(len(database.calls), 2)


if __name__ == "__main__":
    unittest.main()
