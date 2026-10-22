"""Validated media storage operations for Module 7."""
from __future__ import annotations

from pathlib import Path
import uuid

from fastapi import UploadFile

from config.constants import DATA_DIR


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


def resolve_media_paths(tokens: list[str]) -> list[str]:
    """Resolve client-facing media tokens to trusted local paths."""
    resolved: list[str] = []
    for token in dict.fromkeys(tokens):
        path = _safe_path(token)
        if not path.is_file():
            raise MediaStorageError(f"Không tìm thấy media: {path.name}")
        resolved.append(str(path))
    return resolved


def save_uploaded_media(files: list[UploadFile]) -> list[dict[str, str | int | None]]:
    if len(files) > MAX_FILE_COUNT:
        raise MediaStorageError(f"Chỉ được tải tối đa {MAX_FILE_COUNT} tệp mỗi lần")
    UPLOAD_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    uploaded: list[dict[str, str | int | None]] = []
    created: list[Path] = []
    total_size = 0

    try:
        for file in files:
            extension = Path(file.filename or "").suffix.lower()
            content_type = (file.content_type or "").lower()
            if extension not in ALLOWED_EXTENSIONS or not content_type.startswith(ALLOWED_MIME_PREFIXES):
                raise MediaStorageError(f"Tệp {file.filename or '(không tên)'} không phải ảnh/video được hỗ trợ")

            saved_name = f"{uuid.uuid4().hex}{extension}"
            file_path = _safe_path(saved_name)
            size = 0
            with file_path.open("xb") as buffer:
                created.append(file_path)
                while chunk := file.file.read(CHUNK_SIZE):
                    size += len(chunk)
                    total_size += len(chunk)
                    if size > MAX_FILE_SIZE:
                        raise MediaStorageError(f"Tệp {file.filename} vượt quá 25 MB")
                    if total_size > MAX_TOTAL_SIZE:
                        raise MediaStorageError("Tổng dung lượng tải lên vượt quá 100 MB")
                    buffer.write(chunk)
            uploaded.append({
                "original_name": file.filename,
                "saved_name": saved_name,
                "path": saved_name,
                "relative_path": saved_name,
                "size": size,
            })
    except MediaStorageError:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        for path in created:
            path.unlink(missing_ok=True)
        raise MediaStorageError(f"Không thể lưu media: {exc}") from exc

    return uploaded


def list_stored_media() -> list[dict[str, str | int]]:
    UPLOAD_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    return [
        {"name": path.name, "path": path.name, "relative_path": path.name, "size": path.stat().st_size}
        for path in sorted(UPLOAD_MEDIA_DIR.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True)
        if path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS
    ]


__all__ = [
    "MediaStorageError", "list_stored_media", "resolve_media_paths", "save_uploaded_media",
]
