"""
=============================================================================
MODULE 11: FACEBOOK PAGE SCANNER - DATABASE MODELS & DDL SCHEMA
=============================================================================
"""
import logging
from typing import Any, Dict, List, Optional
from core.database.connection import db

logger = logging.getLogger(__name__)

DDL_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS page_scan_sessions (
        id SERIAL PRIMARY KEY,
        owner_key VARCHAR(100),
        keyword VARCHAR(255),
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
        settings TEXT,
        error_message TEXT,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT ck_page_scan_session_source CHECK (
            source_type IN ('SEARCH', 'PARSE', 'UPLOAD', 'HASHTAG')
        ),
        CONSTRAINT ck_page_scan_session_status CHECK (
            status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'STOPPED', 'FAILED')
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
        first_found_by_account_uid VARCHAR(50),
        first_source_type VARCHAR(20),
        first_session_id INT REFERENCES page_scan_sessions(id) ON DELETE SET NULL,
        raw_data TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_scanned_pages_owner_page_key UNIQUE (owner_key, page_key)
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
    "CREATE INDEX IF NOT EXISTS idx_page_scan_sessions_owner ON page_scan_sessions (owner_key, created_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_page_scan_sessions_status ON page_scan_sessions (owner_key, status);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_pages_owner_key ON scanned_pages (owner_key, page_key);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_pages_follower ON scanned_pages (owner_key, follower_count);",
    "CREATE INDEX IF NOT EXISTS idx_scanned_pages_relevance ON scanned_pages (owner_key, relevance_score DESC);",
    "CREATE INDEX IF NOT EXISTS idx_page_scan_session_pages_lookup ON page_scan_session_pages (session_id, page_key);",
    "CREATE INDEX IF NOT EXISTS idx_page_scan_session_pages_rel ON page_scan_session_pages (session_id, relevance_status);",
]

MIGRATION_STATEMENTS = [
    # Cập nhật check constraint cho source_type hỗ trợ 'HASHTAG'
    "ALTER TABLE page_scan_sessions DROP CONSTRAINT IF EXISTS ck_page_scan_session_source;",
    "ALTER TABLE page_scan_sessions ADD CONSTRAINT ck_page_scan_session_source CHECK (source_type IN ('SEARCH', 'PARSE', 'UPLOAD', 'HASHTAG'));",
    # Bổ sung các cột thống kê phiên hashtag
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_posts_scanned INT DEFAULT 0;",
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_posts_matched INT DEFAULT 0;",
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_authors_seen INT DEFAULT 0;",
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_pages_relevant INT DEFAULT 0;",
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_pages_review INT DEFAULT 0;",
    "ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS total_pages_excluded INT DEFAULT 0;",
    # Bổ sung các cột chấm điểm relevance cho page_scan_session_pages
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS relevance_score INT DEFAULT 0;",
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS relevance_status VARCHAR(20) DEFAULT 'RELEVANT';",
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS hashtag_post_count INT DEFAULT 0;",
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS matched_hashtags TEXT;",
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS evidence_posts TEXT;",
    "ALTER TABLE page_scan_session_pages ADD COLUMN IF NOT EXISTS latest_post_at VARCHAR(100);",
    # Bổ sung các cột chấm điểm relevance cho kho scanned_pages
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS relevance_score INT DEFAULT 0;",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS relevance_status VARCHAR(20) DEFAULT 'RELEVANT';",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS matched_hashtags TEXT;",
    "ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS hashtag_post_count INT DEFAULT 0;",
]


def init_models():
    """Khởi tạo schema bảng và chạy migration cho Module 11 trên PostgreSQL hoặc SQLite."""
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

    # Chạy các migration bổ sung cột nếu bảng đã tồn tại từ trước
    for mig in MIGRATION_STATEMENTS:
        try:
            db.execute(mig)
        except Exception as exc:
            logger.debug(f"[Module 11 DB] Migration notice: {exc}")
