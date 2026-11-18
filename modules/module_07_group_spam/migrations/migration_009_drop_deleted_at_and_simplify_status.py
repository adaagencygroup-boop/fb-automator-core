"""Drop deleted_at from cloud_group_campaigns and restrict cloud_group_runs.status to COMPLETED/FAILED.

Run from the project root:

    python -m modules.module_07_group_spam.migrations.migration_009_drop_deleted_at_and_simplify_status up
    python -m modules.module_07_group_spam.migrations.migration_009_drop_deleted_at_and_simplify_status down --yes
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .migration_001_schema import _postgres_database


MIGRATION_DIR = Path(__file__).resolve().parent
UP_SQL_PATH = MIGRATION_DIR / "009_drop_deleted_at_and_simplify_status.sql"

DOWN_SQL = """
BEGIN;

DROP INDEX IF EXISTS public.idx_cloud_group_campaigns_owner_type;

ALTER TABLE public.cloud_group_campaigns
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITHOUT TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_cloud_group_campaigns_owner_type
    ON public.cloud_group_campaigns (owner_key, action_type, deleted_at);

ALTER TABLE public.cloud_group_runs
    DROP CONSTRAINT IF EXISTS ck_cloud_group_runs_status;

ALTER TABLE public.cloud_group_runs
    ADD CONSTRAINT ck_cloud_group_runs_status
    CHECK (status IN (
        'QUEUED', 'SCHEDULED', 'RUNNING', 'STOPPING',
        'COMPLETED', 'PARTIAL', 'STOPPED', 'CANCELLED', 'FAILED'
    ));

COMMIT;
"""


def up() -> None:
    """Apply migration 009."""
    _postgres_database().execute(UP_SQL_PATH.read_text(encoding="utf-8"))


def down() -> None:
    """Revert migration 009."""
    _postgres_database().execute(DOWN_SQL)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["up", "down"])
    parser.add_argument("--yes", action="store_true", help="Confirm destructive down migration")
    args = parser.parse_args()

    if args.action == "down":
        if not args.yes:
            raise SystemExit("Refusing to revert schema without --yes")
        down()
        print("Reverted Module 7 migration 009.")
        return

    up()
    print("Applied Module 7 migration 009.")


if __name__ == "__main__":
    main()
