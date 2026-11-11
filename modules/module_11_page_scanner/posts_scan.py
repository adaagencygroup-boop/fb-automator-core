"""
Quét bài viết trên feed Page (job_type=POST_SCAN).
post_key chuẩn hóa; số reaction/comment/share dùng parse_compact_count;
ngày: published_text thô + published_at parse (nullable).
"""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any, Dict, List, Optional, Set, Tuple

from core.database.connection import db
from .browser_session import (
    AccountBusyError,
    acquire_browser,
    bump_account_usage,
    get_account_usage_today,
    release_account_job,
    release_browser,
    try_acquire_account_job,
)
from .facebook_time import parse_facebook_published_at, try_parse_published_at
from .followers_scan import resolve_page_url
from .page_source import normalize_post_key, parse_compact_count
from .scanner import (
    _ACTIVE_PAUSE_EVENTS,
    _ACTIVE_SESSIONS_LOCK,
    _ACTIVE_STOP_EVENTS,
    _wait_if_paused,
    append_session_log,
    create_scan_session,
    finalize_scan_session,
    get_scraping_account,
)

logger = logging.getLogger(__name__)

DEFAULT_PAGES_PER_ACC_DAY = 50

_EXTRACT_POSTS_JS = r"""
const out = [];
const seen = new Set();
const articles = Array.from(document.querySelectorAll('[role="article"], div[data-pagelet*="FeedUnit"]'));
const nodes = articles.length ? articles : Array.from(document.querySelectorAll('div')).filter(d => {
  const a = d.querySelector('a[href*="/posts/"], a[href*="/permalink"], a[href*="/videos/"], a[href*="/reel/"], a[href*="story_fbid"]');
  return !!a;
}).slice(0, 40);

for (const node of nodes) {
  const links = Array.from(node.querySelectorAll('a[href]'));
  let postUrl = null;
  for (const a of links) {
    const h = a.href || a.getAttribute('href') || '';
    if (/\/(posts|permalink|videos?|reels?|watch)\b/i.test(h) || /story_fbid=/i.test(h) || /\/photo\/?\?/i.test(h)) {
      postUrl = h.startsWith('http') ? h : ('https://www.facebook.com' + h);
      break;
    }
  }
  if (!postUrl || seen.has(postUrl)) continue;
  seen.add(postUrl);

  // Timestamp: ưu tiên utime / datetime / title tuyệt đối; text hiển thị chỉ là fallback.
  let publishedText = null;
  let publishedUtime = null;
  let publishedIso = null;
  const timeNodes = Array.from(node.querySelectorAll(
    'abbr[data-utime], time[datetime], span[data-utime], a[href*="/posts/"] abbr, a[href*="permalink"] abbr, a > abbr, a[aria-label]'
  ));
  for (const el of timeNodes) {
    const ut = el.getAttribute('data-utime') || (el.querySelector && (el.querySelector('[data-utime]') || {}).getAttribute?.('data-utime'));
    if (ut && !publishedUtime) {
      const n = parseInt(ut, 10);
      if (n > 0) publishedUtime = n;
    }
    const dt = el.getAttribute('datetime');
    if (dt && !publishedIso) publishedIso = dt;
    const title = (el.getAttribute('title') || '').trim();
    if (title && /(?:January|February|March|April|May|June|July|August|September|October|November|December|tháng|\d{4})/i.test(title)) {
      if (!publishedText || title.length > publishedText.length) publishedText = title.slice(0, 120);
    }
  }
  if (!publishedText) {
    for (const a of links) {
      const aria = (a.getAttribute('aria-label') || '').trim();
      const t = (a.innerText || '').trim();
      const cand = aria || t;
      if (!cand || cand.length > 120) continue;
      if (/just\s*now|vừa\s*xong|yesterday|hôm\s*qua|ago|trước|\b\d+\s*(?:min|mins|hr|hrs|hour|hours|day|days|week|weeks|month|months|year|years|phút|giờ|ngày|tuần|tháng|năm|[mhdwy])\b|tháng\s*\d|January|February|March|April|May|June|July|August|September|October|November|December/i.test(cand)) {
        publishedText = cand.slice(0, 120);
        break;
      }
    }
  }

  const textBits = [];
  const msgs = node.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"], div[dir="auto"]');
  for (const m of Array.from(msgs).slice(0, 3)) {
    const t = (m.innerText || '').trim();
    if (t && t.length > 2 && t.length < 2000) textBits.push(t);
  }
  const content = textBits.join('\n').slice(0, 1500) || null;

  let postType = 'text';
  if (/\/(reel|reels)\b/i.test(postUrl) || node.querySelector('video')) postType = 'video';
  else if (/\/(photo|photos)\b/i.test(postUrl) || node.querySelector('img[src*="scontent"]')) {
    if (postType !== 'video') postType = node.querySelector('video') ? 'video' : (content ? 'text' : 'photo');
    if (/\/photo/i.test(postUrl)) postType = 'photo';
  }
  if (/\/videos?\b/i.test(postUrl)) postType = 'video';

  const allText = (node.innerText || '').slice(0, 4000);

  // Thanh tương tác FB mới thường chỉ hiện icon + số (👍 92 · 💬 9 · ↗ 4).
  // Ưu tiên aria-label; tuyệt đối không dùng regex số lung tung (sẽ bắt "4" từ "4w").
  const pickCount = (label) => {
    if (!label) return null;
    const s = String(label).replace(/\u00a0/g, ' ');
    // "92 reactions" / "92 people reacted" / "92 người đã bày tỏ cảm xúc"
    // "9 comments" / "9 bình luận" / "4 shares" / "4 lượt chia sẻ"
    let m = s.match(
      /([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)\s*(?:reactions?|people\s+reacted|người\s*(?:đã\s*)?(?:bày\s*tỏ|thích)|lượt\s*thích|likes?)\b/i
    );
    if (m) return m[1];
    m = s.match(
      /([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)\s*(?:comments?|bình\s*luận|phan\s*hoi|phản\s*hồi)\b/i
    );
    if (m) return m[1];
    m = s.match(
      /([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)\s*(?:shares?|lượt\s*chia\s*sẻ|chia\s*sẻ)\b/i
    );
    if (m) return m[1];
    // "Like: 92" / "Thích · 92 người"
    m = s.match(/(?:^|\b)(?:like|thích|reactions?)\b[^0-9]{0,20}([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)/i);
    if (m) return m[1];
    return null;
  };

  let reactionText = null;
  let commentText = null;
  let shareText = null;

  const labeled = Array.from(node.querySelectorAll('[aria-label]'));
  for (const el of labeled) {
    const aria = el.getAttribute('aria-label') || '';
    if (!aria) continue;
    const low = aria.toLowerCase();
    // Một aria gộp: "92 reactions, 9 comments, 4 shares"
    const combo = aria.match(
      /([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)\s*(?:reactions?|người\s*(?:đã\s*)?bày\s*tỏ|likes?).{0,40}?([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)\s*(?:comments?|bình\s*luận).{0,40}?([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)\s*(?:shares?|chia\s*sẻ)/i
    );
    if (combo) {
      reactionText = reactionText || combo[1];
      commentText = commentText || combo[2];
      shareText = shareText || combo[3];
      continue;
    }
    if (!reactionText && /react|bày\s*tỏ|lượt\s*thích|(?:^|\b)likes?\b/i.test(low) && !/comment|bình\s*luận|share|chia\s*sẻ/i.test(low)) {
      reactionText = pickCount(aria) || reactionText;
    }
    if (!commentText && /comment|bình\s*luận|phản\s*hồi/i.test(low)) {
      // aria đôi khi chỉ là "9 comments" — pickCount đã cover; nếu chỉ số trong label riêng
      commentText = pickCount(aria) || commentText;
      if (!commentText) {
        const nm = aria.match(/([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)/);
        if (nm) commentText = nm[1];
      }
    }
    if (!shareText && /share|chia\s*sẻ/i.test(low)) {
      shareText = pickCount(aria) || shareText;
      if (!shareText) {
        const nm = aria.match(/([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)/);
        if (nm) shareText = nm[1];
      }
    }
  }

  // Hàng icon+số (dark UI): lấy cụm 2–3 số thuần đứng cạnh nhau gần cuối article
  // Chỉ khi chưa có reaction — và loại số relative time (đi kèm w/h/d/phút…)
  if (!reactionText || !commentText || !shareText) {
    const compact = (node.innerText || '')
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    // Tìm dòng kiểu "92\n9\n4" hoặc "92 9 4" không kèm chữ thời gian
    for (let i = 0; i < compact.length; i++) {
      const line = compact[i];
      if (/^\d+[whdmy]$/i.test(line) || /^(phút|giờ|ngày|tuần|tháng|năm)\b/i.test(line)) continue;
      const trio = [];
      for (let j = i; j < Math.min(i + 5, compact.length); j++) {
        const lj = compact[j];
        if (/^([\d]+(?:[.,][\d]+)*\s*[KNM]?)$/i.test(lj) && !/^[whdmy]/i.test(lj)) {
          trio.push(lj);
          if (trio.length === 3) break;
        } else if (trio.length) {
          break;
        }
      }
      if (trio.length >= 2) {
        if (!reactionText) reactionText = trio[0];
        if (!commentText && trio[1]) commentText = trio[1];
        if (!shareText && trio[2]) shareText = trio[2];
        break;
      }
    }
  }

  // Toolbar: các span/ số cạnh nút — quét role=button có số thuần
  if (!reactionText || !commentText || !shareText) {
    const buttons = Array.from(node.querySelectorAll('[role="button"], a[role="link"]'));
    for (const btn of buttons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const txt = (btn.innerText || '').replace(/\s+/g, ' ').trim();
      // Chỉ nhận nút có số ngắn kiểu "92" / "1,2K"
      const numOnly = txt.match(/^([\d]+(?:[.,][\d]+)*\s*[KNM]?)$/i);
      const fromAria = pickCount(btn.getAttribute('aria-label') || '');
      if (!reactionText && (/react|bày\s*tỏ|(?:^|\b)like\b/i.test(aria)) && !/comment|share|chia/i.test(aria)) {
        reactionText = fromAria || (numOnly ? numOnly[1] : null) || reactionText;
      }
      if (!commentText && /comment|bình\s*luận/i.test(aria)) {
        commentText = fromAria || (numOnly ? numOnly[1] : null) || commentText;
      }
      if (!shareText && /share|chia\s*sẻ/i.test(aria)) {
        shareText = fromAria || (numOnly ? numOnly[1] : null) || shareText;
      }
    }
  }

  // Fallback text có nhãn rõ — KHÔNG match số trần / relative time (4w, 2h…)
  if (!reactionText) {
    const m = allText.match(
      /([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)\s*(?:reactions?|people\s+reacted|người\s*(?:đã\s*)?bày\s*tỏ|All\s*reactions?)\b/i
    );
    if (m) reactionText = m[1];
  }
  if (!commentText) {
    const m = allText.match(/([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)\s*(?:comments?|bình\s*luận)\b/i);
    if (m) commentText = m[1];
  }
  if (!shareText) {
    const m = allText.match(/([\d]+(?:[.,][\d]+)*(?:\s*[KNM])?)\s*(?:shares?|lượt\s*chia\s*sẻ)\b/i);
    if (m) shareText = m[1];
  }

  out.push({
    post_url: postUrl.split('#')[0],
    content,
    post_type: postType,
    published_text: publishedText,
    published_utime: publishedUtime,
    published_iso: publishedIso,
    reaction_text: reactionText,
    comment_text: commentText,
    share_text: shareText,
    is_pinned: /đã ghim|pinned/i.test(allText.slice(0, 200)),
  });
  if (out.length >= 40) break;
}
return out;
"""


def post_type_matches(post_type: Optional[str], allowed: List[str]) -> bool:
    if not allowed or "all" in allowed:
        return True
    pt = (post_type or "text").lower()
    return pt in {a.lower() for a in allowed}


def date_in_range(
    published_at: Optional[str],
    date_from: Optional[str],
    date_to: Optional[str],
) -> bool:
    """Nếu không parse được ngày → vẫn giữ (caller quyết định lưu)."""
    if not published_at:
        return True
    if date_from and published_at < date_from:
        return False
    if date_to and published_at > date_to:
        return False
    return True


def _sanitize_engagement_text(text: Optional[str]) -> Optional[str]:
    """Loại token thời gian tương đối (4w, 2h…) — không phải số reaction."""
    if not text:
        return None
    t = str(text).strip()
    if not t:
        return None
    if re.fullmatch(
        r"\d+\s*(?:w|h|d|m|y|mo|min|mins|phút|giờ|ngày|tuần|tháng|năm)\b",
        t,
        flags=re.I,
    ):
        return None
    if re.fullmatch(r"\d+[whdmy]\b", t, flags=re.I):
        return None
    return t


def extract_posts_batch(driver) -> List[Dict[str, Any]]:
    try:
        raw = driver.execute_script(_EXTRACT_POSTS_JS) or []
    except Exception as exc:
        logger.debug(f"[POST_SCAN] extract: {exc}")
        return []
    out = []
    for r in raw:
        url = (r.get("post_url") or "").strip()
        if not url:
            continue
        key = normalize_post_key(url)
        if not key:
            continue
        pub_text = r.get("published_text")
        utime_raw = r.get("published_utime")
        try:
            utime_i = int(utime_raw) if utime_raw is not None else None
        except (TypeError, ValueError):
            utime_i = None
        pub_at, pub_src = parse_facebook_published_at(
            pub_text,
            utime=utime_i,
            iso_attr=r.get("published_iso"),
        )
        react_t = _sanitize_engagement_text(r.get("reaction_text"))
        comment_t = _sanitize_engagement_text(r.get("comment_text"))
        share_t = _sanitize_engagement_text(r.get("share_text"))
        out.append(
            {
                "post_key": key,
                "post_url": url,
                "content": r.get("content"),
                "post_type": r.get("post_type") or "text",
                "published_text": pub_text,  # thô — không ghi đè bằng giá trị đoán
                "published_at": pub_at,
                "date_source": pub_src,
                "date_unparsed": pub_src == "unparsed",
                "reaction_count": parse_compact_count(react_t) or 0,
                "comment_count": parse_compact_count(comment_t) or 0,
                "share_count": parse_compact_count(share_t) or 0,
                "is_pinned": bool(r.get("is_pinned")),
            }
        )
    return out


def upsert_posts_batch(
    owner_key: str,
    page_key: str,
    items: List[Dict[str, Any]],
    session_id: int,
) -> Tuple[int, int]:
    inserted = 0
    updated = 0
    for row in items:
        post_key = (row.get("post_key") or "").strip()
        post_url = (row.get("post_url") or "").strip()
        if not post_key or not post_url:
            continue
        try:
            res = db.fetch_one(
                """
                INSERT INTO scanned_posts (
                    owner_key, page_key, post_key, post_url, published_at, published_text,
                    content, post_type, reaction_count, comment_count, share_count,
                    is_pinned, first_session_id, last_session_id, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                )
                ON CONFLICT (owner_key, page_key, post_key) DO UPDATE
                SET post_url = EXCLUDED.post_url,
                    content = COALESCE(EXCLUDED.content, scanned_posts.content),
                    post_type = COALESCE(EXCLUDED.post_type, scanned_posts.post_type),
                    reaction_count = GREATEST(COALESCE(scanned_posts.reaction_count,0), EXCLUDED.reaction_count),
                    comment_count = GREATEST(COALESCE(scanned_posts.comment_count,0), EXCLUDED.comment_count),
                    share_count = GREATEST(COALESCE(scanned_posts.share_count,0), EXCLUDED.share_count),
                    published_at = COALESCE(EXCLUDED.published_at, scanned_posts.published_at),
                    published_text = COALESCE(EXCLUDED.published_text, scanned_posts.published_text),
                    last_session_id = EXCLUDED.last_session_id,
                    updated_at = NOW()
                RETURNING (xmax = 0) AS is_new
                """,
                (
                    owner_key,
                    page_key,
                    post_key,
                    post_url,
                    row.get("published_at"),
                    row.get("published_text"),
                    row.get("content"),
                    row.get("post_type"),
                    int(row.get("reaction_count") or 0),
                    int(row.get("comment_count") or 0),
                    int(row.get("share_count") or 0),
                    bool(row.get("is_pinned")),
                    session_id,
                    session_id,
                ),
            )
            if res and res.get("is_new"):
                inserted += 1
            else:
                updated += 1
        except Exception as exc:
            logger.debug(f"[POST_SCAN] upsert: {exc}")
            try:
                db.execute(
                    """
                    INSERT INTO scanned_posts (
                        owner_key, page_key, post_key, post_url, published_text,
                        content, post_type, reaction_count, comment_count, share_count,
                        is_pinned, first_session_id, last_session_id, created_at, updated_at
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                    ON CONFLICT (owner_key, page_key, post_key) DO UPDATE
                    SET last_session_id = EXCLUDED.last_session_id,
                        content = COALESCE(EXCLUDED.content, scanned_posts.content),
                        updated_at = NOW()
                    """,
                    (
                        owner_key,
                        page_key,
                        post_key,
                        post_url,
                        row.get("published_text"),
                        row.get("content"),
                        row.get("post_type"),
                        int(row.get("reaction_count") or 0),
                        int(row.get("comment_count") or 0),
                        int(row.get("share_count") or 0),
                        bool(row.get("is_pinned")),
                        session_id,
                        session_id,
                    ),
                )
                updated += 1
            except Exception as exc2:
                logger.warning(f"[POST_SCAN] upsert fallback: {exc2}")
    return inserted, updated


def existing_post_keys(owner_key: str, page_key: str) -> Set[str]:
    rows = db.fetch_all(
        """
        SELECT post_key FROM scanned_posts
        WHERE owner_key = %s AND page_key = %s
        """,
        (owner_key, page_key),
    )
    return {str(r["post_key"]) for r in (rows or []) if r.get("post_key")}


def update_session_progress(session_id: int, total_seen: int, total_unique: int, batches: int) -> None:
    try:
        db.execute(
            """
            UPDATE page_scan_sessions
            SET total_seen = %s, total_unique = %s, batches_count = %s,
                total_posts_scanned = %s, total_posts_matched = %s
            WHERE id = %s AND status IN ('RUNNING', 'PAUSED')
            """,
            (total_seen, total_unique, batches, total_seen, total_unique, session_id),
        )
    except Exception:
        pass


def run_post_scan_flow(
    page_keys: List[str],
    account_uid: Optional[str] = None,
    owner_key: str = "system",
    session_id: Optional[int] = None,
    max_posts_per_page: int = 50,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    post_types: Optional[List[str]] = None,
    idle_timeout_s: float = 90.0,
    skip_existing: bool = True,
    page_delay_s: float = 2.0,
    scroll_delay_s: float = 1.5,
    keep_browser: bool = False,
    headless: bool = False,
    allow_direct_fallback: bool = True,
    max_pages_per_acc: int = DEFAULT_PAGES_PER_ACC_DAY,
) -> Dict[str, Any]:
    page_keys = [str(k).strip() for k in (page_keys or []) if str(k).strip()]
    if not page_keys:
        raise ValueError("Cần ít nhất 1 page_key")
    allowed_types = post_types or ["all"]

    account = get_scraping_account(account_uid, owner_key=owner_key)
    if not account:
        raise RuntimeError("Không tìm thấy tài khoản Facebook hợp lệ")

    target_uid = str(account.get("uid") or "").strip()
    owner = account.get("user_id") or owner_key
    cookie_str = account.get("cookie") or ""
    proxy = account.get("proxy")

    if session_id is None:
        session_id = create_scan_session(
            owner_key=owner_key,
            keyword=f"POSTS · {len(page_keys)} page",
            account_uid=target_uid,
            source_type="PARSE",
            max_results=max_posts_per_page * len(page_keys),
            settings={"job": "POST_SCAN", "page_keys": page_keys, "automation": True},
        )

    with _ACTIVE_SESSIONS_LOCK:
        if session_id not in _ACTIVE_STOP_EVENTS:
            _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        if session_id not in _ACTIVE_PAUSE_EVENTS:
            _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()
        stop_event = _ACTIVE_STOP_EVENTS[session_id]

    try_acquire_account_job(target_uid, session_id, "POST_SCAN")

    stop_reason = "COMPLETED"
    error_message: Optional[str] = None
    total_seen = 0
    total_unique = 0
    total_dup = 0
    batches = 0
    start_time = time.time()
    session_keys: Set[str] = set()
    final_status = "COMPLETED"

    lock = None
    acquired_lock = False

    try:
        from core.browser import human_sleep

        try:
            driver, _c, lock, acquired_lock = acquire_browser(
                target_uid=target_uid,
                owner=owner,
                proxy=proxy,
                cookie_str=cookie_str,
                headless=headless,
                allow_direct_fallback=allow_direct_fallback,
            )
        except RuntimeError as lock_err:
            stop_reason = "CHECKPOINT"
            error_message = str(lock_err)
            finalize_scan_session(
                session_id, "PARTIAL", stop_reason, 0, 0, 0, 0, 0, 0, error_message
            )
            return {"session_id": session_id, "stop_reason": stop_reason, "count": 0}

        append_session_log(
            session_id,
            f"POST_SCAN · pages={len(page_keys)} · max/page={max_posts_per_page} · types={allowed_types}",
            "warn",
        )

        used_today = get_account_usage_today(target_uid, "POST_SCAN")
        pages_quota_left = max(0, int(max_pages_per_acc) - used_today)
        idle_timeout_s = max(5.0, float(idle_timeout_s))

        for idx, page_key in enumerate(page_keys):
            if stop_event.is_set():
                stop_reason = "USER_STOPPED"
                break
            if _wait_if_paused(session_id, stop_event):
                stop_reason = "USER_STOPPED"
                break
            if pages_quota_left <= 0:
                append_session_log(session_id, "Quota POST_SCAN Page/acc hôm nay đã hết", "warn")
                stop_reason = "TIMEOUT"
                break

            page_url, page_name = resolve_page_url(owner_key, page_key)
            append_session_log(
                session_id,
                f"[{idx + 1}/{len(page_keys)}] Feed Page {page_name or page_key}",
                "info",
            )
            try:
                driver.get(page_url)
                time.sleep(2.0)
            except Exception as exc:
                append_session_log(session_id, f"Soft-fail open {page_key}: {exc}", "warn")
                bump_account_usage(target_uid, "POST_SCAN", 1)
                pages_quota_left -= 1
                continue

            # Checkpoint?
            try:
                cur = (driver.current_url or "").lower()
                if "/checkpoint/" in cur or "/login" in cur:
                    stop_reason = "CHECKPOINT"
                    error_message = "Checkpoint/login"
                    break
            except Exception:
                pass

            known = existing_post_keys(owner_key, page_key) if skip_existing else set()
            page_got = 0
            last_new_at = time.time()
            stagnant = 0

            while page_got < max_posts_per_page:
                if stop_event.is_set():
                    stop_reason = "USER_STOPPED"
                    break
                if _wait_if_paused(session_id, stop_event):
                    stop_reason = "USER_STOPPED"
                    break

                batch = extract_posts_batch(driver)
                new_items = []
                for item in batch:
                    total_seen += 1
                    pk = item["post_key"]
                    if pk in session_keys or pk in known:
                        total_dup += 1
                        continue
                    if not post_type_matches(item.get("post_type"), allowed_types):
                        continue
                    # Lọc ngày chỉ khi đã parse; chưa parse → vẫn lưu + đánh dấu
                    if item.get("published_at") and not date_in_range(
                        item["published_at"], date_from, date_to
                    ):
                        continue
                    if item.get("date_unparsed"):
                        append_session_log(
                            session_id,
                            f"date_unparsed · {pk} · raw={item.get('published_text')}",
                            "info",
                        )
                    new_items.append(item)
                    session_keys.add(pk)
                    known.add(pk)

                if new_items:
                    # truncate to remaining quota per page
                    room = max_posts_per_page - page_got
                    new_items = new_items[:room]
                    ins, upd = upsert_posts_batch(owner_key, page_key, new_items, session_id)
                    page_got += len(new_items)
                    total_unique = len(session_keys)
                    batches += 1
                    last_new_at = time.time()
                    stagnant = 0
                    update_session_progress(session_id, total_seen, total_unique, batches)
                    append_session_log(
                        session_id,
                        f"{page_key}: +{len(new_items)} posts (ins={ins}/upd={upd}) · page={page_got}",
                        "success",
                    )
                else:
                    stagnant += 1

                if time.time() - last_new_at >= idle_timeout_s:
                    append_session_log(session_id, f"{page_key}: idle — hết bài mới", "info")
                    break
                if stagnant >= 8:
                    append_session_log(session_id, f"{page_key}: list_exhausted", "info")
                    break

                try:
                    driver.execute_script("window.scrollBy(0, window.innerHeight * 0.85);")
                except Exception:
                    pass
                time.sleep(max(0.3, float(scroll_delay_s)))
                try:
                    human_sleep(0.2, 0.5)
                except Exception:
                    pass

            bump_account_usage(target_uid, "POST_SCAN", 1)
            pages_quota_left -= 1

            if stop_reason in ("USER_STOPPED", "CHECKPOINT"):
                break
            if page_delay_s > 0 and idx < len(page_keys) - 1:
                time.sleep(page_delay_s)
        else:
            if total_unique == 0:
                stop_reason = "NO_NEW_RESULTS"

    except Exception as exc:
        logger.exception(f"[POST_SCAN] #{session_id}: {exc}")
        stop_reason = "ERROR"
        error_message = str(exc)[:500]
        append_session_log(session_id, f"Lỗi: {error_message}", "error")
    finally:
        duration = int(time.time() - start_time)
        final_status = {
            "USER_STOPPED": "STOPPED",
            "CHECKPOINT": "PARTIAL",
            "ERROR": "FAILED",
            "TIMEOUT": "PARTIAL",
            "NO_NEW_RESULTS": "COMPLETED",
            "COMPLETED": "COMPLETED",
            "TARGET_REACHED": "COMPLETED",
        }.get(stop_reason, "COMPLETED")
        finalize_scan_session(
            session_id,
            final_status,
            stop_reason,
            total_seen,
            total_unique,
            total_dup,
            0,
            batches,
            duration,
            error_message,
        )
        append_session_log(
            session_id,
            f"Kết thúc POST_SCAN · {final_status}/{stop_reason} · posts={total_unique}",
            "success" if final_status == "COMPLETED" else "warn",
        )
        release_browser(stop_reason, keep_browser, acquired_lock, lock, target_uid)
        release_account_job(target_uid, session_id)
        with _ACTIVE_SESSIONS_LOCK:
            _ACTIVE_STOP_EVENTS.pop(session_id, None)
            _ACTIVE_PAUSE_EVENTS.pop(session_id, None)

    return {
        "session_id": session_id,
        "count": total_unique,
        "stop_reason": stop_reason,
        "status": final_status,
    }


def start_post_scan_background(
    page_keys: List[str],
    account_uid: Optional[str] = None,
    owner_key: str = "system",
    max_posts_per_page: int = 50,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    post_types: Optional[List[str]] = None,
    idle_timeout_s: float = 90.0,
    skip_existing: bool = True,
    page_delay_s: float = 2.0,
    scroll_delay_s: float = 1.5,
    keep_browser: bool = False,
    headless: bool = False,
    allow_direct_fallback: bool = True,
    source_list_id: Optional[str] = None,
    max_pages_per_acc: int = DEFAULT_PAGES_PER_ACC_DAY,
) -> int:
    from .browser_session import get_active_job_for_account

    page_keys = [str(k).strip() for k in (page_keys or []) if str(k).strip()]
    if not page_keys:
        raise ValueError("Cần ít nhất 1 page_key")

    account = get_scraping_account(account_uid, owner_key=owner_key)
    if not account:
        raise RuntimeError("Không tìm thấy tài khoản Facebook hợp lệ")
    target_uid = str(account.get("uid") or "").strip()

    busy = get_active_job_for_account(target_uid)
    if busy:
        raise AccountBusyError(
            target_uid, int(busy["session_id"]), str(busy.get("job_type") or "")
        )

    settings = {
        "job": "POST_SCAN",
        "page_keys": page_keys,
        "max_posts_per_page": max_posts_per_page,
        "date_from": date_from,
        "date_to": date_to,
        "post_types": post_types or ["all"],
        "idle_timeout_s": idle_timeout_s,
        "skip_existing": skip_existing,
        "page_delay_s": page_delay_s,
        "scroll_delay_s": scroll_delay_s,
        "keep_browser": keep_browser,
        "source_list_id": source_list_id,
        "automation": True,
        "max_pages_per_acc": max_pages_per_acc,
    }
    session_id = create_scan_session(
        owner_key=owner_key,
        keyword=f"POSTS · {len(page_keys)} page",
        account_uid=target_uid,
        source_type="PARSE",
        max_results=max_posts_per_page * len(page_keys),
        settings=settings,
    )
    try:
        db.execute(
            "UPDATE page_scan_sessions SET job_type = %s WHERE id = %s",
            ("POST_SCAN", session_id),
        )
    except Exception:
        pass

    with _ACTIVE_SESSIONS_LOCK:
        _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()

    try:
        try_acquire_account_job(target_uid, session_id, "POST_SCAN")
    except AccountBusyError:
        try:
            finalize_scan_session(
                session_id,
                "FAILED",
                "ERROR",
                0,
                0,
                0,
                0,
                0,
                0,
                "BUSY race — acc vừa bị chiếm",
            )
        except Exception:
            pass
        with _ACTIVE_SESSIONS_LOCK:
            _ACTIVE_STOP_EVENTS.pop(session_id, None)
            _ACTIVE_PAUSE_EVENTS.pop(session_id, None)
        raise

    def _runner():
        try:
            run_post_scan_flow(
                page_keys=page_keys,
                account_uid=target_uid,
                owner_key=owner_key,
                session_id=session_id,
                max_posts_per_page=max_posts_per_page,
                date_from=date_from,
                date_to=date_to,
                post_types=post_types,
                idle_timeout_s=idle_timeout_s,
                skip_existing=skip_existing,
                page_delay_s=page_delay_s,
                scroll_delay_s=scroll_delay_s,
                keep_browser=keep_browser,
                headless=headless,
                allow_direct_fallback=allow_direct_fallback,
                max_pages_per_acc=max_pages_per_acc,
            )
        except Exception as exc:
            logger.exception(f"[POST_SCAN] background #{session_id}: {exc}")
            try:
                finalize_scan_session(
                    session_id, "FAILED", "ERROR", 0, 0, 0, 0, 0, 0, str(exc)[:500]
                )
            except Exception:
                pass
            release_account_job(target_uid, session_id)

    threading.Thread(
        target=_runner,
        daemon=True,
        name=f"page_posts_worker_{session_id}",
    ).start()
    return session_id
