"""Supabase Storage client and caching layer for Module 7."""
from __future__ import annotations

from dataclasses import dataclass
import logging
import mimetypes
import os
from pathlib import Path
from typing import Any, Protocol
import urllib.parse

from dotenv import load_dotenv
import httpx

from config.constants import ENV_PATH
from ..constants.media_constant import MEDIA_CACHE_DIR, UPLOAD_MEDIA_DIR

if ENV_PATH.exists():
    load_dotenv(ENV_PATH, override=True)
else:
    load_dotenv(override=True)

logger = logging.getLogger("module_07.supabase_storage")

_DEFAULT_SUPABASE_URL = "https://jnjvyvgvutdjozcljhiv.supabase.co"


@dataclass(frozen=True)
class SupabaseStorageConfig:

    url: str
    service_key: str
    bucket: str

    @classmethod
    def from_env(cls) -> SupabaseStorageConfig:
        url = (os.getenv("SUPABASE_URL_2") or os.getenv("SUPABASE_URL", "")).strip().rstrip("/")
        if not url:
            url = _DEFAULT_SUPABASE_URL
        if url and not url.startswith("http"):
            url = f"https://{url}"
        key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY_2") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")).strip()
        bucket = (os.getenv("SUPABASE_STORAGE_BUCKET_2") or os.getenv("SUPABASE_STORAGE_BUCKET", "campaign")).strip() or "campaign"
        return cls(url=url, service_key=key, bucket=bucket)

    @property
    def is_configured(self) -> bool:
        return bool(self.url and self.service_key)

    @property
    def auth_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.service_key}",
            "apikey": self.service_key,
        }


class CloudStorageClient(Protocol):
    """Abstraction for remote object storage operations (DIP/OCP)."""

    def ensure_bucket(self, bucket: str | None = None) -> bool:
        ...

    def public_url(self, storage_path: str, bucket: str | None = None) -> str:
        ...

    def upload(
        self,
        *,
        file_bytes: bytes,
        filename: str,
        campaign_id: str,
        content_type: str | None = None,
        bucket: str | None = None,
    ) -> dict[str, Any]:
        ...

    def list_objects(self, campaign_id: str, bucket: str | None = None) -> list[dict[str, Any]]:
        ...

    def download_bytes(self, download_url: str) -> bytes:
        ...


class SupabaseStorageClient:
    def __init__(self, config: SupabaseStorageConfig | None = None) -> None:
        self.config = config or SupabaseStorageConfig.from_env()

    def ensure_bucket(self, bucket: str | None = None) -> bool:
        if not self.config.is_configured:
            return False
        target_bucket = bucket or self.config.bucket
        url = f"{self.config.url}/storage/v1/bucket"
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(url, headers=self.config.auth_headers)
                if resp.status_code == 200:
                    existing = [b.get("id") or b.get("name") for b in resp.json()]
                    if target_bucket in existing:
                        return True
                create_resp = client.post(
                    url,
                    headers={**self.config.auth_headers, "Content-Type": "application/json"},
                    json={"id": target_bucket, "name": target_bucket, "public": True},
                )
                return create_resp.status_code in (200, 201)
        except Exception as exc:
            logger.warning("Không thể kiểm tra/tạo bucket Supabase: %s", exc)
            return False

    def public_url(self, storage_path: str, bucket: str | None = None) -> str:
        target_bucket = bucket or self.config.bucket
        clean_path = storage_path.strip().lstrip("/")
        if clean_path.startswith(f"{target_bucket}/"):
            clean_path = clean_path[len(target_bucket) + 1 :]
        return f"{self.config.url}/storage/v1/object/public/{target_bucket}/{clean_path}"

    def upload(
        self,
        *,
        file_bytes: bytes,
        filename: str,
        campaign_id: str,
        content_type: str | None = None,
        bucket: str | None = None,
    ) -> dict[str, Any]:
        if not self.config.is_configured:
            raise RuntimeError("Supabase Storage chưa được cấu hình (thiếu URL hoặc Service Key).")

        target_bucket = bucket or self.config.bucket
        resolved_mime = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        clean_campaign = str(campaign_id or "").strip().strip("/") or "general"
        object_path = f"{clean_campaign}/{filename}"

        url = f"{self.config.url}/storage/v1/object/{target_bucket}/{object_path}"
        headers = {
            **self.config.auth_headers,
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

        storage_path = f"campaign/{clean_campaign}/{filename}"
        return {
            "key": f"{target_bucket}/{object_path}",
            "path": storage_path,
            "relative_path": storage_path,
            "url": self.public_url(object_path, target_bucket),
            "filename": filename,
            "size": len(file_bytes),
            "campaign_id": clean_campaign,
        }

    def list_objects(self, campaign_id: str, bucket: str | None = None) -> list[dict[str, Any]]:
        if not self.config.is_configured:
            return []
        clean_campaign = str(campaign_id or "").strip().strip("/")
        if not clean_campaign:
            return []

        target_bucket = bucket or self.config.bucket
        url = f"{self.config.url}/storage/v1/object/list/{target_bucket}"
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(
                    url,
                    headers={**self.config.auth_headers, "Content-Type": "application/json"},
                    json={"prefix": f"{clean_campaign}/", "limit": 100, "sortBy": {"column": "created_at", "order": "desc"}},
                )
                if resp.status_code != 200:
                    return []
                items = resp.json()
        except Exception as exc:
            logger.warning("Không thể lấy danh sách media chiến dịch: %s", exc)
            return []

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
                "url": self.public_url(obj_path, target_bucket),
                "size": item.get("metadata", {}).get("size") or 0,
                "created_at": item.get("created_at"),
            })
        return results

    def download_bytes(self, download_url: str) -> bytes:
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            resp = client.get(download_url)
            if resp.status_code != 200:
                resp = client.get(download_url, headers=self.config.auth_headers)
                if resp.status_code != 200:
                    raise RuntimeError(f"HTTP {resp.status_code}: Không thể tải file từ {download_url}")
            return resp.content


def _default_client() -> SupabaseStorageClient:
    return SupabaseStorageClient(SupabaseStorageConfig.from_env())


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


def _resolve_remote_target(raw: str, client: CloudStorageClient) -> tuple[str | None, str]:
    if raw.startswith(("http://", "https://")):
        parsed = urllib.parse.urlparse(raw)
        return raw, Path(parsed.path).name or "media_file"
    if raw.startswith("campaign/") or "/" in raw:
        clean_path = raw.removeprefix("campaign/")
        return client.public_url(clean_path), Path(clean_path).name or "media_file"
    return None, Path(raw).name


def get_supabase_url() -> str:
    return SupabaseStorageConfig.from_env().url


def get_supabase_service_key() -> str:
    return SupabaseStorageConfig.from_env().service_key


def get_storage_bucket() -> str:
    return SupabaseStorageConfig.from_env().bucket


def is_supabase_storage_available() -> bool:
    return SupabaseStorageConfig.from_env().is_configured


def ensure_storage_bucket(bucket: str | None = None, *, client: CloudStorageClient | None = None) -> bool:
    """Ensure the target bucket exists and is public."""
    return (client or _default_client()).ensure_bucket(bucket)


def get_public_url(storage_path: str, bucket: str | None = None, *, client: CloudStorageClient | None = None) -> str:
    """Trả về public URL cho một tệp trong Supabase Storage."""
    return (client or _default_client()).public_url(storage_path, bucket)


def upload_to_supabase(
    *,
    file_bytes: bytes,
    filename: str,
    campaign_id: str,
    content_type: str | None = None,
    bucket: str | None = None,
    client: CloudStorageClient | None = None,
) -> dict[str, Any]:
    """Tải tệp lên Supabase Storage với đường dẫn: campaign/{campaign_id}/{filename}."""
    return (client or _default_client()).upload(
        file_bytes=file_bytes,
        filename=filename,
        campaign_id=campaign_id,
        content_type=content_type,
        bucket=bucket,
    )


def upload_local_file_to_supabase(
    local_path: str | Path,
    campaign_id: str,
    bucket: str | None = None,
    *,
    client: CloudStorageClient | None = None,
) -> dict[str, Any]:
    """Tải file cục bộ lên Supabase Storage; giữ nguyên nếu đã là URL hoặc chưa cấu hình cloud."""
    raw = str(local_path or "").strip()
    if not raw:
        return {"url": "", "path": ""}
    if raw.startswith(("http://", "https://")) or not is_supabase_storage_available():
        return {"url": raw, "path": raw}

    file_path = _find_local_file(raw)
    if file_path is None:
        return {"url": raw, "path": raw}

    try:
        content = file_path.read_bytes()
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        return upload_to_supabase(
            file_bytes=content,
            filename=file_path.name,
            campaign_id=campaign_id,
            content_type=content_type,
            bucket=bucket,
            client=client,
        )
    except Exception as exc:
        logger.warning("Không thể tải file %s lên Supabase: %s", file_path.name, exc)
        return {"url": raw, "path": raw}


def download_or_cache_media(
    token: str,
    campaign_id: str | None = None,
    *,
    client: CloudStorageClient | None = None,
) -> Path:
    """Chuyển đổi token media (URL, path Supabase hoặc file local) thành đường dẫn local cho Selenium."""
    raw = str(token or "").strip()
    if not raw:
        raise RuntimeError("Token media trống")

    local_file = _find_local_file(raw)
    if local_file is not None:
        return local_file

    storage_client = client or _default_client()
    download_url, target_filename = _resolve_remote_target(raw, storage_client)
    if not download_url:
        raise RuntimeError(f"Không tìm thấy media cục bộ hoặc từ xa: {raw}")

    camp_folder = str(campaign_id or "common").strip().strip("/")
    cache_dir = MEDIA_CACHE_DIR / camp_folder
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached_file = (cache_dir / target_filename).resolve()

    if cached_file.is_file() and cached_file.stat().st_size > 0:
        return cached_file

    try:
        cached_file.write_bytes(storage_client.download_bytes(download_url))
        return cached_file
    except Exception as exc:
        cached_file.unlink(missing_ok=True)
        raise RuntimeError(f"Lỗi khi tải media từ Supabase ({download_url}): {exc}") from exc


def list_campaign_media(
    campaign_id: str,
    bucket: str | None = None,
    *,
    client: CloudStorageClient | None = None,
) -> list[dict[str, Any]]:
    """Liệt kê danh sách các ảnh/video của chiến dịch từ Supabase Storage."""
    return (client or _default_client()).list_objects(campaign_id, bucket)
