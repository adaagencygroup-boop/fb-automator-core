"""
post_fetch_routes.py
API "Lấy bài viết từ page / trang cá nhân" (Seeding Bài viết) — gắn vào seeding_router → /api/seeding/post-fetch/...
Handler viết `def` (FastAPI chạy trong threadpool) để truy vấn DB không chặn event loop.
"""
from __future__ import annotations

import threading
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from modules.module_02_account_manager.database.connection import get_db
from modules.module_02_account_manager.database.models import Account
from modules.module_08_interaction_seeding.automation import fetched_posts_store, post_fetcher
from modules.module_08_interaction_seeding.models.seeding_models import SeedingPostFetchJob, vn_now
from modules.module_08_interaction_seeding.routes.seeding_routes import (
    _find_running_campaign,
    _running_conflict_detail,
    get_current_user_info,
)

router = APIRouter(prefix="/post-fetch", tags=["Seeding"])

POST_TYPES = ("photo", "video", "text")
_start_lock = threading.Lock()
# Link bài viết / nhóm / reel… không phải link page hay trang cá nhân
_NOT_SOURCE_MARKERS = ("/posts/", "/permalink", "story_fbid", "/videos/", "/photo", "/reel", "/watch", "/groups/", "/share/", "/events/", "/stories/")


class StartFetchRequest(BaseModel):
    source_url: str = Field(..., max_length=2000)
    account_uid: str = Field(..., max_length=50)
    rotate_after_posts: int = Field(0, ge=0, le=1000)


class AddFetchedRequest(BaseModel):
    source_key: str = Field(..., max_length=255)
    mode: Literal["ids", "all", "first"] = "ids"
    ids: List[int] = Field(default_factory=list)
    exclude_ids: List[int] = Field(default_factory=list)
    first_n: Optional[int] = Field(None, ge=1)
    q: Optional[str] = Field(None, max_length=200)
    type: str = "all"


def _require_user(request: Request, authorization: Optional[str]) -> Dict[str, Any]:
    user = get_current_user_info(request, authorization)
    if not user or user.get("id") is None:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại.")
    return user


def _owner_identifiers(user: Dict[str, Any]) -> List[str]:
    ids = {str(user["id"]).strip()}
    if user.get("username"):
        ids.add(str(user["username"]).strip())
    return [x for x in ids if x]


def _get_owned_job(db: Session, job_id: int, user_id: int) -> SeedingPostFetchJob:
    job = (
        db.query(SeedingPostFetchJob)
        .filter(SeedingPostFetchJob.id == job_id, SeedingPostFetchJob.created_by == user_id)
        .first()
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy lượt lấy bài.")
    return job


_CHECK_CHUNK = 1000


def _added_flags(db: Session, user_id: int, rows: List[Dict[str, Any]]) -> List[bool]:
    """Bài nào (trong kho tạm) đã có trong danh sách seeding của user — so theo fb_id hoặc link bài đích."""
    if not rows:
        return []
    fb_ids = sorted({str(r.get("target_fb_id") or "") for r in rows} - {""})
    urls = sorted({str(r.get("target_url") or "") for r in rows} - {""})
    if not fb_ids and not urls:
        return [False] * len(rows)
    found = db.execute(
        text(
            "SELECT fb_id, url FROM seeding_targets WHERE target_type = 'POST' AND created_by = :u"
            " AND (fb_id = ANY(CAST(:fbids AS text[])) OR url = ANY(CAST(:urls AS text[])))"
        ),
        {"u": user_id, "fbids": fb_ids, "urls": urls},
    ).all()
    have_ids = {f for f, _ in found if f}
    have_urls = {u for _, u in found if u}
    return [
        (r.get("target_fb_id") in have_ids) or (r.get("target_url") in have_urls)
        for r in rows
    ]


@router.post("/jobs")
def start_post_fetch(
    body: StartFetchRequest,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Bắt đầu lấy toàn bộ bài viết của 1 page / trang cá nhân (chạy nền)."""
    post_fetcher.init_post_fetch_schema()
    user = _require_user(request, authorization)
    user_id = int(user["id"])

    from modules.module_11_page_scanner.page_source import clean_page_url, extract_page_identifier, is_valid_page_entry

    raw = (body.source_url or "").strip()
    lowered = raw.lower()
    if any(m in lowered for m in _NOT_SOURCE_MARKERS):
        raise HTTPException(
            status_code=422,
            detail="Đây không phải link page / trang cá nhân. Hãy nhập link trang (vd https://www.facebook.com/tenpage) — "
                   "link bài viết thì dùng tab \"Nhập link bài viết\".",
        )
    if not raw or not is_valid_page_entry(raw):
        raise HTTPException(status_code=422, detail="Link không hợp lệ. Nhập link page hoặc trang cá nhân Facebook.")
    source_url = clean_page_url(raw)
    source_key, _quality = extract_page_identifier(source_url)
    if not source_key:
        raise HTTPException(status_code=422, detail="Không nhận diện được page / trang cá nhân từ link này.")

    owner_ids = _owner_identifiers(user)
    account = (
        db.query(Account)
        .filter(
            Account.uid == body.account_uid.strip(),
            Account.user_id.in_(owner_ids),
            Account.status == "LIVE",
            Account.login_status == "LOGGED_IN",
        )
        .first()
    )
    if account is None:
        raise HTTPException(status_code=400, detail="Tài khoản lấy bài không khả dụng (cần còn Live và Đã đăng nhập).")

    with _start_lock:
        other = post_fetcher.running_job_id(user_id)
        if other:
            raise HTTPException(status_code=409, detail=f"Đang lấy bài viết (lượt #{other}). Dừng lượt đó trước khi lấy trang khác.")
        running = _find_running_campaign(db, user_id)
        if running:
            raise HTTPException(
                status_code=409,
                detail=_running_conflict_detail(running) + " (Lấy bài dùng chung Chrome của nick nên không chạy cùng lúc.)",
            )
        job = SeedingPostFetchJob(
            created_by=user_id,
            source_url=source_url,
            source_key=source_key,
            account_uid=account.uid,
            status="RUNNING",
            found_count=0,
            new_count=0,
            started_at=vn_now(),
            heartbeat_at=vn_now(),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        post_fetcher.try_register_job(job.id, user_id)

    post_fetcher.start_fetch_thread(
        job.id,
        user_id,
        owner_ids,
        source_url,
        source_key,
        account.uid,
        body.rotate_after_posts,
    )
    return {"job": post_fetcher.job_to_dict(job)}


@router.get("/jobs/active")
def get_active_post_fetch(
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Lượt lấy bài đang chạy của user; không có thì lượt gần nhất (để khôi phục khi quay lại màn)."""
    post_fetcher.init_post_fetch_schema()
    user_id = int(_require_user(request, authorization)["id"])
    running_id = post_fetcher.running_job_id(user_id)
    q = db.query(SeedingPostFetchJob).filter(SeedingPostFetchJob.created_by == user_id)
    job = q.filter(SeedingPostFetchJob.id == running_id).first() if running_id else None
    if job is None:
        job = q.order_by(SeedingPostFetchJob.id.desc()).first()
    return {"job": post_fetcher.job_to_dict(job)}


@router.get("/jobs/{job_id}")
def get_post_fetch_job(
    job_id: int,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    post_fetcher.init_post_fetch_schema()
    user_id = int(_require_user(request, authorization)["id"])
    return {"job": post_fetcher.job_to_dict(_get_owned_job(db, job_id, user_id))}


@router.post("/jobs/{job_id}/stop")
def stop_post_fetch_job(
    job_id: int,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Dừng lấy bài. Bài đã lấy được vẫn giữ nguyên."""
    post_fetcher.init_post_fetch_schema()
    user_id = int(_require_user(request, authorization)["id"])
    job = _get_owned_job(db, job_id, user_id)
    if post_fetcher.request_stop(job_id):
        job.status = "STOPPING"
    elif job.status in ("RUNNING", "STOPPING"):
        # Không còn chạy trong engine này (engine đã khởi động lại) → chốt luôn
        job.status = "STOPPED"
        job.stop_reason = job.stop_reason or "USER_STOPPED"
        job.finished_at = job.finished_at or vn_now()
    db.commit()
    db.refresh(job)
    return {"job": post_fetcher.job_to_dict(job)}


@router.get("/posts")
def list_fetched_posts(
    source_key: str = Query(..., max_length=255),
    q: Optional[str] = Query(None, max_length=200),
    type: str = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Bài đã lấy của 1 nguồn (theo thứ tự trên feed) từ kho TẠM, có tìm kiếm / lọc loại bài / phân trang.
    available = kho tạm còn bài của nguồn này (False khi đã hết hạn hoặc đã lấy page khác)."""
    user_id = int(_require_user(request, authorization)["id"])
    counts = fetched_posts_store.counts(user_id, source_key, q)
    rows = fetched_posts_store.filtered(user_id, source_key, q, type)
    start = (page - 1) * page_size
    items = rows[start:start + page_size]
    added = _added_flags(db, user_id, items)
    return {
        "items": [
            {
                "id": r["id"],
                "post_url": r.get("post_url"),
                "target_url": r.get("target_url"),
                "content": (r.get("content") or "").strip() or "Bài viết không có nội dung",
                "post_type": r.get("post_type") or "text",
                "published_at": r.get("published_at"),
                "published_text": r.get("published_text"),
                "reaction_count": r.get("reaction_count") or 0,
                "comment_count": r.get("comment_count") or 0,
                "share_count": r.get("share_count") or 0,
                "is_pinned": bool(r.get("is_pinned")),
                "added": flag,
                "created_at": r.get("created_at"),
            }
            for r, flag in zip(items, added)
        ],
        "total": len(rows),
        "counts": counts,
        "page": page,
        "page_size": page_size,
        "available": fetched_posts_store.available(user_id, source_key),
    }


@router.delete("/posts")
def clear_fetched_posts(
    source_key: str = Query(..., max_length=255),
    request: Request = None,
    authorization: Optional[str] = Header(None),
):
    """Xóa danh sách bài quét tạm đang hiển thị của đúng nguồn."""
    user_id = int(_require_user(request, authorization)["id"])
    if post_fetcher.running_job_id(user_id) is not None:
        raise HTTPException(status_code=409, detail="Không thể làm mới danh sách khi đang quét bài viết.")
    if not fetched_posts_store.clear(user_id, source_key):
        raise HTTPException(status_code=404, detail="Danh sách bài viết không còn tồn tại.")
    return {"cleared": True}


@router.get("/posts/ids")
def list_fetched_post_ids(
    source_key: str = Query(..., max_length=255),
    q: Optional[str] = Query(None, max_length=200),
    type: str = Query("all"),
    limit: int = Query(100, ge=1, le=5000),
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Id của N bài đầu (theo thứ tự feed) khớp bộ lọc mà CHƯA có trong danh sách seeding — cho nút "Chọn N bài"."""
    user_id = int(_require_user(request, authorization)["id"])
    rows = fetched_posts_store.filtered(user_id, source_key, q, type)
    ids: List[int] = []
    for start in range(0, len(rows), _CHECK_CHUNK):
        chunk = rows[start:start + _CHECK_CHUNK]
        for r, is_added in zip(chunk, _added_flags(db, user_id, chunk)):
            if not is_added:
                ids.append(int(r["id"]))
                if len(ids) >= limit:
                    return {"ids": ids}
    return {"ids": ids}


@router.post("/posts/add-to-targets")
def add_fetched_posts_to_targets(
    body: AddFetchedRequest,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Bước XÁC NHẬN — lúc duy nhất bài lấy từ page được ghi vào DB: chèn các bài đã chọn trong kho tạm
    vào danh sách seeding (seeding_targets), bỏ bài đã có.
    mode: ids = các bài đã tích; all = mọi bài khớp bộ lọc trừ exclude_ids; first = N bài đầu khớp bộ lọc."""
    user_id = int(_require_user(request, authorization)["id"])
    if not fetched_posts_store.available(user_id, body.source_key):
        raise HTTPException(
            status_code=410,
            detail="Danh sách bài tạm đã hết hạn — bấm \"Lấy danh sách bài viết\" để lấy lại.",
        )

    if body.mode == "ids":
        if not body.ids:
            raise HTTPException(status_code=422, detail="Chưa chọn bài viết nào.")
        picked = fetched_posts_store.by_ids(user_id, body.source_key, body.ids)
    else:
        rows = fetched_posts_store.filtered(user_id, body.source_key, body.q, body.type)
        if body.mode == "all":
            excluded = {int(x) for x in body.exclude_ids}
            picked = [r for r in rows if int(r["id"]) not in excluded]
        else:
            if not body.first_n:
                raise HTTPException(status_code=422, detail="Thiếu số bài cần chọn.")
            picked = rows[: int(body.first_n)]

    # Bỏ trùng theo bài đích (2 link khác nhau của cùng 1 bài), giữ thứ tự trên feed
    fb_ids: List[str] = []
    urls: List[str] = []
    seen: set = set()
    for r in picked:
        fb_id = str(r.get("target_fb_id") or "").strip()
        url = str(r.get("target_url") or "").strip()
        if not fb_id or not url or fb_id in seen:
            continue
        seen.add(fb_id)
        fb_ids.append(fb_id)
        urls.append(url)

    added = 0
    if fb_ids:
        row = db.execute(
            text(
                "WITH uniq AS ("
                "   SELECT * FROM unnest(CAST(:fbids AS text[]), CAST(:urls AS text[])) AS u(target_fb_id, target_url)"
                " ),"
                " ins AS ("
                "   INSERT INTO seeding_targets (target_type, fb_id, url, display_name, created_by, created_at, updated_at)"
                "   SELECT 'POST', u.target_fb_id, u.target_url, 'Bài viết ' || u.target_fb_id, :u, :now, :now"
                "   FROM uniq u"
                "   WHERE NOT EXISTS (SELECT 1 FROM seeding_targets t WHERE t.target_type = 'POST' AND t.created_by = :u"
                "                     AND (t.fb_id = u.target_fb_id OR t.url = u.target_url))"
                "   ON CONFLICT DO NOTHING"
                "   RETURNING 1"
                " )"
                " SELECT COUNT(*) AS added FROM ins"
            ),
            {"fbids": fb_ids, "urls": urls, "u": user_id, "now": vn_now()},
        ).mappings().first()
        db.commit()
        added = int((row or {}).get("added") or 0)

    total_picked = len(picked)
    skipped = max(0, total_picked - added)
    msg = f"Đã thêm {added:,} bài vào danh sách seeding".replace(",", ".")
    if skipped:
        msg += f" · bỏ qua {skipped:,} bài đã có".replace(",", ".")
    return {"picked": total_picked, "added": added, "skipped": skipped, "message": msg + "."}
