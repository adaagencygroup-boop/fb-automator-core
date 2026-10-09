-- Read-only structural checks after dashboard/migrations/001_schema.sql.
SELECT table_name, ordinal_position, column_name, data_type,
       character_maximum_length, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('fb_accounts', 'created_pages')
ORDER BY table_name, ordinal_position;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('fb_accounts', 'created_pages')
ORDER BY tablename, indexname;

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('fb_accounts', 'created_pages')
ORDER BY tablename;

-- Status distribution only; no account credentials or record contents.
SELECT status, COUNT(*) AS account_count
FROM public.fb_accounts GROUP BY status ORDER BY status;
SELECT status, COUNT(*) AS creation_count
FROM public.created_pages GROUP BY status ORDER BY status;

