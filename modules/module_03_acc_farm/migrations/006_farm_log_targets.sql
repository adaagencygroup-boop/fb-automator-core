-- Module 03 - Tab 1: lưu người / nhóm đã tương tác của từng hành động (kết bạn, tham gia nhóm).
-- Chạy tay trong SQL Editor (Supabase hoặc Postgres local) sau 001. Chạy lại được (IF NOT EXISTS).
-- Engine cũng tự thêm cột này khi khởi động (ADDED_COLUMNS trong models.py), nên thứ tự không quan trọng.
-- targets: JSON dạng [{"name": "...", "url": "https://www.facebook.com/...", "status": "joined" | "pending" | null}];
--          NULL = hành động không có đối tượng (newsfeed, watch, thông báo) hoặc dòng log cũ.
BEGIN;

ALTER TABLE public.farm_interaction_logs ADD COLUMN IF NOT EXISTS targets TEXT;

COMMIT;
