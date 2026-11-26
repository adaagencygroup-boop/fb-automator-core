"""Module 13 — API Quét profile."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

import psycopg2.errors
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from modules.module_02_account_manager.api.router import scoped_owner
from modules.module_02_account_manager.context import owner_context
from modules.module_10_group_scan.models import normalize_group_id

from .. import engine, models
from ..parse import key_to_url, profile_key

router = APIRouter(prefix="/api/profile-scan", tags=["Module 13: Profile scan"], dependencies=[Depends(scoped_owner)])

MAX_TARGETS = 10000
COLOR = r"^#[0-9A-Fa-f]{6}$"


def _owner() -> str:
    current = owner_context.get()
    return str(current) if current and str(current).strip() else "system"


class TargetIn(BaseModel):
    uid: Optional[str] = Field(None, max_length=200)
    url: Optional[str] = Field(None, max_length=2000)
    name: Optional[str] = Field(None, max_length=500)
    avatar: Optional[str] = Field(None, max_length=4000)
    source_keys: List[str] = Field(default_factory=list, max_length=500)


class SourceIn(BaseModel):
    key: str = Field(..., min_length=1, max_length=255)
    type: Literal["group", "page", "post"]
    name: str = Field(..., max_length=1000)
    url: Optional[str] = None
    scale: Optional[int] = None
    scale_label: Optional[str] = None


class StartIn(BaseModel):
    account_uids: List[str] = Field(..., min_length=1, max_length=200)
    mode: Literal["source", "link", "file"]
    delay_min: float = Field(5, ge=1, le=180)
    delay_max: float = Field(8, ge=1, le=180)
    rotate_every: int = Field(0, ge=0, le=500)  # 0: không tự đổi tài khoản (giao diện đã bỏ thiết lập này)
    workers: int = Field(2, ge=1, le=5)
    skip_scanned: bool = True
    min_friends: int = Field(0, ge=0, le=5000)
    targets: List[TargetIn] = Field(..., min_length=1, max_length=MAX_TARGETS)
    sources: List[SourceIn] = Field(default_factory=list)


class CategoryIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str = Field("#2563EB", pattern=COLOR)


class SaveIn(BaseModel):
    category_id: Optional[int] = None
    name: Optional[str] = Field(None, max_length=100)
    color: str = Field("#2563EB", pattern=COLOR)
    uids: List[str] = Field(..., min_length=1)


class MembersIn(BaseModel):
    key: str = Field(..., max_length=255)
    uids: List[str] = Field(..., min_length=1)


class MoveIn(MembersIn):
    to_key: str = Field(..., max_length=255)


def _session_or_404(session_id: int) -> Dict[str, Any]:
    row = models.get_session(_owner(), session_id)
    if not row:
        raise HTTPException(404, "Không tìm thấy phiên quét")
    return row


def _view(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row["id"], "status": row["status"], "mode": row["mode"], "message": row["message"], **models.session_counts(row["id"]),
    }


# ==================== Phiên quét ====================


@router.post("/sessions")
def start_session(body: StartIn):
    owner = _owner()
    models.suspend_orphans(owner, engine.local_ids())
    sources = [s.model_dump() for s in body.sources if s.key.startswith(f"{s.type}:")]
    known = {s["key"] for s in sources}
    merged: Dict[str, Dict[str, Any]] = {}
    for t in body.targets:
        key = profile_key(t.uid) or profile_key(t.url)
        if not key:
            continue
        item = merged.setdefault(key, {"key": key, "url": key_to_url(key), "name": t.name, "avatar": t.avatar, "source_keys": []})
        item["source_keys"] += [s for s in dict.fromkeys(t.source_keys) if s in known and s not in item["source_keys"]]
    if not merged:
        raise HTTPException(422, "Không có profile hợp lệ để quét")
    settings = body.model_dump(exclude={"targets", "sources", "mode"})
    settings["delay_max"] = max(body.delay_min, body.delay_max)
    try:
        session_id = engine.start(owner, body.mode, settings, list(merged.values()), sources)
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(409, "Đang có phiên quét profile khác chạy")
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return {"session_id": session_id, "total": len(merged)}


@router.get("/sessions/latest")
def latest():
    owner = _owner()
    models.suspend_orphans(owner, engine.local_ids())
    row = models.latest_session(owner)
    return {"session": _view(row) if row else None}


@router.get("/sessions/{session_id}")
def progress(session_id: int, after_log: int = Query(0, ge=0)):
    models.suspend_orphans(_owner(), engine.local_ids())
    return {"session": _view(_session_or_404(session_id)), "logs": models.get_logs(session_id, after_log)}


@router.get("/sessions/{session_id}/results")
def results(session_id: int):
    _session_or_404(session_id)
    owner = _owner()
    return {"items": models.session_results(owner, session_id), "sources": models.session_sources(owner, session_id)}


@router.post("/sessions/{session_id}/pause")
def pause(session_id: int):
    _session_or_404(session_id)
    run = engine.get_run(session_id)
    if not run or run.stop_event.is_set() or not models.set_status(session_id, "PAUSED", None, only_from=("RUNNING",)):
        raise HTTPException(409, "Phiên không đang chạy trên máy này")
    run.pause_event.set()
    run.log("Tạm dừng", "warn")
    return {"ok": True}


@router.post("/sessions/{session_id}/resume")
def resume(session_id: int):
    row = _session_or_404(session_id)
    run = engine.get_run(session_id)
    if run:
        if run.stop_event.is_set():
            raise HTTPException(409, "Phiên đang dừng, vui lòng đợi vài giây")
        models.set_status(session_id, "RUNNING", None, only_from=("PAUSED",))
        run.pause_event.clear()
        run.log("Chạy tiếp")
        return {"ok": True}
    if models.pending_count(session_id) == 0:
        raise HTTPException(409, "Phiên không còn profile chưa quét")
    try:
        engine.resume(_owner(), row)
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(409, "Đang có phiên quét profile khác chạy")
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return {"ok": True}


@router.post("/sessions/{session_id}/stop")
def stop(session_id: int):
    _session_or_404(session_id)
    run = engine.get_run(session_id)
    if not run:
        raise HTTPException(409, "Phiên không đang chạy trên máy này")
    run.stop_event.set()
    run.log("Dừng khẩn cấp — đang đóng trình duyệt", "warn")
    run.kill_browsers()
    return {"ok": True}


# ==================== Danh sách profile ====================


@router.get("/collections")
def list_collections():
    return {"items": models.collections(_owner())}


@router.get("/collections/profiles")
def list_collection_profiles(key: str = Query(..., max_length=255)):
    return {"items": models.collection_profiles(_owner(), key)}


@router.get("/categories")
def list_categories():
    return {"items": models.categories(_owner())}


def _clean_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise HTTPException(422, "Tên danh mục không được để trống")
    if name.lower() == "chưa có danh mục":
        raise HTTPException(409, "Tên danh mục đã tồn tại")
    return name


def _create_category(name: str, color: str) -> int:
    try:
        return models.create_category(_owner(), _clean_name(name), color)
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(409, "Tên danh mục đã tồn tại")


@router.post("/categories")
def create_category(body: CategoryIn):
    return {"key": f"category:{_create_category(body.name, body.color)}"}


@router.put("/categories/{category_id}")
def update_category(category_id: int, body: CategoryIn):
    try:
        found = models.update_category(_owner(), category_id, _clean_name(body.name), body.color)
    except psycopg2.errors.UniqueViolation:
        raise HTTPException(409, "Tên danh mục đã tồn tại")
    if not found:
        raise HTTPException(404, "Không tìm thấy danh mục")
    return {"ok": True}


@router.delete("/categories/{category_id}")
def delete_category(category_id: int):
    if not models.delete_category(_owner(), category_id):
        raise HTTPException(404, "Không tìm thấy danh mục")
    return {"ok": True}


class UidsIn(BaseModel):
    uids: List[str] = Field(..., min_length=1, max_length=50000)


@router.post("/categories/memberships")
def category_memberships(body: UidsIn):
    """Profile nào đã nằm trong danh mục nào — để cảnh báo trước khi lưu thêm vào danh mục khác."""
    return {"items": models.category_memberships(_owner(), body.uids)}


@router.post("/categories/save")
def save_to_category(body: SaveIn):
    owner = _owner()
    if body.name and body.name.strip():
        category_id = _create_category(body.name, body.color)
    elif body.category_id is not None and models.category_exists(owner, f"category:{body.category_id}"):
        category_id = body.category_id
    else:
        raise HTTPException(404, "Không tìm thấy danh mục")
    return {"category_id": category_id, "added": models.add_to_category(owner, category_id, body.uids)}


def _require_category(key: str) -> None:
    if not models.category_exists(_owner(), key):
        raise HTTPException(404, "Không tìm thấy danh mục")


@router.get("/source-posts")
def source_posts(search: str = Query("", max_length=200)):
    """Bài viết đã quét người tương tác (Module 12) để chọn nguồn."""
    return {"items": models.source_posts(_owner(), search.strip())}


@router.get("/source-stats")
def source_stats(type: Literal["group", "page", "post"]):
    """Mỗi nguồn: {total, scanned} — số profile đã quét thông tin / tổng số người đã thu thập."""
    return {"items": models.source_stats(_owner(), type)}


@router.get("/source-people")
def source_people(
    type: Literal["group", "page", "post"],
    id: str = Query(..., min_length=1, max_length=255),
    tab: Literal["like", "comment"] = "like",
    search: str = Query("", max_length=200),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=500),
):
    """Người của nhóm / page / bài viết (tab: like | comment) để chọn quét; người đã quét thông tin ở cuối danh sách."""
    if type == "group":
        id = normalize_group_id(id.strip())
    kind = f"post_{tab}" if type == "post" else type
    return models.source_people(_owner(), kind, id.strip(), search.strip(), page_size, (page - 1) * page_size)


@router.post("/members/move")
def move_members(body: MoveIn):
    _require_category(body.key)
    _require_category(body.to_key)
    models.move_profiles(_owner(), body.key, body.to_key, body.uids)
    return {"ok": True}


@router.post("/members/delete")
def delete_members(body: MembersIn):
    _require_category(body.key)
    return {"deleted": models.delete_members(_owner(), body.key, body.uids)}
