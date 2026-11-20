"""
Kiểm tra sức chứa từ khóa (nút "Kiểm tra" ở trang Quét thông tin nhóm):
mở Chrome bằng 1 nick đã chọn, tìm nhóm theo từng từ khóa, cuộn tới khi Facebook
không trả thêm kết quả, rồi đếm xem từ khóa đó quét được TỐI ĐA bao nhiêu nhóm.

Chỉ đếm — không lưu nhóm vào DB, không tham gia nhóm.
Mỗi từ khóa báo 3 con số:
  total    — tổng nhóm Facebook trả về cho từ khóa
  count    — số nhóm qua bộ lọc hiện tại (chỉ công khai, ≥ N thành viên) = số quét được tối đa
  fresh    — trong `count`, số nhóm chưa có trong Danh sách nhóm quét (Bắt đầu thực thi bỏ qua nhóm đã có)
"""
from __future__ import annotations

import logging
import random
import threading
import time
import uuid
from typing import Any, Optional
from urllib.parse import quote

from modules.module_10_group_scan.scan_common import (
    TERMINAL_STATUSES,
    close_account_session,
    interruptible_sleep,
    is_browser_dead_error,
    open_account_session,
    prune_jobs,
)

logger = logging.getLogger(__name__)

MAX_KEYWORDS = 20
NO_GROWTH_ROUNDS = 8        # 8 lượt liên tiếp (~30s) không ra nhóm mới và không còn đang tải → hết kết quả
MAX_LOADING_WAITS = 6       # Facebook đang tải (spinner) thì chờ thêm, không tính là "không có gì mới"
MAX_ROUNDS = 400            # chặn an toàn cho 1 từ khóa
LOG_LIMIT = 400

# Trạng thái trang kết quả. Chỉ xét phần CUỐI khung kết quả (không đọc mô tả nhóm ở giữa trang),
# và chỉ coi là bị chặn khi URL / hộp thoại chặn của Facebook xuất hiện — không khớp chữ trong tên nhóm.
_END_OF_RESULTS_JS = r"""
const root = document.querySelector('[role="main"]') || document.body;
const tail = (root ? root.innerText : '').slice(-600).toLowerCase();
const end = /(end of results|no more results|đã hết kết quả|không còn kết quả nào|kết quả cuối cùng)/.test(tail);
const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'))
  .map((d) => (d.innerText || '').toLowerCase()).join(' ');
const blocked = /\/checkpoint\b/.test(location.pathname)
  || /(you.re temporarily blocked|temporarily restricted|bạn tạm thời bị chặn|tạm thời bị hạn chế)/.test(dialogs);
const loading = !!(root && root.querySelector('[role="progressbar"], [aria-busy="true"]'));
return { end, blocked, loading };
"""

# Đánh thức lazy-load: đưa nhóm cuối vào giữa màn hình, nhích lên rồi kéo xuống đáy.
_NUDGE_JS = r"""
const links = document.querySelectorAll('[role="main"] a[href*="/groups/"]');
const last = links.length ? links[links.length - 1] : null;
if (last) last.scrollIntoView({ block: 'center' });
window.scrollBy(0, -400);
window.scrollTo(0, document.body.scrollHeight);
return links.length;
"""

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _now() -> str:
    return time.strftime("%H:%M:%S")


def _log(job_id: str, text: str, tone: str = "info") -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        logs = job.setdefault("logs", [])
        logs.append({"time": _now(), "thread": "Kiểm tra", "text": text, "tone": tone})
        if len(logs) > LOG_LIMIT:
            del logs[: len(logs) - LOG_LIMIT]


def _set(job_id: str, **fields: Any) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.update(fields)


def _set_stat(job_id: str, keyword: str, **fields: Any) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            job["keyword_stats"].setdefault(keyword, {}).update(fields)


def _control(job_id: str) -> str:
    with _jobs_lock:
        return (_jobs.get(job_id) or {}).get("control") or "run"


def get_active_capacity_job(owner: Optional[str]) -> Optional[str]:
    with _jobs_lock:
        active = [
            (job.get("started_at") or 0, jid)
            for jid, job in _jobs.items()
            if job.get("owner") == owner and job.get("status") not in TERMINAL_STATUSES
        ]
    return max(active)[1] if active else None


def start_capacity_check(
    owner: str,
    uids: list[str],
    keywords: list[str],
    *,
    public_only: bool = True,
    min_members: Optional[int] = None,
    force: bool = False,
) -> dict[str, Any]:
    """Từ khóa đã Kiểm tra trước đó → trả kết quả đã lưu ngay (`cached`), không mở Chrome.
    Chỉ từ khóa chưa có (hoặc `force=True` = Kiểm tra lại) mới chạy job cuộn Facebook."""
    from modules.module_10_group_scan.models import normalize_keyword

    words: list[str] = []
    for raw in keywords or []:
        word = normalize_keyword(raw)
        if word and word not in words:
            words.append(word)
    if not words:
        raise ValueError("Nhập ít nhất 1 từ khóa để kiểm tra.")
    if len(words) > MAX_KEYWORDS:
        raise ValueError(f"Mỗi lần kiểm tra tối đa {MAX_KEYWORDS} từ khóa.")
    min_members = int(min_members) if min_members else None

    cached = {} if force else cached_capacity_stats(owner, words, public_only=public_only, min_members=min_members)
    remaining = [w for w in words if w not in cached]
    if not remaining:
        return {"job_id": None, "keywords": [], "cached": cached}

    pool = list(dict.fromkeys(str(u).strip() for u in (uids or []) if str(u).strip()))
    if not pool:
        raise ValueError("Chọn ít nhất 1 tài khoản đã đăng nhập để kiểm tra từ khóa.")
    if get_active_capacity_job(owner):
        raise RuntimeError("Đang kiểm tra từ khóa — chờ xong hoặc bấm Dừng kiểm tra.")

    prune_jobs(_jobs, _jobs_lock)
    job_id = f"KWC-{uuid.uuid4().hex[:10]}"
    with _jobs_lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "owner": owner,
            "uids": pool,
            "keywords": remaining,
            "public_only": bool(public_only),
            "min_members": min_members,
            "status": "running",
            "control": "run",
            "error": "",
            "uid": "",
            "logs": [],
            "keyword_stats": {w: {"count": None, "total": None, "fresh": None, "status": "idle"} for w in remaining},
            "started_at": time.time(),
            "finished_at": None,
        }
    threading.Thread(target=_run, args=(job_id,), daemon=True, name=f"kw-capacity-{job_id}").start()
    return {"job_id": job_id, "keywords": remaining, "cached": cached}


def get_capacity_status(job_id: str, owner: Optional[str]) -> Optional[dict[str, Any]]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job.get("owner") != owner:
            return None
        return {
            "job_id": job_id,
            "status": job["status"],
            "error": job.get("error") or "",
            "uid": job.get("uid") or "",
            "keywords": list(job["keywords"]),
            "keyword_stats": {k: dict(v) for k, v in job["keyword_stats"].items()},
            "logs": list(job["logs"]),
            "started_at": job.get("started_at"),
            "finished_at": job.get("finished_at"),
        }


def stop_capacity_check(job_id: str, owner: Optional[str]) -> bool:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job.get("owner") != owner or job.get("status") in TERMINAL_STATUSES:
            return False
        job["control"] = "abort"
        job["status"] = "stopping"
    _log(job_id, "🛑 Nhận lệnh dừng kiểm tra — đóng trình duyệt…", "warn")
    return True


def _run(job_id: str) -> None:
    from modules.module_02_account_manager.context import owner_scope

    with _jobs_lock:
        owner = (_jobs.get(job_id) or {}).get("owner")
    with owner_scope(owner):
        _body(job_id)


def _scroll_results(driver) -> None:
    from selenium.webdriver.common.by import By

    from modules.module_10_group_scan.keyword_check import RESULTS_ROOT_LOCATORS

    try:
        root = None
        for xpath in RESULTS_ROOT_LOCATORS:
            root = next((el for el in driver.find_elements(By.XPATH, xpath) if el.is_displayed()), None)
            if root is not None:
                break
        if root is not None:
            driver.execute_script("arguments[0].scrollTop = arguments[0].scrollHeight; window.scrollBy(0, 1200);", root)
        else:
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
    except Exception:
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")


def count_keyword_groups(
    driver,
    keyword: str,
    *,
    public_only: bool,
    min_members: Optional[int],
    known_ids: set[str],
    should_stop,
    on_progress=None,
    log=None,
    sleep=None,
) -> dict[str, Any]:
    """Cuộn hết kết quả tìm nhóm của 1 từ khóa và đếm. Trả {total, count, fresh, reason}."""
    from modules.module_10_group_scan.keyword_check import (
        GROUP_RESULTS_JS,
        RESULTS_ROOT_LOCATORS,
        _is_group_profile_url,
        _normalize_group_url,
        _parse_group_meta,
        _passes_filters,
    )
    from modules.module_10_group_scan.models import normalize_group_id

    log = log or (lambda *_a, **_k: None)
    sleep = sleep or (lambda a, b: time.sleep(random.uniform(a, b)))

    driver.get(f"https://www.facebook.com/search/groups/?q={quote(keyword)}")
    sleep(3.0, 4.5)
    try:
        from modules.module_02_account_manager.automation import wait_and_find

        wait_and_find(driver, RESULTS_ROOT_LOCATORS, timeout=15)
    except Exception:
        log(f"⚠️ «{keyword}» chưa thấy khung kết quả — vẫn thử đếm…", "warn")

    seen: set[str] = set()
    groups: list[dict[str, Any]] = []  # lưu DB để lần sau điền ngay, tính lại theo bộ lọc
    total = count = fresh = 0
    idle = 0
    loading_waits = 0
    reason = "đã xem hết — Facebook không hiện thêm nhóm nào nữa"
    complete = True
    for round_idx in range(1, MAX_ROUNDS + 1):
        if should_stop():
            reason = "dừng giữa chừng theo yêu cầu (chưa xem hết)"
            complete = False
            break
        try:
            rows = driver.execute_script(GROUP_RESULTS_JS) or []
        except Exception as exc:
            if is_browser_dead_error(exc):
                raise
            log(f"⚠️ Lỗi đọc kết quả: {exc}", "warn")
            rows = []
        added = 0
        for row in rows:
            url = _normalize_group_url(row.get("href") or "")
            if not _is_group_profile_url(url) or url in seen:
                continue
            seen.add(url)
            added += 1
            total += 1
            meta = _parse_group_meta(row.get("meta") or "")
            gid = normalize_group_id(url)
            groups.append({"id": gid or url, "type": meta.get("type") or "unknown", "members": meta.get("members_count")})
            ok, _why = _passes_filters(meta, public_only=public_only, min_members=min_members)
            if ok:
                count += 1
                if not gid or gid not in known_ids:
                    fresh += 1
        if on_progress:
            on_progress(total=total, count=count, fresh=fresh)
        try:
            flags = driver.execute_script(_END_OF_RESULTS_JS) or {}
        except Exception as exc:
            if is_browser_dead_error(exc):
                raise
            flags = {}
        if flags.get("blocked"):
            reason = "dừng sớm — Facebook tạm chặn hoặc yêu cầu xác minh tài khoản (chưa xem hết)"
            complete = False
            log(f"⚠️ «{keyword}»: {reason} — dừng đếm từ khóa này.", "warn")
            break
        if added:
            idle = 0
            loading_waits = 0
            if round_idx == 1 or round_idx % 5 == 0:
                log(f"… «{keyword}» lượt cuộn {round_idx}: {total} nhóm, {count} quét được.", "info")
        elif flags.get("loading") and loading_waits < MAX_LOADING_WAITS:
            loading_waits += 1  # Facebook đang tải lô tiếp theo → chờ, chưa tính là hết
        else:
            idle += 1
            if idle in (3, 6):
                log(f"… «{keyword}» {idle} lượt chưa ra nhóm mới — cuộn lại để Facebook tải tiếp…", "info")
        # "Hết kết quả" chỉ tin khi đã có ít nhất 2 lượt liên tiếp không ra nhóm mới.
        if flags.get("end") and idle >= 2:
            reason = "đã xem hết — Facebook báo hết kết quả"
            break
        if idle >= NO_GROWTH_ROUNDS:
            break
        _scroll_results(driver)
        if idle:
            # Chưa ra nhóm mới: lắc cuộn để kích lazy-load và chờ lâu hơn.
            try:
                driver.execute_script(_NUDGE_JS)
            except Exception:
                pass
            sleep(2.5, 4.0)
        else:
            sleep(1.6, 2.6)
    else:
        reason = "dừng để an toàn — kết quả quá dài (có thể còn nhóm chưa xem)"
        complete = False
    return {"total": total, "count": count, "fresh": fresh, "reason": reason, "groups": groups, "complete": complete}


def summarize_groups(
    groups: list[dict[str, Any]], *, public_only: bool, min_members: Optional[int], known_ids: set[str],
) -> dict[str, int]:
    """Tính lại total / count / fresh từ danh sách nhóm đã lưu theo bộ lọc & DB HIỆN TẠI."""
    from modules.module_10_group_scan.keyword_check import _passes_filters

    total = count = fresh = 0
    for g in groups or []:
        total += 1
        ok, _ = _passes_filters(
            {"type": g.get("type") or "unknown", "members_count": g.get("members")},
            public_only=public_only, min_members=min_members,
        )
        if ok:
            count += 1
            if str(g.get("id") or "") not in known_ids:
                fresh += 1
    return {"total": total, "count": count, "fresh": fresh}


def cached_capacity_stats(
    owner: str, keywords: list[str], *, public_only: bool, min_members: Optional[int],
) -> dict[str, dict[str, Any]]:
    """Kết quả Kiểm tra đã lưu DB cho các từ khóa (đã tính lại theo bộ lọc / DB hiện tại)."""
    from modules.module_10_group_scan.models import get_keyword_capacity, list_known_group_ids

    saved = get_keyword_capacity(owner, keywords)
    if not saved:
        return {}
    known = list_known_group_ids(owner)
    out: dict[str, dict[str, Any]] = {}
    for word, row in saved.items():
        stats = summarize_groups(row["groups"], public_only=public_only, min_members=min_members, known_ids=known)
        out[word] = {**stats, "status": "done", "cached": True,
                     "reason": row.get("reason") or "", "checked_at": row.get("checked_at") or ""}
    return out


def _body(job_id: str) -> None:
    from modules.module_10_group_scan.models import list_known_group_ids, save_keyword_capacity

    with _jobs_lock:
        job = _jobs[job_id]
        owner = job["owner"]
        pool = list(job["uids"])
        words = list(job["keywords"])
        public_only = job["public_only"]
        min_members = job["min_members"]

    def log(text: str, tone: str = "info") -> None:
        _log(job_id, text, "warn" if tone == "warning" else tone)

    def stop() -> bool:
        return _control(job_id) == "abort"

    session = None
    final, error = "done", ""
    try:
        filt = "chỉ nhóm công khai" if public_only else "mọi loại nhóm"
        if min_members:
            filt += f", ≥ {min_members:,} thành viên".replace(",", ".")
        log(f"🔎 Kiểm tra {len(words)} từ khóa ({filt}) — cuộn tới khi Facebook hết kết quả.", "info")
        session = open_account_session(pool, 0, owner=owner, scope="group-scan", log=log,
                                       lock_timeout=8, should_stop=stop)
        if not session:
            final = "aborted" if stop() else "error"
            error = "" if stop() else "Không tài khoản nào mở được Chrome và đăng nhập Facebook."
            if error:
                log(f"❌ {error}", "error")
            return
        _set(job_id, uid=session["uid"])
        driver = session["driver"]
        known = list_known_group_ids(owner)

        for idx, word in enumerate(words, 1):
            if stop():
                final = "aborted"
                break
            _set_stat(job_id, word, status="running", count=0, total=0, fresh=0)
            log(f"▶️ [{idx}/{len(words)}] «{word}» — đang cuộn kết quả tìm nhóm…", "info")
            try:
                res = count_keyword_groups(
                    driver, word, public_only=public_only, min_members=min_members, known_ids=known,
                    should_stop=stop,
                    on_progress=lambda **kw: _set_stat(job_id, word, **kw),
                    log=log,
                    sleep=lambda a, b: interruptible_sleep(random.uniform(a, b), lambda: _control(job_id)),
                )
            except Exception as exc:
                if is_browser_dead_error(exc):
                    log("Chrome đã bị đóng — dừng kiểm tra.", "warn")
                    final = "aborted"
                    break
                logger.exception("capacity check «%s» failed", word)
                _set_stat(job_id, word, status="error")
                log(f"❌ «{word}» lỗi: {exc}", "error")
                continue
            _set_stat(job_id, word, status="done", reason=res["reason"],
                      **{k: res[k] for k in ("total", "count", "fresh")})
            # Chỉ lưu khi đã cuộn trọn vẹn (không lưu kết quả dở dang do dừng tay / Facebook chặn).
            if res.get("complete") and not stop():
                if save_keyword_capacity(owner, word, res["groups"], reason=res["reason"], source_uid=session["uid"]):
                    _set_stat(job_id, word, checked_at=time.strftime("%H:%M %d/%m/%Y"))
            log(
                f"🏁 «{word}»: quét được tối đa {res['count']} nhóm "
                f"({res['fresh']} nhóm chưa quét) trong {res['total']} nhóm Facebook tìm thấy — {res['reason']}.",
                "success",
            )
            if stop():
                final = "aborted"
                break
            if idx < len(words) and interruptible_sleep(random.uniform(2.0, 4.0), lambda: _control(job_id)):
                final = "aborted"
                break
    except Exception as exc:
        logger.exception("capacity job %s crashed", job_id)
        final, error = "error", str(exc)
        log(f"❌ Lỗi kiểm tra từ khóa: {exc}", "error")
    finally:
        try:
            close_account_session(session, quit_browser=True)
        except Exception as exc:
            logger.warning("close capacity browser failed: %s", exc)
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is not None:
                for stat in job["keyword_stats"].values():
                    if stat.get("status") in ("running", "idle"):
                        stat["status"] = "stopped" if final != "done" else stat["status"]
        _set(job_id, status=final, error=error, finished_at=time.time())
        log(
            "✅ Kiểm tra xong." if final == "done" else ("🛑 Đã dừng kiểm tra." if final == "aborted" else "❌ Kiểm tra lỗi."),
            "success" if final == "done" else "warn",
        )
