import re
import unittest
from pathlib import Path

from modules.module_03_acc_farm.models import ADDED_COLUMNS, DDL_STATEMENTS, SHARED_DDL_STATEMENTS

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"
MIGRATION = MIGRATIONS_DIR / "001_tab1_farm_schema.sql"
# Các file chỉ thêm cột cho bảng Tab 1 sau khi 001 đã chạy trên Supabase
TAB1_ADD_COLUMN_MIGRATIONS = [MIGRATIONS_DIR / "006_farm_log_targets.sql",
                              MIGRATIONS_DIR / "007_farm_history_groups_source.sql",
                              MIGRATIONS_DIR / "008_farm_history_reactions_story.sql",
                              MIGRATIONS_DIR / "009_farm_history_groups_left.sql",
                              MIGRATIONS_DIR / "010_farm_target_owners.sql"]
SHARED_MIGRATION = MIGRATIONS_DIR / "005_browser_fingerprints.sql"


def _normalize(stmt: str) -> str:
    stmt = re.sub(r"--[^\n]*", "", stmt)
    stmt = stmt.replace("public.", "")
    return re.sub(r"\s+", " ", stmt).strip().rstrip(";").strip().lower()


def _schema_statements(sql: str) -> set:
    """Lấy câu CREATE TABLE / CREATE INDEX / ADD COLUMN (bỏ BEGIN, COMMIT, RLS) để so với DDL của models.py."""
    # Bỏ comment trước khi tách câu: comment có thể chứa dấu ";"
    parts = (_normalize(p) for p in re.sub(r"--[^\n]*", "", sql).split(";"))
    return {p for p in parts
            if p.startswith(("create table", "create index")) or (p.startswith("alter table") and " add column " in p)}


class MigrationSyncTests(unittest.TestCase):
    """models.py (engine tự tạo bảng) và file SQL chạy tay trên Supabase phải ra cùng một schema."""

    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8")
        self.files = [MIGRATION, *TAB1_ADD_COLUMN_MIGRATIONS]
        self.from_models = {_normalize(s) for s in DDL_STATEMENTS} | {
            f"alter table {table} add column if not exists {column} {kind}".lower()
            for table, column, kind in ADDED_COLUMNS
        }
        self.from_sql = set().union(*(_schema_statements(f.read_text(encoding="utf-8")) for f in self.files))

    def test_added_columns_also_in_create_table(self):
        creates = {re.search(r"create table if not exists (\w+)", s).group(1): s
                   for s in self.from_models if s.startswith("create table")}
        for table, column, kind in ADDED_COLUMNS:
            self.assertIn(f" {column} {kind}".lower(), creates[table], f"{table}.{column} thiếu trong CREATE TABLE")

    def test_same_tables_columns_and_indexes(self):
        self.assertEqual(self.from_sql - self.from_models, set(), "Có trong file SQL nhưng thiếu ở models.py")
        self.assertEqual(self.from_models - self.from_sql, set(), "Có trong models.py nhưng thiếu ở file SQL")

    def test_every_table_enables_rls(self):
        tables = {re.search(r"create table if not exists (\w+)", s).group(1)
                  for s in self.from_models if s.startswith("create table")}
        rls = set(re.findall(r"ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY", self.sql))
        self.assertEqual(rls, tables)

    def test_runs_in_one_transaction(self):
        for path in self.files:
            body = re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8")).strip()
            self.assertTrue(body.startswith("BEGIN;"), path.name)
            self.assertTrue(body.endswith("COMMIT;"), path.name)


class SharedMigrationSyncTests(unittest.TestCase):
    """Bảng dùng chung của core/browser: models.py và 005_browser_fingerprints.sql phải khớp nhau."""

    def setUp(self):
        self.sql = SHARED_MIGRATION.read_text(encoding="utf-8")
        self.from_models = {_normalize(s) for s in SHARED_DDL_STATEMENTS}
        self.from_sql = _schema_statements(self.sql)

    def test_same_tables_and_columns(self):
        self.assertEqual(self.from_sql, self.from_models)

    def test_every_table_enables_rls(self):
        tables = {re.search(r"create table if not exists (\w+)", s).group(1) for s in self.from_models}
        rls = set(re.findall(r"ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY", self.sql))
        self.assertEqual(rls, tables)

    def test_runs_in_one_transaction(self):
        body = re.sub(r"--[^\n]*", "", self.sql).strip()
        self.assertTrue(body.startswith("BEGIN;"))
        self.assertTrue(body.endswith("COMMIT;"))


if __name__ == "__main__":
    unittest.main()
