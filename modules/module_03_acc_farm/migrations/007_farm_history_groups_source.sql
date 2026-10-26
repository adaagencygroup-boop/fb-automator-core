-- Module 03 - Tab 1: nguồn nhóm của từng lượt (tham gia nhóm theo từ khóa / đề xuất / danh sách link dán).
-- Chạy tay trong SQL Editor (Supabase hoặc Postgres local) sau 001. Chạy lại được (IF NOT EXISTS).
-- Engine cũng tự thêm cột này khi khởi động (ADDED_COLUMNS trong models.py), nên thứ tự không quan trọng.
-- groups_source: 'keyword' | 'suggested' | 'list'; NULL = lượt không chạy tham gia nhóm hoặc dòng lịch sử cũ.
-- friends_source (có sẵn) thêm giá trị 'list' cho kết bạn theo danh sách link, không cần đổi cột.
-- Rollback: ALTER TABLE public.farm_run_history DROP COLUMN IF EXISTS groups_source;
BEGIN;

ALTER TABLE public.farm_run_history ADD COLUMN IF NOT EXISTS groups_source VARCHAR(20);

COMMIT;
