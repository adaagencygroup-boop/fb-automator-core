"""Media upload and listing endpoints for Module 7."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from ..schemas.response import MediaListResponse, MediaUploadResponse
from ..services.media_service import MediaStorageError, list_stored_media, save_uploaded_media


router = APIRouter(prefix="/media", tags=["Module 07: Media"])


@router.post("/upload", response_model=MediaUploadResponse)
async def upload_group_media(
    files: list[UploadFile] = File(...),
    campaign_id: str | None = Query(None),
):
    if not files:
        raise HTTPException(400, "Không có tệp media nào được gửi lên")

    try:
        uploaded = await asyncio.to_thread(save_uploaded_media, files, campaign_id)
    except MediaStorageError as exc:
        raise HTTPException(400, str(exc)) from exc

    return {
        "success": True,
        "message": f"Đã tải lên thành công {len(uploaded)} tệp media",
        "files": uploaded,
    }


@router.get("/list", response_model=MediaListResponse)
async def list_group_media(campaign_id: str | None = Query(None)):
    items = await asyncio.to_thread(list_stored_media, campaign_id)
    return {"files": items, "count": len(items)}
