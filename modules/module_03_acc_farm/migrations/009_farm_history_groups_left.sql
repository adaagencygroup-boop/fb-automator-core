-- Module 03 - Tab 1: số nhóm đã rời của từng lượt (kịch bản Rời nhóm).
-- Chạy tay trong SQL Editor (Supabase hoặc Postgres local) sau 001. Chạy lại được (IF NOT EXISTS).
-- Engine cũng tự thêm cột này khi khởi động (ADDED_COLUMNS trong models.py), nên thứ tự không quan trọng.
-- Từng nhóm đã rời (kèm lý do) ghi ở farm_interaction_logs.targets với action_type 'LEAVE_GROUP', result 'left'.
-- Rollback: ALTER TABLE public.farm_run_history DROP COLUMN IF EXISTS groups_left;
BEGIN;

ALTER TABLE public.farm_run_history ADD COLUMN IF NOT EXISTS groups_left INT DEFAULT 0;

COMMIT;
