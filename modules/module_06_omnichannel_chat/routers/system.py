import time
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import Optional, List
from modules.module_06_omnichannel_chat.database import get_db, SessionLocal
from modules.module_06_omnichannel_chat.models import Account, Page, Message, Notification, PushSubscription, SystemUser, Conversation, Customer
from modules.module_06_omnichannel_chat.auth import get_current_user_optional
from modules.module_06_omnichannel_chat.routers.pages import resolve_current_user_id
from modules.module_06_omnichannel_chat.services import FacebookSyncService
from modules.module_06_omnichannel_chat.services.sync_service import sync_executor

router = APIRouter(prefix="/api/facebook", tags=["System"])

@router.get("/sync-status")
def get_sync_status():
    """Kiem tra tien trinh dong bo chay ngam co dang hoat dong hay khong"""
    try:
        from modules.module_06_omnichannel_chat.services.sync_service import _active_sync_tasks
        tasks = _active_sync_tasks
    except Exception:
        tasks = 0
    qsize = sync_executor._work_queue.qsize()
    is_syncing = tasks > 0 or qsize > 0
    return {"syncing": is_syncing, "queue_size": qsize, "active_tasks": tasks}

@router.post("/reset")
def reset_database(
    request: Request,
    facebook_user_id: Optional[str] = None,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[SystemUser] = Depends(get_current_user_optional)
):
    """
    Xoa toan bo Page, hoi thoai, tin nhan, thong bao cua user hien tai,
    sau do tu dong kich hoat dong bo lai du lieu moi nhat tu Graph API Facebook.
    """
    try:
        logged_in_uid = (user_id or "").strip() or resolve_current_user_id(request, current_user)
        fb_user_ids = []
        page_ids = []

        if logged_in_uid:
            # 1. Tim cac Page va Facebook UID thuoc quyen quan ly cua user_id
            page_query = text("""
                SELECT DISTINCT p.page_id, p.facebook_user_id
                FROM v_pages p
                LEFT JOIN v_accounts va ON p.facebook_user_id = va.facebook_user_id
                LEFT JOIN accounts a ON (
                    p.facebook_user_id = a.uid 
                    OR va.user_access_token = a.token
                    OR va.facebook_user_id = a.uid
                    OR (va.name IS NOT NULL AND va.name != '' AND va.name = a.profile_name)
                )
                WHERE (CAST(a.user_id AS VARCHAR) = :uid OR CAST(va.system_user_id AS VARCHAR) = :uid)
            """)
            rows = db.execute(page_query, {"uid": str(logged_in_uid)}).fetchall()
            for r in rows:
                if r[0] and r[0] not in page_ids:
                    page_ids.append(r[0])
                if r[1] and r[1] not in fb_user_ids:
                    fb_user_ids.append(r[1])

            acc_uids = [row[0] for row in db.execute(
                text("SELECT uid FROM accounts WHERE CAST(user_id AS VARCHAR) = :uid AND uid IS NOT NULL"),
                {"uid": str(logged_in_uid)}
            ).fetchall()]
            for u in acc_uids:
                if u and u not in fb_user_ids:
                    fb_user_ids.append(u)

            va_uids = [row[0] for row in db.execute(
                text("SELECT facebook_user_id FROM v_accounts WHERE CAST(system_user_id AS VARCHAR) = :uid AND facebook_user_id IS NOT NULL"),
                {"uid": str(logged_in_uid)}
            ).fetchall()]
            for u in va_uids:
                if u and u not in fb_user_ids:
                    fb_user_ids.append(u)

        elif current_user:
            user_accounts = db.query(Account).filter(Account.system_user_id == current_user.id).all()
            fb_user_ids = [acc.facebook_user_id for acc in user_accounts if acc.facebook_user_id]
            if fb_user_ids:
                user_pages = db.query(Page).filter(Page.facebook_user_id.in_(fb_user_ids)).all()
                page_ids = [p.page_id for p in user_pages if p.page_id]

        if facebook_user_id:
            if facebook_user_id not in fb_user_ids:
                fb_user_ids.append(facebook_user_id)
            extra_pages = db.query(Page).filter(Page.facebook_user_id == facebook_user_id).all()
            for ep in extra_pages:
                if ep.page_id and ep.page_id not in page_ids:
                    page_ids.append(ep.page_id)

        if not logged_in_uid and not current_user and not facebook_user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Phi\u00ean \u0111\u0103ng nh\u1eadp \u0111\u00e3 h\u1ebft h\u1ea1n. Vui l\u00f2ng \u0111\u0103ng nh\u1eadp l\u1ea1i \u0111\u1ec3 th\u1ef1c hi\u1ec7n x\u00f3a d\u1eef li\u1ec7u."
            )

        # 2. Xoa tin nhan, thong bao, hoi thoai theo page_ids
        if page_ids:
            db.query(Message).filter(Message.page_id.in_(page_ids)).delete(synchronize_session=False)
            db.query(Notification).filter(Notification.page_id.in_(page_ids)).delete(synchronize_session=False)
            db.query(Conversation).filter(Conversation.page_id.in_(page_ids)).delete(synchronize_session=False)
            db.query(Page).filter(Page.page_id.in_(page_ids)).delete(synchronize_session=False)

        # 3. Xoa theo fb_user_ids
        if fb_user_ids:
            db.query(Page).filter(Page.facebook_user_id.in_(fb_user_ids)).delete(synchronize_session=False)
            db.query(Account).filter(Account.facebook_user_id.in_(fb_user_ids)).delete(synchronize_session=False)

        if logged_in_uid:
            try:
                suid_int = int(logged_in_uid) if str(logged_in_uid).isdigit() else 1
                db.query(Account).filter(Account.system_user_id == suid_int).delete(synchronize_session=False)
                db.query(PushSubscription).filter(PushSubscription.system_user_id == suid_int).delete(synchronize_session=False)
            except Exception:
                pass

        db.commit()

        # 4. Tu dong dong bo lai toan bo Page & Du lieu tu Facebook Token cua user (Module 2 accounts)
        if logged_in_uid:
            try:
                user_accs = db.execute(
                    text("SELECT uid, token FROM accounts WHERE CAST(user_id AS VARCHAR) = :uid AND token IS NOT NULL AND token != ''"),
                    {"uid": str(logged_in_uid)}
                ).mappings().all()

                sys_uid = int(logged_in_uid) if (logged_in_uid and str(logged_in_uid).isdigit()) else 1
                for acc in user_accs:
                    acc_uid = str(acc["uid"])
                    acc_token = str(acc["token"]).strip()
                    if acc_token:
                        def _bg_re_sync(tok, suid, auid):
                            try:
                                with SessionLocal() as bg_db:
                                    FacebookSyncService(bg_db).sync_by_token(tok, system_user_id=suid)
                            except Exception as tok_err:
                                print(f"[Reset Auto-Sync Error] Account {auid}: {tok_err}")
                        sync_executor.submit(_bg_re_sync, acc_token, sys_uid, acc_uid)
            except Exception as resync_err:
                print(f"[Reset Auto-Sync Warning] Error triggering sync: {resync_err}")

        return {"success": True, "message": "\u0110\u00e3 reset v\u00e0 b\u1eaft \u0111\u1ea7u \u0111\u1ed3ng b\u1ed9 l\u1ea1i d\u1eef li\u1ec7u th\u00e0nh c\u00f4ng."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
