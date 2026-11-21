"""
post_fetcher.py
Module 8 — "Lấy bài viết từ page / trang cá nhân": job chạy nền cuộn feed của 1 page / trang cá nhân và lấy
TOÀN BỘ bài viết (không giới hạn số bài) cho tới khi hết bài hoặc người dùng bấm Dừng.

- Đọc bài bằng hàm của Module 11 (extract_posts_batch) nhưng chỉ đọc nhóm bài MỚI mỗi vòng
  (đánh dấu data-m8-batch / data-m8-done) → không kẹt ở 40 bài đầu và không chậm dần khi trang dài.
- Lưu vào bảng riêng của Module 8 (seeding_fetched_posts), không đụng bảng của Module 11.
- Mở Chrome + đăng nhập giống hệt lúc chạy seeding (cùng Chrome profile của nick).

Các import nặng (Module 11, Selenium, seeding_routes) để trong hàm: file này được seeding_routes import lúc khởi động.
"""
from __future__ import annotations

import logging
import random
import re
import threading
import time
from contextlib import contextmanager
from datetime import timedelta
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import parse_qsl, unquote, urlencode, urlparse, urlunparse

from sqlalchemy import text

from modules.module_08_interaction_seeding.models.seeding_models import (
    SeedingFetchedPost,
    SeedingPostFetchJob,
    SeedingTemplate,
    vn_now,
)

logger = logging.getLogger(__name__)

# ── Tham số vòng cuộn ──
BATCH_SIZE = 12                 # số bài đọc mỗi vòng
SCROLL_PAUSE_S = (1.2, 2.5)     # nghỉ sau mỗi lần cuộn
LONG_REST_EVERY = 200           # cứ N bài mới thì nghỉ dài
LONG_REST_S = (5.0, 10.0)
IDLE_ROUNDS = 6                 # số vòng liền không có gì mới trước khi thử kéo hẳn xuống đáy
DEEP_CHECKS = 3                 # số lần kéo xuống đáy mà vẫn không có gì → hết bài
DEEP_WAIT_S = 4.0
NO_NEW_TIMEOUT_S = 180.0        # quá lâu không có bài mới → coi như hết bài
HEARTBEAT_EVERY_S = 15.0
MAX_ROUND_ERRORS = 5
TRIM_MEDIA = True               # giải phóng ảnh / video của bài đã đọc ở xa phía trên để Chrome không phình

# ── Job đang chạy trong engine này (mỗi user tối đa 1 job) ──
_jobs_lock = threading.Lock()
_running_jobs: Dict[int, Dict[str, Any]] = {}   # job_id -> {"stop": Event, "owner": int}


def running_job_id(user_id: Optional[int]) -> Optional[int]:
    """Job lấy bài đang chạy của user (None nếu không có)."""
    if user_id is None:
        return None
    with _jobs_lock:
        for job_id, info in _running_jobs.items():
            if info.get("owner") == user_id:
                return job_id
    return None


def is_job_running(job_id: int) -> bool:
    with _jobs_lock:
        return job_id in _running_jobs


def request_stop(job_id: int) -> bool:
    """Yêu cầu dừng job. False nếu job không chạy trong engine này."""
    with _jobs_lock:
        info = _running_jobs.get(job_id)
    if not info:
        return False
    info["stop"].set()
    return True


def try_register_job(job_id: int, owner_id: int) -> Optional[int]:
    """Đăng ký job đang chạy. Trả về id job khác của user nếu đã có (khi đó không đăng ký)."""
    with _jobs_lock:
        for other_id, info in _running_jobs.items():
            if info.get("owner") == owner_id:
                return other_id
        _running_jobs[job_id] = {"stop": threading.Event(), "owner": owner_id}
    return None


def _unregister_job(job_id: int) -> None:
    with _jobs_lock:
        _running_jobs.pop(job_id, None)


# ─────────────────────────────────────────────────────────────
# Khoá bài viết & link chuẩn hoá
# ─────────────────────────────────────────────────────────────
_PFBID_RE = re.compile(r"pfbid[0-9A-Za-z]+")
_KEEP_QUERY = {"story_fbid", "id", "fbid", "v", "multi_permalinks"}


def seeding_post_key(url: str) -> str:
    """Khoá duy nhất của 1 bài. Xử lý link pfbid (trang cá nhân hay dùng) mà normalize_post_key của Module 11 gộp chung."""
    raw = unquote((url or "").strip())
    if not raw:
        return ""
    parsed = urlparse(raw if "://" in raw else "https://" + raw)
    query = dict(parse_qsl(parsed.query))
    story = (query.get("story_fbid") or query.get("fbid") or "").strip()
    if _PFBID_RE.fullmatch(story):
        owner = (query.get("id") or "").strip()
        return f"post:{owner}_{story}" if owner.isdigit() else f"post:{story}"
    m = re.search(r"/(?:posts|permalink)/(pfbid[0-9A-Za-z]+)", parsed.path)
    if m:
        return f"post:{m.group(1)}"
    from modules.module_11_page_scanner.page_source import normalize_post_key

    return normalize_post_key(raw)


def canonical_post_url(url: str) -> str:
    """Bỏ tham số tracking của feed (__cft__[0], __tn__, …), chỉ giữ tham số dùng để nhận diện bài."""
    raw = (url or "").strip().split("#")[0]
    if not raw:
        return ""
    parsed = urlparse(raw)
    keep = [(k, v) for k, v in parse_qsl(parsed.query) if k in _KEEP_QUERY]
    path = parsed.path.rstrip("/") or parsed.path
    return urlunparse((parsed.scheme or "https", parsed.netloc or "www.facebook.com", path, "", urlencode(keep), ""))


def post_target_fields(post_url: str) -> tuple[str, str]:
    """(target_url, target_fb_id) giống hệt khi người dùng tự dán link bài vào danh sách seeding."""
    from modules.module_08_interaction_seeding.routes.seeding_routes import extract_fb_id, normalize_target_url

    target_url = normalize_target_url(canonical_post_url(post_url), "POST")
    return target_url, extract_fb_id(target_url, "POST")


# ─────────────────────────────────────────────────────────────
# JavaScript chạy trên trang Facebook
# ─────────────────────────────────────────────────────────────
# Đánh dấu tối đa N bài GỐC (không phải bình luận lồng trong bài), chưa đọc, đã có link bài.
_MARK_BATCH_JS = r"""
const token = arguments[0];
const maxN = arguments[1] || 12;
const SEL = '[role="article"], div[data-pagelet*="FeedUnit"]';
const LINK_RE = /\/(posts|permalink|videos?|reels?|watch)\b|story_fbid=|\/photo\/?\?/i;
let marked = 0;
for (const el of document.querySelectorAll(SEL)) {
  if (marked >= maxN) break;
  if (el.hasAttribute('data-m8-done') || el.hasAttribute('data-m8-batch')) continue;
  if (el.parentElement && el.parentElement.closest(SEL)) continue;
  const hasLink = Array.from(el.querySelectorAll('a[href]')).some((a) => LINK_RE.test(a.href || a.getAttribute('href') || ''));
  if (!hasLink) continue;
  el.setAttribute('data-m8-batch', token);
  marked++;
}
const doc = document.documentElement;
return { marked: marked, height: Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0) };
"""

# Chốt nhóm vừa đọc; bài đã đọc nằm xa phía trên → bỏ ảnh / video để Chrome nhẹ (giữ nguyên DOM cho React của Facebook).
_FINISH_BATCH_JS = r"""
const token = arguments[0];
const trim = !!arguments[1];
for (const el of document.querySelectorAll('[data-m8-batch="' + token + '"]')) {
  el.removeAttribute('data-m8-batch');
  el.setAttribute('data-m8-done', '1');
}
let trimmed = 0;
if (trim) {
  const limit = -3 * window.innerHeight;
  for (const el of document.querySelectorAll('[data-m8-done="1"]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > limit) continue;
    for (const img of el.querySelectorAll('img')) {
      img.removeAttribute('srcset');
      img.setAttribute('src', 'data:,');
    }
    for (const v of el.querySelectorAll('video')) {
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
    }
    el.style.contentVisibility = 'auto';
    el.setAttribute('data-m8-done', '2');
    trimmed++;
  }
}
return trimmed;
"""

_SCROLL_JS = "window.scrollBy(0, Math.round(window.innerHeight * 0.85));"
_SCROLL_BOTTOM_JS = "window.scrollTo(0, Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));"


# ─────────────────────────────────────────────────────────────
# Bảng & DB
# ─────────────────────────────────────────────────────────────
_schema_lock = threading.Lock()
_schema_ready = False


def init_post_fetch_schema() -> None:
    """Tạo các bảng mới của Seeding (lấy bài + mẫu cấu hình) nếu chưa có, và chốt các job lấy bài bị bỏ dở
    (engine tắt giữa chừng, không còn heartbeat)."""
    global _schema_ready
    with _schema_lock:
        if _schema_ready:
            return
        from modules.module_02_account_manager.database.connection import engine

        if engine is None:
            raise RuntimeError("Engine tài khoản chưa sẵn sàng")
        SeedingPostFetchJob.__table__.create(bind=engine, checkfirst=True)
        SeedingFetchedPost.__table__.create(bind=engine, checkfirst=True)
        SeedingTemplate.__table__.create(bind=engine, checkfirst=True)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE seeding_post_fetch_jobs SET status = 'STOPPED',"
                    " stop_reason = COALESCE(stop_reason, 'USER_STOPPED'), finished_at = COALESCE(finished_at, :now)"
                    " WHERE status IN ('RUNNING', 'STOPPING')"
                    " AND COALESCE(heartbeat_at, started_at) < :stale"
                ),
                {"now": vn_now(), "stale": vn_now() - timedelta(seconds=HEARTBEAT_EVERY_S * 8)},
            )
        _schema_ready = True


@contextmanager
def _session():
    from modules.module_02_account_manager.database.connection import SessionLocal

    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


_UPSERT_COLUMNS = (
    "created_by, source_key, post_key, post_url, target_url, target_fb_id, content, post_type, published_at,"
    " published_text, reaction_count, comment_count, share_count, is_pinned, first_job_id, last_job_id,"
    " created_at, updated_at"
)
_UPSERT_CONFLICT = """
ON CONFLICT (created_by, source_key, post_key) DO UPDATE SET
  post_url = EXCLUDED.post_url,
  content = CASE WHEN EXCLUDED.content IS NOT NULL
                  AND LENGTH(EXCLUDED.content) > LENGTH(COALESCE(seeding_fetched_posts.content, ''))
                 THEN EXCLUDED.content ELSE seeding_fetched_posts.content END,
  post_type = COALESCE(EXCLUDED.post_type, seeding_fetched_posts.post_type),
  published_at = COALESCE(EXCLUDED.published_at, seeding_fetched_posts.published_at),
  published_text = COALESCE(EXCLUDED.published_text, seeding_fetched_posts.published_text),
  reaction_count = GREATEST(EXCLUDED.reaction_count, seeding_fetched_posts.reaction_count),
  comment_count = GREATEST(EXCLUDED.comment_count, seeding_fetched_posts.comment_count),
  share_count = GREATEST(EXCLUDED.share_count, seeding_fetched_posts.share_count),
  is_pinned = EXCLUDED.is_pinned,
  last_job_id = EXCLUDED.last_job_id,
  updated_at = EXCLUDED.updated_at
RETURNING (xmax = 0) AS inserted
"""


def upsert_fetched_posts(db, owner_id: int, source_key: str, job_id: int, rows: List[Dict[str, Any]]) -> int:
    """Lưu 1 nhóm bài (đã khử trùng post_key). Trả về số bài MỚI (lần đầu thấy)."""
    if not rows:
        return 0
    params: Dict[str, Any] = {"owner": owner_id, "source_key": source_key, "job": job_id, "now": vn_now()}
    values = []
    for i, r in enumerate(rows):
        values.append(
            f"(:owner, :source_key, :k{i}, :u{i}, :tu{i}, :tf{i}, :c{i}, :t{i}, :pa{i}, :pt{i},"
            f" :rc{i}, :cc{i}, :sc{i}, :pin{i}, :job, :job, :now, :now)"
        )
        params.update({
            f"k{i}": r["post_key"],
            f"u{i}": r["post_url"],
            f"tu{i}": r["target_url"],
            f"tf{i}": r["target_fb_id"],
            f"c{i}": r.get("content") or None,
            f"t{i}": r.get("post_type") or None,
            f"pa{i}": r.get("published_at") or None,
            f"pt{i}": r.get("published_text") or None,
            f"rc{i}": int(r.get("reaction_count") or 0),
            f"cc{i}": int(r.get("comment_count") or 0),
            f"sc{i}": int(r.get("share_count") or 0),
            f"pin{i}": bool(r.get("is_pinned")),
        })
    sql = f"INSERT INTO seeding_fetched_posts ({_UPSERT_COLUMNS}) VALUES {', '.join(values)} {_UPSERT_CONFLICT}"
    result = db.execute(text(sql), params).fetchall()
    return sum(1 for row in result if row[0])


def prepare_rows(posts: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Bài đọc từ feed → dòng lưu DB (khoá pfbid-safe, link chuẩn hoá, bỏ trùng trong cùng nhóm)."""
    out: Dict[str, Dict[str, Any]] = {}
    for p in posts:
        url = (p.get("post_url") or "").strip()
        key = seeding_post_key(url)
        if not url or not key or key in out:
            continue
        target_url, target_fb_id = post_target_fields(url)
        if not target_fb_id:
            continue
        out[key] = dict(p, post_key=key, post_url=canonical_post_url(url), target_url=target_url, target_fb_id=target_fb_id)
    return list(out.values())


def _update_job(job_id: int, **fields) -> None:
    if not fields:
        return
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    try:
        with _session() as s:
            s.execute(text(f"UPDATE seeding_post_fetch_jobs SET {sets} WHERE id = :job_id"), dict(fields, job_id=job_id))
    except Exception as exc:
        logger.warning(f"[SeedingFetch #{job_id}] cập nhật job lỗi: {exc}")


def job_to_dict(job: SeedingPostFetchJob | None) -> Optional[Dict[str, Any]]:
    if job is None:
        return None
    from modules.module_08_interaction_seeding.routes.seeding_routes import to_vn_iso

    return {
        "id": job.id,
        "source_url": job.source_url,
        "source_key": job.source_key,
        "source_name": job.source_name,
        "account_uid": job.account_uid,
        "status": job.status,
        "stop_reason": job.stop_reason,
        "found_count": job.found_count or 0,
        "new_count": job.new_count or 0,
        "error_message": job.error_message,
        "started_at": to_vn_iso(job.started_at),
        "finished_at": to_vn_iso(job.finished_at),
        "is_running": is_job_running(job.id),
    }


# ─────────────────────────────────────────────────────────────
# Chạy job
# ─────────────────────────────────────────────────────────────
def start_fetch_thread(job_id: int, owner_id: int, owner_identifiers: List[str], source_url: str, source_key: str, account_uid: str) -> None:
    """Job phải được try_register_job trước. Chạy trong thread riêng (không chiếm threadpool của FastAPI)."""
    with _jobs_lock:
        stop = _running_jobs[job_id]["stop"]
    threading.Thread(
        target=_run_fetch_job,
        args=(job_id, owner_id, owner_identifiers, source_url, source_key, account_uid, stop),
        name=f"seeding-post-fetch-{job_id}",
        daemon=True,
    ).start()


def _source_name(driver) -> str:
    try:
        title = (driver.title or "").strip()
    except Exception:
        return ""
    title = re.sub(r"^\(\d+\+?\)\s*", "", title)
    return re.sub(r"\s*[|\-–]\s*Facebook\s*$", "", title).strip()[:255]


def _browser_gone(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(s in msg for s in ("no such window", "not reachable", "invalid session id", "disconnected", "target window already closed"))


def _run_fetch_job(
    job_id: int,
    owner_id: int,
    owner_identifiers: List[str],
    source_url: str,
    source_key: str,
    account_uid: str,
    stop: threading.Event,
) -> None:
    from modules.module_02_account_manager.automation.browser_manager import create_driver
    from modules.module_02_account_manager.automation.login_flow import is_checkpoint_url
    from modules.module_02_account_manager.context import owner_context
    from modules.module_02_account_manager.database.models import Account
    from modules.module_02_account_manager.services.browser_service import HWID
    from modules.module_08_interaction_seeding.automation import FacebookSeedingBot
    from modules.module_08_interaction_seeding.routes.seeding_routes import _safe_close_seeding_driver, broadcast
    from modules.module_11_page_scanner.page_detail_scan import _open_and_wait, has_session_cookie
    from modules.module_11_page_scanner.posts_scan import extract_posts_batch

    owner = str(owner_id)
    ctx_token = owner_context.set(owner)
    driver = None
    status, reason, error = "FAILED", "ERROR", None
    found_keys: set[str] = set()
    new_total = 0

    def log(level: str, msg: str) -> None:
        try:
            broadcast(level, f"[Lấy bài #{job_id}] {msg}", uid=account_uid, owner=owner)
        except Exception:
            logger.info(f"[SeedingFetch #{job_id}] {msg}")

    def on_checkpoint() -> bool:
        try:
            current = driver.current_url or ""
        except Exception:
            return False
        path = urlparse(current).path.lower()
        return is_checkpoint_url(current) or path == "/login" or path.startswith("/login/") or path.startswith("/login.php")

    try:
        with _session() as s:
            account = (
                s.query(Account)
                .filter(Account.uid == account_uid, Account.user_id.in_(owner_identifiers))
                .first()
            )
        if account is None:
            error = "Không tìm thấy tài khoản dùng để lấy bài."
            return

        log("info", f"Mở Chrome của nick {account_uid} để lấy bài…")
        driver = create_driver(uid=account_uid, headless=False, proxy=account.proxy, scope="seeding")
        bot = FacebookSeedingBot(driver)
        if not bot.is_facebook_session_alive(navigate=True):
            log("warning", "Nick chưa có phiên đăng nhập — đang nạp cookie / đăng nhập…")
            if not bot.apply_facebook_support_data(account, HWID, callback=lambda m: log("info", m)):
                reason, error = "LOGGED_OUT", "Không đăng nhập được Facebook bằng nick này."
                return
        if stop.is_set():
            status, reason = "STOPPED", "USER_STOPPED"
            return

        log("info", f"Mở {source_url}")
        _open_and_wait(driver, source_url, stop)
        if on_checkpoint() or not has_session_cookie(driver):
            log("warning", "Phiên đăng nhập bị mất — thử đăng nhập lại 1 lần…")
            if not bot.apply_facebook_support_data(account, HWID, callback=lambda m: log("info", m)):
                reason, error = "LOGGED_OUT", "Nick bị đăng xuất / checkpoint, không đăng nhập lại được."
                return
            _open_and_wait(driver, source_url, stop)
            if on_checkpoint():
                reason, error = "CHECKPOINT", "Nick bị checkpoint khi mở trang."
                return

        name = _source_name(driver)
        if name:
            _update_job(job_id, source_name=name)
        exclude = (name,) if name else ()
        log("info", f"Bắt đầu cuộn feed{(' của ' + name) if name else ''} — lấy tới khi hết bài hoặc bấm Dừng.")

        rounds = idle = deep = errors = 0
        last_height = 0
        last_new_at = time.time()
        last_beat = 0.0
        next_rest_at = LONG_REST_EVERY
        next_log_at = 50

        while not stop.is_set():
            rounds += 1
            batch = f"b{rounds}"
            try:
                info = driver.execute_script(_MARK_BATCH_JS, batch, BATCH_SIZE) or {}
                marked = int(info.get("marked") or 0)
                height = int(info.get("height") or 0)
                fresh = 0
                if marked:
                    posts = extract_posts_batch(
                        driver, exclude_names=exclude, selector=f'[data-m8-batch="{batch}"]', limit=BATCH_SIZE * 2
                    )
                    rows = prepare_rows(posts)
                    fresh = sum(1 for r in rows if r["post_key"] not in found_keys)
                    found_keys.update(r["post_key"] for r in rows)
                    if rows:
                        with _session() as s:
                            new_total += upsert_fetched_posts(s, owner_id, source_key, job_id, rows)
                    driver.execute_script(_FINISH_BATCH_JS, batch, TRIM_MEDIA)
                errors = 0
            except Exception as exc:
                if _browser_gone(exc):
                    error = "Chrome đã bị đóng trong lúc lấy bài."
                    return
                errors += 1
                logger.warning(f"[SeedingFetch #{job_id}] vòng {rounds} lỗi: {exc}")
                if errors >= MAX_ROUND_ERRORS:
                    error = f"Lỗi liên tục khi đọc bài: {exc}"
                    return
                stop.wait(2.0)
                continue

            now = time.time()
            if fresh:
                last_new_at = now
            if fresh or now - last_beat >= HEARTBEAT_EVERY_S:
                _update_job(job_id, found_count=len(found_keys), new_count=new_total, heartbeat_at=vn_now())
                last_beat = now
            if len(found_keys) >= next_log_at:
                log("info", f"Đã lấy {len(found_keys):,} bài ({new_total:,} bài mới).".replace(",", "."))
                next_log_at += 50

            # Có bài mới trên trang hoặc trang dài thêm (Facebook vừa tải thêm) = còn tiến triển
            if marked or height > last_height:
                idle = deep = 0
            else:
                idle += 1
            last_height = max(last_height, height)

            if idle >= IDLE_ROUNDS:
                # Có thể Facebook chưa kịp tải thêm: kéo hẳn xuống đáy và chờ
                driver.execute_script(_SCROLL_BOTTOM_JS)
                stop.wait(DEEP_WAIT_S)
                idle = 0
                deep += 1
                if deep >= DEEP_CHECKS:
                    status, reason = "COMPLETED", "END_OF_FEED"
                    break
                continue
            if now - last_new_at >= NO_NEW_TIMEOUT_S:
                status, reason = "COMPLETED", "END_OF_FEED"
                break
            if rounds % 10 == 0 and on_checkpoint():
                reason, error = "CHECKPOINT", "Nick bị checkpoint / đăng xuất giữa chừng."
                return

            if len(found_keys) >= next_rest_at:
                next_rest_at += LONG_REST_EVERY
                stop.wait(random.uniform(*LONG_REST_S))
            driver.execute_script(_SCROLL_JS)
            stop.wait(random.uniform(*SCROLL_PAUSE_S))
        else:
            status, reason = "STOPPED", "USER_STOPPED"
    except Exception as exc:
        logger.exception(f"[SeedingFetch #{job_id}] lỗi: {exc}")
        error = "Chrome đã bị đóng trong lúc lấy bài." if _browser_gone(exc) else f"Lỗi: {exc}"
    finally:
        # Bấm Dừng trong lúc mở Chrome / đăng nhập (chưa vào vòng cuộn) mà không có lỗi gì → Đã dừng
        if stop.is_set() and status == "FAILED" and not error:
            status, reason = "STOPPED", "USER_STOPPED"
        if driver is not None:
            try:
                _safe_close_seeding_driver(driver, uid=account_uid, owner=owner)
            except Exception as exc:
                logger.warning(f"[SeedingFetch #{job_id}] đóng Chrome lỗi: {exc}")
        _update_job(
            job_id,
            status=status,
            stop_reason=reason,
            error_message=error,
            found_count=len(found_keys),
            new_count=new_total,
            finished_at=vn_now(),
            heartbeat_at=vn_now(),
        )
        _unregister_job(job_id)
        total = f"{len(found_keys):,}".replace(",", ".")
        if status == "COMPLETED":
            log("success", f"Đã lấy hết bài: {total} bài ({new_total:,} bài mới).".replace(",", "."))
        elif status == "STOPPED":
            log("warning", f"Đã dừng lấy bài: {total} bài.")
        else:
            log("error", f"Lấy bài thất bại sau {total} bài — {error or reason}.")
        try:
            owner_context.reset(ctx_token)
        except Exception:
            pass
