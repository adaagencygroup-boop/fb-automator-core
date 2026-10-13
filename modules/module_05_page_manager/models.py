"""
Module 5 schema trên PostgreSQL production.

pages            Fanpage đang quản lý, gắn account_uid (Module 2) và từ khóa AI/TikTok/YouTube.
posting_history  Kết quả từng bài AI hoặc Reels. Bảng này cũng có group_id cho module khác, không được siết page_id thành NOT NULL.
posting_progress Video Reels đã đăng tới đâu (last_object_path). last_folder_index là số cũ từ tool desktop.
downloaded_videos ID đã tải thành công, chống trùng. object_path là đường dẫn trong bucket page-videos.
download_logs    Nhật ký từng lần tải, gồm cả lần thất bại.
page_jobs        Một lần bấm Kích hoạt (AI, REEL, TIKTOK, YOUTUBE).
page_job_items   Trạng thái của từng Page trong job đó.
"""
import json

from core.database.connection import db
from config.constants import BASE_DIR


DDL_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS pages (
        id SERIAL PRIMARY KEY,
        account_uid VARCHAR(100),
        page_id VARCHAR(100) NOT NULL UNIQUE,
        page_name VARCHAR(255) NOT NULL,
        access_token TEXT NOT NULL,
        category VARCHAR(100),
        status VARCHAR(50) DEFAULT 'ACTIVE',
        ai_keyword TEXT,
        tiktok_keyword TEXT,
        youtube_keyword TEXT,
        youtube_url TEXT,
        prompt_template TEXT,
        reels_folder TEXT,
        video_folder TEXT,
        auto_ai_enabled BOOLEAN DEFAULT TRUE,
        auto_reels_enabled BOOLEAN DEFAULT TRUE,
        auto_video_enabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS posting_history (
        id SERIAL PRIMARY KEY,
        page_id VARCHAR(100),
        account_uid VARCHAR(100),
        group_id VARCHAR(100),
        post_id VARCHAR(100),
        post_type VARCHAR(50) NOT NULL,
        title TEXT,
        caption TEXT,
        post_url TEXT,
        media_path TEXT,
        status VARCHAR(50) DEFAULT 'SUCCESS',
        error_message TEXT,
        posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS posting_progress (
        id SERIAL PRIMARY KEY,
        page_id VARCHAR(100) NOT NULL,
        post_type VARCHAR(50) NOT NULL,
        last_folder_index INT DEFAULT 0,
        last_video_id VARCHAR(255),
        last_object_path TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_page_post_type UNIQUE (page_id, post_type)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS downloaded_videos (
        id SERIAL PRIMARY KEY,
        page_id VARCHAR(100) NOT NULL,
        video_id VARCHAR(255) NOT NULL,
        source VARCHAR(50) NOT NULL DEFAULT 'TIKTOK',
        title TEXT,
        caption TEXT,
        object_path TEXT,
        link TEXT,
        downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_page_source_video UNIQUE (page_id, source, video_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS download_logs (
        id SERIAL PRIMARY KEY,
        page_id VARCHAR(100) NOT NULL,
        source VARCHAR(20) NOT NULL,
        video_id VARCHAR(255),
        title TEXT,
        object_path TEXT,
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS page_jobs (
        id SERIAL PRIMARY KEY,
        job_type VARCHAR(20) NOT NULL,
        account_uid VARCHAR(100),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS page_job_items (
        id SERIAL PRIMARY KEY,
        job_id INTEGER NOT NULL REFERENCES page_jobs(id) ON DELETE CASCADE,
        page_id VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        message TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_job_page UNIQUE (job_id, page_id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS posting_schedules (
        id SERIAL PRIMARY KEY,
        page_id VARCHAR(100),
        schedule_type VARCHAR(50),
        scheduled_times VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        last_run_date VARCHAR(50),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,
]

# Cột nghiệp vụ thêm lên bảng đã có trên production. Không xóa cột cũ.
COLUMN_MIGRATIONS = [
    "ALTER TABLE pages ADD COLUMN IF NOT EXISTS account_uid VARCHAR(100)",
    "ALTER TABLE pages ADD COLUMN IF NOT EXISTS ai_keyword TEXT",
    "ALTER TABLE pages ADD COLUMN IF NOT EXISTS tiktok_keyword TEXT",
    "ALTER TABLE pages ADD COLUMN IF NOT EXISTS youtube_keyword TEXT",
    "ALTER TABLE pages ADD COLUMN IF NOT EXISTS youtube_url TEXT",
    "ALTER TABLE posting_history ADD COLUMN IF NOT EXISTS account_uid VARCHAR(100)",
    "ALTER TABLE posting_history ADD COLUMN IF NOT EXISTS group_id VARCHAR(100)",
    "ALTER TABLE posting_history ADD COLUMN IF NOT EXISTS error_message TEXT",
    "ALTER TABLE posting_progress ADD COLUMN IF NOT EXISTS last_video_id VARCHAR(255)",
    "ALTER TABLE posting_progress ADD COLUMN IF NOT EXISTS last_object_path TEXT",
    "ALTER TABLE downloaded_videos ADD COLUMN IF NOT EXISTS object_path TEXT",
    "ALTER TABLE downloaded_videos ALTER COLUMN source SET DEFAULT 'TIKTOK'",
]

INDEX_STATEMENTS = [
    "CREATE INDEX IF NOT EXISTS idx_pages_account_uid ON pages (account_uid)",
    "CREATE INDEX IF NOT EXISTS idx_pages_status ON pages (status)",
    "CREATE INDEX IF NOT EXISTS idx_pages_name_lower ON pages (lower(page_name))",
    "CREATE INDEX IF NOT EXISTS idx_posting_history_posted_at ON posting_history (posted_at)",
    "CREATE INDEX IF NOT EXISTS idx_posting_history_page_type ON posting_history (page_id, post_type)",
    "CREATE INDEX IF NOT EXISTS idx_download_logs_created ON download_logs (created_at)",
    "CREATE INDEX IF NOT EXISTS idx_download_logs_source_page ON download_logs (source, page_id)",
    "CREATE INDEX IF NOT EXISTS idx_page_jobs_type_status ON page_jobs (job_type, status)",
    "CREATE INDEX IF NOT EXISTS idx_page_job_items_job ON page_job_items (job_id)",
]


def init_models():
    """Tạo bảng còn thiếu và thêm cột nghiệp vụ. Giữ nguyên dòng đang có."""
    if not db.is_postgres:
        raise RuntimeError("Module 5 chỉ migrate trên PostgreSQL production.")

    for stmt in DDL_STATEMENTS + COLUMN_MIGRATIONS + INDEX_STATEMENTS:
        db.execute(stmt)

    db.execute("UPDATE downloaded_videos SET source = 'TIKTOK' WHERE source IS NULL")
    db.execute("ALTER TABLE downloaded_videos ALTER COLUMN source SET NOT NULL")
    db.execute("UPDATE downloaded_videos SET object_path = link WHERE object_path IS NULL AND link IS NOT NULL")
    db.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'unique_page_source_video'
            ) THEN
                ALTER TABLE downloaded_videos DROP CONSTRAINT IF EXISTS unique_page_video;
                ALTER TABLE downloaded_videos
                    ADD CONSTRAINT unique_page_source_video UNIQUE (page_id, source, video_id);
            END IF;
        END $$;
        """
    )

    _migrate_pages_data()
    _migrate_posting_progress()


def _migrate_pages_data():
    """Chỉ đổ pages_data.json khi bảng pages đang trống."""
    count_res = db.fetch_one("SELECT COUNT(*) AS c FROM pages")
    if count_res and count_res.get("c", 0) > 0:
        return

    json_file = BASE_DIR / "modules" / "module_05_page_manager" / "pages_data.json"
    if not json_file.exists():
        return

    with open(json_file, "r", encoding="utf-8") as handle:
        pages_list = json.load(handle)
    if not isinstance(pages_list, list):
        return

    inserted = 0
    for page in pages_list:
        page_id = str(page.get("id") or "").strip()
        if not page_id:
            continue
        db.execute(
            """
            INSERT INTO pages (
                page_id, page_name, access_token, reels_folder, video_folder, prompt_template, status
            )
            VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
            ON CONFLICT (page_id) DO NOTHING
            """,
            (
                page_id,
                str(page.get("name") or page_id).strip(),
                str(page.get("access_token") or "").strip(),
                str(page.get("reels_folder") or "").strip() or None,
                str(page.get("video_folder") or "").strip() or None,
                str(page.get("prompt") or "").strip() or None,
            ),
        )
        inserted += 1
    print(f"[Module 5] Migrated {inserted} pages from pages_data.json.")


def _migrate_posting_progress():
    """Chỉ đổ posting_progress.json khi bảng tiến trình đang trống."""
    count_res = db.fetch_one("SELECT COUNT(*) AS c FROM posting_progress")
    if count_res and count_res.get("c", 0) > 0:
        return

    json_file = BASE_DIR / "modules" / "module_05_page_manager" / "posting_progress.json"
    if not json_file.exists():
        return

    with open(json_file, "r", encoding="utf-8") as handle:
        progress_data = json.load(handle)
    if not isinstance(progress_data, dict):
        return

    valid_pages = {row["page_id"] for row in db.fetch_all("SELECT page_id FROM pages")}
    count = 0
    for key, value in progress_data.items():
        if "_video" in key:
            page_id = key.replace("_video", "").strip()
            post_type = "VIDEO"
        elif "_reel" in key:
            page_id = key.replace("_reel", "").strip()
            post_type = "REEL"
        else:
            page_id = key
            post_type = "REEL"
        if page_id not in valid_pages:
            continue
        folder_index = int(value.get("last_posted_folder", 0)) if isinstance(value, dict) else int(value)
        db.execute(
            """
            INSERT INTO posting_progress (page_id, post_type, last_folder_index)
            VALUES (?, ?, ?)
            ON CONFLICT (page_id, post_type) DO UPDATE SET last_folder_index = EXCLUDED.last_folder_index
            """,
            (page_id, post_type, folder_index),
        )
        count += 1
    print(f"[Module 5] Migrated {count} posting_progress rows from JSON.")
