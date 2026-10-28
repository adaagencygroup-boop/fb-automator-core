"""Luồng user/admin giống vps-license-server: pending -> duyệt hạn -> login + HWID -> thu hồi phiên."""
import logging
import math
import os
import re
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, Request
from psycopg2.errors import UniqueViolation

from core.database.connection import db
from modules.module_auth.notification_events import publish
from modules.module_auth.security import (
    ACCESS_TOKEN_MINUTES,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    token_fingerprint,
    verify_password,
)

LOCKED_STATUSES = ("banned", "locked", "rejected")


def utcnow():
    return datetime.utcnow()


def admin_username() -> str:
    return os.environ.get("ADMIN_USERNAME", "admin")


def admin_password() -> str:
    return os.environ.get("ADMIN_PASSWORD", "Admin@123456")


def _row(username: str):
    return db.fetch_one("SELECT * FROM users WHERE username = ?", (username,))


def _row_by_id(user_id: int):
    return db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))


def _as_dt(value):
    if value is None or isinstance(value, datetime):
        return value
    text = str(value).replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:26], fmt)
        except ValueError:
            continue
    return None


def days_remaining(expired_at, now=None) -> int:
    expired = _as_dt(expired_at)
    if not expired:
        return 0
    now = now or utcnow()
    total_seconds = (expired - now).total_seconds()
    if total_seconds <= 0:
        return 0
    return max(1, math.ceil(total_seconds / 86400))


def detect_device(user_agent: str):
    ua = (user_agent or "").lower()
    os_name = "Unknown"
    if "windows" in ua:
        os_name = "Windows"
    elif "mac os" in ua or "macos" in ua:
        os_name = "macOS"
    elif "iphone" in ua or "ipad" in ua:
        os_name = "iOS"
    elif "android" in ua:
        os_name = "Android"
    elif "linux" in ua:
        os_name = "Linux"
    browser = "Unknown"
    if "edg/" in ua or "edge/" in ua:
        browser = "Edge"
    elif "chrome/" in ua and "safari/" in ua:
        browser = "Chrome"
    elif "firefox/" in ua:
        browser = "Firefox"
    elif "safari/" in ua and "chrome/" not in ua:
        browser = "Safari"
    device = "Desktop"
    if any(token in ua for token in ("mobile", "android", "iphone", "ipad")):
        device = "Tablet" if ("tablet" in ua or "ipad" in ua) else "Mobile"
    return device, browser, os_name


def _client_ip(request: Optional[Request]):
    if request and request.client:
        return request.client.host
    return None


def notify(user_id, ntype, target, message):
    db.execute(
        """INSERT INTO system_notifications (user_id, type, target, message, is_read, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (user_id, ntype, target, message, False, utcnow()),
    )


def log_activity(admin_name, admin_role, action_type, target_username=None, target_uid=None,
                 target_role=None, change_detail=None, ip_address=None, user_agent=None, note=None):
    db.execute(
        """INSERT INTO admin_activity_logs
           (admin_username, admin_role, action_type, target_username, target_uid, target_role,
            change_detail, result, ip_address, user_agent, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'success', ?, ?, ?, ?)""",
        (admin_name, admin_role, action_type, target_username, target_uid, target_role,
         change_detail, ip_address, user_agent, note, utcnow()),
    )


def revoke_active_sessions(user_id: int, at=None) -> None:
    db.execute(
        """UPDATE user_sessions
           SET is_active = ?, logout_at = ?, last_active_at = ?
           WHERE user_id = ? AND is_active = ?""",
        (False, at or utcnow(), at or utcnow(), user_id, True),
    )


def _open_session(user, request: Optional[Request], token: str):
    now = utcnow()
    revoke_active_sessions(user["id"], now)
    logging.getLogger("uvicorn.error").info("Auth: previous sessions revoked on login user_id=%s", user["id"])
    ua = request.headers.get("user-agent", "") if request else ""
    device, browser, os_name = detect_device(ua)
    ip_address = _client_ip(request)
    row = db.fetch_one(
        """INSERT INTO user_sessions
           (user_id, ip_address, device_type, user_agent, browser, os, login_at, last_active_at, is_active, token_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id""",
        (user["id"], ip_address, device, ua, browser, os_name, now, now, True, token_fingerprint(token)),
    )
    db.execute(
        "UPDATE users SET last_login_at = ?, last_login_ip = ?, last_login = ? WHERE id = ?",
        (now, ip_address, now, user["id"]),
    )
    return row["id"], ip_address, device, browser, os_name


def issue_browser_tokens(user, request: Optional[Request], remember_me: bool = True):
    """Cấp access + refresh; refresh gắn session DB để gia hạn khi access hết hạn."""
    refresh = create_refresh_token({"sub": user["username"], "role": user.get("role"), "uid": user["id"], "remember_me": remember_me})
    session_id, ip_address, device, browser, os_name = _open_session(user, request, refresh)
    access = create_access_token(
        {
            "sub": user["username"],
            "role": user.get("role"),
            "uid": user["id"],
            "sid": session_id,
            "typ": "access",
        },
        expires_delta=timedelta(minutes=ACCESS_TOKEN_MINUTES),
    )
    return access, refresh, ip_address, device, browser, os_name


def session_is_active(user, token: str) -> bool:
    if user.get("status") in LOCKED_STATUSES:
        return False
    try:
        payload = decode_token(token)
    except Exception:
        return False
    sid = payload.get("sid")
    if sid:
        row = db.fetch_one(
            "SELECT id FROM user_sessions WHERE id = ? AND user_id = ? AND is_active = ?",
            (sid, user["id"], True),
        )
        return row is not None
    return False


def public_user(user, now=None):
    now = now or utcnow()
    expired = _as_dt(user.get("expired_at"))
    return {
        "id": user["id"],
        "username": user["username"],
        "contact_info": user.get("contact_info") or "",
        "hwid": user.get("hwid"),
        "role": user.get("role"),
        "status": user.get("status"),
        "expired_at": expired.isoformat() + "Z" if expired else None,
        "days_remaining": days_remaining(expired, now),
        "created_at": str(user.get("created_at") or ""),
        "last_login_at": str(user.get("last_login_at") or user.get("last_login") or ""),
        "last_login_ip": user.get("last_login_ip"),
        "last_hwid_reset_at": str(user.get("last_hwid_reset_at") or ""),
    }


def validate_username(username: str):
    trimmed = (username or "").strip()
    if not trimmed:
        raise HTTPException(400, "Vui lòng nhập tên đăng nhập.")
    if len(username) > 25:
        raise HTTPException(400, "Tên đăng nhập không được vượt quá 25 ký tự.")
    if not re.search(r"[a-zA-Z0-9]", username):
        raise HTTPException(400, "Tên đăng nhập phải chứa chữ cái hoặc chữ số.")
    if re.search(r"[^a-zA-Z0-9]", username):
        raise HTTPException(400, "Tên đăng nhập không được chứa ký tự đặc biệt.")
    if not re.match(r"^[a-zA-Z]", username):
        raise HTTPException(400, "Tên đăng nhập phải bắt đầu bằng chữ cái.")
    if len(trimmed) < 3:
        raise HTTPException(400, "Tên đăng nhập phải có tối thiểu 3 ký tự.")
    return trimmed


def validate_password(password: str):
    validate_registration_password(password)


def validate_phone(contact: str) -> str:
    trimmed = (contact or "").strip()
    if not trimmed:
        raise HTTPException(400, "Vui lòng nhập số điện thoại liên hệ.")
    if not re.match(r"^[0-9]+$", trimmed):
        raise HTTPException(400, "Số điện thoại chỉ được chứa các chữ số.")
    if len(trimmed) > 10:
        raise HTTPException(400, "Số điện thoại không được vượt quá 10 chữ số.")
    if not trimmed.startswith("0"):
        raise HTTPException(400, "Số điện thoại phải bắt đầu bằng số 0.")
    if len(trimmed) < 10:
        raise HTTPException(400, "Số điện thoại phải có đủ 10 chữ số.")
    return trimmed


def validate_registration_password(password: str):
    if not password or not password.strip():
        raise HTTPException(400, "Mật khẩu không được để trống hoặc chỉ chứa khoảng trắng.")
    if len(password) > 12:
        raise HTTPException(400, "Mật khẩu không được vượt quá 12 ký tự.")
    if len(password) < 8 or not all(re.search(pattern, password) for pattern in (r"[A-Z]", r"[a-z]", r"[0-9]", r"[^a-zA-Z0-9]")):
        raise HTTPException(400, "Mật khẩu phải từ 8 đến 12 ký tự, bao gồm ít nhất 1 chữ hoa, 1 chữ thường, 1 chữ số và 1 ký tự đặc biệt.")


def register_user(username, password, contact_info, hwid):
    username = validate_username(username)
    validate_registration_password(password)
    contact = validate_phone(contact_info)
    if _row(username):
        raise HTTPException(409, "Tên đăng nhập đã tồn tại trên hệ thống")
    if not hwid:
        raise HTTPException(503, "Không nhận diện được mã máy (HWID). Vui lòng thử lại.")
    created_at = utcnow()
    message = f"Người dùng mới đăng ký: {username} | Liên hệ: {contact}"
    password_hash = hash_password(password)
    try:
        with db.session() as cursor:
            cursor.execute(
                """INSERT INTO users (username, password_hash, contact_info, hwid, role, status, created_at)
                   VALUES (%s, %s, %s, %s, 'user', 'pending', %s) RETURNING id""",
                (username, password_hash, contact, hwid, created_at),
            )
            user_id = cursor.fetchone()["id"]
            cursor.execute(
                """INSERT INTO system_notifications (user_id, type, target, message, is_read, created_at)
                   VALUES (%s, 'NEW_REGISTRATION', 'admin', %s, FALSE, %s) RETURNING id""",
                (user_id, message, created_at),
            )
            notification_id = cursor.fetchone()["id"]
    except UniqueViolation as error:
        raise HTTPException(409, "Tên đăng nhập đã tồn tại trên hệ thống") from error
    publish({"type": "NEW_REGISTRATION", "id": notification_id, "user_id": user_id,
             "username": username, "message": message, "created_at": created_at.isoformat()})
    return {"message": "Registration successful. Please wait for admin approval.", "user_id": user_id, "status": "pending"}


def create_registration_ticket(username, user_id, hwid):
    """A status-only capability; never a workspace or refresh credential."""
    return create_access_token({"sub": username, "uid": user_id, "hwid": hwid, "typ": "registration"}, expires_delta=timedelta(days=1))


def registration_status(ticket, hwid, allow_refresh=False):
    try:
        payload = decode_token(ticket)
    except Exception as error:
        raise HTTPException(401, "Phiên kiểm tra đăng ký đã hết hạn. Vui lòng đăng nhập lại.") from error
    is_registration = payload.get("typ") == "registration"
    is_refresh = allow_refresh and payload.get("typ") == "refresh"
    if not (is_registration or is_refresh) or (is_registration and payload.get("hwid") != hwid):
        raise HTTPException(401, "Phiên kiểm tra đăng ký không hợp lệ.")
    user = _row_by_id(payload.get("uid"))
    if not user or user.get("username") != payload.get("sub"):
        raise HTTPException(401, "Phiên kiểm tra đăng ký không hợp lệ.")
    data = {"username": user["username"], "status": user.get("status")}
    if user.get("hwid") and user["hwid"] != hwid:
        data["hwid_mismatch"] = True
    return data


def pending_login_ticket(username, hwid):
    user = _row(username.strip())
    return create_registration_ticket(user["username"], user["id"], hwid)


def _refresh_expiry(user):
    now = utcnow()
    expired = _as_dt(user.get("expired_at"))
    status = user.get("status")
    if expired and now > expired and status != "expired":
        db.execute("UPDATE users SET status = 'expired' WHERE id = ?", (user["id"],))
        user["status"] = "expired"
    elif status == "expired" and expired and now <= expired:
        db.execute("UPDATE users SET status = 'approved' WHERE id = ?", (user["id"],))
        user["status"] = "approved"
    return user


def verify_license(username, password, hwid, request: Optional[Request], remember_me: bool = True):
    user = _row(username)
    if not user or not verify_password(password, user.get("password_hash")):
        if not user:
            raise HTTPException(401, "ACCOUNT_NOT_FOUND")
        raise HTTPException(401, "INVALID_PASSWORD")
    if user.get("status") == "pending":
        raise HTTPException(403, "ACCOUNT_PENDING")
    if user.get("status") in ("rejected", "banned", "locked"):
        raise HTTPException(403, f"ACCOUNT_{str(user.get('status')).upper()}")
    user = _refresh_expiry(user)
    if user.get("hwid") and user["hwid"] != hwid:
        raise HTTPException(403, "ERR_HWID_MISMATCH")
    if not user.get("hwid") and hwid:
        db.execute("UPDATE users SET hwid = ? WHERE id = ?", (hwid, user["id"]))
        user["hwid"] = hwid
    now = utcnow()
    is_expired = user.get("status") == "expired"
    access, refresh, _ip, _device, _browser, _os_name = issue_browser_tokens(user, request, remember_me)
    expired = _as_dt(user.get("expired_at"))
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "days_remaining": 0 if is_expired else days_remaining(expired, now),
        "expired_at": expired.isoformat() + "Z" if expired else None,
        "username": user["username"],
        "user_id": user["id"],
        "role": user.get("role"),
        "status": user.get("status"),
        "contact_info": user.get("contact_info"),
    }


def login_user(username, password, hwid, request: Optional[Request], remember_me: bool = True):
    """Đăng nhập user/admin bằng một yêu cầu, giữ cookie HttpOnly của engine."""
    username = (username or "").strip()
    if not username:
        raise HTTPException(400, "Vui lòng nhập tên đăng nhập.")
    if not password:
        raise HTTPException(400, "Vui lòng nhập mật khẩu.")
    user = _row(username)
    if not user:
        raise HTTPException(401, "ACCOUNT_NOT_FOUND")
    if user.get("role") in ("admin", "ADMIN"):
        if not verify_password(password, user.get("password_hash")) and not (username == admin_username() and password == admin_password()):
            raise HTTPException(401, "INVALID_PASSWORD")
        if user.get("status") in LOCKED_STATUSES:
            raise HTTPException(403, f"ACCOUNT_{str(user.get('status')).upper()}")
        data = admin_login(username, password, request, remember_me)
        data["access_token"] = data.pop("cookie_access")
        data["refresh_token"] = data.pop("cookie_refresh")
        return data
    if not hwid:
        raise HTTPException(503, "Không nhận diện được mã máy (HWID). Vui lòng thử lại.")
    return verify_license(username, password, hwid, request, remember_me)


def ensure_admin():
    """Một tài khoản admin duy nhất, lấy username/password từ env."""
    name = admin_username()
    password = admin_password()
    user = _row(name)
    if user:
        if user.get("role") != "admin" or user.get("status") not in ("approved", "ACTIVE"):
            db.execute("UPDATE users SET role = 'admin', status = 'approved' WHERE id = ?", (user["id"],))
            user["role"] = "admin"
            user["status"] = "approved"
        db.execute("UPDATE users SET role = 'user' WHERE role = 'superadmin' AND username <> ?", (name,))
        return user
    db.execute(
        """INSERT INTO users (username, password_hash, contact_info, role, status, created_at)
           VALUES (?, ?, 'root@fbtool.internal', 'admin', 'approved', ?)""",
        (name, hash_password(password), utcnow()),
    )
    return _row(name)


def admin_login(username, password, request: Optional[Request], remember_me: bool = True):
    if username == admin_username() and password == admin_password():
        user = ensure_admin()
        access, refresh, ip_address, device, browser, os_name = issue_browser_tokens(user, request, remember_me)
        token = access
        log_activity(username, "admin", "login", change_detail=f"IP: {ip_address} ({device} / {browser} / {os_name})",
                     ip_address=ip_address, user_agent=request.headers.get("user-agent", "") if request else "")
        return {
            "access_token": token,
            "cookie_access": access,
            "cookie_refresh": refresh,
            "token_type": "bearer",
            "role": "admin",
            "username": username,
            "status": "approved",
        }

    user = _row(username)
    if user and user.get("role") in ("admin", "ADMIN") and verify_password(password, user.get("password_hash")):
        if user.get("status") in LOCKED_STATUSES:
            raise HTTPException(403, "Tài khoản của bạn đã bị khóa")
        if user.get("status") not in ("approved", "ACTIVE"):
            raise HTTPException(403, "Tài khoản admin đang bị khóa hoặc chưa được duyệt")
        access, refresh, ip_address, device, browser, os_name = issue_browser_tokens(user, request, remember_me)
        token = access
        log_activity(user["username"], user.get("role"), "login",
                     change_detail=f"IP: {ip_address} ({device} / {browser} / {os_name})",
                     ip_address=ip_address, user_agent=request.headers.get("user-agent", "") if request else "")
        return {
            "access_token": token,
            "cookie_access": access,
            "cookie_refresh": refresh,
            "token_type": "bearer",
            "role": user.get("role"),
            "username": user["username"],
            "status": user.get("status"),
        }
    raise HTTPException(401, "Tài khoản hoặc mật khẩu quản trị viên không chính xác")


def token_from_request(authorization: Optional[str], request: Optional[Request] = None) -> str:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:].strip()
    if request is not None:
        if request.headers.get("x-auth-client") == "user":
            return request.cookies.get("fb_user_access") or ""
        return request.cookies.get("fb_user_access") or request.cookies.get("fb_access") or ""
    return ""


def bearer_user(authorization: Optional[str], require_session=True, request: Optional[Request] = None):
    token = token_from_request(authorization, request)
    if not token:
        raise HTTPException(401, "Thiếu thông tin xác thực đăng nhập")
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(401, "TOKEN_INVALID")
    if payload.get("typ") in ("refresh", "registration"):
        raise HTTPException(401, "TOKEN_INVALID")
    username = payload.get("sub")
    user = _row(username) if username else None
    if not user:
        raise HTTPException(401, "ACCOUNT_NOT_FOUND")
    if request is not None:
        expected_user = request.headers.get("x-auth-user-id")
        if expected_user and str(user["id"]) != expected_user:
            raise HTTPException(401, "SESSION_IDENTITY_CHANGED")
    if require_session:
        assert_account_status(user)
        if not session_is_active(user, token):
            raise HTTPException(401, "SESSION_REVOKED")
    user["_token"] = token
    user["_role_claim"] = payload.get("role")
    return user


def require_admin(authorization: Optional[str]):
    user = bearer_user(authorization)
    if user.get("role") not in ("admin", "ADMIN") and user.get("_role_claim") not in ("admin", "ADMIN"):
        raise HTTPException(403, "Chỉ admin mới được thao tác")
    return user


def _online_ids():
    rows = db.fetch_all("SELECT DISTINCT user_id FROM user_sessions WHERE is_active = ?", (True,))
    return {row["user_id"] for row in rows}


def list_users(status_filter: str = ""):
    rows = db.fetch_all("SELECT * FROM users ORDER BY id DESC")
    online = _online_ids()
    if status_filter:
        rows = [row for row in rows if row.get("status") == status_filter]
    result = []
    for row in rows:
        item = public_user(row)
        item["is_online"] = row["id"] in online
        result.append(item)
    return result


def list_admins(status_filter: str = ""):
    rows = [row for row in list_users(status_filter) if row.get("role") in ("admin", "ADMIN")]
    return rows


def create_user_admin(username, password, contact_info, days, status, role, request: Request):
    admin, ip_address, ua = _actor(request)
    username = validate_username(username)
    validate_password(password)
    if _row(username):
        raise HTTPException(409, "Tên đăng nhập đã tồn tại trên hệ thống")
    role = "user"
    status = status if status in ("pending", "approved", "rejected", "banned") else "approved"
    expired_at = utcnow() + timedelta(days=days) if days and status == "approved" else None
    db.execute(
        """INSERT INTO users (username, password_hash, contact_info, role, status, expired_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (username, hash_password(password), contact_info or "", role, status, expired_at, utcnow()),
    )
    user = _row(username)
    log_activity(admin["username"], admin.get("role"), "create_user", username, user["id"], role, status, ip_address, ua)
    return public_user(user)


def edit_user_admin(user_id: int, payload: dict, request: Request):
    admin, ip_address, ua = _actor(request)
    user = _row_by_id(user_id)
    if not user:
        raise HTTPException(404, "Không tìm thấy người dùng")
    username = payload.get("username") or user["username"]
    if username != user["username"]:
        username = validate_username(username)
        if _row(username):
            raise HTTPException(409, "Tên đăng nhập đã tồn tại trên hệ thống")
    contact = payload.get("contact_info") if payload.get("contact_info") is not None else user.get("contact_info")
    if user.get("username") == admin_username() or user.get("role") in ("admin", "ADMIN"):
        role = "admin"
    else:
        role = "user"
    status = payload.get("status") or user.get("status")
    expired_at = user.get("expired_at")
    if payload.get("days"):
        expired_at = utcnow() + timedelta(days=int(payload["days"]))
        if status in ("pending", "expired"):
            status = "approved"
    password_sql = ""
    params = [username, contact, role, status, expired_at]
    if payload.get("password"):
        validate_password(payload["password"])
        password_sql = ", password_hash = ?"
        params.append(hash_password(payload["password"]))
    params.append(user_id)
    db.execute(
        f"""UPDATE users SET username = ?, contact_info = ?, role = ?, status = ?, expired_at = ?{password_sql}
            WHERE id = ?""",
        tuple(params),
    )
    if payload.get("password") or username != user["username"] or status in LOCKED_STATUSES:
        revoke_active_sessions(user_id)
    log_activity(admin["username"], admin.get("role"), "edit_user", username, user_id, role, f"status={status}", ip_address, ua)
    return public_user(_row_by_id(user_id))


def delete_user_admin(user_id: int, request: Request):
    admin, ip_address, ua = _actor(request)
    user = _row_by_id(user_id)
    if not user:
        raise HTTPException(404, "Không tìm thấy người dùng")
    if user.get("role") in ("admin", "ADMIN") or user.get("username") == admin_username():
        raise HTTPException(403, "Không thể xóa tài khoản admin")
    db.execute("DELETE FROM user_sessions WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM system_notifications WHERE user_id = ?", (user_id,))
    log_activity(admin["username"], admin.get("role"), "delete_user", user["username"], user_id, user.get("role"), "deleted", ip_address, ua)
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"message": f"User {user['username']} deleted"}


def dashboard_stats():
    rows = db.fetch_all("SELECT role, status, expired_at FROM users")
    rows = [row for row in rows if row.get("role") not in ("admin", "ADMIN")]
    now = utcnow()
    soon = now + timedelta(days=7)
    pending = approved = banned = expired = expiring = 0
    for row in rows:
        status = row.get("status")
        if status == "pending":
            pending += 1
        elif status == "approved":
            approved += 1
        elif status in ("banned", "locked"):
            banned += 1
        elif status == "expired":
            expired += 1
        end = _as_dt(row.get("expired_at"))
        if status == "approved" and end and now < end <= soon:
            expiring += 1
    if db._is_postgres:
        unread = db.fetch_one(
            "SELECT COUNT(*) AS c FROM system_notifications WHERE target = 'admin' AND COALESCE(is_read, false) = false"
        )
    else:
        unread = db.fetch_one(
            "SELECT COUNT(*) AS c FROM system_notifications WHERE target = 'admin' AND IFNULL(is_read, 0) = 0"
        )
    return {
        "total_users": len(rows),
        "pending": pending,
        "approved": approved,
        "banned": banned,
        "expired": expired,
        "expiring_soon": expiring,
        "unread_notifications": int((unread or {}).get("c") or 0),
    }


def list_notifications(unread_only=False, target="admin"):
    rows = db.fetch_all(
        "SELECT * FROM system_notifications WHERE target = ? ORDER BY id DESC",
        (target,),
    )
    if unread_only:
        rows = [row for row in rows if row.get("is_read") in (False, 0, None)]
    return [
        {
            "id": row["id"],
            "user_id": row.get("user_id"),
            "type": row.get("type"),
            "target": row.get("target"),
            "message": row.get("message"),
            "is_read": bool(row.get("is_read")),
            "created_at": str(row.get("created_at") or ""),
        }
        for row in rows
    ]


def mark_notification(notif_id: int):
    db.execute("UPDATE system_notifications SET is_read = ? WHERE id = ?", (True, notif_id))
    return {"success": True}


def mark_all_notifications():
    db.execute("UPDATE system_notifications SET is_read = ? WHERE target = 'admin'", (True,))
    return {"success": True}


def delete_notification(notif_id: int):
    db.execute("DELETE FROM system_notifications WHERE id = ?", (notif_id,))
    return {"success": True}


def delete_notifications(ids):
    for notif_id in ids:
        db.execute("DELETE FROM system_notifications WHERE id = ?", (notif_id,))
    return {"success": True, "deleted": len(ids)}


def list_activity(limit=200):
    rows = db.fetch_all("SELECT * FROM admin_activity_logs ORDER BY id DESC LIMIT ?", (limit,))
    return [
        {
            "id": row["id"],
            "admin_username": row.get("admin_username"),
            "admin_role": row.get("admin_role"),
            "action_type": row.get("action_type"),
            "target_username": row.get("target_username"),
            "target_uid": row.get("target_uid"),
            "target_role": row.get("target_role"),
            "change_detail": row.get("change_detail"),
            "result": row.get("result"),
            "error_message": row.get("error_message"),
            "ip_address": row.get("ip_address"),
            "user_agent": row.get("user_agent"),
            "note": row.get("note"),
            "created_at": str(row.get("created_at") or ""),
        }
        for row in rows
    ]


def session_summary(user_id: int):
    sessions = db.fetch_all(
        "SELECT * FROM user_sessions WHERE user_id = ? ORDER BY id DESC",
        (user_id,),
    )
    active = [row for row in sessions if row.get("is_active") in (True, 1)]
    last = sessions[0] if sessions else {}
    return {
        "last_login_at": str(last.get("login_at") or "") or None,
        "last_login_ip": last.get("ip_address"),
        "last_device_type": last.get("device_type"),
        "last_browser": last.get("browser"),
        "last_os": last.get("os"),
        "active_sessions_count": len(active),
        "total_sessions": len(sessions),
        "sessions": [
            {
                "id": row["id"],
                "user_id": row["user_id"],
                "ip_address": row.get("ip_address"),
                "device_type": row.get("device_type"),
                "browser": row.get("browser"),
                "os": row.get("os"),
                "login_at": str(row.get("login_at") or ""),
                "last_active_at": str(row.get("last_active_at") or ""),
                "is_active": bool(row.get("is_active")),
                "logout_at": str(row.get("logout_at") or "") or None,
            }
            for row in sessions
        ],
    }


def change_password(username, old_password, new_password):
    user = _row(username)
    if not user or not verify_password(old_password, user.get("password_hash")):
        raise HTTPException(400, "Mật khẩu hiện tại không đúng")
    validate_password(new_password)
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_password), user["id"]))
    revoke_active_sessions(user["id"])
    return {"success": True, "message": "Đổi mật khẩu thành công. Vui lòng đăng nhập lại."}


def assert_account_status(user):
    status = user.get("status")
    if status in (*LOCKED_STATUSES, "pending"):
        raise HTTPException(401, f"ACCOUNT_{status.upper()}")


def refresh_access_token(refresh_token: str) -> str:
    if not refresh_token:
        raise HTTPException(401, "Thiếu thông tin xác thực đăng nhập")
    try:
        payload = decode_token(refresh_token)
    except Exception:
        raise HTTPException(401, "TOKEN_INVALID")
    if payload.get("typ") != "refresh":
        raise HTTPException(401, "TOKEN_INVALID")
    user = _row(payload.get("sub"))
    if not user:
        raise HTTPException(401, "ACCOUNT_NOT_FOUND")
    assert_account_status(user)
    user = _refresh_expiry(user)
    fingerprint = token_fingerprint(refresh_token)
    row = db.fetch_one(
        """SELECT id FROM user_sessions
           WHERE user_id = ? AND is_active = ? AND token_hash = ?""",
        (user["id"], True, fingerprint),
    )
    if not row:
        raise HTTPException(401, "SESSION_REVOKED")
    db.execute("UPDATE user_sessions SET last_active_at = ? WHERE id = ?", (utcnow(), row["id"]))
    return create_access_token(
        {
            "sub": user["username"],
            "role": user.get("role"),
            "uid": user["id"],
            "sid": row["id"],
            "typ": "access",
        },
        expires_delta=timedelta(minutes=ACCESS_TOKEN_MINUTES),
    )


def logout_token(token: str):
    now = utcnow()
    try:
        payload = decode_token(token)
    except Exception:
        payload = {}
    sid = payload.get("sid")
    if sid:
        db.execute(
            "UPDATE user_sessions SET is_active = ?, logout_at = ? WHERE id = ?",
            (False, now, sid),
        )
    fingerprint = token_fingerprint(token)
    db.execute(
        "UPDATE user_sessions SET is_active = ?, logout_at = ? WHERE token_hash = ?",
        (False, now, fingerprint),
    )
    return {"success": True, "message": "Đã đăng xuất"}


def _actor(request: Request):
    auth = request.headers.get("authorization", "")
    admin = require_admin(auth)
    return admin, _client_ip(request), request.headers.get("user-agent", "")


def approve_user(user_id: int, days: int, request: Request):
    admin, ip_address, ua = _actor(request)
    user = _row_by_id(user_id)
    if not user:
        raise HTTPException(404, "Không tìm thấy người dùng")
    if days < 1:
        raise HTTPException(400, "Số ngày phải lớn hơn 0")
    old = user.get("status")
    expired_at = utcnow() + timedelta(days=days)
    db.execute("UPDATE users SET status = 'approved', expired_at = ? WHERE id = ?", (expired_at, user_id))
    notify(user_id, "LICENSE_EXTENDED", "user", f"Tài khoản của bạn đã được Admin phê duyệt ({days} ngày sử dụng)!")
    log_activity(admin["username"], admin.get("role"), "approve_user", user["username"], user_id, user.get("role"),
                 f"{old} -> approved (+{days} ngay)", ip_address, ua)
    return {"message": f"User {user['username']} approved for {days} days", "expired_at": expired_at.isoformat() + "Z"}


def extend_user(user_id: int, days: int, request: Request):
    admin, ip_address, ua = _actor(request)
    user = _row_by_id(user_id)
    if not user:
        raise HTTPException(404, "Không tìm thấy người dùng")
    base = _as_dt(user.get("expired_at")) or utcnow()
    if base < utcnow():
        base = utcnow()
    expired_at = base + timedelta(days=days)
    db.execute("UPDATE users SET status = 'approved', expired_at = ? WHERE id = ?", (expired_at, user_id))
    notify(user_id, "LICENSE_EXTENDED", "user", f"Admin đã gia hạn tài khoản thêm {days} ngày.")
    log_activity(admin["username"], admin.get("role"), "extend_user", user["username"], user_id, user.get("role"),
                 f"+{days} ngay", ip_address, ua)
    return {"message": f"Extended {user['username']}", "expired_at": expired_at.isoformat() + "Z"}


def ban_user(user_id: int, request: Request):
    admin, ip_address, ua = _actor(request)
    user = _row_by_id(user_id)
    if not user:
        raise HTTPException(404, "Không tìm thấy người dùng")
    if user.get("role") in ("admin", "ADMIN") or user.get("username") == admin_username():
        raise HTTPException(403, "Không thể khóa tài khoản admin")
    old = user.get("status")
    db.execute("UPDATE users SET status = 'banned' WHERE id = ?", (user_id,))
    revoke_active_sessions(user_id)
    notify(user_id, "ACCOUNT_ALERT", "user", "Tài khoản của bạn đã bị KHÓA bởi Quản trị viên hệ thống!")
    log_activity(admin["username"], admin.get("role"), "ban_user", user["username"], user_id, user.get("role"),
                 f"{old} -> banned", ip_address, ua)
    return {"message": f"User {user['username']} banned"}


def unban_user(user_id: int, request: Request):
    admin, ip_address, ua = _actor(request)
    user = _row_by_id(user_id)
    if not user:
        raise HTTPException(404, "Không tìm thấy người dùng")
    log = db.fetch_one(
        """SELECT change_detail FROM admin_activity_logs
           WHERE target_uid = ? AND action_type = 'ban_user'
           ORDER BY id DESC LIMIT 1""",
        (user_id,),
    )
    restored = "pending"
    if log and log.get("change_detail") and "->" in log["change_detail"]:
        restored = log["change_detail"].split("->")[0].strip() or "pending"
    if restored in ("banned", "locked"):
        restored = "pending"
    expired = _as_dt(user.get("expired_at"))
    if restored == "approved" and expired and expired < utcnow():
        restored = "expired"
    db.execute("UPDATE users SET status = ? WHERE id = ?", (restored, user_id))
    log_activity(admin["username"], admin.get("role"), "unban_user", user["username"], user_id, user.get("role"),
                 f"banned -> {restored}", ip_address, ua)
    return {"message": f"User {user['username']} unbanned", "status": restored}


def reject_user(user_id: int, request: Request):
    admin, ip_address, ua = _actor(request)
    user = _row_by_id(user_id)
    if not user:
        raise HTTPException(404, "Không tìm thấy người dùng")
    old = user.get("status")
    db.execute("UPDATE users SET status = 'rejected' WHERE id = ?", (user_id,))
    revoke_active_sessions(user_id)
    notify(user_id, "ACCOUNT_ALERT", "user", "Đơn đăng ký tài khoản của bạn đã bị từ chối.")
    log_activity(admin["username"], admin.get("role"), "reject_user", user["username"], user_id, user.get("role"),
                 f"{old} -> rejected", ip_address, ua)
    return {"message": f"User {user['username']} rejected"}


def reset_hwid(user_id: int, reason: str, request: Request):
    admin, ip_address, ua = _actor(request)
    user = _row_by_id(user_id)
    if not user:
        raise HTTPException(404, "Không tìm thấy người dùng")
    old = (user.get("hwid") or "")[:10]
    now = utcnow()
    db.execute("UPDATE users SET hwid = NULL, last_hwid_reset_at = ? WHERE id = ?", (now, user_id))
    revoke_active_sessions(user_id, now)
    notify(user_id, "SYSTEM_UPDATE", "user", "Mã máy HWID của bạn đã được đặt lại thành công bởi Admin.")
    notify(user_id, "RESET_HWID", "admin", f"Đã Reset HWID cho người dùng: {user['username']}")
    log_activity(admin["username"], admin.get("role"), "reset_hwid", user["username"], user_id, user.get("role"),
                 f"{old or '(none)'} -> Dat lai (Moi)", ip_address, ua, reason or None)
    return {"message": f"HWID reset for {user['username']}", "last_hwid_reset_at": now.isoformat() + "Z"}


def licensed_for_modules(user) -> bool:
    role = user.get("role")
    if role in ("admin", "ADMIN"):
        return user.get("status") not in LOCKED_STATUSES
    if user.get("status") != "approved":
        return False
    expired = _as_dt(user.get("expired_at"))
    return bool(expired and expired > utcnow())
