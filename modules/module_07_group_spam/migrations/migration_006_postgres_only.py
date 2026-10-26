"""Move legacy Module 7 campaign metadata to PostgreSQL and stop using SQLite."""

from __future__ import annotations

import argparse
from contextlib import closing
import json
import logging
from pathlib import Path
import sqlite3
from typing import Any

from config.constants import DATA_DIR

from .migration_001_schema import _postgres_database


logger = logging.getLogger(__name__)
MIGRATION_DIR = Path(__file__).resolve().parent
LEGACY_DATABASE_PATH = DATA_DIR / "module_07_group_spam" / "module_07.db"
MIGRATION_MARKER_PATH = DATA_DIR / "module_07_group_spam" / ".postgres_only_migrated"


def _valid_json(value: Any) -> str:
    if not value:
        return "{}"
    try:
        return json.dumps(json.loads(str(value)), ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return "{}"


def import_legacy_sqlite(
    database=None,
    source_path: Path = LEGACY_DATABASE_PATH,
    marker_path: Path = MIGRATION_MARKER_PATH,
) -> dict[str, int]:
    """Idempotently import legacy campaigns/runs; the SQLite file remains as backup."""
    source_path = Path(source_path)
    marker_path = Path(marker_path)
    if marker_path.exists() or not source_path.exists():
        return {"campaigns": 0, "runs": 0}

    database = database or _postgres_database()
    uri = source_path.resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        if "group_campaigns" not in tables:
            marker_path.parent.mkdir(parents=True, exist_ok=True)
            marker_path.write_text("No legacy campaign table found.\n", encoding="utf-8")
            return {"campaigns": 0, "runs": 0}

        campaigns = connection.execute(
            """
            SELECT id, owner_key, name, description, action_type,
                   deleted_at, created_at, updated_at
            FROM group_campaigns
            """
        ).fetchall()
        runs = []
        if "group_runs" in tables:
            runs = connection.execute(
                """
                SELECT r.*, c.owner_key, c.name AS campaign_name, c.action_type
                FROM group_runs r
                JOIN group_campaigns c ON c.id = r.campaign_id
                ORDER BY r.campaign_id, r.run_number
                """
            ).fetchall()

    imported_campaign_ids: set[str] = set()
    for campaign in campaigns:
        imported = database.fetch_one(
            """
            INSERT INTO cloud_group_campaigns
                (campaign_id, owner_key, name, description, action_type,
                 deleted_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (campaign_id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                action_type = EXCLUDED.action_type,
                deleted_at = EXCLUDED.deleted_at,
                updated_at = EXCLUDED.updated_at
            WHERE cloud_group_campaigns.owner_key = EXCLUDED.owner_key
            RETURNING campaign_id
            """,
            tuple(campaign),
        )
        if imported:
            imported_campaign_ids.add(str(campaign["id"]))

    allowed_statuses = {
        "QUEUED", "SCHEDULED", "RUNNING", "STOPPING", "COMPLETED",
        "PARTIAL", "STOPPED", "CANCELLED", "FAILED",
    }
    imported_run_count = 0
    for run in runs:
        if str(run["campaign_id"]) not in imported_campaign_ids:
            continue
        status = str(run["status"] or "FAILED").upper()
        if status not in allowed_statuses:
            status = "STOPPED" if status == "PAUSED" else "FAILED"
        database.execute(
            """
            INSERT INTO cloud_group_runs
                (run_id, campaign_id, run_number, owner_key, campaign_name,
                 action_type, config_json, status, total_planned,
                 total_success, total_failed, total_skipped, started_at,
                 finished_at, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?,
                    CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            ON CONFLICT (run_id) DO UPDATE SET
                config_json = EXCLUDED.config_json,
                campaign_name = EXCLUDED.campaign_name,
                action_type = EXCLUDED.action_type
            """,
            (
                run["id"], run["campaign_id"], run["run_number"],
                run["owner_key"] or "", run["campaign_name"], run["action_type"],
                _valid_json(run["config_json"]), status,
                run["total_planned"], run["total_success"], run["total_failed"],
                run["total_skipped"], run["started_at"], run["finished_at"],
            ),
        )
        imported_run_count += 1

    marker_path.parent.mkdir(parents=True, exist_ok=True)
    marker_path.write_text(
        f"Imported {len(imported_campaign_ids)} campaigns and {imported_run_count} runs.\n",
        encoding="utf-8",
    )
    logger.info(
        "Imported Module 7 legacy SQLite metadata: %s campaigns, %s runs",
        len(imported_campaign_ids),
        imported_run_count,
    )
    return {"campaigns": len(imported_campaign_ids), "runs": imported_run_count}


def up() -> None:
    database = _postgres_database()
    database.execute(
        (MIGRATION_DIR / "006_postgres_only.sql").read_text(encoding="utf-8")
    )
    import_legacy_sqlite(database=database)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("direction", choices=("up",))
    parser.parse_args()
    up()
    print("Module 7 migration 006 up completed.")


if __name__ == "__main__":
    main()
