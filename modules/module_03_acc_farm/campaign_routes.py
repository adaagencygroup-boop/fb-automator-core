"""
campaign_routes.py
Module 03 - Tab 2: API chiến dịch đăng Status nhiều khung giờ (gắn vào router /api/post của post_routes).
"""
import logging
from uuid import UUID
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from modules.module_02_account_manager.api.router import scoped_owner
from modules.module_02_account_manager.context import owner_context
from modules.module_03_acc_farm import campaign_service, compose_repository
from modules.module_03_acc_farm.compose_service import (
    MAX_IMAGES_PER_POST,
    MAX_TIME_SLOTS,
    MIN_IMAGES_PER_POST,
)
from modules.module_03_acc_farm.post_now_service import ComposeInput
from modules.module_03_acc_farm.post_runner import runner

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(scoped_owner)])

MAX_COMPOSE_CHARS = 5_000_000
MAX_POOL_IMAGES = 2000


class CampaignComposePayload(BaseModel):
    content_text: str = Field("", max_length=MAX_COMPOSE_CHARS)
    content_mode: str = "MULTI"
    image_mode: str = "NONE"
    image_paths: List[str] = Field(default_factory=list, max_length=MAX_POOL_IMAGES)
    min_images: int = Field(1, ge=MIN_IMAGES_PER_POST, le=MAX_IMAGES_PER_POST)
    max_images: int = Field(1, ge=MIN_IMAGES_PER_POST, le=MAX_IMAGES_PER_POST)

    def to_input(self) -> ComposeInput:
        return ComposeInput(**self.model_dump())


class CampaignSettingsPayload(BaseModel):
    thread_count: int = Field(1, ge=1, le=50)
    min_delay: int = Field(600, ge=0, le=86400)
    max_delay: int = Field(900, ge=0, le=86400)


class CampaignPayload(BaseModel):
    name: str = Field("", max_length=campaign_service.MAX_NAME_LENGTH)
    accounts: List[Dict[str, Any]] = Field(..., max_length=5000)
    settings: CampaignSettingsPayload = Field(default_factory=CampaignSettingsPayload)
    compose: CampaignComposePayload
    # Các khung giờ HH:mm trong hôm nay (khi sửa: danh sách khung CHƯA CHẠY mới)
    slots: List[str] = Field(default_factory=list, max_length=MAX_TIME_SLOTS * 2)
    # Tạo chiến dịch xong thì xoá nháp ô soạn bài
    clear_draft: bool = True


class ComposeCheckPayload(BaseModel):
    account_count: int = Field(..., ge=0, le=5000)
    compose: CampaignComposePayload
    slots: List[str] = Field(default_factory=list, max_length=MAX_TIME_SLOTS * 2)
    settings: CampaignSettingsPayload = Field(default_factory=CampaignSettingsPayload)


class RerunPayload(BaseModel):
    # Rỗng = chạy ngay; "HH:mm" = chạy lúc đó trong hôm nay
    run_time: Optional[str] = None


def _owner() -> str:
    return owner_context.get() or ""


def _machine_id() -> str:
    from modules.module_03_acc_farm.adapters import get_machine_id
    return get_machine_id()


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except campaign_service.CampaignError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.post("/compose/check")
def check_compose(payload: ComposeCheckPayload):
    """Kiểm tra kho bài / ảnh / khung giờ trước khi Đăng ngay hoặc Tạo chiến dịch (không ghi gì)."""
    result = campaign_service.preview(
        payload.compose.to_input(), payload.account_count, payload.slots, payload.settings.model_dump(),
    )
    return {"success": True, **result}


@router.get("/campaigns")
def list_campaigns():
    return {"success": True, "data": campaign_service.campaign_list(_owner(), machine_id=_machine_id())}


@router.post("/campaigns")
def create_campaign(payload: CampaignPayload):
    result = _call(
        campaign_service.create_campaign,
        _owner(), _machine_id(),
        name=payload.name, accounts=payload.accounts, settings=payload.settings.model_dump(),
        compose=payload.compose.to_input(), slot_times=payload.slots,
    )
    if payload.clear_draft:
        try:
            compose_repository.clear_compose_draft("status")
        except Exception:
            logger.exception("Tạo chiến dịch xong nhưng không xoá được nháp ô soạn bài")
    return {"success": True, "data": result["campaign"], "warnings": result["warnings"]}


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: UUID):
    data = _call(campaign_service.campaign_detail, _owner(), str(campaign_id), runner=runner, machine_id=_machine_id())
    return {"success": True, "data": data}


@router.put("/campaigns/{campaign_id}")
def update_campaign(campaign_id: UUID, payload: CampaignPayload):
    result = _call(
        campaign_service.update_campaign,
        _owner(), str(campaign_id),
        name=payload.name, accounts=payload.accounts, settings=payload.settings.model_dump(),
        compose=payload.compose.to_input(), slot_times=payload.slots,
    )
    return {"success": True, "data": result["campaign"], "warnings": result["warnings"]}


@router.post("/campaigns/{campaign_id}/stop")
def stop_campaign(campaign_id: UUID):
    data = _call(campaign_service.stop_campaign, _owner(), str(campaign_id), runner=runner, machine_id=_machine_id())
    return {"success": True, "data": data, "message": "Đã dừng chiến dịch."}


@router.post("/campaigns/{campaign_id}/start")
def resume_campaign(campaign_id: UUID):
    data = _call(campaign_service.resume_campaign, _owner(), str(campaign_id))
    return {"success": True, "data": data, "message": "Chiến dịch chạy tiếp từ khung kế tiếp."}


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: UUID):
    _call(campaign_service.delete_campaign, _owner(), str(campaign_id), runner=runner, machine_id=_machine_id())
    return {"success": True, "message": "Đã xoá chiến dịch. Bài đã đăng vẫn còn trong Lịch sử."}


@router.post("/campaigns/{campaign_id}/slots/{slot_id}/rerun")
def rerun_slot(campaign_id: UUID, slot_id: UUID, payload: RerunPayload = RerunPayload()):
    data = _call(campaign_service.rerun_slot, _owner(), str(campaign_id), str(slot_id), payload.run_time)
    return {"success": True, "data": data, "message": "Đã xếp lịch chạy lại khung giờ."}
