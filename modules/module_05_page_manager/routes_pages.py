# -*- coding: utf-8 -*-
"""
File: modules/module_05_page_manager/routes_pages.py
FastAPI router cho tính năng Quản lý Danh sách Fanpage (Module 05).
Chuẩn hóa đọc và ghi trực tiếp từ bảng `pages` của hệ thống (kết hợp bảng `accounts`).
"""
import re
import time
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

from core.database.connection import db

router = APIRouter(prefix="/pages", tags=["Module 05 Fanpage Manager"])


def extract_page_id(url_or_id: Optional[str]) -> str:
    """
    Trích xuất page_id từ URL Facebook hoặc chuỗi nhập vào.
    Hỗ trợ:
      - 'https://www.facebook.com/profile.php?id=61595040344257' -> '61595040344257'
      - 'https://www.facebook.com/1126925703844118' -> '1126925703844118'
      - 'https://facebook.com/CheckInVN/' -> 'CheckInVN'
      - '61595040344257' -> '61595040344257'
    """
    raw = (url_or_id or "").strip()
    if not raw:
        return ""
    if re.match(r"^\d{4,25}$", raw):
        return raw

    # URL query parameter ?id=...
    match_query = re.search(r"[?&]id=(\d+)", raw)
    if match_query:
        return match_query.group(1)

    # URL path /profile.php?id=... hoặc /{slug}
    match_path = re.search(r"facebook\.com/(?:pages/[^/]+/)?([^/?#]+)", raw)
    if match_path:
        slug = match_path.group(1).strip()
        if slug.lower() not in ("profile.php", "pages", "people", "groups", "watch", "reel"):
            return slug

    return ""


class ManualPageBody(BaseModel):
    page_name: str
    page_url: Optional[str] = ""
    manager_uid: Optional[str] = ""
    category: Optional[str] = "Fanpage Facebook"
    access_token: Optional[str] = ""


@router.get("/managed")
def get_managed_pages():
    """
    Lấy danh sách tất cả Fanpage trong hệ thống từ bảng `pages`,
    kết nối với bảng `accounts` để lấy thông tin Nick quản trị.
    """
    try:
        pages_raw = db.fetch_all(
            "SELECT id, page_id, page_name, category, status, account_uid, reels_folder, created_at FROM pages ORDER BY id DESC"
        )
    except Exception as e:
        pages_raw = []

    # Lấy thông tin tài khoản Facebook từ bảng accounts (khử trùng lặp theo UID)
    acc_map = {}
    try:
        accounts_raw = db.fetch_all(
            "SELECT uid, profile_name, avatar_url, status, login_status FROM accounts ORDER BY id DESC"
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


@router.post("/manual")
def add_manual_page(body: ManualPageBody):
    """
    Thêm Fanpage thủ công vào bảng `pages`.
    Tự động trích xuất Page ID từ link và liên kết Token từ tài khoản nếu có.
    """
    name = (body.page_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tên fanpage không được để trống.")

    page_id = extract_page_id(body.page_url) or extract_page_id(body.page_name)
    if not page_id:
        page_id = f"manual_{int(time.time())}"

    manager_uid = (body.manager_uid or "").strip()
    access_token = (body.access_token or "").strip()

    # Nếu không nhập access_token, tìm token của nick quản lý trong bảng accounts
    if not access_token and manager_uid:
        try:
            acc = db.fetch_one("SELECT token FROM accounts WHERE uid = %s", (manager_uid,))
            if acc and acc.get("token"):
                access_token = acc["token"].strip()
        except Exception:
            pass

    try:
        sql = """
        INSERT INTO pages (page_id, page_name, account_uid, access_token, category, status)
        VALUES (%s, %s, %s, %s, %s, 'ACTIVE')
        ON CONFLICT (page_id) DO UPDATE SET
            page_name = EXCLUDED.page_name,
            account_uid = EXCLUDED.account_uid,
            access_token = CASE WHEN EXCLUDED.access_token != '' THEN EXCLUDED.access_token ELSE pages.access_token END,
            category = EXCLUDED.category,
            status = 'ACTIVE'
        RETURNING id
        """
        row = db.fetch_one(
            sql,
            (page_id, name, manager_uid, access_token, body.category or "Fanpage Facebook")
        )
        return {
            "success": True,
            "id": row["id"] if row else None,
            "page_id": page_id,
            "page_name": name,
            "account_uid": manager_uid
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Lỗi khi thêm fanpage: {e}")


@router.delete("/{page_identifier}")
def delete_managed_page(page_identifier: str):
    """
    Xóa Fanpage khỏi bảng `pages`. Hỗ trợ xóa theo ID (số) hoặc page_id (chuỗi).
    """
    try:
        if page_identifier.isdigit() and len(page_identifier) < 10:
            db.execute("DELETE FROM pages WHERE id = %s OR page_id = %s", (int(page_identifier), page_identifier))
        else:
            db.execute("DELETE FROM pages WHERE page_id = %s", (page_identifier,))
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Lỗi xóa fanpage: {e}")
