from sqlalchemy import Column, Integer, BigInteger, String, Text, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from modules.module_06_omnichannel_chat.database import Base

class SystemUser(Base):
    __tablename__ = "system_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    role = Column(String(50), default="customer", nullable=False) # 'admin' or 'customer'
    status = Column(String(50), default="pending", nullable=False) # 'pending', 'active', 'suspended'
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    accounts = relationship("Account", back_populates="system_user", cascade="all, delete-orphan")
    push_subscriptions = relationship("PushSubscription", back_populates="system_user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<SystemUser {self.email} (Role: {self.role}, Status: {self.status})>"

class Account(Base):
    __tablename__ = "v_accounts"

    id = Column(Integer, primary_key=True, index=True)
    system_user_id = Column(Integer, ForeignKey("system_users.id", ondelete="CASCADE"), nullable=False)
    facebook_user_id = Column(String(100), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    user_access_token = Column(Text, nullable=False)
    user_access_token_long_lived = Column(Text, nullable=True)

    system_user = relationship("SystemUser", back_populates="accounts")
    pages = relationship("Page", back_populates="account", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Account {self.name} (FB_ID: {self.facebook_user_id})>"

class Page(Base):
    __tablename__ = "v_pages"

    id = Column(Integer, primary_key=True, index=True)
    page_id = Column(String(100), unique=True, index=True, nullable=False)
    page_name = Column(String(255), nullable=False)
    page_access_token = Column(Text, nullable=False)
    
    facebook_user_id = Column(String(100), ForeignKey("v_accounts.facebook_user_id", ondelete="CASCADE"), nullable=False)
    avatar_url = Column(Text, nullable=True)
    status = Column(String(50), default="active", nullable=False)

    account = relationship("Account", back_populates="pages")

    def __repr__(self):
        return f"<Page {self.page_name} (ID: {self.page_id})>"

class Message(Base):
    __tablename__ = "v_messages"

    id = Column(Integer, primary_key=True, index=True)
    facebook_message_id = Column(String(100), unique=True, index=True, nullable=False)
    page_id = Column(String(100), index=True, nullable=False)
    sender_id = Column(String(100), index=True, nullable=False)
    text = Column(Text, nullable=True)
    timestamp = Column(BigInteger, nullable=True)
    direction = Column(String(50), default="inbound", nullable=False)
    reactions = Column(String(50), nullable=True)
    reply_to_message_id = Column(String(100), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    is_replied = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<Message {self.text[:20] if self.text else ''}>"

class Notification(Base):
    __tablename__ = "v_notifications"

    id = Column(Integer, primary_key=True, index=True)
    facebook_notification_id = Column(String(100), unique=True, index=True, nullable=False)
    page_id = Column(String(100), index=True, nullable=False)
    page_name = Column(String(255), nullable=True)
    title = Column(Text, nullable=False)
    link = Column(Text, nullable=True)
    created_time = Column(DateTime, default=datetime.utcnow)
    unread = Column(Boolean, default=True, nullable=False)
    is_replied = Column(Boolean, default=False, nullable=False)
    from_user_id = Column(String(100), nullable=True)
    from_user_name = Column(String(255), nullable=True)
    from_user_avatar = Column(Text, nullable=True)
    notification_type = Column(String(50), default="comment", nullable=False)
    reply_text = Column(Text, nullable=True)
    my_reaction = Column(String(50), nullable=True)
    replied_at = Column(DateTime, nullable=True)

    def __repr__(self):
        return f"<Notification {self.title[:30]}...>"

class PushSubscription(Base):
    __tablename__ = "v_push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    system_user_id = Column(Integer, ForeignKey("system_users.id", ondelete="CASCADE"), nullable=True)
    facebook_user_id = Column(String(100), nullable=True, index=True)
    endpoint = Column(Text, nullable=False)
    p256dh = Column(Text, nullable=False)
    auth = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    system_user = relationship("SystemUser", back_populates="push_subscriptions")

    def __repr__(self):
        return f"<PushSubscription (User: {self.system_user_id})>"

class Customer(Base):
    """Bảng quản lý thông tin khách hàng chuyên sâu (Thay thế file JSON cache đệm)"""
    __tablename__ = "v_customers"

    id = Column(Integer, primary_key=True, index=True)
    psid = Column(String(100), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=True)
    avatar_url = Column(Text, nullable=True)
    phone = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    tags = Column(String(255), nullable=True) # Nhãn phân loại khách hàng
    created_at = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<Customer {self.name} (PSID: {self.psid})>"

class Conversation(Base):
    """Bảng quản lý danh bạ hội thoại tập trung (Tải Sidebar mượt gấp 100 lần, hỗ trợ Tag & Star)"""
    __tablename__ = "v_conversations"

    id = Column(Integer, primary_key=True, index=True)
    page_id = Column(String(100), index=True, nullable=False)
    customer_psid = Column(String(100), index=True, nullable=False)
    customer_name = Column(String(255), nullable=True)
    customer_avatar = Column(Text, nullable=True)
    last_message = Column(Text, nullable=True)
    last_message_at = Column(DateTime, default=datetime.utcnow)
    is_read = Column(Boolean, default=False, nullable=False)
    is_replied = Column(Boolean, default=False, nullable=False)
    is_starred = Column(Boolean, default=False, nullable=False) # Đánh dấu sao ⭐
    tags = Column(String(255), nullable=True)                     # Gắn nhãn ("Tư vấn Pháp Luật", "Khách VIP"...)
    assigned_user_id = Column(Integer, ForeignKey("system_users.id", ondelete="SET NULL"), nullable=True)

    def __repr__(self):
        return f"<Conversation Page:{self.page_id} Customer:{self.customer_name}>"
