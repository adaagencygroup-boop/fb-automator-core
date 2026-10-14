import os
import requests
import asyncio
from typing import Dict, Any
from datetime import datetime
from sqlalchemy.orm import Session
from modules.module_06_omnichannel_chat.repositories import PageRepository, MessageRepository
from modules.module_06_omnichannel_chat.models import Notification
from modules.module_06_omnichannel_chat.websocket import manager
from modules.module_06_omnichannel_chat.services.facebook_auth import FacebookAPIError, FacebookAuthService

FACEBOOK_API_VERSION = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v19.0")

class FacebookCommentService:
    def __init__(self, db: Session):
        self.db = db
        self.page_repo = PageRepository(db)
        self.message_repo = MessageRepository(db)
        self.auth_service = FacebookAuthService(db)

    async def reply_to_comment(self, comment_id: str, page_id: str, text: str, attachment_url: str = None) -> Dict[str, Any]:
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{comment_id}/comments"
        payload = {}
        if text:
            payload["message"] = text
        if attachment_url:
            payload["attachment_url"] = attachment_url
            
        params = {"access_token": page.page_access_token}

        try:
            response = await asyncio.to_thread(
                requests.post, url, params=params, json=payload, timeout=15
            )
            response_json = response.json()
            print(f"[Reply Comment] API Response: {response_json}", flush=True)
        except Exception as e:
            raise FacebookAPIError(f"Network error replying to comment via Facebook: {str(e)}")

        self.auth_service.handle_api_errors(response_json)

        try:
            notif = self.db.query(Notification).filter(Notification.facebook_notification_id == comment_id).first()
            if notif:
                notif.is_replied = True
                notif.reply_text = text
                self.db.commit()

                asyncio.create_task(manager.broadcast_to_user(
                    page.facebook_user_id,
                    {
                        "type": "notification",
                        "data": {
                            "id": notif.id,
                            "facebook_notification_id": notif.facebook_notification_id,
                            "page_id": notif.page_id,
                            "page_name": notif.page_name,
                            "title": notif.title,
                            "link": notif.link,
                            "created_time": notif.created_time.isoformat() if notif.created_time else None,
                            "unread": notif.unread,
                            "is_replied": True,
                            "reply_text": text,
                            "my_reaction": notif.my_reaction,
                            "from_user_id": notif.from_user_id,
                            "from_user_name": notif.from_user_name,
                            "from_user_avatar": notif.from_user_avatar,
                            "notification_type": notif.notification_type
                        }
                    }
                ))
        except Exception as err:
            print(f"[Reply Comment DB Update Error] {err}", flush=True)

        return response_json

    async def private_reply_to_comment(self, comment_id: str, page_id: str, text: str, attachment_url: str = None) -> Dict[str, Any]:
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{page_id}/messages"
        msg_payload: Dict[str, Any] = {}
        if text:
            msg_payload["text"] = text
        if attachment_url:
            msg_payload["attachment"] = {
                "type": "image",
                "payload": {
                    "url": attachment_url,
                    "is_reusable": True
                }
            }
        if not msg_payload:
            msg_payload["text"] = " "

        payload = {
            "recipient": {"comment_id": comment_id},
            "message": msg_payload
        }
        params = {"access_token": page.page_access_token}

        try:
            response = await asyncio.to_thread(
                requests.post, url, params=params, json=payload, timeout=15
            )
            response_json = response.json()
            print(f"[Private Reply Comment] API Response: {response_json}", flush=True)
        except Exception as e:
            raise FacebookAPIError(f"Network error sending private reply via Facebook: {str(e)}")

        self.auth_service.handle_api_errors(response_json)

        message_id = response_json.get("message_id")
        recipient_id = response_json.get("recipient_id")
        
        if message_id and recipient_id:
            try:
                saved_msg = self.message_repo.save_message(
                    facebook_message_id=message_id,
                    page_id=page_id,
                    sender_id=recipient_id,
                    text=text,
                    timestamp=int(datetime.utcnow().timestamp() * 1000),
                    direction="outbound",
                    is_read=True
                )
                
                asyncio.create_task(manager.broadcast_to_user(
                    page.facebook_user_id,
                    {
                        "type": "message",
                        "data": {
                            "id": saved_msg.id,
                            "facebook_message_id": saved_msg.facebook_message_id,
                            "page_id": saved_msg.page_id,
                            "sender_id": recipient_id,
                            "text": saved_msg.text,
                            "timestamp": int(saved_msg.created_at.timestamp() * 1000),
                            "direction": "outbound",
                            "created_at": saved_msg.created_at.isoformat()
                        }
                    }
                ))
            except Exception as err:
                print(f"[Private Reply Message Save Error] {err}", flush=True)

        try:
            notif = self.db.query(Notification).filter(Notification.facebook_notification_id == comment_id).first()
            if notif:
                notif.is_replied = True
                notif.reply_text = f"[Tin nhắn riêng] {text}"
                self.db.commit()
        except Exception as err:
            print(f"[Private Reply DB Update Error] {err}", flush=True)

        return response_json

    async def react_to_comment(self, comment_id: str, page_id: str, reaction: str) -> Dict[str, Any]:
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{comment_id}/likes"
        params = {
            "access_token": page.page_access_token
        }

        try:
            response = await asyncio.to_thread(
                requests.post, url, params=params, timeout=15
            )
            response_json = response.json()
            print(f"[React Comment] API Response: {response_json}", flush=True)
        except Exception as e:
            raise FacebookAPIError(f"Network error reacting to comment via Facebook: {str(e)}")

        self.auth_service.handle_api_errors(response_json)

        try:
            notif = self.db.query(Notification).filter(Notification.facebook_notification_id == comment_id).first()
            if notif:
                notif.my_reaction = reaction
                self.db.commit()

                asyncio.create_task(manager.broadcast_to_user(
                    page.facebook_user_id,
                    {
                        "type": "notification",
                        "data": {
                            "id": notif.id,
                            "facebook_notification_id": notif.facebook_notification_id,
                            "page_id": notif.page_id,
                            "page_name": notif.page_name,
                            "title": notif.title,
                            "link": notif.link,
                            "created_time": notif.created_time.isoformat() if notif.created_time else None,
                            "unread": notif.unread,
                            "is_replied": notif.is_replied,
                            "reply_text": notif.reply_text,
                            "my_reaction": reaction,
                            "from_user_id": notif.from_user_id,
                            "from_user_name": notif.from_user_name,
                            "from_user_avatar": notif.from_user_avatar,
                            "notification_type": notif.notification_type
                        }
                    }
                ))
        except Exception as err:
            print(f"[React Comment DB Update Error] {err}", flush=True)

        return response_json
