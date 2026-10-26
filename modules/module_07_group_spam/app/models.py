"""Local-runtime and cloud-history schema bootstrap for Module 7 v2."""

from pathlib import Path

from core.database.connection import db

from .local_database import local_db


SCHEMA_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "003_v2_campaign_runtime.sql"
)


def init_models() -> None:
    """Create local runtime tables and cloud-only history tables."""
    try:
        local_db.initialize()
        db.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Module 7 database initialization failed: {exc}") from exc
