# -*- coding: utf-8 -*-
"""
File: modules/module_05_page_manager/routes_reels.py
FastAPI router cho tính năng Đăng Video Reels (Module 05).
"""
import json
import asyncio
import queue
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from core.database.connection import db
from modules.module_05_page_manager.reels_service import (
    scan_root_directory, auto_match_folders
)
from modules.module_05_page_manager.reels_runner import reels_runner

router = APIRouter(prefix="/pages/reels", tags=["Module 05 Reels"])


class ScanFoldersRequest(BaseModel):
    root_dir: str


class PageTargetConfig(BaseModel):
    page_id: str
    page_name: str
    account_uid: Optional[str] = None
    access_token: str
    folder_name: Optional[str] = ""


class StartJobRequest(BaseModel):
    root_dir: str
    pages_config: List[PageTargetConfig]
    schedule_enabled: bool = False
    schedule_times: List[str] = []
    sleep_min: int = 600
    sleep_max: int = 900


@router.get("/accounts-pages")
def get_accounts_and_pages():
    """
    Lấy danh sách tài khoản kèm Fanpage con của tài khoản đó.
    Gom nhóm Fanpage theo account_uid để render bảng Figma.
    """
    try:
        pages_raw = db.fetch_all(
            "SELECT id, page_id, page_name, account_uid, access_token, category, status, reels_folder FROM pages ORDER BY id DESC"
        )
    except Exception as e:
        pages_raw = []

    # Lấy thông tin tài khoản Facebook từ bảng accounts (Module 02) nếu có
    acc_map = {}
    try:
        accounts_raw = db.fetch_all(
            "SELECT uid, profile_name, avatar_url, status, login_status FROM accounts"
        )
        for acc in accounts_raw:
            acc_map[str(acc["uid"])] = acc
    except Exception:
        pass

    # Gom nhóm theo account_uid
    grouped: Dict[str, Dict[str, Any]] = {}
    for p in pages_raw:
        uid = str(p.get("account_uid") or "").strip()
        group_key = uid if uid else "unknown"

        if group_key not in grouped:
            acc_info = acc_map.get(uid, {})
            grouped[group_key] = {
                "account_uid": uid if uid else "Chưa gán",
                "account_name": acc_info.get("profile_name") or (f"Tài khoản {uid}" if uid else "Chưa gán tài khoản"),
                "avatar_url": acc_info.get("avatar_url") or "",
                "login_status": acc_info.get("login_status") or "LOGGED_IN",
                "pages": []
            }

        grouped[group_key]["pages"].append({
            "id": p.get("id"),
            "page_id": str(p.get("page_id")),
            "page_name": p.get("page_name") or f"Page {p.get('page_id')}",
            "category": p.get("category") or "",
            "access_token": p.get("access_token") or "",
            "status": p.get("status") or "ACTIVE",
            "reels_folder": p.get("reels_folder") or "",
        })

    # Nếu có tài khoản trong accounts mà chưa có page nào, vẫn hiển thị 0 page
    for uid, acc in acc_map.items():
        if uid not in grouped:
            grouped[uid] = {
                "account_uid": uid,
                "account_name": acc.get("profile_name") or f"Tài khoản {uid}",
                "avatar_url": acc.get("avatar_url") or "",
                "login_status": acc.get("login_status") or "LOGGED_IN",
                "pages": []
            }

    accounts_list = list(grouped.values())
    for a in accounts_list:
        a["pages_count"] = len(a["pages"])

    return {"success": True, "accounts": accounts_list}


@router.post("/scan-folders")
def scan_folders(req: ScanFoldersRequest):
    """
    Quét thư mục gốc và trả về danh sách thư mục con kèm gợi ý khớp tên Fanpage.
    """
    scan_res = scan_root_directory(req.root_dir.strip())
    if not scan_res.get("success"):
        return scan_res

    # Lấy danh sách toàn bộ page hiện có để tự động đối chiếu
    try:
        pages_raw = db.fetch_all("SELECT page_id, page_name FROM pages")
    except Exception:
        pages_raw = []

    matches = auto_match_folders(pages_raw, scan_res.get("folders", []))
    return {
        "success": True,
        "root_dir": scan_res["root_dir"],
        "folders": scan_res["folders"],
        "matches": matches
    }


@router.post("/start")
def start_reels_job(req: StartJobRequest):
    """Kích hoạt tiến trình đăng Reels."""
    payload = req.model_dump()
    res = reels_runner.start_job(payload)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error"))
    return res


@router.post("/stop")
def stop_reels_job():
    """Dừng tiến trình đăng Reels."""
    return reels_runner.stop_job()


@router.get("/status")
def get_reels_status():
    """Lấy trạng thái và thống kê tiến trình đăng."""
    return reels_runner.get_status()


@router.post("/clear-logs")
def clear_logs():
    """Xóa danh sách console log."""
    reels_runner.clear_logs()
    return {"success": True}


@router.get("/logs/stream")
async def stream_logs():
    """
    SSE endpoint stream console log thời gian thực về frontend.
    """
    q: queue.Queue = queue.Queue()

    def on_log(entry):
        q.put(entry)

    reels_runner.subscribe(on_log)

    async def event_generator():
        try:
            # Gửi các log gần nhất lúc mới kết nối
            status = reels_runner.get_status()
            for log_item in status.get("recent_logs", []):
                yield f"data: {json.dumps(log_item, ensure_ascii=False)}\n\n"

            while True:
                try:
                    # Lấy từ queue không khóa quá lâu để có thể gửi heartbeat
                    entry = q.get_nowait()
                    yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
                except queue.Empty:
                    # Gửi heartbeat giữ kết nối
                    yield ": ping\n\n"
                    await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass
        finally:
            reels_runner.unsubscribe(on_log)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
