"""
Module 10 — schema + repo lưu nhóm đã quét (Supabase PostgreSQL).
Tránh quét trùng; Kiểm tra đọc lại số nhóm / từ khóa; Quản lý phiên và lịch sử quét nhóm.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any, Optional
from urllib.parse import urlparse

from core.database.connection import db

DDL_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS scanned_groups (
        id SERIAL PRIMARY KEY,
        owner_username VARCHAR(100) NOT NULL,
        group_id VARCHAR(255) NOT NULL,
        group_url TEXT NOT NULL,
        group_name VARCHAR(500),
        privacy VARCHAR(20) NOT NULL DEFAULT 'unknown',
        members_label VARCHAR(80),
        members_count INTEGER,
        keyword VARCHAR(255) NOT NULL,
        source_uid VARCHAR(50),
        note VARCHAR(50) DEFAULT '—',
        first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_groups_owner_group UNIQUE (owner_username, group_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS scanned_group_keywords (
        id SERIAL PRIMARY KEY,
        owner_username VARCHAR(100) NOT NULL,
        keyword VARCHAR(255) NOT NULL,
        group_id VARCHAR(255) NOT NULL,
        found_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_group_keywords UNIQUE (owner_username, keyword, group_id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_scanned_groups_owner ON scanned_groups (owner_username, last_seen_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_groups_keyword ON scanned_groups (owner_username, keyword);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_group_keywords_owner_kw ON scanned_group_keywords (owner_username, keyword);",
    """
    CREATE TABLE IF NOT EXISTS scanned_group_sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL UNIQUE,
        owner_username VARCHAR(100) NOT NULL,
        scan_type VARCHAR(50) NOT NULL DEFAULT 'GROUP_INFO',
        title VARCHAR(500),
        target TEXT,
        target_type VARCHAR(50) DEFAULT 'keywords',
        source_uid VARCHAR(50),
        account_name VARCHAR(255),
        total_found INTEGER DEFAULT 0,
        target_count INTEGER DEFAULT 0,
        status VARCHAR(30) DEFAULT 'SUCCESS',
        config TEXT DEFAULT '{}',
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,

    """
    CREATE TABLE IF NOT EXISTS scanned_group_categories (
        id SERIAL PRIMARY KEY,
        owner_username VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_group_categories UNIQUE (owner_username, name)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS scanned_group_category_groups (
        id SERIAL PRIMARY KEY,
        owner_username VARCHAR(100) NOT NULL,
        category_name VARCHAR(255) NOT NULL,
        group_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_group_cat_group UNIQUE (owner_username, category_name, group_id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_scanned_group_sessions_owner ON scanned_group_sessions (owner_username, created_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_group_cat_owner ON scanned_group_categories (owner_username, name);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_group_cat_grp_owner ON scanned_group_category_groups (owner_username, category_name);",
    """
    CREATE TABLE IF NOT EXISTS scanned_group_members (
        id SERIAL PRIMARY KEY,
        owner_username VARCHAR(100) NOT NULL,
        group_id VARCHAR(255) NOT NULL,
        group_name VARCHAR(500),
        group_url TEXT,
        member_uid VARCHAR(100) NOT NULL,
        member_name VARCHAR(500),
        profile_url TEXT,
        avatar_url TEXT,
        friend_count INTEGER DEFAULT 0,
        role VARCHAR(50) DEFAULT 'member',
        joined_date VARCHAR(100),
        session_id VARCHAR(64),
        scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_group_members UNIQUE (owner_username, group_id, member_uid)
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_scanned_group_members_owner_grp ON scanned_group_members (owner_username, group_id);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_group_members_uid ON scanned_group_members (owner_username, member_uid);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_group_members_time ON scanned_group_members (owner_username, scanned_at DESC);",
    """
    CREATE TABLE IF NOT EXISTS scanned_group_posts (
        id SERIAL PRIMARY KEY,
        owner_username VARCHAR(100) NOT NULL,
        group_id VARCHAR(255) NOT NULL,
        group_name VARCHAR(500),
        group_url TEXT,
        post_id VARCHAR(100) NOT NULL,
        post_url TEXT NOT NULL,
        content TEXT,
        author_name VARCHAR(500),
        author_uid VARCHAR(100),
        author_url TEXT,
        likes_count INTEGER DEFAULT 0,
        comments_count INTEGER DEFAULT 0,
        shares_count INTEGER DEFAULT 0,
        posted_at VARCHAR(100),
        is_pinned BOOLEAN DEFAULT FALSE,
        session_id VARCHAR(64),
        scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_group_posts UNIQUE (owner_username, group_id, post_id)
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_scanned_group_posts_owner_grp ON scanned_group_posts (owner_username, group_id);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_group_posts_post_id ON scanned_group_posts (owner_username, post_id);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_group_posts_time ON scanned_group_posts (owner_username, scanned_at DESC);",
]


def _normalize_existing_keywords() -> None:
    """Gộp bản ghi khác hoa/thường về 1 keyword chuẩn (casefold)."""
    try:
        rows = db.fetch_all("SELECT id, keyword FROM scanned_group_keywords")
        for row in rows:
            kid = row.get("id")
            raw = row.get("keyword") or ""
            norm = normalize_keyword(raw)
            if not kid or not norm or norm == raw:
                continue
            db.execute(
                "UPDATE scanned_group_keywords SET keyword = ? WHERE id = ?",
                (norm, kid),
            )
        # Xóa trùng sau khi chuẩn hoá (giữ id nhỏ nhất)
        db.execute(
            """
            DELETE FROM scanned_group_keywords a
            USING scanned_group_keywords b
            WHERE a.owner_username = b.owner_username
              AND a.keyword = b.keyword
              AND a.group_id = b.group_id
              AND a.id > b.id
            """
        )
        db.execute(
            """
            UPDATE scanned_groups
            SET keyword = lower(keyword)
            WHERE keyword IS NOT NULL AND keyword <> lower(keyword)
            """
        )
    except Exception as exc:
        print(f"[Module 10 DB] keyword normalize note: {exc}")


def init_models() -> None:
    # Tự động di chuyển/đổi tên bảng cũ sang tên chuẩn bắt đầu bằng scanned_ (nếu có)
    rename_statements = [
        "ALTER TABLE IF EXISTS group_scan_sessions RENAME TO scanned_group_sessions;",
        "ALTER TABLE IF EXISTS group_scan_categories RENAME TO scanned_group_categories;",
        "ALTER TABLE IF EXISTS group_scan_category_groups RENAME TO scanned_group_category_groups;",
    ]
    for r_stmt in rename_statements:
        try:
            db.execute(r_stmt)
        except Exception:
            pass

    # Luôn loại bỏ bảng scanned_group_session_logs nếu có để không tốn dung lượng DB
    try:
        db.execute("DROP TABLE IF EXISTS scanned_group_session_logs CASCADE;")
    except Exception:
        pass

    for statement in DDL_STATEMENTS:
        try:
            db.execute(statement)
        except Exception as exc:
            print(f"[Module 10 DB] DDL error: {exc}")

    # Đảm bảo cột note luôn tồn tại trong scanned_groups
    try:
        db.execute("ALTER TABLE scanned_groups ADD COLUMN IF NOT EXISTS note VARCHAR(50) DEFAULT '—';")
    except Exception as exc:
        print(f"[Module 10 DB] add note column error: {exc}")

    _normalize_existing_keywords()
    _sync_keywords_to_categories()
    print("[Module 10 DB] Schema scanned_groups / scanned_group_keywords / scanned_group_sessions ready.")


def _sync_keywords_to_categories() -> None:
    """Tự động đồng bộ các từ khóa hiện có trong scanned_groups vào bảng scanned_group_categories và liên kết nhóm."""
    try:
        db.execute(
            """
            INSERT INTO scanned_group_categories (owner_username, name, description)
            SELECT DISTINCT owner_username, keyword, 'Danh mục từ khóa: ' || keyword
            FROM scanned_groups
            WHERE keyword IS NOT NULL AND TRIM(keyword) != ''
              AND lower(keyword) != 'directlink'
              AND keyword NOT LIKE 'http%'
              AND keyword NOT LIKE '%facebook.com%'
              AND keyword NOT LIKE '%fb.com%'
            ON CONFLICT (owner_username, name) DO NOTHING;
            """
        )
        db.execute(
            """
            INSERT INTO scanned_group_category_groups (owner_username, category_name, group_id)
            SELECT DISTINCT owner_username, keyword, group_id
            FROM scanned_groups
            WHERE keyword IS NOT NULL AND TRIM(keyword) != ''
              AND lower(keyword) != 'directlink'
              AND keyword NOT LIKE 'http%'
              AND keyword NOT LIKE '%facebook.com%'
              AND keyword NOT LIKE '%fb.com%'
            ON CONFLICT (owner_username, category_name, group_id) DO NOTHING;
            """
        )
    except Exception as exc:
        print(f"[Module 10 DB] sync keyword categories error: {exc}")


def normalize_keyword(raw: Any) -> str:
    """
    Chuẩn hoá từ khóa để so khớp: không phân biệt hoa/thường, gộp khoảng trắng.
    'Bán hàng online' == 'BÁN HÀNG ONLINE' == 'bán Hàng oNline'
    """
    text = re.sub(r"\s+", " ", str(raw or "").strip())
    if not text:
        return ""
    try:
        return text.casefold()
    except Exception:
        return text.lower()


def normalize_group_id(url_or_id: str) -> str:
    raw = (url_or_id or "").strip()
    if not raw:
        return ""
    if "/groups/" in raw:
        slug = raw.split("/groups/")[-1].split("/")[0].split("?")[0].strip()
        return slug.lower()
    return raw.strip().lower()


def normalize_group_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    # Strip protocol and host variants
    raw = re.sub(r"^https?://", "", raw, flags=re.I)
    raw = re.sub(r"^(?:(?:www|web|m)\.)?facebook\.com/", "", raw, flags=re.I)
    raw = raw.lstrip("/")
    if raw.startswith("groups/"):
        slug = raw.split("groups/")[1].split("?")[0].strip("/").split("/")[0].strip()
        if slug:
            return f"https://www.facebook.com/groups/{slug}"
    elif "/groups/" in raw:
        slug = raw.split("/groups/")[1].split("?")[0].strip("/").split("/")[0].strip()
        if slug:
            return f"https://www.facebook.com/groups/{slug}"
    elif raw and not raw.isdigit() and "/" not in raw:
        return f"https://www.facebook.com/groups/{raw}"
    elif raw and raw.isdigit() and len(raw) >= 8:
        return f"https://www.facebook.com/groups/{raw}"
    return raw.split("?")[0].rstrip("/")


def list_known_group_ids(owner: Optional[str]) -> set[str]:
    owner = (owner or "").strip()
    if not owner:
        return set()
    rows = db.fetch_all(
        "SELECT group_id FROM scanned_groups WHERE owner_username = ?",
        (owner,),
    )
    return {str(r.get("group_id") or "").lower() for r in rows if r.get("group_id")}


def keyword_counts(owner: Optional[str], keywords: list[str]) -> dict[str, int]:
    """Số nhóm đã lưu theo từng từ khóa (bảng liên kết)."""
    owner = (owner or "").strip()
    out = {str(k).strip(): 0 for k in keywords if str(k).strip()}
    if not owner or not out:
        return out
    for word in list(out.keys()):
        row = db.fetch_one(
            """
            SELECT COUNT(*) AS cnt
            FROM scanned_group_keywords
            WHERE owner_username = ? AND keyword = ?
            """,
            (owner, normalize_keyword(word)),
        )
        out[word] = int((row or {}).get("cnt") or 0)
    return out


def list_groups_for_keywords(
    owner: Optional[str],
    keywords: list[str],
    *,
    limit: int = 500,
) -> list[dict[str, Any]]:
    owner = (owner or "").strip()
    words = [str(k).strip() for k in keywords if str(k).strip()]
    if not owner or not words:
        return []
    # Lấy theo từng keyword rồi gộp (tránh SQL IN động phức tạp)
    by_id: dict[str, dict[str, Any]] = {}
    for word in words:
        rows = db.fetch_all(
            """
            SELECT g.group_id, g.group_url, g.group_name, g.privacy,
                   g.members_label, g.members_count, k.keyword, g.source_uid,
                   g.last_seen_at, g.note
            FROM scanned_group_keywords k
            JOIN scanned_groups g
              ON g.owner_username = k.owner_username AND g.group_id = k.group_id
            WHERE k.owner_username = ? AND k.keyword = ?
            ORDER BY k.found_at DESC
            LIMIT ?
            """,
            (owner, normalize_keyword(word), max(1, min(2000, int(limit)))),
        )
        for row in rows:
            gid = str(row.get("group_id") or "")
            if not gid or gid in by_id:
                continue
            href = normalize_group_url(row.get("group_url") or "")
            privacy = row.get("privacy") or "unknown"
            note_val = row.get("note")
            if not note_val or note_val == "—":
                note_val = "not_joined" if privacy == "private" else "—"
            by_id[gid] = {
                "id": href or gid,
                "keyword": word,
                "name": row.get("group_name") or gid,
                "type": privacy,
                "members": row.get("members_label") or "—",
                "members_count": row.get("members_count"),
                "url": (href or "").replace("https://www.", "").replace("https://", ""),
                "href": href,
                "note": note_val,
            }
    return list(by_id.values())


def list_all_scanned_groups(
    owner: Optional[str],
    *,
    keyword: Optional[str] = None,
    privacy: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 1000,
    offset: int = 0,
) -> dict[str, Any]:
    owner = (owner or "").strip()
    if not owner:
        return {"groups": [], "total": 0, "keywords": []}

    conditions = ["g.owner_username = ?"]
    params: list[Any] = [owner]

    if keyword and str(keyword).strip() and str(keyword).strip().lower() != "all":
        conditions.append("g.keyword = ?")
        params.append(normalize_keyword(keyword))

    if privacy and str(privacy).strip() and str(privacy).strip().lower() != "all":
        conditions.append("g.privacy = ?")
        params.append(str(privacy).strip().lower())

    if search and str(search).strip():
        s = f"%{str(search).strip().lower()}%"
        conditions.append(
            "(lower(g.group_name) LIKE ? OR lower(g.group_id) LIKE ? OR lower(g.keyword) LIKE ? OR lower(g.group_url) LIKE ?)"
        )
        params.extend([s, s, s, s])

    where_clause = " AND ".join(conditions)

    count_row = db.fetch_one(
        f"SELECT COUNT(*) AS c FROM scanned_groups g WHERE {where_clause}",
        tuple(params),
    )
    total = int((count_row or {}).get("c") or 0)

    rows = db.fetch_all(
        f"""
        SELECT g.id, g.owner_username, g.group_id, g.group_url, g.group_name, g.privacy,
               g.members_label, g.members_count, g.keyword, g.source_uid,
               g.created_at, g.last_seen_at, g.note,
               COALESCE(NULLIF(cg.category_name, ''), g.keyword, '') AS category_name,
               c.id as category_db_id
        FROM scanned_groups g
        LEFT JOIN (
            SELECT group_id, MAX(category_name) as category_name
            FROM scanned_group_category_groups
            WHERE owner_username = ?
            GROUP BY group_id
        ) cg ON cg.group_id = g.group_id
        LEFT JOIN scanned_group_categories c
            ON c.owner_username = g.owner_username AND lower(c.name) = lower(COALESCE(NULLIF(cg.category_name, ''), g.keyword))
        WHERE {where_clause}
        ORDER BY g.created_at DESC
        LIMIT ? OFFSET ?
        """,
        tuple([owner] + params + [max(1, int(limit)), max(0, int(offset))]),
    )

    kw_rows = db.fetch_all(
        """
        SELECT keyword, COUNT(*) as count, SUM(COALESCE(members_count, 0)) as total_members
        FROM scanned_groups
        WHERE owner_username = ?
        GROUP BY keyword
        ORDER BY count DESC
        """,
        (owner,),
    )

    out_groups = []
    for idx, r in enumerate(rows, start=offset + 1):
        gid = str(r.get("group_id") or "")
        href = normalize_group_url(r.get("group_url") or "")
        privacy_val = r.get("privacy") or "unknown"
        created_dt = r.get("created_at")
        created_str = (
            created_dt.strftime("%d/%m/%Y %H:%M")
            if hasattr(created_dt, "strftime")
            else str(created_dt or "")
        )
        cat_name = r.get("category_name") or r.get("keyword") or ""
        cat_db_id = r.get("category_db_id")
        note_val = r.get("note")
        if not note_val or note_val == "—":
            note_val = "not_joined" if privacy_val == "private" else "—"
        out_groups.append({
            "id": str(r.get("id") or gid),
            "stt": idx,
            "group_id": gid,
            "categoryId": f"cat-{cat_db_id}" if cat_db_id else (f"cat-{cat_name}" if cat_name else ""),
            "category_name": cat_name,
            "keyword": r.get("keyword") or "",
            "name": r.get("group_name") or gid,
            "type": privacy_val,
            "members": r.get("members_label") or "—",
            "membersCount": r.get("members_count"),
            "url": href or f"https://www.facebook.com/groups/{gid}",
            "href": href or f"https://www.facebook.com/groups/{gid}",
            "source_uid": r.get("source_uid") or "",
            "created_at": created_str,
            "note": note_val,
            "initialChecked": False,
        })

    return {
        "groups": out_groups,
        "total": total,
        "keywords": [
            {
                "keyword": kr.get("keyword") or "",
                "count": int(kr.get("count") or 0),
                "total_members": int(kr.get("total_members") or 0),
            }
            for kr in kw_rows
            if kr.get("keyword")
        ],
        "categories": list_scan_categories(owner),
    }


def delete_scanned_group(owner: Optional[str], group_id_or_id: Any) -> bool:
    owner = (owner or "").strip()
    if not owner or not group_id_or_id:
        return False
    val = str(group_id_or_id).strip()
    if val.isdigit():
        row = db.fetch_one(
            "SELECT group_id FROM scanned_groups WHERE owner_username = ? AND id = ?",
            (owner, int(val)),
        )
        if row and row.get("group_id"):
            db.execute(
                "DELETE FROM scanned_group_keywords WHERE owner_username = ? AND group_id = ?",
                (owner, row["group_id"]),
            )
        db.execute(
            "DELETE FROM scanned_groups WHERE owner_username = ? AND id = ?",
            (owner, int(val)),
        )
    else:
        db.execute(
            "DELETE FROM scanned_group_keywords WHERE owner_username = ? AND group_id = ?",
            (owner, val),
        )
        db.execute(
            "DELETE FROM scanned_groups WHERE owner_username = ? AND group_id = ?",
            (owner, val),
        )
    return True


def delete_scanned_groups_bulk(owner: Optional[str], ids: list[Any]) -> int:
    owner = (owner or "").strip()
    if not owner or not ids:
        return 0
    cnt = 0
    for item_id in ids:
        if delete_scanned_group(owner, item_id):
            cnt += 1
    return cnt


def clean_group_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", str(raw or "").strip())
    name = name.split("\n")[0].strip()
    name = re.sub(r"^[\(\[]\d+\+?[\)\]]\s*", "", name).strip()
    name = re.sub(r"^(Profile photo of|Ảnh đại diện của|Anh dai dien cua)\s*", "", name, flags=re.I).strip()
    name = re.sub(r"\s*\|\s*Facebook$", "", name, flags=re.I).strip()
    name = re.sub(r"^[\(\[]\d+\+?[\)\]]\s*", "", name).strip()
    return name

def upsert_scanned_group(
    *,
    owner: Optional[str],
    keyword: str,
    group: dict[str, Any],
    source_uid: Optional[str] = None,
) -> bool:
    """
    Lưu nhóm mới. Trả True nếu INSERT mới, False nếu đã có (chỉ cập nhật meta / gắn keyword).
    """
    owner = (owner or "").strip()
    keyword = normalize_keyword(keyword)
    if not owner or not keyword:
        return False

    href = normalize_group_url(group.get("href") or group.get("url") or "")
    gid = normalize_group_id(group.get("group_id") or href)
    if not gid or not href:
        return False

    name = clean_group_name(group.get("name") or "")[:500]
    privacy = str(group.get("type") or group.get("privacy") or "unknown")[:20]
    members_label = (group.get("members") or group.get("members_label") or "")[:80] or None
    members_count = group.get("members_count")
    try:
        members_count = int(members_count) if members_count is not None else None
    except (TypeError, ValueError):
        members_count = None
    uid = (source_uid or group.get("source_uid") or "")[:50] or None
    note_val = str(group.get("note") or "").strip()[:50]
    if not note_val or note_val == "None":
        note_val = "not_joined" if privacy == "private" else "—"

    existing = db.fetch_one(
        "SELECT id FROM scanned_groups WHERE owner_username = ? AND group_id = ?",
        (owner, gid),
    )
    is_new = existing is None

    if is_new:
        db.execute(
            """
            INSERT INTO scanned_groups (
                owner_username, group_id, group_url, group_name, privacy,
                members_label, members_count, keyword, source_uid, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (owner, gid, href, name, privacy, members_label, members_count, keyword, uid, note_val),
        )
    else:
        db.execute(
            """
            UPDATE scanned_groups SET
                group_url = ?,
                group_name = COALESCE(NULLIF(?, ''), group_name),
                privacy = CASE WHEN ? IN ('public','private') THEN ? ELSE privacy END,
                members_label = COALESCE(?, members_label),
                members_count = COALESCE(?, members_count),
                source_uid = COALESCE(?, source_uid),
                note = CASE WHEN ? != '—' AND ? != '' THEN ? ELSE note END,
                last_seen_at = CURRENT_TIMESTAMP
            WHERE owner_username = ? AND group_id = ?
            """,
            (
                href,
                name,
                privacy,
                privacy,
                members_label,
                members_count,
                uid,
                note_val,
                note_val,
                note_val,
                owner,
                gid,
            ),
        )

    # Gắn từ khóa (idempotent)
    db.execute(
        """
        INSERT INTO scanned_group_keywords (owner_username, keyword, group_id)
        VALUES (?, ?, ?)
        ON CONFLICT (owner_username, keyword, group_id) DO NOTHING
        """,
        (owner, keyword, gid),
    )

    # Đảm bảo từ khóa tạo thành 1 DANH MỤC trong scanned_group_categories và liên kết nhóm
    try:
        create_scan_category(owner, keyword, f"Danh mục từ khóa: {keyword}")
        db.execute(
            """
            INSERT INTO scanned_group_category_groups (owner_username, category_name, group_id)
            VALUES (?, ?, ?)
            ON CONFLICT (owner_username, category_name, group_id) DO NOTHING
            """,
            (owner, keyword, gid),
        )
    except Exception as exc:
        print(f"[Module 10 DB] link category error: {exc}")

    return is_new


# ─────────────────────────────────────────────────────────────────────────────
# SCAN SESSIONS & HISTORY
# ─────────────────────────────────────────────────────────────────────────────

def create_scan_session(
    *,
    owner: Optional[str],
    session_id: str,
    scan_type: str = "GROUP_INFO",
    title: str = "",
    target: str = "",
    target_type: str = "keywords",
    source_uid: Optional[str] = None,
    account_name: Optional[str] = None,
    target_count: int = 0,
    config: str = "{}",
) -> bool:
    owner = (owner or "").strip()
    if not owner or not session_id:
        return False
    try:
        db.execute(
            """
            INSERT INTO scanned_group_sessions (
                session_id, owner_username, scan_type, title, target,
                target_type, source_uid, account_name, target_count, config, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING')
            ON CONFLICT (session_id) DO UPDATE SET
                status = 'RUNNING',
                target_count = EXCLUDED.target_count
            """,
            (
                session_id,
                owner,
                scan_type,
                title or "Quét thông tin nhóm",
                target,
                target_type,
                source_uid,
                account_name or source_uid or "",
                target_count,
                config,
            ),
        )
        return True
    except Exception as exc:
        print(f"[Module 10 DB] create_scan_session error: {exc}")
        return False


def update_scan_session(
    session_id: str,
    *,
    total_found: Optional[int] = None,
    status: Optional[str] = None,
    finished: bool = False,
) -> bool:
    if not session_id:
        return False
    updates = []
    params = []
    if total_found is not None:
        updates.append("total_found = ?")
        params.append(int(total_found))
    if status is not None:
        updates.append("status = ?")
        params.append(str(status))
    if finished:
        updates.append("finished_at = CURRENT_TIMESTAMP")
    if not updates:
        return False
    params.append(session_id)
    try:
        db.execute(
            f"UPDATE scanned_group_sessions SET {', '.join(updates)} WHERE session_id = ?",
            tuple(params),
        )
        return True
    except Exception as exc:
        print(f"[Module 10 DB] update_scan_session error: {exc}")
        return False


def add_session_log(session_id: str, level: str, message: str) -> None:
    """Không lưu log chi tiết vào database để tối ưu hiệu năng và dung lượng."""
    return


def list_scan_sessions(
    owner: Optional[str],
    *,
    search: Optional[str] = None,
    scan_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    owner = (owner or "").strip()
    if not owner:
        return []

    conditions = ["owner_username = ?"]
    params: list[Any] = [owner]

    if scan_type and str(scan_type).upper() != "ALL":
        conditions.append("scan_type = ?")
        params.append(str(scan_type).upper())

    if status and str(status).upper() != "ALL":
        conditions.append("status = ?")
        params.append(str(status).upper())

    if search and str(search).strip():
        s = f"%{str(search).strip().lower()}%"
        conditions.append(
            "(lower(title) LIKE ? OR lower(target) LIKE ? OR lower(session_id) LIKE ? OR lower(source_uid) LIKE ?)"
        )
        params.extend([s, s, s, s])

    where_clause = " AND ".join(conditions)

    rows = db.fetch_all(
        f"""
        SELECT id, session_id, owner_username, scan_type, title, target,
               target_type, source_uid, account_name, total_found, target_count,
               status, config, started_at, finished_at, created_at
        FROM scanned_group_sessions
        WHERE {where_clause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        """,
        tuple(params + [max(1, int(limit)), max(0, int(offset))]),
    )

    out = []
    for r in rows:
        sid = r.get("session_id") or ""
        started = r.get("started_at")
        finished = r.get("finished_at")
        start_str = (
            started.strftime("%d/%m/%Y %H:%M:%S")
            if hasattr(started, "strftime")
            else str(started or "")
        )
        end_str = (
            finished.strftime("%d/%m/%Y %H:%M:%S")
            if hasattr(finished, "strftime")
            else "—"
        )

        duration_str = "—"
        if started and finished and hasattr(finished, "__sub__") and hasattr(started, "year"):
            try:
                diff = finished - started
                sec = int(diff.total_seconds())
                if sec >= 60:
                    duration_str = f"{sec // 60}m {sec % 60}s"
                else:
                    duration_str = f"{sec}s"
            except Exception:
                duration_str = "—"

        cfg_raw = r.get("config") or "{}"
        try:
            cfg = json.loads(cfg_raw) if isinstance(cfg_raw, str) else cfg_raw
        except Exception:
            cfg = {}

        target_words = [w.strip() for w in str(r.get("target") or "").split(",") if w.strip()]
        sample_results = []
        if target_words:
            sample_results = list_groups_for_keywords(owner, target_words, limit=10)

        logs_list = [
            {
                "time": start_str.split(" ")[-1] if " " in start_str else "00:00:00",
                "level": "INFO",
                "message": f"Bắt đầu phiên quét {sid}",
            },
            {
                "time": end_str.split(" ")[-1] if " " in end_str else "00:00:00",
                "level": "SUCCESS",
                "message": f"Hoàn tất quét. Thu thập được {r.get('total_found') or len(sample_results)} kết quả.",
            },
        ]

        total_cnt = int(r.get("total_found") or len(sample_results))
        target_cnt = int(r.get("target_count") or max(total_cnt, 30))
        pct = 100 if target_cnt <= 0 else min(100, int((total_cnt / target_cnt) * 100))

        out.append({
            "id": sid,
            "type": r.get("scan_type") or "GROUP_INFO",
            "title": r.get("title") or "Quét thông tin nhóm",
            "target": r.get("target") or "—",
            "targetType": r.get("target_type") or "keywords",
            "account": {
                "uid": r.get("source_uid") or "",
                "name": r.get("account_name") or r.get("source_uid") or "Tài khoản quét",
                "avatarText": (r.get("account_name") or "FB")[:2].upper(),
                "avatarBg": "bg-blue-600",
            },
            "progress": {
                "collected": total_cnt,
                "target": target_cnt,
                "percentage": pct,
                "unit": "nhóm",
            },
            "startTime": start_str,
            "endTime": end_str,
            "duration": duration_str,
            "status": r.get("status") or "SUCCESS",
            "config": {
                "delay": cfg.get("delay") or "5 - 10s",
                "privacy": cfg.get("privacy") or "Tất cả",
                "minMembers": cfg.get("minMembers") or "—",
                "maxKeywords": cfg.get("maxKeywords") or len(target_words) or 1,
            },
            "logs": logs_list or [
                {
                    "time": start_str.split(" ")[-1] if " " in start_str else "00:00:00",
                    "level": "INFO",
                    "message": f"Bắt đầu phiên quét {sid}",
                },
                {
                    "time": end_str.split(" ")[-1] if " " in end_str else "00:00:00",
                    "level": "SUCCESS",
                    "message": f"Hoàn tất quét. Thu thập được {total_cnt} nhóm vào CSDL.",
                },
            ],
            "sampleResults": [
                {
                    "id": sr.get("id") or sr.get("url"),
                    "name": sr.get("name"),
                    "privacy": "Công khai" if sr.get("type") == "public" else "Riêng tư",
                    "members": f"{sr.get('members')} TV",
                    "url": sr.get("href") or f"https://{sr.get('url')}",
                }
                for sr in sample_results
            ],
        })

    return out


def delete_scan_session(owner: Optional[str], session_id: str) -> bool:
    owner = (owner or "").strip()
    if not owner or not session_id:
        return False
    db.execute(
        "DELETE FROM scanned_group_sessions WHERE owner_username = ? AND session_id = ?",
        (owner, session_id),
    )
    return True


def delete_scan_sessions_bulk(owner: Optional[str], session_ids: list[str]) -> int:
    owner = (owner or "").strip()
    if not owner or not session_ids:
        return 0
    cnt = 0
    for sid in session_ids:
        if delete_scan_session(owner, sid):
            cnt += 1
    return cnt


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORIES & SHARED LIST
# ─────────────────────────────────────────────────────────────────────────────


def list_scan_categories(owner: Optional[str]) -> list[dict[str, Any]]:
    owner = (owner or "").strip()
    if not owner:
        return []
    try:
        existing = db.fetch_all(
            "SELECT id, name, description FROM scanned_group_categories WHERE owner_username = ? ORDER BY id ASC",
            (owner,),
        )
        if not existing:
            return []

        cat_counts_rows = db.fetch_all(
            """
            SELECT c.name, COUNT(DISTINCT COALESCE(cg.group_id, g.group_id)) as count
            FROM scanned_group_categories c
            LEFT JOIN scanned_group_category_groups cg
                ON cg.owner_username = c.owner_username AND lower(cg.category_name) = lower(c.name)
            LEFT JOIN scanned_groups g
                ON g.owner_username = c.owner_username AND lower(g.keyword) = lower(c.name)
            WHERE c.owner_username = ?
            GROUP BY c.id, c.name
            ORDER BY c.id ASC
            """,
            (owner,),
        )
        counts_map = {str(r["name"]).lower(): int(r.get("count") or 0) for r in cat_counts_rows if r.get("name")}

        result = []
        for c in existing:
            cname = c.get("name") or ""
            count = counts_map.get(cname.lower(), 0)
            result.append({
                "id": f"cat-{c.get('id')}",
                "name": cname,
                "count": count,
                "description": c.get("description") or "",
            })
        return result
    except Exception as exc:
        print(f"[Module 10 DB] list_scan_categories error: {exc}")
        return []


def update_scan_category(owner: Optional[str], cat_id_or_name: Any, new_name: str) -> dict[str, Any]:
    owner = (owner or "").strip()
    new_name = (new_name or "").strip()
    if not owner or not new_name:
        return {"ok": False, "error": "Thiếu thông tin cập nhật"}
    try:
        val = str(cat_id_or_name).replace("cat-", "").strip()
        old_cat = None
        if val.isdigit():
            old_cat = db.fetch_one(
                "SELECT id, name FROM scanned_group_categories WHERE owner_username = ? AND id = ?",
                (owner, int(val)),
            )
        if not old_cat:
            old_cat = db.fetch_one(
                "SELECT id, name FROM scanned_group_categories WHERE owner_username = ? AND name = ?",
                (owner, str(cat_id_or_name).strip()),
            )
        if not old_cat:
            return {"ok": False, "error": "Không tìm thấy danh mục"}

        old_name = old_cat["name"]
        cat_id = old_cat["id"]

        db.execute(
            "UPDATE scanned_group_categories SET name = ? WHERE owner_username = ? AND id = ?",
            (new_name, owner, cat_id),
        )

        if old_name != new_name:
            db.execute(
                "UPDATE scanned_group_category_groups SET category_name = ? WHERE owner_username = ? AND category_name = ?",
                (new_name, owner, old_name),
            )

        return {"ok": True, "id": f"cat-{cat_id}", "name": new_name}
    except Exception as exc:
        print(f"[Module 10 DB] update_scan_category error: {exc}")
        return {"ok": False, "error": str(exc)}


def delete_scan_category(owner: Optional[str], cat_id_or_name: Any) -> bool:
    owner = (owner or "").strip()
    if not owner or not cat_id_or_name:
        return False
    try:
        val = str(cat_id_or_name).replace("cat-", "").strip()
        old_cat = None
        if val.isdigit():
            old_cat = db.fetch_one(
                "SELECT id, name FROM scanned_group_categories WHERE owner_username = ? AND id = ?",
                (owner, int(val)),
            )
        if not old_cat:
            old_cat = db.fetch_one(
                "SELECT id, name FROM scanned_group_categories WHERE owner_username = ? AND name = ?",
                (owner, str(cat_id_or_name).strip()),
            )
        if not old_cat:
            return False

        cat_name = old_cat["name"]
        cat_id = old_cat["id"]

        db.execute(
            "DELETE FROM scanned_group_category_groups WHERE owner_username = ? AND category_name = ?",
            (owner, cat_name),
        )

        db.execute(
            "DELETE FROM scanned_group_categories WHERE owner_username = ? AND id = ?",
            (owner, cat_id),
        )
        return True
    except Exception as exc:
        print(f"[Module 10 DB] delete_scan_category error: {exc}")
        return False


def move_groups_to_category(owner: Optional[str], target_category_name: str, group_ids: list[Any]) -> int:
    owner = (owner or "").strip()
    target_category_name = (target_category_name or "").strip()
    if not owner or not target_category_name or not group_ids:
        return 0

    create_scan_category(owner, target_category_name)

    moved_count = 0
    for gid_raw in group_ids:
        gid_str = str(gid_raw).strip()
        actual_gid = gid_str
        if gid_str.isdigit():
            row = db.fetch_one(
                "SELECT group_id FROM scanned_groups WHERE owner_username = ? AND id = ?",
                (owner, int(gid_str)),
            )
            if row and row.get("group_id"):
                actual_gid = row["group_id"]
        elif "/groups/" in gid_str:
            actual_gid = normalize_group_id(gid_str)

        try:
            db.execute(
                "DELETE FROM scanned_group_category_groups WHERE owner_username = ? AND group_id = ?",
                (owner, actual_gid),
            )
            db.execute(
                """
                INSERT INTO scanned_group_category_groups (owner_username, category_name, group_id)
                VALUES (?, ?, ?)
                ON CONFLICT (owner_username, category_name, group_id) DO NOTHING
                """,
                (owner, target_category_name, actual_gid),
            )
            moved_count += 1
        except Exception as exc:
            print(f"[Module 10 DB] move group {actual_gid} error: {exc}")

    return moved_count


def create_scan_category(owner: Optional[str], name: str, description: str = "") -> dict[str, Any]:
    owner = (owner or "").strip()
    name = re.sub(r"\s+", " ", (name or "").strip())
    if not owner or not name:
        return {"ok": False, "error": "Thiếu tên danh mục"}
    name_lower = name.lower()
    if (
        name_lower.startswith("http")
        or "/groups/" in name_lower
        or "facebook.com" in name_lower
        or "fb.com" in name_lower
        or name_lower == "directlink"
    ):
        return {"ok": False, "error": "Không tạo danh mục cho liên kết URL hoặc directlink"}
    try:
        row = db.fetch_one(
            "SELECT id, name, description FROM scanned_group_categories WHERE owner_username = ? AND lower(name) = lower(?)",
            (owner, name),
        )
        if not row:
            db.execute(
                """
                INSERT INTO scanned_group_categories (owner_username, name, description)
                VALUES (?, ?, ?)
                ON CONFLICT (owner_username, name) DO NOTHING
                """,
                (owner, name, description or "Danh mục nhóm tự tạo"),
            )
            row = db.fetch_one(
                "SELECT id, name, description FROM scanned_group_categories WHERE owner_username = ? AND lower(name) = lower(?)",
                (owner, name),
            )
        return {
            "ok": True,
            "category": {
                "id": f"cat-{row['id']}" if row else f"cat-{abs(hash(name)) % 10000}",
                "name": row["name"] if row else name,
                "count": 0,
                "description": (row["description"] if row else description) or "",
            },
        }
    except Exception as exc:
        print(f"[Module 10 DB] create_scan_category error: {exc}")
        return {"ok": False, "error": str(exc)}


def save_groups_to_category(
    owner: Optional[str],
    category_name: str,
    groups: list[dict[str, Any]],
    deduplicate: bool = True,
) -> dict[str, Any]:
    owner = (owner or "").strip()
    category_name = (category_name or "").strip()
    if not owner or not category_name:
        return {"ok": False, "saved_count": 0, "error": "Thiếu danh mục hoặc tài khoản"}

    create_scan_category(owner, category_name)

    saved_count = 0
    new_inserted = 0

    for item in groups or []:
        href = normalize_group_url(item.get("href") or item.get("url") or "")
        gid = normalize_group_id(item.get("group_id") or item.get("id") or href)
        if not gid or not href:
            continue

        kw = item.get("keyword") or category_name
        is_new = upsert_scanned_group(
            owner=owner,
            keyword=kw,
            group=item,
            source_uid=item.get("source_uid") or "",
        )
        if is_new:
            new_inserted += 1

        try:
            db.execute(
                """
                INSERT INTO scanned_group_category_groups (owner_username, category_name, group_id)
                VALUES (?, ?, ?)
                ON CONFLICT (owner_username, category_name, group_id) DO NOTHING
                """,
                (owner, category_name, gid),
            )
            saved_count += 1
        except Exception:
            pass

    try:
        sid = f"SCN-2026-{abs(hash(f'{owner}_{category_name}_{time.time()}')) % 9000 + 1000}"
        create_scan_session(
            owner=owner,
            session_id=sid,
            scan_type="GROUP_INFO",
            title=f"Lưu danh sách nhóm vào «{category_name}»",
            target=category_name,
            target_type="category",
            source_uid="",
            account_name="Lưu nhóm chung",
            target_count=len(groups),
            config=json.dumps({"category": category_name, "deduplicate": deduplicate}, ensure_ascii=False),
        )
        update_scan_session(sid, total_found=saved_count, status="SUCCESS", finished=True)
        add_session_log(sid, "INFO", f"Khởi tạo thao tác lưu {len(groups)} nhóm vào danh mục «{category_name}»")
        add_session_log(sid, "SUCCESS", f"Đã lưu thành công {saved_count} nhóm vào CSDL.")
    except Exception as exc:
        print(f"[Module 10 DB] save session error: {exc}")

    return {
        "ok": True,
        "category_name": category_name,
        "saved_count": saved_count,
        "new_inserted": new_inserted,
        "message": f"Đã lưu thành công {saved_count} nhóm vào danh mục «{category_name}».",
    }


def upsert_scanned_group_member(
    owner: str,
    group_id: str,
    member: dict[str, Any],
    *,
    group_name: str = "",
    group_url: str = "",
    session_id: str = "",
) -> bool:
    owner = (owner or "").strip()
    group_id = normalize_group_id(group_id)
    uid = str(member.get("uid") or member.get("member_uid") or "").strip()
    if not owner or not group_id or not uid:
        return False

    name = str(member.get("name") or member.get("member_name") or uid).strip()
    profile_url = str(member.get("profile_url") or member.get("href") or f"https://www.facebook.com/{uid}").strip()
    avatar_url = str(member.get("avatar_url") or "").strip()
    friend_count = int(member.get("friend_count") or member.get("friendCount") or 0)
    role = str(member.get("role") or "member").strip().lower()
    if member.get("isAdmin"):
        role = "admin"
    elif member.get("isMod"):
        role = "moderator"
    joined_date = str(member.get("joined_date") or "").strip()

    try:
        row = db.fetch_one(
            "SELECT id FROM scanned_group_members WHERE owner_username = ? AND group_id = ? AND member_uid = ?",
            (owner, group_id, uid),
        )
        if row:
            db.execute(
                """
                UPDATE scanned_group_members
                SET member_name = ?, profile_url = ?, avatar_url = ?, friend_count = ?, role = ?,
                    group_name = COALESCE(NULLIF(?, ''), group_name),
                    scanned_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (name, profile_url, avatar_url, friend_count, role, group_name, row["id"]),
            )
            return False
        else:
            db.execute(
                """
                INSERT INTO scanned_group_members (
                    owner_username, group_id, group_name, group_url,
                    member_uid, member_name, profile_url, avatar_url,
                    friend_count, role, joined_date, session_id,
                    scanned_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (owner_username, group_id, member_uid) DO UPDATE
                SET member_name = EXCLUDED.member_name,
                    profile_url = EXCLUDED.profile_url,
                    friend_count = EXCLUDED.friend_count,
                    role = EXCLUDED.role,
                    scanned_at = CURRENT_TIMESTAMP
                """,
                (
                    owner, group_id, group_name, group_url,
                    uid, name, profile_url, avatar_url,
                    friend_count, role, joined_date, session_id,
                ),
            )
            return True
    except Exception as exc:
        print(f"[Module 10 DB] upsert_scanned_group_member error: {exc}")
        return False


def list_known_member_uids(owner: str, group_id: Optional[str] = None) -> set[str]:
    owner = (owner or "").strip()
    if not owner:
        return set()
    if group_id:
        rows = db.fetch_all(
            "SELECT member_uid FROM scanned_group_members WHERE owner_username = ? AND group_id = ?",
            (owner, normalize_group_id(group_id)),
        )
    else:
        rows = db.fetch_all(
            "SELECT DISTINCT member_uid FROM scanned_group_members WHERE owner_username = ?",
            (owner,),
        )
    return {str(r.get("member_uid") or "").strip() for r in rows if r.get("member_uid")}


def list_scanned_group_members(
    owner: str,
    *,
    group_id: Optional[str] = None,
    category_id: Optional[str] = None,
    search: Optional[str] = None,
    friend_filter: Optional[str] = None,
    role: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    owner = (owner or "").strip()
    if not owner:
        return [], 0

    where_clauses = ["m.owner_username = ?"]
    params: list[Any] = [owner]

    if group_id and str(group_id).strip():
        where_clauses.append("m.group_id = ?")
        params.append(normalize_group_id(str(group_id).strip()))

    if category_id and str(category_id).strip() and str(category_id).strip() != "cat-all":
        cat_raw = str(category_id).strip()
        cat_name = cat_raw.replace("cat-", "")
        # Resolve category name if ID
        row_c = db.fetch_one(
            "SELECT name FROM scanned_group_categories WHERE owner_username = ? AND (id::text = ? OR name = ?)",
            (owner, cat_name, cat_name),
        )
        target_name = row_c["name"] if row_c else cat_name
        where_clauses.append(
            """
            m.group_id IN (
                SELECT group_id FROM scanned_group_category_groups
                WHERE owner_username = ? AND lower(category_name) = lower(?)
            )
            """
        )
        params.extend([owner, target_name])

    if search and str(search).strip():
        term = f"%{str(search).strip().lower()}%"
        where_clauses.append("(lower(m.member_name) LIKE ? OR lower(m.member_uid) LIKE ? OR lower(m.group_name) LIKE ?)")
        params.extend([term, term, term])

    if role and role.strip() and role != "all":
        where_clauses.append("m.role = ?")
        params.append(role.strip().lower())

    if friend_filter and friend_filter != "all":
        if friend_filter == "under500":
            where_clauses.append("m.friend_count <= 500")
        elif friend_filter in {"500to2000", "50k_200k"}:
            where_clauses.append("m.friend_count > 500 AND m.friend_count <= 2000")
        elif friend_filter in {"over2000", "over500"}:
            where_clauses.append("m.friend_count > 500")

    where_sql = " AND ".join(where_clauses)

    count_row = db.fetch_one(
        f"SELECT COUNT(*) AS total FROM scanned_group_members m WHERE {where_sql}",
        tuple(params),
    )
    total = int(count_row.get("total") or 0) if count_row else 0

    select_sql = f"""
        SELECT m.id, m.group_id, m.group_name, m.group_url,
               m.member_uid, m.member_name, m.profile_url, m.avatar_url,
               m.friend_count, m.role, m.joined_date, m.session_id,
               m.scanned_at
        FROM scanned_group_members m
        WHERE {where_sql}
        ORDER BY m.scanned_at DESC, m.id DESC
        LIMIT ? OFFSET ?
    """
    exec_params = list(params)
    exec_params.extend([max(1, int(limit)), max(0, int(offset))])
    rows = db.fetch_all(select_sql, tuple(exec_params))

    items = []
    for r in rows:
        scanned_at_str = ""
        if r.get("scanned_at"):
            try:
                scanned_at_str = r["scanned_at"].strftime("%d/%m/%Y %H:%M:%S")
            except Exception:
                scanned_at_str = str(r["scanned_at"])
        items.append({
            "id": r["id"],
            "group_id": r["group_id"],
            "group_name": r["group_name"] or r["group_id"],
            "group_url": r["group_url"] or f"https://www.facebook.com/groups/{r['group_id']}",
            "uid": r["member_uid"],
            "name": r["member_name"] or r["member_uid"],
            "profile_url": r["profile_url"] or f"https://www.facebook.com/{r['member_uid']}",
            "avatar_url": r["avatar_url"] or "",
            "friend_count": r["friend_count"] or 0,
            "friendCount": r["friend_count"] or 0,
            "role": r["role"] or "member",
            "joined_date": r["joined_date"] or "",
            "session_id": r["session_id"] or "",
            "scanned_at": scanned_at_str,
        })
    return items, total


def get_group_members_summary(owner: str) -> dict[str, Any]:
    owner = (owner or "").strip()
    if not owner:
        return {"total_members": 0, "total_groups": 0, "total_admins": 0}
    row = db.fetch_one(
        """
        SELECT COUNT(*) AS total_members,
               COUNT(DISTINCT group_id) AS total_groups,
               COUNT(CASE WHEN role IN ('admin', 'moderator') THEN 1 END) AS total_admins
        FROM scanned_group_members
        WHERE owner_username = ?
        """,
        (owner,),
    )
    if not row:
        return {"total_members": 0, "total_groups": 0, "total_admins": 0}
    return {
        "total_members": int(row.get("total_members") or 0),
        "total_groups": int(row.get("total_groups") or 0),
        "total_admins": int(row.get("total_admins") or 0),
    }


def delete_scanned_group_member(owner: str, member_id: int) -> bool:
    owner = (owner or "").strip()
    if not owner or not member_id:
        return False
    try:
        db.execute(
            "DELETE FROM scanned_group_members WHERE owner_username = ? AND id = ?",
            (owner, int(member_id)),
        )
        return True
    except Exception as exc:
        print(f"[Module 10 DB] delete member {member_id} error: {exc}")
        return False


def delete_scanned_group_members_bulk(owner: str, member_ids: list[int]) -> int:
    owner = (owner or "").strip()
    if not owner or not member_ids:
        return 0
    deleted = 0
    for mid in member_ids:
        if delete_scanned_group_member(owner, mid):
            deleted += 1
    return deleted


# =========================================================================
# PHÂN HỆ 10.3: REPO BÀI VIẾT NHÓM (scanned_group_posts)
# =========================================================================


def upsert_scanned_group_post(
    owner: str,
    group_id: str,
    post: dict[str, Any],
    *,
    group_name: str = "",
    group_url: str = "",
    session_id: str = "",
) -> bool:
    owner = (owner or "").strip()
    group_id = normalize_group_id(group_id)
    post_id = str(post.get("post_id") or post.get("postId") or "").strip()
    if not owner or not group_id or not post_id:
        return False

    post_url = str(post.get("post_url") or post.get("postUrl") or f"https://www.facebook.com/groups/{group_id}/posts/{post_id}/").strip()
    content = str(post.get("content") or "").strip()
    author_name = str(post.get("author_name") or post.get("authorName") or "Ẩn danh").strip()
    author_uid = str(post.get("author_uid") or post.get("authorUid") or "").strip()
    author_url = str(post.get("author_url") or post.get("authorUrl") or (f"https://www.facebook.com/{author_uid}" if author_uid else "")).strip()
    likes_count = int(post.get("likes_count") or post.get("likes") or 0)
    comments_count = int(post.get("comments_count") or post.get("comments") or 0)
    shares_count = int(post.get("shares_count") or post.get("shares") or 0)
    posted_at = str(post.get("posted_at") or post.get("postedTime") or "").strip()
    is_pinned = bool(post.get("is_pinned") or post.get("isPinned") or False)

    try:
        row = db.fetch_one(
            "SELECT id FROM scanned_group_posts WHERE owner_username = ? AND group_id = ? AND post_id = ?",
            (owner, group_id, post_id),
        )
        if row:
            db.execute(
                """
                UPDATE scanned_group_posts
                SET content = ?, author_name = ?, author_uid = ?, author_url = ?,
                    likes_count = ?, comments_count = ?, shares_count = ?,
                    posted_at = ?, is_pinned = ?,
                    group_name = COALESCE(NULLIF(?, ''), group_name),
                    scanned_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    content, author_name, author_uid, author_url,
                    likes_count, comments_count, shares_count,
                    posted_at, is_pinned,
                    group_name, row["id"],
                ),
            )
            return False
        else:
            db.execute(
                """
                INSERT INTO scanned_group_posts (
                    owner_username, group_id, group_name, group_url,
                    post_id, post_url, content, author_name, author_uid, author_url,
                    likes_count, comments_count, shares_count, posted_at, is_pinned,
                    session_id, scanned_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (owner_username, group_id, post_id) DO UPDATE
                SET content = EXCLUDED.content,
                    likes_count = EXCLUDED.likes_count,
                    comments_count = EXCLUDED.comments_count,
                    shares_count = EXCLUDED.shares_count,
                    scanned_at = CURRENT_TIMESTAMP
                """,
                (
                    owner, group_id, group_name, group_url,
                    post_id, post_url, content, author_name, author_uid, author_url,
                    likes_count, comments_count, shares_count, posted_at, is_pinned,
                    session_id,
                ),
            )
            return True
    except Exception as exc:
        print(f"[Module 10 DB] upsert_scanned_group_post error: {exc}")
        return False


def list_known_post_ids(owner: str, group_id: Optional[str] = None) -> set[str]:
    owner = (owner or "").strip()
    if not owner:
        return set()
    if group_id:
        rows = db.fetch_all(
            "SELECT post_id FROM scanned_group_posts WHERE owner_username = ? AND group_id = ?",
            (owner, normalize_group_id(group_id)),
        )
    else:
        rows = db.fetch_all(
            "SELECT DISTINCT post_id FROM scanned_group_posts WHERE owner_username = ?",
            (owner,),
        )
    return {str(r.get("post_id") or "").strip() for r in rows if r.get("post_id")}


def list_scanned_group_posts(
    owner: str,
    *,
    group_id: Optional[str] = None,
    category_id: Optional[str] = None,
    search: Optional[str] = None,
    min_likes: Optional[int] = None,
    min_comments: Optional[int] = None,
    min_shares: Optional[int] = None,
    sort_by: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[dict[str, Any]], int]:
    owner = (owner or "").strip()
    if not owner:
        return [], 0

    where_clauses = ["p.owner_username = ?"]
    params: list[Any] = [owner]

    if group_id and str(group_id).strip():
        where_clauses.append("p.group_id = ?")
        params.append(normalize_group_id(str(group_id).strip()))

    if category_id and str(category_id).strip() and str(category_id).strip() != "cat-all":
        cat_raw = str(category_id).strip()
        cat_name = cat_raw.replace("cat-", "")
        row_c = db.fetch_one(
            "SELECT name FROM scanned_group_categories WHERE owner_username = ? AND (id::text = ? OR name = ?)",
            (owner, cat_name, cat_name),
        )
        target_name = row_c["name"] if row_c else cat_name
        where_clauses.append(
            """
            p.group_id IN (
                SELECT group_id FROM scanned_group_category_groups
                WHERE owner_username = ? AND lower(category_name) = lower(?)
            )
            """
        )
        params.extend([owner, target_name])

    if search and str(search).strip():
        term = f"%{str(search).strip().lower()}%"
        where_clauses.append("(lower(p.content) LIKE ? OR lower(p.post_id) LIKE ? OR lower(p.author_name) LIKE ? OR lower(p.group_name) LIKE ?)")
        params.extend([term, term, term, term])

    if min_likes is not None and min_likes > 0:
        where_clauses.append("p.likes_count >= ?")
        params.append(min_likes)

    if min_comments is not None and min_comments > 0:
        where_clauses.append("p.comments_count >= ?")
        params.append(min_comments)

    if min_shares is not None and min_shares > 0:
        where_clauses.append("p.shares_count >= ?")
        params.append(min_shares)

    where_sql = " AND ".join(where_clauses)

    count_row = db.fetch_one(
        f"SELECT COUNT(*) AS total FROM scanned_group_posts p WHERE {where_sql}",
        tuple(params),
    )
    total = int(count_row.get("total") or 0) if count_row else 0

    # BR-GPS-05.2: Công thức xếp hạng Tương tác cao nhất: Like + (Comment * 2) + (Share * 3)
    order_sql = "p.scanned_at DESC, p.id DESC"
    if sort_by == "engagement":
        order_sql = "(p.likes_count + (p.comments_count * 2) + (p.shares_count * 3)) DESC, p.scanned_at DESC"
    elif sort_by == "likes":
        order_sql = "p.likes_count DESC, p.scanned_at DESC"
    elif sort_by == "comments":
        order_sql = "p.comments_count DESC, p.scanned_at DESC"
    elif sort_by == "shares":
        order_sql = "p.shares_count DESC, p.scanned_at DESC"
    elif sort_by == "latest":
        order_sql = "p.scanned_at DESC, p.id DESC"

    select_sql = f"""
        SELECT p.id, p.group_id, p.group_name, p.group_url,
               p.post_id, p.post_url, p.content, p.author_name, p.author_uid, p.author_url,
               p.likes_count, p.comments_count, p.shares_count, p.posted_at, p.is_pinned,
               p.session_id, p.scanned_at
        FROM scanned_group_posts p
        WHERE {where_sql}
        ORDER BY {order_sql}
        LIMIT ? OFFSET ?
    """
    exec_params = list(params)
    exec_params.extend([max(1, int(page_size)), max(0, (int(page) - 1) * int(page_size))])
    rows = db.fetch_all(select_sql, tuple(exec_params))

    items = []
    for r in rows:
        scanned_at_str = ""
        if r.get("scanned_at"):
            try:
                scanned_at_str = r["scanned_at"].strftime("%d/%m/%Y %H:%M:%S")
            except Exception:
                scanned_at_str = str(r["scanned_at"])
        items.append({
            "id": r["id"],
            "group_id": r["group_id"],
            "group_name": r["group_name"] or r["group_id"],
            "group_url": r["group_url"] or f"https://www.facebook.com/groups/{r['group_id']}",
            "post_id": r["post_id"],
            "postId": r["post_id"],
            "post_url": r["post_url"] or f"https://www.facebook.com/groups/{r['group_id']}/posts/{r['post_id']}/",
            "content": r["content"] or "",
            "author_name": r["author_name"] or "Ẩn danh",
            "author_uid": r["author_uid"] or "",
            "author_url": r["author_url"] or "",
            "likes_count": r["likes_count"] or 0,
            "likes": r["likes_count"] or 0,
            "comments_count": r["comments_count"] or 0,
            "comments": r["comments_count"] or 0,
            "shares_count": r["shares_count"] or 0,
            "shares": r["shares_count"] or 0,
            "engagement_score": (r["likes_count"] or 0) + (r["comments_count"] or 0) * 2 + (r["shares_count"] or 0) * 3,
            "posted_at": r["posted_at"] or "",
            "postedTime": r["posted_at"] or "",
            "is_pinned": bool(r.get("is_pinned")),
            "session_id": r["session_id"] or "",
            "scanned_at": scanned_at_str,
        })
    return items, total


def get_group_posts_summary(owner: str) -> dict[str, Any]:
    owner = (owner or "").strip()
    if not owner:
        return {"total_posts": 0, "total_groups": 0, "total_likes": 0, "total_comments": 0}
    row = db.fetch_one(
        """
        SELECT COUNT(*) AS total_posts,
               COUNT(DISTINCT group_id) AS total_groups,
               COALESCE(SUM(likes_count), 0) AS total_likes,
               COALESCE(SUM(comments_count), 0) AS total_comments
        FROM scanned_group_posts
        WHERE owner_username = ?
        """,
        (owner,),
    )
    if not row:
        return {"total_posts": 0, "total_groups": 0, "total_likes": 0, "total_comments": 0}
    return {
        "total_posts": int(row.get("total_posts") or 0),
        "total_groups": int(row.get("total_groups") or 0),
        "total_likes": int(row.get("total_likes") or 0),
        "total_comments": int(row.get("total_comments") or 0),
    }


def list_groups_with_post_counts(owner: str) -> list[dict[str, Any]]:
    """Danh sách các nhóm đã có bài viết quét được, kèm số bài (phục vụ cây thư mục cột trái UC-GPS-06)."""
    owner = (owner or "").strip()
    if not owner:
        return []
    rows = db.fetch_all(
        """
        SELECT p.group_id,
               COALESCE(MAX(p.group_name), p.group_id) AS group_name,
               COALESCE(MAX(p.group_url), 'https://www.facebook.com/groups/' || p.group_id) AS group_url,
               COUNT(*) AS post_count,
               MAX(p.scanned_at) AS last_scanned_at
        FROM scanned_group_posts p
        WHERE p.owner_username = ?
        GROUP BY p.group_id
        ORDER BY post_count DESC, last_scanned_at DESC
        """,
        (owner,),
    )
    items = []
    for r in rows:
        last_str = ""
        if r.get("last_scanned_at"):
            try:
                last_str = r["last_scanned_at"].strftime("%d/%m/%Y %H:%M")
            except Exception:
                last_str = str(r["last_scanned_at"])
        items.append({
            "id": r["group_id"],
            "group_id": r["group_id"],
            "name": r["group_name"] or r["group_id"],
            "url": r["group_url"],
            "post_count": int(r.get("post_count") or 0),
            "last_scanned_at": last_str,
        })
    return items


def delete_scanned_group_post(owner: str, post_id_pk: int) -> bool:
    owner = (owner or "").strip()
    if not owner or not post_id_pk:
        return False
    try:
        db.execute(
            "DELETE FROM scanned_group_posts WHERE owner_username = ? AND id = ?",
            (owner, int(post_id_pk)),
        )
        return True
    except Exception as exc:
        print(f"[Module 10 DB] delete post {post_id_pk} error: {exc}")
        return False


def delete_scanned_group_posts_bulk(owner: str, post_ids_pk: list[int]) -> int:
    owner = (owner or "").strip()
    if not owner or not post_ids_pk:
        return 0
    deleted = 0
    for pid in post_ids_pk:
        if delete_scanned_group_post(owner, pid):
            deleted += 1
    return deleted


