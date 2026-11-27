"""
Điều phối Kiểm tra / Quét của Module 12 (job sống trong RAM, tiến độ + kết quả lưu DB).

- Mỗi nick 1 Chrome (tối đa MAX_PARALLEL_BROWSERS chạy song song), bài viết chia đều cho các nick (FairQueue);
  một nick không bao giờ mở 2 Chrome.
- Kiểm tra: mở từng bài → nội dung, nguồn (nhóm / page / trang cá nhân), thời gian đăng, số Like / Bình luận / Chia sẻ,
  bài bị xoá / riêng tư → "Không khả dụng".
- Quét: từng bài → người bày tỏ cảm xúc (cuộn hết) → tổng chia sẻ (Facebook không cho xem danh sách người chia sẻ)
  → bình luận (gốc + trả lời). Ghi DB mỗi 25 bản ghi, phân tầng tiềm năng tự nâng hạng khi có hành động mới.
- Nghỉ ngẫu nhiên Min–Max giây giữa 2 lượt tải và giữa 2 bài. Tạm dừng / Tiếp tục / Dừng khẩn cấp; Chrome bị tắt
  lúc tạm dừng thì mở lại và quét tiếp đúng bài. Nick bị checkpoint / chặn tạm thời → nhường bài cho nick khác.
"""
from __future__ import annotations

import logging
import random
import threading
import time
import uuid
from datetime import datetime
from typing import Any, Callable, Optional

from modules.module_12_post_engagement import scraper
from modules.module_12_post_engagement.common import (
    BROWSER_STAGGER_SEC,
    MAX_PARALLEL_BROWSERS,
    TERMINAL_STATUSES,
    FairQueue,
    close_account_session,
    interruptible_sleep,
    is_browser_dead_error,
    open_account_session,
    prune_jobs,
    wait_while_paused,
)
from modules.module_12_post_engagement.links import numeric_post_id, parse_post_link

logger = logging.getLogger(__name__)

MAX_POSTS = 20
# Không có hạn mức Share: Facebook chỉ cho xem tổng số lượt chia sẻ, không cho xem ai đã chia sẻ
QUOTA_LIMITS = {"like": 10000, "comment": 5000}
FLUSH_EVERY = 25
MIN_DELAY_SEC = 3.0
# Trần Delay giống giao diện: cả Min và Max tối đa 120 giây
MAX_DELAY_MIN_SEC = 120.0
MAX_DELAY_MAX_SEC = 120.0

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()
_label = threading.local()


class JobBusy(Exception):
    """Đã có phiên Kiểm tra / Quét đang chạy của user (router trả 409)."""


class PostReadError(Exception):
    """Mở được trang nhưng không đọc được dữ liệu bài (tải chậm / Facebook đổi giao diện) — thử lại được."""


# ---------------------------------------------------------------------------
# Job trong RAM
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now().strftime("%H:%M:%S")


def _log(job_id: str, message: str, level: str = "info") -> None:
    entry = {"time": _now(), "thread": getattr(_label, "name", "System"), "level": level.upper(), "message": message}
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            logs = job.setdefault("logs", [])
            logs.append(entry)
            if len(logs) > 1200:
                job["logs"] = logs[-1000:]


def _set(job_id: str, **kw: Any) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.update(kw)


def _progress(job_id: str, key: str, **kw: Any) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            row = job.setdefault("progress", {}).setdefault(key, {})
            row.update(kw)


def _control(job_id: str) -> str:
    with _jobs_lock:
        return (_jobs.get(job_id) or {}).get("control") or "run"


def set_control(job_id: str, action: str, owner: Optional[str]) -> bool:
    action = (action or "").strip().lower()
    if action not in ("pause", "resume", "abort"):
        return False
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job.get("owner") != owner or job.get("status") in TERMINAL_STATUSES:
            return False
        if job.get("control") == "abort":
            # Đã Dừng khẩn cấp: Tạm dừng / Tiếp tục gửi tới sau (bấm nhanh, tab khác) không được huỷ lệnh dừng
            return True  # bỏ qua lệnh, phiên vẫn đang dừng
        if action == "pause":
            job["control"], job["status"] = "pause", "paused"
        elif action == "resume":
            job["control"], job["status"] = "run", "running"
        else:
            job["control"], job["status"] = "abort", "stopping"
    _log(job_id, {"pause": "⏸️ Nhận lệnh TẠM DỪNG", "resume": "▶️ Nhận lệnh TIẾP TỤC", "abort": "🛑 Nhận lệnh DỪNG KHẨN CẤP"}[action],
         "warn")
    return True


def get_status(job_id: str, owner: Optional[str]) -> Optional[dict[str, Any]]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job.get("owner") != owner:
            return None
        return {
            "job_id": job_id,
            "kind": job["kind"],
            "status": job["status"],
            "control": job.get("control") or "run",
            "error": job.get("error") or "",
            "posts": [dict(p) for p in job["posts"]],
            "progress": {k: dict(v) for k, v in (job.get("progress") or {}).items()},
            "totals": dict(job.get("totals") or {}),
            "logs": list(job.get("logs") or []),
            "started_at": job.get("started_at"),
            "finished_at": job.get("finished_at"),
            "accounts": list(job.get("uids") or []),
        }


def get_active(owner: Optional[str], kind: str) -> Optional[str]:
    with _jobs_lock:
        active = [(j.get("started_at") or 0, jid) for jid, j in _jobs.items()
                  if j.get("owner") == owner and j.get("kind") == kind and j.get("status") not in TERMINAL_STATUSES]
    return max(active)[1] if active else None


def _handle_pause(job_id: str) -> bool:
    """Tạm dừng tại chỗ tới khi Tiếp tục. True nếu phải dừng hẳn."""
    control = lambda: _control(job_id)  # noqa: E731
    if control() != "pause":
        return control() == "abort"
    _log(job_id, "⏸️ Đã tạm dừng — bấm Tiếp tục để chạy tiếp.", "warn")
    if wait_while_paused(control):
        if control() == "pause":
            _log(job_id, "⚠️ Tạm dừng quá 2 giờ — tự kết thúc phiên.", "warn")
            _set(job_id, control="abort")
        return True
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            job["pause_resumes"] = int(job.get("pause_resumes") or 0) + 1
    _log(job_id, "▶️ Tiếp tục…", "info")
    return False


def _pause_resumes(job_id: str) -> int:
    with _jobs_lock:
        return int((_jobs.get(job_id) or {}).get("pause_resumes") or 0)


# ---------------------------------------------------------------------------
# Khởi tạo job
# ---------------------------------------------------------------------------


def _clean_uids(uids: list[Any]) -> list[str]:
    return list(dict.fromkeys(str(u).strip() for u in (uids or []) if str(u).strip()))


def normalize_targets(items: list[Any]) -> list[dict[str, Any]]:
    """Link / bài gửi lên → [{post_key, post_url, source_hint, like_quota, comment_quota, title}], bỏ trùng."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for it in items or []:
        raw = it if isinstance(it, str) else (it.get("post_url") or it.get("url") or "")
        info = parse_post_link(raw)
        if not info or info["post_key"] in seen:
            continue
        seen.add(info["post_key"])
        row = {"post_key": info["post_key"], "post_url": info["url"], "source_hint": info["source_hint"]}
        if isinstance(it, dict):
            for kind in QUOTA_LIMITS:
                val = it.get(f"{kind}_quota")
                try:
                    row[f"{kind}_quota"] = max(0, min(QUOTA_LIMITS[kind], int(val)))
                except (TypeError, ValueError):
                    row[f"{kind}_quota"] = QUOTA_LIMITS[kind]
            row["title"] = str(it.get("title") or "")[:160]
        out.append(row)
    return out


def _new_job(owner: str, kind: str, uids: list[str], posts: list[dict[str, Any]], **extra: Any) -> str:
    prune_jobs(_jobs, _jobs_lock)
    prefix = "PEC" if kind == "check" else "PES"
    job_id = f"{prefix}-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    with _jobs_lock:
        # Kiểm tra và đăng ký trong cùng 1 lần khoá: bấm đúp / Chạy tiếp ở 2 tab không tạo được 2 phiên song song
        busy = next((j for j in _jobs.values() if j.get("owner") == owner and j.get("status") not in TERMINAL_STATUSES), None)
        if busy:
            raise JobBusy("Đang có phiên Kiểm tra chạy." if busy.get("kind") == "check" else "Đang có phiên quét chạy.")
        _jobs[job_id] = {
            "job_id": job_id, "kind": kind, "owner": owner, "uids": uids, "posts": posts, "status": "running",
            "control": "run", "logs": [], "progress": {p["post_key"]: {"status": "pending"} for p in posts},
            "totals": {"likes": 0, "comments": 0}, "started_at": time.time(), "finished_at": None,
            "error": "", **extra,
        }
    return job_id


def start_check(owner: str, uids: list[Any], links: list[Any]) -> dict[str, Any]:
    uids = _clean_uids(uids)
    posts = normalize_targets(links)
    if not uids:
        raise ValueError("Chọn ít nhất 1 tài khoản Facebook thực thi.")
    if not posts:
        raise ValueError("Không có link bài viết Facebook hợp lệ để kiểm tra.")
    if len(posts) > MAX_POSTS:
        raise ValueError(f"Mỗi phiên tối đa {MAX_POSTS} bài viết.")
    job_id = _new_job(owner, "check", uids, posts)
    _spawn(job_id)
    return {"job_id": job_id, "posts": posts, "accounts": len(uids)}


def start_scan(owner: str, uids: list[Any], posts: list[Any], *, delay_min: float = 5, delay_max: float = 10,
               resumed_from: str = "") -> dict[str, Any]:
    from modules.module_12_post_engagement import models

    uids = _clean_uids(uids)
    targets = normalize_targets(posts)
    if not uids:
        raise ValueError("Chọn ít nhất 1 tài khoản Facebook thực thi.")
    if not targets:
        raise ValueError("Chưa có bài viết hợp lệ để quét.")
    if len(targets) > MAX_POSTS:
        raise ValueError(f"Mỗi phiên tối đa {MAX_POSTS} bài viết.")
    if not any(t["like_quota"] or t["comment_quota"] for t in targets):
        raise ValueError("Số lượng quét Like / Bình luận đều bằng 0.")
    lo, hi = max(MIN_DELAY_SEC, float(delay_min or 0)), max(MIN_DELAY_SEC, float(delay_max or 0))
    lo, hi = min(lo, hi, MAX_DELAY_MIN_SEC), min(max(lo, hi), MAX_DELAY_MAX_SEC)
    job_id = _new_job(owner, "scan", uids, targets, delay_min=lo, delay_max=hi)
    request = {"uids": uids, "posts": targets, "delay_min": lo, "delay_max": hi}
    try:
        models.create_session(owner, job_id, kind="SCAN",
                              title=f"Quét tương tác {len(targets)} bài viết" + (f" (chạy tiếp {resumed_from})" if resumed_from else ""),
                              config={"accounts": len(uids), "posts": len(targets), "delay": f"{lo:.0f}-{hi:.0f}s"})
        models.save_resume_state(job_id, {"kind": "post_engagement", "request": request,
                                          "progress": {t["post_key"]: {"likes": 0, "comments": 0, "done": False} for t in targets}})
    except Exception as exc:
        logger.warning("create pe session failed: %s", exc)
    _spawn(job_id)
    return {"job_id": job_id, "posts": targets, "accounts": len(uids), "delay_min": lo, "delay_max": hi}


def _spawn(job_id: str) -> None:
    threading.Thread(target=_run, args=(job_id,), daemon=True, name=f"post-engage-{job_id}").start()


def _run(job_id: str) -> None:
    from modules.module_02_account_manager.context import owner_scope

    with _jobs_lock:
        owner = (_jobs.get(job_id) or {}).get("owner")
    with owner_scope(owner):
        _body(job_id)


# ---------------------------------------------------------------------------
# Thân job: chạy song song nhiều Chrome
# ---------------------------------------------------------------------------


def _body(job_id: str) -> None:
    from collections import deque

    from modules.module_02_account_manager.context import owner_scope

    with _jobs_lock:
        job = _jobs[job_id]
        owner, kind = job["owner"], job["kind"]
        uids, posts = list(job["uids"]), list(job["posts"])

    def log(msg: str, level: str = "info") -> None:
        _log(job_id, msg, level)

    def stop_requested() -> bool:
        return _control(job_id) == "abort"

    workers = max(1, min(len(uids), len(posts), MAX_PARALLEL_BROWSERS))
    noun = "bài viết"
    mode = (f"mở {workers} Chrome song song, mỗi Chrome làm 1 {noun} một lúc" if workers > 1
            else "1 Chrome làm lần lượt" if len(posts) > 1 else "mở 1 Chrome")
    spare = len(uids) - workers
    _label.name = "System"
    log(f"🚀 {'Kiểm tra' if kind == 'check' else 'Quét tương tác'} {len(posts)} {noun}, {len(uids)} nick → {mode}"
        + (f"; {spare} nick dự phòng" if spare > 0 else "") + ".", "success")

    nick_queue = deque(uids)
    queue = FairQueue(list(enumerate(posts)), workers)
    lock = threading.Lock()
    state = {"opened": 0, "done": 0, "dead_nicks": 0}

    def take_nick() -> Optional[str]:
        with lock:
            return nick_queue.popleft() if nick_queue else None

    def run_worker(n: int) -> None:
        _label.name = f"Thread-{n:02d}"
        session, taken = None, 0
        try:
            if n > 1 and interruptible_sleep((n - 1) * BROWSER_STAGGER_SEC, lambda: _control(job_id)):
                return
            while True:
                while session is None:
                    if stop_requested() or not queue.has_work(taken):
                        return
                    nick = take_nick()
                    if nick is None:
                        log("⚠️ Không còn nick dự phòng mở được Chrome cho luồng này.", "warn")
                        return
                    session = open_account_session([nick], 0, owner=owner, log=log, should_stop=stop_requested,
                                                   window_slot=n - 1)
                    if session:
                        scraper.install_capture(session["driver"])
                with lock:
                    state["opened"] += 1
                resumes_at_open = _pause_resumes(job_id)
                first = True
                switch_nick = False
                while True:
                    if _handle_pause(job_id):
                        return
                    nxt = queue.take(taken, should_stop=stop_requested)
                    if nxt is None:
                        return
                    taken += 1
                    idx, post = nxt
                    if not first and kind == "scan":
                        with _jobs_lock:
                            dmin, dmax = _jobs[job_id]["delay_min"], _jobs[job_id]["delay_max"]
                        wait = random.uniform(dmin, dmax)
                        log(f"Nghỉ {wait:.1f}s trước bài kế tiếp…", "info")
                        if interruptible_sleep(wait, lambda: _control(job_id)):
                            queue.put_back(nxt)
                            taken -= 1
                            return
                    first = False
                    reopened = 0
                    while True:
                        try:
                            if kind == "check":
                                _check_one(job_id, session, idx, post, len(posts))
                            else:
                                _scan_one(job_id, session, idx, post, len(posts))
                            break
                        except scraper.AccountProblem as exc:
                            log(f"❌ Nick {session['uid']}: {exc}. Nhường bài «{_short(post)}» cho nick khác…", "error")
                            _progress(job_id, post["post_key"], status="pending", note=str(exc))
                            queue.put_back(nxt)
                            taken -= 1
                            with lock:
                                state["dead_nicks"] += 1
                            switch_nick = True
                            break
                        except Exception as exc:
                            if not is_browser_dead_error(exc):
                                # Lỗi riêng của bài này (trang lạ, dữ liệu thiếu…) → ghi lỗi, làm bài tiếp theo.
                                logger.exception("post engagement item failed: %s", post.get("post_url"))
                                log(f"❌ Bài «{_short(post)}» lỗi: {exc} — bỏ qua, làm bài tiếp theo.", "error")
                                _progress(job_id, post["post_key"], status="error", note=str(exc)[:300])
                                break
                            if stop_requested() or _pause_resumes(job_id) <= resumes_at_open or reopened >= 2:
                                _progress(job_id, post["post_key"], status="pending")
                                queue.put_back(nxt)
                                taken -= 1
                                raise
                            # Chrome bị tắt LÚC TẠM DỪNG rồi bấm Tiếp tục → mở lại Chrome của nick này, làm tiếp bài dở.
                            reopened += 1
                            nick = session["uid"]
                            log(f"🔄 Chrome của nick {nick} bị tắt trong lúc tạm dừng — mở lại để quét tiếp «{_short(post)}»…", "info")
                            close_account_session(session)
                            session = open_account_session([nick], 0, owner=owner, log=log, should_stop=stop_requested,
                                                           window_slot=n - 1)
                            if not session:
                                queue.put_back(nxt)
                                taken -= 1
                                log(f"⚠️ Không mở lại được Chrome của nick {nick}.", "warn")
                                return
                            scraper.install_capture(session["driver"])
                            resumes_at_open = _pause_resumes(job_id)
                    if switch_nick:
                        close_account_session(session)
                        session = None
                        break
                    with lock:
                        state["done"] += 1
                    if stop_requested():
                        return
        except Exception as exc:
            if is_browser_dead_error(exc):
                log(f"🛑 Chrome của nick {session.get('uid') if session else '?'} đã bị đóng — luồng này dừng.", "warn")
            else:
                logger.exception("post engagement worker %s crashed", job_id)
                log(f"❌ Luồng lỗi: {exc}", "error")
        finally:
            queue.leave(taken)
            close_account_session(session)

    def run_scoped(n: int) -> None:
        with owner_scope(owner):
            run_worker(n)

    final, error = "done", ""
    try:
        threads = [threading.Thread(target=run_scoped, args=(n,), daemon=True, name=f"post-engage-{job_id}-{n}")
                   for n in range(1, workers + 1)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        _label.name = "System"
        with _jobs_lock:
            prog = dict(_jobs[job_id].get("progress") or {})
        # Bài lỗi cũng là chưa xong → phiên kết thúc "dừng giữa chừng" để Chạy tiếp quét lại (không báo Thành công)
        unfinished = [k for k, v in prog.items() if v.get("status") not in ("done", "unavailable")]
        failed = sum(1 for v in prog.values() if v.get("status") == "error")
        if stop_requested():
            final = "aborted"
        elif state["opened"] == 0:
            final, error = "error", "Không có tài khoản nào mở được Chrome và đăng nhập Facebook."
            log(f"❌ {error}", "error")
        elif unfinished:
            final = "aborted"
            error = f"Còn {len(unfinished)} bài chưa {'kiểm tra' if kind == 'check' else 'quét'} xong"
            if failed:
                error += f" ({failed} bài lỗi)"
            if state["dead_nicks"] and not nick_queue:
                error += " — hết tài khoản Live khả dụng (nick bị checkpoint / chặn tạm thời)"
            log(f"⚠️ {error}." + (" Bấm Chạy tiếp để quét nốt." if kind == "scan" else " Bấm Kiểm tra lại các bài này."), "warn")
    except Exception as exc:
        logger.exception("post engagement job %s failed", job_id)
        final, error = "error", str(exc)
        log(f"❌ Lỗi nghiêm trọng: {exc}", "error")
    finally:
        _label.name = "System"
        with _jobs_lock:
            totals = dict(_jobs[job_id].get("totals") or {})
        if kind == "scan":
            log(f"🏁 Phiên quét kết thúc ({final}). Tổng: {totals.get('likes', 0):,} lượt cảm xúc, "
                f"{totals.get('comments', 0):,} bình luận.", "success" if final == "done" else "warn")
        else:
            log(f"🏁 Kiểm tra xong ({final}).", "success" if final == "done" else "warn")
        _set(job_id, status=final, error=error, finished_at=time.time())
        if kind == "scan":
            _finish_session(job_id, final)


def _finish_session(job_id: str, final: str) -> None:
    from modules.module_12_post_engagement import models

    with _jobs_lock:
        job = _jobs.get(job_id) or {}
        logs, totals = list(job.get("logs") or []), dict(job.get("totals") or {})
    try:
        _save_resume(job_id, force=True)
        models.update_session(job_id, status={"done": "SUCCESS", "aborted": "ABORTED"}.get(final, "FAILED"), logs=logs,
                              finished=True, total_likes=totals.get("likes", 0), total_comments=totals.get("comments", 0))
    except Exception as exc:
        logger.debug("finish pe session failed: %s", exc)


_last_resume_save: dict[str, float] = {}


def _save_resume(job_id: str, *, force: bool = False) -> None:
    from modules.module_12_post_engagement import models

    now = time.time()
    if not force and now - _last_resume_save.get(job_id, 0) < 3:
        return
    _last_resume_save[job_id] = now
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job or job.get("kind") != "scan":
            return
        request = {"uids": job["uids"], "posts": job["posts"], "delay_min": job.get("delay_min"), "delay_max": job.get("delay_max")}
        progress = {k: {"likes": int(v.get("likes") or 0), "comments": int(v.get("comments") or 0),
                        "done": v.get("status") in ("done", "unavailable")}
                    for k, v in (job.get("progress") or {}).items()}
    try:
        models.save_resume_state(job_id, {"kind": "post_engagement", "request": request, "progress": progress})
    except Exception as exc:
        logger.debug("save pe resume failed: %s", exc)


def _short(post: dict[str, Any]) -> str:
    return (post.get("title") or post.get("post_url") or post.get("post_key") or "")[:70]


def _meta_to_post(post: dict[str, Any], opened: dict[str, Any]) -> dict[str, Any]:
    meta = opened.get("meta") or {}
    # Chỉ coi là "không khả dụng" khi Facebook BÁO bài không xem được. Không đọc được dữ liệu (trang tải chậm quá
    # thời gian chờ, giao diện lạ) là lỗi thử lại được — không đánh dấu bài đã xoá / riêng tư.
    unavailable = bool(opened.get("state", {}).get("unavailable"))
    if not meta and not unavailable:
        raise PostReadError("không đọc được dữ liệu bài (trang tải chậm hoặc giao diện Facebook khác thường)")
    return {
        "post_key": post["post_key"],
        # Link chia sẻ (/share/p/…) được Facebook chuyển sang link bài gốc khi mở → lưu link gốc
        "post_url": (meta.get("url") or opened.get("url") or post["post_url"]) if post["post_key"].startswith("share:") else post["post_url"],
        "fb_post_id": meta.get("post_id") or numeric_post_id(post["post_key"]) or None,
        "content": meta.get("message") or "",
        "source_type": meta.get("source_type") or ("group" if post.get("source_hint") == "group" else "unknown"),
        "source_name": meta.get("source_name") or "",
        "source_id": meta.get("source_id") or "",
        "author_name": (meta.get("author") or {}).get("name") or "",
        "author_id": (meta.get("author") or {}).get("id") or "",
        "posted_ts": meta.get("creation_time"),
        # None = Facebook không cho biết số (vẫn quét); 0 = chắc chắn chưa có tương tác (bỏ qua nhánh đó)
        "fb_like_count": meta.get("reactions"),
        "fb_comment_count": meta.get("comments"),
        "fb_share_count": meta.get("shares"),
        "availability": "unavailable" if unavailable else "available",
        "note": "Bài viết không khả dụng (đã xoá, riêng tư hoặc nick không xem được)" if unavailable else "",
    }


def _fix_source_type(models: Any, owner: str, row: dict[str, Any]) -> None:
    """Trang reel không cho biết tác giả là fanpage → dùng kết quả đã nhận ở bài khác của cùng nguồn."""
    try:
        if row.get("source_type") == "profile" and models.is_known_page(owner, row.get("source_id") or ""):
            row["source_type"] = "page"
    except Exception:  # chỉ là nhãn hiển thị, không chặn luồng quét
        logger.debug("is_known_page lỗi", exc_info=True)


def _public_meta(row: dict[str, Any]) -> dict[str, Any]:
    from modules.module_12_post_engagement.models import fmt_dt, utc_from_epoch

    return {
        "fb_post_id": row.get("fb_post_id") or "",
        "content": (row.get("content") or "")[:500],
        "source_type": row.get("source_type"),
        "source_name": row.get("source_name"),
        "author_name": row.get("author_name"),
        "posted_at": fmt_dt(utc_from_epoch(row.get("posted_ts"))),
        "fb_like_count": None if row.get("fb_like_count") is None else int(row["fb_like_count"]),
        "fb_comment_count": None if row.get("fb_comment_count") is None else int(row["fb_comment_count"]),
        "fb_share_count": None if row.get("fb_share_count") is None else int(row["fb_share_count"]),
        "availability": row.get("availability"),
        "note": row.get("note") or "",
    }


def _check_one(job_id: str, session: dict[str, Any], idx: int, post: dict[str, Any], total: int) -> None:
    from modules.module_12_post_engagement import models

    driver = session["driver"]
    _progress(job_id, post["post_key"], status="running", uid=session["uid"])
    _log(job_id, f"🔎 [{idx + 1}/{total}] Nick {session['uid']} kiểm tra bài {post['post_url']}", "info")
    opened = scraper.open_post(driver, post["post_url"])
    row = _meta_to_post(post, opened)
    with _jobs_lock:
        owner = _jobs[job_id]["owner"]
    _fix_source_type(models, owner, row)
    models.upsert_post(owner, row)
    meta = _public_meta(row)
    nf = lambda v: "?" if v is None else f"{v:,}"  # noqa: E731 — Facebook không cho biết số
    if row["availability"] == "unavailable":
        _progress(job_id, post["post_key"], status="unavailable", meta=meta)
        _log(job_id, f"⚠️ [{idx + 1}/{total}] Bài không khả dụng (đã xoá / riêng tư / sai link): {post['post_url']}", "warn")
        return
    _progress(job_id, post["post_key"], status="done", meta=meta)
    src = {"group": "Nhóm", "page": "Page", "profile": "Trang cá nhân"}.get(row["source_type"], "Nguồn")
    _log(job_id, f"✅ [{idx + 1}/{total}] {src} «{row['source_name'] or '—'}»: {nf(meta['fb_like_count'])} cảm xúc · "
                 f"{nf(meta['fb_comment_count'])} bình luận · {nf(meta['fb_share_count'])} chia sẻ.", "success")


def _scan_one(job_id: str, session: dict[str, Any], idx: int, post: dict[str, Any], total: int) -> None:
    """Quét 1 bài: cảm xúc → chia sẻ → bình luận. Ghi DB mỗi FLUSH_EVERY bản ghi."""
    from modules.module_12_post_engagement import models

    driver = session["driver"]
    key = post["post_key"]
    with _jobs_lock:
        job = _jobs[job_id]
        owner = job["owner"]
        dmin, dmax = job["delay_min"], job["delay_max"]
        prev = dict((job.get("progress") or {}).get(key) or {})
    likes_before, comments_before = int(prev.get("likes") or 0), int(prev.get("comments") or 0)
    _progress(job_id, key, status="running", uid=session["uid"])
    started = time.time()
    _log(job_id, f"▶️ [{idx + 1}/{total}] Nick {session['uid']} mở bài {post['post_url']}", "info")

    opened = scraper.open_post(driver, post["post_url"])
    row = _meta_to_post(post, opened)
    _fix_source_type(models, owner, row)
    models.upsert_post(owner, row)
    if row["availability"] == "unavailable":
        _progress(job_id, key, status="unavailable", meta=_public_meta(row))
        _log(job_id, f"⚠️ Bài {post['post_url']} không khả dụng hoặc đã đổi URL — bỏ qua, chuyển bài tiếp theo.", "warn")
        _save_resume(job_id, force=True)
        return
    _progress(job_id, key, meta=_public_meta(row))

    def tick() -> bool:
        return _control(job_id) == "abort"

    def pause_between() -> bool:
        if _handle_pause(job_id):
            return True
        return interruptible_sleep(random.uniform(dmin, dmax), lambda: _control(job_id))

    def make_sink(action: str, total_key: str) -> tuple[Callable[[list[dict[str, Any]]], None], Callable[[], None], dict[str, int]]:
        buf: list[dict[str, Any]] = []
        counter = {"n": 0}

        def flush() -> None:
            if not buf:
                return
            if action == "comment":
                models.save_comments(owner, key, list(buf))
            else:
                models.save_users(owner, key, list(buf), action=action)
            buf.clear()
            counts = models.refresh_post_counts(owner, key)
            _progress(job_id, key, scanned=counts)
            _save_resume(job_id)

        def sink(rows: list[dict[str, Any]]) -> None:
            buf.extend(rows)
            counter["n"] += len(rows)
            with _jobs_lock:
                j = _jobs[job_id]
                j["totals"][total_key] = int(j["totals"].get(total_key) or 0) + len(rows)
                pr = j.setdefault("progress", {}).setdefault(key, {})
                pr["likes" if action == "like" else "comments"] = (likes_before if action == "like" else comments_before) + counter["n"]
            if len(buf) >= FLUSH_EVERY:
                flush()

        return sink, flush, counter

    # 1) Người bày tỏ cảm xúc
    like_quota = max(0, int(post.get("like_quota") or 0) - likes_before)
    fb_id = row.get("fb_post_id") or ""
    if like_quota > 0 and row["fb_like_count"] != 0 and fb_id:
        _log(job_id, f"👍 Đang quét người bày tỏ cảm xúc bài số {idx + 1} (tối đa {like_quota:,})…", "info")
        sink, flush, counter = make_sink("like", "likes")
        try:
            known_likes = models.known_uids(owner, key, "like")
            res = scraper.collect_reactions(driver, fb_id, like_quota, on_batch=sink, tick=tick, pause=pause_between,
                                            known=known_likes)
        finally:
            flush()
        msg = f"✅ Bài số {idx + 1}: trích xuất {counter['n']:,} tài khoản đã bày tỏ cảm xúc"
        # Cờ "chỉ bạn bè" có thể bật nhầm (reel / bài công khai vẫn cho xem hết) → chỉ cảnh báo khi TỔNG đã có
        # (lưu từ lần quét trước + mới quét) vẫn thiếu so với số trên bài — quét lại bài cũ không báo nhầm
        short = row["fb_like_count"] is None or len(known_likes) + counter["n"] < int(row["fb_like_count"] or 0)
        if res.get("reason") == "stalled":
            _log(job_id, msg + f" — dừng sau {scraper.STALL_ROUNDS} vòng không có người mới, có thể còn sót.", "warn")
        elif res.get("friends_only") and short and res.get("reason") != "quota":
            _log(job_id, msg + " — Facebook chỉ cho xem tên người bày tỏ cảm xúc là BẠN BÈ của nick với bài ngoài nhóm.", "warn")
        elif res.get("reason") == "no_dialog":
            _log(job_id, f"⚠️ Bài số {idx + 1}: không mở được danh sách cảm xúc.", "warn")
        else:
            _log(job_id, msg + ".", "success")
        if tick():
            return
        if pause_between():
            return
    elif like_quota > 0 and row["fb_like_count"] == 0:
        _log(job_id, f"Bài số {idx + 1} chưa có lượt cảm xúc nào.", "info")

    # 2) Chia sẻ: Facebook không còn cho xem danh sách người chia sẻ → chỉ ghi nhận tổng số (đã lưu lúc mở bài)
    if (row["fb_share_count"] or 0) > 0:
        _log(job_id, f"🔗 Bài số {idx + 1} có {row['fb_share_count']:,} lượt chia sẻ — Facebook chỉ cho xem tổng số, "
                     f"không cho xem ai đã chia sẻ.", "info")

    # 3) Bình luận (gốc + trả lời, toàn văn)
    comment_quota = max(0, int(post.get("comment_quota") or 0) - comments_before)
    if comment_quota > 0 and row["fb_comment_count"] != 0:
        _log(job_id, f"💬 Đang quét bình luận bài số {idx + 1} (tối đa {comment_quota:,}, kèm nội dung)…", "info")
        opened = scraper.open_post(driver, post["post_url"])
        sink, flush, counter = make_sink("comment", "comments")
        try:
            res = scraper.collect_comments(driver, comment_quota, on_batch=sink, tick=tick, pause=pause_between,
                                           initial_objs=opened.get("objs"), known=models.known_comment_ids(owner, key),
                                           post_id=fb_id)
        finally:
            flush()
        if res.get("reason") == "stalled":
            _log(job_id, f"⚠️ Bài số {idx + 1}: trích xuất {counter['n']:,} bình luận — dừng sau {scraper.STALL_ROUNDS} vòng "
                         f"không có bình luận mới, có thể còn sót.", "warn")
        else:
            _log(job_id, f"✅ Bài số {idx + 1}: trích xuất {counter['n']:,} bình luận kèm nội dung"
                         + (" (đã chuyển bộ lọc sang Tất cả bình luận)" if res.get("sort") == "switched" else "") + ".", "success")
    elif comment_quota > 0 and row["fb_comment_count"] == 0:
        _log(job_id, f"Bài số {idx + 1} chưa có bình luận nào.", "info")

    counts = models.refresh_post_counts(owner, key)
    if tick():
        _progress(job_id, key, scanned=counts)
        return
    _progress(job_id, key, status="done", scanned=counts)
    _save_resume(job_id, force=True)
    took = max(1.0, time.time() - started)
    got = counts.get("likes", 0) + counts.get("comments", 0)
    thread_name = getattr(_label, "name", "System")
    _label.name = "System"
    try:
        _log(job_id, f"Bài số {idx + 1} xong: {counts['likes']:,} cảm xúc, {counts['comments']:,} bình luận — tiến trình hoạt động "
                     f"bình thường, tốc độ {got / took:.1f} mục/giây.", "info")
    finally:
        _label.name = thread_name
