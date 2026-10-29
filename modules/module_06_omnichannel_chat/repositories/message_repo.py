from datetime import datetime, timezone
from sqlalchemy.orm import Session
from typing import List, Optional
from modules.module_06_omnichannel_chat.models import Message, Page

def _dt_from_timestamp(timestamp: Optional[int]) -> datetime:
    if timestamp:
        try:
            return datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).replace(tzinfo=None)
        except Exception:
            pass
    return datetime.now(timezone.utc).replace(tzinfo=None)

class MessageRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_fb_message_id(self, facebook_message_id: str) -> Optional[Message]:
        return self.db.query(Message).filter(Message.facebook_message_id == facebook_message_id).first()

    def save_webhook_message(
        self, facebook_message_id: str, page_id: str, sender_id: str, text: str, timestamp: int, direction: str = "inbound", reply_to_message_id: Optional[str] = None
    ) -> Message:
        message = self.get_by_fb_message_id(facebook_message_id)
        if not message:
            message = Message(
                facebook_message_id=facebook_message_id,
                page_id=page_id,
                sender_id=sender_id,
                text=text,
                timestamp=timestamp,
                direction=direction,
                reply_to_message_id=reply_to_message_id,
                created_at=_dt_from_timestamp(timestamp)
            )
            self.db.add(message)
            self.db.commit()
            self.db.refresh(message)
        return message

    def save_message(
        self, facebook_message_id: str, page_id: str, sender_id: str, text: str, timestamp: int, direction: str = "inbound", is_read: bool = True, reply_to_message_id: Optional[str] = None
    ) -> Message:
        message = self.get_by_fb_message_id(facebook_message_id)
        if not message:
            message = Message(
                facebook_message_id=facebook_message_id,
                page_id=page_id,
                sender_id=sender_id,
                text=text,
                timestamp=timestamp,
                direction=direction,
                is_read=is_read,
                reply_to_message_id=reply_to_message_id,
                created_at=_dt_from_timestamp(timestamp)
            )
            self.db.add(message)
            self.db.commit()
            self.db.refresh(message)
        return message

    def save_reaction(self, facebook_message_id: str, emoji: Optional[str]) -> Optional[Message]:
        message = self.get_by_fb_message_id(facebook_message_id)
        if message:
            message.reactions = emoji
            self.db.commit()
            self.db.refresh(message)
        return message

    def delete_message(self, facebook_message_id: str) -> bool:
        message = self.get_by_fb_message_id(facebook_message_id)
        if message:
            self.db.delete(message)
            self.db.commit()
            return True
        return False

    def get_messages_by_page_id(self, page_id: str, limit: int = 50) -> List[Message]:
        return self.db.query(Message).filter(Message.page_id == page_id).order_by(Message.created_at.desc()).limit(limit).all()

    def get_messages_by_facebook_user_id(self, facebook_user_id: str, limit: int = 50) -> List[Message]:
        return self.db.query(Message)\
            .join(Page, Page.page_id == Message.page_id)\
            .filter(Page.facebook_user_id == facebook_user_id)\
            .order_by(Message.created_at.desc())\
            .limit(limit)\
            .all()

    def get_latest_message(self, page_id: str, sender_id: str) -> Optional[Message]:
        return self.db.query(Message)\
            .filter(Message.page_id == page_id, Message.sender_id == sender_id)\
            .order_by(Message.created_at.desc(), Message.id.desc())\
            .first()

