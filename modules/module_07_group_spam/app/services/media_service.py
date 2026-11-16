"""Validated media storage operations for Module 7."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable, Protocol
import uuid

from fastapi import UploadFile

from ..constants.media_constant import (
    ALLOWED_EXTENSIONS,
    ALLOWED_MIME_PREFIXES,
    CHUNK_SIZE,
    MAX_FILE_COUNT,
    MAX_FILE_SIZE,
    MAX_TOTAL_SIZE,
    UPLOAD_MEDIA_DIR,
)
from .supabase_storage import (
    is_supabase_storage_available,
    upload_to_supabase,
    download_or_cache_media,
    list_campaign_media,
    MEDIA_CACHE_DIR,
)

logger = logging.getLogger("module_07.media_service")



class MediaStorageError(RuntimeError):
    """Raised when uploaded media is invalid or cannot be persisted."""


class MediaDownloader(Protocol):
    def __call__(self, token: str, campaign_id: str | None = None) -> Path:
        ...


# xử lý token media, xác định xem nó là đường dẫn cục bộ hay URL từ xa
def _is_remote_token(raw: str) -> bool:
    return raw.startswith(("http://", "https://", "campaign/"))


# xử lí đường dẫn media, đảm bảo nó hợp lệ và có định dạng được hỗ trợ
def _safe_path(token: str) -> Path:
    raw = str(token or "").strip().replace("\\", "/")
    if not raw:
        raise MediaStorageError("Đường dẫn media trống")
    file_name = Path(raw).name
    if not file_name:
        raise MediaStorageError("Đường dẫn media không hợp lệ")
    candidate = (UPLOAD_MEDIA_DIR / file_name).resolve()
    if candidate.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise MediaStorageError("Định dạng media không được hỗ trợ")
    return candidate


#  xử lý token media, xác định xem nó là đường dẫn cục bộ hay URL từ xa, và tải xuống nếu cần
def _resolve_local_or_cached(
    raw: str,
    campaign_id: str | None,
    downloader: MediaDownloader,
) -> Path:
    path = _safe_path(raw)
    if path.is_file():
        return path
    cached_candidate = downloader(raw, campaign_id)
    if cached_candidate.is_file():
        return cached_candidate
    raise MediaStorageError(f"Không tìm thấy media: {path.name}")


# xử lý danh sách token media, tải xuống các tệp từ xa nếu cần và trả về danh sách đường dẫn cục bộ hợp lệ
def resolve_media_paths(
    tokens: list[str],
    campaign_id: str | None = None,
    *,
    downloader: MediaDownloader | None = None,
) -> list[str]:
    """Resolve client-facing media tokens to trusted local paths on disk for Selenium."""
    fetch_media = downloader or download_or_cache_media
    resolved: list[str] = []
    for token in dict.fromkeys(tokens):
        raw = str(token or "").strip()
        if not raw:
            continue
        if _is_remote_token(raw):
            try:
                resolved.append(str(fetch_media(raw, campaign_id)))
                continue
            except Exception as exc:
                raise MediaStorageError(f"Không thể tải media từ cloud ({raw}): {exc}") from exc
        try:
            resolved.append(str(_resolve_local_or_cached(raw, campaign_id, fetch_media)))
        except MediaStorageError:
            raise
        except Exception as exc:
            raise MediaStorageError(f"Không tìm thấy media: {raw}") from exc

    return resolved


# xử lý danh sách token media, xác thực và giữ nguyên các URL / đường dẫn lưu trữ để lưu vào cấu hình chiến dịch
def resolve_media_tokens_for_config(
    tokens: list[str],
    campaign_id: str | None = None,
    *,
    downloader: MediaDownloader | None = None,
) -> list[str]:
    """
    Validate media tokens and preserve cloud URLs / storage paths for saving to campaign config.
    """
    fetch_media = downloader or download_or_cache_media
    validated: list[str] = []
    for token in dict.fromkeys(tokens):
        raw = str(token or "").strip()
        if not raw:
            continue
        if _is_remote_token(raw):
            validated.append(raw)
            continue
        _resolve_local_or_cached(raw, campaign_id, fetch_media)
        validated.append(raw)
    return validated

# validate file upload lên server, đảm bảo rằng tệp là ảnh/video được hỗ trợ và không vượt quá giới hạn kích thước
def _validate_upload_metadata(file: UploadFile) -> str:
    extension = Path(file.filename or "").suffix.lower()
    content_type = (file.content_type or "").lower()
    if extension not in ALLOWED_EXTENSIONS or not content_type.startswith(ALLOWED_MIME_PREFIXES):
        raise MediaStorageError(f"Tệp {file.filename or '(không tên)'} không phải ảnh/video được hỗ trợ")
    return extension


# xử lí nội dung tệp upload, kiểm tra kích thước tệp và tổng kích thước tải lên, trả về nội dung tệp, kích thước tệp và tổng kích thước mới
def _read_validated_content(file: UploadFile, current_total_size: int) -> tuple[bytes, int, int]:
    content = file.file.read()
    size = len(content)
    new_total_size = current_total_size + size
    if size > MAX_FILE_SIZE:
        raise MediaStorageError(f"Tệp {file.filename} vượt quá 25 MB")
    if new_total_size > MAX_TOTAL_SIZE:
        raise MediaStorageError("Tổng dung lượng tải lên vượt quá 100 MB")
    return content, size, new_total_size


# lưu trữ tệp media upload vào thư mục cache chiến dịch và thư mục upload chính, thêm các đường dẫn tệp đã tạo vào danh sách created_local_files
def _persist_media_file(
    camp_cache_dir: Path,
    saved_name: str,
    content: bytes,
    created_local_files: list[Path],
) -> None:
    cached_path = camp_cache_dir / saved_name
    cached_path.write_bytes(content)
    created_local_files.append(cached_path)

    local_backup = UPLOAD_MEDIA_DIR / saved_name
    try:
        local_backup.write_bytes(content)
        created_local_files.append(local_backup)
    except Exception:
        pass

# xóa các tệp đã tạo trong trường hợp xảy ra lỗi, đảm bảo rằng không còn tệp tạm thời nào còn lại trên đĩa
def _cleanup_files(paths: list[Path]) -> None:
    for path in paths:
        path.unlink(missing_ok=True)


# lưu trữ các tệp media upload, xác thực và xử lý nội dung, trả về danh sách thông tin tệp đã lưu
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
            extension = _validate_upload_metadata(file)
            content, size, total_size = _read_validated_content(file, total_size)
            saved_name = f"{uuid.uuid4().hex}{extension}"
            _persist_media_file(camp_cache_dir, saved_name, content, created_local_files)
            uploaded.append({
                "original_name": file.filename,
                "saved_name": saved_name,
                "path": saved_name,
                "relative_path": saved_name,
                "url": None,
                "size": size,
                "campaign_id": active_campaign_id,
            })
    except Exception as exc:
        _cleanup_files(created_local_files)
        if isinstance(exc, MediaStorageError):
            raise
        raise MediaStorageError(f"Không thể lưu media: {exc}") from exc

    return uploaded


def list_stored_media(
    campaign_id: str | None = None,
    *,
    remote_lister: Callable[[str], list[dict[str, str | int]]] | None = None,
) -> list[dict[str, str | int]]:
    if campaign_id and is_supabase_storage_available():
        fetch_remote = remote_lister or list_campaign_media
        remote_items = fetch_remote(campaign_id)
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
