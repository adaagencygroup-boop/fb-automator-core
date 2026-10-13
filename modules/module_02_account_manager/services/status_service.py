"""Public profile checks, including incremental checks following import."""
import asyncio
from ..database.connection import SessionLocal
from ..database.repository import AccountRepository as Repo
from ..utils.facebook_profile_status import check_profile_status
from .events import broadcast

async def check_statuses(db, uids):
    known = {a.uid for a in Repo.get_all(db)}
    uids = list(dict.fromkeys(uid for uid in uids if uid in known))
    semaphore = asyncio.Semaphore(2)
    async def check(uid):
        async with semaphore:
            return uid, await asyncio.to_thread(check_profile_status, uid)
    statuses = dict(await asyncio.gather(*(check(uid) for uid in uids)))
    Repo.update_profile_statuses(db, statuses)
    broadcast("info", f"Đã kiểm tra {len(statuses)} UID", extra={"event": "account_statuses_updated", "statuses": statuses})
    return {"statuses": statuses, "live": sum(s == "live" for s in statuses.values()), "die": sum(s == "die" for s in statuses.values())}

async def check_imported(uids):
    db = SessionLocal()
    try:
        for start in range(0, len(uids), 20):
            await check_statuses(db, uids[start:start + 20])
        broadcast("success", "Hoàn tất kiểm tra sau import")
    except Exception:
        db.rollback()
        broadcast("error", "Kiểm tra sau import bị gián đoạn")
    finally:
        db.close()
