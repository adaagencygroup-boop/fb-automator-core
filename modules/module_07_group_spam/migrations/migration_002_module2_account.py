"""Add or remove the Module 2 account reference for Module 7 logs.

Run from the project root:

    python -m modules.module_07_group_spam.migrations.migration_002_module2_account up
    python -m modules.module_07_group_spam.migrations.migration_002_module2_account down --yes
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .migration_001_schema import _postgres_database


UP_SQL_PATH = Path(__file__).with_name("002_link_module2_accounts.sql")

DOWN_SQL = """
BEGIN;

DROP INDEX IF EXISTS public.idx_group_session_logs_account_id;

ALTER TABLE public.group_session_logs
    DROP CONSTRAINT IF EXISTS fk_group_session_logs_account,
    DROP COLUMN IF EXISTS account_id;

COMMIT;
"""


def up() -> None:
    """Link Module 7 log rows to Module 2 accounts."""
    sql = UP_SQL_PATH.read_text(encoding="utf-8")
    _postgres_database().execute(sql)


def down() -> None:
    """Remove the Module 2 account link without deleting Module 7 log rows."""
    _postgres_database().execute(DOWN_SQL)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction", choices=("up", "down"))
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm removal of the account reference column.",
    )
    args = parser.parse_args()

    if args.direction == "down" and not args.yes:
        parser.error("down removes account links; run it again with --yes")

    if args.direction == "up":
        up()
        print("Module 7 migration 002 up completed.")
    else:
        down()
        print("Module 7 migration 002 down completed.")


if __name__ == "__main__":
    main()
