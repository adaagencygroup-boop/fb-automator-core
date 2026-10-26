"""PostgreSQL-only schema bootstrap for Module 7."""

from pathlib import Path

from core.database.connection import db


SCHEMA_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "003_v2_campaign_runtime.sql"
)
CLOUD_FIRST_SCHEMA_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "005_cloud_first_logs.sql"
)
POSTGRES_ONLY_SCHEMA_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "006_postgres_only.sql"
)


def init_models() -> None:
    """Create cloud campaign, runtime and history tables and import legacy metadata once."""
    try:
        db.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
        db.execute(CLOUD_FIRST_SCHEMA_PATH.read_text(encoding="utf-8"))
        db.execute(POSTGRES_ONLY_SCHEMA_PATH.read_text(encoding="utf-8"))
        from ..migrations.migration_006_postgres_only import import_legacy_sqlite

        import_legacy_sqlite(database=db)
    except Exception as exc:
        raise RuntimeError(f"Module 7 database initialization failed: {exc}") from exc
