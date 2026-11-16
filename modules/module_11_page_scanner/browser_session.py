"""
Khóa runtime browser page_scanner: 1 job Selenium / 1 account_uid.
Tái sử dụng acquire/release từ scanner; BUSY nếu acc đang chạy phiên khác.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# account_uid -> {session_id, job_type}
_ACCOUNT_JOB_LOCK = threading.Lock()
_ACCOUNT_ACTIVE_JOBS: Dict[str, Dict[str, Any]] = {}

# Phiên có heartbeat_at: quá 120s không heartbeat (engine ghi mỗi 30s) → mồ côi.
STALE_HEARTBEAT_SECONDS = 120
# Phiên cũ chưa có heartbeat_at (tạo bởi engine bản cũ, có thể vẫn đang chạy ở máy khác
# dùng chung DB) → giữ quy tắc cũ: quá 3h tính từ lúc bắt đầu.
STALE_RUNNING_MINUTES = 180
ORPHAN_ERROR_MESSAGE = "Phiên bị gián đoạn (app đã tắt hoặc mất kết nối) — không còn tiến trình chạy"


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


def get_busy_account_uids() -> Set[str]:
    """UID các acc đang có job Selenium chạy (không được đóng Chrome của chúng)."""
    with _ACCOUNT_JOB_LOCK:
        return set(_ACCOUNT_ACTIVE_JOBS.keys())


def close_browsers_for_stopped_sessions(
    account_uids: Iterable[str],
    stopped_session_ids: Iterable[int],
) -> List[str]:
    """
    Dừng khẩn cấp: chỉ đóng Chrome page_scanner của acc thuộc các phiên bị dừng.
    Bỏ qua acc đang chạy job của phiên KHÁC (vd bấm dừng phiên cũ khi acc đã sang job mới).
    """
    from core.browser import close_scoped_active_drivers

    stopped = {int(s) for s in stopped_session_ids}
    targets: Set[str] = set()
    for raw in account_uids:
        uid = str(raw or "").strip()
        if not uid:
            continue
        active = get_active_job_for_account(uid)
        if active is None or int(active.get("session_id") or 0) in stopped:
            targets.add(uid)
    if not targets:
        return []
    return close_scoped_active_drivers(scope="page_scanner", force=True, uids=targets)


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
    target_uid: str,
) -> None:
    from .scanner import _release_page_scanner_browser

    _release_page_scanner_browser(
        stop_reason=stop_reason,
        keep_browser=keep_browser,
        acquired_lock=acquired_lock,
        lock=lock,
        target_uid=target_uid,
    )


def _acc_uid(account: Dict[str, Any]) -> str:
    return str((account or {}).get("uid") or "").strip()


def order_accounts_free_first(accounts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Giữ thứ tự người dùng chọn nhưng bắt đầu từ acc đầu tiên đang rảnh.
    Mọi acc đều bận → AccountBusyError (API trả 409) theo acc đầu tiên.
    """
    accounts = [a for a in (accounts or []) if _acc_uid(a)]
    for i, acc in enumerate(accounts):
        if get_active_job_for_account(_acc_uid(acc)) is None:
            return accounts[i:] + accounts[:i]
    if not accounts:
        return []
    busy = get_active_job_for_account(_acc_uid(accounts[0])) or {}
    raise AccountBusyError(
        _acc_uid(accounts[0]), int(busy.get("session_id") or 0), str(busy.get("job_type") or "")
    )


class AccountRotation:
    """
    Xoay vòng nhiều acc trong 1 phiên Selenium (POST_SCAN / FOLLOW):
    - rotate(): đóng Chrome acc hiện tại, mở acc kế tiếp đang rảnh (bỏ acc bận / mở Chrome lỗi).
    - mark_dead=True (checkpoint): acc cũ không bao giờ được dùng lại trong phiên.
    - count: số đơn vị (bài / page) đã quét trên acc hiện tại — reset khi đổi acc.
    Slot BUSY của acc đầu tiên do start_*_background giữ sẵn; các acc sau được giữ khi đổi sang.
    """

    def __init__(
        self,
        session_id: int,
        job_type: str,
        accounts: List[Dict[str, Any]],
        owner_key: str,
        headless: bool = False,
        allow_direct_fallback: bool = True,
        log=None,
    ):
        self.accounts = [a for a in (accounts or []) if _acc_uid(a)]
        if not self.accounts:
            raise ValueError("Cần ít nhất 1 tài khoản để quét")
        self.session_id = int(session_id)
        self.job_type = job_type
        self.owner_key = owner_key
        self.headless = headless
        self.allow_direct_fallback = allow_direct_fallback
        self._log = log or (lambda message, level="info": None)
        self.idx = 0
        self.dead: Set[str] = set()
        self.count = 0
        self.driver = None
        self.lock = None
        self.acquired_lock = False

    @property
    def account(self) -> Dict[str, Any]:
        return self.accounts[self.idx]

    @property
    def uid(self) -> str:
        return _acc_uid(self.account)

    @property
    def can_rotate(self) -> bool:
        return len(self.accounts) > 1

    def open(self):
        """Mở / tái dùng Chrome cho acc hiện tại."""
        acc = self.account
        self.driver, _created, self.lock, self.acquired_lock = acquire_browser(
            target_uid=self.uid,
            owner=acc.get("user_id") or self.owner_key,
            proxy=acc.get("proxy"),
            cookie_str=acc.get("cookie") or "",
            headless=self.headless,
            allow_direct_fallback=self.allow_direct_fallback,
        )
        self.count = 0
        return self.driver

    def release(self, stop_reason: str, keep_browser: bool = False) -> None:
        """Đóng / giữ Chrome acc hiện tại và nhả slot BUSY của nó."""
        uid = self.uid
        try:
            release_browser(stop_reason, keep_browser, self.acquired_lock, self.lock, uid)
        finally:
            self.driver = None
            self.lock = None
            self.acquired_lock = False
            release_account_job(uid, self.session_id)

    def _free_candidates(self) -> List[int]:
        n = len(self.accounts)
        out = []
        for step in range(1, n):
            j = (self.idx + step) % n
            uid = _acc_uid(self.accounts[j])
            if uid in self.dead or get_active_job_for_account(uid) is not None:
                continue
            out.append(j)
        return out

    def _set_session_account(self, uid: str) -> None:
        try:
            from core.database.connection import db

            db.execute(
                "UPDATE page_scan_sessions SET account_uid = %s WHERE id = %s",
                (uid, self.session_id),
            )
        except Exception as exc:
            logger.debug(f"[browser_session] set session account #{self.session_id}: {exc}")

    def rotate(self, reason: str, mark_dead: bool = False) -> bool:
        """
        Đổi sang acc kế tiếp. True = đã đổi (dùng rotation.driver mới).
        False = không đổi được: khi mark_dead thì không còn Chrome (driver None → nơi gọi dừng);
        khi xoay theo hạn mức thì tiếp tục với acc cũ (Chrome được mở lại nếu cần).
        """
        old_idx, old_uid = self.idx, self.uid
        if mark_dead:
            self.dead.add(old_uid)
        candidates = self._free_candidates() if self.can_rotate else []
        if not candidates:
            if mark_dead:
                self._log(f"Không còn tài khoản thay thế ({reason}) — dừng phiên", "warn")
                self.release("CHECKPOINT", keep_browser=False)
            else:
                self._log(f"Không có tài khoản rảnh để đổi ({reason}) — tiếp tục với {old_uid}", "warn")
            return False

        self.release("CHECKPOINT" if mark_dead else "ROTATE", keep_browser=False)
        for j in candidates:
            uid = _acc_uid(self.accounts[j])
            try:
                try_acquire_account_job(uid, self.session_id, self.job_type)
            except AccountBusyError:
                continue
            self.idx = j
            try:
                self.open()
            except Exception as exc:
                self._log(f"Không mở được Chrome tài khoản {uid}: {exc}", "warn")
                release_account_job(uid, self.session_id)
                self.dead.add(uid)
                continue
            self._set_session_account(uid)
            self._log(f"Đổi tài khoản {old_uid} → {uid} ({reason})", "warn")
            return True

        # Không chuyển được sang acc nào
        self.idx = old_idx
        if mark_dead:
            self._log(f"Không còn tài khoản thay thế ({reason}) — dừng phiên", "warn")
            return False
        try:
            try_acquire_account_job(old_uid, self.session_id, self.job_type)
            self.open()
            self._log(f"Không đổi được tài khoản ({reason}) — tiếp tục với {old_uid}", "warn")
        except Exception as exc:
            self._log(f"Không mở lại được tài khoản {old_uid}: {exc}", "warn")
            self.driver = None
        return False


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


def mark_stale_running_sessions(
    owner_key: Optional[str] = None,
    exclude_session_ids: Optional[Iterable[int]] = None,
    heartbeat_timeout_s: int = STALE_HEARTBEAT_SECONDS,
    legacy_max_age_minutes: int = STALE_RUNNING_MINUTES,
) -> List[int]:
    """
    Phiên RUNNING/PAUSED không còn engine nào chạy → FAILED + ERROR. Trả về id đã đánh dấu.
    - Có heartbeat_at: quá heartbeat_timeout_s không heartbeat.
    - Chưa có heartbeat_at (engine bản cũ): quá legacy_max_age_minutes từ lúc bắt đầu.
    owner_key: chỉ xét phiên của owner này (gọi từ API); None = mọi owner (startup).
    exclude_session_ids: phiên đang chạy trong chính tiến trình này — không bao giờ đánh dấu.
    """
    from core.database.connection import db

    if not getattr(db, "_is_postgres", False):
        return []

    conds = [
        "status IN ('RUNNING', 'PAUSED')",
        """(
            (heartbeat_at IS NOT NULL AND heartbeat_at < NOW() - (%s * INTERVAL '1 second'))
            OR (heartbeat_at IS NULL
                AND COALESCE(started_at, created_at) < NOW() - (%s * INTERVAL '1 minute'))
        )""",
    ]
    params: List[Any] = [
        ORPHAN_ERROR_MESSAGE,
        max(30, int(heartbeat_timeout_s)),
        max(30, int(legacy_max_age_minutes)),
    ]
    if owner_key is not None:
        conds.append("owner_key = %s")
        params.append(owner_key)
    exclude = [int(s) for s in (exclude_session_ids or [])]
    if exclude:
        conds.append("NOT (id = ANY(%s))")
        params.append(exclude)

    try:
        rows = db.fetch_all(
            f"""
            UPDATE page_scan_sessions
            SET status = 'FAILED',
                stop_reason = 'ERROR',
                error_message = COALESCE(error_message, %s),
                finished_at = NOW()
            WHERE {' AND '.join(conds)}
            RETURNING id
            """,
            tuple(params),
        )
    except Exception as exc:
        logger.debug(f"[browser_session] mark_stale: {exc}")
        return []

    ids = [int(r["id"]) for r in (rows or [])]
    for sid in ids:
        logger.warning(f"[browser_session] Phiên #{sid} mồ côi (không heartbeat) → FAILED")
    return ids
