"""Create or remove the Module 7 per-account group membership table.

Run from the project root:

    python -m modules.module_07_group_spam.migrations.migration_008_account_groups up
    python -m modules.module_07_group_spam.migrations.migration_008_account_groups down --yes
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .migration_001_schema import _postgres_database


MIGRATION_DIR = Path(__file__).resolve().parent
UP_SQL_PATH = MIGRATION_DIR / "008_account_groups.sql"

DOWN_SQL = """
BEGIN;

DROP TABLE IF EXISTS public.module7_account_groups;

COMMIT;
"""


def up() -> None:
    """Create the Module 7 account-group membership table."""
    _postgres_database().execute(UP_SQL_PATH.read_text(encoding="utf-8"))


def down() -> None:
    """Drop the Module 7 account-group membership table and its data."""
    _postgres_database().execute(DOWN_SQL)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction", choices=("up", "down"))
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm removal of all saved account-group membership data.",
    )
    args = parser.parse_args()

    if args.direction == "down" and not args.yes:
        parser.error("down deletes saved account-group membership data; run it again with --yes")

    if args.direction == "up":
        up()
        print("Module 7 migration 008 up completed.")
    else:
        down()
        print("Module 7 migration 008 down completed.")


if __name__ == "__main__":
    main()
