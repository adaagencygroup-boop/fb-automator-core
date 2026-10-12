"""
routes.py (TẠM)
API tài khoản tạm để test luồng Tab 1 khi Module 02 (Quản lý tài khoản) chưa hoàn thiện. Bê từ repo cũ.
  POST   /api/farm/accounts/import              Nhập tài khoản (mã hóa mật khẩu / 2FA theo HWID)
  GET    /api/farm/accounts                     Danh sách (KHÔNG trả mật khẩu / 2FA / cookie)
  POST   /api/farm/accounts/check-status        Kiểm tra Live / Die qua trang profile công khai
  POST   /api/farm/accounts/login               Đăng nhập hàng loạt
  POST   /api/farm/accounts/open-browser        Mở Chrome live của nick (tự đăng nhập nếu được)
  POST   /api/farm/accounts/{uid}/sync-cookies  Đồng bộ cookie từ Chrome đang mở / profile
  DELETE /api/farm/accounts/{uid}               Xóa tài khoản + thư mục profile
"""
import asyncio
import logging
import os
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from modules.module_03_acc_farm import adapters
from modules.module_03_acc_farm._temp.local_db import AccountRepo, SessionLocal
from modules.module_03_acc_farm._temp.profile_status import check_profile_status
from modules.module_03_acc_farm._temp.profile_storage import delete_profiles_by_uid
from modules.module_03_acc_farm.browser.encryption import encrypt
from modules.module_03_acc_farm.browser.paths import get_profile_path

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/farm/accounts", tags=["Module 03 - Tài khoản tạm"])
executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="farm-acc")

_open_browser_pending = set()
_open_browser_pending_lock = threading.Lock()


def broadcast(level: str, message: str, uid: Optional[str] = None):
    adapters.emit_log(level, message, uid=uid)


# ─────────────────────── SCHEMAS ────────────────────────────

class AccountImportItem(BaseModel):
    uid: str
    password: str = ""
    two_fa: Optional[str] = None
    cookie: Optional[str] = None
    token: Optional[str] = None
    email: Optional[str] = None
    pass_mail: Optional[str] = None
    mail_recovery: Optional[str] = None
    token_hotmail: Optional[str] = None
    client_id: Optional[str] = None
    proxy: Optional[str] = None


class ImportRequest(BaseModel):
    accounts: List[AccountImportItem]
    check_status: bool = False


class UidsRequest(BaseModel):
    uids: List[str]


class LoginRequest(BaseModel):
    uids: List[str]
    threads: int = 3


class OpenBrowserRequest(BaseModel):
    uid: str


def _clean_uid(uid: str) -> str:
    uid = str(uid or "").strip()
    if not uid.isascii() or not uid.isalnum() or len(uid) > 50:
        raise HTTPException(status_code=400, detail=f"UID không hợp lệ: {uid[:50]}")
    return uid


# ─────────────────────── IMPORT / LIST ────────────────────────────

async def _check_imported_account_statuses(uids: List[str]):
    """Kiểm tra Live / Die các UID vừa import, sau khi đã trả response."""
    semaphore = asyncio.Semaphore(2)
    checked = live = die = 0

    async def check(uid: str):
        async with semaphore:
            try:
                return uid, await asyncio.to_thread(check_profile_status, uid)
            except Exception as exc:
                logger.warning(f"[{uid}] Profile status check failed: {exc}")
                return uid, "die"

    db = SessionLocal()
    try:
        for start in range(0, len(uids), 20):
            batch = dict(await asyncio.gather(*(check(uid) for uid in uids[start:start + 20])))
            AccountRepo.update_profile_statuses(db, batch)
            checked += len(batch)
            live += sum(status == "live" for status in batch.values())
            die += sum(status == "die" for status in batch.values())
            broadcast("info", f"Đã kiểm tra Live/Die sau import: {checked}/{len(uids)} UID")
        broadcast("success", f"Hoàn tất kiểm tra sau import: {live} Live, {die} Die")
    except Exception as exc:
        logger.exception(f"Import status check stopped: {exc}")
        broadcast("error", f"Kiểm tra Live/Die sau import bị gián đoạn sau {checked}/{len(uids)} UID")
    finally:
        db.close()


@router.post("/import")
async def import_accounts(req: ImportRequest, background_tasks: BackgroundTasks):
    """Nhập danh sách tài khoản Facebook vào DB local (mã hóa mật khẩu / 2FA / mật khẩu mail)."""
    if len(req.accounts) > 100:
        raise HTTPException(status_code=400, detail="Mỗi lần import cho phép tối đa 100 tài khoản.")
    hwid = await asyncio.to_thread(adapters.get_hwid)
    imported_uids, errors = [], []
    db = SessionLocal()
    try:
        for item in req.accounts:
            try:
                uid = _clean_uid(item.uid)
                data = {
                    "uid": uid,
                    "password": encrypt(item.password, hwid) if item.password else "",
                    "two_fa": encrypt(item.two_fa, hwid) if item.two_fa else None,
                    "cookie": item.cookie,
                    "token": item.token,
                    "email": item.email,
                    "pass_mail": encrypt(item.pass_mail, hwid) if item.pass_mail else None,
                    "mail_recovery": item.mail_recovery,
                    "token_hotmail": item.token_hotmail,
                    "client_id": item.client_id,
                    "proxy": (item.proxy or "").strip() or None,
                    "profile_path": get_profile_path(uid),
                    "login_status": "not_logged_in",
                }
                AccountRepo.upsert(db, data)
                imported_uids.append(uid)
            except HTTPException as e:
                errors.append({"uid": str(item.uid)[:50], "error": e.detail})
            except Exception as e:
                db.rollback()
                logger.error(f"Import failed for UID {item.uid}: {e}")
                errors.append({"uid": str(item.uid)[:50], "error": "Lưu tài khoản thất bại"})
    finally:
        db.close()

    unique_uids = list(dict.fromkeys(imported_uids))
    broadcast("success", f"Đã import {len(unique_uids)} tài khoản vào DB local")
    if req.check_status and unique_uids:
        background_tasks.add_task(_check_imported_account_statuses, unique_uids)
    return {"imported": len(unique_uids), "errors": errors, "checking": len(unique_uids) if req.check_status else 0}


@router.get("")
async def list_accounts():
    """Danh sách tài khoản; không trả mật khẩu, 2FA, cookie, token."""
    db = SessionLocal()
    try:
        accounts = AccountRepo.get_all(db)
        return [{
            "id": a.id,
            "uid": a.uid,
            "profile_name": a.profile_name or "",
            "has_password": bool(a.password),
            "has_2fa": bool(a.two_fa),
            "has_cookie": bool(a.cookie),
            "has_proxy": bool(a.proxy),
            "email": a.email or "",
            "login_status": a.login_status,
            "status": a.status if a.status_checked_at and a.status in ("live", "die") else None,
            "last_login_at": a.last_login_at.replace(tzinfo=timezone.utc).isoformat() if a.last_login_at else None,
        } for a in accounts]
    finally:
        db.close()


@router.post("/check-status")
async def check_account_statuses(req: UidsRequest):
    """Kiểm tra Live / Die các UID đã lưu qua trang profile công khai."""
    db = SessionLocal()
    try:
        saved = {a.uid for a in AccountRepo.get_all(db)}
        uids = list(dict.fromkeys(u for u in req.uids if u in saved))
        semaphore = asyncio.Semaphore(2)

        async def check(uid: str):
            async with semaphore:
                return uid, await asyncio.to_thread(check_profile_status, uid)

        statuses = dict(await asyncio.gather(*(check(uid) for uid in uids)))
        AccountRepo.update_profile_statuses(db, statuses)
    finally:
        db.close()
    live_count = sum(s == "live" for s in statuses.values())
    die_count = sum(s == "die" for s in statuses.values())
    broadcast("info", f"Đã kiểm tra {len(statuses)} UID: {live_count} Live, {die_count} Die")
    return {"statuses": statuses, "live": live_count, "die": die_count}


# ─────────────────────── ĐĂNG NHẬP ────────────────────────────

def _login_worker(uid: str):
    from modules.module_03_acc_farm.browser.login_flow import run_login
    from modules.module_03_acc_farm.browser.manager import get_profile_lock

    with get_profile_lock(uid):
        account = adapters.get_account(uid)
        if not account:
            broadcast("error", f"Không tìm thấy tài khoản UID: {uid}", uid=uid)
            return
        broadcast("info", f"Đang đăng nhập UID: {uid}...", uid=uid)
        password, two_fa = adapters.get_credentials(uid)
        result = run_login(
            uid=uid, password=password, two_fa=two_fa, cookie=account["cookie"],
            proxy=account["proxy"], expected_name=account["profile_name"],
        )
        if result["success"]:
            adapters.set_login_status(uid, "logged_in", result.get("profile_name", ""))
            broadcast("success", f"Đăng nhập thành công: {uid} — {result.get('profile_name', '')}", uid=uid)
        else:
            adapters.set_login_status(uid, "checkpoint" if result.get("checkpoint") else "failed")
            broadcast("error", f"Đăng nhập thất bại: {uid} — {result['error']}", uid=uid)


@router.post("/login")
async def login_accounts(req: LoginRequest, background_tasks: BackgroundTasks):
    uids = list(dict.fromkeys(_clean_uid(u) for u in req.uids))
    threads = max(1, min(int(req.threads or 1), 5))
    broadcast("info", f"Bắt đầu đăng nhập {len(uids)} tài khoản ({threads} luồng)...")

    async def run():
        loop = asyncio.get_running_loop()
        semaphore = asyncio.Semaphore(threads)

        async def one(uid):
            async with semaphore:
                try:
                    await loop.run_in_executor(executor, _login_worker, uid)
                except Exception as e:
                    logger.exception(f"[{uid}] Login worker crashed: {e}")

        await asyncio.gather(*(one(uid) for uid in uids))
        broadcast("success", "Hoàn tất đăng nhập tất cả tài khoản!")

    background_tasks.add_task(run)
    return {"started": True, "count": len(uids)}


# ─────────────────────── MỞ CHROME LIVE ────────────────────────────

def _watch_open_browser_login(driver, uid: str, checks: int = 150, interval: float = 2.0):
    """Theo dõi tối đa 5 phút khi người dùng tự đăng nhập trên Chrome live; tự lưu cookie khi thành công."""
    from modules.module_03_acc_farm.browser.login_flow import _check_logged_in, _get_profile_name, is_checkpoint_url
    from modules.module_03_acc_farm.browser.manager import extract_cookies_as_string

    for _ in range(checks):
        time.sleep(interval)
        try:
            if not getattr(driver, "window_handles", None):
                logger.info(f"[{uid}] Trình duyệt live đã được đóng.")
                return
            try:
                curr_url = driver.current_url or ""
            except Exception:
                return
            if is_checkpoint_url(curr_url):
                adapters.set_login_status(uid, "checkpoint")
                broadcast("error", f"Đăng nhập lỗi (checkpoint): {uid}", uid=uid)
                return
            if not _check_logged_in(driver):
                continue
            profile_name = _get_profile_name(driver)
            c_str = extract_cookies_as_string(driver)
            adapters.set_login_status(uid, "logged_in", profile_name)
            if c_str and "c_user" in c_str:
                adapters.save_cookie(uid, c_str)
            broadcast("success", f"Đăng nhập thành công: Nick {uid} đã sẵn sàng và lưu cookie!", uid=uid)
            return
        except Exception as exc:
            logger.debug(f"[{uid}] Live watcher dừng: {exc}")
            return


def _open_live_browser_worker(uid: str):
    """Mở Chrome với profile của nick, tự đăng nhập nếu được và giữ trình duyệt trên màn hình."""
    from modules.module_03_acc_farm.browser.login_flow import (
        _check_logged_in, _get_profile_name, _handle_2fa, _handle_post_login_popups,
        _is_2fa_required, _submit_login_form, _try_cookie_login, is_checkpoint_url,
    )
    from modules.module_03_acc_farm.browser.manager import create_driver, extract_cookies_as_string, get_profile_lock, human_sleep

    profile_lock = get_profile_lock(uid)
    if not profile_lock.acquire(timeout=5):
        broadcast("warning", f"Tài khoản {uid} đang bận xử lý bởi tiến trình khác, vui lòng chờ!", uid=uid)
        with _open_browser_pending_lock:
            _open_browser_pending.discard(uid)
        return

    try:
        account = adapters.get_account(uid)
        if not account:
            broadcast("error", f"Không tìm thấy thông tin tài khoản UID: {uid}")
            return
        broadcast("info", f"Đang mở trình duyệt Chrome cho nick: {uid}...")
        driver = create_driver(uid, detach=True, proxy=account["proxy"], scope="live")
        driver.get("https://www.facebook.com")
        human_sleep(2.0, 3.0)

        attempted_login = False
        if not _check_logged_in(driver):
            # Nick đang ở checkpoint thì bơm cookie cũng không qua được, chỉ thêm một lượt bị Facebook chặn
            if account["cookie"] and not is_checkpoint_url(driver.current_url or ""):
                attempted_login = True
                try:
                    _try_cookie_login(driver, account["cookie"])
                except Exception as cookie_error:
                    logger.warning(f"[{uid}] Cookie login attempt failed: {cookie_error}")

            password, two_fa = adapters.get_credentials(uid)
            if not _check_logged_in(driver) and password and not is_checkpoint_url(driver.current_url or ""):
                attempted_login = True
                try:
                    _submit_login_form(driver, uid, password, account["profile_name"])
                    if _is_2fa_required(driver) and two_fa:
                        _handle_2fa(driver, two_fa)
                except Exception as e:
                    logger.warning(f"[{uid}] Auto-login form attempt note: {e}")
            _handle_post_login_popups(driver)

        if _check_logged_in(driver):
            profile_name = _get_profile_name(driver)
            adapters.set_login_status(uid, "logged_in", profile_name)
            c_str = extract_cookies_as_string(driver)
            if c_str and "c_user" in c_str:
                adapters.save_cookie(uid, c_str)
            broadcast("success", f"Đăng nhập thành công: Nick {uid} đã sẵn sàng!", uid=uid)
        elif is_checkpoint_url(driver.current_url or ""):
            adapters.set_login_status(uid, "checkpoint")
            broadcast("warning", f"Nick {uid} đang ở checkpoint, cần tự xác minh trên Chrome vừa mở.", uid=uid)
        else:
            adapters.set_login_status(uid, "failed" if attempted_login else "not_logged_in")
            broadcast("warning", f"Trình duyệt nick {uid} đã mở. Bạn có thể tự đăng nhập trên Chrome, hệ thống sẽ tự bắt cookie.")
            threading.Thread(target=_watch_open_browser_login, args=(driver, uid), daemon=True).start()
    except Exception as e:
        logger.exception(f"Lỗi mở trình duyệt cho {uid}: {e}")
        broadcast("error", f"Không thể mở trình duyệt cho {uid}: {e}")
    finally:
        profile_lock.release()
        with _open_browser_pending_lock:
            _open_browser_pending.discard(uid)


@router.post("/open-browser")
async def open_live_browser(req: OpenBrowserRequest):
    from modules.module_03_acc_farm.browser.manager import get_profile_lock

    uid = _clean_uid(req.uid)
    if get_profile_lock(uid).locked():
        raise HTTPException(status_code=409, detail=f"Tài khoản {uid} đang bận xử lý bởi tiến trình khác, vui lòng chờ vài giây!")
    with _open_browser_pending_lock:
        if uid in _open_browser_pending:
            raise HTTPException(status_code=409, detail=f"Tài khoản {uid} đang trong hàng đợi mở trình duyệt!")
        _open_browser_pending.add(uid)
    executor.submit(_open_live_browser_worker, uid)
    return {"started": True, "uid": uid}


# ─────────────────────── COOKIE / XÓA ────────────────────────────

@router.post("/{uid}/sync-cookies")
async def sync_account_cookies(uid: str):
    """Trích xuất cookie từ Chrome đang mở, hoặc kiểm tra profile trên đĩa còn phiên không."""
    from modules.module_03_acc_farm.browser.manager import _active_drivers, _active_drivers_lock, extract_cookies_as_string

    uid = _clean_uid(uid)
    extracted = None
    with _active_drivers_lock:
        drivers = [d for d, info in _active_drivers.items() if isinstance(info, dict) and info.get("uid") == uid]
    for d in drivers:
        try:
            c = extract_cookies_as_string(d)
            if c and "c_user=" in c:
                extracted = c
                break
        except Exception:
            pass

    if extracted:
        adapters.save_cookie(uid, extracted)
        adapters.set_login_status(uid, "logged_in")
        broadcast("success", f"Đã đồng bộ cookie từ trình duyệt cho UID {uid}", uid=uid)
        return {"success": True, "uid": uid, "source": "active_driver"}

    profile_dir = get_profile_path(uid)
    cookie_db_path = os.path.join(profile_dir, "Default", "Network", "Cookies")
    if not os.path.exists(cookie_db_path):
        cookie_db_path = os.path.join(profile_dir, "Default", "Cookies")
    if os.path.exists(cookie_db_path):
        try:
            conn = sqlite3.connect(f"file:{cookie_db_path}?mode=ro", uri=True)
            try:
                names = [r[0] for r in conn.execute(
                    "SELECT name FROM cookies WHERE host_key LIKE '%facebook.com%'").fetchall()]
            finally:
                conn.close()
            if "c_user" in names:
                adapters.set_login_status(uid, "logged_in")
                broadcast("info", f"Profile Chrome có chứa phiên c_user cho UID {uid}.", uid=uid)
                return {"success": True, "uid": uid, "source": "profile_disk"}
        except Exception as e:
            logger.debug(f"Read profile cookies db error: {e}")
    return {"success": False, "uid": uid, "message": "Không tìm thấy phiên đang hoạt động."}


@router.delete("/{uid}")
async def delete_account(uid: str):
    """Xóa tài khoản và thư mục profile Chrome của UID."""
    uid = _clean_uid(uid)
    db = SessionLocal()
    try:
        exists = AccountRepo.get_by_uid(db, uid) is not None
        try:
            deleted_profiles = delete_profiles_by_uid(uid)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=500, detail=f"Không thể xóa thư mục profile của UID {uid}: {exc}") from exc
        deleted = AccountRepo.delete(db, uid) if exists else False
    finally:
        db.close()
    if not deleted and not deleted_profiles:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    broadcast("info", f"Đã xóa tài khoản và/hoặc profile UID: {uid}")
    return {"deleted": deleted, "profiles_deleted": len(deleted_profiles)}
