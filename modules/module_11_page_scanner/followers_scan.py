"""
Quét người theo dõi Page (job_type=FOLLOW).
Không click nút Follow/Theo dõi — chỉ mở dialog số followers hoặc fallback URL slug.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

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
from .page_source import extract_page_identifier
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

# Soft-fail reasons (plan)
REASON_DIALOG_NOT_FOUND = "followers_dialog_not_found"
REASON_LIST_PRIVATE = "followers_list_private"
REASON_CHECKPOINT = "checkpoint_or_login"
REASON_LIST_EXHAUSTED = "list_exhausted"
REASON_PROFILE_PHP = "profile_php_no_followers_url"
REASON_OK = "ok"

# Ưu tiên click TAB Followers (không cần số). Không click nút Follow/Theo dõi header.
_OPEN_FOLLOWERS_TAB_JS = r"""
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const isFollowAction = (el) => {
  const role = (el.getAttribute('role') || '').toLowerCase();
  const aria = (el.getAttribute('aria-label') || '').toLowerCase();
  const txt = norm(el.innerText || el.textContent).toLowerCase();
  if (/^(theo dõi|follow|following|đang theo dõi)$/i.test(txt)) return true;
  if (role === 'button' && /^(theo dõi|follow)$/i.test(txt) && !/\d/.test(txt)) return true;
  if (/\b(theo dõi|follow)\b/i.test(aria) && !/followers|người theo dõi/i.test(aria) && !/\d/.test(aria)) return true;
  return false;
};
// Tab label đúng: "Followers" / "Người theo dõi" — KHÔNG có số (đó là header text)
const isFollowersTabLabel = (t) => {
  const s = norm(t);
  if (!s || s.length > 40) return false;
  if (/[\d]/.test(s)) return false; // có số → header "408K followers", không phải tab
  return /^(followers|người\s*theo\s*dõi|nguoi\s*theo\s*doi)$/i.test(s);
};

const tryClick = (el, how) => {
  try {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.click();
    return { ok: true, text: norm(el.innerText || el.getAttribute('aria-label') || '').slice(0, 80), how };
  } catch (e) {
    return { ok: false, error: String(e), how };
  }
};

// 1) role=tab trong tablist
const tabs = Array.from(document.querySelectorAll('[role="tab"], [role="tablist"] [role="tab"], a[role="tab"]'));
for (const el of tabs) {
  if (isFollowAction(el)) continue;
  const t = el.innerText || el.getAttribute('aria-label') || '';
  if (!isFollowersTabLabel(t)) continue;
  return tryClick(el, 'role_tab');
}

// 2) Link/span trong thanh tab (All / About / Reels / Photos / Followers)
const candidates = Array.from(document.querySelectorAll(
  'a, span, div[role="link"], div[role="button"], div[tabindex="0"]'
));
for (const el of candidates) {
  if (isFollowAction(el)) continue;
  const t = el.innerText || el.getAttribute('aria-label') || '';
  if (!isFollowersTabLabel(t)) continue;
  // Ưu tiên phần tử gần tablist / nav
  const nearTab = el.closest('[role="tablist"], [role="navigation"], nav');
  const href = (el.getAttribute('href') || '').toLowerCase();
  if (nearTab || /\/followers\b/.test(href) || el.getAttribute('role') === 'tab') {
    return tryClick(el, nearTab ? 'near_tablist' : 'href_followers');
  }
}
// 3) Cùng label nhưng không gần tablist — vẫn thử (cuối)
for (const el of candidates) {
  if (isFollowAction(el)) continue;
  if (!isFollowersTabLabel(el.innerText || el.getAttribute('aria-label') || '')) continue;
  return tryClick(el, 'label_loose');
}
return { ok: false, error: 'no_followers_tab' };
"""

# Fallback cũ: click dòng số "X followers" (một số Page mở dialog). Chỉ dùng sau khi tab fail.
_OPEN_FOLLOWERS_COUNT_JS = r"""
const avoidFollowBtn = (el) => {
  const role = (el.getAttribute('role') || '').toLowerCase();
  const aria = (el.getAttribute('aria-label') || '').toLowerCase();
  const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (/^(theo dõi|follow|following|đang theo dõi)$/i.test(txt)) return true;
  if (/\b(theo dõi|follow)\b/i.test(aria) && !/\d/.test(aria) && !/người theo dõi|followers/i.test(aria)) return true;
  if (role === 'button' && /^(theo dõi|follow)$/i.test(txt) && !/\d/.test(txt)) return true;
  if (role === 'tab') return true; // tab xử lý riêng
  return false;
};
const labels = [/người\s*theo\s*dõi/i, /\bfollowers?\b/i];
const candidates = Array.from(document.querySelectorAll('a, span, div[role="link"], div[role="button"]'));
for (const el of candidates) {
  if (avoidFollowBtn(el)) continue;
  const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 80) continue;
  if (!labels.some((re) => re.test(t))) continue;
  if (!/[\d]/.test(t) && !/\b[nk]\b/i.test(t)) continue;
  try {
    el.scrollIntoView({ block: 'center' });
    el.click();
    return { ok: true, text: t.slice(0, 80) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
return { ok: false, error: 'no_followers_count_link' };
"""

_FOLLOWERS_VIEW_READY_JS = r"""
const url = (location.href || '').toLowerCase();
const onFollowersUrl = /\/followers\b/.test(url);
const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
let selectedTab = null;
for (const t of tabs) {
  const label = ((t.innerText || t.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
  const selected = t.getAttribute('aria-selected') === 'true' || t.getAttribute('aria-current') === 'page';
  if (/^(followers|người\s*theo\s*dõi)$/i.test(label) && selected) {
    selectedTab = label;
    break;
  }
}
const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((d) => {
  const r = d.getBoundingClientRect();
  return r.width > 80 && r.height > 80;
});
let followersDialog = false;
for (const d of dialogs) {
  const aria = d.getAttribute('aria-label') || '';
  const text = (d.innerText || '').slice(0, 200);
  if (/followers|người\s*theo\s*dõi/i.test(aria + ' ' + text)) { followersDialog = true; break; }
}
return {
  on_followers_url: onFollowersUrl,
  selected_followers_tab: selectedTab,
  followers_dialog: followersDialog,
  ready: !!(onFollowersUrl || selectedTab || followersDialog),
  url: location.href,
};
"""

# Chọn đúng khung list followers (tab panel / dialog) — không quét tab All / body lung tung.
_EXTRACT_FOLLOWERS_JS = r"""
const pickFollowersRoot = () => {
  const labelRe = /followers|người\s*theo\s*dõi|nguoi\s*theo\s*doi/i;
  const url = (location.href || '').toLowerCase();

  // 1) Dialog followers nếu có
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((d) => {
    const r = d.getBoundingClientRect();
    return r.width > 80 && r.height > 80;
  });
  for (const d of dialogs) {
    const aria = (d.getAttribute('aria-label') || '');
    if (labelRe.test(aria)) return { root: d, root_kind: 'followers_dialog' };
  }
  for (const d of dialogs) {
    if (labelRe.test((d.innerText || '').slice(0, 400))) return { root: d, root_kind: 'followers_dialog_text' };
  }

  // 2) Tab panel đang chọn khi tab Followers selected
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  for (const t of tabs) {
    const label = ((t.innerText || t.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
    const selected = t.getAttribute('aria-selected') === 'true' || t.getAttribute('aria-current') === 'page';
    if (!selected || !/^(followers|người\s*theo\s*dõi)$/i.test(label)) continue;
    const panelId = t.getAttribute('aria-controls');
    if (panelId) {
      const panel = document.getElementById(panelId);
      if (panel) return { root: panel, root_kind: 'followers_tabpanel' };
    }
    // Tab panel gần nhất / main
    const main = document.querySelector('[role="main"]') || document.body;
    return { root: main, root_kind: 'followers_tab_main' };
  }

  // 3) URL /followers → main content
  if (/\/followers\b/.test(url)) {
    const main = document.querySelector('[role="main"]') || document.body;
    return { root: main, root_kind: 'followers_url_main' };
  }

  // 4) Không chắc đang ở view followers → trả body nhưng đánh dấu unverified
  return { root: document.body, root_kind: 'body_unverified' };
};

const hrefToKey = (href) => {
  if (!href) return '';
  let h = href;
  if (h.startsWith('/')) h = 'https://www.facebook.com' + h;
  if (/\/(followers|following|friends_mutual|friends|photos|videos|reels|posts|about|reviews|live|shop|services)\b/i.test(h)) return '';
  if (/\/(login|watch|marketplace|gaming|events|groups|search|hashtag)\b/i.test(h)) return '';
  let m = h.match(/profile\.php\?id=(\d+)/i);
  if (m) return 'id:' + m[1];
  m = h.match(/facebook\.com\/(?:people\/[^/]+\/)?(\d{6,25})(?:[/?#]|$)/i);
  if (m) return 'id:' + m[1];
  m = h.match(/facebook\.com\/([A-Za-z0-9._-]{3,50})(?:[/?#]|$)/);
  if (m) {
    const slug = m[1].toLowerCase();
    if (!/^(profile\.php|people|pages|photo\.php)$/.test(slug)) return 'user:' + slug;
  }
  return '';
};

const { root, root_kind } = pickFollowersRoot();
const out = [];
const seen = new Set();
const nodes = Array.from(root.querySelectorAll(
  'a[href*="facebook.com/"], a[href^="/"], a[href*="profile.php"], div[role="link"], span[role="link"]'
));
let href_nodes = 0;
for (const el of nodes) {
  let href = el.getAttribute('href') || '';
  if (!href && el.querySelector) {
    const inner = el.querySelector('a[href]');
    if (inner) href = inner.getAttribute('href') || '';
  }
  if (!href) continue;
  href_nodes += 1;
  if (href.startsWith('/')) href = 'https://www.facebook.com' + href;
  const key = hrefToKey(href);
  if (!key || seen.has(key)) continue;
  let name = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  if ((!name || name.length > 120) && el.querySelector) {
    const named = el.querySelector('span[dir="auto"], strong, span');
    if (named) name = (named.innerText || '').replace(/\s+/g, ' ').trim();
  }
  if (!name || name.length > 120) continue;
  if (/^(người theo dõi|followers|following|bạn bè|friends|theo dõi|follow)$/i.test(name)) continue;
  seen.add(key);
  let avatar = null;
  const img = el.querySelector && (el.querySelector('img') || (el.parentElement && el.parentElement.querySelector('img')));
  if (img) avatar = img.getAttribute('src') || img.getAttribute('xlink:href') || null;
  out.push({
    follower_key: key,
    follower_name: name.slice(0, 120),
    profile_url: href.split('&')[0].split('#')[0],
    avatar_url: avatar,
  });
  if (out.length >= 80) break;
}
return {
  items: out,
  meta: {
    root_kind,
    dialog_count: document.querySelectorAll('[role="dialog"]').length,
    node_count: nodes.length,
    href_nodes,
    raw_count: out.length,
  },
};
"""

# Cuộn khung list lớn nhất trong view followers (tab panel / dialog) — không cuộn All.
_SCROLL_DIALOG_JS = r"""
const pickFollowersRoot = () => {
  const labelRe = /followers|người\s*theo\s*dõi|nguoi\s*theo\s*doi/i;
  const url = (location.href || '').toLowerCase();
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((d) => {
    const r = d.getBoundingClientRect();
    return r.width > 80 && r.height > 80;
  });
  for (const d of dialogs) {
    if (labelRe.test(d.getAttribute('aria-label') || '')) return d;
  }
  for (const d of dialogs) {
    if (labelRe.test((d.innerText || '').slice(0, 400))) return d;
  }
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  for (const t of tabs) {
    const label = ((t.innerText || t.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
    const selected = t.getAttribute('aria-selected') === 'true' || t.getAttribute('aria-current') === 'page';
    if (!selected || !/^(followers|người\s*theo\s*dõi)$/i.test(label)) continue;
    const panelId = t.getAttribute('aria-controls');
    if (panelId) {
      const panel = document.getElementById(panelId);
      if (panel) return panel;
    }
    return document.querySelector('[role="main"]') || document.body;
  }
  if (/\/followers\b/.test(url)) return document.querySelector('[role="main"]') || document.body;
  return document.body;
};
const root = pickFollowersRoot();
let best = null;
let bestDelta = 0;
const walk = [root, ...Array.from(root.querySelectorAll('div'))];
for (const d of walk) {
  const st = window.getComputedStyle(d);
  const oy = st.overflowY;
  if (!(oy === 'auto' || oy === 'scroll' || oy === 'overlay')) continue;
  const delta = d.scrollHeight - d.clientHeight;
  if (delta > bestDelta + 40) {
    bestDelta = delta;
    best = d;
  }
}
const el = best || root;
const before = { scrollTop: el.scrollTop || 0, scrollHeight: el.scrollHeight || 0, clientHeight: el.clientHeight || 0 };
el.scrollBy(0, Math.floor((el.clientHeight || 400) * 0.9) || 400);
const after = { scrollTop: el.scrollTop || 0, scrollHeight: el.scrollHeight || 0, clientHeight: el.clientHeight || 0 };
return {
  before,
  after,
  changed: after.scrollTop !== before.scrollTop || after.scrollHeight !== before.scrollHeight,
  used_best: !!best,
  best_delta: bestDelta,
  root_tag: root === document.body ? 'body' : (root.getAttribute('aria-label') || 'dialog').slice(0, 60),
};
"""

_DETECT_PRIVATE_JS = r"""
const body = (document.body && document.body.innerText) || '';
const dlg = document.querySelector('[role="dialog"]');
const t = ((dlg && dlg.innerText) || body).toLowerCase();
if (/chỉ\s*mình\s*bạn|only\s*you|this\s*content\s*isn.?t\s*available|nội dung không khả dụng|không\s*có\s*gì\s*để\s*xem/i.test(t)) {
  return 'private';
}
if (/checkpoint|confirm\s*your\s*identity|xác\s*nhận\s*danh\s*tính|log\s*in/i.test(t)
    && /facebook/i.test(location.href)) {
  if (/\/checkpoint\//i.test(location.href) || /login/i.test(location.href)) return 'checkpoint';
}
return null;
"""


def page_key_to_url(page_key: str, page_url: Optional[str] = None) -> str:
    if page_url and str(page_url).strip():
        return str(page_url).strip()
    key = (page_key or "").strip()
    if key.startswith("id:"):
        return f"https://www.facebook.com/profile.php?id={key[3:]}"
    if key.startswith("user:"):
        return f"https://www.facebook.com/{key[5:]}"
    if key.isdigit():
        return f"https://www.facebook.com/profile.php?id={key}"
    if key.startswith("http"):
        return key
    return f"https://www.facebook.com/{key.lstrip('/')}"


def resolve_page_url(owner_key: str, page_key: str) -> Tuple[str, Optional[str]]:
    """Trả (page_url, page_name) từ scanned_pages hoặc build từ key."""
    row = db.fetch_one(
        """
        SELECT page_url, page_name FROM scanned_pages
        WHERE owner_key = %s AND page_key = %s LIMIT 1
        """,
        (owner_key, page_key),
    )
    if row and row.get("page_url"):
        return str(row["page_url"]), row.get("page_name")
    return page_key_to_url(page_key), None


def can_build_followers_url(page_url: str, page_key: str) -> Tuple[bool, Optional[str]]:
    """
    Fallback /{slug}/followers chỉ khi có slug chữ.
    profile.php / id:… → không ghép URL.
    """
    key = (page_key or "").strip().lower()
    url = (page_url or "").strip().lower()
    if key.startswith("id:") or "profile.php?id=" in url:
        return False, REASON_PROFILE_PHP
    if key.startswith("user:"):
        slug = key[5:]
        if slug:
            return True, f"https://www.facebook.com/{slug}/followers"
    parsed = urlparse(page_url or "")
    parts = [p for p in (parsed.path or "").split("/") if p]
    if parts and re.match(r"^[A-Za-z0-9._-]{3,50}$", parts[0]) and parts[0].lower() not in (
        "profile.php",
        "pages",
        "people",
    ):
        return True, f"https://www.facebook.com/{parts[0]}/followers"
    return False, REASON_PROFILE_PHP


def normalize_follower_key_from_url(url: str) -> str:
    key, _ = extract_page_identifier(url or "")
    return key or ""


def extract_followers_from_html_fixture(html: str) -> List[Dict[str, Any]]:
    """
    Spike/offline: parse HTML fixture (không cần Selenium) — mirror logic JS.
    """
    out: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for m in re.finditer(
        r'href="(https?://(?:www\.)?facebook\.com/[^"]+|/(?:profile\.php\?id=\d+|[^"/?]{3,50})[^"]*)"[^>]*>([^<]{1,80})',
        html or "",
        flags=re.IGNORECASE,
    ):
        href = m.group(1)
        name = re.sub(r"\s+", " ", m.group(2) or "").strip()
        if href.startswith("/"):
            href = "https://www.facebook.com" + href
        if re.search(
            r"/(followers|following|friends|photos|videos|reels|posts|about|login|groups)/",
            href,
            re.I,
        ):
            continue
        key = normalize_follower_key_from_url(href)
        if not key or key in seen:
            continue
        if not name or re.match(r"^(người theo dõi|followers)$", name, re.I):
            continue
        seen.add(key)
        out.append(
            {
                "follower_key": key,
                "follower_name": name,
                "profile_url": href.split("&")[0].split("#")[0],
                "avatar_url": None,
            }
        )
    return out


def _followers_view_ready(driver) -> Dict[str, Any]:
    try:
        return driver.execute_script(_FOLLOWERS_VIEW_READY_JS) or {}
    except Exception:
        return {"ready": False}


def _is_verified_followers_extract(probe: Dict[str, Any], view: Optional[Dict[str, Any]] = None) -> bool:
    """
    Chỉ coi là vào list thật khi:
    - view ready (tab selected / /followers URL / dialog), VÀ
    - extract có ≥1 hàng, VÀ
    - root_kind không phải body_unverified.
    """
    raw = int(probe.get("raw_count") or 0)
    if raw <= 0:
        return False
    meta = probe.get("meta") or {}
    root_kind = str(meta.get("root_kind") or "")
    if root_kind in ("body_unverified", "body", ""):
        # Cho phép nếu URL/tab đã ready
        if not (view or {}).get("ready"):
            return False
    if root_kind == "body_unverified" and not (view or {}).get("ready"):
        return False
    return True


def _wait_followers_view(driver, timeout_s: float = 6.0) -> Dict[str, Any]:
    deadline = time.time() + timeout_s
    last: Dict[str, Any] = {}
    while time.time() < deadline:
        last = _followers_view_ready(driver)
        if last.get("ready"):
            return last
        time.sleep(0.4)
    return last or {"ready": False}


def open_followers_list(driver, page_url: str, page_key: str) -> Dict[str, Any]:
    """
    Tab Followers trước → (tuỳ chọn) dialog từ dòng số → fallback URL.
    Chỉ trả ok khi đã vào view Followers VÀ probe extract ≥1 hàng trong khung list.
    Không click nút Follow/Theo dõi.
    """
    try:
        driver.get(page_url)
        time.sleep(2.0)
    except Exception as exc:
        return {"ok": False, "reason": REASON_CHECKPOINT, "error": str(exc)}

    try:
        priv = driver.execute_script(_DETECT_PRIVATE_JS)
        if priv == "checkpoint":
            return {"ok": False, "reason": REASON_CHECKPOINT}
        if priv == "private":
            return {"ok": False, "reason": REASON_LIST_PRIVATE}
    except Exception:
        pass

    attempts: List[Dict[str, Any]] = []

    # 1) Click TAB Followers (All / About / … / Followers)
    try:
        clicked = driver.execute_script(_OPEN_FOLLOWERS_TAB_JS)
        attempts.append({"step": "tab", "clicked": clicked})
        if clicked and clicked.get("ok"):
            view = _wait_followers_view(driver, timeout_s=6.0)
            time.sleep(0.8)
            probe = extract_followers_batch(driver)
            attempts[-1].update(
                {
                    "view": view,
                    "probe_raw": probe.get("raw_count", 0),
                    "root": (probe.get("meta") or {}).get("root_kind"),
                }
            )
            if view.get("ready") and _is_verified_followers_extract(probe, view):
                return {
                    "ok": True,
                    "reason": REASON_OK,
                    "method": "followers_tab",
                    "click_text": (clicked or {}).get("text"),
                    "click_how": (clicked or {}).get("how"),
                    "view": view,
                    "probe_raw": probe.get("raw_count", 0),
                    "probe_meta": probe.get("meta") or {},
                    "probe_items": probe.get("items") or [],
                    "attempts": attempts,
                }
    except Exception as exc:
        logger.debug(f"[FOLLOW] tab click: {exc}")
        attempts.append({"step": "tab", "error": str(exc)})

    # 2) Một số Page: click dòng số mở dialog (chỉ ok nếu dialog/list thật)
    try:
        clicked = driver.execute_script(_OPEN_FOLLOWERS_COUNT_JS)
        attempts.append({"step": "count_click", "clicked": clicked})
        if clicked and clicked.get("ok"):
            time.sleep(1.5)
            view = _wait_followers_view(driver, timeout_s=4.0)
            probe = extract_followers_batch(driver)
            attempts[-1].update(
                {
                    "view": view,
                    "probe_raw": probe.get("raw_count", 0),
                    "root": (probe.get("meta") or {}).get("root_kind"),
                }
            )
            if view.get("ready") and _is_verified_followers_extract(probe, view):
                method = (
                    "followers_dialog"
                    if view.get("followers_dialog")
                    else (
                        "click_navigate"
                        if view.get("on_followers_url")
                        else "count_click"
                    )
                )
                return {
                    "ok": True,
                    "reason": REASON_OK,
                    "method": method,
                    "click_text": (clicked or {}).get("text"),
                    "view": view,
                    "probe_raw": probe.get("raw_count", 0),
                    "probe_meta": probe.get("meta") or {},
                    "probe_items": probe.get("items") or [],
                    "attempts": attempts,
                }
    except Exception as exc:
        logger.debug(f"[FOLLOW] count click: {exc}")
        attempts.append({"step": "count_click", "error": str(exc)})

    # 3) Fallback URL /{slug}/followers — chỉ ok nếu view/url thật + extract verified
    can, fallback = can_build_followers_url(page_url, page_key)
    if not can:
        return {
            "ok": False,
            "reason": fallback or REASON_DIALOG_NOT_FOUND,
            "attempts": attempts,
        }
    try:
        driver.get(fallback)
        time.sleep(2.0)
        priv = driver.execute_script(_DETECT_PRIVATE_JS)
        if priv == "checkpoint":
            return {"ok": False, "reason": REASON_CHECKPOINT, "attempts": attempts}
        if priv == "private":
            return {"ok": False, "reason": REASON_LIST_PRIVATE, "attempts": attempts}
        view = _wait_followers_view(driver, timeout_s=4.0)
        probe = extract_followers_batch(driver)
        raw = int(probe.get("raw_count") or 0)
        attempts.append(
            {
                "step": "url_fallback",
                "url": fallback,
                "view": view,
                "probe_raw": raw,
                "root": (probe.get("meta") or {}).get("root_kind"),
            }
        )
        # Bắt buộc URL/tab/dialog ready — không chấp nhận scrape tab All
        if view.get("ready") and _is_verified_followers_extract(probe, view):
            return {
                "ok": True,
                "reason": REASON_OK,
                "method": "url_fallback",
                "fallback_url": fallback,
                "view": view,
                "probe_raw": raw,
                "probe_meta": probe.get("meta") or {},
                "probe_items": probe.get("items") or [],
                "attempts": attempts,
            }
        return {
            "ok": False,
            "reason": REASON_DIALOG_NOT_FOUND,
            "method": "url_fallback",
            "fallback_url": fallback,
            "probe_raw": raw,
            "probe_meta": probe.get("meta") or {},
            "view": view,
            "attempts": attempts,
        }
    except Exception as exc:
        return {
            "ok": False,
            "reason": REASON_DIALOG_NOT_FOUND,
            "error": str(exc),
            "attempts": attempts,
        }


def extract_followers_batch(driver) -> Dict[str, Any]:
    """
    Trả {items, raw_count, meta} — raw_count = số hàng trước khi Python lọc trùng.
    """
    empty = {"items": [], "raw_count": 0, "meta": {}}
    try:
        payload = driver.execute_script(_EXTRACT_FOLLOWERS_JS)
        if isinstance(payload, list):
            rows = payload
            meta: Dict[str, Any] = {}
        elif isinstance(payload, dict):
            rows = payload.get("items") or []
            meta = dict(payload.get("meta") or {})
        else:
            return empty
        cleaned = []
        for r in rows:
            key = (r.get("follower_key") or "").strip()
            if not key:
                continue
            cleaned.append(
                {
                    "follower_key": key,
                    "follower_name": (r.get("follower_name") or "").strip() or None,
                    "profile_url": r.get("profile_url"),
                    "avatar_url": r.get("avatar_url"),
                }
            )
        meta.setdefault("raw_count", len(cleaned))
        return {"items": cleaned, "raw_count": len(cleaned), "meta": meta}
    except Exception as exc:
        logger.debug(f"[FOLLOW] extract: {exc}")
        return empty


def scroll_followers_list(driver) -> Dict[str, Any]:
    """Trả metrics scroll để phân biệt cuộn đúng khung vs stuck."""
    try:
        metrics = driver.execute_script(_SCROLL_DIALOG_JS) or {}
        if isinstance(metrics, dict):
            return metrics
    except Exception:
        pass
    try:
        driver.execute_script("window.scrollBy(0, window.innerHeight * 0.85);")
        return {"changed": True, "used_best": False, "fallback": "window"}
    except Exception:
        return {"changed": False, "error": "scroll_failed"}


def upsert_followers_batch(
    owner_key: str,
    page_key: str,
    items: List[Dict[str, Any]],
    session_id: int,
) -> Tuple[int, int]:
    inserted = 0
    updated = 0
    for row in items:
        follower_key = (row.get("follower_key") or "").strip()
        if not follower_key:
            continue
        profile_url = row.get("profile_url") or ""
        if not profile_url:
            if follower_key.startswith("id:"):
                profile_url = f"https://www.facebook.com/profile.php?id={follower_key[3:]}"
            elif follower_key.startswith("user:"):
                profile_url = f"https://www.facebook.com/{follower_key[5:]}"
        try:
            res = db.fetch_one(
                """
                INSERT INTO scanned_page_followers (
                    owner_key, page_key, follower_key, follower_name, profile_url,
                    avatar_url, gender, location, first_session_id, last_session_id,
                    created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                )
                ON CONFLICT (owner_key, page_key, follower_key) DO UPDATE
                SET follower_name = COALESCE(EXCLUDED.follower_name, scanned_page_followers.follower_name),
                    profile_url = COALESCE(EXCLUDED.profile_url, scanned_page_followers.profile_url),
                    avatar_url = COALESCE(EXCLUDED.avatar_url, scanned_page_followers.avatar_url),
                    last_session_id = EXCLUDED.last_session_id,
                    updated_at = NOW()
                RETURNING (xmax = 0) AS is_new
                """,
                (
                    owner_key,
                    page_key,
                    follower_key,
                    row.get("follower_name"),
                    profile_url,
                    row.get("avatar_url"),
                    row.get("gender"),
                    row.get("location"),
                    session_id,
                    session_id,
                ),
            )
            if res and res.get("is_new"):
                inserted += 1
            else:
                updated += 1
        except Exception as exc:
            logger.debug(f"[FOLLOW] upsert: {exc}")
            try:
                db.execute(
                    """
                    INSERT INTO scanned_page_followers (
                        owner_key, page_key, follower_key, follower_name, profile_url,
                        avatar_url, first_session_id, last_session_id, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    ON CONFLICT (owner_key, page_key, follower_key) DO UPDATE
                    SET last_session_id = EXCLUDED.last_session_id,
                        follower_name = COALESCE(EXCLUDED.follower_name, scanned_page_followers.follower_name),
                        updated_at = NOW()
                    """,
                    (
                        owner_key,
                        page_key,
                        follower_key,
                        row.get("follower_name"),
                        profile_url,
                        row.get("avatar_url"),
                        session_id,
                        session_id,
                    ),
                )
                updated += 1
            except Exception as exc2:
                logger.warning(f"[FOLLOW] upsert fallback: {exc2}")
    return inserted, updated


def existing_follower_keys(owner_key: str, page_key: str) -> Set[str]:
    rows = db.fetch_all(
        """
        SELECT follower_key FROM scanned_page_followers
        WHERE owner_key = %s AND page_key = %s
        """,
        (owner_key, page_key),
    )
    return {str(r["follower_key"]) for r in (rows or []) if r.get("follower_key")}


def update_session_progress(
    session_id: int,
    total_seen: int,
    total_unique: int,
    batches_count: int = 0,
) -> None:
    try:
        db.execute(
            """
            UPDATE page_scan_sessions
            SET total_seen = %s, total_unique = %s, batches_count = %s
            WHERE id = %s AND status IN ('RUNNING', 'PAUSED')
            """,
            (total_seen, total_unique, batches_count, session_id),
        )
    except Exception as exc:
        logger.debug(f"[FOLLOW] progress: {exc}")


def run_follower_scan_flow(
    page_keys: List[str],
    account_uid: Optional[str] = None,
    owner_key: str = "system",
    session_id: Optional[int] = None,
    target_followers: int = 500,
    max_per_page: int = 200,
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
            keyword=f"FOLLOWERS · {len(page_keys)} page",
            account_uid=target_uid,
            source_type="PARSE",
            max_results=target_followers,
            settings={
                "job": "FOLLOW",
                "page_keys": page_keys,
                "target_followers": target_followers,
                "max_per_page": max_per_page,
                "idle_timeout_s": idle_timeout_s,
                "skip_existing": skip_existing,
                "page_delay_s": page_delay_s,
                "scroll_delay_s": scroll_delay_s,
                "keep_browser": keep_browser,
                "automation": True,
            },
        )

    with _ACTIVE_SESSIONS_LOCK:
        if session_id not in _ACTIVE_STOP_EVENTS:
            _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        if session_id not in _ACTIVE_PAUSE_EVENTS:
            _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()
        stop_event = _ACTIVE_STOP_EVENTS[session_id]

    try_acquire_account_job(target_uid, session_id, "FOLLOW")

    stop_reason = "COMPLETED"
    error_message: Optional[str] = None
    total_seen = 0
    total_unique = 0
    total_dup = 0
    batches = 0
    start_time = time.time()
    session_keys: Set[str] = set()
    final_status = "COMPLETED"

    driver = None
    lock = None
    acquired_lock = False

    try:
        from core.browser import human_sleep

        try:
            driver, _created, lock, acquired_lock = acquire_browser(
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
            f"FOLLOW · pages={len(page_keys)} · target={target_followers} · max/page={max_per_page} · acc={target_uid}",
            "warn",
        )

        used_today = get_account_usage_today(target_uid, "FOLLOW")
        pages_quota_left = max(0, int(max_pages_per_acc) - used_today)

        for idx, page_key in enumerate(page_keys):
            if stop_event.is_set():
                stop_reason = "USER_STOPPED"
                break
            if _wait_if_paused(session_id, stop_event):
                stop_reason = "USER_STOPPED"
                break

            if pages_quota_left <= 0:
                append_session_log(
                    session_id,
                    f"Quota FOLLOW đạt {max_pages_per_acc} Page/acc hôm nay — dừng",
                    "warn",
                )
                stop_reason = "TIMEOUT"
                break

            if total_unique >= target_followers:
                stop_reason = "TARGET_REACHED"
                break

            page_url, page_name = resolve_page_url(owner_key, page_key)
            append_session_log(
                session_id,
                f"[{idx + 1}/{len(page_keys)}] Mở Page {page_name or page_key}",
                "info",
            )

            opened = open_followers_list(driver, page_url, page_key)
            if not opened.get("ok"):
                reason = opened.get("reason") or REASON_DIALOG_NOT_FOUND
                attempts = opened.get("attempts") or []
                attempt_summary = " → ".join(
                    (
                        f"{a.get('step')}:"
                        f"raw={a.get('probe_raw', '—')}"
                        f"/ready={(a.get('view') or {}).get('ready', '—')}"
                        f"/root={a.get('root') or '—'}"
                    )
                    for a in attempts
                ) or "—"
                append_session_log(
                    session_id,
                    (
                        f"Soft-fail {page_key}: {reason}"
                        f" · method={opened.get('method') or '—'}"
                        f" · probe_raw={opened.get('probe_raw', '—')}"
                        f" · meta={opened.get('probe_meta') or {}}"
                        f" · attempts[{attempt_summary}]"
                    ),
                    "warn" if reason != REASON_CHECKPOINT else "error",
                )
                if reason == REASON_CHECKPOINT:
                    stop_reason = "CHECKPOINT"
                    error_message = "Checkpoint/login khi mở followers"
                    break
                bump_account_usage(target_uid, "FOLLOW", 1)
                pages_quota_left -= 1
                if page_delay_s > 0 and idx < len(page_keys) - 1:
                    time.sleep(page_delay_s)
                continue

            known = existing_follower_keys(owner_key, page_key) if skip_existing else set()
            known_n = len(known)
            view = opened.get("view") or {}
            append_session_log(
                session_id,
                (
                    f"{page_key}: opened method={opened.get('method')}"
                    f" · how={opened.get('click_how') or '—'}"
                    f" · probe_raw={opened.get('probe_raw', 0)}"
                    f" · root={((opened.get('probe_meta') or {}).get('root_kind')) or '—'}"
                    f" · view_ready={view.get('ready')} tab={view.get('selected_followers_tab') or '—'}"
                    f" · url_fl={view.get('on_followers_url')}"
                    f" · skip_existing={skip_existing} · known_in_db={known_n}"
                ),
                "info",
            )

            page_got = 0
            last_new_at = time.time()
            idle_timeout_s = max(5.0, float(idle_timeout_s))
            stagnant = 0
            empty_streak = 0
            dup_streak = 0
            scroll_stuck_streak = 0
            page_stop = REASON_LIST_EXHAUSTED

            # Seed từ probe đã verified khi mở (tab/dialog/url)
            seed_items = opened.get("probe_items") or None

            while page_got < max_per_page and total_unique < target_followers:
                if stop_event.is_set():
                    stop_reason = "USER_STOPPED"
                    break
                if _wait_if_paused(session_id, stop_event):
                    stop_reason = "USER_STOPPED"
                    break

                if seed_items is not None:
                    batch_items = list(seed_items)
                    raw_count = len(batch_items)
                    meta = opened.get("probe_meta") or {}
                    seed_items = None
                else:
                    extracted = extract_followers_batch(driver)
                    batch_items = extracted.get("items") or []
                    raw_count = int(extracted.get("raw_count") or 0)
                    meta = extracted.get("meta") or {}

                new_items = []
                dup_this = 0
                for item in batch_items:
                    fk = item["follower_key"]
                    total_seen += 1
                    if fk in session_keys or fk in known:
                        total_dup += 1
                        dup_this += 1
                        continue
                    new_items.append(item)
                    session_keys.add(fk)
                    known.add(fk)

                if new_items:
                    ins, upd = upsert_followers_batch(
                        owner_key, page_key, new_items, session_id
                    )
                    page_got += len(new_items)
                    total_unique = len(session_keys)
                    batches += 1
                    last_new_at = time.time()
                    stagnant = 0
                    empty_streak = 0
                    dup_streak = 0
                    scroll_stuck_streak = 0
                    update_session_progress(session_id, total_seen, total_unique, batches)
                    append_session_log(
                        session_id,
                        (
                            f"{page_key}: +{len(new_items)} (ins={ins}/upd={upd})"
                            f" · raw={raw_count} dup={dup_this}"
                            f" · page={page_got} · tổng={total_unique}"
                        ),
                        "success",
                    )
                else:
                    stagnant += 1
                    if raw_count == 0:
                        empty_streak += 1
                        dup_streak = 0
                    else:
                        empty_streak = 0
                        dup_streak += 1
                    # Log chẩn đoán mỗi lần stagnant (tối đa vài dòng đầu + mỗi 2 lần)
                    if stagnant <= 2 or stagnant % 2 == 0:
                        cause = (
                            "extract_empty"
                            if raw_count == 0
                            else "all_duplicates"
                        )
                        append_session_log(
                            session_id,
                            (
                                f"{page_key}: stagnant={stagnant}/{8} · {cause}"
                                f" · raw={raw_count} new=0 dup={dup_this}"
                                f" · root={meta.get('root_kind') or '—'}"
                                f" · href_nodes={meta.get('href_nodes', '—')}"
                                f" · dialogs={meta.get('dialog_count', '—')}"
                            ),
                            "warn",
                        )

                if time.time() - last_new_at >= idle_timeout_s:
                    page_stop = (
                        "extract_empty"
                        if empty_streak >= stagnant and page_got == 0
                        else (
                            "all_duplicates"
                            if dup_streak > 0 and page_got == 0
                            else REASON_LIST_EXHAUSTED
                        )
                    )
                    append_session_log(
                        session_id,
                        f"{page_key}: idle {idle_timeout_s}s — {page_stop} · got={page_got}",
                        "info",
                    )
                    break
                if stagnant >= 8 and not new_items:
                    if empty_streak >= 8:
                        page_stop = "extract_empty"
                    elif dup_streak >= 8:
                        page_stop = "all_duplicates"
                    elif scroll_stuck_streak >= 4:
                        page_stop = "scroll_stuck"
                    else:
                        page_stop = REASON_LIST_EXHAUSTED
                    append_session_log(
                        session_id,
                        (
                            f"{page_key}: stop={page_stop}"
                            f" · empty_streak={empty_streak} dup_streak={dup_streak}"
                            f" · scroll_stuck={scroll_stuck_streak} · got={page_got}"
                        ),
                        "warn" if page_got == 0 else "info",
                    )
                    break

                scroll_meta = scroll_followers_list(driver)
                if not scroll_meta.get("changed"):
                    scroll_stuck_streak += 1
                else:
                    scroll_stuck_streak = 0
                if stagnant <= 2 or stagnant % 2 == 0:
                    before = scroll_meta.get("before") or {}
                    after = scroll_meta.get("after") or {}
                    append_session_log(
                        session_id,
                        (
                            f"{page_key}: scroll changed={scroll_meta.get('changed')}"
                            f" · top {before.get('scrollTop', '?')}→{after.get('scrollTop', '?')}"
                            f" · h {before.get('scrollHeight', '?')}→{after.get('scrollHeight', '?')}"
                            f" · best={scroll_meta.get('used_best')} Δ={scroll_meta.get('best_delta', '?')}"
                        ),
                        "info",
                    )
                time.sleep(max(0.3, float(scroll_delay_s)))
                try:
                    human_sleep(0.2, 0.5)
                except Exception:
                    pass

            bump_account_usage(target_uid, "FOLLOW", 1)
            pages_quota_left -= 1

            if stop_reason in ("USER_STOPPED", "CHECKPOINT"):
                break
            if total_unique >= target_followers:
                stop_reason = "TARGET_REACHED"
                break

            if page_delay_s > 0 and idx < len(page_keys) - 1:
                time.sleep(page_delay_s)

        else:
            # for-loop exhausted without break
            if stop_reason == "COMPLETED" and total_unique == 0:
                stop_reason = "NO_NEW_RESULTS"
            elif stop_reason == "COMPLETED" and total_unique < target_followers:
                stop_reason = "NO_NEW_RESULTS"

        if stop_reason == "COMPLETED" and total_unique >= target_followers:
            stop_reason = "TARGET_REACHED"

    except Exception as exc:
        logger.exception(f"[FOLLOW] session #{session_id}: {exc}")
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
            "TARGET_REACHED": "COMPLETED",
            "NO_NEW_RESULTS": "COMPLETED",
            "COMPLETED": "COMPLETED",
        }.get(stop_reason, "COMPLETED")

        finalize_scan_session(
            session_id=session_id,
            status=final_status,
            stop_reason=stop_reason,
            total_seen=total_seen,
            total_unique=total_unique,
            total_duplicates=total_dup,
            total_sponsored=0,
            batches_count=batches,
            duration_seconds=duration,
            error_message=error_message,
        )
        append_session_log(
            session_id,
            f"Kết thúc FOLLOW · {final_status}/{stop_reason} · unique={total_unique}",
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


def start_follower_scan_background(
    page_keys: List[str],
    account_uid: Optional[str] = None,
    owner_key: str = "system",
    target_followers: int = 500,
    max_per_page: int = 200,
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
    page_keys = [str(k).strip() for k in (page_keys or []) if str(k).strip()]
    if not page_keys:
        raise ValueError("Cần ít nhất 1 page_key")

    account = get_scraping_account(account_uid, owner_key=owner_key)
    if not account:
        raise RuntimeError("Không tìm thấy tài khoản Facebook hợp lệ")
    target_uid = str(account.get("uid") or "").strip()

    # BUSY trước khi tạo session
    from .browser_session import get_active_job_for_account

    busy = get_active_job_for_account(target_uid)
    if busy:
        raise AccountBusyError(
            target_uid, int(busy["session_id"]), str(busy.get("job_type") or "")
        )

    settings = {
        "job": "FOLLOW",
        "page_keys": page_keys,
        "target_followers": target_followers,
        "max_per_page": max_per_page,
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
        keyword=f"FOLLOWERS · {len(page_keys)} page",
        account_uid=target_uid,
        source_type="PARSE",
        max_results=target_followers,
        settings=settings,
    )
    try:
        db.execute(
            "UPDATE page_scan_sessions SET job_type = %s WHERE id = %s",
            ("FOLLOW", session_id),
        )
    except Exception:
        pass

    with _ACTIVE_SESSIONS_LOCK:
        _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()

    # Giữ slot acc ngay (trước khi thread chạy) để race không double-start
    try:
        try_acquire_account_job(target_uid, session_id, "FOLLOW")
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
            run_follower_scan_flow(
                page_keys=page_keys,
                account_uid=target_uid,
                owner_key=owner_key,
                session_id=session_id,
                target_followers=target_followers,
                max_per_page=max_per_page,
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
            logger.exception(f"[FOLLOW] background #{session_id}: {exc}")
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
        name=f"page_followers_worker_{session_id}",
    ).start()
    return session_id
