"""
Hàm dùng chung cho 3 luồng quét Module 10 (thông tin nhóm, thành viên, bài viết):
mở nick theo vòng pool, tra nhóm theo owner, ngủ / tạm dừng ngắt được,
dọn job cũ trong RAM, chuẩn hoá log để lưu lịch sử, đọc mốc thời gian Facebook.
"""
from __future__ import annotations

import re
import time
from datetime import date, datetime
from typing import Any, Callable, Iterable, Optional

TERMINAL_STATUSES = {"done", "error", "aborted"}
JOB_TTL_SEC = 2 * 3600
MAX_FINISHED_JOBS = 50
SESSION_LOG_LIMIT = 300
MAX_PAUSE_SEC = 2 * 3600
NEW_MEMBER_DAYS = 30

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
    """Chuẩn hoá log của 3 luồng quét về {time, level, message} để lưu lịch sử."""
    out: list[dict[str, str]] = []
    for row in logs or []:
        if not isinstance(row, dict):
            continue
        message = str(row.get("message") or row.get("text") or "").strip()
        if not message:
            continue
        level = str(row.get("level") or row.get("tone") or "info").upper()
        level = {"WARN": "WARNING", "OK": "SUCCESS"}.get(level, level)
        out.append({"time": str(row.get("time") or ""), "level": level, "message": message})
    return out[-limit:]


# ---------------------------------------------------------------------------
# Nhóm mục tiêu
# ---------------------------------------------------------------------------


def _is_db_serial(value: str) -> bool:
    """ID tự tăng của bảng scanned_groups (ngắn), không phải ID nhóm Facebook."""
    return bool(value) and value.isdigit() and len(value) < 8


def _slug_from_url(url: str) -> str:
    if url and "/groups/" in url:
        return url.split("/groups/")[-1].split("/")[0].split("?")[0].strip()
    return ""


def resolve_group_identity(grp: dict[str, Any], owner: Optional[str], *, fetch_one=None) -> tuple[str, str, str]:
    """Trả (group_id, group_name, group_url) hợp lệ trên Facebook.

    FE có thể gửi ID tự tăng của DB thay cho ID nhóm; khi đó tra lại bảng
    scanned_groups, luôn trong phạm vi owner hiện tại.
    """
    if fetch_one is None:
        from core.database.connection import db

        fetch_one = db.fetch_one

    raw_url = str(grp.get("url") or grp.get("group_url") or grp.get("href") or "").strip()
    group_id = str(grp.get("group_id") or grp.get("groupId") or grp.get("uid") or "").strip()
    group_name = str(grp.get("name") or grp.get("group_name") or "").strip()
    raw_id = str(grp.get("id") or grp.get("dbId") or "").strip()
    url_slug = _slug_from_url(raw_url)

    need_lookup = (
        _is_db_serial(group_id)
        or _is_db_serial(url_slug)
        or not group_id
        or not raw_url
        or (raw_id.isdigit() and group_id == raw_id)
    )
    if need_lookup and owner:
        row = None
        try:
            serial = next((v for v in (raw_id, group_id, url_slug) if v.isdigit()), "")
            if serial:
                row = fetch_one(
                    "SELECT group_id, group_url, group_name FROM scanned_groups WHERE owner_username = ? AND id = ?",
                    (owner, int(serial)),
                )
            if not row and group_id and not _is_db_serial(group_id):
                row = fetch_one(
                    "SELECT group_id, group_url, group_name FROM scanned_groups WHERE owner_username = ? AND group_id = ?",
                    (owner, group_id.lower()),
                )
        except Exception:
            row = None
        if row:
            real_gid = str(row.get("group_id") or "").strip()
            real_url = str(row.get("group_url") or "").strip()
            real_name = str(row.get("group_name") or "").strip()
            if real_gid and not _is_db_serial(real_gid):
                group_id = real_gid
            if real_url:
                raw_url = real_url
            if real_name and not group_name:
                group_name = real_name

    if not group_id or _is_db_serial(group_id):
        slug = _slug_from_url(raw_url)
        if slug and not _is_db_serial(slug):
            group_id = slug

    if raw_url and re.search(r"/groups/\d{1,7}(?:[/?#]|$)", raw_url):
        raw_url = f"https://www.facebook.com/groups/{group_id}" if group_id and not _is_db_serial(group_id) else ""

    if _is_db_serial(group_id):
        group_id = ""
    if not raw_url and group_id:
        raw_url = f"https://www.facebook.com/groups/{group_id}"
    if not group_name:
        group_name = group_id or "Nhóm Facebook"
    return group_id, group_name, raw_url.rstrip("/")


# ---------------------------------------------------------------------------
# Mở nick theo vòng pool
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
    scope: str,
    log: LogFn,
    exclude: Iterable[str] = (),
    lock_timeout: float = 10.0,
    should_stop: Optional[Callable[[], bool]] = None,
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
            )
            if not _login(driver, uid, creds, log):
                log(f"[{uid}] Không đăng nhập được Facebook — chuyển nick kế tiếp.", "error")
                _quit(driver)
                _release(lock)
                continue
            log(f"[{uid}] Đăng nhập thành công.", "success")
            return {"driver": driver, "lock": lock, "uid": uid, "next_index": idx + 1}
        except Exception as exc:
            log(f"[{uid}] Lỗi mở Chrome: {exc} — chuyển nick kế tiếp.", "error")
            _quit(driver)
            _release(lock)
    return None


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
# Mốc thời gian Facebook ("3 giờ", "2 tuần", "5 tháng 3", "March 3, 2024", "Joined 2 days ago")
# ---------------------------------------------------------------------------

_UNIT_DAYS = {
    "giây": 0.0, "s": 0.0, "sec": 0.0, "secs": 0.0, "second": 0.0, "seconds": 0.0,
    "phút": 0.0, "m": 0.0, "min": 0.0, "mins": 0.0, "minute": 0.0, "minutes": 0.0,
    "giờ": 0.0, "tiếng": 0.0, "h": 0.0, "hr": 0.0, "hrs": 0.0, "hour": 0.0, "hours": 0.0,
    "ngày": 1.0, "d": 1.0, "day": 1.0, "days": 1.0,
    "tuần": 7.0, "w": 7.0, "wk": 7.0, "wks": 7.0, "week": 7.0, "weeks": 7.0,
    "tháng": 30.0, "mo": 30.0, "mos": 30.0, "month": 30.0, "months": 30.0,
    "năm": 365.0, "y": 365.0, "yr": 365.0, "yrs": 365.0, "year": 365.0, "years": 365.0,
}

_EN_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_NOISE = re.compile(
    r"\b(?:đã tham gia|tham gia|joined|member since|thành viên từ|vào|khoảng|about|around|on|ago|trước|"
    r"được|kể từ|since)\b",
    re.I,
)


def _safe_date(year: int, month: int, day: int) -> Optional[date]:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _absolute_date(text: str, today: date) -> Optional[date]:
    year_given = True
    found: Optional[tuple[int, int, int]] = None

    m = re.search(r"(\d{1,2})\s*tháng\s*(\d{1,2})(?:\D{0,8}?(\d{4}))?", text)
    if m:
        found = (int(m.group(3)) if m.group(3) else 0, int(m.group(2)), int(m.group(1)))
    if not found:
        m = re.search(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", text)
        if m:
            year = int(m.group(3)) if m.group(3) else 0
            if 0 < year < 100:
                year += 2000
            found = (year, int(m.group(2)), int(m.group(1)))
    if not found:
        m = re.search(r"\b([a-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?\b", text)
        if m and m.group(1)[:3] in _EN_MONTHS:
            found = (int(m.group(3)) if m.group(3) else 0, _EN_MONTHS[m.group(1)[:3]], int(m.group(2)))
    if not found:
        m = re.search(r"\b(\d{1,2})\s+([a-z]{3,9})\.?(?:,?\s*(\d{4}))?\b", text)
        if m and m.group(2)[:3] in _EN_MONTHS:
            found = (int(m.group(3)) if m.group(3) else 0, _EN_MONTHS[m.group(2)[:3]], int(m.group(1)))
    if not found:
        m = re.search(r"(?:năm\s*)?\b((?:19|20)\d{2})\b", text)
        if m:
            return _safe_date(int(m.group(1)), 1, 1)
        return None

    year, month, day = found
    if not year:
        year_given = False
        year = today.year
    result = _safe_date(year, month, day)
    if result and not year_given and result > today:
        result = _safe_date(year - 1, month, day)
    return result


def fb_time_age_days(raw: Any, *, today: Optional[date] = None) -> Optional[float]:
    """Tuổi (ngày) của một mốc thời gian Facebook; None nếu không đọc được."""
    text = re.sub(r"\s+", " ", str(raw or "")).strip().lower()
    if not text or text == "—":
        return None
    today = today or datetime.now().date()

    if re.search(r"vừa xong|just now|mới đây|bây giờ", text):
        return 0.0
    if re.search(r"hôm qua|yesterday", text):
        return 1.0
    if re.search(r"hôm nay|today", text):
        return 0.0

    # "5 tháng 3" là ngày tuyệt đối — phải xét trước dạng tương đối "5 tháng".
    if re.search(r"\d{1,2}\s*tháng\s*\d{1,2}", text) or re.search(r"\d{1,2}/\d{1,2}", text):
        found = _absolute_date(text, today)
        return float((today - found).days) if found else None

    cleaned = _NOISE.sub(" ", text)
    cleaned = re.sub(r"(?:^|\s)(?:an?|một)\s+(?=[^\W\d_])", " 1 ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    m = re.search(r"(\d+)\s*([^\W\d_]+)", cleaned)
    if m and m.group(2) in _UNIT_DAYS:
        return int(m.group(1)) * _UNIT_DAYS[m.group(2)]

    found = _absolute_date(cleaned, today)
    if found:
        return float((today - found).days)
    return None


def is_post_older_than_days(posted_time: Any, max_days: int, *, today: Optional[date] = None) -> bool:
    """True khi đọc được mốc thời gian và bài cũ hơn `max_days` ngày (0 = không lọc)."""
    if not max_days or max_days <= 0:
        return False
    age = fb_time_age_days(posted_time, today=today)
    return age is not None and age > max_days
