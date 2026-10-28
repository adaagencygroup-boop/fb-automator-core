"""
=============================================================================
MODULE 11: FACEBOOK PAGE SCANNER - DATABASE MODELS & DDL SCHEMA
=============================================================================
"""
import logging
from typing import Any, Dict, List, Optional
from core.database.connection import db

logger = logging.getLogger(__name__)

# ==================== CONSTANTS & ENUMS ====================
JOB_TYPES = ["DISCOVERY", "DETAIL", "FOLLOW", "POST_SCAN"]

STOP_REASONS = [
    "TARGET_REACHED",
    "NO_NEW_RESULTS",
    "CYCLE_DETECTED",
    "END_MARKER",
    "MAX_SCROLLS",
    "HASHTAG_UNAVAILABLE",
    "USER_STOPPED",
    "CHECKPOINT",
    "TIMEOUT",
    "ERROR",
]

DETAIL_STATUSES = ["NOT_SCANNED", "SCANNED", "FAILED"]
FOLLOW_STATUSES = ["FOLLOWING", "NOT_FOLLOWED", "FAILED"]
FOLLOW_LOG_STATUSES = ["SUCCESS", "ALREADY_FOLLOWING", "NOT_FOUND", "FAILED"]
LIMITER_ACTIONS = ["PAGE_VISIT", "POST_SCAN", "FOLLOW", "SEARCH_SESSION"]


DDL_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS page_scan_sessions (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100),
        job_type VARCHAR(20) NOT NULL DEFAULT 'DISCOVERY',
        keyword TEXT,
        account_uid VARCHAR(50),
        source_type VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL,
        stop_reason VARCHAR(50),
        max_results INT NOT NULL DEFAULT 100,
        total_seen INT NOT NULL DEFAULT 0,
        total_unique INT NOT NULL DEFAULT 0,
        total_duplicates INT NOT NULL DEFAULT 0,
        total_sponsored INT NOT NULL DEFAULT 0,
        batches_count INT NOT NULL DEFAULT 0,
        duration_seconds INT NOT NULL DEFAULT 0,
        total_posts_scanned INT NOT NULL DEFAULT 0,
        total_posts_matched INT NOT NULL DEFAULT 0,
        total_authors_seen INT NOT NULL DEFAULT 0,
        total_pages_relevant INT NOT NULL DEFAULT 0,
        total_pages_review INT NOT NULL DEFAULT 0,
        total_pages_excluded INT NOT NULL DEFAULT 0,
        settings TEXT,
        campaign_id VARCHAR(64),
        logs TEXT,
        error_message TEXT,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT ck_page_scan_session_job CHECK (
            job_type IN ('DISCOVERY', 'DETAIL', 'FOLLOW', 'POST_SCAN')
        ),
        CONSTRAINT ck_page_scan_session_source CHECK (
            source_type IN ('SEARCH', 'PARSE', 'UPLOAD', 'HASHTAG')
        ),
        CONSTRAINT ck_page_scan_session_status CHECK (
            status IN ('RUNNING', 'PAUSED', 'COMPLETED', 'PARTIAL', 'STOPPED', 'FAILED')
        )
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS scanned_pages (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100),
        page_key VARCHAR(255) NOT NULL,
        page_name VARCHAR(255),
        page_url TEXT NOT NULL,
        avatar_url TEXT,
        category VARCHAR(255),
        follower_count INT,
        follower_text VARCHAR(100),
        is_verified BOOLEAN DEFAULT NULL,
        is_sponsored BOOLEAN NOT NULL DEFAULT FALSE,
        identifier_quality VARCHAR(20) DEFAULT 'high',
        relevance_score INT DEFAULT 0,
        relevance_status VARCHAR(20) DEFAULT 'RELEVANT',
        matched_hashtags TEXT,
        hashtag_post_count INT DEFAULT 0,
        phone TEXT,
        email VARCHAR(255),
        website TEXT,
        address TEXT,
        description TEXT,
        detail_status VARCHAR(20) NOT NULL DEFAULT 'NOT_SCANNED',
        detail_scanned_at TIMESTAMP,
        detail_session_id INT REFERENCES page_scan_sessions(id) ON DELETE SET NULL,
        first_found_by_account_uid VARCHAR(50),
        first_source_type VARCHAR(20),
        first_session_id INT REFERENCES page_scan_sessions(id) ON DELETE SET NULL,
        raw_data TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_pages_owner_page_key UNIQUE (owner_key, page_key),
        CONSTRAINT ck_scanned_pages_detail_status CHECK (
            detail_status IN ('NOT_SCANNED', 'SCANNED', 'FAILED')
        )
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS page_scan_session_pages (
        id SERIAL PRIMARY KEY,
        session_id INT NOT NULL REFERENCES page_scan_sessions(id) ON DELETE CASCADE,
        page_key VARCHAR(255) NOT NULL,
        batch_index INT NOT NULL DEFAULT 1,
        is_new_globally BOOLEAN NOT NULL DEFAULT TRUE,
        relevance_score INT DEFAULT 0,
        relevance_status VARCHAR(20) DEFAULT 'RELEVANT',
        hashtag_post_count INT DEFAULT 0,
        matched_hashtags TEXT,
        evidence_posts TEXT,
        latest_post_at VARCHAR(100),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_session_page_key UNIQUE (session_id, page_key)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS page_follows (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100),
        page_key VARCHAR(255) NOT NULL,
        account_uid VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'NOT_FOLLOWED',
        followed_at TIMESTAMP,
        last_checked_at TIMESTAMP,
        last_session_id INT REFERENCES page_scan_sessions(id) ON DELETE SET NULL,
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_page_follows_owner_acc UNIQUE (owner_key, page_key, account_uid),
        CONSTRAINT ck_page_follows_status CHECK (
            status IN ('FOLLOWING', 'NOT_FOLLOWED', 'FAILED')
        )
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS page_follow_logs (
        id SERIAL PRIMARY KEY,
        session_id INT NOT NULL REFERENCES page_scan_sessions(id) ON DELETE CASCADE,
        page_key VARCHAR(255) NOT NULL,
        account_uid VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_session_follow_log UNIQUE (session_id, page_key, account_uid),
        CONSTRAINT ck_page_follow_logs_status CHECK (
            status IN ('SUCCESS', 'ALREADY_FOLLOWING', 'NOT_FOUND', 'FAILED')
        )
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS scanned_posts (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100),
        page_key VARCHAR(255) NOT NULL,
        post_key VARCHAR(255) NOT NULL,
        post_url TEXT NOT NULL,
        published_at TIMESTAMP,
        published_text VARCHAR(100),
        content TEXT,
        post_type VARCHAR(50),
        reaction_count INT DEFAULT 0,
        comment_count INT DEFAULT 0,
        share_count INT DEFAULT 0,
        is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
        first_session_id INT REFERENCES page_scan_sessions(id) ON DELETE SET NULL,
        last_session_id INT REFERENCES page_scan_sessions(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_posts_owner_post UNIQUE (owner_key, page_key, post_key)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS scanned_page_followers (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100),
        page_key VARCHAR(255) NOT NULL,
        follower_key VARCHAR(255) NOT NULL,
        follower_name VARCHAR(255),
        profile_url TEXT,
        avatar_url TEXT,
        gender VARCHAR(50),
        location TEXT,
        first_session_id INT REFERENCES page_scan_sessions(id) ON DELETE SET NULL,
        last_session_id INT REFERENCES page_scan_sessions(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_page_followers_owner UNIQUE (owner_key, page_key, follower_key)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS page_scanner_account_usage (
        account_uid VARCHAR(50) NOT NULL,
        usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
        action VARCHAR(30) NOT NULL,
        used_count INT NOT NULL DEFAULT 0,
        warning_count INT NOT NULL DEFAULT 0,
        cooldown_until TIMESTAMP,
        tier VARCHAR(5) DEFAULT 'B',
        PRIMARY KEY (account_uid, usage_date, action)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS page_key_aliases (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100),
        alias_key VARCHAR(255) NOT NULL,
        canonical_key VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_page_key_aliases UNIQUE (owner_key, alias_key)
    );
    """,
]

INDEX_STATEMENTS = [
    "CREATE INDEX IF NOT EXISTS idx_page_scan_sessions_owner ON page_scan_sessions (owner_key, created_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_page_scan_sessions_status ON page_scan_sessions (owner_key, status);",
    "CREATE INDEX IF NOT EXISTS idx_page_scan_sessions_job ON page_scan_sessions (owner_key, job_type);",
    "CREATE INDEX IF NOT EXISTS idx_page_scan_sessions_campaign ON page_scan_sessions (owner_key, campaign_id);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_pages_owner_key ON scanned_pages (owner_key, page_key);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_pages_follower ON scanned_pages (owner_key, follower_count);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_pages_relevance ON scanned_pages (owner_key, relevance_score DESC);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_pages_detail_status ON scanned_pages (owner_key, detail_status);",
    "CREATE INDEX IF NOT EXISTS idx_page_scan_session_pages_lookup ON page_scan_session_pages (session_id, page_key);",
    "CREATE INDEX IF NOT EXISTS idx_page_scan_session_pages_rel ON page_scan_session_pages (session_id, relevance_status);",
    "CREATE INDEX IF NOT EXISTS idx_page_follows_acc ON page_follows (owner_key, account_uid, status);",
    "CREATE INDEX IF NOT EXISTS idx_page_follow_logs_session ON page_follow_logs (session_id);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_posts_page_published ON scanned_posts (owner_key, page_key, published_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_page_followers_page ON scanned_page_followers (owner_key, page_key);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_page_followers_session ON scanned_page_followers (first_session_id);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_page_followers_last_session ON scanned_page_followers (last_session_id);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_posts_last_session ON scanned_posts (last_session_id);",
    "CREATE INDEX IF NOT EXISTS idx_account_usage_lookup ON page_scanner_account_usage (account_uid, usage_date);",
    "CREATE INDEX IF NOT EXISTS idx_page_key_aliases_canon ON page_key_aliases (owner_key, canonical_key);",
]

MIGRATION_STATEMENTS = [
    # 1. Cập nhật check constraint cho source_type hỗ trợ 'HASHTAG'
    "ALTER TABLE page_scan_sessions DROP CONSTRAINT IF EXISTS ck_page_scan_session_source;",
    "ALTER TABLE page_scan_sessions ADD CONSTRAINT ck_page_scan_session_source CHECK (source_type IN ('SEARCH', 'PARSE', 'UPLOAD', 'HASHTAG'));",
    # 2. Bổ sung các cột thống kê phiên hashtag
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_posts_scanned INT DEFAULT 0;",
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_posts_matched INT DEFAULT 0;",
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_authors_seen INT DEFAULT 0;",
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_pages_relevant INT DEFAULT 0;",
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_pages_review INT DEFAULT 0;",
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_pages_excluded INT DEFAULT 0;",
    # 3. Bổ sung job_type và mở rộng keyword cho page_scan_sessions (GĐ 4 + GĐ 1)
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS job_type VARCHAR(20) DEFAULT 'DISCOVERY';",
    "ALTER TABLE page_scan_sessions ALTER COLUMN keyword TYPE TEXT;",
    # 4. Bổ sung các cột chấm điểm relevance cho page_scan_session_pages
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS relevance_score INT DEFAULT 0;",
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS relevance_status VARCHAR(20) DEFAULT 'RELEVANT';",
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS hashtag_post_count INT DEFAULT 0;",
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS matched_hashtags TEXT;",
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS evidence_posts TEXT;",
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS latest_post_at VARCHAR(100);",
    # 5. Bổ sung các cột chấm điểm relevance cho kho scanned_pages
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS relevance_score INT DEFAULT 0;",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS relevance_status VARCHAR(20) DEFAULT 'RELEVANT';",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS matched_hashtags TEXT;",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS hashtag_post_count INT DEFAULT 0;",
    # 6. Bổ sung trường liên hệ và quét sâu cho scanned_pages (GĐ 2 + 3)
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS phone TEXT;",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS email VARCHAR(255);",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS website TEXT;",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS address TEXT;",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS description TEXT;",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS detail_status VARCHAR(20) DEFAULT 'NOT_SCANNED';",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS detail_scanned_at TIMESTAMP;",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS detail_session_id INT;",
    # 7. Campaign + log + PAUSED (chỉ dẫn 1.1 / 1.3 / mục 2)
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS campaign_id VARCHAR(64);",
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS logs TEXT;",
    "ALTER TABLE page_scan_sessions DROP CONSTRAINT IF EXISTS ck_page_scan_session_status;",
    "ALTER TABLE page_scan_sessions ADD CONSTRAINT ck_page_scan_session_status CHECK (status IN ('RUNNING', 'PAUSED', 'COMPLETED', 'PARTIAL', 'STOPPED', 'FAILED'));",
    # 8. Bảng người theo dõi Page (khác page_follows)
    """
    CREATE TABLE IF NOT EXISTS scanned_page_followers (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100),
        page_key VARCHAR(255) NOT NULL,
        follower_key VARCHAR(255) NOT NULL,
        follower_name VARCHAR(255),
        profile_url TEXT,
        avatar_url TEXT,
        gender VARCHAR(50),
        location TEXT,
        first_session_id INT,
        last_session_id INT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_page_followers_owner UNIQUE (owner_key, page_key, follower_key)
    );
    """,
    # 9. last_session_id — FE lọc đúng phiên (re-scan cập nhật)
    "ALTER TABLE scanned_page_followers ADD COLUMN IF NOT EXISTS last_session_id INT;",
    "ALTER TABLE scanned_posts ADD COLUMN IF NOT EXISTS last_session_id INT;",
]


# Gọi khi init để dọn phiên RUNNING/PAUSED orphan sau restart
def _mark_stale_on_init():
    try:
        from .browser_session import mark_stale_running_sessions

        n = mark_stale_running_sessions()
        if n:
            logger.warning(f"[Module 11 DB] Marked {n} stale RUNNING/PAUSED session(s)")
    except Exception as exc:
        logger.debug(f"[Module 11 DB] stale session cleanup: {exc}")


def init_models():
    """Khởi tạo schema bảng và chạy migration cho Module 11 trên PostgreSQL hoặc SQLite."""
    # 1. Khởi tạo các bảng chính
    for statement in DDL_STATEMENTS:
        try:
            if getattr(db, "_is_postgres", False):
                clean_statement = statement
            else:
                clean_statement = statement.replace(
                    "SERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT"
                )
                clean_statement = clean_statement.replace(
                    "BOOLEAN NOT NULL DEFAULT FALSE", "INTEGER NOT NULL DEFAULT 0"
                )
                clean_statement = clean_statement.replace(
                    "BOOLEAN NOT NULL DEFAULT TRUE", "INTEGER NOT NULL DEFAULT 1"
                )
                clean_statement = clean_statement.replace(
                    "BOOLEAN DEFAULT NULL", "INTEGER DEFAULT NULL"
                )
            db.execute(clean_statement)
        except Exception as exc:
            logger.warning(f"[Module 11 DB] DDL warning: {exc}")

    # 2. Chạy migration cập nhật/bổ sung cột cho các bảng đã tồn tại
    for mig in MIGRATION_STATEMENTS:
        try:
            db.execute(mig)
        except Exception as exc:
            logger.debug(f"[Module 11 DB] Migration notice: {exc}")

    # 3. Đánh index tăng tốc truy vấn sau khi đảm bảo các cột đã tồn tại
    for idx in INDEX_STATEMENTS:
        try:
            db.execute(idx)
        except Exception as exc:
            logger.debug(f"[Module 11 DB] Index notice: {exc}")

    # 4. Phiên RUNNING orphan sau restart app
    _mark_stale_on_init()

