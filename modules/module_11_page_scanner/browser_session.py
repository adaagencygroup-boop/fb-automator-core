"""
Khóa runtime browser page_scanner: 1 job Selenium / 1 account_uid.
Tái sử dụng acquire/release từ scanner; BUSY nếu acc đang chạy phiên khác.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# account_uid -> {session_id, job_type, acquired_at}
_ACCOUNT_JOB_LOCK = threading.Lock()
_ACCOUNT_ACTIVE_JOBS: Dict[str, Dict[str, Any]] = {}
# Thời gian ân hạn sau khi giữ slot trước khi coi là mồ côi do chưa thấy worker thread (tránh race trước Thread.start())
_LOCK_STARTUP_GRACE_SEC = 5.0

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


def _is_job_stale_or_stopped(session_id: int, acquired_at: Optional[float] = None) -> bool:
    """Kiểm tra phiên đang giữ khóa có bị dừng, lỗi, hoàn tất hoặc không còn chạy."""
    if not session_id:
        return True
    sid = int(session_id)
    try:
        from .scanner import _ACTIVE_STOP_EVENTS, _ACTIVE_SESSIONS_LOCK
        with _ACTIVE_SESSIONS_LOCK:
            ev = _ACTIVE_STOP_EVENTS.get(sid)
            if ev and ev.is_set():
                return True
    except Exception:
        pass

    try:
        from core.database import db
        row = db.fetch_one("SELECT status FROM page_scan_sessions WHERE id = %s", (sid,))
        if row:
            st = str(row.get("status") or "").upper()
            if st in ("STOPPED", "FAILED", "COMPLETED", "CANCELLED", "TIMEOUT", "ERROR"):
                return True
    except Exception:
        pass

    # Tránh race: slot vừa được giữ ngay trước khi worker_thread.start() chạy xong
    if acquired_at is not None and (time.monotonic() - float(acquired_at)) < _LOCK_STARTUP_GRACE_SEC:
        return False

    # Kiểm tra xem có thread worker nào thực sự còn đang chạy không
    try:
        worker_prefixes = (
            "page_hashtag_worker_",
            "page_scan_worker_",
            "page_followers_worker_",
            "page_detail_worker_",
            "page_posts_worker_",
        )
        alive_worker = any(
            t.is_alive() and any(t.name == f"{pref}{sid}" for pref in worker_prefixes)
            for t in threading.enumerate()
        )
        if not alive_worker:
            return True
    except Exception:
        pass

    return False


def try_acquire_account_job(
    account_uid: str,
    session_id: int,
    job_type: str,
) -> None:
    """Đăng ký acc→session. Tự động gỡ khóa mồ côi nếu phiên cũ đã dừng/hoàn tất."""
    uid = str(account_uid or "").strip()
    if not uid:
        raise ValueError("account_uid bắt buộc để khóa browser")
    sid = int(session_id)
    with _ACCOUNT_JOB_LOCK:
        cur = _ACCOUNT_ACTIVE_JOBS.get(uid)
        if cur and int(cur.get("session_id") or 0) != sid:
            old_sid = int(cur.get("session_id") or 0)
            if old_sid and _is_job_stale_or_stopped(old_sid, cur.get("acquired_at")):
                logger.info(
                    f"[Module 11] Tự động giải phóng khóa phiên cũ #{old_sid} (đã dừng) cho acc {uid} để phiên #{sid} nhận khóa"
                )
                _ACCOUNT_ACTIVE_JOBS.pop(uid, None)
            else:
                raise AccountBusyError(
                    uid,
                    old_sid,
                    str(cur.get("job_type") or ""),
                )
        _ACCOUNT_ACTIVE_JOBS[uid] = {
            "session_id": sid,
            "job_type": str(job_type or ""),
            "acquired_at": time.monotonic(),
        }


def release_account_job(account_uid: str, session_id: Optional[int] = None) -> None:
    """Gỡ khóa nếu đúng session đang giữ (hoặc ép giải phóng nếu session_id=None)."""
    uid = str(account_uid or "").strip()
    if not uid:
        return
    with _ACCOUNT_JOB_LOCK:
        cur = _ACCOUNT_ACTIVE_JOBS.get(uid)
        if cur:
            if session_id is None or int(cur.get("session_id") or 0) == int(session_id):
                _ACCOUNT_ACTIVE_JOBS.pop(uid, None)


def get_active_job_for_account(account_uid: str) -> Optional[Dict[str, Any]]:
    uid = str(account_uid or "").strip()
    if not uid:
        return None
    with _ACCOUNT_JOB_LOCK:
        cur = _ACCOUNT_ACTIVE_JOBS.get(uid)
        if cur:
            sid = int(cur.get("session_id") or 0)
            if sid and _is_job_stale_or_stopped(sid, cur.get("acquired_at")):
                logger.info(f"[Module 11] Gỡ khóa mồ côi/đã dừng của acc {uid} (phiên #{sid})")
                _ACCOUNT_ACTIVE_JOBS.pop(uid, None)
                return None
            return dict(cur)
        return None


def get_uids_for_sessions(session_ids: Iterable[int]) -> Set[str]:
    """Trả về tất cả account_uid (kể cả acc đã xoay vòng) đang giữ khóa thuộc các session_ids."""
    target = {int(s) for s in session_ids if s is not None}
    if not target:
        return set()
    with _ACCOUNT_JOB_LOCK:
        return {
            uid for uid, job in _ACCOUNT_ACTIVE_JOBS.items()
            if int(job.get("session_id") or 0) in target
        }


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
    # Khóa profile do chính worker đang giữ tự nhả khi thoát — không nhả hộ từ luồng khác
    return close_scoped_active_drivers(scope="page_scanner", force=True, uids=targets)


def stop_owner_page_scanner_jobs(owner_key: str) -> Dict[str, Any]:
    """
    Dừng khẩn cấp mọi phiên Module 11 CỦA ĐÚNG owner (không đụng phiên / Chrome của người dùng khác):
    1. Báo stop (kèm gỡ pause) cho từng phiên RUNNING/PAUSED của owner, cập nhật DB sang STOPPED.
    2. Đóng Chrome page_scanner của owner (kể cả Chrome keep_browser đang nhàn rỗi).
    3. Nhả khóa acc của các phiên đó. Khóa profile do worker tự nhả khi thoát.
    """
    from core.browser.driver import _active_drivers, _active_drivers_lock
    from core.database import db
    from .scanner import accounts_owner_for, request_stop_session

    rows = db.fetch_all(
        """
        SELECT id, account_uid FROM page_scan_sessions
        WHERE owner_key = %s AND status IN ('RUNNING', 'PAUSED')
        """,
        (owner_key,),
    ) or []
    stopped_ids = {int(r["id"]) for r in rows}
    uids: Set[str] = {str(r["account_uid"]) for r in rows if r.get("account_uid")}
    for sid in stopped_ids:
        request_stop_session(sid)
    if stopped_ids:
        db.execute(
            """
            UPDATE page_scan_sessions
            SET status = 'STOPPED', stop_reason = 'USER_STOPPED', finished_at = NOW()
            WHERE owner_key = %s AND id = ANY(%s) AND status IN ('RUNNING', 'PAUSED')
            """,
            (owner_key, sorted(stopped_ids)),
        )

    # Acc đang xoay vòng trong các phiên này (khác account_uid ban đầu của phiên)
    with _ACCOUNT_JOB_LOCK:
        uids |= {
            uid for uid, job in _ACCOUNT_ACTIVE_JOBS.items()
            if int(job.get("session_id") or 0) in stopped_ids
        }
    # Chrome page_scanner của owner còn mở (chuẩn hóa "system" / None về cùng owner)
    accounts_owner = accounts_owner_for(owner_key)
    with _active_drivers_lock:
        uids |= {
            str(info["uid"]) for info in _active_drivers.values()
            if info.get("scope") == "page_scanner"
            and accounts_owner_for(info.get("owner")) == accounts_owner
        }

    closed: List[str] = []
    try:
        closed = close_browsers_for_stopped_sessions(uids, stopped_ids)
    except Exception as exc:
        logger.warning(f"[Module 11] Đóng Chrome khi dừng khẩn cấp: {exc}")

    with _ACCOUNT_JOB_LOCK:
        released = [
            uid for uid, job in _ACCOUNT_ACTIVE_JOBS.items()
            if int(job.get("session_id") or 0) in stopped_ids
        ]
        for uid in released:
            _ACCOUNT_ACTIVE_JOBS.pop(uid, None)

    return {
        "stopped_session_ids": sorted(stopped_ids),
        "closed_browsers": closed,
        "released_accounts": released,
    }


def acquire_browser(
    target_uid: str,
    owner: str,
    proxy: Any,
    cookie_str: str,
    headless: bool = False,
    allow_direct_fallback: bool = True,
    session_id: Optional[int] = None,
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
        session_id=session_id,
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


class AccountLoginError(RuntimeError):
    """Acc không có phiên Facebook hợp lệ (cookie hết hạn, sai mật khẩu, checkpoint, 2FA…)."""


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
        require_login: bool = False,
    ):
        self.accounts = [a for a in (accounts or []) if _acc_uid(a)]
        if not self.accounts:
            raise ValueError("Cần ít nhất 1 tài khoản để quét")
        self.session_id = int(session_id)
        self.job_type = job_type
        self.owner_key = owner_key
        self.headless = headless
        self.allow_direct_fallback = allow_direct_fallback
        # True: mở Chrome xong phải có phiên đăng nhập thật (tự login lại bằng cookie / mật khẩu + 2FA)
        self.require_login = require_login
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
            session_id=self.session_id,
        )
        self.count = 0
        if self.require_login:
            try:
                self.ensure_login()
            except BaseException:
                # Không đăng nhập được → đóng Chrome + nhả khóa profile ngay; slot BUSY do nơi gọi xử lý
                uid = self.uid
                try:
                    release_browser("CHECKPOINT", False, self.acquired_lock, self.lock, uid)
                finally:
                    self.driver = None
                    self.lock = None
                    self.acquired_lock = False
                raise
        return self.driver

    def _login_credentials(self) -> Tuple[str, str]:
        """Mật khẩu + 2FA (đã giải mã) của acc hiện tại — dùng khi cookie hết hạn."""
        try:
            from core.database.connection import db
            from modules.module_02_account_manager.security.encryption import decrypt_data

            row = db.fetch_one(
                """
                SELECT password, two_fa FROM accounts
                WHERE uid = %s AND user_id IS NOT DISTINCT FROM %s
                LIMIT 1
                """,
                (self.uid, self.account.get("user_id")),
            ) or {}
        except Exception as exc:
            logger.debug(f"[browser_session] đọc mật khẩu {self.uid}: {exc}")
            return "", ""

        def _dec(value):
            try:
                return decrypt_data(value) if value else ""
            except Exception:
                return ""

        return _dec(row.get("password")), _dec(row.get("two_fa"))

    def ensure_login(self) -> None:
        """Bắt buộc có phiên Facebook đăng nhập; không được → AccountLoginError."""
        from modules.module_02_account_manager.automation import ensure_logged_in

        uid = self.uid
        password, two_fa = self._login_credentials()
        self._log(f"Kiểm tra đăng nhập tài khoản {uid}…", "info")
        res = ensure_logged_in(
            self.driver, uid, password=password, two_fa=two_fa, cookie=self.account.get("cookie") or ""
        ) or {}
        if not res.get("success"):
            reason = res.get("error") or "phiên hết hạn / checkpoint"
            self._log(f"Tài khoản {uid} chưa đăng nhập được: {reason}", "error")
            raise AccountLoginError(f"Tài khoản {uid} chưa đăng nhập được: {reason}")
        self._log(
            f"Tài khoản {uid} {'đã đăng nhập lại' if res.get('reloaded') else 'đang đăng nhập'} — bắt đầu quét",
            "success",
        )

    def relogin(self) -> bool:
        """Bị đăng xuất giữa phiên → thử đăng nhập lại trên Chrome hiện tại."""
        if self.driver is None:
            return False
        try:
            self.ensure_login()
            return True
        except Exception:
            return False

    def release(self, stop_reason: str, keep_browser: bool = False) -> None:
        """Đóng / giữ Chrome acc hiện tại và nhả slot BUSY của nó."""
        uid = self.uid
        try:
            # Không giữ khóa = Chrome của uid này (nếu có) thuộc phiên khác → không đóng
            if self.acquired_lock:
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
