-- Module 7: Drop soft-delete column (deleted_at) and restrict run status to COMPLETED/FAILED.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cloud_group_campaigns'
          AND column_name = 'deleted_at'
    ) THEN
        DELETE FROM public.cloud_group_campaigns
        WHERE deleted_at IS NOT NULL;
    END IF;
END $$;

DROP INDEX IF EXISTS public.idx_cloud_group_campaigns_owner_type;

ALTER TABLE public.cloud_group_campaigns
    DROP COLUMN IF EXISTS deleted_at;

CREATE INDEX IF NOT EXISTS idx_cloud_group_campaigns_owner_type
    ON public.cloud_group_campaigns (owner_key, action_type);

UPDATE public.cloud_group_runs
SET status = 'FAILED'
WHERE status IS NULL OR status NOT IN ('COMPLETED', 'FAILED');

ALTER TABLE public.cloud_group_runs
    DROP CONSTRAINT IF EXISTS ck_cloud_group_runs_status;

ALTER TABLE public.cloud_group_runs
    ADD CONSTRAINT ck_cloud_group_runs_status
    CHECK (status IN ('COMPLETED', 'FAILED'));

COMMIT;
