from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
from modules.module_06_omnichannel_chat.models import Conversation

class ConversationRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_conversation(self, page_id: str, customer_psid: str) -> Optional[Conversation]:
        """Lấy thông tin cuộc hội thoại giữa Page và Khách hàng."""
        return self.db.query(Conversation).filter(
            Conversation.page_id == page_id,
            Conversation.customer_psid == customer_psid
        ).first()

    def upsert_conversation(
        self,
        page_id: str,
        customer_psid: str,
        customer_name: Optional[str] = None,
        customer_avatar: Optional[str] = None,
        last_message: Optional[str] = None,
        is_read: bool = False,
        is_replied: bool = False
    ) -> Conversation:
        """Tạo hoặc cập nhật nhanh trạng thái danh bạ hội thoại (Tải Sidebar mượt gấp 100 lần)."""
        conv = self.get_conversation(page_id, customer_psid)
        now = datetime.utcnow()
        if conv:
            if customer_name: conv.customer_name = customer_name
            if customer_avatar: conv.customer_avatar = customer_avatar
            if last_message: conv.last_message = last_message
            conv.last_message_at = now
            conv.is_read = is_read
            conv.is_replied = is_replied
        else:
            conv = Conversation(
                page_id=page_id,
                customer_psid=customer_psid,
                customer_name=customer_name,
                customer_avatar=customer_avatar,
                last_message=last_message,
                last_message_at=now,
                is_read=is_read,
                is_replied=is_replied
            )
            self.db.add(conv)
        self.db.commit()
        self.db.refresh(conv)
        return conv

    def update_tags(self, page_id: str, customer_psid: str, tags: str) -> Optional[Conversation]:
        """Cập nhật nhãn phân loại hội thoại (ví dụ: 'Tư vấn Pháp Luật')."""
        conv = self.get_conversation(page_id, customer_psid)
        if conv:
            conv.tags = tags
            self.db.commit()
            self.db.refresh(conv)
        return conv

    def toggle_star(self, page_id: str, customer_psid: str, is_starred: bool) -> Optional[Conversation]:
        """Bật/tắt đánh dấu sao ⭐ hội thoại quan trọng."""
        conv = self.get_conversation(page_id, customer_psid)
        if conv:
            conv.is_starred = is_starred
            self.db.commit()
            self.db.refresh(conv)
        return conv

    def get_conversations_by_page(self, page_id: str, limit: int = 50) -> List[Conversation]:
        """Lấy danh sách hội thoại theo Page, sắp xếp theo tin mới nhất."""
        return self.db.query(Conversation)\
            .filter(Conversation.page_id == page_id)\
            .order_by(Conversation.last_message_at.desc())\
            .limit(limit)\
            .all()
