"""
=============================================================================
MODULE 11: FACEBOOK PAGE SCANNER - FASTAPI HTTP API ROUTER
=============================================================================
Cung cấp các API tìm kiếm Fanpage, phân tích danh sách link, upload file,
quản lý lịch sử phiên quét và xem kết quả Fanpage đã thu thập.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from core.database.connection import db
from modules.module_02_account_manager.api.router import scoped_owner
from modules.module_02_account_manager.context import owner_context
from ..page_source import (
    get_sample_template,
    normalize_post_key,
    parse_page_file_content,
)
from ..browser_session import AccountBusyError
from ..followers_scan import start_follower_scan_background
from ..posts_scan import start_post_scan_background
from ..scanner import (
    append_session_log,
    create_scan_session,
    finalize_scan_session,
    request_stop_session,
    request_pause_session,
    request_resume_session,
    run_page_search_flow,
    save_batch_pages,
    start_page_search_background,
    start_hashtag_search_background,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/page-scanner",
    tags=["Module 11: Page scanner"],
    dependencies=[Depends(scoped_owner)],
)


def _attach_source_keywords(owner: str, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Gắn danh sách từ khóa/hashtag đã tìm cho từng page (sidebar/tag cột)."""
    if not rows:
        return rows
    keys = [r.get("page_key") for r in rows if r.get("page_key")]
    if not keys:
        return rows
    link_rows = db.fetch_all(
        """
        SELECT ssp.page_key, s.keyword, s.source_type
        FROM page_scan_session_pages ssp
        JOIN page_scan_sessions s ON s.id = ssp.session_id
        WHERE s.owner_key = %s
          AND ssp.page_key = ANY(%s)
          AND COALESCE(s.job_type, 'DISCOVERY') = 'DISCOVERY'
          AND s.source_type IN ('SEARCH', 'HASHTAG')
          AND s.keyword IS NOT NULL
          AND TRIM(s.keyword) <> ''
        ORDER BY s.created_at DESC NULLS LAST
        """,
        (owner, keys),
    )
    by_key: Dict[str, List[str]] = {}
    for lr in link_rows or []:
        pk = lr.get("page_key")
        kw = (lr.get("keyword") or "").strip()
        if not pk or not kw:
            continue
        bucket = by_key.setdefault(pk, [])
        if kw not in bucket:
            bucket.append(kw)
    for r in rows:
        r["source_keywords"] = by_key.get(r.get("page_key") or "", [])
    return rows


def _get_owner() -> str:
    """Lấy định danh owner từ token phiên đăng nhập."""
    current = owner_context.get()
    return current if current and str(current).strip() else "system"


# ==================== SCHEMAS ====================


class SearchPageInput(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=255, description="Từ khóa hoặc hashtag tìm kiếm")
    account_uid: Optional[str] = Field(None, description="UID tài khoản Facebook cào (tuỳ chọn)")
    max_results: int = Field(100, ge=1, le=500, description="Số lượng Fanpage mục tiêu")
    include_sponsored: bool = Field(False, description="Có lấy thẻ Được tài trợ / Sponsored hay không")
    headless: bool = Field(False, description="Chạy Chrome ẩn hay hiện (POC mặc định False để quan sát)")
    allow_direct_fallback: bool = Field(True, description="Tự động chuyển sang IP trực tiếp nếu proxy lỗi")
    campaign_id: Optional[str] = Field(None, description="Mã đợt chạy gom nhiều phiên con")
    settings: Optional[Dict[str, Any]] = Field(None, description="Cấu hình đợt (keywords, hashtags, search_mode, …)")
    keep_browser: bool = Field(
        False,
        description="Giữ Chrome page_scanner khi phiên kết thúc bình thường (job kế cùng acc)",
    )


class SearchHashtagInput(BaseModel):
    hashtags: Union[List[str], str] = Field(..., description="Một hoặc nhiều hashtag (mảng hoặc chuỗi phân cách)")
    context_keywords: Optional[List[str]] = Field(default=[], description="Từ khóa ngữ cảnh bổ trợ chấm điểm liên quan")
    min_posts: int = Field(2, ge=1, le=10, description="Điều kiện cứng: tối thiểu số bài viết / Page")
    max_posts_per_hashtag: int = Field(100, ge=10, le=300, description="Số bài viết tối đa mỗi hashtag (giới hạn an toàn)")
    account_uid: Optional[str] = Field(None, description="UID tài khoản Facebook cào (tuỳ chọn)")
    headless: bool = Field(False, description="Chạy Chrome ẩn hay hiện")
    allow_direct_fallback: bool = Field(True, description="Tự động chuyển sang IP trực tiếp nếu proxy lỗi")
    campaign_id: Optional[str] = Field(None, description="Mã đợt chạy gom nhiều phiên con")
    keep_browser: bool = Field(
        False,
        description="Giữ Chrome page_scanner khi phiên kết thúc bình thường (job kế cùng acc)",
    )
    target_pages: Optional[int] = Field(None, ge=1, le=500, description="Số page mục tiêu đạt lọc để dừng TARGET_REACHED")
    min_followers: int = Field(1000, ge=0, description="Chỉ lưu page có follower_count > ngưỡng này")
    idle_timeout_s: float = Field(90, ge=5, le=600, description="Dừng NO_NEW_RESULTS nếu không có page mới đạt lọc")


class ParseInput(BaseModel):
    content: str = Field(..., min_length=1, description="Chuỗi danh sách link/UID mỗi dòng 1 Page")
    filter_existing: bool = Field(False, description="Kiểm tra đối chiếu trùng với kho đã lưu")
    save_to_db: bool = Field(False, description="Lưu ngay các Page hợp lệ vào kho database")


class FollowerSessionInput(BaseModel):
    page_keys: List[str] = Field(..., min_length=1, description="Danh sách page_key cần quét followers")
    account_uid: Optional[str] = Field(None, description="UID acc cào")
    keep_browser: bool = Field(False, description="Giữ Chrome sau phiên (Selenium sau)")
    target_followers: int = Field(500, ge=1, le=50000, description="Tổng followers mục tiêu")
    max_per_page: int = Field(200, ge=1, le=5000, description="Tối đa followers / Page")
    idle_timeout_s: float = Field(90, ge=5, le=600)
    skip_existing: bool = Field(True, description="Bỏ qua follower đã có trong kho")
    source_list_id: Optional[str] = Field(None, description="ID danh sách Page đã lưu (FE)")
    page_delay_s: float = Field(2.0, ge=0, le=120, description="Delay giữa các Page")
    scroll_delay_s: float = Field(1.5, ge=0.2, le=30, description="Delay giữa các lần scroll dialog")
    headless: bool = Field(False)
    allow_direct_fallback: bool = Field(True)


class FollowerItem(BaseModel):
    page_key: str
    follower_key: str
    follower_name: Optional[str] = None
    profile_url: Optional[str] = None
    avatar_url: Optional[str] = None
    gender: Optional[str] = None
    location: Optional[str] = None


class FollowerImportInput(BaseModel):
    items: List[FollowerItem] = Field(..., min_length=1)
    session_id: Optional[int] = None


class PostSessionInput(BaseModel):
    page_keys: List[str] = Field(..., min_length=1)
    account_uid: Optional[str] = None
    keep_browser: bool = Field(False)
    max_posts_per_page: int = Field(50, ge=1, le=500)
    date_from: Optional[str] = Field(None, description="YYYY-MM-DD")
    date_to: Optional[str] = Field(None, description="YYYY-MM-DD")
    post_types: Optional[List[str]] = Field(default_factory=lambda: ["all"])
    idle_timeout_s: float = Field(90, ge=5, le=600)
    skip_existing: bool = Field(True)
    page_delay_s: float = Field(2.0, ge=0, le=120)
    scroll_delay_s: float = Field(1.5, ge=0.2, le=30)
    source_list_id: Optional[str] = None
    headless: bool = Field(False)
    allow_direct_fallback: bool = Field(True)


class PostItem(BaseModel):
    page_key: str
    post_key: str
    post_url: str
    content: Optional[str] = None
    post_type: Optional[str] = None
    published_at: Optional[str] = None
    published_text: Optional[str] = None
    reaction_count: int = 0
    comment_count: int = 0
    share_count: int = 0
    is_pinned: bool = False


class PostImportInput(BaseModel):
    items: List[PostItem] = Field(..., min_length=1)
    session_id: Optional[int] = None


# ==================== ENDPOINTS ====================


@router.post("/source/hashtag-search")
async def search_pages_by_hashtag(item: SearchHashtagInput):
    """
    POST /api/page-scanner/source/hashtag-search
    Khởi động phiên tìm kiếm Fanpage theo Hashtag trong background task (Section 10).
    Thu hoạch bài viết chứa hashtag -> Rút tác giả Page -> Chấm điểm liên quan (Relevance Score).
    Trả về ngay session_id để client theo dõi tiến độ realtime và có thể dừng bất cứ lúc nào.
    """
    owner = _get_owner()
    try:
        session_id = await asyncio.to_thread(
            start_hashtag_search_background,
            hashtags=item.hashtags if isinstance(item.hashtags, list) else [item.hashtags],
            context_keywords=item.context_keywords,
            min_posts=item.min_posts,
            max_posts_per_hashtag=item.max_posts_per_hashtag,
            account_uid=item.account_uid,
            owner_key=owner,
            headless=item.headless,
            allow_direct_fallback=item.allow_direct_fallback,
            campaign_id=item.campaign_id,
            keep_browser=item.keep_browser,
            min_followers=item.min_followers,
            target_pages=item.target_pages,
            idle_timeout_s=item.idle_timeout_s,
        )
        return {
            "session_id": session_id,
            "campaign_id": item.campaign_id,
            "status": "RUNNING",
            "message": f"Phiên quét hashtag #{session_id} đã được khởi động thành công",
        }
    except AccountBusyError as busy:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "BUSY",
                "message": str(busy),
                "active_session_id": busy.active_session_id,
                "job_type": busy.job_type,
                "account_uid": busy.account_uid,
            },
        )
    except ValueError as val_err:
        raise HTTPException(status_code=422, detail=str(val_err))
    except Exception as exc:
        logger.error(f"[Module 11 API] Lỗi hashtag search: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Không thể khởi động phiên quét hashtag: {exc}")


@router.post("/source/search")
async def search_pages(item: SearchPageInput):
    """
    POST /api/page-scanner/source/search
    Khởi động phiên tìm kiếm Fanpage trong background task không chặn HTTP request.
    Nếu từ khóa bắt đầu bằng # hoặc chứa hashtag, tự động chuyển hướng sang hashtag search.
    """
    owner = _get_owner()
    try:
        kw = item.keyword.strip()
        if kw.startswith("#") or " " in kw and "#" in kw:
            session_id = await asyncio.to_thread(
                start_hashtag_search_background,
                hashtags=[kw],
                context_keywords=[],
                min_posts=2,
                max_posts_per_hashtag=item.max_results,
                account_uid=item.account_uid,
                owner_key=owner,
                headless=item.headless,
                allow_direct_fallback=item.allow_direct_fallback,
                campaign_id=item.campaign_id,
                keep_browser=item.keep_browser,
            )
        else:
            session_id = await asyncio.to_thread(
                start_page_search_background,
                keyword=item.keyword,
                account_uid=item.account_uid,
                max_results=item.max_results,
                include_sponsored=item.include_sponsored,
                owner_key=owner,
                headless=item.headless,
                allow_direct_fallback=item.allow_direct_fallback,
                campaign_id=item.campaign_id,
                settings=item.settings,
                keep_browser=item.keep_browser,
            )
        return {
            "session_id": session_id,
            "campaign_id": item.campaign_id,
            "status": "RUNNING",
            "message": f"Phiên quét #{session_id} đã được khởi động thành công",
        }
    except ValueError as val_err:
        raise HTTPException(status_code=422, detail=str(val_err))
    except Exception as exc:
        logger.error(f"[Module 11 API] Lỗi search: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Không thể khởi động phiên quét: {exc}")


@router.post("/source/parse")
async def parse_pages_text(item: ParseInput):
    """
    POST /api/page-scanner/source/parse
    Dán danh sách link hoặc UID Fanpage (mỗi dòng 1 link) -> chuẩn hóa / khử trùng / thống kê.
    Tùy chọn lưu ngay vào kho CSDL.
    """
    owner = _get_owner()
    try:
        parsed = await asyncio.to_thread(
            parse_page_file_content,
            item.content,
            item.filter_existing,
            owner,
        )

        # Nếu user yêu cầu lưu vào database
        if item.save_to_db and parsed.get("pages"):
            session_id = await asyncio.to_thread(
                create_scan_session,
                owner_key=owner,
                keyword="Nhập link trực tiếp",
                account_uid=None,
                source_type="PARSE",
                max_results=len(parsed["pages"]),
            )
            new_global, existing = await asyncio.to_thread(
                save_batch_pages,
                session_id=session_id,
                owner_key=owner,
                batch_index=1,
                pages=parsed["pages"],
                account_uid=None,
                source_type="PARSE",
            )
            await asyncio.to_thread(
                finalize_scan_session,
                session_id=session_id,
                status="COMPLETED",
                stop_reason="TARGET_REACHED",
                total_seen=parsed["total_lines"],
                total_unique=parsed["valid_count"],
                total_duplicates=parsed["dedup_count"],
                total_sponsored=0,
                batches_count=1,
                duration_seconds=0,
            )
            parsed["session_id"] = session_id
            parsed["saved_new"] = new_global
            parsed["saved_existing"] = existing

        return parsed
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Lỗi đọc dữ liệu Page: {exc}")


@router.post("/source/upload")
async def upload_pages_file(
    file: UploadFile = File(...),
    filter_existing: bool = Query(False),
    save_to_db: bool = Query(False),
):
    """
    POST /api/page-scanner/source/upload
    Upload tệp .txt hoặc .csv chứa danh sách Fanpage.
    Tự động nhận diện cột page_url, link, url, fanpage nếu là CSV.
    """
    owner = _get_owner()
    try:
        content_bytes = await file.read()
        content = content_bytes.decode("utf-8", errors="replace")
        parsed = await asyncio.to_thread(
            parse_page_file_content,
            content,
            filter_existing,
            owner,
        )

        if save_to_db and parsed.get("pages"):
            session_id = await asyncio.to_thread(
                create_scan_session,
                owner_key=owner,
                keyword=f"Upload file: {file.filename or 'file'}",
                account_uid=None,
                source_type="UPLOAD",
                max_results=len(parsed["pages"]),
            )
            new_global, existing = await asyncio.to_thread(
                save_batch_pages,
                session_id=session_id,
                owner_key=owner,
                batch_index=1,
                pages=parsed["pages"],
                account_uid=None,
                source_type="UPLOAD",
            )
            await asyncio.to_thread(
                finalize_scan_session,
                session_id=session_id,
                status="COMPLETED",
                stop_reason="TARGET_REACHED",
                total_seen=parsed["total_lines"],
                total_unique=parsed["valid_count"],
                total_duplicates=parsed["dedup_count"],
                total_sponsored=0,
                batches_count=1,
                duration_seconds=0,
            )
            parsed["session_id"] = session_id
            parsed["saved_new"] = new_global
            parsed["saved_existing"] = existing

        return parsed
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Lỗi upload tệp Fanpage: {exc}")


@router.get("/source/template")
async def download_pages_template():
    """
    GET /api/page-scanner/source/template
    Tải file mẫu danh sách Fanpage Facebook (.txt).
    """
    return PlainTextResponse(
        get_sample_template(),
        headers={"Content-Disposition": 'attachment; filename="mau_danh_sach_fanpage_fb.txt"'},
    )


@router.get("/sessions")
async def list_scan_sessions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
):
    """
    GET /api/page-scanner/sessions
    Lấy danh sách lịch sử các phiên quét của user đăng nhập.
    """
    owner = _get_owner()
    offset = (page - 1) * page_size
    params: List[Any] = [owner]
    conditions = ["owner_key = %s"]

    if status:
        conditions.append("status = %s")
        params.append(status.upper())

    if keyword:
        conditions.append("keyword ILIKE %s")
        params.append(f"%{keyword.strip()}%")

    where_clause = " AND ".join(conditions)

    count_row = db.fetch_one(
        f"SELECT COUNT(*) AS total FROM page_scan_sessions WHERE {where_clause}",
        tuple(params),
    )
    total = int(count_row["total"]) if count_row else 0

    params.extend([page_size, offset])
    query = f"""
    SELECT id, owner_key, keyword, account_uid, source_type, status,
           stop_reason, max_results, total_seen, total_unique, total_duplicates,
           total_sponsored, batches_count, duration_seconds, error_message,
           started_at, finished_at, created_at
    FROM page_scan_sessions
    WHERE {where_clause}
    ORDER BY id DESC
    LIMIT %s OFFSET %s
    """
    rows = db.fetch_all(query, tuple(params))

    return {
        "items": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/sessions/{session_id}")
async def get_scan_session_detail(session_id: int):
    """
    GET /api/page-scanner/sessions/{session_id}
    Xem chi tiết thông số và thống kê của 1 phiên quét cụ thể.
    """
    owner = _get_owner()
    row = db.fetch_one(
        "SELECT * FROM page_scan_sessions WHERE id = %s AND owner_key = %s",
        (session_id, owner),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên quét yêu cầu")

    # Đếm số page đã thu hoạch trong phiên
    pages_count_row = db.fetch_one(
        "SELECT COUNT(*) AS count FROM page_scan_session_pages WHERE session_id = %s",
        (session_id,),
    )
    pages_count = int(pages_count_row["count"]) if pages_count_row else 0
    row["pages_count"] = pages_count

    return row


@router.get("/keywords")
async def list_search_keywords():
    """
    GET /api/page-scanner/keywords
    Danh mục từ khóa / hashtag đã tìm (job DISCOVERY), kèm số page unique.
    Dùng cho sidebar DS page.
    """
    owner = _get_owner()
    rows = db.fetch_all(
        """
        SELECT
            s.keyword,
            COALESCE(MAX(s.source_type), 'SEARCH') AS source_type,
            COUNT(DISTINCT ssp.page_key) AS page_count,
            COUNT(DISTINCT s.id) AS session_count,
            MAX(s.created_at) AS last_at
        FROM page_scan_sessions s
        LEFT JOIN page_scan_session_pages ssp ON ssp.session_id = s.id
        WHERE s.owner_key = %s
          AND COALESCE(s.job_type, 'DISCOVERY') = 'DISCOVERY'
          AND s.source_type IN ('SEARCH', 'HASHTAG')
          AND s.keyword IS NOT NULL
          AND TRIM(s.keyword) <> ''
        GROUP BY s.keyword
        ORDER BY MAX(s.created_at) DESC NULLS LAST, s.keyword ASC
        """,
        (owner,),
    )
    items = []
    for r in rows or []:
        items.append(
            {
                "keyword": r.get("keyword"),
                "source_type": r.get("source_type") or "SEARCH",
                "page_count": int(r.get("page_count") or 0),
                "session_count": int(r.get("session_count") or 0),
                "last_at": r.get("last_at"),
            }
        )
    return {"items": items, "total": len(items)}


@router.get("/pages")
async def list_scanned_pages(
    session_id: Optional[int] = Query(None, description="Lọc theo mã phiên quét"),
    source_keyword: Optional[str] = Query(
        None, description="Lọc page thuộc phiên DISCOVERY có đúng từ khóa/hashtag này"
    ),
    keyword: Optional[str] = Query(None, description="Tìm theo tên hoặc url"),
    relevance_status: Optional[str] = Query(None, description="Lọc theo độ liên quan (RELEVANT, REVIEW, EXCLUDED)"),
    min_followers: Optional[int] = Query(None, ge=0, description="Lọc hiển thị: follower tối thiểu"),
    sort_by: str = Query("followers", description="followers | created | default"),
    sort_dir: str = Query("desc", description="asc | desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """
    GET /api/page-scanner/pages
    Truy vấn danh sách Fanpage đã cào (phân trang, lọc phiên/từ khóa/follower, sắp xếp).
    """
    owner = _get_owner()
    offset = (page - 1) * page_size
    sort_dir_sql = "DESC" if str(sort_dir).lower() != "asc" else "ASC"
    sort_key = str(sort_by or "followers").lower()
    source_kw = (source_keyword or "").strip() or None

    if session_id:
        query_params: List[Any] = [owner, session_id]
        where_conds = []

        if keyword:
            where_conds.append(
                "(sp.page_name ILIKE %s OR sp.page_url ILIKE %s OR COALESCE(sp.phone,'') ILIKE %s"
                " OR COALESCE(sp.email,'') ILIKE %s OR COALESCE(sp.website,'') ILIKE %s"
                " OR COALESCE(sp.address,'') ILIKE %s)"
            )
            kw_param = f"%{keyword.strip()}%"
            query_params.extend([kw_param, kw_param, kw_param, kw_param, kw_param, kw_param])

        if relevance_status and relevance_status.upper() in ["RELEVANT", "REVIEW", "EXCLUDED"]:
            where_conds.append("ssp.relevance_status = %s")
            query_params.append(relevance_status.upper())

        if min_followers is not None:
            where_conds.append("COALESCE(sp.follower_count, 0) >= %s")
            query_params.append(int(min_followers))

        cond_str = f" AND {' AND '.join(where_conds)}" if where_conds else ""

        if sort_key == "created":
            order_sql = f"sp.created_at {sort_dir_sql}, ssp.id ASC"
        elif sort_key == "default":
            order_sql = "ssp.id ASC"
        else:
            order_sql = f"COALESCE(sp.follower_count, 0) {sort_dir_sql}, ssp.id ASC"

        count_query = f"""
        SELECT COUNT(*) AS total
        FROM page_scan_session_pages ssp
        JOIN scanned_pages sp ON ssp.page_key = sp.page_key AND sp.owner_key = %s
        WHERE ssp.session_id = %s{cond_str}
        """
        count_row = db.fetch_one(count_query, tuple(query_params))
        total = int(count_row["total"]) if count_row else 0

        data_query = f"""
        SELECT sp.id, sp.page_key, sp.page_name, sp.page_url, sp.avatar_url,
               sp.category, sp.follower_count, sp.follower_text, sp.is_verified,
               sp.is_sponsored, sp.phone, sp.email, sp.website, sp.address,
               ssp.batch_index, ssp.is_new_globally,
               COALESCE(ssp.relevance_score, sp.relevance_score, 0) AS relevance_score,
               COALESCE(ssp.relevance_status, sp.relevance_status, 'RELEVANT') AS relevance_status,
               COALESCE(ssp.hashtag_post_count, sp.hashtag_post_count, 0) AS hashtag_post_count,
               COALESCE(ssp.matched_hashtags, sp.matched_hashtags) AS matched_hashtags,
               ssp.evidence_posts, ssp.latest_post_at, sp.created_at
        FROM page_scan_session_pages ssp
        JOIN scanned_pages sp ON ssp.page_key = sp.page_key AND sp.owner_key = %s
        WHERE ssp.session_id = %s{cond_str}
        ORDER BY {order_sql}
        LIMIT %s OFFSET %s
        """
        rows = _attach_source_keywords(
            owner, db.fetch_all(data_query, tuple(query_params + [page_size, offset])) or []
        )
    elif source_kw:
        # Chuẩn hóa: "#mypham" ≈ "mypham" (không phân biệt hoa thường)
        source_kw_norm = source_kw.lstrip("#").strip().lower()
        params: List[Any] = [
            owner,  # sp.owner_key
            owner,  # s.owner_key
            source_kw,  # s.keyword exact
            source_kw_norm,  # session keyword normalized
            source_kw_norm,  # matched_hashtags exact normalized
            f"%{source_kw_norm}%",  # matched_hashtags contains
        ]
        where_conds = [
            "sp.owner_key = %s",
            """(
                EXISTS (
                    SELECT 1
                    FROM page_scan_session_pages ssp
                    JOIN page_scan_sessions s ON s.id = ssp.session_id
                    WHERE ssp.page_key = sp.page_key
                      AND s.owner_key = %s
                      AND COALESCE(s.job_type, 'DISCOVERY') = 'DISCOVERY'
                      AND s.source_type IN ('SEARCH', 'HASHTAG')
                      AND (
                        s.keyword = %s
                        OR LOWER(REGEXP_REPLACE(TRIM(s.keyword), '^#+', '')) = %s
                      )
                )
                OR LOWER(REGEXP_REPLACE(TRIM(COALESCE(sp.matched_hashtags, '')), '^#+', '')) = %s
                OR (
                    sp.matched_hashtags IS NOT NULL
                    AND LOWER(sp.matched_hashtags) LIKE %s
                )
            )""",
        ]

        if keyword:
            where_conds.append(
                "(sp.page_name ILIKE %s OR sp.page_url ILIKE %s OR COALESCE(sp.phone,'') ILIKE %s"
                " OR COALESCE(sp.email,'') ILIKE %s OR COALESCE(sp.website,'') ILIKE %s"
                " OR COALESCE(sp.address,'') ILIKE %s)"
            )
            kw_param = f"%{keyword.strip()}%"
            params.extend([kw_param, kw_param, kw_param, kw_param, kw_param, kw_param])

        if relevance_status and relevance_status.upper() in ["RELEVANT", "REVIEW", "EXCLUDED"]:
            where_conds.append("sp.relevance_status = %s")
            params.append(relevance_status.upper())

        if min_followers is not None:
            where_conds.append("COALESCE(sp.follower_count, 0) >= %s")
            params.append(int(min_followers))

        cond_str = " AND ".join(where_conds)

        if sort_key == "created":
            order_sql = f"sp.created_at {sort_dir_sql}, sp.id DESC"
        elif sort_key == "default":
            order_sql = "sp.id DESC"
        else:
            order_sql = f"COALESCE(sp.follower_count, 0) {sort_dir_sql}, sp.id DESC"

        count_row = db.fetch_one(
            f"SELECT COUNT(*) AS total FROM scanned_pages sp WHERE {cond_str}",
            tuple(params),
        )
        total = int(count_row["total"]) if count_row else 0

        params.extend([page_size, offset])
        rows = _attach_source_keywords(
            owner,
            db.fetch_all(
                f"""
                SELECT sp.id, sp.page_key, sp.page_name, sp.page_url, sp.avatar_url, sp.category,
                       sp.follower_count, sp.follower_text, sp.is_verified, sp.is_sponsored,
                       sp.phone, sp.email, sp.website, sp.address,
                       sp.relevance_score, sp.relevance_status, sp.hashtag_post_count, sp.matched_hashtags,
                       sp.first_found_by_account_uid, sp.created_at, sp.updated_at
                FROM scanned_pages sp
                WHERE {cond_str}
                ORDER BY {order_sql}
                LIMIT %s OFFSET %s
                """,
                tuple(params),
            )
            or [],
        )
    else:
        params = [owner]
        where_conds = ["owner_key = %s"]

        if keyword:
            where_conds.append(
                "(page_name ILIKE %s OR page_url ILIKE %s OR COALESCE(phone,'') ILIKE %s"
                " OR COALESCE(email,'') ILIKE %s OR COALESCE(website,'') ILIKE %s"
                " OR COALESCE(address,'') ILIKE %s)"
            )
            kw_param = f"%{keyword.strip()}%"
            params.extend([kw_param, kw_param, kw_param, kw_param, kw_param, kw_param])

        if relevance_status and relevance_status.upper() in ["RELEVANT", "REVIEW", "EXCLUDED"]:
            where_conds.append("relevance_status = %s")
            params.append(relevance_status.upper())

        if min_followers is not None:
            where_conds.append("COALESCE(follower_count, 0) >= %s")
            params.append(int(min_followers))

        cond_str = " AND ".join(where_conds)

        if sort_key == "created":
            order_sql = f"created_at {sort_dir_sql}, id DESC"
        elif sort_key == "default":
            order_sql = "id DESC"
        else:
            order_sql = f"COALESCE(follower_count, 0) {sort_dir_sql}, id DESC"

        count_row = db.fetch_one(
            f"SELECT COUNT(*) AS total FROM scanned_pages WHERE {cond_str}",
            tuple(params),
        )
        total = int(count_row["total"]) if count_row else 0

        params.extend([page_size, offset])
        rows = _attach_source_keywords(
            owner,
            db.fetch_all(
                f"""
                SELECT id, page_key, page_name, page_url, avatar_url, category,
                       follower_count, follower_text, is_verified, is_sponsored,
                       phone, email, website, address,
                       relevance_score, relevance_status, hashtag_post_count, matched_hashtags,
                       first_found_by_account_uid, created_at, updated_at
                FROM scanned_pages
                WHERE {cond_str}
                ORDER BY {order_sql}
                LIMIT %s OFFSET %s
                """,
                tuple(params),
            )
            or [],
        )

    return {
        "items": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/campaigns/active")
async def get_active_campaign():
    """
    GET /api/page-scanner/campaigns/active
    Phiên RUNNING/PAUSED mới nhất của owner + toàn bộ phiên cùng campaign_id.
    Dùng để khôi phục state sau reload (chỉ dẫn 1.3).
    """
    owner = _get_owner()
    top = db.fetch_one(
        """
        SELECT * FROM page_scan_sessions
        WHERE owner_key = %s AND status IN ('RUNNING', 'PAUSED')
        ORDER BY id DESC
        LIMIT 1
        """,
        (owner,),
    )
    if not top:
        return {"active": False, "campaign_id": None, "sessions": []}

    campaign_id = top.get("campaign_id")
    if campaign_id:
        sessions = db.fetch_all(
            """
            SELECT * FROM page_scan_sessions
            WHERE owner_key = %s AND campaign_id = %s
            ORDER BY id ASC
            """,
            (owner, campaign_id),
        )
    else:
        sessions = [top]

    return {
        "active": True,
        "campaign_id": campaign_id,
        "primary_session_id": top.get("id"),
        "status": top.get("status"),
        "sessions": sessions,
        "settings": top.get("settings"),
    }


@router.post("/sessions/{session_id}/pause")
async def pause_scan_session(session_id: int):
    """TẠM DỪNG — treo tại điểm an toàn; không dùng stop event."""
    owner = _get_owner()
    session = db.fetch_one(
        "SELECT id, status FROM page_scan_sessions WHERE id = %s AND owner_key = %s",
        (session_id, owner),
    )
    if not session:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên quét")
    if session.get("status") not in ("RUNNING", "PAUSED"):
        raise HTTPException(status_code=400, detail=f"Phiên không thể tạm dừng (status={session.get('status')})")

    ok = request_pause_session(session_id)
    return {
        "session_id": session_id,
        "paused": True,
        "worker_signaled": ok,
        "message": f"Đã gửi tín hiệu tạm dừng phiên #{session_id}",
    }


@router.post("/sessions/{session_id}/resume")
async def resume_scan_session(session_id: int):
    """TIẾP TỤC — chạy tiếp đúng phiên đang PAUSED."""
    owner = _get_owner()
    session = db.fetch_one(
        "SELECT id, status FROM page_scan_sessions WHERE id = %s AND owner_key = %s",
        (session_id, owner),
    )
    if not session:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên quét")
    if session.get("status") not in ("PAUSED", "RUNNING"):
        raise HTTPException(status_code=400, detail=f"Phiên không thể tiếp tục (status={session.get('status')})")

    ok = request_resume_session(session_id)
    return {
        "session_id": session_id,
        "resumed": True,
        "worker_signaled": ok,
        "message": f"Đã gửi tín hiệu tiếp tục phiên #{session_id}",
    }


@router.post("/sessions/{session_id}/stop")
async def stop_scan_session(session_id: int):
    """
    POST /api/page-scanner/sessions/{session_id}/stop
    Dừng khẩn cấp một phiên quét đang diễn ra.
    """
    owner = _get_owner()
    session = db.fetch_one(
        "SELECT id, status, campaign_id FROM page_scan_sessions WHERE id = %s AND owner_key = %s",
        (session_id, owner),
    )
    if not session:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên quét")

    stopped = request_stop_session(session_id)
    # Dừng cả các phiên cùng campaign còn RUNNING/PAUSED
    campaign_id = session.get("campaign_id")
    if campaign_id:
        siblings = db.fetch_all(
            """
            SELECT id FROM page_scan_sessions
            WHERE owner_key = %s AND campaign_id = %s AND status IN ('RUNNING', 'PAUSED')
            """,
            (owner, campaign_id),
        )
        for row in siblings or []:
            sid = int(row["id"])
            request_stop_session(sid)
            db.execute(
                """
                UPDATE page_scan_sessions
                SET status = 'STOPPED', stop_reason = 'USER_STOPPED', finished_at = NOW()
                WHERE id = %s AND status IN ('RUNNING', 'PAUSED')
                """,
                (sid,),
            )
    elif session.get("status") in ("RUNNING", "PAUSED"):
        db.execute(
            "UPDATE page_scan_sessions SET status = 'STOPPED', stop_reason = 'USER_STOPPED', finished_at = NOW() WHERE id = %s",
            (session_id,),
        )

    # Dừng khẩn cấp → đóng Chrome page_scanner (kể cả đang keep_browser giữa các job)
    try:
        from core.browser import close_scoped_active_drivers
        close_scoped_active_drivers(scope="page_scanner", force=True)
    except Exception:
        pass

    return {
        "session_id": session_id,
        "stopped": True,
        "active_worker_signaled": stopped,
        "message": f"Đã gửi tín hiệu dừng cho phiên #{session_id}",
    }


# ==================== FOLLOWERS (job_type=FOLLOW) — UI + DB, chưa Selenium ====================


def _set_session_job_type(session_id: int, job_type: str) -> None:
    try:
        db.execute(
            "UPDATE page_scan_sessions SET job_type = %s WHERE id = %s",
            (job_type, session_id),
        )
    except Exception as exc:
        logger.warning(f"[PageScanner] set job_type={job_type} #{session_id}: {exc}")


@router.post("/followers/sessions")
async def create_follower_scan_session(item: FollowerSessionInput):
    """
    Tạo phiên quét followers Page + chạy Selenium background.
    Pause/resume/stop: POST /sessions/{id}/pause|resume|stop.
    409 nếu acc đang chạy job Selenium khác.
    """
    owner = _get_owner()
    page_keys = [str(k).strip() for k in (item.page_keys or []) if str(k).strip()]
    if not page_keys:
        raise HTTPException(status_code=400, detail="Cần ít nhất 1 page_key")

    try:
        session_id = await asyncio.to_thread(
            start_follower_scan_background,
            page_keys=page_keys,
            account_uid=item.account_uid,
            owner_key=owner,
            target_followers=item.target_followers,
            max_per_page=item.max_per_page,
            idle_timeout_s=item.idle_timeout_s,
            skip_existing=item.skip_existing,
            page_delay_s=item.page_delay_s,
            scroll_delay_s=item.scroll_delay_s,
            keep_browser=item.keep_browser,
            headless=item.headless,
            allow_direct_fallback=item.allow_direct_fallback,
            source_list_id=item.source_list_id,
        )
        return {
            "session_id": session_id,
            "job_type": "FOLLOW",
            "status": "RUNNING",
            "page_keys": page_keys,
            "message": f"Phiên FOLLOW #{session_id} đã khởi động",
            "automation_ready": True,
        }
    except AccountBusyError as busy:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "BUSY",
                "message": str(busy),
                "active_session_id": busy.active_session_id,
                "job_type": busy.job_type,
                "account_uid": busy.account_uid,
            },
        )
    except ValueError as val_err:
        raise HTTPException(status_code=422, detail=str(val_err))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo phiên FOLLOW: {exc}")


@router.post("/followers/import")
async def import_page_followers(item: FollowerImportInput):
    """Upsert batch followers vào scanned_page_followers."""
    owner = _get_owner()
    inserted = 0
    updated = 0
    for row in item.items:
        page_key = (row.page_key or "").strip()
        follower_key = (row.follower_key or "").strip()
        if not page_key or not follower_key:
            continue
        profile_url = row.profile_url or ""
        if not profile_url and follower_key.isdigit():
            profile_url = f"https://www.facebook.com/profile.php?id={follower_key}"
        elif not profile_url:
            profile_url = f"https://www.facebook.com/{follower_key.lstrip('/')}"
        try:
            res = db.fetch_one(
                """
                INSERT INTO scanned_page_followers (
                    owner_key, page_key, follower_key, follower_name, profile_url,
                    avatar_url, gender, location, first_session_id, last_session_id,
                    created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                )
                ON CONFLICT (owner_key, page_key, follower_key) DO UPDATE
                SET follower_name = COALESCE(EXCLUDED.follower_name, scanned_page_followers.follower_name),
                    profile_url = COALESCE(EXCLUDED.profile_url, scanned_page_followers.profile_url),
                    avatar_url = COALESCE(EXCLUDED.avatar_url, scanned_page_followers.avatar_url),
                    gender = COALESCE(EXCLUDED.gender, scanned_page_followers.gender),
                    location = COALESCE(EXCLUDED.location, scanned_page_followers.location),
                    last_session_id = COALESCE(EXCLUDED.last_session_id, scanned_page_followers.last_session_id),
                    updated_at = NOW()
                RETURNING (xmax = 0) AS is_new
                """,
                (
                    owner,
                    page_key,
                    follower_key,
                    row.follower_name,
                    profile_url,
                    row.avatar_url,
                    row.gender,
                    row.location,
                    item.session_id,
                    item.session_id,
                ),
            )
            if res and res.get("is_new"):
                inserted += 1
            else:
                updated += 1
        except Exception as exc:
            logger.warning(f"[PageScanner] import follower fail: {exc}")
            # Fallback không xmax
            try:
                db.execute(
                    """
                    INSERT INTO scanned_page_followers (
                        owner_key, page_key, follower_key, follower_name, profile_url,
                        avatar_url, gender, location, first_session_id, last_session_id,
                        created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    ON CONFLICT (owner_key, page_key, follower_key) DO UPDATE
                    SET follower_name = COALESCE(EXCLUDED.follower_name, scanned_page_followers.follower_name),
                        last_session_id = COALESCE(EXCLUDED.last_session_id, scanned_page_followers.last_session_id),
                        updated_at = NOW()
                    """,
                    (
                        owner,
                        page_key,
                        follower_key,
                        row.follower_name,
                        profile_url,
                        row.avatar_url,
                        row.gender,
                        row.location,
                        item.session_id,
                        item.session_id,
                    ),
                )
                updated += 1
            except Exception as exc2:
                logger.warning(f"[PageScanner] import follower fallback: {exc2}")

    if item.session_id:
        append_session_log(
            item.session_id,
            f"Import followers: +{inserted} mới · {updated} cập nhật",
            "success",
        )
    return {"inserted": inserted, "updated": updated, "total": inserted + updated}


@router.get("/followers")
async def list_page_followers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    page_key: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    session_id: Optional[int] = Query(None),
):
    """Danh sách người theo dõi đã lưu (DS followers)."""
    owner = _get_owner()
    offset = (page - 1) * page_size
    params: List[Any] = [owner]
    where = ["f.owner_key = %s"]
    if page_key:
        where.append("f.page_key = %s")
        params.append(page_key.strip())
    if session_id:
        where.append("f.last_session_id = %s")
        params.append(int(session_id))
    if keyword:
        where.append(
            "(f.follower_name ILIKE %s OR f.profile_url ILIKE %s OR f.follower_key ILIKE %s OR COALESCE(f.location,'') ILIKE %s)"
        )
        kw = f"%{keyword.strip()}%"
        params.extend([kw, kw, kw, kw])
    cond = " AND ".join(where)
    count_row = db.fetch_one(
        f"SELECT COUNT(*) AS total FROM scanned_page_followers f WHERE {cond}",
        tuple(params),
    )
    total = int(count_row["total"]) if count_row else 0
    rows = db.fetch_all(
        f"""
        SELECT f.*, sp.page_name, sp.page_url AS source_page_url
        FROM scanned_page_followers f
        LEFT JOIN scanned_pages sp ON sp.owner_key = f.owner_key AND sp.page_key = f.page_key
        WHERE {cond}
        ORDER BY f.id DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params + [page_size, offset]),
    )
    return {
        "items": rows or [],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ==================== POSTS (job_type=POST_SCAN) ====================


@router.post("/posts/sessions")
async def create_post_scan_session(item: PostSessionInput):
    """Tạo phiên quét bài viết Page + Selenium background. 409 nếu acc BUSY."""
    owner = _get_owner()
    page_keys = [str(k).strip() for k in (item.page_keys or []) if str(k).strip()]
    if not page_keys:
        raise HTTPException(status_code=400, detail="Cần ít nhất 1 page_key")

    post_types = item.post_types or ["all"]
    try:
        session_id = await asyncio.to_thread(
            start_post_scan_background,
            page_keys=page_keys,
            account_uid=item.account_uid,
            owner_key=owner,
            max_posts_per_page=item.max_posts_per_page,
            date_from=item.date_from,
            date_to=item.date_to,
            post_types=post_types,
            idle_timeout_s=item.idle_timeout_s,
            skip_existing=item.skip_existing,
            page_delay_s=item.page_delay_s,
            scroll_delay_s=item.scroll_delay_s,
            keep_browser=item.keep_browser,
            headless=item.headless,
            allow_direct_fallback=item.allow_direct_fallback,
            source_list_id=item.source_list_id,
        )
        return {
            "session_id": session_id,
            "job_type": "POST_SCAN",
            "status": "RUNNING",
            "page_keys": page_keys,
            "message": f"Phiên POST_SCAN #{session_id} đã khởi động",
            "automation_ready": True,
        }
    except AccountBusyError as busy:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "BUSY",
                "message": str(busy),
                "active_session_id": busy.active_session_id,
                "job_type": busy.job_type,
                "account_uid": busy.account_uid,
            },
        )
    except ValueError as val_err:
        raise HTTPException(status_code=422, detail=str(val_err))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo phiên POST_SCAN: {exc}")


@router.post("/posts/import")
async def import_scanned_posts(item: PostImportInput):
    """Upsert batch bài viết vào scanned_posts."""
    owner = _get_owner()
    inserted = 0
    updated = 0
    for row in item.items:
        page_key = (row.page_key or "").strip()
        post_url = (row.post_url or "").strip()
        post_key = normalize_post_key(row.post_key or post_url)
        if not page_key or not post_key or not post_url:
            continue
        try:
            res = db.fetch_one(
                """
                INSERT INTO scanned_posts (
                    owner_key, page_key, post_key, post_url, published_at, published_text,
                    content, post_type, reaction_count, comment_count, share_count,
                    is_pinned, first_session_id, last_session_id, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                )
                ON CONFLICT (owner_key, page_key, post_key) DO UPDATE
                SET post_url = EXCLUDED.post_url,
                    content = COALESCE(EXCLUDED.content, scanned_posts.content),
                    post_type = COALESCE(EXCLUDED.post_type, scanned_posts.post_type),
                    reaction_count = GREATEST(scanned_posts.reaction_count, EXCLUDED.reaction_count),
                    comment_count = GREATEST(scanned_posts.comment_count, EXCLUDED.comment_count),
                    share_count = GREATEST(scanned_posts.share_count, EXCLUDED.share_count),
                    published_at = COALESCE(EXCLUDED.published_at, scanned_posts.published_at),
                    published_text = COALESCE(EXCLUDED.published_text, scanned_posts.published_text),
                    last_session_id = COALESCE(EXCLUDED.last_session_id, scanned_posts.last_session_id),
                    updated_at = NOW()
                RETURNING (xmax = 0) AS is_new
                """,
                (
                    owner,
                    page_key,
                    post_key,
                    post_url,
                    row.published_at or None,
                    row.published_text,
                    row.content,
                    row.post_type,
                    int(row.reaction_count or 0),
                    int(row.comment_count or 0),
                    int(row.share_count or 0),
                    bool(row.is_pinned),
                    item.session_id,
                    item.session_id,
                ),
            )
            if res and res.get("is_new"):
                inserted += 1
            else:
                updated += 1
        except Exception as exc:
            logger.warning(f"[PageScanner] import post fail: {exc}")
            try:
                db.execute(
                    """
                    INSERT INTO scanned_posts (
                        owner_key, page_key, post_key, post_url, published_text,
                        content, post_type, reaction_count, comment_count, share_count,
                        is_pinned, first_session_id, last_session_id, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                    ON CONFLICT (owner_key, page_key, post_key) DO UPDATE
                    SET content = COALESCE(EXCLUDED.content, scanned_posts.content),
                        last_session_id = COALESCE(EXCLUDED.last_session_id, scanned_posts.last_session_id),
                        updated_at = NOW()
                    """,
                    (
                        owner,
                        page_key,
                        post_key,
                        post_url,
                        row.published_text,
                        row.content,
                        row.post_type,
                        int(row.reaction_count or 0),
                        int(row.comment_count or 0),
                        int(row.share_count or 0),
                        bool(row.is_pinned),
                        item.session_id,
                        item.session_id,
                    ),
                )
                updated += 1
            except Exception as exc2:
                logger.warning(f"[PageScanner] import post fallback: {exc2}")

    if item.session_id:
        append_session_log(
            item.session_id,
            f"Import posts: +{inserted} mới · {updated} cập nhật",
            "success",
        )
    return {"inserted": inserted, "updated": updated, "total": inserted + updated}


@router.get("/posts/pages")
async def list_pages_with_posts():
    """
    GET /api/page-scanner/posts/pages
    Sidebar DS bài viết: page có bài đã quét + số bài.
    """
    owner = _get_owner()
    rows = db.fetch_all(
        """
        SELECT
            p.page_key,
            COALESCE(sp.page_name, p.page_key) AS page_name,
            sp.page_url,
            sp.avatar_url,
            COUNT(*)::int AS post_count,
            MAX(p.updated_at) AS last_post_at
        FROM scanned_posts p
        LEFT JOIN scanned_pages sp
          ON sp.owner_key = p.owner_key AND sp.page_key = p.page_key
        WHERE p.owner_key = %s
        GROUP BY p.page_key, sp.page_name, sp.page_url, sp.avatar_url
        ORDER BY MAX(p.updated_at) DESC NULLS LAST, COUNT(*) DESC
        """,
        (owner,),
    )
    items = []
    total_posts = 0
    for r in rows or []:
        pc = int(r.get("post_count") or 0)
        total_posts += pc
        items.append(
            {
                "page_key": r.get("page_key"),
                "page_name": r.get("page_name"),
                "page_url": r.get("page_url"),
                "avatar_url": r.get("avatar_url"),
                "post_count": pc,
                "last_post_at": r.get("last_post_at"),
            }
        )
    return {"items": items, "total": len(items), "total_posts": total_posts}


@router.get("/posts")
async def list_scanned_posts(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    page_key: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    session_id: Optional[int] = Query(None),
    days: Optional[int] = Query(None, ge=1, le=3650, description="Lọc bài trong N ngày gần nhất"),
    min_reactions: Optional[int] = Query(None, ge=0),
    min_comments: Optional[int] = Query(None, ge=0),
    min_shares: Optional[int] = Query(None, ge=0),
):
    """Danh sách bài viết đã lưu (DS bài viết page)."""
    owner = _get_owner()
    offset = (page - 1) * page_size
    params: List[Any] = [owner]
    where = ["p.owner_key = %s"]
    if page_key:
        where.append("p.page_key = %s")
        params.append(page_key.strip())
    if session_id:
        where.append("p.last_session_id = %s")
        params.append(int(session_id))
    if keyword:
        where.append(
            "(COALESCE(p.content,'') ILIKE %s OR p.post_url ILIKE %s OR p.page_key ILIKE %s)"
        )
        kw = f"%{keyword.strip()}%"
        params.extend([kw, kw, kw])
    if days:
        where.append(
            "(p.published_at >= NOW() - (%s || ' days')::interval"
            " OR (p.published_at IS NULL AND p.created_at >= NOW() - (%s || ' days')::interval))"
        )
        params.extend([str(int(days)), str(int(days))])
    if min_reactions is not None:
        where.append("COALESCE(p.reaction_count, 0) >= %s")
        params.append(int(min_reactions))
    if min_comments is not None:
        where.append("COALESCE(p.comment_count, 0) >= %s")
        params.append(int(min_comments))
    if min_shares is not None:
        where.append("COALESCE(p.share_count, 0) >= %s")
        params.append(int(min_shares))
    cond = " AND ".join(where)
    count_row = db.fetch_one(
        f"SELECT COUNT(*) AS total FROM scanned_posts p WHERE {cond}",
        tuple(params),
    )
    total = int(count_row["total"]) if count_row else 0
    rows = db.fetch_all(
        f"""
        SELECT p.*, sp.page_name, sp.page_url AS source_page_url, sp.avatar_url
        FROM scanned_posts p
        LEFT JOIN scanned_pages sp ON sp.owner_key = p.owner_key AND sp.page_key = p.page_key
        WHERE {cond}
        ORDER BY COALESCE(p.published_at, p.created_at) DESC NULLS LAST, p.id DESC
        LIMIT %s OFFSET %s
        """,
        tuple(params + [page_size, offset]),
    )
    return {
        "items": rows or [],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/source/resolve-pages")
async def resolve_page_keys_from_links(item: ParseInput):
    """Chuẩn hoá link dán → page_key (dùng picker nguồn mục 2/3)."""
    owner = _get_owner()
    parsed = parse_page_file_content(
        item.content,
        filter_existing=item.filter_existing,
        owner_key=owner if item.filter_existing else None,
    )
    return parsed
