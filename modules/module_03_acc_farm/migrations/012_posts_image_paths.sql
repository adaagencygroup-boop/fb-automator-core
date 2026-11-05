-- Module 03 - Tab 2: nhiều ảnh Status (tối đa 3).
-- image_paths: JSON array text. image_path luôn sync = phần tử đầu (tương thích runner cũ).
-- Engine cũng tự thêm cột khi khởi động (ADDED_COLUMNS trong models.py).
BEGIN;

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS image_paths TEXT;

COMMIT;
