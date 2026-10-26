-- Module 7 cloud-first runtime logging.
-- Progress events and final task outcomes are written directly to PostgreSQL.

BEGIN;

ALTER TABLE public.cloud_group_runs
    DROP CONSTRAINT IF EXISTS ck_cloud_group_runs_status;

ALTER TABLE public.cloud_group_runs
    ADD CONSTRAINT ck_cloud_group_runs_status
    CHECK (status IN (
        'QUEUED', 'SCHEDULED', 'RUNNING', 'STOPPING',
        'COMPLETED', 'PARTIAL', 'STOPPED', 'CANCELLED', 'FAILED'
    ));

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

CREATE INDEX IF NOT EXISTS idx_cloud_group_events_run_sequence
    ON public.cloud_group_events (run_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_cloud_group_events_owner_created
    ON public.cloud_group_events (owner_key, created_at);

ALTER TABLE public.cloud_group_events ENABLE ROW LEVEL SECURITY;

COMMIT;
