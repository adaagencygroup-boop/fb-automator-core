"""
=============================================================================
MODULE 3 - TAB 1: TƯƠNG TÁC TÀI KHOẢN (NUÔI NICK) - DATABASE MODELS & SCHEMA
CSDL riêng của Tab 1 (Phụ trách: Bình Kiến).
Tài khoản Facebook KHÔNG nằm ở đây: dùng bảng accounts của Module 02 (qua adapters.py).
Thời gian lưu dạng TIMESTAMP theo giờ UTC, code luôn tự truyền giá trị.
=============================================================================
"""
from core.database.connection import db

DDL_STATEMENTS = [
    # 1. Lượt đang chạy (bảng làm việc: trạng thái, hoạt động hiện tại)
    """
    CREATE TABLE IF NOT EXISTS farm_runs (
        id SERIAL PRIMARY KEY,
        machine_id VARCHAR(64) NOT NULL,
        owner_username VARCHAR(100),
        fb_uid VARCHAR(50) NOT NULL,
        fb_name VARCHAR(150),
        session_id VARCHAR(32),
        status VARCHAR(20) NOT NULL,
        current_activity VARCHAR(255),
        error TEXT,
        started_at TIMESTAMP NOT NULL,
        finished_at TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_farm_runs_machine_started ON farm_runs (machine_id, started_at);",
    "CREATE INDEX IF NOT EXISTS ix_farm_runs_machine_status ON farm_runs (machine_id, status);",
    "CREATE INDEX IF NOT EXISTS ix_farm_runs_session ON farm_runs (session_id);",

    # 2. Lịch sử: 1 dòng / lượt đã kết thúc, ghi xong không sửa
    """
    CREATE TABLE IF NOT EXISTS farm_run_history (
        id SERIAL PRIMARY KEY,
        run_id INT UNIQUE REFERENCES farm_runs(id) ON DELETE SET NULL,
        machine_id VARCHAR(64) NOT NULL,
        owner_username VARCHAR(100),
        session_id VARCHAR(32),
        fb_uid VARCHAR(50) NOT NULL,
        fb_name VARCHAR(150),
        proxy_host VARCHAR(100),
        proxy_mode VARCHAR(20),
        egress_ip VARCHAR(64),
        fingerprint_mode VARCHAR(10),
        final_status VARCHAR(20) NOT NULL,
        error TEXT,
        light_checkpoint BOOLEAN DEFAULT FALSE,
        cookie_saved BOOLEAN DEFAULT FALSE,
        started_at TIMESTAMP NOT NULL,
        finished_at TIMESTAMP NOT NULL,
        duration_seconds INT NOT NULL,
        newsfeed_seconds INT DEFAULT 0,
        newsfeed_scrolls INT DEFAULT 0,
        watch_seconds INT DEFAULT 0,
        watch_videos INT DEFAULT 0,
        newsfeed_reactions INT DEFAULT 0,
        watch_reactions INT DEFAULT 0,
        story_frames INT DEFAULT 0,
        story_seconds INT DEFAULT 0,
        story_reactions INT DEFAULT 0,
        friends_sent INT DEFAULT 0,
        friends_source VARCHAR(20),
        groups_joined INT DEFAULT 0,
        groups_source VARCHAR(20),
        groups_keyword TEXT,
        groups_left INT DEFAULT 0,
        notif_checked BOOLEAN DEFAULT FALSE,
        notif_opened BOOLEAN DEFAULT FALSE,
        actions_success INT DEFAULT 0,
        actions_failed INT DEFAULT 0,
        actions_blocked INT DEFAULT 0,
        actions_skipped INT DEFAULT 0,
        actions_summary TEXT,
        config_snapshot TEXT,
        created_at TIMESTAMP NOT NULL
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_farm_hist_machine_finished ON farm_run_history (machine_id, finished_at);",
    "CREATE INDEX IF NOT EXISTS ix_farm_hist_uid_finished ON farm_run_history (fb_uid, finished_at);",
    "CREATE INDEX IF NOT EXISTS ix_farm_hist_machine_status ON farm_run_history (machine_id, final_status);",
    "CREATE INDEX IF NOT EXISTS ix_farm_hist_session ON farm_run_history (session_id);",

    # 3. Chi tiết từng hành động trong 1 lượt (dùng tính giới hạn ngày)
    """
    CREATE TABLE IF NOT EXISTS farm_interaction_logs (
        id SERIAL PRIMARY KEY,
        run_id INT REFERENCES farm_runs(id) ON DELETE CASCADE,
        machine_id VARCHAR(64) NOT NULL,
        owner_username VARCHAR(100),
        fb_uid VARCHAR(50) NOT NULL,
        action_type VARCHAR(30) NOT NULL,
        status VARCHAR(20) NOT NULL,
        quantity INT DEFAULT 0,
        details TEXT,
        targets TEXT,
        created_at TIMESTAMP NOT NULL
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_farm_logs_uid_action_created ON farm_interaction_logs (fb_uid, action_type, created_at);",
    "CREATE INDEX IF NOT EXISTS ix_farm_logs_run ON farm_interaction_logs (run_id);",

    # 4. Dấu vân tay trình duyệt cố định theo nick (dùng chung mọi máy)
    """
    CREATE TABLE IF NOT EXISTS farm_browser_fingerprints (
        uid VARCHAR(50) PRIMARY KEY,
        mode VARCHAR(10) NOT NULL,
        canvas_seed INT,
        created_at TIMESTAMP NOT NULL
    );
    """,

    # 5. Cấu hình theo máy (giới hạn kết bạn / nhóm mỗi ngày...)
    """
    CREATE TABLE IF NOT EXISTS farm_settings (
        machine_id VARCHAR(64) NOT NULL,
        key VARCHAR(50) NOT NULL,
        value TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        PRIMARY KEY (machine_id, key)
    );
    """,

    # 6. Chủ của nhóm / người trong dàn nick (chia đích): mỗi đích chỉ thuộc 1 nick, nick giành được trước là chủ.
    #    scope: "owner:<tài khoản đăng nhập tool>" (mọi máy) hoặc "machine:<machine_id>" (nick local).
    #    1 nhóm có thể có 2 dòng cùng chủ: ID số và tên rút gọn. Nút Dọn dẹp lịch sử không xóa bảng này.
    """
    CREATE TABLE IF NOT EXISTS farm_target_owners (
        id SERIAL PRIMARY KEY,
        scope VARCHAR(120) NOT NULL,
        kind VARCHAR(10) NOT NULL,
        target_key VARCHAR(255) NOT NULL,
        fb_uid VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        name VARCHAR(150),
        url VARCHAR(500),
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        UNIQUE (scope, target_key)
    );
    """,
]


# Cột thêm sau khi bảng đã có trên một số DB: CREATE TABLE IF NOT EXISTS không tự thêm cột vào bảng cũ.
# Cột mới phải có cả trong CREATE TABLE ở trên và ở đây (bảng, cột, kiểu).
ADDED_COLUMNS = [
    ("farm_run_history", "groups_keyword", "TEXT"),
    # Người / nhóm đã tương tác của 1 hành động (JSON), xem migrations/006_farm_log_targets.sql
    ("farm_interaction_logs", "targets", "TEXT"),
    # Nguồn nhóm của lượt (keyword / suggested / list), xem migrations/007_farm_history_groups_source.sql
    ("farm_run_history", "groups_source", "VARCHAR(20)"),
    # Thả cảm xúc + Xem Story, xem migrations/008_farm_history_reactions_story.sql
    ("farm_run_history", "newsfeed_reactions", "INT DEFAULT 0"),
    ("farm_run_history", "watch_reactions", "INT DEFAULT 0"),
    ("farm_run_history", "story_frames", "INT DEFAULT 0"),
    ("farm_run_history", "story_seconds", "INT DEFAULT 0"),
    ("farm_run_history", "story_reactions", "INT DEFAULT 0"),
    # Rời nhóm, xem migrations/009_farm_history_groups_left.sql
    ("farm_run_history", "groups_left", "INT DEFAULT 0"),
    # Log runtime từng bài (Story/Reels/Status) khi finish_post — migrations/011_posts_logs.sql
    ("posts", "logs", "JSONB"),
    # Nhiều ảnh Status (JSON array text), sync image_path = phần tử đầu — migrations/012_posts_image_paths.sql
    ("posts", "image_paths", "TEXT"),
    # Người dùng đã tạo bài (accounts.user_id) — lịch sử chỉ hiện bài của chính người đăng nhập
    ("posts", "owner_key", "TEXT"),
    # Nội dung Gemini key đã mã hóa (chọn file trên trình duyệt chỉ có tên file) — migrations/015_post_settings_gemini_keys.sql
    # (SQLite chấp nhận kiểu BYTEA như BLOB)
    ("post_settings", "gemini_api_keys_enc", "BYTEA"),
    # Bài thuộc chiến dịch đăng nhiều khung giờ — migrations/016_post_campaigns.sql
    ("posts", "campaign_id", "UUID"),
    ("posts", "slot_id", "UUID"),
]


# Bảng dùng chung của core/browser (mọi module mở Chrome qua core). Tạm đặt ở Module 03 vì Module 03 là
# module đầu tiên dùng core; khi các module khác dùng core thì chuyển DDL này sang core.
# Khớp với migrations/005_browser_fingerprints.sql (tests/test_migration_sync.py kiểm tra).
SHARED_DDL_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS browser_fingerprints (
        uid VARCHAR(50) PRIMARY KEY,
        mode VARCHAR(10) NOT NULL,
        canvas_seed INT,
        created_at TIMESTAMP NOT NULL
    );
    """,
]

# Chép seed từ bảng cũ của Tab 1 để nick đã chạy giữ nguyên dấu vân tay; dòng đã có thì bỏ qua.
# Bỏ được khi không còn bảng farm_browser_fingerprints.
COPY_LEGACY_FINGERPRINTS = """
    INSERT INTO browser_fingerprints (uid, mode, canvas_seed, created_at)
    SELECT uid, mode, canvas_seed, created_at FROM farm_browser_fingerprints
    ON CONFLICT (uid) DO NOTHING
"""


def _init_shared_tables():
    for stmt in SHARED_DDL_STATEMENTS:
        try:
            db.execute(stmt)
        except Exception as e:
            print(f"[Module 3 DB] Shared DDL error: {e}")
    try:
        db.execute(COPY_LEGACY_FINGERPRINTS)
    except Exception as e:
        print(f"[Module 3 DB] Copy fingerprints error: {e}")


def _add_missing_columns():
    for table, column, kind in ADDED_COLUMNS:
        try:
            if db._is_postgres:
                db.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {kind}")
            else:
                # SQLite không hỗ trợ ADD COLUMN IF NOT EXISTS
                existing = {row["name"] for row in db.fetch_all(f"PRAGMA table_info({table})")}
                if column not in existing:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {kind}")
        except Exception as e:
            print(f"[Module 3 DB] Add column {table}.{column} error: {e}")


# =============================================================================
# TAB 2: ĐĂNG BÀI VIẾT (STATUS, REELS, STORY) & TƯƠNG TÁC TỰ ĐỘNG
# =============================================================================

TAB2_DDL_STATEMENTS_PG = [
    # Hàm tự cập nhật updated_at
    """
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """,
    # 1. post_settings
    """
    CREATE TABLE IF NOT EXISTS post_settings (
      post_type TEXT PRIMARY KEY CHECK (post_type IN ('status', 'reels', 'story')),
      api_key_file_path TEXT,
      gemini_model TEXT,
      prompt_template TEXT CHECK (prompt_template IS NULL OR char_length(prompt_template) <= 2000),
      pixabay_api_key_enc BYTEA,
      gemini_api_keys_enc BYTEA,
      master_folder_path TEXT,
      check_duplicate BOOLEAN NOT NULL DEFAULT TRUE,
      schedule_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      schedule_time TIME,
      min_delay INTEGER NOT NULL DEFAULT 600 CHECK (min_delay >= 0),
      max_delay INTEGER NOT NULL DEFAULT 900 CHECK (max_delay >= 0),
      thread_count INTEGER NOT NULL DEFAULT 1 CHECK (thread_count >= 1),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (min_delay <= max_delay),
      CHECK (NOT schedule_enabled OR schedule_time IS NOT NULL)
    );
    """,
    "INSERT INTO post_settings (post_type) VALUES ('status'), ('reels'), ('story') ON CONFLICT (post_type) DO NOTHING;",
    # 2. account_folder_mappings
    """
    CREATE TABLE IF NOT EXISTS account_folder_mappings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_uid TEXT NOT NULL,
      post_type TEXT NOT NULL CHECK (post_type IN ('reels', 'story')),
      subfolder_path TEXT NOT NULL,
      available_media_count INTEGER NOT NULL DEFAULT 0 CHECK (available_media_count >= 0),
      mapping_status TEXT NOT NULL DEFAULT 'MAPPED' CHECK (mapping_status IN ('MAPPED', 'SOURCE_ERROR')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (account_uid, post_type)
    );
    """,
    # 3. post_sessions
    """
    CREATE TABLE IF NOT EXISTS post_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kind TEXT NOT NULL CHECK (kind IN ('status', 'reels', 'story', 'interaction')),
      status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE', 'STOPPED', 'CRASHED')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );
    """,
    # 4. posts
    """
    CREATE TABLE IF NOT EXISTS posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID REFERENCES post_sessions(id) ON DELETE SET NULL,
      account_id UUID,
      account_uid TEXT NOT NULL,
      account_name TEXT,
      owner_key TEXT,
      post_type TEXT NOT NULL CHECK (post_type IN ('status', 'reels', 'story')),
      content TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 63206),
      hashtags TEXT,
      image_path TEXT,
      image_paths TEXT,
      media_path TEXT,
      thumbnail_path TEXT,
      media_hash TEXT,
      schedule_time TIME,
      is_selected BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
        ('DRAFT', 'READY', 'PENDING', 'RUNNING', 'PUBLISHED', 'FAILED', 'STOPPED', 'BLOCKED', 'DIE')),
      facebook_post_url TEXT,
      error_message TEXT,
      logs JSONB,
      campaign_id UUID,
      slot_id UUID,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (post_type = 'status' OR image_path IS NULL),
      CHECK (post_type <> 'status' OR media_path IS NULL),
      CHECK (post_type <> 'status' OR status <> 'PENDING' OR content <> ''),
      CHECK (post_type = 'status' OR status NOT IN ('DRAFT', 'READY'))
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_posts_type_status ON posts (post_type, status);",
    "CREATE INDEX IF NOT EXISTS idx_posts_uid_hash ON posts (account_uid, media_hash) WHERE media_hash IS NOT NULL;",
    "CREATE INDEX IF NOT EXISTS idx_posts_published ON posts (published_at DESC) WHERE published_at IS NOT NULL;",
    "CREATE INDEX IF NOT EXISTS idx_posts_session ON posts (session_id);",
    "CREATE INDEX IF NOT EXISTS idx_posts_account ON posts (account_id);",
    "CREATE INDEX IF NOT EXISTS idx_posts_owner ON posts (owner_key, created_at);",
    # 5. post_interaction_logs
    """
    CREATE TABLE IF NOT EXISTS post_interaction_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID REFERENCES post_sessions(id) ON DELETE SET NULL,
      account_id UUID,
      account_uid TEXT NOT NULL,
      account_name TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      delay_seconds INTEGER NOT NULL DEFAULT 0,
      random_actions_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'STOPPED')),
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_post_interaction_logs_session ON post_interaction_logs (session_id);",
    "CREATE INDEX IF NOT EXISTS idx_post_interaction_logs_uid ON post_interaction_logs (account_uid);",
    "CREATE INDEX IF NOT EXISTS idx_post_interaction_logs_started ON post_interaction_logs (started_at DESC);",
    # Triggers & RLS
    # Trigger dọn dẹp liên kết khi xóa nick (chỉ cài đặt nếu fb_accounts tồn tại)
    """
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
    """,
    """
    DROP TRIGGER IF EXISTS trg_posts_updated_at ON posts;
    CREATE TRIGGER trg_posts_updated_at
      BEFORE UPDATE ON posts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """,
    """
    DROP TRIGGER IF EXISTS trg_post_settings_updated_at ON post_settings;
    CREATE TRIGGER trg_post_settings_updated_at
      BEFORE UPDATE ON post_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """,
    """
    DROP TRIGGER IF EXISTS trg_afm_updated_at ON account_folder_mappings;
    CREATE TRIGGER trg_afm_updated_at
      BEFORE UPDATE ON account_folder_mappings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """,
    # Video TikTok đã tải cho từng nick (Lịch sử)
    """
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
    """,
    "CREATE INDEX IF NOT EXISTS idx_account_tiktok_videos_owner ON account_tiktok_videos (owner_key, created_at);",
    # ── Chiến dịch đăng bài nhiều khung giờ (Status) — migrations/016_post_campaigns.sql ──
    # Nháp ô soạn bài chung (1 nháp / người dùng / loại bài)
    """
    CREATE TABLE IF NOT EXISTS post_compose_drafts (
      owner_key TEXT NOT NULL DEFAULT '',
      post_type TEXT NOT NULL CHECK (post_type IN ('status', 'reels', 'story')),
      content_text TEXT NOT NULL DEFAULT '',
      content_mode TEXT NOT NULL DEFAULT 'MULTI' CHECK (content_mode IN ('SINGLE', 'MULTI')),
      image_mode TEXT NOT NULL DEFAULT 'NONE' CHECK (image_mode IN ('NONE', 'SINGLE', 'MULTI')),
      image_paths TEXT,
      min_images INTEGER NOT NULL DEFAULT 1 CHECK (min_images BETWEEN 1 AND 3),
      max_images INTEGER NOT NULL DEFAULT 1 CHECK (max_images BETWEEN 1 AND 3),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_key, post_type),
      CHECK (min_images <= max_images)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS post_campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_key TEXT NOT NULL DEFAULT '',
      -- Máy tạo chiến dịch (profile Chrome của nick nằm trên máy này) — chỉ máy này chạy các khung giờ
      machine_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
      post_type TEXT NOT NULL DEFAULT 'status' CHECK (post_type IN ('status', 'reels', 'story')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'STOPPED', 'COMPLETED')),
      accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      content_text TEXT NOT NULL DEFAULT '',
      content_mode TEXT NOT NULL DEFAULT 'MULTI' CHECK (content_mode IN ('SINGLE', 'MULTI')),
      image_mode TEXT NOT NULL DEFAULT 'NONE' CHECK (image_mode IN ('NONE', 'SINGLE', 'MULTI')),
      image_paths TEXT,
      min_images INTEGER NOT NULL DEFAULT 1 CHECK (min_images BETWEEN 1 AND 3),
      max_images INTEGER NOT NULL DEFAULT 1 CHECK (max_images BETWEEN 1 AND 3),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (min_images <= max_images)
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_post_campaigns_owner ON post_campaigns (owner_key, created_at DESC);",
    """
    CREATE TABLE IF NOT EXISTS post_campaign_slots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID NOT NULL REFERENCES post_campaigns(id) ON DELETE CASCADE,
      run_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN
        ('WAITING', 'RUNNING', 'DONE', 'MISSED', 'STOPPED', 'FAILED')),
      session_id UUID REFERENCES post_sessions(id) ON DELETE SET NULL,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      total_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_post_campaign_slots_campaign ON post_campaign_slots (campaign_id, run_at);",
    "CREATE INDEX IF NOT EXISTS idx_post_campaign_slots_due ON post_campaign_slots (status, run_at);",
    # Nick nào đã dùng bài (hash nội dung) / ảnh (đường dẫn) nào, ở khung nào — luật không đăng trùng
    """
    CREATE TABLE IF NOT EXISTS post_campaign_usage (
      id BIGSERIAL PRIMARY KEY,
      campaign_id UUID NOT NULL REFERENCES post_campaigns(id) ON DELETE CASCADE,
      slot_id UUID NOT NULL REFERENCES post_campaign_slots(id) ON DELETE CASCADE,
      account_uid TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('TEXT', 'IMAGE')),
      item_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_post_campaign_usage_campaign ON post_campaign_usage (campaign_id, account_uid, kind);",
    "CREATE INDEX IF NOT EXISTS idx_post_campaign_usage_slot ON post_campaign_usage (slot_id);",
    "CREATE INDEX IF NOT EXISTS idx_posts_campaign ON posts (campaign_id, slot_id);",
    """
    DROP TRIGGER IF EXISTS trg_post_campaigns_updated_at ON post_campaigns;
    CREATE TRIGGER trg_post_campaigns_updated_at
      BEFORE UPDATE ON post_campaigns
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """,
    """
    DROP TRIGGER IF EXISTS trg_post_campaign_slots_updated_at ON post_campaign_slots;
    CREATE TRIGGER trg_post_campaign_slots_updated_at
      BEFORE UPDATE ON post_campaign_slots
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    """,
]

TAB2_DDL_STATEMENTS_SQLITE = [
    # 1. post_settings
    """
    CREATE TABLE IF NOT EXISTS post_settings (
      post_type TEXT PRIMARY KEY CHECK (post_type IN ('status', 'reels', 'story')),
      api_key_file_path TEXT,
      gemini_model TEXT,
      prompt_template TEXT CHECK (prompt_template IS NULL OR length(prompt_template) <= 2000),
      pixabay_api_key_enc BLOB,
      gemini_api_keys_enc BLOB,
      master_folder_path TEXT,
      check_duplicate INTEGER NOT NULL DEFAULT 1,
      schedule_enabled INTEGER NOT NULL DEFAULT 0,
      schedule_time TEXT,
      min_delay INTEGER NOT NULL DEFAULT 600 CHECK (min_delay >= 0),
      max_delay INTEGER NOT NULL DEFAULT 900 CHECK (max_delay >= 0),
      thread_count INTEGER NOT NULL DEFAULT 1 CHECK (thread_count >= 1),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CHECK (min_delay <= max_delay),
      CHECK (schedule_enabled = 0 OR schedule_time IS NOT NULL)
    );
    """,
    "INSERT OR IGNORE INTO post_settings (post_type) VALUES ('status'), ('reels'), ('story');",
    # 2. account_folder_mappings
    """
    CREATE TABLE IF NOT EXISTS account_folder_mappings (
      id TEXT PRIMARY KEY,
      account_uid TEXT NOT NULL,
      post_type TEXT NOT NULL CHECK (post_type IN ('reels', 'story')),
      subfolder_path TEXT NOT NULL,
      available_media_count INTEGER NOT NULL DEFAULT 0 CHECK (available_media_count >= 0),
      mapping_status TEXT NOT NULL DEFAULT 'MAPPED' CHECK (mapping_status IN ('MAPPED', 'SOURCE_ERROR')),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (account_uid, post_type)
    );
    """,
    # 3. post_sessions
    """
    CREATE TABLE IF NOT EXISTS post_sessions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('status', 'reels', 'story', 'interaction')),
      status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE', 'STOPPED', 'CRASHED')),
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME
    );
    """,
    # 4. posts
    """
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES post_sessions(id) ON DELETE SET NULL,
      account_id TEXT,
      account_uid TEXT NOT NULL,
      account_name TEXT,
      owner_key TEXT,
      post_type TEXT NOT NULL CHECK (post_type IN ('status', 'reels', 'story')),
      content TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 63206),
      hashtags TEXT,
      image_path TEXT,
      image_paths TEXT,
      media_path TEXT,
      thumbnail_path TEXT,
      media_hash TEXT,
      schedule_time TEXT,
      is_selected INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
        ('DRAFT', 'READY', 'PENDING', 'RUNNING', 'PUBLISHED', 'FAILED', 'STOPPED', 'BLOCKED', 'DIE')),
      facebook_post_url TEXT,
      error_message TEXT,
      logs TEXT,
      campaign_id TEXT,
      slot_id TEXT,
      published_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CHECK (post_type = 'status' OR image_path IS NULL),
      CHECK (post_type <> 'status' OR media_path IS NULL),
      CHECK (post_type <> 'status' OR status <> 'PENDING' OR content <> ''),
      CHECK (post_type = 'status' OR status NOT IN ('DRAFT', 'READY'))
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_posts_type_status ON posts (post_type, status);",
    "CREATE INDEX IF NOT EXISTS idx_posts_uid_hash ON posts (account_uid, media_hash);",
    "CREATE INDEX IF NOT EXISTS idx_posts_published ON posts (published_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_posts_session ON posts (session_id);",
    "CREATE INDEX IF NOT EXISTS idx_posts_account ON posts (account_id);",
    "CREATE INDEX IF NOT EXISTS idx_posts_owner ON posts (owner_key, created_at);",
    # 5. post_interaction_logs
    """
    CREATE TABLE IF NOT EXISTS post_interaction_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES post_sessions(id) ON DELETE SET NULL,
      account_id TEXT,
      account_uid TEXT NOT NULL,
      account_name TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      delay_seconds INTEGER NOT NULL DEFAULT 0,
      random_actions_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'STOPPED')),
      error_message TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_post_interaction_logs_session ON post_interaction_logs (session_id);",
    "CREATE INDEX IF NOT EXISTS idx_post_interaction_logs_uid ON post_interaction_logs (account_uid);",
    "CREATE INDEX IF NOT EXISTS idx_post_interaction_logs_started ON post_interaction_logs (started_at DESC);",
    # Video TikTok đã tải cho từng nick (Lịch sử)
    """
    CREATE TABLE IF NOT EXISTS account_tiktok_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_key TEXT NOT NULL,
      account_uid TEXT NOT NULL,
      account_name TEXT,
      video_id TEXT NOT NULL,
      video_url TEXT,
      keyword TEXT,
      caption TEXT,
      file_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_account_tiktok_videos_owner ON account_tiktok_videos (owner_key, created_at);",
    # ── Chiến dịch đăng bài nhiều khung giờ (Status) ──
    """
    CREATE TABLE IF NOT EXISTS post_compose_drafts (
      owner_key TEXT NOT NULL DEFAULT '',
      post_type TEXT NOT NULL CHECK (post_type IN ('status', 'reels', 'story')),
      content_text TEXT NOT NULL DEFAULT '',
      content_mode TEXT NOT NULL DEFAULT 'MULTI' CHECK (content_mode IN ('SINGLE', 'MULTI')),
      image_mode TEXT NOT NULL DEFAULT 'NONE' CHECK (image_mode IN ('NONE', 'SINGLE', 'MULTI')),
      image_paths TEXT,
      min_images INTEGER NOT NULL DEFAULT 1 CHECK (min_images BETWEEN 1 AND 3),
      max_images INTEGER NOT NULL DEFAULT 1 CHECK (max_images BETWEEN 1 AND 3),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (owner_key, post_type),
      CHECK (min_images <= max_images)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS post_campaigns (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL DEFAULT '',
      -- Máy tạo chiến dịch (profile Chrome của nick nằm trên máy này) — chỉ máy này chạy các khung giờ
      machine_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
      post_type TEXT NOT NULL DEFAULT 'status' CHECK (post_type IN ('status', 'reels', 'story')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'STOPPED', 'COMPLETED')),
      accounts TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}',
      content_text TEXT NOT NULL DEFAULT '',
      content_mode TEXT NOT NULL DEFAULT 'MULTI' CHECK (content_mode IN ('SINGLE', 'MULTI')),
      image_mode TEXT NOT NULL DEFAULT 'NONE' CHECK (image_mode IN ('NONE', 'SINGLE', 'MULTI')),
      image_paths TEXT,
      min_images INTEGER NOT NULL DEFAULT 1 CHECK (min_images BETWEEN 1 AND 3),
      max_images INTEGER NOT NULL DEFAULT 1 CHECK (max_images BETWEEN 1 AND 3),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CHECK (min_images <= max_images)
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_post_campaigns_owner ON post_campaigns (owner_key, created_at);",
    """
    CREATE TABLE IF NOT EXISTS post_campaign_slots (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES post_campaigns(id) ON DELETE CASCADE,
      run_at DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN
        ('WAITING', 'RUNNING', 'DONE', 'MISSED', 'STOPPED', 'FAILED')),
      session_id TEXT REFERENCES post_sessions(id) ON DELETE SET NULL,
      started_at DATETIME,
      finished_at DATETIME,
      total_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_post_campaign_slots_campaign ON post_campaign_slots (campaign_id, run_at);",
    "CREATE INDEX IF NOT EXISTS idx_post_campaign_slots_due ON post_campaign_slots (status, run_at);",
    """
    CREATE TABLE IF NOT EXISTS post_campaign_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES post_campaigns(id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL REFERENCES post_campaign_slots(id) ON DELETE CASCADE,
      account_uid TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('TEXT', 'IMAGE')),
      item_key TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_post_campaign_usage_campaign ON post_campaign_usage (campaign_id, account_uid, kind);",
    "CREATE INDEX IF NOT EXISTS idx_post_campaign_usage_slot ON post_campaign_usage (slot_id);",
    "CREATE INDEX IF NOT EXISTS idx_posts_campaign ON posts (campaign_id, slot_id);",
]


# Bài cũ chưa có chủ: gán theo chủ hiện tại của nick (nick đã xóa khỏi Module 02 thì chưa gán được)
BACKFILL_POST_OWNER = """
    UPDATE posts SET owner_key = a.owner
    FROM (
        SELECT uid, MIN(user_id) AS owner FROM accounts
        WHERE COALESCE(user_id, '') <> '' GROUP BY uid HAVING COUNT(DISTINCT user_id) = 1
    ) a
    WHERE posts.owner_key IS NULL AND posts.account_uid = a.uid
"""


def init_tab2_models():
    """Khởi tạo schema cho Tab 2 (Đăng bài: Status, Reels, Story)"""
    statements = TAB2_DDL_STATEMENTS_PG if db._is_postgres else TAB2_DDL_STATEMENTS_SQLITE
    for stmt in statements:
        try:
            db.execute(stmt)
        except Exception as e:
            print(f"[Module 3 Tab 2 DB] Error: {e}")
    try:
        db.execute(BACKFILL_POST_OWNER)
    except Exception as e:
        print(f"[Module 3 Tab 2 DB] Backfill post owner error: {e}")


def init_models():
    """Khởi tạo schema toàn diện cho Module 3 (Tab 1 Tương tác + Tab 2 Đăng bài)"""
    # 1. Khởi tạo Tab 1 (farm_*)
    for stmt in DDL_STATEMENTS:
        try:
            if not db._is_postgres:
                clean_stmt = stmt.replace("SERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT")
                clean_stmt = clean_stmt.replace("BOOLEAN DEFAULT FALSE", "INTEGER DEFAULT 0")
            else:
                clean_stmt = stmt
            db.execute(clean_stmt)
        except Exception as e:
            print(f"[Module 3 DB] DDL error: {e}")
    _add_missing_columns()
    _init_shared_tables()

    # 2. Khởi tạo Tab 2 (Đăng bài: Status, Reels, Story)
    init_tab2_models()
