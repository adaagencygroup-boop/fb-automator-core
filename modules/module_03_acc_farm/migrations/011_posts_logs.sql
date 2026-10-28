-- Module 03 - Tab 2: lưu log runtime từng bài (Story/Reels/Status) khi finish_post.
-- Engine cũng tự thêm cột này khi khởi động (ADDED_COLUMNS trong models.py).
-- Chạy tay trên Supabase SQL Editor cũng được (IF NOT EXISTS).
BEGIN;

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS logs JSONB;

COMMIT;
