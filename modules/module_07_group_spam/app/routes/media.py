"""Media upload and listing endpoints for Module 7."""
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from config.constants import DATA_DIR
from ..constants.media_constant import ALLOWED_EXTENSIONS, UPLOAD_MEDIA_DIR
from ..schemas.response import MediaListResponse, MediaUploadResponse
from ..services.local_media import _find_local_file
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


@router.get("/file")
async def get_group_media_file(token: str = Query(..., min_length=1)):
    """Phục vụ tệp ảnh/video đã lưu trên máy cho preview khi chạy lại chiến dịch."""
    found = await asyncio.to_thread(_find_local_file, token)
    if not found or not found.is_file():
        raise HTTPException(404, "Không tìm thấy tệp media")

    resolved = found.resolve()
    allowed_roots = (
        UPLOAD_MEDIA_DIR.resolve(),
        (DATA_DIR / "module_07_group_spam").resolve(),
    )
    if (
        resolved.suffix.lower() not in ALLOWED_EXTENSIONS
        or not any(resolved.is_relative_to(root) for root in allowed_roots)
    ):
        raise HTTPException(403, "Đường dẫn media không hợp lệ")

    return FileResponse(resolved)
