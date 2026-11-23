"""
Package routes cho Module 08: Interaction Seeding.
"""

from modules.module_08_interaction_seeding.routes.seeding_routes import (
    router,
    seeding_router,
)
from modules.module_08_interaction_seeding.routes.post_fetch_routes import router as post_fetch_router
from modules.module_08_interaction_seeding.routes.run_routes import router as run_router

# /api/seeding/post-fetch/... (Lấy bài viết từ page / trang cá nhân)
seeding_router.include_router(post_fetch_router)
# /api/seeding/campaigns/{id}/pause|resume|batch-progress|retry-failed, /campaigns/preview, /templates
seeding_router.include_router(run_router)

__all__ = [
    "router",
    "seeding_router",
]
