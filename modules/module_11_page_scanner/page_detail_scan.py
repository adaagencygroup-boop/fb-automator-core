"""
Quét thông tin chi tiết Page theo danh sách link / file (job_type=DETAIL).
Mở từng Page → đọc header (tên, followers, tích xanh, avatar, hạng mục)
→ mở About → tách SĐT / Email / Website / Địa chỉ → lưu scanned_pages.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

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
from .entity_classify import build_about_url
from .followers_scan import page_key_to_url
from .page_source import parse_follower_count
from .scanner import (
    _ACTIVE_PAUSE_EVENTS,
    _ACTIVE_SESSIONS_LOCK,
    _ACTIVE_STOP_EVENTS,
    _PICK_AVATAR_JS,
    ScanStopped,
    _wait_if_paused,
    append_session_log,
    create_scan_session,
    finalize_scan_session,
    pick_page_delay,
    resolve_scan_accounts,
    sleep_page_delay,
)

logger = logging.getLogger(__name__)

JOB_TYPE = "DETAIL"
USAGE_ACTION = "PAGE_VISIT"
# Mỗi Page chỉ mở trang chính + About (không cuộn) → nhẹ hơn FOLLOW/POST_SCAN
DEFAULT_PAGES_PER_ACC_DAY = 200
CONTENT_WAIT_S = 8.0

# ==================== JS đọc DOM ====================

_READ_HEADER_JS = _PICK_AVATAR_JS + r"""
const main = document.querySelector('[role="main"]') || document.body;
const GENERIC = /^(notifications|thông báo|facebook|trang chủ|home|menu|tin nhắn|messages)$/i;
const visible = (el) => {
  try {
    const r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  } catch (e) { return false; }
};
// Chấm xanh "đang hoạt động" trên avatar có nhãn ẩn ("Active status indicator") nằm trước tên Page → bỏ qua
const STATUS_NOISE = /^((active|online)\s+status\s+indicator|active( now)?|online|đang hoạt động|chỉ báo trạng thái.*|trạng thái (hoạt động|trực tuyến))$/i;
const firstLine = (el) => ((el.innerText || el.textContent || '').split('\n')
  .map((s) => s.trim()).find((s) => s && !STATUS_NOISE.test(s)) || '');
const pickHeading = (root) => {
  for (const h of Array.from(root.querySelectorAll('h1, [role="heading"][aria-level="1"]'))) {
    const t = firstLine(h);
    if (t && t.length <= 120 && !GENERIC.test(t) && visible(h)) return h;
  }
  return null;
};
// profile.php / Page kiểu mới: h1 tên có thể nằm ngoài [role="main"]
let nameEl = pickHeading(main) || pickHeading(document);
const meta = (p) => {
  const m = document.querySelector('meta[property="' + p + '"]');
  return m ? (m.getAttribute('content') || '') : '';
};
let pageName = nameEl ? firstLine(nameEl) : '';
if (!pageName) {
  // "(3) Tên Page | Facebook" → "Tên Page"
  const title = (document.title || '').replace(/^\(\d+\+?\)\s*/, '').replace(/\s*[|\-–]\s*Facebook\s*$/i, '').trim();
  if (title && !GENERIC.test(title)) pageName = title;
}
if (!pageName) pageName = (meta('og:title') || '').trim();
let isVerified = null;
if (nameEl) {
  let node = nameEl;
  for (let i = 0; i < 4 && node; i++) {
    if (node.querySelector && node.querySelector(
      '[aria-label*="Verified"], [aria-label*="verified"], [aria-label*="xác minh"], [aria-label*="Xác minh"]'
    )) { isVerified = true; break; }
    node = node.parentElement;
  }
}
const bodyText = ((document.body && document.body.innerText) || '').slice(0, 3000);
const unavailable = /(this content isn.?t available|nội dung này hiện không khả dụng|bạn hiện không xem được nội dung này|trang này không khả dụng|this page isn.?t available)/i.test(bodyText);

let avatarUrl = _pickAvatar(null);
if (!avatarUrl) {
  const ogImg = meta('og:image');
  if (_isAvatarSrc(ogImg)) {
    avatarUrl = ogImg;
  }
}

const links = Array.from(main.querySelectorAll('a[href]')).slice(0, 400).map((a) => ({
  href: a.getAttribute('href') || '',
  text: ((a.innerText || '').trim()).slice(0, 200),
}));

const panelItems = [];
let rowSeq = 0;
const headingDefs = [
  { key: 'details', regex: /^(chi tiết|details)$/i },
  { key: 'links', regex: /^(liên kết|links|trang web và liên kết|websites and social links)$/i },
  { key: 'contact', regex: /^(thông tin liên hệ|contact info|contact)$/i },
];

try {
  const headings = Array.from(main.querySelectorAll('h2, h3, [role="heading"], span, div')).filter(el => {
    const t = (el.innerText || el.textContent || '').trim();
    return t && t.length <= 40 && headingDefs.some(hd => hd.regex.test(t));
  });

  for (const h of headings) {
    const t = (h.innerText || h.textContent || '').trim();
    const hDef = headingDefs.find(hd => hd.regex.test(t));
    if (!hDef) continue;
    let block = h.parentElement;
    for (let depth = 0; depth < 3 && block; depth++) {
      const children = Array.from(block.children);
      if (children.length > 1) {
        let afterH = false;
        for (const child of children) {
          if (child.contains(h) || child === h) {
            afterH = true;
            continue;
          }
          if (afterH) {
            const rowText = (child.innerText || '').trim();
            if (!rowText) continue;
            const a = child.querySelector('a[href]');
            const href = a ? (a.getAttribute('href') || '') : '';
            const svg = child.querySelector('svg, img');
            const icon = svg ? (svg.getAttribute('aria-label') || svg.getAttribute('title') || '') : '';
            rowSeq += 1;
            const rowLines = rowText.split('\n').map((x) => x.trim()).filter(Boolean);
            if (rowLines.length <= 1) {
              panelItems.push({
                section: hDef.key,
                heading: t,
                text: rowText,
                href: href,
                icon: icon,
                row: rowSeq,
              });
            } else {
              // Row gom nhiều dòng (vd cả khối Chi tiết: giá / giờ mở cửa / địa chỉ) → mỗi dòng 1 item
              const anchors = Array.from(child.querySelectorAll('a[href]'));
              for (const ln of rowLines) {
                const ax = anchors.find((x) => {
                  const at = (x.innerText || '').trim();
                  return at && ln.includes(at);
                });
                panelItems.push({
                  section: hDef.key,
                  heading: t,
                  text: ln,
                  href: ax ? (ax.getAttribute('href') || '') : '',
                  icon: ax ? icon : '',
                  row: rowSeq,
                });
              }
            }
          }
        }
        break;
      }
      block = block.parentElement;
    }
  }
} catch (e) {}

return {
  page_name: pageName,
  header_text: ((main.innerText || '').slice(0, 4000)),
  links: links,
  panel_items: panelItems,
  is_verified: isVerified,
  avatar_url: avatarUrl,
  current_url: location.href,
  unavailable: unavailable,
};
"""

_READ_ABOUT_JS = r"""
const main = document.querySelector('[role="main"]') || document.body;
const links = Array.from(main.querySelectorAll('a[href]')).slice(0, 400).map((a) => ({
  href: a.getAttribute('href') || '',
  text: ((a.innerText || '').trim()).slice(0, 200),
}));

const panelItems = [];
let rowSeq = 0;
const headingDefs = [
  { key: 'details', regex: /^(chi tiết|details)$/i },
  { key: 'links', regex: /^(liên kết|links|trang web và liên kết|websites and social links)$/i },
  { key: 'contact', regex: /^(thông tin liên hệ|contact info|contact)$/i },
];

try {
  const headings = Array.from(main.querySelectorAll('h2, h3, [role="heading"], span, div')).filter(el => {
    const t = (el.innerText || el.textContent || '').trim();
    return t && t.length <= 40 && headingDefs.some(hd => hd.regex.test(t));
  });

  for (const h of headings) {
    const t = (h.innerText || h.textContent || '').trim();
    const hDef = headingDefs.find(hd => hd.regex.test(t));
    if (!hDef) continue;
    let block = h.parentElement;
    for (let depth = 0; depth < 3 && block; depth++) {
      const children = Array.from(block.children);
      if (children.length > 1) {
        let afterH = false;
        for (const child of children) {
          if (child.contains(h) || child === h) {
            afterH = true;
            continue;
          }
          if (afterH) {
            const rowText = (child.innerText || '').trim();
            if (!rowText) continue;
            const a = child.querySelector('a[href]');
            const href = a ? (a.getAttribute('href') || '') : '';
            const svg = child.querySelector('svg, img');
            const icon = svg ? (svg.getAttribute('aria-label') || svg.getAttribute('title') || '') : '';
            rowSeq += 1;
            const rowLines = rowText.split('\n').map((x) => x.trim()).filter(Boolean);
            if (rowLines.length <= 1) {
              panelItems.push({
                section: hDef.key,
                heading: t,
                text: rowText,
                href: href,
                icon: icon,
                row: rowSeq,
              });
            } else {
              // Row gom nhiều dòng (vd cả khối Chi tiết: giá / giờ mở cửa / địa chỉ) → mỗi dòng 1 item
              const anchors = Array.from(child.querySelectorAll('a[href]'));
              for (const ln of rowLines) {
                const ax = anchors.find((x) => {
                  const at = (x.innerText || '').trim();
                  return at && ln.includes(at);
                });
                panelItems.push({
                  section: hDef.key,
                  heading: t,
                  text: ln,
                  href: ax ? (ax.getAttribute('href') || '') : '',
                  icon: ax ? icon : '',
                  row: rowSeq,
                });
              }
            }
          }
        }
        break;
      }
      block = block.parentElement;
    }
  }
} catch (e) {}

return {
  about_text: ((main.innerText || '').slice(0, 10000)),
  links: links,
  panel_items: panelItems,
  current_url: location.href,
};
"""

_CONTENT_READY_JS = r"""
const main = document.querySelector('[role="main"]');
return !!(main && (main.innerText || '').trim().length > 150);
"""

# ==================== Tách thông tin liên hệ (hàm thuần — có test) ====================

_LABELS = {
    "phone": (
        "mobile", "phone", "điện thoại", "di động", "số điện thoại", "số di động", "hotline",
    ),
    "email": ("email", "e-mail", "thư điện tử"),
    "website": ("website", "trang web", "websites", "trang web cá nhân"),
    "address": ("address", "địa chỉ"),
}
_ALL_LABELS = {lab for labs in _LABELS.values() for lab in labs}

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# SĐT VN: 0xxx / +84 / 84 (9–10 số sau mã), tổng đài 1800/1900
_PHONE_RE = re.compile(
    r"(?<![\d.,])(?:\+84|84|0)(?:[\s.\-]?\d){8,10}(?!\d|[.,]\d)"
    r"|(?<![\d.,])1[89]00(?:[\s.\-]?\d){4,6}(?!\d|[.,]\d)"
)
# Tên miền: nhãn cuối phải là chữ (loại "12.000", "4.9")
_DOMAIN_RE = re.compile(
    r"^(?:https?://)?(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?:[/:?#][^\s]*)?$",
    re.IGNORECASE,
)
# Dòng text trần không nhãn chỉ nhận đuôi phổ biến (tránh "Page.Transparency")
_COMMON_TLDS = {
    "com", "vn", "net", "org", "info", "biz", "shop", "store", "online", "site", "io", "co",
    "edu", "gov", "asia", "me", "xyz", "app", "dev", "tv", "us", "uk", "jp", "kr", "sg",
}
_SOCIAL_HOSTS = (
    "facebook.com", "fb.com", "fb.me", "fb.watch", "messenger.com", "m.me", "instagram.com",
    # Threads đã chuyển từ threads.net sang threads.com — cả hai là mạng xã hội, không phải website
    "threads.net", "threads.com", "tiktok.com", "youtube.com", "youtu.be", "twitter.com", "x.com",
    "wa.me", "whatsapp.com", "linkedin.com", "zalo.me", "t.me", "pinterest.com",
)
_ADDRESS_HINT_RE = re.compile(
    r"\b(quận|phường|huyện|xã|thị xã|thị trấn|tỉnh|tp\.|thành phố|đường|ngõ|ngách|số nhà|"
    r"hà nội|hồ chí minh|đà nẵng|hải phòng|cần thơ|việt nam|vietnam|street|district|ward|city)\b",
    re.IGNORECASE,
)
_NOISE_RE = re.compile(
    r"(người theo dõi|followers?|lượt thích|likes?|đánh giá|reviews?|đang theo dõi|following)",
    re.IGNORECASE,
)


def _norm_label(line: str) -> str:
    return re.sub(r"\s+", " ", (line or "").strip().strip(":").strip()).lower()


def normalize_phone(raw: str) -> str:
    """Giữ dạng dễ đọc: bỏ ký tự thừa, gom khoảng trắng."""
    text = re.sub(r"[^\d+\s.\-]", "", raw or "").strip(" .-")
    return re.sub(r"\s+", " ", text)


def find_phone(text: str) -> Optional[str]:
    for match in _PHONE_RE.finditer(text or ""):
        digits = re.sub(r"\D", "", match.group(0))
        if 8 <= len(digits) <= 12:
            return normalize_phone(match.group(0))
    return None


def find_email(text: str) -> Optional[str]:
    match = _EMAIL_RE.search(text or "")
    return match.group(0).strip(".") if match else None


def unwrap_clean_url(href: str) -> str:
    """
    Giải mã URL redirect l.php?u=... lặp lại tối đa 3 lần cho đến khi ổn định.
    YouTube handle @antvtruyenhinhcongannhandan được mã hóa 2 lần: %2540 -> %40 -> @.
    Loại bỏ các tham số tracking fbclid, __cft__, __tn__.
    """
    href = (href or "").strip()
    if not href:
        return ""
    if href.startswith("/"):
        href = "https://www.facebook.com" + href

    for _ in range(3):
        try:
            parsed = urlparse(href)
            host = (parsed.netloc or "").lower()
            if ("facebook.com" in host or "fb.com" in host) and parsed.path.rstrip("/").endswith("/l.php"):
                qs = parse_qs(parsed.query)
                u = (qs.get("u") or [""])[0]
                if u:
                    unquoted = unquote(u)
                    if unquoted == href:
                        break
                    href = unquoted
                    continue
            unquoted = unquote(href)
            if unquoted == href:
                break
            href = unquoted
        except Exception:
            break

    try:
        parsed = urlparse(href)
        if parsed.query:
            clean_pairs = []
            for p in parsed.query.split("&"):
                k = p.split("=")[0].strip()
                if k in ("fbclid", "__cft__", "__tn__") or k.startswith("__cft__") or k.startswith("__tn__"):
                    continue
                clean_pairs.append(p)
            clean_query = "&".join(clean_pairs)
            href = parsed._replace(query=clean_query).geturl()
        if parsed.path not in ("", "/"):
            href = href.rstrip("/")
    except Exception:
        pass

    return href


unwrap_facebook_redirect = unwrap_clean_url


_RATING_RE = re.compile(
    r"(\d+)%\s*(?:đề xuất|recommend(?:ed)?)\s*\(([\d,.]+)\s*(?:lượt đánh giá|reviews?)\)",
    re.IGNORECASE,
)


def parse_rating_info(text: str) -> Tuple[Optional[int], Optional[int]]:
    """Parse rating: (\d+)% đề xuất ((\d+) lượt đánh giá) -> (rating_percent, rating_count)."""
    m = _RATING_RE.search(text or "")
    if m:
        pct = int(m.group(1))
        cnt = int(re.sub(r"\D", "", m.group(2)))
        return pct, cnt
    return None, None


_OPENING_RE = re.compile(
    r"\b(luôn mở cửa|always open|đang mở cửa|open now|đóng cửa|closed|"
    r"\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2})\b",
    re.IGNORECASE,
)


def parse_opening_info(text: str) -> Optional[str]:
    """Parse trạng thái hoặc giờ mở cửa."""
    for line in (text or "").splitlines():
        line = line.strip()
        m = _OPENING_RE.search(line)
        if m:
            val = m.group(1).strip()
            low = val.lower()
            if "always open" in low or "luôn mở cửa" in low:
                return "Luôn mở cửa"
            if "open now" in low or "đang mở cửa" in low:
                return "Đang mở cửa"
            if "closed" in low or "đóng cửa" in low:
                return "Đóng cửa"
            return val
    return None


def parse_address_components(address: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Tách (district, city, postal) từ chuỗi địa chỉ."""
    if not address:
        return None, None, None

    postal = None
    m_post = re.search(r"\b(\d{5,6})\b", address)
    if m_post:
        postal = m_post.group(1)

    district = None
    # Ưu tiên tìm quận / huyện / thị xã trước
    m_dist = re.search(
        r"\b(quận|huyện|thị xã)\s+([^,]+)",
        address,
        re.IGNORECASE,
    )
    if not m_dist:
        m_dist = re.search(
            r"\b(phường|xã)\s+([^,]+)",
            address,
            re.IGNORECASE,
        )
    if m_dist:
        d_val = f"{m_dist.group(1)} {m_dist.group(2).strip()}"
        if not re.search(r"\b(hà nội|hồ chí minh|đà nẵng|hải phòng|cần thơ)\b", d_val, re.IGNORECASE):
            district = d_val

    city = None
    m_city = re.search(
        r"\b(thành phố|tỉnh|tp\.)\s+([^,]+)",
        address,
        re.IGNORECASE,
    )
    if m_city:
        city = f"{m_city.group(1)} {m_city.group(2).strip()}"
    elif re.search(r"\b(hà nội|hanoi)\b", address, re.IGNORECASE):
        city = "thành phố Hà Nội"
    elif re.search(r"\b(hồ chí minh|ho chi minh|sài gòn|saigon)\b", address, re.IGNORECASE):
        city = "thành phố Hồ Chí Minh"
    elif re.search(r"\b(đà nẵng|da nang)\b", address, re.IGNORECASE):
        city = "thành phố Đà Nẵng"

    return district, city, postal


def classify_resolved_links(links: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Phân loại liên kết sau khi giải mã domain sạch."""
    out = {
        "youtube": None,
        "email": None,
        "phone": None,
        "lat": None,
        "lng": None,
        "messenger_handle": None,
        "website": None,
    }
    for link in links or []:
        raw_href = str((link or {}).get("href") or "").strip()
        if not raw_href:
            continue
        low = raw_href.lower()
        if low.startswith("mailto:"):
            em = find_email(unquote(raw_href[7:]))
            if em and not out["email"]:
                out["email"] = em
            continue
        if low.startswith("tel:"):
            ph = normalize_phone(unquote(raw_href[4:]))
            if ph and not out["phone"]:
                out["phone"] = ph
            continue

        clean_url = unwrap_clean_url(raw_href)
        clean_low = clean_url.lower()

        # YouTube: youtube.com/youtu.be
        if ("youtube.com" in clean_low or "youtu.be" in clean_low) and not out["youtube"]:
            out["youtube"] = clean_url
            continue

        # Bing Maps: where1=lat,lng
        if "bing.com/maps" in clean_low or "where1=" in clean_low:
            m_coords = re.search(r"where1=([\-+]?\d+(?:\.\d+)?)(?:,|%2c|\s|\+|%20)+([\-+]?\d+(?:\.\d+)?)", clean_url, re.IGNORECASE)
            if m_coords and out["lat"] is None:
                try:
                    out["lat"] = float(m_coords.group(1))
                    out["lng"] = float(m_coords.group(2))
                except Exception:
                    pass
            continue

        # Messenger handle: chỉ khi có link m.me hoặc messenger.com
        if "m.me/" in clean_low or "messenger.com/t/" in clean_low:
            if not out["messenger_handle"]:
                m_handle = re.search(r"(?:m\.me|messenger\.com/t)/([^/?#]+)", clean_url, re.IGNORECASE)
                if m_handle:
                    handle = m_handle.group(1).strip()
                    if handle and not handle.startswith("profile.php"):
                        out["messenger_handle"] = handle
            continue

        # Website khác (bỏ qua social networks)
        if not out["website"] and _clean_website(clean_url):
            out["website"] = clean_url

    return out


def parse_messenger_text(lines: List[str], links: List[Dict[str, Any]], page_name: Optional[str] = None) -> Optional[str]:
    """Messenger đọc bằng TEXT/icon (không phải href)."""
    for link in links or []:
        href = str(link.get("href") or "").lower()
        text = str(link.get("text") or "").strip()
        if ("m.me/" in href or "messenger.com" in href) and text:
            if not re.search(r"^(gửi tin nhắn|send message|nhắn tin|chat)$", text, re.IGNORECASE):
                return text

    for line in lines:
        m_prefix = re.search(r"^(?:messenger|tin nhắn|nhắn tin|gửi tin nhắn)\s*[:·-]?\s*(.+)$", line.strip(), re.IGNORECASE)
        if m_prefix:
            cand = m_prefix.group(1).strip()
            if cand and _norm_label(cand) not in _ALL_LABELS and len(cand) >= 2:
                return cand

    for idx, line in enumerate(lines):
        norm = _norm_label(line)
        if norm in ("messenger", "tin nhắn", "nhắn tin", "send message", "chat"):
            for j in (idx + 1, idx - 1):
                if 0 <= j < len(lines):
                    cand = lines[j].strip()
                    if cand and _norm_label(cand) not in _ALL_LABELS and len(cand) >= 2:
                        return cand

    if page_name:
        for line in lines:
            if "messenger" in line.lower() and page_name.lower() in line.lower():
                return page_name

    return None


def _is_social_host(url: str) -> bool:
    try:
        host = (urlparse(url if "://" in url else f"https://{url}").netloc or "").lower()
    except ValueError:
        return True
    host = host.split(":")[0]
    return any(host == h or host.endswith("." + h) for h in _SOCIAL_HOSTS)


def _clean_website(url: str) -> Optional[str]:
    url = (url or "").strip().rstrip("/")
    if not url or _is_social_host(url):
        return None
    if not _DOMAIN_RE.match(url):
        return None
    return url


def _value_near_label(lines: List[str], idx: int, validator) -> Optional[str]:
    """FB hiển thị 'giá trị' rồi dòng nhãn bên dưới; vài layout ngược lại."""
    for j in (idx - 1, idx + 1):
        if 0 <= j < len(lines):
            cand = lines[j].strip()
            if cand and _norm_label(cand) not in _ALL_LABELS:
                value = validator(cand)
                if value:
                    return value
    return None


def _valid_address(line: str) -> Optional[str]:
    line = (line or "").strip()
    if not (5 <= len(line) <= 200):
        return None
    if _EMAIL_RE.search(line) or _NOISE_RE.search(line) or line.lower().startswith("http"):
        return None
    if find_phone(line) and len(re.sub(r"\D", "", line)) >= 8 and not _ADDRESS_HINT_RE.search(line):
        return None
    return line


# Tiêu đề mục trong cột Giới thiệu (Page kiểu mới) → loại mục để đọc giá trị bên dưới
_SECTION_HEADS = {
    "details": "details", "chi tiết": "details",
    "links": "links", "liên kết": "links", "websites and social links": "links",
    "trang web và liên kết mạng xã hội": "links",
    "contact info": "contact", "thông tin liên hệ": "contact", "contact": "contact",
}
_STOP_HEADS = {
    "featured", "đáng chú ý", "photos", "ảnh", "posts", "bài viết", "reels", "intro", "giới thiệu",
    "bio", "tiểu sử", "category", "hạng mục", "about", "filters", "bộ lọc", "see all", "xem tất cả",
    "page transparency", "minh bạch trang", "more", "xem thêm",
}
_TAB_LABELS = _STOP_HEADS | set(_SECTION_HEADS)
# Hết cột Giới thiệu trên trang chính — phần sau là bài đăng (nhiễu SĐT/email lạ)
_INTRO_END = {"featured", "đáng chú ý", "posts", "bài viết", "filters", "bộ lọc"}


def intro_text(header_text: str) -> str:
    """Cắt text trang chính tới hết cột Giới thiệu (bỏ phần bài đăng)."""
    out = []
    for line in (header_text or "").splitlines():
        if _norm_label(line) in _INTRO_END:
            break
        out.append(line)
    return "\n".join(out)


# Nhãn ẩn của chấm xanh "đang hoạt động" trên avatar Page — FB đặt trước tên Page trong text trang
_STATUS_NOISE_RE = re.compile(
    r"^((active|online)\s+status\s+indicator|active( now)?|online|đang hoạt động|chỉ báo trạng thái.*"
    r"|trạng thái (hoạt động|trực tuyến))$",
    re.IGNORECASE,
)


def is_status_noise(line: str) -> bool:
    return bool(_STATUS_NOISE_RE.match((line or "").strip()))


def first_text_line(text: str) -> Optional[str]:
    """Dòng đầu text trang = tên Page (dự phòng khi không thấy h1). Bỏ qua nhãn chấm trạng thái hoạt động."""
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or is_status_noise(line):
            continue
        if len(line) <= 120 and not _NOISE_RE.search(line) and _norm_label(line) not in _TAB_LABELS:
            return line
        return None
    return None


def name_before_followers(text: str) -> Optional[str]:
    """Tên Page nằm ngay trên dòng '… followers / người theo dõi' của phần đầu trang."""
    lines = [l.strip() for l in (text or "").splitlines()]
    for idx, line in enumerate(lines):
        if not re.search(r"(followers?|người\s*theo\s*dõi)", line, re.IGNORECASE):
            continue
        for prev in reversed(lines[:idx]):
            if not prev or is_status_noise(prev):
                continue
            if len(prev) <= 120 and not _NOISE_RE.search(prev) and _norm_label(prev) not in _TAB_LABELS:
                return prev
            return None
        return None
    return None


def pick_page_name(heading_name: Optional[str], header_text: str) -> Optional[str]:
    """Tên từ h1 nếu hợp lệ; không thì dòng ngay trên số follower, cuối cùng là dòng đầu text trang."""
    name = (heading_name or "").strip()
    if name and not is_status_noise(name):
        return name
    return name_before_followers(header_text) or first_text_line(header_text)


def _section_values(lines: List[str]) -> Dict[str, Optional[str]]:
    """Đọc giá trị theo mục Chi tiết / Liên kết / Thông tin liên hệ (không có nhãn từng dòng)."""
    found: Dict[str, Optional[str]] = {"phone": None, "email": None, "website": None, "address": None}
    section: Optional[str] = None
    for line in lines:
        label = _norm_label(line)
        if label in _SECTION_HEADS:
            section = _SECTION_HEADS[label]
            continue
        if label in _STOP_HEADS:
            section = None
            continue
        if not section:
            continue
        if not found["email"]:
            found["email"] = find_email(line)
        if not found["phone"] and not _EMAIL_RE.search(line):
            found["phone"] = find_phone(line)
        if section == "links" and not found["website"] and " " not in line:
            found["website"] = _clean_website(line)
        # Chi tiết còn có "Rating · 4.8", "Price range · $$", giờ mở cửa 08:00 → bỏ
        if section in ("details", "contact") and not found["address"] \
                and ("," in line or re.search(r"\d", line)) and not find_phone(line) \
                and "·" not in line and not re.search(r"\d{1,2}:\d{2}", line):
            found["address"] = _valid_address(line)
    return found


def extract_category(header_text: str) -> Optional[str]:
    match = re.search(r"(?:Trang|Page)\s*[·•]\s*([^\n·•|]{2,80})", header_text or "", re.IGNORECASE)
    return match.group(1).strip() if match else None


def extract_followers(text: str) -> Tuple[Optional[int], Optional[str]]:
    """Tìm cụm '… người theo dõi / followers' rồi parse thành số."""
    match = re.search(
        r"[\d]+(?:[.,][\d]+)*\s*(?:nghìn|ngàn|triệu|n|k|tr|m)?\s*(?:người\s*theo\s*dõi|followers?)\b",
        text or "",
        re.IGNORECASE,
    )
    if not match:
        return None, None
    count, _ = parse_follower_count(match.group(0))
    return count, match.group(0).strip()


_PRICE_LINE_RE = re.compile(r"^\s*(?:\${1,4}|[£€₫]{1,4})(?:\s*[-–]\s*(?:\${1,4}|[£€₫]{1,4}))?\s*$")
_PRICE_PREFIX_RE = re.compile(r"^\s*(?:\${1,4}|[£€₫]{1,4})\s*[·•|,\-–]?\s+")
_OPENING_PREFIX_RE = re.compile(
    r"^\s*(?:luôn mở cửa|always open|đang mở cửa|open now|đóng cửa|closed(?: now)?)\s*[·•|,\-–:]?\s+",
    re.IGNORECASE,
)


def _is_price_line(line: str) -> bool:
    return bool(_PRICE_LINE_RE.match(line or ""))


def _clean_address_line(line: str) -> Optional[str]:
    """Bỏ giá ($$) / trạng thái mở cửa dính đầu dòng, rồi kiểm tra là địa chỉ."""
    line = (line or "").strip()
    if not line or _is_price_line(line) or parse_opening_info(line):
        # dòng chỉ là giá / giờ mở cửa; riêng dòng vừa có giờ vừa có địa chỉ xử lý ở dưới
        stripped = line
    else:
        stripped = line
    for _ in range(4):
        new = _PRICE_PREFIX_RE.sub("", stripped, count=1)
        new = _OPENING_PREFIX_RE.sub("", new, count=1)
        if new == stripped:
            break
        stripped = new
    stripped = stripped.strip()
    if not stripped or _is_price_line(stripped):
        return None
    # Dòng đánh giá "100% đề xuất" / "(21 lượt đánh giá)" không phải địa chỉ
    if re.search(r"\d\s*%", stripped) and re.search(r"đề xuất|recommend", stripped, re.IGNORECASE):
        return None
    if parse_opening_info(stripped) and not ("," in stripped and len(stripped) > 40):
        return None
    addr = _valid_address(stripped)
    if addr and ("," in addr or re.search(r"\d", addr)):
        return addr
    return None


def _group_panel_rows(panel_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Gộp các item đã tách dòng về từng row (giữ logic nhận dạng theo row như trước)."""
    rows: List[Dict[str, Any]] = []
    index: Dict[Tuple[Any, Any], Dict[str, Any]] = {}
    for n, p in enumerate(panel_items or []):
        key = (p.get("section"), p.get("row") if p.get("row") is not None else ("_", n))
        row = index.get(key)
        if row is None:
            row = {"section": p.get("section"), "lines": [], "hrefs": [], "icon": ""}
            index[key] = row
            rows.append(row)
        txt = (p.get("text") or "").strip()
        if txt:
            row["lines"].append(txt)
        href = (p.get("href") or "").strip()
        if href:
            row["hrefs"].append((href, txt))
        if not row["icon"] and p.get("icon"):
            row["icon"] = p.get("icon")
    return rows


_CONTACT_FIELDS = ("phone", "email", "website", "address")
_EXTRA_DETAIL_FIELDS = (
    "rating_percent", "rating_count", "opening", "youtube", "messenger",
    "messenger_handle", "district", "city", "postal", "lat", "lng"
)
_ALL_DETAIL_FIELDS = _CONTACT_FIELDS + _EXTRA_DETAIL_FIELDS


def extract_contact_info(
    about_text: str,
    links: Optional[List[Dict[str, Any]]] = None,
    panel_items: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Tách SĐT / Email / Website / Địa chỉ + Rating / Giờ mở cửa / YouTube / Messenger / Tọa độ
    từ text trang About / Giới thiệu + danh sách link đã resolve + các mục đọc theo DOM panel_items.
    """
    lines = [l.strip() for l in (about_text or "").splitlines() if l.strip()]
    result: Dict[str, Any] = {k: None for k in _ALL_DETAIL_FIELDS}

    # 0. Nếu có panel_items được trích xuất trực tiếp bằng DOM (scope theo heading)
    all_links = list(links or [])
    if panel_items:
        for p in panel_items:
            href = (p.get("href") or "").strip()
            if href:
                all_links.append({"href": href, "text": (p.get("text") or "").strip()})

        for row in _group_panel_rows(panel_items):
            sec = row["section"]
            txt = "\n".join(row["lines"]).strip()
            icon = (row["icon"] or "").lower()

            # Section: Chi tiết (details)
            if sec == "details":
                pct, cnt = parse_rating_info(txt)
                if pct is not None and not result["rating_percent"]:
                    result["rating_percent"] = pct
                    result["rating_count"] = cnt
                op = parse_opening_info(txt)
                if op and not result["opening"]:
                    result["opening"] = op
                # Địa chỉ: theo từng dòng, bỏ giá ($$) / giờ mở cửa; nhiều cơ sở → nhiều dòng
                addr_lines = [
                    ln for ln in (_clean_address_line(x) for x in row["lines"]) if ln
                ]
                if addr_lines and not result["address"]:
                    result["address"] = "\n".join(addr_lines)

            # Section: Thông tin liên hệ (contact)
            elif sec == "contact":
                if ("messenger" in icon or "messenger" in txt.lower() or "nhắn tin" in txt.lower()) and not result["messenger"]:
                    cand_msg = re.sub(r"^(messenger|tin nhắn|nhắn tin|gửi tin nhắn)\s*[:·-]?\s*", "", txt, flags=re.IGNORECASE).strip()
                    if cand_msg:
                        result["messenger"] = cand_msg
                em = find_email(txt)
                if em and not result["email"]:
                    result["email"] = em
                ph = find_phone(txt)
                if ph and not result["phone"]:
                    result["phone"] = ph
                addr = _valid_address(txt)
                if addr and not result["address"] and ("," in txt or re.search(r"\d", txt)):
                    result["address"] = addr

    # 1. Phân loại links theo domain đã giải mã (unwrap tối đa 3 lần, bỏ fbclid/__cft__/__tn__)
    resolved_links = classify_resolved_links(all_links)
    for k in ("youtube", "email", "phone", "lat", "lng", "messenger_handle", "website"):
        if resolved_links.get(k) is not None and result.get(k) is None:
            result[k] = resolved_links[k]

    # 2. Parse Rating
    pct, cnt = parse_rating_info(about_text)
    if pct is not None:
        result["rating_percent"] = pct
        result["rating_count"] = cnt

    # 3. Parse Opening Hours
    op = parse_opening_info(about_text)
    if op:
        result["opening"] = op

    # 4. Parse Messenger text
    msg = parse_messenger_text(lines, links or [])
    if msg:
        result["messenger"] = msg

    # 5. Dòng có nhãn chuẩn
    validators = {
        "phone": find_phone,
        "email": find_email,
        "website": _clean_website,
        "address": _valid_address,
    }
    for idx, line in enumerate(lines):
        label = _norm_label(line)
        for field, labels in _LABELS.items():
            if result[field] or label not in labels:
                continue
            result[field] = _value_near_label(lines, idx, validators[field])

    # 6. Theo section Chi tiết / Liên kết / Thông tin liên hệ
    for field, value in _section_values(lines).items():
        if value and not result[field]:
            result[field] = value

    # 7. Fallback quét toàn văn
    if not result["email"]:
        result["email"] = find_email(about_text)
    if not result["phone"]:
        result["phone"] = find_phone(about_text)
    if not result["website"]:
        for line in lines:
            if " " in line or "@" in line:
                continue
            site = _clean_website(line)
            if not site:
                continue
            host = urlparse(site if "://" in site else f"https://{site}").netloc.lower()
            if host.rsplit(".", 1)[-1] in _COMMON_TLDS:
                result["website"] = site
                break
    if not result["address"]:
        for line in lines:
            if "," in line and _ADDRESS_HINT_RE.search(line):
                addr = _valid_address(line)
                if addr and len(addr) >= 8:
                    result["address"] = addr
                    break

    # 8. Tách thành phần địa chỉ (district, city, postal) nếu có address
    if result.get("address"):
        dist, city, post = parse_address_components(result["address"])
        result["district"] = dist
        result["city"] = city
        result["postal"] = post

    return result


def page_tab_url(page_url: str, tab: str) -> str:
    """slug → …/slug/{tab};  profile.php?id=… → …&sk={tab}."""
    url = (page_url or "").strip()
    if "profile.php" in url.lower():
        if re.search(r"[?&]sk=", url, flags=re.IGNORECASE):
            return re.sub(r"([?&]sk=)[^&]*", lambda m: m.group(1) + tab, url, count=1, flags=re.IGNORECASE)
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}sk={tab}"
    return url.split("?")[0].rstrip("/") + "/" + tab


def about_contact_url(page_url: str) -> str:
    """Tab 'Thông tin liên hệ và cơ bản' của layout cũ."""
    return page_tab_url(page_url, "about_contact_and_basic_info")


def find_tab_link(links: List[Dict[str, Any]], tab: str) -> Optional[str]:
    """Link tab About của Page kiểu mới (vd /directory_contact_info) lấy từ chính trang About."""
    for link in links or []:
        href = str((link or {}).get("href") or "")
        if re.search(rf"(?:/|sk=){re.escape(tab)}\b", href):
            return href if href.startswith("http") else "https://www.facebook.com" + href
    return None


def clean_category(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    if not value or _norm_label(value) in _TAB_LABELS or len(value) > 80:
        return None
    return value


# ==================== Selenium ====================


def _is_checkpoint_url(driver) -> bool:
    try:
        cur = (driver.current_url or "").lower()
    except Exception:
        return False
    return "/checkpoint/" in cur or "/login" in cur


def has_session_cookie(driver) -> bool:
    """Có cookie c_user = đang đăng nhập. Lỗi đọc cookie → không chặn (coi như còn phiên)."""
    try:
        cookie = driver.get_cookie("c_user")
    except Exception:
        return True
    return bool(cookie and (cookie.get("value") if isinstance(cookie, dict) else cookie))


def _open_and_wait(driver, url: str, stop_event: threading.Event) -> None:
    try:
        driver.get(url)
    except Exception as exc:
        # Timeout tải trang: DOM thường đã có nội dung — tiếp tục đọc
        logger.debug(f"[DETAIL] get {url}: {exc}")
    deadline = time.time() + CONTENT_WAIT_S
    while time.time() < deadline and not stop_event.is_set():
        try:
            if driver.execute_script(_CONTENT_READY_JS):
                break
        except Exception:
            pass
        time.sleep(0.4)
    # About tải phần liên hệ trễ hơn khung main
    stop_event.wait(1.2)


def _read_about(driver, url: str, stop_event: threading.Event) -> Dict[str, Any]:
    _open_and_wait(driver, url, stop_event)
    try:
        return driver.execute_script(_READ_ABOUT_JS) or {}
    except Exception as exc:
        logger.debug(f"[DETAIL] read about {url}: {exc}")
        return {}


def scan_page_detail(driver, page_url: str, stop_event: threading.Event) -> Dict[str, Any]:
    """Mở Page + About, trả dict chi tiết (hoặc reason khi lỗi / checkpoint)."""
    _open_and_wait(driver, page_url, stop_event)
    if _is_checkpoint_url(driver):
        return {"ok": False, "reason": "checkpoint"}
    if not has_session_cookie(driver):
        # Page công khai vẫn hiện khi đã bị đăng xuất → không được quét bằng phiên khách
        return {"ok": False, "reason": "logged_out"}
    try:
        header = driver.execute_script(_READ_HEADER_JS) or {}
    except Exception as exc:
        return {"ok": False, "reason": f"header_error: {str(exc)[:120]}"}
    if header.get("unavailable"):
        return {"ok": False, "reason": "unavailable"}

    header_text = header.get("header_text") or ""
    follower_count, follower_text = extract_followers(header_text)
    detail: Dict[str, Any] = {
        "ok": True,
        "_header_text": header_text,
        "_panel_items": header.get("panel_items") or [],
        "_links": header.get("links") or [],
        "page_name": pick_page_name(header.get("page_name"), header_text),
        "avatar_url": header.get("avatar_url"),
        "is_verified": header.get("is_verified"),
        "category": clean_category(extract_category(header_text)),
        "follower_count": follower_count,
        "follower_text": follower_text,
    }
    return detail


def merge_contacts(*parts: Dict[str, Any]) -> Dict[str, Any]:
    """Gộp theo thứ tự ưu tiên: nguồn trước có giá trị thì giữ."""
    merged: Dict[str, Any] = {k: None for k in _ALL_DETAIL_FIELDS}
    for part in parts:
        for key in _ALL_DETAIL_FIELDS:
            if merged[key] is None and (part or {}).get(key) is not None:
                merged[key] = part[key]
    return merged


def scan_page_contacts(
    driver,
    page_url: str,
    header_text: str,
    stop_event: threading.Event,
    header_panel_items: Optional[List[Dict[str, Any]]] = None,
    header_links: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Page kiểu mới: /about chỉ có Giới thiệu; liên hệ ở /directory_contact_info, web ở /directory_links,
    địa chỉ + liên kết hiện ở cột Giới thiệu trang chính. Layout cũ: /about_contact_and_basic_info.
    Ưu tiên: tab liên hệ > About > cột Giới thiệu trang chính.
    """
    def parse(page: Dict[str, Any]) -> Dict[str, Any]:
        return extract_contact_info(
            page.get("about_text") or "",
            page.get("links") or [],
            page.get("panel_items") or [],
        )

    raws: List[Dict[str, Any]] = []
    about = _read_about(driver, build_about_url(page_url), stop_event)
    raws.append(about)
    about_links = about.get("links") or []

    contact_page: Dict[str, Any] = {}
    contact_href = find_tab_link(about_links, "directory_contact_info")
    if contact_href and not stop_event.is_set():
        contact_page = _read_about(driver, contact_href, stop_event)
        raws.append(contact_page)

    contacts = merge_contacts(
        parse(contact_page),
        parse(about),
        extract_contact_info(intro_text(header_text), header_links or about_links, header_panel_items),
        extract_contact_info(header_text, header_links or about_links, header_panel_items),
    )

    if not contact_href and not any(contacts.get(k) for k in ("phone", "email", "website")) \
            and not stop_event.is_set():
        legacy = _read_about(driver, about_contact_url(page_url), stop_event)
        raws.append(legacy)
        contacts = merge_contacts(parse(legacy), contacts)

    links_href = find_tab_link(about_links, "directory_links")
    if not contacts.get("website") and links_href and not stop_event.is_set():
        links_page = _read_about(driver, links_href, stop_event)
        raws.append(links_page)
        contacts = merge_contacts(contacts, parse(links_page))

    cat = re.search(
        r"(?:Hạng mục|Category)\s*[:\n]\s*([^\n]{2,80})", about.get("about_text") or "", re.IGNORECASE
    )
    contacts["category"] = clean_category(cat.group(1)) if cat else None
    contacts["_raw"] = raws
    return contacts


def dump_debug_text(page_key: str, header_text: str, abouts: List[Dict[str, Any]], result: Dict[str, Any]) -> Optional[str]:
    """Ghi text thô đã đọc (header + About) ra logs/page_detail_debug/ để soát lỗi tách thông tin."""
    try:
        from config.paths import runtime_root

        folder = runtime_root() / "logs" / "page_detail_debug"
        folder.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", page_key)[:100] or "page"
        path = folder / f"{safe}.txt"
        parts = [
            f"page_key: {page_key}",
            "result: " + ", ".join(f"{k}={result.get(k)!r}" for k in (
                "page_name", "follower_text", "category", "phone", "email", "website", "address",
            )),
            "\n===== HEADER (trang chính) =====\n" + (header_text or ""),
        ]
        for about in abouts or []:
            links = "\n".join(
                f"  {l.get('href')}  |  {l.get('text')}" for l in (about.get("links") or [])
                if l.get("href") and not str(l.get("href")).startswith("#")
            )
            parts.append(
                f"\n===== ABOUT {about.get('current_url') or ''} =====\n{about.get('about_text') or ''}"
                f"\n----- LINKS -----\n{links}"
            )
        path.write_text("\n".join(parts), encoding="utf-8")
        return str(path)
    except Exception as exc:
        logger.debug(f"[DETAIL] dump debug {page_key}: {exc}")
        return None


# ==================== DB ====================


def save_page_detail(
    owner_key: str,
    session_id: int,
    page_key: str,
    page_url: str,
    detail: Dict[str, Any],
    status: str,
    source_type: str,
    account_uid: Optional[str],
    batch_index: int,
) -> bool:
    """Upsert scanned_pages (giữ dữ liệu cũ khi lần này không đọc được) + gắn vào phiên."""
    extra_meta = {
        "rating_percent": detail.get("rating_percent"),
        "rating_count": detail.get("rating_count"),
        "opening": detail.get("opening"),
        "youtube": detail.get("youtube"),
        "messenger": detail.get("messenger"),
        "messenger_handle": detail.get("messenger_handle"),
        "district": detail.get("district"),
        "city": detail.get("city"),
        "postal": detail.get("postal"),
        "lat": detail.get("lat"),
        "lng": detail.get("lng"),
    }
    desc_val = (
        json.dumps(extra_meta, ensure_ascii=False)
        if any(v is not None for v in extra_meta.values())
        else detail.get("description")
    )

    row = db.fetch_one(
        """
        INSERT INTO scanned_pages (
            owner_key, page_key, page_name, page_url, avatar_url, category,
            follower_count, follower_text, is_verified,
            phone, email, website, address, description,
            detail_status, detail_scanned_at, detail_session_id,
            first_found_by_account_uid, first_source_type, first_session_id,
            created_at, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, NOW(), %s,
            %s, %s, %s,
            NOW(), NOW()
        )
        ON CONFLICT (owner_key, page_key) DO UPDATE
        SET page_name = COALESCE(EXCLUDED.page_name, scanned_pages.page_name),
            avatar_url = COALESCE(EXCLUDED.avatar_url, scanned_pages.avatar_url),
            category = COALESCE(EXCLUDED.category, scanned_pages.category),
            follower_count = COALESCE(EXCLUDED.follower_count, scanned_pages.follower_count),
            follower_text = COALESCE(EXCLUDED.follower_text, scanned_pages.follower_text),
            is_verified = COALESCE(EXCLUDED.is_verified, scanned_pages.is_verified),
            phone = COALESCE(EXCLUDED.phone, scanned_pages.phone),
            email = COALESCE(EXCLUDED.email, scanned_pages.email),
            website = COALESCE(EXCLUDED.website, scanned_pages.website),
            address = COALESCE(EXCLUDED.address, scanned_pages.address),
            description = COALESCE(EXCLUDED.description, scanned_pages.description),
            detail_status = CASE
                WHEN EXCLUDED.detail_status = 'FAILED' AND scanned_pages.detail_status = 'SCANNED'
                THEN scanned_pages.detail_status
                ELSE EXCLUDED.detail_status
            END,
            detail_scanned_at = NOW(),
            detail_session_id = EXCLUDED.detail_session_id,
            updated_at = NOW()
        RETURNING (xmax = 0) AS is_new
        """,
        (
            owner_key,
            page_key,
            detail.get("page_name"),
            page_url,
            detail.get("avatar_url"),
            detail.get("category"),
            detail.get("follower_count"),
            detail.get("follower_text"),
            detail.get("is_verified"),
            detail.get("phone"),
            (detail.get("email") or "")[:255] or None,
            detail.get("website"),
            detail.get("address"),
            desc_val,
            status,
            session_id,
            account_uid,
            source_type,
            session_id,
        ),
    )
    is_new = bool(row and row.get("is_new"))
    db.execute(
        """
        INSERT INTO page_scan_session_pages (session_id, page_key, batch_index, is_new_globally, created_at)
        VALUES (%s, %s, %s, %s, NOW())
        ON CONFLICT (session_id, page_key) DO NOTHING
        """,
        (session_id, page_key, batch_index, is_new),
    )
    return is_new


def _update_progress(session_id: int, processed: int, saved: int) -> None:
    try:
        db.execute(
            """
            UPDATE page_scan_sessions SET total_seen = %s, total_unique = %s, batches_count = %s
            WHERE id = %s AND status IN ('RUNNING', 'PAUSED')
            """,
            (processed, saved, processed, session_id),
        )
    except Exception as exc:
        logger.debug(f"[DETAIL] progress: {exc}")


# ==================== Flow ====================


def _normalize_pages(pages: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    seen = set()
    for p in pages or []:
        key = str((p or {}).get("page_key") or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        url = str((p or {}).get("page_url") or "").strip() or page_key_to_url(key)
        out.append({"page_key": key, "page_url": url})
    return out


def _existing_page_keys(owner_key: str, page_keys: List[str]) -> set:
    """page_key đã có trong kho scanned_pages của owner.
    Page đã có trong DB thì quét lại luôn cập nhật dữ liệu mới (không áp ngưỡng follower như page mới)."""
    if not page_keys:
        return set()
    try:
        rows = db.fetch_all(
            "SELECT page_key FROM scanned_pages WHERE owner_key = %s AND page_key = ANY(%s)",
            (owner_key, list(page_keys)),
        )
        return {r["page_key"] for r in (rows or [])}
    except Exception as exc:
        logger.warning(f"[DETAIL] Không đọc được page đã có trong DB: {exc}")
        return set()


def run_page_detail_flow(
    pages: List[Dict[str, Any]],
    owner_key: str,
    session_id: int,
    account_uids: Optional[List[str]] = None,
    source_type: str = "PARSE",
    target_pages: Optional[int] = None,
    min_followers: int = 0,
    rotate_every: int = 0,
    rotate_on_checkpoint: bool = True,
    page_delay_min_s: Optional[float] = None,
    page_delay_max_s: Optional[float] = None,
    page_delay_s: float = 3.0,
    keep_browser: bool = False,
    headless: bool = False,
    allow_direct_fallback: bool = True,
    max_pages_per_acc: int = DEFAULT_PAGES_PER_ACC_DAY,
) -> Dict[str, Any]:
    pages = _normalize_pages(pages)
    accounts = resolve_scan_accounts(account_uids, None, owner_key=owner_key)
    if not accounts:
        raise RuntimeError("Không tìm thấy tài khoản Facebook hợp lệ")
    target = int(target_pages) if target_pages else len(pages)
    min_followers = max(0, int(min_followers or 0))
    rotate_every = max(0, int(rotate_every or 0))
    existing_keys = _existing_page_keys(owner_key, [p["page_key"] for p in pages])

    with _ACTIVE_SESSIONS_LOCK:
        _ACTIVE_STOP_EVENTS.setdefault(session_id, threading.Event())
        _ACTIVE_PAUSE_EVENTS.setdefault(session_id, threading.Event())
        stop_event = _ACTIVE_STOP_EVENTS[session_id]

    def log(message: str, level: str = "info") -> None:
        append_session_log(session_id, message, level)

    rotation = AccountRotation(
        session_id, JOB_TYPE, accounts, owner_key,
        headless=headless, allow_direct_fallback=allow_direct_fallback, log=log,
        require_login=True,  # chưa đăng nhập vẫn xem được Page công khai → phải chặn trước khi quét
    )

    def quota_left() -> int:
        return max(0, int(max_pages_per_acc) - get_account_usage_today(rotation.uid, USAGE_ACTION))

    stop_reason = "COMPLETED"
    error_message: Optional[str] = None
    processed = saved = skipped = failed = 0
    start = time.time()

    try:
        try:
            driver = rotation.open()
        except Exception as exc:
            # Acc đầu không mở được Chrome / không đăng nhập được → thử các acc còn lại
            log(f"Không dùng được tài khoản {rotation.uid}: {exc}", "error")
            if rotation.rotate("chưa đăng nhập được", mark_dead=True):
                driver = rotation.driver
            else:
                stop_reason = "CHECKPOINT"
                error_message = "Không có tài khoản nào đăng nhập được — kiểm tra lại cookie / mật khẩu / 2FA"
                log(error_message, "error")
                raise

        log(
            f"DETAIL · {len(pages)} page · mục tiêu {target} · acc {rotation.uid} ({len(rotation.accounts)} acc)"
            f"{f' · followers ≥ {min_followers}' if min_followers else ''}"
            f"{f' · đổi acc sau {rotate_every} page' if rotate_every and rotation.can_rotate else ''}",
            "warn",
        )
        left = quota_left()

        for idx, page in enumerate(pages):
            if stop_event.is_set() or _wait_if_paused(session_id, stop_event):
                stop_reason = "USER_STOPPED"
                break
            if saved >= target:
                stop_reason = "TARGET_REACHED"
                break
            if left <= 0:
                if rotation.rotate(f"hết quota {max_pages_per_acc} page/ngày"):
                    driver = rotation.driver
                    left = quota_left()
                if left <= 0:
                    log(f"Tài khoản đã đạt {max_pages_per_acc} page hôm nay — dừng", "warn")
                    stop_reason = "TIMEOUT"
                    break

            page_key, page_url = page["page_key"], page["page_url"]
            log(f"[{idx + 1}/{len(pages)}] Mở {page_url} · acc {rotation.uid}")

            detail: Dict[str, Any] = {}
            relogged = False
            for _attempt in range(len(rotation.accounts) + 1):
                detail = scan_page_detail(driver, page_url, stop_event)
                reason = detail.get("reason")
                if reason not in ("checkpoint", "logged_out"):
                    break
                if reason == "logged_out" and not relogged:
                    # Phiên hết hạn giữa chừng → đăng nhập lại 1 lần trên acc hiện tại rồi mở lại Page
                    relogged = True
                    log(f"Tài khoản {rotation.uid} bị đăng xuất — đăng nhập lại", "warn")
                    if rotation.relogin():
                        continue
                log(f"{page_key}: {'mất đăng nhập' if reason == 'logged_out' else 'checkpoint/login'}"
                    f" trên acc {rotation.uid}", "error")
                if not (rotate_on_checkpoint and rotation.rotate("checkpoint/đăng xuất", mark_dead=True)):
                    break
                driver = rotation.driver
                left = quota_left()
                relogged = False
            if detail.get("reason") in ("checkpoint", "logged_out"):
                stop_reason, error_message = "CHECKPOINT", "Mất đăng nhập / checkpoint — không còn tài khoản thay thế"
                break

            processed += 1
            bump_account_usage(rotation.uid, USAGE_ACTION, 1)
            left -= 1
            rotation.count += 1

            if stop_event.is_set():
                stop_reason = "USER_STOPPED"
                break

            if not detail.get("ok"):
                failed += 1
                log(f"{page_key}: không đọc được Page ({detail.get('reason')})", "warn")
                save_page_detail(
                    owner_key, session_id, page_key, page_url, {}, "FAILED",
                    source_type, rotation.uid, idx + 1,
                )
            elif min_followers and page_key not in existing_keys and detail.get("follower_count") is not None \
                    and detail["follower_count"] < min_followers:
                # Chỉ page MỚI mới bị bỏ qua khi dưới ngưỡng; page đã có trong DB vẫn quét tiếp để cập nhật dữ liệu
                skipped += 1
                log(
                    f"{detail.get('page_name') or page_key}: {detail['follower_count']} followers"
                    f" < {min_followers} — bỏ qua",
                    "info",
                )
            else:
                contacts = scan_page_contacts(
                    driver,
                    page_url,
                    detail.get("_header_text") or "",
                    stop_event,
                    header_panel_items=detail.get("_panel_items") or [],
                    header_links=detail.get("_links") or [],
                )
                if not detail.get("category"):
                    detail["category"] = contacts.get("category")
                detail.update({k: contacts.get(k) for k in _ALL_DETAIL_FIELDS if contacts.get(k) is not None})
                header_raw_text = detail.pop("_header_text", "")
                detail.pop("_panel_items", None)
                detail.pop("_links", None)
                dump_path = dump_debug_text(
                    page_key, header_raw_text, contacts.get("_raw") or [], detail
                )
                if dump_path:
                    log(f"Text thô đã đọc: {dump_path}", "info")
                save_page_detail(
                    owner_key, session_id, page_key, page_url, detail, "SCANNED",
                    source_type, rotation.uid, idx + 1,
                )
                saved += 1
                found = [
                    f"{label} {detail[k]}" for k, label in
                    (("phone", "SĐT"), ("email", "Email"), ("website", "Web")) if detail.get(k)
                ]
                log(
                    f"{'Cập nhật page đã có trong DB' if page_key in existing_keys else 'Quét xong'}"
                    f" {detail.get('page_name') or page_key}"
                    f" · FL {detail.get('follower_text') or '—'}"
                    f" · {' · '.join(found) if found else 'không có thông tin liên hệ công khai'}",
                    "success",
                )
            _update_progress(session_id, processed, saved)

            has_next = idx < len(pages) - 1 and saved < target
            if has_next and rotate_every and rotation.can_rotate and rotation.count >= rotate_every:
                rotation.rotate(f"đủ {rotation.count} page / tài khoản")
                if rotation.driver is None:
                    stop_reason, error_message = "ERROR", "Không mở lại được trình duyệt sau khi đổi tài khoản"
                    break
                driver = rotation.driver
                left = quota_left()
            if has_next:
                delay = pick_page_delay(page_delay_min_s, page_delay_max_s, page_delay_s)
                log(f"Nghỉ {delay:.0f}s trước page tiếp theo")
                if sleep_page_delay(delay, stop_event):
                    stop_reason = "USER_STOPPED"
                    break
        else:
            stop_reason = "TARGET_REACHED" if saved >= target else ("NO_NEW_RESULTS" if not saved else "COMPLETED")
    except (Exception, ScanStopped) as exc:
        if stop_event.is_set():
            stop_reason = "USER_STOPPED"
        elif stop_reason != "CHECKPOINT":
            logger.exception(f"[DETAIL] #{session_id}: {exc}")
            stop_reason, error_message = "ERROR", str(exc)[:500]
            log(f"Lỗi: {error_message}", "error")
    finally:
        # Nhả trước khi ghi DB để DB lỗi không làm kẹt khóa profile
        rotation.release(stop_reason, keep_browser)
        final_status = {
            "USER_STOPPED": "STOPPED",
            "CHECKPOINT": "PARTIAL",
            "TIMEOUT": "PARTIAL",
            "ERROR": "FAILED",
        }.get(stop_reason, "COMPLETED")
        finalize_scan_session(
            session_id, final_status, stop_reason, processed, saved, skipped, 0,
            processed, int(time.time() - start), error_message,
        )
        log(
            f"Kết thúc DETAIL · {final_status}/{stop_reason} · lưu {saved}"
            f" · bỏ qua {skipped} · lỗi {failed}",
            "success" if final_status == "COMPLETED" else "warn",
        )
        with _ACTIVE_SESSIONS_LOCK:
            _ACTIVE_STOP_EVENTS.pop(session_id, None)
            _ACTIVE_PAUSE_EVENTS.pop(session_id, None)

    return {"session_id": session_id, "count": saved, "stop_reason": stop_reason, "status": final_status}


def start_page_detail_background(
    pages: List[Dict[str, Any]],
    owner_key: str,
    account_uids: Optional[List[str]] = None,
    source_type: str = "PARSE",
    source_label: Optional[str] = None,
    target_pages: Optional[int] = None,
    min_followers: int = 0,
    rotate_every: int = 0,
    rotate_on_checkpoint: bool = True,
    page_delay_min_s: Optional[float] = None,
    page_delay_max_s: Optional[float] = None,
    keep_browser: bool = False,
    headless: bool = False,
    allow_direct_fallback: bool = True,
) -> Tuple[int, int]:
    """Tạo phiên DETAIL + chạy nền. Trả (session_id, số page sẽ quét)."""
    pages = _normalize_pages(pages)
    if not pages:
        raise ValueError("Không có link Page hợp lệ để quét")
    source_type = "UPLOAD" if str(source_type).upper() == "UPLOAD" else "PARSE"

    accounts = order_accounts_free_first(resolve_scan_accounts(account_uids, None, owner_key=owner_key))
    if not accounts:
        raise RuntimeError("Không tìm thấy tài khoản Facebook hợp lệ")
    ordered_uids = [str(a.get("uid") or "").strip() for a in accounts]
    target_uid = ordered_uids[0]
    label = source_label or ("Upload file" if source_type == "UPLOAD" else "Nhập link")

    session_id = create_scan_session(
        owner_key=owner_key,
        keyword=f"{label} · {len(pages)} page",
        account_uid=target_uid,
        source_type=source_type,
        max_results=min(len(pages), int(target_pages or len(pages))),
        settings={
            "job": JOB_TYPE,
            "page_keys": [p["page_key"] for p in pages],
            "target_pages": target_pages,
            "min_followers": min_followers,
            "rotate_every": rotate_every,
            "page_delay_min_s": page_delay_min_s,
            "page_delay_max_s": page_delay_max_s,
            "account_uids": ordered_uids,
            "source_label": label,
            "automation": True,
        },
    )
    db.execute("UPDATE page_scan_sessions SET job_type = %s WHERE id = %s", (JOB_TYPE, session_id))

    with _ACTIVE_SESSIONS_LOCK:
        _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()
    try:
        try_acquire_account_job(target_uid, session_id, JOB_TYPE)
    except AccountBusyError:
        finalize_scan_session(session_id, "FAILED", "ERROR", 0, 0, 0, 0, 0, 0, "BUSY race — acc vừa bị chiếm")
        with _ACTIVE_SESSIONS_LOCK:
            _ACTIVE_STOP_EVENTS.pop(session_id, None)
            _ACTIVE_PAUSE_EVENTS.pop(session_id, None)
        raise

    def _runner():
        try:
            run_page_detail_flow(
                pages=pages,
                owner_key=owner_key,
                session_id=session_id,
                account_uids=ordered_uids,
                source_type=source_type,
                target_pages=target_pages,
                min_followers=min_followers,
                rotate_every=rotate_every,
                rotate_on_checkpoint=rotate_on_checkpoint,
                page_delay_min_s=page_delay_min_s,
                page_delay_max_s=page_delay_max_s,
                keep_browser=keep_browser,
                headless=headless,
                allow_direct_fallback=allow_direct_fallback,
            )
        except Exception as exc:
            logger.exception(f"[DETAIL] background #{session_id}: {exc}")
            try:
                finalize_scan_session(session_id, "FAILED", "ERROR", 0, 0, 0, 0, 0, 0, str(exc)[:500])
            except Exception:
                pass
            release_account_job(target_uid, session_id)

    threading.Thread(target=_runner, daemon=True, name=f"page_detail_worker_{session_id}").start()
    return session_id, len(pages)
