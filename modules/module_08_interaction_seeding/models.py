"""
=============================================================================
MODULE 8: INTERACTION SEEDING - DATABASE MODELS & SCHEMA
Quản lý CSDL riêng cho Module 8 (Phụ trách: Hưởng, Trường).
Phục vụ các màn hình: Seeding Page, Seeding Trang cá nhân, Seeding bài viết, Lịch sử.

Quy ước:
- FK thật chỉ đặt giữa các bảng seeding_*. Tham chiếu sang module khác là tham chiếu
  logic (giống page_id của Module 5): account_uid -> accounts.uid, created_by -> users.id.
- Dùng account_uid thay vì accounts.id vì import tài khoản dùng INSERT OR REPLACE,
  SQLite sẽ xoá và tạo lại dòng (id mới) mỗi lần import lại.
- Bảng seeding_tasks vừa là kế hoạch phân bổ, vừa là hàng đợi bền vững, vừa là nhật ký kết quả.
=============================================================================
"""
from core.database.connection import db

DDL_STATEMENTS = [
    # 1. Đối tượng được seeding (Page / Trang cá nhân / Bài viết), dùng chung giữa các chiến dịch
    """
    CREATE TABLE IF NOT EXISTS seeding_targets (
        id SERIAL PRIMARY KEY,
        target_type VARCHAR(20) NOT NULL, -- 'PAGE', 'PROFILE', 'POST'
        fb_id VARCHAR(100) NOT NULL, -- Định danh cắt từ đuôi link (username / ID), không mở link
        url TEXT NOT NULL,
        display_name VARCHAR(255), -- Display name, cut from end of link
        created_by INT, -- users.id (người dùng sở hữu/import link)
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,

    # 2. Chiến dịch seeding (mỗi lần bấm "Bắt đầu seeding") + cấu hình + bộ đếm cho trang Lịch sử
    """
    CREATE TABLE IF NOT EXISTS seeding_campaigns (
        id SERIAL PRIMARY KEY,
        campaign_type VARCHAR(20) NOT NULL, -- 'PAGE', 'PROFILE', 'POST'
        actions VARCHAR(100) NOT NULL,
        reactions VARCHAR(100), -- 'LIKE,LOVE,CARE,HAHA,WOW,SAD,ANGRY' (chỉ cho POST)
        account_count INT NOT NULL,
        delay_seconds_min INT DEFAULT 30, -- Thời gian nghỉ giữa 2 lần tương tác (giây)
        delay_seconds_max INT DEFAULT 60,
        status VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'RUNNING', 'STOPPING', 'STOPPED', 'COMPLETED', 'FAILED'
        total_planned INT DEFAULT 0,
        total_success INT DEFAULT 0,
        total_failed INT DEFAULT 0,
        created_by INT, -- users.id (bảng core)
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,

    # 3. Mục tiêu trong từng chiến dịch (mức độ mong muốn & ghi chú lấy từ cột B, C của file Excel)
    """
    CREATE TABLE IF NOT EXISTS seeding_campaign_targets (
        id SERIAL PRIMARY KEY,
        campaign_id INT NOT NULL REFERENCES seeding_campaigns(id) ON DELETE CASCADE,
        target_id INT NOT NULL REFERENCES seeding_targets(id),
        note TEXT,
        source VARCHAR(10) DEFAULT 'MANUAL', -- 'MANUAL', 'EXCEL'
        planned_count INT DEFAULT 0,
        success_count INT DEFAULT 0,
        failed_count INT DEFAULT 0,
        CONSTRAINT unique_campaign_target UNIQUE (campaign_id, target_id)
    );
    """,

    # 4. Kho bình luận random của chiến dịch (tối đa 50 dòng) hoặc bình luận mẫu của user (campaign_id IS NULL)
    """
    CREATE TABLE IF NOT EXISTS seeding_comments (
        id SERIAL PRIMARY KEY,
        campaign_id INT REFERENCES seeding_campaigns(id) ON DELETE CASCADE,
        created_by INT,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,

    # 5. Tác vụ nguyên tử: 1 tài khoản x 1 hành động x 1 mục tiêu
    """
    CREATE TABLE IF NOT EXISTS seeding_tasks (
        id SERIAL PRIMARY KEY,
        campaign_id INT NOT NULL REFERENCES seeding_campaigns(id) ON DELETE CASCADE,
        campaign_target_id INT NOT NULL REFERENCES seeding_campaign_targets(id) ON DELETE CASCADE,
        target_id INT NOT NULL REFERENCES seeding_targets(id),
        account_uid VARCHAR(100) NOT NULL, -- accounts.uid (Module 2)
        action VARCHAR(20) NOT NULL, -- 'FOLLOW', 'REACT', 'COMMENT', 'SHARE'
        reaction VARCHAR(10), -- Chỉ dùng cho REACT
        comment_id INT REFERENCES seeding_comments(id) ON DELETE SET NULL,
        status VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED'
        error_message TEXT,
        scheduled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- Thời điểm sớm nhất được phép chạy (giãn cách)
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,

    # Scheduler lấy task đến hạn
    "CREATE INDEX IF NOT EXISTS idx_seeding_tasks_queue ON seeding_tasks (status, scheduled_at);",
    # Tiến trình & chi tiết từng chiến dịch
    "CREATE INDEX IF NOT EXISTS idx_seeding_tasks_campaign ON seeding_tasks (campaign_id, status);",
    # Đếm số lượt tương tác trong ngày của từng tài khoản
    "CREATE INDEX IF NOT EXISTS idx_seeding_tasks_account ON seeding_tasks (account_uid, finished_at);",
    # Mỗi tài khoản chỉ thực hiện 1 lần mỗi hành động trên 1 mục tiêu (Follow/Like lần 2 = bỏ Follow/Like).
    # FAILED / SKIPPED không chặn, để chiến dịch sau có thể thử lại.
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_seeding_tasks_once
    ON seeding_tasks (account_uid, target_id, action)
    WHERE status IN ('PENDING', 'RUNNING', 'SUCCESS');
    """,
    # Trang Lịch sử: lọc theo loại & thời gian
    "CREATE INDEX IF NOT EXISTS idx_seeding_campaigns_history ON seeding_campaigns (campaign_type, created_at);",
    "CREATE INDEX IF NOT EXISTS idx_seeding_campaign_targets_target ON seeding_campaign_targets (target_id);",
]


def init_models():
    """Khởi tạo schema riêng cho Module 8"""
    for stmt in DDL_STATEMENTS:
        try:
            if not db._is_postgres:
                clean_stmt = stmt.replace("SERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT")
            else:
                clean_stmt = stmt
            db.execute(clean_stmt)
        except Exception as e:
            print(f"[Module 8 DB] DDL error: {e}")
