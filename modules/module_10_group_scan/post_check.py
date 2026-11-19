"""
Module 10.3: Quét bài viết nhóm (Group Post Scraping).

DOM do user chỉ (feed nhóm):
- Mỗi bài: container [aria-posinset] (1 = mới nhất)
- Nội dung: [data-ad-rendering-role="story_message"]
- Tác giả: [data-ad-rendering-role="profile_name"]
- Permalink: <a href> /posts|permalink|multi_permalinks|story_fbid trong cùng container
"""
from __future__ import annotations

import logging
import random
import re
import threading
import time
import uuid
from typing import Any, Optional

from modules.module_10_group_scan.scan_common import (
    TERMINAL_STATUSES,
    close_account_session,
    interruptible_sleep,
    is_post_older_than_days,
    open_account_session,
    prune_jobs,
    resolve_group_identity,
    wait_while_paused,
)

logger = logging.getLogger(__name__)

_post_jobs: dict[str, dict[str, Any]] = {}
_post_jobs_lock = threading.Lock()

# ---------------------------------------------------------------------------
# DOM scrape — theo selector user gửi (aria-posinset / story_message / profile_name)
# ---------------------------------------------------------------------------
SCRAPE_POSTS_READY = True
SCRAPE_POSTS_JS = """
return (() => {
  // v11: luôn ưu tiên URL dạng /groups/{gid}/permalink/{postId}/
  // Feed Chronological hay ẩn href /posts — đào ID số trong HTML, loại user id + group id.
  const clean = (t) => (t || '').replace(/\\s+/g, ' ').trim();
  const absUrl = (href) => {
    if (!href) return '';
    if (href.startsWith('http')) return href;
    if (href.startsWith('/')) return 'https://www.facebook.com' + href;
    return href;
  };
  const gidFromLoc = () => (location.pathname.match(/\\/groups\\/([^/]+)/) || [])[1] || '';
  // URL đang mở có thể dùng slug (tên nhóm) trong khi link bài dùng ID số → khi đó không so được.
  const sameGroup = (part, gid) => {
    if (!gid) return true;
    if (String(part).toLowerCase() === String(gid).toLowerCase()) return true;
    return !/^\\d+$/.test(String(gid));
  };
  const permalinkUrl = (gid, id) => {
    if (!gid || !id) return '';
    // Chuẩn user cần: /groups/{gid}/permalink/{id}/
    if (String(id).startsWith('pfbid')) {
      return absUrl('/groups/' + gid + '/posts/' + id + '/');
    }
    return absUrl('/groups/' + gid + '/permalink/' + id + '/');
  };

  const parsePermFromHref = (rawHref, gid) => {
    if (!rawHref) return null;
    const raw = String(rawHref)
      .replace(/&amp;/g, '&')
      .replace(/\\\\u002F/g, '/')
      .replace(/%2F/gi, '/')
      .replace(/\\\\u00253D/g, '=');
    // Chỉ nhận link bài của CHÍNH nhóm đang quét (tránh bài được share từ nhóm khác).
    let m = raw.match(/\\/groups\\/([^/?#]+)\\/(?:posts|permalink)\\/(pfbid[\\w]+|\\d{6,})/i);
    if (m && sameGroup(m[1], gid)) return { id: m[2], url: permalinkUrl(gid, m[2]), source: 'href-path' };
    m = raw.match(/\\/groups\\/([^/?#]+)\\/?\\?[^#]*multi_permalinks=(\\d{6,})/i);
    if (m && sameGroup(m[1], gid)) return { id: m[2], url: permalinkUrl(gid, m[2]), source: 'href-multi' };
    return null;
  };

  const scopeForLinks = (root) => {
    let p = root;
    for (let i = 0; i < 10 && p; i++) {
      const role = (p.getAttribute && p.getAttribute('role')) || '';
      if (role === 'article') return p;
      p = p.parentElement;
    }
    return root;
  };

  const collectBannedIds = (scope, gid, authorUid) => {
    const ban = new Set();
    if (gid) ban.add(String(gid));
    if (authorUid) ban.add(String(authorUid));
    scope.querySelectorAll('a[href*="/user/"], a[href*="profile.php"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      let m = href.match(/\\/user\\/(\\d+)/i) || href.match(/[?&]id=(\\d+)/i);
      if (m) ban.add(m[1]);
    });
    return ban;
  };

  const decodeHtmlBlob = (html) => String(html || '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\\\\u002F/g, '/')
    .replace(/\\\\u00253D/g, '=')
    .replace(/%2F/gi, '/')
    .replace(/%3D/gi, '=')
    .replace(/\\\\"/g, '"')
    .replace(/\\\\\\//g, '/');

  const extractIdFromHtml = (html, gid, banned) => {
    if (!html) return null;
    const text = decodeHtmlBlob(html);
    // Chỉ các dấu hiệu chắc chắn là ID của CHÍNH bài này. Không đoán theo "số dài nhất / xuất hiện nhiều nhất":
    // cách đó từng lấy nhầm ID ảnh / số rác (vd 5018518518518518) → link bài không mở được.
    const pathRe = /\\/groups\\/([^/"'\\\\?#]+)\\/(?:posts|permalink)\\/(pfbid[\\w]+|\\d{6,})/ig;
    let m;
    while ((m = pathRe.exec(text)) !== null) {
      if (sameGroup(m[1], gid) && !banned.has(String(m[2]))) {
        return { id: m[2], url: permalinkUrl(gid, m[2]), source: 'html-path' };
      }
    }
    m = text.match(/"top_level_post_id"\\s*:\\s*"(\\d{10,})"/i);
    if (m && !banned.has(String(m[1]))) return { id: m[1], url: permalinkUrl(gid, m[1]), source: 'json-top' };
    return null;
  };

  const resolveTimeLink = (scope, gid) => {
    const anchors = Array.from(scope.querySelectorAll('a[href], a[role="link"]'));
    for (const a of anchors) {
      const t = clean(a.innerText || a.getAttribute('aria-label') || '');
      if (!t || t.length > 48) continue;
      if (!/(\\d+\\s*(giây|phút|giờ|ngày|tuần|tháng|năm|s|m|h|d|w)|vừa xong|yesterday|ago|a day|\\d+d\\b)/i.test(t)) {
        continue;
      }
      try {
        a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        a.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      } catch (e) {}
      for (const h of [a.getAttribute('href') || '', a.href || '']) {
        const perm = parsePermFromHref(h, gid);
        if (perm) return { ...perm, source: 'time-link' };
      }
    }
    return null;
  };

  const extractPermalink = (root, authorUid) => {
    const scope = scopeForLinks(root);
    const gid = gidFromLoc();
    const banned = collectBannedIds(scope, gid, authorUid);
    const samples = [];
    const links = scope.querySelectorAll('a[href], a[role="link"]');
    for (const a of links) {
      const raw = a.getAttribute('href') || '';
      const prop = a.href || '';
      if (raw && samples.length < 8) samples.push(raw.slice(0, 140));
      let perm = parsePermFromHref(raw, gid) || parsePermFromHref(prop, gid);
      if (perm && !banned.has(String(perm.id))) return { ...perm, samples };
    }

    let found = resolveTimeLink(scope, gid);
    if (found && !banned.has(String(found.id))) return { ...found, samples };

    const htmlScope = scope.outerHTML || scope.innerHTML || '';
    found = extractIdFromHtml(htmlScope, gid, banned);
    if (found) return { ...found, samples };
    if (scope !== root) {
      found = extractIdFromHtml(root.outerHTML || root.innerHTML || '', gid, banned);
      if (found) return { ...found, samples };
    }

    return { id: '', url: '', samples, source: 'none' };
  };

  const authorFrom = (root) => {
    const box = root.querySelector('[data-ad-rendering-role="profile_name"]');
    if (!box) return { name: '', uid: '', url: '' };
    let name = clean(box.innerText || '');
    // Bỏ đuôi "· Follow" / "· Đang theo dõi"
    name = name.replace(/\\s*[·•].*$/, '').trim();
    const a = box.querySelector('a[href]');
    let url = a ? absUrl((a.getAttribute('href') || '').split('?')[0]) : '';
    let uid = '';
    if (url) {
      let m = url.match(/\\/user\\/(\\d+)/i) || url.match(/profile\\.php\\?id=(\\d+)/i) || url.match(/[?&]id=(\\d+)/);
      if (m) uid = m[1];
    }
    return { name: name || '', uid, url };
  };

  const contentFrom = (root) => {
    const box = root.querySelector('[data-ad-rendering-role="story_message"]');
    return clean(box ? (box.innerText || '') : '');
  };

  const parseCount = (str) => {
    if (!str) return 0;
    const s = String(str).trim().toLowerCase();
    const m = s.match(/([0-9.,]+)\\s*([kmtr])?/);
    if (!m) return 0;
    let n = parseFloat(m[1].replace(/,/g, '.'));
    const u = m[2];
    if (u === 'k') n *= 1000;
    if (u === 'm' || u === 'tr') n *= 1000000;
    return Math.round(n) || 0;
  };

  const metricsFrom = (root) => {
    let likes = 0, comments = 0, shares = 0;
    const nodes = root.querySelectorAll('[aria-label]');
    for (const el of nodes) {
      const lab = clean(el.getAttribute('aria-label') || '');
      if (!lab) continue;
      if (/^(all reactions|tất cả cảm xúc|reactions?):/i.test(lab) || /\\d+\\s*(reactions?|cảm xúc)/i.test(lab)) {
        likes = Math.max(likes, parseCount(lab));
      }
      if (/\\d+\\s*(comments?|bình luận)/i.test(lab)) {
        comments = Math.max(comments, parseCount(lab));
      }
      if (/\\d+\\s*(shares?|lượt chia sẻ|chia sẻ)/i.test(lab)) {
        shares = Math.max(shares, parseCount(lab));
      }
    }
    return { likes, comments, shares };
  };

  const TIME_RE = new RegExp(
    '^(' +
      '\\\\d+\\\\s*(giây|phút|giờ|tiếng|ngày|tuần|tháng|năm|secs?|mins?|hrs?|days?|wks?|weeks?|mos?|months?|yrs?|years?|s|m|h|d|w|y)(?=$|[\\\\s·,.])' +
      '|vừa xong|just now|hôm qua|yesterday|một ngày|a day' +
      '|\\\\d{1,2}\\\\s*tháng\\\\s*\\\\d{1,2}' +
      '|\\\\d{1,2}\\\\/\\\\d{1,2}' +
      '|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\\\.?\\\\s+\\\\d{1,2}' +
      '|\\\\d{1,2}\\\\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*' +
    ')',
    'i'
  );

  const postedTimeFrom = (root) => {
    const scope = scopeForLinks(root);
    const candidates = scope.querySelectorAll('a[href], span, abbr');
    for (const el of candidates) {
      const t = clean(el.getAttribute('title') || el.innerText || '');
      if (!t || t.length > 40) continue;
      if (TIME_RE.test(t)) return t;
    }
    return '';
  };

  const PINNED_RE = /(pinned post|bài viết đã ghim|bài viết được ghim|đã ghim|pinned by|ghim bởi)/i;
  const FEATURED_RE = /^(featured|nổi bật|đáng chú ý)$/i;
  const pinnedFrom = (root, content) => {
    const scope = scopeForLinks(root);
    for (const el of scope.querySelectorAll('[aria-label]')) {
      if (PINNED_RE.test(el.getAttribute('aria-label') || '')) return true;
    }
    // Chỉ xét phần đầu bài (trước nội dung), tránh khớp chữ trong thân bài.
    let head = scope.innerText || '';
    const cut = content ? head.indexOf(content.slice(0, 30)) : -1;
    head = cut > 0 ? head.slice(0, cut) : head.slice(0, 200);
    if (PINNED_RE.test(head)) return true;
    return head.split('\\n').some((line) => FEATURED_RE.test(clean(line)));
  };

  const roots = Array.from(document.querySelectorAll('[aria-posinset]'));
  const posts = [];
  const seen = new Set();
  let withMessage = 0, withName = 0, withPerm = 0, withFallback = 0, skippedEmpty = 0;
  let sampleHrefs = [];
  let idSources = {};

  for (const root of roots) {
    const pos = parseInt(root.getAttribute('aria-posinset') || '0', 10) || 0;
    const content = contentFrom(root);
    const author = authorFrom(root);
    if (content) withMessage += 1;
    if (author.name) withName += 1;

    // Cần ít nhất nội dung bài (tránh khung rác / comment unit)
    if (!content || content.length < 2) {
      skippedEmpty += 1;
      continue;
    }

    const permWrap = extractPermalink(root, author.uid || '');
    if (sampleHrefs.length === 0 && permWrap.samples && permWrap.samples.length) {
      sampleHrefs = permWrap.samples;
    }

    const gid = gidFromLoc();
    let postId = permWrap.id || '';
    let postUrl = permWrap.url || '';
    let idSource = permWrap.source || 'none';

    if (postId && postUrl) {
      // Chuẩn hóa về /permalink/{id}/ khi là ID số
      if (/^\\d{10,}$/.test(postId)) {
        postUrl = permalinkUrl(gid, postId);
      }
      withPerm += 1;
      root.removeAttribute('data-fbscan-missing');
      root.setAttribute('data-fbscan-done', '1');
    } else {
      // Chưa có link thật (Facebook chỉ gắn link vào mốc thời gian khi rê chuột):
      // đánh dấu để Python rê chuột thật rồi đọc lại; tuyệt đối không lưu link đoán.
      withFallback += 1;
      root.setAttribute('data-fbscan-missing', '1');
      continue;
    }
    idSources[idSource] = (idSources[idSource] || 0) + 1;

    if (seen.has(postId)) continue;
    seen.add(postId);

    const metrics = metricsFrom(root);
    posts.push({
      postId,
      postUrl,
      content,
      authorName: author.name || 'Ẩn danh',
      authorUid: author.uid || '',
      authorUrl: author.url || '',
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      postedTime: postedTimeFrom(root),
      isPinned: pinnedFrom(root, content),
      posinset: pos,
      idSource,
    });
  }

  posts.sort((a, b) => (a.posinset || 0) - (b.posinset || 0));

  return {
    posts,
    debug: {
      scrapeVersion: 12,
      ready: true,
      roots: roots.length,
      found: posts.length,
      withMessage,
      withName,
      withPerm,
      withFallback,
      skippedEmpty,
      idSources,
      sampleHrefs,
      href: location.href,
    },
  };
})();
"""

SCROLL_POSTS_JS = """
(() => {
  const feed = document.querySelector('[role="feed"]');
  const cands = [];
  if (feed) cands.push(feed);
  document.querySelectorAll('div, main, section').forEach((el) => {
    try {
      const s = window.getComputedStyle(el);
      const oy = s.overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay')
        && el.scrollHeight > el.clientHeight + 80
        && el.clientHeight > 180) {
        cands.push(el);
      }
    } catch (e) {}
  });
  cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  const target = cands[0];
  if (target) {
    target.scrollTop = (target.scrollTop || 0) + 1400;
    try { target.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e) {}
    return { type: 'container' };
  }
  window.scrollBy(0, 1400);
  return { type: 'window' };
})();
"""


# Facebook chỉ gắn link bài (/groups/{gid}/posts/{id}/) vào mốc thời gian SAU khi rê chuột.
# Chọn các thẻ <a> ở phần đầu bài (không phải tên tác giả / nội dung / ảnh) để rê chuột.
_PERMALINK_ANCHORS_FN = r"""
const fbscanAnchors = (root) => {
  let scope = root;
  for (let i = 0; i < 10 && scope; i++) {
    if (scope.getAttribute && scope.getAttribute('role') === 'article') break;
    scope = scope.parentElement;
  }
  scope = scope || root;
  const story = scope.querySelector('[data-ad-rendering-role="story_message"]');
  const prof = scope.querySelector('[data-ad-rendering-role="profile_name"]');
  const out = [];
  for (const a of scope.querySelectorAll('a')) {
    if (story && story.contains(a)) continue;
    if (prof && prof.contains(a)) continue;
    if (a.querySelector('img, image, video')) continue;
    const href = a.getAttribute('href') || '';
    if (/\/(user|hashtag|photo|watch|reel)s?\/|profile\.php|l\.facebook\.com|\/stories\//i.test(href)) continue;
    if (href && !/^#|\/posts\/|\/permalink\/|__cft__|^\/groups\/|facebook\.com\/groups\//i.test(href)) continue;
    const text = (a.innerText || a.textContent || '').trim();
    if (text.length > 40) continue;
    out.push(a);
    if (out.length >= 4) break;
  }
  return out;
};
"""

HOVER_PERMALINK_JS = r"""
return (() => {
""" + _PERMALINK_ANCHORS_FN + r"""
  let hovered = 0;
  for (const root of document.querySelectorAll('[aria-posinset]')) {
    if (root.getAttribute('data-fbscan-done') === '1') continue;
    for (const a of fbscanAnchors(root)) {
      for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
        try { a.dispatchEvent(new MouseEvent(type, { bubbles: type !== 'mouseenter' && type !== 'pointerenter' })); } catch (e) {}
      }
      try { a.focus({ preventScroll: true }); } catch (e) {}
      hovered += 1;
    }
  }
  return hovered;
})();
"""

PERMALINK_ANCHORS_JS = r"""
""" + _PERMALINK_ANCHORS_FN + r"""
return fbscanAnchors(arguments[0]);
"""

HOVER_WAIT_SEC = 0.8
REAL_HOVER_MAX_POSTS = 4


def _scrape_posts_with_hover(driver) -> Any:
    """Đọc feed sau khi đã rê chuột lên mốc thời gian để Facebook gắn link bài thật.

    1) Rê chuột giả lập (JS) lên mọi bài → chờ → đọc DOM.
    2) Bài vẫn chưa có link → rê chuột thật (Selenium) vài bài → chờ → đọc lại và gộp.
    """
    try:
        if driver.execute_script(HOVER_PERMALINK_JS):
            time.sleep(HOVER_WAIT_SEC)
    except Exception as exc:
        if _is_browser_dead_error(exc):
            raise
    payload = driver.execute_script(SCRAPE_POSTS_JS)
    missing = int(((payload or {}).get("debug") or {}).get("withFallback") or 0) if isinstance(payload, dict) else 0
    if not missing:
        return payload
    try:
        from selenium.webdriver.common.action_chains import ActionChains
        from selenium.webdriver.common.by import By

        hovered = 0
        for root in driver.find_elements(By.CSS_SELECTOR, '[data-fbscan-missing="1"]')[:REAL_HOVER_MAX_POSTS]:
            for anchor in (driver.execute_script(PERMALINK_ANCHORS_JS, root) or [])[:3]:
                try:
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", anchor)
                    ActionChains(driver).move_to_element(anchor).pause(0.25).perform()
                    hovered += 1
                except Exception:
                    continue
        if not hovered:
            return payload
        time.sleep(HOVER_WAIT_SEC)
        again = driver.execute_script(SCRAPE_POSTS_JS)
    except Exception as exc:
        if _is_browser_dead_error(exc):
            raise
        return payload
    if not isinstance(again, dict):
        return payload
    merged = {str(p.get("postId")): p for p in (payload.get("posts") or []) if isinstance(p, dict)}
    for p in again.get("posts") or []:
        if isinstance(p, dict) and str(p.get("postId")) not in merged:
            merged[str(p.get("postId"))] = p
    debug = dict(again.get("debug") or {})
    debug["realHovered"] = hovered
    return {"posts": sorted(merged.values(), key=lambda p: p.get("posinset") or 0), "debug": debug}


def _now_str() -> str:
    return time.strftime("%H:%M:%S")


def _is_browser_dead_error(exc: BaseException) -> bool:
    msg = str(exc or "").lower()
    name = type(exc).__name__.lower()
    keys = (
        "invalid session",
        "no such window",
        "chrome not reachable",
        "disconnected",
        "target window already closed",
        "web view not found",
        "session deleted",
        "browsing context",
    )
    return any(k in msg for k in keys) or any(k in name for k in ("invalidsession", "nosuchwindow"))


def _driver_alive(driver: Any) -> bool:
    if driver is None:
        return False
    try:
        _ = driver.current_url
        return True
    except Exception:
        return False


def _normalize_post_item(item: dict[str, Any], group_id: str) -> Optional[dict[str, Any]]:
    """Chuẩn hóa item thô từ SCRAPE_POSTS_JS.

    Ưu tiên permalink thật; nếu feed ẩn link thì chấp nhận fallback content-hash
    (postId bắt đầu bằng 'c' + URL ?scan_post=) khi có nội dung bài.
    """
    if not isinstance(item, dict):
        return None
    pid = str(item.get("postId") or item.get("post_id") or "").strip()
    url = str(item.get("postUrl") or item.get("post_url") or "").strip()
    content = str(item.get("content") or "").strip()
    if not pid or pid.startswith("local_"):
        return None
    if not url or not url.startswith("http"):
        return None
    ok_real = bool(
        re.search(r"/groups/[^/]+/posts/(?:pfbid[\w]+|\d+)", url, flags=re.I)
        or re.search(r"/groups/[^/]+/permalink/(?:pfbid[\w]+|\d+)", url, flags=re.I)
        or re.search(r"[?&]multi_permalinks=\d{6,}", url, flags=re.I)
        or re.search(r"[?&]story_fbid=\d{6,}", url, flags=re.I)
        or re.search(r"permalink\.php\?[^#]*story_fbid=\d{6,}", url, flags=re.I)
    )
    # Không nhận fallback ?scan_post= / hash cxxx — chỉ permalink/posts thật
    if not ok_real:
        return None
    if "/posts/" in url or "/permalink/" in url:
        url = url.split("?")[0]
    # Ép về dạng /permalink/{id}/ khi ID số (đúng yêu cầu mở thẳng bài)
    if re.fullmatch(r"\d{10,}", pid) and group_id:
        url = f"https://www.facebook.com/groups/{group_id}/permalink/{pid}/"
    out = dict(item)
    out["postId"] = pid
    out["post_id"] = pid
    out["postUrl"] = url
    out["post_url"] = url
    out.setdefault("groupId", group_id)
    return out


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


def _set_post_job(job_id: str, **kwargs: Any) -> None:
    with _post_jobs_lock:
        job = _post_jobs.get(job_id)
        if job is not None:
            job.update(kwargs)


def _get_post_control(job_id: str) -> str:
    with _post_jobs_lock:
        return (_post_jobs.get(job_id) or {}).get("control") or "run"


def set_post_scan_control(job_id: str, action: str, owner: Optional[str] = None) -> bool:
    action_clean = (action or "").strip().lower()
    if action_clean not in {"pause", "resume", "abort"}:
        return False
    with _post_jobs_lock:
        job = _post_jobs.get(job_id)
        if not job or job.get("owner") != owner:
            return False
        if job.get("status") in TERMINAL_STATUSES:
            return False
        if action_clean == "pause":
            job["control"] = "pause"
            job["status"] = "paused"
        elif action_clean == "resume":
            job["control"] = "run"
            job["status"] = "running"
        else:
            # Worker tự đặt trạng thái cuối (aborted) khi đã lưu xong.
            job["control"] = "abort"
            job["status"] = "stopping"
    labels = {"pause": "TẠM DỪNG", "resume": "TIẾP TỤC", "abort": "DỪNG"}
    _append_post_log(job_id, f"Lệnh điều khiển nhận được: {labels[action_clean]}", "warn")
    return True


def get_post_scan_status(job_id: str, owner: Optional[str] = None) -> Optional[dict[str, Any]]:
    with _post_jobs_lock:
        job = _post_jobs.get(job_id)
        if not job or job.get("owner") != owner:
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
            "scrape_ready": SCRAPE_POSTS_READY,
        }


def _is_post_older_than_days(posted_time_str: str, max_days: int) -> bool:
    """Giữ tên cũ cho code gọi ngoài; logic nằm ở scan_common."""
    return is_post_older_than_days(posted_time_str, max_days)


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
    uids = [str(u).strip() for u in (uids or []) if str(u).strip()]
    uids = list(dict.fromkeys(uids))
    if not uids:
        raise ValueError("Vui lòng chọn ít nhất 1 tài khoản thực thi")
    if not groups:
        raise ValueError("Vui lòng chọn ít nhất 1 nhóm mục tiêu")
    if len(groups) > 20:
        raise ValueError("Số lượng nhóm trong một phiên không được vượt quá 20 nhóm")

    prune_jobs(_post_jobs, _post_jobs_lock)
    job_id = f"GPS-{int(time.time())}-{uuid.uuid4().hex[:6]}"

    dmin = max(1.0, min(3600.0, float(delay_min)))
    dmax = max(dmin, min(3600.0, float(delay_max)))
    limit_y = max(1, min(100, int(posts_limit)))
    switch_x = max(1, min(100, int(switch_acc_threshold)))
    days_z = max(0, min(365, int(days_limit)))  # 0 = không lọc theo ngày

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

        cfg_str = json.dumps(
            {
                "accounts_count": len(uids),
                "groups_count": len(groups),
                "delay": f"{dmin:.0f} - {dmax:.0f}s",
                "switch_after_posts": switch_x,
                "posts_limit": limit_y,
                "days_limit": days_z,
                "skip_pinned_posts": skip_pinned_posts,
                "auto_dedupe_posts": auto_dedupe_posts,
            },
            ensure_ascii=False,
        )

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
        logger.warning("Failed to record post scan session: %s", exc)

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
        "scrape_ready": SCRAPE_POSTS_READY,
    }


OLD_POST_STREAK_STOP = 5


def filter_post_rows(
    raw_items: list[dict[str, Any]],
    *,
    group_id: str,
    group_seen: set[str],
    cross_seen: set[str],
    skip_pinned: bool,
    auto_dedupe: bool,
    days_limit: int,
    remaining: int,
    stats: dict[str, int],
    today=None,
) -> list[dict[str, Any]]:
    """Lọc một lượt DOM bài viết. Luôn bỏ trùng trong cùng nhóm; `auto_dedupe` bỏ thêm bài
    đã có trong CSDL. stats["old_streak"] đếm số bài cũ liên tiếp (feed xếp theo thời gian)."""
    kept: list[dict[str, Any]] = []
    for raw in raw_items or []:
        if len(kept) >= remaining:
            break
        item = _normalize_post_item(raw, group_id)
        if not item:
            continue
        pid = str(item.get("postId") or "").strip()
        if not pid or pid in group_seen:
            continue
        group_seen.add(pid)
        pinned = bool(item.get("isPinned"))
        if skip_pinned and pinned:
            stats["pinned"] = stats.get("pinned", 0) + 1
            continue
        if days_limit > 0 and is_post_older_than_days(item.get("postedTime") or "", days_limit, today=today):
            stats["old"] = stats.get("old", 0) + 1
            if not pinned:
                stats["old_streak"] = stats.get("old_streak", 0) + 1
            continue
        if not pinned:
            stats["old_streak"] = 0
        if auto_dedupe and pid in cross_seen:
            stats["dup"] = stats.get("dup", 0) + 1
            continue
        cross_seen.add(pid)
        kept.append(item)
    return kept


def _run_post_scan_worker(job_id: str) -> None:
    from modules.module_02_account_manager.context import owner_scope

    with _post_jobs_lock:
        job = _post_jobs.get(job_id)
        owner = job.get("owner") if job else None
    if not job:
        return
    # Khoá profile + thư mục Chrome của Module 02 phụ thuộc owner hiện tại.
    with owner_scope(owner):
        _post_scan_body(job_id)


def _post_scan_body(job_id: str) -> None:
    from modules.module_10_group_scan.models import (
        list_known_post_ids,
        update_scan_session,
        upsert_scanned_group_post,
    )

    with _post_jobs_lock:
        job = _post_jobs[job_id]
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

    def log(message: str, level: str = "info") -> None:
        _append_post_log(job_id, message, level)

    def control() -> str:
        return _get_post_control(job_id)

    def stop_requested() -> bool:
        return control() == "abort"

    def handle_pause() -> bool:
        if control() != "pause":
            return control() == "abort"
        log("⏸️ Đã tạm dừng. Bấm Tiếp tục để chạy tiếp.", "warn")
        if wait_while_paused(control):
            if control() == "pause":
                log("⚠️ Tạm dừng quá 2 giờ — tự kết thúc phiên.", "warn")
                _set_post_job(job_id, control="abort")
            return True
        log("▶️ Tiếp tục quét…", "info")
        return False

    log(f"Khởi động phiên quét bài viết cho {len(target_groups)} nhóm với {len(uids)} tài khoản.", "success")

    cross_seen: set[str] = set()
    if auto_dedupe_posts:
        try:
            cross_seen = set(list_known_post_ids(owner))
            log(f"Đã nạp {len(cross_seen)} Post ID từ CSDL để lọc trùng chéo.", "info")
        except Exception as exc:
            log(f"Lỗi khi đọc Post ID CSDL: {exc}", "warn")

    all_scanned: list[dict[str, Any]] = []
    session: Optional[dict[str, Any]] = None
    account_index = 0
    posts_with_acc = 0
    final_status = "done"
    error_text = ""

    def rotate() -> bool:
        """Mở nick kế tiếp; nick cũ chỉ bị đóng khi nick mới đã vào được."""
        nonlocal session, account_index, posts_with_acc
        if session is not None and len(uids) <= 1:
            posts_with_acc = 0
            return True
        exclude = {session["uid"]} if session else set()
        fresh = open_account_session(
            uids, account_index, owner=owner, scope="group-posts", log=log,
            exclude=exclude, should_stop=stop_requested,
        )
        if fresh:
            close_account_session(session)
            session = fresh
            account_index = fresh["next_index"]
            posts_with_acc = 0
            _set_post_job(job_id, current_account=fresh["uid"])
            return True
        if session is not None:
            log("⚠️ Không đổi được sang nick khác — tiếp tục dùng nick hiện tại.", "warn")
            posts_with_acc = 0
            return True
        return False

    def open_group(group_url: str, group_id: str, group_name: str) -> bool:
        driver = session["driver"]
        target_url = f"{group_url}/?sorting_setting=CHRONOLOGICAL"
        try:
            driver.get(target_url)
        except Exception as exc:
            log(f"Lỗi truy cập {target_url}: {exc}", "warn")
            try:
                driver.get(f"{group_url}/")
            except Exception:
                return False
        if interruptible_sleep(random.uniform(5.0, 7.0), control):
            return False
        try:
            sample = driver.execute_script(
                "return (document.body ? document.body.innerText : '').slice(0, 500).toLowerCase();"
            ) or ""
            if "this page isn't available" in sample or "trang này hiện không khả dụng" in sample:
                log("URL sắp xếp theo thời gian không mở được, chuyển trang thảo luận chung…", "warn")
                driver.get(f"{group_url}/")
                interruptible_sleep(random.uniform(3.5, 5.0), control)
        except Exception:
            pass
        landed = ""
        try:
            landed = str(driver.current_url or "")
        except Exception:
            pass
        if group_id and group_id.lower() in landed.lower():
            log(f"[OK] Đã vào nhóm «{group_name}» (ID={group_id}).", "success")
        else:
            log(f"[WARN] URL hiện tại có thể lệch nhóm: {landed or '(trống)'} | kỳ vọng ID={group_id}", "warn")
        return True

    try:
        for grp_idx, grp in enumerate(target_groups):
            if handle_pause():
                break

            group_id, group_name, group_url = resolve_group_identity(grp, owner)
            if not group_id:
                log(f"⚠️ Bỏ qua nhóm «{group_name}»: không tìm thấy đường dẫn Facebook hợp lệ.", "warn")
                continue
            _set_post_job(job_id, current_group=group_name)

            if session is None or posts_with_acc >= switch_acc_threshold:
                if session is not None:
                    log(f"[ROTATE] Nick {session['uid']} đã quét {posts_with_acc} bài — đổi nick…", "info")
                if not rotate():
                    if stop_requested():
                        break
                    error_text = "Không có tài khoản nào trong pool mở được Chrome và đăng nhập Facebook."
                    log(f"❌ {error_text}", "error")
                    final_status = "error"
                    break

            log(f"[{grp_idx + 1}/{len(target_groups)}] Vào nhóm «{group_name}» bằng nick {session['uid']}…", "info")
            if not open_group(group_url, group_id, group_name):
                if stop_requested():
                    break
                continue

            group_posts: list[dict[str, Any]] = []
            group_seen: set[str] = set()
            stats: dict[str, int] = {}
            buffer: list[dict[str, Any]] = []
            stuck_rounds = 0
            stopped = False
            first_round = True

            def flush() -> None:
                if not buffer:
                    return
                saved = 0
                for rec in buffer:
                    if upsert_scanned_group_post(
                        owner=owner, group_id=group_id, post=rec,
                        group_name=group_name, group_url=group_url, session_id=job_id,
                    ):
                        saved += 1
                log(f"[Checkpoint] Lưu {saved}/{len(buffer)} bài mới của «{group_name}» vào CSDL.", "info")
                buffer.clear()

            for _round in range(60):
                if handle_pause():
                    stopped = True
                    break
                if len(group_posts) >= posts_limit:
                    log(f"Đã đạt hạn mức {posts_limit} bài cho nhóm «{group_name}».", "success")
                    break

                driver = session["driver"]
                if not _driver_alive(driver):
                    log("Chrome đã bị đóng thủ công. Dừng phiên quét.", "warn")
                    _set_post_job(job_id, control="abort")
                    stopped = True
                    break

                try:
                    payload = _scrape_posts_with_hover(driver)
                except Exception as exc:
                    if _is_browser_dead_error(exc):
                        log("Chrome đã đóng / mất session. Dừng phiên quét.", "warn")
                        _set_post_job(job_id, control="abort")
                        stopped = True
                        break
                    log(f"Lỗi chạy SCRAPE_POSTS_JS: {exc}", "warn")
                    payload = None

                raw_items: list[dict[str, Any]] = []
                debug_info: dict[str, Any] = {}
                if isinstance(payload, dict):
                    raw_items = payload.get("posts") or []
                    debug_info = payload.get("debug") or {}
                elif isinstance(payload, list):
                    raw_items = payload
                if first_round:
                    first_round = False
                    log(
                        f"DOM bài viết v{debug_info.get('scrapeVersion', '?')}: roots={debug_info.get('roots', '?')}, "
                        f"có link={debug_info.get('withPerm', '?')}, chưa lấy được link={debug_info.get('withFallback', '?')}, "
                        f"nguồn ID={debug_info.get('idSources', {})}",
                        "info" if raw_items else "warn",
                    )

                seen_before = len(group_seen)
                kept = filter_post_rows(
                    raw_items,
                    group_id=group_id,
                    group_seen=group_seen,
                    cross_seen=cross_seen,
                    skip_pinned=skip_pinned_posts,
                    auto_dedupe=auto_dedupe_posts,
                    days_limit=days_limit,
                    remaining=posts_limit - len(group_posts),
                    stats=stats,
                )
                for item in kept:
                    posted = str(item.get("postedTime") or "").strip()
                    rec = {
                        "group_id": group_id,
                        "group_name": group_name,
                        "group_url": group_url,
                        "post_id": item["postId"],
                        "postId": item["postId"],
                        "post_url": item.get("postUrl") or "",
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
                        "posted_at": posted,
                        "postedTime": posted,
                        "is_pinned": bool(item.get("isPinned")),
                        "session_id": job_id,
                    }
                    group_posts.append(rec)
                    buffer.append(rec)
                posts_with_acc += len(kept)

                with _post_jobs_lock:
                    if job_id in _post_jobs:
                        _post_jobs[job_id]["posts"] = all_scanned + group_posts
                if len(buffer) >= 10:
                    flush()

                if kept:
                    last = group_posts[-1]
                    snippet = (last["content"][:45] + "...") if len(last["content"]) > 45 else (last["content"] or "Ảnh/Video")
                    log(f"Thu thập: «{snippet}» | Nhóm: {len(group_posts)}/{posts_limit}.", "success")

                if days_limit > 0 and stats.get("old_streak", 0) >= OLD_POST_STREAK_STOP:
                    log(f"Gặp {OLD_POST_STREAK_STOP} bài liên tiếp cũ hơn {days_limit} ngày — dừng cuộn nhóm «{group_name}».", "info")
                    break

                if len(group_seen) > seen_before:
                    stuck_rounds = 0
                else:
                    stuck_rounds += 1
                    if stuck_rounds >= 10:
                        log(f"Đã cuộn hết bài viết nhóm «{group_name}».", "info")
                        break

                if posts_with_acc >= switch_acc_threshold and len(uids) > 1 and len(group_posts) < posts_limit:
                    log(f"[ROTATE] Nick {session['uid']} đạt {switch_acc_threshold} bài — đổi nick và quét tiếp nhóm này.", "info")
                    flush()
                    old_uid = session["uid"]
                    rotate()
                    if stop_requested():
                        stopped = True
                        break
                    if session["uid"] != old_uid:
                        if not open_group(group_url, group_id, group_name):
                            stopped = stop_requested()
                            break
                        stuck_rounds = 0
                        first_round = True
                        continue

                try:
                    driver.execute_script(SCROLL_POSTS_JS)
                except Exception:
                    try:
                        driver.execute_script("window.scrollBy(0, 1200);")
                    except Exception:
                        pass
                if interruptible_sleep(random.uniform(dmin, dmax) * random.uniform(0.4, 0.6), control):
                    stopped = True
                    break

            flush()
            all_scanned.extend(group_posts)
            _set_post_job(job_id, groups_done=grp_idx + 1, posts=list(all_scanned))
            skipped = []
            if stats.get("pinned"):
                skipped.append(f"{stats['pinned']} bài ghim")
            if stats.get("old"):
                skipped.append(f"{stats['old']} bài cũ hơn {days_limit} ngày")
            if stats.get("dup"):
                skipped.append(f"{stats['dup']} trùng")
            log(
                f"Hoàn thành nhóm «{group_name}»: {len(group_posts)} bài viết"
                + (f" (bỏ {', '.join(skipped)})" if skipped else "") + ".",
                "success",
            )
            if stopped or stop_requested():
                break

            if grp_idx < len(target_groups) - 1:
                group_delay = random.uniform(dmin, dmax)
                log(f"Nghỉ {group_delay:.1f}s trước khi chuyển nhóm kế tiếp…", "info")
                if interruptible_sleep(group_delay, control):
                    break

        if final_status != "error" and stop_requested():
            final_status = "aborted"
    except Exception as exc:
        logger.exception("Post scan worker uncaught exception: %s", exc)
        final_status = "error"
        error_text = str(exc)
        log(f"Lỗi nghiêm trọng trong phiên quét: {exc}", "error")
    finally:
        # Giữ Chrome mở để người dùng xem lại nhóm; vẫn nhả khoá profile.
        close_account_session(session, quit_browser=False)
        log(
            f"Phiên quét bài viết kết thúc ({final_status}). Tổng thu thập: {len(all_scanned)} bài viết.",
            "success" if final_status == "done" else "warn",
        )
        _set_post_job(job_id, status=final_status, error=error_text, finished_at=time.time(),
                      posts=list(all_scanned))
        with _post_jobs_lock:
            logs_snapshot = list((_post_jobs.get(job_id) or {}).get("logs") or [])
        try:
            update_scan_session(
                job_id,
                total_found=len(all_scanned),
                status={"done": "SUCCESS", "aborted": "ABORTED"}.get(final_status, "FAILED"),
                finished=True,
                logs=logs_snapshot,
            )
        except Exception as exc:
            logger.debug("Update post scan session error: %s", exc)
