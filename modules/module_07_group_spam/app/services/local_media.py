"""Ảnh và video chiến dịch lưu trên máy, trong thư mục cache của module 7."""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any
import urllib.parse

import httpx

from ..constants.media_constant import MEDIA_CACHE_DIR, UPLOAD_MEDIA_DIR

logger = logging.getLogger("module_07.media_store")


def _safe_name(value: str, fallback: str) -> str:
    cleaned = "".join(ch for ch in str(value or "") if ch.isalnum() or ch in "-_.")
    return cleaned or fallback


def _campaign_dir(campaign_id: str) -> Path:
    folder = MEDIA_CACHE_DIR / _safe_name(campaign_id, "general")
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def is_media_storage_available() -> bool:
    return True


def upload_local_media(
    local_path: str | Path,
    campaign_id: str,
    bucket: str | None = None,
    *,
    client: Any = None,
) -> dict[str, Any]:
    """Giữ file trên máy. URL http hoặc pg:// cũ không bị ghi đè."""
    del bucket, client
    raw = str(local_path or "").strip()
    if not raw:
        return {"url": "", "path": ""}
    if raw.startswith(("http://", "https://", "pg://")):
        return {"url": raw, "path": raw}

    file_path = _find_local_file(raw)
    if file_path is None:
        return {"url": raw, "path": raw}

    target = _campaign_dir(campaign_id) / file_path.name
    if file_path.resolve() != target.resolve():
        shutil.copy2(file_path, target)
    return {"url": str(target), "path": str(target), "filename": target.name, "size": target.stat().st_size}


def list_campaign_media(
    campaign_id: str,
    bucket: str | None = None,
    *,
    client: Any = None,
) -> list[dict[str, Any]]:
    """Liệt kê ảnh/video của chiến dịch trong thư mục máy."""
    del bucket, client
    folder = _campaign_dir(campaign_id)
    items = []
    for path in sorted(folder.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
        if not path.is_file():
            continue
        items.append({
            "name": path.name,
            "path": str(path),
            "relative_path": path.name,
            "url": str(path),
            "size": path.stat().st_size,
        })
    return items


def delete_campaign_media(campaign_id: str) -> None:
    """Xóa toàn bộ thư mục media của chiến dịch trên đĩa khi xóa cứng chiến dịch."""
    safe_id = _safe_name(campaign_id, "")
    if not safe_id:
        return
    base_dir = UPLOAD_MEDIA_DIR.resolve()
    folder = (base_dir / safe_id).resolve()
    if folder.is_relative_to(base_dir) and folder != base_dir and folder.is_dir():
        shutil.rmtree(folder, ignore_errors=True)


def _find_local_file(raw: str) -> Path | None:
    candidate = Path(raw)
    try:
        if candidate.is_file():
            return candidate.resolve()
    except Exception:
        pass
    local_in_uploads = (UPLOAD_MEDIA_DIR / candidate.name).resolve()
    if local_in_uploads.is_file():
        return local_in_uploads
    for search_dir in (MEDIA_CACHE_DIR, UPLOAD_MEDIA_DIR):
        if search_dir.exists():
            matches = list(search_dir.glob(f"**/{candidate.name}"))
            if matches and matches[0].is_file():
                return matches[0].resolve()
    return None


def _read_postgres_legacy(download_url: str) -> bytes | None:
    """File đã chép vào Postgres trước đó vẫn đọc được, không ghi thêm."""
    try:
        from core.storage.postgres_objects import parse_pg_url, read_object
    except Exception:
        return None
    parsed = parse_pg_url(download_url)
    if not parsed:
        parsed_url = urllib.parse.urlparse(download_url)
        marker = "/media/"
        if marker not in (parsed_url.path or ""):
            return None
        rest = urllib.parse.unquote(parsed_url.path.split(marker, 1)[1])
        bucket, _, path = rest.partition("/")
        parsed = (bucket, path) if bucket and path else None
    if not parsed:
        return None
    row = read_object(*parsed)
    if not row or not row.get("data"):
        return None
    return row["data"]


def download_or_cache_media(
    token: str,
    campaign_id: str | None = None,
    *,
    client: Any = None,
) -> Path:
    """Đổi token media thành file trên máy để Selenium đăng."""
    del client
    raw = str(token or "").strip()
    if not raw:
        raise RuntimeError("Token media trống")

    local_file = _find_local_file(raw)
    if local_file is not None:
        return local_file

    filename = Path(urllib.parse.urlparse(raw).path).name or "media_file"
    cache_dir = _campaign_dir(campaign_id or "common")
    cached_file = (cache_dir / _safe_name(filename, "media_file")).resolve()
    if cached_file.is_file() and cached_file.stat().st_size > 0:
        return cached_file

    payload = _read_postgres_legacy(raw)
    if payload is None and raw.startswith(("http://", "https://")):
        with httpx.Client(timeout=30.0, follow_redirects=True) as http:
            response = http.get(raw)
            if response.status_code != 200:
                raise RuntimeError(f"HTTP {response.status_code}: Không thể tải file từ {raw}")
            payload = response.content
    if not payload:
        raise RuntimeError(f"Không tìm thấy media trên máy: {raw}")
    cached_file.write_bytes(payload)
    return cached_file
