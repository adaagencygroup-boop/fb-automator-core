-- ============================================================================
-- SCRIPT KIỂM TRA CHỈ ĐỌC: TAB 2 PHÂN HỆ ĐĂNG BÀI (MODULE 03)
-- Đối chiếu cấu hình cột, index, ràng buộc khóa, RLS trên PostgreSQL / Supabase
-- ============================================================================

-- 1. Kiểm tra danh sách bảng và cột
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('post_settings', 'account_folder_mappings', 'post_sessions', 'posts', 'post_interaction_logs')
ORDER BY table_name, ordinal_position;

-- 2. Kiểm tra chỉ mục (Indexes)
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('post_settings', 'account_folder_mappings', 'post_sessions', 'posts', 'post_interaction_logs')
ORDER BY tablename, indexname;

-- 3. Kiểm tra ràng buộc khóa chính, khóa ngoại, unique
SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
       ccu.table_name AS references_table, rc.delete_rule
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.referential_constraints rc
  ON rc.constraint_schema = tc.constraint_schema AND rc.constraint_name = tc.constraint_name
LEFT JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_type = 'FOREIGN KEY'
 AND ccu.constraint_schema = tc.constraint_schema AND ccu.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('post_settings', 'account_folder_mappings', 'post_sessions', 'posts', 'post_interaction_logs')
  AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- 4. Kiểm tra Row Level Security (RLS)
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('post_settings', 'account_folder_mappings', 'post_sessions', 'posts', 'post_interaction_logs')
ORDER BY tablename;

-- 5. Thống kê số lượng bản ghi theo trạng thái
SELECT post_type, COUNT(*) AS settings_count FROM post_settings GROUP BY post_type;
SELECT status, COUNT(*) AS session_count FROM post_sessions GROUP BY status ORDER BY status;
SELECT post_type, status, COUNT(*) AS post_count FROM posts GROUP BY post_type, status ORDER BY post_type, status;
SELECT status, COUNT(*) AS log_count FROM post_interaction_logs GROUP BY status ORDER BY status;
