# -*- coding: utf-8 -*-
"""
File: modules/module_05_page_manager/routes_pages.py
FastAPI router cho tính năng Quản lý Danh sách Fanpage (Module 05).
Chuẩn hóa đọc và ghi trực tiếp từ bảng `pages` của hệ thống (kết hợp bảng `accounts`),
áp dụng phân quyền chặt chẽ theo `user_id` của phiên đăng nhập hiện tại.
"""
import re
import time
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Depends, Request

from core.database.connection import db
from core.facebook.fb_graph_client import fb_client
from modules.module_02_account_manager.api.router import scoped_owner
from modules.module_02_account_manager.context import owner_context

router = APIRouter(
    prefix="/pages",
    tags=["Module 05 Fanpage Manager"],
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


class SyncByAccountBody(BaseModel):
    account_uid: str
    custom_token: Optional[str] = ""


@router.get("/managed")
def get_managed_pages(request: Request):
    """
    Lấy danh sách Fanpage từ bảng `pages` thuộc sở hữu của User ID đang đăng nhập,
    kết nối với bảng `accounts` của chính User đó để lấy thông tin Nick quản trị.
    """
    owner = get_current_owner(request)
    if not owner:
        return {"pages": []}

    try:
        pages_raw = db.fetch_all(
            "SELECT id, page_id, page_name, category, status, account_uid, reels_folder, created_at FROM pages WHERE user_id = %s ORDER BY id DESC",
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
            uid_str = str(acc.get("uid") or "").strip()
            if uid_str and uid_str not in acc_map:
                acc_map[uid_str] = acc
    except Exception:
        pass

    try:
        pages = []
        for r in pages_raw:
            pid = str(r.get("page_id") or "")
            uid = str(r.get("account_uid") or "").strip()
            page_status = (r.get("status") or "ACTIVE").upper()

            # Hiển thị trạng thái SUCCESS / ERROR phù hợp với UI FanpageList
            display_status = "SUCCESS" if page_status in ("ACTIVE", "SUCCESS", "LIVE") else "ERROR"

            page_url = f"https://www.facebook.com/{pid}" if pid else ""
            avatar_url = f"https://graph.facebook.com/{pid}/picture?type=square&width=80&height=80" if pid else ""

            acc_info = acc_map.get(uid, {})
            mgr_name = acc_info.get("profile_name") or (f"Tài khoản {uid}" if uid else "Chưa gán")
            mgr_avatar = acc_info.get("avatar_url") or (f"https://graph.facebook.com/{uid}/picture?type=square&width=80&height=80" if uid else "")

            pages.append({
                "id": r.get("id"),
                "page_id": pid,
                "page_name": r.get("page_name") or f"Page {pid}",
                "page_category": r.get("category") or "Fanpage Facebook",
                "page_url": page_url,
                "page_avatar_url": avatar_url,
                "status": display_status,
                "raw_status": page_status,
                "manager_uid": uid,
                "manager_name": mgr_name,
                "manager_avatar_url": mgr_avatar,
                "reels_folder": r.get("reels_folder") or "",
                "created_at": str(r.get("created_at") or "")
            })

        return {"pages": pages}
    except Exception as e:
        return {"pages": [], "error": str(e)}


@router.post("/sync-by-account")
def sync_by_account(body: SyncByAccountBody, request: Request):
    """
    Quét và nạp tất cả Fanpage từ một nick Facebook thuộc sở hữu của User hiện tại:
    1. Lấy token của nick Facebook (hoặc custom_token nếu người dùng dán).
    2. Nâng cấp token sang Long-lived User Token (nếu có App ID/Secret).
    3. Gọi Meta Graph API /me/accounts để lấy danh sách Page kèm Permanent Page Access Token.
    4. UPSERT vào bảng `pages` với `user_id = current_user_id` và `account_uid = selected_uid`.
    """
    owner = get_current_owner(request)
    if not owner:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")

    acc_uid = (body.account_uid or "").strip()
    if not acc_uid:
        raise HTTPException(status_code=400, detail="Vui lòng chọn tài khoản Facebook để quét Fanpage.")

    # Tìm tài khoản trong bảng accounts thuộc sở hữu của user_id hiện tại
    acc = db.fetch_one(
        "SELECT uid, profile_name, token, status FROM accounts WHERE uid = %s AND user_id = %s",
        (acc_uid, owner)
    )

    token = (body.custom_token or "").strip()
    if not token and acc and acc.get("token"):
        token = str(acc["token"]).strip()

    if not token:
        name_str = acc.get("profile_name") if acc else acc_uid
        raise HTTPException(
            status_code=400,
            detail=f"Tài khoản '{name_str}' chưa có Access Token. Vui lòng nhập Access Token hoặc đăng nhập lại nick này."
        )

    # Gọi Graph API quét tất cả Fanpage
    try:
        pages = fb_client.fetch_managed_pages(token)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=f"Lỗi khi kết nối Facebook Graph API: {ex}")

    if not pages:
        return {
            "success": True,
            "count": 0,
            "message": "Không tìm thấy Fanpage nào được quản lý bởi tài khoản này."
        }

    synced_count = 0
    for p in pages:
        pid = str(p.get("id"))
        pname = p.get("name") or f"Page {pid}"
        ptoken = p.get("access_token") or ""
        pcat = p.get("category") or "Fanpage Facebook"

        sql = """
        INSERT INTO pages (page_id, page_name, access_token, category, account_uid, user_id, status)
        VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE')
        ON CONFLICT (page_id) DO UPDATE SET
            page_name = EXCLUDED.page_name,
            access_token = CASE WHEN EXCLUDED.access_token != '' THEN EXCLUDED.access_token ELSE pages.access_token END,
            category = EXCLUDED.category,
            account_uid = EXCLUDED.account_uid,
            user_id = EXCLUDED.user_id,
            status = 'ACTIVE'
        """
        db.execute(sql, (pid, pname, ptoken, pcat, acc_uid, owner))
        synced_count += 1

    # Nếu người dùng nhập custom_token thì cập nhật luôn token cho tài khoản Facebook trong bảng accounts
    if body.custom_token and acc:
        try:
            db.execute("UPDATE accounts SET token = %s WHERE uid = %s AND user_id = %s", (token, acc_uid, owner))
        except Exception:
            pass

    return {
        "success": True,
        "count": synced_count,
        "message": f"Đã quét và nạp thành công {synced_count} Fanpage kèm Token vĩnh viễn!",
        "pages": pages
    }


@router.delete("/{page_identifier}")
def delete_managed_page(page_identifier: str, request: Request):
    """
    Xóa Fanpage khỏi bảng `pages`, có ràng buộc chặt chẽ theo `user_id` của người dùng hiện tại.
    """
    owner = get_current_owner(request)
    if not owner:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ.")

    try:
        if page_identifier.isdigit() and len(page_identifier) < 10:
            db.execute(
                "DELETE FROM pages WHERE (id = %s OR page_id = %s) AND user_id = %s",
                (int(page_identifier), page_identifier, owner)
            )
        else:
            db.execute(
                "DELETE FROM pages WHERE page_id = %s AND user_id = %s",
                (page_identifier, owner)
            )
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Lỗi xóa fanpage: {e}")
