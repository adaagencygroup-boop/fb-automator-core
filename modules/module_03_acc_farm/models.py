"""
=============================================================================
MODULE 3 - TAB 1: TƯƠNG TÁC TÀI KHOẢN (NUÔI NICK) - DATABASE MODELS & SCHEMA
CSDL riêng của Tab 1 (Phụ trách: Bình Kiến).
Tài khoản Facebook KHÔNG nằm ở đây: lưu local (xem _temp/local_db.py).
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


def init_models():
    """Khởi tạo schema riêng cho Module 3 - Tab 1"""
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
