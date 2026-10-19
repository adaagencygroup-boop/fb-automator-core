from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from datetime import datetime, timedelta
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.schemas import NotificationOut
from modules.module_06_omnichannel_chat.auth import get_current_user_optional
from modules.module_06_omnichannel_chat.routers.pages import resolve_current_user_id
from modules.module_06_omnichannel_chat.models import Notification, Page, Account, SystemUser

router = APIRouter(prefix="/api/facebook", tags=["Notifications"])

@router.get("/notifications", response_model=List[NotificationOut])
def get_notifications(
    request: Request,
    facebook_user_id: Optional[str] = None,
    user_id: Optional[str] = None,
    page_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[SystemUser] = Depends(get_current_user_optional)
):
    """Fetch all notifications associated with a Facebook User ID (within last 14 days / 2 weeks)."""
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
        LEFT JOIN accounts a ON (p.facebook_user_id = a.uid OR va.user_access_token = a.token)
        {where_sql}
    """)
    page_rows = db.execute(sql, params).mappings().all()
    page_dict = {str(r["page_id"]): r["page_name"] for r in page_rows}
    allowed_page_ids = list(page_dict.keys())

    if not allowed_page_ids:
        return []

    results = db.query(Notification)\
        .filter(Notification.created_time >= two_weeks_ago)\
        .filter(Notification.page_id.in_(allowed_page_ids))\
        .order_by(Notification.created_time.desc())\
        .all()

    notif_list = []
    for notif in results:
        data = {
            "id": notif.id,
            "facebook_notification_id": notif.facebook_notification_id,
            "page_id": notif.page_id,
            "page_name": getattr(notif, "page_name", None) or page_dict.get(str(notif.page_id)) or "Trang Facebook",
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
