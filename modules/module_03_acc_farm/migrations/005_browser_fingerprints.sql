-- Bảng dùng chung của core/browser: dấu vân tay trình duyệt cố định theo nick (mọi module, mọi máy).
-- Chạy tay trong SQL Editor của Supabase sau 001. Chỉ dùng cho PostgreSQL.
-- Bảng phải giống SHARED_DDL_STATEMENTS trong modules/module_03_acc_farm/models.py
-- (engine vẫn tự tạo bảng qua init_models(); tests/test_migration_sync.py kiểm tra 2 bản khớp nhau).
-- Thời gian lưu TIMESTAMP theo giờ UTC, code luôn tự truyền giá trị.
BEGIN;

CREATE TABLE IF NOT EXISTS public.browser_fingerprints (
    uid VARCHAR(50) PRIMARY KEY,
    mode VARCHAR(10) NOT NULL,
    canvas_seed INT,
    created_at TIMESTAMP NOT NULL
);

-- Chép seed từ bảng cũ của Tab 1 để nick đã chạy giữ nguyên dấu vân tay; dòng đã có thì bỏ qua.
INSERT INTO public.browser_fingerprints (uid, mode, canvas_seed, created_at)
SELECT uid, mode, canvas_seed, created_at FROM public.farm_browser_fingerprints
ON CONFLICT (uid) DO NOTHING;

-- Chỉ engine (backend) truy cập; không tạo policy cho trình duyệt.
ALTER TABLE public.browser_fingerprints ENABLE ROW LEVEL SECURITY;

COMMIT;
