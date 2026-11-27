"""
compose_repository.py
Module 03 - Tab 2: Nháp ô soạn bài chung (bảng post_compose_drafts).
Mỗi người dùng có 1 nháp cho mỗi loại bài, gồm 2 cách soạn (giữ cả hai, `layout` chọn cách dùng khi đăng):
  - TEXT     : ô soạn chung (các bài tách bằng dòng "---") + kho ảnh chung, chia ngẫu nhiên cho nick
  - ACCOUNTS : "Từng bài" — account_posts = {uid: [{content, images}, ...]}, bài thứ i cho khung giờ thứ i
"""
import json
import logging
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from core.database.connection import db
from modules.module_02_account_manager.context import owner_context
from modules.module_03_acc_farm.compose_service import (
    CONTENT_MULTI,
    IMAGE_MULTI,
    IMAGE_NONE,
    LAYOUT_ACCOUNTS,
    LAYOUT_TEXT,
    MAX_ACCOUNT_POST_IMAGES,
    MAX_TIME_SLOTS,
    append_posts,
    clamp_image_range,
    normalize_account_posts,
    normalize_content_mode,
    normalize_image_mode,
    normalize_layout,
    normalize_pool_images,
)

logger = logging.getLogger(__name__)

_COLUMNS = (
    "post_type, content_text, content_mode, image_mode, image_paths, min_images, max_images, "
    "layout, account_posts, updated_at"
)


def _owner() -> str:
    return owner_context.get() or ""


def _load_paths(raw: Any) -> List[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return []
    return normalize_pool_images(value if isinstance(value, list) else [])


def _dump_paths(paths: Iterable[str]) -> Optional[str]:
    clean = normalize_pool_images(paths)
    return json.dumps(clean, ensure_ascii=False) if clean else None


def load_account_posts(raw: Any) -> Dict[str, List[Dict[str, Any]]]:
    if not raw:
        return {}
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return {}
    return normalize_account_posts(value)


def dump_account_posts(value: Any) -> Optional[str]:
    clean = {uid: entries for uid, entries in normalize_account_posts(value).items() if entries}
    return json.dumps(clean, ensure_ascii=False) if clean else None


def _to_draft(row: Optional[Dict[str, Any]], post_type: str) -> Dict[str, Any]:
    if not row:
        return {
            "post_type": post_type,
            "content_text": "",
            "content_mode": CONTENT_MULTI,
            "image_mode": IMAGE_NONE,
            "image_paths": [],
            "min_images": 1,
            "max_images": 1,
            "layout": LAYOUT_ACCOUNTS,  # nháp mới mở ở dạng "Từng bài"
            "account_posts": {},
            "updated_at": None,
        }
    out = dict(row)
    out["image_paths"] = _load_paths(row.get("image_paths"))
    out["layout"] = normalize_layout(row.get("layout"))
    out["account_posts"] = load_account_posts(row.get("account_posts"))
    return out


def get_compose_draft(post_type: str) -> Dict[str, Any]:
    row = db.fetch_one(
        f"SELECT {_COLUMNS} FROM post_compose_drafts WHERE owner_key = %s AND post_type = %s",
        (_owner(), post_type),
    )
    return _to_draft(row, post_type)


def save_compose_draft(
    post_type: str,
    *,
    content_text: str,
    content_mode: Optional[str],
    image_mode: Optional[str],
    image_paths: Optional[Iterable[str]],
    min_images: Optional[int],
    max_images: Optional[int],
    layout: Optional[str] = None,
    account_posts: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    lo, hi = clamp_image_range(min_images, max_images)
    row = db.fetch_one(
        f"""
        INSERT INTO post_compose_drafts
            (owner_key, post_type, content_text, content_mode, image_mode, image_paths, min_images, max_images,
             layout, account_posts, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (owner_key, post_type) DO UPDATE SET
            content_text = EXCLUDED.content_text,
            content_mode = EXCLUDED.content_mode,
            image_mode = EXCLUDED.image_mode,
            image_paths = EXCLUDED.image_paths,
            min_images = EXCLUDED.min_images,
            max_images = EXCLUDED.max_images,
            layout = EXCLUDED.layout,
            account_posts = EXCLUDED.account_posts,
            updated_at = NOW()
        RETURNING {_COLUMNS}
        """,
        (
            _owner(), post_type, content_text or "",
            normalize_content_mode(content_mode), normalize_image_mode(image_mode),
            _dump_paths(image_paths or []), lo, hi,
            normalize_layout(layout), dump_account_posts(account_posts or {}),
        ),
    )
    return _to_draft(row, post_type)


def append_to_compose_draft(post_type: str, posts: Iterable[str], images: Iterable[str] = ()) -> Dict[str, Any]:
    """Thêm bài (AI vừa tạo) vào cuối ô soạn và ảnh vào kho chung — trong 1 transaction có khoá dòng.

    Ô chuyển sang "Nhiều nội dung"; có ảnh mới mà kho đang "Không ảnh" thì chuyển sang "Nhiều ảnh".
    """
    owner = _owner()
    new_posts = [p for p in posts if p and p.strip()]
    new_images = normalize_pool_images(images)
    with db.session() as cur:
        cur.execute(
            "INSERT INTO post_compose_drafts (owner_key, post_type) VALUES (%s, %s) "
            "ON CONFLICT (owner_key, post_type) DO NOTHING",
            (owner, post_type),
        )
        cur.execute(
            f"SELECT {_COLUMNS} FROM post_compose_drafts WHERE owner_key = %s AND post_type = %s FOR UPDATE",
            (owner, post_type),
        )
        current = _to_draft(cur.fetchone(), post_type)
        image_mode = current["image_mode"]
        if new_images and image_mode == IMAGE_NONE:
            image_mode = IMAGE_MULTI
        cur.execute(
            f"""
            UPDATE post_compose_drafts SET
                content_text = %s, content_mode = %s, image_mode = %s, image_paths = %s, updated_at = NOW()
            WHERE owner_key = %s AND post_type = %s
            RETURNING {_COLUMNS}
            """,
            (
                append_posts(current["content_text"], new_posts),
                CONTENT_MULTI if new_posts else current["content_mode"],
                image_mode,
                _dump_paths(current["image_paths"] + new_images),
                owner, post_type,
            ),
        )
        return _to_draft(cur.fetchone(), post_type)


def _locked_draft(cur, owner: str, post_type: str) -> Dict[str, Any]:
    cur.execute(
        "INSERT INTO post_compose_drafts (owner_key, post_type) VALUES (%s, %s) "
        "ON CONFLICT (owner_key, post_type) DO NOTHING",
        (owner, post_type),
    )
    cur.execute(
        f"SELECT {_COLUMNS} FROM post_compose_drafts WHERE owner_key = %s AND post_type = %s FOR UPDATE",
        (owner, post_type),
    )
    return _to_draft(cur.fetchone(), post_type)


def _save_account_posts(cur, owner: str, post_type: str, posts: Dict[str, Any]) -> Dict[str, Any]:
    cur.execute(
        f"""
        UPDATE post_compose_drafts SET account_posts = %s, updated_at = NOW()
        WHERE owner_key = %s AND post_type = %s
        RETURNING {_COLUMNS}
        """,
        (dump_account_posts(posts), owner, post_type),
    )
    return _to_draft(cur.fetchone(), post_type)


def attach_account_post_images(post_type: str, uid: str, index: int, images: Sequence[str]) -> bool:
    """Gắn ảnh (vừa cào xong, chạy song song với AI viết bài) vào ô (nick, lượt). Ô đã bị xoá thì bỏ qua."""
    owner = _owner()
    with db.session() as cur:
        current = _locked_draft(cur, owner, post_type)
        posts = current["account_posts"]
        entries = posts.get(str(uid)) or []
        if not (0 <= index < len(entries)) or not entries[index]["content"].strip():
            return False
        entry = entries[index]
        entry["images"] = normalize_pool_images(list(entry["images"]) + list(images))[:MAX_ACCOUNT_POST_IMAGES]
        _save_account_posts(cur, owner, post_type, posts)
    return True


def fill_account_posts(
    post_type: str, fills: Sequence[Tuple[str, int, str, Sequence[str]]], *, overwrite: bool = False,
    reset_images: bool = False,
) -> Dict[str, Any]:
    """Ghi bài AI vừa tạo vào ô (nick, lượt) của dạng "Từng bài" — trong 1 transaction có khoá dòng.

    fills: (uid, index, content, images). Ô đã có nội dung chỉ bị ghi đè khi `overwrite` (nút Tạo lại);
    `reset_images` (Tạo lại có cào ảnh): bỏ ảnh cũ của ô để thay bằng ảnh mới; không thì ảnh AI thêm vào ảnh sẵn có.
    """
    owner = _owner()
    with db.session() as cur:
        current = _locked_draft(cur, owner, post_type)
        posts = current["account_posts"]
        for uid, index, content, images in fills:
            if not (0 <= index < MAX_TIME_SLOTS):
                continue
            entries = posts.setdefault(str(uid), [])
            while len(entries) <= index:
                entries.append({"content": "", "images": []})
            entry = entries[index]
            if entry["content"].strip() and not overwrite:
                continue
            entry["content"] = content
            base = [] if (overwrite and reset_images) else list(entry["images"])
            entry["images"] = normalize_pool_images(base + list(images))[:MAX_ACCOUNT_POST_IMAGES]
        return _save_account_posts(cur, owner, post_type, posts)


def clear_compose_draft(post_type: str, layout: Optional[str] = None) -> Dict[str, Any]:
    """Xoá nội dung của 1 cách soạn (TEXT: ô soạn + kho ảnh; ACCOUNTS: bài từng nick); không truyền = xoá cả hai.
    Giữ lại các lựa chọn chế độ."""
    if layout is None:
        sets = "content_text = '', image_paths = NULL, account_posts = NULL"
    elif normalize_layout(layout) == LAYOUT_TEXT:
        sets = "content_text = '', image_paths = NULL"
    else:
        sets = "account_posts = NULL"
    db.execute(
        f"UPDATE post_compose_drafts SET {sets}, updated_at = NOW() WHERE owner_key = %s AND post_type = %s",
        (_owner(), post_type),
    )
    return get_compose_draft(post_type)
