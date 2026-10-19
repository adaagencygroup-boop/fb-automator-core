"""Explicit owner access for the legacy Qt posting/downloading workers."""
import hashlib
import os
from core.database.connection import db


def require_owner(owner):
    if not owner:
        raise ValueError("Worker Module 5 cần owner rõ ràng.")
    return str(owner)


def pages_for(owner, ids=None):
    owner = require_owner(owner)
    rows = db.fetch_all("SELECT * FROM pages WHERE user_id = %s ORDER BY id", (owner,))
    selected = None if ids is None else {str(pid) for pid in ids}
    return [{**row, "id": str(row["page_id"]), "name": row["page_name"], "prompt": row.get("prompt_template") or ""}
            for row in rows if selected is None or str(row["page_id"]) in selected]


def progress(owner, page_id, post_type):
    return db.fetch_one("""SELECT last_folder_index FROM posting_progress
        WHERE user_id = %s AND page_id = %s AND post_type = %s""", (require_owner(owner), page_id, post_type)) or {}


def save_progress(owner, page_id, post_type, index):
    db.execute("""INSERT INTO posting_progress (user_id, page_id, post_type, last_folder_index)
        VALUES (%s, %s, %s, %s) ON CONFLICT (user_id, page_id, post_type)
        DO UPDATE SET last_folder_index = EXCLUDED.last_folder_index, updated_at = NOW()""",
        (require_owner(owner), page_id, post_type, index))


def video_exists(owner, page_id, source, video_id):
    return bool(db.fetch_one("""SELECT id FROM downloaded_videos
        WHERE user_id = %s AND page_id = %s AND source = %s AND video_id = %s""",
        (require_owner(owner), page_id, source, video_id)))


def record_download(owner, page_id, source, video_id, caption, link, object_path, success=True):
    owner = require_owner(owner)
    with db.session() as cur:
        if success:
            cur.execute("""INSERT INTO downloaded_videos
                (user_id, page_id, source, video_id, caption, link, object_path)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, page_id, source, video_id) DO NOTHING""",
                (owner, page_id, source, video_id, caption, link, object_path))
        cur.execute("""INSERT INTO download_logs (user_id, page_id, source, video_id, object_path, status)
            VALUES (%s, %s, %s, %s, %s, %s)""", (owner, page_id, source, video_id, object_path, "SUCCESS" if success else "FAILED"))


def download_root(root, owner):
    key = hashlib.sha256(require_owner(owner).encode()).hexdigest()[:24]
    return os.path.join(os.path.abspath(root), key)
