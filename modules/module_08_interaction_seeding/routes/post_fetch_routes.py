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
from modules.module_08_interaction_seeding.automation import post_fetcher
from modules.module_08_interaction_seeding.models.seeding_models import SeedingPostFetchJob, vn_now
from modules.module_08_interaction_seeding.routes.seeding_routes import (
    _find_running_campaign,
    _running_conflict_detail,
    get_current_user_info,
    to_vn_iso,
)

router = APIRouter(prefix="/post-fetch", tags=["Seeding"])

POST_TYPES = ("photo", "video", "text")
_start_lock = threading.Lock()
# Link bài viết / nhóm / reel… không phải link page hay trang cá nhân
_NOT_SOURCE_MARKERS = ("/posts/", "/permalink", "story_fbid", "/videos/", "/photo", "/reel", "/watch", "/groups/", "/share/", "/events/", "/stories/")


class StartFetchRequest(BaseModel):
    source_url: str = Field(..., max_length=2000)
    account_uid: str = Field(..., max_length=50)


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


def _filter_sql(q: Optional[str], post_type: str, params: Dict[str, Any], with_type: bool = True) -> str:
    """Điều kiện WHERE chung cho danh sách / thêm vào seeding (theo nguồn + tìm kiếm + loại bài)."""
    where = ["fp.created_by = :u", "fp.source_key = :sk"]
    if q and q.strip():
        where.append("(fp.content ILIKE :q OR fp.post_url ILIKE :q)")
        params["q"] = f"%{q.strip()}%"
    if with_type and post_type == "text":
        # Bài không rõ loại cũng tính là "Bài viết" (khớp số đếm)
        where.append("COALESCE(fp.post_type, 'text') NOT IN ('photo', 'video')")
    elif with_type and post_type in POST_TYPES:
        where.append("fp.post_type = :pt")
        params["pt"] = post_type
    return " AND ".join(where)


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

    post_fetcher.start_fetch_thread(job.id, user_id, owner_ids, source_url, source_key, account.uid)
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
    """Bài đã lấy của 1 nguồn (theo thứ tự trên feed), có tìm kiếm / lọc loại bài / phân trang."""
    post_fetcher.init_post_fetch_schema()
    user_id = int(_require_user(request, authorization)["id"])

    count_params: Dict[str, Any] = {"u": user_id, "sk": source_key}
    count_where = _filter_sql(q, type, count_params, with_type=False)
    counts_row = db.execute(
        text(
            "SELECT COUNT(*) AS all_count,"
            " COUNT(*) FILTER (WHERE fp.post_type = 'photo') AS photo,"
            " COUNT(*) FILTER (WHERE fp.post_type = 'video') AS video,"
            " COUNT(*) FILTER (WHERE COALESCE(fp.post_type, 'text') NOT IN ('photo', 'video')) AS text"
            f" FROM seeding_fetched_posts fp WHERE {count_where}"
        ),
        count_params,
    ).mappings().first() or {}
    counts = {
        "all": int(counts_row.get("all_count") or 0),
        "photo": int(counts_row.get("photo") or 0),
        "video": int(counts_row.get("video") or 0),
        "text": int(counts_row.get("text") or 0),
    }

    params: Dict[str, Any] = {"u": user_id, "sk": source_key, "lim": page_size, "off": (page - 1) * page_size}
    where = _filter_sql(q, type, params)
    rows = db.execute(
        text(
            "SELECT fp.id, fp.post_url, fp.target_url, fp.content, fp.post_type, fp.published_at, fp.published_text,"
            " fp.reaction_count, fp.comment_count, fp.share_count, fp.is_pinned, fp.created_at,"
            " EXISTS (SELECT 1 FROM seeding_targets t WHERE t.target_type = 'POST' AND t.created_by = :u"
            "         AND (t.fb_id = fp.target_fb_id OR t.url = fp.target_url)) AS added"
            f" FROM seeding_fetched_posts fp WHERE {where}"
            " ORDER BY fp.id ASC LIMIT :lim OFFSET :off"
        ),
        params,
    ).mappings().all()
    total = counts["all"] if type not in POST_TYPES else counts[type]
    return {
        "items": [
            {
                "id": r["id"],
                "post_url": r["post_url"],
                "target_url": r["target_url"],
                "content": r["content"] or "",
                "post_type": r["post_type"] or "text",
                "published_at": r["published_at"].isoformat() if r["published_at"] else None,
                "published_text": r["published_text"],
                "reaction_count": r["reaction_count"] or 0,
                "comment_count": r["comment_count"] or 0,
                "share_count": r["share_count"] or 0,
                "is_pinned": bool(r["is_pinned"]),
                "added": bool(r["added"]),
                "created_at": to_vn_iso(r["created_at"]),
            }
            for r in rows
        ],
        "total": total,
        "counts": counts,
        "page": page,
        "page_size": page_size,
    }


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
    """Id của N bài đầu (theo thứ tự feed) khớp bộ lọc mà CHƯA có trong danh sách seeding — cho nút "Chọn N bài đầu"."""
    post_fetcher.init_post_fetch_schema()
    user_id = int(_require_user(request, authorization)["id"])
    params: Dict[str, Any] = {"u": user_id, "sk": source_key, "lim": limit}
    where = _filter_sql(q, type, params)
    rows = db.execute(
        text(
            f"SELECT fp.id FROM seeding_fetched_posts fp WHERE {where}"
            " AND NOT EXISTS (SELECT 1 FROM seeding_targets t WHERE t.target_type = 'POST' AND t.created_by = :u"
            "                 AND (t.fb_id = fp.target_fb_id OR t.url = fp.target_url))"
            " ORDER BY fp.id ASC LIMIT :lim"
        ),
        params,
    ).all()
    return {"ids": [r[0] for r in rows]}


@router.post("/posts/add-to-targets")
def add_fetched_posts_to_targets(
    body: AddFetchedRequest,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Thêm bài đã chọn vào danh sách seeding (1 câu SQL — chịu được rất nhiều bài).
    mode: ids = các bài đã tích; all = mọi bài khớp bộ lọc trừ exclude_ids; first = N bài đầu khớp bộ lọc."""
    post_fetcher.init_post_fetch_schema()
    user_id = int(_require_user(request, authorization)["id"])
    params: Dict[str, Any] = {"u": user_id, "sk": body.source_key, "now": vn_now()}

    if body.mode == "ids":
        ids = sorted({int(x) for x in body.ids})
        if not ids:
            raise HTTPException(status_code=422, detail="Chưa chọn bài viết nào.")
        params["ids"] = ids
        picked_sql = "SELECT fp.target_fb_id, fp.target_url FROM seeding_fetched_posts fp" \
                     " WHERE fp.created_by = :u AND fp.source_key = :sk AND fp.id = ANY(:ids)"
    else:
        where = _filter_sql(body.q, body.type, params)
        if body.mode == "all":
            if body.exclude_ids:
                where += " AND NOT (fp.id = ANY(:ex))"
                params["ex"] = sorted({int(x) for x in body.exclude_ids})
            picked_sql = f"SELECT fp.target_fb_id, fp.target_url FROM seeding_fetched_posts fp WHERE {where}"
        else:
            if not body.first_n:
                raise HTTPException(status_code=422, detail="Thiếu số bài cần chọn.")
            params["n"] = int(body.first_n)
            picked_sql = (
                f"SELECT fp.target_fb_id, fp.target_url FROM seeding_fetched_posts fp WHERE {where}"
                " ORDER BY fp.id ASC LIMIT :n"
            )

    row = db.execute(
        text(
            f"WITH picked AS ({picked_sql}),"
            " uniq AS (SELECT DISTINCT ON (target_fb_id) target_fb_id, target_url FROM picked),"
            " ins AS ("
            "   INSERT INTO seeding_targets (target_type, fb_id, url, display_name, created_by, created_at, updated_at)"
            "   SELECT 'POST', u.target_fb_id, u.target_url, 'Bài viết ' || u.target_fb_id, :u, :now, :now"
            "   FROM uniq u"
            "   WHERE NOT EXISTS (SELECT 1 FROM seeding_targets t WHERE t.target_type = 'POST' AND t.created_by = :u"
            "                     AND (t.fb_id = u.target_fb_id OR t.url = u.target_url))"
            "   ON CONFLICT DO NOTHING"
            "   RETURNING 1"
            " )"
            " SELECT (SELECT COUNT(*) FROM picked) AS picked, (SELECT COUNT(*) FROM ins) AS added"
        ),
        params,
    ).mappings().first()
    db.commit()
    picked = int(row["picked"] or 0)
    added = int(row["added"] or 0)
    skipped = max(0, picked - added)
    msg = f"Đã thêm {added:,} bài vào danh sách seeding".replace(",", ".")
    if skipped:
        msg += f" · bỏ qua {skipped:,} bài đã có".replace(",", ".")
    return {"picked": picked, "added": added, "skipped": skipped, "message": msg + "."}
