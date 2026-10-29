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
from typing import Any, Optional
from urllib.parse import quote, urlparse, urlunparse

logger = logging.getLogger(__name__)

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


def get_check_status(job_id: Optional[str] = None, uid: Optional[str] = None) -> Optional[dict[str, Any]]:
    if job_id:
        return _job_snapshot(job_id)
    uid = str(uid or "").strip()
    if not uid:
        return None
    with _jobs_lock:
        matches = [jid for jid, job in _jobs.items() if str(job.get("uid")) == uid]
        if not matches:
            return None
        matches.sort(key=lambda jid: _jobs[jid].get("started_at") or 0, reverse=True)
        return _job_snapshot(matches[0])


def _append_log(job_id: str, text: str, tone: str = "info") -> None:
    line = {
        "time": time.strftime("%H:%M:%S"),
        "thread": "Thread-01",
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
    try:
        from modules.module_10_group_scan.models import add_session_log
        add_session_log(job_id, tone, text)
    except Exception:
        pass


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


def _latest_job_for_uid(uid: str) -> Optional[dict[str, Any]]:
    with _jobs_lock:
        matches = [job for job in _jobs.values() if str(job.get("uid")) == uid]
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


def set_job_control(job_id: str, action: str) -> dict[str, Any]:
    """
    pause  = tạm dừng sau khi xong từ khóa hiện tại
    resume = tiếp tục (nếu đang paused — chưa support resume mid-job; chỉ clear flag)
    abort  = dừng khẩn cấp ngay
    """
    action = str(action or "").strip().lower()
    if action not in {"pause", "resume", "abort"}:
        raise ValueError("action phải là pause | resume | abort")
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            raise ValueError("Không tìm thấy job")
        if action == "pause":
            job["control"] = "pause_after"
            msg = "Sẽ tạm dừng sau khi xong từ khóa hiện tại."
        elif action == "abort":
            job["control"] = "abort"
            msg = "Đang dừng khẩn cấp…"
        else:
            job["control"] = "run"
            msg = "Đã bỏ tạm dừng."
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
    job = _latest_job_for_uid(uid)
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
) -> dict:
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

    public_only = bool(public_only)
    private_only = bool(private_only)
    # Cả hai True = nhận Public + Private (tắt lọc loại)
    if public_only and private_only:
        public_only = False
        private_only = False
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
            finished = old_status in {"done", "error"}
            if force or stale or finished or old_status is None:
                _pending.pop(key, None)
                if old_job_id and not finished:
                    with _jobs_lock:
                        old = _jobs.get(old_job_id)
                        if old and old.get("status") == "running":
                            old["status"] = "error"
                            old["error"] = "Job bị thay bằng lần Kiểm tra mới (browser cũ có thể đã tắt)"
                    _append_log(
                        old_job_id,
                        "⏹️ Job cũ bị thay — browser đã tắt / mất kết nối / bấm Kiểm tra lại.",
                        "warn",
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
            "control": "run",
            "started_at": time.time(),
        }

    try:
        from modules.module_10_group_scan.models import create_scan_session
        import json
        words_str = ", ".join(item["keyword"] for item in items)
        cfg_str = json.dumps({
            "delay": f"{dmin:.0f} - {dmax:.0f}s",
            "privacy": "Công khai" if public_only else "Riêng tư" if private_only else "Tất cả",
            "minMembers": f"{min_members:,} TV" if min_members else "—",
            "maxKeywords": len(items),
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
        args=(owner, uid, items, dmin, dmax, public_only, private_only, min_members, key, job_id),
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
) -> None:
    from modules.module_02_account_manager.context import owner_scope

    try:
        with owner_scope(owner):
            _check_keywords_on_account(
                uid, items, delay_min, delay_max, job_id,
                public_only=public_only,
                private_only=private_only,
                min_members=min_members,
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
            # Không ghi đè paused / aborted / error đã set trong vòng lặp
            if job and job.get("status") == "running":
                job["status"] = "done"
        try:
            from modules.module_10_group_scan.models import update_scan_session
            st = "SUCCESS" if (job and job.get("status") in {"done", "running"}) else "FAILED"
            update_scan_session(job_id, status=st, finished=True)
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
    """'463K' / '26K members' / '1.2M' / '1.234 thành viên' → int."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return int(raw)
    text = str(raw).strip()
    if not text or text == "—":
        return None
    m = re.search(
        r"([\d.,]+)\s*([KkMmBb])?\s*(?:members?|thành viên|thanh vien)?",
        text,
        re.I,
    )
    if not m:
        digits = re.sub(r"[^\d]", "", text)
        return int(digits) if digits else None
    num_s = m.group(1).replace(",", "").replace(" ", "")
    # EU style 1.234.567 or 1,2
    if num_s.count(".") > 1:
        num_s = num_s.replace(".", "")
    elif num_s.count(",") > 1:
        num_s = num_s.replace(",", "")
    elif "," in num_s and "." not in num_s:
        # 1,2 → 1.2 (thập phân) hoặc 1,234 → bỏ phẩy nghìn
        parts = num_s.split(",")
        num_s = parts[0] + "." + parts[1] if len(parts) == 2 and len(parts[1]) <= 2 else num_s.replace(",", "")
    try:
        value = float(num_s)
    except ValueError:
        return None
    suffix = (m.group(2) or "").upper()
    mult = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}.get(suffix, 1)
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
        r"([\d.,]+\s*[KkMmBb]?)\s*(?:members?|thành viên|thanh vien)",
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
            return False, "bỏ (không đọc được số thành viên)"
        if count < min_members:
            return False, f"bỏ ({count} < {min_members} thành viên)"
    return True, ""


def _clean_group_name(raw: str, url: str = "") -> str:
    name = re.sub(r"\s+", " ", str(raw or "").strip())
    name = name.split("\n")[0].strip()
    name = re.sub(
        r"^(Profile photo of|Ảnh đại diện của|Anh dai dien cua)\s*",
        "",
        name,
        flags=re.I,
    ).strip()
    if not name or re.match(r"^(join|tham gia|joined)$", name, re.I):
        slug = ""
        if "/groups/" in (url or ""):
            slug = url.split("/groups/")[-1].split("/")[0].strip()
        name = slug or "—"
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
) -> list[dict[str, Any]]:
    from selenium.webdriver.common.by import By

    from modules.module_10_group_scan.models import (
        normalize_group_id,
        upsert_scanned_group,
    )

    found: list[dict[str, Any]] = []
    seen: set[str] = {str(g.get("href") or g.get("id") or "") for g in (already or [])}
    known = set(known_group_ids or set())
    limit = _clamp_limit(max_groups)
    # Có lọc / bỏ trùng DB → cuộn nhiều hơn
    max_rounds = 16 if (public_only or private_only or (min_members and min_members > 0) or known) else 8
    skipped = 0
    skipped_dup = 0

    def _aborted() -> bool:
        return _get_control(job_id) == "abort"

    # Đọc meta: "Public · 463K members · 90+ posts a day" — gom theo URL, bỏ "Profile photo of"
    js = """
    const root =
      document.querySelector('[aria-label="Search results"][role="main"]') ||
      document.querySelector('[aria-label="Search results"]') ||
      document.querySelector('[role="main"]');
    if (!root) return [];
    const byHref = new Map();
    const metaRe = /(Public|Private|Công khai|Cong khai|Riêng tư|Rieng tu|Bí mật)\\s*[·•|]\\s*[\\d.,]+\\s*[KkMmBb]?\\s*(members?|thành viên|thanh vien)/i;
    const softMetaRe = /[\\d.,]+\\s*[KkMmBb]?\\s*(members?|thành viên|thanh vien)/i;

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
      // Ưu tiên tên thật (không rỗng), meta có members
      if (name && (!prev.name || prev.name.length < name.length)) prev.name = name;
      if (meta && (!prev.meta || meta.length > prev.meta.length)) prev.meta = meta;
      byHref.set(href, prev);
    }
    return Array.from(byHref.values());
    """

    for round_idx in range(max_rounds):
        if _aborted():
            _append_log(job_id, f"🛑 Dừng khẩn cấp giữa lúc quét «{keyword}».", "warn")
            break
        if len(found) >= limit:
            break
        try:
            rows = driver.execute_script(js) or []
        except Exception as exc:
            _append_log(job_id, f"⚠️ Lỗi đọc DOM kết quả: {exc}", "warn")
            rows = []

        for row in rows:
            if _aborted():
                break
            url = _normalize_group_url(row.get("href") or "")
            if not _is_group_profile_url(url) or url in seen:
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
            # Private chưa join → ghi chú; Public không cần ghi chú đặc biệt
            note = "not_joined" if privacy == "private" else "—"
            item = {
                "id": url,
                "keyword": keyword,
                "name": name,
                "url": url.replace("https://www.", "").replace("https://", ""),
                "href": url,
                "type": privacy,
                "members": members_label,
                "members_count": meta_info.get("members_count"),
                "note": note,
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
                f"➕ [{len(found)}/{limit}] «{keyword}» {name} · {meta_info.get('type')} · {mem} — {url}",
                "success",
            )
            with _jobs_lock:
                job = _jobs.get(job_id)
                if job is not None:
                    job["groups"] = list(already or []) + list(found)
            try:
                from modules.module_10_group_scan.models import update_scan_session
                update_scan_session(job_id, total_found=len(already or []) + len(found))
            except Exception:
                pass
            _update_keyword_stat(job_id, keyword, count=len(found), status="running")
            if len(found) >= limit:
                break

        if len(found) >= limit:
            break

        try:
            roots = []
            for xpath in RESULTS_ROOT_LOCATORS:
                roots.extend(driver.find_elements(By.XPATH, xpath))
            root = next((el for el in roots if el.is_displayed()), None)
            if root is not None:
                driver.execute_script(
                    "arguments[0].scrollTop = arguments[0].scrollHeight; window.scrollBy(0, 900);",
                    root,
                )
            else:
                driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        except Exception:
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        human_sleep(1.2, 2.0)
        _append_log(
            job_id,
            f"… «{keyword}» cuộn thêm (lần {round_idx + 1}), giữ {len(found)}/{limit}"
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


def _check_keywords_on_account(
    uid: str,
    items: list[dict[str, Any]],
    delay_min: float,
    delay_max: float,
    job_id: str,
    *,
    public_only: bool = False,
    private_only: bool = False,
    min_members: Optional[int] = None,
) -> None:
    from modules.module_02_account_manager.automation import (
        create_driver,
        ensure_logged_in,
        get_profile_lock,
        human_sleep,
        human_type,
        wait_and_find,
    )
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_02_account_manager.database.repository import AccountRepository as Repo
    from modules.module_02_account_manager.security.encryption import decrypt_data

    profile_lock = get_profile_lock(uid)
    if not profile_lock.acquire(timeout=8):
        _append_log(job_id, f"⚠️ [{uid}] Profile đang bận — không mở được Chrome.", "warn")
        _set_job(job_id, status="error", error="Profile đang bận")
        return

    all_groups: list[dict[str, Any]] = []
    try:
        db = SessionLocal()
        try:
            account = Repo.get_by_uid(db, uid)
            if not account:
                _append_log(job_id, f"❌ [{uid}] Không tìm thấy tài khoản Module 2.", "error")
                _set_job(job_id, status="error", error="Không tìm thấy tài khoản")
                return
            cookie = account.cookie or ""
            proxy = account.proxy
            password = decrypt_data(account.password or "")
            two_fa = decrypt_data(account.two_fa or "")
        finally:
            db.close()

        _append_log(job_id, f"🌐 [{uid}] Đang mở Chrome (session Module 2)…", "info")
        driver = create_driver(
            uid,
            headless=False,
            detach=True,
            proxy=proxy,
            scope="group-scan",
            verify_egress=False,
        )

        login = ensure_logged_in(
            driver,
            uid=uid,
            password=password,
            two_fa=two_fa,
            cookie=cookie,
        )
        if not login.get("success"):
            msg = login.get("error") or "Không đăng nhập được Facebook"
            _append_log(job_id, f"❌ [{uid}] {msg}", "error")
            _set_job(job_id, status="error", error=msg)
            return

        from modules.module_10_group_scan.models import list_known_group_ids

        owner = None
        with _jobs_lock:
            owner = (_jobs.get(job_id) or {}).get("owner")
        known_ids = list_known_group_ids(owner)
        _append_log(
            job_id,
            f"🗄️ DB: đã có {len(known_ids)} nhóm của owner — sẽ bỏ trùng khi quét.",
            "info",
        )

        filter_bits = []
        if public_only:
            filter_bits.append("chỉ Public")
        if private_only:
            filter_bits.append("chỉ Private")
        if min_members:
            filter_bits.append(f">={min_members} thành viên")
        filter_txt = f", lọc: {', '.join(filter_bits)}" if filter_bits else " (không lọc Public/Private/members)"
        plan = ", ".join(f"«{it['keyword']}»×{it['limit']}" for it in items)
        _append_log(
            job_id,
            f"✅ [{uid}] Session OK [scan-v2]. {len(items)} từ khóa: {plan} "
            f"(delay {delay_min:.0f}–{delay_max:.0f}s){filter_txt}.",
            "success",
        )

        try:
            current = (driver.current_url or "").lower()
        except Exception:
            current = ""
        if "facebook.com" not in current:
            driver.get("https://www.facebook.com/")
            human_sleep(2.0, 3.0)

        for idx, item in enumerate(items):
            if _get_control(job_id) == "abort":
                _append_log(job_id, "🛑 Dừng khẩn cấp — không chạy từ khóa còn lại.", "warn")
                _set_job(job_id, groups=list(all_groups), status="aborted", error="Dừng khẩn cấp")
                return

            keyword = item["keyword"]
            limit = _clamp_limit(item.get("limit"))
            _update_keyword_stat(job_id, keyword, status="running", count=0, limit=limit)
            _append_log(
                job_id,
                f"▶️ [{idx + 1}/{len(items)}] Quét «{keyword}» — DỪNG KHI ĐỦ {limit} nhóm MỚI (bỏ trùng DB).",
                "info",
            )

            try:
                # Từ khóa 2+ → về home rồi vào lại ô Search (không kẹt trang kết quả cũ)
                _search_and_open_groups(
                    driver,
                    keyword,
                    job_id,
                    wait_and_find,
                    human_sleep,
                    human_type,
                    reset_home=(idx > 0),
                )
                if _get_control(job_id) == "abort":
                    _append_log(job_id, "🛑 Dừng khẩn cấp trước khi scrape.", "warn")
                    _set_job(job_id, groups=list(all_groups), status="aborted", error="Dừng khẩn cấp")
                    return
                groups = _scrape_groups_from_results(
                    driver,
                    keyword,
                    job_id,
                    human_sleep,
                    max_groups=limit,
                    already=all_groups,
                    public_only=public_only,
                    private_only=private_only,
                    min_members=min_members,
                    owner=owner,
                    source_uid=uid,
                    known_group_ids=known_ids,
                )
                from modules.module_10_group_scan.models import normalize_group_id as _ngid

                for g in groups:
                    gid = _ngid(g.get("href") or "")
                    if gid:
                        known_ids.add(gid)
                # Siết cứng hạn mức (phòng DOM trả thừa)
                groups = groups[:limit]
                all_groups.extend(groups)
                _set_job(job_id, groups=list(all_groups))
                if _get_control(job_id) == "abort":
                    _update_keyword_stat(job_id, keyword, count=len(groups), status="done", limit=limit)
                    _append_log(job_id, f"🛑 Dừng khẩn cấp sau «{keyword}» ({len(groups)} nhóm).", "warn")
                    _set_job(job_id, groups=list(all_groups), status="aborted", error="Dừng khẩn cấp")
                    return
                _update_keyword_stat(job_id, keyword, count=len(groups), status="done", limit=limit)
                _append_log(
                    job_id,
                    f"🏁 Xong «{keyword}»: {len(groups)}/{limit} nhóm.",
                    "success",
                )
            except Exception as exc:
                logger.exception("[%s] keyword «%s» failed", uid, keyword)
                _update_keyword_stat(job_id, keyword, status="error")
                _append_log(job_id, f"❌ «{keyword}» lỗi: {exc}", "error")
                if _get_control(job_id) == "abort":
                    _set_job(job_id, groups=list(all_groups), status="aborted", error="Dừng khẩn cấp")
                    return
                if idx >= len(items) - 1:
                    raise

            # Tạm dừng: xong từ khóa hiện tại → dừng, không chạy từ khóa tiếp
            if _get_control(job_id) == "pause_after":
                _append_log(
                    job_id,
                    f"⏸️ Tạm dừng sau «{keyword}». Các từ khóa còn lại chờ Bắt đầu lại.",
                    "warn",
                )
                _set_job(job_id, groups=list(all_groups), status="paused", control="pause_after")
                return

            if idx < len(items) - 1:
                next_kw = items[idx + 1]["keyword"]
                wait_sec = random.uniform(delay_min, delay_max) if delay_max > 0 else 0.0
                end_at = time.time() + wait_sec
                _append_log(
                    job_id,
                    f"➡️ Tiếp theo «{next_kw}» (hạn {items[idx + 1]['limit']})"
                    + (f" — nghỉ {wait_sec:.1f}s…" if wait_sec > 0 else " — chuyển ngay…"),
                    "info",
                )
                while time.time() < end_at:
                    if _get_control(job_id) == "abort":
                        _append_log(job_id, "🛑 Dừng khẩn cấp trong lúc nghỉ giữa từ khóa.", "warn")
                        _set_job(job_id, groups=list(all_groups), status="aborted", error="Dừng khẩn cấp")
                        return
                    if _get_control(job_id) == "pause_after":
                        _append_log(job_id, "⏸️ Tạm dừng (không chạy từ khóa tiếp).", "warn")
                        _set_job(job_id, groups=list(all_groups), status="paused")
                        return
                    time.sleep(min(0.5, max(0.0, end_at - time.time())))

        _set_job(job_id, groups=list(all_groups), status="done")
        _append_log(
            job_id,
            f"🏁 Hoàn tất {len(items)} từ khóa — tổng {len(all_groups)} nhóm.",
            "success",
        )
    except Exception as exc:
        logger.exception("[%s] keyword check failed", uid)
        _append_log(job_id, f"❌ Kiểm tra từ khóa lỗi: {exc}", "error")
        _set_job(job_id, status="error", error=str(exc), groups=list(all_groups))
    finally:
        try:
            profile_lock.release()
        except Exception:
            pass
