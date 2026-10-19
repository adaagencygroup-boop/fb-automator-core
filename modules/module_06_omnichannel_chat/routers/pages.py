import time
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional, Dict
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.config import settings
from modules.module_06_omnichannel_chat.schemas import PageOut, TokenInput, SyncByTokenResponse
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

@router.get("/config")
def get_config():
    return {
        "facebook_app_id": settings.FACEBOOK_APP_ID or "",
        "facebook_api_version": settings.FACEBOOK_API_VERSION
    }

@router.get("/pages", response_model=List[PageOut])
def get_local_pages(
    request: Request,
    facebook_user_id: Optional[str] = None,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[SystemUser] = Depends(get_current_user_optional)
):
    """
    Lấy danh sách Fanpage trực tiếp từ bảng 'v_pages' (Module 6) liên kết với bảng 'accounts' (Module 2),
    lọc theo user_id đang đăng nhập, không phụ thuộc bảng pages của Module 5.
    """
    logged_in_uid = (user_id or "").strip() or resolve_current_user_id(request, current_user)

    # 1. Tự động kiểm tra và đồng bộ Fanpage từ Graph API cho các tài khoản Module 2 của user nếu có token
    if logged_in_uid:
        try:
            user_accs = db.execute(
                text("SELECT uid, token FROM accounts WHERE CAST(user_id AS VARCHAR) = :uid AND token IS NOT NULL AND token != ''"),
                {"uid": str(logged_in_uid)}
            ).mappings().all()

            now = time.time()
            sync_service = FacebookSyncService(db)
            sys_uid = int(logged_in_uid) if (logged_in_uid and str(logged_in_uid).isdigit()) else 1
            for acc in user_accs:
                acc_uid = str(acc["uid"])
                acc_token = acc["token"]
                # Cooldown 5 phút mỗi tài khoản để tránh gọi Graph API quá nhiều lần
                if now - _last_synced_accounts.get(acc_uid, 0) > 300:
                    _last_synced_accounts[acc_uid] = now
                    try:
                        sync_service.sync_by_token(acc_token, system_user_id=sys_uid)
                    except Exception as tok_err:
                        print(f"[Warning] Auto-sync token error for acc {acc_uid}: {tok_err}")
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

    # 3. Kích hoạt chạy ngầm sync_historical_data khi user mở Quản lý Chat Page
    try:
        sync_service = FacebookSyncService(db)
        now = time.time()
        for r in rows:
            p_id = str(r["page_id"])
            p_acc_uid = str(r.get("facebook_user_id") or "")
            # Cooldown 120s (2 phút) mỗi page để tránh spam Facebook Graph API
            if now - _last_synced_pages.get(p_id, 0) > 120:
                _last_synced_pages[p_id] = now
                sync_executor.submit(sync_service.sync_historical_data, p_id, p_acc_uid)
    except Exception as sync_trigger_err:
        print(f"[Warning] Trigger sync_historical_data note: {sync_trigger_err}")

    # 4. Trả về định dạng PageOut
    results = []
    for r in rows:
        avatar = r.get("avatar_url") or f"https://graph.facebook.com/v19.0/{r['page_id']}/picture?type=large"
        results.append(PageOut(
            id=r["id"],
            page_id=str(r["page_id"]),
            page_name=r["page_name"] or "",
            avatar_url=avatar,
            status=(r.get("status") or "active").lower(),
            facebook_user_id=str(r.get("facebook_user_id") or "")
        ))

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
