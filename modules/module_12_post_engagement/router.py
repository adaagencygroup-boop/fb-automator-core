"""API Module 12 — Quét tài khoản đã tương tác bài viết. Tài khoản lấy từ Module 02; mỗi user một kho riêng."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from modules.module_02_account_manager.api.router import scoped_owner
from modules.module_02_account_manager.context import owner_context
from modules.module_12_post_engagement import jobs, models
from modules.module_12_post_engagement.links import parse_link_rows

router = APIRouter(prefix="/api/post-engagement", tags=["Module 12: Post engagement"])


def _owner() -> str:
    owner = (owner_context.get() or "").strip()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    models.ensure_schema()
    return owner


class ParseLinksRequest(BaseModel):
    text: Optional[str] = None
    rows: Optional[list[Any]] = None


class CheckRequest(BaseModel):
    uids: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)


class ScanPost(BaseModel):
    post_url: str = Field(..., min_length=5)
    like_quota: int = Field(0, ge=0, le=jobs.QUOTA_LIMITS["like"])
    comment_quota: int = Field(0, ge=0, le=jobs.QUOTA_LIMITS["comment"])
    # Bản FE cũ còn gửi share_quota: vẫn nhận để không lỗi 422 nhưng bỏ qua (không còn quét Share)
    share_quota: int = Field(0, ge=0)
    title: Optional[str] = ""


class ScanRequest(BaseModel):
    uids: list[str] = Field(default_factory=list)
    posts: list[ScanPost] = Field(default_factory=list)
    delay_min: float = Field(5, ge=0, le=3600)
    delay_max: float = Field(10, ge=0, le=3600)


class ControlRequest(BaseModel):
    job_id: str = Field(..., min_length=1)
    action: str = Field(..., pattern="^(pause|resume|abort)$")


class ExportRequest(BaseModel):
    post_keys: list[str] = Field(..., min_length=1, max_length=500)
    scope: str = Field("all", pattern="^(all|tab)$")
    tab: str = Field("like", pattern="^(like|share|comment)$")
    search: Optional[str] = ""
    tier: Optional[int] = Field(None, ge=1, le=2)


class DeletePostsRequest(BaseModel):
    post_keys: list[str] = Field(..., min_length=1, max_length=500)


@router.get("/health")
def health():
    return {"ok": True, "module": 12, "name": "post-engagement"}


@router.post("/links/parse", dependencies=[Depends(scoped_owner)])
def parse_links(body: ParseLinksRequest):
    """Nhận diện link bài viết từ ô dán (text) hoặc từ các dòng của tệp (rows)."""
    rows = body.rows if body.rows is not None else (body.text or "").splitlines()
    return parse_link_rows(rows, max_links=jobs.MAX_POSTS * 10)


# ---------------------------------------------------------------- Kiểm tra
@router.post("/check/start", dependencies=[Depends(scoped_owner)])
def check_start(body: CheckRequest):
    owner = _owner()
    if jobs.get_active(owner, "scan"):
        raise HTTPException(409, "Đang có phiên quét chạy — chờ xong hoặc dừng phiên đó trước khi Kiểm tra.")
    if jobs.get_active(owner, "check"):
        raise HTTPException(409, "Đang có phiên Kiểm tra chạy.")
    try:
        return jobs.start_check(owner, body.uids, body.links)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/check/status", dependencies=[Depends(scoped_owner)])
def check_status(job_id: str):
    data = jobs.get_status(job_id, _owner())
    if not data or data["kind"] != "check":
        raise HTTPException(404, "Không tìm thấy phiên Kiểm tra")
    return data


@router.get("/check/active", dependencies=[Depends(scoped_owner)])
def check_active():
    return {"job_id": jobs.get_active(_owner(), "check")}


@router.post("/check/control", dependencies=[Depends(scoped_owner)])
def check_control(body: ControlRequest):
    if not jobs.set_control(body.job_id, body.action, _owner()):
        raise HTTPException(404, "Phiên Kiểm tra không còn chạy")
    return {"ok": True}


# ---------------------------------------------------------------- Quét
@router.post("/scan/start", dependencies=[Depends(scoped_owner)])
def scan_start(body: ScanRequest):
    owner = _owner()
    if jobs.get_active(owner, "scan"):
        raise HTTPException(409, "Đang có phiên quét chạy.")
    if jobs.get_active(owner, "check"):
        raise HTTPException(409, "Đang Kiểm tra bài viết — chờ Kiểm tra xong rồi bấm Bắt đầu thực thi.")
    try:
        return jobs.start_scan(owner, body.uids, [p.model_dump() for p in body.posts],
                               delay_min=body.delay_min, delay_max=body.delay_max)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/scan/status", dependencies=[Depends(scoped_owner)])
def scan_status(job_id: str):
    data = jobs.get_status(job_id, _owner())
    if not data or data["kind"] != "scan":
        raise HTTPException(404, "Không tìm thấy phiên quét")
    return data


@router.get("/scan/active", dependencies=[Depends(scoped_owner)])
def scan_active():
    return {"job_id": jobs.get_active(_owner(), "scan")}


@router.post("/scan/control", dependencies=[Depends(scoped_owner)])
def scan_control(body: ControlRequest):
    if not jobs.set_control(body.job_id, body.action, _owner()):
        raise HTTPException(404, "Phiên quét không còn chạy")
    return {"ok": True}


# ---------------------------------------------------------------- Kho dữ liệu
@router.get("/posts", dependencies=[Depends(scoped_owner)])
def posts(search: str = "", source: str = "all", sort: str = "newest", keys: str = "", limit: int = 200, offset: int = 0):
    """Danh mục bài viết đã quét (cột trái). keys="a,b": chỉ các bài của phiên đang xem."""
    key_list = [k for k in keys.split(",") if k.strip()] if keys else None
    return models.list_posts(_owner(), search=search, source=source, sort=sort, keys=key_list, limit=limit, offset=offset)


@router.get("/posts/lookup", dependencies=[Depends(scoped_owner)])
def posts_lookup(keys: str = ""):
    """Thông tin đã lưu của các bài (bảng xem trước sau khi Kiểm tra / mở lại trang)."""
    return {"posts": models.get_posts(_owner(), [k for k in keys.split(",") if k.strip()])}


@router.get("/posts/{post_key}/engagements", dependencies=[Depends(scoped_owner)])
def engagements(post_key: str, tab: str = "like", search: str = "", tier: Optional[int] = None, limit: int = 20, offset: int = 0):
    return models.list_engagements(_owner(), post_key, tab=tab, search=search, tier=tier, limit=limit, offset=offset)


@router.post("/export", dependencies=[Depends(scoped_owner)])
def export(body: ExportRequest):
    rows = models.export_engagements(_owner(), body.post_keys, scope=body.scope, tab=body.tab, search=body.search or "",
                                     tier=body.tier)
    return {"rows": rows, "total": len(rows)}


@router.post("/posts/delete", dependencies=[Depends(scoped_owner)])
def delete_posts(body: DeletePostsRequest):
    return {"ok": True, "deleted": models.delete_posts(_owner(), body.post_keys)}


# ---------------------------------------------------------------- Chạy tiếp
@router.get("/sessions/resumable", dependencies=[Depends(scoped_owner)])
def resumable():
    return {"session": models.latest_resumable(_owner())}


@router.post("/sessions/{session_id}/resume", dependencies=[Depends(scoped_owner)])
def resume(session_id: str):
    owner = _owner()
    info = models.get_resume_info(owner, session_id)
    if not info:
        raise HTTPException(404, "Không tìm thấy phiên")
    if info["status"] not in models.RESUMABLE_STATUSES or not info["remaining"]:
        raise HTTPException(409, "Phiên này không còn bài nào cần chạy tiếp.")
    if jobs.get_active(owner, "scan") or jobs.get_active(owner, "check"):
        raise HTTPException(409, "Đang có phiên khác chạy.")
    req = (info.get("state") or {}).get("request") or {}
    try:
        res = jobs.start_scan(owner, req.get("uids") or [], info["remaining"], delay_min=req.get("delay_min") or 5,
                              delay_max=req.get("delay_max") or 10, resumed_from=session_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    models.update_session(session_id, status="RESUMED")
    return {**res, "remaining": len(info["remaining"])}
