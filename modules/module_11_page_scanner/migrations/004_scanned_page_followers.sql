-- Module 11 GĐ followers scan: danh sách người theo dõi Fanpage (khác page_follows = acc follow Page)
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
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_scanned_page_followers_owner UNIQUE (owner_key, page_key, follower_key)
);

CREATE INDEX IF NOT EXISTS idx_scanned_page_followers_page
    ON scanned_page_followers (owner_key, page_key);

CREATE INDEX IF NOT EXISTS idx_scanned_page_followers_session
    ON scanned_page_followers (first_session_id);
