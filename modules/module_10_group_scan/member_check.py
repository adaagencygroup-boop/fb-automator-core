"""
Module 10.2: Quét thành viên nhóm (Group Member Scraping)
- UC-GMS-01: Chọn tài khoản Facebook thực thi (xoay vòng pool nhiều nick)
- UC-GMS-02: Chọn nhóm mục tiêu từ kho danh mục (tối đa 20 nhóm / phiên)
- UC-GMS-03: Cấu hình quét nâng cao (delay min-max, đổi nick sau N nhóm, giới hạn TV/nhóm, lọc Admin/Mod, lọc trùng cross-group, ưu tiên thành viên mới)
- UC-GMS-04: Khởi chạy quét, cuộn trang vô tận, live log real-time, checkpoint lưu CSDL
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
    NEW_MEMBER_DAYS,
    TERMINAL_STATUSES,
    close_account_session,
    fb_time_age_days,
    interruptible_sleep,
    open_account_session,
    prune_jobs,
    resolve_group_identity,
    wait_while_paused,
)

logger = logging.getLogger(__name__)

_member_jobs: dict[str, dict[str, Any]] = {}
_member_jobs_lock = threading.Lock()

SCRAPE_MEMBERS_JS = """
return (() => {
  // Ưu tiên thẻ tên thành viên dạng:
  // <a href="/groups/{gid}/user/{uid}/" role="link">Emily Martin</a>
  const byUid = new Map();

  const cleanName = (raw) => {
    let n = (raw || '').replace(/\\s+/g, ' ').trim();
    n = n.split('\\n')[0].trim();
    n = n.replace(/^(Profile photo of|Ảnh đại diện của|Anh dai dien cua)\\s*/i, '');
    if (!n || n.length < 2) return '';
    if (/^(join|tham gia|joined|đang chờ|xem tất cả|see all|quản trị viên|admin|người kiểm duyệt|moderator|thành viên|members?|bạn bè|friends)$/i.test(n)) {
      return '';
    }
    if (n.length > 80) return '';
    return n;
  };

  const parseFriends = (text) => {
    if (!text) return 0;
    const m = text.match(/([0-9.,]+)\\s*(?:bạn bè|friends|bạn chung|mutual friends)/i);
    if (!m) return 0;
    const numStr = m[1].replace(/\\./g, '').replace(/,/g, '');
    return parseInt(numStr, 10) || 0;
  };

  const extractUid = (href) => {
    if (!href) return '';
    let m = href.match(/\\/groups\\/[^/]+\\/user\\/(\\d+)/i);
    if (m) return m[1];
    m = href.match(/\\/user\\/(\\d+)/i);
    if (m) return m[1];
    m = href.match(/profile\\.php\\?id=(\\d+)/i);
    if (m) return m[1];
    m = href.match(/[?&]id=(\\d+)/i);
    if (m) return m[1];
    return '';
  };

  const isAvatarOnlyLink = (a) => {
    const aria = (a.getAttribute('aria-label') || '').toLowerCase();
    if (/profile photo|ảnh đại diện|anh dai dien/.test(aria)) return true;
    const text = (a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim();
    const hasImg = !!a.querySelector('img, image, svg image');
    if (hasImg && (!text || text.length < 2)) return true;
    return false;
  };

  const nameFromAnchor = (a) => {
    let raw = '';
    const spans = a.querySelectorAll('span');
    for (const sp of spans) {
      const t = (sp.innerText || sp.textContent || '').replace(/\\s+/g, ' ').trim();
      if (t && t.length >= 2 && t.length <= 80 && !sp.querySelector('img, svg')) {
        raw = t;
        break;
      }
    }
    if (!raw) {
      raw = (a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim();
    }
    if (!raw || raw.length < 2) {
      const aria = (a.getAttribute('aria-label') || '').trim();
      if (aria && !/profile photo|ảnh đại diện/i.test(aria)) raw = aria;
    }
    return cleanName(raw);
  };

  const nameNearAnchor = (a) => {
    let name = nameFromAnchor(a);
    if (name) return name;
    const row = a.closest('div[role="listitem"]')
      || a.closest('div[data-visualcompletion="ignore-dynamic-rendering"]')
      || a.parentElement
      || a;
    const links = row.querySelectorAll('a[href*="/user/"], a[href*="profile.php"], a[role="link"]');
    for (const link of links) {
      if (isAvatarOnlyLink(link)) continue;
      name = nameFromAnchor(link);
      if (name) return name;
    }
    return '';
  };

  const ADMIN_BADGE = /^(quản trị viên|quản trị viên nhóm|admin|group admin)$/i;
  const MOD_BADGE = /^(người kiểm duyệt|moderator|group moderator)$/i;
  const ADMIN_SECTION = /(admins?\\s*(and|&)\\s*moderators|quản trị viên\\s*(và|&)\\s*người kiểm duyệt|^admins?$|^quản trị viên$)/i;
  const MOD_SECTION = /^(moderators?|người kiểm duyệt)$/i;
  const MEMBER_SECTION = /(thành viên mới|new to the group|members? with things in common|bạn bè|friends|^thành viên$|^members$|everyone|tất cả)/i;

  // Tiêu đề mục đứng ngay trước một dòng thành viên (theo thứ tự DOM).
  const headings = Array.from(document.querySelectorAll('h2, h3, h4, [role="heading"]'))
    .map((el) => ({ el, text: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() }))
    .filter((h) => h.text && h.text.length <= 80);
  const sectionOf = (row) => {
    let last = '';
    for (const h of headings) {
      if (h.el === row || h.el.contains(row)) continue;
      if (h.el.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) last = h.text;
      else break;
    }
    return last;
  };

  const roleFromRow = (row) => {
    if (!row) return { isAdmin: false, isMod: false, role: 'member' };
    const leafElements = row.querySelectorAll('span, div');
    for (const el of leafElements) {
      if (el.children.length !== 0) continue;
      const leafText = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (ADMIN_BADGE.test(leafText)) return { isAdmin: true, isMod: false, role: 'admin' };
      if (MOD_BADGE.test(leafText)) return { isAdmin: false, isMod: true, role: 'moderator' };
    }
    const section = sectionOf(row);
    if (section && !MEMBER_SECTION.test(section)) {
      if (ADMIN_SECTION.test(section)) return { isAdmin: true, isMod: false, role: 'admin' };
      if (MOD_SECTION.test(section)) return { isAdmin: false, isMod: true, role: 'moderator' };
    }
    return { isAdmin: false, isMod: false, role: 'member' };
  };

  const JOINED_RE = /(joined[^\\n·•]{0,60}|member since[^\\n·•]{0,30}|đã tham gia[^\\n·•]{0,60}|thành viên từ[^\\n·•]{0,30})/i;
  const joinedFromRow = (rowText) => {
    const m = (rowText || '').match(JOINED_RE);
    return m ? m[1].replace(/\\s+/g, ' ').trim() : '';
  };

  const upsertMember = (uid, payload) => {
    const prev = byUid.get(uid);
    if (!prev) {
      byUid.set(uid, payload);
      return;
    }
    const betterName = payload.name && (!prev.name || payload.name.length > prev.name.length);
    byUid.set(uid, {
      ...prev,
      ...payload,
      name: betterName ? payload.name : prev.name,
      avatarUrl: payload.avatarUrl || prev.avatarUrl,
      friendCount: payload.friendCount || prev.friendCount,
      joinedText: payload.joinedText || prev.joinedText,
      role: payload.role && payload.role !== 'member' ? payload.role : prev.role,
      isAdmin: payload.isAdmin || prev.isAdmin,
      isMod: payload.isMod || prev.isMod,
    });
  };

  const collectFromAnchors = (anchors) => {
    for (const a of anchors) {
      const href = a.getAttribute('href') || a.href || '';
      const uid = extractUid(href);
      if (!uid) continue;

      let row = a.closest('div[role="listitem"]')
        || a.closest('div[data-visualcompletion="ignore-dynamic-rendering"]')
        || a.parentElement;

      let avatarUrl = '';
      if (row) {
        const img = row.querySelector('img[src*="scontent"], img[src*="fbcdn"], image');
        if (img) avatarUrl = img.getAttribute('xlink:href') || img.getAttribute('src') || '';
      }
      if (!avatarUrl) {
        const img = a.querySelector('img[src*="scontent"], img[src*="fbcdn"], image');
        if (img) avatarUrl = img.getAttribute('xlink:href') || img.getAttribute('src') || '';
      }

      const name = isAvatarOnlyLink(a) ? nameNearAnchor(a) : (nameFromAnchor(a) || nameNearAnchor(a));
      if (!name) continue;

      const rowText = row ? (row.innerText || row.textContent || '') : '';
      const friendCount = parseFriends(rowText);
      const roleInfo = roleFromRow(row);
      const joinedText = joinedFromRow(rowText);

      upsertMember(uid, {
        uid,
        name,
        href: href.startsWith('http') ? href.split('?')[0] : ('https://www.facebook.com' + href.split('?')[0]),
        avatarUrl,
        friendCount,
        joinedText,
        role: roleInfo.role,
        isAdmin: roleInfo.isAdmin,
        isMod: roleInfo.isMod,
      });
    }
  };

  const primaryAnchors = Array.from(document.querySelectorAll(
    'a[href*="/groups/"][href*="/user/"], a[role="link"][href*="/groups/"][href*="/user/"]'
  ));
  collectFromAnchors(primaryAnchors);

  // Fallback rộng hơn nếu DOM không dùng /groups/.../user/
  if (byUid.size === 0) {
    const fallback = Array.from(document.querySelectorAll(
      'a[href*="/user/"], a[href*="profile.php?id="], a[role="link"][href*="/user/"], a[role="link"][href*="profile.php?id="]'
    ));
    collectFromAnchors(fallback);
  }

  const bodyText = ((document.body && document.body.innerText) || '').slice(0, 800).toLowerCase();
  const debug = {
    primaryAnchors: primaryAnchors.length,
    userAnchors: document.querySelectorAll('a[href*="/user/"]').length,
    profileAnchors: document.querySelectorAll('a[href*="profile.php?id="]').length,
    found: byUid.size,
    url: location.href,
    blocked: /this page isn't available|trang này hiện không khả dụng|content isn't available|nội dung không khả dụng/.test(bodyText),
    needJoin: /tham gia nhóm|join group|join this group/.test(bodyText),
  };

  debug.scrapeVersion = 3;
  return { members: Array.from(byUid.values()), debug };
})();
"""

PREPARE_MEMBERS_PAGE_JS = """
(() => {
  const clicked = [];
  const want = /^(everyone|tất cả|tat ca|all members|thành viên|thanh vien|members|people|thành viên mới|thanh vien moi|new members|recently joined|người đóng góp mới)$/i;
  const nodes = Array.from(document.querySelectorAll('a, div[role="tab"], span, div[role="button"], div[role="link"]'));
  for (const el of nodes) {
    const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!t || t.length > 40) continue;
    if (!want.test(t)) continue;
    try { el.click(); clicked.push(t); } catch (e) {}
    if (clicked.length >= 3) break;
  }
  return clicked;
})();
"""

SCROLL_MEMBERS_JS = """
(() => {
  const cands = Array.from(document.querySelectorAll('div, main, section')).filter((el) => {
    try {
      const s = window.getComputedStyle(el);
      const oy = s.overflowY;
      return (oy === 'auto' || oy === 'scroll' || oy === 'overlay')
        && el.scrollHeight > el.clientHeight + 80
        && el.clientHeight > 180;
    } catch (e) { return false; }
  });
  cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  const target = cands[0];
  if (target) {
    const before = target.scrollTop;
    target.scrollTop = before + 1100;
    return { type: 'container', before, after: target.scrollTop, sh: target.scrollHeight, ch: target.clientHeight };
  }
  const beforeY = window.scrollY || window.pageYOffset || 0;
  window.scrollBy(0, 1100);
  return { type: 'window', before: beforeY, after: window.scrollY || window.pageYOffset || 0 };
})();
"""

DIAG_MEMBERS_DOM_JS = """
return {
  scrapeVersion: 4,
  href: String(window.location.href || ''),
  title: String(document.title || ''),
  groupsUser: document.querySelectorAll('a[href*="/groups/"][href*="/user/"]').length,
  user: document.querySelectorAll('a[href*="/user/"]').length,
  profile: document.querySelectorAll('a[href*="profile.php?id="]').length,
  bodyLen: document.body ? (document.body.innerText || '').length : -1
};
"""


def _now_str() -> str:
    return time.strftime("%H:%M:%S")


def _diag_members_page(driver) -> dict[str, Any]:
    """Chẩn đoán trang members bằng Selenium Python (không phụ thuộc IIFE JS)."""
    debug: dict[str, Any] = {
        "scrapeVersion": 4,
        "href": "",
        "title": "",
        "groupsUser": 0,
        "user": 0,
        "profile": 0,
        "needJoin": False,
        "blocked": False,
        "sample": "",
        "sourceLen": 0,
        "jsError": "",
    }
    try:
        debug["href"] = str(getattr(driver, "current_url", "") or "")
        debug["title"] = str(getattr(driver, "title", "") or "")
    except Exception as exc:
        debug["jsError"] = f"url/title: {exc}"

    html = ""
    try:
        html = driver.page_source or ""
        debug["sourceLen"] = len(html)
    except Exception as exc:
        debug["jsError"] = f"page_source: {exc}"

    try:
        js_diag = driver.execute_script(DIAG_MEMBERS_DOM_JS)
        if isinstance(js_diag, dict):
            for key in ("scrapeVersion", "href", "title", "groupsUser", "user", "profile"):
                if key in js_diag and js_diag[key] not in (None, ""):
                    debug[key] = js_diag[key]
        elif js_diag is None:
            debug["jsError"] = (debug.get("jsError") or "") + " | execute_script returned None"
    except Exception as exc:
        debug["jsError"] = str(exc)[:200]

    if html:
        debug["groupsUser"] = max(int(debug.get("groupsUser") or 0), len(re.findall(r"/groups/[^\"/'<>\s]+/user/\d+", html, flags=re.I)))
        debug["user"] = max(int(debug.get("user") or 0), len(re.findall(r"/user/\d+", html, flags=re.I)))
        debug["profile"] = max(int(debug.get("profile") or 0), len(re.findall(r"profile\.php\?id=\d+", html, flags=re.I)))

    sample = ""
    try:
        sample = driver.execute_script("return (document.body && document.body.innerText || '').slice(0, 240);") or ""
    except Exception:
        sample = re.sub(r"\s+", " ", html[:2500])[:240]
    debug["sample"] = str(sample)
    low = str(sample).lower()
    debug["needJoin"] = bool(re.search(r"tham gia nhóm|join group|join this group", low, flags=re.I))
    debug["blocked"] = bool(re.search(r"isn't available|không khả dụng|not available|content isn't available", low, flags=re.I))
    return debug


def _scrape_members_via_selenium(driver) -> list[dict[str, Any]]:
    """Bóc thành viên bằng find_elements + fallback regex HTML."""
    from selenium.webdriver.common.by import By

    by_uid: dict[str, dict[str, Any]] = {}

    def _clean_name(raw: str) -> str:
        n = re.sub(r"\s+", " ", (raw or "")).strip().split("\n")[0].strip()
        n = re.sub(r"^(Profile photo of|Ảnh đại diện của|Anh dai dien cua)\s*", "", n, flags=re.I)
        if not n or len(n) < 2 or len(n) > 80:
            return ""
        if re.match(
            r"^(join|tham gia|joined|đang chờ|xem tất cả|see all|quản trị viên|admin|người kiểm duyệt|moderator|thành viên|members?|bạn bè|friends)$",
            n,
            flags=re.I,
        ):
            return ""
        return n

    def _uid_from_href(href: str) -> str:
        if not href:
            return ""
        for pat in (
            r"/groups/[^/]+/user/(\d+)",
            r"/user/(\d+)",
            r"profile\.php\?id=(\d+)",
            r"[?&]id=(\d+)",
        ):
            m = re.search(pat, href, flags=re.I)
            if m:
                return m.group(1)
        return ""

    anchors = []
    try:
        anchors = driver.find_elements(By.CSS_SELECTOR, 'a[href*="/user/"], a[href*="profile.php?id="]')
    except Exception:
        anchors = []

    for a in anchors:
        try:
            href = a.get_attribute("href") or ""
            uid = _uid_from_href(href)
            if not uid or uid in by_uid:
                continue
            name = _clean_name(a.text or "")
            if not name:
                aria = a.get_attribute("aria-label") or ""
                if not re.search(r"profile photo|ảnh đại diện", aria, flags=re.I):
                    name = _clean_name(aria)
            if not name:
                # Avatar-only: tìm tên ở anchor kế bên cùng hàng
                try:
                    parent = a.find_element(By.XPATH, "./ancestor::div[contains(@data-visualcompletion,'ignore-dynamic') or @role='listitem'][1]")
                    for link in parent.find_elements(By.CSS_SELECTOR, 'a[href*="/user/"], a[href*="profile.php?id="]'):
                        name = _clean_name(link.text or "")
                        if name:
                            break
                except Exception:
                    pass
            if not name:
                continue
            by_uid[uid] = {
                "uid": uid,
                "name": name,
                "href": href.split("?")[0],
                "avatarUrl": "",
                "friendCount": 0,
                "role": "member",
                "isAdmin": False,
                "isMod": False,
            }
        except Exception:
            continue

    # Fallback: có UID trong HTML nhưng Selenium không lấy được text
    if not by_uid:
        html = ""
        try:
            html = driver.page_source or ""
        except Exception:
            html = ""
        for m in re.finditer(r'href="(https?:[^"]*?/groups/[^"]+?/user/(\d+)/?[^"]*)"', html, flags=re.I):
            href, uid = m.group(1), m.group(2)
            if uid in by_uid:
                continue
            # Lấy đoạn HTML xung quanh để đoán tên
            start = max(0, m.start() - 80)
            end = min(len(html), m.end() + 220)
            chunk = re.sub(r"<[^>]+>", " ", html[start:end])
            chunk = re.sub(r"\s+", " ", chunk).strip()
            name = _clean_name(chunk)
            if not name:
                name = f"UID {uid}"
            by_uid[uid] = {
                "uid": uid,
                "name": name,
                "href": href.split("?")[0],
                "avatarUrl": "",
                "friendCount": 0,
                "role": "member",
                "isAdmin": False,
                "isMod": False,
            }

    return list(by_uid.values())


def _append_member_log(job_id: str, message: str, level: str = "info", thread: str = "Thread-01") -> None:
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
    with _member_jobs_lock:
        job = _member_jobs.get(job_id)
        if job is not None:
            logs = job.setdefault("logs", [])
            logs.append(entry)
            if len(logs) > 1000:
                job["logs"] = logs[-800:]




def _set_member_job(job_id: str, **kwargs: Any) -> None:
    with _member_jobs_lock:
        job = _member_jobs.get(job_id)
        if job is not None:
            job.update(kwargs)


def _get_member_control(job_id: str) -> str:
    with _member_jobs_lock:
        return (_member_jobs.get(job_id) or {}).get("control") or "run"


def set_member_scan_control(job_id: str, action: str, owner: Optional[str] = None) -> bool:
    action_clean = (action or "").strip().lower()
    if action_clean not in {"pause", "resume", "abort"}:
        return False
    with _member_jobs_lock:
        job = _member_jobs.get(job_id)
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
            # Worker tự đặt trạng thái cuối (aborted) khi đã đóng Chrome và lưu xong.
            job["control"] = "abort"
            job["status"] = "stopping"
    labels = {"pause": "TẠM DỪNG", "resume": "TIẾP TỤC", "abort": "DỪNG"}
    _append_member_log(job_id, f"Lệnh điều khiển nhận được: {labels[action_clean]}", "warn")
    return True


def get_member_scan_status(job_id: str, owner: Optional[str] = None) -> Optional[dict[str, Any]]:
    with _member_jobs_lock:
        job = _member_jobs.get(job_id)
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
            "members": list(job.get("members") or []),
            "total_members_scanned": len(job.get("members") or []),
            "control": job.get("control") or "run",
            "logs": list(job.get("logs") or []),
            "started_at": job.get("started_at"),
            "finished_at": job.get("finished_at"),
        }


def get_active_member_job(owner: Optional[str]) -> Optional[str]:
    """Job quét thành viên đang chạy gần nhất của owner — để giao diện gắn lại sau khi tải lại trang."""
    with _member_jobs_lock:
        active = [
            (job.get("started_at") or 0, jid)
            for jid, job in _member_jobs.items()
            if job.get("owner") == owner and job.get("status") not in TERMINAL_STATUSES
        ]
    return max(active)[1] if active else None


def start_member_scan(
    owner: str,
    uids: list[str],
    groups: list[dict[str, Any]],
    *,
    delay_min: float = 5.0,
    delay_max: float = 10.0,
    switch_acc_threshold: int = 5,
    members_limit: int = 50,
    skip_admin: bool = True,
    auto_dedupe: bool = True,
    new_members_only: bool = False,
) -> dict[str, Any]:
    """Khởi chạy phiên quét thành viên nhóm (xoay vòng pool tài khoản)."""
    uids = [str(u).strip() for u in (uids or []) if str(u).strip()]
    uids = list(dict.fromkeys(uids))
    if not uids:
        raise ValueError("Vui lòng chọn ít nhất 1 tài khoản thực thi")
    if not groups:
        raise ValueError("Vui lòng chọn ít nhất 1 nhóm mục tiêu")
    if len(groups) > 20:
        raise ValueError("Số lượng nhóm trong một phiên không được vượt quá 20 nhóm")

    prune_jobs(_member_jobs, _member_jobs_lock)
    job_id = f"GMS-{int(time.time())}-{uuid.uuid4().hex[:6]}"

    dmin = max(1.0, min(3600.0, float(delay_min)))
    dmax = max(dmin, min(3600.0, float(delay_max)))
    limit = max(1, min(1000, int(members_limit)))
    switch_threshold = max(1, int(switch_acc_threshold))

    with _member_jobs_lock:
        _member_jobs[job_id] = {
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
            "members": [],
            "delay_min": dmin,
            "delay_max": dmax,
            "members_limit": limit,
            "switch_acc_threshold": switch_threshold,
            "skip_admin": skip_admin,
            "auto_dedupe": auto_dedupe,
            "new_members_only": new_members_only,
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
            "switch_after_groups": switch_threshold,
            "members_limit": limit,
            "skip_admin": skip_admin,
            "auto_dedupe": auto_dedupe,
            "new_members_only": new_members_only,
        }, ensure_ascii=False)

        create_scan_session(
            owner=owner,
            session_id=job_id,
            scan_type="GROUP_MEMBERS",
            title=f"Quét thành viên cho {len(groups)} nhóm («{targets_str[:80]}»)",
            target=targets_str,
            target_type="groups",
            source_uid=uids[0],
            account_name=f"Pool {len(uids)} nick",
            target_count=len(groups) * limit,
            config=cfg_str,
        )
    except Exception as exc:
        logger.warning(f"Failed to record member scan session: {exc}")

    thread = threading.Thread(
        target=_run_member_scan_worker,
        args=(job_id,),
        daemon=True,
        name=f"member-scan-{job_id}",
    )
    thread.start()

    return {
        "started": True,
        "job_id": job_id,
        "accounts_count": len(uids),
        "groups_count": len(groups),
        "members_limit": limit,
        "delay_min": dmin,
        "delay_max": dmax,
    }


def _scrape_member_rows(driver) -> list[dict[str, Any]]:
    """JS là nguồn chính (đọc được vai trò, ngày tham gia, bạn bè); Selenium là dự phòng."""
    payload = None
    try:
        payload = driver.execute_script(SCRAPE_MEMBERS_JS)
    except Exception as exc:
        logger.debug("SCRAPE_MEMBERS_JS failed: %s", exc)
    rows: list[dict[str, Any]] = []
    if isinstance(payload, dict):
        rows = payload.get("members") or []
    elif isinstance(payload, list):
        rows = payload
    if rows:
        return [r for r in rows if isinstance(r, dict)]
    try:
        return _scrape_members_via_selenium(driver)
    except Exception as exc:
        logger.debug("Selenium member scrape failed: %s", exc)
        return []


def filter_member_rows(
    raw_items: list[dict[str, Any]],
    *,
    group_seen: set[str],
    cross_seen: set[str],
    skip_admin: bool,
    auto_dedupe: bool,
    new_members_only: bool,
    remaining: int,
    stats: dict[str, int],
) -> list[dict[str, Any]]:
    """Lọc một lượt DOM. Luôn bỏ trùng trong cùng nhóm; `auto_dedupe` bỏ thêm UID đã có
    trong CSDL / nhóm khác của phiên. Trả các dòng hợp lệ (tối đa `remaining`)."""
    kept: list[dict[str, Any]] = []
    for item in raw_items:
        if len(kept) >= remaining:
            break
        if not isinstance(item, dict):
            continue
        m_uid = str(item.get("uid") or "").strip()
        m_name = str(item.get("name") or "").strip()
        if not m_uid or not m_name or m_uid in group_seen:
            continue
        group_seen.add(m_uid)
        if skip_admin and (item.get("isAdmin") or item.get("isMod")):
            stats["admin"] = stats.get("admin", 0) + 1
            continue
        if auto_dedupe and m_uid in cross_seen:
            stats["dup"] = stats.get("dup", 0) + 1
            continue
        joined_text = str(item.get("joinedText") or "").strip()
        if new_members_only:
            age = fb_time_age_days(joined_text)
            if age is None:
                stats["unknown_join"] = stats.get("unknown_join", 0) + 1
                continue
            if age > NEW_MEMBER_DAYS:
                stats["old"] = stats.get("old", 0) + 1
                continue
        cross_seen.add(m_uid)
        kept.append({**item, "uid": m_uid, "name": m_name, "joinedText": joined_text})
    return kept


def _run_member_scan_worker(job_id: str) -> None:
    from modules.module_02_account_manager.context import owner_scope

    with _member_jobs_lock:
        job = _member_jobs.get(job_id)
        owner = job.get("owner") if job else None
    if not job:
        return
    # Khoá profile + thư mục Chrome của Module 02 phụ thuộc owner hiện tại.
    with owner_scope(owner):
        _member_scan_body(job_id)


def _member_scan_body(job_id: str) -> None:
    from modules.module_10_group_scan.models import (
        list_known_member_uids,
        update_scan_session,
        upsert_scanned_group_member,
    )

    with _member_jobs_lock:
        job = _member_jobs[job_id]
        owner = job["owner"]
        uids = list(job["uids"])
        target_groups = list(job["target_groups"])
        dmin = job["delay_min"]
        dmax = job["delay_max"]
        switch_acc_threshold = job["switch_acc_threshold"]
        members_limit = job["members_limit"]
        skip_admin = job["skip_admin"]
        auto_dedupe = job["auto_dedupe"]
        new_members_only = job["new_members_only"]

    def log(message: str, level: str = "info") -> None:
        _append_member_log(job_id, message, level)

    def control() -> str:
        return _get_member_control(job_id)

    def handle_pause() -> bool:
        """True nếu phải dừng hẳn."""
        if control() != "pause":
            return control() == "abort"
        log("⏸️ Đã tạm dừng. Bấm Tiếp tục để chạy tiếp.", "warn")
        if wait_while_paused(control):
            if control() == "pause":
                log("⚠️ Tạm dừng quá 2 giờ — tự kết thúc phiên.", "warn")
                _set_member_job(job_id, control="abort")
            return True
        log("▶️ Tiếp tục quét…", "info")
        return False

    log(f"Khởi động phiên quét thành viên cho {len(target_groups)} nhóm với {len(uids)} tài khoản.", "success")

    cross_seen: set[str] = set()
    if auto_dedupe:
        try:
            cross_seen = set(list_known_member_uids(owner))
            log(f"Đã nạp {len(cross_seen)} UID từ CSDL để lọc trùng chéo.", "info")
        except Exception as exc:
            log(f"Lỗi khi đọc UID CSDL: {exc}", "warn")

    all_scanned: list[dict[str, Any]] = []
    session: Optional[dict[str, Any]] = None
    account_index = 0
    groups_with_acc = 0
    final_status = "done"
    error_text = ""

    def stop_requested() -> bool:
        return control() == "abort"

    def rotate() -> bool:
        """Mở nick kế tiếp (nick hiện tại vẫn giữ tới khi nick mới vào được). False nếu không còn nick nào."""
        nonlocal session, account_index, groups_with_acc
        if session is not None and len(uids) <= 1:
            groups_with_acc = 0
            return True
        exclude = {session["uid"]} if session else set()
        fresh = open_account_session(
            uids, account_index, owner=owner, scope="group-members", log=log,
            exclude=exclude, should_stop=stop_requested,
        )
        if fresh:
            close_account_session(session)
            session = fresh
            account_index = fresh["next_index"]
            groups_with_acc = 0
            _set_member_job(job_id, current_account=fresh["uid"])
            return True
        if session is not None:
            log("⚠️ Không đổi được sang nick khác — tiếp tục dùng nick hiện tại.", "warn")
            groups_with_acc = 0
            return True
        return False

    try:
        for grp_idx, grp in enumerate(target_groups):
            if handle_pause():
                break

            group_id, group_name, group_url = resolve_group_identity(grp, owner)
            if not group_id:
                log(f"⚠️ Bỏ qua nhóm «{group_name}»: không tìm thấy đường dẫn Facebook hợp lệ. Hãy quét lại thông tin nhóm.", "warn")
                continue
            _set_member_job(job_id, current_group=group_name)

            if session is None or groups_with_acc >= switch_acc_threshold:
                if session is not None:
                    log(f"🔄 Nick {session['uid']} đã quét {groups_with_acc} nhóm — đổi nick…", "info")
                if not rotate():
                    if stop_requested():
                        break
                    error_text = "Không có tài khoản nào trong pool mở được Chrome và đăng nhập Facebook."
                    log(f"❌ {error_text}", "error")
                    final_status = "error"
                    break

            driver = session["driver"]
            groups_with_acc += 1
            log(f"[{grp_idx + 1}/{len(target_groups)}] Vào nhóm «{group_name}» (ID: {group_id}) bằng nick {session['uid']}…", "info")

            target_url = f"{group_url}/members"
            try:
                driver.get(target_url)
            except Exception as exc:
                log(f"Lỗi truy cập {target_url}: {exc}", "warn")
                continue
            if interruptible_sleep(random.uniform(3.5, 5.0), control):
                break

            try:
                sample = driver.execute_script(
                    "return (document.body ? document.body.innerText : '').slice(0, 500).toLowerCase();"
                ) or ""
                if "this page isn't available" in sample or "trang này hiện không khả dụng" in sample:
                    log(f"⚠️ Facebook báo nhóm «{group_name}» không khả dụng với nick này ({target_url}).", "error")
                    continue
            except Exception:
                pass

            try:
                clicked_tabs = driver.execute_script(PREPARE_MEMBERS_PAGE_JS) or []
                if clicked_tabs:
                    log(f"Đã chuyển tab danh sách thành viên: {', '.join(str(x) for x in clicked_tabs)}", "info")
                    interruptible_sleep(random.uniform(2.0, 3.0), control)
            except Exception:
                pass

            try:
                diag = _diag_members_page(driver)
                if diag.get("needJoin"):
                    log(f"⚠️ Nick có thể chưa là thành viên nhóm «{group_name}» nên Facebook ẩn danh sách thành viên.", "warn")
                if not diag.get("groupsUser") and not diag.get("user"):
                    alt_url = f"{group_url}/people"
                    log(f"Không thấy link thành viên trên /members, thử {alt_url} …", "warn")
                    driver.get(alt_url)
                    interruptible_sleep(random.uniform(3.0, 4.5), control)
                    try:
                        driver.execute_script(PREPARE_MEMBERS_PAGE_JS)
                    except Exception:
                        pass
            except Exception as exc:
                log(f"Lỗi chẩn đoán DOM: {exc}", "warn")

            group_members: list[dict[str, Any]] = []
            group_seen: set[str] = set()
            stats: dict[str, int] = {}
            buffer: list[dict[str, Any]] = []
            stuck_rounds = 0
            stopped = False

            def flush() -> None:
                if not buffer:
                    return
                saved = 0
                for rec in buffer:
                    if upsert_scanned_group_member(
                        owner=owner, group_id=group_id, member=rec,
                        group_name=group_name, group_url=group_url, session_id=job_id,
                    ):
                        saved += 1
                log(f"💾 [CSDL] Lưu {saved}/{len(buffer)} thành viên mới của «{group_name}».", "success")
                buffer.clear()

            for _round in range(40):
                if handle_pause():
                    stopped = True
                    break
                if len(group_members) >= members_limit:
                    log(f"Đã đạt hạn mức {members_limit} thành viên cho nhóm «{group_name}».", "success")
                    break

                seen_before = len(group_seen)
                kept = filter_member_rows(
                    _scrape_member_rows(driver),
                    group_seen=group_seen,
                    cross_seen=cross_seen,
                    skip_admin=skip_admin,
                    auto_dedupe=auto_dedupe,
                    new_members_only=new_members_only,
                    remaining=members_limit - len(group_members),
                    stats=stats,
                )
                for item in kept:
                    rec = {
                        "group_id": group_id,
                        "group_name": group_name,
                        "group_url": group_url,
                        "uid": item["uid"],
                        "name": item["name"],
                        "profile_url": item.get("href") or f"https://www.facebook.com/{item['uid']}",
                        "avatar_url": item.get("avatarUrl") or "",
                        "friend_count": item.get("friendCount") or 0,
                        "friendCount": item.get("friendCount") or 0,
                        "role": item.get("role") or "member",
                        "joined_date": item.get("joinedText") or "",
                        "session_id": job_id,
                    }
                    group_members.append(rec)
                    buffer.append(rec)

                with _member_jobs_lock:
                    if job_id in _member_jobs:
                        _member_jobs[job_id]["members"] = all_scanned + group_members
                if len(buffer) >= 5:
                    flush()

                if kept:
                    last = group_members[-1]
                    log(f"Quét được: {last['name']} (UID: {last['uid']}) | Nhóm: {len(group_members)}/{members_limit}.", "success")
                if len(group_seen) > seen_before:
                    stuck_rounds = 0
                else:
                    stuck_rounds += 1
                    if stuck_rounds >= 5:
                        log(f"Đã cuộn hết danh sách nhóm «{group_name}» (không còn thành viên mới).", "info")
                        break

                try:
                    driver.execute_script(SCROLL_MEMBERS_JS)
                except Exception:
                    try:
                        driver.execute_script("window.scrollBy(0, 1100);")
                    except Exception:
                        pass
                if interruptible_sleep(random.uniform(dmin, dmax) * random.uniform(0.4, 0.6), control):
                    stopped = True
                    break

            flush()
            all_scanned.extend(group_members)
            _set_member_job(job_id, groups_done=grp_idx + 1, members=list(all_scanned))
            skipped = []
            if stats.get("admin"):
                skipped.append(f"{stats['admin']} admin/mod")
            if stats.get("dup"):
                skipped.append(f"{stats['dup']} trùng")
            if stats.get("old"):
                skipped.append(f"{stats['old']} tham gia quá {NEW_MEMBER_DAYS} ngày")
            if stats.get("unknown_join"):
                skipped.append(f"{stats['unknown_join']} không rõ ngày tham gia")
            log(
                f"Hoàn thành nhóm «{group_name}»: {len(group_members)} thành viên"
                + (f" (bỏ {', '.join(skipped)})" if skipped else "") + ".",
                "success",
            )
            if new_members_only and stats.get("unknown_join") and not group_members:
                log(
                    "⚠️ Facebook không hiển thị ngày tham gia ở nhóm này nên bộ lọc «chỉ thành viên mới» bỏ hết. "
                    "Tắt bộ lọc này nếu muốn lấy toàn bộ thành viên.",
                    "warn",
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
        logger.exception("Member scan worker uncaught exception: %s", exc)
        final_status = "error"
        error_text = str(exc)
        log(f"Lỗi nghiêm trọng trong phiên quét: {exc}", "error")
    finally:
        close_account_session(session)
        log(
            f"Phiên quét thành viên kết thúc ({final_status}). Tổng thu thập: {len(all_scanned)} thành viên.",
            "success" if final_status == "done" else "warn",
        )
        _set_member_job(job_id, status=final_status, error=error_text, finished_at=time.time(),
                        members=list(all_scanned))
        with _member_jobs_lock:
            logs_snapshot = list((_member_jobs.get(job_id) or {}).get("logs") or [])
        try:
            update_scan_session(
                job_id,
                total_found=len(all_scanned),
                status={"done": "SUCCESS", "aborted": "ABORTED"}.get(final_status, "FAILED"),
                finished=True,
                logs=logs_snapshot,
            )
        except Exception as exc:
            logger.debug(f"Update member scan session error: {exc}")
