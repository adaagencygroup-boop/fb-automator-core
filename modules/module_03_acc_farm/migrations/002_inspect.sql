-- Kiểm tra chỉ đọc sau khi chạy module_03_acc_farm/migrations/001_tab1_farm_schema.sql.
SELECT table_name, ordinal_position, column_name, data_type,
       character_maximum_length, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('farm_runs', 'farm_run_history', 'farm_interaction_logs',
                     'farm_browser_fingerprints', 'farm_settings')
ORDER BY table_name, ordinal_position;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('farm_runs', 'farm_run_history', 'farm_interaction_logs',
                    'farm_browser_fingerprints', 'farm_settings')
ORDER BY tablename, indexname;

SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
       ccu.table_name AS references_table, rc.delete_rule
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.referential_constraints rc
  ON rc.constraint_schema = tc.constraint_schema AND rc.constraint_name = tc.constraint_name
LEFT JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_type = 'FOREIGN KEY'
 AND ccu.constraint_schema = tc.constraint_schema AND ccu.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('farm_runs', 'farm_run_history', 'farm_interaction_logs',
                        'farm_browser_fingerprints', 'farm_settings')
  AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('farm_runs', 'farm_run_history', 'farm_interaction_logs',
                    'farm_browser_fingerprints', 'farm_settings')
ORDER BY tablename;

-- Chỉ đếm theo trạng thái; không đọc nội dung lỗi, cookie hay thông tin nick.
SELECT status, COUNT(*) AS run_count
FROM public.farm_runs GROUP BY status ORDER BY status;
SELECT final_status, COUNT(*) AS history_count
FROM public.farm_run_history GROUP BY final_status ORDER BY final_status;
