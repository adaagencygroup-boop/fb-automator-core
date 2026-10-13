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
        friends_sent INT DEFAULT 0,
        friends_source VARCHAR(20),
        groups_joined INT DEFAULT 0,
        groups_keyword TEXT,
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
]


# Cột thêm sau khi bảng đã có trên một số DB: CREATE TABLE IF NOT EXISTS không tự thêm cột vào bảng cũ.
# Cột mới phải có cả trong CREATE TABLE ở trên và ở đây (bảng, cột, kiểu).
ADDED_COLUMNS = [
    ("farm_run_history", "groups_keyword", "TEXT"),
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
      post_type TEXT NOT NULL CHECK (post_type IN ('status', 'reels', 'story')),
      content TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 63206),
      hashtags TEXT,
      image_path TEXT,
      media_path TEXT,
      thumbnail_path TEXT,
      media_hash TEXT,
      schedule_time TIME,
      is_selected BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
        ('DRAFT', 'READY', 'PENDING', 'RUNNING', 'PUBLISHED', 'FAILED', 'STOPPED', 'BLOCKED', 'DIE')),
      facebook_post_url TEXT,
      error_message TEXT,
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
      post_type TEXT NOT NULL CHECK (post_type IN ('status', 'reels', 'story')),
      content TEXT NOT NULL DEFAULT '' CHECK (length(content) <= 63206),
      hashtags TEXT,
      image_path TEXT,
      media_path TEXT,
      thumbnail_path TEXT,
      media_hash TEXT,
      schedule_time TEXT,
      is_selected INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN
        ('DRAFT', 'READY', 'PENDING', 'RUNNING', 'PUBLISHED', 'FAILED', 'STOPPED', 'BLOCKED', 'DIE')),
      facebook_post_url TEXT,
      error_message TEXT,
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
]


def init_tab2_models():
    """Khởi tạo schema cho Tab 2 (Đăng bài: Status, Reels, Story)"""
    statements = TAB2_DDL_STATEMENTS_PG if db._is_postgres else TAB2_DDL_STATEMENTS_SQLITE
    for stmt in statements:
        try:
            db.execute(stmt)
        except Exception as e:
            print(f"[Module 3 Tab 2 DB] Error: {e}")


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
