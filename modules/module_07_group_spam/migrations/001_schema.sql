-- Module 7: Facebook Group Post/Comment history
-- PostgreSQL / Supabase migration.
--
-- This migration intentionally does not drop legacy tables. Any cleanup of
-- group_campaigns, groups, or other historical tables should be reviewed and
-- executed separately.

BEGIN;

CREATE TABLE IF NOT EXISTS public.group_sessions (
    id SERIAL PRIMARY KEY,
    owner_key VARCHAR(100),
    action_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    total_planned INTEGER NOT NULL DEFAULT 0,
    total_success INTEGER NOT NULL DEFAULT 0,
    total_pending_approval INTEGER NOT NULL DEFAULT 0,
    total_failed INTEGER NOT NULL DEFAULT 0,
    total_skipped INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP WITHOUT TIME ZONE,
    finished_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),

    CONSTRAINT ck_group_session_action_type
        CHECK (action_type IN ('POST', 'COMMENT')),
    CONSTRAINT ck_group_session_final_status
        CHECK (status IN ('COMPLETED', 'PARTIAL', 'STOPPED', 'CANCELLED', 'FAILED')),
    CONSTRAINT ck_group_session_totals
        CHECK (
            total_planned >= 0
            AND total_success >= 0
            AND total_pending_approval >= 0
            AND total_failed >= 0
            AND total_skipped >= 0
            AND total_success
                + total_pending_approval
                + total_failed
                + total_skipped
                <= total_planned
        )
);

CREATE TABLE IF NOT EXISTS public.group_session_logs (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL
        REFERENCES public.group_sessions(id) ON DELETE CASCADE,
    account_uid VARCHAR(50) NOT NULL,
    group_key VARCHAR(255) NOT NULL,
    group_url TEXT NOT NULL,
    group_name VARCHAR(255),
    member_count INTEGER,
    monthly_post_count INTEGER,
    monthly_post_count_is_lower_bound BOOLEAN NOT NULL DEFAULT FALSE,
    round_index INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(30) NOT NULL,
    result_message VARCHAR(255),
    error_code VARCHAR(100),
    error_detail TEXT,
    facebook_post_id VARCHAR(100),
    facebook_post_url TEXT,
    finished_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),

    CONSTRAINT uq_group_session_log_result
        UNIQUE (session_id, account_uid, group_key),
    CONSTRAINT ck_group_session_log_counts
        CHECK (
            (member_count IS NULL OR member_count >= 0)
            AND (monthly_post_count IS NULL OR monthly_post_count >= 0)
        ),
    CONSTRAINT ck_group_session_log_lower_bound
        CHECK (
            monthly_post_count IS NOT NULL
            OR monthly_post_count_is_lower_bound = FALSE
        ),
    CONSTRAINT ck_group_session_log_round
        CHECK (round_index >= 1),
    CONSTRAINT ck_group_session_log_final_status
        CHECK (
            status IN (
                'SUCCESS',
                'PENDING_APPROVAL',
                'FAILED',
                'SKIPPED',
                'CANCELLED'
            )
        )
);

CREATE INDEX IF NOT EXISTS idx_group_sessions_history
    ON public.group_sessions (owner_key, finished_at);

CREATE INDEX IF NOT EXISTS idx_group_sessions_status
    ON public.group_sessions (owner_key, status, finished_at);

CREATE INDEX IF NOT EXISTS idx_group_session_logs_status
    ON public.group_session_logs (session_id, status, finished_at);

CREATE INDEX IF NOT EXISTS idx_group_session_logs_account
    ON public.group_session_logs (account_uid, finished_at);

CREATE INDEX IF NOT EXISTS idx_group_session_logs_group
    ON public.group_session_logs (group_key, finished_at);

-- Module 7 writes through the trusted backend. No browser-facing RLS policies
-- are created here; service-role/direct database connections remain usable.
ALTER TABLE public.group_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_session_logs ENABLE ROW LEVEL SECURITY;

COMMIT;
