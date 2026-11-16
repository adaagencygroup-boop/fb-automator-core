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

logger = logging.getLogger(__name__)

_member_jobs: dict[str, dict[str, Any]] = {}
_member_jobs_lock = threading.Lock()

SCRAPE_MEMBERS_JS = """
(() => {
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
    // Bỏ tên quá dài (thường là block text lẫn nút)
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
    // /groups/790752766302091/user/61554844533119/
    let m = href.match(/\\/groups\\/[^/]+\\/user\\/(\\d+)/i);
    if (m) return m[1];
    m = href.match(/\\/user\\/(\\d+)/i);
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
    // Link chỉ chứa ảnh, không có tên chữ
    if (hasImg && (!text || text.length < 2)) return true;
    return false;
  };

  const nameFromAnchor = (a) => {
    // Ưu tiên text trực tiếp của thẻ a (đúng case "Emily Martin")
    let raw = '';
    // Child text nodes / span text trước
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

  const upsertMember = (uid, payload) => {
    const prev = byUid.get(uid);
    if (!prev) {
      byUid.set(uid, payload);
      return;
    }
    // Giữ tên đẹp hơn (có chữ, không rỗng) và avatar nếu thiếu
    const betterName = payload.name && (!prev.name || payload.name.length > prev.name.length);
    byUid.set(uid, {
      ...prev,
      ...payload,
      name: betterName ? payload.name : prev.name,
      avatarUrl: payload.avatarUrl || prev.avatarUrl,
      friendCount: payload.friendCount || prev.friendCount,
      role: payload.role && payload.role !== 'member' ? payload.role : prev.role,
      isAdmin: payload.isAdmin || prev.isAdmin,
      isMod: payload.isMod || prev.isMod,
    });
  };

  // 1) PRIMARY: đúng pattern /groups/.../user/{uid}/
  const primaryAnchors = document.querySelectorAll(
    'a[href*="/groups/"][href*="/user/"], a[role="link"][href*="/groups/"][href*="/user/"]'
  );

  for (const a of primaryAnchors) {
    const href = a.getAttribute('href') || a.href || '';
    const uid = extractUid(href);
    if (!uid) continue;
    if (isAvatarOnlyLink(a)) {
      // Vẫn lấy avatar từ link ảnh nếu đã có bản ghi tên
      continue;
    }
    const name = nameFromAnchor(a);
    if (!name) continue;

    let row = a.closest('div[role="listitem"]')
      || a.closest('div[data-visualcompletion="ignore-dynamic-rendering"]')
      || a.parentElement;
    let avatarUrl = '';
    if (row) {
      const img = row.querySelector('img[src*="scontent"], img[src*="fbcdn"], image');
      if (img) avatarUrl = img.getAttribute('xlink:href') || img.getAttribute('src') || '';
    }
    const rowText = row ? (row.innerText || row.textContent || '') : '';
    const friendCount = parseFriends(rowText);

    let isAdmin = false;
    let isMod = false;
    let role = 'member';
    if (row) {
      const leafElements = row.querySelectorAll('span, div');
      for (const el of leafElements) {
        if (el.children.length !== 0) continue;
        const leafText = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (leafText === 'quản trị viên' || leafText === 'admin') {
          isAdmin = true;
          role = 'admin';
          break;
        }
        if (leafText === 'người kiểm duyệt' || leafText === 'moderator') {
          isMod = true;
          role = 'moderator';
          break;
        }
      }
    }

    upsertMember(uid, {
      uid,
      name,
      href: href.startsWith('http') ? href.split('?')[0] : ('https://www.facebook.com' + href.split('?')[0]),
      avatarUrl,
      friendCount,
      role,
      isAdmin,
      isMod,
    });
  }

  // 2) Bổ sung avatar từ link ảnh cùng /groups/.../user/{uid}/
  for (const a of primaryAnchors) {
    const href = a.getAttribute('href') || a.href || '';
    const uid = extractUid(href);
    if (!uid || !byUid.has(uid)) continue;
    const img = a.querySelector('img[src*="scontent"], img[src*="fbcdn"], image');
    if (!img) continue;
    const avatarUrl = img.getAttribute('xlink:href') || img.getAttribute('src') || '';
    if (!avatarUrl) continue;
    const prev = byUid.get(uid);
    if (!prev.avatarUrl) {
      byUid.set(uid, { ...prev, avatarUrl });
    }
  }

  // 3) FALLBACK hẹp: /user/{uid}/ ngoài pattern groups (ít dùng trên /members)
  if (byUid.size === 0) {
    const fallback = document.querySelectorAll('a[href*="/user/"]');
    for (const a of fallback) {
      const href = a.getAttribute('href') || a.href || '';
      const uid = extractUid(href);
      if (!uid || isAvatarOnlyLink(a)) continue;
      const name = nameFromAnchor(a);
      if (!name) continue;
      upsertMember(uid, {
        uid,
        name,
        href: href.startsWith('http') ? href.split('?')[0] : ('https://www.facebook.com' + href.split('?')[0]),
        avatarUrl: '',
        friendCount: 0,
        role: 'member',
        isAdmin: false,
        isMod: false,
      });
    }
  }

  return Array.from(byUid.values());
})();
"""
def _now_str() -> str:
    return time.strftime("%H:%M:%S")


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


def set_member_scan_control(job_id: str, action: str) -> bool:
    action_clean = (action or "").strip().lower()
    if action_clean not in {"pause", "resume", "abort"}:
        return False
    with _member_jobs_lock:
        job = _member_jobs.get(job_id)
        if not job:
            return False
        job["control"] = action_clean
        if action_clean == "pause":
            job["status"] = "paused"
        elif action_clean == "resume":
            job["status"] = "running"
        elif action_clean == "abort":
            job["status"] = "aborted"
    _append_member_log(job_id, f"Lệnh điều khiển nhận được: {action_clean.upper()}", "warn")
    return True


def get_member_scan_status(job_id: str) -> Optional[dict[str, Any]]:
    with _member_jobs_lock:
        job = _member_jobs.get(job_id)
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
            "members": list(job.get("members") or []),
            "total_members_scanned": len(job.get("members") or []),
            "control": job.get("control") or "run",
            "logs": list(job.get("logs") or []),
            "started_at": job.get("started_at"),
            "finished_at": job.get("finished_at"),
        }


def start_member_scan(
    owner: str,
    uids: list[str],
    groups: list[dict[str, Any]],
    *,
    delay_min: float = 5.0,
    delay_max: float = 10.0,
    switch_acc_threshold: int = 50,
    members_limit: int = 50,
    skip_admin: bool = True,
    auto_dedupe: bool = True,
    new_members_only: bool = True,
) -> dict[str, Any]:
    """Khởi chạy phiên quét thành viên nhóm đa luồng/xoay vòng tài khoản."""
    if not uids:
        raise ValueError("Vui lòng chọn ít nhất 1 tài khoản thực thi")
    if not groups:
        raise ValueError("Vui lòng chọn ít nhất 1 nhóm mục tiêu")
    if len(groups) > 20:
        raise ValueError("Số lượng nhóm trong một phiên không được vượt quá 20 nhóm")

    job_id = f"GMS-{int(time.time())}-{uuid.uuid4().hex[:6]}"

    # Validate delay
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

    # Tạo phiên lưu lịch sử trong CSDL
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


def _run_member_scan_worker(job_id: str) -> None:
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
        list_known_member_uids,
        normalize_group_id,
        update_scan_session,
        upsert_scanned_group_member,
    )

    with _member_jobs_lock:
        job = _member_jobs.get(job_id)
        if not job:
            return
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

    _append_member_log(
        job_id,
        f"Khởi động phiên quét thành viên cho {len(target_groups)} nhóm với {len(uids)} tài khoản.",
        "success",
    )

    # Nạp danh sách UID đã có trong DB nếu bật lọc trùng
    known_db_uids: set[str] = set()
    if auto_dedupe:
        try:
            known_db_uids = list_known_member_uids(owner)
            _append_member_log(
                job_id,
                f"Đã nạp {len(known_db_uids)} UID từ CSDL để kích hoạt cơ chế tự động lọc trùng chéo.",
                "info",
            )
        except Exception as exc:
            _append_member_log(job_id, f"Lỗi khi đọc UID CSDL: {exc}", "warn")

    seen_session_uids: set[str] = set(known_db_uids)
    all_scanned_members: list[dict[str, Any]] = []

    account_index = 0
    driver = None
    current_uid = None
    profile_lock = None
    groups_processed_with_acc = 0

    def close_current_driver():
        nonlocal driver, profile_lock, current_uid
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
            # Kiểm tra trạng thái điều khiển
            ctrl = _get_member_control(job_id)
            if ctrl == "abort":
                _append_member_log(job_id, "Nhận tín hiệu DỪNG KHẨN CẤP. Ngừng toàn bộ tác vụ.", "warn")
                break
            while ctrl == "pause":
                _append_member_log(job_id, "Tiến trình đang TẠM DỪNG. Chờ lệnh tiếp tục...", "info")
                time.sleep(2)
                ctrl = _get_member_control(job_id)
                if ctrl == "abort":
                    break
            if ctrl == "abort":
                break

            # Trích xuất group_id và group_url thực tế của Facebook (tránh lấy nhầm db auto-increment id ví dụ 945)
            raw_url = str(grp.get("url") or grp.get("group_url") or grp.get("href") or "").strip()
            group_id = str(grp.get("group_id") or grp.get("groupId") or grp.get("uid") or "").strip()
            group_name = str(grp.get("name") or grp.get("group_name") or "").strip()
            raw_id = str(grp.get("id") or grp.get("dbId") or "").strip()

            # 1. Trích xuất slug ban đầu từ raw_url nếu có
            url_slug = ""
            if raw_url and "/groups/" in raw_url:
                url_slug = raw_url.split("/groups/")[-1].split("/")[0].split("?")[0].strip()

            # 2. Nhận diện ID số tự tăng CSDL (<= 7 chữ số)
            is_group_id_db_id = bool(group_id.isdigit() and len(group_id) < 8)
            is_slug_db_id = bool(url_slug.isdigit() and len(url_slug) < 8)
            is_raw_id_valid = bool(raw_id.isdigit())

            # 3. Tra cứu CSDL scanned_groups nếu phát hiện group_id hoặc url_slug mang ID số tự tăng CSDL
            need_db_lookup = is_group_id_db_id or is_slug_db_id or not group_id or not raw_url or (raw_id and group_id == raw_id and is_raw_id_valid)

            if need_db_lookup:
                try:
                    from core.database.connection import db
                    lookup_int = int(raw_id) if is_raw_id_valid else (
                        int(group_id) if is_group_id_db_id else (
                            int(url_slug) if is_slug_db_id else -1
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
                    logger.warning(f"Failed to lookup real group_id: {exc}")

            # 4. Nếu sau khi tra cứu, group_id vẫn là số ngắn CSDL hoặc rỗng:
            if (not group_id or (group_id.isdigit() and len(group_id) < 8)) and raw_url and "/groups/" in raw_url:
                candidate_slug = raw_url.split("/groups/")[-1].split("/")[0].split("?")[0].strip()
                if candidate_slug and not (candidate_slug.isdigit() and len(candidate_slug) < 8):
                    group_id = candidate_slug

            # 5. Nếu raw_url kết thúc bằng số ngắn CSDL (ví dụ /groups/945):
            if raw_url and re.search(r"/groups/\d{1,7}(?:[/?#]|$)", raw_url):
                if group_id and not (group_id.isdigit() and len(group_id) < 8):
                    raw_url = f"https://www.facebook.com/groups/{group_id}"
                else:
                    raw_url = ""

            # 6. Kiểm tra an toàn: nếu group_id hoặc raw_url vẫn không hợp lệ
            if (group_id.isdigit() and len(group_id) < 8) or (not group_id and not raw_url):
                _append_member_log(
                    job_id,
                    f"⚠️ Bỏ qua nhóm «{group_name or 'ID ' + (group_id or raw_id)}»: Không tìm thấy đường dẫn Facebook hợp lệ trong CSDL (ID {group_id or raw_id}). Vui lòng quét lại thông tin nhóm.",
                    "warn",
                )
                continue

            if not group_name:
                group_name = group_id or "Nhóm Facebook"

            _set_member_job(job_id, current_group=group_name)

            # Xoay vòng tài khoản nếu cần
            need_switch_account = (
                driver is None
                or current_uid is None
                or groups_processed_with_acc >= switch_acc_threshold
            )

            if need_switch_account:
                if driver:
                    _append_member_log(
                        job_id,
                        f"Đã xử lý {groups_processed_with_acc} nhóm bằng nick {current_uid}. Bắt đầu đổi nick...",
                        "info",
                    )
                    close_current_driver()

                current_uid = uids[account_index % len(uids)]
                account_index += 1
                groups_processed_with_acc = 0
                _set_member_job(job_id, current_account=current_uid)

                _append_member_log(
                    job_id,
                    f"Mở trình duyệt tự động hóa với tài khoản UID: {current_uid}...",
                    "info",
                )

                try:
                    profile_lock = get_profile_lock(current_uid)
                    if not profile_lock.acquire(timeout=10):
                        _append_member_log(
                            job_id,
                            f"Tài khoản {current_uid} đang bận bởi tiến trình khác, chuyển nick tiếp theo trong pool...",
                            "warn",
                        )
                        profile_lock = None
                        continue
                except Exception as exc:
                    _append_member_log(job_id, f"Lỗi khóa profile tài khoản {current_uid}: {exc}", "error")
                    profile_lock = None
                    continue

                db_sess = SessionLocal()
                try:
                    account_obj = Repo.get_by_uid(db_sess, current_uid, owner_username=owner)
                    if not account_obj:
                        from modules.module_02_account_manager.database.models import Account
                        account_obj = db_sess.query(Account).filter(Account.uid == current_uid).first()
                    if not account_obj:
                        _append_member_log(job_id, f"Không tìm thấy tài khoản {current_uid} trong Module 02.", "error")
                        close_current_driver()
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
                        scope="group-members",
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
                        _append_member_log(
                            job_id,
                            f"Không thể duy trì phiên đăng nhập cho nick {current_uid}: {login_res.get('error')}",
                            "error",
                        )
                        close_current_driver()
                        continue
                except Exception as exc:
                    _append_member_log(job_id, f"Lỗi khởi tạo Chrome cho {current_uid}: {exc}", "error")
                    close_current_driver()
                    continue

            # Tiến hành quét nhóm
            groups_processed_with_acc += 1
            _append_member_log(
                job_id,
                f"[{grp_idx + 1}/{len(target_groups)}] Điều hướng tới nhóm: «{group_name}» (ID: {group_id})...",
                "info",
            )

            # Xây dựng URL cơ sở và URL mục tiêu
            base_group_url = raw_url if (raw_url and "/groups/" in raw_url and not re.search(r"/groups/\d{1,7}(?:[/?#]|$)", raw_url)) else f"https://www.facebook.com/groups/{group_id}"
            base_group_url = base_group_url.rstrip("/")

            # Facebook hiện đại không có đường dẫn riêng /members/new_members cho tài khoản thường
            # Đường dẫn chuẩn luôn là /members
            target_url = f"{base_group_url}/members"

            try:
                driver.get(target_url)
                human_sleep(2.5, 4.0)
            except Exception as exc:
                _append_member_log(job_id, f"Lỗi truy cập {target_url}: {exc}", "warn")
                try:
                    target_url = f"{base_group_url}/members/"
                    driver.get(target_url)
                    human_sleep(2.5, 4.0)
                except Exception:
                    continue

            # Kiểm tra soft 404 (This Page Isn't Available / Trang này hiện không khả dụng)
            try:
                page_text_sample = driver.execute_script("return (document.body ? document.body.innerText : '').slice(0, 500).toLowerCase();") or ""
                if "this page isn't available" in page_text_sample or "trang này hiện không khả dụng" in page_text_sample:
                    _append_member_log(
                        job_id,
                        f"⚠️ Trang Facebook báo liên kết không khả dụng (This Page Isn't Available) cho nhóm «{group_name}» ({target_url}). Vui lòng kiểm tra quyền truy cập của nick.",
                        "error",
                    )
                    continue
            except Exception:
                pass

            # Vòng lặp Infinite Scroll để bóc tách thành viên
            group_members: list[dict[str, Any]] = []
            max_scroll_rounds = 40
            scroll_stuck_count = 0
            prev_found_count = 0
            checkpoint_buffer: list[dict[str, Any]] = []

            for scroll_round in range(max_scroll_rounds):
                # Kiểm tra điều khiển
                ctrl = _get_member_control(job_id)
                if ctrl == "abort":
                    break
                while ctrl == "pause":
                    time.sleep(2)
                    ctrl = _get_member_control(job_id)
                    if ctrl == "abort":
                        break
                if ctrl == "abort":
                    break

                if len(group_members) >= members_limit:
                    _append_member_log(
                        job_id,
                        f"Đã đạt hạn mức chỉ định {members_limit} thành viên cho nhóm «{group_name}».",
                        "success",
                    )
                    break

                try:
                    raw_items = driver.execute_script(SCRAPE_MEMBERS_JS) or []
                except Exception as exc:
                    _append_member_log(job_id, f"Lỗi đọc DOM thành viên: {exc}", "warn")
                    raw_items = []

                new_in_round = 0
                for item in raw_items:
                    m_uid = str(item.get("uid") or "").strip()
                    m_name = str(item.get("name") or "").strip()
                    is_admin_or_mod = item.get("isAdmin") or item.get("isMod")

                    # Lọc Admin / Mod nếu bật cấu hình
                    if skip_admin and is_admin_or_mod:
                        continue

                    # Lọc trùng UID
                    if auto_dedupe and m_uid in seen_session_uids:
                        continue

                    seen_session_uids.add(m_uid)
                    member_record = {
                        "group_id": group_id,
                        "group_name": group_name,
                        "group_url": f"https://www.facebook.com/groups/{group_id}",
                        "uid": m_uid,
                        "name": m_name,
                        "profile_url": item.get("href") or f"https://www.facebook.com/{m_uid}",
                        "avatar_url": item.get("avatarUrl") or "",
                        "friend_count": item.get("friendCount") or 0,
                        "friendCount": item.get("friendCount") or 0,
                        "role": item.get("role") or "member",
                        "joined_date": "Gần đây" if new_members_only else "",
                        "session_id": job_id,
                    }
                    group_members.append(member_record)
                    checkpoint_buffer.append(member_record)
                    new_in_round += 1

                    if len(group_members) >= members_limit:
                        break

                # Cập nhật danh sách thành viên vào bộ nhớ tạm của Job
                with _member_jobs_lock:
                    if job_id in _member_jobs:
                        _member_jobs[job_id]["members"] = list(all_scanned_members + group_members)

                # Checkpoint: Lưu CSDL mỗi 5 thành viên (thay vì 20)
                if len(checkpoint_buffer) >= 5:
                    saved_batch = 0
                    for m_rec in checkpoint_buffer:
                        if upsert_scanned_group_member(
                            owner=owner,
                            group_id=group_id,
                            member=m_rec,
                            group_name=group_name,
                            group_url=m_rec["group_url"],
                            session_id=job_id,
                        ):
                            saved_batch += 1
                    _append_member_log(
                        job_id,
                        f"💾 [CSDL] Đã lưu {saved_batch}/{len(checkpoint_buffer)} thành viên nhóm «{group_name}» vào CSDL.",
                        "success",
                    )
                    checkpoint_buffer.clear()

                if new_in_round > 0:
                    last_m = group_members[-1]
                    _append_member_log(
                        job_id,
                        f"Quét được: {last_m['name']} (UID: {last_m['uid']}) | Tổng nhóm: {len(group_members)}/{members_limit}.",
                        "success",
                    )
                    scroll_stuck_count = 0
                else:
                    if len(group_members) == prev_found_count:
                        scroll_stuck_count += 1
                        if scroll_stuck_count >= 5:
                            _append_member_log(
                                job_id,
                                f"Đã cuộn đến cuối danh sách nhóm «{group_name}» (không còn thành viên mới).",
                                "info",
                            )
                            break
                    else:
                        scroll_stuck_count = 0

                prev_found_count = len(group_members)

                # Cuộn trang mượt mà
                try:
                    driver.execute_script("window.scrollBy({ top: 900, behavior: 'smooth' });")
                except Exception:
                    try:
                        driver.execute_script("window.scrollBy(0, 900);")
                    except Exception:
                        pass

                # Delay chống block
                sleep_sec = random.uniform(dmin, dmax)
                human_sleep(sleep_sec * 0.4, sleep_sec * 0.6)

            # Lưu các thành viên còn lại trong buffer của nhóm này
            if checkpoint_buffer:
                saved_batch = 0
                for m_rec in checkpoint_buffer:
                    if upsert_scanned_group_member(
                        owner=owner,
                        group_id=group_id,
                        member=m_rec,
                        group_name=group_name,
                        group_url=m_rec["group_url"],
                        session_id=job_id,
                    ):
                        saved_batch += 1
                _append_member_log(
                    job_id,
                    f"💾 [CSDL] Đã lưu hoàn tất {saved_batch}/{len(checkpoint_buffer)} thành viên còn lại vào CSDL.",
                    "success",
                )
                checkpoint_buffer.clear()

            all_scanned_members.extend(group_members)
            _set_member_job(
                job_id,
                groups_done=grp_idx + 1,
                members=list(all_scanned_members),
            )
            _append_member_log(
                job_id,
                f"Hoàn thành nhóm «{group_name}» với {len(group_members)} thành viên thu thập được.",
                "success",
            )

            # Nghỉ giữa các nhóm
            if grp_idx < len(target_groups) - 1:
                group_delay = random.uniform(dmin, dmax)
                _append_member_log(
                    job_id,
                    f"Nghỉ ngơi an toàn {group_delay:.1f}s trước khi chuyển sang nhóm kế tiếp...",
                    "info",
                )
                time.sleep(group_delay)

        # Cập nhật kết thúc phiên
        final_status = "aborted" if _get_member_control(job_id) == "abort" else "done"
        _set_member_job(
            job_id,
            status=final_status,
            finished_at=time.time(),
        )
        _append_member_log(
            job_id,
            f"Phiên quét thành viên kết thúc. Tổng thu thập: {len(all_scanned_members)} UID thành viên.",
            "success" if final_status == "done" else "warn",
        )

        try:
            update_scan_session(
                job_id,
                total_found=len(all_scanned_members),
                status="SUCCESS" if final_status == "done" else "ABORTED",
                finished=True,
            )
        except Exception as exc:
            logger.debug(f"Update member scan session error: {exc}")

    except Exception as exc:
        logger.exception("Member scan worker uncaught exception: %s", exc)
        _set_member_job(job_id, status="error", error=str(exc))
        _append_member_log(job_id, f"Lỗi nghiêm trọng trong phiên quét: {exc}", "error")
    finally:
        close_current_driver()
