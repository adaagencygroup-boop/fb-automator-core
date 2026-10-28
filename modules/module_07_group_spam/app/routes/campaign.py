"""Campaign lifecycle endpoints for Module 7."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from modules.module_02_account_manager.api.router import scoped_owner

from ..services.campaign import campaign_manager
from ..services.media_service import (
    MediaStorageError,
    resolve_media_paths,
    resolve_media_tokens_for_config,
)
from ..schemas.request import CampaignInput
from ..schemas.response import CampaignStartedResponse, CampaignStatusResponse
from .settings import _resolved_key


router = APIRouter(prefix="/campaign", tags=["Module 07: Campaign"])


@router.post("", response_model=CampaignStartedResponse)
async def start_group_campaign(item: CampaignInput, owner: str | None = Depends(scoped_owner)):
    if not item.groups:
        raise HTTPException(400, "Chưa chọn nhóm Facebook nào để chạy chiến dịch")
    if item.settings.get("credential_id"):
        _resolved_key(item.settings.get("model", ""), None, item.settings["credential_id"])
    try:
        payload = item.model_dump()
        payload["media"] = resolve_media_tokens_for_config(item.media, item.campaign_id)
        job = campaign_manager.start(payload, owner)
        return {**job, "success_count": job.get("success", 0), "success": True}
    except (MediaStorageError, RuntimeError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/current", response_model=CampaignStatusResponse, response_model_exclude_unset=True)
async def get_current_group_campaign(owner: str | None = Depends(scoped_owner)):
    return campaign_manager.current(owner) or {"status": "IDLE"}


@router.get("/{job_id}", response_model=CampaignStatusResponse)
async def get_group_campaign(job_id: str, owner: str | None = Depends(scoped_owner)):
    job = campaign_manager.get(job_id, owner)
    if not job:
        raise HTTPException(404, "Không tìm thấy chiến dịch")
    return job


@router.post("/{job_id}/stop", response_model=CampaignStatusResponse)
async def stop_group_campaign(job_id: str, owner: str | None = Depends(scoped_owner)):
    job = campaign_manager.stop(job_id, owner)
    if not job:
        raise HTTPException(404, "Không tìm thấy chiến dịch")
    return job
