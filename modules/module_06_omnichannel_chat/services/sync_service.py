import threading
import os
import requests
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy.orm import Session

FACEBOOK_API_VERSION = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v19.0")

from modules.module_06_omnichannel_chat.services.facebook_auth import (
    FacebookAuthService,
    AccountNotFoundError,
    FacebookAuthError,
    FacebookAPIError
)
from modules.module_06_omnichannel_chat.services.facebook_chat import FacebookChatService
from modules.module_06_omnichannel_chat.services.facebook_comments import FacebookCommentService
from modules.module_06_omnichannel_chat.services.web_push import WebPushService

sync_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="sync_historical")
_active_sync_tasks = 0
_sync_lock = threading.Lock()

class FacebookSyncService:
    def __init__(self, db: Session):
        self.db = db
        self.auth_service = FacebookAuthService(db)
        self.chat_service = FacebookChatService(db)
        self.comment_service = FacebookCommentService(db)

    def exchange_token(self, short_lived_token: str) -> str:
        return self.auth_service.exchange_token(short_lived_token)

    def sync_historical_data(self, page_id: str, facebook_user_id: str):
        from modules.module_06_omnichannel_chat.database import SessionLocal
        from modules.module_06_omnichannel_chat.repositories import PageRepository, MessageRepository, NotificationRepository, ConversationRepository, CustomerRepository
        from modules.module_06_omnichannel_chat.models import Message, Notification

        db = SessionLocal()
        try:
            page_repo = PageRepository(db)
            message_repo = MessageRepository(db)
            notif_repo = NotificationRepository(db)
            conv_repo = ConversationRepository(db)
            customer_repo = CustomerRepository(db)

            page = page_repo.get_by_page_id(page_id)
            if not page or not page.page_access_token:
                return

            token = page.page_access_token

            # 0. Tự động liên kết Webhook (subscribed_apps) cho Fanpage này với Facebook App
            try:
                sub_url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{page_id}/subscribed_apps"
                requests.post(sub_url, params={
                    "subscribed_fields": "messages,messaging_postbacks,feed,message_reads,message_reactions",
                    "access_token": token
                }, timeout=10)
            except Exception as sub_err:
                print(f"[Subscribed Apps Warning] Page {page_id}: {sub_err}")

            # 1. Fetch Conversations & Messages
            conv_next_url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{page_id}/conversations"
            conv_params = {
                "fields": "id,senders,updated_time",
                "access_token": token,
                "limit": "50"
            }

            while conv_next_url:
                try:
                    if conv_params:
                        resp = requests.get(conv_next_url, params=conv_params, timeout=20)
                        conv_params = None
                    else:
                        resp = requests.get(conv_next_url, timeout=20)

                    if resp.status_code != 200:
                        break

                    conv_json = resp.json()
                    conv_list = conv_json.get("data", [])

                    for conv in conv_list:
                        conv_id = conv.get("id")
                        if not conv_id:
                            continue

                        msg_next_url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{conv_id}/messages"
                        msg_params = {
                            "fields": "id,message,created_time,from,to,sticker,attachments{id,mime_type,file_url,image_data,video_data,type}",
                            "access_token": token,
                            "limit": "100"
                        }

                        while msg_next_url:
                            try:
                                if msg_params:
                                    msg_resp = requests.get(msg_next_url, params=msg_params, timeout=20)
                                    msg_params = None
                                else:
                                    msg_resp = requests.get(msg_next_url, timeout=20)

                                if msg_resp.status_code != 200:
                                    break

                                msg_json = msg_resp.json()
                                messages_data = msg_json.get("data", [])

                                for msg in messages_data:
                                    fb_message_id = msg.get("id")
                                    text = msg.get("message", "")
                                    created_time_str = msg.get("created_time")
                                    from_obj = msg.get("from", {})
                                    to_data = msg.get("to", {}).get("data", [])

                                    if not fb_message_id or not created_time_str:
                                        continue

                                    sticker = msg.get("sticker")
                                    attachments = msg.get("attachments", {}).get("data", [])

                                    att_text = ""
                                    if sticker:
                                        s_url = sticker.get("url") if isinstance(sticker, dict) else str(sticker)
                                        att_text = f"[image] {s_url}"
                                    elif attachments:
                                        for att in attachments:
                                            img_data = att.get("image_data") if isinstance(att.get("image_data"), dict) else {}
                                            video_data = att.get("video_data") if isinstance(att.get("video_data"), dict) else {}
                                            audio_data = att.get("audio_data") if isinstance(att.get("audio_data"), dict) else {}
                                            payload_data = att.get("payload") if isinstance(att.get("payload"), dict) else {}

                                            att_url = (
                                                att.get("file_url")
                                                or img_data.get("url")
                                                or img_data.get("preview_url")
                                                or video_data.get("url")
                                                or audio_data.get("url")
                                                or payload_data.get("url")
                                                or att.get("url")
                                            )
                                            mime = (att.get("mime_type") or att.get("type") or "").lower()
                                            att_name = (att.get("name") or "").lower()
                                            att_url_lower = (att_url or "").lower()

                                            if att_url:
                                                if "image" in mime or "image" in att.get("type", "").lower() or img_data:
                                                    att_text = f"[image] {att_url}"
                                                elif (
                                                    "audio" in mime
                                                    or "audio" in att.get("type", "").lower()
                                                    or "audioclip" in att_name
                                                    or "audioclip" in att_url_lower
                                                    or audio_data
                                                    or any(att_url_lower.split("?")[0].endswith(ext) for ext in [".m4a", ".aac", ".mp3", ".wav", ".ogg"])
                                                ):
                                                    att_text = f"[audio] {att_url}"
                                                else:
                                                    att_text = f"[file] {att_url}"
                                                break

                                    if not text:
                                        text = att_text or "📎 [Tin nhắn đính kèm]"
                                    elif att_text and att_text not in text:
                                        text = f"{text}\n{att_text}"

                                    try:
                                        dt = datetime.fromisoformat(created_time_str.replace("Z", "+00:00"))
                                        timestamp = int(dt.timestamp() * 1000)
                                    except Exception:
                                        dt = datetime.utcnow()
                                        timestamp = int(dt.timestamp() * 1000)

                                    direction = "inbound"
                                    customer_name = from_obj.get("name", "Khách hàng")
                                    if from_obj.get("id") == page_id:
                                        direction = "outbound"
                                        sender_id = to_data[0].get("id") if to_data else ""
                                        if to_data and to_data[0].get("name"):
                                            customer_name = to_data[0].get("name")
                                    else:
                                        sender_id = from_obj.get("id", "")

                                    if not sender_id:
                                        continue

                                    try:
                                        existing_msg = message_repo.get_by_fb_message_id(fb_message_id)
                                        if existing_msg:
                                            if not existing_msg.text or "Tin nhắn đính kèm" in existing_msg.text or existing_msg.text == "[image]":
                                                if text and "Tin nhắn đính kèm" not in text:
                                                    existing_msg.text = text
                                                    db.commit()
                                        else:
                                            new_msg = Message(
                                                facebook_message_id=fb_message_id,
                                                page_id=page_id,
                                                sender_id=sender_id,
                                                text=text,
                                                timestamp=timestamp,
                                                direction=direction,
                                                is_read=True,
                                                is_replied=True,
                                                created_at=dt
                                            )
                                            db.add(new_msg)
                                            db.commit()

                                        # Cập nhật bảng v_customers
                                        customer_repo.upsert_customer(psid=sender_id, name=customer_name)
                                    except Exception as msg_err:
                                        db.rollback()
                                        print(f"[Historical Message Save Warning] {fb_message_id}: {msg_err}")

                                msg_paging = msg_json.get("paging", {})
                                msg_next_url = msg_paging.get("next")
                            except Exception as e:
                                db.rollback()
                                print(f"[Historical Messages Sync Error] {e}")
                                break

                        # Cập nhật v_conversations theo đúng tin nhắn mới nhất thực tế trong database
                        try:
                            latest_msg_record = message_repo.get_latest_message(page_id, sender_id)
                            if latest_msg_record:
                                conv_repo.upsert_conversation(
                                    page_id=page_id,
                                    customer_psid=sender_id,
                                    customer_name=customer_name,
                                    last_message=latest_msg_record.text,
                                    last_message_at=latest_msg_record.created_at,
                                    is_read=True,
                                    is_replied=(latest_msg_record.direction == "outbound")
                                )
                        except Exception as conv_sync_err:
                            print(f"[Warning] Sync conversation preview error: {conv_sync_err}")

                    conv_paging = conv_json.get("paging", {})
                    conv_next_url = conv_paging.get("next")
                except Exception as e:
                    db.rollback()
                    print(f"[Historical Conv Sync Error] {e}")
                    break

            # 2. Fetch Feed Posts, Comments, and Interactions
            REACT_MAP = {
                "like": "thích",
                "love": "yêu thích",
                "haha": "haha",
                "wow": "wow",
                "sad": "buồn",
                "angry": "phẫn nộ",
                "care": "thương thương",
            }
            feed_url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{page_id}/feed"
            feed_params = {
                "fields": "id,message,created_time,permalink_url,shares,reactions.summary(total_count){id,name,type},comments{id,message,created_time,from}",
                "access_token": token,
                "limit": "25"
            }
            try:
                resp = requests.get(feed_url, params=feed_params, timeout=20)
                if resp.status_code == 200:
                    feed_data = resp.json().get("data", [])
                    two_weeks_ago = datetime.utcnow() - timedelta(days=14)
                    page_name = page.page_name if page and page.page_name else "Trang Facebook"

                    for post in feed_data:
                        post_id = post.get("id")
                        post_time_str = post.get("created_time")
                        try:
                            p_dt = datetime.fromisoformat(post_time_str.replace("Z", "+00:00"))
                        except Exception:
                            p_dt = datetime.utcnow()

                        p_dt_naive = p_dt.replace(tzinfo=None) if hasattr(p_dt, "tzinfo") and p_dt.tzinfo else p_dt
                        if p_dt_naive < two_weeks_ago:
                            continue

                        post_link = post.get("permalink_url") or f"https://facebook.com/{post_id}"

                        # A. Comments
                        comments_data = post.get("comments", {}).get("data", [])
                        for comment in comments_data:
                            c_id = comment.get("id")
                            c_msg = comment.get("message", "")
                            c_time = comment.get("created_time")
                            c_from = comment.get("from", {}).get("name", "Người dùng")

                            if not c_id:
                                continue

                            try:
                                dt = datetime.fromisoformat(c_time.replace("Z", "+00:00"))
                            except Exception:
                                dt = datetime.utcnow()

                            dt_naive = dt.replace(tzinfo=None) if hasattr(dt, "tzinfo") and dt.tzinfo else dt
                            if dt_naive < two_weeks_ago:
                                continue

                            title = f"{c_from} đã bình luận: {c_msg}"
                            link = f"https://facebook.com/{c_id}"

                            try:
                                if not notif_repo.get_by_fb_notification_id(c_id):
                                    notif = Notification(
                                        facebook_notification_id=c_id,
                                        page_id=page_id,
                                        title=title,
                                        link=link,
                                        created_time=dt,
                                        unread=False,
                                        is_replied=False,
                                        from_user_name=c_from,
                                        notification_type="comment"
                                    )
                                    db.add(notif)
                                    db.commit()
                            except Exception as notif_err:
                                db.rollback()
                                print(f"[Historical Notif Save Warning] {c_id}: {notif_err}")

                        # B. Post Reactions (Interactions)
                        reactions_obj = post.get("reactions", {})
                        react_data = reactions_obj.get("data", [])
                        total_reacts = reactions_obj.get("summary", {}).get("total_count", 0)

                        if react_data:
                            for r in react_data:
                                r_id = f"react_{post_id}_{r.get('id')}"
                                r_name = r.get("name", "Người dùng")
                                r_type = str(r.get("type", "LIKE")).lower()
                                react_vn = REACT_MAP.get(r_type, "thích")
                                r_title = f"đã bày tỏ cảm xúc “{react_vn}”"

                                try:
                                    if not notif_repo.get_by_fb_notification_id(r_id):
                                        notif = Notification(
                                            facebook_notification_id=r_id,
                                            page_id=page_id,
                                            title=r_title,
                                            link=post_link,
                                            created_time=datetime.utcnow(),
                                            unread=True,
                                            is_replied=False,
                                            from_user_name=r_name,
                                            notification_type="interaction"
                                        )
                                        db.add(notif)
                                        db.commit()
                                except Exception:
                                    db.rollback()
                        elif total_reacts > 0:
                            # Aggregate reaction count when FB privacy restricts individual user lists
                            r_sum_id = f"react_sum_{post_id}"
                            r_title = f"đã nhận được {total_reacts} lượt bày tỏ cảm xúc"
                            try:
                                if not notif_repo.get_by_fb_notification_id(r_sum_id):
                                    notif = Notification(
                                        facebook_notification_id=r_sum_id,
                                        page_id=page_id,
                                        title=r_title,
                                        link=post_link,
                                        created_time=datetime.utcnow(),
                                        unread=True,
                                        is_replied=False,
                                        from_user_name="Người theo dõi",
                                        notification_type="interaction"
                                    )
                                    db.add(notif)
                                    db.commit()
                            except Exception:
                                db.rollback()

                        # C. Shares
                        shares_cnt = post.get("shares", {}).get("count", 0)
                        if shares_cnt > 0:
                            s_id = f"share_{post_id}"
                            s_title = f"đã chia sẻ bài viết ({shares_cnt} lượt chia sẻ)"
                            try:
                                if not notif_repo.get_by_fb_notification_id(s_id):
                                    notif = Notification(
                                        facebook_notification_id=s_id,
                                        page_id=page_id,
                                        title=s_title,
                                        link=post_link,
                                        created_time=p_dt,
                                        unread=True,
                                        is_replied=False,
                                        from_user_name="Người dùng",
                                        notification_type="interaction"
                                    )
                                    db.add(notif)
                                    db.commit()
                            except Exception:
                                db.rollback()

                        # D. Post creation interaction
                        post_notif_id = f"post_created_{post_id}"
                        p_msg = (post.get("message") or "").strip()
                        snippet = f": “{p_msg[:45]}...”" if p_msg else ""
                        p_title = f"đã đăng một bài viết mới{snippet}"
                        try:
                            if not notif_repo.get_by_fb_notification_id(post_notif_id):
                                notif = Notification(
                                    facebook_notification_id=post_notif_id,
                                    page_id=page_id,
                                    title=p_title,
                                    link=post_link,
                                    created_time=p_dt,
                                    unread=False,
                                    is_replied=True,
                                    from_user_name=page_name,
                                    notification_type="interaction"
                                )
                                db.add(notif)
                                db.commit()
                        except Exception:
                            db.rollback()
            except Exception as e:
                db.rollback()
                print(f"[Historical Feed Sync Warning] Page {page_id}: {e}")
        finally:
            db.close()

    def sync_by_token(self, access_token: str, system_user_id: Optional[int] = 1) -> Tuple[str, int, List[Any]]:
        long_lived_token = self.exchange_token(access_token)
        user_id, pages = self.auth_service.fetch_user_pages(long_lived_token, system_user_id=system_user_id)
        global _active_sync_tasks
        def _tracked_sync(pid, uid):
            global _active_sync_tasks
            try:
                self.sync_historical_data(pid, uid)
            finally:
                with _sync_lock:
                    _active_sync_tasks = max(0, _active_sync_tasks - 1)

        with _sync_lock:
            _active_sync_tasks += len(pages)

        for p in pages:
            sync_executor.submit(_tracked_sync, p.page_id, user_id)
        return user_id, len(pages), pages

    async def send_message_reply(self, page_id: str, recipient_id: str, text: str, reply_to_message_id: Optional[str] = None):
        return await self.chat_service.send_message_reply(page_id, recipient_id, text, reply_to_message_id)

    async def send_attachment_by_url(self, page_id: str, recipient_id: str, attachment_type: str, url_link: str, reply_to_message_id: Optional[str] = None):
        return await self.chat_service.send_attachment_by_url(page_id, recipient_id, attachment_type, url_link, reply_to_message_id)

    async def react_to_message(self, page_id: str, recipient_id: str, message_id: str, reaction: Optional[str]):
        return await self.chat_service.react_to_message(page_id, recipient_id, message_id, reaction)

    async def delete_message(self, page_id: str, message_id: str):
        return await self.chat_service.delete_message(page_id, message_id)

    async def reply_to_comment(self, comment_id: str, page_id: str, text: str, attachment_url: str = None):
        return await self.comment_service.reply_to_comment(comment_id, page_id, text, attachment_url)

    async def private_reply_to_comment(self, page_id: str, comment_id: str, text: str, attachment_url: str = None):
        return await self.comment_service.private_reply_to_comment(comment_id, page_id, text, attachment_url)

    async def react_to_comment(self, comment_id: str, page_id: str, reaction: str,
                               liked: bool = True):
        # liked=False -> bo thich (DELETE /{comment_id}/likes)
        return await self.comment_service.react_to_comment(comment_id, page_id, reaction, liked)

    async def hide_comment(self, comment_id: str, page_id: str, is_hidden: bool = True):
        return await self.comment_service.hide_comment(comment_id, page_id, is_hidden)

    async def delete_comment(self, comment_id: str, page_id: str):
        return await self.comment_service.delete_comment(comment_id, page_id)

    async def get_customer_profile(self, psid: str, page_id: str):
        return await self.chat_service.get_customer_profile(psid, page_id)

    async def mark_seen(self, page_id: str, recipient_id: str):
        return await self.chat_service.mark_seen(page_id, recipient_id)

    @staticmethod
    async def trigger_web_push(db: Session, facebook_user_id: str, title: str, body: str, target_url: str = "/"):
        return await WebPushService.trigger_web_push(db, facebook_user_id, title, body, target_url=target_url)


import asyncio
from pathlib import Path
from modules.module_06_omnichannel_chat.config import settings

_last_synced_url: Optional[str] = None


def _update_env_file(filepath: Path, key: str, value: str):
    if not filepath.exists():
        return
    try:
        content = filepath.read_text(encoding="utf-8")
        lines = content.splitlines()
        found = False
        new_lines = []
        for line in lines:
            if line.strip().startswith(f"{key}=") or line.strip().startswith(f"{key} ="):
                new_lines.append(f"{key}={value}")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"{key}={value}")
        filepath.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    except Exception as e:
        print(f"[Env Update Warning] Error updating {filepath.name}: {e}")


def _update_env_media_url(public_url: str):
    root_dir = Path(__file__).resolve().parent.parent.parent.parent
    root_env = root_dir / ".env"
    frontend_env = root_dir / "frontend" / ".env"

    _update_env_file(root_env, "PUBLIC_MEDIA_BASE_URL", public_url)
    _update_env_file(root_env, "FACEBOOK_OAUTH_CALLBACK_URL", f"{public_url}/oauth/meta/callback")
    _update_env_file(frontend_env, "NEXT_PUBLIC_MEDIA_BASE_URL", public_url)
    os.environ["PUBLIC_MEDIA_BASE_URL"] = public_url


def sync_app_webhook(force: bool = False) -> Dict[str, Any]:
    """Tự động phát hiện ngrok và đồng bộ Webhook URL của Facebook App lên Meta Graph API & cập nhật .env"""
    global _last_synced_url
    public_url = None
    try:
        r = requests.get("http://127.0.0.1:4040/api/tunnels", timeout=2).json()
        tunnels = r.get("tunnels", [])
        for t in tunnels:
            u = t.get("public_url")
            if u and u.startswith("https://"):
                public_url = u
                break
    except Exception:
        pass

    if not public_url:
        public_url = os.getenv("PUBLIC_MEDIA_BASE_URL") or os.getenv("NEXT_PUBLIC_MEDIA_BASE_URL")

    if not public_url:
        return {"status": "skipped", "reason": "No public URL found"}

    public_url = public_url.rstrip("/")
    target_callback = f"{public_url}/api/facebook/webhook"

    if not force and _last_synced_url == public_url:
        return {"status": "unchanged", "public_url": public_url}

    app_id = settings.FACEBOOK_APP_ID
    app_secret = settings.FACEBOOK_APP_SECRET
    if not app_id or not app_secret:
        return {"status": "skipped", "reason": "FACEBOOK_APP_ID or SECRET not set"}

    app_token = f"{app_id}|{app_secret}"
    verify_token = settings.FACEBOOK_WEBHOOK_VERIFY_TOKEN
    version = settings.FACEBOOK_API_VERSION or "v19.0"

    sub_url = f"https://graph.facebook.com/{version}/{app_id}/subscriptions"
    try:
        if not force:
            curr = requests.get(sub_url, params={"access_token": app_token}, timeout=10).json()
            current_data = curr.get("data", [])
            page_sub = next((s for s in current_data if s.get("object") == "page"), None)
            curr_callback = page_sub.get("callback_url") if page_sub else None

            if curr_callback == target_callback:
                _last_synced_url = public_url
                _update_env_media_url(public_url)
                return {"status": "already_synced", "public_url": public_url}

        print(f"[Facebook Webhook] Phat hien ngrok URL moi: {public_url}. Dang tu dong dong bo Webhook len Meta...")
        requests.post(sub_url, data={
            "object": "page",
            "callback_url": target_callback,
            "fields": "messages,messaging_postbacks,feed,message_reads,message_reactions",
            "verify_token": verify_token,
            "access_token": app_token
        }, timeout=10)

        requests.post(sub_url, data={
            "object": "user",
            "callback_url": target_callback,
            "fields": "feed",
            "verify_token": verify_token,
            "access_token": app_token
        }, timeout=10)

        _last_synced_url = public_url
        _update_env_media_url(public_url)
        print(f"[Facebook Webhook] DA DONG BO THANH CONG Webhook URL len Meta: {target_callback}")
        return {"status": "success", "public_url": public_url, "callback_url": target_callback}
    except Exception as e:
        print(f"[Facebook Webhook Sync Warning] {e}")
        return {"status": "error", "message": str(e)}


async def watch_and_sync_webhook_loop(poll_interval: int = 10):
    """Vong lap chay ngam tu dong:
    - O moi truong Local/Dev: Tham do ngrok local API (cong 4040) moi 10s.
      Bat ky luc nao chay lai 'ngrok http 28129', he thong se tu dong bat URL ngrok moi va cap nhat Meta.
    - O moi truong Deploy/Production (co ten mien rieng co dinh): Tu dong dong bo ten mien that len Meta va giu on dinh, khong can ngrok.
    """
    print("[Facebook Webhook] Da kich hoat tien trinh tu dong theo doi Webhook -> Meta.")
    while True:
        try:
            await asyncio.to_thread(sync_app_webhook)
            prod_url = os.getenv("PUBLIC_MEDIA_BASE_URL", "")
            if prod_url.startswith("https://") and "ngrok" not in prod_url and "localtunnel" not in prod_url:
                # O moi truong production co ten mien that, giu on dinh va chi kiem tra 1 tieng/lan
                await asyncio.sleep(3600)
                continue
        except Exception:
            pass
        await asyncio.sleep(poll_interval)



