"""PostgreSQL-only persistence for Module 7 campaigns and runtime logs."""

from __future__ import annotations

from datetime import datetime
import json
import logging
import threading
import uuid
from typing import Any


logger = logging.getLogger(__name__)


class CloudHistoryStore:
    """Write campaign metadata, run summaries and task outcomes to PostgreSQL."""

    def __init__(self) -> None:
        self._runs: dict[str, dict[str, Any]] = {}
        self._cloud_ready: set[str] = set()
        self._lock = threading.RLock()

    @staticmethod
    def _db():
        from core.database.connection import db

        return db

    def initialize_run(
        self,
        *,
        run_id: str,
        requested_campaign_id: str | None,
        owner: str | None,
        campaign_name: str,
        description: str | None,
        action_type: str,
        config: dict[str, Any],
    ) -> tuple[str, int]:
        owner_key = owner or ""
        campaign_id = str(requested_campaign_id or "").strip() or str(uuid.uuid4())
        run_number = 1
        config_json = json.dumps(config, ensure_ascii=False, default=str)
        cloud_ready = False

        try:
            with self._db().session() as cursor:
                cursor.execute(
                    "SELECT owner_key FROM cloud_group_campaigns WHERE campaign_id = %s",
                    (campaign_id,),
                )
                existing = cursor.fetchone()
                if existing and str(existing["owner_key"] or "") != owner_key:
                    campaign_id = str(uuid.uuid4())

                cursor.execute(
                    """
                    INSERT INTO cloud_group_campaigns
                        (campaign_id, owner_key, name, description, action_type)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (campaign_id) DO UPDATE SET
                        name = EXCLUDED.name,
                        description = EXCLUDED.description,
                        action_type = EXCLUDED.action_type,
                        deleted_at = NULL,
                        updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                    WHERE cloud_group_campaigns.owner_key = EXCLUDED.owner_key
                    """,
                    (campaign_id, owner_key, campaign_name, description, action_type),
                )
                cursor.execute(
                    "SELECT COALESCE(MAX(run_number), 0) + 1 AS next_number "
                    "FROM cloud_group_runs WHERE campaign_id = %s",
                    (campaign_id,),
                )
                row = cursor.fetchone()
                run_number = int(row["next_number"] if row else 1)
                cursor.execute(
                    """
                    INSERT INTO cloud_group_runs
                        (run_id, campaign_id, run_number, owner_key, campaign_name,
                         action_type, config_json, status, total_planned,
                         total_success, total_failed, total_skipped, synced_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, 'QUEUED',
                            0, 0, 0, 0, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                    """,
                    (
                        run_id, campaign_id, run_number, owner_key, campaign_name,
                        action_type, config_json,
                    ),
                )
            cloud_ready = True
        except Exception:
            logger.warning("Cannot initialize Module 7 campaign in cloud", exc_info=True)

        metadata = {
            "run_id": run_id,
            "campaign_id": campaign_id,
            "run_number": run_number,
            "owner_key": owner_key,
            "campaign_name": campaign_name,
            "description": description,
            "action_type": action_type,
            "config_json": config_json,
            "status": "QUEUED",
            "total_planned": 0,
            "total_success": 0,
            "total_failed": 0,
            "total_skipped": 0,
            "started_at": None,
            "finished_at": None,
        }
        with self._lock:
            self._runs[run_id] = metadata
            if cloud_ready:
                self._cloud_ready.add(run_id)
        return campaign_id, run_number

    def _upsert_cloud_campaign(self, metadata: dict[str, Any]) -> bool:
        try:
            row = self._db().fetch_one(
                """
                INSERT INTO cloud_group_campaigns
                    (campaign_id, owner_key, name, description, action_type)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (campaign_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    action_type = EXCLUDED.action_type,
                    deleted_at = NULL,
                    updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                WHERE cloud_group_campaigns.owner_key = EXCLUDED.owner_key
                RETURNING campaign_id
                """,
                (
                    metadata["campaign_id"], metadata["owner_key"],
                    metadata["campaign_name"], metadata.get("description"),
                    metadata["action_type"],
                ),
            )
            return bool(row)
        except Exception:
            logger.warning("Cannot write Module 7 campaign metadata to cloud", exc_info=True)
            return False

    def _upsert_cloud_run(self, metadata: dict[str, Any]) -> bool:
        try:
            self._db().execute(
                """
                INSERT INTO cloud_group_runs
                    (run_id, campaign_id, run_number, owner_key, campaign_name,
                     action_type, config_json, status, total_planned,
                     total_success, total_failed, total_skipped, started_at,
                     finished_at, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?,
                        CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                ON CONFLICT (run_id) DO UPDATE SET
                    campaign_name = EXCLUDED.campaign_name,
                    action_type = EXCLUDED.action_type,
                    config_json = EXCLUDED.config_json,
                    status = EXCLUDED.status,
                    total_planned = EXCLUDED.total_planned,
                    total_success = EXCLUDED.total_success,
                    total_failed = EXCLUDED.total_failed,
                    total_skipped = EXCLUDED.total_skipped,
                    started_at = EXCLUDED.started_at,
                    finished_at = EXCLUDED.finished_at,
                    synced_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                """,
                (
                    metadata["run_id"], metadata["campaign_id"],
                    metadata["run_number"], metadata["owner_key"],
                    metadata["campaign_name"], metadata["action_type"],
                    metadata["config_json"], metadata["status"],
                    metadata["total_planned"], metadata["total_success"],
                    metadata["total_failed"], metadata["total_skipped"],
                    metadata["started_at"], metadata["finished_at"],
                ),
            )
            with self._lock:
                self._cloud_ready.add(metadata["run_id"])
            return True
        except Exception:
            logger.warning("Cannot write Module 7 run summary to cloud", exc_info=True)
            return False

    def _ensure_cloud_run(self, metadata: dict[str, Any]) -> bool:
        if not self._upsert_cloud_campaign(metadata):
            return False
        return self._upsert_cloud_run(metadata)

    def update_run(
        self,
        run_id: str,
        *,
        status: str,
        total_planned: int,
        total_success: int,
        total_failed: int,
        total_skipped: int,
        started_at: str | None,
        finished_at: str | None,
    ) -> None:
        with self._lock:
            metadata = self._runs.get(run_id)
            cloud_ready = run_id in self._cloud_ready
            if metadata:
                metadata = {
                    **metadata,
                    "status": status,
                    "total_planned": total_planned,
                    "total_success": total_success,
                    "total_failed": total_failed,
                    "total_skipped": total_skipped,
                    "started_at": started_at,
                    "finished_at": finished_at,
                }
                self._runs[run_id] = metadata

        if metadata:
            if cloud_ready:
                self._upsert_cloud_run(metadata)
            else:
                self._ensure_cloud_run(metadata)

    def record_task(self, run_id: str, item: dict[str, Any]) -> None:
        with self._lock:
            metadata = self._runs.get(run_id)
            cloud_ready = run_id in self._cloud_ready
        if not metadata:
            return
        if not cloud_ready and not self._ensure_cloud_run(metadata):
            return
        try:
            self._db().execute(
                """
                INSERT INTO cloud_group_logs
                    (log_id, run_id, owner_key, action_type, account_uid,
                     account_name, group_key, group_name, group_url, content,
                     status, result_message, error_code, error_detail,
                     result_url, finished_at, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
                ON CONFLICT (log_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    result_message = EXCLUDED.result_message,
                    error_code = EXCLUDED.error_code,
                    error_detail = EXCLUDED.error_detail,
                    result_url = EXCLUDED.result_url,
                    finished_at = EXCLUDED.finished_at,
                    synced_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                """,
                (
                    item["id"], run_id, metadata["owner_key"], metadata["action_type"],
                    item["account_uid"], item.get("account_name"), item["group_key"],
                    item.get("group_name"), item["group_url"], item.get("content"),
                    item["status"], item.get("message"), item.get("error_code"),
                    item.get("error_detail"), item.get("result_url"),
                    item.get("finished_at") or datetime.now().isoformat(timespec="seconds"),
                ),
            )
        except Exception:
            logger.warning("Cannot write Module 7 task outcome to cloud", exc_info=True)


cloud_history = CloudHistoryStore()


__all__ = ["CloudHistoryStore", "cloud_history"]
