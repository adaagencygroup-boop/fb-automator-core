"""Create or remove the final-log schema used by Module 7.

Run from the project root:

    python -m modules.module_07_group_spam.migrations.migration_001_schema up
    python -m modules.module_07_group_spam.migrations.migration_001_schema down --yes
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any


UP_SQL_PATH = Path(__file__).with_name("001_schema.sql")

DOWN_SQL = """
BEGIN;

DROP TABLE IF EXISTS public.group_session_logs;
DROP TABLE IF EXISTS public.group_sessions;

COMMIT;
"""


def _postgres_database() -> Any:
    """Return the configured PostgreSQL database or fail without changing data."""
    from core.database.connection import db

    if not db.is_postgres:
        raise RuntimeError(
            "Module 7 migrations require PostgreSQL/Supabase. "
            "Check DATABASE_URL before running the migration."
        )
    return db


def up() -> None:
    """Create the Module 7 tables, constraints, indexes and RLS settings."""
    sql = UP_SQL_PATH.read_text(encoding="utf-8")
    _postgres_database().execute(sql)


def down() -> None:
    """Drop only Module 7 tables, including all data stored in those tables."""
    _postgres_database().execute(DOWN_SQL)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction", choices=("up", "down"))
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm the destructive down migration.",
    )
    args = parser.parse_args()

    if args.direction == "down" and not args.yes:
        parser.error("down deletes all Module 7 data; run it again with --yes")

    if args.direction == "up":
        up()
        print("Module 7 migration up completed.")
    else:
        down()
        print("Module 7 migration down completed.")


if __name__ == "__main__":
    main()
