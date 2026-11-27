"""
campaign_repository.py
Module 03 - Tab 2: Truy xuất chiến dịch đăng bài nhiều khung giờ.
  post_campaigns       : chiến dịch (nick, cài đặt, nội dung ô soạn + kho ảnh), gắn với máy tạo ra nó
  post_campaign_slots  : các khung giờ (WAITING / RUNNING / DONE / MISSED / STOPPED / FAILED);
                         dạng "Từng bài" lưu bài của từng nick ngay trên khung (account_posts)
  post_campaign_usage  : nick nào đã nhận bài / ảnh nào (luật không đăng trùng trong chiến dịch)
"""
import json
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from core.database.connection import db

WAITING, RUNNING, DONE, MISSED, STOPPED, FAILED = "WAITING", "RUNNING", "DONE", "MISSED", "STOPPED", "FAILED"
ACTIVE, COMPLETED = "ACTIVE", "COMPLETED"

_CAMPAIGN_COLUMNS = (
    "id::text AS id, owner_key, machine_id, name, post_type, status, accounts, settings, content_text, "
    "content_mode, image_mode, image_paths, min_images, max_images, layout, created_at, updated_at"
)
_SLOT_COLUMNS = (
    "id::text AS id, campaign_id::text AS campaign_id, run_at, status, session_id::text AS session_id, "
    "started_at, finished_at, total_count, success_count, failed_count, message"
)


def _json(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def _slot_posts_json(account_posts: Dict[str, List[Dict[str, Any]]], index: int) -> Optional[str]:
    """Bài của từng nick cho khung thứ `index` (dạng "Từng bài") → JSON {uid: {content, images}}."""
    if not account_posts:
        return None
    slot = {uid: entries[index] for uid, entries in account_posts.items() if index < len(entries)}
    return json.dumps(slot, ensure_ascii=False) if slot else None


def _insert_slots(cur, campaign_id: str, run_times: Sequence[datetime], account_posts: Dict[str, Any]) -> None:
    for i, run_at in enumerate(run_times):
        cur.execute(
            "INSERT INTO post_campaign_slots (campaign_id, run_at, account_posts) VALUES (%s, %s, %s)",
            (campaign_id, run_at, _slot_posts_json(account_posts, i)),
        )


def _campaign(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    out = dict(row)
    out["accounts"] = _json(row.get("accounts"), [])
    out["settings"] = _json(row.get("settings"), {})
    out["image_paths"] = _json(row.get("image_paths"), [])
    return out


# ==============================================================================
# CHIẾN DỊCH
# ==============================================================================

def create_campaign(data: Dict[str, Any], run_times: Sequence[datetime]) -> Dict[str, Any]:
    """Tạo chiến dịch + các khung giờ trong 1 transaction."""
    with db.session() as cur:
        cur.execute(
            f"""
            INSERT INTO post_campaigns
                (owner_key, machine_id, name, post_type, status, accounts, settings, content_text,
                 content_mode, image_mode, image_paths, min_images, max_images, layout)
            VALUES (%s, %s, %s, %s, 'ACTIVE', %s::jsonb, %s::jsonb, %s, %s, %s, %s, %s, %s, %s)
            RETURNING {_CAMPAIGN_COLUMNS}
            """,
            (
                data["owner_key"], data["machine_id"], data["name"], data.get("post_type", "status"),
                json.dumps(data["accounts"], ensure_ascii=False), json.dumps(data["settings"]),
                data["content_text"], data["content_mode"], data["image_mode"],
                json.dumps(data["image_paths"], ensure_ascii=False), data["min_images"], data["max_images"],
                data.get("layout") or "TEXT",
            ),
        )
        campaign = _campaign(cur.fetchone())
        _insert_slots(cur, campaign["id"], run_times, data.get("account_posts") or {})
    return campaign


def get_campaign(campaign_id: str, owner_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if owner_key is None:
        row = db.fetch_one(f"SELECT {_CAMPAIGN_COLUMNS} FROM post_campaigns WHERE id = %s", (campaign_id,))
    else:
        row = db.fetch_one(
            f"SELECT {_CAMPAIGN_COLUMNS} FROM post_campaigns WHERE id = %s AND owner_key = %s",
            (campaign_id, owner_key),
        )
    return _campaign(row)


def list_campaigns(owner_key: str, limit: int = 200) -> List[Dict[str, Any]]:
    rows = db.fetch_all(
        f"""
        SELECT {_CAMPAIGN_COLUMNS},
               (SELECT COUNT(*) FROM post_campaign_slots s WHERE s.campaign_id = c.id) AS slot_total,
               (SELECT COUNT(*) FROM post_campaign_slots s WHERE s.campaign_id = c.id AND s.status = 'DONE') AS slot_done,
               (SELECT COUNT(*) FROM post_campaign_slots s WHERE s.campaign_id = c.id AND s.status = 'WAITING') AS slot_waiting,
               (SELECT COUNT(*) FROM post_campaign_slots s WHERE s.campaign_id = c.id AND s.status = 'RUNNING') AS slot_running,
               (SELECT COUNT(*) FROM post_campaign_slots s
                 WHERE s.campaign_id = c.id AND s.status IN ('MISSED', 'FAILED')) AS slot_problem,
               (SELECT MIN(run_at) FROM post_campaign_slots s
                 WHERE s.campaign_id = c.id AND s.status = 'WAITING') AS next_run_at,
               (SELECT COALESCE(SUM(success_count), 0) FROM post_campaign_slots s WHERE s.campaign_id = c.id) AS posts_success,
               (SELECT COALESCE(SUM(failed_count), 0) FROM post_campaign_slots s WHERE s.campaign_id = c.id) AS posts_failed
        FROM post_campaigns c
        WHERE owner_key = %s
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (owner_key, limit),
    )
    return [_campaign(r) for r in rows]


def update_campaign(campaign_id: str, fields: Dict[str, Any], waiting_times: Sequence[datetime]) -> None:
    """Sửa nội dung / nick / cài đặt và thay toàn bộ khung WAITING (khung đã chạy giữ nguyên)."""
    with db.session() as cur:
        cur.execute(
            """
            UPDATE post_campaigns SET
                name = %s, accounts = %s::jsonb, settings = %s::jsonb, content_text = %s, content_mode = %s,
                image_mode = %s, image_paths = %s, min_images = %s, max_images = %s, layout = %s,
                status = CASE WHEN status = 'COMPLETED' AND %s THEN 'ACTIVE' ELSE status END
            WHERE id = %s
            """,
            (
                fields["name"], json.dumps(fields["accounts"], ensure_ascii=False), json.dumps(fields["settings"]),
                fields["content_text"], fields["content_mode"], fields["image_mode"],
                json.dumps(fields["image_paths"], ensure_ascii=False), fields["min_images"], fields["max_images"],
                fields.get("layout") or "TEXT", bool(waiting_times), campaign_id,
            ),
        )
        cur.execute("DELETE FROM post_campaign_slots WHERE campaign_id = %s AND status = 'WAITING'", (campaign_id,))
        _insert_slots(cur, campaign_id, waiting_times, fields.get("account_posts") or {})


def stop_campaign(campaign_id: str) -> None:
    with db.session() as cur:
        cur.execute("UPDATE post_campaigns SET status = 'STOPPED' WHERE id = %s", (campaign_id,))
        cur.execute(
            "UPDATE post_campaign_slots SET status = 'STOPPED', message = 'Chiến dịch đã dừng' "
            "WHERE campaign_id = %s AND status = 'WAITING'",
            (campaign_id,),
        )


def resume_campaign(campaign_id: str, not_before: datetime) -> int:
    """Chạy tiếp: các khung bị dừng còn ở tương lai quay lại WAITING. Trả về số khung sẽ chạy."""
    with db.session() as cur:
        cur.execute(
            "UPDATE post_campaign_slots SET status = 'WAITING', message = NULL "
            "WHERE campaign_id = %s AND status = 'STOPPED' AND session_id IS NULL AND run_at >= %s",
            (campaign_id, not_before),
        )
        cur.execute(
            "SELECT COUNT(*) AS n FROM post_campaign_slots WHERE campaign_id = %s AND status IN ('WAITING', 'RUNNING')",
            (campaign_id,),
        )
        pending = int(cur.fetchone()["n"])
        cur.execute(
            "UPDATE post_campaigns SET status = %s WHERE id = %s",
            (ACTIVE if pending else COMPLETED, campaign_id),
        )
    return pending


def delete_campaign(campaign_id: str) -> None:
    # Bài đã đăng vẫn giữ campaign_id / slot_id để xem Lịch sử
    db.execute("DELETE FROM post_campaigns WHERE id = %s", (campaign_id,))


def complete_finished_campaigns(machine_id: str) -> int:
    cur = db.execute(
        """
        UPDATE post_campaigns c SET status = 'COMPLETED'
        WHERE c.machine_id = %s AND c.status = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM post_campaign_slots s
                          WHERE s.campaign_id = c.id AND s.status IN ('WAITING', 'RUNNING'))
        """,
        (machine_id,),
    )
    return cur.rowcount or 0


# ==============================================================================
# KHUNG GIỜ
# ==============================================================================

def list_slots(campaign_id: str) -> List[Dict[str, Any]]:
    return db.fetch_all(
        f"SELECT {_SLOT_COLUMNS} FROM post_campaign_slots WHERE campaign_id = %s ORDER BY run_at, created_at",
        (campaign_id,),
    )


def get_slot(slot_id: str, campaign_id: str) -> Optional[Dict[str, Any]]:
    return db.fetch_one(
        f"SELECT {_SLOT_COLUMNS} FROM post_campaign_slots WHERE id = %s AND campaign_id = %s",
        (slot_id, campaign_id),
    )


def slot_account_posts(slot_id: str) -> Dict[str, Dict[str, Any]]:
    """Dạng "Từng bài": {uid: {content, images}} của 1 khung."""
    row = db.fetch_one("SELECT account_posts FROM post_campaign_slots WHERE id = %s", (slot_id,))
    value = _json(row.get("account_posts") if row else None, {})
    return value if isinstance(value, dict) else {}


def waiting_slots_account_posts(campaign_id: str) -> List[Dict[str, Dict[str, Any]]]:
    """Bài từng nick của các khung chưa chạy, theo thứ tự giờ (để mở lại khi sửa chiến dịch)."""
    rows = db.fetch_all(
        "SELECT account_posts FROM post_campaign_slots WHERE campaign_id = %s AND status = 'WAITING' "
        "ORDER BY run_at, created_at",
        (campaign_id,),
    )
    out = []
    for r in rows:
        value = _json(r.get("account_posts"), {})
        out.append(value if isinstance(value, dict) else {})
    return out


def has_running_slot(campaign_id: str) -> bool:
    row = db.fetch_one(
        "SELECT 1 AS x FROM post_campaign_slots WHERE campaign_id = %s AND status = 'RUNNING' LIMIT 1",
        (campaign_id,),
    )
    return bool(row)


def count_waiting_slots(campaign_id: str) -> int:
    row = db.fetch_one(
        "SELECT COUNT(*) AS n FROM post_campaign_slots WHERE campaign_id = %s AND status = 'WAITING'",
        (campaign_id,),
    )
    return int(row["n"]) if row else 0


def recover_after_restart(machine_id: str, missed_before: datetime) -> Tuple[List[Dict[str, Any]], int]:
    """Lúc backend khởi động: khung đang RUNNING → FAILED (trả về để dừng bài chờ), khung WAITING quá hạn → MISSED."""
    with db.session() as cur:
        cur.execute(
            f"""
            UPDATE post_campaign_slots s SET status = 'FAILED', finished_at = NOW(),
                message = 'Backend bị tắt khi khung này đang chạy. Bấm Chạy lại để đăng cho các nick chưa đăng.'
            FROM post_campaigns c
            WHERE c.id = s.campaign_id AND c.machine_id = %s AND s.status = 'RUNNING'
            RETURNING s.id::text AS id, s.session_id::text AS session_id
            """,
            (machine_id,),
        )
        failed = [dict(r) for r in cur.fetchall()]
        cur.execute(
            """
            UPDATE post_campaign_slots s SET status = 'MISSED',
                message = 'Bị lỡ do backend không chạy đúng giờ. Bấm Chạy lại để đăng.'
            FROM post_campaigns c
            WHERE c.id = s.campaign_id AND c.machine_id = %s AND c.status = 'ACTIVE'
              AND s.status = 'WAITING' AND s.run_at < %s
            """,
            (machine_id, missed_before),
        )
        missed = cur.rowcount or 0
    return failed, missed


def running_slots(machine_id: str) -> List[Dict[str, Any]]:
    return db.fetch_all(
        f"""
        SELECT {", ".join("s." + c.strip() for c in _SLOT_COLUMNS.split(", "))}, c.status AS campaign_status
        FROM post_campaign_slots s JOIN post_campaigns c ON c.id = s.campaign_id
        WHERE c.machine_id = %s AND s.status = 'RUNNING'
        """,
        (machine_id,),
    )


def due_slots(machine_id: str, now: datetime) -> List[Dict[str, Any]]:
    return db.fetch_all(
        f"""
        SELECT {", ".join("s." + c.strip() for c in _SLOT_COLUMNS.split(", "))}
        FROM post_campaign_slots s JOIN post_campaigns c ON c.id = s.campaign_id
        WHERE c.machine_id = %s AND c.status = 'ACTIVE' AND s.status = 'WAITING' AND s.run_at <= %s
        ORDER BY s.run_at, s.created_at
        """,
        (machine_id, now),
    )


def claim_slot(slot_id: str, session_id: str, total: int, message: Optional[str]) -> bool:
    """WAITING → RUNNING (chỉ thành công nếu khung chưa bị sửa / dừng / xoá trong lúc chuẩn bị)."""
    cur = db.execute(
        """
        UPDATE post_campaign_slots SET status = 'RUNNING', session_id = %s, started_at = NOW(),
            finished_at = NULL, total_count = %s, failed_count = 0, message = %s
        WHERE id = %s AND status = 'WAITING'
        """,
        (session_id, total, message, slot_id),
    )
    return (cur.rowcount or 0) == 1


def set_slot_message(slot_id: str, message: str) -> None:
    db.execute("UPDATE post_campaign_slots SET message = %s WHERE id = %s", (message, slot_id))


def finish_slot(slot_id: str, status: str, success: int, failed: int, message: Optional[str]) -> None:
    db.execute(
        """
        UPDATE post_campaign_slots SET status = %s, finished_at = NOW(), success_count = %s,
            failed_count = %s, total_count = %s, message = %s
        WHERE id = %s
        """,
        (status, success, failed, success + failed, message, slot_id),
    )


def reset_slot_for_rerun(slot_id: str, run_at: datetime) -> bool:
    cur = db.execute(
        """
        UPDATE post_campaign_slots SET status = 'WAITING', run_at = %s, finished_at = NULL,
            message = 'Chờ chạy lại'
        WHERE id = %s AND status IN ('MISSED', 'FAILED', 'STOPPED', 'DONE')
        """,
        (run_at, slot_id),
    )
    return (cur.rowcount or 0) == 1


def set_campaign_active(campaign_id: str) -> None:
    db.execute("UPDATE post_campaigns SET status = 'ACTIVE' WHERE id = %s AND status <> 'ACTIVE'", (campaign_id,))


# ==============================================================================
# BÀI CỦA KHUNG + LƯỢT DÙNG BÀI / ẢNH
# ==============================================================================

def slot_published_uids(slot_id: str) -> set:
    rows = db.fetch_all(
        "SELECT DISTINCT account_uid FROM posts WHERE slot_id = %s AND status = 'PUBLISHED'", (slot_id,)
    )
    return {str(r["account_uid"]) for r in rows}


def session_post_counts(session_id: str) -> Dict[str, int]:
    rows = db.fetch_all("SELECT status, COUNT(*) AS n FROM posts WHERE session_id = %s GROUP BY status", (session_id,))
    return {r["status"]: int(r["n"]) for r in rows}


def session_status(session_id: str) -> Optional[str]:
    row = db.fetch_one("SELECT status FROM post_sessions WHERE id = %s", (session_id,))
    return row["status"] if row else None


def load_usage(campaign_id: str) -> List[Dict[str, Any]]:
    return db.fetch_all(
        "SELECT account_uid, kind, item_key FROM post_campaign_usage WHERE campaign_id = %s", (campaign_id,)
    )


def delete_slot_usage(slot_id: str, account_uids: Iterable[str]) -> None:
    uids = list(account_uids)
    if uids:
        db.execute(
            "DELETE FROM post_campaign_usage WHERE slot_id = %s AND account_uid = ANY(%s)", (slot_id, uids)
        )


def add_usage(campaign_id: str, slot_id: str, rows: Iterable[Tuple[str, str, str]]) -> None:
    """rows: (account_uid, kind TEXT|IMAGE, item_key)."""
    items = list(rows)
    if not items:
        return
    with db.session() as cur:
        cur.executemany(
            "INSERT INTO post_campaign_usage (campaign_id, slot_id, account_uid, kind, item_key) VALUES (%s, %s, %s, %s, %s)",
            [(campaign_id, slot_id, uid, kind, key) for uid, kind, key in items],
        )
