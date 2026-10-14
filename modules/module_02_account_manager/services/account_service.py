"""Account CRUD, import and profile deletion orchestration."""
from datetime import timezone
from fastapi import HTTPException
from ..database.repository import AccountRepository as Repo
from ..database.models import Account
from ..database.fanpage_repository import FanpageRepository as Pages
from ..context import owner_context
from ..security.encryption import decrypt_data
from ..utils.paths import profile_path
from ..utils.profile_storage import delete_profiles_by_uid
from .events import broadcast

_FIELDS = ("cookie", "token", "email", "mail_recovery", "token_hotmail", "client_id", "proxy", "profile_name")
_FANPAGE_OWNER_CONFLICT = "Không thể xóa: Fanpage của UID này chưa xác định được chủ sở hữu giữa nhiều người dùng"

def serialize(account, detail=False):
    result = {"id": account.id, "owner_username": account.user_id, "user_id": account.user_id, "uid": account.uid}
    result["avatar_url"] = account.avatar_url or None
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
    data = item.model_dump(exclude_unset=True, exclude={"owner_username", "user_id"})
    data["profile_path"] = str(profile_path(item.uid))
    return Repo.upsert(db, data)

def save_single_account(db, item):
    from sqlalchemy.exc import IntegrityError
    from ..automation.browser_manager import get_profile_lock, _active_drivers, _active_drivers_lock
    from ..context import owner_context
    from ..utils.paths import account_key
    from .browser_service import _open_browser_pending, _open_browser_pending_lock
    from .login_service import _login_pending, _login_pending_lock
    original = item.original_uid
    if original is None:
        if item.create_only and Repo.get_by_uid(db, item.uid) is not None:
            raise HTTPException(409, "UID already exists")
        return save_account(db, item)
    locks, moved = [], False
    try:
        with _open_browser_pending_lock, _login_pending_lock:
            for uid in sorted(set((original, item.uid))):
                lock = get_profile_lock(uid)
                if account_key(uid) in _open_browser_pending or account_key(uid) in _login_pending or not lock.acquire(blocking=False):
                    raise HTTPException(409, "Profile is busy or queued")
                locks.append(lock)
        account = require_account(db, original)
        if original != item.uid:
            if Repo.get_by_uid(db, item.uid) is not None:
                raise HTTPException(409, "UID already exists")
            with _active_drivers_lock:
                drivers = [d for d, info in _active_drivers.items() if info.get("owner") == owner_context.get() and info.get("uid") in (original, item.uid)]
            for driver in drivers:
                try:
                    handles = driver.window_handles
                except Exception as exc:
                    raise HTTPException(409, "Cannot confirm Chrome is closed") from exc
                if handles:
                    raise HTTPException(409, "Close Chrome before changing UID")
            old_path, new_path = profile_path(original), profile_path(item.uid)
            if new_path.exists():
                raise HTTPException(409, "Destination profile already exists")
            if old_path.exists():
                old_path.rename(new_path)
                moved = True
        data = item.model_dump(exclude_unset=True, exclude={"owner_username", "original_uid"})
        data["profile_path"] = str(profile_path(item.uid))
        Repo.apply_fields(account, data)
        account.uid = item.uid
        if original != item.uid:
            account.avatar_url = None
        db.commit()
        return account
    except Exception as exc:
        db.rollback()
        if moved:
            try:
                new_path.rename(old_path)
            except Exception as restore_error:
                raise HTTPException(500, "Save failed and restoring the original profile failed") from restore_error
        if isinstance(exc, IntegrityError):
            raise HTTPException(409, "UID already exists") from exc
        if isinstance(exc, ValueError):
            raise HTTPException(422, str(exc)) from exc
        raise
    finally:
        for lock in reversed(locks):
            lock.release()

def import_accounts(db, items, skip_existing=False):
    added_count, updated_count, errors, uids = 0, 0, [], []
    skipped_count = 0
    for item in items:
        try:
            exists = Repo.get_by_uid(db, item.uid) is not None
            if exists and skip_existing:
                skipped_count += 1
                continue
            save_account(db, item)
            if exists:
                updated_count += 1
            else:
                added_count += 1
            uids.append(item.uid)
        except Exception:
            db.rollback()
            errors.append({"uid": item.uid, "error": "Không thể lưu tài khoản"})
    imported = added_count + updated_count
    broadcast("info", f"Đã import {imported} tài khoản (Thêm mới: {added_count}, Cập nhật: {updated_count})")
    return {
        "imported": imported,
        "skipped_count": skipped_count,
        "added_count": added_count,
        "updated_count": updated_count,
        "errors": errors,
    }, list(dict.fromkeys(uids))

def require_unambiguous_fanpage_owner(db, uid):
    require_account(db, uid)
    owners = db.query(Account.user_id).filter(Account.uid == uid).all()
    if any(owner != owner_context.get() for (owner,) in owners):
        raise HTTPException(409, _FANPAGE_OWNER_CONFLICT)


def delete_preview(db, uids):
    owned_uids = {
        uid for (uid,) in Repo.query(db).with_entities(Account.uid).filter(Account.uid.in_(uids)).all()
    }
    if any(uid not in owned_uids for uid in uids):
        raise HTTPException(404, "Account not found")
    counts = Pages.counts(db, uids)
    if counts:
        owners = db.query(Account.user_id).filter(Account.uid.in_(list(counts))).all()
        if any(owner != owner_context.get() for (owner,) in owners):
            raise HTTPException(409, _FANPAGE_OWNER_CONFLICT)
    return {"page_counts": {uid: counts.get(uid, 0) for uid in uids}, "pages_total": sum(counts.values())}


def delete_account(db, uid, delete_pages=False):
    from ..automation.browser_manager import get_profile_lock, _active_drivers, _active_drivers_lock
    lock = get_profile_lock(uid)
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "Không thể xóa: Tài khoản đang trong tiến trình chạy")
    try:
        with _active_drivers_lock:
            drivers = [d for d, info in _active_drivers.items() if info.get("uid") == uid and info.get("owner") == owner_context.get()]
        for driver in drivers:
            try:
                if driver.window_handles:
                    raise HTTPException(409, "Không thể xóa: Tài khoản đang trong tiến trình chạy. Hãy đóng Chrome rồi thử lại")
            except HTTPException:
                raise
            except Exception:
                pass
        exists = Repo.get_by_uid(db, uid) is not None
        page_ids = Pages.related_ids(db, uid)
        if page_ids:
            require_unambiguous_fanpage_owner(db, uid)
        try:
            removed = delete_profiles_by_uid(uid)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(409, str(exc)) from exc
        affected_pages = Pages.remove_links(db, page_ids, delete_pages)
        deleted = Repo.delete(db, uid, commit=False) if exists else False
        if not deleted and not removed:
            raise HTTPException(404, "Account not found")
        db.commit()
        broadcast("info", f"Đã xóa tài khoản {uid}", uid=uid)
        return {
            "deleted": deleted, "profiles_deleted": removed,
            "pages_deleted": affected_pages if delete_pages else 0,
            "pages_unlinked": 0 if delete_pages else affected_pages,
        }
    except Exception:
        db.rollback()
        raise
    finally:
        lock.release()

def bulk_delete(db, uids, delete_pages=False):
    result = {"deleted": 0, "profiles_deleted": 0, "pages_deleted": 0, "pages_unlinked": 0, "deleted_uids": [], "errors": []}
    for uid in uids:
        try:
            deleted = delete_account(db, uid, delete_pages=delete_pages)
            result["deleted"] += int(deleted["deleted"])
            result["profiles_deleted"] += len(deleted["profiles_deleted"])
            result["pages_deleted"] += deleted["pages_deleted"]
            result["pages_unlinked"] += deleted["pages_unlinked"]
            result["deleted_uids"].append(uid)
        except Exception as exc:
            db.rollback()
            result["errors"].append({"uid": uid, "error": exc.detail if isinstance(exc, HTTPException) else "Không thể xóa tài khoản"})
    return result
