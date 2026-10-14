from fastapi import APIRouter
from modules.module_06_omnichannel_chat.routers.webhooks import router as webhooks_router
from modules.module_06_omnichannel_chat.routers.pages import router as pages_router
from modules.module_06_omnichannel_chat.routers.messages import router as messages_router
from modules.module_06_omnichannel_chat.routers.comments import router as comments_router
from modules.module_06_omnichannel_chat.routers.notifications import router as notifications_router
from modules.module_06_omnichannel_chat.routers.posts import router as posts_router
from modules.module_06_omnichannel_chat.routers.push import router as push_router
from modules.module_06_omnichannel_chat.routers.system import router as system_router

all_routers = [
    webhooks_router,
    pages_router,
    messages_router,
    comments_router,
    notifications_router,
    posts_router,
    push_router,
    system_router,
]

router = APIRouter()
for r in all_routers:
    router.include_router(r)

__all__ = [
    "router",
    "all_routers",
    "webhooks_router",
    "pages_router",
    "messages_router",
    "comments_router",
    "notifications_router",
    "posts_router",
    "push_router",
    "system_router",
]
