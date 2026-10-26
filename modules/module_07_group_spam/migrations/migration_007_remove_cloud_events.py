"""Remove persisted Module 7 progress events from PostgreSQL."""

from __future__ import annotations

import argparse
from pathlib import Path

from .migration_001_schema import _postgres_database


SQL_PATH = Path(__file__).with_name("007_remove_cloud_events.sql")


def up() -> None:
    _postgres_database().execute(SQL_PATH.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction", choices=("up",))
    parser.parse_args()
    up()
    print("Module 7 migration 007 up completed.")


if __name__ == "__main__":
    main()
