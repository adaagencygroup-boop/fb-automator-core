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
from modules.module_auth.license_policy import ACCOUNT_FEATURE, ACCOUNT_FREE_DAYS, account_license_expiry
from modules.module_auth.schema import SYSTEM_DEFAULT_FEATURES
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
_ACCOUNT_SECRET_COLUMNS = ("password", "two_fa", "pass_mail")
logger = logging.getLogger(__name__)
FEATURE_NAMES = {key: re.sub(r"^\d+\.\s*", "", name) for key, name, _description, _order in SYSTEM_DEFAULT_FEATURES}


def _table_exists(cursor, table_name: str) -> bool:
    if db._is_postgres:
        cursor.execute(
            db._normalize_query(
                "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ? LIMIT 1"
            ),
            (table_name,),
        )
    else:
        cursor.execute(
            "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
            (table_name,),
        )
    return cursor.fetchone() is not None


def _reencrypt_user_accounts_for_hwid(cursor, user_id: int, old_hwid: Optional[str], new_hwid: Optional[str]) -> dict:
    """Re-encrypt accounts.(password, two_fa, pass_mail) in-memory from old_hwid to new_hwid within the caller's transaction."""
    stats = {"migrated_accounts": 0, "migrated_fields": 0, "already_migrated_fields": 0, "failed_fields": 0}
    if not old_hwid or not new_hwid or old_hwid == new_hwid:
        return stats
    if not _table_exists(cursor, "accounts"):
        return stats

    from modules.module_02_account_manager.security.encryption import _crypt, _decrypt

    cursor.execute(
        db._normalize_query(
            "SELECT id, password, two_fa, pass_mail FROM accounts WHERE user_id = ? ORDER BY id"
        ),
        (str(user_id),),
    )
    rows = [dict(r) for r in cursor.fetchall()]
    for row in rows:
        updates = {}
        for col in _ACCOUNT_SECRET_COLUMNS:
            cipher = row.get(col)
            if not cipher:
                continue
            try:
                plaintext = _decrypt(cipher, old_hwid)
            except Exception:
                try:
                    _decrypt(cipher, new_hwid)
                    stats["already_migrated_fields"] += 1
                except Exception:
                    stats["failed_fields"] += 1
                    logger.warning(
                        "[HWID Re-encrypt] Skipping undecryptable field '%s' on account id=%s (user_id=%s)",
                        col,
                        row.get("id"),
                        user_id,
                    )
                continue
            updates[col] = _crypt(plaintext, new_hwid)
            stats["migrated_fields"] += 1

        if updates:
            set_clause = ", ".join(f"{col} = ?" for col in updates)
            params = tuple(updates.values()) + (row["id"],)
            cursor.execute(
                db._normalize_query(f"UPDATE accounts SET {set_clause} WHERE id = ?"),
                params,
            )
            stats["migrated_accounts"] += 1

    return stats


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


def _user_event(cursor, user_id, event_type, message, event_key, at):
    """A persisted unique key prevents duplicates across polls, restarts and workers."""
    cursor.execute(
        """INSERT INTO system_notifications (user_id, type, target, message, is_read, created_at, event_key)
           VALUES (%s, %s, 'user', %s, FALSE, %s, %s)
           ON CONFLICT (event_key) DO NOTHING""",
        (user_id, event_type, message, at, event_key),
    )


def _account_approved_event(cursor, user_id, at, free_trial=False):
    message = "Tài khoản của bạn đã được phê duyệt."
    if free_trial:
        message += f" Bạn được dùng miễn phí module Quản lý tài khoản Facebook trong {ACCOUNT_FREE_DAYS} ngày."
    _user_event(cursor, user_id, "ACCOUNT_APPROVED", message, f"account-approved:{user_id}", at)


def _license_time(expiry):
    # All stored license timestamps are UTC; messages use the user's Vietnam timezone.
    return (expiry + timedelta(hours=7)).strftime("%H:%M ngày %d/%m/%Y")


def _expired_module_events(cursor, user_id, features, now):
    for feature in features:
        expiry = _as_dt(feature.get("expired_at"))
        if not feature.get("is_enabled") or not expiry or expiry > now:
            continue
        key = feature["feature_key"]
        name = FEATURE_NAMES.get(key, key)
        _user_event(cursor, user_id, "MODULE_EXPIRED",
                    f"Module {name} đã hết hạn lúc {_license_time(expiry)}. Vui lòng liên hệ Admin để gia hạn.",
                    f"module-expired:{user_id}:{key}:{expiry.isoformat()}", expiry)


def _module_term_event(cursor, user_id, key, old, expiry, now, automatic=False):
    previous = _as_dt(old.get("expired_at")) if old else None
    if expiry <= now or (previous == expiry and old.get("is_enabled")):
        return
    name = FEATURE_NAMES.get(key, key)
    purchased_before = bool(old and (old.get("is_enabled") or (old.get("days_granted") or 0) > 0))
    if automatic:
        event_type, action = "MODULE_RENEWED", "được tự động gia hạn"
    elif not purchased_before:
        event_type, action = "MODULE_ACTIVATED", "được kích hoạt"
    elif previous and expiry > previous:
        event_type, action = "MODULE_RENEWED", "đã được gia hạn"
    else:
        event_type, action = "MODULE_UPDATED", "được cập nhật thời hạn"
    _user_event(cursor, user_id, event_type,
                f"Module {name} {action}, có hiệu lực đến {_license_time(expiry)}.",
                f"{event_type.lower()}:{user_id}:{key}:{expiry.isoformat()}", now)


def revoke_active_sessions(user_id: int, at=None) -> None:
    db.execute(
        """UPDATE user_sessions
           SET is_active = ?, logout_at = ?, last_active_at = ?
           WHERE user_id = ? AND is_active = ?""",
        (False, at or utcnow(), at or utcnow(), user_id, True),
    )


def _open_session(user, request: Optional[Request], token: str, revoke_others: bool = True):
    now = utcnow()
    # Admin cloud: revoke_others=False — mở nhiều tab/máy không đá phiên đang dùng.
    if revoke_others:
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


def issue_browser_tokens(user, request: Optional[Request], remember_me: bool = True, revoke_others: bool = True):
    """Cấp access + refresh; refresh gắn session DB để gia hạn khi access hết hạn."""
    refresh = create_refresh_token({"sub": user["username"], "role": user.get("role"), "uid": user["id"], "remember_me": remember_me})
    session_id, ip_address, device, browser, os_name = _open_session(
        user, request, refresh, revoke_others=revoke_others
    )
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


def get_user_feature_licenses(user_id: int):
    """Lấy danh sách bản quyền 11 tính năng của người dùng từ user_feature_licenses"""
    rows = db.fetch_all(
        """SELECT sf.feature_key, sf.feature_name, sf.order_index,
                  ufl.is_enabled, ufl.days_granted, ufl.expired_at
           FROM system_features sf
           LEFT JOIN user_feature_licenses ufl
                  ON sf.feature_key = ufl.feature_key AND ufl.user_id = ?
           WHERE sf.is_active = TRUE
           ORDER BY sf.order_index ASC""",
        (user_id,),
    )
    now = utcnow()
    features = []
    for r in rows:
        exp = _as_dt(r.get("expired_at"))
        is_active = bool(r.get("is_enabled") and exp and exp > now)
        remaining = days_remaining(exp, now) if exp else 0
        features.append({
            "key": r["feature_key"],
            "name": r["feature_name"],
            "order_index": r["order_index"],
            "is_enabled": bool(r.get("is_enabled")),
            "is_active": is_active,
            "days_granted": r.get("days_granted") or 0,
            "days_remaining": remaining if remaining > 0 else 0,
            "expired_at": exp.isoformat() + "Z" if exp else None,
        })
    return features


def sync_user_feature_licenses(user_id: int, feature_items: list, base_expired_at=None, preserve_unchanged=True, is_extend=False):
    """Update paid modules atomically, then derive the read-only account license.

    is_extend=True: days is treated as a signed delta (+/- or 0) applied to each module's current expiry.
    is_extend=False: days is the target remaining term from now.
    """
    now = utcnow()
    upsert = """INSERT INTO user_feature_licenses (user_id, feature_key, is_enabled, days_granted, expired_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id, feature_key) DO UPDATE
                SET is_enabled = EXCLUDED.is_enabled, days_granted = EXCLUDED.days_granted,
                    expired_at = EXCLUDED.expired_at, updated_at = CURRENT_TIMESTAMP"""
    with db.session() as cursor:
        cursor.execute("SELECT created_at FROM users WHERE id = %s FOR UPDATE", (user_id,))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(404, "Không tìm thấy người dùng")
        cursor.execute("SELECT feature_key, is_enabled, days_granted, expired_at FROM user_feature_licenses WHERE user_id = %s", (user_id,))
        existing = {row["feature_key"]: dict(row) for row in cursor.fetchall()}
        _expired_module_events(cursor, user_id, existing.values(), now)
        for item in feature_items:
            key = item.get("key")
            if not key or key == ACCOUNT_FEATURE:
                continue  # This term is managed by the server, including forged API payloads.
            raw_days = int(item.get("days") or 0)
            enabled = bool(item.get("enabled", False))
            old = existing.get(key)
            if is_extend:
                if enabled:
                    if raw_days == 0 and old and bool(old["is_enabled"]):
                        continue
                    feat_base = _as_dt(old["expired_at"]) if (old and old.get("expired_at")) else now
                    if not feat_base or feat_base < now:
                        feat_base = now
                    expiry = feat_base + timedelta(days=raw_days)
                    if expiry < now:
                        expiry = now
                    granted = days_remaining(expiry, now)
                elif old and (old["is_enabled"] or (old.get("days_granted") or 0) > 0):
                    if not old["is_enabled"]:
                        continue
                    expiry = min(_as_dt(old["expired_at"]), now)
                    granted = max(1, old.get("days_granted") or 0)
                else:
                    continue
            else:
                days = max(0, raw_days)
                if preserve_unchanged and old and enabled == bool(old["is_enabled"]) and days == days_remaining(old["expired_at"], now):
                    continue
                if enabled:
                    expiry, granted = now + timedelta(days=days), days
                elif old and (old["is_enabled"] or (old.get("days_granted") or 0) > 0):
                    # Cancelling a paid term starts grace today; an already-ended term
                    # keeps its historical end so repeatedly saving never restarts grace.
                    expiry = min(_as_dt(old["expired_at"]), now)
                    granted = max(1, old.get("days_granted") or 0)
                else:
                    expiry, granted = now, 0
            cursor.execute(upsert, (user_id, key, enabled, granted, expiry))
            if enabled:
                _module_term_event(cursor, user_id, key, old, expiry, now)
            existing[key] = {"feature_key": key, "is_enabled": enabled, "days_granted": granted, "expired_at": expiry}
        expired_at = account_license_expiry(user["created_at"], existing.values())
        cursor.execute(upsert, (user_id, ACCOUNT_FEATURE, True, days_remaining(expired_at, now), expired_at))
        account_before = existing.get(ACCOUNT_FEATURE)
        if account_before and expired_at > _as_dt(account_before["expired_at"]):
            _module_term_event(cursor, user_id, ACCOUNT_FEATURE, account_before, expired_at, now, automatic=True)
        cursor.execute(
            """UPDATE users SET expired_at = %s,
               status = CASE WHEN status IN ('approved', 'expired') THEN
                   CASE WHEN %s > %s THEN 'approved' ELSE 'expired' END ELSE status END
               WHERE id = %s""", (expired_at, expired_at, now, user_id),
        )
    return expired_at


def public_user(user, now=None):
    now = now or utcnow()
    expired = _as_dt(user.get("expired_at"))
    user_id = user["id"]
    features = get_user_feature_licenses(user_id)
    active_features = [f["key"] for f in features if f["is_active"]]
    
    return {
        "id": user_id,
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
        "client_version": user.get("client_version") or "v2.3.9",
        "last_hwid_reset_at": str(user.get("last_hwid_reset_at") or ""),
        "features": features,
        "permissions": active_features,
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
    if len(password) < 8 or not all(re.search(pattern, password) for pattern in (r"[A-Z]", r"[a-z]", r"[0-9]", r"[^a-zA-Z0-9]")):
        raise HTTPException(400, "Mật khẩu phải từ 8 ký tự trở lên, bao gồm ít nhất 1 chữ hoa, 1 chữ thường, 1 chữ số và 1 ký tự đặc biệt.")


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
                """INSERT INTO users (username, password_hash, contact_info, hwid, role, status, created_at, expired_at)
                   VALUES (%s, %s, %s, %s, 'user', 'approved', %s, %s) RETURNING id""",
                (username, password_hash, contact, hwid, created_at, created_at + timedelta(days=ACCOUNT_FREE_DAYS)),
            )
            user_id = cursor.fetchone()["id"]
            cursor.execute(
                """INSERT INTO user_feature_licenses (user_id, feature_key, is_enabled, days_granted, expired_at)
                   VALUES (%s, %s, TRUE, %s, %s)""",
                (user_id, ACCOUNT_FEATURE, ACCOUNT_FREE_DAYS, created_at + timedelta(days=ACCOUNT_FREE_DAYS)),
            )
            _account_approved_event(cursor, user_id, created_at, free_trial=True)
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
    return {"message": "Đăng ký thành công. Bạn được dùng miễn phí Quản lý tài khoản Facebook trong 30 ngày.", "user_id": user_id, "status": "approved"}


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
    data = {"username": user["username"], "status": user.get("status"), "user_id": user["id"]}
    if user.get("hwid") and user["hwid"] != hwid:
        data["hwid_mismatch"] = True
    return data


def pending_login_ticket(username, hwid):
    user = _row(username.strip())
    return create_registration_ticket(user["username"], user["id"], hwid)


def claim_approved_session(ticket: str, hwid: str, request: Optional[Request], remember_me: bool = True):
    """Sau admin duyệt: đổi registration ticket → access/refresh, vào app không cần login lại."""
    if not ticket:
        raise HTTPException(401, "Phiên kiểm tra đăng ký đã hết hạn. Vui lòng đăng nhập lại.")
    profile = registration_status(ticket, hwid, allow_refresh=False)
    if profile.get("hwid_mismatch"):
        raise HTTPException(403, "ERR_HWID_MISMATCH")
    status = profile.get("status")
    if status not in ("approved", "ACTIVE", "expired"):
        raise HTTPException(403, f"ACCOUNT_{str(status or 'pending').upper()}")
    user = _row_by_id(profile["user_id"])
    if not user:
        raise HTTPException(401, "ACCOUNT_NOT_FOUND")
    user = _refresh_expiry(user)
    access, refresh, _ip, _device, _browser, _os_name = issue_browser_tokens(
        user, request, remember_me, revoke_others=True
    )
    expired = _as_dt(user.get("expired_at"))
    now = utcnow()
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "days_remaining": 0 if user.get("status") == "expired" else days_remaining(expired, now),
        "expired_at": expired.isoformat() + "Z" if expired else None,
        "username": user["username"],
        "user_id": user["id"],
        "role": user.get("role"),
        "status": user.get("status"),
        "contact_info": user.get("contact_info"),
    }


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
        prev_hwid = user.get("previous_hwid")
        with db.session() as cursor:
            if prev_hwid and prev_hwid != hwid:
                _reencrypt_user_accounts_for_hwid(cursor, user["id"], prev_hwid, hwid)
            cursor.execute(
                db._normalize_query("UPDATE users SET hwid = ?, previous_hwid = NULL WHERE id = ?"),
                (hwid, user["id"]),
            )
        user["hwid"] = hwid
        user["previous_hwid"] = None
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
        access, refresh, ip_address, device, browser, os_name = issue_browser_tokens(
            user, request, remember_me, revoke_others=False
        )
        token = access
        log_activity(username, "admin", "login", change_detail=f"IP: {ip_address} ({device} / {browser} / {os_name})",
                     ip_address=ip_address, user_agent=request.headers.get("user-agent", "") if request else "")
        return {
            "access_token": token,
            "refresh_token": refresh,
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
        access, refresh, ip_address, device, browser, os_name = issue_browser_tokens(
            user, request, remember_me, revoke_others=False
        )
        token = access
        log_activity(user["username"], user.get("role"), "login",
                     change_detail=f"IP: {ip_address} ({device} / {browser} / {os_name})",
                     ip_address=ip_address, user_agent=request.headers.get("user-agent", "") if request else "")
        return {
            "access_token": token,
            "refresh_token": refresh,
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


def create_user_admin(username, password, contact_info, days, status, role, request: Request, hwid: Optional[str] = None, features: Optional[list] = None):
    admin, ip_address, ua = _actor(request)
    username = validate_username(username)
    validate_password(password)
    if _row(username):
        raise HTTPException(409, "Tên đăng nhập đã tồn tại trên hệ thống")
    role = "admin" if role in ("admin", "ADMIN") else "user"
    if role == "admin":
        status = "approved"
    else:
        status = status if status in ("pending", "approved", "rejected", "banned") else "approved"
    expired_at = utcnow() + timedelta(days=days) if days and status == "approved" else None
    db.execute(
        """INSERT INTO users (username, password_hash, contact_info, role, status, hwid, expired_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (username, hash_password(password), contact_info or "", role, status, (hwid or "").strip() or None, expired_at, utcnow()),
    )
    user = _row(username)
    user_id = user["id"]

    if role == "user":
        sync_user_feature_licenses(user_id, features or [])
        if status == "approved":
            with db.session() as cursor:
                _account_approved_event(cursor, user_id, utcnow())

    log_activity(admin["username"], admin.get("role"), "create_user", username, user_id, role, status, ip_address, ua)
    return public_user(_row_by_id(user_id))


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
    if role == "admin" and status in LOCKED_STATUSES:
        raise HTTPException(400, "Không thể khóa tài khoản quản trị viên")
    expired_at = user.get("expired_at")
    password_sql = ""
    params = [username, contact, role, status, expired_at]
    if payload.get("password"):
        validate_password(payload["password"])
        password_sql = ", password_hash = ?"
        params.append(hash_password(payload["password"]))
    hwid_changed = False
    reencrypt_pair = None
    if "hwid" in payload:
        new_hwid = (payload.get("hwid") or "").strip() or None
        old_hwid = user.get("hwid") or None
        if new_hwid != old_hwid:
            hwid_changed = True
            if new_hwid is None:
                password_sql += ", previous_hwid = COALESCE(hwid, previous_hwid), hwid = ?, last_hwid_reset_at = ?"
                params.extend([new_hwid, utcnow()])
            else:
                effective_old = old_hwid or user.get("previous_hwid")
                if effective_old and effective_old != new_hwid:
                    reencrypt_pair = (effective_old, new_hwid)
                password_sql += ", previous_hwid = NULL, hwid = ?"
                params.append(new_hwid)
    params.append(user_id)
    with db.session() as cursor:
        if reencrypt_pair:
            _reencrypt_user_accounts_for_hwid(cursor, user_id, reencrypt_pair[0], reencrypt_pair[1])
        cursor.execute(
            db._normalize_query(
                f"""UPDATE users SET username = ?, contact_info = ?, role = ?, status = ?, expired_at = ?{password_sql}
                    WHERE id = ?"""
            ),
            tuple(params),
        )
    log_detail = f"status={status}"
    if role == "user":
        feat_list = payload.get("features") if isinstance(payload.get("features"), list) else []
        sync_user_feature_licenses(user_id, feat_list)
        if feat_list:
            feat_summary = format_feature_changes_summary(feat_list, is_extend=False)
            log_detail += f"; Tính năng: {feat_summary}"
        if user.get("status") in ("pending", "rejected") and _row_by_id(user_id).get("status") == "approved":
            with db.session() as cursor:
                _account_approved_event(cursor, user_id, utcnow())
    if payload.get("password") or username != user["username"] or status in LOCKED_STATUSES or hwid_changed:
        revoke_active_sessions(user_id)
    log_activity(admin["username"], admin.get("role"), "edit_user", username, user_id, role, log_detail, ip_address, ua)
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


def list_user_notifications(user_id: int, unread_only=False):
    # Polling the inbox also catches modules that expired while the app was closed.
    with db.session() as cursor:
        cursor.execute(
            "SELECT feature_key, is_enabled, expired_at FROM user_feature_licenses WHERE user_id = %s",
            (user_id,),
        )
        _expired_module_events(cursor, user_id, cursor.fetchall(), utcnow())
    unread_clause = " AND COALESCE(is_read, false) = false" if unread_only else ""
    rows = db.fetch_all(
        "SELECT id, type, message, is_read, created_at FROM system_notifications "
        "WHERE user_id = ? AND target = 'user'" + unread_clause + " ORDER BY id DESC",
        (user_id,),
    )
    return [{"id": row["id"], "type": row.get("type"), "message": row.get("message"),
             "is_read": bool(row.get("is_read")), "created_at": str(row.get("created_at") or "")}
            for row in rows]


def mark_user_notification(user_id: int, notif_id: int):
    row = db.fetch_one(
        """UPDATE system_notifications SET is_read = ?
           WHERE id = ? AND user_id = ? AND target = 'user' RETURNING id""",
        (True, notif_id, user_id),
    )
    if not row:
        raise HTTPException(404, "Không tìm thấy thông báo")
    return {"success": True}


def mark_all_user_notifications(user_id: int):
    db.execute(
        "UPDATE system_notifications SET is_read = ? WHERE user_id = ? AND target = 'user'",
        (True, user_id),
    )
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


def get_feature_name_map():
    """Lấy từ điển map {feature_key: tên ngắn gọn hoặc tên đầy đủ}"""
    try:
        rows = db.fetch_all("SELECT feature_key, feature_name FROM system_features")
        mapped = {r["feature_key"]: re.sub(r"^\d+\.\s*", "", r["feature_name"]) for r in rows}
        return {**FEATURE_NAMES, **mapped}
    except Exception:
        return dict(FEATURE_NAMES)


def format_feature_changes_summary(features: list, is_extend: bool = False) -> str:
    """Tạo chuỗi tóm tắt thay đổi tính năng cho admin activity log"""
    if not features or not isinstance(features, list):
        return ""
    name_map = get_feature_name_map()
    changes = []
    for f in features:
        key = f.get("key")
        if not key or key == ACCOUNT_FEATURE:
            continue
        name = name_map.get(key, key)
        enabled = f.get("enabled", True)
        days = f.get("days", 0)
        if not enabled:
            changes.append(f"Tắt: {name}")
        elif is_extend:
            if days != 0:
                sign = "+" if days > 0 else ""
                changes.append(f"{name} ({sign}{days} ngày)")
        else:
            changes.append(f"{name} ({days} ngày)")
    if not changes:
        return "Không có thay đổi tính năng"
    return "; ".join(changes)


def approve_user(user_id: int, days: int, request: Request, features: Optional[list] = None):
    admin, ip_address, ua = _actor(request)
    user = _row_by_id(user_id)
    if not user:
        raise HTTPException(404, "Không tìm thấy người dùng")
    if days < 1:
        raise HTTPException(400, "Số ngày phải lớn hơn 0")
    old = user.get("status")

    # Đồng bộ sang user_feature_licenses nếu có truyền danh sách tính năng
    if features is not None:
        expired_at = sync_user_feature_licenses(user_id, features, preserve_unchanged=False)
        if features:
            feat_text = format_feature_changes_summary(features, is_extend=False)
            log_detail = f"{old} -> approved (+{days} ngày); Cấp tính năng: {feat_text}"
        else:
            log_detail = f"{old} -> approved (+{days} ngày)"
    else:
        # An approval without subscriptions keeps only the automatic free term.
        expired_at = sync_user_feature_licenses(user_id, [])
        log_detail = f"{old} -> approved (+{days} ngày)"

    db.execute("UPDATE users SET status = ?, expired_at = ? WHERE id = ?", ("approved" if expired_at > utcnow() else "expired", expired_at, user_id))
    with db.session() as cursor:
        _account_approved_event(cursor, user_id, utcnow())
    log_activity(admin["username"], admin.get("role"), "approve_user", user["username"], user_id, user.get("role"),
                 log_detail, ip_address, ua)
    return {"message": f"User {user['username']} approved for {days} days", "expired_at": expired_at.isoformat() + "Z"}


def extend_user(user_id: int, days: int, request: Request, features: Optional[list] = None):
    admin, ip_address, ua = _actor(request)
    user = _row_by_id(user_id)
    if not user:
        raise HTTPException(404, "Không tìm thấy người dùng")
    if features is not None:
        expired_at = sync_user_feature_licenses(user_id, features, preserve_unchanged=False, is_extend=True)
        change_text = format_feature_changes_summary(features, is_extend=True)
    else:
        current = db.fetch_all(
            "SELECT feature_key, expired_at FROM user_feature_licenses WHERE user_id = ? AND is_enabled = TRUE AND feature_key <> ?",
            (user_id, ACCOUNT_FEATURE),
        )
        items = [{"key": row["feature_key"], "enabled": True, "days": days} for row in current]
        expired_at = sync_user_feature_licenses(user_id, items, preserve_unchanged=False, is_extend=True)
        change_text = f"{'+' if days >= 0 else ''}{days} ngày (Tất cả tính năng)"

    db.execute("UPDATE users SET status = ?, expired_at = ? WHERE id = ?", ("approved" if expired_at > utcnow() else "expired", expired_at, user_id))
    log_activity(admin["username"], admin.get("role"), "extend_user", user["username"], user_id, user.get("role"),
                 change_text, ip_address, ua)
    return {"message": f"Updated {user['username']}", "expired_at": expired_at.isoformat() + "Z"}


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
    db.execute(
        "UPDATE users SET previous_hwid = COALESCE(hwid, previous_hwid), hwid = NULL, last_hwid_reset_at = ? WHERE id = ?",
        (now, user_id),
    )
    revoke_active_sessions(user_id, now)
    notify(user_id, "SYSTEM_UPDATE", "user", "Mã máy HWID của bạn đã được đặt lại thành công bởi Admin.")
    notify(user_id, "RESET_HWID", "admin", f"Đã Reset HWID cho người dùng: {user['username']}")
    log_activity(admin["username"], admin.get("role"), "reset_hwid", user["username"], user_id, user.get("role"),
                 f"{old or '(none)'} -> Dat lai (Moi)", ip_address, ua, reason or None)
    return {"message": f"HWID reset for {user['username']}", "last_hwid_reset_at": now.isoformat() + "Z"}


def licensed_for_modules(user, feature_key: Optional[str] = None) -> bool:
    """
    Kiểm tra xem người dùng có quyền truy cập module / tính năng cụ thể hay không.
    Nếu không truyền feature_key: kiểm tra quyền chung của tài khoản.
    """
    role = user.get("role")
    if role in ("admin", "ADMIN"):
        return user.get("status") not in LOCKED_STATUSES
    if user.get("status") != "approved":
        return False
    expired = _as_dt(user.get("expired_at"))
    if not (expired and expired > utcnow()):
        return False

    if feature_key:
        row = db.fetch_one(
            """SELECT is_enabled, expired_at FROM user_feature_licenses
               WHERE user_id = ? AND feature_key = ?""",
            (user["id"], feature_key),
        )
        if not row:
            return False
        f_exp = _as_dt(row.get("expired_at"))
        return bool(row.get("is_enabled") and f_exp and f_exp > utcnow())

    return True
