"""Campaign management and execution history endpoints for Module 7."""
from __future__ import annotations

from datetime import datetime, timedelta
import json
import math
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query

from modules.module_02_account_manager.api.router import scoped_owner
from ..local_database import local_db

router = APIRouter(tags=["Module 07: Campaigns & History"])


def _campaign(campaign_id: str, owner: str | None) -> dict:
    local_db.initialize()
    campaign = local_db.fetch_one(
        "SELECT * FROM group_campaigns WHERE id = ? AND owner_key = ? AND deleted_at IS NULL",
        (campaign_id, owner or ""),
    )
    if not campaign:
        raise HTTPException(404, "Không tìm thấy chiến dịch")
    return campaign


@router.get("/campaigns")
async def list_campaigns(
    q: str | None = Query(None, description="Tìm theo tên chiến dịch"),
    time_filter: str = Query("all", description="Khoảng thời gian: all, today, 7days, 30days, custom"),
    from_date: str | None = Query(None, description="Từ ngày (YYYY-MM-DD)"),
    to_date: str | None = Query(None, description="Đến ngày (YYYY-MM-DD)"),
    action_type: str = Query("ALL", description="Loại tác vụ: ALL, POST, COMMENT"),
    status: str = Query("ALL", description="Trạng thái: ALL, COMPLETED, STOPPED, FAILED, RUNNING"),
    owner: str | None = Depends(scoped_owner),
):
    """Lấy danh sách các chiến dịch đã lưu và thực thi."""
    local_db.initialize()

    if from_date and to_date and from_date.strip() > to_date.strip():
        raise HTTPException(400, "Khoảng ngày không hợp lệ")

    where_clauses = ["c.deleted_at IS NULL", "c.owner_key = ?"]
    params: list[Any] = [owner or ""]

    if q and q.strip():
        where_clauses.append("LOWER(c.name) LIKE ?")
        params.append(f"%{q.strip().lower()}%")

    if action_type and action_type.upper() in {"POST", "COMMENT"}:
        where_clauses.append("c.action_type = ?")
        params.append(action_type.upper())

    # Time filters
    now = datetime.now()
    if time_filter == "today":
        today_str = now.strftime("%Y-%m-%d")
        where_clauses.append("SUBSTR(c.created_at, 1, 10) = ?")
        params.append(today_str)
    elif time_filter == "7days":
        seven_days_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d")
        where_clauses.append("SUBSTR(c.created_at, 1, 10) >= ?")
        params.append(seven_days_ago)
    elif time_filter == "30days":
        thirty_days_ago = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        where_clauses.append("SUBSTR(c.created_at, 1, 10) >= ?")
        params.append(thirty_days_ago)
    elif time_filter == "custom":
        if from_date and from_date.strip():
            where_clauses.append("SUBSTR(c.created_at, 1, 10) >= ?")
            params.append(from_date.strip())
        if to_date and to_date.strip():
            where_clauses.append("SUBSTR(c.created_at, 1, 10) <= ?")
            params.append(to_date.strip())

    where_sql = " AND ".join(where_clauses)
    query = f"""
        SELECT
            c.id,
            c.name,
            c.description,
            c.action_type,
            c.created_at,
            (SELECT COUNT(*) FROM group_run_tasks t JOIN group_runs r ON r.id = t.run_id
             WHERE r.campaign_id = c.id AND t.status = 'SUCCESS') AS total_interactions,
            (
                SELECT COALESCE(r2.started_at, r2.created_at)
                FROM group_runs r2
                WHERE r2.campaign_id = c.id
                ORDER BY r2.run_number DESC
                LIMIT 1
            ) AS last_run_at,
            (
                SELECT r3.status
                FROM group_runs r3
                WHERE r3.campaign_id = c.id
                ORDER BY r3.run_number DESC
                LIMIT 1
            ) AS latest_status,
            (
                SELECT COUNT(DISTINCT t.account_uid)
                FROM group_run_tasks t
                JOIN group_runs r4 ON t.run_id = r4.id
                WHERE r4.campaign_id = c.id
            ) AS total_accounts_run,
            (
                SELECT COUNT(r5.id)
                FROM group_runs r5
                WHERE r5.campaign_id = c.id
            ) AS total_runs
        FROM group_campaigns c
        WHERE {where_sql}
        ORDER BY COALESCE(last_run_at, c.created_at) DESC
    """

    rows = local_db.fetch_all(query, tuple(params))

    items = []
    for row in rows:
        st = row.get("latest_status") or "CHƯA CHẠY"
        # Status filtering in memory if status filter selected
        if status != "ALL":
            if status == "COMPLETED" and st != "COMPLETED":
                continue
            if status == "STOPPED" and st != "STOPPED":
                continue
            if status == "FAILED" and st != "FAILED":
                continue
            if status == "RUNNING" and st not in {"RUNNING", "QUEUED", "SCHEDULED", "PAUSED", "STOPPING"}:
                continue

        items.append({
            "id": row["id"],
            "name": row["name"],
            "description": row.get("description") or "",
            "action_type": row["action_type"],
            "created_at": row["created_at"],
            "last_run_at": row["last_run_at"] or row["created_at"],
            "status": st,
            "total_accounts_run": row["total_accounts_run"] or 0,
            "total_runs": row["total_runs"] or 0,
            "total_interactions": row["total_interactions"] or 0,
        })

    return {"campaigns": items, "count": len(items)}


@router.get("/campaigns/{campaign_id}/details")
async def get_campaign_details(
    campaign_id: str,
    owner: str | None = Depends(scoped_owner),
):
    """Lấy danh sách các tài khoản, nhóm và link bài viết của chiến dịch (khoảng 5 dòng cuộn, Copy UID)."""
    campaign = _campaign(campaign_id, owner)

    tasks_query = """
        SELECT
            t.id,
            t.account_uid,
            t.account_name,
            t.group_key,
            t.group_name,
            t.group_url,
            t.result_url,
            t.status,
            t.result_message,
            t.created_at,
            t.finished_at
        FROM group_run_tasks t
        JOIN group_runs r ON t.run_id = r.id
        WHERE r.campaign_id = ?
        ORDER BY t.created_at DESC
    """
    task_rows = local_db.fetch_all(tasks_query, (campaign_id,))

    items = []
    for idx, task in enumerate(task_rows, 1):
        items.append({
            "stt": idx,
            "id": task["id"],
            "account_uid": task["account_uid"],
            "account_name": task.get("account_name") or "",
            "group_name": task.get("group_name") or task.get("group_key") or "",
            "group_url": task.get("group_url") or "",
            "result_url": task.get("result_url") or "",
            "status": task.get("status") or "PENDING",
            "result_message": task.get("result_message") or "",
            "created_at": task.get("finished_at") or task.get("created_at") or "",
        })

    return {
        "campaign": dict(campaign),
        "details": items,
        "count": len(items),
    }


@router.get("/campaigns/{campaign_id}/rerun")
async def get_campaign_rerun_config(
    campaign_id: str,
    owner: str | None = Depends(scoped_owner),
):
    """Nạp cấu hình của lượt chạy trước cho chức năng Chạy lại (CAMP-RUN-01)."""
    campaign = _campaign(campaign_id, owner)

    run = local_db.fetch_one(
        "SELECT id, config_json, run_number, created_at FROM group_runs WHERE campaign_id = ? ORDER BY run_number DESC LIMIT 1",
        (campaign_id,),
    )
    if not run or not run.get("config_json"):
        raise HTTPException(404, "Không tìm thấy cấu hình lượt chạy trước")

    try:
        config = json.loads(run["config_json"])
    except Exception as exc:
        raise HTTPException(500, f"Không thể giải mã cấu hình chạy lại: {exc}") from exc

    return {
        "campaign_id": campaign["id"],
        "name": campaign["name"],
        "description": campaign.get("description") or "",
        "action_type": campaign["action_type"],
        "run_number": run.get("run_number") or 1,
        "config": config,
    }


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(
    campaign_id: str,
    owner: str | None = Depends(scoped_owner),
):
    """Xóa mềm chiến dịch: ẩn khỏi danh sách nhưng giữ lịch sử tác vụ (CAMP-DEL-01)."""
    campaign = _campaign(campaign_id, owner)

    with local_db.session() as cursor:
        cursor.execute("BEGIN IMMEDIATE")
        active = cursor.execute(
            "SELECT id FROM group_runs WHERE campaign_id = ? AND status IN ('QUEUED', 'SCHEDULED', 'RUNNING', 'PAUSED', 'STOPPING')",
            (campaign_id,),
        ).fetchone()
        if active:
            raise HTTPException(409, "Hãy dừng lượt chạy trước khi xóa chiến dịch")
        cursor.execute(
            "UPDATE group_campaigns SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_key = ?",
            (campaign_id, owner or ""),
        )

    return {
        "success": True,
        "message": f"Đã xóa mềm chiến dịch \"{campaign['name']}\"",
        "campaign_id": campaign_id,
    }


@router.get("/history")
async def get_group_history_records(
    q: str | None = Query(None, description="Tìm kiếm: chiến dịch, UID, link bài viết"),
    campaign_id: str | None = Query(None, description="Mã chiến dịch"),
    action_type: str = Query("ALL", description="Loại seeding: ALL, POST, COMMENT"),
    status: str = Query("ALL", description="Trạng thái: ALL, SUCCESS, FAILED"),
    from_date: str | None = Query(None, description="Từ ngày (YYYY-MM-DD)"),
    to_date: str | None = Query(None, description="Đến ngày (YYYY-MM-DD)"),
    page: int = Query(1, ge=1, description="Trang hiện tại"),
    page_size: int = Query(10, ge=1, le=100, description="Số bản ghi mỗi trang"),
    owner: str | None = Depends(scoped_owner),
):
    """Tra cứu lịch sử đăng bài và bình luận theo Chương 3 SRS."""
    local_db.initialize()

    # Validate date range: Từ ngày không được lớn hơn Đến ngày
    if from_date and to_date and from_date.strip() > to_date.strip():
        raise HTTPException(400, "Thời gian 'Từ ngày' không được lớn hơn 'Đến ngày'")

    where_clauses = ["c.owner_key = ?"]
    params: list[Any] = [owner or ""]

    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        where_clauses.append(
            "(LOWER(c.name) LIKE ? OR LOWER(t.account_uid) LIKE ? OR LOWER(COALESCE(t.result_url, '')) LIKE ? OR LOWER(COALESCE(t.group_name, '')) LIKE ?)"
        )
        params.extend([term, term, term, term])

    if campaign_id and campaign_id.strip() and campaign_id.strip() != "ALL":
        where_clauses.append("c.id = ?")
        params.append(campaign_id.strip())

    if action_type and action_type.upper() in {"POST", "COMMENT"}:
        where_clauses.append("c.action_type = ?")
        params.append(action_type.upper())

    if status and status.upper() in {"SUCCESS", "FAILED"}:
        if status.upper() == "SUCCESS":
            where_clauses.append("t.status = 'SUCCESS'")
        else:
            where_clauses.append("t.status IN ('FAILED', 'CANCELLED')")

    if from_date and from_date.strip():
        where_clauses.append("SUBSTR(COALESCE(t.finished_at, t.created_at), 1, 10) >= ?")
        params.append(from_date.strip())

    if to_date and to_date.strip():
        where_clauses.append("SUBSTR(COALESCE(t.finished_at, t.created_at), 1, 10) <= ?")
        params.append(to_date.strip())

    where_sql = " AND ".join(where_clauses)

    # 1. Thống kê theo đúng bộ lọc
    stats_query = f"""
        SELECT
            COUNT(t.id) AS total_count,
            SUM(CASE WHEN t.status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN t.status IN ('FAILED', 'CANCELLED') THEN 1 ELSE 0 END) AS failed_count
        FROM group_run_tasks t
        JOIN group_runs r ON t.run_id = r.id
        JOIN group_campaigns c ON r.campaign_id = c.id
        WHERE {where_sql}
    """
    stats_row = local_db.fetch_one(stats_query, tuple(params)) or {}
    total = int(stats_row.get("total_count") or 0)
    success_cnt = int(stats_row.get("success_count") or 0)
    failed_cnt = int(stats_row.get("failed_count") or 0)

    if total > 0:
        success_rate = f"{(success_cnt / total * 100):.1f}%"
        failed_rate = f"{(failed_cnt / total * 100):.1f}%"
    else:
        success_rate = "0%"
        failed_rate = "0%"

    stats = {
        "total": total,
        "success": success_cnt,
        "failed": failed_cnt,
        "success_rate": success_rate,
        "failed_rate": failed_rate,
    }

    # 2. Danh sách chiến dịch để đổ vào dropdown filter
    campaigns_list = local_db.fetch_all(
        "SELECT id, name FROM group_campaigns WHERE owner_key = ? ORDER BY created_at DESC LIMIT 100",
        (owner or "",)
    )

    # 3. Phân trang danh sách bản ghi lịch sử
    total_pages = max(1, math.ceil(total / page_size))
    offset = (page - 1) * page_size

    list_query = f"""
        SELECT
            t.id,
            t.run_id,
            c.id AS campaign_id,
            c.name AS campaign_name,
            c.action_type,
            t.account_uid,
            t.account_name,
            t.group_key,
            t.group_name,
            t.group_url,
            t.content,
            t.status,
            t.result_message,
            t.result_url,
            t.created_at,
            t.finished_at
        FROM group_run_tasks t
        JOIN group_runs r ON t.run_id = r.id
        JOIN group_campaigns c ON r.campaign_id = c.id
        WHERE {where_sql}
        ORDER BY COALESCE(t.finished_at, t.created_at) DESC
        LIMIT ? OFFSET ?
    """
    list_params = list(params)
    list_params.extend([page_size, offset])
    rows = local_db.fetch_all(list_query, tuple(list_params))

    records = []
    start_index = (page - 1) * page_size + 1
    for i, row in enumerate(rows):
        is_post = row["action_type"] == "POST"
        st = row["status"]
        if st == "SUCCESS":
            result_desc = "Đã đăng bài" if is_post else "Đã bình luận"
        else:
            result_desc = row.get("result_message") or "Lỗi"

        time_val = row.get("finished_at") or row.get("created_at") or ""
        records.append({
            "stt": start_index + i,
            "id": row["id"],
            "run_id": row["run_id"],
            "campaign_id": row["campaign_id"],
            "campaign_name": row["campaign_name"],
            "action_type": row["action_type"],
            "account_uid": row["account_uid"],
            "account_name": row.get("account_name") or "",
            "group_name": row.get("group_name") or row.get("group_key") or "",
            "group_url": row.get("group_url") or "",
            "content": row.get("content") or "",
            "status": st,
            "result": result_desc,
            "result_url": row.get("result_url") or row.get("group_url") or "",
            "has_permalink": bool(row.get("result_url")),
            "time": time_val,
        })

    return {
        "stats": stats,
        "campaigns": campaigns_list,
        "records": records,
        "pagination": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        },
    }
