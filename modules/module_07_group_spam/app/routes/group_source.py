"""Facebook group-source endpoints for Module 7."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from modules.module_02_account_manager.api.router import scoped_owner

from ..services.group_source import (
    get_posted_group_keys,
    get_posted_group_records,
    get_sample_template,
    parse_group_file_content,
    search_facebook_groups,
)
from ..schemas.request import ParseFileInput, SearchGroupInput
from ..schemas.response import GroupHistoryResponse, GroupSearchResponse, ParsedGroupsResponse


router = APIRouter(prefix="/source", tags=["Module 07: Group source"])


@router.post("/parse", response_model=ParsedGroupsResponse, response_model_exclude_none=True)
async def parse_group_source(item: ParseFileInput, owner: str | None = Depends(scoped_owner)):
    try:
        return await asyncio.to_thread(parse_group_file_content, item.content, item.filter_posted, owner)
    except Exception as exc:
        raise HTTPException(400, f"Lỗi đọc dữ liệu nhóm: {exc}") from exc


@router.post("/upload", response_model=ParsedGroupsResponse, response_model_exclude_none=True)
async def upload_group_source_file(
    file: UploadFile = File(...), filter_posted: bool = False,
    owner: str | None = Depends(scoped_owner),
):
    try:
        content = (await file.read()).decode("utf-8", errors="replace")
        return await asyncio.to_thread(parse_group_file_content, content, filter_posted, owner)
    except Exception as exc:
        raise HTTPException(400, f"Lỗi upload file nhóm: {exc}") from exc


@router.get("/template")
async def download_group_template():
    return PlainTextResponse(
        get_sample_template(),
        headers={"Content-Disposition": 'attachment; filename="mau_danh_sach_nhom_fb.txt"'},
    )


@router.post("/search", response_model=GroupSearchResponse, response_model_exclude_none=True)
async def search_groups(item: SearchGroupInput, owner: str | None = Depends(scoped_owner)):
    try:
        results = await asyncio.to_thread(
            search_facebook_groups,
            item.keyword,
            item.max_results,
            item.member_filter,
            item.group_type,
            item.frequency_filter,
            item.account_uid,
            owner,
            item.membership_filter,
        )
        return {"groups": results, "count": len(results)}
    except Exception as exc:
        raise HTTPException(400, f"Lỗi tìm kiếm nhóm: {exc}") from exc


@router.get("/history", response_model=GroupHistoryResponse, response_model_exclude_none=True)
async def get_group_posting_history(owner: str | None = Depends(scoped_owner)):
    groups = await asyncio.to_thread(get_posted_group_records, owner)
    posted = await asyncio.to_thread(get_posted_group_keys, owner)
    return {"posted_groups": list(posted), "history_groups": groups, "count": len(groups)}
