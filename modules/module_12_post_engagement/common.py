"""
Hàm dùng chung cho luồng Kiểm tra / Quét của Module 12.

Copy từ Module 10 (modules/module_10_group_scan/scan_common.py) — KHÔNG import chéo sang Module 10
để sửa Module 10 không ảnh hưởng Module 12: mở nick (khoá profile, đăng nhập), đóng Chrome, nhận biết
Chrome bị tắt, ngủ / tạm dừng ngắt được, chia việc đều cho các Chrome (FairQueue), dọn job cũ trong RAM.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Callable, Iterable, Optional

TERMINAL_STATUSES = {"done", "error", "aborted"}
JOB_TTL_SEC = 2 * 3600
MAX_FINISHED_JOBS = 50
SESSION_LOG_LIMIT = 300
MAX_PAUSE_SEC = 2 * 3600
MAX_PARALLEL_BROWSERS = 5
BROWSER_STAGGER_SEC = 3.0
BROWSER_SCOPE = "post-engagement"

LogFn = Callable[[str, str], None]


# ---------------------------------------------------------------------------
# Job trong RAM
# ---------------------------------------------------------------------------


def prune_jobs(jobs: dict, lock, *, now: Optional[float] = None, ttl: float = JOB_TTL_SEC,
               keep: int = MAX_FINISHED_JOBS) -> int:
    """Xoá job đã kết thúc quá `ttl` giây, và chỉ giữ `keep` job kết thúc gần nhất."""
    now = time.time() if now is None else now
    with lock:
        finished = [
            (jid, float(job.get("finished_at") or job.get("started_at") or 0))
            for jid, job in jobs.items()
            if job.get("status") in TERMINAL_STATUSES
        ]
        finished.sort(key=lambda item: item[1], reverse=True)
        drop = [jid for idx, (jid, ts) in enumerate(finished) if idx >= keep or now - ts > ttl]
        for jid in drop:
            jobs.pop(jid, None)
    return len(drop)


def interruptible_sleep(seconds: float, get_control: Callable[[], str], *, step: float = 0.5) -> bool:
    """Ngủ tối đa `seconds` giây; trả True ngay khi nhận lệnh abort."""
    end = time.monotonic() + max(0.0, float(seconds or 0))
    while True:
        if get_control() == "abort":
            return True
        remaining = end - time.monotonic()
        if remaining <= 0:
            return False
        time.sleep(min(step, remaining))


def wait_while_paused(get_control: Callable[[], str], *, step: float = 1.0,
                      max_wait: float = MAX_PAUSE_SEC) -> bool:
    """Chờ khi đang pause. Trả True nếu phải dừng (abort hoặc pause quá lâu)."""
    started = time.monotonic()
    while get_control() == "pause":
        if time.monotonic() - started > max_wait:
            return True
        time.sleep(step)
    return get_control() == "abort"


def session_log_entries(logs: Iterable[dict[str, Any]], limit: int = SESSION_LOG_LIMIT) -> list[dict[str, str]]:
    """Chuẩn hoá log về {time, thread, level, message} để lưu lịch sử phiên."""
    out: list[dict[str, str]] = []
    for row in logs or []:
        if not isinstance(row, dict):
            continue
        message = str(row.get("message") or row.get("text") or "").strip()
        if not message:
            continue
        level = str(row.get("level") or row.get("tone") or "info").upper()
        level = {"WARN": "WARNING", "OK": "SUCCESS"}.get(level, level)
        out.append({"time": str(row.get("time") or ""), "thread": str(row.get("thread") or ""),
                    "level": level, "message": message})
    return out[-limit:]


# ---------------------------------------------------------------------------
# Mở nick (Module 02 là nguồn tài khoản dùng chung)
# ---------------------------------------------------------------------------


def _automation():
    from modules.module_02_account_manager import automation

    return automation


def _load_credentials(uid: str, owner: Optional[str]) -> Optional[dict[str, Any]]:
    """Đọc cookie / proxy / mật khẩu của nick trong Module 02 — chỉ nick của owner này."""
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_02_account_manager.database.repository import AccountRepository as Repo
    from modules.module_02_account_manager.security.encryption import decrypt_secret

    session = SessionLocal()
    try:
        account = Repo.get_by_uid(session, uid, owner_username=owner)
        if not account:
            return None
        return {
            "cookie": account.cookie or "",
            "proxy": account.proxy,
            "has_secret": bool(account.password or account.two_fa),
            "password": decrypt_secret(account.password or ""),
            "two_fa": decrypt_secret(account.two_fa or ""),
        }
    finally:
        session.close()


def _login(driver, uid: str, creds: dict[str, Any], log: LogFn) -> bool:
    auto = _automation()
    try:
        res = auto.ensure_logged_in(
            driver,
            uid=uid,
            password=creds.get("password") or "",
            two_fa=creds.get("two_fa") or "",
            cookie=creds.get("cookie") or "",
        )
        if res.get("success"):
            return True
        log(f"[{uid}] Đăng nhập không thành công: {res.get('error') or 'không rõ lý do'}", "warn")
    except Exception as exc:
        log(f"[{uid}] Lỗi khi xác thực phiên: {exc}. Kiểm tra lại trạng thái đăng nhập…", "warn")
    try:
        from modules.module_02_account_manager.automation.login_flow import _check_logged_in

        return bool(_check_logged_in(driver))
    except Exception:
        return False


def _quit(driver) -> None:
    if driver is None:
        return
    try:
        driver.quit()
    except Exception:
        pass


def _release(lock) -> None:
    if lock is None:
        return
    try:
        lock.release()
    except Exception:
        pass


def open_account_session(
    pool: list[str],
    start_index: int,
    *,
    owner: Optional[str],
    log: LogFn,
    scope: str = BROWSER_SCOPE,
    exclude: Iterable[str] = (),
    lock_timeout: float = 10.0,
    should_stop: Optional[Callable[[], bool]] = None,
    window_slot: Optional[int] = None,
    load_credentials: Optional[Callable[[str, Optional[str]], Optional[dict[str, Any]]]] = None,
) -> Optional[dict[str, Any]]:
    """Thử lần lượt các nick trong pool từ `start_index`, mỗi nick tối đa một lần.

    Nick bận / không có trong Module 02 / không đăng nhập được thì chuyển nick kế tiếp.
    Trả {driver, lock, uid, next_index} hoặc None khi không nick nào dùng được.
    Phải gọi trong owner_scope(owner) để khoá và profile Chrome đúng của user.
    """
    auto = _automation()
    load = load_credentials or _load_credentials
    excluded = {str(u) for u in exclude}
    total = len(pool)
    for step in range(total):
        if should_stop and should_stop():
            return None
        idx = (start_index + step) % total
        uid = str(pool[idx])
        if uid in excluded:
            continue

        lock = None
        driver = None
        try:
            lock = auto.get_profile_lock(uid)
            if not lock.acquire(timeout=lock_timeout):
                log(f"[{uid}] Profile đang được tiến trình khác dùng — chuyển nick kế tiếp.", "warn")
                lock = None
                continue

            creds = load(uid, owner)
            if not creds:
                log(f"[{uid}] Không tìm thấy nick này trong Module 02 của bạn — chuyển nick kế tiếp.", "error")
                _release(lock)
                continue
            if creds.get("has_secret") and not creds.get("password") and not creds.get("two_fa"):
                if not creds.get("cookie"):
                    log(
                        f"[{uid}] Không giải mã được mật khẩu và không có cookie — hãy đăng nhập lại nick ở Module 02.",
                        "error",
                    )
                    _release(lock)
                    continue
                log(f"[{uid}] Không giải mã được mật khẩu trên máy này — dùng cookie phiên đã lưu.", "warn")

            log(f"[{uid}] Đang mở Chrome…", "info")
            driver = auto.create_driver(
                uid,
                headless=False,
                detach=True,
                proxy=creds.get("proxy"),
                scope=scope,
                verify_egress=False,
                **({"window_slot": window_slot} if window_slot is not None else {}),
            )
            if should_stop and should_stop():
                log(f"[{uid}] Đã nhận lệnh dừng — đóng Chrome, không đăng nhập.", "warn")
                _quit(driver)
                _release(lock)
                return None
            if not _login(driver, uid, creds, log):
                log(f"[{uid}] Không đăng nhập được Facebook — chuyển nick kế tiếp.", "error")
                _quit(driver)
                _release(lock)
                continue
            if should_stop and should_stop():
                log(f"[{uid}] Đã nhận lệnh dừng — đóng Chrome.", "warn")
                _quit(driver)
                _release(lock)
                return None
            log(f"[{uid}] Đăng nhập thành công.", "success")
            return {"driver": driver, "lock": lock, "uid": uid, "next_index": idx + 1}
        except Exception as exc:
            log(f"[{uid}] Lỗi mở Chrome: {exc} — chuyển nick kế tiếp.", "error")
            _quit(driver)
            _release(lock)
    return None


_BROWSER_DEAD_MARKERS = (
    "invalid session id", "no such window", "target window already closed", "chrome not reachable",
    "disconnected", "session deleted", "max retries exceeded", "connection refused",
    "failed to establish a new connection", "web view not found",
)


def is_browser_dead_error(exc: BaseException) -> bool:
    """Lỗi do Chrome bị tắt tay / mất kết nối chromedriver → phải dừng phiên ngay, không thử tiếp."""
    text = f"{type(exc).__name__} {exc}".lower()
    return any(marker in text for marker in _BROWSER_DEAD_MARKERS)


def close_account_session(session: Optional[dict[str, Any]], *, quit_browser: bool = True) -> None:
    """Đóng Chrome (tuỳ chọn) và luôn nhả khoá profile."""
    if not session:
        return
    if quit_browser:
        _quit(session.get("driver"))
    _release(session.get("lock"))
    session["driver"] = None
    session["lock"] = None


# ---------------------------------------------------------------------------
# Chia việc đều cho các Chrome chạy song song
# ---------------------------------------------------------------------------


class FairQueue:
    """Chia việc đều cho các Chrome chạy song song.

    Mỗi luồng được `len(items) // workers` việc; phần dư để luồng nào xong phần của mình trước thì làm tiếp.
    Luồng dừng sớm gọi `leave()` để trả phần chưa làm; luồng đã xong phần mình nhưng còn việc của luồng khác
    thì CHỜ — nếu luồng kia bỏ cuộc thì nhận làm thay. Nhờ vậy không việc nào bị bỏ sót.
    """

    def __init__(self, items: Iterable[Any], workers: int):
        self._items = deque(items)
        self._workers = max(1, int(workers))
        self._base = len(self._items) // self._workers
        self._extra = len(self._items) % self._workers
        self._active = self._workers
        self._cond = threading.Condition()

    def has_work(self, taken: int = 0) -> bool:
        with self._cond:
            return bool(self._items)

    def take(self, taken: int, *, should_stop: Optional[Callable[[], bool]] = None,
             wait: bool = True, poll: float = 0.5) -> Any:
        """Lấy việc tiếp theo cho luồng đã làm `taken` việc. None khi hết việc (hoặc bị dừng)."""
        with self._cond:
            while True:
                if not self._items:
                    return None
                if taken < self._base:
                    return self._items.popleft()
                if self._extra > 0:
                    self._extra -= 1
                    return self._items.popleft()
                if self._active <= 1:
                    return self._items.popleft()
                if not wait or (should_stop and should_stop()):
                    return None
                self._cond.wait(poll)

    def put_back(self, item: Any) -> None:
        """Trả lại việc vừa lấy mà chưa làm — thành phần dư cho luồng khác."""
        with self._cond:
            self._items.appendleft(item)
            self._extra += 1
            self._cond.notify_all()

    def leave(self, taken: int) -> None:
        """Luồng kết thúc: phần chưa làm (nếu dừng sớm) chuyển cho luồng còn chạy."""
        with self._cond:
            if taken < self._base:
                self._extra += self._base - taken
            self._active = max(0, self._active - 1)
            self._cond.notify_all()

    def remaining(self) -> list[Any]:
        with self._cond:
            return list(self._items)
