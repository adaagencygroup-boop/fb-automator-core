-- Module 7 PostgreSQL-only campaign storage.
-- Adds cloud campaign metadata and rerun configuration for existing installs.

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

INSERT INTO public.cloud_group_campaigns
    (campaign_id, owner_key, name, action_type, created_at, updated_at)
SELECT DISTINCT ON (campaign_id)
    campaign_id,
    owner_key,
    campaign_name,
    action_type,
    COALESCE(started_at, finished_at, synced_at),
    synced_at
FROM public.cloud_group_runs
ORDER BY campaign_id, synced_at DESC
ON CONFLICT (campaign_id) DO NOTHING;

ALTER TABLE public.cloud_group_runs
    ADD COLUMN IF NOT EXISTS run_number INTEGER,
    ADD COLUMN IF NOT EXISTS config_json JSONB;

WITH numbered AS (
    SELECT
        run_id,
        ROW_NUMBER() OVER (
            PARTITION BY campaign_id
            ORDER BY COALESCE(started_at, finished_at, synced_at), run_id
        ) AS calculated_number
    FROM public.cloud_group_runs
)
UPDATE public.cloud_group_runs AS runs
SET run_number = numbered.calculated_number
FROM numbered
WHERE runs.run_id = numbered.run_id
  AND runs.run_number IS NULL;

UPDATE public.cloud_group_runs
SET config_json = '{}'::jsonb
WHERE config_json IS NULL;

ALTER TABLE public.cloud_group_runs
    ALTER COLUMN run_number SET DEFAULT 1,
    ALTER COLUMN run_number SET NOT NULL,
    ALTER COLUMN config_json SET DEFAULT '{}'::jsonb,
    ALTER COLUMN config_json SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_cloud_group_runs_campaign_number'
          AND conrelid = 'public.cloud_group_runs'::regclass
    ) THEN
        ALTER TABLE public.cloud_group_runs
            ADD CONSTRAINT uq_cloud_group_runs_campaign_number
            UNIQUE (campaign_id, run_number);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_cloud_group_runs_number'
          AND conrelid = 'public.cloud_group_runs'::regclass
    ) THEN
        ALTER TABLE public.cloud_group_runs
            ADD CONSTRAINT ck_cloud_group_runs_number CHECK (run_number >= 1);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_cloud_group_runs_campaign'
          AND conrelid = 'public.cloud_group_runs'::regclass
    ) THEN
        ALTER TABLE public.cloud_group_runs
            ADD CONSTRAINT fk_cloud_group_runs_campaign
            FOREIGN KEY (campaign_id)
            REFERENCES public.cloud_group_campaigns(campaign_id)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cloud_group_campaigns_owner_created
    ON public.cloud_group_campaigns (owner_key, created_at);
CREATE INDEX IF NOT EXISTS idx_cloud_group_campaigns_owner_type
    ON public.cloud_group_campaigns (owner_key, action_type, deleted_at);
CREATE INDEX IF NOT EXISTS idx_cloud_group_campaigns_owner_name
    ON public.cloud_group_campaigns (owner_key, name);

ALTER TABLE public.cloud_group_campaigns ENABLE ROW LEVEL SECURITY;

COMMIT;
