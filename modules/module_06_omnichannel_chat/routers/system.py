from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.models import Account, Page, Message, Notification, PushSubscription, SystemUser, Conversation, Customer
from modules.module_06_omnichannel_chat.auth import get_current_user_optional

router = APIRouter(prefix="/api/facebook", tags=["System"])

@router.post("/reset")
def reset_database(
    facebook_user_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[SystemUser] = Depends(get_current_user_optional)
):
    """Deletes synced accounts, pages, messages, notifications, and push subscriptions for current logged-in user or given facebook_user_id."""
    try:
        fb_user_ids = []

        if current_user:
            # 1. Get accounts belonging to current logged-in user
            user_accounts = db.query(Account).filter(Account.system_user_id == current_user.id).all()
            fb_user_ids = [acc.facebook_user_id for acc in user_accounts if acc.facebook_user_id]

        # Fallback to facebook_user_id if provided
        if facebook_user_id and facebook_user_id not in fb_user_ids:
            fb_user_ids.append(facebook_user_id)

        if not fb_user_ids and not current_user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để thực hiện xóa dữ liệu."
            )

        if fb_user_ids:
            # 2. Get pages belonging to target facebook_user_ids
            user_pages = db.query(Page).filter(Page.facebook_user_id.in_(fb_user_ids)).all()
            page_ids = [p.page_id for p in user_pages if p.page_id]

            if page_ids:
                # 3. Delete messages, notifications and conversations for user's pages
                db.query(Message).filter(Message.page_id.in_(page_ids)).delete(synchronize_session=False)
                db.query(Notification).filter(Notification.page_id.in_(page_ids)).delete(synchronize_session=False)
                db.query(Conversation).filter(Conversation.page_id.in_(page_ids)).delete(synchronize_session=False)

            # 4. Delete user's pages
            db.query(Page).filter(Page.facebook_user_id.in_(fb_user_ids)).delete(synchronize_session=False)

            # 5. Delete user's accounts
            db.query(Account).filter(Account.facebook_user_id.in_(fb_user_ids)).delete(synchronize_session=False)

        if current_user:
            # 6. Delete remaining user accounts and push subscriptions for current_user
            db.query(Account).filter(Account.system_user_id == current_user.id).delete(synchronize_session=False)
            db.query(PushSubscription).filter(PushSubscription.system_user_id == current_user.id).delete(synchronize_session=False)

        db.commit()
        return {"success": True, "message": "Đã xóa toàn bộ dữ liệu tài khoản thành công."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
