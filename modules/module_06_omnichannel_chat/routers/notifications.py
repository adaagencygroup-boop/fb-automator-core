from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.schemas import NotificationOut
from modules.module_06_omnichannel_chat.auth import get_current_user_optional
from modules.module_06_omnichannel_chat.models import Notification, Page, Account, SystemUser

router = APIRouter(prefix="/api/facebook", tags=["Notifications"])

@router.get("/notifications", response_model=List[NotificationOut])
def get_notifications(
    facebook_user_id: Optional[str] = None,
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

    query = db.query(Notification, Page.page_name.label("joined_page_name"))\
        .outerjoin(Page, Page.page_id == Notification.page_id)\
        .filter(Notification.created_time >= two_weeks_ago)

    if current_user and current_user.role != "admin":
        query = query.join(Account, Page.facebook_user_id == Account.facebook_user_id).filter(Account.system_user_id == current_user.id)

    if facebook_user_id:
        query = query.filter(Page.facebook_user_id == facebook_user_id)

    results = query.order_by(Notification.created_time.desc()).all()

    notif_list = []
    for notif, joined_page_name in results:
        data = {
            "id": notif.id,
            "facebook_notification_id": notif.facebook_notification_id,
            "page_id": notif.page_id,
            "page_name": getattr(notif, "page_name", None) or joined_page_name or "Trang Facebook",
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
