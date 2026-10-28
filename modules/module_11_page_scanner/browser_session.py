"""
Khóa runtime browser page_scanner: 1 job Selenium / 1 account_uid.
Tái sử dụng acquire/release từ scanner; BUSY nếu acc đang chạy phiên khác.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# account_uid -> {session_id, job_type}
_ACCOUNT_JOB_LOCK = threading.Lock()
_ACCOUNT_ACTIVE_JOBS: Dict[str, Dict[str, Any]] = {}

STALE_RUNNING_MINUTES = 180  # 3h không heartbeat → đánh FAILED khi startup


class AccountBusyError(RuntimeError):
    """Acc đang chạy phiên Selenium khác trong scope page_scanner."""

    def __init__(self, account_uid: str, active_session_id: int, job_type: str):
        self.account_uid = account_uid
        self.active_session_id = int(active_session_id)
        self.job_type = job_type or "UNKNOWN"
        super().__init__(
            f"Acc {account_uid} đang chạy phiên #{self.active_session_id} ({self.job_type})"
        )


def try_acquire_account_job(
    account_uid: str,
    session_id: int,
    job_type: str,
) -> None:
    """Đăng ký acc→session. Raise AccountBusyError nếu trùng acc khác session."""
    uid = str(account_uid or "").strip()
    if not uid:
        raise ValueError("account_uid bắt buộc để khóa browser")
    with _ACCOUNT_JOB_LOCK:
        cur = _ACCOUNT_ACTIVE_JOBS.get(uid)
        if cur and int(cur.get("session_id") or 0) != int(session_id):
            raise AccountBusyError(
                uid,
                int(cur["session_id"]),
                str(cur.get("job_type") or ""),
            )
        _ACCOUNT_ACTIVE_JOBS[uid] = {
            "session_id": int(session_id),
            "job_type": str(job_type or ""),
        }


def release_account_job(account_uid: str, session_id: int) -> None:
    """Gỡ khóa nếu đúng session đang giữ."""
    uid = str(account_uid or "").strip()
    if not uid:
        return
    with _ACCOUNT_JOB_LOCK:
        cur = _ACCOUNT_ACTIVE_JOBS.get(uid)
        if cur and int(cur.get("session_id") or 0) == int(session_id):
            _ACCOUNT_ACTIVE_JOBS.pop(uid, None)


def get_active_job_for_account(account_uid: str) -> Optional[Dict[str, Any]]:
    uid = str(account_uid or "").strip()
    if not uid:
        return None
    with _ACCOUNT_JOB_LOCK:
        cur = _ACCOUNT_ACTIVE_JOBS.get(uid)
        return dict(cur) if cur else None


def acquire_browser(
    target_uid: str,
    owner: str,
    proxy: Any,
    cookie_str: str,
    headless: bool = False,
    allow_direct_fallback: bool = True,
) -> Tuple[Any, bool, Any, bool]:
    """Wrapper — keep_browser chỉ tái dùng khi cùng uid (logic trong scanner)."""
    from .scanner import _acquire_page_scanner_browser

    return _acquire_page_scanner_browser(
        target_uid=target_uid,
        owner=owner,
        proxy=proxy,
        cookie_str=cookie_str,
        headless=headless,
        allow_direct_fallback=allow_direct_fallback,
    )


def release_browser(
    stop_reason: str,
    keep_browser: bool,
    acquired_lock: bool,
    lock: Any,
) -> None:
    from .scanner import _release_page_scanner_browser

    _release_page_scanner_browser(
        stop_reason=stop_reason,
        keep_browser=keep_browser,
        acquired_lock=acquired_lock,
        lock=lock,
    )


def bump_account_usage(account_uid: str, action: str, delta: int = 1) -> int:
    """Tăng used_count theo (acc, ngày, action). Trả về used_count sau khi cộng."""
    from core.database.connection import db

    uid = str(account_uid or "").strip()
    act = str(action or "").strip().upper() or "PAGE_VISIT"
    if not uid:
        return 0
    try:
        db.execute(
            """
            INSERT INTO page_scanner_account_usage (account_uid, usage_date, action, used_count)
            VALUES (%s, CURRENT_DATE, %s, %s)
            ON CONFLICT (account_uid, usage_date, action)
            DO UPDATE SET used_count = page_scanner_account_usage.used_count + EXCLUDED.used_count
            """,
            (uid, act, max(1, int(delta))),
        )
        row = db.fetch_one(
            """
            SELECT used_count FROM page_scanner_account_usage
            WHERE account_uid = %s AND usage_date = CURRENT_DATE AND action = %s
            """,
            (uid, act),
        )
        return int((row or {}).get("used_count") or 0)
    except Exception as exc:
        logger.debug(f"[browser_session] bump_account_usage: {exc}")
        return 0


def get_account_usage_today(account_uid: str, action: str) -> int:
    from core.database.connection import db

    uid = str(account_uid or "").strip()
    act = str(action or "").strip().upper()
    if not uid:
        return 0
    try:
        row = db.fetch_one(
            """
            SELECT used_count FROM page_scanner_account_usage
            WHERE account_uid = %s AND usage_date = CURRENT_DATE AND action = %s
            """,
            (uid, act),
        )
        return int((row or {}).get("used_count") or 0)
    except Exception:
        return 0


def mark_stale_running_sessions(max_age_minutes: int = STALE_RUNNING_MINUTES) -> int:
    """
    Startup: phiên RUNNING/PAUSED quá lâu (daemon chết) → FAILED + ERROR.
    Trả về số phiên đã đánh dấu.
    """
    from core.database.connection import db

    rows = None
    minutes = max(30, int(max_age_minutes))
    try:
        if getattr(db, "_is_postgres", False):
            rows = db.fetch_all(
                """
                SELECT id FROM page_scan_sessions
                WHERE status IN ('RUNNING', 'PAUSED')
                  AND COALESCE(finished_at, started_at, created_at)
                      < (NOW() - (%s * INTERVAL '1 minute'))
                """,
                (minutes,),
            )
        else:
            rows = db.fetch_all(
                """
                SELECT id FROM page_scan_sessions
                WHERE status IN ('RUNNING', 'PAUSED')
                  AND datetime(COALESCE(finished_at, started_at, created_at))
                      < datetime('now', ?)
                """,
                (f"-{minutes} minutes",),
            )
    except Exception as exc:
        logger.debug(f"[browser_session] mark_stale query: {exc}")
        return 0

    count = 0
    for row in rows or []:
        sid = int(row["id"])
        try:
            db.execute(
                """
                UPDATE page_scan_sessions
                SET status = 'FAILED',
                    stop_reason = 'ERROR',
                    error_message = COALESCE(error_message, 'Stale session after restart'),
                    finished_at = NOW()
                WHERE id = %s AND status IN ('RUNNING', 'PAUSED')
                """,
                (sid,),
            )
            count += 1
            logger.warning(f"[browser_session] Marked stale session #{sid} as FAILED")
        except Exception as exc:
            logger.debug(f"[browser_session] mark stale #{sid}: {exc}")
    return count
