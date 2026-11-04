import os
import mimetypes
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

# ?u ti?n c?u h?nh _1 ri?ng c?a Module 06
SUPABASE_URL = os.getenv("SUPABASE_URL_1") or os.getenv("SUPABASE_URL", "")
if SUPABASE_URL and not SUPABASE_URL.startswith("http"):
    SUPABASE_URL = f"https://{SUPABASE_URL}"

SUPABASE_KEY = (
    os.getenv("SUPABASE_KEY_1")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY_1")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    or os.getenv("SUPABASE_KEY", "")
)
BUCKET_NAME = (
    os.getenv("SUPABASE_STORAGE_BUCKET_1")
    or os.getenv("SUPABASE_CHAT_BUCKET")
    or os.getenv("SUPABASE_STORAGE_BUCKET", "chat-attachments")
)

_client = None

def get_supabase_client():
    global _client
    if _client is not None:
        return _client
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        from supabase import create_client
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
        return _client
    except Exception as e:
        print(f"[Supabase Storage] Client init error: {e}")
        return None

def upload_file_bytes(file_bytes: bytes, file_name: str, content_type: Optional[str] = None) -> Optional[str]:
    """
    Tải file bytes lên Supabase Storage bucket và trả về Public URL.
    Nếu upload lỗi hoặc chưa cấu hình Supabase, trả về None (để fallback lưu local).
    """
    client = get_supabase_client()
    if not client:
        return None

    if not content_type:
        content_type, _ = mimetypes.guess_type(file_name)
        content_type = content_type or "application/octet-stream"

    try:
        # file_options upsert="true" để ghi đè nếu trùng
        client.storage.from_(BUCKET_NAME).upload(
            path=file_name,
            file=file_bytes,
            file_options={"content-type": content_type, "upsert": "true"}
        )
        public_url = client.storage.from_(BUCKET_NAME).get_public_url(file_name)
        return public_url
    except Exception as e:
        print(f"[Supabase Storage Upload Error] {file_name}: {e}")
        return None

