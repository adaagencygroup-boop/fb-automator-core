# -*- coding: utf-8 -*-
"""
File: modules/module_05_page_manager/routes_reels.py
FastAPI router cho tính năng Đăng Video Reels (Module 05).
"""
import os
import sys
import json
import asyncio
import queue
import threading

_reels_picker_lock = threading.Lock()
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Query, Request, Depends
from fastapi.responses import StreamingResponse

from core.database.connection import db
from modules.module_02_account_manager.api.router import scoped_owner
from modules.module_02_account_manager.context import owner_context
from modules.module_05_page_manager.reels_service import (
    scan_root_directory, auto_match_folders
)
from modules.module_05_page_manager.reels_runner import ReelsTaskRunner

router = APIRouter(
    prefix="/pages/reels",
    tags=["Module 05 Reels"],
    dependencies=[Depends(scoped_owner)]
)


def get_current_owner(request: Optional[Request] = None) -> Optional[str]:
    """Lấy user_id của tài khoản hệ thống đang đăng nhập."""
    owner = owner_context.get()
    if owner:
        return str(owner).strip()
    if request:
        auth_user = request.headers.get("x-auth-user-id") or request.headers.get("x-user-id")
        if auth_user:
            return str(auth_user).strip()
    return None


def require_owner():
    owner = owner_context.get()
    if not owner:
        raise HTTPException(401, "Phiên đăng nhập không hợp lệ.")
    return str(owner)


def current_runner():
    return ReelsTaskRunner(require_owner())


class SelectFolderRequest(BaseModel):
    initial_dir: Optional[str] = None


class ScanFoldersRequest(BaseModel):
    root_dir: str


class PageTargetConfig(BaseModel):
    page_id: str
    page_name: str = ""
    account_uid: Optional[str] = None
    access_token: str = ""
    folder_name: Optional[str] = ""


class StartJobRequest(BaseModel):
    root_dir: str
    pages_config: List[PageTargetConfig]
    schedule_enabled: bool = False
    schedule_times: List[str] = []
    sleep_min: int = 600
    sleep_max: int = 900


@router.get("/accounts-pages")
def get_accounts_and_pages(request: Request):
    """
    Lấy danh sách tài khoản kèm Fanpage con của tài khoản đó.
    Chỉ trả về các tài khoản và Fanpage thuộc sở hữu của User ID đang đăng nhập.
    Gom nhóm Fanpage theo account_uid để render bảng Figma.
    """
    owner = get_current_owner(request)
    if not owner:
        return {"success": True, "accounts": []}

    try:
        pages_raw = db.fetch_all(
            "SELECT id, page_id, page_name, account_uid, category, status, reels_folder, web_connection_id FROM pages WHERE user_id = %s ORDER BY id DESC",
            (owner,)
        )
    except Exception as e:
        pages_raw = []

    # Lấy thông tin tài khoản Facebook từ bảng accounts của chính User đó
    acc_map = {}
    try:
        accounts_raw = db.fetch_all(
            "SELECT uid, profile_name, avatar_url, status, login_status FROM accounts WHERE user_id = %s ORDER BY id DESC",
            (owner,)
        )
        for acc in accounts_raw:
            acc_map[str(acc["uid"])] = acc
    except Exception:
        pass

    # Gom nhóm theo account_uid
    web_map = {str(row["id"]): row for row in db.fetch_all(
        "SELECT id, facebook_name FROM meta_web_connections WHERE user_id = %s", (owner,)
    )}
    grouped: Dict[str, Dict[str, Any]] = {}
    for p in pages_raw:
        uid = str(p.get("account_uid") or "").strip()
        web_info = web_map.get(str(p.get("web_connection_id")))
        group_key = f"web:{p['web_connection_id']}" if web_info else uid or "unknown"

        if group_key not in grouped:
            acc_info = acc_map.get(uid, {})
            grouped[group_key] = {
                "group_key": group_key,
                "manager_kind": "web" if web_info else "account",
                "web_connection_id": p.get("web_connection_id"),
                "account_uid": uid if uid else None,
                "account_name": web_info["facebook_name"] if web_info else acc_info.get("profile_name") or (f"Tài khoản {uid}" if uid else "Chưa gán tài khoản"),
                "avatar_url": acc_info.get("avatar_url") or "",
                "login_status": "CONNECTED" if web_info else acc_info.get("login_status") or "LOGGED_IN",
                "pages": []
            }

        grouped[group_key]["pages"].append({
            "id": p.get("id"),
            "page_id": str(p.get("page_id")),
            "page_name": p.get("page_name") or f"Page {p.get('page_id')}",
            "category": p.get("category") or "",
            "status": p.get("status") or "ACTIVE",
            "reels_folder": p.get("reels_folder") or "",
        })

    # Nếu có tài khoản trong accounts mà chưa có page nào, vẫn hiển thị 0 page
    for uid, acc in acc_map.items():
        if uid not in grouped:
            grouped[uid] = {
                "group_key": uid,
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


@router.post("/select-folder")
def select_reels_folder(req: Optional[SelectFolderRequest] = None):
    """
    Mở hộp thoại Windows native FolderBrowserDialog để chọn thư mục video Reels.
    Nhận chính xác 100% đường dẫn tuyệt đối từ bất kỳ ổ đĩa nào, không fix cứng mặc định.
    """
    init_dir = (req.initial_dir if req else None) or ""
    clean_init = init_dir.strip().strip('"').strip("'") if init_dir else ""
    dialog_init = clean_init if (clean_init and os.path.exists(clean_init) and os.path.isdir(clean_init)) else None

    if not _reels_picker_lock.acquire(blocking=False):
        return {"folder": "", "error": "Cửa sổ chọn thư mục đang mở, vui lòng thao tác trên cửa sổ đó!", "success": False}

    selected = ""
    error_msg = ""
    try:
        import subprocess
        helper_path = os.path.join(os.path.dirname(__file__), "picker_helper.py")
        venv_python = sys.executable
        cmd = [venv_python, helper_path]
        if dialog_init:
            cmd.append(dialog_init)
        else:
            cmd.append("")
        cmd.append("Chọn thư mục gốc video Reels")
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        selected = res.stdout.strip()
        if res.returncode != 0:
            error_msg = f"picker_helper code {res.returncode}: {res.stderr.strip()}"
    except Exception as e:
        error_msg = f"subprocess error: {str(e)}"
        selected = ""
    finally:
        _reels_picker_lock.release()

    if selected:
        selected = os.path.normpath(selected)
    return {"folder": selected or "", "success": bool(selected), "error": error_msg}


@router.post("/scan-folders")
def scan_folders(req: ScanFoldersRequest):
    """
    Quét thư mục gốc và trả về danh sách thư mục con kèm gợi ý khớp tên Fanpage.
    """
    clean_dir = os.path.normpath(req.root_dir.strip().strip('"').strip("'")) if req.root_dir else ""
    scan_res = scan_root_directory(clean_dir)
    if not scan_res.get("success"):
        return scan_res

    # Lấy danh sách toàn bộ page hiện có để tự động đối chiếu
    try:
        pages_raw = db.fetch_all("SELECT page_id, page_name FROM pages WHERE user_id = %s", (require_owner(),))
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
    owner = require_owner()
    payload = req.model_dump()
    selected = []
    seen = set()
    for target in req.pages_config:
        if target.page_id in seen:
            continue
        seen.add(target.page_id)
        page = db.fetch_one("SELECT page_id, page_name, account_uid, reels_folder FROM pages WHERE user_id = %s AND page_id = %s", (owner, target.page_id))
        if not page:
            raise HTTPException(404, "Page không thuộc owner hiện tại.")
        # Only folder selection is supplied by the caller; credentials stay in the DB.
        selected.append({**page, "folder_name": target.folder_name or page.get("reels_folder") or page["page_name"]})
    payload["pages_config"] = selected
    res = current_runner().start_job(payload)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error"))
    return res


@router.post("/stop")
def stop_reels_job():
    """Dừng tiến trình đăng Reels."""
    return current_runner().stop_job()


@router.get("/status")
def get_reels_status():
    """Lấy trạng thái và thống kê tiến trình đăng."""
    return current_runner().get_status()


@router.post("/clear-logs")
def clear_logs():
    """Xóa danh sách console log."""
    current_runner().clear_logs()
    return {"success": True}


@router.get("/logs/stream")
async def stream_logs():
    """
    SSE endpoint stream console log thời gian thực về frontend.
    """
    runner = current_runner()
    q: queue.Queue = queue.Queue()

    def on_log(entry):
        q.put(entry)

    runner.subscribe(on_log)

    async def event_generator():
        try:
            # Gửi các log gần nhất lúc mới kết nối
            status = runner.get_status()
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
            runner.unsubscribe(on_log)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
