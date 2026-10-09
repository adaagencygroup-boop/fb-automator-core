from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from modules.module_06_omnichannel_chat.models import Notification, Page

class NotificationRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_fb_notification_id(self, facebook_notification_id: str) -> Optional[Notification]:
        return self.db.query(Notification).filter(Notification.facebook_notification_id == facebook_notification_id).first()

    def get_notifications_by_facebook_user_id(self, facebook_user_id: str, limit: int = 50) -> List[Notification]:
        two_weeks_ago = datetime.utcnow() - timedelta(days=14)
        return self.db.query(Notification)\
            .join(Page, Page.page_id == Notification.page_id)\
            .filter(Page.facebook_user_id == facebook_user_id)\
            .filter(Notification.created_time >= two_weeks_ago)\
            .order_by(Notification.created_time.desc())\
            .limit(limit)\
            .all()
