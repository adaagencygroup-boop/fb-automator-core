from pathlib import Path
import tempfile
import unittest

from modules.module_07_group_spam.app.local_database import LocalGroupDatabase
from modules.module_07_group_spam.app.services.campaign import _safe_config


MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
CLOUD_SCHEMA = MIGRATIONS / "003_v2_campaign_runtime.sql"
LOCAL_SCHEMA = MIGRATIONS / "003_v2_local_runtime.sql"
CLOUD_CLEANUP = MIGRATIONS / "004_remove_local_tables_from_cloud.sql"


class Module7V2SchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cloud_sql = CLOUD_SCHEMA.read_text(encoding="utf-8").lower()
        cls.local_sql = LOCAL_SCHEMA.read_text(encoding="utf-8").lower()
        cls.cleanup_sql = CLOUD_CLEANUP.read_text(encoding="utf-8").lower()

    def test_runtime_tables_exist_only_in_local_schema(self):
        for table in (
            "group_campaigns",
            "group_runs",
            "group_run_tasks",
            "group_sync_outbox",
        ):
            self.assertIn(f"create table if not exists {table}", self.local_sql)
            self.assertNotIn(f"create table if not exists public.{table}", self.cloud_sql)

    def test_cloud_schema_contains_only_final_history_tables(self):
        for table in ("cloud_group_runs", "cloud_group_logs"):
            self.assertIn(f"create table if not exists public.{table}", self.cloud_sql)
            self.assertIn(
                f"alter table public.{table} enable row level security",
                self.cloud_sql,
            )

    def test_local_runtime_foreign_keys_and_outbox_indexes_exist(self):
        self.assertIn("references group_campaigns(id) on delete cascade", self.local_sql)
        self.assertIn("references group_runs(id) on delete cascade", self.local_sql)
        self.assertNotIn("references public.accounts", self.local_sql)
        self.assertIn("event_id text not null unique", self.local_sql)
        self.assertIn("idx_group_sync_outbox_pending", self.local_sql)
        self.assertIn("idx_group_sync_outbox_data", self.local_sql)

    def test_local_database_initializes_all_runtime_tables(self):
        with tempfile.TemporaryDirectory() as directory:
            database = LocalGroupDatabase(Path(directory) / "module_07.db")
            database.initialize()
            rows = database.fetch_all(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
            names = {row["name"] for row in rows}
            self.assertTrue({
                "group_campaigns",
                "group_runs",
                "group_run_tasks",
                "group_sync_outbox",
            }.issubset(names))

    def test_cloud_cleanup_refuses_to_delete_runtime_rows(self):
        self.assertIn("if runtime_rows > 0", self.cleanup_sql)
        self.assertIn("cloud cleanup refused", self.cleanup_sql)
        self.assertIn("drop table public.group_campaigns", self.cleanup_sql)
        self.assertIn("legacy group_campaigns rows still exist", self.cleanup_sql)

    def test_cloud_cleanup_removes_old_final_log_tables(self):
        self.assertIn("drop table if exists public.group_session_logs", self.cleanup_sql)
        self.assertIn("drop table if exists public.group_sessions", self.cleanup_sql)

    def test_sensitive_config_values_are_removed_recursively(self):
        cleaned = _safe_config({
            "threads": 2,
            "api_key": "secret",
            "nested": {"cookie": "secret-cookie", "model": "gemini"},
        })
        self.assertEqual(cleaned, {"threads": 2, "nested": {"model": "gemini"}})


if __name__ == "__main__":
    unittest.main()
