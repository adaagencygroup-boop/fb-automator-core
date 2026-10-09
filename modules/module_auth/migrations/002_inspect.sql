-- Read-only checks after applying module_auth/migrations/001_schema.sql. No application credentials
-- or record contents (passwords, tokens, contacts) are returned.
SELECT table_name, ordinal_position, column_name, data_type,
       character_maximum_length, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('users', 'user_sessions', 'system_notifications',
                     'admin_activity_logs')
ORDER BY table_name, ordinal_position;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('users', 'user_sessions', 'system_notifications',
                    'admin_activity_logs')
ORDER BY tablename, indexname;

SELECT tc.table_name, tc.constraint_name, kcu.column_name,
       ccu.table_name AS referenced_table, ccu.column_name AS referenced_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_catalog = kcu.constraint_catalog
 AND tc.constraint_schema = kcu.constraint_schema
 AND tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON tc.constraint_catalog = ccu.constraint_catalog
 AND tc.constraint_schema = ccu.constraint_schema
 AND tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('user_sessions', 'system_notifications')
ORDER BY tc.table_name, kcu.column_name;

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('users', 'user_sessions', 'system_notifications',
                    'admin_activity_logs')
ORDER BY tablename;

-- Reveals legacy/new role and status vocabularies that need application mapping.
SELECT role, status, COUNT(*) AS user_count
FROM public.users
GROUP BY role, status
ORDER BY role, status;


