-- ============================================================================
-- SCHEMA POSTGRESQL: PHÂN HỆ ĐĂNG BÀI & TƯƠNG TÁC (MODULE 03 - TAB 2)
-- Yêu cầu: PostgreSQL 13+ (gen_random_uuid() có sẵn, không cần pgcrypto)
--
-- LƯU Ý KHI DÙNG:
--  * Chạy bằng công cụ migration (Flyway / Liquibase / node-pg-migrate / Alembic / Supabase SQL Editor).
--  * Kiểu của fb_accounts.id khớp với account_id ở các bảng bên dưới (UUID).
--  * Cấu hình Tương tác (nuôi nick) lưu ở State phiên làm việc, KHÔNG lưu DB.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Ghi chú: Bảng fb_accounts được quản lý bởi Module 02 (Account Manager).
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Hàm dùng chung: tự cập nhật updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1. post_settings: cấu hình đăng bài theo từng tab (Status, Reels, Story)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS post_settings (
  post_type           TEXT PRIMARY KEY CHECK (post_type IN ('status', 'reels', 'story')),

  -- Riêng cho Status
  api_key_file_path   TEXT,
  gemini_model        TEXT,
  prompt_template     TEXT CHECK (prompt_template IS NULL OR char_length(prompt_template) <= 2000),
  pixabay_api_key_enc BYTEA,                    -- mã hóa phía ứng dụng trước khi ghi

  -- Riêng cho Reels / Story
  master_folder_path  TEXT,
  check_duplicate     BOOLEAN NOT NULL DEFAULT TRUE,

  -- Chung
  schedule_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  schedule_time       TIME,                     -- giờ hẹn bắt đầu (HH:mm)
  min_delay           INTEGER NOT NULL DEFAULT 600 CHECK (min_delay >= 0),
  max_delay           INTEGER NOT NULL DEFAULT 900 CHECK (max_delay >= 0),
  thread_count        INTEGER NOT NULL DEFAULT 1 CHECK (thread_count >= 1),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (min_delay <= max_delay),
  CHECK (NOT schedule_enabled OR schedule_time IS NOT NULL)
);

-- Dữ liệu khởi tạo: mỗi tab một dòng cấu hình mặc định
INSERT INTO post_settings (post_type)
VALUES ('status'), ('reels'), ('story')
ON CONFLICT (post_type) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. account_folder_mappings: ánh xạ thư mục nguồn cho Reels / Story
-- Neo theo account_uid (bền vững khi import lại danh sách tài khoản).
-- Nick chưa gán = không có dòng (giao diện hiển thị "--").
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_folder_mappings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_uid           TEXT NOT NULL,
  post_type             TEXT NOT NULL CHECK (post_type IN ('reels', 'story')),
  subfolder_path        TEXT NOT NULL,
  available_media_count INTEGER NOT NULL DEFAULT 0 CHECK (available_media_count >= 0),
  mapping_status        TEXT NOT NULL DEFAULT 'MAPPED'
                        CHECK (mapping_status IN ('MAPPED', 'SOURCE_ERROR')),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_uid, post_type)
);

-- ----------------------------------------------------------------------------
-- 3. post_sessions: mỗi lần bấm chạy là một phiên
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS post_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('status', 'reels', 'story', 'interaction')),
  status      TEXT NOT NULL DEFAULT 'RUNNING'
              CHECK (status IN ('RUNNING', 'DONE', 'STOPPED', 'CRASHED')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- 4. posts: bản nháp + hàng đợi + lịch sử đăng (một bảng, đổi trạng thái)
--
-- Vòng đời:
--   Status:      DRAFT -> (bấm Lưu) READY -> PENDING -> RUNNING -> kết quả
--   Reels/Story:                             PENDING -> RUNNING -> kết quả
--   Kết quả: PUBLISHED | FAILED | BLOCKED | DIE | STOPPED
-- Sửa nội dung sau khi Lưu: đưa về DRAFT (chặn đăng, BR-M03-PRV-04).
-- account_uid / account_name là snapshot để giữ lịch sử khi nick bị xóa.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID REFERENCES post_sessions(id) ON DELETE SET NULL,
  account_id        UUID,
  account_uid       TEXT NOT NULL,
  account_name      TEXT,
  post_type         TEXT NOT NULL CHECK (post_type IN ('status', 'reels', 'story')),
  content           TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 63206),
  hashtags          TEXT,
  image_path        TEXT,      -- chỉ Status (ảnh minh họa Pixabay)
  media_path        TEXT,      -- chỉ Reels/Story (file được chọn lúc chạy)
  thumbnail_path    TEXT,      -- ảnh bìa Reels
  media_hash        TEXT,      -- SHA-256 nội dung file, dùng kiểm tra chống đăng trùng
  schedule_time     TIME,
  is_selected       BOOLEAN NOT NULL DEFAULT TRUE,
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
                    ('DRAFT', 'READY', 'PENDING', 'RUNNING',
                     'PUBLISHED', 'FAILED', 'STOPPED', 'BLOCKED', 'DIE')),
  facebook_post_url TEXT,
  error_message     TEXT,
  logs              JSONB,     -- log runtime từng bài (finish_post); DB cũ: 011_posts_logs.sql
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Ràng buộc theo loại bài
  CHECK (post_type = 'status' OR image_path IS NULL),
  CHECK (post_type <> 'status' OR media_path IS NULL),
  CHECK (post_type <> 'status' OR status <> 'PENDING' OR content <> ''),
  CHECK (post_type = 'status' OR status NOT IN ('DRAFT', 'READY'))
);

CREATE INDEX IF NOT EXISTS idx_posts_type_status ON posts (post_type, status);
CREATE INDEX IF NOT EXISTS idx_posts_uid_hash    ON posts (account_uid, media_hash)
  WHERE media_hash IS NOT NULL;                          -- partial index, nhỏ và nhanh
CREATE INDEX IF NOT EXISTS idx_posts_published   ON posts (published_at DESC)
  WHERE published_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_session     ON posts (session_id);
CREATE INDEX IF NOT EXISTS idx_posts_account     ON posts (account_id);   -- cho FK SET NULL / trigger xóa nick

-- ----------------------------------------------------------------------------
-- 5. post_interaction_logs: lịch sử chạy tương tác riêng của Tab 2
-- Cấu hình lấy từ State phiên, ghi nhận số phút, delay, số hành động ngẫu nhiên.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS post_interaction_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID REFERENCES post_sessions(id) ON DELETE SET NULL,
  account_id           UUID,
  account_uid          TEXT NOT NULL,
  account_name         TEXT,
  duration_minutes     INTEGER NOT NULL DEFAULT 0,
  delay_seconds        INTEGER NOT NULL DEFAULT 0,
  random_actions_count INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'RUNNING'
                       CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'STOPPED')),
  error_message        TEXT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_post_interaction_logs_session ON post_interaction_logs (session_id);
CREATE INDEX IF NOT EXISTS idx_post_interaction_logs_uid     ON post_interaction_logs (account_uid);
CREATE INDEX IF NOT EXISTS idx_post_interaction_logs_started ON post_interaction_logs (started_at DESC);

-- ----------------------------------------------------------------------------
-- 6. TRIGGER
-- ----------------------------------------------------------------------------

-- Khi xóa nick: bỏ bài chưa kết thúc và ánh xạ thư mục của nick đó.
-- Bài đã kết thúc được giữ lại (account_id -> NULL, snapshot uid/name còn nguyên).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fb_accounts') THEN
    CREATE OR REPLACE FUNCTION fb_accounts_before_delete() RETURNS trigger AS $func$
    BEGIN
      DELETE FROM posts
       WHERE account_id = OLD.id
         AND status IN ('DRAFT', 'READY', 'PENDING', 'RUNNING');
      DELETE FROM account_folder_mappings WHERE account_uid = OLD.uid;
      RETURN OLD;
    END;
    $func$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_account_delete_cleanup ON fb_accounts;
    CREATE TRIGGER trg_account_delete_cleanup
      BEFORE DELETE ON fb_accounts
      FOR EACH ROW EXECUTE FUNCTION fb_accounts_before_delete();
  END IF;
END $$;

-- Tự cập nhật updated_at
DROP TRIGGER IF EXISTS trg_posts_updated_at ON posts;
CREATE TRIGGER trg_posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_post_settings_updated_at ON post_settings;
CREATE TRIGGER trg_post_settings_updated_at
  BEFORE UPDATE ON post_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_afm_updated_at ON account_folder_mappings;
CREATE TRIGGER trg_afm_updated_at
  BEFORE UPDATE ON account_folder_mappings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY (Bảo mật bảng trên Supabase)
-- ----------------------------------------------------------------------------
ALTER TABLE post_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_folder_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_interaction_logs ENABLE ROW LEVEL SECURITY;

COMMIT;

