"""Response models for the Module 7 HTTP API."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ProviderSettingsResponse(BaseModel):
    configured: bool
    hint: str


class SettingsResponse(BaseModel):
    credentials: list[dict] = Field(default_factory=list)
    credential_id: str | None = None
    model: str
    threads: int
    rest_minutes: int
    max_posts: int
    api_key_configured: bool
    api_key_hint: str
    providers: dict[str, ProviderSettingsResponse]


class MessageResponse(BaseModel):
    success: bool
    message: str


class GeminiModelResponse(BaseModel):
    id: str
    name: str


class GeminiModelListResponse(BaseModel):
    models: list[GeminiModelResponse]
    count: int


class GeneratedPostsResponse(BaseModel):
    posts: list[str]
    count: int
    model: str


class GroupResponse(BaseModel):
    id: str
    key: str
    name: str
    url: str
    uid: str
    frequency: str
    members: str
    privacy: str
    already_posted: bool
    mem_num: float | None = None


class ParsedGroupsResponse(BaseModel):
    groups: list[GroupResponse]
    total_lines: int
    valid_count: int
    dedup_count: int
    invalid_count: int
    already_posted_count: int


class GroupSearchResponse(BaseModel):
    groups: list[GroupResponse]
    count: int


class GroupHistoryResponse(BaseModel):
    posted_groups: list[str]
    history_groups: list[GroupResponse]
    count: int


class UploadedMediaResponse(BaseModel):
    original_name: str | None
    saved_name: str
    path: str
    relative_path: str
    size: int


class MediaUploadResponse(MessageResponse):
    files: list[UploadedMediaResponse]


class StoredMediaResponse(BaseModel):
    name: str
    path: str
    relative_path: str
    size: int


class MediaListResponse(BaseModel):
    files: list[StoredMediaResponse]
    count: int


class CampaignLogResponse(BaseModel):
    time: str
    level: str
    message: str


class CampaignResultResponse(BaseModel):
    account_uid: str
    group_key: str
    group_name: str | None = None
    group_url: str
    status: str
    message: str
    join_status: str | None = None


class CampaignStatusResponse(BaseModel):
    campaign_id: str | None = None
    action_type: str | None = None
    job_id: str | None = None
    status: str
    message: str | None = None
    total: int | None = None
    completed: int | None = None
    total_steps: int | None = None
    completed_steps: int | None = None
    success: int | None = None
    failed: int | None = None
    skipped: int | None = None
    joined: int | None = None
    already_member: int | None = None
    pending_approval: int | None = None
    progress: int | None = None
    started_at: str | None = None
    finished_at: str | None = None
    logs: list[CampaignLogResponse] | None = None
    results: list[CampaignResultResponse] | None = None


class CampaignStartedResponse(BaseModel):
    campaign_id: str
    action_type: str
    job_id: str
    status: str
    message: str
    total: int
    completed: int
    total_steps: int
    completed_steps: int
    success: bool
    success_count: int
    failed: int
    skipped: int
    joined: int
    already_member: int
    pending_approval: int
    progress: int
    started_at: str | None
    finished_at: str | None
    logs: list[CampaignLogResponse] = Field(default_factory=list)
    results: list[CampaignResultResponse] = Field(default_factory=list)


__all__ = [
    "CampaignStartedResponse",
    "CampaignStatusResponse",
    "GeneratedPostsResponse",
    "GeminiModelListResponse",
    "GroupHistoryResponse",
    "GroupSearchResponse",
    "MediaListResponse",
    "MediaUploadResponse",
    "MessageResponse",
    "ParsedGroupsResponse",
    "SettingsResponse",
]
