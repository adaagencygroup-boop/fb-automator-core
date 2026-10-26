"""Campaign management and execution history endpoints for Module 7."""
from __future__ import annotations

from datetime import datetime, timedelta
import json
import math
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query

from core.database.connection import db
from modules.module_02_account_manager.api.router import scoped_owner

router = APIRouter(tags=["Module 07: Campaigns & History"])


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
    where_clauses = ["c.deleted_at IS NULL"]
    params: list[Any] = []

    if owner:
        where_clauses.append("c.owner_key = ?")
        params.append(owner)

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
        where_clauses.append("CAST(c.created_at AS DATE) = CAST(? AS DATE)")
        params.append(today_str)
    elif time_filter == "7days":
        seven_days_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d")
        where_clauses.append("CAST(c.created_at AS DATE) >= CAST(? AS DATE)")
        params.append(seven_days_ago)
    elif time_filter == "30days":
        thirty_days_ago = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        where_clauses.append("CAST(c.created_at AS DATE) >= CAST(? AS DATE)")
        params.append(thirty_days_ago)
    elif time_filter == "custom":
        if from_date and from_date.strip():
            where_clauses.append("CAST(c.created_at AS DATE) >= CAST(? AS DATE)")
            params.append(from_date.strip())
        if to_date and to_date.strip():
            where_clauses.append("CAST(c.created_at AS DATE) <= CAST(? AS DATE)")
            params.append(to_date.strip())

    where_sql = " AND ".join(where_clauses)
    query = f"""
        SELECT 
            c.campaign_id AS id,
            c.name,
            c.description,
            c.action_type,
            c.created_at,
            (
                SELECT COALESCE(r2.started_at, r2.finished_at, r2.synced_at)
                FROM cloud_group_runs r2
                WHERE r2.campaign_id = c.campaign_id
                ORDER BY r2.run_number DESC
                LIMIT 1
            ) AS last_run_at,
            (
                SELECT r3.status 
                FROM cloud_group_runs r3
                WHERE r3.campaign_id = c.campaign_id
                ORDER BY r3.run_number DESC
                LIMIT 1
            ) AS latest_status,
            (
                SELECT COUNT(r5.run_id)
                FROM cloud_group_runs r5
                WHERE r5.campaign_id = c.campaign_id
            ) AS total_runs,
            (
                SELECT COUNT(DISTINCT l.account_uid)
                FROM cloud_group_logs l
                JOIN cloud_group_runs r6 ON r6.run_id = l.run_id
                WHERE r6.campaign_id = c.campaign_id
            ) AS total_accounts_run
        FROM cloud_group_campaigns c
        WHERE {where_sql}
        ORDER BY COALESCE(last_run_at, c.created_at) DESC
    """

    rows = db.fetch_all(query, tuple(params))

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
            if status == "RUNNING" and st not in {"RUNNING", "QUEUED", "SCHEDULED"}:
                continue

        items.append({
            "id": row["id"],
            "name": row["name"],
            "description": row.get("description") or "",
            "action_type": row["action_type"],
            "created_at": row["created_at"],
            "last_run_at": row["last_run_at"] or row["created_at"],
            "status": st,
            "total_accounts_run": row.get("total_accounts_run") or 0,
            "total_runs": row["total_runs"] or 0,
        })

    return {"campaigns": items, "count": len(items)}


@router.get("/campaigns/{campaign_id}/details")
async def get_campaign_details(
    campaign_id: str,
    owner: str | None = Depends(scoped_owner),
):
    """Lấy danh sách các tài khoản, nhóm và link bài viết của chiến dịch (khoảng 5 dòng cuộn, Copy UID)."""
    campaign_where = "campaign_id = ?"
    campaign_params: list[Any] = [campaign_id]
    if owner:
        campaign_where += " AND owner_key = ?"
        campaign_params.append(owner)
    campaign = db.fetch_one(
        f"SELECT campaign_id AS id, name, description, action_type "
        f"FROM cloud_group_campaigns WHERE {campaign_where}",
        tuple(campaign_params),
    )
    if not campaign:
        raise HTTPException(404, "Không tìm thấy chiến dịch")

    tasks_where = ["r.campaign_id = ?"]
    task_params: list[Any] = [campaign_id]
    if owner:
        tasks_where.append("r.owner_key = ?")
        task_params.append(owner)
    tasks_query = f"""
        SELECT 
            l.log_id AS id,
            l.account_uid,
            l.account_name,
            l.group_key,
            l.group_name,
            l.group_url,
            l.result_url,
            l.status,
            l.result_message,
            l.finished_at,
            l.synced_at
        FROM cloud_group_logs l
        JOIN cloud_group_runs r ON l.run_id = r.run_id
        WHERE {' AND '.join(tasks_where)}
        ORDER BY COALESCE(l.finished_at, l.synced_at) DESC
    """
    task_rows = db.fetch_all(tasks_query, tuple(task_params))

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
            "created_at": task.get("finished_at") or task.get("synced_at") or "",
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
    where = "campaign_id = ? AND deleted_at IS NULL"
    params: list[Any] = [campaign_id]
    if owner:
        where += " AND owner_key = ?"
        params.append(owner)
    campaign = db.fetch_one(
        f"SELECT campaign_id AS id, name, description, action_type "
        f"FROM cloud_group_campaigns WHERE {where}",
        tuple(params),
    )
    if not campaign:
        raise HTTPException(404, "Không tìm thấy chiến dịch để chạy lại")

    run = db.fetch_one(
        "SELECT run_id AS id, config_json, run_number, synced_at AS created_at "
        "FROM cloud_group_runs WHERE campaign_id = ? "
        "ORDER BY run_number DESC LIMIT 1",
        (campaign_id,),
    )
    if not run or not run.get("config_json"):
        raise HTTPException(404, "Không tìm thấy cấu hình lượt chạy trước")

    try:
        raw_config = run["config_json"]
        config = raw_config if isinstance(raw_config, dict) else json.loads(raw_config)
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
    where = "campaign_id = ? AND deleted_at IS NULL"
    params: list[Any] = [campaign_id]
    if owner:
        where += " AND owner_key = ?"
        params.append(owner)
    campaign = db.fetch_one(
        f"SELECT campaign_id AS id, name FROM cloud_group_campaigns WHERE {where}",
        tuple(params),
    )
    if not campaign:
        raise HTTPException(404, "Không tìm thấy chiến dịch hoặc đã bị xóa")

    delete_where = "campaign_id = ?"
    delete_params: list[Any] = [campaign_id]
    if owner:
        delete_where += " AND owner_key = ?"
        delete_params.append(owner)
    db.execute(
        "UPDATE cloud_group_campaigns "
        "SET deleted_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC', "
        "updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' "
        f"WHERE {delete_where}",
        tuple(delete_params),
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
    # Validate date range: Từ ngày không được lớn hơn Đến ngày
    if from_date and to_date and from_date.strip() > to_date.strip():
        raise HTTPException(400, "Thời gian 'Từ ngày' không được lớn hơn 'Đến ngày'")

    where_clauses = ["1=1"]
    params: list[Any] = []

    if owner:
        where_clauses.append("r.owner_key = ?")
        params.append(owner)

    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        where_clauses.append(
            "(LOWER(r.campaign_name) LIKE ? OR LOWER(l.account_uid) LIKE ? OR LOWER(COALESCE(l.result_url, '')) LIKE ? OR LOWER(COALESCE(l.group_name, '')) LIKE ?)"
        )
        params.extend([term, term, term, term])

    if campaign_id and campaign_id.strip() and campaign_id.strip() != "ALL":
        where_clauses.append("r.campaign_id = ?")
        params.append(campaign_id.strip())

    if action_type and action_type.upper() in {"POST", "COMMENT"}:
        where_clauses.append("r.action_type = ?")
        params.append(action_type.upper())

    if status and status.upper() in {"SUCCESS", "FAILED"}:
        if status.upper() == "SUCCESS":
            where_clauses.append("l.status = 'SUCCESS'")
        else:
            where_clauses.append("l.status IN ('FAILED', 'CANCELLED')")

    if from_date and from_date.strip():
        where_clauses.append("CAST(COALESCE(l.finished_at, l.synced_at) AS DATE) >= CAST(? AS DATE)")
        params.append(from_date.strip())

    if to_date and to_date.strip():
        where_clauses.append("CAST(COALESCE(l.finished_at, l.synced_at) AS DATE) <= CAST(? AS DATE)")
        params.append(to_date.strip())

    where_sql = " AND ".join(where_clauses)

    # 1. Thống kê theo đúng bộ lọc
    stats_query = f"""
        SELECT 
            COUNT(l.log_id) AS total_count,
            SUM(CASE WHEN l.status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN l.status IN ('FAILED', 'CANCELLED') THEN 1 ELSE 0 END) AS failed_count
        FROM cloud_group_logs l
        JOIN cloud_group_runs r ON l.run_id = r.run_id
        WHERE {where_sql}
    """
    stats_row = db.fetch_one(stats_query, tuple(params)) or {}
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
    campaign_filter = "deleted_at IS NULL"
    campaign_filter_params: tuple[Any, ...] = ()
    if owner:
        campaign_filter += " AND owner_key = ?"
        campaign_filter_params = (owner,)
    campaigns_list = db.fetch_all(
        f"SELECT campaign_id AS id, name FROM cloud_group_campaigns WHERE {campaign_filter} "
        "ORDER BY created_at DESC LIMIT 100",
        campaign_filter_params,
    )

    # 3. Phân trang danh sách bản ghi lịch sử
    total_pages = max(1, math.ceil(total / page_size))
    offset = (page - 1) * page_size

    list_query = f"""
        SELECT 
            l.log_id AS id,
            l.run_id,
            r.campaign_id,
            r.campaign_name,
            r.action_type,
            l.account_uid,
            l.account_name,
            l.group_key,
            l.group_name,
            l.group_url,
            l.content,
            l.status,
            l.result_message,
            l.result_url,
            l.finished_at,
            l.synced_at
        FROM cloud_group_logs l
        JOIN cloud_group_runs r ON l.run_id = r.run_id
        WHERE {where_sql}
        ORDER BY COALESCE(l.finished_at, l.synced_at) DESC
        LIMIT ? OFFSET ?
    """
    list_params = list(params)
    list_params.extend([page_size, offset])
    rows = db.fetch_all(list_query, tuple(list_params))

    records = []
    start_index = (page - 1) * page_size + 1
    for i, row in enumerate(rows):
        is_post = row["action_type"] == "POST"
        st = "SUCCESS" if row["status"] == "SUCCESS" else "FAILED"
        if st == "SUCCESS":
            result_desc = "Đã đăng bài" if is_post else "Đã bình luận"
        else:
            result_desc = row.get("result_message") or "Lỗi"

        time_val = row.get("finished_at") or row.get("synced_at") or ""
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
