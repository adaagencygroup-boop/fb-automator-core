"""Public profile checks, including incremental checks following import."""
import asyncio
import logging
from ..database.connection import SessionLocal
from ..database.repository import AccountRepository as Repo
from ..utils.facebook_profile_status import check_profile_status
from .events import broadcast

logger = logging.getLogger(__name__)

async def check_statuses(db, uids):
    known = {a.uid for a in Repo.get_all(db)}
    uids = list(dict.fromkeys(uid for uid in uids if uid in known))
    semaphore = asyncio.Semaphore(2)
    async def check(uid):
        async with semaphore:
            try:
                return uid, await asyncio.to_thread(check_profile_status, uid)
            except Exception:
                logger.warning("Profile check failed for UID %s", uid, exc_info=True)
                return uid, None
    results = await asyncio.gather(*(check(uid) for uid in uids))
    statuses = {uid: status for uid, status in results if status in ("live", "die")}
    summary = {"statuses": statuses, "live": sum(s == "live" for s in statuses.values()),
               "die": sum(s == "die" for s in statuses.values()), "inconclusive": len(results) - len(statuses)}
    Repo.update_profile_statuses(db, statuses)
    broadcast("info", f"Đã kiểm tra {len(results)} UID: {summary['live']} Live, {summary['die']} Die, "
              f"{summary['inconclusive']} chưa kết luận được", extra={"event": "account_statuses_updated", **summary})
    return summary

async def check_imported(uids):
    db = SessionLocal()
    try:
        totals = {"live": 0, "die": 0, "inconclusive": 0}
        for start in range(0, len(uids), 20):
            summary = await check_statuses(db, uids[start:start + 20])
            for key in totals:
                totals[key] += summary[key]
        broadcast("success", f"Hoàn tất kiểm tra sau import: {totals['live']} Live, {totals['die']} Die, "
                  f"{totals['inconclusive']} chưa kết luận được")
    except Exception:
        db.rollback()
        broadcast("error", "Kiểm tra sau import bị gián đoạn")
    finally:
        db.close()
