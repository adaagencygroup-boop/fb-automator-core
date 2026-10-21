from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.schemas import PushSubscriptionInput
from modules.module_06_omnichannel_chat.models import PushSubscription, Account, SystemUser

router = APIRouter(prefix="/api/facebook", tags=["Push Notifications"])

@router.post("/push/subscribe")
def subscribe_push(
    payload: PushSubscriptionInput, 
    db: Session = Depends(get_db)
):
    """API to receive Push Subscription from Frontend."""
    system_user_id = None
    if payload.facebook_user_id:
        acc = db.query(Account).filter(Account.facebook_user_id == payload.facebook_user_id).first()
        if acc:
            system_user_id = acc.system_user_id

    if not system_user_id:
        first_user = db.query(SystemUser).first()
        if first_user:
            system_user_id = first_user.id

    existing_sub = db.query(PushSubscription).filter(
        PushSubscription.endpoint == payload.endpoint
    ).first()

    if existing_sub:
        existing_sub.facebook_user_id = payload.facebook_user_id
        if system_user_id:
            existing_sub.system_user_id = system_user_id
        db.commit()
    else:
        new_sub = PushSubscription(
            system_user_id=system_user_id,
            facebook_user_id=payload.facebook_user_id,
            endpoint=payload.endpoint,
            p256dh=payload.p256dh or "",
            auth=payload.auth or ""
        )
        db.add(new_sub)
        db.commit()
    return {"success": True, "message": "Subscription stored"}
