"""API khớp hợp đồng web-admin nguồn: /api/v1/auth và /api/v1/admin."""
import asyncio
import json
import logging
import os
from queue import Empty
import time
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from modules.module_auth.security import ACCESS_TOKEN_MINUTES, REFRESH_TOKEN_DAYS
from modules.module_auth.security import decode_token

from modules.module_auth.hwid import get_hwid
from modules.module_auth.notification_events import subscribe, unsubscribe
from modules.module_auth.service import (
    admin_login,
    approve_user,
    ban_user,
    bearer_user,
    change_password,
    create_user_admin,
    create_registration_ticket,
    dashboard_stats,
    delete_notification,
    delete_notifications,
    delete_user_admin,
    edit_user_admin,
    extend_user,
    licensed_for_modules,
    list_activity,
    list_admins,
    list_notifications,
    list_users,
    login_user,
    logout_token,
    mark_all_notifications,
    mark_notification,
    public_user,
    claim_approved_session,
    pending_login_ticket,
    refresh_access_token,
    register_user,
    registration_status,
    reject_user,
    require_admin,
    reset_hwid,
    session_summary,
    unban_user,
    verify_license,
)

auth_router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])
admin_router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])


class RegisterBody(BaseModel):
    username: str
    password: str
    contact_info: str
    hwid: Optional[str] = None


class LicenseBody(BaseModel):
    username: str
    password: str
    hwid: Optional[str] = ""


class UserLoginBody(LicenseBody):
    remember_me: bool = True


class LoginBody(BaseModel):
    username: str = ""
    password: str = ""


class DaysBody(BaseModel):
    days: int


class ResetHwidBody(BaseModel):
    reason: Optional[str] = ""


class CreateUserBody(BaseModel):
    username: str
    password: str
    contact_info: Optional[str] = ""
    days: int = 30
    status: str = "approved"
    role: Optional[str] = "user"
    hwid: Optional[str] = None


class EditUserBody(BaseModel):
    username: Optional[str] = None
    contact_info: Optional[str] = None
    days: Optional[int] = None
    password: Optional[str] = None
    status: Optional[str] = None
    role: Optional[str] = None
    hwid: Optional[str] = None


class PasswordBody(BaseModel):
    old_password: str
    new_password: str
    username: Optional[str] = None


class BatchDeleteBody(BaseModel):
    ids: List[int]


def _token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Thiếu thông tin xác thực đăng nhập")
    return authorization[7:].strip()


def _secure_cookie() -> bool:
    return os.environ.get("COOKIE_SECURE", "").lower() in ("1", "true", "yes")


def set_auth_cookies(response: Response, access: str, refresh: str, remember_me: bool = True, admin_client: bool = False, user_client: bool = False) -> None:
    if not admin_client:
        response.delete_cookie("fb_registration", path="/api/v1/auth")
    secure = _secure_cookie()
    response.set_cookie(
        "fb_admin_access" if admin_client else "fb_user_access" if user_client else "fb_access",
        access,
        max_age=ACCESS_TOKEN_MINUTES * 60 if remember_me else None,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/api/v1/" if admin_client else "/",
    )
    response.set_cookie(
        "fb_admin_refresh" if admin_client else "fb_user_refresh" if user_client else "fb_refresh",
        refresh,
        max_age=REFRESH_TOKEN_DAYS * 24 * 60 * 60 if remember_me else None,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/api/v1/" if admin_client else "/api/v1/auth",
    )


def clear_auth_cookies(response: Response, admin_client: bool = False, user_client: bool = False) -> None:
    if admin_client:
        response.delete_cookie("fb_admin_access", path="/api/v1/")
        response.delete_cookie("fb_admin_refresh", path="/api/v1/")
        return
    if user_client:
        response.delete_cookie("fb_user_access", path="/")
        response.delete_cookie("fb_user_refresh", path="/api/v1/auth")
        response.delete_cookie("fb_registration", path="/api/v1/auth")
        return
    response.delete_cookie("fb_access", path="/")
    response.delete_cookie("fb_refresh", path="/api/v1/auth")
    response.delete_cookie("fb_registration", path="/api/v1/auth")


def set_registration_cookie(response: Response, ticket: str, user_client: bool = False):
    clear_auth_cookies(response, user_client=user_client)
    response.set_cookie("fb_registration", ticket, max_age=86400, httponly=True,
                        secure=_secure_cookie(), samesite="lax", path="/api/v1/auth")


@auth_router.get("/hwid")
def read_hwid():
    return {"hwid": get_hwid()}


@auth_router.post("/register", status_code=201)
def register(body: RegisterBody, request: Request, response: Response):
    hwid = get_hwid()
    data = register_user(body.username, body.password, body.contact_info, hwid)
    ticket = create_registration_ticket(body.username.strip(), data["user_id"], hwid)
    set_registration_cookie(response, ticket, user_client=request.headers.get("x-auth-client") == "user")
    # Body token cho Tauri (cookie cross-origin không tin cậy)
    data["registration_token"] = ticket
    return data


def _registration_tickets(request: Request, authorization: Optional[str] = None, body_token: Optional[str] = None):
    tickets = []
    if body_token:
        tickets.append(body_token.strip())
    header_ticket = (request.headers.get("x-registration-token") or "").strip()
    if header_ticket:
        tickets.append(header_ticket)
    if authorization and authorization.startswith("Bearer "):
        tickets.append(authorization[7:].strip())
    refresh_name = "fb_user_refresh" if request.headers.get("x-auth-client") == "user" else "fb_refresh"
    for name in (refresh_name, "fb_registration"):
        cookie = request.cookies.get(name)
        if cookie:
            tickets.append(cookie)
    # Giữ thứ tự, bỏ trùng
    seen = set()
    ordered = []
    for ticket in tickets:
        if ticket and ticket not in seen:
            seen.add(ticket)
            ordered.append(ticket)
    return ordered


@auth_router.get("/registration-status")
def read_registration_status(request: Request, authorization: Optional[str] = Header(None)):
    hwid = get_hwid()
    last_error = None
    for ticket in _registration_tickets(request, authorization):
        try:
            payload = decode_token(ticket)
            allow_refresh = payload.get("typ") == "refresh"
            return registration_status(ticket, hwid, allow_refresh=allow_refresh)
        except HTTPException as error:
            last_error = error
            if error.status_code != 401:
                raise
        except Exception:
            last_error = HTTPException(401, "Phiên kiểm tra đăng ký không hợp lệ.")
    if last_error:
        raise last_error
    raise HTTPException(401, "Phiên kiểm tra đăng ký đã hết hạn. Vui lòng đăng nhập lại.")


class ClaimApprovalBody(BaseModel):
    registration_token: Optional[str] = None
    remember_me: bool = True


@auth_router.post("/claim-approval")
def claim_approval(
    request: Request,
    response: Response,
    body: Optional[ClaimApprovalBody] = None,
    authorization: Optional[str] = Header(None),
):
    """User đã được admin duyệt — cấp session workspace ngay (không bắt login lại)."""
    payload = body or ClaimApprovalBody()
    hwid = get_hwid()
    tickets = _registration_tickets(request, authorization, payload.registration_token)
    if not tickets:
        raise HTTPException(401, "Phiên kiểm tra đăng ký đã hết hạn. Vui lòng đăng nhập lại.")
    last_error = None
    for ticket in tickets:
        try:
            data = claim_approved_session(ticket, hwid, request, payload.remember_me)
            set_auth_cookies(
                response,
                data["access_token"],
                data["refresh_token"],
                payload.remember_me,
                user_client=request.headers.get("x-auth-client") == "user",
            )
            return data
        except HTTPException as error:
            last_error = error
            if error.status_code not in (401,):
                raise
    raise last_error or HTTPException(401, "Phiên kiểm tra đăng ký đã hết hạn. Vui lòng đăng nhập lại.")


@auth_router.post("/verify-license")
def verify(body: LicenseBody, request: Request, response: Response):
    data = verify_license(body.username, body.password, body.hwid or "", request)
    # Giữ access_token/refresh_token trong body — Tauri WebView (tauri.localhost → 127.0.0.1)
    # không gửi được cookie SameSite=Lax cross-origin; FE dùng Bearer.
    set_auth_cookies(
        response,
        data["access_token"],
        data["refresh_token"],
        user_client=request.headers.get("x-auth-client") == "user",
    )
    return data


@auth_router.post("/login")
def login(body: UserLoginBody, request: Request, response: Response):
    hwid = get_hwid()
    try:
        data = login_user(body.username, body.password, hwid, request, body.remember_me)
    except HTTPException as error:
        if error.detail not in ("ACCOUNT_PENDING", "ACCOUNT_BANNED", "ACCOUNT_LOCKED", "ERR_HWID_MISMATCH"):
            raise
        ticket = pending_login_ticket(body.username, hwid)
        result = JSONResponse(
            status_code=error.status_code,
            content={"detail": error.detail, "registration_token": ticket},
        )
        set_registration_cookie(result, ticket, user_client=request.headers.get("x-auth-client") == "user")
        return result
    set_auth_cookies(
        response,
        data["access_token"],
        data["refresh_token"],
        body.remember_me,
        user_client=request.headers.get("x-auth-client") == "user",
    )
    return data


class RefreshBody(BaseModel):
    refresh_token: Optional[str] = None


@auth_router.post("/refresh")
def refresh(request: Request, response: Response, body: Optional[RefreshBody] = None):
    admin_client = request.headers.get("x-auth-client") == "admin"
    user_client = request.headers.get("x-auth-client") == "user"
    payload = body or RefreshBody()
    # Cookie (browser) hoặc body (Tauri desktop khi cookie cross-origin bị chặn)
    refresh_token = (
        (payload.refresh_token or "").strip()
        or (request.cookies.get("fb_user_refresh", "") if user_client else "")
        or (request.cookies.get("fb_admin_refresh") if admin_client else None)
        or request.cookies.get("fb_refresh", "")
        or ""
    )
    access = refresh_access_token(refresh_token)
    expected_user = request.headers.get("x-auth-user-id")
    if expected_user and str(decode_token(access).get("uid")) != expected_user:
        raise HTTPException(401, "SESSION_IDENTITY_CHANGED")
    if admin_client and decode_token(access).get("role") not in ("admin", "ADMIN"):
        raise HTTPException(403, "Chỉ admin mới được thao tác")
    remember_me = decode_token(refresh_token).get("remember_me", True)
    response.set_cookie(
        "fb_admin_access" if admin_client else "fb_user_access" if user_client else "fb_access",
        access,
        max_age=ACCESS_TOKEN_MINUTES * 60 if remember_me else None,
        httponly=True,
        secure=_secure_cookie(),
        samesite="lax",
        path="/api/v1/" if admin_client else "/",
    )
    return {"ok": True, "access_token": access, "refresh_token": refresh_token}


@auth_router.get("/me")
def me(request: Request, authorization: Optional[str] = Header(None)):
    user = bearer_user(authorization, request=request)
    payload = public_user(user)
    payload["modules_unlocked"] = licensed_for_modules(user)
    return payload


@auth_router.get("/user-sessions/{user_id}")
def user_sessions(user_id: int, authorization: Optional[str] = Header(None)):
    require_admin(authorization)
    return session_summary(user_id)


@auth_router.get("/my-sessions")
def my_sessions(request: Request, authorization: Optional[str] = Header(None)):
    user = bearer_user(authorization, request=request)
    return session_summary(user["id"])


@auth_router.post("/change-password")
def password(body: PasswordBody, request: Request, authorization: Optional[str] = Header(None)):
    user = bearer_user(authorization, require_session=False, request=request)
    target = body.username or user["username"]
    if target != user["username"] and user.get("role") not in ("admin", "ADMIN"):
        raise HTTPException(403, "Không có quyền đổi mật khẩu người khác")
    return change_password(target, body.old_password, body.new_password)


@auth_router.post("/logout")
def logout(request: Request, response: Response, authorization: Optional[str] = Header(None)):
    admin_client = request.headers.get("x-auth-client") == "admin"
    user_client = request.headers.get("x-auth-client") == "user"
    token = request.cookies.get("fb_admin_refresh" if admin_client else "fb_user_refresh" if user_client else "fb_refresh") or ""
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    if not token:
        token = request.cookies.get("fb_admin_access" if admin_client else "fb_user_access" if user_client else "fb_access") or ""
    if token:
        try:
            claims = decode_token(token)
        except Exception:
            claims = {}
        logging.getLogger("uvicorn.error").info(
            "Auth: explicit logout client=%s user_id=%s session_id=%s token_type=%s",
            "admin" if admin_client else "user", claims.get("uid"), claims.get("sid"), claims.get("typ"),
        )
        logout_token(token)
    clear_auth_cookies(response, admin_client=admin_client, user_client=user_client)
    return {"success": True, "message": "Đã đăng xuất"}


@admin_router.post("/login")
async def login_admin(request: Request, response: Response, username: str = "", password: str = "", remember_me: bool = True):
    if not username or not password:
        try:
            data = await request.json()
            username = username or data.get("username", "")
            password = password or data.get("password", "")
            if "remember_me" in data:
                if not isinstance(data["remember_me"], bool):
                    raise HTTPException(422, "remember_me phải là boolean")
                remember_me = data["remember_me"]
        except HTTPException:
            raise
        except Exception:
            pass
    data = admin_login(username, password, request, remember_me)
    access = data.pop("cookie_access", None)
    refresh = data.pop("cookie_refresh", None)
    if access and refresh:
        set_auth_cookies(response, access, refresh, remember_me, admin_client=True)
        # Cross-origin web-admin (Render) không nhận cookie API → cần refresh trong body
        data["refresh_token"] = refresh
    if request.headers.get("x-auth-client") == "browser":
        data.pop("access_token", None)
        data.pop("refresh_token", None)
    return data


@admin_router.get("/me")
def admin_me(authorization: Optional[str] = Header(None)):
    user = require_admin(authorization)
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user.get("role"),
        "contact_info": user.get("contact_info") or "",
        "status": user.get("status"),
        "created_at": str(user.get("created_at") or ""),
        "last_login_at": str(user.get("last_login_at") or ""),
        "last_login_ip": user.get("last_login_ip"),
    }


@admin_router.get("/stats")
def stats(authorization: Optional[str] = Header(None)):
    require_admin(authorization)
    return dashboard_stats()


@admin_router.get("/users")
def users(authorization: Optional[str] = Header(None), status_filter: str = ""):
    require_admin(authorization)
    return list_users(status_filter)


@admin_router.get("/admins")
def admins(authorization: Optional[str] = Header(None), status_filter: str = ""):
    require_admin(authorization)
    return list_admins(status_filter)


@admin_router.post("/users")
def create_user(body: CreateUserBody, request: Request):
    return create_user_admin(body.username, body.password, body.contact_info or "", body.days, body.status, body.role or "user", request, hwid=body.hwid)


@admin_router.put("/users/{user_id}")
def edit_user(user_id: int, body: EditUserBody, request: Request):
    return edit_user_admin(user_id, body.model_dump(exclude_none=True), request)


@admin_router.delete("/users/{user_id}")
def remove_user(user_id: int, request: Request):
    return delete_user_admin(user_id, request)


@admin_router.put("/users/{user_id}/approve")
def approve(user_id: int, body: DaysBody, request: Request):
    return approve_user(user_id, body.days, request)


@admin_router.put("/users/{user_id}/extend")
def extend(user_id: int, body: DaysBody, request: Request):
    return extend_user(user_id, body.days, request)


@admin_router.put("/users/{user_id}/ban")
def ban(user_id: int, request: Request):
    return ban_user(user_id, request)


@admin_router.put("/users/{user_id}/unban")
def unban(user_id: int, request: Request):
    return unban_user(user_id, request)


@admin_router.put("/users/{user_id}/reject")
def reject(user_id: int, request: Request):
    return reject_user(user_id, request)


@admin_router.delete("/users/{user_id}/hwid")
async def hwid_reset(user_id: int, request: Request):
    reason = ""
    try:
        data = await request.json()
        reason = (data or {}).get("reason") or ""
    except Exception:
        pass
    return reset_hwid(user_id, reason, request)


@admin_router.get("/notifications/stream")
async def notification_stream(request: Request):
    """Cookie-authenticated SSE; registration events are sent only after commit."""
    def validate_stream_user():
        refresh = request.cookies.get("fb_admin_refresh")
        authorization = request.headers.get("authorization")
        if refresh and not authorization:
            authorization = f"Bearer {refresh_access_token(refresh)}"
        elif request.cookies.get("fb_admin_access") and not authorization:
            authorization = f"Bearer {request.cookies['fb_admin_access']}"
        user = bearer_user(authorization, request=request)
        if user.get("role") not in ("admin", "ADMIN"):
            raise HTTPException(403, "Chỉ admin mới được thao tác")

    await asyncio.to_thread(validate_stream_user)

    async def events():
        queue = subscribe()
        heartbeat_at = time.monotonic()
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while not await request.is_disconnected():
                if time.monotonic() - heartbeat_at >= 25:
                    try:
                        await asyncio.to_thread(validate_stream_user)
                    except HTTPException:
                        break
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                    heartbeat_at = time.monotonic()
                try:
                    yield f"data: {json.dumps(queue.get_nowait())}\n\n"
                except Empty:
                    await asyncio.sleep(0.5)
        finally:
            unsubscribe(queue)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@admin_router.get("/notifications")
def notifications(authorization: Optional[str] = Header(None), unread_only: bool = False, target: str = "admin"):
    require_admin(authorization)
    return list_notifications(unread_only, target)


@admin_router.put("/notifications/{notif_id}/read")
def read_notification(notif_id: int, authorization: Optional[str] = Header(None)):
    require_admin(authorization)
    return mark_notification(notif_id)


@admin_router.put("/notifications/read-all")
def read_all(authorization: Optional[str] = Header(None)):
    require_admin(authorization)
    return mark_all_notifications()


@admin_router.delete("/notifications/{notif_id}")
def remove_notification(notif_id: int, authorization: Optional[str] = Header(None)):
    require_admin(authorization)
    return delete_notification(notif_id)


@admin_router.post("/notifications/batch-delete")
def remove_notifications(body: BatchDeleteBody, authorization: Optional[str] = Header(None)):
    require_admin(authorization)
    return delete_notifications(body.ids)


@admin_router.get("/activity-logs")
def activity(authorization: Optional[str] = Header(None), limit: int = Query(200)):
    require_admin(authorization)
    return list_activity(limit)


def assert_module_access(authorization: Optional[str]):
    user = bearer_user(authorization)
    if not licensed_for_modules(user):
        raise HTTPException(403, "LICENSE_REQUIRED")
    return user


def assert_request_module_access(authorization: Optional[str], path: str, method: str):
    # Dashboard summaries stay readable; their routers still enforce owner scope.
    if method == "GET" and path in {"/api/accounts/stats", "/api/creator/pages/history"}:
        return bearer_user(authorization)
    return assert_module_access(authorization)
