"""
=============================================================================
MODULE 5: PAGE MANAGER & AUTO POST - DATABASE MODELS & SCHEMA
Quản lý CSDL riêng biệt cho Module 5 (Phụ trách: Bình Ka, Kiệt).
Thay thế toàn bộ pages_data.json, posting_progress.json, và 194 bảng videos.db.
=============================================================================
"""
import os
import json
from pathlib import Path
from core.database.connection import db
from config.constants import BASE_DIR

DDL_STATEMENTS = [
    # 1. Bảng quản lý Fanpage
    """
    CREATE TABLE IF NOT EXISTS pages (
        id SERIAL PRIMARY KEY,
        page_id VARCHAR(100) NOT NULL UNIQUE,
        page_name VARCHAR(255) NOT NULL,
        access_token TEXT NOT NULL,
        category VARCHAR(100),
        reels_folder TEXT,
        video_folder TEXT,
        auto_ai_enabled BOOLEAN DEFAULT TRUE,
        auto_reels_enabled BOOLEAN DEFAULT TRUE,
        auto_video_enabled BOOLEAN DEFAULT FALSE,
        prompt_template TEXT,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,

    # 2. Lịch sử bài đăng (Feed, Reels, Video)
    """
    CREATE TABLE IF NOT EXISTS posting_history (
        id SERIAL PRIMARY KEY,
        page_id VARCHAR(100) NOT NULL,
        post_id VARCHAR(100),
        post_type VARCHAR(50) NOT NULL,
        title TEXT,
        caption TEXT,
        post_url TEXT,
        media_path TEXT,
        status VARCHAR(50) DEFAULT 'SUCCESS',
        posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,

    # 3. Tiến trình đăng bài theo từng Fanpage (thay thế posting_progress.json)
    """
    CREATE TABLE IF NOT EXISTS posting_progress (
        id SERIAL PRIMARY KEY,
        page_id VARCHAR(100) NOT NULL,
        post_type VARCHAR(50) NOT NULL,
        last_folder_index INT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_page_post_type UNIQUE (page_id, post_type)
    );
    """,

    # 4. Kho video đã tải chống tải trùng (Thay thế 194 bảng tbl_<page_id> trong videos.db)
    """
    CREATE TABLE IF NOT EXISTS downloaded_videos (
        id SERIAL PRIMARY KEY,
        page_id VARCHAR(100) NOT NULL,
        video_id VARCHAR(255) NOT NULL,
        source VARCHAR(50) DEFAULT 'TIKTOK',
        title TEXT,
        caption TEXT,
        link TEXT,
        downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_page_video UNIQUE (page_id, video_id)
    );
    """,

    # 5. Lịch hẹn giờ đăng bài (thay thế scheduler_state.json)
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
    """
]

def init_models():
    """Khởi tạo schema và migrate dữ liệu riêng cho Module 5"""
    for stmt in DDL_STATEMENTS:
        try:
            if not db._is_postgres:
                clean_stmt = stmt.replace("SERIAL PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT")
                clean_stmt = clean_stmt.replace("BOOLEAN DEFAULT TRUE", "INTEGER DEFAULT 1")
                clean_stmt = clean_stmt.replace("BOOLEAN DEFAULT FALSE", "INTEGER DEFAULT 0")
            else:
                clean_stmt = stmt
            db.execute(clean_stmt)
        except Exception as e:
            print(f"[Module 5 DB] DDL error: {e}")

    _migrate_pages_data()
    _migrate_posting_progress()


def _migrate_pages_data():
    """Di trú dữ liệu 91 Fanpage từ pages_data.json vào bảng pages nếu rỗng"""
    try:
        count_res = db.fetch_one("SELECT COUNT(*) as c FROM pages")
        if count_res and count_res.get("c", 0) > 0:
            return

        json_file = BASE_DIR / "modules" / "module_05_page_manager" / "pages_data.json"
        if not json_file.exists():
            return

        with open(json_file, "r", encoding="utf-8") as f:
            pages_list = json.load(f)

        if not pages_list or not isinstance(pages_list, list):
            return

        inserted = 0
        for p in pages_list:
            page_id = str(p.get("id") or "").strip()
            page_name = str(p.get("name") or page_id).strip()
            access_token = str(p.get("access_token") or "").strip()
            reels_folder = str(p.get("reels_folder") or "").strip() or None
            video_folder = str(p.get("video_folder") or "").strip() or None
            prompt_template = str(p.get("prompt") or "").strip() or None

            if not page_id:
                continue

            query = """
            INSERT INTO pages (page_id, page_name, access_token, reels_folder, video_folder, prompt_template, status)
            VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
            ON CONFLICT (page_id) DO NOTHING
            """
            if not db._is_postgres:
                query = """
                INSERT OR IGNORE INTO pages (page_id, page_name, access_token, reels_folder, video_folder, prompt_template, status)
                VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
                """

            db.execute(query, (page_id, page_name, access_token, reels_folder, video_folder, prompt_template))
            inserted += 1

        print(f"[Module 5 Migration] Migrated {inserted} pages into 'pages' table.")
    except Exception as e:
        print(f"[Module 5 Migration] Notice: {e}")


def _migrate_posting_progress():
    """Di trú tiến trình từ posting_progress.json nếu rỗng"""
    try:
        count_res = db.fetch_one("SELECT COUNT(*) as c FROM posting_progress")
        if count_res and count_res.get("c", 0) > 0:
            return

        json_file = BASE_DIR / "modules" / "module_05_page_manager" / "posting_progress.json"
        if not json_file.exists():
            return

        with open(json_file, "r", encoding="utf-8") as f:
            progress_data = json.load(f)

        if not progress_data or not isinstance(progress_data, dict):
            return

        valid_pages = set(r["page_id"] for r in db.fetch_all("SELECT page_id FROM pages"))
        count = 0
        for key, idx in progress_data.items():
            if "_reel" in key:
                p_id = key.replace("_reel", "").strip()
                p_type = "REEL"
            elif "_video" in key:
                p_id = key.replace("_video", "").strip()
                p_type = "VIDEO"
            else:
                p_id = key
                p_type = "REEL"

            if p_id not in valid_pages:
                continue

            folder_index = int(idx.get("last_posted_folder", 0)) if isinstance(idx, dict) else int(idx)

            query = """
            INSERT INTO posting_progress (page_id, post_type, last_folder_index)
            VALUES (?, ?, ?)
            ON CONFLICT (page_id, post_type) DO UPDATE SET last_folder_index = EXCLUDED.last_folder_index
            """
            if not db._is_postgres:
                query = """
                INSERT OR REPLACE INTO posting_progress (page_id, post_type, last_folder_index)
                VALUES (?, ?, ?)
                """

            try:
                db.execute(query, (p_id, p_type, folder_index))
                count += 1
            except Exception:
                pass

        print(f"[Module 5 Migration] Migrated {count} entries into 'posting_progress' table.")
    except Exception as e:
        print(f"[Module 5 Migration] Notice: {e}")
