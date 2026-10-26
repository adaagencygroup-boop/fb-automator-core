"""Switch Module 7 runtime logging from local SQLite to PostgreSQL.

Run from the project root:

    python -m modules.module_07_group_spam.migrations.migration_005_cloud_first_logs up
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .migration_001_schema import _postgres_database


MIGRATION_DIR = Path(__file__).resolve().parent


def up() -> None:
    _postgres_database().execute(
        (MIGRATION_DIR / "005_cloud_first_logs.sql").read_text(encoding="utf-8")
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction", choices=("up",))
    parser.parse_args()
    up()
    print("Module 7 migration 005 up completed.")


if __name__ == "__main__":
    main()
