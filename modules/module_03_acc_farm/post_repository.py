"""
post_repository.py
Module 03 - Tab 2: Phân hệ Đăng bài (Status, Reels, Story) & Tương tác nhanh.
Truy xuất dữ liệu cho 5 bảng:
  1. post_settings
  2. account_folder_mappings
  3. post_sessions
  4. posts
  5. post_interaction_logs
Sử dụng database connection pool chuẩn PostgreSQL (Supabase).
"""
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from core.database.connection import db

logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ==============================================================================
# 1. POST SETTINGS
# ==============================================================================

def get_post_settings(post_type: str) -> Optional[Dict[str, Any]]:
    sql = """
        SELECT post_type, api_key_file_path, gemini_model, prompt_template,
               master_folder_path, check_duplicate, schedule_enabled,
               schedule_time, min_delay, max_delay, thread_count, updated_at
        FROM post_settings
        WHERE post_type = %s
    """
    return db.fetch_one(sql, (post_type,))


def upsert_post_settings(post_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
    sql = """
        INSERT INTO post_settings (
            post_type, api_key_file_path, gemini_model, prompt_template,
            master_folder_path, check_duplicate, schedule_enabled,
            schedule_time, min_delay, max_delay, thread_count, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (post_type) DO UPDATE SET
            api_key_file_path = EXCLUDED.api_key_file_path,
            gemini_model = EXCLUDED.gemini_model,
            prompt_template = EXCLUDED.prompt_template,
            master_folder_path = EXCLUDED.master_folder_path,
            check_duplicate = EXCLUDED.check_duplicate,
            schedule_enabled = EXCLUDED.schedule_enabled,
            schedule_time = EXCLUDED.schedule_time,
            min_delay = EXCLUDED.min_delay,
            max_delay = EXCLUDED.max_delay,
            thread_count = EXCLUDED.thread_count,
            updated_at = NOW()
        RETURNING *;
    """
    sched_enabled = bool(data.get('schedule_enabled', False))
    sched_time = data.get('schedule_time')
    if not sched_time or not str(sched_time).strip() or not sched_enabled:
        sched_time = None
    elif isinstance(sched_time, str):
        sched_time = sched_time.strip()

    params = (
        post_type,
        data.get('api_key_file_path'),
        data.get('gemini_model', 'gemini-3.8-flash'),
        data.get('prompt_template'),
        data.get('master_folder_path'),
        data.get('check_duplicate', True),
        sched_enabled,
        sched_time,
        data.get('min_delay', 600),
        data.get('max_delay', 900),
        data.get('thread_count', 1),
    )
    res = db.fetch_one(sql, params)
    return res or {}


# ==============================================================================
# 2. ACCOUNT FOLDER MAPPINGS (REELS / STORY)
# ==============================================================================

def get_folder_mappings(post_type: str) -> List[Dict[str, Any]]:
    sql = """
        SELECT id, account_uid, post_type, subfolder_path,
               available_media_count, mapping_status, updated_at
        FROM account_folder_mappings
        WHERE post_type = %s
        ORDER BY account_uid ASC
    """
    return db.fetch_all(sql, (post_type,))


def upsert_folder_mapping(
    account_uid: str,
    post_type: str,
    subfolder_path: str,
    available_media_count: int = 0,
    mapping_status: str = 'MAPPED'
) -> Dict[str, Any]:
    norm_status = mapping_status if mapping_status in ('MAPPED', 'SOURCE_ERROR') else ('MAPPED' if available_media_count > 0 else 'SOURCE_ERROR')
    sql = """
        INSERT INTO account_folder_mappings (
            account_uid, post_type, subfolder_path, available_media_count, mapping_status, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (account_uid, post_type) DO UPDATE SET
            subfolder_path = EXCLUDED.subfolder_path,
            available_media_count = EXCLUDED.available_media_count,
            mapping_status = EXCLUDED.mapping_status,
            updated_at = NOW()
        RETURNING *;
    """
    res = db.fetch_one(sql, (account_uid, post_type, subfolder_path, available_media_count, norm_status))
    return res or {}


def delete_folder_mapping(account_uid: str, post_type: str) -> None:
    sql = "DELETE FROM account_folder_mappings WHERE account_uid = %s AND post_type = %s;"
    db.execute(sql, (account_uid, post_type))


# ==============================================================================
# 3. POST SESSIONS
# ==============================================================================

def create_post_session(kind: str) -> str:
    session_id = str(uuid.uuid4())
    sql = """
        INSERT INTO post_sessions (id, kind, status, started_at)
        VALUES (%s, %s, 'RUNNING', NOW())
        RETURNING id;
    """
    res = db.fetch_one(sql, (session_id, kind))
    return res['id'] if res else session_id


def update_post_session(session_id: str, status: str, finished: bool = False) -> None:
    norm_status = status.upper()
    if norm_status in ('COMPLETED', 'FINISHED', 'SUCCESS'):
        norm_status = 'DONE'
    elif norm_status == 'PAUSE':
        norm_status = 'PAUSED'

    try:
        if finished:
            sql = "UPDATE post_sessions SET status = %s, finished_at = NOW() WHERE id = %s;"
        else:
            sql = "UPDATE post_sessions SET status = %s WHERE id = %s;"
        db.execute(sql, (norm_status, session_id))
    except Exception as e:
        logger.error(f"Lỗi update_post_session({session_id}, {norm_status}): {e}")


def get_post_session(session_id: str) -> Optional[Dict[str, Any]]:
    sql = "SELECT * FROM post_sessions WHERE id = %s;"
    return db.fetch_one(sql, (session_id,))


def get_latest_active_session(kind: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if kind:
        sql = """
            SELECT * FROM post_sessions
            WHERE kind = %s AND status = 'RUNNING'
            ORDER BY started_at DESC LIMIT 1;
        """
        return db.fetch_one(sql, (kind,))
    else:
        sql = """
            SELECT * FROM post_sessions
            WHERE status = 'RUNNING'
            ORDER BY started_at DESC LIMIT 1;
        """
        return db.fetch_one(sql)


# ==============================================================================
# 4. POSTS (DRAFT, QUEUE & HISTORY)
# ==============================================================================

def create_post(
    post_type: str,
    account_uid: str,
    account_name: str = '',
    content: str = '',
    hashtags: Optional[str] = None,
    image_path: Optional[str] = None,
    media_path: Optional[str] = None,
    thumbnail_path: Optional[str] = None,
    media_hash: Optional[str] = None,
    status: str = 'PENDING',
    session_id: Optional[str] = None,
    account_id: Optional[str] = None,
    schedule_time: Optional[str] = None
) -> Dict[str, Any]:
    post_id = str(uuid.uuid4())
    sql = """
        INSERT INTO posts (
            id, session_id, account_id, account_uid, account_name,
            post_type, content, hashtags, image_path, media_path,
            thumbnail_path, media_hash, schedule_time, status,
            created_at, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
        RETURNING *;
    """
    params = (
        post_id, session_id, account_id, account_uid, account_name,
        post_type, content, hashtags, image_path, media_path,
        thumbnail_path, media_hash, schedule_time, status
    )
    res = db.fetch_one(sql, params)
    return res or {}


def get_drafts(post_type: str = 'status') -> List[Dict[str, Any]]:
    sql = """
        SELECT DISTINCT ON (account_uid) * FROM posts
        WHERE post_type = %s AND status IN ('DRAFT', 'READY')
        ORDER BY account_uid, created_at DESC;
    """
    return db.fetch_all(sql, (post_type,))


def delete_drafts_by_account(account_uid: str, post_type: str = 'status') -> None:
    sql = "DELETE FROM posts WHERE account_uid = %s AND post_type = %s AND status IN ('DRAFT', 'READY');"
    db.execute(sql, (account_uid, post_type))


def delete_draft(post_id: str) -> None:
    sql = "DELETE FROM posts WHERE id = %s AND status IN ('DRAFT', 'READY');"
    db.execute(sql, (post_id,))


def save_or_update_draft(
    account_uid: str,
    content: str,
    post_type: str = "status",
    draft_id: Optional[str] = None,
    account_name: str = "",
    status: str = "READY",
    image_path: Optional[str] = None,
    clear_image: bool = False
) -> Dict[str, Any]:
    if draft_id:
        check_sql = "SELECT id FROM posts WHERE id = %s;"
        existing = db.fetch_one(check_sql, (draft_id,))
        if existing:
            if clear_image or image_path == "__REMOVE__":
                update_sql = """
                    UPDATE posts
                    SET content = %s,
                        account_name = CASE WHEN %s != '' THEN %s ELSE account_name END,
                        status = %s,
                        image_path = NULL,
                        updated_at = NOW()
                    WHERE id = %s
                    RETURNING *;
                """
                res = db.fetch_one(update_sql, (content, account_name, account_name, status, draft_id))
            elif image_path is not None:
                update_sql = """
                    UPDATE posts
                    SET content = %s,
                        account_name = CASE WHEN %s != '' THEN %s ELSE account_name END,
                        status = %s,
                        image_path = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    RETURNING *;
                """
                res = db.fetch_one(update_sql, (content, account_name, account_name, status, image_path, draft_id))
            else:
                update_sql = """
                    UPDATE posts
                    SET content = %s,
                        account_name = CASE WHEN %s != '' THEN %s ELSE account_name END,
                        status = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    RETURNING *;
                """
                res = db.fetch_one(update_sql, (content, account_name, account_name, status, draft_id))
            if res:
                return res

    delete_drafts_by_account(account_uid, post_type)
    final_img = None if (clear_image or image_path == "__REMOVE__") else image_path
    return create_post(
        post_type=post_type,
        account_uid=account_uid,
        account_name=account_name,
        content=content,
        image_path=final_img,
        status=status
    )




def claim_next_pending_post(session_id: str) -> Optional[Dict[str, Any]]:
    """
    Lấy bài PENDING an toàn tránh đụng độ giữa 2 luồng đồng thời.
    Sử dụng FOR UPDATE SKIP LOCKED.
    Đồng thời loại trừ các account_uid đang có bài ở trạng thái RUNNING để đảm bảo
    mỗi profile Chrome chỉ chạy đơn luồng tại một thời điểm.
    """
    sql = """
        SELECT * FROM posts
        WHERE session_id = %s 
          AND status = 'PENDING'
          AND account_uid NOT IN (
              SELECT account_uid FROM posts WHERE session_id = %s AND status = 'RUNNING'
          )
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1;
    """
    with db.session() as cursor:
        cursor.execute(db._normalize_query(sql), (session_id, session_id))
        row = cursor.fetchone()
        if not row:
            return None
        post = dict(row)
        cursor.execute(
            db._normalize_query("UPDATE posts SET status = 'RUNNING', updated_at = NOW() WHERE id = %s;"),
            (post['id'],)
        )
        post['status'] = 'RUNNING'
        return post


def count_pending_posts(session_id: str) -> int:
    """Đếm số lượng bài viết còn đang PENDING trong session."""
    sql = "SELECT COUNT(*) as cnt FROM posts WHERE session_id = %s AND status = 'PENDING';"
    with db.session() as cursor:
        cursor.execute(db._normalize_query(sql), (session_id,))
        row = cursor.fetchone()
        return row['cnt'] if row else 0


def finish_post(
    post_id: str,
    account_uid: str,
    status: str,
    message: Optional[str] = None,
    url: Optional[str] = None,
    logs: Optional[List[Dict[str, Any]]] = None
) -> None:
    """
    Kết thúc bài viết và cập nhật trạng thái liên quan trong một transaction duy nhất:
    - Nếu PUBLISHED: lưu url, published_at = NOW(), lưu logs
    - Nếu STOPPED: lưu status = 'STOPPED', message, lưu logs
    - Nếu DIE hoặc BLOCKED:
        + Cập nhật bài hiện tại thành DIE hoặc BLOCKED
        + Hủy toàn bộ bài PENDING còn lại của nick này sang STOPPED
        + Với DIE: cập nhật fb_accounts.account_status = 'CHECKPOINT'
    - Nếu FAILED: lưu lỗi bài viết
    """
    logs_json = json.dumps(logs, ensure_ascii=False) if logs else None
    with db.session() as cursor:
        if status == 'PUBLISHED' and not url and account_uid:
            url = f"https://www.facebook.com/{account_uid}"

        if logs_json:
            update_sql = db._normalize_query("""
                UPDATE posts
                SET status = %s,
                    error_message = %s,
                    facebook_post_url = %s,
                    logs = %s::jsonb,
                    published_at = CASE WHEN %s = 'PUBLISHED' THEN NOW() END,
                    updated_at = NOW()
                WHERE id = %s;
            """)
            cursor.execute(update_sql, (status, message, url, logs_json, status, post_id))
        else:
            update_sql = db._normalize_query("""
                UPDATE posts
                SET status = %s,
                    error_message = %s,
                    facebook_post_url = %s,
                    published_at = CASE WHEN %s = 'PUBLISHED' THEN NOW() END,
                    updated_at = NOW()
                WHERE id = %s;
            """)
            cursor.execute(update_sql, (status, message, url, status, post_id))

        if status == 'PUBLISHED':
            # UC-M03-07 Hậu điều kiện: Tự động xóa các bản nháp (DRAFT/READY) của UID này sau khi xuất bản thành công
            delete_draft_sql = db._normalize_query("""
                DELETE FROM posts
                WHERE account_uid = %s AND status IN ('DRAFT', 'READY');
            """)
            cursor.execute(delete_draft_sql, (account_uid,))

        if status in ("DIE", "BLOCKED"):
            stop_pending_sql = db._normalize_query("""
                UPDATE posts
                SET status = 'STOPPED',
                    error_message = %s,
                    updated_at = NOW()
                WHERE account_uid = %s AND status = 'PENDING';
            """)
            cursor.execute(stop_pending_sql, (f"Nick {status}, hủy hàng đợi", account_uid))

        if status == "DIE":
            acc_sql = db._normalize_query("""
                UPDATE fb_accounts
                SET account_status = 'CHECKPOINT',
                    updated_at = NOW()
                WHERE uid = %s;
            """)
            cursor.execute(acc_sql, (account_uid,))


def update_post_result(
    post_id: str,
    status: str,
    facebook_post_url: Optional[str] = None,
    error_message: Optional[str] = None
) -> None:
    if status == 'PUBLISHED':
        sql = """
            UPDATE posts
            SET status = %s, facebook_post_url = %s, error_message = NULL,
                published_at = NOW(), updated_at = NOW()
            WHERE id = %s;
        """
        db.execute(sql, (status, facebook_post_url, post_id))
        # UC-M03-07: Xóa các bản nháp DRAFT / READY của tài khoản này
        del_sql = """
            DELETE FROM posts
            WHERE account_uid = (SELECT account_uid FROM posts WHERE id = %s)
              AND status IN ('DRAFT', 'READY');
        """
        db.execute(del_sql, (post_id,))
    else:
        sql = """
            UPDATE posts
            SET status = %s, error_message = %s, updated_at = NOW()
            WHERE id = %s;
        """
        db.execute(sql, (status, error_message, post_id))



def stop_all_session_posts(session_id: str) -> None:
    sql = """
        UPDATE posts
        SET status = 'STOPPED',
            error_message = 'Tiến trình đã dừng theo yêu cầu của người dùng',
            updated_at = NOW()
        WHERE session_id = %s AND status IN ('PENDING', 'RUNNING');
    """
    db.execute(sql, (session_id,))


def check_media_hash_exists(account_uid: str, media_hash: str) -> bool:
    """Kiểm tra xem nick này đã từng đăng video có hash này chưa"""
    sql = """
        SELECT 1 FROM posts
        WHERE account_uid = %s AND media_hash = %s AND status = 'PUBLISHED'
        LIMIT 1;
    """
    res = db.fetch_one(sql, (account_uid, media_hash))
    return bool(res)


def get_posted_media_hashes(account_uid: str) -> set:
    """Lấy tập hợp các hash media đã đăng thành công của một tài khoản."""
    if not account_uid:
        return set()
    sql = """
        SELECT media_hash FROM posts
        WHERE account_uid = %s AND status = 'PUBLISHED' AND media_hash IS NOT NULL;
    """
    try:
        rows = db.fetch_all(sql, (account_uid,)) or []
        return {r['media_hash'] for r in rows if r.get('media_hash')}
    except Exception as e:
        logger.warning(f"Lỗi lấy posted_media_hashes cho {account_uid}: {e}")
        return set()


def get_posted_media_hashes_batch(account_uids: List[str]) -> Dict[str, set]:
    """Lấy danh sách các media_hash đã từng đăng thành công cho danh sách UIDs."""
    clean_uids = [str(u).strip() for u in account_uids if u and str(u).strip()]
    if not clean_uids:
        return {}
    res = {u: set() for u in clean_uids}
    try:
        sql = """
            SELECT account_uid, media_hash FROM posts
            WHERE account_uid IN %s AND status = 'PUBLISHED' AND media_hash IS NOT NULL;
        """
        rows = db.fetch_all(sql, (tuple(clean_uids),)) or []
        for r in rows:
            u = str(r['account_uid'])
            h = r.get('media_hash')
            if h and u in res:
                res[u].add(h)
    except Exception as e:
        logger.warning(f"Lỗi get_posted_media_hashes_batch: {e}")
    return res


# ==============================================================================
# 5. POST INTERACTION LOGS
# ==============================================================================

def create_post_interaction_log(
    account_uid: str,
    account_name: str = '',
    session_id: Optional[str] = None,
    account_id: Optional[str] = None,
    duration_minutes: int = 0,
    delay_seconds: int = 0
) -> str:
    log_id = str(uuid.uuid4())
    sql = """
        INSERT INTO post_interaction_logs (
            id, session_id, account_id, account_uid, account_name,
            duration_minutes, delay_seconds, status, started_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, 'RUNNING', NOW())
        RETURNING id;
    """
    params = (log_id, session_id, account_id, account_uid, account_name, duration_minutes, delay_seconds)
    res = db.fetch_one(sql, params)
    return res['id'] if res else log_id


def finish_post_interaction_log(
    log_id: str,
    status: str = 'COMPLETED',
    error_message: Optional[str] = None,
    random_actions_count: int = 0
) -> None:
    sql = """
        UPDATE post_interaction_logs
        SET status = %s, error_message = %s, random_actions_count = %s, finished_at = NOW()
        WHERE id = %s;
    """
    db.execute(sql, (status, error_message, random_actions_count, log_id))


def get_post_history(
    post_type: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    time_slot: Optional[str] = None,
    date: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
) -> tuple:
    conditions = ["status IN ('PUBLISHED', 'FAILED', 'STOPPED', 'BLOCKED', 'DIE')"]
    params = []

    if post_type and post_type != "all":
        conditions.append("post_type = %s")
        params.append(post_type.lower())

    if status and status != "all":
        if status.upper() in ("PUBLISHED", "SUCCESS", "ĐÃ XUẤT BẢN"):
            conditions.append("status = 'PUBLISHED'")
        elif status.upper() in ("FAILED", "LỖI", "LOI"):
            conditions.append("status IN ('FAILED', 'STOPPED', 'BLOCKED', 'DIE')")
        else:
            conditions.append("status = %s")
            params.append(status.upper())

    if time_slot and time_slot != "all":
        conditions.append("CAST(schedule_time AS TEXT) LIKE %s")
        params.append(f"{time_slot.strip()}%")

    if date and date != "all":
        conditions.append("DATE(created_at) = %s")
        params.append(date)

    if search and search.strip():
        term = f"%{search.strip()}%"
        conditions.append("(account_name ILIKE %s OR account_uid ILIKE %s OR content ILIKE %s)")
        params.extend([term, term, term])

    where_clause = " WHERE " + " AND ".join(conditions)

    count_sql = f"SELECT COUNT(*) as total FROM posts {where_clause};"
    count_res = db.fetch_one(count_sql, tuple(params))
    total = int(count_res['total']) if count_res and 'total' in count_res else 0

    data_sql = f"""
        SELECT * FROM posts
        {where_clause}
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s;
    """
    rows = db.fetch_all(data_sql, tuple(params + [limit, offset]))
    return rows or [], total


def cleanup_post_history(days: int = 30) -> int:
    try:
        if days <= 0:
            sql = "DELETE FROM posts WHERE status IN ('PUBLISHED', 'FAILED', 'STOPPED', 'BLOCKED', 'DIE');"
            db.execute(sql)
        else:
            sql = f"DELETE FROM posts WHERE status IN ('PUBLISHED', 'FAILED', 'STOPPED', 'BLOCKED', 'DIE') AND created_at < NOW() - INTERVAL '{int(days)} days';"
            db.execute(sql)
        return 1
    except Exception as e:
        logger.error(f"Lỗi khi dọn dẹp post history: {e}")
        return 0

