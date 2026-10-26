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
    parse_page_file_content,
)
from ..scanner import (
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
    max_posts_per_hashtag: int = Field(100, ge=10, le=300, description="Số bài viết tối đa mỗi hashtag")
    account_uid: Optional[str] = Field(None, description="UID tài khoản Facebook cào (tuỳ chọn)")
    headless: bool = Field(False, description="Chạy Chrome ẩn hay hiện")
    allow_direct_fallback: bool = Field(True, description="Tự động chuyển sang IP trực tiếp nếu proxy lỗi")
    campaign_id: Optional[str] = Field(None, description="Mã đợt chạy gom nhiều phiên con")
    keep_browser: bool = Field(
        False,
        description="Giữ Chrome page_scanner khi phiên kết thúc bình thường (job kế cùng acc)",
    )


class ParseInput(BaseModel):
    content: str = Field(..., min_length=1, description="Chuỗi danh sách link/UID mỗi dòng 1 Page")
    filter_existing: bool = Field(False, description="Kiểm tra đối chiếu trùng với kho đã lưu")
    save_to_db: bool = Field(False, description="Lưu ngay các Page hợp lệ vào kho database")


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
        )
        return {
            "session_id": session_id,
            "campaign_id": item.campaign_id,
            "status": "RUNNING",
            "message": f"Phiên quét hashtag #{session_id} đã được khởi động thành công",
        }
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


@router.get("/pages")
async def list_scanned_pages(
    session_id: Optional[int] = Query(None, description="Lọc theo mã phiên quét"),
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

    if session_id:
        query_params: List[Any] = [owner, session_id]
        where_conds = []

        if keyword:
            where_conds.append(
                "(sp.page_name ILIKE %s OR sp.page_url ILIKE %s OR COALESCE(sp.phone,'') ILIKE %s OR COALESCE(sp.email,'') ILIKE %s)"
            )
            kw_param = f"%{keyword.strip()}%"
            query_params.extend([kw_param, kw_param, kw_param, kw_param])

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
               sp.is_sponsored, sp.phone, sp.email, sp.website,
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
        rows = db.fetch_all(data_query, tuple(query_params + [page_size, offset]))
    else:
        params = [owner]
        where_conds = ["owner_key = %s"]

        if keyword:
            where_conds.append(
                "(page_name ILIKE %s OR page_url ILIKE %s OR COALESCE(phone,'') ILIKE %s OR COALESCE(email,'') ILIKE %s)"
            )
            kw_param = f"%{keyword.strip()}%"
            params.extend([kw_param, kw_param, kw_param, kw_param])

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
        rows = db.fetch_all(
            f"""
            SELECT id, page_key, page_name, page_url, avatar_url, category,
                   follower_count, follower_text, is_verified, is_sponsored,
                   phone, email, website,
                   relevance_score, relevance_status, hashtag_post_count, matched_hashtags,
                   first_found_by_account_uid, created_at, updated_at
            FROM scanned_pages
            WHERE {cond_str}
            ORDER BY {order_sql}
            LIMIT %s OFFSET %s
            """,
            tuple(params),
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
