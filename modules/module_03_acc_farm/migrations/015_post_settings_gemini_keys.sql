-- Module 03 - Tab 2: lưu nội dung Gemini API key (mã hóa phía ứng dụng, giống pixabay_api_key_enc).
-- Trước đây chọn file key trên trình duyệt chỉ lưu tên file vào api_key_file_path → tải lại trang mất key.
-- Engine cũng tự thêm cột khi khởi động (ADDED_COLUMNS trong models.py).
BEGIN;

ALTER TABLE public.post_settings ADD COLUMN IF NOT EXISTS gemini_api_keys_enc BYTEA;

COMMIT;
