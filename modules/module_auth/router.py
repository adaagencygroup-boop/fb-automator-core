"""API khớp hợp đồng web-admin nguồn: /api/v1/auth và /api/v1/admin."""
import asyncio
import json
import os
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from modules.module_auth.security import ACCESS_TOKEN_MINUTES, REFRESH_TOKEN_DAYS

from modules.module_auth.hwid import get_hwid
from modules.module_auth.service import (
    admin_login,
    approve_user,
    ban_user,
    bearer_user,
    change_password,
    create_user_admin,
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
    logout_token,
    mark_all_notifications,
    mark_notification,
    public_user,
    refresh_access_token,
    register_user,
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


class EditUserBody(BaseModel):
    username: Optional[str] = None
    contact_info: Optional[str] = None
    days: Optional[int] = None
    password: Optional[str] = None
    status: Optional[str] = None
    role: Optional[str] = None


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


def set_auth_cookies(response: Response, access: str, refresh: str) -> None:
    secure = _secure_cookie()
    response.set_cookie(
        "fb_access",
        access,
        max_age=ACCESS_TOKEN_MINUTES * 60,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        "fb_refresh",
        refresh,
        max_age=REFRESH_TOKEN_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/api/v1/auth",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("fb_access", path="/")
    response.delete_cookie("fb_refresh", path="/api/v1/auth")


@auth_router.get("/hwid")
def read_hwid():
    return {"hwid": get_hwid()}


@auth_router.post("/register", status_code=201)
def register(body: RegisterBody):
    return register_user(body.username, body.password, body.contact_info, body.hwid)


@auth_router.post("/verify-license")
def verify(body: LicenseBody, request: Request, response: Response):
    data = verify_license(body.username, body.password, body.hwid or "", request)
    set_auth_cookies(response, data.pop("access_token"), data.pop("refresh_token"))
    return data


@auth_router.post("/refresh")
def refresh(request: Request, response: Response):
    access = refresh_access_token(request.cookies.get("fb_refresh", ""))
    response.set_cookie(
        "fb_access",
        access,
        max_age=ACCESS_TOKEN_MINUTES * 60,
        httponly=True,
        secure=_secure_cookie(),
        samesite="lax",
        path="/",
    )
    return {"ok": True}


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
    token = request.cookies.get("fb_refresh") or ""
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    if not token:
        token = request.cookies.get("fb_access") or ""
    if token:
        logout_token(token)
    clear_auth_cookies(response)
    return {"success": True, "message": "Đã đăng xuất"}


@admin_router.post("/login")
async def login_admin(request: Request, response: Response, username: str = "", password: str = ""):
    if not username or not password:
        try:
            data = await request.json()
            username = username or data.get("username", "")
            password = password or data.get("password", "")
        except Exception:
            pass
    data = admin_login(username, password, request)
    access = data.pop("cookie_access", None)
    refresh = data.pop("cookie_refresh", None)
    if access and refresh:
        set_auth_cookies(response, access, refresh)
    if request.headers.get("x-auth-client") == "browser":
        data.pop("access_token", None)
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
    return create_user_admin(body.username, body.password, body.contact_info or "", body.days, body.status, body.role or "user", request)


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
async def notification_stream():
    """EventSource của web-admin không gửi Bearer. Giữ kết nối và báo connected."""

    async def events():
        yield f"data: {json.dumps({'type': 'connected'})}\n\n"
        while True:
            await asyncio.sleep(25)
            yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"

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
