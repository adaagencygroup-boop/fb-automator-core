"""Supabase Storage client and caching layer for Module 7."""
from __future__ import annotations

import logging
import mimetypes
import os
from pathlib import Path
from typing import Any
import urllib.parse

import httpx

from config.constants import DATA_DIR

logger = logging.getLogger("module_07.supabase_storage")

MEDIA_CACHE_DIR = (DATA_DIR / "module_07_group_spam" / "cache").resolve()
UPLOAD_MEDIA_DIR = (DATA_DIR / "module_07_group_spam" / "uploads").resolve()


def get_supabase_url() -> str:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    if not url:
        url = "https://jnjvyvgvutdjozcljhiv.supabase.co"
    return url


def get_supabase_service_key() -> str:
    return os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()


def get_storage_bucket() -> str:
    return os.getenv("SUPABASE_STORAGE_BUCKET", "campaign").strip() or "campaign"


def is_supabase_storage_available() -> bool:
    return bool(get_supabase_url() and get_supabase_service_key())


def _auth_headers() -> dict[str, str]:
    key = get_supabase_service_key()
    return {
        "Authorization": f"Bearer {key}",
        "apikey": key,
    }


def ensure_storage_bucket(bucket: str | None = None) -> bool:
    """Ensure the target bucket exists and is public."""
    if not is_supabase_storage_available():
        return False
    target_bucket = bucket or get_storage_bucket()
    url = f"{get_supabase_url()}/storage/v1/bucket"
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url, headers=_auth_headers())
            if resp.status_code == 200:
                existing = [b.get("id") or b.get("name") for b in resp.json()]
                if target_bucket in existing:
                    return True

            # Tạo mới bucket nếu chưa có
            create_resp = client.post(
                url,
                headers={**_auth_headers(), "Content-Type": "application/json"},
                json={"id": target_bucket, "name": target_bucket, "public": True},
            )
            return create_resp.status_code in (200, 201)
    except Exception as exc:
        logger.warning("Không thể kiểm tra/tạo bucket Supabase: %s", exc)
        return False


def get_public_url(storage_path: str, bucket: str | None = None) -> str:
    """Trả về public URL cho một tệp trong Supabase Storage."""
    target_bucket = bucket or get_storage_bucket()
    clean_path = storage_path.strip().lstrip("/")
    # Nếu path đã bắt đầu bằng tên bucket, bỏ đi để tránh trùng lặp trong URL
    if clean_path.startswith(f"{target_bucket}/"):
        clean_path = clean_path[len(target_bucket) + 1 :]
    return f"{get_supabase_url()}/storage/v1/object/public/{target_bucket}/{clean_path}"


def upload_to_supabase(
    *,
    file_bytes: bytes,
    filename: str,
    campaign_id: str,
    content_type: str | None = None,
    bucket: str | None = None,
) -> dict[str, Any]:
    """
    Tải tệp lên Supabase Storage với đường dẫn: campaign/{campaign_id}/{filename}.
    Trả về dict chứa key, path, url, filename, size.
    """
    if not is_supabase_storage_available():
        raise RuntimeError("Supabase Storage chưa được cấu hình (thiếu URL hoặc Service Key).")

    target_bucket = bucket or get_storage_bucket()
    resolved_mime = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"

    # Đường dẫn đối tượng trong bucket: {campaign_id}/{filename}
    clean_campaign = str(campaign_id or "").strip().strip("/")
    if not clean_campaign:
        clean_campaign = "general"
    object_path = f"{clean_campaign}/{filename}"

    url = f"{get_supabase_url()}/storage/v1/object/{target_bucket}/{object_path}"
    headers = {
        **_auth_headers(),
        "Content-Type": resolved_mime,
        "x-upsert": "true",
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, headers=headers, content=file_bytes)
            if resp.status_code not in (200, 201):
                raise RuntimeError(
                    f"Supabase Storage trả về mã lỗi {resp.status_code}: {resp.text}"
                )
    except Exception as exc:
        logger.error("Lỗi tải lên Supabase Storage: %s", exc)
        raise RuntimeError(f"Không thể tải media lên Supabase Storage: {exc}") from exc

    # Public URL truy cập trực tiếp
    public_url = get_public_url(object_path, target_bucket)
    storage_path = f"campaign/{clean_campaign}/{filename}"

    return {
        "key": f"{target_bucket}/{object_path}",
        "path": storage_path,
        "relative_path": storage_path,
        "url": public_url,
        "filename": filename,
        "size": len(file_bytes),
        "campaign_id": clean_campaign,
    }


def download_or_cache_media(token: str, campaign_id: str | None = None) -> Path:
    """
    Chuyển đổi token media (URL Supabase, path Supabase hoặc tên file local)
    thành đường dẫn file cục bộ (local Path) để Selenium Chrome có thể upload.
    Tự động tải về và cache trên máy nếu file chưa có ở local.
    """
    raw = str(token or "").strip()
    if not raw:
        raise RuntimeError("Token media trống")

    # 1. Kiểm tra nếu là file tuyệt đối đã tồn tại trên đĩa
    candidate_path = Path(raw)
    try:
        if candidate_path.is_file():
            return candidate_path.resolve()
    except Exception:
        pass

    # 2. Kiểm tra nếu là file trong thư mục uploads local (tương thích ngược)
    local_in_uploads = (UPLOAD_MEDIA_DIR / candidate_path.name).resolve()
    if local_in_uploads.is_file():
        return local_in_uploads

    # 3. Xác định URL tải về nếu là URL hoặc path Supabase
    download_url = None
    target_filename = candidate_path.name

    if raw.startswith("http://") or raw.startswith("https://"):
        download_url = raw
        parsed = urllib.parse.urlparse(raw)
        target_filename = Path(parsed.path).name or "media_file"
    elif raw.startswith("campaign/") or "/" in raw:
        # Đường dẫn dạng campaign/{id}/{filename} hoặc {id}/{filename}
        clean_path = raw
        if clean_path.startswith("campaign/"):
            clean_path = clean_path[len("campaign/") :]
        download_url = get_public_url(clean_path)
        target_filename = Path(clean_path).name or "media_file"

    if not download_url:
        # Thử tìm trong thư mục cache
        for search_dir in [MEDIA_CACHE_DIR, UPLOAD_MEDIA_DIR]:
            if search_dir.exists():
                matches = list(search_dir.glob(f"**/{target_filename}"))
                if matches and matches[0].is_file():
                    return matches[0].resolve()
        raise RuntimeError(f"Không tìm thấy media cục bộ hoặc từ xa: {raw}")

    # 4. Lưu vào thư mục cache
    camp_folder = str(campaign_id or "common").strip().strip("/")
    cache_dir = MEDIA_CACHE_DIR / camp_folder
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached_file = (cache_dir / target_filename).resolve()

    if cached_file.is_file() and cached_file.stat().st_size > 0:
        return cached_file

    # 5. Tải về từ URL
    try:
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            resp = client.get(download_url)
            if resp.status_code != 200:
                # Nếu public URL không được, thử tải qua service key
                resp = client.get(download_url, headers=_auth_headers())
                if resp.status_code != 200:
                    raise RuntimeError(f"HTTP {resp.status_code}: Không thể tải file từ {download_url}")

            with cached_file.open("wb") as f:
                f.write(resp.content)
            return cached_file
    except Exception as exc:
        cached_file.unlink(missing_ok=True)
        raise RuntimeError(f"Lỗi khi tải media từ Supabase ({download_url}): {exc}") from exc


def list_campaign_media(campaign_id: str, bucket: str | None = None) -> list[dict[str, Any]]:
    """Liệt kê danh sách các ảnh/video của chiến dịch từ Supabase Storage."""
    if not is_supabase_storage_available():
        return []

    target_bucket = bucket or get_storage_bucket()
    clean_campaign = str(campaign_id or "").strip().strip("/")
    if not clean_campaign:
        return []

    url = f"{get_supabase_url()}/storage/v1/object/list/{target_bucket}"
    prefix = f"{clean_campaign}/"

    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                url,
                headers={**_auth_headers(), "Content-Type": "application/json"},
                json={"prefix": prefix, "limit": 100, "sortBy": {"column": "created_at", "order": "desc"}},
            )
            if resp.status_code != 200:
                return []

            items = resp.json()
            results: list[dict[str, Any]] = []
            for item in items:
                name = item.get("name")
                if not name or name.endswith("/"):
                    continue
                obj_path = f"{clean_campaign}/{name}"
                results.append({
                    "name": name,
                    "path": f"campaign/{obj_path}",
                    "relative_path": f"campaign/{obj_path}",
                    "url": get_public_url(obj_path, target_bucket),
                    "size": item.get("metadata", {}).get("size") or 0,
                    "created_at": item.get("created_at"),
                })
            return results
    except Exception as exc:
        logger.warning("Không thể lấy danh sách media chiến dịch: %s", exc)
        return []

