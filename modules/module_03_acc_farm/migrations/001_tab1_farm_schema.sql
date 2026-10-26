-- Module 03 - Tab 1 (Tương tác tài khoản / nuôi nick): 6 bảng farm_*.
-- Chạy tay trong SQL Editor của Supabase. Chỉ dùng cho PostgreSQL.
-- Bảng/cột/index phải giống DDL_STATEMENTS trong modules/module_03_acc_farm/models.py
-- (engine vẫn tự tạo bảng qua init_models(); tests/test_migration_sync.py kiểm tra 2 bản khớp nhau).
-- Thời gian lưu TIMESTAMP theo giờ UTC, code luôn tự truyền giá trị.
BEGIN;

-- 1. Lượt đang chạy (bảng làm việc: trạng thái, hoạt động hiện tại)
CREATE TABLE IF NOT EXISTS public.farm_runs (
    id SERIAL PRIMARY KEY,
    machine_id VARCHAR(64) NOT NULL,
    owner_username VARCHAR(100),
    fb_uid VARCHAR(50) NOT NULL,
    fb_name VARCHAR(150),
    session_id VARCHAR(32),
    status VARCHAR(20) NOT NULL,
    current_activity VARCHAR(255),
    error TEXT,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_farm_runs_machine_started ON public.farm_runs (machine_id, started_at);
CREATE INDEX IF NOT EXISTS ix_farm_runs_machine_status ON public.farm_runs (machine_id, status);
CREATE INDEX IF NOT EXISTS ix_farm_runs_session ON public.farm_runs (session_id);

-- 2. Lịch sử: 1 dòng / lượt đã kết thúc, ghi xong không sửa
CREATE TABLE IF NOT EXISTS public.farm_run_history (
    id SERIAL PRIMARY KEY,
    run_id INT UNIQUE REFERENCES public.farm_runs(id) ON DELETE SET NULL,
    machine_id VARCHAR(64) NOT NULL,
    owner_username VARCHAR(100),
    session_id VARCHAR(32),
    fb_uid VARCHAR(50) NOT NULL,
    fb_name VARCHAR(150),
    proxy_host VARCHAR(100),
    proxy_mode VARCHAR(20),
    egress_ip VARCHAR(64),
    fingerprint_mode VARCHAR(10),
    final_status VARCHAR(20) NOT NULL,
    error TEXT,
    light_checkpoint BOOLEAN DEFAULT FALSE,
    cookie_saved BOOLEAN DEFAULT FALSE,
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP NOT NULL,
    duration_seconds INT NOT NULL,
    newsfeed_seconds INT DEFAULT 0,
    newsfeed_scrolls INT DEFAULT 0,
    watch_seconds INT DEFAULT 0,
    watch_videos INT DEFAULT 0,
    newsfeed_reactions INT DEFAULT 0,
    watch_reactions INT DEFAULT 0,
    story_frames INT DEFAULT 0,
    story_seconds INT DEFAULT 0,
    story_reactions INT DEFAULT 0,
    friends_sent INT DEFAULT 0,
    friends_source VARCHAR(20),
    groups_joined INT DEFAULT 0,
    groups_source VARCHAR(20),
    groups_keyword TEXT,
    groups_left INT DEFAULT 0,
    notif_checked BOOLEAN DEFAULT FALSE,
    notif_opened BOOLEAN DEFAULT FALSE,
    actions_success INT DEFAULT 0,
    actions_failed INT DEFAULT 0,
    actions_blocked INT DEFAULT 0,
    actions_skipped INT DEFAULT 0,
    actions_summary TEXT,
    config_snapshot TEXT,
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_farm_hist_machine_finished ON public.farm_run_history (machine_id, finished_at);
CREATE INDEX IF NOT EXISTS ix_farm_hist_uid_finished ON public.farm_run_history (fb_uid, finished_at);
CREATE INDEX IF NOT EXISTS ix_farm_hist_machine_status ON public.farm_run_history (machine_id, final_status);
CREATE INDEX IF NOT EXISTS ix_farm_hist_session ON public.farm_run_history (session_id);

-- 3. Chi tiết từng hành động trong 1 lượt (dùng tính giới hạn ngày)
CREATE TABLE IF NOT EXISTS public.farm_interaction_logs (
    id SERIAL PRIMARY KEY,
    run_id INT REFERENCES public.farm_runs(id) ON DELETE CASCADE,
    machine_id VARCHAR(64) NOT NULL,
    owner_username VARCHAR(100),
    fb_uid VARCHAR(50) NOT NULL,
    action_type VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL,
    quantity INT DEFAULT 0,
    details TEXT,
    targets TEXT,
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_farm_logs_uid_action_created ON public.farm_interaction_logs (fb_uid, action_type, created_at);
CREATE INDEX IF NOT EXISTS ix_farm_logs_run ON public.farm_interaction_logs (run_id);

-- 4. Dấu vân tay trình duyệt cố định theo nick (dùng chung mọi máy)
CREATE TABLE IF NOT EXISTS public.farm_browser_fingerprints (
    uid VARCHAR(50) PRIMARY KEY,
    mode VARCHAR(10) NOT NULL,
    canvas_seed INT,
    created_at TIMESTAMP NOT NULL
);

-- 5. Cấu hình theo máy (giới hạn kết bạn / nhóm mỗi ngày...)
CREATE TABLE IF NOT EXISTS public.farm_settings (
    machine_id VARCHAR(64) NOT NULL,
    key VARCHAR(50) NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    PRIMARY KEY (machine_id, key)
);

-- 6. Chủ của nhóm / người trong dàn nick (chia đích), xem migrations/010_farm_target_owners.sql
CREATE TABLE IF NOT EXISTS public.farm_target_owners (
    id SERIAL PRIMARY KEY,
    scope VARCHAR(120) NOT NULL,
    kind VARCHAR(10) NOT NULL,
    target_key VARCHAR(255) NOT NULL,
    fb_uid VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    name VARCHAR(150),
    url VARCHAR(500),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    UNIQUE (scope, target_key)
);

-- Cột thêm sau (khớp ADDED_COLUMNS trong models.py): DB đã có bảng từ engine bản cũ vẫn được bổ sung cột.
-- groups_keyword: các từ khóa đã mở trang tìm nhóm, nối bằng dấu phẩy; NULL = nhóm đề xuất / không tham gia nhóm.
ALTER TABLE public.farm_run_history ADD COLUMN IF NOT EXISTS groups_keyword TEXT;

-- Chỉ engine (backend) truy cập; không tạo policy cho trình duyệt, giống module_01 / module_auth.
ALTER TABLE public.farm_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_run_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_interaction_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_browser_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_target_owners ENABLE ROW LEVEL SECURITY;

COMMIT;
