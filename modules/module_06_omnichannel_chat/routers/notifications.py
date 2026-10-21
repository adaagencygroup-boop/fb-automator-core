import math
import re
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import text, func, or_
from typing import List, Optional, Union
from datetime import datetime, timedelta
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.schemas import NotificationOut, PaginatedNotificationsOut
from modules.module_06_omnichannel_chat.auth import get_current_user_optional
from modules.module_06_omnichannel_chat.routers.pages import resolve_current_user_id
from modules.module_06_omnichannel_chat.models import Notification, Page, Account, SystemUser

router = APIRouter(prefix="/api/facebook", tags=["Notifications"])

def extract_post_and_comment_id(facebook_notification_id: str, link: Optional[str], notification_type: str):
    post_id = None
    comment_id = None
    fb_id = str(facebook_notification_id or "")
    link_str = str(link or "")

    if fb_id.startswith("post_created_"):
        post_id = fb_id.replace("post_created_", "")
    elif fb_id.startswith("react_sum_"):
        post_id = fb_id.replace("react_sum_", "")
    elif fb_id.startswith("react_"):
        parts = fb_id.split("_")
        if len(parts) >= 2:
            post_id = parts[1]
    elif "_" in fb_id and notification_type == "comment":
        parts = fb_id.split("_")
        post_id = parts[0]
        comment_id = parts[1]

    if not post_id and link_str:
        m = re.search(r"facebook\.com/(?:reel/|.*?permalink/)?(\d+(?:_\d+)?)", link_str)
        if m:
            post_id = m.group(1)

    return post_id, comment_id

@router.get("/notifications", response_model=Union[PaginatedNotificationsOut, List[NotificationOut]])
def get_notifications(
    request: Request,
    facebook_user_id: Optional[str] = None,
    user_id: Optional[str] = None,
    page_id: Optional[str] = None,
    page: Optional[int] = Query(None, ge=1, description="Số trang (1-indexed)"),
    page_size: Optional[int] = Query(None, ge=1, le=100, description="Số lượng thông báo trên 1 trang"),
    limit: Optional[int] = Query(None, ge=1, le=100, description="Số lượng thông báo cần lấy"),
    offset: Optional[int] = Query(None, ge=0, description="Vị trí bắt đầu"),
    notification_type: Optional[str] = Query(None, description="Loại thông báo: comment hoặc interaction"),
    filter: Optional[str] = Query(None, description="Lọc: unread, replied, unreplied"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo tiêu đề hoặc người gửi"),
    db: Session = Depends(get_db),
    current_user: Optional[SystemUser] = Depends(get_current_user_optional)
):
    """Fetch notifications with pagination support (within last 14 days / 2 weeks)."""
    two_weeks_ago = datetime.utcnow() - timedelta(days=14)

    # Automatically purge notifications older than 14 days
    try:
        db.query(Notification).filter(Notification.created_time < two_weeks_ago).delete(synchronize_session=False)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[Purge Old Notifications Error] {e}")

    logged_in_uid = (user_id or "").strip() or resolve_current_user_id(request, current_user)

    params = {}
    where_clauses = []

    if logged_in_uid:
        where_clauses.append("(CAST(a.user_id AS VARCHAR) = :user_id OR CAST(va.system_user_id AS VARCHAR) = :user_id)")
        params["user_id"] = str(logged_in_uid)

    if facebook_user_id:
        where_clauses.append("p.facebook_user_id = :fb_uid")
        params["fb_uid"] = str(facebook_user_id)

    if page_id:
        where_clauses.append("p.page_id = :page_id")
        params["page_id"] = str(page_id)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    sql = text(f"""
        SELECT DISTINCT p.page_id, p.page_name
        FROM v_pages p
        LEFT JOIN v_accounts va ON p.facebook_user_id = va.facebook_user_id
        LEFT JOIN accounts a ON (
            p.facebook_user_id = a.uid 
            OR va.user_access_token = a.token
            OR va.facebook_user_id = a.uid
            OR (va.name IS NOT NULL AND va.name != '' AND va.name = a.profile_name)
        )
        {where_sql}
    """)
    page_rows = db.execute(sql, params).mappings().all()
    page_dict = {str(r["page_id"]): r["page_name"] for r in page_rows}
    allowed_page_ids = list(page_dict.keys())

    p_page = page if isinstance(page, int) else None
    p_size = page_size if isinstance(page_size, int) else None
    p_limit = limit if isinstance(limit, int) else None
    p_offset = offset if isinstance(offset, int) else None
    s_type = notification_type.strip().lower() if isinstance(notification_type, str) else ""
    s_filter = filter.strip().lower() if isinstance(filter, str) else ""
    s_query = search.strip().lower() if isinstance(search, str) else ""

    is_paginated = p_page is not None or p_limit is not None or p_offset is not None or p_size is not None
    effective_page_size = p_size or p_limit or 20
    effective_page = p_page or ((p_offset // effective_page_size) + 1 if p_offset is not None else 1)
    effective_offset = p_offset if p_offset is not None else (effective_page - 1) * effective_page_size

    if not allowed_page_ids:
        if is_paginated:
            return PaginatedNotificationsOut(items=[], notifications=[], total=0, page=1, page_size=effective_page_size, total_pages=0)
        return []

    query = db.query(Notification)\
        .filter(Notification.created_time >= two_weeks_ago)\
        .filter(Notification.page_id.in_(allowed_page_ids))

    if s_type:
        query = query.filter(Notification.notification_type == s_type)
    if s_filter == "unread":
        query = query.filter(Notification.unread == True)
    elif s_filter == "unreplied":
        query = query.filter(Notification.is_replied == False)
    elif s_filter == "replied":
        query = query.filter(Notification.is_replied == True)

    if s_query:
        s = f"%{s_query}%"
        query = query.filter(
            or_(
                func.lower(Notification.title).like(s),
                func.lower(Notification.from_user_name).like(s),
            )
        )

    total = query.count()
    query = query.order_by(Notification.created_time.desc())

    if is_paginated:
        results = query.offset(effective_offset).limit(effective_page_size).all()
        total_pages = math.ceil(total / effective_page_size) if effective_page_size else 1
    else:
        results = query.all()
        total_pages = 1

    notif_list = []
    for notif in results:
        pid, cid = extract_post_and_comment_id(notif.facebook_notification_id, notif.link, notif.notification_type)
        data = {
            "id": notif.id,
            "facebook_notification_id": notif.facebook_notification_id,
            "page_id": notif.page_id,
            "page_name": getattr(notif, "page_name", None) or page_dict.get(str(notif.page_id)) or "Trang Facebook",
            "post_id": pid,
            "comment_id": cid,
            "title": notif.title,
            "link": notif.link,
            "created_time": notif.created_time,
            "unread": notif.unread,
            "is_replied": notif.is_replied,
            "from_user_id": notif.from_user_id,
            "from_user_name": notif.from_user_name,
            "from_user_avatar": notif.from_user_avatar,
            "notification_type": notif.notification_type,
            "reply_text": notif.reply_text,
            "my_reaction": notif.my_reaction,
            "replied_at": notif.replied_at
        }
        notif_list.append(data)

    if is_paginated:
        return PaginatedNotificationsOut(
            items=notif_list,
            notifications=notif_list,
            total=total,
            page=effective_page,
            page_size=effective_page_size,
            total_pages=total_pages
        )

    return notif_list

@router.put("/notifications/{notif_id}/read")
def mark_notification_read(
    notif_id: str,
    db: Session = Depends(get_db)
):
    """Mark a notification as read."""
    notif = db.query(Notification).filter(Notification.facebook_notification_id == notif_id).first()
    if notif:
        notif.unread = False
        db.commit()
        return {"success": True, "message": "Notification marked as read"}
    raise HTTPException(status_code=404, detail="Notification not found")
