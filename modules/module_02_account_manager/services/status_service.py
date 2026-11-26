"""Public profile checks, including concurrent checks following import."""
import asyncio
import logging
import httpx
from ..database.connection import SessionLocal
from ..database.repository import AccountRepository as Repo
from ..utils.facebook_profile_status import (
    _DEFAULT_HEADERS,
    _check_in_isolated_browser,
    check_profile_status_http_async,
)
from .events import broadcast

logger = logging.getLogger(__name__)
_BROWSER_FALLBACK_CONCURRENCY = 4

async def check_statuses(db, uids):
    known = {a.uid for a in Repo.get_all(db)}
    uids = list(dict.fromkeys(uid for uid in uids if uid in known))
    browser_semaphore = asyncio.Semaphore(_BROWSER_FALLBACK_CONCURRENCY)
    limits = httpx.Limits(max_connections=None, max_keepalive_connections=100)
    async with httpx.AsyncClient(follow_redirects=True, headers=_DEFAULT_HEADERS, limits=limits) as client:
        async def check(uid):
            try:
                status = await check_profile_status_http_async(uid, client)
                if status is None and uid.isascii() and uid.isdigit():
                    async with browser_semaphore:
                        status = await asyncio.to_thread(_check_in_isolated_browser, uid)
                return uid, status
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
        summary = await check_statuses(db, uids)
        broadcast("success", f"Hoàn tất kiểm tra sau import: {summary['live']} Live, {summary['die']} Die, "
                  f"{summary['inconclusive']} chưa kết luận được")
    except Exception:
        db.rollback()
        broadcast("error", "Kiểm tra sau import bị gián đoạn")
    finally:
        db.close()
