# -*- coding: utf-8 -*-
"""
File: modules/module_05_page_manager/routes_pages.py
FastAPI router cho tính năng Quản lý Danh sách Fanpage (Module 05).
Chuẩn hóa đọc và ghi trực tiếp từ bảng `pages` của hệ thống (kết hợp bảng `accounts`),
áp dụng phân quyền chặt chẽ theo `user_id` của phiên đăng nhập hiện tại.
"""
import time
from typing import Optional, List, Dict, Any, Literal
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Depends, Request
from . import meta_sync
from . import meta_web
from .meta_config import GRAPH_API_VERSION, REQUIRED_SCOPES, credentials, callback_url

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
    access_token: str = ""
    account_uid: str = ""
    state: str = ""
    error: str = ""


class OAuthByProfileBody(BaseModel):
    account_uid: str
    headless: bool = False


class VerifyTokensBody(BaseModel):
    account_uids: Optional[List[str]] = None


@router.get("/accounts")
def list_sync_accounts(request: Request):
    owner = require_owner(request)
    rows = db.fetch_all("""SELECT uid, profile_name, avatar_url, status, status_checked_at, login_status,
        (token IS NOT NULL AND trim(token) <> '') AS has_token
        FROM accounts WHERE user_id = %s ORDER BY id DESC""", (owner,))
    return {"accounts": [{
        "uid": row["uid"], "profile_name": row.get("profile_name") or "",
        "avatar_url": row.get("avatar_url") or "", "has_token": bool(row.get("has_token")),
        "status": (row.get("status") or "").lower() if row.get("status_checked_at") else None,
        "login_status": {"LOGGED_IN": "logged_in", "ERROR": "failed"}.get(row.get("login_status"), "not_logged_in"),
    } for row in rows]}


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
            "SELECT id, page_id, page_name, category, status, account_uid, reels_folder, created_at, token_metadata, web_connection_id, tiktok_keyword, tiktok_url, youtube_keyword, youtube_url FROM pages WHERE user_id = %s ORDER BY id DESC",
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

    web_map = {str(row["id"]): row for row in db.fetch_all(
        "SELECT id, facebook_name FROM meta_web_connections WHERE user_id = %s", (owner,)
    )}
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

            web_info = web_map.get(str(r.get("web_connection_id")))
            acc_info = acc_map.get(uid, {})
            mgr_name = acc_info.get("profile_name") or (f"Tài khoản {uid}" if uid else "Chưa gán")
            mgr_avatar = acc_info.get("avatar_url") or (f"https://graph.facebook.com/{uid}/picture?type=square&width=80&height=80" if uid else "")

            if web_info:
                mgr_name = web_info["facebook_name"]
                mgr_avatar = ""
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
                "manager_kind": "web" if web_info else "account",
                "web_connection_id": r.get("web_connection_id"),
                "manager_name": mgr_name,
                "manager_avatar_url": mgr_avatar,
                "reels_folder": r.get("reels_folder") or "",
                "created_at": str(r.get("created_at") or ""),
                "token_metadata": r.get("token_metadata") or {},
                "tiktok_keyword": r.get("tiktok_keyword") or "",
                "tiktok_url": r.get("tiktok_url") or "",
                "youtube_keyword": r.get("youtube_keyword") or "",
                "youtube_url": r.get("youtube_url") or ""
            })

        return {"pages": pages}
    except Exception as e:
        return {"pages": [], "error": str(e)}


def require_owner(request):
    owner = get_current_owner(request)
    if not owner:
        raise HTTPException(401, "Phiên đăng nhập không hợp lệ.")
    return owner


def _web_call(fn, owner, *args):
    try:
        return fn(owner, *args)
    except KeyError:
        raise HTTPException(404, "Không tìm thấy tác vụ OAuth của bạn; engine có thể đã khởi động lại.") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except Exception:
        raise HTTPException(500, "Không thể xử lý kết nối Facebook. Kết nối cũ được giữ nguyên.") from None


class WebOAuthStartBody(BaseModel):
    reason: Literal["connect", "switch"] = "connect"
    open_browser: bool = False


class WebOAuthCompleteBody(BaseModel):
    state: str
    access_token: str = ""
    error: str = ""


@router.post("/web-oauth/start", status_code=202)
def web_oauth_start(body: WebOAuthStartBody, request: Request):
    res = _web_call(meta_web.start, require_owner(request), body.reason)
    if body.open_browser and isinstance(res, dict) and res.get("authorization_url"):
        import webbrowser
        try:
            webbrowser.open(res["authorization_url"])
        except Exception:
            pass
    return res


@router.post("/web-oauth/complete", status_code=202)
def web_oauth_complete(body: WebOAuthCompleteBody, request: Request):
    return _web_call(meta_web.complete, require_owner(request), body.state, body.access_token, body.error)


@router.post("/web-oauth/{job_id}/cancel")
def web_oauth_cancel(job_id: str, request: Request):
    return _web_call(meta_web.cancel, require_owner(request), job_id)


@router.get("/web-connection")
def web_connection_status(request: Request):
    return _web_call(meta_web.connection_status, require_owner(request))


@router.post("/web-connection/sync", status_code=202)
def web_connection_sync(request: Request):
    return _web_call(meta_web.resync, require_owner(request))


def start_sync(owner, uid, token):
    try:
        meta_sync.account(owner, uid)
        credentials()
        if not token:
            raise ValueError("Account chưa có token; hãy kết nối OAuth hoặc nhập User Token.")
        return meta_sync.submit(owner, uid, meta_sync.sync_task(owner, uid, token))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post("/sync-by-account", status_code=202)
def sync_by_account(body: SyncByAccountBody, request: Request):
    owner = require_owner(request)
    try:
        acc = meta_sync.account(owner, body.account_uid.strip())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return start_sync(owner, body.account_uid.strip(), (body.custom_token or acc.get("token") or "").strip())


@router.delete("/{page_identifier}")
def delete_managed_page(page_identifier: str, request: Request):
    """
    Xóa Fanpage khỏi bảng `pages`, có ràng buộc chặt chẽ theo `user_id` của người dùng hiện tại.
    """
    if page_identifier in ("all-videos", "bulk-keywords", "managed", "oauth-config", "check-folder"):
      raise HTTPException(status_code=404, detail="Không Tìm Thấy Trang")
    owner = get_current_owner(request)
    if not owner:
      raise HTTPException(status_code=401, detail="Phiên Đăng Nhập Không Hợp Lệ.")

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
        raise HTTPException(status_code=400, detail="Không thể xóa Fanpage trong DB.")


@router.get("/oauth-config")
def get_oauth_config():
    try:
        app_id, _ = credentials()
        redirect = callback_url()
        return {"configured": True, "app_id": app_id, "api_version": GRAPH_API_VERSION,
                "callback_url": redirect, "scopes": sorted(REQUIRED_SCOPES)}
    except ValueError as exc:
        return {"configured": False, "message": str(exc)}


class OAuthStartBody(BaseModel):
    account_uid: str


@router.post("/oauth-start")
def oauth_start(body: OAuthStartBody, request: Request):
    try:
        return meta_sync.create_state(require_owner(request), body.account_uid.strip(), "web")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post("/sync-by-token", status_code=202)
def sync_by_token(body: SyncByTokenBody, request: Request):
    owner = require_owner(request)
    uid = body.account_uid.strip()
    if body.state:
        try:
            uid = meta_sync.consume_state(body.state, owner, "web")
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        if body.error:
            raise HTTPException(400, "Người dùng đã hủy hoặc từ chối quyền OAuth.")
    elif body.error:
        raise HTTPException(400, "OAuth state không hợp lệ.")
    return start_sync(owner, uid, body.access_token.strip())


@router.post("/oauth-by-profile", status_code=202)
def oauth_by_profile(body: OAuthByProfileBody, request: Request):
    owner, uid = require_owner(request), body.account_uid.strip()
    try:
        credentials()
        callback_url()
        return meta_sync.submit(owner, uid, meta_sync.profile_task(owner, uid, body.headless))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.get("/sync-jobs/{job_id}")
def sync_job_status(job_id: str, request: Request):
    try:
        return meta_sync.status(require_owner(request), job_id)
    except KeyError:
        raise HTTPException(404, "Không tìm thấy job của bạn.") from None


class ConfirmBody(BaseModel):
    accept: bool


@router.post("/sync-jobs/{job_id}/confirm", status_code=202)
def confirm_sync(job_id: str, body: ConfirmBody, request: Request):
    try:
        return meta_sync.confirm(require_owner(request), job_id, body.accept)
    except KeyError:
        raise HTTPException(404, "Không tìm thấy job của bạn.") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post("/tokens/verify")
def verify_tokens(body: VerifyTokensBody, request: Request):
    """
    Kiểm tra thực tế trạng thái sống/chết (Live Check) của User Token qua Meta Graph API.
    Gọi song song /me bằng ThreadPoolExecutor.
    Hỗ trợ phân tán tải qua Proxy của từng nick (nếu có) kèm fallback an toàn sang IP trực tiếp,
    và phân loại chính xác mã lỗi Rate Limit của Meta (4, 17, 32, 341, 613).
    """
    owner = get_current_owner(request)
    if not owner:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")

    target_uids = body.account_uids or []
    if target_uids:
        placeholders = ",".join(["%s"] * len(target_uids))
        query = f"SELECT uid, profile_name, token, proxy FROM accounts WHERE user_id = %s AND uid IN ({placeholders})"
        params = [owner] + [str(u).strip() for u in target_uids]
    else:
        query = "SELECT uid, profile_name, token, proxy FROM accounts WHERE user_id = %s"
        params = [owner]

    rows = db.fetch_all(query, tuple(params))
    results = {}

    from core.network.proxy_manager import proxy_manager

    def _check_single(uid: str, name: str, token: str, proxy_str: Optional[str] = None):
        token_str = (token or "").strip()
        if not token_str:
            return uid, {"status": "NONE", "message": "Chưa có Token"}

        url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/me"
        params = {"fields": "id,name", "access_token": token_str}
        proxies = proxy_manager.parse_proxy(proxy_str) if proxy_str else None

        resp = None
        used_proxy_fallback = False

        # 1. Thử gọi qua Proxy của nick (timeout ngắn 4s)
        if proxies:
            try:
                resp = requests.get(url, params=params, proxies=proxies, timeout=4)
            except Exception:
                # Proxy lỗi hoặc timeout -> Tự động Fallback sang IP trực tiếp
                used_proxy_fallback = True

        # 2. Nếu không có proxy hoặc proxy bị lỗi -> Fallback gọi IP trực tiếp (timeout 4s)
        if resp is None:
            try:
                resp = requests.get(url, params=params, timeout=4)
            except Exception as direct_err:
                msg = "Không kết nối được Facebook."
                if used_proxy_fallback:
                    msg += " (Proxy nick lỗi, đã thử trực tiếp nhưng thất bại)"
                return uid, {
                    "status": "ERROR",
                    "message": msg,
                    "proxy_failed": used_proxy_fallback
                }

        try:
            data = resp.json()
            if resp.status_code == 200 and "id" in data:
                try:
                    metadata = fb_client.inspect_token(token_str)
                except ValueError as exc:
                    return uid, {"status": "ERROR", "message": str(exc), "checked_at": time.time()}
                except Exception:
                    return uid, {"status": "ERROR", "message": "Không thể xác thực App ID, quyền và thời hạn với Meta.", "checked_at": time.time()}
                res_payload = {
                    "status": "LIVE",
                    "meta_id": data.get("id"),
                    "meta_name": data.get("name"),
                    "message": "Token còn sống (LIVE)",
                    "checked_at": time.time()
                }
                res_payload["token_metadata"] = metadata
                if used_proxy_fallback:
                    res_payload["proxy_fallback"] = True
                    res_payload["message"] += " (Proxy lỗi, đã chuyển IP trực tiếp)"
                return uid, res_payload
            else:
                err = data.get("error", {})
                code = err.get("code")
                msg = "Meta từ chối token hoặc quyền truy cập"

                # Phân loại mã lỗi Rate Limit của Meta (4, 17, 32, 341, 613)
                if code in (4, 17, 32, 341, 613):
                    return uid, {
                        "status": "RATE_LIMITED",
                        "code": code,
                        "message": f"Meta Rate Limit ({code}): {msg}",
                        "checked_at": time.time()
                    }
                elif code in (190, 102):
                    return uid, {
                        "status": "EXPIRED",
                        "code": code,
                        "message": f"Hết hạn ({code}): {msg}",
                        "checked_at": time.time()
                    }
                else:
                    return uid, {
                        "status": "ERROR",
                        "code": code,
                        "message": f"Lỗi Meta ({code}): {msg}",
                        "checked_at": time.time()
                    }
        except Exception as exc:
            return uid, {
                "status": "ERROR",
                "message": "Phản hồi Facebook không hợp lệ."
            }

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [
            executor.submit(
                _check_single,
                str(r.get("uid") or "").strip(),
                r.get("profile_name") or "",
                r.get("token") or "",
                r.get("proxy") or ""
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
