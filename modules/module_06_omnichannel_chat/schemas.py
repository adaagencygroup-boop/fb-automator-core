from pydantic import BaseModel, HttpUrl
from typing import Dict, List, Optional
from datetime import datetime

# Base schemas
class PageBase(BaseModel):
    page_id: str
    page_name: str
    avatar_url: Optional[str] = None
    status: str = "active"

class PageCreate(PageBase):
    page_access_token: str
    facebook_user_id: str

class PageUpdate(BaseModel):
    page_name: str
    page_access_token: str
    facebook_user_id: str
    avatar_url: Optional[str] = None
    status: Optional[str] = None

# API Response schema for pages
class PageOut(PageBase):
    id: int
    facebook_user_id: str

    class Config:
        from_attributes = True

# API Response schema for Sync process
class SyncResponse(BaseModel):
    success: bool
    message: str
    synced_count: int
    pages: List[PageOut]

# Schema for direct token-based sync
class TokenInput(BaseModel):
    access_token: str

class SyncByTokenResponse(BaseModel):
    success: bool
    message: str
    facebook_user_id: str
    synced_count: Optional[int] = 0
    pages_count: Optional[int] = 0
    pages: List[PageOut]

# Schema for Messages
class MessageOut(BaseModel):
    id: int
    facebook_message_id: str = ""
    page_id: str
    sender_id: str
    text: Optional[str] = None
    timestamp: Optional[int] = None
    direction: str = "inbound" # 'inbound' or 'outbound'
    reactions: Optional[str] = None
    reply_to_message_id: Optional[str] = None
    is_read: bool = False
    is_replied: bool = False
    created_at: datetime

    class Config:
        from_attributes = True

# Schema for Notifications
class NotificationOut(BaseModel):
    id: int
    facebook_notification_id: str
    page_id: str
    page_name: Optional[str] = None
    post_id: Optional[str] = None
    comment_id: Optional[str] = None
    title: str
    link: Optional[str] = None
    created_time: datetime
    unread: bool
    is_replied: bool = False
    from_user_id: Optional[str] = None
    from_user_name: Optional[str] = None
    from_user_avatar: Optional[str] = None
    notification_type: str = "comment"
    reply_text: Optional[str] = None
    my_reaction: Optional[str] = None
    replied_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# Schema for replying/sending message
class SendReplyInput(BaseModel):
    page_id: str
    recipient_id: str
    text: str
    reply_to_message_id: Optional[str] = None

# Schema for Accounts
class AccountBase(BaseModel):
    facebook_user_id: str
    name: Optional[str] = "Tài khoản Facebook"

class AccountCreate(AccountBase):
    system_user_id: int
    user_access_token: str

class AccountOut(AccountBase):
    id: int
    system_user_id: int
    user_access_token_long_lived: Optional[str] = None

    class Config:
        from_attributes = True

# ===== 🚀 CÁC SCHEMAS NÂNG CẤP CHO MODULE 6 (ENTERPRISE) =====

class CustomerBase(BaseModel):
    psid: str
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[str] = None

class CustomerCreate(CustomerBase):
    pass

class CustomerOut(CustomerBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

class ConversationOut(BaseModel):
    id: int
    page_id: str
    customer_psid: str
    customer_name: Optional[str] = None
    customer_avatar: Optional[str] = None
    last_message: Optional[str] = None
    last_message_at: datetime
    is_read: bool = False
    is_replied: bool = False
    is_starred: bool = False
    tags: Optional[str] = None
    assigned_user_id: Optional[int] = None

    class Config:
        from_attributes = True

class TagUpdateInput(BaseModel):
    page_id: str
    customer_psid: str
    tags: str

class StarUpdateInput(BaseModel):
    page_id: str
    customer_psid: str
    is_starred: bool

class PushSubscriptionInput(BaseModel):
    facebook_user_id: Optional[str] = None
    endpoint: str
    p256dh: Optional[str] = None
    auth: Optional[str] = None

class ReactInput(BaseModel):
    page_id: str
    recipient_id: str
    reaction: str

class SendAttachmentUrlInput(BaseModel):
    page_id: str
    recipient_id: str
    attachment_type: str
    url: str
    reply_to_message_id: Optional[str] = None

class CommentReplyInput(BaseModel):
    page_id: str
    text: Optional[str] = ""
    attachment_url: Optional[str] = None

class CommentReactInput(BaseModel):
    page_id: str
    reaction: str  # LIKE, LOVE, HAHA, WOW, SAD, ANGRY
    # False = bo thich (DELETE /{comment_id}/likes)
    liked: bool = True

class CommentHideInput(BaseModel):
    page_id: str
    is_hidden: bool = True

class PostLikeInput(BaseModel):
    page_id: str
    # False = bo thich (DELETE /{post_id}/likes)
    liked: bool = True

class PostCommentInput(BaseModel):
    page_id: str
    message: str
    attachment_url: Optional[str] = None

# ===== 📄 CÁC SCHEMAS PHÂN TRANG (PAGINATION) =====

class PaginatedResponse(BaseModel):
    total: int
    page: int
    page_size: int
    total_pages: int

class PaginatedPagesOut(PaginatedResponse):
    items: List[PageOut]
    pages: Optional[List[PageOut]] = None

class PaginatedConversationsOut(PaginatedResponse):
    items: List[dict]
    conversations: Optional[List[dict]] = None

class PaginatedNotificationsOut(PaginatedResponse):
    items: List[NotificationOut]
    notifications: Optional[List[NotificationOut]] = None
    # So chua doc theo tung tab cua FE, khong an theo tab/filter dang chon
    unread_counts: Dict[str, int] = {}



