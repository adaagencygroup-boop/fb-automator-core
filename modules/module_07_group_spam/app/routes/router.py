"""Aggregate the domain routers exposed by Module 7."""

from fastapi import APIRouter

from ..core.constants import MODULE_API_PREFIX
from .campaign import router as campaign_router
from .campaign_management import router as campaign_mgmt_router
from .group_source import router as group_source_router
from .media import router as media_router
from .settings import router as settings_router


router = APIRouter(prefix=MODULE_API_PREFIX)
for domain_router in (settings_router, group_source_router, media_router, campaign_router, campaign_mgmt_router):
    router.include_router(domain_router)

__all__ = ["router"]
