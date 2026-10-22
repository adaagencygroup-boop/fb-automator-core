"""Settings and AI-content endpoints for Module 7."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from ..core.settings import group_settings
from ..services.ai_service import (
    AIProviderError,
    generate_posts,
    list_gemini_models,
    test_connection,
)
from ..schemas.request import (
    CredentialInput,
    ConnectionTestInput,
    GeneratePostsInput,
    ModelListInput,
    SettingsInput,
)
from ..schemas.response import (
    GeneratedPostsResponse,
    GeminiModelListResponse,
    MessageResponse,
    SettingsResponse,
)


router = APIRouter(tags=["Module 07: Settings & AI"])


def _resolved_key(model: str, supplied_key: str | None, credential_id: str | None = None, *, exact_model: bool = True) -> str:
    try:
        key = group_settings.credential_key(credential_id, model, exact_model=exact_model) if credential_id else group_settings.get_api_key(model, supplied_key)
        if supplied_key and supplied_key.strip():
            key = supplied_key.strip()
    except KeyError as exc:
        raise HTTPException(404, exc.args[0]) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not key:
        raise HTTPException(422, "Chưa cấu hình API Key cho model đã chọn")
    return key


@router.get("/settings", response_model=SettingsResponse)
async def get_settings():
    return await asyncio.to_thread(group_settings.public)


@router.put("/settings", response_model=SettingsResponse)
async def save_settings(item: SettingsInput):
    _resolved_key(item.model, item.api_key, item.credential_id)
    try:
        return await asyncio.to_thread(
            group_settings.save,
            model=item.model,
            credential_id=item.credential_id,
            api_key=item.api_key,
            threads=item.threads,
            rest_minutes=item.rest_minutes,
            max_posts=item.max_posts,
        )
    except OSError as exc:
        raise HTTPException(500, "Không thể lưu cấu hình Module 7 trên máy") from exc
    except KeyError as exc:
        raise HTTPException(404, exc.args[0]) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/settings/test", response_model=MessageResponse)
async def check_ai_connection(item: ConnectionTestInput):
    key = _resolved_key(item.model, item.api_key, item.credential_id, exact_model=False)
    try:
        await asyncio.to_thread(test_connection, item.model, key)
    except AIProviderError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"success": True, "message": "Kết nối API thành công"}


@router.post("/ai/gemini-models", response_model=GeminiModelListResponse)
async def get_gemini_models(item: ModelListInput):
    key = _resolved_key("gemini-3.8-flash", item.api_key, item.credential_id, exact_model=False)
    try:
        models = await asyncio.to_thread(list_gemini_models, key)
    except AIProviderError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not models:
        raise HTTPException(404, "API Key này không có model Gemini tạo văn bản khả dụng")
    return {"models": models, "count": len(models)}


@router.post("/ai/generate-posts", response_model=GeneratedPostsResponse)
async def create_ai_posts(item: GeneratePostsInput):
    key = _resolved_key(item.model, item.api_key, item.credential_id)
    try:
        posts = await asyncio.to_thread(generate_posts, item.model, key, item.prompt, item.count)
    except AIProviderError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"posts": posts, "count": len(posts), "model": item.model}


@router.get("/credentials")
async def list_credentials():
    return await asyncio.to_thread(group_settings.credentials)


@router.post("/ai/generate-comments")
async def create_ai_comments(item: GeneratePostsInput):
    key = _resolved_key(item.model, item.api_key, item.credential_id)
    try:
        comments = await asyncio.to_thread(generate_posts, item.model, key, item.prompt, item.count, comment=True)
    except AIProviderError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"comments": comments, "count": len(comments), "model": item.model}


async def _save_credential(item: CredentialInput, credential_id: str | None = None):
    try:
        return await asyncio.to_thread(group_settings.save_credential, name=item.name or item.model, model=item.model, api_key=item.api_key, credential_id=credential_id)
    except KeyError as exc:
        raise HTTPException(404, exc.args[0]) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(500, "Không thể lưu API trên máy") from exc


@router.post("/credentials", status_code=201)
async def add_credential(item: CredentialInput):
    return await _save_credential(item)


@router.put("/credentials/{credential_id}")
async def edit_credential(credential_id: str, item: CredentialInput):
    return await _save_credential(item, credential_id)


@router.delete("/credentials/{credential_id}")
async def delete_credential(credential_id: str):
    try:
        await asyncio.to_thread(group_settings.delete_credential, credential_id)
    except KeyError as exc:
        raise HTTPException(404, exc.args[0]) from exc
    except OSError as exc:
        raise HTTPException(500, "Không thể xóa API trên máy") from exc
    return {"success": True}
