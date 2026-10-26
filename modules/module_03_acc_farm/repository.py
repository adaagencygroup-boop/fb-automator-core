"""
repository.py
Truy cập dữ liệu các bảng farm_* (Supabase / Postgres) của Module 3 - Tab 1.

- Lệnh ghi trong lúc chạy (cập nhật lượt, log hành động, kết thúc lượt) đi qua 1 thread ghi duy nhất
  để giữ đúng thứ tự; ghi lỗi (mất mạng) thì giữ lại và thử lại sau RETRY_SECONDS.
- Lệnh cần kết quả ngay (tạo lượt, đọc giới hạn ngày, fingerprint, settings, lịch sử) chạy đồng bộ.
"""
import json
import logging
import secrets
import threading
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from core.database.connection import db

logger = logging.getLogger(__name__)

VN_TZ = timezone(timedelta(hours=7))
RETRY_SECONDS = 30
FINAL_STATUSES = ("COMPLETED", "STOPPED", "FAILED", "BLOCKED", "DIE")
OPEN_STATUSES = ("PENDING", "RUNNING", "PAUSED")
STALE_ERROR = "Engine dừng đột ngột"

RUN_COLUMNS = {"status", "current_activity", "error", "finished_at", "fb_name"}
HISTORY_COLUMNS = (
    "run_id", "machine_id", "owner_username", "session_id", "fb_uid", "fb_name",
    "proxy_host", "proxy_mode", "egress_ip", "fingerprint_mode",
    "final_status", "error", "light_checkpoint", "cookie_saved",
    "started_at", "finished_at", "duration_seconds",
    "newsfeed_seconds", "newsfeed_scrolls", "newsfeed_reactions", "watch_seconds", "watch_videos", "watch_reactions",
    "story_frames", "story_seconds", "story_reactions",
    "friends_sent", "friends_source", "groups_joined", "groups_source", "groups_keyword", "groups_left",
    "notif_checked", "notif_opened",
    "actions_success", "actions_failed", "actions_blocked", "actions_skipped",
    "actions_summary", "config_snapshot", "created_at",
)


def utc_now() -> datetime:
    """Giờ UTC dạng naive để lưu vào cột TIMESTAMP."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _q(query: str) -> str:
    return db._normalize_query(query)


def as_datetime(value) -> Optional[datetime]:
    """Postgres trả datetime; chế độ SQLite dự phòng trả chuỗi ISO."""
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


# ─────────────────────────── HÀNG ĐỢI GHI ────────────────────────────

class _WriteQueue:
    """1 thread ghi duy nhất, thực hiện lần lượt; lệnh lỗi được giữ ở đầu hàng và thử lại sau."""

    def __init__(self):
        self._items: deque = deque()
        self._cond = threading.Condition()
        self._thread: Optional[threading.Thread] = None
        self._stopping = False

    def start(self):
        with self._cond:
            if self._thread and self._thread.is_alive():
                return
            self._stopping = False
            self._thread = threading.Thread(target=self._loop, name="farm-db-writer", daemon=True)
            self._thread.start()

    def stop(self, timeout: float = 5.0):
        """Ghi nốt các lệnh đang chờ (tối đa timeout giây) rồi dừng thread."""
        with self._cond:
            self._stopping = True
            self._cond.notify_all()
        if self._thread:
            self._thread.join(timeout)

    def put(self, label: str, fn: Callable[[], None]):
        with self._cond:
            self._items.append((label, fn))
            self._cond.notify_all()

    def pending(self) -> int:
        with self._cond:
            return len(self._items)

    def _loop(self):
        while True:
            with self._cond:
                while not self._items and not self._stopping:
                    self._cond.wait()
                if not self._items:
                    return
                label, fn = self._items[0]
            try:
                fn()
            except Exception as e:
                if self._stopping:
                    logger.warning(f"Bỏ {self.pending()} lệnh ghi chưa lưu được khi tắt engine ({label}): {e}")
                    return
                logger.warning(f"Ghi CSDL thất bại ({label}), thử lại sau {RETRY_SECONDS}s: {e}")
                with self._cond:
                    self._cond.wait(RETRY_SECONDS)
                continue
            with self._cond:
                self._items.popleft()


writer = _WriteQueue()


# ─────────────────────────── LƯỢT CHẠY ────────────────────────────

def create_run(machine_id: str, uid: str, fb_name: str, session_id: str,
               owner_username: Optional[str] = None) -> int:
    row = db.fetch_one(
        """INSERT INTO farm_runs (machine_id, owner_username, fb_uid, fb_name, session_id, status, started_at)
           VALUES (?, ?, ?, ?, ?, 'PENDING', ?) RETURNING id""",
        (machine_id, owner_username or None, str(uid), (fb_name or None), session_id, utc_now()),
    )
    return int(row["id"])


def update_run(run_id: int, **fields):
    data = {k: v for k, v in fields.items() if k in RUN_COLUMNS}
    if not data or not run_id:
        return
    cols = ", ".join(f"{k} = ?" for k in data)
    params = tuple(data.values()) + (run_id,)
    writer.put(f"update_run#{run_id}", lambda: db.execute(f"UPDATE farm_runs SET {cols} WHERE id = ?", params))


def add_log(run_id: Optional[int], machine_id: str, uid: str, action_type: str, status: str,
            quantity: int = 0, details: str = "", owner_username: Optional[str] = None,
            targets: Optional[List[Dict[str, Any]]] = None):
    """targets: người / nhóm đã tương tác (kết bạn, tham gia nhóm); rỗng thì không ghi cột targets."""
    data = {
        "run_id": run_id, "machine_id": machine_id, "owner_username": owner_username or None,
        "fb_uid": str(uid), "action_type": action_type, "status": status,
        "quantity": int(quantity or 0), "details": details or "",
    }
    if targets:
        data["targets"] = json.dumps(targets, ensure_ascii=False)
    data["created_at"] = utc_now()
    cols = ", ".join(data)
    placeholders = ", ".join("?" for _ in data)
    params = tuple(data.values())
    writer.put(f"add_log#{run_id}:{action_type}", lambda: db.execute(
        f"INSERT INTO farm_interaction_logs ({cols}) VALUES ({placeholders})", params,
    ))


def _insert_history(cursor, history: Dict[str, Any]):
    cols = [c for c in HISTORY_COLUMNS if c in history]
    placeholders = ", ".join("?" for _ in cols)
    cursor.execute(
        _q(f"INSERT INTO farm_run_history ({', '.join(cols)}) VALUES ({placeholders}) "
           f"ON CONFLICT (run_id) DO NOTHING"),
        tuple(history[c] for c in cols),
    )


def finish_run(run_id: int, status: str, error: Optional[str], activity: str, history: Dict[str, Any]):
    """Kết thúc lượt: cập nhật farm_runs + thêm dòng farm_run_history trong cùng 1 transaction."""
    finished_at = history.get("finished_at") or utc_now()

    def _write():
        with db.session() as cur:
            cur.execute(
                _q("UPDATE farm_runs SET status = ?, error = ?, current_activity = ?, finished_at = ? WHERE id = ?"),
                (status, error, (activity or "")[:255], finished_at, run_id),
            )
            _insert_history(cur, history)

    writer.put(f"finish_run#{run_id}", _write)


# ─────────────────────────── TỔNG HỢP LỊCH SỬ ────────────────────────────

def summarize_actions(actions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Tính các cột tổng hợp của farm_run_history từ danh sách kết quả hành động (theo thứ tự chạy)."""
    out = {
        "newsfeed_seconds": 0, "newsfeed_scrolls": 0, "newsfeed_reactions": 0,
        "watch_seconds": 0, "watch_videos": 0, "watch_reactions": 0,
        "story_frames": 0, "story_seconds": 0, "story_reactions": 0,
        "friends_sent": 0, "friends_source": None, "groups_joined": 0, "groups_source": None, "groups_keyword": None,
        "groups_left": 0,
        "notif_checked": False, "notif_opened": False,
        "actions_success": 0, "actions_failed": 0, "actions_blocked": 0, "actions_skipped": 0,
    }
    group_keywords = []
    for a in actions:
        status, qty = a.get("status"), int(a.get("quantity") or 0)
        key = {"SUCCESS": "actions_success", "FAILED": "actions_failed",
               "BLOCKED": "actions_blocked", "SKIPPED": "actions_skipped"}.get(status)
        if key:
            out[key] += 1
        action = a.get("action")
        if action == "NEWSFEED":
            out["newsfeed_seconds"] += int(a.get("seconds") or 0)
            out["newsfeed_scrolls"] += int(a.get("scrolls") or 0)
            out["newsfeed_reactions"] += int(a.get("reactions") or 0)
        elif action == "WATCH":
            out["watch_seconds"] += int(a.get("seconds") or 0)
            out["watch_videos"] += qty
            out["watch_reactions"] += int(a.get("reactions") or 0)
        elif action == "STORY":
            out["story_frames"] += qty
            out["story_seconds"] += int(a.get("seconds") or 0)
            out["story_reactions"] += int(a.get("reactions") or 0)
        elif action == "ADD_FRIEND":
            out["friends_sent"] += qty
            out["friends_source"] = a.get("source") or out["friends_source"]
        elif action == "JOIN_GROUP":
            out["groups_joined"] += qty
            out["groups_source"] = a.get("source") or out["groups_source"]
            group_keywords += [k for k in (a.get("keywords") or []) if k not in group_keywords]
        elif action == "LEAVE_GROUP":
            out["groups_left"] += qty
        elif action == "CHECK_NOTIF":
            out["notif_checked"] = out["notif_checked"] or status == "SUCCESS"
            out["notif_opened"] = out["notif_opened"] or (status == "SUCCESS" and qty > 0)
    # Từ khóa đã mở trang tìm nhóm, theo thứ tự dùng; NULL = vào nhóm đề xuất hoặc không chạy tham gia nhóm
    out["groups_keyword"] = ", ".join(group_keywords) or None
    out["actions_summary"] = json.dumps(
        [{k: a.get(k) for k in ("action", "status", "quantity", "details")} for a in actions],
        ensure_ascii=False,
    )
    return out


# ─────────────────────────── DỌN LƯỢT TREO ────────────────────────────

def mark_stale_runs(machine_id: str) -> int:
    """
    Gọi lúc engine khởi động: lượt của MÁY NÀY còn PENDING/RUNNING/PAUSED thuộc engine đã tắt
    → FAILED "Engine dừng đột ngột" + ghi lịch sử (số liệu lấy từ farm_interaction_logs).
    """
    placeholders = ", ".join("?" for _ in OPEN_STATUSES)
    runs = db.fetch_all(
        f"SELECT * FROM farm_runs WHERE machine_id = ? AND status IN ({placeholders}) ORDER BY id",
        (machine_id, *OPEN_STATUSES),
    )
    now = utc_now()
    for run in runs:
        logs = db.fetch_all(
            "SELECT action_type, status, quantity, details FROM farm_interaction_logs WHERE run_id = ? ORDER BY id",
            (run["id"],),
        )
        actions = [{"action": l["action_type"], "status": l["status"], "quantity": l["quantity"],
                    "details": l["details"]} for l in logs]
        started = as_datetime(run["started_at"]) or now
        history = {
            "run_id": run["id"], "machine_id": machine_id, "owner_username": run.get("owner_username"),
            "session_id": run.get("session_id"), "fb_uid": run["fb_uid"], "fb_name": run.get("fb_name"),
            "final_status": "FAILED", "error": STALE_ERROR,
            "started_at": started, "finished_at": now,
            "duration_seconds": max(0, int((now - started).total_seconds())),
            "created_at": now, **summarize_actions(actions),
        }
        with db.session() as cur:
            cur.execute(
                _q("UPDATE farm_runs SET status = 'FAILED', error = ?, current_activity = ?, finished_at = ? WHERE id = ?"),
                (STALE_ERROR, STALE_ERROR, now, run["id"]),
            )
            _insert_history(cur, history)
    return len(runs)


# ─────────────────────────── GIỚI HẠN NGÀY ────────────────────────────

def _vn_day_start_utc(days_ago: int = 0) -> datetime:
    now_vn = datetime.now(VN_TZ)
    start_vn = now_vn.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days_ago)
    return start_vn.astimezone(timezone.utc).replace(tzinfo=None)


def sum_today(uid: str, action_type: str) -> int:
    """
    Tổng số lượng đã làm hôm nay (giờ VN) của 1 nick cho 1 hành động, tính mọi máy và mọi trạng thái:
    lượt bị dừng / lỗi giữa chừng vẫn đã gửi lời mời thật lên Facebook.
    """
    row = db.fetch_one(
        """SELECT COALESCE(SUM(quantity), 0) AS total FROM farm_interaction_logs
           WHERE fb_uid = ? AND action_type = ? AND created_at >= ?""",
        (str(uid), action_type, _vn_day_start_utc()),
    )
    return int(row["total"] or 0) if row else 0


def group_target_history(uid: str) -> List[Dict[str, Any]]:
    """
    Các log tham gia / rời nhóm có targets của 1 nick (mọi máy), cũ trước mới sau, để chế độ danh sách link bỏ qua
    nhóm đã vào và Rời nhóm tìm nhóm tham gia gần đây. Dùng index (fb_uid, action_type, created_at).
    """
    return db.fetch_all(
        """SELECT run_id, action_type, targets, created_at FROM farm_interaction_logs
           WHERE fb_uid = ? AND action_type IN ('JOIN_GROUP', 'LEAVE_GROUP') AND targets IS NOT NULL
           ORDER BY created_at, id""",
        (str(uid),),
    )


# ─────────────────────────── CHỦ CỦA NHÓM / NGƯỜI (CHIA ĐÍCH) ────────────────────────────

OWNER_KEY_CHUNK = 500


class _TakenByOther(Exception):
    """Có key thuộc nick khác: hủy cả lần giành (session rollback)."""


def _placeholders(items) -> str:
    return ", ".join("?" for _ in items)


def target_owners(scope: str, keys: List[str]) -> Dict[str, str]:
    """key -> uid nick chủ, chỉ gồm các key đã có chủ trong dàn."""
    keys = list(dict.fromkeys(keys))
    owners = {}
    for start in range(0, len(keys), OWNER_KEY_CHUNK):
        chunk = keys[start:start + OWNER_KEY_CHUNK]
        rows = db.fetch_all(
            f"SELECT target_key, fb_uid FROM farm_target_owners WHERE scope = ? AND target_key IN ({_placeholders(chunk)})",
            (scope, *chunk),
        )
        owners.update({row["target_key"]: row["fb_uid"] for row in rows})
    return owners


def claim_target(scope: str, uid: str, kind: str, keys: List[str], status: str,
                 name: Optional[str] = None, url: Optional[str] = None, exclusive: bool = True) -> Optional[str]:
    """
    Ghi nick làm chủ mọi key (các tên khác nhau của cùng 1 đích); key đã có chủ thì giữ nguyên chủ cũ.
    exclusive: có key thuộc nick khác thì hủy cả lần ghi và trả uid nick đó; None = nick là chủ của đích.
    2 nick giành cùng 1 key thì nick sau chờ nick trước xong (khóa duy nhất) rồi thấy đã có chủ.
    Key ghi theo thứ tự cố định để 2 nick giành cùng lúc không khóa chéo nhau.
    """
    keys = sorted(set(keys))
    if not keys:
        return None
    now = utc_now()
    try:
        with db.session() as cur:
            for key in keys:
                cur.execute(
                    _q("""INSERT INTO farm_target_owners
                              (scope, kind, target_key, fb_uid, status, name, url, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (scope, target_key) DO NOTHING"""),
                    (scope, kind, key, str(uid), status, name, url, now, now),
                )
            if exclusive:
                cur.execute(
                    _q(f"SELECT fb_uid FROM farm_target_owners WHERE scope = ? AND target_key IN ({_placeholders(keys)})"),
                    (scope, *keys),
                )
                other = next((row["fb_uid"] for row in cur.fetchall() if row["fb_uid"] != str(uid)), None)
                if other:
                    raise _TakenByOther(other)
    except _TakenByOther as taken:
        return str(taken.args[0])
    return None


def settle_targets(scope: str, uid: str, keys: List[str], status: str,
                   name: Optional[str] = None, url: Optional[str] = None):
    """Cập nhật trạng thái các key nick đang là chủ (key của nick khác không đổi)."""
    keys = sorted(set(keys))
    if not keys:
        return
    db.execute(
        f"""UPDATE farm_target_owners SET status = ?, name = COALESCE(?, name), url = COALESCE(?, url), updated_at = ?
            WHERE scope = ? AND fb_uid = ? AND target_key IN ({_placeholders(keys)})""",
        (status, name, url, utc_now(), scope, str(uid), *keys),
    )


def release_targets(scope: str, uid: str, keys: List[str]):
    """Trả lại các key nick vừa giành mà không bấm được (status claimed); key đã vào / đã gửi từ trước giữ nguyên."""
    keys = sorted(set(keys))
    if not keys:
        return
    db.execute(
        f"""DELETE FROM farm_target_owners
            WHERE scope = ? AND fb_uid = ? AND status = 'claimed' AND target_key IN ({_placeholders(keys)})""",
        (scope, str(uid), *keys),
    )


def owner_holders(scope: str) -> Dict[str, int]:
    """Nick đang giữ chủ trong dàn: uid -> số nhóm / người đang giữ."""
    rows = db.fetch_all(
        "SELECT fb_uid, COUNT(*) AS total FROM farm_target_owners WHERE scope = ? GROUP BY fb_uid", (scope,))
    return {row["fb_uid"]: int(row["total"]) for row in rows}


def delete_owner_rows(scope: str, uids: List[str]) -> int:
    """Xóa mọi dòng chủ của các nick trong dàn (nick đã die / đã xóa): nhóm / người đó thành chưa có chủ."""
    uids = sorted(set(str(u) for u in uids))
    if not uids:
        return 0
    with db.session() as cur:
        cur.execute(_q(f"DELETE FROM farm_target_owners WHERE scope = ? AND fb_uid IN ({_placeholders(uids)})"),
                    (scope, *uids))
        return max(cur.rowcount, 0)


def has_target_owners() -> bool:
    return db.fetch_one("SELECT 1 AS found FROM farm_target_owners LIMIT 1") is not None


def owner_backfill_logs() -> List[Dict[str, Any]]:
    """Log có targets của tham gia / rời nhóm / kết bạn (mọi máy), cũ trước mới sau, để chép chủ vào bảng mới."""
    return db.fetch_all(
        """SELECT machine_id, owner_username, fb_uid, action_type, targets FROM farm_interaction_logs
           WHERE action_type IN ('JOIN_GROUP', 'LEAVE_GROUP', 'ADD_FRIEND') AND targets IS NOT NULL
           ORDER BY created_at, id"""
    )


def apply_owner_backfill(entries: List[Dict[str, Any]]) -> int:
    """
    Chép chủ từ log trong 1 giao dịch, theo thứ tự thời gian: key chưa có chủ thì nick của log là chủ;
    key nick đó đang là chủ thì cập nhật trạng thái (vd đã rời). entries: {scope, uid, kind, keys, status, name, url}.
    """
    now = utc_now()
    with db.session() as cur:
        for e in entries:
            for key in sorted(set(e["keys"])):
                cur.execute(
                    _q("""INSERT INTO farm_target_owners
                              (scope, kind, target_key, fb_uid, status, name, url, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                          ON CONFLICT (scope, target_key) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
                          WHERE farm_target_owners.fb_uid = EXCLUDED.fb_uid"""),
                    (e["scope"], e["kind"], key, str(e["uid"]), e["status"], e.get("name"), e.get("url"), now, now),
                )
    return len(entries)


# ─────────────────────────── CẢNH BÁO CHECKPOINT ────────────────────────────

def recent_heavy_checkpoints(machine_id: str, error_prefix: str, hours: int) -> List[Dict[str, Any]]:
    """Lượt DIE vì checkpoint nặng của máy này trong `hours` giờ gần nhất (mới nhất trước, tối đa 20 dòng)."""
    return db.fetch_all(
        """SELECT fb_uid, fb_name, error, finished_at FROM farm_run_history
           WHERE machine_id = ? AND final_status = 'DIE' AND error LIKE ? AND finished_at >= ?
           ORDER BY finished_at DESC LIMIT 20""",
        (machine_id, f"{error_prefix}%", utc_now() - timedelta(hours=hours)),
    )


# ─────────────────────────── FINGERPRINT ────────────────────────────

def get_or_create_fingerprint(uid: str, profile_used_before: bool) -> Dict[str, Any]:
    uid = str(uid)
    row = db.fetch_one("SELECT mode, canvas_seed FROM farm_browser_fingerprints WHERE uid = ?", (uid,))
    if not row:
        if profile_used_before:
            mode, seed = "legacy", None
        else:
            mode, seed = "native", secrets.randbelow(2**31 - 1) + 1
        db.execute(
            """INSERT INTO farm_browser_fingerprints (uid, mode, canvas_seed, created_at)
               VALUES (?, ?, ?, ?) ON CONFLICT (uid) DO NOTHING""",
            (uid, mode, seed, utc_now()),
        )
        row = db.fetch_one("SELECT mode, canvas_seed FROM farm_browser_fingerprints WHERE uid = ?", (uid,))
    return {"mode": row["mode"], "canvas_seed": row["canvas_seed"]}


# ─────────────────────────── SETTINGS ────────────────────────────

def get_settings(machine_id: str) -> Dict[str, str]:
    rows = db.fetch_all("SELECT key, value FROM farm_settings WHERE machine_id = ?", (machine_id,))
    return {r["key"]: r["value"] for r in rows}


def set_setting(machine_id: str, key: str, value: str):
    db.execute(
        """INSERT INTO farm_settings (machine_id, key, value, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (machine_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at""",
        (machine_id, key, value, utc_now()),
    )


# ─────────────────────────── KHÔI PHỤC MÀN TRẠNG THÁI ────────────────────────────

def get_latest_session(machine_id: str) -> Tuple[List[Dict[str, Any]], Dict[int, List[Dict[str, Any]]]]:
    """Các lượt của lần Kích hoạt gần nhất trên máy này + log hành động theo run_id."""
    newest = db.fetch_one(
        "SELECT id, session_id FROM farm_runs WHERE machine_id = ? ORDER BY started_at DESC, id DESC LIMIT 1",
        (machine_id,),
    )
    if not newest:
        return [], {}
    if newest["session_id"]:
        runs = db.fetch_all(
            "SELECT * FROM farm_runs WHERE machine_id = ? AND session_id = ? ORDER BY id",
            (machine_id, newest["session_id"]),
        )
    else:
        runs = db.fetch_all("SELECT * FROM farm_runs WHERE id = ?", (newest["id"],))
    ids = [r["id"] for r in runs]
    logs_by_run: Dict[int, List[Dict[str, Any]]] = {}
    if ids:
        placeholders = ", ".join("?" for _ in ids)
        for log in db.fetch_all(
            f"SELECT run_id, action_type, status, quantity FROM farm_interaction_logs "
            f"WHERE run_id IN ({placeholders}) ORDER BY id",
            tuple(ids),
        ):
            logs_by_run.setdefault(log["run_id"], []).append(log)
    return runs, logs_by_run


# ─────────────────────────── LỊCH SỬ ────────────────────────────

def _vn_date_to_utc(value: str, end_of_day: bool = False) -> datetime:
    day = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=VN_TZ)
    if end_of_day:
        day += timedelta(days=1)
    return day.astimezone(timezone.utc).replace(tzinfo=None)


def _history_where(machine_id: str, filters: Dict[str, Any]) -> Tuple[str, list]:
    where, params = ["h.machine_id = ?"], [machine_id]
    search = (filters.get("search") or "").strip()
    if search:
        where.append("(LOWER(h.fb_uid) LIKE ? OR LOWER(COALESCE(h.fb_name, '')) LIKE ?)")
        pattern = f"%{search.lower()}%"
        params += [pattern, pattern]
    if filters.get("action"):
        where.append("EXISTS (SELECT 1 FROM farm_interaction_logs l WHERE l.run_id = h.run_id AND l.action_type = ?)")
        params.append(filters["action"])
    if filters.get("status"):
        where.append("h.final_status = ?")
        params.append(filters["status"])
    if filters.get("proxy") == "with":
        where.append("h.proxy_mode IN ('full', 'facebook_only')")
    elif filters.get("proxy") == "without":
        where.append("(h.proxy_mode IS NULL OR h.proxy_mode = 'none')")
    if filters.get("date_from"):
        where.append("h.finished_at >= ?")
        params.append(_vn_date_to_utc(filters["date_from"]))
    if filters.get("date_to"):
        where.append("h.finished_at < ?")
        params.append(_vn_date_to_utc(filters["date_to"], end_of_day=True))
    return " AND ".join(where), params


def list_history(machine_id: str, filters: Dict[str, Any], page: int, page_size: int) -> Dict[str, Any]:
    where, params = _history_where(machine_id, filters)
    total = db.fetch_one(f"SELECT COUNT(*) AS c FROM farm_run_history h WHERE {where}", tuple(params))["c"]
    rows = db.fetch_all(
        f"SELECT h.* FROM farm_run_history h WHERE {where} "
        f"ORDER BY h.finished_at DESC, h.id DESC LIMIT ? OFFSET ?",
        tuple(params) + (page_size, (page - 1) * page_size),
    )
    return {"total": int(total or 0), "page": page, "page_size": page_size, "items": rows}


def iter_history_for_export(machine_id: str, filters: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
    where, params = _history_where(machine_id, filters)
    return db.fetch_all(
        f"SELECT h.* FROM farm_run_history h WHERE {where} ORDER BY h.finished_at DESC, h.id DESC LIMIT ?",
        tuple(params) + (limit,),
    )


def get_history_detail(machine_id: str, history_id: int) -> Optional[Dict[str, Any]]:
    row = db.fetch_one("SELECT * FROM farm_run_history WHERE id = ? AND machine_id = ?", (history_id, machine_id))
    if not row:
        return None
    logs = []
    if row.get("run_id"):
        logs = db.fetch_all(
            "SELECT action_type, status, quantity, details, targets, created_at FROM farm_interaction_logs "
            "WHERE run_id = ? ORDER BY id",
            (row["run_id"],),
        )
    return {"history": row, "logs": logs}


def cleanup_history(machine_id: str, keep_days: int) -> Dict[str, int]:
    """
    Xóa dữ liệu của máy này cũ hơn keep_days ngày (tính cả hôm nay, giờ VN; keep_days >= 1 nên luôn giữ hôm nay:
    log hôm nay dùng để tính giới hạn kết bạn / nhóm mỗi ngày). Lượt đang chạy không bị xóa.
    """
    cutoff = _vn_day_start_utc(days_ago=keep_days - 1)
    final_ph = ", ".join("?" for _ in FINAL_STATUSES)
    with db.session() as cur:
        cur.execute(_q("DELETE FROM farm_run_history WHERE machine_id = ? AND finished_at < ?"), (machine_id, cutoff))
        history = cur.rowcount
        cur.execute(_q("DELETE FROM farm_interaction_logs WHERE machine_id = ? AND created_at < ?"), (machine_id, cutoff))
        logs = cur.rowcount
        cur.execute(
            _q(f"DELETE FROM farm_runs WHERE machine_id = ? AND started_at < ? AND status IN ({final_ph})"),
            (machine_id, cutoff, *FINAL_STATUSES),
        )
        runs = cur.rowcount
    return {"history": max(history, 0), "logs": max(logs, 0), "runs": max(runs, 0), "cutoff": cutoff.isoformat()}
