-- Lịch sử video TikTok đã tải cho từng tài khoản Facebook
CREATE TABLE IF NOT EXISTS account_tiktok_videos (
  id BIGSERIAL PRIMARY KEY,
  owner_key TEXT NOT NULL,
  account_uid TEXT NOT NULL,
  account_name TEXT,
  video_id TEXT NOT NULL,
  video_url TEXT,
  keyword TEXT,
  caption TEXT,
  file_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_tiktok_videos_owner ON account_tiktok_videos (owner_key, created_at);
