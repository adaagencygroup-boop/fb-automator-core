"""
routes.py
API Tương tác tài khoản (Module 03 - Tab 1):
  POST /api/farm/start                 Kích hoạt chạy các kịch bản cho danh sách nick
  POST /api/farm/pause                 Tạm dừng (giữ nguyên trình duyệt)
  POST /api/farm/resume                Chạy tiếp
  POST /api/farm/stop                  Dừng hẳn
  GET  /api/farm/status                Trạng thái phiên chạy hiện tại (khôi phục UI khi chuyển tab)
  GET  /api/farm/settings              Cấu hình đã lưu của máy này
  POST /api/farm/settings              Lưu 1 cấu hình
  GET  /api/farm/history               Lịch sử các lượt đã chạy (lọc + phân trang)
  GET  /api/farm/history/export        Xuất CSV theo bộ lọc
  GET  /api/farm/history/{id}          Chi tiết 1 lượt
  POST /api/farm/history/cleanup       Dọn dữ liệu cũ hơn N ngày

Cờ điều khiển, executor và driver scope "farm" tách riêng khỏi các luồng khác.
"""
import asyncio
import csv
import io
import json
import logging
import random
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from core.browser import ProxyError, parse_proxy
from modules.module_03_acc_farm import adapters, repository
from modules.module_03_acc_farm.browser.login_flow import CHECKPOINT_HEAVY, HEAVY_CHECKPOINT_PREFIX
from modules.module_03_acc_farm.farming.flow import (
    FarmAccountDead,
    FarmControl,
    FarmStopped,
    dismiss_notice_dialogs,
    pop_light_checkpoint,
    pop_notices,
    try_dismiss_checkpoint,
    run_add_friends,
    run_add_friends_from_groups,
    run_check_notifications,
    run_join_groups,
    run_newsfeed,
    run_watch,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/farm", tags=["Module 03 - Tương tác tài khoản"])

HARD_MAX_THREADS = 10
MAX_TIME_VALUE = 3600
# Delay tối thiểu ép phía server: nhập 0-1 giây sẽ gửi lời mời liên tục như bot, rất dễ bị chặn tính năng
DELAY_FLOORS = {"friends_delay": 3, "groups_delay": 5}
# VR-M03-CFG-03: ô từ khóa tham gia nhóm (nhiều từ khóa cách nhau dấu phẩy) không quá số ký tự này,
# tính sau khi bỏ khoảng trắng 2 đầu
GROUP_KEYWORD_MAX_LEN = 50
_farm_executor = ThreadPoolExecutor(max_workers=HARD_MAX_THREADS, thread_name_prefix="farm")

ACTION_LABELS = {
    "CHECK_NOTIF": "Check thông báo",
    "NEWSFEED": "Lướt Newsfeed",
    "WATCH": "Xem Video Watch",
    "ADD_FRIEND": "Kết bạn theo gợi ý",
    "JOIN_GROUP": "Tham gia nhóm",
}
FINAL_STATUSES = set(repository.FINAL_STATUSES)
# Cảnh báo mức 1: nick khác trên cùng máy dính checkpoint nặng trong khoảng này thì báo khi bắt đầu phiên
CHECKPOINT_ALERT_HOURS = 72
COUNTER_FIELDS = {"ADD_FRIEND": "friends_sent", "JOIN_GROUP": "groups_joined"}

SETTING_KEYS = {
    "farm_daily_limit_enabled": ("bool", None),
    "farm_daily_friend_limit": ("int", (1, 100)),
    "farm_daily_group_limit": ("int", (1, 100)),
}
HISTORY_PAGE_SIZE_MAX = 100
EXPORT_MAX_ROWS = 50000
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ─────────────────────── SCHEMAS ────────────────────────────

class FarmScenarioConfig(BaseModel):
    enabled_newsfeed: bool = False
    newsfeed_time_min: int = 3       # phút
    newsfeed_time_max: int = 7
    newsfeed_delay_min: int = 5      # giây dừng đọc giữa các nhịp cuộn
    newsfeed_delay_max: int = 15

    enabled_watch: bool = False
    watch_time_min: int = 3          # phút
    watch_time_max: int = 7
    watch_delay_min: int = 5         # giây xem mỗi video
    watch_delay_max: int = 15

    enabled_add_friends: bool = False
    friends_min: int = 3
    friends_max: int = 7
    friends_delay_min: int = 5       # giây nghỉ giữa 2 lời mời
    friends_delay_max: int = 15
    friends_fallback_group_members: bool = False   # Không có gợi ý thì kết bạn với thành viên nhóm đã tham gia

    enabled_join_groups: bool = False
    groups_min: int = 1
    groups_max: int = 3
    groups_delay_min: int = 10       # giây nghỉ giữa 2 lần tham gia nhóm
    groups_delay_max: int = 20
    group_keyword: str = ""

    enabled_check_notif: bool = False

    daily_limit_enabled: bool = True
    daily_friend_limit: int = 20
    daily_group_limit: int = 5


class FarmStartRequest(BaseModel):
    uids: List[str]
    threads: int = 5
    config: FarmScenarioConfig


class SettingItem(BaseModel):
    key: str
    value: str


class CleanupRequest(BaseModel):
    keep_days: int


# ─────────────────────── STATE ────────────────────────────

_state_lock = threading.Lock()
_control: Optional[FarmControl] = None
_active_task: Optional[asyncio.Task] = None
_state: Dict = {
    "running": False,
    "owner_username": "",
    "threads": 0,
    "started_at": 0,
    "finished_at": 0,
    "accounts": {},
    # Nick trên máy này dính checkpoint nặng (trong phiên hoặc trong CHECKPOINT_ALERT_HOURS trước đó): chỉ cảnh báo
    "checkpoint_alerts": [],
}
# Dữ liệu gom cho dòng lịch sử của từng nick trong phiên hiện tại (không trả ra API status)
_history_data: Dict[str, Dict] = {}


def _snapshot() -> Dict:
    with _state_lock:
        return {
            **{k: v for k, v in _state.items() if k not in ("accounts", "checkpoint_alerts")},
            "paused": bool(_control and _control.paused),
            "stopping": bool(_control and _control.stopped and _state["running"]),
            "accounts": [dict(a) for a in _state["accounts"].values()],
            "checkpoint_alerts": [dict(a) for a in _state["checkpoint_alerts"]],
        }


def _emit(level: str, message: str, uid: Optional[str] = None, slot: Optional[int] = None):
    prefix = f"[Thread-{slot:02d}] " if slot else ""
    adapters.emit_log(level, f"{prefix}{message}", uid=uid, slot=slot)


def _set_account(uid: str, **fields):
    """
    Cập nhật trạng thái 1 nick trong bộ nhớ + farm_runs. UI lấy trạng thái qua GET /api/farm/status.
    Trạng thái kết thúc không ghi ở đây: _finalize ghi cùng dòng lịch sử trong 1 transaction.
    """
    if fields.get("status") == "RUNNING" and _control is not None and _control.paused:
        fields["status"] = "PAUSED"
    with _state_lock:
        acc = _state["accounts"].get(uid)
        if acc is None:
            return
        acc.update(fields)
        run_id = acc.get("run_id")
    db_fields = {}
    if "status" in fields and fields["status"] not in FINAL_STATUSES:
        db_fields["status"] = fields["status"]
    if "activity" in fields:
        db_fields["current_activity"] = (fields["activity"] or "")[:255]
    if db_fields and run_id:
        repository.update_run(run_id, **db_fields)


def _hist(uid: str, **fields):
    with _state_lock:
        _history_data.setdefault(uid, {}).update(fields)


def _alert_heavy_checkpoint(uid: str, error: str):
    """Cảnh báo mức 1: chỉ báo, không tự dừng nick khác (Facebook có thể khóa theo cụm nick cùng thiết bị)."""
    with _state_lock:
        acc = _state["accounts"].get(uid) or {}
        others = [u for u, a in _state["accounts"].items()
                  if u != uid and a.get("status") in repository.OPEN_STATUSES]
        _state["checkpoint_alerts"].append({
            "uid": uid, "name": acc.get("name") or "", "error": error, "at": time.time(), "source": "session",
        })
    tail = f" Nick khác đang chờ/chạy trên máy này: {', '.join(others)}. Cân nhắc dừng phiên." if others else ""
    _emit("warning", f"Cảnh báo: nick {uid} dính checkpoint nặng, Facebook có thể đang khóa theo cụm thiết bị.{tail}")


def _history_checkpoint_alerts(machine_id: str) -> List[Dict]:
    """Nick trên máy này dính checkpoint nặng trong CHECKPOINT_ALERT_HOURS giờ qua (mỗi nick lấy lần gần nhất)."""
    try:
        rows = repository.recent_heavy_checkpoints(machine_id, HEAVY_CHECKPOINT_PREFIX, CHECKPOINT_ALERT_HOURS)
    except Exception as e:
        logger.warning(f"Không đọc được lịch sử checkpoint để cảnh báo: {e}")
        return []
    alerts = {}
    for row in rows:
        if row["fb_uid"] not in alerts:
            alerts[row["fb_uid"]] = {
                "uid": row["fb_uid"], "name": row.get("fb_name") or "", "error": row["error"],
                "at": _ts(row["finished_at"]), "source": "history",
            }
    return list(alerts.values())


# ─────────────────────── HELPERS ────────────────────────────

def _normalize_pair(low: int, high: int, cap: Optional[int] = None):
    low = max(0, int(low or 0))
    high = max(0, int(high or 0))
    if cap is not None:
        low, high = min(low, cap), min(high, cap)
    if low > high:
        low, high = high, low
    return low, high


def _normalize_config(cfg: FarmScenarioConfig) -> FarmScenarioConfig:
    """Validate lại phía server: số nguyên >= 0, Min > Max thì hoán đổi, Thời gian/Delay tối đa 3600."""
    data = cfg.model_dump()
    for prefix in ("newsfeed_time", "newsfeed_delay", "watch_time", "watch_delay"):
        data[f"{prefix}_min"], data[f"{prefix}_max"] = _normalize_pair(
            data[f"{prefix}_min"], data[f"{prefix}_max"], MAX_TIME_VALUE
        )
    for prefix in ("friends", "groups"):
        data[f"{prefix}_min"], data[f"{prefix}_max"] = _normalize_pair(data[f"{prefix}_min"], data[f"{prefix}_max"])
    for prefix, floor in DELAY_FLOORS.items():
        low, high = _normalize_pair(data[f"{prefix}_min"], data[f"{prefix}_max"], MAX_TIME_VALUE)
        data[f"{prefix}_min"], data[f"{prefix}_max"] = max(low, floor), max(high, floor)
    data["daily_friend_limit"] = min(100, max(1, int(data["daily_friend_limit"] or 1)))
    data["daily_group_limit"] = min(100, max(1, int(data["daily_group_limit"] or 1)))
    # Không tham gia nhóm thì từ khóa không có ý nghĩa: bỏ đi để không lưu chuỗi tùy ý vào config_snapshot
    data["group_keyword"] = (data.get("group_keyword") or "").strip() if data["enabled_join_groups"] else ""
    return FarmScenarioConfig(**data)


def split_group_keywords(raw: str) -> List[str]:
    """Tách ô từ khóa theo dấu phẩy: bỏ khoảng trắng, phần rỗng và từ khóa trùng (không phân biệt hoa thường)."""
    keywords, seen = [], set()
    for part in (raw or "").split(","):
        keyword = part.strip()
        if keyword and keyword.lower() not in seen:
            seen.add(keyword.lower())
            keywords.append(keyword)
    return keywords


def _build_plan(cfg: FarmScenarioConfig) -> List[tuple]:
    """
    Sinh kế hoạch riêng cho từng nick (random độc lập trong khoảng Min–Max).
    Check thông báo luôn chạy đầu tiên; các kịch bản còn lại xáo thứ tự ngẫu nhiên.
    """
    steps = []
    if cfg.enabled_newsfeed:
        steps.append(("NEWSFEED", {
            "total_seconds": random.uniform(cfg.newsfeed_time_min, cfg.newsfeed_time_max) * 60,
            "delay": (cfg.newsfeed_delay_min, cfg.newsfeed_delay_max),
        }))
    if cfg.enabled_watch:
        steps.append(("WATCH", {
            "total_seconds": random.uniform(cfg.watch_time_min, cfg.watch_time_max) * 60,
            "delay": (cfg.watch_delay_min, cfg.watch_delay_max),
        }))
    if cfg.enabled_add_friends:
        steps.append(("ADD_FRIEND", {"target": random.randint(cfg.friends_min, cfg.friends_max)}))
    if cfg.enabled_join_groups:
        keywords = split_group_keywords(cfg.group_keyword)
        steps.append(("JOIN_GROUP", {
            "target": random.randint(cfg.groups_min, cfg.groups_max),
            # Mỗi nick dùng từ khóa theo thứ tự riêng để các nick không cùng vào một danh sách nhóm
            "keywords": random.sample(keywords, len(keywords)),
        }))
    random.shuffle(steps)
    if cfg.enabled_check_notif:
        steps.insert(0, ("CHECK_NOTIF", {}))
    return steps


def _uid_has_other_browser(uid: str) -> bool:
    """Nick có trình duyệt khác đang mở thật không (cửa sổ đã bị đóng tay thì gỡ khỏi danh sách)."""
    from core.browser import get_active_drivers, unregister_active_driver
    alive = False
    for d in get_active_drivers(uid, adapters.ACCOUNT_OWNER):
        try:
            if d.window_handles:
                alive = True
                continue
        except Exception:
            pass
        unregister_active_driver(d)
    return alive


def _apply_daily_limit(uid: str, action: str, target: int, cfg: FarmScenarioConfig) -> tuple:
    """Trả (target_thực_tế, đã_làm_hôm_nay, giới_hạn) sau khi trừ phần đã làm trong ngày."""
    if not cfg.daily_limit_enabled:
        return target, 0, 0
    limit = cfg.daily_friend_limit if action == "ADD_FRIEND" else cfg.daily_group_limit
    try:
        done_today = repository.sum_today(uid, action)
    except Exception as e:
        raise RuntimeError(f"Không kiểm tra được giới hạn ngày (lỗi CSDL), bỏ qua để không vượt giới hạn: {e}") from e
    return max(0, min(target, limit - done_today)), done_today, limit


def _run_action(driver, ctl: FarmControl, uid: str, action: str, params: dict,
                cfg: FarmScenarioConfig, report, progress=None) -> dict:
    if action == "CHECK_NOTIF":
        return run_check_notifications(driver, ctl, report)
    if action == "NEWSFEED":
        return run_newsfeed(driver, ctl, params["total_seconds"], *params["delay"], report)
    if action == "WATCH":
        return run_watch(driver, ctl, params["total_seconds"], *params["delay"], report)

    target, done_today, limit = _apply_daily_limit(uid, action, params["target"], cfg)
    if target <= 0:
        return {"status": "SKIPPED", "quantity": 0,
                "details": f"Đã đạt giới hạn ngày ({done_today}/{limit})"}
    if action == "ADD_FRIEND":
        delay = (cfg.friends_delay_min, cfg.friends_delay_max)
        result = run_add_friends(driver, ctl, target, report, progress, delay=delay)
        result["source"] = "suggestions"
        if result.get("no_suggestions") and cfg.friends_fallback_group_members:
            report("Không có gợi ý kết bạn, chuyển sang thành viên nhóm đã tham gia")
            fallback = run_add_friends_from_groups(driver, ctl, target, report, progress, delay=delay)
            fallback["details"] = f"Không có gợi ý → {fallback['details']}"
            fallback["source"] = "group_members"
            return fallback
        return result
    return run_join_groups(driver, ctl, target, params.get("keywords"), report, progress,
                           delay=(cfg.groups_delay_min, cfg.groups_delay_max))


def _record_action(uid: str, action: str, result: dict, owner: Optional[str]):
    """Ghi 1 hành động vào farm_interaction_logs (qua hàng đợi) và giữ lại để tổng hợp dòng lịch sử."""
    with _state_lock:
        run_id = _state["accounts"].get(uid, {}).get("run_id")
        _history_data.setdefault(uid, {}).setdefault("actions", []).append({"action": action, **result})
    repository.add_log(run_id, adapters.get_machine_id(), uid, action, result["status"],
                       result.get("quantity", 0), result.get("details", ""), owner_username=owner)


def _proxy_host(proxy: Optional[str]) -> Optional[str]:
    """host:port của proxy, bỏ user/pass trước khi lưu lên CSDL chung."""
    if not proxy or not str(proxy).strip():
        return None
    try:
        info = parse_proxy(str(proxy).strip())
        return f"{info['host']}:{info['port']}" if info else None
    except Exception:
        return None


def _finalize(uid: str, cfg: FarmScenarioConfig, owner: Optional[str]):
    """Ghi trạng thái cuối của lượt + dòng lịch sử (gọi đúng 1 lần cho mỗi nick, kể cả khi dừng sớm / lỗi)."""
    with _state_lock:
        acc = _state["accounts"].get(uid)
        if not acc or acc.get("finalized"):
            return
        acc["finalized"] = True
        if acc["status"] not in FINAL_STATUSES:
            acc["status"] = "FAILED"
            acc["error"] = acc.get("error") or "Tiến trình kết thúc bất thường"
        acc_copy = dict(acc)
        data = dict(_history_data.get(uid) or {})
    now = repository.utc_now()
    started = data.get("started_at") or now
    history = {
        "run_id": acc_copy["run_id"],
        "machine_id": adapters.get_machine_id(),
        "owner_username": owner or None,
        "session_id": _state.get("session_id"),
        "fb_uid": uid,
        "fb_name": acc_copy.get("name") or None,
        "proxy_host": data.get("proxy_host"),
        "proxy_mode": data.get("proxy_mode"),
        "egress_ip": data.get("egress_ip"),
        "fingerprint_mode": data.get("fingerprint_mode"),
        "final_status": acc_copy["status"],
        "error": acc_copy.get("error"),
        "light_checkpoint": bool(data.get("light_checkpoint")),
        "cookie_saved": bool(data.get("cookie_saved")),
        "started_at": started,
        "finished_at": now,
        "duration_seconds": max(0, int((now - started).total_seconds())),
        "config_snapshot": json.dumps(cfg.model_dump(), ensure_ascii=False),
        "created_at": now,
        **repository.summarize_actions(data.get("actions") or []),
    }
    repository.finish_run(acc_copy["run_id"], acc_copy["status"], acc_copy.get("error"),
                          acc_copy.get("activity") or "", history)


# ─────────────────────── WORKER ────────────────────────────

# Tương tác nuôi nick: không để Chrome hãm timer / tạm dừng video khi cửa sổ bị che hoặc thu nhỏ
FARM_CHROME_ARGUMENTS = [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--autoplay-policy=no-user-gesture-required",
]

# Page Visibility luôn báo đang hiển thị và chặn sự kiện visibilitychange tới script của trang
FARM_VISIBILITY_JS = """
    Object.defineProperty(document, 'hidden', { get: () => false });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
    const stopVisibility = (e) => e.stopImmediatePropagation();
    window.addEventListener('visibilitychange', stopVisibility, true);
    document.addEventListener('visibilitychange', stopVisibility, true);
"""


def _save_session_cookie(uid: str, driver):
    """Chrome của nick bị đóng để mở lại: lưu cookie còn sống trước khi đóng."""
    from core.browser import extract_cookies_as_string

    cookies = extract_cookies_as_string(driver)
    if cookies and "c_user=" in cookies:
        adapters.save_cookie(uid, cookies)
        adapters.set_login_status(uid, "logged_in")


def _farm_worker(uid: str, slot: int, cfg: FarmScenarioConfig, owner: Optional[str]):
    """Chạy toàn bộ kịch bản đã tick cho 1 nick trên cùng 1 tab Chrome."""
    from core.browser import extract_cookies_as_string, get_profile_lock, open_browser
    from modules.module_03_acc_farm.browser.login_flow import ensure_logged_in, is_checkpoint_url

    ctl = _control
    _hist(uid, started_at=repository.utc_now())
    try:
        ctl.checkpoint()
    except FarmStopped:
        _set_account(uid, status="STOPPED", activity="Đã dừng trước khi đến lượt", error="Dừng bởi người dùng")
        return

    _set_account(uid, status="RUNNING", thread=slot, activity="Đang khởi động trình duyệt", started_at=time.time())

    if _uid_has_other_browser(uid):
        msg = "Nick đang mở trình duyệt ở tiến trình khác, bỏ qua lượt này"
        _emit("error", f"{msg}: {uid}", uid, slot)
        _set_account(uid, status="FAILED", error=msg, activity=msg)
        return

    profile_lock = get_profile_lock(uid, adapters.ACCOUNT_OWNER)
    if not profile_lock.acquire(timeout=5):
        msg = "Nick đang bận ở tiến trình khác, bỏ qua lượt này"
        _emit("error", f"{msg}: {uid}", uid, slot)
        _set_account(uid, status="FAILED", error=msg, activity=msg)
        return

    driver = None
    final_status = "COMPLETED"
    error_msg = None
    save_cookie = True
    cookie_saved = False

    try:
        account = adapters.get_account(uid)
        if not account:
            raise RuntimeError("Không tìm thấy tài khoản trong danh sách")
        password, two_fa = adapters.get_credentials(uid)
        display = f"{uid} ({account['profile_name']})" if account["profile_name"] else uid
        expected_name = account["profile_name"]
        proxy, cookie = account["proxy"], account["cookie"]
        _hist(uid, proxy_host=_proxy_host(proxy))

        _emit("info", f"Khởi chạy Chrome Profile cho UID {display}...", uid, slot)
        pop_notices()
        pop_light_checkpoint()
        # Nick có proxy mà proxy chết thì dừng nick, không chạy bằng IP thật của máy
        driver = open_browser(uid, owner=adapters.ACCOUNT_OWNER, proxy=proxy, scope="farm",
                              allow_direct_fallback=False,
                              extra_arguments=FARM_CHROME_ARGUMENTS, extra_init_scripts=[FARM_VISIBILITY_JS],
                              on_before_close=lambda d, _uid=uid: _save_session_cookie(_uid, d))
        mode = getattr(driver, "proxy_mode", "none")
        _hist(uid, proxy_mode=mode, egress_ip=getattr(driver, "proxy_egress_ip", None),
              fingerprint_mode=getattr(driver, "fingerprint_mode", None))
        if mode == "facebook_only":
            _emit("info", "Proxy: đang dùng (proxy chỉ cho phép Facebook, không đọc được IP ra ngoài)", uid, slot)
        elif mode == "full":
            _emit("info", f"Proxy: đang dùng, IP ra ngoài {getattr(driver, 'proxy_egress_ip', None) or 'không rõ'}", uid, slot)
        else:
            _emit("warning", "Proxy: nick không có proxy, đang chạy bằng IP của máy", uid, slot)
        ctl.checkpoint()

        # Checkpoint nhẹ (chỉ cần Dismiss) thì bỏ qua trước, tránh luồng đăng nhập coi là nick chết
        driver.get("https://www.facebook.com")
        ctl.sleep(random.uniform(3.0, 5.0))
        if is_checkpoint_url(driver.current_url or ""):
            try_dismiss_checkpoint(driver)
        # Đóng popup thông báo tài khoản trước, tránh luồng đăng nhập bấm nhầm nút Close khác trên trang
        dismiss_notice_dialogs(driver)

        login = ensure_logged_in(driver, uid, password=password, two_fa=two_fa,
                                 cookie=cookie, expected_name=expected_name)
        for notice in pop_notices():
            _emit("warning", notice, uid, slot)
        if not login.get("success"):
            raise FarmAccountDead(login.get("error") or "Phiên đăng nhập không hợp lệ", checkpoint=login.get("checkpoint"))

        plan = _build_plan(cfg)
        _emit("info", "Kế hoạch: " + " → ".join(ACTION_LABELS[a] for a, _ in plan), uid, slot)
        _set_account(uid, actions={a: "PENDING" for a, _ in plan})

        for action, params in plan:
            ctl.checkpoint()
            label = ACTION_LABELS[action]
            _set_account(uid, activity=f"Đang chạy: {label}")
            _emit("info", f"Bắt đầu: {label}", uid, slot)
            with _state_lock:
                acc = _state["accounts"].get(uid, {})
                actions = dict(acc.get("actions") or {})
            actions[action] = "RUNNING"
            _set_account(uid, actions=actions)

            def report(text, _uid=uid):
                _set_account(_uid, activity=text)

            done = {"quantity": 0}
            counter_field = COUNTER_FIELDS.get(action)

            def progress(quantity, _uid=uid, _field=counter_field):
                done["quantity"] = quantity
                if _field:
                    _set_account(_uid, **{_field: quantity})

            try:
                result = _run_action(driver, ctl, uid, action, params, cfg, report, progress)
            except FarmStopped as e:
                # Newsfeed / Watch gắn phần đã chạy (giây, lần cuộn, video), nhóm gắn từ khóa đã dùng vào lỗi;
                # số lượng kết bạn / nhóm báo qua progress
                partial = dict(getattr(e, "partial", None) or {})
                quantity = partial.pop("quantity", done["quantity"])
                _record_action(uid, action, {
                    "status": "SKIPPED", "quantity": quantity,
                    "details": f"Dừng giữa chừng, đã làm {quantity}" if quantity else "Dừng giữa chừng",
                    **partial,
                }, owner)
                actions[action] = "SKIPPED"
                _set_account(uid, actions=actions)
                raise
            except FarmAccountDead as e:
                _record_action(uid, action, {"status": "FAILED", "quantity": done["quantity"],
                                             "details": f"Tài khoản chết giữa chừng: {e}"[:300]}, owner)
                actions[action] = "FAILED"
                _set_account(uid, actions=actions)
                raise
            except Exception as e:
                # Lỗi 1 hoạt động: ghi nhận rồi chạy tiếp (BR-STS-02); trình duyệt chết thì để vòng ngoài xử lý
                try:
                    _ = driver.title
                except Exception:
                    _record_action(uid, action, {"status": "FAILED", "quantity": done["quantity"],
                                                 "details": "Trình duyệt bị đóng giữa chừng"}, owner)
                    raise
                logger.exception(f"[{uid}] Lỗi kịch bản {action}: {e}")
                result = {"status": "FAILED", "quantity": done["quantity"], "details": f"Lỗi: {str(e)[:200]}"}

            _record_action(uid, action, result, owner)

            actions[action] = result["status"]
            counters = {counter_field: result.get("quantity", 0)} if counter_field else {}
            _set_account(uid, actions=actions, **counters)

            for notice in pop_notices():
                _emit("warning", notice, uid, slot)
            level = {"SUCCESS": "success", "BLOCKED": "warning", "SKIPPED": "warning"}.get(result["status"], "error")
            _emit(level, f"{label}: {result.get('details', '')}", uid, slot)
            if result["status"] == "BLOCKED":
                final_status = "BLOCKED"

    except FarmStopped:
        final_status = "STOPPED"
        error_msg = "Dừng bởi người dùng"
    except ProxyError as e:
        final_status = "FAILED"
        error_msg = str(e)[:300]
        save_cookie = False
    except FarmAccountDead as e:
        final_status = "DIE"
        error_msg = str(e)
        save_cookie = False
        try:
            # "checkpoint" để tách nick cần xác minh với nick chỉ mất phiên; cả hai đều bị loại khỏi lượt chạy sau
            adapters.set_login_status(uid, "checkpoint" if e.checkpoint else "failed")
        except Exception as db_err:
            logger.warning(f"[{uid}] Không cập nhật được trạng thái đăng nhập: {db_err}")
        if e.checkpoint == CHECKPOINT_HEAVY:
            _alert_heavy_checkpoint(uid, error_msg)
    except Exception as e:
        logger.exception(f"[{uid}] Lỗi tiến trình tương tác: {e}")
        final_status = "FAILED"
        error_msg = str(e)[:300]
    finally:
        if driver is not None:
            if save_cookie:
                try:
                    cookie_str = extract_cookies_as_string(driver)
                    if cookie_str and "c_user=" in cookie_str:
                        adapters.save_cookie(uid, cookie_str)
                        cookie_saved = True
                except Exception as e:
                    logger.debug(f"[{uid}] Không lưu được cookie cuối phiên: {e}")
            try:
                driver.quit()
            except Exception:
                pass
        profile_lock.release()
        _hist(uid, cookie_saved=cookie_saved, light_checkpoint=pop_light_checkpoint())

    summary = {
        "COMPLETED": ("success", "Hoàn thành toàn bộ kịch bản, "
                      + ("đã lưu cookie mới và đóng trình duyệt" if cookie_saved else "đóng trình duyệt (không có cookie mới để lưu)")),
        "BLOCKED": ("warning", "Hoàn thành nhưng có tính năng bị Facebook chặn"),
        "STOPPED": ("warning", "Đã dừng theo yêu cầu"),
        "DIE": ("error", f"Tài khoản cần xác minh / mất phiên: {error_msg}"),
        "FAILED": ("error", f"Lỗi hệ thống: {error_msg}"),
    }[final_status]
    _emit(summary[0], summary[1], uid, slot)
    _set_account(uid, status=final_status, activity=summary[1], error=error_msg, finished_at=time.time())


# ─────────────────────── VÒNG ĐỜI ENGINE ────────────────────────────

async def on_startup(ws_manager):
    """engine.py gọi trong lifespan sau init_database(): log, thread ghi, dọn lượt treo của máy này."""
    adapters.setup_logging()
    adapters.register_log_channel(ws_manager, asyncio.get_running_loop())
    repository.writer.start()
    try:
        stale = await asyncio.to_thread(repository.mark_stale_runs, await asyncio.to_thread(adapters.get_machine_id))
        if stale:
            logger.info(f"Đã chuyển {stale} lượt treo của lần chạy trước sang FAILED và ghi lịch sử")
    except Exception as e:
        logger.warning(f"Không dọn được lượt treo lúc khởi động: {e}")


async def on_shutdown():
    if _control is not None and _state["running"]:
        _control.stop()
    await asyncio.to_thread(repository.writer.stop)


# ─────────────────────── ENDPOINTS: CHẠY ────────────────────────────

@router.post("/start")
async def start_farm_interactions(req: FarmStartRequest):
    global _control, _active_task
    owner = adapters.get_owner_username()
    if owner and not adapters.is_license_valid(owner):
        raise HTTPException(status_code=403, detail="Tài khoản của bạn đã hết hạn bản quyền! Vui lòng liên hệ Quản trị viên để gia hạn.")

    with _state_lock:
        if _state["running"]:
            raise HTTPException(status_code=409, detail="Đang có phiên Tương tác tài khoản chạy. Vui lòng dừng hoặc chờ hoàn tất.")

    uids = list(dict.fromkeys(str(u).strip() for u in req.uids if str(u).strip()))
    if not uids:
        raise HTTPException(status_code=400, detail="Vui lòng chọn ít nhất 1 tài khoản để thực thi.")
    cfg = _normalize_config(req.config)
    if not any([cfg.enabled_newsfeed, cfg.enabled_watch, cfg.enabled_add_friends,
                cfg.enabled_join_groups, cfg.enabled_check_notif]):
        raise HTTPException(status_code=400, detail="Kịch bản tương tác đang trống. Vui lòng chọn ít nhất 1 hành động.")
    if len(cfg.group_keyword) > GROUP_KEYWORD_MAX_LEN:
        raise HTTPException(status_code=400,
                            detail=f"Từ khóa tham gia nhóm không được quá {GROUP_KEYWORD_MAX_LEN} ký tự.")

    # Chỉ nick Live + Đã đăng nhập mới được chạy (VR-M03-ACC-01)
    eligible, rejected = [], []
    for uid in uids:
        acc = await asyncio.to_thread(adapters.get_account, uid)
        if acc and acc["status"] == "live" and acc["login_status"] == "logged_in":
            eligible.append({"uid": acc["uid"], "name": acc["profile_name"]})
        else:
            rejected.append(uid)
    if not eligible:
        raise HTTPException(status_code=400, detail="Không có tài khoản nào đủ điều kiện (Live + Đã đăng nhập).")

    # Mỗi lần kích hoạt tạo lượt mới, giữ nguyên lịch sử lượt cũ (BR-STS-01)
    session_id = uuid.uuid4().hex
    machine_id = await asyncio.to_thread(adapters.get_machine_id)
    try:
        run_ids = {}
        for acc in eligible:
            run_ids[acc["uid"]] = await asyncio.to_thread(
                repository.create_run, machine_id, acc["uid"], acc["name"], session_id, owner
            )
    except Exception as e:
        logger.exception(f"Không tạo được lượt chạy: {e}")
        raise HTTPException(status_code=503, detail="Không ghi được lượt chạy vào CSDL. Kiểm tra kết nối CSDL rồi thử lại.")

    threads = max(1, min(int(req.threads or 1), HARD_MAX_THREADS, len(eligible)))
    history_alerts = await asyncio.to_thread(_history_checkpoint_alerts, machine_id)
    _control = FarmControl()
    with _state_lock:
        _history_data.clear()
        _state.update({
            "checkpoint_alerts": history_alerts,
            "running": True,
            "owner_username": owner or "",
            "session_id": session_id,
            "threads": threads,
            "started_at": time.time(),
            "finished_at": 0,
            "accounts": {
                acc["uid"]: {
                    "uid": acc["uid"],
                    "name": acc["name"],
                    "run_id": run_ids[acc["uid"]],
                    "status": "PENDING",
                    "activity": "Chờ thực thi",
                    "error": None,
                    "thread": None,
                    "actions": {},
                    "friends_sent": 0,
                    "groups_joined": 0,
                    "started_at": None,
                    "finished_at": None,
                }
                for acc in eligible
            },
        })

    _emit("info", f"Bắt đầu Tương tác tài khoản: {len(eligible)} nick, {threads} luồng")
    if rejected:
        _emit("warning", f"Bỏ qua {len(rejected)} nick không đủ điều kiện (cần Live + Đã đăng nhập): {', '.join(rejected)}")
    if history_alerts:
        listed = ", ".join(a["uid"] + (f" ({a['name']})" if a["name"] else "") for a in history_alerts)
        _emit("warning", f"Cảnh báo: {CHECKPOINT_ALERT_HOURS} giờ qua có {len(history_alerts)} nick trên máy này dính "
                         f"checkpoint nặng: {listed}. Facebook có thể đang khóa theo cụm thiết bị, cân nhắc giảm số nick chạy.")

    async def run_all():
        loop = asyncio.get_running_loop()
        slots: asyncio.Queue = asyncio.Queue()
        for i in range(1, threads + 1):
            slots.put_nowait(i)

        async def run_one(uid: str):
            slot = await slots.get()
            try:
                await loop.run_in_executor(_farm_executor, _farm_worker, uid, slot, cfg, owner)
            except Exception as e:
                logger.exception(f"[{uid}] Farm worker crashed: {e}")
                _set_account(uid, status="FAILED", error=str(e)[:300], activity="Lỗi hệ thống")
            finally:
                slots.put_nowait(slot)
                try:
                    _finalize(uid, cfg, owner)
                except Exception as e:
                    logger.exception(f"[{uid}] Không ghi được lịch sử lượt chạy: {e}")

        try:
            await asyncio.gather(*(run_one(acc["uid"]) for acc in eligible))
        finally:
            with _state_lock:
                _state["running"] = False
                _state["finished_at"] = time.time()
                counts = {}
                for acc in _state["accounts"].values():
                    counts[acc["status"]] = counts.get(acc["status"], 0) + 1
            summary = ", ".join(f"{k}: {v}" for k, v in sorted(counts.items()))
            _emit("success", f"Kết thúc phiên Tương tác tài khoản ({summary})")

    _active_task = asyncio.create_task(run_all())
    return {"started": True, "accepted": [a["uid"] for a in eligible], "rejected": rejected, "threads": threads}


@router.post("/pause")
async def pause_farm():
    if not _control or not _state["running"]:
        raise HTTPException(status_code=409, detail="Không có phiên Tương tác nào đang chạy.")
    _control.pause()
    with _state_lock:
        running_uids = [u for u, a in _state["accounts"].items() if a["status"] == "RUNNING"]
    for uid in running_uids:
        _set_account(uid, status="PAUSED")
    _emit("warning", "Tiến trình tạm ngưng bởi người dùng")
    return {"paused": True}


@router.post("/resume")
async def resume_farm():
    if not _control or not _state["running"]:
        raise HTTPException(status_code=409, detail="Không có phiên Tương tác nào đang chạy.")
    _control.resume()
    with _state_lock:
        paused_uids = [u for u, a in _state["accounts"].items() if a["status"] == "PAUSED"]
    for uid in paused_uids:
        _set_account(uid, status="RUNNING")
    _emit("info", "Tiếp tục chạy Tương tác tài khoản")
    return {"resumed": True}


@router.post("/stop")
async def stop_farm():
    if not _control or not _state["running"]:
        raise HTTPException(status_code=409, detail="Không có phiên Tương tác nào đang chạy.")
    _control.stop()
    _emit("warning", "Đã nhận lệnh Dừng hẳn: các nick đang chạy sẽ lưu cookie rồi đóng trình duyệt, nick đang chờ sẽ bị hủy")
    return {"stopping": True}


def _ts(value) -> Optional[float]:
    value = repository.as_datetime(value)
    return value.replace(tzinfo=timezone.utc).timestamp() if value else None


def _restore_from_db(snap: Dict) -> Dict:
    """Bộ nhớ engine trống (vừa khởi động lại): dựng lại lần Kích hoạt gần nhất của máy này từ CSDL."""
    runs, logs_by_run = repository.get_latest_session(adapters.get_machine_id())
    if not runs:
        return snap
    accounts = []
    for run in runs:
        actions = {}
        friends_sent = groups_joined = 0
        for log in logs_by_run.get(run["id"], []):
            actions[log["action_type"]] = log["status"]
            if log["action_type"] == "ADD_FRIEND":
                friends_sent += log["quantity"] or 0
            elif log["action_type"] == "JOIN_GROUP":
                groups_joined += log["quantity"] or 0
        accounts.append({
            "uid": run["fb_uid"], "name": run.get("fb_name") or "", "run_id": run["id"],
            "status": run["status"],
            "activity": run["error"] if run["error"] == repository.STALE_ERROR else (run.get("current_activity") or ""),
            "error": run["error"], "thread": None, "actions": actions,
            "friends_sent": friends_sent, "groups_joined": groups_joined,
            "started_at": _ts(run["started_at"]), "finished_at": _ts(run["finished_at"]),
        })
    return {
        **snap, "running": False, "paused": False, "stopping": False,
        "started_at": min((a["started_at"] or 0) for a in accounts),
        "finished_at": max((a["finished_at"] or 0) for a in accounts),
        "accounts": accounts,
    }


@router.get("/status")
async def farm_status():
    snap = _snapshot()
    snap.pop("session_id", None)
    if snap["accounts"]:
        return snap
    try:
        return await asyncio.to_thread(_restore_from_db, snap)
    except Exception as e:
        logger.warning(f"Không khôi phục được trạng thái từ CSDL: {e}")
        return snap


# ─────────────────────── ENDPOINTS: SETTINGS ────────────────────────────

@router.get("/settings")
async def get_farm_settings():
    try:
        return await asyncio.to_thread(repository.get_settings, adapters.get_machine_id())
    except Exception as e:
        logger.warning(f"Không đọc được farm_settings: {e}")
        raise HTTPException(status_code=503, detail="Không đọc được cấu hình từ CSDL.")


@router.post("/settings")
async def save_farm_setting(item: SettingItem):
    spec = SETTING_KEYS.get(item.key)
    if not spec:
        raise HTTPException(status_code=400, detail="Khóa cấu hình không hợp lệ.")
    kind, bounds = spec
    value = (item.value or "").strip()
    if kind == "bool":
        if value not in ("0", "1"):
            raise HTTPException(status_code=400, detail="Giá trị phải là 0 hoặc 1.")
    else:
        if not value.isdigit() or not (bounds[0] <= int(value) <= bounds[1]):
            raise HTTPException(status_code=400, detail=f"Giá trị phải là số nguyên từ {bounds[0]} đến {bounds[1]}.")
        value = str(int(value))
    try:
        await asyncio.to_thread(repository.set_setting, adapters.get_machine_id(), item.key, value)
    except Exception as e:
        logger.warning(f"Không lưu được farm_settings: {e}")
        raise HTTPException(status_code=503, detail="Không lưu được cấu hình vào CSDL.")
    return {"key": item.key, "value": value}


# ─────────────────────── ENDPOINTS: LỊCH SỬ ────────────────────────────

def _history_filters(search: Optional[str], action: Optional[str], status: Optional[str],
                     proxy: Optional[str], date_from: Optional[str], date_to: Optional[str]) -> Dict:
    if action and action not in ACTION_LABELS:
        raise HTTPException(status_code=400, detail="Kịch bản không hợp lệ.")
    if status and status not in FINAL_STATUSES:
        raise HTTPException(status_code=400, detail="Trạng thái không hợp lệ.")
    if proxy and proxy not in ("with", "without"):
        raise HTTPException(status_code=400, detail="Bộ lọc proxy không hợp lệ.")
    for value in (date_from, date_to):
        if value:
            if not _DATE_RE.match(value):
                raise HTTPException(status_code=400, detail="Ngày phải có dạng YYYY-MM-DD.")
            try:
                datetime.strptime(value, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="Ngày không hợp lệ.")
    return {"search": (search or "").strip()[:100], "action": action, "status": status,
            "proxy": proxy, "date_from": date_from, "date_to": date_to}


def _iso(value) -> Optional[str]:
    value = repository.as_datetime(value)
    return value.replace(tzinfo=timezone.utc).isoformat() if value else None


def _serialize_history(row: Dict) -> Dict:
    out = dict(row)
    for key in ("started_at", "finished_at", "created_at"):
        out[key] = _iso(out.get(key))
    for key in ("light_checkpoint", "cookie_saved", "notif_checked", "notif_opened"):
        out[key] = bool(out.get(key))
    for key in ("actions_summary", "config_snapshot"):
        try:
            out[key] = json.loads(out[key]) if out.get(key) else None
        except (TypeError, ValueError):
            out[key] = None
    out.pop("machine_id", None)
    return out


@router.get("/history")
async def farm_history(
    search: Optional[str] = None,
    action: Optional[str] = None,
    status: Optional[str] = None,
    proxy: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=HISTORY_PAGE_SIZE_MAX),
):
    filters = _history_filters(search, action, status, proxy, date_from, date_to)
    try:
        data = await asyncio.to_thread(repository.list_history, adapters.get_machine_id(), filters, page, page_size)
    except Exception as e:
        logger.warning(f"Không đọc được lịch sử: {e}")
        raise HTTPException(status_code=503, detail="Không đọc được lịch sử từ CSDL.")
    data["items"] = [_serialize_history(r) for r in data["items"]]
    return data


_CSV_COLUMNS = [
    ("id", "Mã"), ("started_at", "Bắt đầu (UTC)"), ("finished_at", "Kết thúc (UTC)"),
    ("duration_seconds", "Thời lượng (giây)"), ("fb_uid", "UID"), ("fb_name", "Tên nick"),
    ("final_status", "Trạng thái"), ("error", "Lỗi"),
    ("proxy_host", "Proxy"), ("proxy_mode", "Chế độ proxy"), ("egress_ip", "IP ra ngoài"),
    ("fingerprint_mode", "Fingerprint"),
    ("newsfeed_seconds", "Newsfeed (giây)"), ("newsfeed_scrolls", "Số lần cuộn"),
    ("watch_seconds", "Watch (giây)"), ("watch_videos", "Video đã xem"),
    ("friends_sent", "Lời mời kết bạn"), ("friends_source", "Nguồn kết bạn"),
    ("groups_joined", "Nhóm đã tham gia"), ("groups_keyword", "Từ khóa nhóm"),
    ("notif_checked", "Đã xem thông báo"),
    ("notif_opened", "Mở thông báo chưa đọc"),
    ("actions_success", "HĐ thành công"), ("actions_failed", "HĐ lỗi"),
    ("actions_blocked", "HĐ bị chặn"), ("actions_skipped", "HĐ bỏ qua"),
    ("light_checkpoint", "Checkpoint nhẹ"), ("cookie_saved", "Đã lưu cookie"),
]


def _csv_cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Có" if value else "Không"
    text = str(value)
    # Chống CSV injection khi mở bằng Excel (tên nick / lỗi do Facebook trả về có thể bắt đầu bằng = + - @)
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        text = "'" + text
    return text


@router.get("/history/export")
async def export_farm_history(
    search: Optional[str] = None,
    action: Optional[str] = None,
    status: Optional[str] = None,
    proxy: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    filters = _history_filters(search, action, status, proxy, date_from, date_to)
    try:
        rows = await asyncio.to_thread(repository.iter_history_for_export, adapters.get_machine_id(),
                                       filters, EXPORT_MAX_ROWS)
    except Exception as e:
        logger.warning(f"Không xuất được lịch sử: {e}")
        raise HTTPException(status_code=503, detail="Không đọc được lịch sử từ CSDL.")
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([title for _, title in _CSV_COLUMNS] + ["Kịch bản"])
    for row in rows:
        item = _serialize_history(row)
        actions = item.get("actions_summary") or []
        scenario = "; ".join(f"{a.get('action')}={a.get('status')}({a.get('quantity') or 0})" for a in actions)
        writer.writerow([_csv_cell(item.get(key)) for key, _ in _CSV_COLUMNS] + [_csv_cell(scenario)])
    filename = f"lich_su_tuong_tac_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content="﻿" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/history/{history_id}")
async def farm_history_detail(history_id: int):
    try:
        data = await asyncio.to_thread(repository.get_history_detail, adapters.get_machine_id(), history_id)
    except Exception as e:
        logger.warning(f"Không đọc được chi tiết lịch sử: {e}")
        raise HTTPException(status_code=503, detail="Không đọc được lịch sử từ CSDL.")
    if not data:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản ghi lịch sử.")
    return {
        "history": _serialize_history(data["history"]),
        "logs": [{**log, "created_at": _iso(log.get("created_at"))} for log in data["logs"]],
    }


@router.post("/history/cleanup")
async def cleanup_farm_history(req: CleanupRequest):
    if req.keep_days < 1 or req.keep_days > 3650:
        raise HTTPException(status_code=400, detail="Số ngày giữ lại phải từ 1 đến 3650 (luôn giữ dữ liệu hôm nay).")
    try:
        result = await asyncio.to_thread(repository.cleanup_history, adapters.get_machine_id(), req.keep_days)
    except Exception as e:
        logger.warning(f"Không dọn được lịch sử: {e}")
        raise HTTPException(status_code=503, detail="Không dọn được dữ liệu trong CSDL.")
    _emit("info", f"Đã dọn nhật ký Tương tác tài khoản: {result['history']} lượt lịch sử, {result['logs']} log hành động")
    return result
