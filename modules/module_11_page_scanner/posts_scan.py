"""
Quét bài viết trên feed Page (job_type=POST_SCAN).
post_key chuẩn hóa; số reaction/comment/share dùng parse_compact_count;
ngày: published_text thô + published_at parse (nullable).
"""
from __future__ import annotations

import logging
import random
import re
import threading
import time
from typing import Any, Dict, List, Optional, Set, Tuple

from core.database.connection import db
from .browser_session import (
    AccountBusyError,
    AccountRotation,
    bump_account_usage,
    get_account_usage_today,
    order_accounts_free_first,
    release_account_job,
    try_acquire_account_job,
)
from .facebook_time import parse_facebook_published_at, try_parse_published_at
from .followers_scan import resolve_page_url
from .page_source import normalize_post_key, parse_compact_count
from .scanner import (
    _ACTIVE_PAUSE_EVENTS,
    _ACTIVE_SESSIONS_LOCK,
    _ACTIVE_STOP_EVENTS,
    ScanStopped,
    _wait_if_paused,
    _wait_if_paused_timed,
    append_session_log,
    create_scan_session,
    finalize_scan_session,
    pick_page_delay,
    resolve_scan_accounts,
    sleep_page_delay,
)

logger = logging.getLogger(__name__)

DEFAULT_PAGES_PER_ACC_DAY = 50

_EXTRACT_POSTS_JS = r"""
// arguments[0] = selector bài cần đọc (mặc định: mọi bài trên trang), arguments[1] = tối đa số bài trả về (mặc định 40).
// Có selector riêng thì không dò ngược sang mọi <div> (tránh đọc lại bài đã xử lý).
const customSel = arguments[0] || '';
const LIMIT = arguments[1] || 40;
const out = [];
const seen = new Set();
const articles = Array.from(document.querySelectorAll(customSel || '[role="article"], div[data-pagelet*="FeedUnit"]'));
const nodes = (articles.length || customSel) ? articles : Array.from(document.querySelectorAll('div')).filter(d => {
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

  // Caption: gom ứng viên để Python chọn (pick_caption). Không lấy "3 div đầu tiên" — hay dính tên Page / header.
  const textCandidates = [];
  const seenText = new Set();
  const pushCand = (text, source) => {
    const t = (text || '').replace(/ /g, ' ').trim();
    if (!t || t.length < 3 || seenText.has(t)) return;
    seenText.add(t);
    textCandidates.push({ text: t.slice(0, 5000), source });
  };
  for (const m of Array.from(node.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]'))) {
    pushCand(m.innerText, 'message');
  }
  const nestedArticles = Array.from(node.querySelectorAll('[role="article"]')).filter((a) => a !== node);
  for (const b of Array.from(node.querySelectorAll('div[dir="auto"], span[dir="auto"]'))) {
    if (textCandidates.length >= 15) break;
    // Header (tên Page, thời gian), nút, thanh tương tác, bình luận → không phải caption
    if (b.closest('h1, h2, h3, h4, strong, a, [role="button"], [role="toolbar"], ul')) continue;
    if (nestedArticles.some((a) => a.contains(b))) continue;
    // Chỉ lấy khối ngoài cùng, tránh trùng cha/con
    const parentBlock = b.parentElement && b.parentElement.closest('div[dir="auto"], span[dir="auto"]');
    if (parentBlock && node.contains(parentBlock)) continue;
    pushCand(b.innerText, 'block');
  }
  const hasText = textCandidates.length > 0;

  let postType = 'text';
  if (/\/(reel|reels)\b/i.test(postUrl) || node.querySelector('video')) postType = 'video';
  else if (/\/(photo|photos)\b/i.test(postUrl) || node.querySelector('img[src*="scontent"]')) {
    if (postType !== 'video') postType = node.querySelector('video') ? 'video' : (hasText ? 'text' : 'photo');
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
    text_candidates: textCandidates,
    post_type: postType,
    published_text: publishedText,
    published_utime: publishedUtime,
    published_iso: publishedIso,
    reaction_text: reactionText,
    comment_text: commentText,
    share_text: shareText,
    is_pinned: /đã ghim|pinned/i.test(allText.slice(0, 200)),
  });
  if (out.length >= LIMIT) break;
}
return out;
"""


# Bấm "Xem thêm" để mở caption bị thu gọn — chỉ mở rộng chữ trên giao diện (không like/follow/bình luận).
# Bỏ qua nút là link có href (bấm sẽ chuyển trang). arguments[0] = selector vùng được bấm.
_EXPAND_SEE_MORE_JS = r"""
const scopes = Array.from(document.querySelectorAll(arguments[0] || '[role="article"]'));
const label = /^(xem thêm|see more)$/i;
const done = new Set();
let clicked = 0;
for (const scope of scopes) {
  for (const el of Array.from(scope.querySelectorAll('[role="button"], span, div[tabindex="0"]'))) {
    if (clicked >= 25) return clicked;
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!label.test(t)) continue;
    const target = el.closest('[role="button"]') || el;
    if (done.has(target) || target.closest('a[href]')) continue;
    done.add(target);
    const r = target.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    try { target.click(); clicked++; } catch (e) {}
  }
}
return clicked;
"""

# Trang reel / video: meta og + các khối chữ của reel ĐANG hiện (FB tải sẵn reel kế tiếp trong DOM)
_READ_REEL_CAPTION_JS = r"""
const meta = (p) => {
  const m = document.querySelector('meta[property="' + p + '"]');
  return m ? (m.getAttribute('content') || '') : '';
};
const out = [];
const push = (text, source) => {
  const t = (text || '').replace(/ /g, ' ').trim();
  if (t && t.length >= 3) out.push({ text: t.slice(0, 5000), source });
};
push(meta('og:description'), 'meta');
push(meta('og:title'), 'meta');
const visible = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
};
const freeText = (b) => !b.closest('h1, h2, h3, h4, strong, a, [role="button"], ul');
const hasTextBlock = (n) => Array.from(n.querySelectorAll('div[dir="auto"], span[dir="auto"]'))
  .some((b) => freeText(b) && (b.innerText || '').trim().length >= 10);
let scope = null;
const vids = Array.from(document.querySelectorAll('video')).filter(visible);
if (vids.length) {
  let n = vids[0].parentElement;
  for (let i = 0; i < 15 && n; i++, n = n.parentElement) {
    if (hasTextBlock(n)) { scope = n; break; }
  }
}
if (!scope) scope = document.querySelector('[role="main"]') || document.body;
const nested = Array.from(scope.querySelectorAll('[role="article"]'));
for (const b of Array.from(scope.querySelectorAll('div[dir="auto"], span[dir="auto"]'))) {
  if (out.length >= 25) break;
  if (!freeText(b) || nested.some((a) => a.contains(b)) || !visible(b)) continue;
  const parentBlock = b.parentElement && b.parentElement.closest('div[dir="auto"], span[dir="auto"]');
  if (parentBlock && scope.contains(parentBlock)) continue;
  push(b.innerText, 'block');
}
return {
  candidates: out,
  url: location.href,
  title: document.title,
  scope_text: (scope.innerText || '').slice(0, 3000),
};
"""

_CONTENT_READY_JS = r"""
const m = document.querySelector('[role="main"]');
return !!document.querySelector('video') || !!(m && (m.innerText || '').trim().length > 30);
"""

CAPTION_MAX_LEN = 5000
# Reel / video có caption ngắn hơn ngưỡng này → mở bài để lấy caption đầy đủ
SHORT_CAPTION_LEN = 40

_SEE_MORE_TAIL_RE = re.compile(r"(?:…|\.{3})?\s*(?:xem thêm|see more|ẩn bớt|see less)\s*$", re.IGNORECASE)
_CAPTION_NOISE_RE = re.compile(
    r"^(?:xem thêm|see more|ẩn bớt|see less|theo dõi|follow|thích|like|bình luận|comment|chia sẻ|share|"
    r"gửi|send|reels?|facebook|watch|video|âm thanh gốc.*|original audio.*)$",
    re.IGNORECASE,
)
# og:description kiểu "1,2K views, 30 reactions | Facebook Watch Videos from X: <caption>"
_META_PREFIX_RES = (
    re.compile(r"^.*?(?:facebook watch videos from|video từ|reels? (?:from|của))[^:]{0,100}:\s*", re.IGNORECASE),
    re.compile(
        r"^(?:[\d.,]+\s*[KkMmNn]?\s*(?:views?|lượt xem|reactions?|likes?|lượt thích|comments?|bình luận|shares?|"
        r"lượt chia sẻ)[,·\s]*)+[|:·-]?\s*",
        re.IGNORECASE,
    ),
)
_META_SUFFIX_RE = re.compile(r"\s*[|\-–]\s*facebook\s*$", re.IGNORECASE)


def clean_caption(text: Optional[str], source: str = "block") -> Optional[str]:
    """Gom khoảng trắng / dòng trống, bỏ đuôi 'Xem thêm', cắt CAPTION_MAX_LEN."""
    if not text:
        return None
    lines: List[str] = []
    for line in str(text).replace(" ", " ").splitlines():
        line = re.sub(r"[ \t]+", " ", line).strip()
        if not line and (not lines or not lines[-1]):
            continue
        lines.append(line)
    out = "\n".join(lines).strip()
    out = _SEE_MORE_TAIL_RE.sub("", out).strip()
    if source == "meta":
        for pattern in _META_PREFIX_RES:
            out = pattern.sub("", out, count=1).strip()
        out = _META_SUFFIX_RE.sub("", out).strip()
    return out[:CAPTION_MAX_LEN] or None


def pick_caption(candidates: Optional[List[Any]], exclude: Tuple[str, ...] = ()) -> Optional[str]:
    """
    Chọn caption từ ứng viên {text, source}:
    - Có khung message của bài → lấy khung đó (dài nhất).
    - Không có → ứng viên dài nhất (block / meta), bỏ tên Page và nhãn giao diện.
    """
    excluded = {str(e).strip().lower() for e in exclude if e and str(e).strip()}
    best_message: Optional[str] = None
    best_other: Optional[str] = None
    for cand in candidates or []:
        if isinstance(cand, dict):
            text, source = cand.get("text"), str(cand.get("source") or "block")
        else:
            text, source = cand, "block"
        cleaned = clean_caption(text, source)
        if not cleaned or len(cleaned) < 3:
            continue
        if cleaned.lower() in excluded or _CAPTION_NOISE_RE.match(cleaned):
            continue
        if source == "message":
            if best_message is None or len(cleaned) > len(best_message):
                best_message = cleaned
        elif best_other is None or len(cleaned) > len(best_other):
            best_other = cleaned
    return best_message or best_other


def needs_full_caption(post: Dict[str, Any]) -> bool:
    """Reel / video mà caption rỗng hoặc quá ngắn → cần mở bài để đọc đủ."""
    url = str(post.get("post_url") or "")
    is_video = bool(re.search(r"/(?:reels?|videos?|watch)\b", url, re.IGNORECASE)) or \
        str(post.get("post_type") or "").lower() == "video"
    return is_video and len((post.get("content") or "").strip()) < SHORT_CAPTION_LEN


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


def expand_see_more(driver, scope_selector: str = '[role="article"]') -> int:
    """Bấm 'Xem thêm' trong vùng chỉ định. Nếu lỡ chuyển trang thì quay lại."""
    try:
        before = driver.current_url
    except Exception:
        before = None
    try:
        clicked = int(driver.execute_script(_EXPAND_SEE_MORE_JS, scope_selector) or 0)
    except Exception as exc:
        logger.debug(f"[POST_SCAN] expand see more: {exc}")
        return 0
    if clicked:
        time.sleep(0.5)
        try:
            if before and driver.current_url != before:
                driver.back()
                time.sleep(1.5)
        except Exception:
            pass
    return clicked


def extract_posts_batch(
    driver,
    exclude_names: Tuple[str, ...] = (),
    selector: Optional[str] = None,
    limit: int = 40,
) -> List[Dict[str, Any]]:
    """selector: chỉ đọc các bài khớp (mặc định mọi bài trên trang); limit: tối đa số bài trả về."""
    if selector:
        expand_see_more(driver, selector)
    else:
        expand_see_more(driver)
    try:
        raw = driver.execute_script(_EXTRACT_POSTS_JS, selector or "", int(limit or 40)) or []
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
                "content": pick_caption(r.get("text_candidates"), exclude=exclude_names),
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


# Quét lại: chỉ thay nội dung khi bản mới dài hơn (caption đầy đủ thắng bản bị cắt / sai như "BUILDER")
_LONGER_CONTENT_SQL = (
    "CASE WHEN EXCLUDED.content IS NOT NULL"
    " AND LENGTH(EXCLUDED.content) > LENGTH(COALESCE(scanned_posts.content, ''))"
    " THEN EXCLUDED.content ELSE scanned_posts.content END"
)


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
                f"""
                INSERT INTO scanned_posts (
                    owner_key, page_key, post_key, post_url, published_at, published_text,
                    content, post_type, reaction_count, comment_count, share_count,
                    is_pinned, first_session_id, last_session_id, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                )
                ON CONFLICT (owner_key, page_key, post_key) DO UPDATE
                SET post_url = EXCLUDED.post_url,
                    content = {_LONGER_CONTENT_SQL},
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
                    f"""
                    INSERT INTO scanned_posts (
                        owner_key, page_key, post_key, post_url, published_text,
                        content, post_type, reaction_count, comment_count, share_count,
                        is_pinned, first_session_id, last_session_id, created_at, updated_at
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                    ON CONFLICT (owner_key, page_key, post_key) DO UPDATE
                    SET last_session_id = EXCLUDED.last_session_id,
                        content = {_LONGER_CONTENT_SQL},
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


def _is_checkpoint_url(driver) -> bool:
    try:
        cur = (driver.current_url or "").lower()
    except Exception:
        return False
    return "/checkpoint/" in cur or "/login" in cur


def fetch_full_caption(
    driver,
    url: str,
    stop_event: threading.Event,
    exclude_names: Tuple[str, ...] = (),
) -> Tuple[Optional[str], Dict[str, Any]]:
    """Mở trang reel / video, bấm 'Xem thêm', đọc caption. Trả (caption, dữ liệu thô để debug)."""
    try:
        driver.get(url)
    except Exception as exc:
        # Timeout tải trang: DOM thường đã có nội dung — vẫn đọc tiếp
        logger.debug(f"[POST_SCAN] open {url}: {exc}")
    deadline = time.time() + 6.0
    while time.time() < deadline and not stop_event.is_set():
        try:
            if driver.execute_script(_CONTENT_READY_JS):
                break
        except Exception:
            pass
        time.sleep(0.4)
    if _is_checkpoint_url(driver):
        return None, {"checkpoint": True, "url": url}
    stop_event.wait(1.0)  # phần caption tải sau khung video
    expand_see_more(driver, '[role="main"], [role="dialog"]')
    try:
        raw = driver.execute_script(_READ_REEL_CAPTION_JS) or {}
    except Exception as exc:
        raw = {"error": str(exc)[:300]}
    raw["requested_url"] = url
    return pick_caption(raw.get("candidates"), exclude=exclude_names), raw


def dump_caption_debug(post_key: str, raw: Dict[str, Any], caption: Optional[str]) -> Optional[str]:
    """Không đọc được caption → ghi text thô ra logs/post_caption_debug/ để chỉnh selector theo DOM thật."""
    try:
        from config.paths import runtime_root

        folder = runtime_root() / "logs" / "post_caption_debug"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{re.sub(r'[^A-Za-z0-9._-]+', '_', post_key)[:100] or 'post'}.txt"
        parts = [
            f"post_key: {post_key}",
            f"requested_url: {raw.get('requested_url')}",
            f"current_url: {raw.get('url')}",
            f"title: {raw.get('title')}",
            f"picked_caption: {caption!r}",
            f"error: {raw.get('error')}",
            "\n===== CANDIDATES =====",
        ]
        for cand in raw.get("candidates") or []:
            parts.append(f"--- [{cand.get('source')}]\n{cand.get('text')}")
        parts.append("\n===== SCOPE TEXT =====\n" + str(raw.get("scope_text") or ""))
        path.write_text("\n".join(parts), encoding="utf-8")
        return str(path)
    except Exception as exc:
        logger.debug(f"[POST_SCAN] dump caption {post_key}: {exc}")
        return None


def fill_missing_captions(
    driver,
    owner_key: str,
    page_key: str,
    post_keys: Set[str],
    session_id: int,
    stop_event: threading.Event,
    exclude_names: Tuple[str, ...] = (),
    limit: int = 50,
) -> Dict[str, Any]:
    """
    Reel / video thấy trong lượt quét Page này (cả bài đã có trong kho) mà caption rỗng / quá ngắn
    → mở từng bài lấy caption đầy đủ. Bài cũ lưu sai (vd chỉ "BUILDER") cũng được sửa khi quét lại.
    """
    result = {"todo": 0, "checked": 0, "updated": 0, "stopped": False, "checkpoint": False}
    if not post_keys:
        return result
    rows = db.fetch_all(
        """
        SELECT post_key, post_url, post_type, content FROM scanned_posts
        WHERE owner_key = %s AND page_key = %s AND post_key = ANY(%s)
        """,
        (owner_key, page_key, list(post_keys)),
    ) or []
    todo = [r for r in rows if needs_full_caption(r)][: max(1, int(limit))]
    result["todo"] = len(todo)
    if not todo:
        return result
    append_session_log(
        session_id,
        f"{page_key}: {len(todo)} reel/video thiếu caption — mở từng bài để lấy caption đầy đủ",
        "info",
    )
    for i, row in enumerate(todo):
        if stop_event.is_set() or _wait_if_paused(session_id, stop_event):
            result["stopped"] = True
            break
        caption, raw = fetch_full_caption(driver, row["post_url"], stop_event, exclude_names)
        if raw.get("checkpoint"):
            result["checkpoint"] = True
            break
        result["checked"] += 1
        old = (row.get("content") or "").strip()
        if caption and len(caption) > len(old):
            db.execute(
                """
                UPDATE scanned_posts SET content = %s, updated_at = NOW()
                WHERE owner_key = %s AND page_key = %s AND post_key = %s
                """,
                (caption, owner_key, page_key, row["post_key"]),
            )
            result["updated"] += 1
            append_session_log(
                session_id,
                f"[{i + 1}/{len(todo)}] {row['post_key']}: lấy được caption {len(caption)} ký tự",
                "success",
            )
        else:
            path = dump_caption_debug(row["post_key"], raw, caption)
            append_session_log(
                session_id,
                f"[{i + 1}/{len(todo)}] {row['post_key']}: không đọc được caption đầy đủ"
                f"{f' — text thô: {path}' if path else ''}",
                "warn",
            )
        if i < len(todo) - 1 and sleep_page_delay(random.uniform(1.5, 3.0), stop_event):
            result["stopped"] = True
            break
    return result


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
    account_uids: Optional[List[str]] = None,
    rotate_every: int = 0,
    rotate_on_checkpoint: bool = False,
    skip_pinned_posts: bool = False,
    page_delay_min_s: Optional[float] = None,
    page_delay_max_s: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Quét bài viết các Page. Nhiều acc (account_uids) → xoay vòng:
    - rotate_every > 0: đổi acc khi acc hiện tại đã quét đủ N bài (xét sau mỗi Page).
    - rotate_on_checkpoint: gặp checkpoint/login → đổi acc và quét lại Page đó.
    skip_pinned_posts: bỏ bài ghim của Quản trị viên.
    """
    page_keys = [str(k).strip() for k in (page_keys or []) if str(k).strip()]
    if not page_keys:
        raise ValueError("Cần ít nhất 1 page_key")
    allowed_types = post_types or ["all"]

    accounts = resolve_scan_accounts(account_uids, account_uid, owner_key=owner_key)
    if not accounts:
        raise RuntimeError("Không tìm thấy tài khoản Facebook hợp lệ")
    target_uid = str(accounts[0].get("uid") or "").strip()

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
    pinned_skipped = 0
    rotate_every = max(0, int(rotate_every or 0))

    rotation = AccountRotation(
        session_id,
        "POST_SCAN",
        accounts,
        owner_key,
        headless=headless,
        allow_direct_fallback=allow_direct_fallback,
        log=lambda message, level="info": append_session_log(session_id, message, level),
    )

    def _quota_left() -> int:
        return max(0, int(max_pages_per_acc) - get_account_usage_today(rotation.uid, "POST_SCAN"))

    try:
        from core.browser import human_sleep

        try:
            driver = rotation.open()
        except RuntimeError as lock_err:
            stop_reason = "CHECKPOINT"
            error_message = str(lock_err)
            finalize_scan_session(
                session_id, "PARTIAL", stop_reason, 0, 0, 0, 0, 0, 0, error_message
            )
            return {"session_id": session_id, "stop_reason": stop_reason, "count": 0}

        append_session_log(
            session_id,
            (
                f"POST_SCAN · pages={len(page_keys)} · max/page={max_posts_per_page} · types={allowed_types}"
                f" · acc={len(rotation.accounts)}"
                f"{f' · đổi acc sau {rotate_every} bài' if rotate_every and rotation.can_rotate else ''}"
                f"{' · đảo acc khi checkpoint' if rotate_on_checkpoint and rotation.can_rotate else ''}"
                f"{' · bỏ bài ghim' if skip_pinned_posts else ''}"
            ),
            "warn",
        )

        pages_quota_left = _quota_left()
        idle_timeout_s = max(5.0, float(idle_timeout_s))

        for idx, page_key in enumerate(page_keys):
            if stop_event.is_set():
                stop_reason = "USER_STOPPED"
                break
            if _wait_if_paused(session_id, stop_event):
                stop_reason = "USER_STOPPED"
                break
            if pages_quota_left <= 0:
                if rotation.rotate("hết quota POST_SCAN hôm nay"):
                    driver = rotation.driver
                    pages_quota_left = _quota_left()
                if pages_quota_left <= 0:
                    append_session_log(session_id, "Quota POST_SCAN Page/acc hôm nay đã hết", "warn")
                    stop_reason = "TIMEOUT"
                    break
                driver = rotation.driver

            page_url, page_name = resolve_page_url(owner_key, page_key)
            append_session_log(
                session_id,
                f"[{idx + 1}/{len(page_keys)}] Feed Page {page_name or page_key} · acc {rotation.uid}",
                "info",
            )

            # Mở Page; gặp checkpoint → đảo acc và mở lại (tối đa số acc)
            soft_failed = False
            for _attempt in range(len(rotation.accounts)):
                try:
                    driver.get(page_url)
                    time.sleep(2.0)
                except Exception as exc:
                    append_session_log(session_id, f"Soft-fail open {page_key}: {exc}", "warn")
                    soft_failed = True
                    break
                if not _is_checkpoint_url(driver):
                    break
                if rotate_on_checkpoint and rotation.rotate("checkpoint/login", mark_dead=True):
                    driver = rotation.driver
                    pages_quota_left = _quota_left()
                    continue
                stop_reason = "CHECKPOINT"
                error_message = "Checkpoint/login"
                break
            if stop_reason == "CHECKPOINT":
                break
            if soft_failed:
                bump_account_usage(rotation.uid, "POST_SCAN", 1)
                pages_quota_left -= 1
                continue

            known = existing_post_keys(owner_key, page_key) if skip_existing else set()
            pinned_seen: Set[str] = set()
            page_seen: Set[str] = set()
            known_passed = 0
            known_logged = 0
            page_got = 0
            last_new_at = time.time()
            stagnant = 0

            while page_got < max_posts_per_page:
                if stop_event.is_set():
                    stop_reason = "USER_STOPPED"
                    break
                stopped_in_pause, paused_s = _wait_if_paused_timed(session_id, stop_event)
                # Thời gian tạm dừng không tính là idle của Page đang quét
                last_new_at += paused_s
                if stopped_in_pause:
                    stop_reason = "USER_STOPPED"
                    break

                batch = extract_posts_batch(driver, exclude_names=(page_name,) if page_name else ())
                new_items = []
                fresh_known = 0  # bài đã có trong kho, LẦN ĐẦU hiện ra ở lượt quét Page này, trong khoảng ngày
                for item in batch:
                    total_seen += 1
                    pk = item["post_key"]
                    first_seen_on_page = pk not in page_seen
                    page_seen.add(pk)
                    if pk in session_keys or pk in known:
                        total_dup += 1
                        in_range = not item.get("published_at") or date_in_range(
                            item["published_at"], date_from, date_to
                        )
                        if first_seen_on_page and in_range:
                            fresh_known += 1
                        continue
                    if skip_pinned_posts and item.get("is_pinned"):
                        if pk not in pinned_seen:
                            pinned_seen.add(pk)
                            pinned_skipped += 1
                            append_session_log(session_id, f"{page_key}: bỏ bài ghim {pk}", "info")
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
                elif fresh_known:
                    # Quét lại (skip_existing): feed vẫn đang cuộn qua bài đã có trong kho
                    # → coi là tiến triển để đi tiếp tới bài cũ hơn chưa quét.
                    # Bài ngoài khoảng ngày KHÔNG tính → vẫn dừng sớm khi đã qua mốc ngày.
                    known_passed += fresh_known
                    last_new_at = time.time()
                    stagnant = 0
                    if known_passed - known_logged >= 50:
                        known_logged = known_passed
                        append_session_log(
                            session_id,
                            f"{page_key}: đã đi qua {known_passed} bài có sẵn trong kho — tiếp tục tìm bài mới",
                            "info",
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

            # Reel / video caption trên feed thiếu → mở từng bài lấy caption đầy đủ
            if stop_reason not in ("USER_STOPPED", "CHECKPOINT"):
                cap = fill_missing_captions(
                    driver,
                    owner_key,
                    page_key,
                    page_seen,
                    session_id,
                    stop_event,
                    exclude_names=(page_name,) if page_name else (),
                    limit=max_posts_per_page,
                )
                if cap["todo"]:
                    append_session_log(
                        session_id,
                        f"{page_key}: caption reel/video — cập nhật {cap['updated']}/{cap['todo']}",
                        "success" if cap["updated"] else "warn",
                    )
                if cap["stopped"]:
                    stop_reason = "USER_STOPPED"
                elif cap["checkpoint"]:
                    append_session_log(session_id, f"{page_key}: checkpoint/login khi mở reel", "error")
                    if rotate_on_checkpoint and rotation.rotate("checkpoint/login", mark_dead=True):
                        driver = rotation.driver
                        pages_quota_left = _quota_left()
                    else:
                        stop_reason = "CHECKPOINT"
                        error_message = "Checkpoint/login khi mở reel"

            bump_account_usage(rotation.uid, "POST_SCAN", 1)
            pages_quota_left -= 1
            rotation.count += page_got

            if stop_reason in ("USER_STOPPED", "CHECKPOINT"):
                break
            has_next = idx < len(page_keys) - 1
            if has_next and rotate_every and rotation.can_rotate and rotation.count >= rotate_every:
                if rotation.rotate(f"đủ {rotation.count} bài / nick"):
                    pages_quota_left = _quota_left()
                if rotation.driver is None:
                    stop_reason = "ERROR"
                    error_message = "Không mở lại được trình duyệt sau khi đổi tài khoản"
                    break
                driver = rotation.driver
            if has_next and sleep_page_delay(
                pick_page_delay(page_delay_min_s, page_delay_max_s, page_delay_s), stop_event
            ):
                stop_reason = "USER_STOPPED"
                break
        else:
            if total_unique == 0:
                stop_reason = "NO_NEW_RESULTS"

    except (Exception, ScanStopped) as exc:
        if stop_event.is_set():
            # Dừng khẩn cấp đóng Chrome giữa chừng → lỗi WebDriver là hệ quả của việc dừng
            logger.info(f"[POST_SCAN] #{session_id} dừng giữa thao tác trình duyệt: {exc}")
            stop_reason = "USER_STOPPED"
        else:
            logger.exception(f"[POST_SCAN] #{session_id}: {exc}")
            stop_reason = "ERROR"
            error_message = str(exc)[:500]
            append_session_log(session_id, f"Lỗi: {error_message}", "error")
    finally:
        # Nhả trước khi ghi DB để DB lỗi không làm kẹt khóa profile
        rotation.release(stop_reason, keep_browser)
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
            (
                f"Kết thúc POST_SCAN · {final_status}/{stop_reason} · posts={total_unique}"
                f"{f' · bỏ {pinned_skipped} bài ghim' if pinned_skipped else ''}"
            ),
            "success" if final_status == "COMPLETED" else "warn",
        )
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
    account_uids: Optional[List[str]] = None,
    rotate_every: int = 0,
    rotate_on_checkpoint: bool = False,
    skip_pinned_posts: bool = False,
    page_delay_min_s: Optional[float] = None,
    page_delay_max_s: Optional[float] = None,
) -> int:
    page_keys = [str(k).strip() for k in (page_keys or []) if str(k).strip()]
    if not page_keys:
        raise ValueError("Cần ít nhất 1 page_key")

    # Nhiều acc: bắt đầu từ acc rảnh đầu tiên (409 BUSY nếu tất cả đang bận)
    accounts = order_accounts_free_first(
        resolve_scan_accounts(account_uids, account_uid, owner_key=owner_key)
    )
    if not accounts:
        raise RuntimeError("Không tìm thấy tài khoản Facebook hợp lệ")
    ordered_uids = [str(a.get("uid") or "").strip() for a in accounts]
    target_uid = ordered_uids[0]

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
        "page_delay_min_s": page_delay_min_s,
        "page_delay_max_s": page_delay_max_s,
        "scroll_delay_s": scroll_delay_s,
        "keep_browser": keep_browser,
        "source_list_id": source_list_id,
        "automation": True,
        "max_pages_per_acc": max_pages_per_acc,
        "account_uids": ordered_uids,
        "rotate_every": rotate_every,
        "rotate_on_checkpoint": rotate_on_checkpoint,
        "skip_pinned_posts": skip_pinned_posts,
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
                account_uids=ordered_uids,
                rotate_every=rotate_every,
                rotate_on_checkpoint=rotate_on_checkpoint,
                skip_pinned_posts=skip_pinned_posts,
                page_delay_min_s=page_delay_min_s,
                page_delay_max_s=page_delay_max_s,
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
