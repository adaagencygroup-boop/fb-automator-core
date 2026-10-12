-- Link each Module 7 result log to the exact Module 2 account.
-- account_uid remains a snapshot so history is still readable after deletion.

BEGIN;

ALTER TABLE public.group_session_logs
    ADD COLUMN IF NOT EXISTS account_id INTEGER;

-- Backfill existing rows by the Module 2 tenant key and Facebook UID.
UPDATE public.group_session_logs AS log
SET account_id = account.id
FROM public.group_sessions AS session,
     public.accounts AS account
WHERE log.session_id = session.id
  AND account.user_id IS NOT DISTINCT FROM session.owner_key
  AND account.uid = log.account_uid
  AND log.account_id IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_group_session_logs_account'
          AND conrelid = 'public.group_session_logs'::regclass
    ) THEN
        ALTER TABLE public.group_session_logs
            ADD CONSTRAINT fk_group_session_logs_account
            FOREIGN KEY (account_id)
            REFERENCES public.accounts(id)
            ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_group_session_logs_account_id
    ON public.group_session_logs (account_id, finished_at);

COMMENT ON COLUMN public.group_session_logs.account_id IS
    'Module 2 accounts.id; nullable after the source account is deleted.';

COMMIT;
