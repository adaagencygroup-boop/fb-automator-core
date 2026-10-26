-- =============================================================================
-- MIGRATION 003: MODULE 11 - PAGE SCANNER EXPANSION (GĐ 2 -> GĐ 5 + LIMITER)
-- Ngày tạo: 23/10/2026
-- Mô tả: Bổ sung trường liên hệ, quét sâu, quan hệ follow theo acc, bảng bài viết,
--        và bảng đếm hạn mức Account Limiter.
-- =============================================================================

-- 1. Nâng cấp bảng page_scan_sessions: thêm job_type, mở rộng keyword
ALTER TABLE page_scan_sessions ADD COLUMN IF NOT EXISTS job_type VARCHAR(20) DEFAULT 'DISCOVERY';
ALTER TABLE page_scan_sessions ALTER COLUMN keyword TYPE TEXT;

-- 2. Nâng cấp bảng scanned_pages: thông tin liên hệ và trạng thái quét sâu (GĐ 2 + 3)
ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS detail_status VARCHAR(20) DEFAULT 'NOT_SCANNED';
ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS detail_scanned_at TIMESTAMP;
ALTER TABLE scanned_pages ADD COLUMN IF NOT EXISTS detail_session_id INT;

-- 3. Tạo bảng page_follows: Lưu quan hệ Follow theo từng tài khoản (GĐ 4)
CREATE TABLE IF NOT EXISTS page_follows (
    id SERIAL PRIMARY KEY,
    owner_key VARCHAR(100),
    page_key VARCHAR(255) NOT NULL,
    account_uid VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'NOT_FOLLOWED',
    followed_at TIMESTAMP,
    last_checked_at TIMESTAMP,
    last_session_id INT,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_page_follows_owner_acc UNIQUE (owner_key, page_key, account_uid),
    CONSTRAINT ck_page_follows_status CHECK (status IN ('FOLLOWING', 'NOT_FOLLOWED', 'FAILED'))
);

-- 4. Tạo bảng page_follow_logs: Nhật ký chi tiết từng lượt follow trong phiên
CREATE TABLE IF NOT EXISTS page_follow_logs (
    id SERIAL PRIMARY KEY,
    session_id INT NOT NULL,
    page_key VARCHAR(255) NOT NULL,
    account_uid VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_session_follow_log UNIQUE (session_id, page_key, account_uid),
    CONSTRAINT ck_page_follow_logs_status CHECK (status IN ('SUCCESS', 'ALREADY_FOLLOWING', 'NOT_FOUND', 'FAILED'))
);

-- 5. Tạo bảng scanned_posts: Lưu trữ bài viết cào được từ Fanpage (GĐ 5)
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
    first_session_id INT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_scanned_posts_owner_post UNIQUE (owner_key, page_key, post_key)
);

-- 6. Tạo bảng page_scanner_account_usage: Account Limiter đếm theo (acc, ngày, hành động)
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

-- 7. Tạo bảng page_key_aliases: Gộp khóa định danh khi nâng cấp từ username sang ID số (GĐ 3)
CREATE TABLE IF NOT EXISTS page_key_aliases (
    id SERIAL PRIMARY KEY,
    owner_key VARCHAR(100),
    alias_key VARCHAR(255) NOT NULL,
    canonical_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_page_key_aliases UNIQUE (owner_key, alias_key)
);

-- 8. Tạo Indexes tăng tốc truy vấn & báo cáo
CREATE INDEX IF NOT EXISTS idx_page_scan_sessions_job ON page_scan_sessions (owner_key, job_type);
CREATE INDEX IF NOT EXISTS idx_scanned_pages_detail_status ON scanned_pages (owner_key, detail_status);
CREATE INDEX IF NOT EXISTS idx_page_follows_acc ON page_follows (owner_key, account_uid, status);
CREATE INDEX IF NOT EXISTS idx_page_follow_logs_session ON page_follow_logs (session_id);
CREATE INDEX IF NOT EXISTS idx_scanned_posts_page_published ON scanned_posts (owner_key, page_key, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_usage_lookup ON page_scanner_account_usage (account_uid, usage_date);
CREATE INDEX IF NOT EXISTS idx_page_key_aliases_canon ON page_key_aliases (owner_key, canonical_key);
