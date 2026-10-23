"""
Module 10 — schema + repo lưu nhóm đã quét (Supabase PostgreSQL).
Tránh quét trùng; Kiểm tra đọc lại số nhóm / từ khóa.
"""
from __future__ import annotations

import re
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
    for statement in DDL_STATEMENTS:
        try:
            db.execute(statement)
        except Exception as exc:
            print(f"[Module 10 DB] DDL error: {exc}")
    _normalize_existing_keywords()
    print("[Module 10 DB] Schema scanned_groups / scanned_group_keywords ready.")


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
    if raw.startswith("/"):
        raw = "https://www.facebook.com" + raw
    try:
        parsed = urlparse(raw)
        path = re.sub(r"/+$", "", parsed.path or "")
        return f"https://www.facebook.com{path}"
    except Exception:
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
                   g.last_seen_at
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
            by_id[gid] = {
                "id": href or gid,
                "keyword": word,
                "name": row.get("group_name") or gid,
                "type": privacy,
                "members": row.get("members_label") or "—",
                "members_count": row.get("members_count"),
                "url": (href or "").replace("https://www.", "").replace("https://", ""),
                "href": href,
                "note": "not_joined" if privacy == "private" else "—",
            }
    return list(by_id.values())


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

    name = (group.get("name") or "")[:500]
    privacy = str(group.get("type") or group.get("privacy") or "unknown")[:20]
    members_label = (group.get("members") or group.get("members_label") or "")[:80] or None
    members_count = group.get("members_count")
    try:
        members_count = int(members_count) if members_count is not None else None
    except (TypeError, ValueError):
        members_count = None
    uid = (source_uid or group.get("source_uid") or "")[:50] or None

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
                members_label, members_count, keyword, source_uid
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (owner, gid, href, name, privacy, members_label, members_count, keyword, uid),
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
    return is_new
