"""Request models for the Module 7 HTTP API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

from ..core.constants import (
    ActionType,
    MAX_MAX_POSTS,
    MAX_REST_MINUTES,
    MAX_THREADS,
    MIN_MAX_POSTS,
    MIN_REST_MINUTES,
    MIN_THREADS,
)
from ..core.settings import model_spec


class SettingsInput(BaseModel):
    credential_id: str | None = Field(default=None, max_length=100)
    model: str
    api_key: str | None = Field(default=None, max_length=512)
    threads: int = Field(ge=MIN_THREADS, le=MAX_THREADS)
    rest_minutes: int = Field(ge=MIN_REST_MINUTES, le=MAX_REST_MINUTES)
    max_posts: int = Field(ge=MIN_MAX_POSTS, le=MAX_MAX_POSTS)

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
    credential_id: str | None = Field(default=None, max_length=100)
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
    credential_id: str | None = Field(default=None, max_length=100)
    api_key: str | None = Field(default=None, max_length=512)


class CredentialInput(ConnectionTestInput):
    name: str | None = Field(default=None, min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def nonblank_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Tên API không được để trống")
        return value.strip() if value is not None else None


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
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    action_type: str = ActionType.POST.value
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
        if value != ActionType.POST.value:
            raise ValueError("Luồng này chỉ hỗ trợ chiến dịch đăng bài")
        return value

    @field_validator("account_uids")
    @classmethod
    def requires_accounts(cls, value: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(str(uid).strip() for uid in value if str(uid).strip()))
        if not cleaned:
            raise ValueError("Chưa chọn tài khoản Facebook nào")
        return cleaned

    @field_validator("groups")
    @classmethod
    def unique_valid_groups(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        unique: list[dict[str, Any]] = []
        seen: set[str] = set()
        for group in value:
            url = str(group.get("url") or "").strip()
            key = str(group.get("key") or group.get("uid") or url).strip().lower()
            if not url or not key or key in seen:
                continue
            seen.add(key)
            unique.append(group)
        if not unique:
            raise ValueError("Chưa chọn nhóm Facebook hợp lệ")
        return unique

    @field_validator("media")
    @classmethod
    def unique_media(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(str(path).strip() for path in value if str(path).strip()))

    @field_validator("posts")
    @classmethod
    def requires_content(cls, value: list[str]) -> list[str]:
        if not any(str(post).strip() for post in value):
            raise ValueError("Chưa có nội dung bài đăng")
        return value


__all__ = [
    "CampaignInput",
    "ConnectionTestInput",
    "GeneratePostsInput",
    "ModelListInput",
    "ParseFileInput",
    "SearchGroupInput",
    "SettingsInput",
]
