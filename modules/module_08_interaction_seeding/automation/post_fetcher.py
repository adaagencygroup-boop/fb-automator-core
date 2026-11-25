"""
post_fetcher.py
Module 8 — "Lấy bài viết từ page / trang cá nhân": job chạy nền cuộn feed của 1 page / trang cá nhân và lấy
TOÀN BỘ bài viết (không giới hạn số bài) cho tới khi hết bài hoặc người dùng bấm Dừng.

- Đọc bài bằng bộ trích xuất riêng của Module 8 và chỉ đọc nhóm bài MỚI mỗi vòng
  (đánh dấu data-m8-batch / data-m8-done) → không kẹt ở 40 bài đầu và không chậm dần khi trang dài.
- Bài lấy về chỉ lưu TẠM (RAM + file tạm trên máy, xem fetched_posts_store.py) — không ghi lên DB chung;
  chỉ khi người dùng bấm "Thêm bài viết đã chọn" thì các bài đã chọn mới được lưu vào seeding_targets.
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

from modules.module_08_interaction_seeding.automation import fetched_posts_store
from modules.module_08_interaction_seeding.models.seeding_models import (
    SeedingPostFetchJob,
    SeedingTemplate,
    vn_now,
)

logger = logging.getLogger(__name__)

# ── Tham số vòng cuộn ──
BATCH_SIZE = 12                 # số bài đọc mỗi vòng
SCROLL_PAUSE_S = (3.0, 4.5)     # chờ feed tải xong sau mỗi lần cuộn chậm, tránh lướt qua bài chưa render
LONG_REST_EVERY = 200           # cứ N bài mới thì nghỉ dài
LONG_REST_S = (5.0, 10.0)
IDLE_ROUNDS = 10                # số vòng không có bài trước khi kéo xuống đáy kiểm tra lần cuối
DEEP_WAIT_S = 10.0
NO_NEW_TIMEOUT_S = 300.0        # feed chậm tải bài cũ vẫn có thêm thời gian để hiện bài
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
    m_share = re.search(r"/share/(?:p|r|v)/([0-9A-Za-z_-]+)", parsed.path)
    if m_share:
        return f"post:{m_share.group(1)}"
    m_fbid = query.get("fbid") or query.get("story_fbid")
    if m_fbid:
        return f"post:{m_fbid}"
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


def _resolve_post_url_from_embed_menu(driver, selector: str, candidate_index: int) -> str:
    """Use Facebook's Embed dialog when the feed omits a post permalink href."""
    try:
        opened = driver.execute_script(r"""
const node = document.querySelectorAll(arguments[0])[arguments[1]];
if (!node) return false;
const action = Array.from(node.querySelectorAll('[role="button"]')).find((button) =>
  /^actions for this post/i.test(button.getAttribute('aria-label') || '')
);
if (!action) return false;
action.click();
return true;
""", selector, int(candidate_index))
        if not opened:
            return ""
        time.sleep(0.35)
        clicked = driver.execute_script(r"""
const embed = Array.from(document.querySelectorAll('[role="menuitem"], [role="button"]')).find((item) =>
  /^(embed|nhúng)$/i.test((item.innerText || item.textContent || '').replace(/\s+/g, ' ').trim())
);
if (!embed) return false;
embed.click();
return true;
""")
        if not clicked:
            driver.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));")
            return ""
        time.sleep(0.45)
        post_url = driver.execute_script(r"""
const link = Array.from(document.querySelectorAll('a[href]')).find((anchor) =>
  anchor.href.includes('/docs/plugins/embedded-posts/') && anchor.href.includes('prefill_href=')
);
if (!link) return '';
try { return new URL(link.href).searchParams.get('prefill_href') || ''; }
catch { return ''; }
""") or ""
        driver.execute_script(r"""
const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).pop();
const close = dialog?.querySelector('[aria-label="Close"]');
if (close) close.click();
else document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
""")
        post_url = str(post_url).strip()
        if not re.search(r"/posts/[^/?#]+|/permalink(?:\.php)?(?:/[^/?#]+)?(?:[?#]|$)|/(?:reels?|videos?)/(?:\d+|pfbid[0-9a-z]+)(?:[/?#]|$)|[?&]story_fbid=", post_url, re.I):
            return ""
        return post_url
    except Exception as exc:
        logger.debug("Unable to get post permalink from Embed dialog: %s", exc)
        try:
            driver.execute_script("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));")
        except Exception:
            pass
        return ""


def _read_post_batch(driver, selector: str) -> List[Dict[str, Any]]:
    """Đọc bài riêng cho Module 8, không trích số like/comment/share từ DOM."""
    rows = driver.execute_script(_READ_POST_BATCH_JS, selector) or []
    posts: List[Dict[str, Any]] = []
    for row in rows:
        post_url = str(row.get("post_url") or "").strip()
        if not post_url and row.get("candidate_index") is not None:
            post_url = _resolve_post_url_from_embed_menu(driver, selector, int(row["candidate_index"]))
        if not post_url:
            continue
        raw = str(row.get("content") or "").replace("\xa0", " ")
        content = "\n".join(line.strip() for line in raw.splitlines() if line.strip())
        posts.append({
            "post_url": post_url,
            "content": content or "Bài viết không có nội dung",
            "post_type": row.get("post_type") or "text",
            "published_at": row.get("published_at"),
            "published_text": row.get("published_text"),
            "reaction_count": 0,
            "comment_count": 0,
            "share_count": 0,
            "is_pinned": bool(row.get("is_pinned")),
            "content_cleaned": True,
        })
    return posts


# ─────────────────────────────────────────────────────────────
# JavaScript chạy trên trang Facebook
# ─────────────────────────────────────────────────────────────
# Đánh dấu tối đa N bài GỐC (không phải bình luận lồng trong bài), chưa đọc, đã có link bài.
_OPEN_POSTS_TAB_JS = r"""
const labels = new Set(['posts', 'bài viết']);
const visible = (el) => {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};
const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
// Profile feeds can show their posts directly without exposing a separate Posts tab.
// Use explicit profile-only markers so a Page with a missing Posts tab still stops
// instead of accidentally scanning its Featured section.
const headings = Array.from(document.querySelectorAll('[role="heading"], h1, h2'))
  .filter(visible)
  .map((el) => normalize(el.innerText || el.textContent));
const pagelets = Array.from(document.querySelectorAll('[data-pagelet]'))
  .map((el) => normalize(el.getAttribute('data-pagelet')));
const bodyText = normalize(document.body?.innerText || '');
const isProfile = pagelets.some((name) => /profile.*(timeline|feed|comet)|profiletimeline/.test(name))
  || ((headings.some((text) => /personal details|personal information|chi tiết cá nhân|thông tin cá nhân/.test(text))
    || /personal details|personal information|chi tiết cá nhân|thông tin cá nhân/.test(bodyText))
    && (headings.some((text) => /friends|bạn bè/.test(text)) || /\bfriends\b|bạn bè/.test(bodyText)));
// Facebook's current tab label is a plain span; start from that exact node, then
// climb to the interactive tab instead of relying on its unstable class names.
const postsSpan = Array.from(document.querySelectorAll('span'))
  .filter(visible)
  .find((el) => normalize(el.innerText || el.textContent) === 'posts');
const postsControl = postsSpan?.closest('[role="tab"], a, button, [role="link"], [role="button"]') || postsSpan;
const controls = Array.from(document.querySelectorAll('[role="tab"], a, button, [role="link"], [role="button"]'))
  .filter(visible)
  .map((el) => ({ el, label: normalize(el.getAttribute('aria-label') || el.innerText || el.textContent) }))
  .filter(({ label }) => labels.has(label));
if (postsControl && !controls.some(({ el }) => el === postsControl)) {
  controls.unshift({ el: postsControl, label: 'posts' });
}
if (!controls.length) return { found: false, selected: false, is_profile: isProfile };
const selected = controls.find(({ el }) => el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page');
if (selected) return { found: true, selected: true, is_profile: isProfile };
controls[0].el.click();
return { found: true, selected: false, clicked: true, is_profile: isProfile };
"""

_MARK_BATCH_JS = r"""
const token = arguments[0];
const maxN = arguments[1] || 12;
const MESSAGE_SEL = '[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"]';
const LINK_RE = /\/posts\/[^/?#]+|\/permalink(?:\.php)?(?:\/[^/?#]+)?(?:[?#]|$)|\/(?:reels?|videos?)\/(?:\d+|pfbid[0-9a-z]+)(?:[/?#]|$)|[?&]story_fbid=/i;
const candidates = [];
const hasPostLink = (el) => Array.from(el.querySelectorAll('a[href]')).some((a) => LINK_RE.test(a.href || a.getAttribute('href') || ''));
const postKey = (el) => {
  const links = Array.from(el.querySelectorAll('a[href]')).filter((a) => LINK_RE.test(a.href || a.getAttribute('href') || ''));
  const isInComment = (anchor) => {
    for (let current = anchor; current && current !== el; current = current.parentElement) {
      const label = [current.getAttribute('aria-label'), current.getAttribute('data-testid'), current.getAttribute('data-pagelet')]
        .filter(Boolean).join(' ').toLowerCase();
      if (/comment|bình luận|phản hồi|reply/.test(label)) return true;
    }
    return false;
  };
  const anchor = links.find((link) => !isInComment(link)) || links[0];
  if (!anchor) return '';
  try {
    const url = new URL(anchor.href || anchor.getAttribute('href'), location.href);
    const identity = ['story_fbid', 'fbid', 'id', 'v'].map((key) => url.searchParams.get(key) || '').filter(Boolean).join(':');
    return `${url.pathname}${identity ? `?${identity}` : ''}`;
  } catch {
    return anchor.getAttribute('href') || '';
  }
};
const refreshMarker = (el) => {
  const key = postKey(el);
  const previous = el.getAttribute('data-m8-post-key');
  if (key && previous && key !== previous) {
    el.removeAttribute('data-m8-done');
    el.removeAttribute('data-m8-batch');
  }
  if (key) el.setAttribute('data-m8-post-key', key);
};
const hasPostActions = (el) => Array.from(el.querySelectorAll('[role="button"]')).some((button) => {
  const label = (button.getAttribute('aria-label') || button.innerText || button.textContent || '').toLowerCase();
  return /react|like|comment|share|thích|bình luận|chia sẻ/.test(label);
});
const addCandidate = (el) => {
  if (el) refreshMarker(el);
  if (!el || el.hasAttribute('data-m8-done') || el.hasAttribute('data-m8-batch')) return;
  if (candidates.some((existing) => existing.contains(el) || el.contains(existing))) return;
  candidates.push(el);
};

// Dùng message của bài làm mốc; không chọn wrapper Timeline/Feed hoặc article của bình luận.
const messages = Array.from(document.querySelectorAll(MESSAGE_SEL)).filter((message) => {
  for (let parent = message.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    if (parent.matches(MESSAGE_SEL)) return false;
  }
  return true;
});
const topMessageCount = (root) => Array.from(root.querySelectorAll(MESSAGE_SEL)).filter((message) => {
  for (let parent = message.parentElement; parent && parent !== root; parent = parent.parentElement) {
    if (parent.matches(MESSAGE_SEL)) return false;
  }
  return true;
}).length;
for (const message of messages) {
  if (candidates.length >= maxN) break;
  let best = null;
  let postActionRoot = null;
  let current = message.parentElement;
  for (let depth = 0; current && current !== document.body && depth < 12; depth++, current = current.parentElement) {
    refreshMarker(current);
    if (current.hasAttribute('data-m8-done') || current.hasAttribute('data-m8-batch')) break;
    if (candidates.some((candidate) => candidate.contains(current))) break;
    if (hasPostActions(current)) {
      if (!postActionRoot) postActionRoot = current;
      if (hasPostLink(current)) {
        best = current;
        break;
      }
    }
  }
  if (!best && postActionRoot) {
    best = postActionRoot;
    current = postActionRoot.parentElement;
    for (let depth = 0; current && current !== document.body && depth < 6; depth++, current = current.parentElement) {
      if (topMessageCount(current) > 1) break;
      if (hasPostLink(current)) {
        best = current;
        break;
      }
    }
  }
  if (best) {
    message.setAttribute('data-m8-message-root', token);
    addCandidate(best);
  }
}

// Giữ cả bài chỉ có ảnh/video, không có story_message để trích nội dung.
const SEMANTIC_POST_SEL = '[role="article"], div[data-pagelet*="FeedUnit"]';
for (const el of document.querySelectorAll(SEMANTIC_POST_SEL)) {
  if (candidates.length >= maxN) break;
  if (el.parentElement && el.parentElement.closest(SEMANTIC_POST_SEL)) continue;
  if (topMessageCount(el) > 0 || !hasPostLink(el) || !hasPostActions(el)) continue;
  addCandidate(el);
}

// New profile layouts often render a video/Reel post without an article or
// story_message marker. Find its card from the real media permalink and the
// nearest post-level Like/Comment/Share actions, excluding navigation links.
const isCommentLink = (anchor) => {
  if (anchor.closest('[role="navigation"]')) return true;
  for (let current = anchor; current && current !== document.body; current = current.parentElement) {
    const label = [current.getAttribute('aria-label'), current.getAttribute('data-testid'), current.getAttribute('data-pagelet')]
      .filter(Boolean).join(' ').toLowerCase();
    if (/comment|bình luận|phản hồi|reply/.test(label)) return true;
  }
  return false;
};
for (const anchor of document.querySelectorAll(
  'a[href*="/posts/"], a[href*="/permalink"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/videos/"], a[href*="story_fbid="]'
)) {
  if (candidates.length >= maxN) break;
  if (!LINK_RE.test(anchor.href || anchor.getAttribute('href') || '') || isCommentLink(anchor)) continue;
  let current = anchor.parentElement;
  for (let depth = 0; current && current !== document.body && depth < 24; depth++, current = current.parentElement) {
    if (current.hasAttribute('data-m8-done') || current.hasAttribute('data-m8-batch')) break;
    if (candidates.some((candidate) => candidate.contains(current) || current.contains(candidate))) break;
    if (!hasPostActions(current)) continue;
    addCandidate(current);
    break;
  }
}

let marked = 0;
let expanded = 0;
for (const el of candidates) {
  if (marked >= maxN) break;
  for (const button of el.querySelectorAll('[role="button"]')) {
    const label = (button.innerText || button.textContent || '').replace(/\s+/g, ' ').trim();
    if (/^(see more|xem thêm)$/i.test(label)) {
      button.click();
      expanded++;
    }
  }
  const key = postKey(el);
  if (key) el.setAttribute('data-m8-post-key', key);
  el.setAttribute('data-m8-batch', token);
  marked++;
}
const doc = document.documentElement;
return { marked: marked, expanded: expanded, height: Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0) };
"""

# Bài riêng cho Module 8: không đọc số lượng tương tác và không lấy text tổng hợp cả article.
_READ_POST_BATCH_JS = r"""
const selector = arguments[0];
const MESSAGE_SEL = '[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"]';
const result = [];
const normalize = (value) => (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const cleanTimeText = (value) => normalize(value).replace(/[\u034f\u200b-\u200f\u2060\ufeff]/g, '');
const isTimeLabel = (value) => /just\s*now|yesterday|ago|hôm\s*qua|trước|\d+\s*(?:minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|years?|y|phút|giờ|ngày|tuần|tháng|năm)(?=\s|$|[^a-z])|tháng\s*\d|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|january|february|march|april|may|june|july|august|september|october|november|december|\bjan\b|\bfeb\b|\bmar\b|\bapr\b|\bjun\b|\bjul\b|\baug\b|\bsep\b|\boct\b|\bnov\b|\bdec\b/i.test(value || '');
const isCommentLink = (anchor, postNode) => {
  if (anchor.closest('[role="navigation"]')) return true;
  for (let current = anchor; current && current !== postNode; current = current.parentElement) {
    const label = [current.getAttribute('aria-label'), current.getAttribute('data-testid'), current.getAttribute('data-pagelet')]
      .filter(Boolean).join(' ').toLowerCase();
    if (/comment|bình luận|phản hồi|reply/.test(label)) return true;
  }
  return false;
};

const postNodes = Array.from(document.querySelectorAll(selector));
for (const [candidateIndex, node] of postNodes.entries()) {
  // Chọn anchor hợp lệ đầu tiên theo thứ tự DOM như luồng trước.
  const postLink = Array.from(node.querySelectorAll('a[href]')).find((a) => {
    const href = a.href || a.getAttribute('href') || '';
    return /\/posts\/[^/?#]+|\/permalink(?:\.php)?(?:\/[^/?#]+)?(?:[?#]|$)|\/(?:reels?|videos?)\/(?:\d+|pfbid[0-9a-z]+)(?:[/?#]|$)|[?&]story_fbid=/i.test(href)
      && !isCommentLink(a, node);
  });
  const postUrl = postLink ? (postLink.href || postLink.getAttribute('href') || '') : '';

  // Trích xuất CHÍNH XÁC nội dung bài viết qua element [data-ad-comet-preview="message"] / [data-ad-preview="message"] / [data-ad-rendering-role="story_message"]
  // Tuyệt đối KHÔNG đọc nhầm bình luận (bình luận không có các data-ad-* marker này).
  let content = '';
  const readCaptionLine = (el) => {
    const copy = el.cloneNode(true);
    // Bỏ nút "Xem thêm" / "See more"
    copy.querySelectorAll('[role="button"], button').forEach((button) => button.remove());
    // Giữ xuống dòng từ <br>
    copy.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode('\n')));
    // Thay emoji <img> bằng ký tự alt thật
    copy.querySelectorAll('img[alt]').forEach((img) => img.replaceWith(document.createTextNode(img.getAttribute('alt') || '')));
    return (copy.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  };

  // 1. Chỉ tìm trong các phần tử ĐƯỢC FACEBOOK ĐÁNH DẤU CHÍNH XÁC là message bài viết
  const messageRoot = node.querySelector(`[data-m8-message-root="${node.getAttribute('data-m8-batch')}"]`) ||
    node.querySelector('[data-ad-rendering-role="story_message"]') ||
    node.querySelector('[data-ad-comet-preview="message"]') ||
    node.querySelector('[data-ad-preview="message"]');

  if (!postUrl && !messageRoot) continue;

  if (messageRoot) {
    // Ưu tiên 1: Lấy các div[dir="auto"] bên trong x126k92a (cấu trúc chuẩn của bài viết Facebook Comet)
    const bodyWrappers = Array.from(messageRoot.querySelectorAll('[class~="x126k92a"]'))
      .filter((body) => !body.parentElement?.closest('[class~="x126k92a"]'));
    const lines = [];
    for (const bodyWrapper of (bodyWrappers.length ? bodyWrappers : [messageRoot])) {
      const leafDivs = Array.from(bodyWrapper.querySelectorAll('div[dir="auto"]'))
        .filter((div) => !div.querySelector('div[dir="auto"]'));
      lines.push(...leafDivs.map(readCaptionLine).filter(Boolean));
    }

    if (lines.length > 0) {
      content = lines.join('\n').trim();
    }

    // Ưu tiên 2: Tìm các thẻ span[dir="auto"] bên trong messageRoot (không chứa span[dir="auto"] con)
    if (!content) {
      const spans = Array.from(messageRoot.querySelectorAll('span[dir="auto"]'))
        .filter((span) => !span.querySelector('span[dir="auto"]'));
      if (spans.length > 0) {
        const lines = spans.map(readCaptionLine).filter(Boolean);
        content = lines.join('\n').trim();
      }
    }

    // Ưu tiên 3: Đọc trực tiếp từ messageRoot
    if (!content) {
      content = readCaptionLine(messageRoot);
    }

  }

  // NẾU KHÔNG CÓ messageRoot -> Bài viết không có text (chỉ có ảnh/video/share bài khác không kèm caption).
  // Tuyệt đối KHÔNG fallback sang các div[dir="auto"] ngoài messageRoot vì sẽ bắt nhầm bình luận!

  const TIME_SELECTOR = 'abbr[data-utime], time[datetime], [data-utime], [title], [aria-label], [aria-labelledby]';
  const timeNodes = Array.from(node.querySelectorAll(TIME_SELECTOR));
  // Một số layout đặt nhãn thời gian trong chính permalink và các span con
  // (chữ có thể bị chèn ký tự zero-width), không có abbr/data-utime.
  let linkAncestor = postLink;
  for (let depth = 0; linkAncestor && linkAncestor !== node && depth < 5; depth++, linkAncestor = linkAncestor.parentElement) {
    if (!timeNodes.includes(linkAncestor)) timeNodes.push(linkAncestor);
  }
  const timeLabelText = (el) => {
    const referenced = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '')
      .filter(Boolean).join(' ');
    return cleanTimeText(el.getAttribute('title') || el.getAttribute('datetime') || el.getAttribute('aria-label') || referenced || el.innerText || el.textContent);
  };
  // Timestamp of the post is normally inside its permalink in the post header.
  // Prefer that metadata so a comment or a nested shared post cannot supply the date.
  const permalinkTimeNodes = postLink
    ? [postLink, ...postLink.querySelectorAll(TIME_SELECTOR)]
    : [];
  const orderedTimeNodes = [...new Set([...permalinkTimeNodes, ...timeNodes])];
  const timeNode = orderedTimeNodes.find((el) => el.hasAttribute('data-utime') || el.hasAttribute('datetime')) ||
    orderedTimeNodes.find((el) => isTimeLabel(timeLabelText(el)));
  const utimeRaw = timeNode?.getAttribute('data-utime') || timeNode?.querySelector('[data-utime]')?.getAttribute('data-utime');
  const utime = Number(utimeRaw);
  const rawTimeText = timeNode ? timeLabelText(timeNode) : '';
  let publishedDate = timeNode?.getAttribute('datetime') ? new Date(timeNode.getAttribute('datetime')) : null;
  if (!(publishedDate instanceof Date) || Number.isNaN(publishedDate.getTime())) publishedDate = null;
  if (!publishedDate && Number.isFinite(utime) && utime > 0) publishedDate = new Date(utime * 1000);
  if (!publishedDate) {
    const relative = rawTimeText.match(/(just\s*now|yesterday|hôm\s*qua|an?\s+(?:minute|hour|day|week|month|year)s?\s+ago|\d+\s*(?:minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|years?|y|phút|giờ|ngày|tuần|tháng|năm)(?=\s|$|[^a-z]))/i);
    if (relative) {
      const label = relative[0].toLowerCase();
      const amount = Number(label.match(/\d+/)?.[0] || (/^an?\s/.test(label) ? 1 : 0));
      const published = new Date();
      if (/yesterday|hôm\s*qua/.test(label)) published.setDate(published.getDate() - 1);
      else if (/min|phút|\bm\b/.test(label)) published.setMinutes(published.getMinutes() - amount);
      else if (/\bhr?\b|hour|giờ/.test(label)) published.setHours(published.getHours() - amount);
      else if (/week|tuần|\bw\b/.test(label)) published.setDate(published.getDate() - amount * 7);
      else if (/month|tháng/.test(label)) published.setMonth(published.getMonth() - amount);
      else if (/year|năm|\by\b/.test(label)) published.setFullYear(published.getFullYear() - amount);
      else if (/day|ngày|\bd\b/.test(label)) published.setDate(published.getDate() - amount);
      publishedDate = published;
    }
  }
  if (!publishedDate) {
    const vietnameseDate = rawTimeText.match(/\b(\d{1,2})\s+tháng\s+(\d{1,2})(?:[,\s]+(\d{4}))?/i);
    const numericDate = rawTimeText.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
    const englishDate = rawTimeText.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i);
    if (vietnameseDate) {
      const year = Number(vietnameseDate[3] || new Date().getFullYear());
      publishedDate = new Date(year, Number(vietnameseDate[2]) - 1, Number(vietnameseDate[1]));
    } else if (numericDate) {
      const year = Number(numericDate[3].length === 2 ? `20${numericDate[3]}` : numericDate[3]);
      publishedDate = new Date(year, Number(numericDate[2]) - 1, Number(numericDate[1]));
    } else if (englishDate) {
      publishedDate = new Date(`${englishDate[1]} ${englishDate[2]} ${englishDate[3] || new Date().getFullYear()}`);
    } else if (rawTimeText) {
      const parsed = new Date(rawTimeText);
      if (!Number.isNaN(parsed.getTime())) publishedDate = parsed;
    }
  }
  // Facebook labels sometimes omit the year; a future date without an explicit year is last year.
  if (publishedDate && !/\b\d{4}\b/.test(rawTimeText) && publishedDate > new Date()) {
    publishedDate.setFullYear(publishedDate.getFullYear() - 1);
  }
  const publishedAt = publishedDate ? publishedDate.toISOString() : null;
  const publishedText = publishedDate
    ? `${String(publishedDate.getDate()).padStart(2, '0')}-${String(publishedDate.getMonth() + 1).padStart(2, '0')}-${publishedDate.getFullYear()}`
    : null;
  const lowerUrl = postUrl.toLowerCase();
  const postType = /\/(reel|reels|videos?|watch)\b/.test(lowerUrl) || node.querySelector('video')
    ? 'video'
    : /\/photo\/?\?/.test(lowerUrl) || node.querySelector('img[src*="scontent"]')
      ? 'photo'
      : 'text';
  result.push({ post_url: postUrl, candidate_index: candidateIndex, content, post_type: postType, published_at: publishedAt, published_text: publishedText });
}
return result;
"""

# Chốt nhóm vừa đọc; bài đã đọc nằm xa phía trên → bỏ ảnh / video để Chrome nhẹ (giữ nguyên DOM cho React của Facebook).
_FINISH_BATCH_JS = r"""
const token = arguments[0];
const trim = !!arguments[1];
for (const message of document.querySelectorAll('[data-m8-message-root="' + token + '"]')) {
  message.removeAttribute('data-m8-message-root');
}
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

_SCROLL_JS = r"""(() => {
  const step = Math.max(320, Math.round(window.innerHeight * 0.45));
  const root = document.scrollingElement || document.documentElement;
  const rootBefore = root.scrollTop || 0;
  window.scrollBy(0, step);
  if ((root.scrollTop || 0) > rootBefore + 2) {
    return { before: rootBefore, after: root.scrollTop, moved: true, at_bottom: false };
  }

  // Một số layout Facebook cuộn trong vùng feed thay vì document.
  const anchors = document.querySelectorAll(
    'a[href*="/posts/"], a[href*="/permalink"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/videos/"], a[href*="story_fbid="]'
  );
  const candidates = new Set();
  for (const anchor of anchors) {
    let parent = anchor.parentElement;
    for (let depth = 0; parent && depth < 12; depth++, parent = parent.parentElement) {
      if (parent.scrollHeight > parent.clientHeight + 12) {
        const overflow = getComputedStyle(parent).overflowY;
        if (overflow === 'auto' || overflow === 'scroll' || parent.hasAttribute('role')) candidates.add(parent);
      }
    }
  }
  const ordered = Array.from(candidates).sort(
    (a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)
  );
  for (const element of ordered) {
    const before = element.scrollTop;
    element.scrollTop = before + step;
    if (element.scrollTop > before + 2) {
      return { before, after: element.scrollTop, moved: true, at_bottom: false };
    }
  }
  const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
  return {
    before: rootBefore,
    after: root.scrollTop || 0,
    moved: false,
    at_bottom: maxTop - (root.scrollTop || 0) <= 8,
  };
})()"""
_SCROLL_BOTTOM_JS = r"""(() => {
  const root = document.scrollingElement || document.documentElement;
  window.scrollTo(0, root.scrollHeight);
  const anchors = document.querySelectorAll(
    'a[href*="/posts/"], a[href*="/permalink"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/videos/"], a[href*="story_fbid="]'
  );
  const candidates = new Set();
  for (const anchor of anchors) {
    let parent = anchor.parentElement;
    for (let depth = 0; parent && depth < 12; depth++, parent = parent.parentElement) {
      if (parent.scrollHeight > parent.clientHeight + 12) {
        const overflow = getComputedStyle(parent).overflowY;
        if (overflow === 'auto' || overflow === 'scroll' || parent.hasAttribute('role')) candidates.add(parent);
      }
    }
  }
  for (const element of candidates) element.scrollTop = element.scrollHeight;
})()"""


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


def prepare_rows(posts: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Bài đọc từ feed → dòng lưu kho tạm (khoá pfbid-safe, link chuẩn hoá, bỏ trùng trong cùng nhóm)."""
    out: Dict[str, Dict[str, Any]] = {}
    for p in posts:
        url = (p.get("post_url") or "").strip()
        key = seeding_post_key(url)
        if not url or not key or key in out:
            continue
        target_url, target_fb_id = post_target_fields(url)
        if not target_fb_id:
            target_fb_id = key.split(":")[-1] if ":" in key else key
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


def _select_posts_tab(driver, stop: threading.Event) -> bool:
    """Select Posts on Pages; profiles may expose their posts directly in the feed."""
    try:
        state = driver.execute_script(_OPEN_POSTS_TAB_JS) or {}
        if not state.get("found"):
            if state.get("is_profile"):
                logger.info("Profile page has no separate Posts tab; continuing with its default feed.")
                return True
            return False
        if state.get("clicked"):
            stop.wait(1.5)
        return True
    except Exception as exc:
        logger.debug("Unable to select Facebook Posts tab: %s", exc)
        return False


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
        fetched_posts_store.begin(owner_id, source_key, job_id)
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
        if not _select_posts_tab(driver, stop):
            error = "Không tìm thấy mục Bài viết trên trang nguồn; đã dừng để tránh quét mục Đáng chú ý."
            reason = "POSTS_TAB_NOT_FOUND"
            return
        if on_checkpoint() or not has_session_cookie(driver):
            log("warning", "Phiên đăng nhập bị mất — thử đăng nhập lại 1 lần…")
            if not bot.apply_facebook_support_data(account, HWID, callback=lambda m: log("info", m)):
                reason, error = "LOGGED_OUT", "Nick bị đăng xuất / checkpoint, không đăng nhập lại được."
                return
            _open_and_wait(driver, source_url, stop)
            if on_checkpoint():
                reason, error = "CHECKPOINT", "Nick bị checkpoint khi mở trang."
                return
            if not _select_posts_tab(driver, stop):
                error = "Không tìm thấy mục Bài viết trên trang nguồn; đã dừng để tránh quét mục Đáng chú ý."
                reason = "POSTS_TAB_NOT_FOUND"
                return

        name = _source_name(driver)
        if name:
            _update_job(job_id, source_name=name)
        log("info", f"Bắt đầu cuộn feed{(' của ' + name) if name else ''} — lấy tới khi hết bài hoặc bấm Dừng.")

        rounds = idle = errors = 0
        last_height = 0
        bottom_blocked_last_round = False
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
                    # Facebook updates a caption asynchronously after "See more".
                    if int(info.get("expanded") or 0):
                        time.sleep(0.9)
                    batch_selector = f'[data-m8-batch="{batch}"]'
                    posts = _read_post_batch(driver, batch_selector)
                    rows = prepare_rows(posts)
                    fresh = sum(1 for r in rows if r["post_key"] not in found_keys)
                    found_keys.update(r["post_key"] for r in rows)
                    if rows:
                        # Chỉ lưu tạm (RAM + file trên máy) — DB chỉ ghi khi người dùng bấm thêm bài đã chọn
                        new_total += fetched_posts_store.upsert(owner_id, source_key, job_id, rows)
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

            # Nếu lần cuộn trước đã chạm đáy, cho thêm một vòng đọc DOM sau thời gian chờ.
            # Chỉ kết thúc khi vòng đó cũng không thấy bài mới hay chiều cao feed tăng.
            height_increased = height > last_height
            # DOM có thể dựng lại node cũ khiến marked > 0 dù không có bài mới.
            # Khi đã chạm đáy, chỉ cần một vòng xác nhận không có bài mới/chiều cao mới.
            if bottom_blocked_last_round and not fresh and not height_increased:
                status, reason = "COMPLETED", "END_OF_FEED"
                break
            bottom_blocked_last_round = False

            # Có bài mới trên trang hoặc trang dài thêm (Facebook vừa tải thêm) = còn tiến triển
            if marked or height_increased:
                idle = 0
            else:
                idle += 1
            last_height = max(last_height, height)

            if idle >= IDLE_ROUNDS:
                # Hết tiến triển qua nhiều vòng: kéo xuống đáy, chờ một lượt tải cuối,
                # rồi xác nhận thêm một vòng DOM trước khi kết thúc.
                driver.execute_script(_SCROLL_BOTTOM_JS)
                stop.wait(DEEP_WAIT_S)
                idle = 0
                bottom_blocked_last_round = True
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
            scroll_info = driver.execute_script(_SCROLL_JS) or {}
            stop.wait(random.uniform(*SCROLL_PAUSE_S))
            bottom_blocked_last_round = bool(scroll_info.get("at_bottom") and not scroll_info.get("moved"))
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
        fetched_posts_store.finish(owner_id)
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
