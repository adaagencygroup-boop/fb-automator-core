-- Progress logs are transient and remain in CampaignJob RAM only.

BEGIN;

DROP TABLE IF EXISTS public.cloud_group_events;

COMMIT;
