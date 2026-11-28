"""
campaign_service.py
Module 03 - Tab 2: Nghiệp vụ chiến dịch đăng Status nhiều khung giờ trong ngày.

Luật đã thống nhất:
  - Khung giờ HH:mm trong ngày hôm nay, sau bây giờ ít nhất 5 phút, không trùng, tối đa 24 khung.
  - Khung quá gần nhau chỉ cảnh báo (khung sau sẽ xếp hàng chờ khung trước).
  - Kho bài / ảnh không đủ → chặn; phải dùng lại bài cho nick khác → cảnh báo.
  - Sửa thoải mái nội dung / nick / khung chưa chạy; khoá sửa khi có khung đang chạy.
  - Khung bị lỡ / lỗi / dừng (hoặc có bài lỗi) được chạy lại, chỉ cho nick chưa đăng thành công ở khung đó.
"""
import os
import re
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from modules.module_03_acc_farm import campaign_repository as repo
from modules.module_03_acc_farm.compose_service import (
    IMAGE_NONE,
    LAYOUT_ACCOUNTS,
    MAX_TIME_SLOTS,
    PlanCheck,
    account_entry,
    clamp_image_range,
    normalize_account_posts,
    normalize_content_mode,
    normalize_layout,
    normalize_image_mode,
    normalize_pool_images,
    parse_compose_text,
    validate_account_posts,
    validate_plan,
)
from modules.module_03_acc_farm.post_now_service import ComposeInput

MIN_LEAD = timedelta(minutes=5)
MAX_NAME_LENGTH = 200
ESTIMATED_SECONDS_PER_POST = 120
_TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


class CampaignError(Exception):
    def __init__(self, message: str, status_code: int = 400, errors: Optional[List[str]] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.errors = errors or [message]


def local_now() -> datetime:
    return datetime.now().astimezone()


def _hhmm(dt: datetime) -> str:
    return dt.astimezone().strftime("%H:%M")


# ==============================================================================
# KIỂM TRA ĐẦU VÀO
# ==============================================================================

def normalize_settings(thread_count: Any, min_delay: Any, max_delay: Any) -> Dict[str, int]:
    def _int(v, default, lo, hi):
        try:
            n = int(v)
        except (TypeError, ValueError):
            n = default
        return max(lo, min(hi, n))

    lo = _int(min_delay, 600, 0, 86400)
    hi = _int(max_delay, 900, 0, 86400)
    return {"thread_count": _int(thread_count, 1, 1, 50), "min_delay": min(lo, hi), "max_delay": max(lo, hi)}


def normalize_accounts(accounts: Sequence[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Chỉ lưu uid + tên (mật khẩu / cookie đọc lại từ Module 02 lúc chạy, không lưu vào chiến dịch)."""
    seen, out = set(), []
    for acc in accounts or []:
        uid = str(acc.get("uid") or "").strip()
        if uid and uid not in seen:
            seen.add(uid)
            out.append({"uid": uid, "name": str(acc.get("name") or acc.get("account_name") or "").strip()})
    return out


def parse_slot_times(
    times: Sequence[str], now: datetime, keep: Sequence[datetime] = ()
) -> List[datetime]:
    """HH:mm hôm nay → datetime có múi giờ. Giờ trùng với khung đang chờ cũ (`keep`) được giữ dù đã sát giờ."""
    errors: List[str] = []
    keep_set = {k.astimezone().replace(second=0, microsecond=0) for k in keep}
    result: List[datetime] = []
    for raw in times or []:
        text = str(raw or "").strip()
        m = _TIME_RE.match(text)
        if not m:
            errors.append(f"Giờ \"{text}\" không đúng dạng HH:mm.")
            continue
        dt = now.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0)
        if dt in result:
            errors.append(f"Khung {_hhmm(dt)} bị trùng.")
            continue
        if dt not in keep_set and dt < now + MIN_LEAD:
            errors.append(f"Khung {_hhmm(dt)} phải sau bây giờ ít nhất 5 phút (chỉ đặt giờ trong hôm nay).")
            continue
        result.append(dt)
    if errors:
        raise CampaignError(" ".join(errors), errors=errors)
    return sorted(result)


def estimate_slot_seconds(account_count: int, settings: Dict[str, int]) -> int:
    threads = max(1, int(settings.get("thread_count") or 1))
    rounds = -(-max(0, account_count) // threads)
    avg_delay = (int(settings.get("min_delay") or 0) + int(settings.get("max_delay") or 0)) / 2
    return int(rounds * ESTIMATED_SECONDS_PER_POST + max(0, rounds - 1) * avg_delay)


def slot_gap_warnings(times: Sequence[datetime], account_count: int, settings: Dict[str, int]) -> List[str]:
    need = estimate_slot_seconds(account_count, settings)
    warnings = []
    for a, b in zip(times, times[1:]):
        gap = (b - a).total_seconds()
        if gap < need:
            warnings.append(
                f"Khung {_hhmm(a)} và {_hhmm(b)} chỉ cách {int(gap // 60)} phút, mỗi khung dự kiến chạy khoảng "
                f"{max(1, need // 60)} phút — khung {_hhmm(b)} sẽ phải xếp hàng chờ."
            )
    return warnings


def _check_account_posts(
    compose: ComposeInput,
    accounts: Sequence[Dict[str, Any]],
    slot_count: int,
    file_exists: Callable[[str], bool],
) -> Tuple[Dict[str, Any], PlanCheck]:
    """Dạng "Từng bài": mỗi nick đủ `slot_count` bài; chỉ giữ bài của nick đã chọn và các khung đang có."""
    s = max(1, int(slot_count or 1))
    posts = normalize_account_posts(compose.account_posts)
    check = validate_account_posts(posts, accounts, s)
    kept: Dict[str, List[Dict[str, Any]]] = {}
    filled = 0
    for acc in accounts:
        uid = str(acc.get("uid") or "").strip()
        entries = [account_entry(posts, uid, i) for i in range(s)]
        filled += sum(1 for e in entries if e["content"].strip())
        kept[uid] = entries
    images = list(dict.fromkeys(p for entries in kept.values() for e in entries for p in e["images"]))
    missing = [p for p in images if not file_exists(p)]
    if missing:
        names = ", ".join(os.path.basename(p) for p in missing[:5])
        check.errors.append(f"{len(missing)} ảnh đã chọn không còn trên máy ({names}). Bỏ ảnh đó rồi thử lại.")
    normalized = {
        "layout": LAYOUT_ACCOUNTS,
        "account_posts": kept,
        "content_text": compose.content_text or "",
        "content_mode": normalize_content_mode(compose.content_mode),
        "image_mode": IMAGE_NONE,
        "image_paths": [],
        "min_images": 1,
        "max_images": 1,
        "parsed": {"count": filled, "summary": f"Đã có {filled}/{len(accounts) * s} bài"},
    }
    return normalized, check


def check_compose(
    compose: ComposeInput,
    account_count: int,
    slot_count: int,
    file_exists: Callable[[str], bool] = os.path.isfile,
    accounts: Optional[Sequence[Dict[str, Any]]] = None,
) -> Tuple[Dict[str, Any], PlanCheck]:
    """Tách bài + kiểm tra kho. Trả về (nội dung đã chuẩn hoá để lưu, kết quả kiểm tra).
    Dạng "Từng bài" cần danh sách nick (`accounts`) để kiểm tra từng nick."""
    if normalize_layout(compose.layout) == LAYOUT_ACCOUNTS:
        return _check_account_posts(compose, normalize_accounts(accounts or []), slot_count, file_exists)
    content_mode = normalize_content_mode(compose.content_mode)
    image_mode = normalize_image_mode(compose.image_mode)
    lo, hi = clamp_image_range(compose.min_images, compose.max_images)
    parsed = parse_compose_text(compose.content_text, content_mode)
    images = normalize_pool_images(compose.image_paths)
    check = validate_plan(
        parsed, images if image_mode != IMAGE_NONE else [], account_count=account_count, slot_count=slot_count,
        content_mode=content_mode, image_mode=image_mode, min_images=lo, max_images=hi,
    )
    if image_mode != IMAGE_NONE:
        missing = [p for p in images if not file_exists(p)]
        if missing:
            names = ", ".join(os.path.basename(p) for p in missing[:5])
            check.errors.append(f"{len(missing)} ảnh trong kho không còn trên máy ({names}). Xoá khỏi kho rồi thử lại.")
    normalized = {
        "layout": normalize_layout(compose.layout),
        "account_posts": {},
        "content_text": compose.content_text or "",
        "content_mode": content_mode,
        "image_mode": image_mode,
        "image_paths": images,
        "min_images": lo,
        "max_images": hi,
        "parsed": parsed.to_dict(),
    }
    normalized["parsed"].pop("posts", None)
    return normalized, check


def preview(
    compose: ComposeInput,
    account_count: int,
    slot_times: Sequence[str],
    settings: Dict[str, int],
    now: Optional[datetime] = None,
    keep_slots: Sequence[str] = (),
    accounts: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Kiểm tra trước khi bấm Đăng ngay / Tạo chiến dịch (FE hiện lỗi + cảnh báo ngay khi soạn).
    keep_slots: khung chờ cũ của chiến dịch đang sửa (được giữ dù đã sát giờ)."""
    now = now or local_now()
    errors: List[str] = []
    warnings: List[str] = []
    times: List[datetime] = []
    keep = []
    for raw in keep_slots or []:
        m = _TIME_RE.match(str(raw or "").strip())
        if m:
            keep.append(now.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0))
    try:
        times = parse_slot_times(slot_times, now, keep=keep)
    except CampaignError as exc:
        errors.extend(exc.errors)
    if len(slot_times or []) > MAX_TIME_SLOTS:
        errors.append(f"Tối đa {MAX_TIME_SLOTS} khung giờ.")
    normalized, check = check_compose(compose, account_count, max(1, len(slot_times or [])), accounts=accounts)
    errors.extend(check.errors)
    warnings.extend(check.warnings)
    warnings.extend(slot_gap_warnings(times, account_count, settings))
    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "parsed": normalized["parsed"],
        "estimated_slot_minutes": max(1, estimate_slot_seconds(account_count, settings) // 60) if account_count else 0,
    }


def _validated_payload(
    name: str, accounts: Sequence[Dict[str, Any]], settings: Dict[str, Any], compose: ComposeInput, slot_count: int,
) -> Tuple[Dict[str, Any], List[str]]:
    clean_name = (name or "").strip()
    if not clean_name:
        clean_name = f"Chiến dịch {local_now().strftime('%H:%M %d/%m')}"
    if len(clean_name) > MAX_NAME_LENGTH:
        raise CampaignError(f"Tên chiến dịch tối đa {MAX_NAME_LENGTH} ký tự.")
    accs = normalize_accounts(accounts)
    clean_settings = normalize_settings(settings.get("thread_count"), settings.get("min_delay"), settings.get("max_delay"))
    normalized, check = check_compose(compose, len(accs), slot_count, accounts=accs)
    if not check.ok:
        raise CampaignError(" ".join(check.errors), errors=check.errors)
    normalized.pop("parsed")
    return {"name": clean_name, "accounts": accs, "settings": clean_settings, **normalized}, check.warnings


# ==============================================================================
# THAO TÁC CHIẾN DỊCH
# ==============================================================================

def create_campaign(
    owner_key: str, machine_id: str, *, name: str, accounts: Sequence[Dict[str, Any]], settings: Dict[str, Any],
    compose: ComposeInput, slot_times: Sequence[str], now: Optional[datetime] = None,
) -> Dict[str, Any]:
    now = now or local_now()
    if not slot_times:
        raise CampaignError("Chưa chọn khung giờ nào. Không hẹn giờ thì dùng \"Đăng ngay\".")
    if len(slot_times) > MAX_TIME_SLOTS:
        raise CampaignError(f"Tối đa {MAX_TIME_SLOTS} khung giờ.")
    times = parse_slot_times(slot_times, now)
    data, warnings = _validated_payload(name, accounts, settings, compose, len(times))
    campaign = repo.create_campaign(
        {**data, "owner_key": owner_key, "machine_id": machine_id, "post_type": "status"}, times
    )
    warnings += slot_gap_warnings(times, len(data["accounts"]), data["settings"])
    return {"campaign": campaign, "warnings": warnings}


def _owned(owner_key: str, campaign_id: str) -> Dict[str, Any]:
    campaign = repo.get_campaign(campaign_id, owner_key)
    if not campaign:
        raise CampaignError("Không tìm thấy chiến dịch.", status_code=404)
    return campaign


def _running_slot_error(campaign_id: str) -> CampaignError:
    running = [s for s in repo.list_slots(campaign_id) if s["status"] == repo.RUNNING]
    when = _hhmm(running[0]["run_at"]) if running else ""
    return CampaignError(f"Khung {when} đang chạy. Đợi khung này xong (hoặc dừng nó) rồi mới sửa.", status_code=409)


def update_campaign(
    owner_key: str, campaign_id: str, *, name: str, accounts: Sequence[Dict[str, Any]], settings: Dict[str, Any],
    compose: ComposeInput, slot_times: Sequence[str], now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Thay nội dung / nick / cài đặt và danh sách khung CHƯA CHẠY. Khung đã chạy giữ nguyên."""
    now = now or local_now()
    _owned(owner_key, campaign_id)
    if repo.has_running_slot(campaign_id):
        raise _running_slot_error(campaign_id)
    slots = repo.list_slots(campaign_id)
    waiting_old = [s["run_at"] for s in slots if s["status"] == repo.WAITING]
    other_count = sum(1 for s in slots if s["status"] != repo.WAITING)
    times = parse_slot_times(slot_times, now, keep=waiting_old)
    if other_count + len(times) > MAX_TIME_SLOTS:
        raise CampaignError(f"Tối đa {MAX_TIME_SLOTS} khung giờ cho 1 chiến dịch (đã có {other_count} khung đã chạy).")
    data, warnings = _validated_payload(name, accounts, settings, compose, max(1, len(times)))
    repo.update_campaign(campaign_id, data, times)
    warnings += slot_gap_warnings(times, len(data["accounts"]), data["settings"])
    return {"campaign": repo.get_campaign(campaign_id, owner_key), "warnings": warnings}


def _stop_local_runner(campaign: Dict[str, Any], machine_id: str, runner) -> None:
    if campaign.get("machine_id") != machine_id:
        return
    running = [s for s in repo.list_slots(campaign["id"]) if s["status"] == repo.RUNNING]
    for slot in running:
        if slot.get("session_id") and runner.active_session_id() == slot["session_id"] and runner.is_busy():
            runner.stop_session()


def _local_running_slots(campaign: Dict[str, Any], machine_id: Optional[str], runner):
    """Khung RUNNING của chiến dịch mà phiên của nó đang nằm trên runner máy này."""
    if runner is None or campaign.get("machine_id") != machine_id:
        return []
    return [
        s for s in repo.list_slots(campaign["id"])
        if s["status"] == repo.RUNNING and s.get("session_id")
        and runner.active_session_id() == s["session_id"] and runner.is_busy()
    ]


def stop_campaign(owner_key: str, campaign_id: str, *, runner, machine_id: str) -> Dict[str, Any]:
    """Tạm dừng chiến dịch: khung chưa chạy → Tạm dừng; khung đang chạy dở → PAUSE phiên đăng (không huỷ bài),
    Chạy tiếp sẽ chạy tiếp từ chỗ dừng. Máy khác tự pause ở lượt quét kế tiếp của bộ lập lịch."""
    campaign = _owned(owner_key, campaign_id)
    repo.stop_campaign(campaign_id)
    for slot in _local_running_slots(campaign, machine_id, runner):
        if not runner.is_paused():
            runner.pause_session()
        repo.set_slot_message(slot["id"], repo.PAUSED_MID_RUN_MESSAGE)
    return repo.get_campaign(campaign_id, owner_key)


def resume_campaign(
    owner_key: str, campaign_id: str, now: Optional[datetime] = None, *, runner=None, machine_id: Optional[str] = None,
) -> Dict[str, Any]:
    campaign = _owned(owner_key, campaign_id)
    now = now or local_now()
    repo.mark_paused_slots_missed(now, campaign_id=campaign_id)  # khung đã qua giờ lúc tạm dừng = bị lỡ
    pending = repo.resume_campaign(campaign_id, now)
    if not pending:
        raise CampaignError("Không còn khung nào ở phía sau để chạy tiếp. Thêm khung mới bằng Sửa, hoặc Chạy lại khung bị lỡ.")
    # Khung đang dở do tạm dừng chiến dịch → chạy tiếp ngay từ chỗ dừng
    for slot in _local_running_slots(campaign, machine_id, runner):
        if slot.get("message") == repo.PAUSED_MID_RUN_MESSAGE:
            if runner.is_paused():
                runner.resume_session()
            repo.set_slot_message(slot["id"], repo.RESUMED_MID_RUN_MESSAGE)
    return repo.get_campaign(campaign_id, owner_key)


def delete_campaign(owner_key: str, campaign_id: str, *, runner, machine_id: str) -> None:
    campaign = _owned(owner_key, campaign_id)
    if repo.has_running_slot(campaign_id):
        if campaign.get("machine_id") != machine_id:
            raise CampaignError("Chiến dịch đang chạy trên máy khác. Dừng chiến dịch, đợi khung đang chạy kết thúc rồi xoá.", 409)
        _stop_local_runner(campaign, machine_id, runner)
    repo.delete_campaign(campaign_id)


def is_paused(slot: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    """Khung tạm dừng theo chiến dịch, chưa tới giờ: chờ Chạy tiếp (không phải bị lỡ / dừng giữa chừng)."""
    if slot.get("status") != repo.STOPPED or slot.get("session_id"):
        return False
    run_at = slot.get("run_at")
    return run_at is None or run_at >= (now or local_now())


def can_rerun(slot: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    status = slot.get("status")
    if status == repo.STOPPED:
        return not is_paused(slot, now)  # tạm dừng chưa tới giờ → dùng Chạy tiếp, không Chạy lại
    return status in (repo.MISSED, repo.FAILED) or (
        status == repo.DONE and int(slot.get("failed_count") or 0) > 0
    )


def rerun_slot(
    owner_key: str, campaign_id: str, slot_id: str, run_time: Optional[str] = None, now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Chạy lại khung bị lỡ / lỗi: ngay bây giờ (run_time rỗng) hoặc 1 giờ khác trong hôm nay."""
    now = now or local_now()
    _owned(owner_key, campaign_id)
    slot = repo.get_slot(slot_id, campaign_id)
    if not slot:
        raise CampaignError("Không tìm thấy khung giờ.", status_code=404)
    if not can_rerun(slot):
        raise CampaignError("Chỉ chạy lại được khung bị lỡ, bị lỗi, bị dừng hoặc còn bài lỗi.", status_code=409)
    if run_time and str(run_time).strip():
        m = _TIME_RE.match(str(run_time).strip())
        if not m:
            raise CampaignError(f"Giờ \"{run_time}\" không đúng dạng HH:mm.")
        run_at = now.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0)
        if run_at < now:
            raise CampaignError(f"Giờ chạy lại {_hhmm(run_at)} đã qua. Chọn giờ sau bây giờ hoặc chạy ngay.")
    else:
        run_at = now
    if not repo.reset_slot_for_rerun(slot_id, run_at):
        raise CampaignError("Khung giờ vừa đổi trạng thái, tải lại rồi thử lại.", status_code=409)
    repo.set_campaign_active(campaign_id)
    return repo.get_slot(slot_id, campaign_id)


def slot_post_counts(slot: Dict[str, Any], counts: Optional[Dict[str, int]] = None) -> Optional[Dict[str, int]]:
    """Bài của khung chia theo kết quả để vẽ thanh tiến độ: đã đăng / lỗi / bị dừng / đang chờ.
    Khung chưa có phiên → None. `published` tính cả các lần chạy lại (số nick đã đăng thành công ở khung)."""
    sid = slot.get("session_id")
    if not sid:
        return None
    if counts is None:
        counts = repo.session_post_counts(sid)
    stopped = int(counts.get("STOPPED", 0))
    pending = int(counts.get("PENDING", 0)) + int(counts.get("RUNNING", 0))
    failed = sum(int(n) for s, n in counts.items() if s not in ("PUBLISHED", "STOPPED", "PENDING", "RUNNING"))
    return {"published": int(slot.get("success_count") or counts.get("PUBLISHED", 0)), "failed": failed,
            "stopped": stopped, "pending": pending}


def _slot_view(slot: Dict[str, Any], runner, local: bool) -> Dict[str, Any]:
    view = dict(slot)
    view["can_rerun"] = can_rerun(slot)
    view["paused"] = is_paused(slot)
    view["estimated_finish_at"] = None
    view["post_counts"] = slot_post_counts(slot)
    if (
        local and slot["status"] == repo.RUNNING and slot.get("session_id")
        and runner.active_session_id() == slot["session_id"]
    ):
        seconds = runner.estimate_remaining_seconds()
        if seconds is not None:
            view["estimated_finish_at"] = local_now() + timedelta(seconds=seconds)
    return view


def campaign_detail(owner_key: str, campaign_id: str, *, runner, machine_id: str) -> Dict[str, Any]:
    campaign = _owned(owner_key, campaign_id)
    local = campaign.get("machine_id") == machine_id
    slots = [_slot_view(s, runner, local) for s in repo.list_slots(campaign_id)]
    account_posts: Dict[str, List[Dict[str, Any]]] = {}
    if normalize_layout(campaign.get("layout")) == LAYOUT_ACCOUNTS:
        # Mở lại khi sửa: bài thứ i của nick = bài của khung CHƯA CHẠY thứ i
        waiting = repo.waiting_slots_account_posts(campaign_id)
        for acc in campaign.get("accounts") or []:
            uid = str(acc.get("uid"))
            account_posts[uid] = [
                {"content": str((w.get(uid) or {}).get("content") or ""), "images": list((w.get(uid) or {}).get("images") or [])}
                for w in waiting
            ]
        post_count = len(campaign.get("accounts") or []) * len(slots)
    else:
        post_count = len(parse_compose_text(campaign["content_text"], campaign["content_mode"]).posts)
    return {
        **campaign,
        "account_posts": account_posts,
        "on_this_machine": local,
        "post_count": post_count,
        "can_edit": not any(s["status"] == repo.RUNNING for s in slots),
        "slots": slots,
    }


def campaign_list(owner_key: str, *, machine_id: str) -> List[Dict[str, Any]]:
    items = []
    for c in repo.list_campaigns(owner_key):
        c = dict(c)
        c["on_this_machine"] = c.get("machine_id") == machine_id
        c["account_count"] = len(c.get("accounts") or [])
        # Danh sách không cần nội dung đầy đủ
        c.pop("content_text", None)
        c.pop("image_paths", None)
        items.append(c)
    return items
