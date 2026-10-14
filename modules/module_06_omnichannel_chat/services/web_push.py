import os
import json
import asyncio
from sqlalchemy.orm import Session
from sqlalchemy import or_

try:
    from pywebpush import webpush, WebPushException
except ImportError:
    webpush = None

class WebPushService:
    @staticmethod
    async def trigger_web_push(db: Session, facebook_user_id: str, title: str, body: str, target_url: str = "/"):
        if not webpush:
            print("[WebPush Warning] pywebpush library is not installed on server!", flush=True)
            return

        from modules.module_06_omnichannel_chat.models import PushSubscription, Account
        try:
            acc = db.query(Account).filter(Account.facebook_user_id == facebook_user_id).first()
            system_user_id = acc.system_user_id if acc else None

            subs = db.query(PushSubscription).filter(
                or_(
                    PushSubscription.facebook_user_id == facebook_user_id,
                    PushSubscription.system_user_id == system_user_id
                )
            ).all()

            if not subs:
                print(f"[WebPush Warning] No subscriptions in DB for FB user {facebook_user_id}", flush=True)
                return

            print(f"[WebPush Info] Triggering push to {len(subs)} subscription(s) for FB user {facebook_user_id}", flush=True)

            unread_count = 1
            try:
                from modules.module_06_omnichannel_chat.models import Notification, Message, Page
                unread_notifs = db.query(Notification).join(Page, Page.page_id == Notification.page_id).filter(
                    Page.facebook_user_id == facebook_user_id,
                    Notification.unread == True
                ).count()

                unread_msgs = db.query(Message).join(Page, Page.page_id == Message.page_id).filter(
                    Page.facebook_user_id == facebook_user_id,
                    Message.is_read == False,
                    Message.direction == "inbound"
                ).count()
                unread_count = max(1, unread_notifs + unread_msgs)
            except Exception:
                pass

            payload = json.dumps({
                "title": title,
                "body": body,
                "unread_count": unread_count,
                "target_url": target_url,
                "icon": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/2021_Facebook_icon.svg/512px-2021_Facebook_icon.svg.png"
            })
            vapid_private_key = os.environ.get("VAPID_PRIVATE_KEY", "08oBgpgpRhnEqADg_lei0Qn4wocB0KvqfwXt9wJjHkY")
            if not vapid_private_key:
                return

            if vapid_private_key and len(vapid_private_key) % 4 != 0:
                vapid_private_key += "=" * (4 - (len(vapid_private_key) % 4))

            for sub in subs:
                sub_info = {
                    "endpoint": sub.endpoint,
                    "keys": {
                        "p256dh": sub.p256dh,
                        "auth": sub.auth
                    }
                }
                try:
                    await asyncio.to_thread(
                        webpush,
                        subscription_info=sub_info,
                        data=payload,
                        vapid_private_key=vapid_private_key,
                        vapid_claims={"sub": "mailto:admin@phanmemchat.online"}
                    )
                except Exception as e:
                    err_msg = str(e)
                    if "410" in err_msg or "404" in err_msg or "unsubscribed or expired" in err_msg.lower():
                        try:
                            db.delete(sub)
                            db.commit()
                            print(f"[WebPush Cleanup] Removed expired subscription {sub.id}", flush=True)
                        except Exception:
                            pass
                    else:
                        print(f"[WebPush Error] {e}", flush=True)
        except Exception as outer_e:
            print(f"[WebPush Outer Error] {outer_e}", flush=True)
