"""Remove all legacy and local-runtime Module 7 tables from PostgreSQL."""

import argparse
from pathlib import Path

from .migration_001_schema import _postgres_database


UP_SQL_PATH = Path(__file__).with_name("004_remove_local_tables_from_cloud.sql")


def up() -> None:
    """Leave only the two cloud_group_* v2 tables in PostgreSQL."""
    _postgres_database().execute(UP_SQL_PATH.read_text(encoding="utf-8"))


def down() -> None:
    """No-op: the removed tables are device-local and must not return to cloud."""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction", choices=("up", "down"))
    args = parser.parse_args()

    if args.direction == "up":
        up()
        print("Module 7 migration 004 up completed.")
    else:
        down()
        print("Module 7 migration 004 down completed (no-op).")


if __name__ == "__main__":
    main()
