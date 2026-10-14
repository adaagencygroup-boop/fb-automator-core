"""Batch login uses bounded threads and per-worker database sessions."""
import asyncio
import threading
from ..utils.paths import account_key
from fastapi import HTTPException

_login_pending = set()
_login_pending_lock = threading.Lock()
from ..database.connection import SessionLocal
from ..database.repository import AccountRepository as Repo
from ..security.encryption import decrypt_data
from . import runtime
from .events import broadcast

def login_one(uid):
    from ..automation.browser_manager import get_profile_lock
    from ..automation.login_flow import run_login
    with get_profile_lock(uid):
        if runtime.stopping.is_set():
            return
        with SessionLocal() as db:
            account = Repo.get_by_uid(db, uid)
            if account is None:
                return
            def secret(value):
                try:
                    return decrypt_data(value)
                except ValueError:
                    return ""
            stage = "đăng nhập"
            try:
                result = run_login(uid, secret(account.password), secret(account.two_fa), account.cookie, account.proxy)
                stage = "lưu kết quả đăng nhập vào DB"
                Repo.update_login_status(db, uid, "logged_in" if result["success"] else "failed", result.get("profile_name"), avatar_url=result.get("avatar_url"))
                stage = "lưu cookie vào DB"
                if result.get("cookie"):
                    Repo.update_cookies(db, uid, result["cookie"])
                broadcast("success" if result["success"] else "error", f"Đăng nhập {'thành công' if result['success'] else 'thất bại'}: {uid}", uid=uid)
            except Exception as exc:
                db.rollback()
                reason = "DB đã hết kết nối khả dụng" if "EMAXCONNSESSION" in str(exc) else type(exc).__name__
                broadcast("error", f"Lỗi {stage}: {uid} ({reason})", uid=uid)

async def login_batch(uids, threads):
    semaphore = asyncio.Semaphore(threads)
    async def run(uid):
        async with semaphore:
            if not runtime.stopping.is_set():
                await asyncio.wrap_future(runtime.submit(login_one, uid))
    from ..automation.browser_manager import get_profile_lock
    keys = [account_key(uid) for uid in uids]
    with _login_pending_lock:
        if any(key in _login_pending or get_profile_lock(uid).locked() for key, uid in zip(keys, uids)):
            raise HTTPException(409, "Profile is busy or queued")
        _login_pending.update(keys)
    try:
        await asyncio.gather(*(run(uid) for uid in uids))
    finally:
        with _login_pending_lock:
            _login_pending.difference_update(keys)
    broadcast("success", "Hoàn tất đăng nhập tất cả tài khoản!", extra={"event": "account_login_finished"})
