"""Batch login uses bounded threads and per-worker database sessions."""
import asyncio
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
            try:
                result = run_login(uid, secret(account.password), secret(account.two_fa), account.cookie, account.proxy)
                Repo.update_login_status(db, uid, "logged_in" if result["success"] else "failed", result.get("profile_name"))
                if result.get("cookie"):
                    Repo.update_cookies(db, uid, result["cookie"])
                broadcast("success" if result["success"] else "error", f"Đăng nhập {'thành công' if result['success'] else 'thất bại'}: {uid}", uid=uid)
            except Exception:
                db.rollback()
                broadcast("error", f"Đăng nhập lỗi: {uid}", uid=uid)

async def login_batch(uids, threads):
    semaphore = asyncio.Semaphore(threads)
    async def run(uid):
        async with semaphore:
            if not runtime.stopping.is_set():
                await asyncio.wrap_future(runtime.submit(login_one, uid))
    await asyncio.gather(*(run(uid) for uid in uids))
    broadcast("success", "Hoàn tất đăng nhập tất cả tài khoản!", extra={"event": "account_login_finished"})
