"""Account CRUD, import and profile deletion orchestration."""
from datetime import timezone
from fastapi import HTTPException
from ..database.repository import AccountRepository as Repo
from ..security.encryption import decrypt_data
from ..utils.paths import profile_path
from ..utils.profile_storage import delete_profiles_by_uid
from .events import broadcast

_FIELDS = ("cookie", "token", "email", "mail_recovery", "token_hotmail", "client_id", "proxy", "profile_name")

def serialize(account, detail=False):
    result = {"id": account.id, "owner_username": account.user_id, "uid": account.uid}
    for name in _FIELDS:
        result[name] = getattr(account, name) or ""
    for name in ("password", "two_fa", "pass_mail"):
        try:
            value = decrypt_data(getattr(account, name))
        except ValueError:
            value = ""
        result["twofa_secret" if name == "two_fa" and not detail else name] = value
    result["login_status"] = {"LOGGED_IN": "logged_in", "ERROR": "failed"}.get(account.login_status, "not_logged_in")
    result["status"] = account.status.lower() if account.status_checked_at and account.status in ("LIVE", "DIE") else None
    result["last_login_at"] = account.last_login_at.replace(tzinfo=timezone.utc).isoformat() if account.last_login_at else None
    return result

def require_account(db, uid):
    account = Repo.get_by_uid(db, uid)
    if account is None:
        raise HTTPException(404, "Account not found")
    return account

def save_account(db, item):
    data = item.model_dump(exclude_unset=True, exclude={"owner_username"})
    data["profile_path"] = str(profile_path(item.uid))
    return Repo.upsert(db, data)

def import_accounts(db, items):
    imported, errors, uids = 0, [], []
    for item in items:
        try:
            save_account(db, item)
            imported += 1
            uids.append(item.uid)
        except Exception:
            db.rollback()
            errors.append({"uid": item.uid, "error": "Không thể lưu tài khoản"})
    broadcast("info", f"Đã import {imported} tài khoản")
    return {"imported": imported, "errors": errors}, list(dict.fromkeys(uids))

def delete_account(db, uid):
    from ..automation.browser_manager import get_profile_lock, _active_drivers, _active_drivers_lock
    from ..context import owner_context
    lock = get_profile_lock(uid)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "Profile đang được sử dụng")
    try:
        with _active_drivers_lock:
            drivers = [d for d, info in _active_drivers.items() if info.get("uid") == uid and info.get("owner") == owner_context.get()]
        for driver in drivers:
            try:
                if driver.window_handles:
                    raise HTTPException(409, "Hãy đóng Chrome trước khi xóa tài khoản")
            except HTTPException:
                raise
            except Exception:
                pass
        exists = Repo.get_by_uid(db, uid) is not None
        try:
            removed = delete_profiles_by_uid(uid)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(409, str(exc)) from exc
        deleted = Repo.delete(db, uid) if exists else False
        if not deleted and not removed:
            raise HTTPException(404, "Account not found")
        broadcast("info", f"Đã xóa tài khoản {uid}", uid=uid)
        return {"deleted": deleted, "profiles_deleted": removed}
    finally:
        lock.release()

def bulk_delete(db, uids):
    result = {"deleted": 0, "profiles_deleted": 0, "errors": []}
    for uid in uids:
        try:
            deleted = delete_account(db, uid)
            result["deleted"] += int(deleted["deleted"])
            result["profiles_deleted"] += len(deleted["profiles_deleted"])
        except Exception as exc:
            db.rollback()
            result["errors"].append({"uid": uid, "error": exc.detail if isinstance(exc, HTTPException) else "Không thể xóa tài khoản"})
    return result
