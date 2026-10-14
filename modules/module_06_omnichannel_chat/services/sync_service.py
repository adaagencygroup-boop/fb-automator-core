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
                                                is_replied=True
                                            )
                                            db.add(new_msg)
                                            db.commit()

                                        # Cập nhật bảng v_conversations và v_customers
                                        customer_repo.upsert_customer(psid=sender_id, name=customer_name)
                                        conv_repo.upsert_conversation(
                                            page_id=page_id,
                                            customer_psid=sender_id,
                                            customer_name=customer_name,
                                            last_message=text,
                                            last_message_at=dt,
                                            is_read=True,
                                            is_replied=(direction == "outbound")
                                        )
                                    except Exception as msg_err:
                                        db.rollback()
                                        print(f"[Historical Message Save Warning] {fb_message_id}: {msg_err}")

                                msg_paging = msg_json.get("paging", {})
                                msg_next_url = msg_paging.get("next")
                            except Exception as e:
                                db.rollback()
                                print(f"[Historical Messages Sync Error] {e}")
                                break

                    conv_paging = conv_json.get("paging", {})
                    conv_next_url = conv_paging.get("next")
                except Exception as e:
                    db.rollback()
                    print(f"[Historical Conv Sync Error] {e}")
                    break

            # 2. Fetch Feed Comments
            feed_url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{page_id}/feed"
            feed_params = {
                "fields": "comments{id,message,created_time,from}",
                "access_token": token,
                "limit": "25"
            }
            try:
                resp = requests.get(feed_url, params=feed_params, timeout=20)
                if resp.status_code == 200:
                    feed_data = resp.json().get("data", [])
                    for post in feed_data:
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

                            two_weeks_ago = datetime.utcnow() - timedelta(days=14)
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
                                        is_replied=False
                                    )
                                    db.add(notif)
                                    db.commit()
                            except Exception as notif_err:
                                db.rollback()
                                print(f"[Historical Notif Save Warning] {c_id}: {notif_err}")
            except Exception as e:
                db.rollback()
                print(f"[Historical Feed Sync Warning] Page {page_id}: {e}")
        finally:
            db.close()

    def sync_by_token(self, access_token: str, system_user_id: Optional[int] = 1) -> Tuple[str, int, List[Any]]:
        long_lived_token = self.exchange_token(access_token)
        user_id, pages = self.auth_service.fetch_user_pages(long_lived_token, system_user_id=system_user_id)
        for p in pages:
            sync_executor.submit(self.sync_historical_data, p.page_id, user_id)
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

    async def react_to_comment(self, comment_id: str, page_id: str, reaction: str):
        return await self.comment_service.react_to_comment(comment_id, page_id, reaction)

    async def get_customer_profile(self, psid: str, page_id: str):
        return await self.chat_service.get_customer_profile(psid, page_id)

    @staticmethod
    async def trigger_web_push(db: Session, facebook_user_id: str, title: str, body: str, target_url: str = "/"):
        return await WebPushService.trigger_web_push(db, facebook_user_id, title, body, target_url=target_url)

