"""Local HTTP API for Module 7 settings and AI content generation."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
import shutil
from typing import Any, Optional
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, field_validator

from ..ai_service import AIProviderError, generate_posts, list_gemini_models, test_connection
from ..group_source import (
    clean_group_url,
    get_posted_group_keys,
    get_sample_template,
    parse_group_file_content,
    search_facebook_groups,
)
from ..settings import group_settings, model_spec
from ..campaign import campaign_manager
from modules.module_02_account_manager.api.router import scoped_owner


router = APIRouter(prefix="/api/groups", tags=["Module 07: Group posting"])


class SettingsInput(BaseModel):
    model: str
    api_key: str | None = Field(default=None, max_length=512)
    threads: int = Field(ge=1, le=10)
    rest_minutes: int = Field(ge=0, le=1440)
    max_posts: int = Field(ge=1, le=1000)

    @field_validator("model")
    @classmethod
    def supported_model(cls, value: str) -> str:
        model_spec(value)
        return value

    @field_validator("api_key")
    @classmethod
    def clean_api_key(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None


class ConnectionTestInput(BaseModel):
    model: str
    api_key: str | None = Field(default=None, max_length=512)

    @field_validator("model")
    @classmethod
    def supported_model(cls, value: str) -> str:
        model_spec(value)
        return value


class GeneratePostsInput(ConnectionTestInput):
    prompt: str = Field(min_length=3, max_length=2000)
    count: int = Field(ge=1, le=10)


class ModelListInput(BaseModel):
    api_key: str | None = Field(default=None, max_length=512)


def _resolved_key(model: str, supplied_key: str | None) -> str:
    key = group_settings.get_api_key(model, supplied_key)
    if not key:
        raise HTTPException(422, "Chưa cấu hình API Key cho model đã chọn")
    return key


@router.get("/settings")
async def get_settings():
    return await asyncio.to_thread(group_settings.public)


@router.put("/settings")
async def save_settings(item: SettingsInput):
    _resolved_key(item.model, item.api_key)
    try:
        return await asyncio.to_thread(
            group_settings.save,
            model=item.model,
            api_key=item.api_key,
            threads=item.threads,
            rest_minutes=item.rest_minutes,
            max_posts=item.max_posts,
        )
    except OSError as exc:
        raise HTTPException(500, "Không thể lưu cấu hình Module 7 trên máy") from exc


@router.post("/settings/test")
async def check_ai_connection(item: ConnectionTestInput):
    key = _resolved_key(item.model, item.api_key)
    try:
        await asyncio.to_thread(test_connection, item.model, key)
    except AIProviderError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"success": True, "message": "Kết nối API thành công"}


@router.post("/ai/gemini-models")
async def get_gemini_models(item: ModelListInput):
    key = _resolved_key("gemini-3.8-flash", item.api_key)
    try:
        models = await asyncio.to_thread(list_gemini_models, key)
    except AIProviderError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not models:
        raise HTTPException(404, "API Key này không có model Gemini tạo văn bản khả dụng")
    return {"models": models, "count": len(models)}


@router.post("/ai/generate-posts")
async def create_ai_posts(item: GeneratePostsInput):
    key = _resolved_key(item.model, item.api_key)
    try:
        posts = await asyncio.to_thread(generate_posts, item.model, key, item.prompt, item.count)
    except AIProviderError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"posts": posts, "count": len(posts), "model": item.model}


# ==================== NGUỒN NHÓM (GROUP SOURCE) ====================

class ParseFileInput(BaseModel):
    content: str
    filter_posted: bool = False


class SearchGroupInput(BaseModel):
    keyword: str = Field(min_length=1, max_length=200)
    max_results: int = Field(default=50, ge=1, le=200)
    member_filter: str = Field(default="all")
    group_type: str = Field(default="all")
    frequency_filter: str = Field(default="all")
    account_uid: str | None = None


class CampaignInput(BaseModel):
    action_type: str = "POST"
    account_ids: list[Any] = Field(default_factory=list)
    account_uids: list[str] = Field(default_factory=list)
    groups: list[dict[str, Any]] = Field(default_factory=list)
    posts: list[str] = Field(default_factory=list)
    media: list[str] = Field(default_factory=list)
    settings: dict[str, Any] = Field(default_factory=dict)

    @field_validator("action_type")
    @classmethod
    def post_campaign_only(cls, value: str) -> str:
        value = value.strip().upper()
        if value != "POST":
            raise ValueError("Luồng này chỉ hỗ trợ chiến dịch đăng bài")
        return value

    @field_validator("account_uids")
    @classmethod
    def requires_accounts(cls, value: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(str(uid).strip() for uid in value if str(uid).strip()))
        if not cleaned:
            raise ValueError("Chưa chọn tài khoản Facebook nào")
        return cleaned

    @field_validator("posts")
    @classmethod
    def requires_content(cls, value: list[str]) -> list[str]:
        if not any(str(post).strip() for post in value):
            raise ValueError("Chưa có nội dung bài đăng")
        return value


@router.post("/source/parse")
async def parse_group_source(item: ParseFileInput):
    """Phân tích danh sách link nhóm từ chuỗi text (tách '?', dedup, lọc lỗi)."""
    try:
        return await asyncio.to_thread(parse_group_file_content, item.content, item.filter_posted)
    except Exception as exc:
        raise HTTPException(400, f"Lỗi đọc dữ liệu nhóm: {exc}") from exc


@router.post("/source/upload")
async def upload_group_source_file(file: UploadFile = File(...), filter_posted: bool = False):
    """Upload file .txt, .csv chứa danh sách link nhóm và trả về kết quả chuẩn hóa."""
    try:
        content_bytes = await file.read()
        content = content_bytes.decode("utf-8", errors="replace")
        return await asyncio.to_thread(parse_group_file_content, content, filter_posted)
    except Exception as exc:
        raise HTTPException(400, f"Lỗi upload file nhóm: {exc}") from exc


@router.get("/source/template")
async def download_group_template():
    """Tải file mẫu danh sách link nhóm Facebook (.txt)."""
    return PlainTextResponse(
        get_sample_template(),
        headers={"Content-Disposition": 'attachment; filename="mau_danh_sach_nhom_fb.txt"'},
    )


@router.post("/source/search")
async def search_groups(item: SearchGroupInput):
    """Tìm kiếm nhóm theo từ khóa (kế thừa FaceBook_Post_Group.py)."""
    try:
        results = await asyncio.to_thread(
            search_facebook_groups,
            item.keyword,
            item.max_results,
            item.member_filter,
            item.group_type,
            item.frequency_filter,
            item.account_uid,
        )
        return {"groups": results, "count": len(results)}
    except Exception as exc:
        raise HTTPException(400, f"Lỗi tìm kiếm nhóm: {exc}") from exc


@router.get("/source/history")
async def get_group_posting_history():
    """Lấy danh sách các nhóm đã đăng thành công từ PostgreSQL để tránh spam lặp lại hoặc nạp lại nhóm."""
    from modules.module_07_group_spam.group_source import get_posted_group_records
    groups = await asyncio.to_thread(get_posted_group_records)
    posted = await asyncio.to_thread(get_posted_group_keys)
    return {"posted_groups": list(posted), "history_groups": groups, "count": len(groups)}


UPLOAD_MEDIA_DIR = Path("data/module_07_group_spam/uploads")


@router.post("/media/upload")
async def upload_group_media(files: list[UploadFile] = File(...)):
    """Upload danh sách file media (ảnh/video) lưu vào backend phục vụ automation."""
    if not files:
        raise HTTPException(400, "Không có tệp media nào được gửi lên")

    UPLOAD_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    uploaded = []

    for file in files:
        try:
            ext = Path(file.filename or "").suffix.lower()
            safe_name = f"{uuid.uuid4().hex[:12]}{ext}"
            file_path = UPLOAD_MEDIA_DIR / safe_name

            with file_path.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            uploaded.append({
                "original_name": file.filename,
                "saved_name": safe_name,
                "path": str(file_path.resolve()),
                "relative_path": str(file_path).replace("\\", "/"),
                "size": file_path.stat().st_size,
            })
        except Exception as exc:
            raise HTTPException(500, f"Lỗi lưu tệp {file.filename}: {exc}") from exc

    return {
        "success": True,
        "message": f"Đã tải lên thành công {len(uploaded)} tệp media",
        "files": uploaded,
    }


@router.get("/media/list")
async def list_group_media():
    """Liệt kê các tệp media đã lưu trong thư mục uploads của module 7."""
    UPLOAD_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for p in UPLOAD_MEDIA_DIR.iterdir():
        if p.is_file():
            items.append({
                "name": p.name,
                "path": str(p.resolve()),
                "relative_path": str(p).replace("\\", "/"),
                "size": p.stat().st_size,
            })
    return {"files": items, "count": len(items)}


@router.post("/campaign")
async def start_group_campaign(item: CampaignInput, owner: str | None = Depends(scoped_owner)):
    """Khởi động worker đăng bài và trả về job để frontend theo dõi."""
    if not item.groups:
        raise HTTPException(400, "Chưa chọn nhóm Facebook nào để chạy chiến dịch")
    try:
        job = campaign_manager.start(item.model_dump(), owner)
        # Giữ cờ `success` của hợp đồng API cũ; số lượt thành công nằm ở success_count.
        return {**job, "success_count": job.get("success", 0), "success": True}
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/campaign/current")
async def get_current_group_campaign(owner: str | None = Depends(scoped_owner)):
    return campaign_manager.current(owner) or {"status": "IDLE"}


@router.get("/campaign/{job_id}")
async def get_group_campaign(job_id: str, owner: str | None = Depends(scoped_owner)):
    job = campaign_manager.get(job_id, owner)
    if not job:
        raise HTTPException(404, "Không tìm thấy chiến dịch")
    return job


@router.post("/campaign/{job_id}/stop")
async def stop_group_campaign(job_id: str, owner: str | None = Depends(scoped_owner)):
    job = campaign_manager.stop(job_id, owner)
    if not job:
        raise HTTPException(404, "Không tìm thấy chiến dịch")
    return job

