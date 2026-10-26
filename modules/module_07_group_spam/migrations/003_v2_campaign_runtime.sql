-- Module 7 v2 cloud schema.
-- PostgreSQL / Supabase stores live run summaries, progress events and task outcomes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cloud_group_campaigns (
    campaign_id VARCHAR(36) PRIMARY KEY,
    owner_key VARCHAR(100) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    action_type VARCHAR(20) NOT NULL,
    deleted_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),

    CONSTRAINT ck_cloud_group_campaigns_action_type
        CHECK (action_type IN ('POST', 'COMMENT'))
);

CREATE TABLE IF NOT EXISTS public.cloud_group_runs (
    run_id VARCHAR(36) PRIMARY KEY,
    campaign_id VARCHAR(36) NOT NULL,
    run_number INTEGER NOT NULL DEFAULT 1,
    owner_key VARCHAR(100) NOT NULL,
    campaign_name VARCHAR(200) NOT NULL,
    action_type VARCHAR(20) NOT NULL,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL,
    total_planned INTEGER NOT NULL DEFAULT 0,
    total_success INTEGER NOT NULL DEFAULT 0,
    total_failed INTEGER NOT NULL DEFAULT 0,
    total_skipped INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP WITHOUT TIME ZONE,
    finished_at TIMESTAMP WITHOUT TIME ZONE,
    synced_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),

    CONSTRAINT ck_cloud_group_runs_action_type
        CHECK (action_type IN ('POST', 'COMMENT')),
    CONSTRAINT fk_cloud_group_runs_campaign
        FOREIGN KEY (campaign_id)
        REFERENCES public.cloud_group_campaigns(campaign_id) ON DELETE CASCADE,
    CONSTRAINT uq_cloud_group_runs_campaign_number
        UNIQUE (campaign_id, run_number),
    CONSTRAINT ck_cloud_group_runs_number CHECK (run_number >= 1),
    CONSTRAINT ck_cloud_group_runs_status
        CHECK (status IN (
            'QUEUED', 'SCHEDULED', 'RUNNING', 'STOPPING',
            'COMPLETED', 'PARTIAL', 'STOPPED', 'CANCELLED', 'FAILED'
        )),
    CONSTRAINT ck_cloud_group_runs_totals
        CHECK (
            total_planned >= 0
            AND total_success >= 0
            AND total_failed >= 0
            AND total_skipped >= 0
            AND total_success + total_failed + total_skipped <= total_planned
        )
);

CREATE TABLE IF NOT EXISTS public.cloud_group_logs (
    log_id VARCHAR(36) PRIMARY KEY,
    run_id VARCHAR(36) NOT NULL
        REFERENCES public.cloud_group_runs(run_id) ON DELETE CASCADE,
    owner_key VARCHAR(100) NOT NULL,
    action_type VARCHAR(20) NOT NULL,
    account_uid VARCHAR(50) NOT NULL,
    account_name VARCHAR(150),
    group_key VARCHAR(255) NOT NULL,
    group_name VARCHAR(255),
    group_url TEXT NOT NULL,
    content TEXT,
    status VARCHAR(30) NOT NULL,
    result_message TEXT,
    error_code VARCHAR(100),
    error_detail TEXT,
    result_url TEXT,
    finished_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    synced_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),

    CONSTRAINT ck_cloud_group_logs_action_type
        CHECK (action_type IN ('POST', 'COMMENT')),
    CONSTRAINT ck_cloud_group_logs_status
        CHECK (status IN ('SUCCESS', 'PENDING_APPROVAL', 'FAILED', 'SKIPPED', 'CANCELLED'))
);

CREATE TABLE IF NOT EXISTS public.cloud_group_events (
    event_id VARCHAR(36) PRIMARY KEY,
    run_id VARCHAR(36) NOT NULL
        REFERENCES public.cloud_group_runs(run_id) ON DELETE CASCADE,
    owner_key VARCHAR(100) NOT NULL,
    sequence_number INTEGER NOT NULL,
    level VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    synced_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
        DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),

    CONSTRAINT uq_cloud_group_events_sequence UNIQUE (run_id, sequence_number),
    CONSTRAINT ck_cloud_group_events_sequence CHECK (sequence_number >= 1),
    CONSTRAINT ck_cloud_group_events_level
        CHECK (level IN ('INFO', 'SUCCESS', 'WARNING', 'ERROR'))
);

CREATE INDEX IF NOT EXISTS idx_cloud_group_runs_history
    ON public.cloud_group_runs (owner_key, finished_at);
CREATE INDEX IF NOT EXISTS idx_cloud_group_runs_status
    ON public.cloud_group_runs (owner_key, status, finished_at);
CREATE INDEX IF NOT EXISTS idx_cloud_group_runs_type
    ON public.cloud_group_runs (owner_key, action_type, finished_at);

CREATE INDEX IF NOT EXISTS idx_cloud_group_logs_run_status
    ON public.cloud_group_logs (run_id, status);
CREATE INDEX IF NOT EXISTS idx_cloud_group_logs_history
    ON public.cloud_group_logs (owner_key, finished_at);
CREATE INDEX IF NOT EXISTS idx_cloud_group_logs_account
    ON public.cloud_group_logs (owner_key, account_uid, finished_at);
CREATE INDEX IF NOT EXISTS idx_cloud_group_logs_group
    ON public.cloud_group_logs (owner_key, group_key, finished_at);
CREATE INDEX IF NOT EXISTS idx_cloud_group_events_run_sequence
    ON public.cloud_group_events (run_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_cloud_group_events_owner_created
    ON public.cloud_group_events (owner_key, created_at);
CREATE INDEX IF NOT EXISTS idx_cloud_group_campaigns_owner_created
    ON public.cloud_group_campaigns (owner_key, created_at);
CREATE INDEX IF NOT EXISTS idx_cloud_group_campaigns_owner_type
    ON public.cloud_group_campaigns (owner_key, action_type, deleted_at);
CREATE INDEX IF NOT EXISTS idx_cloud_group_campaigns_owner_name
    ON public.cloud_group_campaigns (owner_key, name);

COMMENT ON TABLE public.cloud_group_campaigns IS
    'Module 7 campaign metadata and soft-delete state stored in PostgreSQL.';
COMMENT ON TABLE public.cloud_group_runs IS
    'Module 7 cloud run summaries; upsert by run_id.';
COMMENT ON TABLE public.cloud_group_logs IS
    'Module 7 cloud final task outcomes; upsert by log_id.';
COMMENT ON TABLE public.cloud_group_events IS
    'Module 7 cloud progress events written directly while a run is active.';

ALTER TABLE public.cloud_group_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_group_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_group_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_group_campaigns ENABLE ROW LEVEL SECURITY;

COMMIT;
