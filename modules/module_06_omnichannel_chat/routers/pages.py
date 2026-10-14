from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.config import settings
from modules.module_06_omnichannel_chat.schemas import PageOut, TokenInput, SyncByTokenResponse
from modules.module_06_omnichannel_chat.repositories import PageRepository, AccountRepository
from modules.module_06_omnichannel_chat.services import FacebookSyncService, FacebookAuthError, FacebookAPIError
from modules.module_06_omnichannel_chat.models import Page, Account, SystemUser
from modules.module_06_omnichannel_chat.auth import get_current_user_optional

router = APIRouter(prefix="/api/facebook", tags=["Pages"])

@router.get("/config")
def get_config():
    return {
        "facebook_app_id": settings.FACEBOOK_APP_ID or "",
        "facebook_api_version": settings.FACEBOOK_API_VERSION
    }

@router.get("/pages", response_model=List[PageOut])
def get_local_pages(
    facebook_user_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[SystemUser] = Depends(get_current_user_optional)
):
    """Fetch stored Facebook pages for a given User ID or current logged-in SystemUser."""
    query = db.query(Page)

    if current_user and current_user.role != "admin":
        query = query.join(Account, Page.facebook_user_id == Account.facebook_user_id)\
                     .filter(Account.system_user_id == current_user.id)

    if facebook_user_id:
        query = query.filter(Page.facebook_user_id == facebook_user_id)

    return query.all()

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
