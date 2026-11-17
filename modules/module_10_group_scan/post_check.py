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
    let m = raw.match(/\\/groups\\/[^/]+\\/(?:posts|permalink)\\/(pfbid[\\w]+|\\d+)/i);
    if (m) return { id: m[1], url: permalinkUrl(gid, m[1]), source: 'href-path' };
    m = raw.match(/[?&]multi_permalinks=(\\d{6,})/i);
    if (m) return { id: m[1], url: permalinkUrl(gid, m[1]), source: 'href-multi' };
    m = raw.match(/[?&]story_fbid=(\\d{6,})/i);
    if (m) return { id: m[1], url: permalinkUrl(gid, m[1]), source: 'href-story' };
    m = raw.match(/permalink\\.php\\?[^#]*story_fbid=(\\d{6,})/i);
    if (m) return { id: m[1], url: permalinkUrl(gid, m[1]), source: 'href-php' };
    m = raw.match(/\\/(?:posts|permalink)\\/(pfbid[\\w]+|\\d+)/i);
    if (m) return { id: m[1], url: permalinkUrl(gid, m[1]), source: 'href-loose' };
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
    const patterns = [
      [/\\/groups\\/[^/"'\\\\]+\\/(?:posts|permalink)\\/(pfbid[\\w]+|\\d+)/i, 'html-path'],
      [/multi_permalinks(?:=|%3D)(\\d{6,})/i, 'html-multi'],
      [/"top_level_post_id"\\s*:\\s*"(\\d{6,})"/i, 'json-top'],
      [/"post_id"\\s*:\\s*"(\\d{10,})"/i, 'json-post'],
      [/"story_fbid"\\s*:\\s*"(\\d{6,})"/i, 'json-story'],
      [/story_fbid(?:=|%3D)(\\d{6,})/i, 'html-story'],
      [/"id"\\s*:\\s*"(pfbid[\\w]+)"/i, 'json-pfbid'],
      [/subscription_target_id["\\s:]+["']?(\\d{10,})/i, 'json-sub'],
      [/"legacy_story_id"[\\s:]+"(\\d{10,})"/i, 'json-legacy'],
    ];
    for (const [re, source] of patterns) {
      const m = text.match(re);
      if (!m) continue;
      const id = m[1];
      if (!id || banned.has(String(id))) continue;
      if (/^\\d+$/.test(id) && id.length < 10) continue;
      return { id, url: permalinkUrl(gid, id), source };
    }
    return null;
  };

  // Heuristic: ID số dài trong HTML khung bài, không phải user/group id
  const extractNumericCandidate = (html, gid, banned) => {
    const text = decodeHtmlBlob(html);
    const counts = new Map();
    const re = /\\b(\\d{14,18})\\b/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const id = m[1];
      if (banned.has(id) || id === String(gid)) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    if (!counts.size) return null;
    // Ưu tiên ID xuất hiện nhiều lần; nếu hòa thì ID dài hơn
    let best = null;
    let bestScore = -1;
    for (const [id, cnt] of counts.entries()) {
      const score = cnt * 10 + id.length;
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (!best) return null;
    return { id: best, url: permalinkUrl(gid, best), source: 'numeric-heuristic' };
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

    found = extractNumericCandidate(htmlScope, gid, banned);
    if (found) return { ...found, samples };
    if (scope !== root) {
      found = extractNumericCandidate(root.outerHTML || root.innerHTML || '', gid, banned);
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

  const postedTimeFrom = (root) => {
    const scope = scopeForLinks(root);
    const candidates = scope.querySelectorAll('a[href], span, abbr');
    for (const el of candidates) {
      const t = clean(el.getAttribute('title') || el.innerText || '');
      if (!t || t.length > 32) continue;
      if (/^(\\d+\\s*(giây|phút|giờ|ngày|tuần|tháng|năm|s|m|h|d|w)|vừa xong|yesterday|yesterday|một ngày|a day|\\d+\\s*days?)/i.test(t)) {
        return t;
      }
    }
    return '';
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
    } else {
      // Không lưu link giả ?scan_post= nữa — bỏ bài nếu không ra được permalink thật
      withFallback += 1;
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
      isPinned: false,
      posinset: pos,
      idSource,
    });
  }

  posts.sort((a, b) => (a.posinset || 0) - (b.posinset || 0));

  return {
    posts,
    debug: {
      scrapeVersion: 11,
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
            "scrape_ready": SCRAPE_POSTS_READY,
        }


def _is_post_older_than_days(posted_time_str: str, max_days: int) -> bool:
    if not posted_time_str or max_days <= 0:
        return False
    raw = posted_time_str.lower().strip()
    if any(k in raw for k in ["vừa xong", "phút", "m", "giờ", "h", "tiếng"]):
        return False
    m_days = re.search(r"(\d+)\s*(?:ngày|d|days?)", raw)
    if m_days:
        return int(m_days.group(1)) > max_days
    m_weeks = re.search(r"(\d+)\s*(?:tuần|w|weeks?)", raw)
    if m_weeks:
        return int(m_weeks.group(1)) * 7 > max_days
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
                "scrape_ready": SCRAPE_POSTS_READY,
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


def _resolve_group_identity(grp: dict[str, Any]) -> tuple[str, str, str]:
    """Trả về (group_id, group_name, raw_url) hợp lệ Facebook."""
    raw_url = str(grp.get("url") or grp.get("group_url") or grp.get("href") or "").strip()
    group_id = str(grp.get("group_id") or grp.get("groupId") or grp.get("uid") or "").strip()
    group_name = str(grp.get("name") or grp.get("group_name") or "").strip()
    raw_id = str(grp.get("id") or grp.get("dbId") or "").strip()

    url_slug = ""
    if raw_url and "/groups/" in raw_url:
        url_slug = raw_url.split("/groups/")[-1].split("/")[0].split("?")[0].strip()

    is_group_id_db_id = bool(group_id.isdigit() and len(group_id) < 8)
    is_slug_db_id = bool(url_slug.isdigit() and len(url_slug) < 8)
    is_raw_id_valid = bool(raw_id.isdigit())
    need_db_lookup = (
        is_group_id_db_id
        or is_slug_db_id
        or not group_id
        or not raw_url
        or (raw_id and group_id == raw_id and is_raw_id_valid)
    )

    if need_db_lookup:
        try:
            from core.database.connection import db

            lookup_int = (
                int(raw_id)
                if is_raw_id_valid
                else (
                    int(group_id)
                    if is_group_id_db_id
                    else (int(url_slug) if is_slug_db_id else -1)
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
            logger.warning("Failed to lookup real group_id: %s", exc)

    if (not group_id or (group_id.isdigit() and len(group_id) < 8)) and raw_url and "/groups/" in raw_url:
        candidate_slug = raw_url.split("/groups/")[-1].split("/")[0].split("?")[0].strip()
        if candidate_slug and not (candidate_slug.isdigit() and len(candidate_slug) < 8):
            group_id = candidate_slug

    if raw_url and re.search(r"/groups/\d{1,7}(?:[/?#]|$)", raw_url):
        if group_id and not (group_id.isdigit() and len(group_id) < 8):
            raw_url = f"https://www.facebook.com/groups/{group_id}"
        else:
            raw_url = ""

    if not group_name:
        group_name = group_id or "Nhóm Facebook"
    return group_id, group_name, raw_url


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
    if SCRAPE_POSTS_READY and auto_dedupe_posts:
        try:
            known_db_posts = list_known_post_ids(owner)
            _append_post_log(
                job_id,
                f"Đã nạp {len(known_db_posts)} Post ID từ CSDL để lọc trùng chéo.",
                "info",
            )
        except Exception as exc:
            _append_post_log(job_id, f"Lỗi khi đọc Post ID CSDL: {exc}", "warn")

    seen_session_posts: set[str] = set(known_db_posts)
    all_scanned_posts: list[dict[str, Any]] = []
    keep_browser_open = False  # True khi chỉ test vào nick+nhóm, không tự tắt Chrome

    account_index = 0
    driver = None
    current_uid = None
    profile_lock = None
    posts_scanned_with_acc = 0

    def close_current_driver(*, force: bool = False):
        """force=True: quit Chrome + nhả lock. force=False + keep_browser_open: giữ Chrome, vẫn nhả lock."""
        nonlocal driver, profile_lock, current_uid, keep_browser_open
        if keep_browser_open and not force:
            # Chrome detach giữ mở cho user tự tắt — nhưng phải nhả lock
            # nếu không lần Start sau sẽ báo "tài khoản đang bận".
            driver = None
            if profile_lock:
                try:
                    profile_lock.release()
                except Exception:
                    pass
                profile_lock = None
            current_uid = None
            return
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

            group_id, group_name, raw_url = _resolve_group_identity(grp)
            raw_id = str(grp.get("id") or grp.get("dbId") or "").strip()

            if (group_id.isdigit() and len(group_id) < 8) or (not group_id and not raw_url):
                _append_post_log(
                    job_id,
                    f"⚠️ Bỏ qua nhóm «{group_name or 'ID ' + (group_id or raw_id)}»: "
                    f"Không tìm thấy đường dẫn Facebook hợp lệ trong CSDL (ID {group_id or raw_id}).",
                    "warn",
                )
                continue

            _set_post_job(job_id, current_group=group_name)

            need_switch_account = (
                driver is None
                or current_uid is None
                or posts_scanned_with_acc >= switch_acc_threshold
            )

            if need_switch_account:
                if driver:
                    _append_post_log(
                        job_id,
                        f"[ROTATE] Đã quét {posts_scanned_with_acc} bài với nick {current_uid}. Đổi tài khoản...",
                        "info",
                    )
                    close_current_driver(force=True)

                current_uid = uids[account_index % len(uids)]
                account_index += 1
                posts_scanned_with_acc = 0
                _set_post_job(job_id, current_account=current_uid)
                _append_post_log(job_id, f"Mở trình duyệt với tài khoản UID: {current_uid}...", "info")

                try:
                    profile_lock = get_profile_lock(current_uid)
                    acquired = False
                    for wait_try in range(3):
                        if profile_lock.acquire(timeout=15):
                            acquired = True
                            break
                        _append_post_log(
                            job_id,
                            f"Tài khoản {current_uid} đang bận (thử {wait_try + 1}/3, chờ lock)...",
                            "warn",
                        )
                    if not acquired:
                        _append_post_log(
                            job_id,
                            f"Bỏ qua nick {current_uid}: profile vẫn bận. "
                            "Hãy đóng hết Chrome profile nick này rồi Start lại.",
                            "error",
                        )
                        profile_lock = None
                        continue
                except Exception as exc:
                    _append_post_log(job_id, f"Lỗi khóa profile {current_uid}: {exc}", "error")
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
                        close_current_driver(force=True)
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
                            f"[ERROR] {current_uid} checkpoint/đăng nhập lỗi: {login_res.get('error')}. Đổi nick...",
                            "error",
                        )
                        close_current_driver(force=True)
                        continue
                    _append_post_log(
                        job_id,
                        f"[OK] Đã vào nick UID {current_uid} (đăng nhập thành công).",
                        "success",
                    )
                except Exception as exc:
                    _append_post_log(job_id, f"Lỗi khởi tạo Chrome cho {current_uid}: {exc}", "error")
                    close_current_driver(force=True)
                    continue

            base_group_url = (
                raw_url
                if (raw_url and "/groups/" in raw_url and not re.search(r"/groups/\d{1,7}(?:[/?#]|$)", raw_url))
                else f"https://www.facebook.com/groups/{group_id}"
            ).rstrip("/")
            target_url = f"{base_group_url}/?sorting_setting=CHRONOLOGICAL"
            _append_post_log(
                job_id,
                f"[{grp_idx + 1}/{len(target_groups)}] Đang vào nhóm đã chọn: «{group_name}» | ID={group_id} | URL={target_url}",
                "info",
            )

            try:
                driver.get(target_url)
                human_sleep(5.0, 7.0)
            except Exception as exc:
                _append_post_log(job_id, f"Lỗi truy cập {target_url}: {exc}", "warn")
                try:
                    target_url = f"{base_group_url}/"
                    driver.get(target_url)
                    human_sleep(5.0, 7.0)
                except Exception:
                    continue

            try:
                page_text_sample = (
                    driver.execute_script(
                        "return (document.body ? document.body.innerText : '').slice(0, 500).toLowerCase();"
                    )
                    or ""
                )
                if "this page isn't available" in page_text_sample or "trang này hiện không khả dụng" in page_text_sample:
                    _append_post_log(job_id, "URL sort không mở được, chuyển trang thảo luận chung...", "warn")
                    target_url = f"{base_group_url}/"
                    driver.get(target_url)
                    human_sleep(3.5, 5.0)
            except Exception:
                pass

            landed_url = ""
            try:
                landed_url = str(getattr(driver, "current_url", "") or "")
            except Exception:
                landed_url = ""
            if group_id and group_id in landed_url:
                _append_post_log(
                    job_id,
                    f"[OK] Đã vào đúng nhóm «{group_name}» (ID={group_id}). URL hiện tại: {landed_url}",
                    "success",
                )
            else:
                _append_post_log(
                    job_id,
                    f"[WARN] Đã mở trình duyệt nhưng URL hiện tại có thể lệch nhóm: {landed_url or '(trống)'} | kỳ vọng ID={group_id}",
                    "warn",
                )

            # Luôn giữ Chrome mở sau phiên — user tự tắt
            keep_browser_open = True

            # Chế độ test: chỉ vào nick + nhóm, giữ browser mở, không scrape / không tự tắt
            if not SCRAPE_POSTS_READY:
                keep_browser_open = True
                _set_post_job(job_id, groups_done=grp_idx + 1, status="holding")
                _append_post_log(
                    job_id,
                    f"Browser đang giữ mở tại nhóm «{group_name}». Bấm Dừng khi xong kiểm tra.",
                    "success",
                )
                while True:
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
                    time.sleep(2)
                break

            group_posts: list[dict[str, Any]] = []
            max_scroll_rounds = 40
            scroll_stuck_count = 0
            prev_found_count = 0
            checkpoint_buffer: list[dict[str, Any]] = []

            for _scroll_round in range(max_scroll_rounds):
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

                if not _driver_alive(driver):
                    _append_post_log(
                        job_id,
                        "Chrome đã bị đóng thủ công. Dừng phiên quét.",
                        "warn",
                    )
                    _set_post_job(job_id, control="abort", status="aborted")
                    break

                try:
                    scrape_payload = driver.execute_script(SCRAPE_POSTS_JS)
                except Exception as exc:
                    if _is_browser_dead_error(exc):
                        _append_post_log(
                            job_id,
                            "Chrome đã đóng / mất session. Dừng phiên quét.",
                            "warn",
                        )
                        _set_post_job(job_id, control="abort", status="aborted")
                        break
                    _append_post_log(job_id, f"Lỗi chạy SCRAPE_POSTS_JS: {exc}", "warn")
                    scrape_payload = None

                debug_info: dict[str, Any] = {}
                if scrape_payload is None:
                    raw_items = []
                elif isinstance(scrape_payload, list):
                    raw_items = scrape_payload
                elif isinstance(scrape_payload, dict):
                    raw_items = scrape_payload.get("posts") or []
                    debug_info = scrape_payload.get("debug") or {}
                else:
                    raw_items = []

                if _scroll_round == 0:
                    _append_post_log(
                        job_id,
                        (
                            f"DOM bài viết v{debug_info.get('scrapeVersion', '?')}: "
                            f"roots={debug_info.get('roots', '?')}, "
                            f"msg={debug_info.get('withMessage', '?')}, "
                            f"name={debug_info.get('withName', '?')}, "
                            f"perm={debug_info.get('withPerm', '?')}, "
                            f"fallback={debug_info.get('withFallback', '?')}, "
                            f"found={debug_info.get('found', len(raw_items))}, "
                            f"sources={debug_info.get('idSources', {})}"
                        ),
                        "info" if raw_items else "warn",
                    )

                new_in_round = 0
                for item in raw_items:
                    item = _normalize_post_item(item, group_id)
                    if not item:
                        continue
                    pid = str(item.get("postId") or "").strip()
                    if not pid:
                        continue
                    if skip_pinned_posts and item.get("isPinned"):
                        continue
                    if auto_dedupe_posts and pid in seen_session_posts:
                        continue
                    posted_time_raw = str(item.get("postedTime") or "").strip()
                    if days_limit > 0 and _is_post_older_than_days(posted_time_raw, days_limit):
                        continue

                    seen_session_posts.add(pid)
                    post_record = {
                        "group_id": group_id,
                        "group_name": group_name,
                        "group_url": f"https://www.facebook.com/groups/{group_id}",
                        "post_id": pid,
                        "postId": pid,
                        "post_url": item.get("postUrl") or item.get("post_url") or "",
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

                with _post_jobs_lock:
                    if job_id in _post_jobs:
                        _post_jobs[job_id]["posts"] = list(all_scanned_posts + group_posts)

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
                        f"[Checkpoint] Đã lưu {saved_batch} bài của «{group_name}» vào CSDL.",
                        "info",
                    )
                    checkpoint_buffer.clear()

                if new_in_round > 0:
                    last_p = group_posts[-1]
                    snippet = (
                        (last_p["content"][:45] + "...")
                        if len(last_p["content"]) > 45
                        else (last_p["content"] or "Ảnh/Video")
                    )
                    _append_post_log(
                        job_id,
                        f"Thu thập: «{snippet}» | Tổng nhóm: {len(group_posts)}/{posts_limit}.",
                        "success",
                    )
                    scroll_stuck_count = 0
                else:
                    if len(group_posts) == prev_found_count:
                        scroll_stuck_count += 1
                        if scroll_stuck_count >= 10:
                            _append_post_log(
                                job_id,
                                f"Đã cuộn đến cuối danh sách bài viết nhóm «{group_name}».",
                                "info",
                            )
                            break
                    else:
                        scroll_stuck_count = 0

                prev_found_count = len(group_posts)

                if posts_scanned_with_acc >= switch_acc_threshold and len(uids) > 1:
                    _append_post_log(
                        job_id,
                        f"[ROTATE] Nick {current_uid} đạt {switch_acc_threshold} bài. Đổi tài khoản...",
                        "info",
                    )
                    close_current_driver(force=True)
                    current_uid = uids[account_index % len(uids)]
                    account_index += 1
                    posts_scanned_with_acc = 0
                    _set_post_job(job_id, current_account=current_uid)
                    break

                try:
                    driver.execute_script(SCROLL_POSTS_JS)
                except Exception:
                    try:
                        driver.execute_script("window.scrollBy(0, 1200);")
                    except Exception:
                        pass

                sleep_sec = random.uniform(dmin, dmax)
                human_sleep(sleep_sec * 0.4, sleep_sec * 0.6)

            if checkpoint_buffer:
                for p_rec in checkpoint_buffer:
                    upsert_scanned_group_post(
                        owner=owner,
                        group_id=group_id,
                        post=p_rec,
                        group_name=group_name,
                        group_url=p_rec["group_url"],
                        session_id=job_id,
                    )
                checkpoint_buffer.clear()

            all_scanned_posts.extend(group_posts)
            _set_post_job(job_id, groups_done=grp_idx + 1, posts=list(all_scanned_posts))
            _append_post_log(
                job_id,
                f"Hoàn thành nhóm «{group_name}» với {len(group_posts)} bài viết thu thập được.",
                "success",
            )

            if grp_idx < len(target_groups) - 1:
                group_delay = random.uniform(dmin, dmax)
                _append_post_log(
                    job_id,
                    f"Nghỉ {group_delay:.1f}s trước khi chuyển nhóm kế tiếp...",
                    "info",
                )
                time.sleep(group_delay)

        final_status = "aborted" if _get_post_control(job_id) == "abort" else "done"
        keep_browser_open = True
        _set_post_job(job_id, status=final_status, finished_at=time.time())
        _append_post_log(
            job_id,
            f"Phiên quét bài viết hoàn tất. Tổng thu thập: {len(all_scanned_posts)} bài viết. Browser giữ mở — tự tắt khi xong.",
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
            logger.debug("Update post scan session error: %s", exc)

    except Exception as exc:
        logger.exception("Post scan worker uncaught exception: %s", exc)
        _set_post_job(job_id, status="error", error=str(exc))
        _append_post_log(job_id, f"Lỗi nghiêm trọng trong phiên quét: {exc}", "error")
        keep_browser_open = True
    finally:
        # Không tự tắt Chrome — user tự đóng
        close_current_driver(force=False)
