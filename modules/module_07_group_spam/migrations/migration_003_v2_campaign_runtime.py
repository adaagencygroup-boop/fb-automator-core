"""Create or remove the Module 7 v2 local and cloud schemas.

Run from the project root:

    python -m modules.module_07_group_spam.migrations.migration_003_v2_campaign_runtime up
    python -m modules.module_07_group_spam.migrations.migration_003_v2_campaign_runtime down --yes
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .migration_001_schema import _postgres_database


CLOUD_SQL_PATH = Path(__file__).with_name("003_v2_campaign_runtime.sql")

CLOUD_DOWN_SQL = """
BEGIN;

DROP TABLE IF EXISTS public.cloud_group_events;
DROP TABLE IF EXISTS public.cloud_group_logs;
DROP TABLE IF EXISTS public.cloud_group_runs;
DROP TABLE IF EXISTS public.cloud_group_campaigns;

COMMIT;
"""


def up() -> None:
    """Create PostgreSQL campaign, runtime and history tables."""
    _postgres_database().execute(CLOUD_SQL_PATH.read_text(encoding="utf-8"))


def down() -> None:
    """Remove the Module 7 PostgreSQL tables."""
    _postgres_database().execute(CLOUD_DOWN_SQL)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction", choices=("up", "down"))
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm removal of all Module 7 v2 local and cloud data.",
    )
    args = parser.parse_args()

    if args.direction == "down" and not args.yes:
        parser.error("down deletes all Module 7 v2 data; run it again with --yes")

    if args.direction == "up":
        up()
        print("Module 7 migration 003 up completed.")
    else:
        down()
        print("Module 7 migration 003 down completed.")


if __name__ == "__main__":
    main()
