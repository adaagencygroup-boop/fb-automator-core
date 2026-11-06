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
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel

from core.browser import ProxyError, parse_proxy
from modules.module_03_acc_farm import adapters, repository
from modules.module_03_acc_farm.browser.errors import BROWSER_CLOSED, BROWSER_HUNG, friendly_error
from modules.module_03_acc_farm.browser.login_flow import CHECKPOINT_HEAVY, HEAVY_CHECKPOINT_PREFIX
from modules.module_03_acc_farm.farming.flow import (
    SKIP_DONE,
    FarmAccountDead,
    FarmControl,
    FarmStopped,
    dismiss_notice_dialogs,
    pop_light_checkpoint,
    pop_notices,
    try_dismiss_checkpoint,
    run_add_friends,
    run_add_friends_from_groups,
    run_add_friends_from_links,
    run_check_notifications,
    run_join_groups,
    run_join_groups_from_links,
    run_leave_groups,
    run_newsfeed,
    run_story,
    run_watch,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/farm", tags=["Module 03 - Tương tác tài khoản"])

HARD_MAX_THREADS = 10
MAX_TIME_VALUE = 3600
# Delay tối thiểu ép phía server: nhập 0-1 giây sẽ gửi lời mời liên tục như bot, rất dễ bị chặn tính năng
DELAY_FLOORS = {"friends_delay": 3, "groups_delay": 5, "leave_delay": 5}
# VR-M03-CFG-03: ô từ khóa tham gia nhóm (nhiều từ khóa cách nhau dấu phẩy) không quá số ký tự này,
# tính sau khi bỏ khoảng trắng 2 đầu
GROUP_KEYWORD_MAX_LEN = 50
# Chế độ danh sách link: giới hạn số nhóm / lời mời mỗi nick mỗi phiên
LIST_LIMIT_RANGE = (1, 100)
# Rời nhóm bằng tính năng Rời nhóm thì sau chừng này ngày mới được tham gia lại theo danh sách
REJOIN_AFTER_DAYS = 7
# Số dòng lỗi tối đa đưa vào thông báo 400 (FE đã hiện đủ từng dòng)
LINK_ERRORS_IN_MESSAGE = 5
# Loại cảm xúc cho phép (giống nhau ở Newsfeed, Watch, Story; không có Angry)
REACTION_TYPES = ("Like", "Love", "Care", "Haha", "Wow", "Sad")
REACT_SCENARIOS = ("newsfeed", "watch", "story")
# Rời nhóm: ngưỡng ngày random lại cho mỗi nick mỗi phiên (không có ô trên UI)
LEAVE_STALE_DAYS = (5, 7)    # "không tương tác lâu ngày" / "lâu chưa hoạt động"
LEAVE_RECENT_DAYS = (2, 3)   # "tham gia gần đây"
_farm_executor = ThreadPoolExecutor(max_workers=HARD_MAX_THREADS, thread_name_prefix="farm")

ACTION_LABELS = {
    "CHECK_NOTIF": "Check thông báo",
    "NEWSFEED": "Lướt Newsfeed",
    "WATCH": "Xem Video Watch",
    "STORY": "Xem Story",
    "ADD_FRIEND": "Kết bạn theo gợi ý",
    "JOIN_GROUP": "Tham gia nhóm",
    "LEAVE_GROUP": "Rời nhóm",
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
    newsfeed_react_enabled: bool = False
    newsfeed_react_types: List[str] = []   # loại cảm xúc được chọn ngẫu nhiên (REACTION_TYPES)

    enabled_watch: bool = False
    watch_time_min: int = 3          # phút
    watch_time_max: int = 7
    watch_delay_min: int = 5         # giây xem mỗi video
    watch_delay_max: int = 15
    watch_react_enabled: bool = False
    watch_react_types: List[str] = []

    enabled_story: bool = False
    story_min: int = 5               # số khung story xem mỗi nick
    story_max: int = 10
    story_delay_min: int = 3         # giây xem mỗi khung
    story_delay_max: int = 8
    story_react_enabled: bool = False
    story_react_types: List[str] = []

    enabled_add_friends: bool = False
    friends_min: int = 3
    friends_max: int = 7
    friends_delay_min: int = 5       # giây nghỉ giữa 2 lời mời
    friends_delay_max: int = 15
    friends_fallback_group_members: bool = False   # Không có gợi ý thì kết bạn với thành viên nhóm đã tham gia
    friend_source: Literal["suggestions", "list"] = "suggestions"
    friend_links: str = ""           # Chế độ list: mỗi dòng 1 link trang cá nhân
    friend_list_limit: int = 10      # Chế độ list: số lời mời tối đa mỗi nick mỗi phiên
    friends_split_enabled: bool = True   # Chế độ list: chia link cho các nick, mỗi người chỉ 1 nick trong dàn mời

    enabled_join_groups: bool = False
    groups_min: int = 1
    groups_max: int = 3
    groups_delay_min: int = 10       # giây nghỉ giữa 2 lần tham gia nhóm
    groups_delay_max: int = 20
    group_keyword: str = ""
    group_source: Literal["keyword", "list"] = "keyword"
    group_links: str = ""            # Chế độ list: mỗi dòng 1 link nhóm
    group_list_limit: int = 10       # Chế độ list: số nhóm tối đa mỗi nick mỗi phiên
    groups_split_enabled: bool = True    # Mỗi nhóm chỉ 1 nick trong dàn vào (chia link / từ khóa, bỏ nhóm đã có chủ)

    enabled_leave_groups: bool = False
    leave_min: int = 3
    leave_max: int = 5
    leave_delay_min: int = 10        # giây nghỉ giữa 2 lần rời nhóm
    leave_delay_max: int = 30
    # not_visited: lâu không vào nhóm ("You last visited"); inactive: nhóm lâu chưa hoạt động ("Last active");
    # recent: nhóm tool vào gần đây ở các phiên trước
    leave_criteria: Literal["not_visited", "inactive", "recent"] = "not_visited"
    leave_keep_admin: bool = True    # Giữ lại nhóm nick là Admin/Mod

    enabled_check_notif: bool = False

    daily_limit_enabled: bool = False
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
# Phần link / từ khóa chia cho từng nick khi bấm Kích hoạt (uid -> {"group_links", "friend_links", "group_keywords"})
_assignments: Dict[str, Dict] = {}
# UID mọi nick trong dàn (cùng owner, đọc 1 lần lúc Kích hoạt) để kết bạn không mời trúng nick nhà.
# None = đọc lỗi: kết bạn báo lỗi chứ không chạy mà không kiểm.
_own_uids: Optional[frozenset] = frozenset()


def _snapshot() -> Dict:
    with _state_lock:
        return {
            **{k: v for k, v in _state.items() if k not in ("accounts", "checkpoint_alerts", "owner_scope")},
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
    for prefix in ("newsfeed_time", "newsfeed_delay", "watch_time", "watch_delay", "story_delay"):
        data[f"{prefix}_min"], data[f"{prefix}_max"] = _normalize_pair(
            data[f"{prefix}_min"], data[f"{prefix}_max"], MAX_TIME_VALUE
        )
    low, high = _normalize_pair(data["story_min"], data["story_max"])
    data["story_min"], data["story_max"] = max(1, low), max(1, high)
    for scenario in REACT_SCENARIOS:
        # Chỉ giữ loại hợp lệ, không trùng; bật mà không chọn loại nào thì coi như tắt
        types = [t for t in REACTION_TYPES if t in set(data[f"{scenario}_react_types"] or [])]
        enabled = bool(data[f"{scenario}_react_enabled"] and types)
        data[f"{scenario}_react_enabled"], data[f"{scenario}_react_types"] = enabled, types if enabled else []
    for prefix in ("friends", "groups", "leave"):
        data[f"{prefix}_min"], data[f"{prefix}_max"] = _normalize_pair(data[f"{prefix}_min"], data[f"{prefix}_max"])
    for prefix, floor in DELAY_FLOORS.items():
        low, high = _normalize_pair(data[f"{prefix}_min"], data[f"{prefix}_max"], MAX_TIME_VALUE)
        data[f"{prefix}_min"], data[f"{prefix}_max"] = max(low, floor), max(high, floor)
    data["daily_friend_limit"] = min(100, max(1, int(data["daily_friend_limit"] or 1)))
    data["daily_group_limit"] = min(100, max(1, int(data["daily_group_limit"] or 1)))
    for key in ("friend_list_limit", "group_list_limit"):
        data[key] = min(LIST_LIMIT_RANGE[1], max(LIST_LIMIT_RANGE[0], int(data[key] or LIST_LIMIT_RANGE[0])))
    # Ô không dùng tới (kịch bản tắt / chế độ khác) thì bỏ đi để không lưu chuỗi tùy ý vào config_snapshot
    group_list = data["enabled_join_groups"] and data["group_source"] == "list"
    friend_list = data["enabled_add_friends"] and data["friend_source"] == "list"
    data["group_keyword"] = (data.get("group_keyword") or "").strip() \
        if data["enabled_join_groups"] and not group_list else ""
    data["group_links"] = (data.get("group_links") or "").strip() if group_list else ""
    data["friend_links"] = (data.get("friend_links") or "").strip() if friend_list else ""
    if friend_list:
        data["friends_fallback_group_members"] = False
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


# ─────────────────────── DANH SÁCH LINK ────────────────────────────

FB_LINK_HOSTS = {"facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com",
                 "mbasic.facebook.com", "fb.com", "www.fb.com"}
LINK_MAX_LEN = 500
_RESERVED_GROUP_PATHS = {"joins", "discover", "feed", "create", "search", "notifications"}
# Đường dẫn 1 đoạn không phải trang cá nhân (khớp NOT_PROFILE trong farming/flow.py)
_NOT_PROFILE_PATHS = {"friends", "groups", "watch", "marketplace", "gaming", "reel", "reels", "photo", "photos",
                      "events", "pages", "search", "notifications", "messages", "bookmarks", "stories", "hashtag",
                      "profile.php", "home.php", "login", "share", "people", "permalink.php", "story.php"}
_USERNAME_RE = re.compile(r"^[A-Za-z0-9.]{5,}$")
_NUMERIC_RE = re.compile(r"^\d+$")


def parse_fb_link(raw: str) -> Optional[Dict]:
    """
    Nhận diện 1 link Facebook: {"kind": "group" | "friend", "key": id chuẩn để so trùng, "url": link mở}.
    key nhóm "group:<id|tên>"; người "id:<số>" hoặc "user:<username>"; link chia sẻ /share/... "share:<đường dẫn>"
    (chưa biết đích, mở ra mới biết). Không phải link Facebook / không nhận ra thì trả None.
    """
    text = (raw or "").strip()
    if not text or len(text) > LINK_MAX_LEN or any(c.isspace() for c in text):
        return None
    if not re.match(r"^[a-z][a-z0-9+.-]*://", text, re.I):
        text = "https://" + text
    try:
        parsed = urlparse(text)
    except ValueError:
        return None
    if parsed.scheme.lower() not in ("http", "https") or (parsed.hostname or "").lower() not in FB_LINK_HOSTS:
        return None
    parts = [p for p in parsed.path.split("/") if p]
    query = parse_qs(parsed.query)
    first = parts[0].lower() if parts else ""

    if first == "share" and len(parts) >= 2:
        # /share/g/<mã> = nhóm; /share/p|r|v/<mã> = bài / reel / video (không nhận); /share/<mã> = trang cá nhân
        if len(parts) >= 3 and parts[1] == "g":
            kind = "group"
        elif len(parts) == 2:
            kind = "friend"
        else:
            return None
        path = "/" + "/".join(parts) + "/"
        return {"kind": kind, "key": f"share:{path}", "url": f"https://www.facebook.com{path}"}

    if first == "groups" and len(parts) >= 2:
        if len(parts) >= 4 and parts[2] == "user" and _NUMERIC_RE.match(parts[3]):
            return _person(parts[3])
        gid = parts[1]
        if gid.lower() in _RESERVED_GROUP_PATHS:
            return None
        return {"kind": "group", "key": f"group:{gid.lower()}", "url": f"https://www.facebook.com/groups/{gid}/"}

    profile_id = (query.get("profile_id") or [""])[0]
    if _NUMERIC_RE.match(profile_id):
        return _person(profile_id)
    if first == "profile.php":
        pid = (query.get("id") or [""])[0]
        return _person(pid) if _NUMERIC_RE.match(pid) else None
    if first == "people" and len(parts) >= 3 and _NUMERIC_RE.match(parts[2]):
        return _person(parts[2])
    if len(parts) == 1 and _USERNAME_RE.match(parts[0]) and first not in _NOT_PROFILE_PATHS:
        if _NUMERIC_RE.match(parts[0]):
            return _person(parts[0])
        return {"kind": "friend", "key": f"user:{first}", "url": f"https://www.facebook.com/{parts[0]}"}
    return None


def _person(pid: str) -> Dict:
    return {"kind": "friend", "key": f"id:{pid}", "url": f"https://www.facebook.com/profile.php?id={pid}"}


def parse_link_list(raw: str, kind: str) -> Dict:
    """
    Tách ô dán link (mỗi dòng 1 link) cho kind "group" / "friend".
    Trả {"items": [{"key", "url", "source": dòng gốc}], "errors": [(số dòng, lý do)], "duplicates": số dòng trùng}.
    Dòng trống bỏ qua; link trùng (cùng key) chỉ giữ dòng đầu.
    """
    items, errors, seen, duplicates = [], [], set(), 0
    label = "nhóm" if kind == "group" else "trang cá nhân"
    for number, line in enumerate((raw or "").splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        link = parse_fb_link(line)
        if link is None:
            errors.append((number, f"không phải link {label} Facebook hợp lệ"))
        elif link["kind"] != kind:
            other = "trang cá nhân" if link["kind"] == "friend" else "nhóm"
            errors.append((number, f"là link {other}, ô này chỉ nhận link {label}"))
        elif link["key"] in seen:
            duplicates += 1
        else:
            seen.add(link["key"])
            items.append({"key": link["key"], "url": link["url"], "source": line[:LINK_MAX_LEN]})
    return {"items": items, "errors": errors, "duplicates": duplicates}


def _link_list_error(raw: str, kind: str) -> Optional[str]:
    """Lỗi của ô danh sách link (dòng sai / không có link hợp lệ) để trả 400; None = hợp lệ."""
    title = "Danh sách nhóm" if kind == "group" else "Danh sách kết bạn"
    parsed = parse_link_list(raw, kind)
    if parsed["errors"]:
        shown = "; ".join(f"dòng {n}: {reason}" for n, reason in parsed["errors"][:LINK_ERRORS_IN_MESSAGE])
        more = len(parsed["errors"]) - LINK_ERRORS_IN_MESSAGE
        return f"{title} có link sai ({shown}{f'; và {more} dòng khác' if more > 0 else ''})."
    if not parsed["items"]:
        return f"{title} đang trống. Vui lòng dán ít nhất 1 link."
    return None


def _link_keys(target: Dict) -> set:
    """Các key của 1 mục targets đã lưu (link gốc đã dán + link đọc được trên trang)."""
    keys = set()
    for field in ("source_url", "url"):
        link = parse_fb_link(target.get(field) or "") if isinstance(target, dict) else None
        if link:
            keys.add(link["key"])
    return keys


def _group_history_skips(uid: str) -> Dict[str, str]:
    """
    Nhóm nick không cần tham gia lại theo lịch sử tool (mọi máy): key -> lý do.
    Xét trạng thái CUỐI của từng nhóm: đã vào / chờ duyệt -> bỏ qua; đã rời bằng tính năng Rời nhóm -> bỏ qua
    tới đủ REJOIN_AFTER_DAYS ngày. Nhóm rời bằng tay tool không biết, vẫn bỏ qua.
    """
    try:
        rows = repository.group_target_history(uid)
    except Exception as e:
        raise RuntimeError("Không đọc được lịch sử nhóm của nick (lỗi CSDL), bỏ qua để không vào lại nhóm cũ") from e
    latest: Dict[str, tuple] = {}
    for row in rows:
        try:
            targets = json.loads(row.get("targets") or "[]")
        except (TypeError, ValueError):
            continue
        for target in targets if isinstance(targets, list) else []:
            if not isinstance(target, dict):
                continue
            if row["action_type"] == "LEAVE_GROUP":
                state = "left" if target.get("result") == "left" else None
            else:
                # Chế độ từ khóa không có "result": bấm Tham gia xong là đã vào / chờ duyệt (status có thể trống)
                result = target.get("result")
                state = "in" if result in (None, "joined", "pending", "skipped_done") else None
            if state:
                for key in _link_keys(target):
                    latest[key] = (state, repository.as_datetime(row["created_at"]))
    rejoin_before = repository.utc_now() - timedelta(days=REJOIN_AFTER_DAYS)
    skips = {}
    for key, (state, at) in latest.items():
        if state == "in":
            skips[key] = "đã vào / đang chờ duyệt (theo lịch sử tool)"
        elif at and at > rejoin_before:
            skips[key] = f"vừa rời nhóm chưa đủ {REJOIN_AFTER_DAYS} ngày (theo lịch sử tool)"
    return skips


# ─────────────────────── CHIA ĐÍCH CHO CÁC NICK ────────────────────────────
# Mỗi nhóm / người chỉ thuộc 1 nick trong dàn (bảng farm_target_owners): nick giành được trước là chủ, giữ mãi
# (rời nhóm vẫn là chủ, chủ được vào lại theo REJOIN_AFTER_DAYS). Dàn = nick cùng owner trên mọi máy; nick local
# (không owner) tính theo máy. Bỏ tick chia: vẫn ghi chủ cho đích chưa có chủ nhưng không chặn nick nào.

TARGET_KEY_MAX_LEN = 255


def _owner_scope(owner: Optional[str], machine_id: Optional[str]) -> str:
    return f"owner:{owner}" if owner else f"machine:{machine_id}"


def split_links(items: List[Dict], uids: List[str], owners: Dict[str, str]) -> tuple:
    """
    Chia danh sách link cho các nick, mỗi link đúng 1 nick. Link đã có chủ là nick đang chạy thì về nick đó,
    chủ là nick khác (không chạy lượt này) thì bỏ; link chưa có chủ chia vòng theo thứ tự xáo để các nick đều nhau.
    Trả ({uid: [link] đã xáo}, số link bỏ vì thuộc nick khác).
    """
    assigned = {uid: [] for uid in uids}
    free, dropped = [], 0
    for item in items:
        owner = owners.get(item["key"])
        if owner is None:
            free.append(item)
        elif owner in assigned:
            assigned[owner].append(item)
        else:
            dropped += 1
    random.shuffle(free)
    order = random.sample(uids, len(uids))
    for index, item in enumerate(free):
        assigned[order[index % len(order)]].append(item)
    for links in assigned.values():
        random.shuffle(links)
    return assigned, dropped


def split_keywords(keywords: List[str], uids: List[str]) -> Dict[str, List[str]]:
    """Chia từ khóa nhóm cho các nick, không trùng; ít từ khóa hơn số nick thì mỗi nick 1 từ khóa (có nick dùng chung)."""
    if not keywords:
        return {uid: [] for uid in uids}
    words = random.sample(keywords, len(keywords))
    order = random.sample(uids, len(uids))
    if len(words) >= len(order):
        return {uid: words[index::len(order)] for index, uid in enumerate(order)}
    return {uid: [words[index % len(words)]] for index, uid in enumerate(order)}


class TargetOwners:
    """
    Chủ của nhóm / người cho 1 nick trong 1 kịch bản. Flow gọi claim trước khi bấm Tham gia / Thêm bạn bè,
    settle khi đã bấm xong, release khi không bấm được, record khi nick đã có sẵn (đã là thành viên / bạn bè).
    enforce=False (bỏ tick chia): vẫn ghi chủ cho đích chưa có chủ nhưng không bao giờ chặn.
    """

    def __init__(self, scope: str, uid: str, kind: str, enforce: bool):
        self.scope, self.uid, self.kind, self.enforce = scope, str(uid), kind, enforce

    @staticmethod
    def keys(*urls) -> List[str]:
        """Key chuẩn của các link (link dán, link trang đang mở, ID số / tên rút gọn của nhóm), không trùng."""
        out = []
        for url in urls:
            link = parse_fb_link(url or "")
            if link and len(link["key"]) <= TARGET_KEY_MAX_LEN and link["key"] not in out:
                out.append(link["key"])
        return out

    def claim(self, keys: List[str], name: Optional[str] = None, url: Optional[str] = None) -> Optional[str]:
        """None = được bấm; chuỗi = uid nick khác đang là chủ. Lỗi CSDL khi đang chia thì ném lỗi (không đoán)."""
        try:
            other = repository.claim_target(self.scope, self.uid, self.kind, keys, "claimed", name, url,
                                            exclusive=self.enforce)
        except Exception as e:
            if self.enforce:
                raise RuntimeError(f"Không ghi được nick nhận {'nhóm' if self.kind == 'group' else 'người'} này "
                                   "(lỗi CSDL), dừng để không trùng nick khác") from e
            logger.warning(f"[{self.uid}] Không ghi được chủ {keys}: {e}")
            return None
        return other if self.enforce else None

    def settle(self, keys: List[str], status: str, name: Optional[str] = None, url: Optional[str] = None):
        try:
            repository.settle_targets(self.scope, self.uid, keys, status, name, url)
        except Exception as e:
            logger.warning(f"[{self.uid}] Không cập nhật được trạng thái chủ {keys}: {e}")

    def release(self, keys: List[str]):
        try:
            repository.release_targets(self.scope, self.uid, keys)
        except Exception as e:
            logger.warning(f"[{self.uid}] Không trả lại được {keys}: {e}")

    def record(self, keys: List[str], status: str, name: Optional[str] = None, url: Optional[str] = None):
        """Đích nick đã có sẵn: chưa có chủ thì nick là chủ; nick đang là chủ thì cập nhật trạng thái. Không chặn."""
        try:
            repository.claim_target(self.scope, self.uid, self.kind, keys, status, name, url, exclusive=False)
            repository.settle_targets(self.scope, self.uid, keys, status, name, url)
        except Exception as e:
            logger.warning(f"[{self.uid}] Không ghi được chủ {keys}: {e}")


def _assign_targets(cfg: "FarmScenarioConfig", uids: List[str], scope: str) -> tuple:
    """
    Chia link / từ khóa cho các nick lúc Kích hoạt (chỉ phần đang bật chia). Trả ({uid: phần của nick}, dòng log).
    Không đọc được chủ (lỗi CSDL) thì ném lỗi: chia sai còn tệ hơn không chạy.
    """
    assigned: Dict[str, Dict] = {uid: {} for uid in uids}
    notes = []
    for enabled, split, source, raw, kind, field, unit in (
        (cfg.enabled_join_groups, cfg.groups_split_enabled, cfg.group_source, cfg.group_links, "group", "group_links", "nhóm"),
        (cfg.enabled_add_friends, cfg.friends_split_enabled, cfg.friend_source, cfg.friend_links, "friend", "friend_links",
         "kết bạn"),
    ):
        if not (enabled and split and source == "list"):
            continue
        items = parse_link_list(raw, kind)["items"]
        parts, dropped = split_links(items, uids, repository.target_owners(scope, [i["key"] for i in items]))
        for uid, links in parts.items():
            assigned[uid][field] = links
        dropped_text = f", bỏ {dropped} link đã thuộc nick khác trong dàn" if dropped else ""
        notes.append(f"Chia danh sách {unit}: {len(items)} link cho {len(uids)} nick, mỗi link 1 nick{dropped_text}")
    if cfg.enabled_join_groups and cfg.groups_split_enabled and cfg.group_source == "keyword":
        keywords = split_group_keywords(cfg.group_keyword)
        if keywords:
            for uid, words in split_keywords(keywords, uids).items():
                assigned[uid]["group_keywords"] = words
            shared = "" if len(keywords) >= len(uids) else f" ({len(keywords)} từ khóa cho {len(uids)} nick, có nick dùng chung)"
            notes.append(f"Chia từ khóa nhóm cho các nick{shared}; nhóm đã có nick khác trong dàn vào thì bỏ qua")
        else:
            notes.append("Nhóm đề xuất: nhóm đã có nick khác trong dàn vào thì bỏ qua")
    return assigned, notes


# Kết quả 1 link coi như đã xong (xóa khỏi ô dán): đã vào / chờ duyệt / đã gửi lời mời / đã có sẵn từ trước
LIST_DONE_RESULTS = {"joined", "pending", "sent", SKIP_DONE}
# (hành động, ô link, ô từ khóa) để tính phần còn lại; kết bạn theo gợi ý không có ô nhập
LEFTOVER_FIELDS = (("JOIN_GROUP", "group_links", "group_keyword"), ("ADD_FRIEND", "friend_links", None))


def leftover_inputs(cfg: "FarmScenarioConfig", uids: List[str], assigned: Dict[str, Dict],
                    actions: Dict[str, List[Dict]]) -> Dict[str, Optional[str]]:
    """
    Ô link / từ khóa còn lại sau 1 lượt để giao diện thay vào ô nhập; None = giữ nguyên ô đó.
    Mọi nick chạy kịch bản thành công: xóa trống. Có nick không thành công: bật chia thì chỉ giữ link chưa xong
    + từ khóa đã chia cho nick đó, tắt chia thì giữ nguyên. actions: uid -> kết quả từng hành động của nick.
    """
    out = {"group_links": None, "group_keyword": None, "friend_links": None}
    for action, links_field, keyword_field in LEFTOVER_FIELDS:
        enabled, split, source = {
            "JOIN_GROUP": (cfg.enabled_join_groups, cfg.groups_split_enabled, cfg.group_source),
            "ADD_FRIEND": (cfg.enabled_add_friends, cfg.friends_split_enabled, cfg.friend_source),
        }[action]
        listed = source == "list"
        field = links_field if listed else keyword_field
        raw = getattr(cfg, field) if enabled and field else ""
        if not raw.strip():
            continue
        assigned_key = field if listed else "group_keywords"
        results = {uid: next((r for r in reversed(actions.get(uid) or []) if r.get("action") == action), None)
                   for uid in uids}

        def ok(uid):
            result = results[uid]
            if result is None:
                return False
            # Bật chia mà nick không được chia link / từ khóa nào: không có gì để chạy, không tính là lỗi
            return result.get("status") == "SUCCESS" or (
                result.get("status") == "SKIPPED" and split and not (assigned.get(uid) or {}).get(assigned_key))

        failed = [uid for uid in uids if not ok(uid)]
        if not failed:
            out[field] = ""
        elif not split:
            continue
        elif listed:
            done = set()
            for result in results.values():
                for target in (result or {}).get("targets") or []:
                    link = parse_fb_link(target.get("source_url") or "") if isinstance(target, dict) \
                        and target.get("result") in LIST_DONE_RESULTS else None
                    if link:
                        done.add(link["key"])
            out[field] = "\n".join(line.strip() for line in raw.splitlines()
                                   if line.strip() and (parse_fb_link(line.strip()) or {}).get("key") not in done)
        else:
            keep = {w for uid in failed for w in (assigned.get(uid) or {}).get("group_keywords") or []}
            out[field] = ", ".join(w for w in split_group_keywords(raw) if w in keep)
    return out


def _owner_backfill_entries(rows: List[Dict]) -> List[Dict]:
    """Chủ suy ra từ log cũ (bảng farm_target_owners mới tạo), theo đúng quy tắc khi chạy."""
    entries = []
    for row in rows:
        try:
            targets = json.loads(row.get("targets") or "[]")
        except (TypeError, ValueError):
            continue
        scope = _owner_scope(row.get("owner_username"), row.get("machine_id"))
        for target in targets if isinstance(targets, list) else []:
            if not isinstance(target, dict):
                continue
            result = target.get("result")
            if row["action_type"] == "LEAVE_GROUP":
                if result != "left":
                    continue
                kind, status = "group", "left"
            elif row["action_type"] == "JOIN_GROUP":
                # skipped_done "vừa rời nhóm" là nhóm nick đã rời, không phải đang ở trong
                if result not in (None, "joined", "pending", "skipped_done") or "vừa rời" in (target.get("reason") or ""):
                    continue
                kind = "group"
                status = "member" if result == "skipped_done" else (result or target.get("status") or "joined")
            else:
                # Kết bạn theo gợi ý / thành viên nhóm không chia, chỉ chế độ danh sách (có source_url)
                if not target.get("source_url") or result not in ("sent", "skipped_done"):
                    continue
                kind, status = "friend", "sent" if result == "sent" else "friends"
            keys = [k for k in _link_keys(target) if len(k) <= TARGET_KEY_MAX_LEN]
            if keys:
                entries.append({"scope": scope, "uid": row["fb_uid"], "kind": kind, "keys": keys, "status": status,
                                "name": (target.get("name") or None), "url": target.get("url") or None})
    return entries


def _nick_gone(accounts: Dict[str, str], uid: str) -> bool:
    """Nick đã xóa khỏi Module 02 hoặc DIE: không còn giữ nhóm / người. CHECKPOINT vẫn giữ (có thể gỡ được)."""
    return accounts.get(str(uid)) in (None, "DIE")


def _scope_owner(scope: str) -> Optional[str]:
    """Owner của dàn: "owner:<tên>" -> tên; "machine:<id>" (nick local) -> None."""
    kind, _, value = scope.partition(":")
    return value if kind == "owner" else None


def _release_gone_owners(scope: str, accounts: Optional[Dict[str, str]]) -> List[tuple]:
    """
    Lúc Kích hoạt: xóa chủ của nick đã die / đã xóa trong dàn để nhóm / người đó chia lại được cho nick khác.
    accounts: nick của owner trong Module 02 (None = đọc lỗi). Đọc lỗi hoặc owner không có nick nào (thường do
    nối nhầm CSDL) thì không xóa gì. Trả các dòng log (level, nội dung).
    """
    if accounts is None:
        return [("warning", "Không đọc được danh sách nick trong dàn: chưa trả nhóm / người của nick đã die hoặc đã xóa")]
    if not accounts:
        return []
    try:
        holders = repository.owner_holders(scope)
        gone = sorted(uid for uid in holders if _nick_gone(accounts, uid))
        removed = repository.delete_owner_rows(scope, gone) if gone else 0
    except Exception as e:
        logger.warning(f"Không trả được nhóm / người của nick đã die hoặc đã xóa: {e}")
        return [("warning", "Lỗi CSDL khi trả nhóm / người của nick đã die hoặc đã xóa, bỏ qua bước này")]
    if not removed:
        return []
    return [("info", f"Trả {removed} nhóm / người của nick đã die hoặc đã xóa: {', '.join(gone)}")]


def _backfill_target_owners() -> int:
    """
    Bảng chủ còn trống (vừa tạo) thì chép chủ từ log cũ để nhóm / người đã vào trước đây vẫn có chủ.
    Bỏ nick đã die / đã xóa (cùng quy tắc lúc Kích hoạt). Không đọc được Module 02 thì ném lỗi: bảng vẫn trống,
    lần khởi động sau chép lại.
    """
    if repository.has_target_owners():
        return 0
    entries = _owner_backfill_entries(repository.owner_backfill_logs())
    accounts_by_scope = {scope: adapters.list_owner_accounts(_scope_owner(scope))
                         for scope in {e["scope"] for e in entries}}
    entries = [e for e in entries if not _nick_gone(accounts_by_scope[e["scope"]], e["uid"])]
    return repository.apply_owner_backfill(entries) if entries else 0


def _build_plan(cfg: FarmScenarioConfig, assigned: Optional[Dict] = None) -> List[tuple]:
    """
    Sinh kế hoạch riêng cho từng nick (random độc lập trong khoảng Min–Max).
    Check thông báo luôn chạy đầu tiên; các kịch bản còn lại xáo thứ tự ngẫu nhiên.
    Chế độ danh sách link: mỗi nick đi danh sách theo thứ tự xáo riêng, số lượng = giới hạn mỗi phiên.
    assigned: phần đã chia cho nick lúc Kích hoạt (bật chia); không có thì nick dùng cả danh sách / mọi từ khóa.
    """
    assigned = assigned or {}
    steps = []
    if cfg.enabled_newsfeed:
        steps.append(("NEWSFEED", {
            "total_seconds": random.uniform(cfg.newsfeed_time_min, cfg.newsfeed_time_max) * 60,
            "delay": (cfg.newsfeed_delay_min, cfg.newsfeed_delay_max),
            "react": list(cfg.newsfeed_react_types) if cfg.newsfeed_react_enabled else None,
        }))
    if cfg.enabled_watch:
        steps.append(("WATCH", {
            "total_seconds": random.uniform(cfg.watch_time_min, cfg.watch_time_max) * 60,
            "delay": (cfg.watch_delay_min, cfg.watch_delay_max),
            "react": list(cfg.watch_react_types) if cfg.watch_react_enabled else None,
        }))
    if cfg.enabled_story:
        steps.append(("STORY", {
            "target": random.randint(cfg.story_min, cfg.story_max),
            "delay": (cfg.story_delay_min, cfg.story_delay_max),
            "react": list(cfg.story_react_types) if cfg.story_react_enabled else None,
        }))
    if cfg.enabled_add_friends and cfg.friend_source == "list":
        links = assigned.get("friend_links")
        if links is None:
            links = parse_link_list(cfg.friend_links, "friend")["items"]
            links = random.sample(links, len(links))
        steps.append(("ADD_FRIEND", {"target": cfg.friend_list_limit, "links": list(links)}))
    elif cfg.enabled_add_friends:
        steps.append(("ADD_FRIEND", {"target": random.randint(cfg.friends_min, cfg.friends_max)}))
    if cfg.enabled_join_groups and cfg.group_source == "list":
        links = assigned.get("group_links")
        if links is None:
            links = parse_link_list(cfg.group_links, "group")["items"]
            links = random.sample(links, len(links))
        steps.append(("JOIN_GROUP", {"target": cfg.group_list_limit, "links": list(links)}))
    elif cfg.enabled_join_groups:
        keywords = assigned.get("group_keywords")
        if keywords is None:
            # Mỗi nick dùng từ khóa theo thứ tự riêng để các nick không cùng vào một danh sách nhóm
            keywords = split_group_keywords(cfg.group_keyword)
            keywords = random.sample(keywords, len(keywords))
        steps.append(("JOIN_GROUP", {
            "target": random.randint(cfg.groups_min, cfg.groups_max),
            "keywords": list(keywords),
        }))
    if cfg.enabled_leave_groups:
        low, high = LEAVE_RECENT_DAYS if cfg.leave_criteria == "recent" else LEAVE_STALE_DAYS
        steps.append(("LEAVE_GROUP", {
            "target": random.randint(cfg.leave_min, cfg.leave_max),
            "criteria": cfg.leave_criteria,
            "days": random.randint(low, high),
            "keep_admin": cfg.leave_keep_admin,
            "delay": (cfg.leave_delay_min, cfg.leave_delay_max),
        }))
    random.shuffle(steps)
    # Rời nhóm luôn chạy trước Tham gia nhóm (không rời nhóm vừa vào trong cùng phiên)
    names = [a for a, _ in steps]
    if "LEAVE_GROUP" in names and "JOIN_GROUP" in names and names.index("LEAVE_GROUP") > names.index("JOIN_GROUP"):
        steps.insert(names.index("JOIN_GROUP"), steps.pop(names.index("LEAVE_GROUP")))
    if cfg.enabled_check_notif:
        steps.insert(0, ("CHECK_NOTIF", {}))
    return steps


def _recent_joined_groups(uid: str, days: int, current_run_id: Optional[int]) -> Dict[str, float]:
    """
    Nhóm tool đã vào HẲN (không tính chờ duyệt) trong `days` ngày qua ở các phiên trước, chưa rời sau đó:
    key -> số ngày kể từ lúc vào. Không đọc được lịch sử thì ném lỗi (kịch bản Rời nhóm báo lỗi, không đoán).
    """
    try:
        rows = repository.group_target_history(uid)
    except Exception as e:
        raise RuntimeError("Không đọc được lịch sử nhóm của nick (lỗi CSDL)") from e
    now = repository.utc_now()
    joined: Dict[str, float] = {}
    for row in rows:
        if current_run_id and row.get("run_id") == current_run_id:
            continue
        try:
            targets = json.loads(row.get("targets") or "[]")
        except (TypeError, ValueError):
            continue
        at = repository.as_datetime(row["created_at"])
        for target in targets if isinstance(targets, list) else []:
            if not isinstance(target, dict):
                continue
            keys = _link_keys(target)
            if row["action_type"] == "LEAVE_GROUP":
                if target.get("result") == "left":
                    for key in keys:
                        joined.pop(key, None)
            elif (target.get("result") or target.get("status")) == "joined" and at:
                for key in keys:
                    joined[key] = (now - at).total_seconds() / 86400
    return {key: age for key, age in joined.items() if age <= days}


def _uid_has_other_browser(uid: str, owner: Optional[str]) -> bool:
    """Nick có trình duyệt khác đang mở thật không (cửa sổ đã bị đóng tay thì gỡ khỏi danh sách)."""
    from core.browser import get_active_drivers, unregister_active_driver
    alive = False
    for d in get_active_drivers(uid, owner):
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
        raise RuntimeError("Không kiểm tra được giới hạn ngày (lỗi CSDL), bỏ qua để không vượt giới hạn") from e
    return max(0, min(target, limit - done_today)), done_today, limit


def _action_label(action: str, params: dict) -> str:
    if "links" in params:
        return {"ADD_FRIEND": "Kết bạn theo danh sách", "JOIN_GROUP": "Tham gia nhóm theo danh sách"}[action]
    return ACTION_LABELS[action]


# Phần đã làm của hành động bị dừng / lỗi giữa chừng: (câu khi có, câu khi chưa làm được gì, đơn vị cho "và N ... khác")
PARTIAL_DONE_TEXTS = {
    "JOIN_GROUP": ("đã tham gia {n} nhóm", "chưa tham gia được nhóm nào", "nhóm"),
    "ADD_FRIEND": ("đã gửi {n} lời mời", "chưa gửi được lời mời nào", "người"),
    "LEAVE_GROUP": ("đã rời {n} nhóm", "chưa rời được nhóm nào", "nhóm"),
    "WATCH": ("đã xem {n} video", "chưa xem xong video nào", None),
    "STORY": ("đã xem {n} story", "chưa xem được story nào", None),
}
PARTIAL_NAMES_SHOWN = 5


def _partial_done(action: str, quantity: int, partial: dict) -> str:
    """Câu "đã làm được gì" của hành động bị dừng / lỗi giữa chừng, cho log và lịch sử; "" = không có gì để nói."""
    if action == "NEWSFEED":
        seconds = partial.get("seconds") or 0
        if not seconds:
            return "chưa lướt được"
        text = f"đã lướt {seconds / 60:.1f} phút, cuộn {partial.get('scrolls') or 0} lần"
    elif action in PARTIAL_DONE_TEXTS:
        done_text, none_text, unit = PARTIAL_DONE_TEXTS[action]
        if not quantity:
            return none_text
        text = done_text.format(n=quantity)
        names = [t.get("name") or t.get("url") for t in partial.get("targets") or []
                 if isinstance(t, dict) and (t.get("name") or t.get("url"))
                 and not str(t.get("result") or "").startswith("skipped_")]
        if names:
            text += ": " + ", ".join(names[:PARTIAL_NAMES_SHOWN])
            if len(names) > PARTIAL_NAMES_SHOWN:
                text += f" và {len(names) - PARTIAL_NAMES_SHOWN} {unit} khác"
    else:
        return ""
    if partial.get("reactions"):
        text += f", thả {partial['reactions']} cảm xúc"
    return text


def _action_source(action: str, params: dict) -> Optional[str]:
    """Nguồn của kết bạn / tham gia nhóm để ghi friends_source / groups_source."""
    if action == "ADD_FRIEND":
        return "list" if "links" in params else "suggestions"
    if action == "JOIN_GROUP":
        return "list" if "links" in params else ("keyword" if params.get("keywords") else "suggested")
    return None


def _target_owners(uid: str, kind: str, enforce: bool) -> Optional[TargetOwners]:
    """Đối tượng ghi chủ cho nick trong phiên hiện tại (None khi chưa có scope, vd gọi ngoài /start)."""
    with _state_lock:
        scope = _state.get("owner_scope")
    return TargetOwners(scope, uid, kind, enforce) if scope else None


def _settle_left(owners: Optional[TargetOwners], targets) -> None:
    """Nhóm vừa rời: nick vẫn là chủ, chỉ đổi trạng thái (không trả nhóm cho nick khác)."""
    for target in (targets or []) if owners else []:
        if isinstance(target, dict) and target.get("result") == "left":
            owners.settle(sorted(_link_keys(target)), "left")


def _run_action(driver, ctl: FarmControl, uid: str, action: str, params: dict,
                cfg: FarmScenarioConfig, report, progress=None, log=None) -> dict:
    if action == "CHECK_NOTIF":
        return run_check_notifications(driver, ctl, report)
    if action == "NEWSFEED":
        return run_newsfeed(driver, ctl, params["total_seconds"], *params["delay"], report, react=params.get("react"),
                            log=log)
    if action == "WATCH":
        return run_watch(driver, ctl, params["total_seconds"], *params["delay"], report, react=params.get("react"), log=log)
    if action == "STORY":
        return run_story(driver, ctl, params["target"], *params["delay"], report, react=params.get("react"))
    if action == "LEAVE_GROUP":
        recent = None
        if params["criteria"] == "recent":
            with _state_lock:
                run_id = _state["accounts"].get(uid, {}).get("run_id")
            recent = _recent_joined_groups(uid, params["days"], run_id)
        owners = _target_owners(uid, "group", False)
        try:
            result = run_leave_groups(driver, ctl, params["target"], params["criteria"], params["days"],
                                      params["keep_admin"], report, progress, delay=params["delay"], recent=recent,
                                      log=log)
        except Exception as e:
            _settle_left(owners, (getattr(e, "partial", None) or {}).get("targets"))
            raise
        _settle_left(owners, result.get("targets"))
        return result

    target, done_today, limit = _apply_daily_limit(uid, action, params["target"], cfg)
    if target <= 0:
        return {"status": "SKIPPED", "quantity": 0,
                "details": f"Đã đạt giới hạn ngày ({done_today}/{limit})"}
    with _state_lock:
        own_uids = _own_uids
    if action == "ADD_FRIEND" and own_uids is None:
        return {"status": "FAILED", "quantity": 0,
                "details": "Không đọc được danh sách nick trong dàn (lỗi CSDL), không kết bạn để tránh mời trúng nick nhà"}
    if "links" in params:
        if not params["links"]:
            return {"status": "SKIPPED", "quantity": 0,
                    "details": "Không có link nào được chia cho nick này (danh sách ít link hơn số nick "
                               "hoặc link đã thuộc nick khác trong dàn)"}
        if action == "ADD_FRIEND":
            return run_add_friends_from_links(driver, ctl, params["links"], target, report, progress,
                                              delay=(cfg.friends_delay_min, cfg.friends_delay_max), log=log,
                                              owners=_target_owners(uid, "friend", cfg.friends_split_enabled),
                                              own_uids=own_uids)
        return run_join_groups_from_links(driver, ctl, params["links"], target, report, progress,
                                          delay=(cfg.groups_delay_min, cfg.groups_delay_max),
                                          skips=_group_history_skips(uid), log=log,
                                          owners=_target_owners(uid, "group", cfg.groups_split_enabled))
    if action == "ADD_FRIEND":
        delay = (cfg.friends_delay_min, cfg.friends_delay_max)
        result = run_add_friends(driver, ctl, target, report, progress, delay=delay, own_uids=own_uids)
        result["source"] = "suggestions"
        if result.get("no_suggestions") and cfg.friends_fallback_group_members:
            report("Không có gợi ý kết bạn, chuyển sang thành viên nhóm đã tham gia")
            fallback = run_add_friends_from_groups(driver, ctl, target, report, progress, delay=delay,
                                                   own_uids=own_uids)
            fallback["details"] = f"Không có gợi ý → {fallback['details']}"
            fallback["source"] = "group_members"
            return fallback
        return result
    return run_join_groups(driver, ctl, target, params.get("keywords"), report, progress,
                           delay=(cfg.groups_delay_min, cfg.groups_delay_max),
                           owners=_target_owners(uid, "group", cfg.groups_split_enabled))


def _record_action(uid: str, action: str, result: dict, owner: Optional[str]):
    """Ghi 1 hành động vào farm_interaction_logs (qua hàng đợi) và giữ lại để tổng hợp dòng lịch sử."""
    with _state_lock:
        run_id = _state["accounts"].get(uid, {}).get("run_id")
        _history_data.setdefault(uid, {}).setdefault("actions", []).append({"action": action, **result})
    repository.add_log(run_id, adapters.get_machine_id(), uid, action, result["status"],
                       result.get("quantity", 0), result.get("details", ""), owner_username=owner,
                       targets=result.get("targets"))


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


def _save_session_cookie(uid: str, owner: Optional[str], driver):
    """Chrome của nick bị đóng để mở lại: lưu cookie còn sống trước khi đóng."""
    from core.browser import extract_cookies_as_string

    cookies = extract_cookies_as_string(driver)
    if cookies and "c_user=" in cookies:
        adapters.save_cookie(uid, cookies, owner=owner)
        adapters.set_login_status(uid, "logged_in", owner=owner)


def _farm_worker(uid: str, slot: int, cfg: FarmScenarioConfig, owner: Optional[str]):
    """Chạy toàn bộ kịch bản đã tick cho 1 nick trên cùng 1 tab Chrome."""
    # owner = người đã bấm Kích hoạt: mọi lệnh đọc / ghi tài khoản trong luồng này (kể cả login_flow) dùng owner đó
    with adapters.owner_scope(owner):
        _run_farm_worker(uid, slot, cfg, owner)


# Selenium thử lại lệnh đọc 4 lần, mỗi lần chờ 120s: kiểm tra Chrome còn sống mất tới 8 phút nếu giữ thời gian chờ mặc định
BROWSER_PROBE_TIMEOUT = 10


def _browser_responds(driver) -> bool:
    """Chrome / chromedriver còn trả lời trong thời gian ngắn (tối đa ~40s khi treo)."""
    config = driver.command_executor.client_config
    original = config.timeout
    config.timeout = BROWSER_PROBE_TIMEOUT
    try:
        _ = driver.title
        return True
    except Exception:
        return False
    finally:
        config.timeout = original


def _run_farm_worker(uid: str, slot: int, cfg: FarmScenarioConfig, owner: Optional[str]):
    from core.browser import extract_cookies_as_string, force_kill_driver, get_profile_lock, open_browser
    from modules.module_03_acc_farm.browser.login_flow import ensure_logged_in, is_checkpoint_url

    ctl = _control
    _hist(uid, started_at=repository.utc_now())
    try:
        ctl.checkpoint()
    except FarmStopped:
        _set_account(uid, status="STOPPED", activity="Đã dừng trước khi đến lượt", error="Dừng bởi người dùng")
        return

    _set_account(uid, status="RUNNING", thread=slot, activity="Đang khởi động trình duyệt", started_at=time.time())

    if _uid_has_other_browser(uid, owner):
        msg = "Nick đang mở trình duyệt ở tiến trình khác, bỏ qua lượt này"
        _emit("error", f"{msg}: {uid}", uid, slot)
        _set_account(uid, status="FAILED", error=msg, activity=msg)
        return

    profile_lock = get_profile_lock(uid, owner)
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
    browser_hung = False
    # Bị chặn kết bạn / tham gia nhóm vẫn tính Hoàn thành: chỉ ghi ở ô hành động và log
    blocked_labels = []
    # Phần đã làm của hành động đang chạy dở lúc bấm Dừng, ghi thêm vào cột Hoạt động hiện tại
    stopped_note = ""

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
        driver = open_browser(uid, owner=owner, proxy=proxy, scope="farm",
                              allow_direct_fallback=False,
                              extra_arguments=FARM_CHROME_ARGUMENTS, extra_init_scripts=[FARM_VISIBILITY_JS],
                              on_before_close=lambda d, _uid=uid, _owner=owner: _save_session_cookie(_uid, _owner, d))
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
            if login.get("browser_error"):
                save_cookie = False
                raise RuntimeError(login.get("error"))
            raise FarmAccountDead(login.get("error") or "Phiên đăng nhập không hợp lệ", checkpoint=login.get("checkpoint"))

        with _state_lock:
            share = dict(_assignments.get(uid) or {})
        plan = _build_plan(cfg, share)
        _emit("info", "Kế hoạch: " + " → ".join(_action_label(a, p) for a, p in plan), uid, slot)
        shared_parts = [f"{len(share[field])} link {unit}" for field, unit in
                        (("group_links", "nhóm"), ("friend_links", "kết bạn")) if field in share]
        if share.get("group_keywords"):
            shared_parts.append("từ khóa " + ", ".join(f"'{k}'" for k in share["group_keywords"]))
        if shared_parts:
            _emit("info", "Được chia: " + "; ".join(shared_parts), uid, slot)
        _set_account(uid, actions={a: "PENDING" for a, _ in plan})

        for action, params in plan:
            ctl.checkpoint()
            label = _action_label(action, params)
            source = _action_source(action, params)
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

            def log_line(level, text, _uid=uid, _slot=slot, _label=label):
                # Chế độ danh sách: mỗi link 1 dòng log ngay khi xử lý xong
                _emit(level, f"{_label}: {text}", _uid, _slot)

            def partial_of(e, _done=done, _source=source):
                # Newsfeed / Watch gắn phần đã chạy (giây, lần cuộn, video), nhóm gắn từ khóa đã dùng vào lỗi
                # (mọi loại lỗi); số lượng kết bạn / nhóm báo qua progress
                partial = dict(getattr(e, "partial", None) or {})
                if _source:
                    partial.setdefault("source", _source)
                return partial.pop("quantity", _done["quantity"]), partial

            try:
                result = _run_action(driver, ctl, uid, action, params, cfg, report, progress, log_line)
                if source:
                    result.setdefault("source", source)
            except FarmStopped as e:
                quantity, partial = partial_of(e)
                stopped_note = _partial_done(action, quantity, partial)
                details = f"Dừng giữa chừng, {stopped_note}" if stopped_note else "Dừng giữa chừng"
                _record_action(uid, action, {"status": "SKIPPED", "quantity": quantity, "details": details, **partial},
                               owner)
                actions[action] = "SKIPPED"
                _set_account(uid, actions=actions)
                # Kịch bản chạy hết thì có dòng kết quả ở cuối vòng; dừng giữa chừng cũng phải báo phần đã làm được
                _emit("warning", f"{label}: {details}", uid, slot)
                raise
            except FarmAccountDead as e:
                quantity, partial = partial_of(e)
                browser_hung = not e.checkpoint and not _browser_responds(driver)
                details = "Trình duyệt bị đóng hoặc không phản hồi giữa chừng" if browser_hung \
                    else f"Tài khoản chết giữa chừng: {e}"[:300]
                done_note = _partial_done(action, quantity, partial)
                if done_note:
                    details = f"{details} (trước đó {done_note})"
                _record_action(uid, action, {"status": "FAILED", "quantity": quantity, "details": details, **partial}, owner)
                actions[action] = "FAILED"
                _set_account(uid, actions=actions)
                _emit("error", f"{label}: {details}", uid, slot)
                raise
            except Exception as e:
                # Lỗi 1 hoạt động: ghi nhận rồi chạy tiếp (BR-STS-02); trình duyệt chết thì để vòng ngoài xử lý
                quantity, partial = partial_of(e)
                done_note = _partial_done(action, quantity, partial) if quantity or partial.get("seconds") else ""
                tail = f" (trước đó {done_note})" if done_note else ""
                if not _browser_responds(driver):
                    browser_hung = True
                    details = f"Trình duyệt bị đóng hoặc không phản hồi giữa chừng{tail}"
                    _record_action(uid, action, {"status": "FAILED", "quantity": quantity, "details": details, **partial},
                                   owner)
                    actions[action] = "FAILED"
                    _set_account(uid, actions=actions)
                    _emit("error", f"{label}: {details}", uid, slot)
                    raise
                logger.exception(f"[{uid}] Lỗi kịch bản {action}: {e}")
                result = {"status": "FAILED", "quantity": quantity, "details": friendly_error(e, still_open=True) + tail,
                          **partial}

            _record_action(uid, action, result, owner)

            actions[action] = result["status"]
            counters = {counter_field: result.get("quantity", 0)} if counter_field else {}
            _set_account(uid, actions=actions, **counters)

            for notice in pop_notices():
                _emit("warning", notice, uid, slot)
            level = {"SUCCESS": "success", "BLOCKED": "warning", "SKIPPED": "warning"}.get(result["status"], "error")
            _emit(level, f"{label}: {result.get('details', '')}", uid, slot)
            if result["status"] == "BLOCKED":
                blocked_labels.append(label)

    except FarmStopped:
        final_status = "STOPPED"
        error_msg = "Dừng bởi người dùng"
    except ProxyError as e:
        final_status = "FAILED"
        error_msg = friendly_error(e)
        save_cookie = False
    except FarmAccountDead as e:
        save_cookie = False
        # "Mất phiên" đọc được lúc trình duyệt treo / đã đóng không nói lên điều gì về nick: giữ nguyên trạng thái nick
        browser_hung = browser_hung or (not e.checkpoint and not _browser_responds(driver))
        if browser_hung:
            final_status = "FAILED"
            error_msg = BROWSER_HUNG
        else:
            final_status = "DIE"
            error_msg = str(e)
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
        error_msg = friendly_error(e)
        if browser_hung and error_msg not in (BROWSER_HUNG, BROWSER_CLOSED):
            error_msg = BROWSER_HUNG
    finally:
        if driver is not None:
            # Chrome treo: lấy cookie và quit() mỗi lệnh chờ tới 8 phút, quit() lại chỉ tắt chromedriver, Chrome vẫn sống
            # (tái hiện 2026-11-04) -> tắt cả cây tiến trình, quit() sau đó chỉ còn dọn bridge + đăng ký driver.
            browser_hung = browser_hung or not _browser_responds(driver)
            if browser_hung:
                force_kill_driver(driver)
            elif save_cookie:
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

    blocked_note = f" (Facebook chặn: {', '.join(blocked_labels)})" if blocked_labels else ""
    summary = {
        "COMPLETED": ("success", f"Hoàn thành toàn bộ kịch bản{blocked_note}, "
                      + ("đã lưu cookie mới và đóng trình duyệt" if cookie_saved else "đóng trình duyệt (không có cookie mới để lưu)")),
        "STOPPED": ("warning", f"Đã dừng theo yêu cầu, {stopped_note}" if stopped_note else "Đã dừng theo yêu cầu"),
        "DIE": ("error", f"Tài khoản cần xác minh / mất phiên: {error_msg}"),
        "FAILED": ("error", error_msg),
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
    try:
        filled = await asyncio.to_thread(_backfill_target_owners)
        if filled:
            logger.info(f"Đã chép chủ của {filled} nhóm / người từ lịch sử cũ vào bảng chia đích")
    except Exception as e:
        logger.warning(f"Không chép được chủ nhóm / người từ lịch sử cũ: {e}")


async def on_shutdown():
    if _control is not None and _state["running"]:
        _control.stop()
    await asyncio.to_thread(repository.writer.stop)


# ─────────────────────── ENDPOINTS: CHẠY ────────────────────────────

@router.post("/start")
async def start_farm_interactions(req: FarmStartRequest, request: Request):
    global _control, _active_task, _own_uids
    # Nick thuộc người đang đăng nhập (giống Module 02); không đăng nhập thì chỉ nick local
    owner = await asyncio.to_thread(adapters.owner_from_request, request)
    if owner and not adapters.is_license_valid(owner):
        raise HTTPException(status_code=403, detail="Tài khoản của bạn đã hết hạn bản quyền! Vui lòng liên hệ Quản trị viên để gia hạn.")

    with _state_lock:
        if _state["running"]:
            raise HTTPException(status_code=409, detail="Đang có phiên Tương tác tài khoản chạy. Vui lòng dừng hoặc chờ hoàn tất.")

    uids = list(dict.fromkeys(str(u).strip() for u in req.uids if str(u).strip()))
    if not uids:
        raise HTTPException(status_code=400, detail="Vui lòng chọn ít nhất 1 tài khoản để thực thi.")
    cfg = _normalize_config(req.config)
    if not any([cfg.enabled_newsfeed, cfg.enabled_watch, cfg.enabled_story, cfg.enabled_add_friends,
                cfg.enabled_join_groups, cfg.enabled_leave_groups, cfg.enabled_check_notif]):
        raise HTTPException(status_code=400, detail="Kịch bản tương tác đang trống. Vui lòng chọn ít nhất 1 hành động.")
    if len(cfg.group_keyword) > GROUP_KEYWORD_MAX_LEN:
        raise HTTPException(status_code=400,
                            detail=f"Từ khóa tham gia nhóm không được quá {GROUP_KEYWORD_MAX_LEN} ký tự.")
    for enabled, source, raw, kind in ((cfg.enabled_join_groups, cfg.group_source, cfg.group_links, "group"),
                                       (cfg.enabled_add_friends, cfg.friend_source, cfg.friend_links, "friend")):
        error = _link_list_error(raw, kind) if enabled and source == "list" else None
        if error:
            raise HTTPException(status_code=400, detail=error)

    # Chỉ nick Live + Đã đăng nhập mới được chạy (VR-M03-ACC-01)
    eligible, rejected = [], []
    for uid in uids:
        acc = await asyncio.to_thread(adapters.get_account, uid, owner)
        if acc and acc["status"] == "live" and acc["login_status"] == "logged_in":
            eligible.append({"uid": acc["uid"], "name": acc["profile_name"]})
        else:
            rejected.append(uid)
    if not eligible:
        raise HTTPException(status_code=400, detail="Không có tài khoản nào đủ điều kiện (Live + Đã đăng nhập).")

    # Mỗi lần kích hoạt tạo lượt mới, giữ nguyên lịch sử lượt cũ (BR-STS-01)
    session_id = uuid.uuid4().hex
    machine_id = await asyncio.to_thread(adapters.get_machine_id)
    scope = _owner_scope(owner, machine_id)
    # Nick trong dàn (Module 02): trả nhóm / người của nick đã die / đã xóa trước khi chia, kết bạn bỏ qua nick nhà
    try:
        dan_accounts = await asyncio.to_thread(adapters.list_owner_accounts, owner)
    except Exception as e:
        logger.exception(f"Không đọc được danh sách nick trong dàn: {e}")
        dan_accounts = None
    release_notes = await asyncio.to_thread(_release_gone_owners, scope, dan_accounts)
    try:
        assignments, split_notes = await asyncio.to_thread(_assign_targets, cfg, [a["uid"] for a in eligible], scope)
    except Exception as e:
        logger.exception(f"Không chia được link / từ khóa cho các nick: {e}")
        raise HTTPException(status_code=503, detail="Không đọc được nhóm / người đã có nick nhận trong dàn (lỗi CSDL). "
                                                    "Kiểm tra kết nối CSDL rồi thử lại, hoặc bỏ tick chia cho các nick.")
    own_uids: Optional[frozenset] = frozenset()
    if cfg.enabled_add_friends:
        own_uids = frozenset(dan_accounts) if dan_accounts is not None else None
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
        _assignments.clear()
        _assignments.update(assignments)
        _own_uids = own_uids
        _state.update({
            "checkpoint_alerts": history_alerts,
            "running": True,
            "owner_username": owner or "",
            "owner_scope": scope,
            "session_id": session_id,
            "threads": threads,
            "started_at": time.time(),
            "finished_at": 0,
            "leftover": None,
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
    for level, note in release_notes:
        _emit(level, note)
    for note in split_notes:
        _emit("info", note)
    if own_uids is None:
        _emit("warning", "Không đọc được danh sách nick trong dàn (lỗi CSDL): lượt này không kết bạn để tránh mời trúng nick nhà")
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
                _set_account(uid, status="FAILED", error=friendly_error(e), activity="Lỗi hệ thống")
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
                actions = {uid: list((_history_data.get(uid) or {}).get("actions") or []) for uid in _state["accounts"]}
                assigned = dict(_assignments)
            # Dừng khẩn cấp thì giữ nguyên ô nhập; lỗi khi tính cũng giữ nguyên (không được xóa nhầm link của người dùng)
            try:
                leftover = None if _control.stopped else leftover_inputs(cfg, list(actions), assigned, actions)
            except Exception as e:
                logger.exception(f"Không tính được link / từ khóa còn lại: {e}")
                leftover = None
            with _state_lock:
                _state["leftover"] = leftover
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
                     proxy: Optional[str], date_from: Optional[str], date_to: Optional[str],
                     fb_uid: Optional[str] = None) -> Dict:
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
    return {
        "search": (search or "").strip()[:100],
        "action": action,
        "status": status,
        "proxy": proxy,
        "date_from": date_from,
        "date_to": date_to,
        "fb_uid": (fb_uid or "").strip()[:64],
    }


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
    fb_uid: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=HISTORY_PAGE_SIZE_MAX),
):
    filters = _history_filters(search, action, status, proxy, date_from, date_to, fb_uid)
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
    ("newsfeed_reactions", "Cảm xúc Newsfeed"),
    ("watch_seconds", "Watch (giây)"), ("watch_videos", "Video đã xem"), ("watch_reactions", "Cảm xúc Watch"),
    ("story_frames", "Khung story đã xem"), ("story_seconds", "Story (giây)"), ("story_reactions", "Cảm xúc Story"),
    ("friends_sent", "Lời mời kết bạn"), ("friends_source", "Nguồn kết bạn"),
    ("groups_joined", "Nhóm đã tham gia"), ("groups_source", "Nguồn nhóm"), ("groups_keyword", "Từ khóa nhóm"),
    ("groups_left", "Nhóm đã rời"),
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
    fb_uid: Optional[str] = None,
):
    filters = _history_filters(search, action, status, proxy, date_from, date_to, fb_uid)
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
        "logs": [{**log, "created_at": _iso(log.get("created_at")), "targets": _json_list(log.get("targets"))}
                 for log in data["logs"]],
    }


RUN_TARGET_LISTS = {"JOIN_GROUP": "groups_joined", "LEAVE_GROUP": "groups_left", "ADD_FRIEND": "friends_sent"}


@router.get("/runs/{run_id}/targets")
async def farm_run_targets(run_id: int):
    """Danh sách nhóm đã vào / đã rời + người đã gửi lời mời của 1 lượt (không gồm link bị bỏ qua)."""
    try:
        rows = await asyncio.to_thread(repository.get_run_targets, adapters.get_machine_id(), run_id)
    except Exception as e:
        logger.warning(f"Không đọc được danh sách của lượt {run_id}: {e}")
        raise HTTPException(status_code=503, detail="Không đọc được danh sách từ CSDL.")
    lists = {key: [] for key in RUN_TARGET_LISTS.values()}
    for row in rows:
        lists[RUN_TARGET_LISTS[row["action_type"]]].extend(
            t for t in _json_list(row["targets"])
            if isinstance(t, dict) and not str(t.get("result") or "").startswith("skipped_"))
    return lists


def _json_list(value) -> List:
    """Cột JSON dạng danh sách; rỗng / hỏng thì trả []."""
    try:
        parsed = json.loads(value) if value else []
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


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
