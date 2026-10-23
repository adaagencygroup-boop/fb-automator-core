"""Device-local SQLite storage for Module 7 runtime state and sync outbox."""

from __future__ import annotations

from contextlib import closing, contextmanager
from pathlib import Path
import sqlite3
from typing import Any, Generator

from config.constants import DATA_DIR


DEFAULT_PATH = DATA_DIR / "module_07_group_spam" / "module_07.db"
SCHEMA_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "003_v2_local_runtime.sql"
)


class LocalGroupDatabase:
    def __init__(self, path: Path = DEFAULT_PATH):
        self.path = Path(path)

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    def initialize(self) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))

    def drop_schema(self) -> None:
        with closing(self._connect()) as connection:
            with connection:
                connection.executescript("""
                    DROP TABLE IF EXISTS group_sync_outbox;
                    DROP TABLE IF EXISTS group_run_tasks;
                    DROP TABLE IF EXISTS group_runs;
                    DROP TABLE IF EXISTS group_campaigns;
                """)

    @contextmanager
    def session(self) -> Generator[sqlite3.Cursor, None, None]:
        connection = self._connect()
        cursor = connection.cursor()
        try:
            yield cursor
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            cursor.close()
            connection.close()

    def fetch_all(self, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.session() as cursor:
            cursor.execute(query, params)
            return [dict(row) for row in cursor.fetchall()]

    def fetch_one(self, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        with self.session() as cursor:
            cursor.execute(query, params)
            row = cursor.fetchone()
            return dict(row) if row else None


local_db = LocalGroupDatabase()
