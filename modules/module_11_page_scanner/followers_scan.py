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
    AccountRotation,
    bump_account_usage,
    get_account_usage_today,
    order_accounts_free_first,
    release_account_job,
    try_acquire_account_job,
)
from .page_source import extract_page_identifier
from .scanner import (
    _PICK_AVATAR_JS,
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
_EXTRACT_FOLLOWERS_JS = _PICK_AVATAR_JS + r"""
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

// Facebook vẽ avatar bằng <svg><image> trong link riêng (không chữ), tách khỏi link tên
const avatarOf = (box) => {
  for (const im of Array.from(box.querySelectorAll('image, img'))) {
    const src = _cleanImgSrc(im);
    if (src && _isAvatarSrc(src)) return src;
  }
  return null;
};
const linkKey = (a) => hrefToKey(a.getAttribute('href') || '');
const avatarByKey = new Map();
for (const a of Array.from(root.querySelectorAll('a[href]'))) {
  const key = linkKey(a);
  if (!key || avatarByKey.has(key)) continue;
  const src = avatarOf(a);
  if (src) avatarByKey.set(key, src);
}
// Ảnh không nằm trong link: leo lên khung hàng, dừng khi khung chứa người khác
const avatarFor = (el, key) => {
  if (avatarByKey.has(key)) return avatarByKey.get(key);
  let box = el;
  for (let i = 0; i < 5 && box && box !== root; i++, box = box.parentElement) {
    if (Array.from(box.querySelectorAll('a[href]')).some((a) => { const k = linkKey(a); return k && k !== key; })) break;
    const src = avatarOf(box);
    if (src) return src;
  }
  return null;
};

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
  const avatar = avatarFor(el, key);
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

# Cuộn view followers: window → [role=main] → hàng cuối (scrollIntoView) → div overflow.
# arguments[0] = target thử đầu tiên. Dialog: cuộn window chỉ động trang nền → bỏ window/main.
_SCROLL_TARGETS = ("window", "main", "last_row", "overflow")
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
const inDialog = !!root.closest('[role="dialog"]');
const ORDER = inDialog ? ['last_row', 'overflow'] : ['window', 'main', 'last_row', 'overflow'];
const start = Math.max(0, ORDER.indexOf(arguments[0] || ''));
const order = ORDER.slice(start).concat(ORDER.slice(0, start));

const pageEl = document.scrollingElement || document.documentElement;
const pageState = () => ({
  top: Math.round(window.scrollY || pageEl.scrollTop || 0),
  height: pageEl.scrollHeight, client: window.innerHeight,
});
const elState = (el) => ({ top: Math.round(el.scrollTop), height: el.scrollHeight, client: el.clientHeight });
// Chỉ tính là cuộn được khi đi XUỐNG hoặc list dài thêm
const moved = (x, y) => y.top > x.top || y.height > x.height;
const biggestOverflow = () => {
  let best = null, bestDelta = 40;
  for (const d of [root, ...Array.from(root.querySelectorAll('div'))]) {
    if (!/^(auto|scroll|overlay)$/.test(getComputedStyle(d).overflowY)) continue;
    const delta = d.scrollHeight - d.clientHeight;
    if (delta > bestDelta) { bestDelta = delta; best = d; }
  }
  return best;
};
const scrollEl = (el) => {
  if (!el) return null;
  const before = elState(el);
  el.scrollBy({ top: Math.floor((el.clientHeight || 400) * 0.9), behavior: 'instant' });
  return { before, after: elState(el) };
};
const RUN = {
  window: () => {
    const before = pageState();
    window.scrollBy({ top: Math.floor(window.innerHeight * 0.85), behavior: 'instant' });
    return { before, after: pageState() };
  },
  main: () => scrollEl(document.querySelector('[role="main"]')),
  last_row: () => {
    const links = Array.from(root.querySelectorAll('a[href]'));
    const rows = links.filter((x) => x.querySelector('image, img'));
    const last = (rows.length ? rows : links).pop();
    if (!last) return null;
    // Khung cuộn chứa hàng cuối; không có → đo theo trang
    let box = last.parentElement;
    while (box && !(/^(auto|scroll|overlay)$/.test(getComputedStyle(box).overflowY)
                    && box.scrollHeight > box.clientHeight)) box = box.parentElement;
    const state = () => (box && box !== pageEl && box !== document.body ? elState(box) : pageState());
    const before = state();
    last.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    return { before, after: state() };
  },
  overflow: () => scrollEl(biggestOverflow()),
};

const tried = [];
let result = null;
for (const target of order) {
  const r = RUN[target]();
  tried.push(target);
  if (!r) continue;
  const changed = moved(r.before, r.after);
  if (changed || !result) result = { changed, target, ...r };
  if (changed) break;
}
const none = pageState();
return Object.assign(result || { changed: false, target: order[0], before: none, after: none },
                     { tried, in_dialog: inDialog });
"""

_SCROLL_WINDOW_JS = r"""
const el = document.scrollingElement || document.documentElement;
const st = () => ({ top: Math.round(window.scrollY || el.scrollTop || 0), height: el.scrollHeight, client: window.innerHeight });
const before = st();
window.scrollBy({ top: Math.floor(window.innerHeight * 0.85), behavior: 'instant' });
const after = st();
return { changed: after.top > before.top || after.height > before.height, before, after };
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
            probe = extract_followers_batch(driver, page_key, page_url)
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
            probe = extract_followers_batch(driver, page_key, page_url)
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
        probe = extract_followers_batch(driver, page_key, page_url)
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


# Link giao diện (tab, ảnh bìa...) lọt vào vùng list — không phải người theo dõi
_UI_LINK_SLUGS = {
    "photo", "photos", "media", "story", "stories", "reel", "reels", "videos", "share", "sharer",
    "help", "policies", "privacy", "settings", "messages", "notifications", "bookmarks", "ads",
    "business", "hashtag", "events", "groups", "marketplace", "watch", "gaming", "login",
}
_UI_LINK_NAME_RE = re.compile(
    r"^(all|tất cả)$|^(view |xem )?(profile )?cover photo|^xem ảnh (bìa|đại diện)|^view profile (picture|cover)",
    re.I,
)


def is_ui_link_row(row: Dict[str, Any], self_keys: Set[str]) -> bool:
    """True nếu hàng là link giao diện hoặc link về chính Page đang quét."""
    key = str(row.get("follower_key") or "").strip().lower()
    if key in self_keys:
        return True
    if key.startswith("user:") and key[5:] in _UI_LINK_SLUGS:
        return True
    return bool(_UI_LINK_NAME_RE.search(str(row.get("follower_name") or "").strip()))


def page_self_keys(driver, page_key: str = "", page_url: str = "") -> Set[str]:
    """Các key trỏ về chính Page (key trong kho, URL kho, URL đang mở: slug ↔ id)."""
    keys = {str(page_key or "").strip().lower()}
    try:
        current = driver.current_url
    except Exception:
        current = ""
    for url in (page_url, current):
        if isinstance(url, str) and url:
            keys.add(normalize_follower_key_from_url(url).lower())
    keys.discard("")
    return keys


def extract_followers_batch(driver, page_key: str = "", page_url: str = "") -> Dict[str, Any]:
    """
    Trả {items, raw_count, meta} — raw_count = số hàng JS đọc được (gồm link giao diện, giữ nguyên
    nghĩa cho bước xác nhận mở list / chẩn đoán kẹt); items đã bỏ link giao diện.
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
        raw_count = 0
        self_keys = page_self_keys(driver, page_key, page_url)
        for r in rows:
            key = (r.get("follower_key") or "").strip()
            if not key:
                continue
            raw_count += 1
            if is_ui_link_row(r, self_keys):
                continue
            cleaned.append(
                {
                    "follower_key": key,
                    "follower_name": (r.get("follower_name") or "").strip() or None,
                    "profile_url": r.get("profile_url"),
                    "avatar_url": r.get("avatar_url"),
                }
            )
        meta["ui_links"] = raw_count - len(cleaned)
        meta.setdefault("raw_count", raw_count)
        return {"items": cleaned, "raw_count": raw_count, "meta": meta}
    except Exception as exc:
        logger.debug(f"[FOLLOW] extract: {exc}")
        return empty


def scroll_followers_list(driver, state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Cuộn 1 nhịp, trả {changed, target, before, after, tried, in_dialog}.
    state (giữ theo từng Page): target thử trước; kẹt 2 lần liên tiếp → lần sau bắt đầu từ target kế tiếp.
    """
    state = state if state is not None else {}
    first = state.get("target")
    metrics: Dict[str, Any] = {}
    try:
        res = driver.execute_script(_SCROLL_DIALOG_JS, first)
        if isinstance(res, dict):
            metrics = res
    except Exception as exc:
        logger.debug(f"[FOLLOW] scroll: {exc}")

    tried = metrics.get("tried") or []
    first_stuck = bool(tried) and not (metrics.get("changed") and metrics.get("target") == tried[0])
    if tried and tried[0] != state.get("target"):
        state["target"], state["stuck"] = tried[0], 0
    state["stuck"] = int(state.get("stuck") or 0) + 1 if first_stuck else 0
    if state["stuck"] >= 2:
        order = ("last_row", "overflow") if metrics.get("in_dialog") else _SCROLL_TARGETS
        nxt = order[(order.index(tried[0]) + 1) % len(order)]
        if metrics.get("changed"):
            nxt = metrics["target"]
        metrics["switched_to"] = nxt
        state["target"], state["stuck"] = nxt, 0

    if not metrics.get("changed") and not metrics.get("in_dialog"):
        try:
            fb = driver.execute_script(_SCROLL_WINDOW_JS) or {}
            if not metrics or fb.get("changed"):
                metrics.update(fb, target="window_fallback")
        except Exception as exc:
            metrics.setdefault("error", f"scroll_failed: {exc}"[:200])
    metrics.setdefault("changed", False)
    return metrics


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


def backfill_follower_avatars(owner_key: str, page_key: str, avatars: Dict[str, str]) -> None:
    """Cập nhật avatar cho follower đã có trong kho (link CDN hết hạn nên luôn thay bằng link mới)."""
    if not avatars:
        return
    try:
        db.execute(
            """
            UPDATE scanned_page_followers f
            SET avatar_url = v.avatar_url
            FROM unnest(%s::text[], %s::text[]) AS v(follower_key, avatar_url)
            WHERE f.owner_key = %s AND f.page_key = %s AND f.follower_key = v.follower_key
            """,
            (list(avatars.keys()), list(avatars.values()), owner_key, page_key),
        )
    except Exception as exc:
        logger.warning(f"[FOLLOW] backfill avatar: {exc}")


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
    account_uids: Optional[List[str]] = None,
    rotate_every: int = 0,
    rotate_on_checkpoint: bool = False,
    page_delay_min_s: Optional[float] = None,
    page_delay_max_s: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Quét followers các Page. Nhiều acc (account_uids) → xoay vòng:
    - rotate_every > 0: đổi acc sau mỗi N Page đã quét trên acc hiện tại.
    - rotate_on_checkpoint: gặp checkpoint/login → đổi acc và mở lại Page đó.
    """
    page_keys = [str(k).strip() for k in (page_keys or []) if str(k).strip()]
    if not page_keys:
        raise ValueError("Cần ít nhất 1 page_key")

    accounts = resolve_scan_accounts(account_uids, account_uid, owner_key=owner_key)
    if not accounts:
        raise RuntimeError("Không tìm thấy tài khoản Facebook hợp lệ")
    target_uid = str(accounts[0].get("uid") or "").strip()

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
    session_keys: Set[str] = set()  # UID đã lưu trong phiên, dùng lọc trùng giữa các Page
    cross_skipped = 0
    final_status = "COMPLETED"

    driver = None
    rotate_every = max(0, int(rotate_every or 0))
    rotation = AccountRotation(
        session_id,
        "FOLLOW",
        accounts,
        owner_key,
        headless=headless,
        allow_direct_fallback=allow_direct_fallback,
        log=lambda message, level="info": append_session_log(session_id, message, level),
    )

    def _quota_left() -> int:
        return max(0, int(max_pages_per_acc) - get_account_usage_today(rotation.uid, "FOLLOW"))

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
                f"FOLLOW · pages={len(page_keys)} · target={target_followers} · max/page={max_per_page}"
                f" · acc={rotation.uid} ({len(rotation.accounts)} acc)"
                f"{f' · đổi acc sau {rotate_every} page' if rotate_every and rotation.can_rotate else ''}"
            ),
            "warn",
        )

        pages_quota_left = _quota_left()

        for idx, page_key in enumerate(page_keys):
            if stop_event.is_set():
                stop_reason = "USER_STOPPED"
                break
            if _wait_if_paused(session_id, stop_event):
                stop_reason = "USER_STOPPED"
                break

            if pages_quota_left <= 0:
                if rotation.rotate("hết quota FOLLOW hôm nay"):
                    pages_quota_left = _quota_left()
                if pages_quota_left <= 0:
                    append_session_log(
                        session_id,
                        f"Quota FOLLOW đạt {max_pages_per_acc} Page/acc hôm nay — dừng",
                        "warn",
                    )
                    stop_reason = "TIMEOUT"
                    break
                driver = rotation.driver

            if total_unique >= target_followers:
                stop_reason = "TARGET_REACHED"
                break

            page_url, page_name = resolve_page_url(owner_key, page_key)
            append_session_log(
                session_id,
                f"[{idx + 1}/{len(page_keys)}] Mở Page {page_name or page_key} · acc {rotation.uid}",
                "info",
            )

            # Mở danh sách followers; checkpoint → đảo acc và mở lại (tối đa số acc)
            for _attempt in range(len(rotation.accounts)):
                opened = open_followers_list(driver, page_url, page_key)
                if opened.get("reason") != REASON_CHECKPOINT or not rotate_on_checkpoint:
                    break
                append_session_log(session_id, f"{page_key}: checkpoint/login — thử đổi tài khoản", "warn")
                if not rotation.rotate("checkpoint/login", mark_dead=True):
                    break
                driver = rotation.driver
                pages_quota_left = _quota_left()
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
                bump_account_usage(rotation.uid, "FOLLOW", 1)
                pages_quota_left -= 1
                if idx < len(page_keys) - 1 and sleep_page_delay(
                    pick_page_delay(page_delay_min_s, page_delay_max_s, page_delay_s), stop_event
                ):
                    stop_reason = "USER_STOPPED"
                    break
                continue

            # Quét lại cùng Page luôn bỏ qua người đã lưu; skip_existing chỉ quyết định lọc trùng giữa các Page
            known = existing_follower_keys(owner_key, page_key)
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
            page_seen: Set[str] = set()
            avatar_saved: Set[str] = set()
            page_cross = 0  # UID bỏ qua vì đã lưu ở Page khác trong phiên
            known_passed = 0
            known_logged = 0
            last_new_at = time.time()
            idle_timeout_s = max(5.0, float(idle_timeout_s))
            stagnant = 0
            empty_streak = 0
            dup_streak = 0
            scroll_stuck_streak = 0
            page_stop = REASON_LIST_EXHAUSTED
            scroll_state: Dict[str, Any] = {}
            scroll_meta: Dict[str, Any] = {}

            # Seed từ probe đã verified khi mở (tab/dialog/url)
            seed_items = opened.get("probe_items") or None

            while page_got < max_per_page and total_unique < target_followers:
                if stop_event.is_set():
                    stop_reason = "USER_STOPPED"
                    break
                stopped_in_pause, paused_s = _wait_if_paused_timed(session_id, stop_event)
                # Thời gian tạm dừng không tính là idle của Page đang quét
                last_new_at += paused_s
                if stopped_in_pause:
                    stop_reason = "USER_STOPPED"
                    break

                if seed_items is not None:
                    batch_items = list(seed_items)
                    raw_count = int(opened.get("probe_raw") or len(batch_items))
                    meta = opened.get("probe_meta") or {}
                    seed_items = None
                else:
                    extracted = extract_followers_batch(driver, page_key, page_url)
                    batch_items = extracted.get("items") or []
                    raw_count = int(extracted.get("raw_count") or 0)
                    meta = extracted.get("meta") or {}

                new_items = []
                late_avatars: Dict[str, str] = {}
                dup_this = 0
                fresh_known = 0  # UID đã có trong kho nhưng LẦN ĐẦU hiện ra ở lượt quét Page này
                for item in batch_items:
                    fk = item["follower_key"]
                    total_seen += 1
                    first_seen_on_page = fk not in page_seen
                    page_seen.add(fk)
                    has_new_avatar = bool(item.get("avatar_url")) and fk not in avatar_saved
                    if has_new_avatar:
                        avatar_saved.add(fk)
                    # Bỏ tick kiểm tra trùng → mỗi Page lưu đủ follower, chỉ lọc trong chính Page
                    cross_page = skip_existing and fk in session_keys and fk not in known
                    if cross_page or fk in known:
                        total_dup += 1
                        dup_this += 1
                        if cross_page and first_seen_on_page:
                            page_cross += 1
                        if first_seen_on_page:
                            fresh_known += 1
                        # Đã có trong kho (quét lại) hoặc avatar hiện muộn → bổ sung avatar
                        if has_new_avatar:
                            late_avatars[fk] = item["avatar_url"]
                        continue
                    new_items.append(item)
                    session_keys.add(fk)
                    known.add(fk)

                backfill_follower_avatars(owner_key, page_key, late_avatars)

                if new_items:
                    ins, upd = upsert_followers_batch(
                        owner_key, page_key, new_items, session_id
                    )
                    page_got += len(new_items)
                    total_unique += len(new_items)
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
                elif fresh_known:
                    # Quét lại: danh sách vẫn đang cuộn qua UID đã có trong kho
                    # → coi là tiến triển để đi tiếp tới UID mới phía dưới, không dừng "all_duplicates".
                    known_passed += fresh_known
                    last_new_at = time.time()
                    stagnant = 0
                    empty_streak = 0
                    dup_streak = 0
                    scroll_stuck_streak = 0
                    if known_passed - known_logged >= 100:
                        known_logged = known_passed
                        append_session_log(
                            session_id,
                            f"{page_key}: đã đi qua {known_passed} UID có sẵn trong kho — tiếp tục tìm UID mới",
                            "info",
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
                    elif scroll_stuck_streak >= 4 and raw_count > 0:
                        page_stop = "scroll_stuck"
                    elif dup_streak >= 8:
                        page_stop = "all_duplicates"
                    else:
                        page_stop = REASON_LIST_EXHAUSTED
                    append_session_log(
                        session_id,
                        (
                            f"{page_key}: stop={page_stop}"
                            f" · empty_streak={empty_streak} dup_streak={dup_streak}"
                            f" · scroll_stuck={scroll_stuck_streak} · got={page_got}"
                            f" · target={scroll_meta.get('target') or '—'}"
                            f" · top={(scroll_meta.get('after') or {}).get('top', '?')}"
                            f" · h={(scroll_meta.get('after') or {}).get('height', '?')}"
                        ),
                        "warn" if page_got == 0 else "info",
                    )
                    break

                scroll_meta = scroll_followers_list(driver, scroll_state)
                if not scroll_meta.get("changed"):
                    scroll_stuck_streak += 1
                else:
                    scroll_stuck_streak = 0
                before = scroll_meta.get("before") or {}
                after = scroll_meta.get("after") or {}
                switched = scroll_meta.get("switched_to")
                append_session_log(
                    session_id,
                    (
                        f"{page_key}: scroll changed={scroll_meta.get('changed')}"
                        f" · target={scroll_meta.get('target') or '—'}"
                        f" · top {before.get('top', '?')}→{after.get('top', '?')}"
                        f" · h {before.get('height', '?')}→{after.get('height', '?')}"
                        f" · tried={'>'.join(scroll_meta.get('tried') or []) or '—'}"
                        f"{f' · kẹt 2 lần, lần sau thử {switched} trước' if switched else ''}"
                    ),
                    "info",
                )
                time.sleep(max(0.3, float(scroll_delay_s)))
                try:
                    human_sleep(0.2, 0.5)
                except Exception:
                    pass

            if page_cross:
                cross_skipped += page_cross
                append_session_log(
                    session_id,
                    f"{page_key}: bỏ qua {page_cross} follower trùng với Page khác trong phiên",
                    "info",
                )

            bump_account_usage(rotation.uid, "FOLLOW", 1)
            pages_quota_left -= 1
            rotation.count += 1  # đơn vị xoay vòng FOLLOW = Page / tài khoản

            if stop_reason in ("USER_STOPPED", "CHECKPOINT"):
                break
            if total_unique >= target_followers:
                stop_reason = "TARGET_REACHED"
                break

            has_next = idx < len(page_keys) - 1
            if has_next and rotate_every and rotation.can_rotate and rotation.count >= rotate_every:
                if rotation.rotate(f"đủ {rotation.count} page / tài khoản"):
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
            # for-loop exhausted without break
            if stop_reason == "COMPLETED" and total_unique == 0:
                stop_reason = "NO_NEW_RESULTS"
            elif stop_reason == "COMPLETED" and total_unique < target_followers:
                stop_reason = "NO_NEW_RESULTS"

        if stop_reason == "COMPLETED" and total_unique >= target_followers:
            stop_reason = "TARGET_REACHED"

    except (Exception, ScanStopped) as exc:
        if stop_event.is_set():
            # Dừng khẩn cấp đóng Chrome giữa chừng → lỗi WebDriver là hệ quả của việc dừng
            logger.info(f"[FOLLOW] #{session_id} dừng giữa thao tác trình duyệt: {exc}")
            stop_reason = "USER_STOPPED"
        else:
            logger.exception(f"[FOLLOW] session #{session_id}: {exc}")
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
            (
                f"Kết thúc FOLLOW · {final_status}/{stop_reason} · unique={total_unique}"
                f"{f' · bỏ {cross_skipped} follower trùng Page khác' if cross_skipped else ''}"
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
    account_uids: Optional[List[str]] = None,
    rotate_every: int = 0,
    rotate_on_checkpoint: bool = False,
    page_delay_min_s: Optional[float] = None,
    page_delay_max_s: Optional[float] = None,
) -> int:
    page_keys = [str(k).strip() for k in (page_keys or []) if str(k).strip()]
    if not page_keys:
        raise ValueError("Cần ít nhất 1 page_key")

    # Nhiều acc: bắt đầu từ acc rảnh đầu tiên (409 BUSY nếu tất cả đang bận) — trước khi tạo phiên
    accounts = order_accounts_free_first(
        resolve_scan_accounts(account_uids, account_uid, owner_key=owner_key)
    )
    if not accounts:
        raise RuntimeError("Không tìm thấy tài khoản Facebook hợp lệ")
    ordered_uids = [str(a.get("uid") or "").strip() for a in accounts]
    target_uid = ordered_uids[0]

    settings = {
        "job": "FOLLOW",
        "page_keys": page_keys,
        "target_followers": target_followers,
        "max_per_page": max_per_page,
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
                account_uids=ordered_uids,
                rotate_every=rotate_every,
                rotate_on_checkpoint=rotate_on_checkpoint,
                page_delay_min_s=page_delay_min_s,
                page_delay_max_s=page_delay_max_s,
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
