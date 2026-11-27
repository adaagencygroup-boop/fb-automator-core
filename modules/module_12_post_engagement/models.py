"""
Module 12 — lưu trữ PostgreSQL (dùng chung kết nối core.database như các module khác; mỗi user một kho riêng).

pe_posts     bài viết (thông tin bài + số tương tác Facebook hiển thị + số đã quét được)
pe_users     1 người trên 1 bài: cờ Like / Share / Comment, loại cảm xúc, mức tiềm năng (tự tính lại mỗi lần ghi)
pe_comments  từng bình luận (gốc + trả lời) kèm toàn văn nội dung
pe_sessions  phiên Kiểm tra / Quét: cấu hình, log, tiến độ để "Chạy tiếp"
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime as _dt, timezone as _tz
from typing import Any, Iterable, Optional

from core.database.connection import db

# Thời điểm Engine này khởi động (giờ UTC như CURRENT_TIMESTAMP) — phiên RUNNING bắt đầu trước mốc này là phiên chết.
_ENGINE_STARTED_UTC = _dt.now(_tz.utc).replace(tzinfo=None)

BATCH = 50  # số dòng mỗi câu INSERT nhiều dòng

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS pe_posts (
        id SERIAL PRIMARY KEY,
        owner_username VARCHAR(100) NOT NULL,
        post_key VARCHAR(255) NOT NULL,
        post_url TEXT NOT NULL,
        fb_post_id VARCHAR(64),
        content TEXT,
        source_type VARCHAR(20) NOT NULL DEFAULT 'unknown',
        source_name VARCHAR(500),
        source_id VARCHAR(64),
        author_name VARCHAR(255),
        author_id VARCHAR(64),
        posted_at TIMESTAMP,
        fb_like_count INTEGER NOT NULL DEFAULT 0,
        fb_comment_count INTEGER NOT NULL DEFAULT 0,
        fb_share_count INTEGER NOT NULL DEFAULT 0,
        like_count INTEGER NOT NULL DEFAULT 0,
        comment_count INTEGER NOT NULL DEFAULT 0,
        share_count INTEGER NOT NULL DEFAULT 0,
        availability VARCHAR(20) NOT NULL DEFAULT 'unknown',
        note TEXT,
        search_fold TEXT,
        checked_at TIMESTAMP,
        scanned_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_pe_posts_owner_key UNIQUE (owner_username, post_key)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS pe_users (
        id SERIAL PRIMARY KEY,
        owner_username VARCHAR(100) NOT NULL,
        post_key VARCHAR(255) NOT NULL,
        uid VARCHAR(64) NOT NULL,
        name VARCHAR(255),
        name_fold VARCHAR(255),
        profile_url TEXT,
        avatar_url TEXT,
        is_page BOOLEAN NOT NULL DEFAULT FALSE,
        has_like BOOLEAN NOT NULL DEFAULT FALSE,
        has_share BOOLEAN NOT NULL DEFAULT FALSE,
        has_comment BOOLEAN NOT NULL DEFAULT FALSE,
        reaction_type VARCHAR(20),
        liked_at TIMESTAMP,
        shared_at TIMESTAMP,
        commented_at TIMESTAMP,
        tier SMALLINT NOT NULL DEFAULT 3,
        first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_pe_users UNIQUE (owner_username, post_key, uid)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS pe_comments (
        id SERIAL PRIMARY KEY,
        owner_username VARCHAR(100) NOT NULL,
        post_key VARCHAR(255) NOT NULL,
        comment_id VARCHAR(64) NOT NULL,
        parent_id VARCHAR(64),
        depth SMALLINT NOT NULL DEFAULT 0,
        uid VARCHAR(64) NOT NULL,
        name VARCHAR(255),
        text TEXT,
        text_fold TEXT,
        commented_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_pe_comments UNIQUE (owner_username, post_key, comment_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS pe_sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(64) NOT NULL UNIQUE,
        owner_username VARCHAR(100) NOT NULL,
        kind VARCHAR(20) NOT NULL DEFAULT 'SCAN',
        title VARCHAR(500),
        status VARCHAR(30) NOT NULL DEFAULT 'RUNNING',
        config TEXT DEFAULT '{}',
        logs TEXT,
        resume_state TEXT,
        total_likes INTEGER NOT NULL DEFAULT 0,
        total_comments INTEGER NOT NULL DEFAULT 0,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_pe_posts_owner ON pe_posts (owner_username, scanned_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_pe_users_post ON pe_users (owner_username, post_key, id);",
    "CREATE INDEX IF NOT EXISTS idx_pe_comments_post ON pe_comments (owner_username, post_key, id);",
    "CREATE INDEX IF NOT EXISTS idx_pe_sessions_owner ON pe_sessions (owner_username, started_at DESC);",
    # is_known_page: tìm nguồn đã từng được nhận là fanpage
    "CREATE INDEX IF NOT EXISTS idx_pe_posts_source ON pe_posts (owner_username, source_id);",
]


_schema_ready = False


def init_models() -> None:
    global _schema_ready
    for stmt in SCHEMA:
        db.execute(stmt)
    db.execute(_RETIER_SQL)
    _schema_ready = True
    print("[Module 12 DB] Schema pe_posts / pe_users / pe_comments / pe_sessions ready.")


def ensure_schema() -> None:
    """Engine khởi động nhanh có thể bỏ qua bước tạo bảng — tạo ở yêu cầu đầu tiên."""
    if not _schema_ready:
        init_models()


# ---------------------------------------------------------------------------
# Tiện ích
# ---------------------------------------------------------------------------


def fold(text: Any) -> str:
    """Bỏ dấu + chữ thường + gộp khoảng trắng: tìm 'phu tho' ra 'Phú Thọ'."""
    s = unicodedata.normalize("NFD", str(text or ""))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn").replace("đ", "d").replace("Đ", "D")
    return re.sub(r"\s+", " ", s).strip().lower()


def _to_local(value: Any) -> Any:
    """CURRENT_TIMESTAMP của Postgres là giờ UTC (không múi giờ) → giờ máy để hiển thị."""
    if not hasattr(value, "strftime"):
        return value
    if getattr(value, "tzinfo", None) is not None:
        return value.astimezone().replace(tzinfo=None)
    return value.replace(tzinfo=_tz.utc).astimezone().replace(tzinfo=None)


def fmt_dt(value: Any, fmt: str = "%d/%m/%Y %H:%M") -> str:
    return _to_local(value).strftime(fmt) if hasattr(value, "strftime") else ""


def utc_from_epoch(ts: Any) -> Optional[_dt]:
    try:
        ts = int(ts)
    except (TypeError, ValueError):
        return None
    if ts <= 0:
        return None
    return _dt.fromtimestamp(ts, _tz.utc).replace(tzinfo=None)


def _chunks(rows: list, size: int = BATCH) -> Iterable[list]:
    for i in range(0, len(rows), size):
        yield rows[i:i + size]


def _owner(owner: Optional[str]) -> str:
    return (owner or "").strip()


def _like(word: str) -> str:
    r"""Mẫu LIKE '%từ%' — thoát \ % _ để gõ '%' / 'a_b' không khớp mọi dòng (ký tự thoát mặc định của Postgres là \)."""
    return "%" + word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


# ---------------------------------------------------------------------------
# Bài viết
# ---------------------------------------------------------------------------


def upsert_post(owner: Optional[str], post: dict[str, Any]) -> None:
    """Thêm / cập nhật thông tin bài (link, nội dung, nguồn, thời gian đăng, số tương tác Facebook, trạng thái)."""
    owner = _owner(owner)
    key = str(post.get("post_key") or "").strip()
    url = str(post.get("post_url") or post.get("url") or "").strip()
    if not owner or not key or not url:
        return
    content = (post.get("content") or "")[:20000] or None
    source_name = (post.get("source_name") or "")[:500] or None
    search = fold(" ".join(str(x) for x in (content or "", source_name or "", key, post.get("fb_post_id") or "", url)))
    db.execute(
        """
        INSERT INTO pe_posts (owner_username, post_key, post_url, fb_post_id, content, source_type, source_name, source_id,
                              author_name, author_id, posted_at, fb_like_count, fb_comment_count, fb_share_count,
                              availability, note, search_fold, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (owner_username, post_key) DO UPDATE SET
            post_url = EXCLUDED.post_url,
            fb_post_id = COALESCE(EXCLUDED.fb_post_id, pe_posts.fb_post_id),
            content = COALESCE(EXCLUDED.content, pe_posts.content),
            source_type = CASE WHEN EXCLUDED.source_type <> 'unknown' THEN EXCLUDED.source_type ELSE pe_posts.source_type END,
            source_name = COALESCE(EXCLUDED.source_name, pe_posts.source_name),
            source_id = COALESCE(EXCLUDED.source_id, pe_posts.source_id),
            author_name = COALESCE(EXCLUDED.author_name, pe_posts.author_name),
            author_id = COALESCE(EXCLUDED.author_id, pe_posts.author_id),
            posted_at = COALESCE(EXCLUDED.posted_at, pe_posts.posted_at),
            fb_like_count = GREATEST(EXCLUDED.fb_like_count, CASE WHEN EXCLUDED.availability = 'available' THEN 0 ELSE pe_posts.fb_like_count END),
            fb_comment_count = GREATEST(EXCLUDED.fb_comment_count, CASE WHEN EXCLUDED.availability = 'available' THEN 0 ELSE pe_posts.fb_comment_count END),
            fb_share_count = GREATEST(EXCLUDED.fb_share_count, CASE WHEN EXCLUDED.availability = 'available' THEN 0 ELSE pe_posts.fb_share_count END),
            availability = EXCLUDED.availability,
            note = EXCLUDED.note,
            search_fold = EXCLUDED.search_fold,
            checked_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        """,
        (
            owner, key, url, post.get("fb_post_id") or None, content, post.get("source_type") or "unknown", source_name,
            post.get("source_id") or None, (post.get("author_name") or "")[:255] or None, post.get("author_id") or None,
            utc_from_epoch(post.get("posted_ts")), int(post.get("fb_like_count") or 0), int(post.get("fb_comment_count") or 0),
            int(post.get("fb_share_count") or 0), post.get("availability") or "unknown", post.get("note") or None, search,
        ),
    )


def refresh_post_counts(owner: Optional[str], post_key: str) -> dict[str, int]:
    """Đếm lại số người Like và số bình luận đã quét được của bài (Share chỉ có tổng số của Facebook)."""
    owner = _owner(owner)
    row = db.fetch_one(
        """
        SELECT
          (SELECT COUNT(*) FROM pe_users WHERE owner_username = ? AND post_key = ? AND has_like) AS likes,
          (SELECT COUNT(*) FROM pe_comments WHERE owner_username = ? AND post_key = ?) AS comments
        """,
        (owner, post_key, owner, post_key),
    ) or {}
    counts = {k: int(row.get(k) or 0) for k in ("likes", "comments")}
    db.execute(
        "UPDATE pe_posts SET like_count = ?, comment_count = ?, scanned_at = CURRENT_TIMESTAMP, "
        "updated_at = CURRENT_TIMESTAMP WHERE owner_username = ? AND post_key = ?",
        (counts["likes"], counts["comments"], owner, post_key),
    )
    return counts


def _post_row(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "post_key": r.get("post_key"),
        "post_url": r.get("post_url"),
        "fb_post_id": r.get("fb_post_id") or "",
        "content": r.get("content") or "",
        "source_type": r.get("source_type") or "unknown",
        "source_name": r.get("source_name") or "",
        "author_name": r.get("author_name") or "",
        "posted_at": fmt_dt(r.get("posted_at")),
        "posted_date": fmt_dt(r.get("posted_at"), "%d/%m/%Y"),
        "fb_like_count": int(r.get("fb_like_count") or 0),
        "fb_comment_count": int(r.get("fb_comment_count") or 0),
        "fb_share_count": int(r.get("fb_share_count") or 0),
        "like_count": int(r.get("like_count") or 0),
        "comment_count": int(r.get("comment_count") or 0),
        "share_count": int(r.get("share_count") or 0),
        "availability": r.get("availability") or "unknown",
        "note": r.get("note") or "",
        "checked_at": fmt_dt(r.get("checked_at")),
        "scanned_at": fmt_dt(r.get("scanned_at")),
        "scanned_date": fmt_dt(r.get("scanned_at"), "%d/%m/%Y"),
    }


def get_posts(owner: Optional[str], keys: list[str]) -> dict[str, dict[str, Any]]:
    owner = _owner(owner)
    keys = [str(k) for k in keys or [] if str(k).strip()]
    if not owner or not keys:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for part in _chunks(keys, 200):
        rows = db.fetch_all(
            f"SELECT * FROM pe_posts WHERE owner_username = ? AND post_key IN ({','.join('?' * len(part))})",
            (owner, *part),
        )
        for r in rows:
            out[r["post_key"]] = _post_row(r)
    return out


def list_posts(owner: Optional[str], *, search: str = "", source: str = "all", sort: str = "newest",
               keys: Optional[list[str]] = None, limit: int = 200, offset: int = 0) -> dict[str, Any]:
    """Kho bài đã quét (cột trái): tìm theo nội dung / mã bài / nhóm / page (không dấu), lọc nguồn, sắp xếp."""
    owner = _owner(owner)
    if not owner:
        return {"posts": [], "total": 0}
    cond, params = ["owner_username = ?", "scanned_at IS NOT NULL"], [owner]
    if keys is not None:
        keys = [str(k) for k in keys if str(k).strip()]
        if not keys:
            return {"posts": [], "total": 0}
        cond.append(f"post_key IN ({','.join('?' * len(keys))})")
        params.extend(keys)
    if source in ("group", "page", "profile"):
        cond.append("source_type = ?")
        params.append(source)
    q = fold(search)
    if q:
        for word in q.split(" ")[:6]:
            cond.append("search_fold LIKE ?")
            params.append(_like(word))
    order = {
        # Nhiều tương tác nhất = tổng TRÊN FACEBOOK (đúng 3 số hiện trên thẻ bài), không phải số người đã quét được
        "most": "(fb_like_count + fb_comment_count + fb_share_count) DESC, scanned_at DESC",
        "oldest": "scanned_at ASC",
    }.get(sort, "scanned_at DESC")
    where = " AND ".join(cond)
    total = int((db.fetch_one(f"SELECT COUNT(*) AS c FROM pe_posts WHERE {where}", tuple(params)) or {}).get("c") or 0)
    rows = db.fetch_all(
        f"SELECT * FROM pe_posts WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
        (*params, max(1, min(1000, int(limit))), max(0, int(offset))),
    )
    return {"posts": [_post_row(r) for r in rows], "total": total}


def list_post_keys(owner: Optional[str], *, search: str = "", source: str = "all", sort: str = "newest") -> list[str]:
    """Mã mọi bài trong kho khớp bộ lọc (Xuất toàn bộ kho — không giới hạn 200 bài của 1 trang danh sách)."""
    out: list[str] = []
    offset = 0
    while True:
        page = list_posts(owner, search=search, source=source, sort=sort, limit=1000, offset=offset)
        out.extend(p["post_key"] for p in page["posts"])
        offset += 1000
        if offset >= page["total"] or not page["posts"]:
            return out


def is_known_page(owner: Optional[str], source_id: str) -> bool:
    """Nguồn này đã từng được nhận là fanpage ở bài khác (trang reel không có dấu hiệu fanpage)."""
    owner = _owner(owner)
    if not owner or not source_id:
        return False
    return bool(db.fetch_one("SELECT 1 AS x FROM pe_posts WHERE owner_username = ? AND source_id = ? AND source_type = 'page' LIMIT 1",
                             (owner, str(source_id))))


def delete_posts(owner: Optional[str], keys: list[str]) -> int:
    """Xoá bài khỏi kho cùng toàn bộ người tương tác / bình luận của bài."""
    owner = _owner(owner)
    keys = [str(k) for k in keys or [] if str(k).strip()]
    if not owner or not keys:
        return 0
    deleted = 0
    for part in _chunks(keys, 200):
        marks = ",".join("?" * len(part))
        db.execute(f"DELETE FROM pe_comments WHERE owner_username = ? AND post_key IN ({marks})", (owner, *part))
        db.execute(f"DELETE FROM pe_users WHERE owner_username = ? AND post_key IN ({marks})", (owner, *part))
        cur = db.execute(f"DELETE FROM pe_posts WHERE owner_username = ? AND post_key IN ({marks})", (owner, *part))
        rc = getattr(cur, "rowcount", None)
        deleted += rc if isinstance(rc, int) and rc >= 0 else len(part)
    return deleted


# ---------------------------------------------------------------------------
# Người tương tác + phân tầng
# ---------------------------------------------------------------------------

# Mức tiềm năng (khớp fb_parse.tier_of): vừa Like vừa bình luận → 1, chỉ 1 trong 2 → 2. Không tính Share vì Facebook
# chỉ cho xem tổng số lượt chia sẻ; cột has_share / shared_at giữ lại trong bảng nhưng không còn được ghi.
_TIER_SQL = (
    "CASE WHEN (pe_users.has_like OR EXCLUDED.has_like) AND (pe_users.has_comment OR EXCLUDED.has_comment) "
    "THEN 1 ELSE 2 END"
)
# Dữ liệu quét trước khi đổi quy tắc (3 mức có tính Share) → tính lại 1 lần lúc khởi động
_RETIER_SQL = (
    "UPDATE pe_users SET tier = CASE WHEN has_like AND has_comment THEN 1 ELSE 2 END "
    "WHERE tier <> CASE WHEN has_like AND has_comment THEN 1 ELSE 2 END"
)
TIERS = (1, 2)


def save_users(owner: Optional[str], post_key: str, users: list[dict[str, Any]], *, action: str) -> int:
    """Ghi người tương tác (action: like | comment). Đã có thì bật thêm cờ hành động và NÂNG HẠNG ngay.

    Mức tiềm năng: vừa Like vừa bình luận → Mức 1, chỉ 1 trong 2 → Mức 2 (người không có hành động nào thì không
    bao giờ được ghi).
    """
    owner = _owner(owner)
    if not owner or not post_key or action not in ("like", "comment"):
        return 0
    seen: dict[str, dict[str, Any]] = {}
    for u in users or []:
        uid = str(u.get("uid") or "").strip()
        if uid.isdigit():
            seen[uid] = u
    rows = list(seen.values())
    for part in _chunks(rows):
        values, params = [], []
        for u in part:
            values.append("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)")
            when = utc_from_epoch(u.get("ts")) or _dt.now(_tz.utc).replace(tzinfo=None)
            params.extend([
                owner, post_key, str(u["uid"]), (u.get("name") or "")[:255] or None, fold(u.get("name"))[:255] or None,
                u.get("profile_url") or f"https://www.facebook.com/{u['uid']}", u.get("avatar") or None, bool(u.get("is_page")),
                action == "like", action == "share", action == "comment",
                (u.get("reaction") or "LIKE") if action == "like" else None,
                when if action == "like" else None, when if action == "share" else None, when if action == "comment" else None,
            ])
        db.execute(
            f"""
            INSERT INTO pe_users (owner_username, post_key, uid, name, name_fold, profile_url, avatar_url, is_page,
                                  has_like, has_share, has_comment, reaction_type, liked_at, shared_at, commented_at, tier)
            VALUES {', '.join(values)}
            ON CONFLICT (owner_username, post_key, uid) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, pe_users.name),
                name_fold = COALESCE(EXCLUDED.name_fold, pe_users.name_fold),
                profile_url = COALESCE(EXCLUDED.profile_url, pe_users.profile_url),
                avatar_url = COALESCE(EXCLUDED.avatar_url, pe_users.avatar_url),
                is_page = pe_users.is_page OR EXCLUDED.is_page,
                has_like = pe_users.has_like OR EXCLUDED.has_like,
                has_share = pe_users.has_share OR EXCLUDED.has_share,
                has_comment = pe_users.has_comment OR EXCLUDED.has_comment,
                reaction_type = COALESCE(EXCLUDED.reaction_type, pe_users.reaction_type),
                liked_at = COALESCE(pe_users.liked_at, EXCLUDED.liked_at),
                shared_at = COALESCE(pe_users.shared_at, EXCLUDED.shared_at),
                commented_at = CASE WHEN pe_users.commented_at IS NULL THEN EXCLUDED.commented_at
                                    WHEN EXCLUDED.commented_at IS NULL THEN pe_users.commented_at
                                    ELSE LEAST(pe_users.commented_at, EXCLUDED.commented_at) END,
                tier = {_TIER_SQL},
                updated_at = CURRENT_TIMESTAMP
            """,
            tuple(params),
        )
    return len(rows)


def save_comments(owner: Optional[str], post_key: str, comments: list[dict[str, Any]]) -> int:
    """Ghi bình luận (mỗi bình luận 1 dòng, không trùng) và bật cờ 'đã bình luận' cho người viết."""
    owner = _owner(owner)
    if not owner or not post_key:
        return 0
    uniq: dict[str, dict[str, Any]] = {}
    for c in comments or []:
        cid, uid = str(c.get("comment_id") or "").strip(), str(c.get("uid") or "").strip()
        if cid and uid.isdigit():
            uniq[cid] = c
    rows = list(uniq.values())
    for part in _chunks(rows):
        values, params = [], []
        for c in part:
            values.append("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            params.extend([
                owner, post_key, str(c["comment_id"]), str(c.get("parent_id") or "") or None, int(c.get("depth") or 0),
                str(c["uid"]), (c.get("name") or "")[:255] or None, c.get("text") or "", fold(c.get("text"))[:5000],
                utc_from_epoch(c.get("created_time")),
            ])
        db.execute(
            f"""
            INSERT INTO pe_comments (owner_username, post_key, comment_id, parent_id, depth, uid, name, text, text_fold, commented_at)
            VALUES {', '.join(values)}
            ON CONFLICT (owner_username, post_key, comment_id) DO UPDATE SET
                text = CASE WHEN EXCLUDED.text <> '' THEN EXCLUDED.text ELSE pe_comments.text END,
                text_fold = CASE WHEN EXCLUDED.text <> '' THEN EXCLUDED.text_fold ELSE pe_comments.text_fold END,
                parent_id = COALESCE(EXCLUDED.parent_id, pe_comments.parent_id),
                commented_at = COALESCE(EXCLUDED.commented_at, pe_comments.commented_at)
            """,
            tuple(params),
        )
    authors: dict[str, dict[str, Any]] = {}
    for c in rows:
        uid = str(c["uid"])
        prev = authors.get(uid)
        ts = c.get("created_time")
        if prev is None or (ts and (not prev.get("ts") or ts < prev["ts"])):
            authors[uid] = {"uid": uid, "name": c.get("name"), "profile_url": c.get("profile_url"), "avatar": c.get("avatar"),
                            "is_page": c.get("is_page"), "ts": ts}
    save_users(owner, post_key, list(authors.values()), action="comment")
    return len(rows)


def known_uids(owner: Optional[str], post_key: str, action: str) -> set[str]:
    owner = _owner(owner)
    col = {"like": "has_like", "comment": "has_comment"}.get(action)
    if not owner or not col:
        return set()
    rows = db.fetch_all(f"SELECT uid FROM pe_users WHERE owner_username = ? AND post_key = ? AND {col}", (owner, post_key))
    return {str(r["uid"]) for r in rows}


def known_comment_ids(owner: Optional[str], post_key: str) -> set[str]:
    owner = _owner(owner)
    if not owner:
        return set()
    rows = db.fetch_all("SELECT comment_id FROM pe_comments WHERE owner_username = ? AND post_key = ?", (owner, post_key))
    return {str(r["comment_id"]) for r in rows}


TABS = ("like", "comment")  # không có tab Share: Facebook chỉ cho xem tổng số lượt chia sẻ


def list_engagements(owner: Optional[str], post_key: str, *, tab: str = "like", search: str = "", tier: Optional[int] = None,
                     limit: int = 20, offset: int = 0, export: bool = False) -> dict[str, Any]:
    """Bảng chi tiết 1 bài theo tab. Tab Bình luận: mỗi bình luận 1 dòng (kèm nội dung), mức tiềm năng là của người viết
    trên toàn bài — không phụ thuộc tab đang mở."""
    owner = _owner(owner)
    tab = tab if tab in TABS else "like"
    if not owner or not post_key:
        return {"rows": [], "total": 0, "counts": {}}
    q = fold(search)
    if tab == "comment":
        cond, params = ["c.owner_username = ?", "c.post_key = ?"], [owner, post_key]
        for word in q.split(" ")[:6] if q else []:
            cond.append("(COALESCE(u.name_fold, '') LIKE ? OR c.uid LIKE ? OR COALESCE(c.text_fold, '') LIKE ?)")
            params.extend([_like(word)] * 3)
        if tier in TIERS:
            cond.append("u.tier = ?")
            params.append(int(tier))
        where = " AND ".join(cond)
        base = (f"FROM pe_comments c LEFT JOIN pe_users u ON u.owner_username = c.owner_username "
                f"AND u.post_key = c.post_key AND u.uid = c.uid WHERE {where}")
        total = int((db.fetch_one(f"SELECT COUNT(*) AS n {base}", tuple(params)) or {}).get("n") or 0)
        lim = "" if export else " LIMIT ? OFFSET ?"
        rows = db.fetch_all(
            f"SELECT c.id, c.comment_id, c.parent_id, c.depth, c.uid, COALESCE(u.name, c.name) AS name, u.profile_url, "
            f"u.avatar_url, u.reaction_type, u.tier, u.has_like, u.has_comment, c.text, c.commented_at AS at "
            f"{base} ORDER BY c.commented_at ASC NULLS LAST, c.id ASC{lim}",
            tuple(params) + (() if export else (max(1, min(500, int(limit))), max(0, int(offset)))),
        )
    else:
        cond, params = ["owner_username = ?", "post_key = ?", "has_like"], [owner, post_key]
        for word in q.split(" ")[:6] if q else []:
            cond.append("(COALESCE(name_fold, '') LIKE ? OR uid LIKE ?)")
            params.extend([_like(word)] * 2)
        if tier in TIERS:
            cond.append("tier = ?")
            params.append(int(tier))
        where = " AND ".join(cond)
        total = int((db.fetch_one(f"SELECT COUNT(*) AS n FROM pe_users WHERE {where}", tuple(params)) or {}).get("n") or 0)
        lim = "" if export else " LIMIT ? OFFSET ?"
        rows = db.fetch_all(
            f"SELECT id, uid, name, profile_url, avatar_url, reaction_type, tier, has_like, has_comment, "
            f"liked_at AS at, '' AS text FROM pe_users WHERE {where} ORDER BY id ASC{lim}",
            tuple(params) + (() if export else (max(1, min(500, int(limit))), max(0, int(offset)))),
        )
    counts = db.fetch_one(
        """
        SELECT
          (SELECT COUNT(*) FROM pe_users WHERE owner_username = ? AND post_key = ? AND has_like) AS like_count,
          (SELECT COUNT(*) FROM pe_comments WHERE owner_username = ? AND post_key = ?) AS comment_count
        """,
        (owner, post_key, owner, post_key),
    ) or {}
    out = []
    for r in rows:
        uid = str(r.get("uid") or "")
        out.append({
            "id": f"{tab}-{r.get('comment_id') or r.get('id')}",
            "uid": uid,
            "name": r.get("name") or uid,
            "profile_url": r.get("profile_url") or f"https://www.facebook.com/{uid}",
            "avatar_url": r.get("avatar_url") or "",
            "reaction": r.get("reaction_type") or "",
            "tier": int(r.get("tier") or 2),
            "has_like": bool(r.get("has_like")),
            "has_comment": bool(r.get("has_comment")),
            "time": fmt_dt(r.get("at"), "%d/%m/%Y %H:%M"),
            "text": r.get("text") or "",
            "comment_id": r.get("comment_id") or "",
            "is_reply": bool(r.get("parent_id")),
        })
    return {
        "rows": out,
        "total": total,
        "counts": {k: int(counts.get(k) or 0) for k in ("like_count", "comment_count")},
    }


def export_engagements(owner: Optional[str], post_keys: list[str], *, scope: str = "all", tab: str = "like",
                       search: str = "", tier: Optional[int] = None) -> list[dict[str, Any]]:
    """Dữ liệu xuất file. scope=tab: đúng tab đang xem; scope=all: Like + Bình luận của các bài."""
    owner = _owner(owner)
    posts = get_posts(owner, post_keys)
    tabs = [tab] if scope == "tab" else list(TABS)
    out: list[dict[str, Any]] = []
    for key in post_keys:
        post = posts.get(key) or {}
        for t in tabs:
            data = list_engagements(owner, key, tab=t, search=search, tier=tier, export=True)
            for r in data["rows"]:
                out.append({**r, "action": t, "post_key": key, "post_url": post.get("post_url") or "",
                            "post_title": (post.get("content") or "")[:120]})
    return out


# ---------------------------------------------------------------------------
# Phiên (Kiểm tra / Quét) + Chạy tiếp
# ---------------------------------------------------------------------------

RESUMABLE_STATUSES = {"INTERRUPTED", "ABORTED"}


def create_session(owner: Optional[str], session_id: str, *, kind: str, title: str, config: dict[str, Any]) -> None:
    owner = _owner(owner)
    if not owner:
        return
    db.execute(
        "INSERT INTO pe_sessions (session_id, owner_username, kind, title, status, config) VALUES (?, ?, ?, ?, 'RUNNING', ?) "
        "ON CONFLICT (session_id) DO NOTHING",
        (session_id, owner, kind, title[:500], json.dumps(config, ensure_ascii=False, default=str)),
    )


def update_session(session_id: str, *, status: Optional[str] = None, logs: Optional[list[dict[str, Any]]] = None,
                   finished: bool = False, total_likes: Optional[int] = None, total_comments: Optional[int] = None) -> None:
    sets, params = [], []
    if status:
        sets.append("status = ?")
        params.append(status)
    if logs is not None:
        from modules.module_12_post_engagement.common import session_log_entries

        sets.append("logs = ?")
        params.append(json.dumps(session_log_entries(logs), ensure_ascii=False))
    if finished:
        sets.append("finished_at = CURRENT_TIMESTAMP")
    if total_likes is not None:
        sets.append("total_likes = ?")
        params.append(int(total_likes))
    if total_comments is not None:
        sets.append("total_comments = ?")
        params.append(int(total_comments))
    if not sets:
        return
    db.execute(f"UPDATE pe_sessions SET {', '.join(sets)} WHERE session_id = ?", (*params, session_id))


def save_resume_state(session_id: str, state: dict[str, Any]) -> None:
    db.execute("UPDATE pe_sessions SET resume_state = ? WHERE session_id = ?",
               (json.dumps(state, ensure_ascii=False, default=str), session_id))


def mark_interrupted_sessions(owner: Optional[str]) -> int:
    """Phiên còn RUNNING nhưng bắt đầu TRƯỚC khi Engine này khởi động thì đã chết (job chỉ sống trong RAM)."""
    owner = _owner(owner)
    if not owner:
        return 0
    rows = db.fetch_all(
        "SELECT session_id FROM pe_sessions WHERE owner_username = ? AND status IN ('RUNNING', 'PAUSED') AND started_at < ?",
        (owner, _ENGINE_STARTED_UTC),
    )
    for r in rows:
        db.execute("UPDATE pe_sessions SET status = 'INTERRUPTED' WHERE owner_username = ? AND session_id = ?",
                   (owner, r["session_id"]))
    return len(rows)


def resume_remaining(state: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
    """Bài chưa quét xong của phiên — mỗi bài kèm hạn mức Like / Bình luận còn thiếu."""
    if not isinstance(state, dict):
        return []
    req = state.get("request") or {}
    progress = state.get("progress") or {}
    out = []
    for p in req.get("posts") or []:
        row = progress.get(str(p.get("post_key"))) or {}
        if row.get("done"):
            continue
        out.append({
            **p,
            "like_quota": max(0, int(p.get("like_quota") or 0) - int(row.get("likes") or 0)),
            "comment_quota": max(0, int(p.get("comment_quota") or 0) - int(row.get("comments") or 0)),
        })
    return [p for p in out if p["like_quota"] > 0 or p["comment_quota"] > 0]


def get_resume_info(owner: Optional[str], session_id: str) -> Optional[dict[str, Any]]:
    owner = _owner(owner)
    if not owner or not session_id:
        return None
    mark_interrupted_sessions(owner)
    row = db.fetch_one("SELECT session_id, status, resume_state FROM pe_sessions WHERE owner_username = ? AND session_id = ?",
                       (owner, session_id))
    if not row:
        return None
    try:
        state = json.loads(row.get("resume_state") or "null")
    except Exception:
        state = None
    return {"session_id": row["session_id"], "status": str(row.get("status") or "").upper(), "state": state,
            "remaining": resume_remaining(state)}


def latest_resumable(owner: Optional[str]) -> Optional[dict[str, Any]]:
    """Phiên Quét gần nhất còn bài chưa quét xong (trang Quét hiện nút Chạy tiếp)."""
    owner = _owner(owner)
    if not owner:
        return None
    mark_interrupted_sessions(owner)
    row = db.fetch_one(
        "SELECT session_id, title, status, resume_state, started_at FROM pe_sessions WHERE owner_username = ? AND kind = 'SCAN' "
        "ORDER BY started_at DESC LIMIT 1",
        (owner,),
    )
    if not row or str(row.get("status") or "").upper() not in RESUMABLE_STATUSES:
        return None
    try:
        state = json.loads(row.get("resume_state") or "null")
    except Exception:
        return None
    remaining = resume_remaining(state)
    if not remaining:
        return None
    return {
        "session_id": row["session_id"],
        "title": row.get("title") or "",
        "status": str(row.get("status") or "").upper(),
        "startTime": fmt_dt(row.get("started_at"), "%H:%M %d/%m/%Y"),
        "remaining": len(remaining),
        "items": [{"label": (p.get("title") or p.get("post_url") or p.get("post_key") or "")[:80],
                   "likes_left": p["like_quota"], "comments_left": p["comment_quota"]} for p in remaining[:6]],
    }
