"""
Kiểm tra từ khóa (nhiều từ khóa / 1 nick):
1) Mở Chrome session Module 2 một lần
2) Với từng từ khóa: search → Groups → quét tới hạn mức
3) Giữa các từ khóa nghỉ delay_min..delay_max giây (cùng account)
4) FE poll /check-status (logs + groups + keyword_stats)
"""
from __future__ import annotations

import logging
import random
import re
import threading
import time
import uuid
from collections import deque
from typing import Any, Optional
from urllib.parse import quote, urlparse, urlunparse

from modules.module_10_group_scan.scan_common import (
    FairQueue,
    close_account_session,
    is_browser_dead_error,
    open_account_session,
    prune_jobs,
)

logger = logging.getLogger(__name__)

# Nhãn luồng hiện trên log ([Thread-01], [Thread-02]…) — mỗi Chrome quét song song là một luồng.
_thread_label = threading.local()

DEFAULT_MAX_GROUPS = 30
HARD_MAX_GROUPS = 200
# Job cũ/treo (tắt browser, mất kết nối) tự nhả sau khoảng này.
STALE_PENDING_SEC = 45

_pending: dict[str, dict[str, Any]] = {}
_pending_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()

SEARCH_INPUT_LOCATORS = [
    # English UI trước (nhiều nick đang để EN)
    '//input[@aria-label="Search Facebook"]',
    '//input[@placeholder="Search Facebook"]',
    '//input[@type="search" and @aria-label="Search Facebook"]',
    '//input[@role="combobox" and @aria-label="Search Facebook"]',
    # Vietnamese UI
    '//input[@aria-label="Tìm kiếm trên Facebook"]',
    '//input[@placeholder="Tìm kiếm trên Facebook"]',
    '//input[@type="search" and (@aria-label="Tìm kiếm trên Facebook" or @aria-label="Search Facebook")]',
    '//input[@role="combobox" and (contains(@aria-label,"Tìm kiếm trên Facebook") or contains(@aria-label,"Search Facebook"))]',
    '//input[@type="search" and (contains(@aria-label,"Tìm kiếm") or contains(@aria-label,"Search") or contains(@placeholder,"Tìm kiếm") or contains(@placeholder,"Search Facebook"))]',
]

GROUPS_TAB_LOCATORS = [
    '//*[@role="list"]//span[normalize-space()="Groups" or normalize-space()="Nhóm"]',
    '//*[@role="list"]//*[@role="listitem" or @role="link" or @role="button"][.//span[normalize-space()="Groups" or normalize-space()="Nhóm"]]',
    '//span[normalize-space()="Groups" or normalize-space()="Nhóm"]',
    '//a[contains(@href,"/search/groups")]//span[contains(.,"Groups") or contains(.,"Nhóm")]',
    '//*[@role="link" or @role="button"][normalize-space()="Groups" or normalize-space()="Nhóm"]',
]

RESULTS_ROOT_LOCATORS = [
    '//*[@aria-label="Search results" and @role="main"]',
    '//*[@aria-label="Search results"]',
    '//*[@role="main" and contains(@aria-label,"Search results")]',
    '//*[@role="main" and (contains(@aria-label,"Kết quả tìm kiếm") or contains(@aria-label,"kết quả"))]',
]

def _pending_key(owner: Optional[str], uid: str) -> str:
    return f"{owner or ''}::{uid}"


def _clamp_limit(value: Any, default: int = DEFAULT_MAX_GROUPS) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    return max(1, min(HARD_MAX_GROUPS, n))


def _normalize_keywords(items: list[Any]) -> list[dict[str, Any]]:
    """Chuẩn hoá [{keyword, limit}] — bỏ trùng không phân biệt hoa/thường."""
    from modules.module_10_group_scan.models import normalize_keyword

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items or []:
        if isinstance(item, str):
            word = item.strip()
            limit = DEFAULT_MAX_GROUPS
        elif isinstance(item, dict):
            word = str(item.get("keyword") or item.get("word") or "").strip()
            limit = _clamp_limit(item.get("limit"), DEFAULT_MAX_GROUPS)
        else:
            continue
        key = normalize_keyword(word)
        if not key or key in seen:
            continue
        seen.add(key)
        # Giữ nguyên chữ user gõ để search FB; DB sẽ lưu dạng chuẩn
        out.append({"keyword": re.sub(r"\s+", " ", word).strip(), "limit": limit})
    return out


def _job_snapshot(job_id: str) -> Optional[dict[str, Any]]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        stats = dict(job.get("keyword_stats") or {})
        return {
            "job_id": job_id,
            "uid": job.get("uid"),
            "keyword": job.get("keyword"),
            "keywords": list(job.get("keywords") or []),
            "keyword_stats": stats,
            "status": job.get("status"),
            "error": job.get("error") or "",
            "logs": list(job.get("logs") or []),
            "groups": list(job.get("groups") or []),
            "count": len(job.get("groups") or []),
            "delay_min": job.get("delay_min"),
            "delay_max": job.get("delay_max"),
            "control": job.get("control") or "run",
        }


def _job_owner(job_id: str) -> Any:
    with _jobs_lock:
        return (_jobs.get(job_id) or {}).get("owner", object())


def get_check_status(
    job_id: Optional[str] = None,
    uid: Optional[str] = None,
    owner: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    if job_id:
        if _job_owner(job_id) != owner:
            return None
        return _job_snapshot(job_id)
    uid = str(uid or "").strip()
    if not uid:
        return None
    with _jobs_lock:
        matches = [
            jid for jid, job in _jobs.items()
            if str(job.get("uid")) == uid and job.get("owner") == owner
        ]
        if not matches:
            return None
        matches.sort(key=lambda jid: _jobs[jid].get("started_at") or 0, reverse=True)
        return _job_snapshot(matches[0])


def _append_log(job_id: str, text: str, tone: str = "info") -> None:
    line = {
        "time": time.strftime("%H:%M:%S"),
        "thread": getattr(_thread_label, "name", "Thread-01"),
        "text": text,
        "tone": tone,
    }
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        logs = job.setdefault("logs", [])
        logs.append(line)
        if len(logs) > 200:
            del logs[:-200]
    try:
        from modules.module_02_account_manager.services.events import broadcast

        level = "success" if tone == "success" else "warning" if tone == "warn" else "error" if tone == "error" else "info"
        broadcast(level, text, uid=_jobs.get(job_id, {}).get("uid"))
    except Exception:
        pass



def _job_groups(job_id: str) -> list[dict[str, Any]]:
    with _jobs_lock:
        return list((_jobs.get(job_id) or {}).get("groups") or [])


def _add_job_groups(job_id: str, items: list[dict[str, Any]]) -> int:
    """Thêm nhóm vào kết quả chung của job (nhiều luồng ghi cùng lúc) — trả tổng số nhóm."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return 0
        groups = job.setdefault("groups", [])
        have = {g.get("href") for g in groups}
        for g in items:
            if g and g.get("href") not in have:
                groups.append(g)
                have.add(g.get("href"))
        return len(groups)


def _set_job(job_id: str, **fields) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        job.update(fields)


def _update_keyword_stat(job_id: str, keyword: str, **fields) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        stats = job.setdefault("keyword_stats", {})
        row = dict(stats.get(keyword) or {})
        row.update(fields)
        stats[keyword] = row
        if fields.get("status") == "running":
            job["keyword"] = keyword


def _latest_job_for_uid(uid: str, owner: Optional[str] = None) -> Optional[dict[str, Any]]:
    with _jobs_lock:
        matches = [
            job for job in _jobs.values()
            if str(job.get("uid")) == uid and job.get("owner") == owner
        ]
        if not matches:
            return None
        matches.sort(key=lambda job: job.get("started_at") or 0, reverse=True)
        return matches[0]


def _release_pending(key: str, job_id: Optional[str] = None) -> None:
    with _pending_lock:
        info = _pending.get(key)
        if info is None:
            return
        if job_id is not None and info.get("job_id") and info.get("job_id") != job_id:
            return
        _pending.pop(key, None)


def _get_control(job_id: str) -> str:
    with _jobs_lock:
        job = _jobs.get(job_id) or {}
        return str(job.get("control") or "run")


def _handle_pause_if_requested(job_id: str, context_label: str = "") -> bool:
    """
    Nếu job đang có cờ pause/pause_after/paused, tạm dừng tại chỗ và chờ đến khi resume hoặc abort.
    Trả về True nếu bị abort trong lúc tạm dừng, False nếu resume bình thường.
    """
    if _get_control(job_id) not in {"pause", "pause_after", "paused"}:
        return False

    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return False
        job["control"] = "paused"
        job["status"] = "paused"

    lbl = f" tại «{context_label}»" if context_label else ""
    _append_log(job_id, f"⏸️ Đã tạm dừng quét{lbl}. Bấm 'Tiếp tục' để chạy tiếp.", "warn")

    max_pause_sec = 7200  # 2 giờ tối đa
    start_pause = time.time()
    while _get_control(job_id) in {"pause", "pause_after", "paused"}:
        if _get_control(job_id) == "abort":
            _append_log(job_id, "🛑 Đã dừng khẩn cấp trong lúc tạm dừng.", "warn")
            _set_job(job_id, status="aborted", error="Dừng khẩn cấp")
            return True
        if time.time() - start_pause > max_pause_sec:
            _append_log(job_id, "⚠️ Tạm dừng quá thời gian cho phép (2 giờ) — tự động kết thúc job.", "warn")
            _set_job(job_id, status="aborted", error="Quá thời gian tạm dừng (2 giờ)")
            return True
        time.sleep(0.5)

    _set_job(job_id, status="running", control="run")
    _append_log(job_id, f"▶️ Tiếp tục quét{lbl}…", "info")
    return False


def set_job_control(job_id: str, action: str, owner: Optional[str] = None) -> dict[str, Any]:
    """
    pause  = tạm dừng quét (ở nhóm hoặc từ khóa tiếp theo)
    resume = tiếp tục quét lại từ chỗ tạm dừng
    abort  = dừng khẩn cấp ngay
    """
    action = str(action or "").strip().lower()
    if action not in {"pause", "resume", "abort"}:
        raise ValueError("action phải là pause | resume | abort")
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job.get("owner") != owner:
            raise ValueError("Không tìm thấy job")
        if action == "pause":
            job["control"] = "pause_after"
            msg = "Đã gửi lệnh tạm dừng."
        elif action == "abort":
            job["control"] = "abort"
            msg = "Đang dừng khẩn cấp…"
        else:
            job["control"] = "run"
            if job.get("status") == "paused":
                job["status"] = "running"
            msg = "Đang tiếp tục quét…"
        return {"job_id": job_id, "control": job["control"], "status": job.get("status"), "message": msg}


def clear_pending_for_uid(*, owner: Optional[str], uid: str, reason: str = "force") -> bool:
    """Gỡ khóa Kiểm tra bị kẹt (tắt browser / mất kết nối)."""
    uid = str(uid or "").strip()
    if not uid:
        return False
    key = _pending_key(owner, uid)
    released = False
    with _pending_lock:
        if key in _pending:
            _pending.pop(key, None)
            released = True
    job = _latest_job_for_uid(uid, owner)
    if job and job.get("status") == "running":
        job_id = None
        with _jobs_lock:
            for jid, item in _jobs.items():
                if item is job:
                    job_id = jid
                    break
            job["status"] = "error"
            job["error"] = f"Đã hủy job cũ ({reason})"
        if job_id:
            _append_log(job_id, f"⏹️ Đã hủy job Kiểm tra cũ ({reason}). Có thể chạy lại.", "warn")
    return released


def start_keyword_check(
    *,
    owner: Optional[str],
    uid: str,
    keywords: list[Any],
    delay_min: float = 5.0,
    delay_max: float = 10.0,
    public_only: bool = False,
    private_only: bool = False,
    min_members: Optional[int] = None,
    force: bool = True,
    auto_join: bool = False,
    uids: Optional[list[str]] = None,
    rotate_after: int = 50,
) -> dict:
    prune_jobs(_jobs, _jobs_lock)
    valid_uids = list(dict.fromkeys(str(u).strip() for u in (uids or []) if str(u).strip()))
    if not valid_uids and uid:
        valid_uids = [str(uid).strip()]
    elif valid_uids and not uid:
        uid = valid_uids[0]

    uid = str(uid or "").strip()
    items = _normalize_keywords(keywords)
    if not uid:
        raise ValueError("Thiếu UID tài khoản")
    if not items:
        raise ValueError("Thiếu từ khóa")

    try:
        dmin = max(0.0, float(delay_min))
    except (TypeError, ValueError):
        dmin = 5.0
    try:
        dmax = max(dmin, float(delay_max))
    except (TypeError, ValueError):
        dmax = max(dmin, 10.0)

    # Chính sách: chỉ quét nhóm Public và không tham gia nhóm nào.
    # Bỏ qua giá trị client gửi để FE/Engine cũ không bật lại được.
    public_only = True
    private_only = False
    auto_join = False
    if min_members is not None:
        try:
            min_members = max(0, int(min_members))
        except (TypeError, ValueError):
            min_members = None
        if min_members == 0:
            min_members = None

    key = _pending_key(owner, uid)
    with _pending_lock:
        info = _pending.get(key)
        if info is not None:
            age = time.time() - float(info.get("started_at") or 0)
            old_job_id = info.get("job_id")
            old_status = None
            if old_job_id:
                with _jobs_lock:
                    old_status = (_jobs.get(old_job_id) or {}).get("status")

            stale = age >= STALE_PENDING_SEC
            finished = old_status in {"done", "error", "aborted"}
            if force or stale or finished or old_status is None:
                _pending.pop(key, None)
                if old_job_id:
                    with _jobs_lock:
                        old = _jobs.get(old_job_id)
                        if old and old.get("status") in {"running", "paused"}:
                            old["control"] = "abort"
                            if old.get("status") == "running":
                                old["status"] = "error"
                                old["error"] = "Job bị thay bằng lần Kiểm tra mới"
                    if old_status == "running":
                        _append_log(
                            old_job_id,
                            "⏹️ Đã bắt đầu phiên quét mới (thay thế job cũ).",
                            "info",
                        )
            else:
                raise RuntimeError("Nick đang chạy Kiểm tra — chờ xong rồi thử lại (hoặc đợi ~45s)")

        job_id = uuid.uuid4().hex[:12]
        _pending[key] = {"started_at": time.time(), "job_id": job_id, "uid": uid}

    keyword_stats = {
        item["keyword"]: {"count": 0, "status": "idle", "limit": item["limit"]}
        for item in items
    }
    with _jobs_lock:
        _jobs[job_id] = {
            "uid": uid,
            "uids": valid_uids,
            "rotate_after": rotate_after,
            "keyword": items[0]["keyword"],
            "keywords": [item["keyword"] for item in items],
            "keyword_stats": keyword_stats,
            "owner": owner,
            "status": "running",
            "error": "",
            "logs": [],
            "groups": [],
            "delay_min": dmin,
            "delay_max": dmax,
            "public_only": public_only,
            "private_only": private_only,
            "min_members": min_members,
            "auto_join": auto_join,
            "control": "run",
            "started_at": time.time(),
        }

    # Đảm bảo mỗi từ khóa tạo thành 1 DANH MỤC trong bảng scanned_group_categories ngay khi bắt đầu
    # CHỈ tạo danh mục cho TỪ KHÓA thực sự, KHÔNG tạo danh mục khi là link URL (Nhập link / Tải tệp)
    try:
        from modules.module_10_group_scan.models import create_scan_category
        for item in items:
            kw = str(item.get("keyword") or "").strip()
            is_url = kw.startswith("http") or "/groups/" in kw or "facebook.com" in kw or "fb.com" in kw
            if kw and not is_url:
                create_scan_category(owner, kw, f"Danh mục từ khóa: {kw}")
    except Exception as exc:
        logger.debug(f"auto create_scan_category in check error: {exc}")

    try:
        from modules.module_10_group_scan.models import create_scan_session
        import json
        words_str = ", ".join(item["keyword"] for item in items)
        cfg_str = json.dumps({
            "delay": f"{dmin:.0f} - {dmax:.0f}s",
            "privacy": "Công khai" if public_only else "Riêng tư" if private_only else "Tất cả",
            "minMembers": f"{min_members:,} TV" if min_members else "—",
            "maxKeywords": len(items),
            "autoJoin": bool(auto_join),
        }, ensure_ascii=False)
        create_scan_session(
            owner=owner,
            session_id=job_id,
            scan_type="GROUP_INFO",
            title=f"Quét thông tin nhóm theo từ khóa «{words_str[:80]}»",
            target=words_str,
            target_type="keywords",
            source_uid=uid,
            account_name=f"Nick {uid}",
            target_count=sum(item["limit"] for item in items),
            config=cfg_str,
        )
    except Exception as exc:
        logger.debug(f"create_scan_session error: {exc}")

    thread = threading.Thread(
        target=_run_check,
        args=(owner, uid, items, dmin, dmax, public_only, private_only, min_members, key, job_id, valid_uids, rotate_after),
        daemon=True,
        name=f"group-scan-check-{uid}",
    )
    thread.start()
    return {
        "started": True,
        "scan_version": 2,
        "uid": uid,
        "keyword": items[0]["keyword"],
        "keywords": [item["keyword"] for item in items],
        "keyword_limits": {item["keyword"]: item["limit"] for item in items},
        "job_id": job_id,
        "delay_min": dmin,
        "delay_max": dmax,
        "public_only": public_only,
        "private_only": private_only,
        "min_members": min_members,
        "auto_join": auto_join,
        "max_groups": items[0]["limit"],
    }


def _run_check(
    owner: Optional[str],
    uid: str,
    items: list[dict[str, Any]],
    delay_min: float,
    delay_max: float,
    public_only: bool,
    private_only: bool,
    min_members: Optional[int],
    key: str,
    job_id: str,
    uids: Optional[list[str]] = None,
    rotate_after: int = 50,
) -> None:
    from modules.module_02_account_manager.context import owner_scope

    try:
        with owner_scope(owner):
            _check_keywords_on_account(
                uid, items, delay_min, delay_max, job_id,
                owner=owner,
                public_only=public_only,
                private_only=private_only,
                min_members=min_members,
                uids=uids,
                rotate_after=rotate_after,
            )
    except Exception as exc:
        msg = str(exc)
        soft = any(
            token in msg
            for token in (
                "InvalidSessionId",
                "invalid session",
                "chrome not reachable",
                "disconnected",
                "no such window",
                "target window already closed",
            )
        )
        if soft:
            logger.warning("[%s] Browser đã đóng giữa Kiểm tra: %s", uid, exc)
            _append_log(job_id, "⏹️ Browser đã tắt / mất kết nối — dừng job. Bấm Kiểm tra lại được ngay.", "warn")
            _set_job(job_id, status="error", error="Browser đã tắt hoặc mất kết nối")
        else:
            logger.exception("[%s] Lỗi Kiểm tra từ khóa", uid)
            _append_log(job_id, f"❌ Lỗi Kiểm tra: {exc}", "error")
            _set_job(job_id, status="error", error=str(exc))
    finally:
        _release_pending(key, job_id=job_id)
        with _jobs_lock:
            job = _jobs.get(job_id)
            # Không ghi đè aborted / error đã set trong vòng lặp
            if job and job.get("status") in {"running", "paused"}:
                job["status"] = "done"
            if job:
                job["finished_at"] = time.time()
            final_status = (job or {}).get("status")
            logs_snapshot = list((job or {}).get("logs") or [])
        try:
            from modules.module_10_group_scan.models import update_scan_session
            st = {"done": "SUCCESS", "aborted": "ABORTED"}.get(final_status, "FAILED")
            update_scan_session(job_id, status=st, finished=True, logs=logs_snapshot)
        except Exception:
            pass


def _normalize_group_url(href: str) -> str:
    raw = (href or "").strip()
    if not raw:
        return ""
    if raw.startswith("/"):
        raw = "https://www.facebook.com" + raw
    try:
        parsed = urlparse(raw)
        path = re.sub(r"/+$", "", parsed.path or "")
        return urlunparse(("https", "www.facebook.com", path, "", "", ""))
    except Exception:
        return raw.split("?")[0].rstrip("/")


def _is_group_profile_url(url: str) -> bool:
    if "/groups/" not in url:
        return False
    bad = (
        "/search/",
        "/groups/search",
        "/permalink/",
        "/posts/",
        "/members/",
        "/files/",
        "/media/",
        "/about/",
        "/events/",
        "/feed/",
        "/discover/",
        "/joins/",
        "/create",
        "/user/",
    )
    if any(part in url for part in bad):
        return False
    slug = url.split("/groups/")[-1].split("/")[0].strip().lower()
    if not slug or slug in {"search", "feed", "discover", "create", "joins", "notifications"}:
        return False
    return True


def _parse_member_count(raw: Any) -> Optional[int]:
    """'463K' / '26N' / '1.2M' / '1,2 tr' / '1.234 thành viên' → int."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return int(raw)
    text = str(raw).strip()
    if not text or text == "—":
        return None
    m = re.search(
        r"([\d.,]+)\s*([KkMmBbNn]|tr|triệu|trieu|tỷ|ty)?\s*(?:members?|thành viên|thanh vien|người theo dõi)?",
        text,
        re.I,
    )
    if not m:
        digits = re.sub(r"[^\d]", "", text)
        return int(digits) if digits else None

    num_s = m.group(1).strip().replace(" ", "")
    suffix = (m.group(2) or "").upper()

    # Xử lý chuẩn xác dấu phân cách thập phân / hàng nghìn
    if "." in num_s and "," in num_s:
        if num_s.rfind(",") > num_s.rfind("."):
            num_s = num_s.replace(".", "").replace(",", ".")
        else:
            num_s = num_s.replace(",", "")
    elif "," in num_s:
        parts = num_s.split(",")
        if len(parts) == 2 and len(parts[1]) <= 2:
            num_s = parts[0] + "." + parts[1]
        else:
            num_s = num_s.replace(",", "")
    elif "." in num_s:
        parts = num_s.split(".")
        if len(parts) > 2:
            num_s = num_s.replace(".", "")
        elif len(parts) == 2 and len(parts[1]) == 3 and not suffix:
            num_s = num_s.replace(".", "")

    try:
        value = float(num_s)
    except ValueError:
        return None

    mult = {
        "K": 1_000,
        "N": 1_000,
        "M": 1_000_000,
        "TR": 1_000_000,
        "TRIỆU": 1_000_000,
        "TRIEU": 1_000_000,
        "B": 1_000_000_000,
        "TỶ": 1_000_000_000,
        "TY": 1_000_000_000,
    }.get(suffix, 1)
    return int(value * mult)


def _parse_group_meta(meta: str) -> dict[str, Any]:
    """
    'Public · 463K members · 90+ posts a day'
    'Công khai · 26N thành viên · …'
    → type public|private|unknown, members_label, members_count
    """
    text = re.sub(r"\s+", " ", (meta or "").strip())
    privacy = "unknown"
    low = text.lower()
    if re.search(r"\bpublic\b|công khai|cong khai", low):
        privacy = "public"
    elif re.search(r"\bprivate\b|riêng tư|rieng tu|bí mật|bi mat", low):
        privacy = "private"

    members_label = "—"
    members_count: Optional[int] = None
    m = re.search(
        r"([\d.,]+\s*(?:[KkMmBbNn]|tr|triệu|trieu|tỷ|ty)?)\s*(?:members?|thành viên|thanh vien|người theo dõi)",
        text,
        re.I,
    )
    if m:
        members_label = m.group(0).strip()
        members_count = _parse_member_count(m.group(1))
    else:
        # Fallback: đoạn giữa dấu ·
        parts = [p.strip() for p in re.split(r"[·•|]", text) if p.strip()]
        for part in parts[1:] if len(parts) > 1 else parts:
            cnt = _parse_member_count(part)
            if cnt is not None:
                members_label = part
                members_count = cnt
                break

    return {
        "type": privacy,
        "members": members_label,
        "members_count": members_count,
        "meta": text,
    }


def _passes_filters(
    meta: dict[str, Any],
    *,
    public_only: bool = False,
    private_only: bool = False,
    min_members: Optional[int] = None,
) -> tuple[bool, str]:
    privacy = meta.get("type") or "unknown"
    if public_only and privacy != "public":
        return False, f"bỏ (không public: {privacy})"
    if private_only and privacy != "private":
        return False, f"bỏ (không private: {privacy})"
    if min_members is not None and min_members > 0:
        count = meta.get("members_count")
        if count is None:
            count = _parse_member_count(meta.get("members"))
        if count is None:
            return False, "bỏ (không đọc được số thành viên)"
        if count < min_members:
            return False, f"bỏ ({count} < {min_members} thành viên)"
    return True, ""


def _clean_group_name(raw: str, url: str = "") -> str:
    name = re.sub(r"\s+", " ", str(raw or "").strip())
    name = name.split("\n")[0].strip()
    # 1. Bỏ tiền tố thông báo Facebook dạng (20+), (99+), (1), [5+], v.v.
    name = re.sub(r"^[\(\[]\d+\+?[\)\]]\s*", "", name).strip()
    # 2. Bỏ tiền tố ảnh đại diện
    name = re.sub(
        r"^(Profile photo of|Ảnh đại diện của|Anh dai dien cua)\s*",
        "",
        name,
        flags=re.I,
    ).strip()
    # 3. Bỏ hậu tố | Facebook
    name = re.sub(r"\s*\|\s*Facebook$", "", name, flags=re.I).strip()
    # 4. Lặp lại việc bỏ tiền tố thông báo nếu còn sót
    name = re.sub(r"^[\(\[]\d+\+?[\)\]]\s*", "", name).strip()

    if not name or re.match(r"^(join|tham gia|joined|notifications|facebook|search)$", name, re.I):
        slug = ""
        if "/groups/" in (url or ""):
            slug = url.split("/groups/")[-1].split("/")[0].split("?")[0].strip()
        name = slug or "Nhóm Facebook"
    return name


def _format_members_label(meta: dict[str, Any]) -> str:
    """Ưu tiên nhãn '463K', fallback số đầy đủ."""
    label = str(meta.get("members") or "").strip()
    if label and label != "—":
        # Rút gọn "463K members" → "463K"
        m = re.match(r"([\d.,]+\s*[KkMmBb]?)", label)
        if m:
            return m.group(1).replace(" ", "")
        return label
    count = meta.get("members_count")
    if isinstance(count, int) and count >= 0:
        if count >= 1_000_000:
            v = count / 1_000_000
            return f"{v:.1f}".rstrip("0").rstrip(".") + "M"
        if count >= 1_000:
            v = count / 1_000
            return f"{v:.1f}".rstrip("0").rstrip(".") + "K"
        return str(count)
    return "—"


def _click_groups_tab(driver, wait_and_find, human_sleep) -> bool:
    from selenium.webdriver.common.by import By

    human_sleep(1.5, 2.5)
    try:
        el = wait_and_find(driver, GROUPS_TAB_LOCATORS, timeout=18)
    except Exception:
        return False

    targets = [el]
    try:
        parent = el.find_element(By.XPATH, "./ancestor::*[@role='link' or @role='button' or @role='listitem'][1]")
        targets.insert(0, parent)
    except Exception:
        pass

    for target in targets:
        try:
            target.click()
            human_sleep(1.5, 2.5)
            return True
        except Exception:
            try:
                driver.execute_script("arguments[0].click();", target)
                human_sleep(1.5, 2.5)
                return True
            except Exception:
                continue
    return False


def _scrape_group_direct(
    driver,
    target_url: str,
    job_id: str,
    human_sleep,
    *,
    public_only: bool = False,
    private_only: bool = False,
    min_members: Optional[int] = None,
    owner: Optional[str] = None,
    source_uid: Optional[str] = None,
    known_group_ids: Optional[set[str]] = None,
) -> Optional[dict[str, Any]]:
    """Quét trực tiếp thông tin nhóm khi người dùng cung cấp link / file link.
    - Privacy: <div class="x9f619 x1n2onr6 x1ja2u2z x78zum5 xdt5ytf x2lah0s x193iq5w xeuugli x14vy60q xyiysdx x1120s5i x1nn3v0j">Public group</div>
    - Members: <a class="x1i10hfl ... href="/groups/.../members/" role="link">257.6K members</a>
    - Join button: <span class="x1lliihq x6ikm8r x10wlt62 x1n2onr6 xlyipyv xuxw1ft">Join group</span>
    """
    from modules.module_10_group_scan.models import (
        normalize_group_id,
        upsert_scanned_group,
    )

    clean_url = _normalize_group_url(target_url)
    if not clean_url:
        clean_url = target_url
    gid = normalize_group_id(clean_url)
    # Link do người dùng tự nhập: luôn mở ra lấy thông tin mới — nhóm đã có trong danh sách thì cập nhật lại,
    # không bỏ qua như khi quét theo từ khóa.

    try:
        driver.get(clean_url)
        human_sleep(2.5, 4.0)
    except Exception as exc:
        if is_browser_dead_error(exc):
            raise  # Chrome đã tắt → luồng dừng, không thử tiếp từng link trên trình duyệt chết
        _append_log(job_id, f"⚠️ Không tải được link {clean_url}: {exc}", "warn")
        return None

    SCRAPE_DIRECT_GROUP_JS = r"""
    return (() => {
      const res = {
        title: document.title || '',
        name: '',
        privacy: '',
        privacyRaw: '',
        membersText: '',
      };

      // 1. Tên nhóm (ưu tiên h1)
      const h1 = document.querySelector('h1');
      if (h1) {
        res.name = (h1.innerText || h1.textContent || '').trim();
      }

      // 2. Xem nhóm là private hay public qua element:
      // <div class="x9f619 x1n2onr6 x1ja2u2z x78zum5 xdt5ytf x2lah0s x193iq5w xeuugli x14vy60q xyiysdx x1120s5i x1nn3v0j">Public group</div>
      const privacySelector = 'div.x9f619.x1n2onr6.x1ja2u2z.x78zum5.xdt5ytf.x2lah0s.x193iq5w.xeuugli.x14vy60q.xyiysdx.x1120s5i.x1nn3v0j';
      const privacyNodes = document.querySelectorAll(privacySelector);
      for (const node of privacyNodes) {
        const txt = (node.innerText || node.textContent || '').trim();
        if (!txt) continue;
        res.privacyRaw = txt;
        if (/public group|nhóm công khai|public|công khai/i.test(txt)) {
          res.privacy = 'public';
          break;
        }
        if (/private group|nhóm riêng tư|private|riêng tư|bí mật/i.test(txt)) {
          res.privacy = 'private';
          break;
        }
      }

      // Fallback nếu class trên div có biến thể nhẹ
      if (!res.privacy) {
        const leafDivs = document.querySelectorAll('div, span');
        for (const el of leafDivs) {
          if (el.children.length > 0) continue;
          const txt = (el.innerText || el.textContent || '').trim();
          if (/^(public group|nhóm công khai)$/i.test(txt)) {
            res.privacy = 'public';
            res.privacyRaw = txt;
            break;
          }
          if (/^(private group|nhóm riêng tư)$/i.test(txt)) {
            res.privacy = 'private';
            res.privacyRaw = txt;
            break;
          }
        }
      }

      // 3. Xem nhóm có bao nhiêu thành viên qua element:
      // <a class="x1i10hfl ... href="/groups/.../members/" role="link">257.6K members</a>
      const memberAnchors = document.querySelectorAll(
        'a.x1i10hfl[href*="/members/"], a[href*="/members/"], a[href*="/members"]'
      );
      for (const a of memberAnchors) {
        const txt = (a.innerText || a.textContent || '').trim();
        if (/[\d.,]+\s*[KkMmBb]?\s*(members|thành viên)/i.test(txt) || /^[\d.,]+\s*[KkMmBb]?$/i.test(txt)) {
          res.membersText = txt;
          break;
        }
      }

      // Fallback thẻ a có class x1i10hfl hoặc role="link"
      if (!res.membersText) {
        const possibleAnchors = document.querySelectorAll('a.x1i10hfl, a[role="link"]');
        for (const a of possibleAnchors) {
          const txt = (a.innerText || a.textContent || '').trim();
          if (/[\d.,]+\s*[KkMmBb]?\s*(members|thành viên)/i.test(txt)) {
            res.membersText = txt;
            break;
          }
        }
      }

      // Fallback toàn trang nếu Facebook không render liên kết /members/
      if (!res.membersText) {
        const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ');
        const m = bodyText.match(/[\d.,]+\s*[KkMmBb]?\s*(members|thành viên)/i);
        if (m) {
          res.membersText = m[0];
        }
      }

      return res;
    })();
    """

    data: dict[str, Any] = {}
    for _ in range(4):
        try:
            data = driver.execute_script(SCRAPE_DIRECT_GROUP_JS) or {}
            if data.get("privacy") or data.get("membersText"):
                break
        except Exception:
            pass
        human_sleep(0.8, 1.2)

    # Ưu tiên h1 (tên nhóm trực tiếp trên trang, không dính thông báo Facebook)
    candidate_name = data.get("name") or data.get("h1") or ""
    if not candidate_name or candidate_name.lower() in {"notifications", "facebook", "search"}:
        candidate_name = data.get("title") or ""

    cleaned_name = _clean_group_name(candidate_name, clean_url)

    # Privacy: Ưu tiên giá trị đọc từ element div.x9f619...
    privacy = data.get("privacy") or "unknown"
    if privacy == "unknown":
        raw_p = (data.get("privacyRaw") or "").lower()
        if "public" in raw_p or "công khai" in raw_p:
            privacy = "public"
        elif "private" in raw_p or "riêng tư" in raw_p:
            privacy = "private"

    # Members: Ưu tiên giá trị đọc từ element a.x1i10hfl... /members/
    members_text = data.get("membersText") or ""
    members_count = _parse_member_count(members_text)
    meta_info = {
        "type": privacy,
        "members": members_text,
        "members_count": members_count,
    }

    ok, reason = _passes_filters(
        meta_info,
        public_only=public_only,
        private_only=private_only,
        min_members=min_members,
    )
    if not ok:
        _append_log(job_id, f"⏭️ {cleaned_name}: {reason} ({privacy.upper()} · {members_text})", "info")
        return None

    members_label = _format_members_label(meta_info)
    item = {
        "id": clean_url,
        "keyword": clean_url,
        "name": cleaned_name,
        "url": clean_url.replace("https://www.", "").replace("https://", ""),
        "href": clean_url,
        "type": privacy,
        "members": members_label,
        "members_count": members_count,
        "note": "—",
    }

    is_new = True
    try:
        is_new = upsert_scanned_group(owner=owner, keyword="DirectLink", group=item, source_uid=source_uid)
        if gid and known_group_ids is not None:
            known_group_ids.add(gid)
    except Exception as exc:
        _append_log(job_id, f"⚠️ Lỗi lưu nhóm vào DB: {exc}", "warn")

    if is_new:
        _append_log(job_id, f"✅ Đã quét: {cleaned_name} ({privacy.upper()} · {members_label})", "success")
    else:
        _append_log(
            job_id,
            f"♻️ {cleaned_name} đã có trong Danh sách nhóm quét — đã cập nhật lại thông tin "
            f"({privacy.upper()} · {members_label}).",
            "success",
        )
    return item


# Đọc kết quả tìm kiếm nhóm: href + tên + meta ("Public · 463K members · 90+ posts a day"),
# gom theo URL, bỏ "Profile photo of". Dùng chung cho luồng quét và luồng Kiểm tra từ khóa.
GROUP_RESULTS_JS = """
    const root =
      document.querySelector('[aria-label="Search results"][role="main"]') ||
      document.querySelector('[aria-label="Search results"]') ||
      document.querySelector('[role="main"]');
    if (!root) return [];
    const byHref = new Map();
    const metaRe = /(Public|Private|Công khai|Cong khai|Riêng tư|Rieng tu|Bí mật)\\s*[·•|]\\s*[\\d.,]+\\s*(?:[KkMmBbNn]|tr|triệu|trieu)?\\s*(members?|thành viên|thanh vien|người theo dõi)/i;
    const softMetaRe = /[\\d.,]+\\s*(?:[KkMmBbNn]|tr|triệu|trieu)?\\s*(members?|thành viên|thanh vien|người theo dõi)/i;

    const cleanName = (raw) => {
      let n = (raw || '').replace(/\\s+/g, ' ').trim();
      n = n.split('\\n')[0].trim();
      n = n.replace(/^(Profile photo of|Ảnh đại diện của|Anh dai dien cua)\\s*/i, '');
      if (!n || /^(join|tham gia|joined|đang chờ)$/i.test(n)) return '';
      return n;
    };

    const findMeta = (el) => {
      let node = el;
      for (let depth = 0; depth < 12 && node && node !== root; depth++) {
        const spans = node.querySelectorAll ? node.querySelectorAll('span') : [];
        for (const sp of spans) {
          const t = (sp.innerText || sp.textContent || '').replace(/\\s+/g, ' ').trim();
          if (t.length < 6 || t.length > 180) continue;
          if (metaRe.test(t) || softMetaRe.test(t)) return t;
        }
        // Cả block text của card
        const block = (node.innerText || '').replace(/\\s+/g, ' ').trim();
        const m = block.match(metaRe) || block.match(/((?:Public|Private|Công khai)[^\\n]{0,100}?(?:members?|thành viên))/i);
        if (m) return m[0].trim();
        node = node.parentElement;
      }
      return '';
    };

    const anchors = root.querySelectorAll('a[href*="/groups/"]');
    for (const a of anchors) {
      let href = a.getAttribute('href') || a.href || '';
      if (!href.includes('/groups/')) continue;
      if (href.includes('notif_id') || href.includes('/search/') || href.includes('ref=notif')) continue;
      try {
        const u = new URL(href, location.origin);
        href = u.origin + u.pathname.replace(/\\/+$/, '');
      } catch (e) {
        href = href.split('?')[0].replace(/\\/+$/, '');
      }
      let name = cleanName(a.getAttribute('aria-label') || '');
      if (!name) name = cleanName(a.innerText || a.textContent || '');
      const meta = findMeta(a);

      const prev = byHref.get(href) || { href, name: '', meta: '' };
      if (name && (!prev.name || prev.name.length < name.length)) prev.name = name;
      if (meta && (!prev.meta || meta.length > prev.meta.length)) prev.meta = meta;
      byHref.set(href, prev);
    }
    return Array.from(byHref.values());
"""


def _scrape_groups_from_results(
    driver,
    keyword: str,
    job_id: str,
    human_sleep,
    max_groups: int,
    already: Optional[list[dict[str, Any]]] = None,
    *,
    public_only: bool = False,
    private_only: bool = False,
    min_members: Optional[int] = None,
    owner: Optional[str] = None,
    source_uid: Optional[str] = None,
    known_group_ids: Optional[set[str]] = None,
    delay_min: float = 0.0,
    delay_max: float = 0.0,
    stat_offset: int = 0,
    display_limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Quét kết quả tìm kiếm tới khi đủ `max_groups` nhóm MỚI.

    `stat_offset` / `display_limit`: khi một từ khóa được quét qua nhiều lượt (đổi nick giữa chừng),
    log và bảng thống kê vẫn hiển thị tổng của cả từ khóa.
    """
    from modules.module_10_group_scan.models import (
        normalize_group_id,
        upsert_scanned_group,
    )

    from modules.module_10_group_scan.keyword_capacity import (
        MAX_LOADING_WAITS,
        MAX_ROUNDS,
        NO_GROWTH_ROUNDS,
        _END_OF_RESULTS_JS,
        _NUDGE_JS,
        _scroll_results,
    )

    found: list[dict[str, Any]] = []
    seen: set[str] = {str(g.get("href") or g.get("id") or "") for g in (already or [])}
    known = set(known_group_ids or set())
    limit = _clamp_limit(max_groups)
    skipped = 0
    skipped_dup = 0
    # Cuộn giống hệt nút Kiểm tra: chỉ dừng khi NO_GROWTH_ROUNDS lượt liền Facebook không hiện nhóm mới
    # (đang tải thì chờ thêm), để số nhóm quét thật khớp với số Kiểm tra báo.
    idle = 0
    loading_waits = 0
    # Nhóm đã thấy trên trang lần này (kể cả nhóm đã lấy ở nick trước). Sau khi đổi nick phải cuộn lại qua
    # các nhóm cũ — những lượt đó vẫn là Facebook đang tải thêm, không được tính là "hết kết quả".
    page_seen: set[str] = set()

    def _aborted() -> bool:
        return _get_control(job_id) == "abort"

    js = GROUP_RESULTS_JS

    for round_idx in range(MAX_ROUNDS):
        if _aborted():
            _append_log(job_id, f"🛑 Dừng khẩn cấp giữa lúc quét «{keyword}».", "warn")
            break
        if len(found) >= limit:
            break
        page_before = len(page_seen)
        try:
            rows = driver.execute_script(js) or []
        except Exception as exc:
            if is_browser_dead_error(exc):
                raise
            _append_log(job_id, f"⚠️ Lỗi đọc DOM kết quả: {exc}", "warn")
            rows = []

        for row in rows:
            if _aborted():
                break
            if _handle_pause_if_requested(job_id, context_label=keyword):
                return found
            url = _normalize_group_url(row.get("href") or "")
            if not _is_group_profile_url(url):
                continue
            page_seen.add(url)
            if url in seen:
                continue
            seen.add(url)

            gid = normalize_group_id(url)
            if gid and gid in known:
                skipped_dup += 1
                if skipped_dup <= 5 or skipped_dup % 15 == 0:
                    _append_log(
                        job_id,
                        f"⏭️ «{keyword}» bỏ trùng DB: {gid}",
                        "info",
                    )
                continue

            meta_info = _parse_group_meta(row.get("meta") or "")
            ok, reason = _passes_filters(
                meta_info,
                public_only=public_only,
                private_only=private_only,
                min_members=min_members,
            )
            name = _clean_group_name(row.get("name") or "", url)
            if not ok:
                skipped += 1
                if skipped <= 8 or skipped % 10 == 0:
                    _append_log(
                        job_id,
                        f"⏭️ «{keyword}» {name}: {reason}"
                        + (f" — {meta_info.get('meta')}" if meta_info.get("meta") else ""),
                        "info",
                    )
                continue

            members_label = _format_members_label(meta_info)
            privacy = meta_info.get("type") or "unknown"

            item = {
                "id": url,
                "keyword": keyword,
                "name": name,
                "url": url.replace("https://www.", "").replace("https://", ""),
                "href": url,
                "type": privacy,
                "members": members_label,
                "members_count": meta_info.get("members_count"),
                "note": "—",
            }

            # Lưu Supabase ngay — tránh mất khi tắt browser
            try:
                is_new = upsert_scanned_group(
                    owner=owner,
                    keyword=keyword,
                    group=item,
                    source_uid=source_uid,
                )
                if gid:
                    known.add(gid)
                if not is_new:
                    skipped_dup += 1
                    _append_log(job_id, f"⏭️ «{keyword}» đã có trong DB: {name}", "info")
                    continue
            except Exception as exc:
                _append_log(job_id, f"⚠️ Lưu DB lỗi ({name}): {exc}", "warn")

            found.append(item)
            mem = members_label or "?"
            _append_log(
                job_id,
                f"➕ [{stat_offset + len(found)}/{display_limit or limit}] «{keyword}» {name} · {meta_info.get('type')} · {mem} — {url}",
                "success",
            )
            total_found = _add_job_groups(job_id, [item])
            try:
                from modules.module_10_group_scan.models import update_scan_session
                update_scan_session(job_id, total_found=total_found)
            except Exception:
                pass
            _update_keyword_stat(job_id, keyword, count=stat_offset + len(found), status="running")
            if len(found) >= limit:
                break

            # Khoảng cách giữa các lần quét: delay_min đến delay_max giây
            if delay_max > 0:
                wait_sec = random.uniform(delay_min, delay_max)
                _append_log(job_id, f"⏳ Nghỉ {wait_sec:.1f}s trước khi quét nhóm tiếp theo…", "info")
                end_time = time.time() + wait_sec
                while time.time() < end_time:
                    if _aborted():
                        break
                    if _get_control(job_id) in {"pause", "pause_after", "paused"}:
                        if _handle_pause_if_requested(job_id, context_label=name):
                            return found
                        break
                    time.sleep(min(0.5, max(0.0, end_time - time.time())))
            else:
                if _handle_pause_if_requested(job_id, context_label=name):
                    return found

        if len(found) >= limit:
            break

        if _handle_pause_if_requested(job_id, context_label=keyword):
            return found

        try:
            flags = driver.execute_script(_END_OF_RESULTS_JS) or {}
        except Exception as exc:
            if is_browser_dead_error(exc):
                raise
            flags = {}
        if flags.get("blocked"):
            _append_log(job_id, f"⚠️ «{keyword}»: Facebook tạm chặn hoặc yêu cầu xác minh tài khoản — dừng từ khóa này.", "warn")
            break
        if len(page_seen) > page_before:
            idle = 0
            loading_waits = 0
        elif flags.get("loading") and loading_waits < MAX_LOADING_WAITS:
            loading_waits += 1  # Facebook đang tải lô tiếp theo → chờ, chưa tính là hết
        else:
            idle += 1
        if flags.get("end") and idle >= 2:
            _append_log(job_id, f"ℹ️ «{keyword}»: Facebook báo đã hết kết quả tìm kiếm.", "info")
            break
        if idle >= NO_GROWTH_ROUNDS:
            _append_log(job_id, f"ℹ️ «{keyword}»: Facebook không hiện thêm nhóm nào nữa.", "info")
            break

        _scroll_results(driver)
        if idle:
            # Chưa ra nhóm mới: lắc cuộn để Facebook tải tiếp, chờ lâu hơn.
            try:
                driver.execute_script(_NUDGE_JS)
            except Exception:
                pass
            human_sleep(2.5, 4.0)
            if idle in (1, 4, 7):
                _append_log(
                    job_id,
                    f"… «{keyword}» chưa thấy nhóm mới ({idle}/{NO_GROWTH_ROUNDS}) — cuộn lại để Facebook tải tiếp, "
                    f"giữ {len(found)}/{limit}.",
                    "info",
                )
        else:
            human_sleep(1.6, 2.6)
            _append_log(
                job_id,
                f"… «{keyword}» cuộn xuống tải thêm nhóm, giữ {len(found)}/{limit}"
                + (f", bỏ {skipped}" if skipped else "")
                + ".",
                "info",
            )

    if skipped or skipped_dup:
        _append_log(
            job_id,
            f"ℹ️ «{keyword}» bỏ lọc={skipped}, bỏ trùng DB={skipped_dup}.",
            "info",
        )
    return found[:limit]


def _clear_search_input(driver, search_el) -> None:
    from selenium.webdriver.common.keys import Keys

    try:
        search_el.click()
    except Exception:
        try:
            driver.execute_script("arguments[0].click();", search_el)
        except Exception:
            pass
    try:
        search_el.clear()
    except Exception:
        pass
    try:
        search_el.send_keys(Keys.CONTROL, "a")
        search_el.send_keys(Keys.BACKSPACE)
    except Exception:
        pass
    try:
        driver.execute_script(
            "arguments[0].value='';"
            "arguments[0].dispatchEvent(new Event('input',{bubbles:true}));",
            search_el,
        )
    except Exception:
        pass


def _search_and_open_groups(
    driver,
    keyword: str,
    job_id: str,
    wait_and_find,
    human_sleep,
    human_type,
    *,
    reset_home: bool = False,
) -> None:
    """Gõ từ khóa vào ô Search Facebook → Enter → tab Groups. reset_home=True khi chuyển từ khóa."""
    from selenium.webdriver.common.keys import Keys

    if reset_home:
        _append_log(job_id, f"🔄 Về trang chủ rồi mở lại ô tìm kiếm cho «{keyword}»…", "info")
        try:
            driver.get("https://www.facebook.com/")
            human_sleep(2.0, 3.0)
        except Exception as exc:
            _append_log(job_id, f"⚠️ Không về được trang chủ: {exc}", "warn")

    typed = False
    try:
        search_el = wait_and_find(driver, SEARCH_INPUT_LOCATORS, timeout=20)
        _clear_search_input(driver, search_el)
        human_sleep(0.25, 0.45)
        # Lấy lại ô search sau khi clear (FB hay re-render)
        try:
            search_el = wait_and_find(driver, SEARCH_INPUT_LOCATORS, timeout=8)
        except Exception:
            pass
        human_type(search_el, keyword)
        human_sleep(0.3, 0.6)
        _append_log(job_id, f"✅ Đã gõ «{keyword}» vào ô Search — Enter…", "success")
        search_el.send_keys(Keys.ENTER)
        human_sleep(2.5, 3.5)
        typed = True
    except Exception as exc:
        _append_log(job_id, f"⚠️ Không gõ được ô Search («{keyword}»): {exc}", "warn")

    if not typed:
        url = f"https://www.facebook.com/search/groups/?q={quote(keyword)}"
        _append_log(job_id, f"↪️ Mở thẳng kết quả Groups: {url}", "info")
        driver.get(url)
        human_sleep(2.5, 3.5)
    else:
        _append_log(job_id, f"🔎 «{keyword}» — click tab Groups / Nhóm…", "info")
        clicked = _click_groups_tab(driver, wait_and_find, human_sleep)
        if not clicked:
            url = f"https://www.facebook.com/search/groups/?q={quote(keyword)}"
            _append_log(job_id, f"⚠️ Không click được Groups — mở trực tiếp {url}", "warn")
            driver.get(url)
            human_sleep(2.5, 3.5)
        else:
            _append_log(job_id, f"✅ «{keyword}» đã vào filter Groups.", "success")
            try:
                cur = driver.current_url or ""
                if "/search/groups" not in cur:
                    driver.get(f"https://www.facebook.com/search/groups/?q={quote(keyword)}")
                    human_sleep(2.0, 3.0)
            except Exception:
                pass

    try:
        wait_and_find(driver, RESULTS_ROOT_LOCATORS, timeout=15)
        _append_log(job_id, f"✅ «{keyword}» — thấy Search results, bắt đầu quét…", "success")
    except Exception:
        _append_log(job_id, f"⚠️ «{keyword}» chưa thấy Search results — vẫn thử quét /groups/…", "warn")


MAX_PARALLEL_BROWSERS = 5
BROWSER_STAGGER_SEC = 3.0


def _is_direct_group_link(keyword: str) -> bool:
    return (
        keyword.startswith("http")
        or "/groups/" in keyword
        or "fb.com/" in keyword
        or "facebook.com/" in keyword
    )


def _wait_interruptible(job_id: str, seconds: float, *, pause_label: str = "") -> bool:
    """Chờ `seconds` giây; trả True nếu bị Dừng khẩn cấp (kể cả khi đang tạm dừng)."""
    end_at = time.time() + max(0.0, seconds)
    while time.time() < end_at:
        control = _get_control(job_id)
        if control == "abort":
            return True
        if control in {"pause", "pause_after", "paused"}:
            return _handle_pause_if_requested(job_id, context_label=pause_label)
        time.sleep(min(0.5, max(0.0, end_at - time.time())))
    return _get_control(job_id) == "abort"


def _check_keywords_on_account(
    uid: str,
    items: list[dict[str, Any]],
    delay_min: float,
    delay_max: float,
    job_id: str,
    *,
    owner: Optional[str] = None,
    public_only: bool = False,
    private_only: bool = False,
    min_members: Optional[int] = None,
    uids: Optional[list[str]] = None,
    rotate_after: Optional[int] = None,  # không còn dùng — giữ để client cũ gửi lên không lỗi
) -> None:
    """Quét song song: mỗi nick mở 1 Chrome, các Chrome lần lượt lấy từ khóa trong hàng đợi chung.

    Số Chrome = min(số nick, số từ khóa, MAX_PARALLEL_BROWSERS). Một nick không bao giờ mở 2 Chrome
    (Chrome không cho 2 cửa sổ dùng chung profile, và Facebook dễ nghi ngờ) → 1 nick + nhiều từ khóa
    thì quét lần lượt; nick dư (nhiều nick hơn từ khóa) không mở, chỉ dùng thay khi nick khác lỗi.
    """
    if not owner:
        with _jobs_lock:
            owner = (_jobs.get(job_id) or {}).get("owner")
    from modules.module_02_account_manager.automation import (
        human_sleep,
        human_type,
        wait_and_find,
    )
    from modules.module_02_account_manager.context import owner_scope
    from modules.module_10_group_scan.models import list_known_group_ids, normalize_group_id

    pool = list(dict.fromkeys(str(u).strip() for u in (uids or []) if str(u).strip())) or [str(uid)]
    if uid in pool:
        pool.remove(uid)
        pool.insert(0, uid)
    workers = max(1, min(len(pool), len(items), MAX_PARALLEL_BROWSERS))
    nick_queue: deque = deque(pool)
    # Chia đều: mỗi Chrome len(items)//workers việc, phần dư cho Chrome xong phần mình trước.
    item_queue = FairQueue(enumerate(items), workers)
    queue_lock = threading.Lock()
    state = {"opened": 0}

    def stop_requested() -> bool:
        return _get_control(job_id) == "abort"

    def log(message: str, level: str = "info") -> None:
        _append_log(job_id, message, "warn" if level == "warn" else level)

    def take(queue: deque):
        with queue_lock:
            return queue.popleft() if queue else None

    try:
        known_ids = list_known_group_ids(owner)
    except Exception as exc:
        logger.warning("list_known_group_ids failed: %s", exc)
        known_ids = set()
    _append_log(job_id, f"🗄️ DB: đã có {len(known_ids)} nhóm của owner — sẽ bỏ trùng khi quét.", "info")

    filter_bits = []
    if public_only:
        filter_bits.append("chỉ Public")
    if private_only:
        filter_bits.append("chỉ Private")
    if min_members:
        filter_bits.append(f">={min_members} thành viên")
    filter_txt = f", lọc: {', '.join(filter_bits)}" if filter_bits else ""
    all_links = all(_is_direct_group_link(it["keyword"]) for it in items)
    noun = "link nhóm" if all_links else "từ khóa"
    if workers > 1:
        mode = f"mở {workers} Chrome song song, mỗi Chrome làm 1 {noun} một lúc"
    elif len(items) > 1:
        mode = "1 Chrome làm lần lượt (mỗi nick chỉ mở 1 Chrome)"
    else:
        mode = "mở 1 Chrome"
    spare = len(pool) - workers
    if all_links:
        plan = f"mở từng link lấy thông tin nhóm (nhóm đã có thì cập nhật lại), nghỉ {delay_min:.0f}–{delay_max:.0f}s giữa các link"
    else:
        plan = "hạn mức: " + ", ".join(f"«{it['keyword']}»×{it['limit']}" for it in items) + (
            f" (nghỉ {delay_min:.0f}–{delay_max:.0f}s)"
        )
    _append_log(
        job_id,
        f"🚀 {len(items)} {noun}, {len(pool)} nick → {mode}"
        + (f"; {spare} nick dự phòng" if spare > 0 else "")
        + f". {plan[0].upper()}{plan[1:]}{filter_txt}, chỉ lấy nhóm Public, KHÔNG tham gia nhóm.",
        "info",
    )

    def scan_item(driver, nick: str, idx: int, item: dict[str, Any], reset_home: bool) -> bool:
        """Quét 1 từ khóa / 1 link. Trả False khi Chrome đã chết (luồng phải dừng)."""
        keyword = item["keyword"]
        limit = _clamp_limit(item.get("limit"))
        is_link = _is_direct_group_link(keyword)
        _update_keyword_stat(job_id, keyword, status="running", count=0, limit=1 if is_link else limit, uid=nick)
        _append_log(
            job_id,
            f"▶️ [{idx + 1}/{len(items)}] Nick {nick} mở link nhóm {keyword}"
            if is_link
            else f"▶️ [{idx + 1}/{len(items)}] Nick {nick} quét «{keyword}» — dừng khi đủ {limit} nhóm mới (bỏ trùng DB).",
            "info",
        )
        collected: list[dict[str, Any]] = []
        try:
            if is_link:
                group = _scrape_group_direct(
                    driver, keyword, job_id, human_sleep,
                    public_only=public_only, private_only=private_only, min_members=min_members,
                    owner=owner, source_uid=nick, known_group_ids=known_ids,
                )
                collected = [group] if group else []
                _add_job_groups(job_id, collected)
            else:
                _search_and_open_groups(
                    driver, keyword, job_id, wait_and_find, human_sleep, human_type, reset_home=reset_home,
                )
                if not stop_requested():
                    collected = _scrape_groups_from_results(
                        driver, keyword, job_id, human_sleep,
                        max_groups=limit,
                        already=_job_groups(job_id),
                        public_only=public_only, private_only=private_only, min_members=min_members,
                        owner=owner, source_uid=nick, known_group_ids=known_ids,
                        delay_min=delay_min, delay_max=delay_max,
                        display_limit=limit,
                    )
            for g in collected:
                gid = normalize_group_id(g.get("href") or "")
                if gid:
                    known_ids.add(gid)
            collected = collected[:limit]
            _add_job_groups(job_id, collected)  # bỏ trùng theo href — nhóm đã thêm lúc quét không bị đếm 2 lần
            stopped = stop_requested()
            _update_keyword_stat(
                job_id, keyword, count=len(collected), status="stopped" if stopped else "done",
                limit=1 if is_link else limit,
            )
            if not stopped and not is_link:  # link: _scrape_group_direct đã ghi kết quả
                _append_log(job_id, f"🏁 Xong «{keyword}»: {len(collected)}/{limit} nhóm.", "success")
            return True
        except Exception as exc:
            if is_browser_dead_error(exc):
                _update_keyword_stat(job_id, keyword, status="stopped")
                _append_log(job_id, f"🛑 Chrome của nick {nick} đã bị đóng — dừng «{keyword}».", "warn")
                return False
            logger.exception("[%s] keyword «%s» failed", nick, keyword)
            _update_keyword_stat(job_id, keyword, status="error")
            _append_log(job_id, f"❌ «{keyword}» lỗi: {exc}", "error")
            return True

    def run_worker(n: int) -> None:
        _thread_label.name = f"Thread-{n:02d}"
        session = None
        taken = 0
        try:
            # Mở Chrome lệch nhau vài giây để máy không bị dồn tải cùng lúc.
            if n > 1 and _wait_interruptible(job_id, (n - 1) * BROWSER_STAGGER_SEC):
                return
            while session is None:
                if stop_requested():
                    return
                if not item_queue.has_work(taken):
                    return  # luồng khác đã làm hết
                nick = take(nick_queue)
                if nick is None:
                    _append_log(job_id, "⚠️ Không còn nick nào mở được Chrome cho luồng này.", "warn")
                    return
                _append_log(job_id, f"🌐 Nick {nick}: đang mở Chrome…", "info")
                session = open_account_session(
                    [nick], 0, owner=owner, scope="group-scan", log=log,
                    lock_timeout=8, should_stop=stop_requested,
                )
            nick = session["uid"]
            driver = session["driver"]
            with queue_lock:
                state["opened"] += 1
            try:
                current = (driver.current_url or "").lower()
            except Exception:
                current = ""
            if "facebook.com" not in current:
                driver.get("https://www.facebook.com/")
                human_sleep(2.0, 3.0)
            _append_log(job_id, f"✅ Nick {nick} sẵn sàng quét.", "success")

            first = True
            while True:
                if stop_requested():
                    return
                if _handle_pause_if_requested(job_id, context_label=f"nick {nick}"):
                    return
                nxt = item_queue.take(taken)
                if nxt is None:
                    return
                taken += 1
                idx, item = nxt
                if not first and delay_max > 0:
                    wait_sec = random.uniform(delay_min, delay_max)
                    _append_log(
                        job_id, f"➡️ Nick {nick}: tiếp theo «{item['keyword']}» — nghỉ {wait_sec:.1f}s…", "info",
                    )
                    if _wait_interruptible(job_id, wait_sec, pause_label=f"Nghỉ trước «{item['keyword']}»"):
                        item_queue.put_back(nxt)
                        return
                if not scan_item(driver, nick, idx, item, reset_home=not first):
                    return
                first = False
        except Exception as exc:
            if is_browser_dead_error(exc):
                _append_log(job_id, "🛑 Chrome đã bị đóng — luồng này dừng.", "warn")
            else:
                logger.exception("[%s] group scan worker failed", job_id)
                _append_log(job_id, f"❌ Luồng quét lỗi: {exc}", "error")
        finally:
            item_queue.release(taken)  # dừng sớm → phần chưa làm chuyển cho Chrome khác
            if session:
                _append_log(job_id, f"🔒 Đóng Chrome của nick {session.get('uid')}.", "info")
            close_account_session(session)

    def run_worker_scoped(n: int) -> None:
        with owner_scope(owner):
            run_worker(n)

    threads = [
        threading.Thread(target=run_worker_scoped, args=(n,), daemon=True, name=f"group-scan-check-{job_id}-{n}")
        for n in range(1, workers + 1)
    ]
    for t in threads:
        t.start()
    for t in threads:
        if hasattr(t, "join"):
            t.join()

    total = len(_job_groups(job_id))
    leftover = item_queue.remaining()
    for _, item in leftover:
        _update_keyword_stat(job_id, item["keyword"], status="stopped")
    if stop_requested():
        _append_log(job_id, f"🛑 Đã dừng khẩn cấp — đã lưu {total} nhóm.", "warn")
        _set_job(job_id, status="aborted", error="Dừng khẩn cấp")
        return
    with _jobs_lock:
        if (_jobs.get(job_id) or {}).get("status") == "aborted":
            return  # bị dừng trong lúc tạm dừng / tạm dừng quá 2 giờ
    if state["opened"] == 0:
        msg = "Không nick nào mở được Chrome và đăng nhập Facebook"
        _append_log(job_id, f"❌ {msg}.", "error")
        _set_job(job_id, status="error", error=msg)
        return
    if leftover:
        _append_log(job_id, f"⚠️ {len(leftover)} từ khóa chưa quét vì Chrome đã bị đóng.", "warn")
        _set_job(job_id, status="aborted", error="Chrome đã bị đóng")
        return
    _set_job(job_id, status="done")
    _append_log(job_id, f"🏁 Hoàn tất {len(items)} {noun} — tổng {total} nhóm.", "success")
