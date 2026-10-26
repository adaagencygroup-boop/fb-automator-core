-- Module 03 - Tab 1: thả cảm xúc (Newsfeed, Watch, Story) + kịch bản Xem Story.
-- Chạy tay trong SQL Editor (Supabase hoặc Postgres local) sau 001. Chạy lại được (IF NOT EXISTS).
-- Engine cũng tự thêm các cột này khi khởi động (ADDED_COLUMNS trong models.py), nên thứ tự không quan trọng.
-- *_reactions: tổng số cảm xúc đã thả trong kịch bản (chia theo loại ghi ở farm_interaction_logs.details).
-- story_frames: số khung story đã xem; story_seconds: thời gian xem story. farm_interaction_logs.action_type thêm 'STORY'.
-- Rollback:
--   ALTER TABLE public.farm_run_history DROP COLUMN IF EXISTS newsfeed_reactions, DROP COLUMN IF EXISTS watch_reactions,
--     DROP COLUMN IF EXISTS story_frames, DROP COLUMN IF EXISTS story_seconds, DROP COLUMN IF EXISTS story_reactions;
BEGIN;

ALTER TABLE public.farm_run_history ADD COLUMN IF NOT EXISTS newsfeed_reactions INT DEFAULT 0;
ALTER TABLE public.farm_run_history ADD COLUMN IF NOT EXISTS watch_reactions INT DEFAULT 0;
ALTER TABLE public.farm_run_history ADD COLUMN IF NOT EXISTS story_frames INT DEFAULT 0;
ALTER TABLE public.farm_run_history ADD COLUMN IF NOT EXISTS story_seconds INT DEFAULT 0;
ALTER TABLE public.farm_run_history ADD COLUMN IF NOT EXISTS story_reactions INT DEFAULT 0;

COMMIT;
