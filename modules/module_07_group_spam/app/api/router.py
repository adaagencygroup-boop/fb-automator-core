"""Aggregate the domain routers exposed by Module 7."""

from fastapi import APIRouter

from ..utils.constants import MODULE_API_PREFIX
from .routes import all_routers


router = APIRouter(prefix=MODULE_API_PREFIX)
for domain_router in all_routers:
    router.include_router(domain_router)

__all__ = ["router"]
