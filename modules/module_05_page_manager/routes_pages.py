# -*- coding: utf-8 -*-
"""
File: modules/module_05_page_manager/routes_pages.py
FastAPI router cho tính năng Quản lý Danh sách Fanpage (Module 05).
Chuẩn hóa đọc và ghi trực tiếp từ bảng `pages` của hệ thống (kết hợp bảng `accounts`),
áp dụng phân quyền chặt chẽ theo `user_id` của phiên đăng nhập hiện tại.
"""
import os
import re
import time
from typing import Optional, List, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
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


class SyncByTokenBody(BaseModel):
    access_token: str


class OAuthByProfileBody(BaseModel):
    account_uid: str
    headless: bool = False


class VerifyTokensBody(BaseModel):
    account_uids: Optional[List[str]] = None


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


@router.get("/oauth-config")
def get_oauth_config():
    """Lấy cấu hình Meta OAuth để frontend mở dialog."""
    app_id = os.getenv("FACEBOOK_APP_ID", "").strip()
    api_ver = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v19.0").strip()
    return {
        "app_id": app_id,
        "api_version": api_ver,
        "configured": bool(app_id)
    }


@router.post("/sync-by-token")
def sync_by_token(body: SyncByTokenBody, request: Request):
    """
    Đồng bộ Fanpage từ Access Token trả về qua luồng OAuth trên trình duyệt:
    1. Xác thực token và lấy thông tin cá nhân từ /me.
    2. Cập nhật hoặc thêm tài khoản vào bảng `accounts` theo `user_id`.
    3. Đổi token sang Long-lived token và quét toàn bộ Fanpage.
    4. UPSERT vào bảng `pages` kèm Page Token vĩnh viễn.
    """
    owner = get_current_owner(request)
    if not owner:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")

    raw_token = (body.access_token or "").strip()
    if not raw_token:
        raise HTTPException(status_code=400, detail="Vui lòng cung cấp Access Token.")

    try:
        me = fb_client.get_user_profile(raw_token)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=f"Không thể xác thực token với Facebook: {ex}")

    fb_uid = str(me.get("id"))
    fb_name = me.get("name") or f"Facebook User {fb_uid}"
    avatar_url = ""
    pic = me.get("picture")
    if isinstance(pic, dict) and "data" in pic:
        avatar_url = pic["data"].get("url") or ""

    long_lived_token = fb_client.exchange_token(raw_token)

    try:
        existing_acc = db.fetch_one("SELECT id FROM accounts WHERE uid = %s AND user_id = %s", (fb_uid, owner))
        if existing_acc:
            db.execute(
                "UPDATE accounts SET token = %s, profile_name = %s, status = 'active', avatar_url = CASE WHEN %s != '' THEN %s ELSE avatar_url END WHERE uid = %s AND user_id = %s",
                (long_lived_token, fb_name, avatar_url, avatar_url, fb_uid, owner)
            )
        else:
            db.execute(
                "INSERT INTO accounts (uid, profile_name, token, user_id, status, avatar_url) VALUES (%s, %s, %s, %s, 'active', %s)",
                (fb_uid, fb_name, long_lived_token, owner, avatar_url)
            )
    except Exception as acc_err:
        print(f"[Accounts Sync Warning] {acc_err}")

    try:
        pages = fb_client.fetch_managed_pages(long_lived_token)
    except Exception as ex:
        raise HTTPException(status_code=400, detail=f"Lỗi khi quét Fanpage: {ex}")

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
        db.execute(sql, (pid, pname, ptoken, pcat, fb_uid, owner))
        synced_count += 1

    return {
        "success": True,
        "count": synced_count,
        "facebook_user_id": fb_uid,
        "facebook_user_name": fb_name,
        "message": f"Đã đồng bộ {synced_count} Fanpage từ tài khoản '{fb_name}' kèm Token vĩnh viễn!",
        "pages": pages
    }


@router.post("/oauth-by-profile")
def oauth_by_profile(body: OAuthByProfileBody, request: Request):
    """
    Tự động cấp Token mới cho nick Clone qua Profile Chrome độc lập (Module 02):
    1. Khởi động Chrome với đúng profile và Proxy của clone đó.
    2. Truy cập URL Meta OAuth dialog trong nền (hoặc live).
    3. Tự động click chấp thuận hoặc bắt URL redirect sang login_success.html#access_token=...
    4. Trích xuất token mới, lưu vào bảng `accounts` và quét đồng bộ Fanpage.
    """
    owner = get_current_owner(request)
    if not owner:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")

    acc_uid = (body.account_uid or "").strip()
    if not acc_uid:
        raise HTTPException(status_code=400, detail="Vui lòng chọn tài khoản Facebook để cấp Token.")

    app_id = os.getenv("FACEBOOK_APP_ID", "").strip()
    if not app_id:
        raise HTTPException(
            status_code=400,
            detail="Chưa cấu hình FACEBOOK_APP_ID trong file .env. Vui lòng nhập App ID của Meta trước khi thực hiện OAuth."
        )
    api_ver = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v19.0").strip()

    acc = db.fetch_one(
        "SELECT uid, profile_name, proxy, cookie FROM accounts WHERE uid = %s AND user_id = %s",
        (acc_uid, owner)
    )
    if not acc:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy tài khoản UID {acc_uid} trong hệ thống của bạn.")

    from core.browser import get_profile_lock, open_browser, safe_close_driver

    profile_lock = get_profile_lock(acc_uid, owner)
    acquired = profile_lock.acquire(timeout=10)
    if not acquired:
        raise HTTPException(
            status_code=429,
            detail=f"Trình duyệt profile của nick {acc_uid} đang bận xử lý tác vụ khác. Vui lòng thử lại sau giây lát."
        )

    driver = None
    extracted_token = None
    try:
        driver = open_browser(
            uid=acc_uid,
            owner=owner,
            proxy=acc.get("proxy"),
            headless=body.headless,
            scope="oauth",
            allow_direct_fallback=True
        )

        redirect_uri = "https://www.facebook.com/connect/login_success.html"
        scope = "pages_show_list,pages_manage_posts,pages_read_engagement"
        oauth_url = (
            f"https://www.facebook.com/{api_ver}/dialog/oauth"
            f"?client_id={app_id}&redirect_uri={redirect_uri}&scope={scope}&response_type=token"
        )

        driver.get(oauth_url)

        start_time = time.time()
        while time.time() - start_time < 60:
            curr_url = driver.current_url or ""

            if "login_success.html" in curr_url and "access_token=" in curr_url:
                m = re.search(r"access_token=([^&]+)", curr_url)
                if m:
                    extracted_token = m.group(1)
                    break

            if "checkpoint" in curr_url:
                raise RuntimeError(f"Tài khoản {acc_uid} đang bị Facebook Checkpoint. Vui lòng mở trình duyệt kiểm tra lại tài khoản.")
            if "login.php" in curr_url:
                raise RuntimeError(f"Tài khoản {acc_uid} chưa đăng nhập trên profile Chrome hoặc phiên đăng nhập đã hết. Vui lòng đăng nhập lại trên trang Quản lý tài khoản.")

            # Tự động tìm và click nút 'Tiếp tục' / 'Continue' nếu Meta hiển thị hộp thoại xác nhận
            try:
                from selenium.webdriver.common.by import By
                consent_buttons = driver.find_elements(
                    By.XPATH,
                    "//button[contains(., 'Tiếp tục') or contains(., 'Continue') or contains(., 'Đồng ý') or contains(., 'Xác nhận')] | //div[@role='button'][contains(., 'Tiếp tục') or contains(., 'Continue')]"
                )
                for btn in consent_buttons:
                    if btn.is_displayed():
                        try:
                            btn.click()
                            break
                        except Exception:
                            driver.execute_script("arguments[0].click();", btn)
                            break
            except Exception:
                pass

            time.sleep(1.0)

        if not extracted_token:
            curr_url = driver.current_url or ""
            raise RuntimeError(f"Hết thời gian chờ phản hồi OAuth từ Facebook. URL dừng lại tại: {curr_url[:120]}")

    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Lỗi OAuth qua Chrome Profile: {str(exc)}")
    finally:
        if driver:
            safe_close_driver(driver)
        profile_lock.release()

    long_lived_token = fb_client.exchange_token(extracted_token)

    try:
        db.execute(
            "UPDATE accounts SET token = %s, status = 'active' WHERE uid = %s AND user_id = %s",
            (long_lived_token, acc_uid, owner)
        )
    except Exception as db_err:
        print(f"[OAuth Profile DB Update Warning] {db_err}")

    try:
        pages = fb_client.fetch_managed_pages(long_lived_token)
    except Exception as fetch_err:
        raise HTTPException(status_code=400, detail=f"Đã cấp token thành công nhưng lỗi khi quét Page: {fetch_err}")

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

    return {
        "success": True,
        "count": synced_count,
        "token": long_lived_token,
        "message": f"Đã cấp mới Token và nạp thành công {synced_count} Fanpage từ nick {acc_uid}!",
        "pages": pages
    }


@router.post("/tokens/verify")
def verify_tokens(body: VerifyTokensBody, request: Request):
    """
    Kiểm tra thực tế trạng thái sống/chết (Live Check) của User Token qua Meta Graph API.
    Gọi song song /me bằng ThreadPoolExecutor.
    """
    owner = get_current_owner(request)
    if not owner:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")

    target_uids = body.account_uids or []
    if target_uids:
        placeholders = ",".join(["%s"] * len(target_uids))
        query = f"SELECT uid, profile_name, token FROM accounts WHERE user_id = %s AND uid IN ({placeholders})"
        params = [owner] + [str(u).strip() for u in target_uids]
    else:
        query = "SELECT uid, profile_name, token FROM accounts WHERE user_id = %s"
        params = [owner]

    rows = db.fetch_all(query, tuple(params))
    results = {}

    def _check_single(uid: str, name: str, token: str):
        token_str = (token or "").strip()
        if not token_str:
            return uid, {"status": "NONE", "message": "Chưa có Token"}

        try:
            url = "https://graph.facebook.com/v20.0/me"
            resp = requests.get(
                url,
                params={"fields": "id,name", "access_token": token_str},
                timeout=7
            )
            data = resp.json()
            if resp.status_code == 200 and "id" in data:
                return uid, {
                    "status": "LIVE",
                    "meta_id": data.get("id"),
                    "meta_name": data.get("name"),
                    "message": "Token còn sống (LIVE)"
                }
            else:
                err = data.get("error", {})
                code = err.get("code")
                msg = err.get("message", "Token không hợp lệ hoặc đã hết hạn")
                return uid, {
                    "status": "EXPIRED",
                    "code": code,
                    "message": f"Hết hạn ({code}): {msg}"
                }
        except Exception as exc:
            return uid, {
                "status": "ERROR",
                "message": f"Lỗi kết nối Facebook: {str(exc)}"
            }

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [
            executor.submit(
                _check_single,
                str(r.get("uid") or "").strip(),
                r.get("profile_name") or "",
                r.get("token") or ""
            )
            for r in rows
            if str(r.get("uid") or "").strip()
        ]
        for f in as_completed(futures):
            try:
                uid, res = f.result()
                results[uid] = res
            except Exception:
                pass

    return {
        "success": True,
        "results": results,
        "checked_count": len(results)
    }
