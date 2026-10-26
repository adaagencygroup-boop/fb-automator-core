-- Module 10: Quét thông tin nhóm — lưu nhóm đã quét (Supabase / PostgreSQL)
-- Chạy tự động qua init_models() khi Engine start; file này để tham chiếu / migrate tay.

BEGIN;

CREATE TABLE IF NOT EXISTS public.scanned_groups (
    id SERIAL PRIMARY KEY,
    owner_username VARCHAR(100) NOT NULL,
    group_id VARCHAR(255) NOT NULL,
    group_url TEXT NOT NULL,
    group_name VARCHAR(500),
    privacy VARCHAR(20) NOT NULL DEFAULT 'unknown',
    members_label VARCHAR(80),
    members_count INTEGER,
    keyword VARCHAR(255) NOT NULL,
    source_uid VARCHAR(50),
    first_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    last_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    CONSTRAINT uq_scanned_groups_owner_group
        UNIQUE (owner_username, group_id),
    CONSTRAINT ck_scanned_groups_members
        CHECK (members_count IS NULL OR members_count >= 0)
);

-- Liên kết từ khóa ↔ nhóm (một nhóm có thể gắn nhiều từ khóa)
CREATE TABLE IF NOT EXISTS public.scanned_group_keywords (
    id SERIAL PRIMARY KEY,
    owner_username VARCHAR(100) NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    group_id VARCHAR(255) NOT NULL,
    found_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    CONSTRAINT uq_scanned_group_keywords
        UNIQUE (owner_username, keyword, group_id)
);

CREATE INDEX IF NOT EXISTS idx_scanned_groups_owner
    ON public.scanned_groups (owner_username, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_scanned_groups_keyword
    ON public.scanned_groups (owner_username, keyword);

CREATE INDEX IF NOT EXISTS idx_scanned_group_keywords_owner_kw
    ON public.scanned_group_keywords (owner_username, keyword);

ALTER TABLE public.scanned_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scanned_group_keywords ENABLE ROW LEVEL SECURITY;

COMMIT;
