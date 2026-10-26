-- Module 7 cloud-first runtime logging.
-- Run state and final task outcomes are written directly to PostgreSQL.

BEGIN;

ALTER TABLE public.cloud_group_runs
    DROP CONSTRAINT IF EXISTS ck_cloud_group_runs_status;

ALTER TABLE public.cloud_group_runs
    ADD CONSTRAINT ck_cloud_group_runs_status
    CHECK (status IN (
        'QUEUED', 'SCHEDULED', 'RUNNING', 'STOPPING',
        'COMPLETED', 'PARTIAL', 'STOPPED', 'CANCELLED', 'FAILED'
    ));

COMMIT;
