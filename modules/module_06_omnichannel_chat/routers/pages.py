import time
import math
from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional, Dict, Union
from modules.module_06_omnichannel_chat.database import get_db, SessionLocal
from modules.module_06_omnichannel_chat.config import settings
from modules.module_06_omnichannel_chat.schemas import PageOut, TokenInput, SyncByTokenResponse, PaginatedPagesOut
from modules.module_06_omnichannel_chat.repositories import PageRepository, AccountRepository
from modules.module_06_omnichannel_chat.services import FacebookSyncService, FacebookAuthError, FacebookAPIError
from modules.module_06_omnichannel_chat.services.sync_service import sync_executor
from modules.module_06_omnichannel_chat.models import Page, Account, SystemUser
from modules.module_06_omnichannel_chat.auth import get_current_user_optional

router = APIRouter(prefix="/api/facebook", tags=["Pages"])

_last_synced_pages: Dict[str, float] = {}
_last_synced_accounts: Dict[str, float] = {}

def resolve_current_user_id(request: Request, current_user: Optional[SystemUser] = None) -> Optional[str]:
    """Xác định user_id đang đăng nhập từ nhiều nguồn (Header, Cookie, Token, SessionUser)."""
    # 1. Header do Next.js gửi qua axios interceptor
    user_id = request.headers.get("x-auth-user-id") or request.headers.get("x-user-id")
    if user_id and user_id.strip():
        return user_id.strip()

    # 2. Token phiên đăng nhập của module_auth (Authorization Header hoặc Cookie)
    auth_header = request.headers.get("Authorization")
    user_client = request.headers.get("x-auth-client") == "user"
    cookie_token = request.cookies.get("fb_user_access") or (None if user_client else request.cookies.get("fb_access"))
    if (auth_header and auth_header.strip()) or cookie_token:
        try:
            from modules.module_auth.service import bearer_user
            auth_user = bearer_user(auth_header, require_session=False, request=request)
            if auth_user and auth_user.get("id") is not None:
                return str(auth_user["id"])
        except Exception:
            pass

    # 3. SystemUser từ get_current_user_optional (nếu có)
    if current_user and hasattr(current_user, "id") and not hasattr(current_user, "dependency") and current_user.id:
        return str(current_user.id)

    # 4. Query params user_id (nếu có)
    q_user = request.query_params.get("user_id")
    if q_user and q_user.strip():
        return q_user.strip()

    return None

@router.get("/status")
def get_chat_status(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Optional[SystemUser] = Depends(get_current_user_optional)
):
    """Kiểm tra xem Module 2 của user đã import tài khoản Facebook chưa và có Page chưa."""
    logged_in_uid = resolve_current_user_id(request, current_user)
    accounts_count = 0
    pages_count = 0
    if logged_in_uid:
        accounts_count = db.execute(
            text("SELECT count(*) FROM accounts WHERE CAST(user_id AS VARCHAR) = :uid"),
            {"uid": str(logged_in_uid)}
        ).scalar() or 0
        pages_count = db.execute(
            text("""
                SELECT count(DISTINCT p.page_id)
                FROM (
                    SELECT page_id, facebook_user_id FROM v_pages
                    UNION
                    SELECT page_id, account_uid as facebook_user_id FROM pages WHERE page_id IS NOT NULL
                ) p
                LEFT JOIN v_accounts va ON p.facebook_user_id = va.facebook_user_id
                LEFT JOIN accounts a ON (
                    p.facebook_user_id = a.uid 
                    OR va.user_access_token = a.token
                    OR va.facebook_user_id = a.uid
                    OR (va.name IS NOT NULL AND va.name != '' AND va.name = a.profile_name)
                )
                WHERE (CAST(a.user_id AS VARCHAR) = :user_id OR CAST(va.system_user_id AS VARCHAR) = :user_id)
            """),
            {"user_id": str(logged_in_uid)}
        ).scalar() or 0
    else:
        accounts_count = db.execute(text("SELECT count(*) FROM accounts")).scalar() or 0
        pages_count = db.execute(text("SELECT count(*) FROM v_pages")).scalar() or 0

    return {
        "has_accounts": accounts_count > 0,
        "accounts_count": accounts_count,
        "has_pages": pages_count > 0,
        "pages_count": pages_count,
    }

@router.get("/config")
def get_config():
    return {
        "facebook_app_id": settings.FACEBOOK_APP_ID or "",
        "facebook_api_version": settings.FACEBOOK_API_VERSION
    }

@router.get("/pages", response_model=Union[PaginatedPagesOut, List[PageOut]])
def get_local_pages(
    request: Request,
    facebook_user_id: Optional[str] = None,
    user_id: Optional[str] = None,
    page: Optional[int] = Query(None, ge=1, description="Số trang (1-indexed)"),
    page_size: Optional[int] = Query(None, ge=1, le=100, description="Số lượng mục trên 1 trang"),
    limit: Optional[int] = Query(None, ge=1, le=100, description="Số lượng mục cần lấy"),
    offset: Optional[int] = Query(None, ge=0, description="Vị trí bắt đầu"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo tên hoặc ID Page"),
    db: Session = Depends(get_db),
    current_user: Optional[SystemUser] = Depends(get_current_user_optional)
):
    """
    Lấy danh sách Fanpage trực tiếp từ bảng 'v_pages' (Module 6) liên kết với bảng 'accounts' (Module 2),
    lọc theo user_id đang đăng nhập, không phụ thuộc bảng pages của Module 5.
    """
    logged_in_uid = (user_id or "").strip() or resolve_current_user_id(request, current_user)

    # 1. Tự động kiểm tra và đồng bộ Fanpage từ Graph API (chạy ngầm trong executor, không chặn request)
    if logged_in_uid:
        try:
            user_accs = db.execute(
                text("SELECT uid, token FROM accounts WHERE CAST(user_id AS VARCHAR) = :uid AND token IS NOT NULL AND token != ''"),
                {"uid": str(logged_in_uid)}
            ).mappings().all()

            now = time.time()
            sys_uid = int(logged_in_uid) if (logged_in_uid and str(logged_in_uid).isdigit()) else 1
            for acc in user_accs:
                acc_uid = str(acc["uid"])
                acc_token = acc["token"]
                # Cooldown 5 phút mỗi tài khoản để tránh gọi Graph API quá nhiều lần
                if now - _last_synced_accounts.get(acc_uid, 0) > 300:
                    _last_synced_accounts[acc_uid] = now
                    def _bg_sync_token(tok, suid, auid):
                        try:
                            with SessionLocal() as bg_db:
                                FacebookSyncService(bg_db).sync_by_token(tok, system_user_id=suid)
                        except Exception as tok_err:
                            print(f"[Warning] Auto-sync token error for acc {auid}: {tok_err}")
                    sync_executor.submit(_bg_sync_token, acc_token, sys_uid, acc_uid)
        except Exception as e:
            print(f"[Warning] Auto-sync check error: {e}")

    # 2. Truy vấn danh sách Page từ v_pages kết hợp accounts (Module 2)
    params = {}
    where_clauses = []

    if logged_in_uid:
        where_clauses.append("(CAST(a.user_id AS VARCHAR) = :user_id OR CAST(va.system_user_id AS VARCHAR) = :user_id)")
        params["user_id"] = str(logged_in_uid)

    if facebook_user_id:
        where_clauses.append("p.facebook_user_id = :fb_uid")
        params["fb_uid"] = str(facebook_user_id)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    sql = text(f"""
        SELECT DISTINCT p.id, p.page_id, p.page_name, p.page_access_token, p.avatar_url, p.status, p.facebook_user_id
        FROM v_pages p
        LEFT JOIN v_accounts va ON p.facebook_user_id = va.facebook_user_id
        LEFT JOIN accounts a ON (
            p.facebook_user_id = a.uid 
            OR va.user_access_token = a.token
            OR va.facebook_user_id = a.uid
            OR (va.name IS NOT NULL AND va.name != '' AND va.name = a.profile_name)
        )
        {where_sql}
        ORDER BY p.id DESC
    """)

    rows = db.execute(sql, params).mappings().all()

    # 3. Kích hoạt chạy ngầm sync_historical_data cho các trang đầu (tối đa 3 trang để tránh nghẽn thread pool)
    try:
        now = time.time()
        for r in rows[:3]:
            p_id = str(r["page_id"])
            p_acc_uid = str(r.get("facebook_user_id") or "")
            if now - _last_synced_pages.get(p_id, 0) > 300:
                _last_synced_pages[p_id] = now
                def _bg_sync_page(page_id, acc_uid):
                    try:
                        with SessionLocal() as bg_db:
                            FacebookSyncService(bg_db).sync_historical_data(page_id, acc_uid)
                    except Exception as err:
                        print(f"[Warning] Sync page {page_id} error: {err}")
                sync_executor.submit(_bg_sync_page, p_id, p_acc_uid)
    except Exception as sync_trigger_err:
        print(f"[Warning] Trigger sync_historical_data note: {sync_trigger_err}")

    # 4. Trả về định dạng PageOut & Phân trang
    p_page = page if isinstance(page, int) else None
    p_size = page_size if isinstance(page_size, int) else None
    p_limit = limit if isinstance(limit, int) else None
    p_offset = offset if isinstance(offset, int) else None
    s_query = search.strip().lower() if isinstance(search, str) else ""

    results = []
    for r in rows:
        p_name = r["page_name"] or ""
        p_id = str(r["page_id"])
        if s_query and (s_query not in p_name.lower() and s_query not in p_id.lower()):
            continue
        avatar = r.get("avatar_url") or f"https://graph.facebook.com/v19.0/{r['page_id']}/picture?type=large"
        results.append(PageOut(
            id=r["id"],
            page_id=p_id,
            page_name=p_name,
            avatar_url=avatar,
            status=(r.get("status") or "active").lower(),
            facebook_user_id=str(r.get("facebook_user_id") or "")
        ))

    total = len(results)
    if p_page is not None or p_limit is not None or p_offset is not None or p_size is not None:
        effective_page_size = p_size or p_limit or 20
        effective_page = p_page or ((p_offset // effective_page_size) + 1 if p_offset is not None else 1)
        effective_offset = p_offset if p_offset is not None else (effective_page - 1) * effective_page_size
        sliced = results[effective_offset : effective_offset + effective_page_size]
        total_pages = math.ceil(total / effective_page_size) if effective_page_size else 1
        return PaginatedPagesOut(
            items=sliced,
            pages=sliced,
            total=total,
            page=effective_page,
            page_size=effective_page_size,
            total_pages=total_pages
        )

    return results

@router.post("/sync-by-token", response_model=SyncByTokenResponse)
def sync_by_user_token(
    payload: TokenInput,
    db: Session = Depends(get_db),
    current_user: Optional[SystemUser] = Depends(get_current_user_optional)
):
    """Sync Facebook Pages using long-lived User Token."""
    sync_service = FacebookSyncService(db)
    system_user_id = current_user.id if current_user else 1
    try:
        facebook_user_id, pages_count, pages = sync_service.sync_by_token(payload.access_token, system_user_id=system_user_id)
        page_outs = [PageOut.model_validate(p) for p in pages]
        return SyncByTokenResponse(
            success=True,
            message=f"Đã đồng bộ {pages_count} trang Facebook thành công!",
            facebook_user_id=facebook_user_id,
            synced_count=pages_count,
            pages_count=pages_count,
            pages=page_outs
        )
    except FacebookAuthError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
    except FacebookAPIError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Lỗi hệ thống: {str(e)}")
