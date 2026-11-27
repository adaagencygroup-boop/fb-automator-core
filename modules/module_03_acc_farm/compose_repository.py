"""
compose_repository.py
Module 03 - Tab 2: Nháp ô soạn bài chung (bảng post_compose_drafts).
Mỗi người dùng có 1 nháp cho mỗi loại bài: nội dung (các bài tách bằng dòng "---"),
chế độ 1/nhiều nội dung, kho ảnh chung và số ảnh mỗi bài.
"""
import json
import logging
from typing import Any, Dict, Iterable, List, Optional

from core.database.connection import db
from modules.module_02_account_manager.context import owner_context
from modules.module_03_acc_farm.compose_service import (
    CONTENT_MULTI,
    IMAGE_MULTI,
    IMAGE_NONE,
    append_posts,
    clamp_image_range,
    normalize_content_mode,
    normalize_image_mode,
    normalize_pool_images,
)

logger = logging.getLogger(__name__)

_COLUMNS = "post_type, content_text, content_mode, image_mode, image_paths, min_images, max_images, updated_at"


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
            "updated_at": None,
        }
    out = dict(row)
    out["image_paths"] = _load_paths(row.get("image_paths"))
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
) -> Dict[str, Any]:
    lo, hi = clamp_image_range(min_images, max_images)
    row = db.fetch_one(
        f"""
        INSERT INTO post_compose_drafts
            (owner_key, post_type, content_text, content_mode, image_mode, image_paths, min_images, max_images, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (owner_key, post_type) DO UPDATE SET
            content_text = EXCLUDED.content_text,
            content_mode = EXCLUDED.content_mode,
            image_mode = EXCLUDED.image_mode,
            image_paths = EXCLUDED.image_paths,
            min_images = EXCLUDED.min_images,
            max_images = EXCLUDED.max_images,
            updated_at = NOW()
        RETURNING {_COLUMNS}
        """,
        (
            _owner(), post_type, content_text or "",
            normalize_content_mode(content_mode), normalize_image_mode(image_mode),
            _dump_paths(image_paths or []), lo, hi,
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


def clear_compose_draft(post_type: str) -> Dict[str, Any]:
    """Xoá nội dung + kho ảnh, giữ lại các lựa chọn chế độ."""
    db.execute(
        "UPDATE post_compose_drafts SET content_text = '', image_paths = NULL, updated_at = NOW() "
        "WHERE owner_key = %s AND post_type = %s",
        (_owner(), post_type),
    )
    return get_compose_draft(post_type)
