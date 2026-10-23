-- Correct the initial v2 deployment: runtime tables belong to the device only.
-- Refuse cleanup if runtime rows exist so this migration cannot discard data.

BEGIN;

DROP TABLE IF EXISTS public.group_session_logs;
DROP TABLE IF EXISTS public.group_sessions;

DO $$
DECLARE
    runtime_rows BIGINT := 0;
    campaign_id_type TEXT;
BEGIN
    SELECT data_type
    INTO campaign_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'group_campaigns'
      AND column_name = 'id';

    IF campaign_id_type IN ('character varying', 'text') THEN
        SELECT
            (SELECT COUNT(*) FROM public.group_campaigns)
            + (SELECT COUNT(*) FROM public.group_runs)
            + (SELECT COUNT(*) FROM public.group_run_tasks)
            + (SELECT COUNT(*) FROM public.group_sync_outbox)
        INTO runtime_rows;

        IF runtime_rows > 0 THEN
            RAISE EXCEPTION USING MESSAGE =
                'Cloud cleanup refused: '
                || runtime_rows
                || ' Module 7 local-runtime rows still exist';
        END IF;

        DROP TABLE public.group_run_tasks;
        DROP TABLE public.group_runs;
        DROP TABLE public.group_sync_outbox;
        DROP TABLE public.group_campaigns;
    END IF;

    IF to_regclass('public.group_campaigns_legacy_v1') IS NOT NULL THEN
        SELECT COUNT(*) FROM public.group_campaigns_legacy_v1 INTO runtime_rows;
        IF runtime_rows > 0 THEN
            RAISE EXCEPTION USING MESSAGE =
                'Cloud cleanup refused: '
                || runtime_rows
                || ' legacy group_campaigns rows still exist';
        END IF;
        DROP TABLE public.group_campaigns_legacy_v1;
    END IF;

    IF to_regclass('public.group_campaigns') IS NOT NULL THEN
        SELECT data_type
        INTO campaign_id_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'group_campaigns'
          AND column_name = 'id';

        IF campaign_id_type NOT IN ('character varying', 'text') THEN
            SELECT COUNT(*) FROM public.group_campaigns INTO runtime_rows;
            IF runtime_rows > 0 THEN
                RAISE EXCEPTION USING MESSAGE =
                    'Cloud cleanup refused: '
                    || runtime_rows
                    || ' legacy group_campaigns rows still exist';
            END IF;
            DROP TABLE public.group_campaigns;
        END IF;
    END IF;
END
$$;

COMMIT;
