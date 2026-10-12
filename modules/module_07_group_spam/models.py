"""
=============================================================================
MODULE 7: FACEBOOK GROUP POSTING - MINIMAL FINAL-LOG SCHEMA

Chỉ lưu session đã kết thúc và trạng thái cuối của từng account/group.
Cấu hình, queue và log tiến trình được giữ trong bộ nhớ ứng dụng.
=============================================================================
"""
from core.database.connection import db


DDL_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS group_sessions (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100),
        action_type VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL,
        total_planned INT NOT NULL DEFAULT 0,
        total_success INT NOT NULL DEFAULT 0,
        total_pending_approval INT NOT NULL DEFAULT 0,
        total_failed INT NOT NULL DEFAULT 0,
        total_skipped INT NOT NULL DEFAULT 0,
        started_at TIMESTAMP,
        finished_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT ck_group_session_action_type CHECK (
            action_type IN ('POST', 'COMMENT')
        ),
        CONSTRAINT ck_group_session_final_status CHECK (
            status IN ('COMPLETED', 'PARTIAL', 'STOPPED', 'CANCELLED', 'FAILED')
        ),
        CONSTRAINT ck_group_session_totals CHECK (
            total_planned >= 0
            AND total_success >= 0
            AND total_pending_approval >= 0
            AND total_failed >= 0
            AND total_skipped >= 0
            AND total_success + total_pending_approval + total_failed + total_skipped
                <= total_planned
        )
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS group_session_logs (
        id SERIAL PRIMARY KEY,
        session_id INT NOT NULL REFERENCES group_sessions(id) ON DELETE CASCADE,
        account_uid VARCHAR(50) NOT NULL,
        account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
        group_key VARCHAR(255) NOT NULL,
        group_url TEXT NOT NULL,
        group_name VARCHAR(255),
        member_count INT,
        monthly_post_count INT,
        monthly_post_count_is_lower_bound BOOLEAN NOT NULL DEFAULT FALSE,
        round_index INT NOT NULL DEFAULT 1,
        status VARCHAR(30) NOT NULL,
        result_message VARCHAR(255),
        error_code VARCHAR(100),
        error_detail TEXT,
        facebook_post_id VARCHAR(100),
        facebook_post_url TEXT,
        finished_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_group_session_log_result UNIQUE (
            session_id, account_uid, group_key
        ),
        CONSTRAINT ck_group_session_log_counts CHECK (
            (member_count IS NULL OR member_count >= 0)
            AND (monthly_post_count IS NULL OR monthly_post_count >= 0)
        ),
        CONSTRAINT ck_group_session_log_lower_bound CHECK (
            monthly_post_count IS NOT NULL
            OR monthly_post_count_is_lower_bound = FALSE
        ),
        CONSTRAINT ck_group_session_log_round CHECK (round_index >= 1),
        CONSTRAINT ck_group_session_log_final_status CHECK (
            status IN (
                'SUCCESS', 'PENDING_APPROVAL', 'FAILED', 'SKIPPED', 'CANCELLED'
            )
        )
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_group_sessions_history ON group_sessions (owner_key, finished_at);",
    "CREATE INDEX IF NOT EXISTS idx_group_sessions_status ON group_sessions (owner_key, status, finished_at);",
    "CREATE INDEX IF NOT EXISTS idx_group_session_logs_status ON group_session_logs (session_id, status, finished_at);",
    "CREATE INDEX IF NOT EXISTS idx_group_session_logs_account ON group_session_logs (account_uid, finished_at);",
    "CREATE INDEX IF NOT EXISTS idx_group_session_logs_account_id ON group_session_logs (account_id, finished_at);",
    "CREATE INDEX IF NOT EXISTS idx_group_session_logs_group ON group_session_logs (group_key, finished_at);",
]


def init_models():
    """Khởi tạo schema log tối giản trên PostgreSQL hoặc SQLite fallback."""
    for statement in DDL_STATEMENTS:
        try:
            if db._is_postgres:
                clean_statement = statement
            else:
                clean_statement = statement.replace(
                    "SERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT"
                )
                clean_statement = clean_statement.replace(
                    "BOOLEAN NOT NULL DEFAULT FALSE", "INTEGER NOT NULL DEFAULT 0"
                )
            db.execute(clean_statement)
        except Exception as exc:
            print(f"[Module 7 DB] DDL error: {exc}")
