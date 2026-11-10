"""
Module 10.3: Quét bài viết nhóm (Group Post Scraping)
- UC-GPS-01: Chọn tài khoản Facebook thực thi (xoay vòng pool nhiều nick)
- UC-GPS-02: Chọn nhóm mục tiêu từ kho danh mục (tối đa 20 nhóm / phiên)
- UC-GPS-03: Cấu hình quét nâng cao (delay min-max, đổi nick sau X bài, giới hạn Y bài/nhóm, lọc bài Z ngày qua, bỏ qua bài ghim, lọc trùng bài viết giữa các nhóm)
- UC-GPS-04: Khởi chạy quét bài viết nhóm & Giám sát Live Log thời gian thực
"""
from __future__ import annotations

import logging
import random
import re
import threading
import time
import uuid
from typing import Any, Optional

logger = logging.getLogger(__name__)

_post_jobs: dict[str, dict[str, Any]] = {}
_post_jobs_lock = threading.Lock()

SCRAPE_POSTS_JS = """
return (() => {
  const feed = document.querySelector('[role="feed"]');
  const articles = document.querySelectorAll('div[role="article"]');
  const containers = feed ? Array.from(feed.children) : (articles.length > 0 ? Array.from(articles) : []);
  if (containers.length === 0) return [];

  const parseNumber = (str) => {
    if (!str) return 0;
    let s = str.trim().toLowerCase();
    let m = s.match(/([0-9.,]+)\\s*([kmtr])?/);
    if (!m) return 0;
    let num = parseFloat(m[1].replace(/,/g, '.'));
    let unit = m[2];
    if (unit === 'k') num *= 1000;
    if (unit === 'm' || unit === 'tr') num *= 1000000;
    return Math.round(num);
  };

  const cleanText = (t) => (t || '').replace(/\\s+/g, ' ').trim();

  const posts = [];
  const seenIds = new Set();

  for (const child of containers) {
    const postLinkEl = child.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="multi_permalinks="]');
    if (!postLinkEl) continue;

    let rawHref = postLinkEl.getAttribute('href') || postLinkEl.href || '';
    let postId = '';
    let postUrl = '';

    const mPost = rawHref.match(/\\/posts\\/(\\d+)/);
    if (mPost) {
      postId = mPost[1];
      postUrl = rawHref.split('?')[0];
    } else {
      const mPerm = rawHref.match(/multi_permalinks=(\\d+)/);
      if (mPerm) {
        postId = mPerm[1];
        postUrl = rawHref.split('&')[0];
      }
    }

    if (!postId || seenIds.has(postId)) continue;
    seenIds.add(postId);

    const fullCardText = child.innerText || '';

    // Kiểm tra bài ghim
    const isPinned = /bài viết được ghim|pinned post|được ghim/i.test(fullCardText) ||
                     !!child.querySelector('[aria-label*="ghim" i], [aria-label*="Pinned" i]');

    // Tác giả & UID
    let authorName = 'Ẩn danh';
    let authorUid = '';
    let authorUrl = '';

    const authorAnchors = child.querySelectorAll('a[href*="/user/"], h2 a, h3 a, h4 a, strong a');
    for (const a of authorAnchors) {
      const at = cleanText(a.innerText || a.getAttribute('aria-label') || '');
      const href = a.getAttribute('href') || a.href || '';
      if (at && at.length > 1 && !/^(like|thích|chia sẻ|bình luận|comment|xem thêm|share|follow|theo dõi)/i.test(at)) {
        authorName = at;
        authorUrl = href.startsWith('http') ? href : 'https://www.facebook.com' + href;
        const uMatch = href.match(/\\/user\\/(\\d+)/) || href.match(/facebook\\.com\\/([^/?#]+)/);
        if (uMatch) authorUid = uMatch[1];
        break;
      }
    }

    // Nội dung bài viết
    let content = '';
    const msgDivs = child.querySelectorAll('div[data-ad-preview="message"], div[dir="auto"]');
    for (const md of msgDivs) {
      const t = cleanText(md.innerText || '');
      if (t.length > content.length && !t.includes(authorName) && !t.includes('bình luận')) {
        content = t;
      }
    }

    // Lượt thích / Thả cảm xúc
    let likes = 0;
    const likeEl = child.querySelector('[aria-label*="thích" i], [aria-label*="like" i], [aria-label*="reaction" i]');
    if (likeEl) {
      likes = parseNumber(likeEl.getAttribute('aria-label') || likeEl.innerText || '');
    }

    // Lượt bình luận
    let comments = 0;
    const cmtMatch = fullCardText.match(/([0-9.,]+[KkMmTr]?)\\s*(?:bình luận|comments?|cmt)/i);
    if (cmtMatch) comments = parseNumber(cmtMatch[1]);

    // Lượt chia sẻ
    let shares = 0;
    const shareMatch = fullCardText.match(/([0-9.,]+[KkMmTr]?)\\s*(?:lượt chia sẻ|chia sẻ|shares?)/i);
    if (shareMatch) shares = parseNumber(shareMatch[1]);

    // Thời gian đăng bài
    let postedTime = '';
    const timeEl = child.querySelector('a[href*="/posts/"] span, a[href*="/permalink/"] span, abbr');
    if (timeEl) {
      postedTime = cleanText(timeEl.innerText || timeEl.getAttribute('aria-label') || '');
    }

    posts.push({
      postId,
      postUrl,
      authorName,
      authorUid,
      authorUrl,
      content,
      likes,
      comments,
      shares,
      isPinned,
      postedTime,
    });
  }

  return posts;
})();
"""


def _now_str() -> str:
    return time.strftime("%H:%M:%S")


def _append_post_log(job_id: str, message: str, level: str = "info", thread: str = "Thread-01") -> None:
    color_map = {
        "info": "text-slate-300",
        "success": "text-emerald-400",
        "warn": "text-amber-400",
        "error": "text-rose-400",
    }
    entry = {
        "time": _now_str(),
        "thread": thread,
        "color": color_map.get(level.lower(), "text-slate-300"),
        "message": message,
        "level": level.upper(),
    }
    with _post_jobs_lock:
        job = _post_jobs.get(job_id)
        if job is not None:
            logs = job.setdefault("logs", [])
            logs.append(entry)
            if len(logs) > 1000:
                job["logs"] = logs[-800:]

    try:
        from modules.module_10_group_scan.models import add_session_log
        add_session_log(job_id, level.upper(), f"[{thread}] {message}")
    except Exception:
        pass


def _set_post_job(job_id: str, **kwargs: Any) -> None:
    with _post_jobs_lock:
        job = _post_jobs.get(job_id)
        if job is not None:
            job.update(kwargs)


def _get_post_control(job_id: str) -> str:
    with _post_jobs_lock:
        return (_post_jobs.get(job_id) or {}).get("control") or "run"


def set_post_scan_control(job_id: str, action: str) -> bool:
    action_clean = (action or "").strip().lower()
    if action_clean not in {"pause", "resume", "abort"}:
        return False
    with _post_jobs_lock:
        job = _post_jobs.get(job_id)
        if not job:
            return False
        job["control"] = action_clean
        if action_clean == "pause":
            job["status"] = "paused"
        elif action_clean == "resume":
            job["status"] = "running"
        elif action_clean == "abort":
            job["status"] = "aborted"
    _append_post_log(job_id, f"Lệnh điều khiển nhận được: {action_clean.upper()}", "warn")
    return True


def get_post_scan_status(job_id: str) -> Optional[dict[str, Any]]:
    with _post_jobs_lock:
        job = _post_jobs.get(job_id)
        if not job:
            return None
        return {
            "job_id": job_id,
            "status": job.get("status"),
            "error": job.get("error") or "",
            "current_group": job.get("current_group"),
            "current_account": job.get("current_account"),
            "target_groups_count": len(job.get("target_groups") or []),
            "groups_done": job.get("groups_done", 0),
            "posts": list(job.get("posts") or []),
            "total_posts_scanned": len(job.get("posts") or []),
            "control": job.get("control") or "run",
            "logs": list(job.get("logs") or []),
            "started_at": job.get("started_at"),
            "finished_at": job.get("finished_at"),
        }


def _is_post_older_than_days(posted_time_str: str, max_days: int) -> bool:
    """Kiểm tra thời gian đăng có cũ hơn số ngày quy định không."""
    if not posted_time_str or max_days <= 0:
        return False
    raw = posted_time_str.lower().strip()
    # Các mốc giờ/phút/vừa xong đều nhỏ hơn 1 ngày
    if any(k in raw for k in ["vừa xong", "phút", "m", "giờ", "h", "tiếng"]):
        return False
    # Khớp số ngày: ví dụ "2 ngày", "5d", "3 ngày trước"
    m_days = re.search(r"(\d+)\s*(?:ngày|d|days?)", raw)
    if m_days:
        d = int(m_days.group(1))
        return d > max_days
    # Khớp số tuần: 1 tuần = 7 ngày
    m_weeks = re.search(r"(\d+)\s*(?:tuần|w|weeks?)", raw)
    if m_weeks:
        d = int(m_weeks.group(1)) * 7
        return d > max_days
    # Khớp số tháng hoặc năm: chắc chắn cũ hơn nếu max_days < 30
    if any(k in raw for k in ["tháng", "năm", "mo", "yr", "year"]):
        return True
    return False


def start_post_scan(
    owner: str,
    uids: list[str],
    groups: list[dict[str, Any]],
    *,
    delay_min: float = 5.0,
    delay_max: float = 10.0,
    switch_acc_threshold: int = 50,
    posts_limit: int = 50,
    days_limit: int = 7,
    skip_pinned_posts: bool = True,
    auto_dedupe_posts: bool = True,
) -> dict[str, Any]:
    """Khởi chạy phiên quét bài viết nhóm đa luồng/xoay vòng tài khoản."""
    if not uids:
        raise ValueError("Vui lòng chọn ít nhất 1 tài khoản thực thi")
    if not groups:
        raise ValueError("Vui lòng chọn ít nhất 1 nhóm mục tiêu")
    if len(groups) > 20:
        raise ValueError("Số lượng nhóm trong một phiên không được vượt quá 20 nhóm")

    job_id = f"GPS-{int(time.time())}-{uuid.uuid4().hex[:6]}"

    dmin = max(1.0, min(3600.0, float(delay_min)))
    dmax = max(dmin, min(3600.0, float(delay_max)))
    limit_y = max(1, min(100, int(posts_limit)))
    switch_x = max(1, min(100, int(switch_acc_threshold)))
    days_z = max(1, min(365, int(days_limit)))

    with _post_jobs_lock:
        _post_jobs[job_id] = {
            "job_id": job_id,
            "owner": owner,
            "uids": list(uids),
            "current_account": uids[0],
            "target_groups": list(groups),
            "current_group": groups[0].get("name") or groups[0].get("id") or "",
            "groups_done": 0,
            "status": "running",
            "control": "run",
            "logs": [],
            "posts": [],
            "delay_min": dmin,
            "delay_max": dmax,
            "posts_limit": limit_y,
            "switch_acc_threshold": switch_x,
            "days_limit": days_z,
            "skip_pinned_posts": skip_pinned_posts,
            "auto_dedupe_posts": auto_dedupe_posts,
            "started_at": time.time(),
            "finished_at": None,
            "error": "",
        }

    try:
        from modules.module_10_group_scan.models import create_scan_session
        import json
        targets_str = ", ".join(str(g.get("name") or g.get("id")) for g in groups[:5])
        if len(groups) > 5:
            targets_str += f" và {len(groups) - 5} nhóm khác"

        cfg_str = json.dumps({
            "accounts_count": len(uids),
            "groups_count": len(groups),
            "delay": f"{dmin:.0f} - {dmax:.0f}s",
            "switch_after_posts": switch_x,
            "posts_limit": limit_y,
            "days_limit": days_z,
            "skip_pinned_posts": skip_pinned_posts,
            "auto_dedupe_posts": auto_dedupe_posts,
        }, ensure_ascii=False)

        create_scan_session(
            owner=owner,
            session_id=job_id,
            scan_type="GROUP_POSTS",
            title=f"Quét bài viết cho {len(groups)} nhóm («{targets_str[:80]}»)",
            target=targets_str,
            target_type="groups",
            source_uid=uids[0],
            account_name=f"Pool {len(uids)} nick",
            target_count=len(groups) * limit_y,
            config=cfg_str,
        )
    except Exception as exc:
        logger.warning(f"Failed to record post scan session: {exc}")

    thread = threading.Thread(
        target=_run_post_scan_worker,
        args=(job_id,),
        daemon=True,
        name=f"post-scan-{job_id}",
    )
    thread.start()

    return {
        "started": True,
        "job_id": job_id,
        "accounts_count": len(uids),
        "groups_count": len(groups),
        "posts_limit": limit_y,
        "switch_acc_threshold": switch_x,
        "days_limit": days_z,
        "delay_min": dmin,
        "delay_max": dmax,
    }


def _run_post_scan_worker(job_id: str) -> None:
    from modules.module_02_account_manager.automation import (
        create_driver,
        ensure_logged_in,
        get_profile_lock,
        human_sleep,
    )
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_02_account_manager.database.repository import AccountRepository as Repo
    from modules.module_02_account_manager.security.encryption import decrypt_data
    from modules.module_10_group_scan.models import (
        list_known_post_ids,
        normalize_group_id,
        update_scan_session,
        upsert_scanned_group_post,
    )

    with _post_jobs_lock:
        job = _post_jobs.get(job_id)
        if not job:
            return
        owner = job["owner"]
        uids = list(job["uids"])
        target_groups = list(job["target_groups"])
        dmin = job["delay_min"]
        dmax = job["delay_max"]
        switch_acc_threshold = job["switch_acc_threshold"]
        posts_limit = job["posts_limit"]
        days_limit = job["days_limit"]
        skip_pinned_posts = job["skip_pinned_posts"]
        auto_dedupe_posts = job["auto_dedupe_posts"]

    _append_post_log(
        job_id,
        f"Khởi động phiên quét bài viết cho {len(target_groups)} nhóm với {len(uids)} tài khoản.",
        "success",
    )

    known_db_posts: set[str] = set()
    if auto_dedupe_posts:
        try:
            known_db_posts = list_known_post_ids(owner)
            _append_post_log(
                job_id,
                f"Đã nạp {len(known_db_posts)} Post ID từ CSDL để kích hoạt cơ chế tự động lọc trùng chéo.",
                "info",
            )
        except Exception as exc:
            _append_post_log(job_id, f"Lỗi khi đọc Post ID CSDL: {exc}", "warn")

    seen_session_posts: set[str] = set(known_db_posts)
    all_scanned_posts: list[dict[str, Any]] = []

    account_index = 0
    driver = None
    current_uid = None
    profile_lock = None
    posts_scanned_with_acc = 0

    def close_current_driver():
        nonlocal driver, profile_lock, current_uid
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
            driver = None
        if profile_lock:
            try:
                profile_lock.release()
            except Exception:
                pass
            profile_lock = None
        current_uid = None

    try:
        for grp_idx, grp in enumerate(target_groups):
            ctrl = _get_post_control(job_id)
            if ctrl == "abort":
                _append_post_log(job_id, "Nhận tín hiệu DỪNG KHẨN CẤP. Ngừng toàn bộ tác vụ.", "warn")
                break
            while ctrl == "pause":
                _append_post_log(job_id, "Tiến trình đang TẠM DỪNG. Chờ lệnh tiếp tục...", "info")
                time.sleep(2)
                ctrl = _get_post_control(job_id)
                if ctrl == "abort":
                    break
            if ctrl == "abort":
                break

            # Trích xuất group_id và group_url thực tế của Facebook (tránh lấy nhầm db auto-increment id ví dụ 945)
            raw_url = str(grp.get("url") or grp.get("group_url") or grp.get("href") or "").strip()
            group_id = str(grp.get("group_id") or grp.get("groupId") or grp.get("uid") or "").strip()
            group_name = str(grp.get("name") or grp.get("group_name") or "").strip()
            raw_id = str(grp.get("id") or grp.get("dbId") or "").strip()

            # 1. Trích xuất slug ban đầu từ raw_url nếu có
            url_slug = ""
            if raw_url and "/groups/" in raw_url:
                url_slug = raw_url.split("/groups/")[-1].split("/")[0].split("?")[0].strip()

            # 2. Nhận diện ID số tự tăng CSDL (<= 7 chữ số)
            is_group_id_db_id = bool(group_id.isdigit() and len(group_id) < 8)
            is_slug_db_id = bool(url_slug.isdigit() and len(url_slug) < 8)
            is_raw_id_valid = bool(raw_id.isdigit())

            # 3. Tra cứu CSDL scanned_groups nếu phát hiện group_id hoặc url_slug mang ID số tự tăng CSDL
            need_db_lookup = is_group_id_db_id or is_slug_db_id or not group_id or not raw_url or (raw_id and group_id == raw_id and is_raw_id_valid)

            if need_db_lookup:
                try:
                    from core.database.connection import db
                    lookup_int = int(raw_id) if is_raw_id_valid else (
                        int(group_id) if is_group_id_db_id else (
                            int(url_slug) if is_slug_db_id else -1
                        )
                    )
                    db_fallback = None
                    if lookup_int > 0:
                        db_fallback = db.fetch_one(
                            "SELECT group_id, group_url, group_name FROM scanned_groups WHERE id = ?",
                            (lookup_int,),
                        )
                    if not db_fallback and group_id and not is_group_id_db_id:
                        db_fallback = db.fetch_one(
                            "SELECT group_id, group_url, group_name FROM scanned_groups WHERE group_id = ?",
                            (group_id,),
                        )

                    if db_fallback:
                        real_gid = str(db_fallback.get("group_id") or "").strip()
                        real_url = str(db_fallback.get("group_url") or "").strip()
                        real_name = str(db_fallback.get("group_name") or "").strip()

                        if real_gid and not (real_gid.isdigit() and len(real_gid) < 8):
                            group_id = real_gid
                        if real_url:
                            raw_url = real_url
                        if real_name and not group_name:
                            group_name = real_name
                except Exception as exc:
                    logger.warning(f"Failed to lookup real group_id: {exc}")

            # 4. Nếu sau khi tra cứu, group_id vẫn là số ngắn CSDL hoặc rỗng:
            if (not group_id or (group_id.isdigit() and len(group_id) < 8)) and raw_url and "/groups/" in raw_url:
                candidate_slug = raw_url.split("/groups/")[-1].split("/")[0].split("?")[0].strip()
                if candidate_slug and not (candidate_slug.isdigit() and len(candidate_slug) < 8):
                    group_id = candidate_slug

            # 5. Nếu raw_url kết thúc bằng số ngắn CSDL (ví dụ /groups/945):
            if raw_url and re.search(r"/groups/\d{1,7}(?:[/?#]|$)", raw_url):
                if group_id and not (group_id.isdigit() and len(group_id) < 8):
                    raw_url = f"https://www.facebook.com/groups/{group_id}"
                else:
                    raw_url = ""

            # 6. Kiểm tra an toàn: nếu group_id hoặc raw_url vẫn không hợp lệ
            if (group_id.isdigit() and len(group_id) < 8) or (not group_id and not raw_url):
                _append_post_log(
                    job_id,
                    f"⚠️ Bỏ qua nhóm «{group_name or 'ID ' + (group_id or raw_id)}»: Không tìm thấy đường dẫn Facebook hợp lệ trong CSDL (ID {group_id or raw_id}). Vui lòng quét lại thông tin nhóm.",
                    "warn",
                )
                continue

            if not group_name:
                group_name = group_id or "Nhóm Facebook"

            _set_post_job(job_id, current_group=group_name)

            # Xoay vòng tài khoản nếu cần (đủ X bài hoặc chưa mở driver)
            need_switch_account = (
                driver is None
                or current_uid is None
                or posts_scanned_with_acc >= switch_acc_threshold
            )

            if need_switch_account:
                if driver:
                    _append_post_log(
                        job_id,
                        f"[ROTATE] Đã quét được {posts_scanned_with_acc} bài với nick {current_uid}. Đổi tài khoản tiếp theo...",
                        "info",
                    )
                    close_current_driver()

                current_uid = uids[account_index % len(uids)]
                account_index += 1
                posts_scanned_with_acc = 0
                _set_post_job(job_id, current_account=current_uid)

                _append_post_log(
                    job_id,
                    f"Mở trình duyệt tự động hóa với tài khoản UID: {current_uid}...",
                    "info",
                )

                try:
                    profile_lock = get_profile_lock(current_uid)
                    if not profile_lock.acquire(timeout=10):
                        _append_post_log(
                            job_id,
                            f"Tài khoản {current_uid} đang bận bởi tiến trình khác, chuyển nick tiếp theo trong pool...",
                            "warn",
                        )
                        profile_lock = None
                        continue
                except Exception as exc:
                    _append_post_log(job_id, f"Lỗi khóa profile tài khoản {current_uid}: {exc}", "error")
                    profile_lock = None
                    continue

                db_sess = SessionLocal()
                try:
                    account_obj = Repo.get_by_uid(db_sess, current_uid, owner_username=owner)
                    if not account_obj:
                        from modules.module_02_account_manager.database.models import Account
                        account_obj = db_sess.query(Account).filter(Account.uid == current_uid).first()
                    if not account_obj:
                        _append_post_log(job_id, f"Không tìm thấy tài khoản {current_uid} trong Module 02.", "error")
                        close_current_driver()
                        continue
                    cookie = account_obj.cookie or ""
                    proxy = account_obj.proxy
                    try:
                        password = decrypt_data(account_obj.password or "")
                    except Exception:
                        password = ""
                    try:
                        two_fa = decrypt_data(account_obj.two_fa or "")
                    except Exception:
                        two_fa = ""
                finally:
                    db_sess.close()

                try:
                    driver = create_driver(
                        current_uid,
                        headless=False,
                        detach=True,
                        proxy=proxy,
                        scope="group-posts",
                        verify_egress=False,
                    )
                    login_res = ensure_logged_in(
                        driver,
                        uid=current_uid,
                        password=password,
                        two_fa=two_fa,
                        cookie=cookie,
                    )
                    if not login_res.get("success"):
                        _append_post_log(
                            job_id,
                            f"[ERROR] Tài khoản {current_uid} bị Checkpoint hoặc lỗi đăng nhập: {login_res.get('error')}. Đổi sang tài khoản tiếp theo...",
                            "error",
                        )
                        close_current_driver()
                        continue
                except Exception as exc:
                    _append_post_log(job_id, f"Lỗi khởi tạo Chrome cho {current_uid}: {exc}", "error")
                    close_current_driver()
                    continue

            # Điều hướng vào nhóm mục tiêu với sắp xếp bài mới nhất
            _append_post_log(
                job_id,
                f"[{grp_idx + 1}/{len(target_groups)}] Mở nhóm: «{group_name}» (ID: {group_id}) và chuyển Newsfeed sang bài mới nhất...",
                "info",
            )
            # Xây dựng URL cơ sở và URL mục tiêu
            base_group_url = raw_url if (raw_url and "/groups/" in raw_url and not re.search(r"/groups/\d{1,7}(?:[/?#]|$)", raw_url)) else f"https://www.facebook.com/groups/{group_id}"
            base_group_url = base_group_url.rstrip("/")
            target_url = f"{base_group_url}/?sorting_setting=CHRONOLOGICAL"

            try:
                driver.get(target_url)
                human_sleep(3.0, 4.5)
            except Exception as exc:
                _append_post_log(job_id, f"Lỗi truy cập {target_url}: {exc}", "warn")
                try:
                    target_url = f"{base_group_url}/"
                    driver.get(target_url)
                    human_sleep(3.0, 4.0)
                except Exception:
                    continue

            # Kiểm tra soft 404 (This Page Isn't Available / Trang này hiện không khả dụng)
            try:
                page_text_sample = driver.execute_script("return (document.body ? document.body.innerText : '').slice(0, 500).toLowerCase();") or ""
                if "this page isn't available" in page_text_sample or "trang này hiện không khả dụng" in page_text_sample:
                    _append_post_log(
                        job_id,
                        f"Bộ lọc sắp xếp bài mới nhất không tương thích với nhóm này, chuyển sang trang thảo luận chung...",
                        "warn",
                    )
                    target_url = f"{base_group_url}/"
                    driver.get(target_url)
                    human_sleep(3.0, 4.0)
            except Exception:
                pass

            group_posts: list[dict[str, Any]] = []
            max_scroll_rounds = 35
            scroll_stuck_count = 0
            prev_found_count = 0
            checkpoint_buffer: list[dict[str, Any]] = []

            for scroll_round in range(max_scroll_rounds):
                ctrl = _get_post_control(job_id)
                if ctrl == "abort":
                    break
                while ctrl == "pause":
                    time.sleep(2)
                    ctrl = _get_post_control(job_id)
                    if ctrl == "abort":
                        break
                if ctrl == "abort":
                    break

                if len(group_posts) >= posts_limit:
                    _append_post_log(
                        job_id,
                        f"Đã đạt hạn mức {posts_limit} bài viết cho nhóm «{group_name}».",
                        "success",
                    )
                    break

                # Bóc tách bài viết từ DOM
                try:
                    raw_items = driver.execute_script(SCRAPE_POSTS_JS) or []
                except Exception as exc:
                    _append_post_log(job_id, f"Lỗi đọc DOM bài viết: {exc}", "warn")
                    raw_items = []

                new_in_round = 0
                for item in raw_items:
                    pid = str(item.get("postId") or "").strip()
                    if not pid:
                        continue

                    # Bỏ qua bài ghim nếu cấu hình
                    if skip_pinned_posts and item.get("isPinned"):
                        continue

                    # Lọc trùng Post ID
                    if auto_dedupe_posts and pid in seen_session_posts:
                        continue

                    posted_time_raw = str(item.get("postedTime") or "").strip()
                    # Lọc theo số ngày đăng Z
                    if days_limit > 0 and _is_post_older_than_days(posted_time_raw, days_limit):
                        continue

                    seen_session_posts.add(pid)
                    post_record = {
                        "group_id": group_id,
                        "group_name": group_name,
                        "group_url": f"https://www.facebook.com/groups/{group_id}",
                        "post_id": pid,
                        "postId": pid,
                        "post_url": item.get("postUrl") or f"https://www.facebook.com/groups/{group_id}/posts/{pid}/",
                        "content": item.get("content") or "",
                        "author_name": item.get("authorName") or "Ẩn danh",
                        "author_uid": item.get("authorUid") or "",
                        "author_url": item.get("authorUrl") or "",
                        "likes": item.get("likes") or 0,
                        "likes_count": item.get("likes") or 0,
                        "comments": item.get("comments") or 0,
                        "comments_count": item.get("comments") or 0,
                        "shares": item.get("shares") or 0,
                        "shares_count": item.get("shares") or 0,
                        "posted_at": posted_time_raw,
                        "postedTime": posted_time_raw,
                        "is_pinned": bool(item.get("isPinned")),
                        "session_id": job_id,
                    }
                    group_posts.append(post_record)
                    checkpoint_buffer.append(post_record)
                    new_in_round += 1
                    posts_scanned_with_acc += 1

                    if len(group_posts) >= posts_limit:
                        break

                # Cập nhật state in-memory
                with _post_jobs_lock:
                    if job_id in _post_jobs:
                        _post_jobs[job_id]["posts"] = list(all_scanned_posts + group_posts)

                # Checkpoint: Lưu CSDL mỗi 10 bài viết (BR-GPS-04.4)
                if len(checkpoint_buffer) >= 10:
                    saved_batch = 0
                    for p_rec in checkpoint_buffer:
                        if upsert_scanned_group_post(
                            owner=owner,
                            group_id=group_id,
                            post=p_rec,
                            group_name=group_name,
                            group_url=p_rec["group_url"],
                            session_id=job_id,
                        ):
                            saved_batch += 1
                    _append_post_log(
                        job_id,
                        f"[Checkpoint] Đã lưu {saved_batch} bài viết mới của «{group_name}» vào CSDL.",
                        "info",
                    )
                    checkpoint_buffer.clear()

                if new_in_round > 0:
                    last_p = group_posts[-1]
                    snippet = (last_p['content'][:45] + "...") if len(last_p['content']) > 45 else (last_p['content'] or 'Ảnh/Video')
                    _append_post_log(
                        job_id,
                        f"Thu thập: «{snippet}» (Like: {last_p['likes']}, CMT: {last_p['comments']}, Share: {last_p['shares']}) | Tổng nhóm: {len(group_posts)}/{posts_limit}.",
                        "success",
                    )
                    scroll_stuck_count = 0
                else:
                    if len(group_posts) == prev_found_count:
                        scroll_stuck_count += 1
                        if scroll_stuck_count >= 5:
                            _append_post_log(
                                job_id,
                                f"Đã cuộn đến cuối danh sách bài viết nhóm «{group_name}».",
                                "info",
                            )
                            break
                    else:
                        scroll_stuck_count = 0

                prev_found_count = len(group_posts)

                # Kiểm tra hạn mức đổi nick
                if posts_scanned_with_acc >= switch_acc_threshold and len(uids) > 1:
                    _append_post_log(
                        job_id,
                        f"[ROTATE] Nick {current_uid} đã đạt hạn mức tích lũy {switch_acc_threshold} bài. Lưu bookmark và chuyển tài khoản tiếp theo...",
                        "info",
                    )
                    close_current_driver()
                    current_uid = uids[account_index % len(uids)]
                    account_index += 1
                    posts_scanned_with_acc = 0
                    _set_post_job(job_id, current_account=current_uid)
                    break

                # Cuộn trang mô phỏng người dùng
                try:
                    driver.execute_script("window.scrollBy({ top: 900, behavior: 'smooth' });")
                except Exception:
                    try:
                        driver.execute_script("window.scrollBy(0, 900);")
                    except Exception:
                        pass

                sleep_sec = random.uniform(dmin, dmax)
                human_sleep(sleep_sec * 0.4, sleep_sec * 0.6)

            # Lưu các bài còn lại trong buffer
            if checkpoint_buffer:
                saved_batch = 0
                for p_rec in checkpoint_buffer:
                    if upsert_scanned_group_post(
                        owner=owner,
                        group_id=group_id,
                        post=p_rec,
                        group_name=group_name,
                        group_url=p_rec["group_url"],
                        session_id=job_id,
                    ):
                        saved_batch += 1
                checkpoint_buffer.clear()

            all_scanned_posts.extend(group_posts)
            _set_post_job(
                job_id,
                groups_done=grp_idx + 1,
                posts=list(all_scanned_posts),
            )
            _append_post_log(
                job_id,
                f"Hoàn thành nhóm «{group_name}» với {len(group_posts)} bài viết thu thập được.",
                "success",
            )

            # Nghỉ giữa các nhóm
            if grp_idx < len(target_groups) - 1:
                group_delay = random.uniform(dmin, dmax)
                _append_post_log(
                    job_id,
                    f"Nghỉ ngơi an toàn {group_delay:.1f}s trước khi chuyển sang nhóm kế tiếp...",
                    "info",
                )
                time.sleep(group_delay)

        final_status = "aborted" if _get_post_control(job_id) == "abort" else "done"
        _set_post_job(
            job_id,
            status=final_status,
            finished_at=time.time(),
        )
        _append_post_log(
            job_id,
            f"Phiên quét bài viết hoàn tất. Tổng thu thập: {len(all_scanned_posts)} bài viết.",
            "success" if final_status == "done" else "warn",
        )

        try:
            update_scan_session(
                job_id,
                total_found=len(all_scanned_posts),
                status="SUCCESS" if final_status == "done" else "ABORTED",
                finished=True,
            )
        except Exception as exc:
            logger.debug(f"Update post scan session error: {exc}")

    except Exception as exc:
        logger.exception("Post scan worker uncaught exception: %s", exc)
        _set_post_job(job_id, status="error", error=str(exc))
        _append_post_log(job_id, f"Lỗi nghiêm trọng trong phiên quét: {exc}", "error")
    finally:
        close_current_driver()
