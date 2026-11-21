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
    FairQueue,
    ResumeTracker,
    NEW_MEMBER_DAYS,
    TERMINAL_STATUSES,
    close_account_session,
    fb_time_age_days,
    format_join_date,
    interruptible_sleep,
    is_browser_dead_error,
    open_account_session,
    prune_jobs,
    resolve_group_identity,
    wait_while_paused,
)

logger = logging.getLogger(__name__)

_member_jobs: dict[str, dict[str, Any]] = {}
_member_jobs_lock = threading.Lock()
# Nhãn luồng trên log ([Thread-01], [Thread-02]…) — mỗi Chrome quét song song là một luồng.
_member_thread_label = threading.local()
# Tiến độ từng phiên (để "Chạy tiếp" khi bị gián đoạn) — job_id → ResumeTracker
_member_trackers: dict[str, ResumeTracker] = {}

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
      const roleInfo = roleFromRow(row);
      const joinedText = joinedFromRow(rowText);

      upsertMember(uid, {
        uid,
        name,
        href: href.startsWith('http') ? href.split('?')[0] : ('https://www.facebook.com' + href.split('?')[0]),
        avatarUrl,
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
                "role": "member",
                "isAdmin": False,
                "isMod": False,
            }

    return list(by_uid.values())


def _append_member_log(job_id: str, message: str, level: str = "info", thread: Optional[str] = None) -> None:
    thread = thread or getattr(_member_thread_label, "name", "Thread-01")
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
    """Khởi chạy phiên quét thành viên nhóm: mỗi nick 1 Chrome song song, nhóm chia đều cho các nick.
    `switch_acc_threshold` không còn dùng — giữ để client cũ gửi lên không lỗi."""
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
    try:
        tracker = ResumeTracker(
            job_id, "group_members",
            {
                "uids": list(uids), "groups": list(groups), "delay_min": dmin, "delay_max": dmax,
                "members_limit": limit, "skip_admin": skip_admin, "auto_dedupe": auto_dedupe,
                "new_members_only": new_members_only,
            },
            [str(i) for i in range(len(groups))],
        )
        _member_trackers[job_id] = tracker
        tracker.flush()
    except Exception as exc:
        logger.debug(f"member resume tracker init error: {exc}")

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
    """Quét thành viên song song: mỗi nick 1 Chrome (tối đa MAX_PARALLEL_BROWSERS), nhóm chia đều cho
    các nick, phần dư cho nick xong phần mình trước. Một nick không bao giờ mở 2 Chrome."""
    from collections import deque

    from modules.module_02_account_manager.context import owner_scope
    from modules.module_10_group_scan.keyword_check import BROWSER_STAGGER_SEC, MAX_PARALLEL_BROWSERS
    from modules.module_10_group_scan.models import list_known_member_uids, update_scan_session

    with _member_jobs_lock:
        job = _member_jobs[job_id]
        owner = job["owner"]
        uids = list(job["uids"])
        target_groups = list(job["target_groups"])
        auto_dedupe = job["auto_dedupe"]

    def log(message: str, level: str = "info") -> None:
        _append_member_log(job_id, message, level)

    def control() -> str:
        return _get_member_control(job_id)

    def stop_requested() -> bool:
        return control() == "abort"

    workers = max(1, min(len(uids), len(target_groups), MAX_PARALLEL_BROWSERS))
    if workers > 1:
        mode = f"mở {workers} Chrome song song, mỗi Chrome quét 1 nhóm một lúc"
    elif len(target_groups) > 1:
        mode = "1 Chrome quét lần lượt (mỗi nick chỉ mở 1 Chrome)"
    else:
        mode = "mở 1 Chrome"
    spare = len(uids) - workers
    log(
        f"🚀 {len(target_groups)} nhóm, {len(uids)} nick → {mode}"
        + (f"; {spare} nick dự phòng" if spare > 0 else "") + ".",
        "success",
    )

    cross_seen: set[str] = set()
    if auto_dedupe:
        try:
            cross_seen = set(list_known_member_uids(owner))
            log(f"Đã nạp {len(cross_seen)} UID từ CSDL để lọc trùng chéo.", "info")
        except Exception as exc:
            log(f"Lỗi khi đọc UID CSDL: {exc}", "warn")

    nick_queue = deque(uids)
    group_queue = FairQueue(enumerate(target_groups), workers)
    lock = threading.Lock()
    state: dict[str, Any] = {"opened": 0, "members": [], "groups_done": 0, "fatal": ""}

    def take_nick() -> Optional[str]:
        with lock:
            return nick_queue.popleft() if nick_queue else None

    def add_members(items: list[dict[str, Any]]) -> None:
        with lock:
            state["members"].extend(items)
            snapshot = list(state["members"])
        _set_member_job(job_id, members=snapshot)

    def run_worker(n: int) -> None:
        _member_thread_label.name = f"Thread-{n:02d}"
        session = None
        taken = 0
        try:
            if n > 1 and interruptible_sleep((n - 1) * BROWSER_STAGGER_SEC, control):
                return
            while session is None:
                if stop_requested():
                    return
                if not group_queue.has_work(taken):
                    return
                nick = take_nick()
                if nick is None:
                    log("⚠️ Không còn nick nào mở được Chrome cho luồng này.", "warn")
                    return
                session = open_account_session(
                    [nick], 0, owner=owner, scope="group-members", log=log, should_stop=stop_requested, window_slot=n - 1,
                )
            with lock:
                state["opened"] += 1
            _set_member_job(job_id, current_account=session["uid"])
            nick = session["uid"]
            resumes_at_open = _member_pause_resumes(job_id)
            first = True
            while True:
                if _member_handle_pause(job_id):
                    return
                nxt = group_queue.take(taken, should_stop=stop_requested)
                if nxt is None:
                    return
                taken += 1
                grp_idx, grp = nxt
                if not first:
                    with _member_jobs_lock:
                        dmin, dmax = _member_jobs[job_id]["delay_min"], _member_jobs[job_id]["delay_max"]
                    group_delay = random.uniform(dmin, dmax)
                    log(f"Nghỉ {group_delay:.1f}s trước khi chuyển nhóm kế tiếp…", "info")
                    if interruptible_sleep(group_delay, control):
                        group_queue.put_back(nxt)
                        return
                first = False
                with _member_jobs_lock:
                    base_limit = int(grp.get("limit") or _member_jobs[job_id]["members_limit"])
                members: list[dict[str, Any]] = []
                run_grp, reopened = grp, 0
                while True:
                    try:
                        _scan_group_members(job_id, session, grp_idx, run_grp, len(target_groups), cross_seen, lock,
                                            sink=members, count_offset=len(members))
                        break
                    except Exception as exc:
                        if not (is_browser_dead_error(exc) and not stop_requested()
                                and _member_pause_resumes(job_id) > resumes_at_open and reopened < 2):
                            add_members(members)  # thành viên đã quét được trước khi Chrome tắt vẫn giữ
                            raise
                        # Chrome bị tắt LÚC ĐANG TẠM DỪNG rồi bấm Tiếp tục → mở lại Chrome của nick này và quét
                        # tiếp đúng nhóm dở (tắt Chrome lúc đang chạy thì vẫn dừng luồng như cũ).
                        reopened += 1
                        log(f"🔄 Chrome của nick {nick} bị tắt trong lúc tạm dừng — mở lại để quét tiếp nhóm dở "
                            f"({len(members)}/{base_limit} thành viên)…", "info")
                        close_account_session(session)
                        session = open_account_session(
                            [nick], 0, owner=owner, scope="group-members", log=log, should_stop=stop_requested, window_slot=n - 1,
                        )
                        if not session:
                            add_members(members)
                            log(f"⚠️ Không mở lại được Chrome của nick {nick}.", "warn")
                            return
                        resumes_at_open = _member_pause_resumes(job_id)
                        run_grp = {**grp, "limit": max(1, base_limit - len(members))}
                add_members(members)
                tracker = _member_trackers.get(job_id)
                if tracker is not None:
                    try:  # nhóm bị Dừng khẩn cấp giữa chừng chưa tính là xong → Chạy tiếp sẽ quét nốt
                        tracker.update(str(grp_idx), count=len(members), done=not stop_requested())
                    except Exception as exc:
                        logger.debug("member resume tracker update failed: %s", exc)
                with lock:
                    state["groups_done"] += 1
                    done = state["groups_done"]
                _set_member_job(job_id, groups_done=done)
                if stop_requested():
                    return
        except Exception as exc:
            if is_browser_dead_error(exc):
                log(f"🛑 Chrome của nick {session.get('uid') if session else '?'} đã bị đóng — luồng này dừng.", "warn")
            else:
                logger.exception("member scan worker %s crashed", job_id)
                log(f"❌ Luồng quét lỗi: {exc}", "error")
        finally:
            group_queue.leave(taken)
            close_account_session(session)

    def run_worker_scoped(n: int) -> None:
        with owner_scope(owner):
            run_worker(n)

    final_status, error_text = "done", ""
    try:
        threads = [
            threading.Thread(target=run_worker_scoped, args=(n,), daemon=True, name=f"member-scan-{job_id}-{n}")
            for n in range(1, workers + 1)
        ]
        for t in threads:
            t.start()
        for t in threads:
            if hasattr(t, "join"):
                t.join()
        leftover = group_queue.remaining()
        if stop_requested():
            final_status = "aborted"
        elif state["opened"] == 0:
            final_status = "error"
            error_text = "Không có tài khoản nào trong pool mở được Chrome và đăng nhập Facebook."
            log(f"❌ {error_text}", "error")
        elif leftover or state["groups_done"] < len(target_groups):
            # Nhóm đang quét dở lúc Chrome bị đóng cũng là chưa xong (không chỉ nhóm còn trong hàng đợi).
            n_left = len(target_groups) - state["groups_done"]
            final_status = "aborted"
            error_text = f"Còn {n_left} nhóm chưa quét xong"
            log(f"⚠️ Còn {n_left} nhóm chưa quét xong (Chrome bị đóng) — bấm Chạy tiếp để quét nốt.", "warn")
    except Exception as exc:
        logger.exception("Member scan worker uncaught exception: %s", exc)
        final_status = "error"
        error_text = str(exc)
        log(f"Lỗi nghiêm trọng trong phiên quét: {exc}", "error")
    finally:
        with lock:
            all_scanned = list(state["members"])
        log(
            f"Phiên quét thành viên kết thúc ({final_status}). Tổng thu thập: {len(all_scanned)} thành viên.",
            "success" if final_status == "done" else "warn",
        )
        _set_member_job(job_id, status=final_status, error=error_text, finished_at=time.time(), members=all_scanned)
        tracker = _member_trackers.pop(job_id, None)
        if tracker is not None:
            try:
                tracker.flush()
            except Exception as exc:
                logger.debug("member resume tracker flush failed: %s", exc)
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


def _member_handle_pause(job_id: str) -> bool:
    """Tạm dừng tại chỗ tới khi Tiếp tục. True nếu phải dừng hẳn (Dừng khẩn cấp / tạm dừng quá 2 giờ)."""
    control = lambda: _get_member_control(job_id)  # noqa: E731
    if control() != "pause":
        return control() == "abort"
    _append_member_log(job_id, "⏸️ Đã tạm dừng. Bấm Tiếp tục để chạy tiếp.", "warn")
    if wait_while_paused(control):
        if control() == "pause":
            _append_member_log(job_id, "⚠️ Tạm dừng quá 2 giờ — tự kết thúc phiên.", "warn")
            _set_member_job(job_id, control="abort")
        return True
    with _member_jobs_lock:
        job = _member_jobs.get(job_id)
        if job is not None:
            job["pause_resumes"] = int(job.get("pause_resumes") or 0) + 1
    _append_member_log(job_id, "▶️ Tiếp tục quét…", "info")
    return False


def _member_pause_resumes(job_id: str) -> int:
    with _member_jobs_lock:
        return int((_member_jobs.get(job_id) or {}).get("pause_resumes") or 0)


def _scan_group_members(
    job_id: str,
    session: dict[str, Any],
    grp_idx: int,
    grp: dict[str, Any],
    total_groups: int,
    cross_seen: set[str],
    cross_lock: threading.Lock,
    *,
    sink: Optional[list[dict[str, Any]]] = None,
    count_offset: int = 0,
) -> list[dict[str, Any]]:
    """Quét thành viên của 1 nhóm bằng Chrome của `session`. Lỗi Chrome chết được ném ra ngoài.

    sink: danh sách nhận thành viên ngay khi quét được — Chrome chết giữa chừng vẫn giữ phần đã có.
    count_offset: số thành viên nhóm này đã quét trước đó (quét tiếp sau khi mở lại Chrome) — để lưu tiến độ đúng.
    """
    from modules.module_10_group_scan.models import upsert_scanned_group_member

    with _member_jobs_lock:
        job = _member_jobs[job_id]
        owner = job["owner"]
        dmin = job["delay_min"]
        dmax = job["delay_max"]
        members_limit = int(grp.get("limit") or job["members_limit"])
        skip_admin = job["skip_admin"]
        auto_dedupe = job["auto_dedupe"]
        new_members_only = job["new_members_only"]

    def log(message: str, level: str = "info") -> None:
        _append_member_log(job_id, message, level)

    def control() -> str:
        return _get_member_control(job_id)

    group_id, group_name, group_url = resolve_group_identity(grp, owner)
    if not group_id:
        log(f"⚠️ Bỏ qua nhóm «{group_name}»: không tìm thấy đường dẫn Facebook hợp lệ. Hãy quét lại thông tin nhóm.", "warn")
        return []
    _set_member_job(job_id, current_group=group_name)
    driver = session["driver"]
    log(f"[{grp_idx + 1}/{total_groups}] Vào nhóm «{group_name}» (ID: {group_id}) bằng nick {session['uid']}…", "info")

    target_url = f"{group_url}/members"
    try:
        driver.get(target_url)
    except Exception as exc:
        if is_browser_dead_error(exc):
            raise
        log(f"Lỗi truy cập {target_url}: {exc}", "warn")
        return []
    if interruptible_sleep(random.uniform(3.5, 5.0), control):
        return []

    try:
        sample = driver.execute_script(
            "return (document.body ? document.body.innerText : '').slice(0, 500).toLowerCase();"
        ) or ""
        if "this page isn't available" in sample or "trang này hiện không khả dụng" in sample:
            log(f"⚠️ Facebook báo nhóm «{group_name}» không khả dụng với nick này ({target_url}).", "error")
            return []
    except Exception as exc:
        if is_browser_dead_error(exc):
            raise

    try:
        clicked_tabs = driver.execute_script(PREPARE_MEMBERS_PAGE_JS) or []
        if clicked_tabs:
            log(f"Đã chuyển tab danh sách thành viên: {', '.join(str(x) for x in clicked_tabs)}", "info")
            interruptible_sleep(random.uniform(2.0, 3.0), control)
    except Exception as exc:
        if is_browser_dead_error(exc):
            raise

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
        if is_browser_dead_error(exc):
            raise
        log(f"Lỗi chẩn đoán DOM: {exc}", "warn")

    group_members: list[dict[str, Any]] = []  # của lần quét này (đếm theo hạn mức còn thiếu)
    group_seen: set[str] = set()
    stats: dict[str, int] = {}
    buffer: list[dict[str, Any]] = []
    stuck_rounds = 0

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
        tracker = _member_trackers.get(job_id)
        if tracker is not None:  # tiến độ dở của nhóm — Chạy tiếp chỉ quét số còn thiếu
            try:
                tracker.update(str(grp_idx), count=count_offset + len(group_members))
            except Exception as exc:
                logger.debug("member resume tracker update failed: %s", exc)

    try:
        for _round in range(40):
            if _member_handle_pause(job_id):
                break
            if len(group_members) >= members_limit:
                log(f"Đã đạt hạn mức {members_limit} thành viên cho nhóm «{group_name}».", "success")
                break

            seen_before = len(group_seen)
            with cross_lock:  # nhiều Chrome cùng lọc trùng chéo trên 1 tập UID
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
                    "role": item.get("role") or "member",
                    # "Joined on Monday" → "16/11/2026" (không đọc được thì giữ chữ gốc).
                    "joined_date": format_join_date(item.get("joinedText")),
                    "session_id": job_id,
                }
                group_members.append(rec)
                buffer.append(rec)
                if sink is not None:
                    sink.append(rec)

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
            except Exception as exc:
                if is_browser_dead_error(exc):
                    flush()
                    raise
                try:
                    driver.execute_script("window.scrollBy(0, 1100);")
                except Exception:
                    pass
            if interruptible_sleep(random.uniform(dmin, dmax) * random.uniform(0.4, 0.6), control):
                break

    except Exception as exc:
        if is_browser_dead_error(exc):
            flush()  # thành viên đã đọc được vẫn vào CSDL trước khi báo Chrome chết
        raise
    flush()
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
    return group_members
