-- Module 03 - Tab 1: chủ của nhóm / người trong dàn nick (tính năng chia đích cho các nick).
-- Chạy tay trong SQL Editor (Supabase hoặc Postgres local) sau 001. Chạy lại được (IF NOT EXISTS).
-- Engine cũng tự tạo bảng khi khởi động (DDL_STATEMENTS trong models.py), nên thứ tự không quan trọng.
-- Mỗi đích (nhóm / người) chỉ thuộc 1 nick: nick giành được trước là chủ, nick khác trong dàn bỏ qua đích đó.
--   scope: "owner:<tài khoản đăng nhập tool>" (dàn gồm nick cùng owner trên mọi máy) hoặc "machine:<machine_id>" (nick local).
--   target_key: link đã chuẩn hóa ("group:<id|tên rút gọn>", "id:<uid>", "user:<username>", "share:<đường dẫn>");
--   1 nhóm có thể có 2 dòng cùng chủ (ID số và tên rút gọn).
--   status: claimed (đã giành, chưa bấm xong) / joined / pending / member / left / sent / friends.
-- Dữ liệu cũ: engine tự chép chủ từ farm_interaction_logs.targets lúc khởi động khi bảng còn trống.
-- Nút Dọn dẹp lịch sử không xóa bảng này.
-- Rollback: DROP TABLE IF EXISTS public.farm_target_owners;
BEGIN;

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

-- Chỉ engine (backend) truy cập; không tạo policy cho trình duyệt.
ALTER TABLE public.farm_target_owners ENABLE ROW LEVEL SECURITY;

COMMIT;
