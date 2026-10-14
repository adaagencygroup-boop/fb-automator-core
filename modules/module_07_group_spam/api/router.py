"""Local HTTP API for Module 7 settings and AI content generation."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..ai_service import AIProviderError, generate_posts, list_gemini_models, test_connection
from ..settings import group_settings, model_spec


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
