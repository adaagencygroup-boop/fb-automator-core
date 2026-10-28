"""Validated media storage operations for Module 7."""
from __future__ import annotations

import logging
from pathlib import Path
import uuid

from fastapi import UploadFile

from config.constants import DATA_DIR
from .supabase_storage import (
    is_supabase_storage_available,
    upload_to_supabase,
    download_or_cache_media,
    list_campaign_media,
    MEDIA_CACHE_DIR,
)

logger = logging.getLogger("module_07.media_service")

UPLOAD_MEDIA_DIR = (DATA_DIR / "module_07_group_spam" / "uploads").resolve()
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".avi", ".mkv"}
ALLOWED_MIME_PREFIXES = ("image/", "video/")
MAX_FILE_COUNT = 20
MAX_FILE_SIZE = 25 * 1024 * 1024
MAX_TOTAL_SIZE = 100 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024


class MediaStorageError(RuntimeError):
    """Raised when uploaded media is invalid or cannot be persisted."""


def _safe_path(token: str) -> Path:
    raw = str(token or "").strip().replace("\\", "/")
    if not raw:
        raise MediaStorageError("Đường dẫn media trống")
    candidate = (UPLOAD_MEDIA_DIR / Path(raw).name).resolve()
    if candidate.parent != UPLOAD_MEDIA_DIR or Path(raw).name != raw:
        raise MediaStorageError("Đường dẫn media không hợp lệ")
    if candidate.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise MediaStorageError("Định dạng media không được hỗ trợ")
    return candidate


def resolve_media_paths(tokens: list[str], campaign_id: str | None = None) -> list[str]:
    """Resolve client-facing media tokens to trusted local paths on disk for Selenium."""
    resolved: list[str] = []
    for token in dict.fromkeys(tokens):
        raw = str(token or "").strip()
        if not raw:
            continue
        if raw.startswith("http://") or raw.startswith("https://") or raw.startswith("campaign/"):
            try:
                local_path = download_or_cache_media(raw, campaign_id)
                resolved.append(str(local_path))
                continue
            except Exception as exc:
                raise MediaStorageError(f"Không thể tải media từ cloud ({raw}): {exc}") from exc

        try:
            path = _safe_path(raw)
            if not path.is_file():
                cached_candidate = download_or_cache_media(raw, campaign_id)
                if cached_candidate.is_file():
                    resolved.append(str(cached_candidate))
                    continue
                raise MediaStorageError(f"Không tìm thấy media: {path.name}")
            resolved.append(str(path))
        except MediaStorageError:
            raise
        except Exception as exc:
            raise MediaStorageError(f"Không tìm thấy media: {raw}") from exc

    return resolved


def resolve_media_tokens_for_config(tokens: list[str], campaign_id: str | None = None) -> list[str]:
    """
    Validate media tokens and preserve cloud URLs / storage paths for saving to campaign config.
    """
    validated: list[str] = []
    for token in dict.fromkeys(tokens):
        raw = str(token or "").strip()
        if not raw:
            continue
        if raw.startswith("http://") or raw.startswith("https://") or raw.startswith("campaign/"):
            validated.append(raw)
            continue
        path = _safe_path(raw)
        if not path.is_file():
            raise MediaStorageError(f"Không tìm thấy media: {path.name}")
        validated.append(raw)
    return validated


def save_uploaded_media(
    files: list[UploadFile],
    campaign_id: str | None = None,
) -> list[dict[str, str | int | None]]:
    if len(files) > MAX_FILE_COUNT:
        raise MediaStorageError(f"Chỉ được tải tối đa {MAX_FILE_COUNT} tệp mỗi lần")

    active_campaign_id = str(campaign_id or "").strip() or uuid.uuid4().hex
    UPLOAD_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    MEDIA_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    camp_cache_dir = MEDIA_CACHE_DIR / active_campaign_id
    camp_cache_dir.mkdir(parents=True, exist_ok=True)

    uploaded: list[dict[str, str | int | None]] = []
    created_local_files: list[Path] = []
    total_size = 0

    try:
        for file in files:
            extension = Path(file.filename or "").suffix.lower()
            content_type = (file.content_type or "").lower()
            if extension not in ALLOWED_EXTENSIONS or not content_type.startswith(ALLOWED_MIME_PREFIXES):
                raise MediaStorageError(f"Tệp {file.filename or '(không tên)'} không phải ảnh/video được hỗ trợ")

            saved_name = f"{uuid.uuid4().hex}{extension}"

            content = file.file.read()
            size = len(content)
            total_size += size

            if size > MAX_FILE_SIZE:
                raise MediaStorageError(f"Tệp {file.filename} vượt quá 25 MB")
            if total_size > MAX_TOTAL_SIZE:
                raise MediaStorageError("Tổng dung lượng tải lên vượt quá 100 MB")

            # Lưu vào local cache để phục vụ tác vụ chạy ngay
            cached_path = camp_cache_dir / saved_name
            with cached_path.open("wb") as f:
                f.write(content)
            created_local_files.append(cached_path)

            # Sao lưu vào UPLOAD_MEDIA_DIR
            local_backup = UPLOAD_MEDIA_DIR / saved_name
            try:
                with local_backup.open("wb") as f:
                    f.write(content)
                created_local_files.append(local_backup)
            except Exception:
                pass

            # Tải lên Supabase Storage
            cloud_info = None
            if is_supabase_storage_available():
                try:
                    cloud_info = upload_to_supabase(
                        file_bytes=content,
                        filename=saved_name,
                        campaign_id=active_campaign_id,
                        content_type=content_type,
                    )
                except Exception as exc:
                    logger.warning("Không thể tải lên Supabase Storage, dùng fallback local: %s", exc)

            if cloud_info:
                uploaded.append({
                    "original_name": file.filename,
                    "saved_name": saved_name,
                    "path": cloud_info["path"],
                    "relative_path": cloud_info["path"],
                    "url": cloud_info["url"],
                    "size": size,
                    "campaign_id": active_campaign_id,
                })
            else:
                uploaded.append({
                    "original_name": file.filename,
                    "saved_name": saved_name,
                    "path": saved_name,
                    "relative_path": saved_name,
                    "url": None,
                    "size": size,
                    "campaign_id": active_campaign_id,
                })
    except MediaStorageError:
        for path in created_local_files:
            path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        for path in created_local_files:
            path.unlink(missing_ok=True)
        raise MediaStorageError(f"Không thể lưu media: {exc}") from exc

    return uploaded


def list_stored_media(campaign_id: str | None = None) -> list[dict[str, str | int]]:
    if campaign_id and is_supabase_storage_available():
        remote_items = list_campaign_media(campaign_id)
        if remote_items:
            return remote_items

    UPLOAD_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    return [
        {"name": path.name, "path": path.name, "relative_path": path.name, "size": path.stat().st_size}
        for path in sorted(UPLOAD_MEDIA_DIR.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True)
        if path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS
    ]


__all__ = [
    "MediaStorageError",
    "list_stored_media",
    "resolve_media_paths",
    "resolve_media_tokens_for_config",
    "save_uploaded_media",
    "UPLOAD_MEDIA_DIR",
]
