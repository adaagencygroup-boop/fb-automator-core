"""
FacebookSyncService Facade
Imports modular services from modules.module_06_omnichannel_chat.services:
- FacebookAuthService (Token exchange & Page Sync)
- FacebookChatService (Chat messaging, attachments, reactions)
- FacebookCommentService (Post comment replies & reactions)
- WebPushService (APNs/FCM Web Push notifications)
"""

from typing import List, Dict, Any, Tuple, Optional
from sqlalchemy.orm import Session

from modules.module_06_omnichannel_chat.services.facebook_auth import (
    FacebookAuthService,
    AccountNotFoundError,
    FacebookAuthError,
    FacebookAPIError
)
from modules.module_06_omnichannel_chat.services.facebook_chat import FacebookChatService
from modules.module_06_omnichannel_chat.services.facebook_comments import FacebookCommentService
from modules.module_06_omnichannel_chat.services.web_push import WebPushService
from modules.module_06_omnichannel_chat.services.sync_service import FacebookSyncService

__all__ = [
    "FacebookSyncService",
    "FacebookAuthService",
    "FacebookChatService",
    "FacebookCommentService",
    "WebPushService",
    "AccountNotFoundError",
    "FacebookAuthError",
    "FacebookAPIError",
]
