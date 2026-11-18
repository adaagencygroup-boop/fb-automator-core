"""File đính kèm chat lưu trên máy chạy engine, thư mục uploads."""
import os
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from config.constants import UPLOADS_DIR


def upload_file_bytes(file_bytes: bytes, file_name: str, content_type: Optional[str] = None) -> Optional[str]:
    """Ghi file vào thư mục uploads và trả URL công khai để Facebook tải."""
    del content_type
    safe_name = Path(file_name or "").name
    if not file_bytes or not safe_name or safe_name in {".", ".."}:
        return None
    try:
        os.makedirs(UPLOADS_DIR, exist_ok=True)
        target = UPLOADS_DIR / safe_name
        if not target.is_file():
            target.write_bytes(file_bytes)
        relative = "/uploads/" + quote(safe_name)
        base = (os.getenv("PUBLIC_MEDIA_BASE_URL") or "").strip().rstrip("/")
        return f"{base}{relative}" if base else relative
    except Exception as exc:
        print(f"[Media Storage] Không lưu được {safe_name} trên máy: {exc}")
        return None
