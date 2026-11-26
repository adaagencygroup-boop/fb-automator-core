"""
Module 10 — schema + repo lưu nhóm đã quét (Supabase PostgreSQL).
Tránh quét trùng; Kiểm tra đọc lại số nhóm / từ khóa; Quản lý phiên và lịch sử quét nhóm.
"""
from __future__ import annotations

import json
import re
import threading
import time
from typing import Any, Optional

from core.database.connection import db

# Thời điểm Engine hiện tại khởi động (giờ UTC như CURRENT_TIMESTAMP của DB) — để nhận ra phiên
# RUNNING của Engine cũ (đã chết khi restart) mà không đụng phiên đang chạy thật.
from datetime import datetime as _dt, timezone as _tz

_ENGINE_STARTED_UTC = _dt.now(_tz.utc).replace(tzinfo=None)

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
    # Kết quả nút "Kiểm tra" (cuộn hết kết quả tìm nhóm của 1 từ khóa). Lưu danh sách nhóm thấy được
    # (id, công khai/riêng tư, số thành viên) để lần sau điền ngay và tính lại theo bộ lọc / DB hiện tại.
    """
    CREATE TABLE IF NOT EXISTS scanned_keyword_capacity (
        id SERIAL PRIMARY KEY,
        owner_username VARCHAR(100) NOT NULL,
        keyword VARCHAR(255) NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        groups TEXT,
        reason TEXT,
        source_uid VARCHAR(100),
        checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_keyword_capacity UNIQUE (owner_username, keyword)
    );
    """,
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
    # Nhật ký thật của phiên quét (JSON, tối đa vài trăm dòng cuối)
    try:
        db.execute("ALTER TABLE scanned_group_sessions ADD COLUMN IF NOT EXISTS logs TEXT;")
    except Exception as exc:
        print(f"[Module 10 DB] add logs column error: {exc}")
    # Tiến độ phiên quét (JSON) để "Chạy tiếp" phiên bị gián đoạn — chỉ quét phần còn thiếu
    try:
        db.execute("ALTER TABLE scanned_group_sessions ADD COLUMN IF NOT EXISTS resume_state TEXT;")
    except Exception as exc:
        print(f"[Module 10 DB] add resume_state column error: {exc}")

    _normalize_existing_keywords()
    _sync_keywords_to_categories()
    print("[Module 10 DB] Schema scanned_groups / scanned_group_keywords / scanned_group_sessions ready.")


def _sync_keywords_to_categories() -> None:
    """Mỗi từ khóa đã quét có 1 DANH MỤC (thư mục) — chỉ tạo khi chưa có thư mục nào trùng tên.

    - So tên không phân biệt hoa/thường: đã có "Phenikaa" thì từ khóa "phenikaa" KHÔNG tạo thêm "phenikaa"
      (trước đây mỗi lần Engine khởi động lại sinh thư mục trùng).
    - KHÔNG gắn lại nhóm vào thư mục từ khóa: nhóm chưa lưu / chuyển mục tự thuộc thư mục trùng từ khóa
      (xem _group_category_keys); gắn lại ở đây làm nhóm đã "Chuyển mục" hiện lại ở thư mục cũ.
    """
    try:
        db.execute(
            """
            INSERT INTO scanned_group_categories (owner_username, name, description)
            SELECT DISTINCT ON (g.owner_username, lower(g.keyword))
                   g.owner_username, g.keyword, 'Danh mục từ khóa: ' || g.keyword
            FROM scanned_groups g
            WHERE g.keyword IS NOT NULL AND TRIM(g.keyword) != ''
              AND lower(g.keyword) != 'directlink'
              AND g.keyword NOT LIKE 'http%%'
              AND g.keyword NOT LIKE '%%facebook.com%%'
              AND g.keyword NOT LIKE '%%fb.com%%'
              AND NOT EXISTS (
                  SELECT 1 FROM scanned_group_categories c
                  WHERE c.owner_username = g.owner_username AND lower(c.name) = lower(g.keyword)
              )
            ORDER BY g.owner_username, lower(g.keyword), g.keyword
            ON CONFLICT (owner_username, name) DO NOTHING;
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


def lookup_scanned_groups(owner: Optional[str], links: list[str]) -> dict[str, dict[str, Any]]:
    """Tra các link nhóm đã có trong Danh sách nhóm quét của owner (nút Kiểm tra & Lọc trùng lặp).

    Trả {link_gốc: {group_id, group_name, privacy, last_seen_at}} — chỉ những link đã quét trước đó.
    Khớp theo group_id (số hoặc slug) và theo group_url đã chuẩn hoá.
    """
    owner = (owner or "").strip()
    wanted: dict[str, str] = {}
    for link in links or []:
        gid = normalize_group_id(normalize_group_url(str(link or "")))
        if gid:
            wanted[str(link)] = gid
    if not owner or not wanted:
        return {}
    ids = sorted(set(wanted.values()))
    urls = sorted({f"https://www.facebook.com/groups/{gid}" for gid in ids})
    found: dict[str, dict[str, Any]] = {}
    chunk = 500
    for start in range(0, len(ids), chunk):
        part_ids = ids[start:start + chunk]
        part_urls = urls[start:start + chunk]
        rows = db.fetch_all(
            f"""
            SELECT group_id, group_url, group_name, privacy, last_seen_at
            FROM scanned_groups
            WHERE owner_username = ?
              AND (lower(group_id) IN ({",".join("?" * len(part_ids))})
                   OR lower(rtrim(group_url, '/')) IN ({",".join("?" * len(part_urls))}))
            """,
            (owner, *part_ids, *[u.lower() for u in part_urls]),
        )
        for r in rows:
            for key in {str(r.get("group_id") or "").lower(),
                        normalize_group_id(str(r.get("group_url") or ""))}:
                if key:
                    found[key] = r
    out: dict[str, dict[str, Any]] = {}
    for link, gid in wanted.items():
        r = found.get(gid)
        if not r:
            continue
        seen = r.get("last_seen_at")
        out[link] = {
            "group_id": r.get("group_id"),
            "group_name": r.get("group_name") or "",
            "privacy": (r.get("privacy") or "unknown").lower(),
            "last_seen_at": _fmt_dt(seen, "%H:%M %d/%m/%Y"),
        }
    return out


def _category_key(name: Any) -> str:
    """Tên thư mục so khớp không phân biệt hoa/thường (giống bộ lọc trên giao diện)."""
    return " ".join(str(name or "").split()).lower()


def _group_category_keys(owner: str) -> dict[str, set[str]]:
    """group_id → các thư mục chứa nhóm đó.

    - Nhóm đã được LƯU / CHUYỂN vào thư mục (bảng liên kết) → chỉ nằm ở các thư mục đó. "Chuyển mục" xoá
      liên kết cũ nên nhóm rời thư mục cũ (kể cả thư mục trùng từ khóa đã quét ra nhóm).
    - Nhóm chưa từng lưu / chuyển → nằm ở thư mục trùng từ khóa quét ra nó.
    1 nhóm có thể được lưu vào nhiều thư mục — trước đây chỉ lấy 1 (MAX) nên thư mục kia không thấy nhóm.
    """
    by_keyword: dict[str, set[str]] = {}
    for r in db.fetch_all(
        "SELECT group_id, keyword FROM scanned_groups WHERE owner_username = ?", (owner,)
    ):
        gid = str(r.get("group_id") or "").lower()
        if gid:
            kw = _category_key(r.get("keyword"))
            by_keyword[gid] = {kw} if kw else set()
    linked: dict[str, set[str]] = {}
    for r in db.fetch_all(
        "SELECT group_id, category_name FROM scanned_group_category_groups WHERE owner_username = ?", (owner,)
    ):
        gid = str(r.get("group_id") or "").lower()
        name = _category_key(r.get("category_name"))
        if gid in by_keyword and name:  # bỏ liên kết tới nhóm đã xoá
            linked.setdefault(gid, set()).add(name)
    return {gid: linked.get(gid) or kws for gid, kws in by_keyword.items()}


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
        -- 1 dòng / tên thư mục (không phân biệt hoa/thường): "Phenikaa" + "phenikaa" từng làm mỗi nhóm hiện 2 lần.
        LEFT JOIN (
            SELECT lower(name) AS lname, MIN(id) AS id
            FROM scanned_group_categories
            WHERE owner_username = ?
            GROUP BY lower(name)
        ) c ON c.lname = lower(COALESCE(NULLIF(cg.category_name, ''), g.keyword))
        WHERE {where_clause}
        ORDER BY g.created_at DESC
        LIMIT ? OFFSET ?
        """,
        tuple([owner, owner] + params + [max(1, int(limit)), max(0, int(offset))]),
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

    try:
        member_of = _group_category_keys(owner)
    except Exception as exc:
        print(f"[Module 10 DB] group category keys error: {exc}")
        member_of = {}

    out_groups = []
    for idx, r in enumerate(rows, start=offset + 1):
        gid = str(r.get("group_id") or "")
        href = normalize_group_url(r.get("group_url") or "")
        privacy_val = r.get("privacy") or "unknown"
        created_dt = r.get("created_at")
        created_str = (
            _to_local(created_dt).strftime("%d/%m/%Y %H:%M")
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
            # Mọi thư mục chứa nhóm (chữ thường) — giao diện lọc theo đây khi chọn thư mục.
            "category_keys": sorted(member_of.get(gid.lower()) or {_category_key(r.get("keyword"))} - {""}),
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


def resolve_scanned_group_id(owner: str, group_id_or_id: Any) -> str:
    """Nhận ID tự tăng của DB, ID nhóm Facebook (số dài hoặc slug) hoặc URL → group_id đã lưu.

    ID nhóm Facebook cũng toàn chữ số, nên chuỗi số được thử như ID tự tăng trước,
    không có thì coi là ID nhóm.
    """
    val = str(group_id_or_id or "").strip()
    if not val:
        return ""
    if "/groups/" in val:
        return normalize_group_id(val)
    if val.isdigit() and len(val) < 10:
        row = db.fetch_one(
            "SELECT group_id FROM scanned_groups WHERE owner_username = ? AND id = ?",
            (owner, int(val)),
        )
        if row and row.get("group_id"):
            return str(row["group_id"])
    return val.lower()


def delete_scanned_group(owner: Optional[str], group_id_or_id: Any) -> bool:
    """Xoá nhóm cùng liên kết từ khóa / danh mục. True nếu thực sự xoá được."""
    owner = (owner or "").strip()
    if not owner or not group_id_or_id:
        return False
    gid = resolve_scanned_group_id(owner, group_id_or_id)
    if not gid:
        return False
    with db.session() as cur:
        cur.execute(
            "DELETE FROM scanned_groups WHERE owner_username = %s AND group_id = %s",
            (owner, gid),
        )
        deleted = cur.rowcount
        cur.execute(
            "DELETE FROM scanned_group_keywords WHERE owner_username = %s AND group_id = %s",
            (owner, gid),
        )
        cur.execute(
            "DELETE FROM scanned_group_category_groups WHERE owner_username = %s AND group_id = %s",
            (owner, gid),
        )
    return deleted > 0


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

    # Từ khóa có 1 DANH MỤC (dùng thư mục trùng tên đã có, không tạo trùng). Chỉ gắn nhóm MỚI vào thư mục:
    # nhóm đã có (người dùng có thể đã "Chuyển mục") quét lại thì giữ nguyên thư mục hiện tại.
    try:
        cat = create_scan_category(owner, keyword, f"Danh mục từ khóa: {keyword}")
        cat_name = ((cat or {}).get("category") or {}).get("name") or keyword
        if is_new:
            db.execute(
                """
                INSERT INTO scanned_group_category_groups (owner_username, category_name, group_id)
                VALUES (?, ?, ?)
                ON CONFLICT (owner_username, category_name, group_id) DO NOTHING
                """,
                (owner, cat_name, gid),
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
    logs: Optional[list[dict[str, Any]]] = None,
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
    if logs is not None:
        from modules.module_10_group_scan.scan_common import session_log_entries

        updates.append("logs = ?")
        params.append(json.dumps(session_log_entries(logs), ensure_ascii=False))
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


# Trạng thái phiên được phép "Chạy tiếp" (phiên chưa quét hết vì Engine tắt / Chrome bị đóng / Dừng khẩn cấp).
RESUMABLE_STATUSES = {"INTERRUPTED", "ABORTED"}


def save_resume_state(session_id: str, state: dict[str, Any]) -> bool:
    """Ghi tiến độ phiên (yêu cầu gốc + từng mục đã quét bao nhiêu / xong chưa)."""
    if not session_id:
        return False
    try:
        db.execute(
            "UPDATE scanned_group_sessions SET resume_state = ? WHERE session_id = ?",
            (json.dumps(state, ensure_ascii=False, default=str), session_id),
        )
        return True
    except Exception as exc:
        print(f"[Module 10 DB] save_resume_state error: {exc}")
        return False


def resume_remaining(state: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
    """Các mục chưa quét xong của phiên — mỗi mục kèm hạn mức còn thiếu.

    group_info:    [{"keyword", "limit"}] (link nhóm chưa mở thì limit 1)
    group_members: [{...nhóm, "limit": số thành viên còn thiếu}]
    """
    if not isinstance(state, dict):
        return []
    req = state.get("request") or {}
    progress = state.get("progress") or {}
    out: list[dict[str, Any]] = []
    if state.get("kind") == "group_members":
        per_group = int(req.get("members_limit") or 50)
        for idx, grp in enumerate(req.get("groups") or []):
            row = progress.get(str(idx)) or {}
            if row.get("done"):
                continue
            left = max(1, per_group - int(row.get("count") or 0))
            out.append({**grp, "limit": left})
        return out
    for item in req.get("keywords") or []:
        row = progress.get(item.get("keyword")) or {}
        if row.get("done"):
            continue
        left = max(1, int(item.get("limit") or 30) - int(row.get("count") or 0))
        out.append({"keyword": item.get("keyword"), "limit": left})
    return out


def get_resume_info(owner: Optional[str], session_id: str) -> Optional[dict[str, Any]]:
    """{status, scan_type, state, remaining} của phiên thuộc owner, hoặc None."""
    owner = (owner or "").strip()
    if not owner or not session_id:
        return None
    mark_interrupted_sessions(owner)
    row = db.fetch_one(
        "SELECT session_id, scan_type, status, resume_state FROM scanned_group_sessions "
        "WHERE owner_username = ? AND session_id = ?",
        (owner, session_id),
    )
    if not row:
        return None
    try:
        state = json.loads(row.get("resume_state") or "null")
    except Exception:
        state = None
    return {
        "session_id": row["session_id"],
        "scan_type": row.get("scan_type") or "GROUP_INFO",
        "status": str(row.get("status") or "").upper(),
        "state": state,
        "remaining": resume_remaining(state),
    }


def latest_resumable_session(owner: Optional[str], scan_type: str) -> Optional[dict[str, Any]]:
    """Phiên gần nhất cùng loại còn phần chưa quét (để trang Quét hiện nút Chạy tiếp)."""
    owner = (owner or "").strip()
    if not owner:
        return None
    mark_interrupted_sessions(owner)
    # Chỉ xét PHIÊN GẦN NHẤT cùng loại: đã chạy phiên khác sau phiên dừng dở thì phiên cũ không còn nhắc ở
    # trang Quét nữa (dễ hiểu nhầm là chạy tiếp phiên vừa rồi) — vẫn Chạy tiếp được ở trang Lịch sử.
    rows = db.fetch_all(
        "SELECT session_id, title, status, resume_state, started_at FROM scanned_group_sessions "
        "WHERE owner_username = ? AND scan_type = ? ORDER BY started_at DESC LIMIT 1",
        (owner, str(scan_type).upper()),
    )
    for row in rows:
        if str(row.get("status") or "").upper() not in RESUMABLE_STATUSES or not row.get("resume_state"):
            return None
        try:
            state = json.loads(row.get("resume_state") or "null")
        except Exception:
            continue
        remaining = resume_remaining(state)
        if remaining:
            members = state.get("kind") == "group_members"
            return {
                "session_id": row["session_id"],
                "title": row.get("title") or "",
                "status": str(row.get("status") or "").upper(),
                "startTime": _fmt_dt(row.get("started_at")),
                "remaining": len(remaining),
                # Từng mục còn thiếu bao nhiêu — để người dùng biết bấm Chạy tiếp sẽ quét gì
                "items": [
                    {
                        "label": str((it.get("name") or it.get("group_name") or it.get("group_id") or "")
                                     if members else it.get("keyword") or ""),
                        "left": int(it.get("limit") or 0),
                        "unit": "thành viên" if members else (
                            "link" if "/groups/" in str(it.get("keyword") or "") else "nhóm"),
                    }
                    for it in remaining[:6]
                ],
            }
    return None


def add_session_log(session_id: str, level: str, message: str) -> None:
    """Không lưu log chi tiết vào database để tối ưu hiệu năng và dung lượng."""
    return


_SESSION_UNITS = {"GROUP_INFO": "nhóm", "GROUP_MEMBERS": "thành viên"}

_STATUS_TEXT = {
    "SUCCESS": ("SUCCESS", "Phiên quét hoàn tất"),
    "FAILED": ("ERROR", "Phiên quét gặp lỗi"),
    "ERROR": ("ERROR", "Phiên quét gặp lỗi"),
    "ABORTED": ("WARNING", "Phiên quét đã bị dừng"),
    "INTERRUPTED": ("WARNING", "Phiên quét bị gián đoạn do Engine khởi động lại — các mục đã quét trước đó vẫn được lưu"),
    "RESUMED": ("INFO", "Phiên bị gián đoạn — phần còn lại đã được chạy tiếp ở phiên mới"),
}


def _to_local(value: Any) -> Any:
    """CURRENT_TIMESTAMP của Postgres lưu giờ UTC (TIMESTAMP không múi giờ) → đổi sang giờ máy để hiển thị."""
    if not hasattr(value, "strftime"):
        return value
    from datetime import timezone

    if getattr(value, "tzinfo", None) is not None:
        return value.astimezone().replace(tzinfo=None)
    return value.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)


def _fmt_dt(value: Any, fmt: str = "%d/%m/%Y %H:%M:%S") -> str:
    return _to_local(value).strftime(fmt) if hasattr(value, "strftime") else ""


def _legacy_session_logs(status: str, start_str: str, end_str: str, total: int, unit: str) -> list[dict[str, str]]:
    """Phiên tạo trước khi có cột logs: chỉ dựng từ dữ liệu thật đã lưu, nói rõ là không có log chi tiết."""
    rows = [{
        "time": start_str.split(" ")[-1] if start_str else "",
        "level": "INFO",
        "message": "Phiên này không có nhật ký chi tiết (được tạo trước khi hệ thống lưu log).",
    }]
    if status == "RUNNING":
        rows.append({"time": "", "level": "INFO", "message": f"Phiên đang chạy — đã thu thập {total} {unit}."})
    else:
        level, text = _STATUS_TEXT.get(status, ("INFO", f"Trạng thái: {status or '—'}"))
        rows.append({
            "time": end_str.split(" ")[-1] if end_str else "",
            "level": level,
            "message": f"{text}. Thu thập được {total} {unit}.",
        })
    return rows


def _batch_session_samples(owner: str, rows: list[dict[str, Any]], per_session: int = 10) -> dict[str, list[dict[str, Any]]]:
    """Mẫu kết quả cho nhiều phiên bằng tối đa 3 truy vấn (không N+1)."""
    samples: dict[str, list[dict[str, Any]]] = {}
    member_ids = [r["session_id"] for r in rows if r.get("scan_type") == "GROUP_MEMBERS" and r.get("session_id")]
    keyword_sessions = {
        r["session_id"]: [normalize_keyword(w) for w in str(r.get("target") or "").split(",") if w.strip()]
        for r in rows
        if (r.get("scan_type") or "GROUP_INFO") == "GROUP_INFO"
        and (r.get("target_type") or "keywords") == "keywords"
        and r.get("session_id")
    }

    if member_ids:
        found = db.fetch_all(
            """
            SELECT session_id, member_uid, member_name, profile_url, group_name, role FROM (
                SELECT m.*, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY id DESC) AS rn
                FROM scanned_group_members m
                WHERE owner_username = ? AND session_id = ANY(?)
            ) t WHERE rn <= ?
            """,
            (owner, member_ids, per_session),
        )
        for r in found:
            samples.setdefault(r["session_id"], []).append({
                "id": r.get("member_uid"),
                "name": r.get("member_name") or r.get("member_uid"),
                "members": f"{r.get('group_name') or ''} · {r.get('role') or 'member'}",
                "url": r.get("profile_url") or f"https://www.facebook.com/{r.get('member_uid')}",
            })

    all_words = sorted({w for words in keyword_sessions.values() for w in words if w})
    if all_words:
        found = db.fetch_all(
            """
            SELECT keyword, group_id, group_url, group_name, privacy, members_label FROM (
                SELECT k.keyword, g.group_id, g.group_url, g.group_name, g.privacy, g.members_label,
                       ROW_NUMBER() OVER (PARTITION BY k.keyword ORDER BY k.found_at DESC) AS rn
                FROM scanned_group_keywords k
                JOIN scanned_groups g ON g.owner_username = k.owner_username AND g.group_id = k.group_id
                WHERE k.owner_username = ? AND k.keyword = ANY(?)
            ) t WHERE rn <= ?
            """,
            (owner, all_words, per_session),
        )
        by_word: dict[str, list[dict[str, Any]]] = {}
        for r in found:
            by_word.setdefault(r["keyword"], []).append(r)
        for sid, words in keyword_sessions.items():
            seen: set[str] = set()
            picked: list[dict[str, Any]] = []
            for word in words:
                for r in by_word.get(word, []):
                    gid = str(r.get("group_id") or "")
                    if gid in seen or len(picked) >= per_session:
                        continue
                    seen.add(gid)
                    href = normalize_group_url(r.get("group_url") or "") or f"https://www.facebook.com/groups/{gid}"
                    privacy = r.get("privacy")
                    picked.append({
                        "id": href,
                        "name": r.get("group_name") or gid,
                        "privacy": "Công khai" if privacy == "public" else "Riêng tư" if privacy == "private" else "Không rõ",
                        "members": f"{r.get('members_label') or '—'} TV",
                        "url": href,
                    })
            if picked:
                samples[sid] = picked
    return samples


def mark_interrupted_sessions(owner: Optional[str]) -> int:
    """Phiên còn RUNNING nhưng bắt đầu TRƯỚC khi Engine hiện tại khởi động thì chắc chắn đã chết
    (job chỉ sống trong RAM) → đánh dấu INTERRUPTED. Không bao giờ đụng phiên đang chạy thật,
    vì phiên của Engine này luôn bắt đầu sau _ENGINE_STARTED_UTC."""
    owner = (owner or "").strip()
    if not owner:
        return 0
    try:
        stale = db.fetch_all(
            "SELECT session_id FROM scanned_group_sessions "
            "WHERE owner_username = ? AND status IN ('RUNNING', 'PENDING', 'PAUSED') AND started_at < ?",
            (owner, _ENGINE_STARTED_UTC),
        )
        for row in stale:
            db.execute(
                "UPDATE scanned_group_sessions SET status = 'INTERRUPTED' WHERE owner_username = ? AND session_id = ?",
                (owner, row["session_id"]),
            )
        return len(stale)
    except Exception as exc:
        print(f"[Module 10 DB] mark_interrupted_sessions error: {exc}")
        return 0


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
    mark_interrupted_sessions(owner)

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
               status, config, logs, resume_state, started_at, finished_at, created_at
        FROM scanned_group_sessions
        WHERE {where_clause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        """,
        tuple(params + [max(1, int(limit)), max(0, int(offset))]),
    )

    try:
        samples = _batch_session_samples(owner, rows)
    except Exception as exc:
        print(f"[Module 10 DB] session samples error: {exc}")
        samples = {}

    out = []
    for r in rows:
        sid = r.get("session_id") or ""
        stype = r.get("scan_type") or "GROUP_INFO"
        unit = _SESSION_UNITS.get(stype, "kết quả")
        sstatus = str(r.get("status") or "SUCCESS").upper()
        started = r.get("started_at")
        finished = r.get("finished_at")
        start_str = _fmt_dt(started)
        end_str = _fmt_dt(finished) or "—"

        duration_str = "—"
        if hasattr(started, "year") and hasattr(finished, "year"):
            sec = max(0, int((finished - started).total_seconds()))
            duration_str = f"{sec // 60}m {sec % 60}s" if sec >= 60 else f"{sec}s"

        cfg_raw = r.get("config") or "{}"
        try:
            cfg = json.loads(cfg_raw) if isinstance(cfg_raw, str) else dict(cfg_raw or {})
        except Exception:
            cfg = {}
        target_words = [w.strip() for w in str(r.get("target") or "").split(",") if w.strip()]
        if stype == "GROUP_INFO":
            config_out = {
                "delay": cfg.get("delay") or "5 - 10s",
                "privacy": cfg.get("privacy") or "Tất cả",
                "minMembers": cfg.get("minMembers") or "—",
                "maxKeywords": cfg.get("maxKeywords") or len(target_words) or 1,
            }
            if "autoJoin" in cfg:
                config_out["autoJoin"] = "Bật" if cfg.get("autoJoin") else "Tắt"
        else:
            config_out = {k: v for k, v in cfg.items() if v is not None}

        total_cnt = int(r.get("total_found") or 0)
        target_cnt = int(r.get("target_count") or 0) or max(total_cnt, 1)
        pct = min(100, int((total_cnt / target_cnt) * 100)) if target_cnt > 0 else 0

        logs_list: list[dict[str, Any]] = []
        raw_logs = r.get("logs")
        if raw_logs:
            try:
                parsed = json.loads(raw_logs) if isinstance(raw_logs, str) else raw_logs
                logs_list = [row for row in parsed if isinstance(row, dict)]
            except Exception:
                logs_list = []
        if not logs_list:
            logs_list = _legacy_session_logs(sstatus, start_str, "" if end_str == "—" else end_str, total_cnt, unit)

        remaining_items = 0
        if sstatus in RESUMABLE_STATUSES and r.get("resume_state"):
            try:
                remaining_items = len(resume_remaining(json.loads(r["resume_state"])))
            except Exception:
                remaining_items = 0

        out.append({
            "id": sid,
            "type": stype,
            "resumable": remaining_items > 0,
            "remainingItems": remaining_items,
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
                "unit": unit,
            },
            "startTime": start_str,
            "endTime": end_str,
            "duration": duration_str,
            "status": sstatus,
            "config": config_out,
            "logs": logs_list,
            "sampleResults": samples.get(sid, []),
        })

    return out


def delete_scan_session(owner: Optional[str], session_id: str) -> bool:
    owner = (owner or "").strip()
    if not owner or not session_id:
        return False
    cur = db.execute(
        "DELETE FROM scanned_group_sessions WHERE owner_username = ? AND session_id = ?",
        (owner, session_id),
    )
    # Chỉ báo "đã xoá" khi thật sự có dòng bị xoá (phiên của người khác / không tồn tại → False).
    rowcount = getattr(cur, "rowcount", None)
    return rowcount is None or rowcount < 0 or rowcount > 0


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

        # Đếm đúng như bộ lọc trên giao diện: nhóm thuộc thư mục nếu đã lưu / chuyển vào, hoặc từ khóa trùng tên.
        counts_map: dict[str, int] = {}
        for keys in _group_category_keys(owner).values():
            for k in keys:
                counts_map[k] = counts_map.get(k, 0) + 1

        result = []
        for c in existing:
            cname = c.get("name") or ""
            count = counts_map.get(_category_key(cname), 0)
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
    new_name = re.sub(r"\s+", " ", (new_name or "").strip())
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
        clash = _find_category(owner, new_name, exclude_id=cat_id)
        if clash:
            return {"ok": False, "error": f"Danh mục «{clash['name']}» đã tồn tại — chọn tên khác."}

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


def delete_scan_category(owner: Optional[str], cat_id_or_name: Any, *, delete_groups: bool = False) -> dict[str, Any]:
    """Xoá danh mục. delete_groups=True → xoá luôn mọi nhóm đang nằm trong danh mục (theo liên kết / từ khóa);
    False → chỉ xoá danh mục, nhóm vẫn giữ trong "Tất cả nhóm đã quét". Trả {ok, groups_deleted}."""
    owner = (owner or "").strip()
    if not owner or not cat_id_or_name:
        return {"ok": False, "groups_deleted": 0}
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
            return {"ok": False, "groups_deleted": 0}

        cat_name = old_cat["name"]
        cat_id = old_cat["id"]

        groups_deleted = 0
        if delete_groups:
            key = _category_key(cat_name)
            gids = [gid for gid, keys in _group_category_keys(owner).items() if key in keys]
            groups_deleted = delete_scanned_groups_bulk(owner, gids)

        db.execute(
            "DELETE FROM scanned_group_category_groups WHERE owner_username = ? AND category_name = ?",
            (owner, cat_name),
        )

        db.execute(
            "DELETE FROM scanned_group_categories WHERE owner_username = ? AND id = ?",
            (owner, cat_id),
        )
        return {"ok": True, "groups_deleted": groups_deleted}
    except Exception as exc:
        print(f"[Module 10 DB] delete_scan_category error: {exc}")
        return {"ok": False, "groups_deleted": 0}


def move_groups_to_category(owner: Optional[str], target_category_name: str, group_ids: list[Any]) -> int:
    owner = (owner or "").strip()
    target_category_name = (target_category_name or "").strip()
    if not owner or not target_category_name or not group_ids:
        return 0

    created = create_scan_category(owner, target_category_name)
    target_category_name = ((created or {}).get("category") or {}).get("name") or target_category_name

    moved_count = 0
    for gid_raw in group_ids:
        actual_gid = resolve_scanned_group_id(owner, gid_raw)
        if not actual_gid:
            continue

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


_category_lock = threading.Lock()


def _find_category(owner: str, name: str, *, exclude_id: Any = None) -> Optional[dict[str, Any]]:
    """Thư mục của owner trùng tên (không phân biệt hoa/thường, gộp khoảng trắng) — cũ nhất nếu có nhiều."""
    key = _category_key(name)
    if not key:
        return None
    for row in db.fetch_all(
        "SELECT id, name, description FROM scanned_group_categories WHERE owner_username = ? ORDER BY id ASC",
        (owner,),
    ):
        if _category_key(row.get("name")) == key and (exclude_id is None or str(row.get("id")) != str(exclude_id)):
            return row
    return None


def canonical_category_name(owner: Optional[str], name: str) -> str:
    """Tên thư mục đang có trùng `name` (khác hoa/thường) — để Lưu / Chuyển mục vào đúng thư mục cũ."""
    owner = (owner or "").strip()
    clean = re.sub(r"\s+", " ", (name or "").strip())
    row = _find_category(owner, clean) if owner and clean else None
    return (row or {}).get("name") or clean


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
        with _category_lock:
            row = _find_category(owner, name)
            existed = bool(row)
            if not row:
                db.execute(
                    """
                    INSERT INTO scanned_group_categories (owner_username, name, description)
                    VALUES (?, ?, ?)
                    ON CONFLICT (owner_username, name) DO NOTHING
                    """,
                    (owner, name, description or "Danh mục nhóm tự tạo"),
                )
                row = _find_category(owner, name)
            return {
                "ok": True,
                "existed": existed,  # đã có thư mục trùng tên (khác hoa/thường) → dùng thư mục đó, không tạo mới
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

    created = create_scan_category(owner, category_name)
    category_name = ((created or {}).get("category") or {}).get("name") or category_name

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
                SET member_name = ?, profile_url = ?, avatar_url = ?, role = ?,
                    group_name = COALESCE(NULLIF(?, ''), group_name),
                    joined_date = COALESCE(NULLIF(?, ''), joined_date),
                    scanned_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (name, profile_url, avatar_url, role, group_name, joined_date, row["id"]),
            )
            return False
        else:
            db.execute(
                """
                INSERT INTO scanned_group_members (
                    owner_username, group_id, group_name, group_url,
                    member_uid, member_name, profile_url, avatar_url,
                    role, joined_date, session_id,
                    scanned_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (owner_username, group_id, member_uid) DO UPDATE
                SET member_name = EXCLUDED.member_name,
                    profile_url = EXCLUDED.profile_url,
                    role = EXCLUDED.role,
                    joined_date = COALESCE(NULLIF(EXCLUDED.joined_date, ''), scanned_group_members.joined_date),
                    scanned_at = CURRENT_TIMESTAMP
                """,
                (
                    owner, group_id, group_name, group_url,
                    uid, name, profile_url, avatar_url,
                    role, joined_date, session_id,
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

    where_sql = " AND ".join(where_clauses)

    count_row = db.fetch_one(
        f"SELECT COUNT(*) AS total FROM scanned_group_members m WHERE {where_sql}",
        tuple(params),
    )
    total = int(count_row.get("total") or 0) if count_row else 0

    select_sql = f"""
        SELECT m.id, m.group_id, m.group_name, m.group_url,
               m.member_uid, m.member_name, m.profile_url, m.avatar_url,
               m.role, m.joined_date, m.session_id,
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
                scanned_at_str = _to_local(r["scanned_at"]).strftime("%d/%m/%Y %H:%M:%S")
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
# KẾT QUẢ "KIỂM TRA" TỪ KHÓA (scanned_keyword_capacity)
# =========================================================================


def save_keyword_capacity(
    owner: str,
    keyword: str,
    groups: list[dict[str, Any]],
    *,
    reason: str = "",
    source_uid: str = "",
) -> bool:
    """Lưu / ghi đè kết quả Kiểm tra của 1 từ khóa. groups = [{id, type, members}]."""
    word = normalize_keyword(keyword)
    if not owner or not word:
        return False
    try:
        db.execute(
            """
            INSERT INTO scanned_keyword_capacity (owner_username, keyword, total, groups, reason, source_uid, checked_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT (owner_username, keyword) DO UPDATE SET
                total = EXCLUDED.total, groups = EXCLUDED.groups, reason = EXCLUDED.reason,
                source_uid = EXCLUDED.source_uid, checked_at = CURRENT_TIMESTAMP
            """,
            (owner, word, len(groups or []), json.dumps(groups or [], ensure_ascii=False), reason or "", source_uid or ""),
        )
        return True
    except Exception as exc:
        print(f"[Module 10 DB] save_keyword_capacity error: {exc}")
        return False


def get_keyword_capacity(owner: Optional[str], keywords: list[str]) -> dict[str, dict[str, Any]]:
    """Kết quả Kiểm tra đã lưu: {keyword: {groups, total, reason, checked_at}}."""
    words = [w for w in dict.fromkeys(normalize_keyword(k) for k in (keywords or [])) if w]
    if not owner or not words:
        return {}
    try:
        rows = db.fetch_all(
            "SELECT keyword, total, groups, reason, checked_at FROM scanned_keyword_capacity "
            "WHERE owner_username = ? AND keyword = ANY(?)",
            (owner, words),
        )
    except Exception as exc:
        print(f"[Module 10 DB] get_keyword_capacity error: {exc}")
        return {}
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        try:
            groups = json.loads(r.get("groups") or "[]")
        except Exception:
            groups = []
        checked = _to_local(r.get("checked_at"))
        out[r["keyword"]] = {
            "groups": groups if isinstance(groups, list) else [],
            "total": int(r.get("total") or 0),
            "reason": r.get("reason") or "",
            "checked_at": checked.strftime("%H:%M %d/%m/%Y") if hasattr(checked, "strftime") else str(checked or ""),
        }
    return out
