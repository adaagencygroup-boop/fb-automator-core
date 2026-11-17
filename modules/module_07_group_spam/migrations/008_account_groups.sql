-- Module 7 per-account Facebook group membership history.

BEGIN;

CREATE TABLE IF NOT EXISTS public.module7_account_groups (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_key VARCHAR(100) NOT NULL,
    account_uid VARCHAR(50) NOT NULL,
    group_key VARCHAR(255) NOT NULL,
    group_name VARCHAR(255),
    group_url TEXT NOT NULL,
    status VARCHAR(30) NOT NULL,
    search_keyword TEXT,
    campaign_id VARCHAR(36),
    requested_at TIMESTAMP WITHOUT TIME ZONE,
    joined_at TIMESTAMP WITHOUT TIME ZONE,
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),

    CONSTRAINT uq_module7_account_groups_owner_account_group
        UNIQUE (owner_key, account_uid, group_key),
    CONSTRAINT ck_module7_account_groups_status
        CHECK (status IN ('JOINED', 'PENDING_APPROVAL', 'LEFT', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_module7_account_groups_account_status
    ON public.module7_account_groups (owner_key, account_uid, status);
CREATE INDEX IF NOT EXISTS idx_module7_account_groups_group
    ON public.module7_account_groups (owner_key, group_key);

ALTER TABLE public.module7_account_groups ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.module7_account_groups IS
    'Module 7 Facebook group membership state per account, including the search keyword when available.';

COMMIT;
