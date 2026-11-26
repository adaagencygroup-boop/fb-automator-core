"""Module 13 — bảng dữ liệu và truy vấn (PostgreSQL). Truy vấn của người dùng đều giới hạn theo owner_key."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from core.database.connection import db

logger = logging.getLogger(__name__)

STALE_HEARTBEAT_SECONDS = 120
UNCATEGORIZED = "category:none"

DDL = [
    """
    CREATE TABLE IF NOT EXISTS profile_scan_sessions (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL,
        mode VARCHAR(20) NOT NULL,
        settings TEXT NOT NULL,
        message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMP,
        heartbeat_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS profile_scan_targets (
        id SERIAL PRIMARY KEY,
        session_id INT NOT NULL REFERENCES profile_scan_sessions(id) ON DELETE CASCADE,
        profile_key VARCHAR(100) NOT NULL,
        url TEXT NOT NULL,
        name TEXT,
        avatar_url TEXT,
        source_keys TEXT[] NOT NULL DEFAULT '{}',
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        attempts INT NOT NULL DEFAULT 0,
        uid VARCHAR(100),
        reason TEXT,
        account_uid VARCHAR(50),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (session_id, profile_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS profile_scan_logs (
        id SERIAL PRIMARY KEY,
        session_id INT NOT NULL REFERENCES profile_scan_sessions(id) ON DELETE CASCADE,
        level VARCHAR(10) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scanned_profiles (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100) NOT NULL,
        uid VARCHAR(100) NOT NULL,
        username VARCHAR(100),
        name TEXT,
        url TEXT,
        avatar_url TEXT,
        friends BIGINT,
        followers BIGINT,
        bio TEXT,
        birthday TEXT,
        hometown TEXT,
        location TEXT,
        education TEXT,
        job_title TEXT,
        job_place TEXT,
        phone TEXT,
        phone_source VARCHAR(10),
        last_session_id INT,
        scanned_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (owner_key, uid)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS profile_sources (
        owner_key VARCHAR(100) NOT NULL,
        source_key VARCHAR(255) NOT NULL,
        type VARCHAR(10) NOT NULL,
        name TEXT NOT NULL,
        url TEXT,
        scale BIGINT,
        scale_label TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (owner_key, source_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS profile_categories (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100) NOT NULL,
        name TEXT NOT NULL,
        color VARCHAR(20) NOT NULL DEFAULT '#2563EB',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
    """,
    # collection_key: 'group:…' | 'page:…' | 'post:…' | 'category:<id>' | 'category:none'
    """
    CREATE TABLE IF NOT EXISTS profile_members (
        owner_key VARCHAR(100) NOT NULL,
        collection_key VARCHAR(255) NOT NULL,
        uid VARCHAR(100) NOT NULL,
        added_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (owner_key, collection_key, uid)
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_categories_name ON profile_categories (owner_key, LOWER(name))",
    # Mỗi người dùng chỉ một phiên đang chạy
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_scan_live ON profile_scan_sessions (owner_key) WHERE status IN ('RUNNING', 'PAUSED')",
    "CREATE INDEX IF NOT EXISTS ix_profile_targets_status ON profile_scan_targets (session_id, status, id)",
    "CREATE INDEX IF NOT EXISTS ix_profile_logs_session ON profile_scan_logs (session_id, id)",
    # Luồng ghi log (NULL: log chung của phiên)
    "ALTER TABLE profile_scan_logs ADD COLUMN IF NOT EXISTS thread SMALLINT",
    "CREATE INDEX IF NOT EXISTS ix_profile_members_uid ON profile_members (owner_key, uid)",
]


def init_models() -> None:
    for statement in DDL:
        db.execute(statement)
    suspend_orphans()


# ==================== Phiên quét ====================


def suspend_orphans(owner: Optional[str] = None, exclude: Optional[List[int]] = None) -> None:
    """Phiên mất tiến trình chạy (app tắt) → SUSPENDED, người đang dở trở lại hàng đợi để chạy tiếp."""
    with db.session() as cur:
        cur.execute(
            """
            UPDATE profile_scan_sessions
            SET status = 'SUSPENDED', message = 'Phiên bị gián đoạn do ứng dụng đã tắt — bấm Chạy tiếp để quét phần còn lại'
            WHERE status IN ('RUNNING', 'PAUSED')
              AND heartbeat_at < NOW() - (%s * INTERVAL '1 second')
              AND (%s::text IS NULL OR owner_key = %s) AND NOT (id = ANY(%s::int[]))
            RETURNING id
            """,
            (STALE_HEARTBEAT_SECONDS, owner, owner, list(exclude or [])),
        )
        ids = [r["id"] for r in cur.fetchall()]
        if ids:
            cur.execute(
                "UPDATE profile_scan_targets SET status = 'PENDING' WHERE status = 'RUNNING' AND session_id = ANY(%s)", (ids,)
            )


def create_session(
    owner: str, mode: str, settings: Dict[str, Any], targets: List[Dict[str, Any]], sources: List[Dict[str, Any]]
) -> int:
    with db.session() as cur:
        cur.execute(
            "INSERT INTO profile_scan_sessions (owner_key, status, mode, settings) VALUES (%s, 'RUNNING', %s, %s) RETURNING id",
            (owner, mode, json.dumps(settings)),
        )
        sid = cur.fetchone()["id"]
        for s in sources:
            cur.execute(
                """
                INSERT INTO profile_sources (owner_key, source_key, type, name, url, scale, scale_label)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (owner_key, source_key) DO UPDATE
                SET name = EXCLUDED.name, url = EXCLUDED.url, scale = EXCLUDED.scale,
                    scale_label = EXCLUDED.scale_label, updated_at = NOW()
                """,
                (owner, s["key"], s["type"], s["name"], s.get("url"), s.get("scale"), s.get("scale_label")),
            )
        cur.execute(
            """
            INSERT INTO profile_scan_targets (session_id, profile_key, url, name, avatar_url, source_keys)
            SELECT %s, e->>'key', e->>'url', e->>'name', e->>'avatar',
                   ARRAY(SELECT jsonb_array_elements_text(e->'source_keys'))
            FROM jsonb_array_elements(%s::jsonb) WITH ORDINALITY AS t(e, n) ORDER BY n
            """,
            (sid, json.dumps(targets)),
        )
    return sid


def get_session(owner: str, session_id: int) -> Optional[Dict[str, Any]]:
    return db.fetch_one("SELECT * FROM profile_scan_sessions WHERE id = %s AND owner_key = %s", (session_id, owner))


def latest_session(owner: str) -> Optional[Dict[str, Any]]:
    return db.fetch_one("SELECT * FROM profile_scan_sessions WHERE owner_key = %s ORDER BY id DESC LIMIT 1", (owner,))


def session_counts(session_id: int) -> Dict[str, int]:
    rows = db.fetch_all("SELECT status, COUNT(*) AS c FROM profile_scan_targets WHERE session_id = %s GROUP BY status", (session_id,))
    by = {r["status"]: int(r["c"]) for r in rows}
    return {
        "total": sum(by.values()), "done": by.get("DONE", 0), "skipped": by.get("SKIPPED", 0),
        "failed": by.get("FAILED", 0), "pending": by.get("PENDING", 0) + by.get("RUNNING", 0),
    }


def set_status(session_id: int, status: str, message: Optional[str] = None, only_from: Optional[tuple] = None) -> bool:
    allowed = list(only_from) if only_from else None
    row = db.fetch_one(
        """
        UPDATE profile_scan_sessions
        SET status = %s, message = %s, heartbeat_at = NOW(),
            finished_at = CASE WHEN %s IN ('COMPLETED', 'STOPPED', 'FAILED') THEN NOW() ELSE NULL END
        WHERE id = %s AND (%s::text[] IS NULL OR status = ANY(%s::text[])) RETURNING id
        """,
        (status, message, status, session_id, allowed, allowed),
    )
    return bool(row)


def save_settings(session_id: int, settings: Dict[str, Any]) -> None:
    db.execute("UPDATE profile_scan_sessions SET settings = %s WHERE id = %s", (json.dumps(settings), session_id))


def heartbeat(session_id: int) -> None:
    db.execute("UPDATE profile_scan_sessions SET heartbeat_at = NOW() WHERE id = %s", (session_id,))


def log(session_id: int, message: str, level: str = "info", thread: Optional[int] = None) -> None:
    try:
        db.execute(
            "INSERT INTO profile_scan_logs (session_id, level, message, thread) VALUES (%s, %s, %s, %s)",
            (session_id, level, message[:1000], thread),
        )
    except Exception as exc:
        logger.warning(f"[Module 13] ghi log phiên #{session_id}: {exc}")


def get_logs(session_id: int, after: int) -> List[Dict[str, Any]]:
    return db.fetch_all(
        """
        SELECT * FROM (
            SELECT id, level, message, thread, TO_CHAR((created_at AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI:SS') AS time
            FROM profile_scan_logs WHERE session_id = %s AND id > %s ORDER BY id DESC LIMIT 500
        ) t ORDER BY id
        """,
        (session_id, after),
    )


def claim_target(session_id: int, account_uid: str) -> Optional[Dict[str, Any]]:
    return db.fetch_one(
        """
        UPDATE profile_scan_targets SET status = 'RUNNING', account_uid = %s, updated_at = NOW()
        WHERE id = (
            SELECT id FROM profile_scan_targets WHERE session_id = %s AND status = 'PENDING'
            ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        """,
        (account_uid, session_id),
    )


def finish_target(
    target_id: int, status: str, uid: Optional[str] = None, reason: Optional[str] = None, count_attempt: bool = True
) -> None:
    db.execute(
        "UPDATE profile_scan_targets SET status = %s, uid = %s, reason = %s, attempts = attempts + %s, updated_at = NOW() WHERE id = %s",
        (status, uid, reason, 1 if count_attempt else 0, target_id),
    )


def done_in_session(session_id: int, uid: str, except_target: int) -> bool:
    """Người này đã quét xong trong phiên, qua một mục tiêu khác (UID / username)."""
    return bool(db.fetch_one(
        "SELECT 1 FROM profile_scan_targets WHERE session_id = %s AND uid = %s AND status = 'DONE' AND id <> %s LIMIT 1",
        (session_id, uid, except_target),
    ))


def requeue_running(session_id: int) -> None:
    db.execute("UPDATE profile_scan_targets SET status = 'PENDING' WHERE session_id = %s AND status = 'RUNNING'", (session_id,))


def pending_count(session_id: int) -> int:
    return session_counts(session_id)["pending"]


# ==================== Profile ====================

FIELDS = (
    "username", "name", "url", "avatar_url", "friends", "followers", "bio", "birthday", "hometown", "location",
    "education", "job_title", "job_place", "phone", "phone_source",
)
_SELECT = """
    p.uid, p.name, p.url, p.avatar_url AS avatar, p.friends, p.followers, p.bio, p.birthday, p.hometown, p.location,
    p.education, p.job_title, p.job_place, p.phone, p.phone_source, TO_CHAR((p.scanned_at AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI') AS scanned_at
"""


def find_profile(owner: str, profile_key: str) -> Optional[Dict[str, Any]]:
    kind, value = profile_key.split(":", 1)
    if kind == "id":
        return db.fetch_one("SELECT * FROM scanned_profiles WHERE owner_key = %s AND uid = %s", (owner, value))
    return db.fetch_one("SELECT * FROM scanned_profiles WHERE owner_key = %s AND username = %s LIMIT 1", (owner, value))


# Kho người của từng loại nguồn: (bảng, cột chủ, cột nguồn, cột UID, cột tên, thứ tự, điều kiện thêm)
# Bài viết: kho người tương tác của Module 12 (chỉ lấy người, bỏ fanpage tương tác)
_SOURCE_TABLES = {
    "group": ("scanned_group_members", "owner_username", "group_id", "member_uid", "member_name", "t.scanned_at DESC, t.id DESC", ""),
    "page": ("scanned_page_followers", "owner_key", "page_key", "follower_key", "follower_name", "t.id DESC", ""),
    "post_like": ("pe_users", "owner_username", "post_key", "uid", "name", "t.id", " AND t.has_like AND NOT t.is_page"),
    "post_comment": ("pe_users", "owner_username", "post_key", "uid", "name", "t.id", " AND t.has_comment AND NOT t.is_page"),
    # Thống kê cả bài viết: người like hoặc bình luận
    "post": ("pe_users", "owner_username", "post_key", "uid", "name", "t.id", " AND (t.has_like OR t.has_comment) AND NOT t.is_page"),
}


def _table_exists(name: str) -> bool:
    """Bảng của module khác chỉ có khi module đó đã chạy lần nào."""
    row = db.fetch_one("SELECT to_regclass(%s) IS NOT NULL AS ok", (f"public.{name}",))
    return bool(row and row["ok"])


def source_posts(owner: str, search: str, limit: int = 500) -> List[Dict[str, Any]]:
    """Bài viết đã quét tương tác (Module 12) + số người (không tính fanpage) đã like / bình luận."""
    if not (_table_exists("pe_posts") and _table_exists("pe_users")):
        return []
    where = "p.owner_username = %s AND p.scanned_at IS NOT NULL"
    params: List[Any] = [owner]
    if search:
        where += " AND (p.content ILIKE %s OR p.post_key ILIKE %s OR p.fb_post_id ILIKE %s OR p.source_name ILIKE %s OR p.author_name ILIKE %s)"
        params += [f"%{search}%"] * 5
    return db.fetch_all(
        f"""
        SELECT p.post_key AS id, p.post_url AS url, p.fb_post_id, p.content, p.source_type, p.source_name, p.author_name,
            p.scanned_at, COALESCE(u.likes, 0) AS likes, COALESCE(u.comments, 0) AS comments
        FROM pe_posts p
        LEFT JOIN (
            SELECT post_key, COUNT(*) FILTER (WHERE has_like) AS likes, COUNT(*) FILTER (WHERE has_comment) AS comments
            FROM pe_users WHERE owner_username = %s AND NOT is_page GROUP BY post_key
        ) u ON u.post_key = p.post_key
        WHERE {where} ORDER BY p.scanned_at DESC LIMIT %s
        """,
        (owner, *params, limit),
    )


def source_stats(owner: str, type_: str) -> Dict[str, Dict[str, int]]:
    """Mỗi nguồn: tổng số người đã thu thập + số người trong đó đã quét thông tin profile (Module 13)."""
    table, owner_col, source_col, uid_col, _name, _order, extra = _SOURCE_TABLES[type_]
    if table == "pe_users" and not _table_exists(table):
        return {}
    rows = db.fetch_all(
        f"""
        WITH done AS (
            SELECT uid AS k FROM scanned_profiles WHERE owner_key = %s
            UNION SELECT LOWER(username) FROM scanned_profiles WHERE owner_key = %s AND username IS NOT NULL
        )
        SELECT t.{source_col} AS id, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE LOWER(REGEXP_REPLACE(t.{uid_col}, '^(id|user):', '')) IN (SELECT k FROM done))::int AS scanned
        FROM {table} t WHERE t.{owner_col} = %s{extra} GROUP BY t.{source_col}
        """,
        (owner, owner, owner),
    )
    return {str(r["id"]): {"total": r["total"], "scanned": r["scanned"]} for r in rows}


def source_people(owner: str, type_: str, source_id: str, search: str, limit: int, offset: int) -> Dict[str, Any]:
    """Người của 1 nhóm / page / bài viết; người đã quét thông tin (như find_profile) xếp xuống cuối."""
    table, owner_col, source_col, uid_col, name_col, order, extra = _SOURCE_TABLES[type_]
    if table == "pe_users" and not _table_exists(table):
        return {"items": [], "total": 0}
    where = f"t.{owner_col} = %s AND t.{source_col} = %s{extra}"
    params: List[Any] = [owner, source_id]
    if search:
        where += f" AND (t.{name_col} ILIKE %s OR t.{uid_col} ILIKE %s OR t.profile_url ILIKE %s)"
        params += [f"%{search}%"] * 3
    total = db.fetch_one(f"SELECT COUNT(*) AS c FROM {table} t WHERE {where}", tuple(params))["c"]
    items = db.fetch_all(
        f"""
        SELECT t.{uid_col} AS uid, t.{name_col} AS name, t.profile_url AS url, t.avatar_url AS avatar,
            LOWER(REGEXP_REPLACE(t.{uid_col}, '^(id|user):', '')) IN (
                SELECT uid FROM scanned_profiles WHERE owner_key = %s
                UNION ALL
                SELECT username FROM scanned_profiles WHERE owner_key = %s AND username IS NOT NULL
            ) AS scanned
        FROM {table} t WHERE {where} ORDER BY scanned, {order} LIMIT %s OFFSET %s
        """,
        (owner, owner, *params, limit, offset),
    )
    return {"items": items, "total": total}


def _add_members(cur, owner: str, keys: List[str], uid: str) -> None:
    for key in keys:
        cur.execute(
            "INSERT INTO profile_members (owner_key, collection_key, uid) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (owner, key, uid),
        )


def _link(cur, owner: str, uid: str, source_keys: List[str]) -> None:
    if source_keys:
        _add_members(cur, owner, source_keys, uid)
        return
    # Link / tệp: chưa nằm ở danh mục nào thì vào "Chưa có danh mục"
    cur.execute(
        "SELECT 1 FROM profile_members WHERE owner_key = %s AND uid = %s AND collection_key LIKE 'category:%%' LIMIT 1", (owner, uid)
    )
    if not cur.fetchone():
        _add_members(cur, owner, [UNCATEGORIZED], uid)


def link_profile(owner: str, uid: str, source_keys: List[str]) -> None:
    with db.session() as cur:
        _link(cur, owner, uid, source_keys)


def save_profile(owner: str, uid: str, data: Dict[str, Any], session_id: int, source_keys: List[str]) -> None:
    """Ghi 1 profile theo UID. Lần quét sau không đọc được trường nào thì giữ giá trị cũ của trường đó."""
    values = [data.get(f) if data.get(f) != "" else None for f in FIELDS]
    sets = ", ".join(f"{f} = COALESCE(EXCLUDED.{f}, scanned_profiles.{f})" for f in FIELDS)
    with db.session() as cur:
        cur.execute(
            f"""
            INSERT INTO scanned_profiles (owner_key, uid, {', '.join(FIELDS)}, last_session_id, scanned_at)
            VALUES (%s, %s, {', '.join(['%s'] * len(FIELDS))}, %s, NOW())
            ON CONFLICT (owner_key, uid) DO UPDATE SET {sets}, last_session_id = EXCLUDED.last_session_id, scanned_at = NOW()
            """,
            (owner, uid, *values, session_id),
        )
        # Trước đây chỉ biết username → gộp vào UID số
        if uid.isdigit() and data.get("username"):
            old = f"user:{data['username']}"
            cur.execute(
                """
                INSERT INTO profile_members (owner_key, collection_key, uid)
                SELECT owner_key, collection_key, %s FROM profile_members WHERE owner_key = %s AND uid = %s
                ON CONFLICT DO NOTHING
                """,
                (uid, owner, old),
            )
            cur.execute("DELETE FROM profile_members WHERE owner_key = %s AND uid = %s", (owner, old))
            cur.execute("DELETE FROM scanned_profiles WHERE owner_key = %s AND uid = %s", (owner, old))
        _link(cur, owner, uid, source_keys)


def session_results(owner: str, session_id: int) -> List[Dict[str, Any]]:
    """Mỗi người 1 dòng cho mỗi nguồn đã chọn trong phiên."""
    return db.fetch_all(
        f"""
        SELECT {_SELECT}, COALESCE(k.key, '') AS "sourceKey"
        FROM profile_scan_targets t
        JOIN scanned_profiles p ON p.owner_key = %s AND p.uid = t.uid
        LEFT JOIN LATERAL unnest(t.source_keys) AS k(key) ON TRUE
        WHERE t.session_id = %s AND t.status = 'DONE'
        ORDER BY t.id
        """,
        (owner, session_id),
    )


def session_sources(owner: str, session_id: int) -> List[Dict[str, Any]]:
    return db.fetch_all(
        """
        SELECT s.source_key AS key, s.type, s.name, s.url, s.scale, s.scale_label, COUNT(*)::int AS target_count
        FROM profile_scan_targets t CROSS JOIN LATERAL unnest(t.source_keys) AS k(key)
        JOIN profile_sources s ON s.owner_key = %s AND s.source_key = k.key
        WHERE t.session_id = %s
        GROUP BY s.source_key, s.type, s.name, s.url, s.scale, s.scale_label ORDER BY MIN(t.id)
        """,
        (owner, session_id),
    )


# ==================== Danh sách profile ====================


def collections(owner: str) -> List[Dict[str, Any]]:
    counts = {
        r["collection_key"]: int(r["c"])
        for r in db.fetch_all("SELECT collection_key, COUNT(*) AS c FROM profile_members WHERE owner_key = %s GROUP BY 1", (owner,))
    }
    targets = {
        r["key"]: int(r["c"])
        for r in db.fetch_all(
            """
            SELECT k.key, COUNT(DISTINCT t.profile_key) AS c
            FROM profile_scan_targets t
            JOIN profile_scan_sessions s ON s.id = t.session_id AND s.owner_key = %s
            CROSS JOIN LATERAL unnest(t.source_keys) AS k(key) GROUP BY k.key
            """,
            (owner,),
        )
    }
    out = []
    for s in db.fetch_all("SELECT * FROM profile_sources WHERE owner_key = %s ORDER BY updated_at DESC", (owner,)):
        n = counts.get(s["source_key"], 0)
        if n:
            out.append({
                "key": s["source_key"], "type": s["type"], "name": s["name"], "url": s["url"], "scale": s["scale"],
                "profile_count": n, "target_count": max(n, targets.get(s["source_key"], 0)),
            })
    for c in categories(owner):
        out.append({
            "key": f"category:{c['id']}", "type": "category", "name": c["name"], "color": c["color"], "profile_count": c["profile_count"],
        })
    out.append({"key": UNCATEGORIZED, "type": "category", "name": "Chưa có danh mục", "profile_count": counts.get(UNCATEGORIZED, 0)})
    return out


def collection_profiles(owner: str, key: str) -> List[Dict[str, Any]]:
    return db.fetch_all(
        f"""
        SELECT {_SELECT}, m.collection_key AS "sourceKey"
        FROM profile_members m JOIN scanned_profiles p ON p.owner_key = m.owner_key AND p.uid = m.uid
        WHERE m.owner_key = %s AND m.collection_key = %s ORDER BY p.scanned_at DESC, p.id DESC
        """,
        (owner, key),
    )


def categories(owner: str) -> List[Dict[str, Any]]:
    return db.fetch_all(
        """
        SELECT c.id, c.name, c.color, COUNT(m.uid)::int AS profile_count
        FROM profile_categories c
        LEFT JOIN profile_members m ON m.owner_key = c.owner_key AND m.collection_key = 'category:' || c.id
        WHERE c.owner_key = %s GROUP BY c.id, c.name, c.color ORDER BY c.id
        """,
        (owner,),
    )


def category_memberships(owner: str, uids: List[str]) -> List[Dict[str, Any]]:
    """Danh mục đang chứa các profile này: [{id, name, color, uids}] (không tính 'Chưa có danh mục')."""
    return db.fetch_all(
        """
        SELECT c.id, c.name, c.color, ARRAY_AGG(m.uid ORDER BY m.uid) AS uids
        FROM profile_members m
        JOIN profile_categories c ON c.owner_key = m.owner_key AND m.collection_key = 'category:' || c.id
        WHERE m.owner_key = %s AND m.uid = ANY(%s)
        GROUP BY c.id, c.name, c.color ORDER BY c.id
        """,
        (owner, uids),
    )


def category_exists(owner: str, key: str) -> bool:
    if key == UNCATEGORIZED:
        return True
    cid = key[len("category:"):] if key.startswith("category:") else ""
    if not (cid.isascii() and cid.isdigit() and len(cid) < 10):
        return False
    return bool(db.fetch_one("SELECT 1 AS x FROM profile_categories WHERE owner_key = %s AND id = %s", (owner, int(cid))))


def create_category(owner: str, name: str, color: str) -> int:
    return db.fetch_one("INSERT INTO profile_categories (owner_key, name, color) VALUES (%s, %s, %s) RETURNING id", (owner, name, color))["id"]


def update_category(owner: str, category_id: int, name: str, color: str) -> bool:
    return bool(db.fetch_one(
        "UPDATE profile_categories SET name = %s, color = %s WHERE owner_key = %s AND id = %s RETURNING id", (name, color, owner, category_id)
    ))


def delete_category(owner: str, category_id: int) -> bool:
    key = f"category:{category_id}"
    with db.session() as cur:
        cur.execute("DELETE FROM profile_categories WHERE owner_key = %s AND id = %s RETURNING id", (owner, category_id))
        if not cur.fetchone():
            return False
        # Còn ở danh mục khác thì không đẩy về "Chưa có danh mục"
        cur.execute(
            """
            INSERT INTO profile_members (owner_key, collection_key, uid)
            SELECT m.owner_key, %s, m.uid FROM profile_members m
            WHERE m.owner_key = %s AND m.collection_key = %s AND NOT EXISTS (
                SELECT 1 FROM profile_members o WHERE o.owner_key = m.owner_key AND o.uid = m.uid
                  AND o.collection_key LIKE 'category:%%' AND o.collection_key <> m.collection_key)
            ON CONFLICT DO NOTHING
            """,
            (UNCATEGORIZED, owner, key),
        )
        cur.execute("DELETE FROM profile_members WHERE owner_key = %s AND collection_key = %s", (owner, key))
    return True


def add_to_category(owner: str, category_id: int, uids: List[str]) -> int:
    with db.session() as cur:
        cur.execute(
            """
            INSERT INTO profile_members (owner_key, collection_key, uid)
            SELECT owner_key, %s, uid FROM scanned_profiles WHERE owner_key = %s AND uid = ANY(%s)
            ON CONFLICT DO NOTHING RETURNING uid
            """,
            (f"category:{category_id}", owner, uids),
        )
        added = len(cur.fetchall())
        cur.execute(
            "DELETE FROM profile_members WHERE owner_key = %s AND collection_key = %s AND uid = ANY(%s)", (owner, UNCATEGORIZED, uids)
        )
    return added


def move_profiles(owner: str, from_key: str, to_key: str, uids: List[str]) -> None:
    if from_key == to_key:
        return
    with db.session() as cur:
        cur.execute(
            """
            WITH moved AS (
                DELETE FROM profile_members WHERE owner_key = %s AND collection_key = %s AND uid = ANY(%s) RETURNING uid
            )
            INSERT INTO profile_members (owner_key, collection_key, uid) SELECT %s, %s, uid FROM moved ON CONFLICT DO NOTHING
            """,
            (owner, from_key, uids, owner, to_key),
        )


def delete_members(owner: str, key: str, uids: List[str]) -> int:
    """Bỏ profile khỏi danh mục; không còn ở đâu nữa thì xóa hẳn dữ liệu profile."""
    with db.session() as cur:
        cur.execute(
            "DELETE FROM profile_members WHERE owner_key = %s AND collection_key = %s AND uid = ANY(%s) RETURNING uid", (owner, key, uids)
        )
        gone = [r["uid"] for r in cur.fetchall()]
        cur.execute(
            """
            DELETE FROM scanned_profiles p WHERE p.owner_key = %s AND p.uid = ANY(%s::text[])
              AND NOT EXISTS (SELECT 1 FROM profile_members m WHERE m.owner_key = p.owner_key AND m.uid = p.uid)
            """,
            (owner, gone),
        )
    return len(gone)
