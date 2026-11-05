import time
import os
import requests
import asyncio
from typing import Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session

FACEBOOK_BASE_URL = f"https://graph.facebook.com/{os.getenv('FACEBOOK_GRAPH_API_VERSION', 'v19.0')}"

from modules.module_06_omnichannel_chat.repositories import PageRepository, MessageRepository, ConversationRepository
from modules.module_06_omnichannel_chat.models import Message
from modules.module_06_omnichannel_chat.websocket import manager
from modules.module_06_omnichannel_chat.services.facebook_auth import FacebookAPIError, FacebookAuthService

class FacebookChatService:
    def __init__(self, db: Session):
        self.db = db
        self.page_repo = PageRepository(db)
        self.message_repo = MessageRepository(db)
        self.conv_repo = ConversationRepository(db)
        self.auth_service = FacebookAuthService(db)

    async def send_message_reply(
        self,
        page_id: str,
        recipient_id: str,
        text: str,
        reply_to_message_id: Optional[str] = None
    ) -> Dict[str, Any]:
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        url = f"{FACEBOOK_BASE_URL}/me/messages"
        payload: Dict[str, Any] = {
            "recipient": {"id": recipient_id},
            "message": {"text": text},
            "messaging_type": "RESPONSE"
        }

        resolved_mid = reply_to_message_id
        if reply_to_message_id:
            ref_msg = self.message_repo.get_by_id_or_fb_id(str(reply_to_message_id))
            if ref_msg and ref_msg.facebook_message_id:
                resolved_mid = ref_msg.facebook_message_id
            payload["reply_to"] = {"mid": resolved_mid}

        params = {"access_token": page.page_access_token}

        try:
            response = await asyncio.to_thread(
                requests.post, url, params=params, json=payload, timeout=15
            )
            response_json = response.json()

            if "error" in response_json:
                if "reply_to" in payload:
                    del payload["reply_to"]
                    payload["message"]["reply_to"] = {"mid": resolved_mid}
                    response = await asyncio.to_thread(
                        requests.post, url, params=params, json=payload, timeout=15
                    )
                    response_json = response.json()

                if "error" in response_json and "reply_to" in payload["message"]:
                    del payload["message"]["reply_to"]
                    response = await asyncio.to_thread(
                        requests.post, url, params=params, json=payload, timeout=15
                    )
                    response_json = response.json()
        except Exception as e:
            raise FacebookAPIError(f"Network error sending message via Facebook: {str(e)}")

        self.auth_service.handle_api_errors(response_json)
        message_id = response_json.get("message_id")

        if message_id:
            saved_msg = self.message_repo.save_message(
                facebook_message_id=message_id,
                page_id=page_id,
                sender_id=recipient_id,
                text=text,
                timestamp=int(time.time() * 1000),
                direction="outbound",
                is_read=False,
                reply_to_message_id=reply_to_message_id
            )

            try:
                self.conv_repo.upsert_conversation(
                    page_id=page_id,
                    customer_psid=recipient_id,
                    last_message=text,
                    last_message_at=saved_msg.created_at,
                    is_read=True,
                    is_replied=True
                )
            except Exception as conv_err:
                print(f"[Warning] Update conversation on reply error: {conv_err}")

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
                        "reply_to_message_id": saved_msg.reply_to_message_id,
                        "created_at": saved_msg.created_at.isoformat()
                    }
                }
            ))

        return response_json

    async def send_attachment_by_url(
        self,
        page_id: str,
        recipient_id: str,
        attachment_type: str,
        url_link: str,
        reply_to_message_id: Optional[str] = None
    ) -> Dict[str, Any]:
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        url = f"{FACEBOOK_BASE_URL}/me/messages"
        payload: Dict[str, Any] = {
            "recipient": {"id": recipient_id},
            "message": {
                "attachment": {
                    "type": attachment_type,
                    "payload": {
                        "url": url_link,
                        "is_reusable": True
                    }
                }
            },
            "messaging_type": "RESPONSE"
        }

        resolved_mid = reply_to_message_id
        if reply_to_message_id:
            ref_msg = self.message_repo.get_by_id_or_fb_id(str(reply_to_message_id))
            if ref_msg and ref_msg.facebook_message_id:
                resolved_mid = ref_msg.facebook_message_id
            payload["reply_to"] = {"mid": resolved_mid}

        params = {"access_token": page.page_access_token}

        try:
            response = await asyncio.to_thread(
                requests.post, url, params=params, json=payload, timeout=20
            )
            response_json = response.json()

            if "error" in response_json:
                if "reply_to" in payload:
                    del payload["reply_to"]
                    response = await asyncio.to_thread(
                        requests.post, url, params=params, json=payload, timeout=20
                    )
                    response_json = response.json()
        except Exception as e:
            raise FacebookAPIError(f"Network error sending attachment: {str(e)}")

        self.auth_service.handle_api_errors(response_json)
        message_id = response_json.get("message_id")

        if message_id:
            media_text = f"[{attachment_type}] {url_link}"
            saved_msg = self.message_repo.save_message(
                facebook_message_id=message_id,
                page_id=page_id,
                sender_id=recipient_id,
                text=media_text,
                timestamp=int(time.time() * 1000),
                direction="outbound",
                is_read=False,
                reply_to_message_id=reply_to_message_id
            )

            try:
                self.conv_repo.upsert_conversation(
                    page_id=page_id,
                    customer_psid=recipient_id,
                    last_message=media_text,
                    last_message_at=saved_msg.created_at,
                    is_read=True,
                    is_replied=True
                )
            except Exception as conv_err:
                print(f"[Warning] Update conversation on attachment send error: {conv_err}")

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
                        "reply_to_message_id": saved_msg.reply_to_message_id,
                        "created_at": saved_msg.created_at.isoformat()
                    }
                }
            ))

        return response_json

    async def react_to_message(
        self,
        page_id: str,
        recipient_id: str,
        message_id: str,
        reaction: str
    ) -> Dict[str, Any]:
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        url = f"{FACEBOOK_BASE_URL}/me/messages"
        payload = {
            "recipient": {"id": recipient_id},
            "sender_action": "react",
            "payload": {
                "message_id": message_id,
                "reaction": reaction
            }
        }
        params = {"access_token": page.page_access_token}

        try:
            response = await asyncio.to_thread(
                requests.post, url, params=params, json=payload, timeout=10
            )
            response_json = response.json()
        except Exception as e:
            raise FacebookAPIError(f"Network error reacting to message: {str(e)}")

        self.auth_service.handle_api_errors(response_json)

        emoji_map = {
            "love": "❤️",
            "like": "👍",
            "haha": "😂",
            "wow": "😮",
            "sad": "😢",
            "angry": "😡",
            "other": "👍"
        }
        saved_emoji = emoji_map.get(reaction.lower(), reaction)
        self.message_repo.save_reaction(message_id, saved_emoji)

        return response_json

    async def delete_message(self, page_id: str, message_id: str) -> bool:
        return self.message_repo.delete_message(message_id)

    async def get_customer_profile(self, psid: str, page_id: str) -> Dict[str, Any]:
        from modules.module_06_omnichannel_chat.repositories import CustomerRepository
        customer_repo = CustomerRepository(self.db)
        cached_customer = customer_repo.get_by_psid(psid)
        if cached_customer and cached_customer.name:
            return {
                "name": cached_customer.name,
                "avatar_url": cached_customer.avatar_url or ""
            }

        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            return {"name": "", "avatar_url": ""}

        url = f"{FACEBOOK_BASE_URL}/{psid}"
        params = {
            "fields": "name,profile_pic",
            "access_token": page.page_access_token
        }

        try:
            response = await asyncio.to_thread(requests.get, url, params=params, timeout=5)
            data = response.json()
            if "error" not in data:
                c_name = data.get("name", "")
                c_avatar = data.get("profile_pic", "")
                customer_repo.upsert_customer(psid, name=c_name, avatar_url=c_avatar)
                return {
                    "name": c_name,
                    "avatar_url": c_avatar
                }
        except Exception as e:
            print(f"[Customer Profile Fetch Error] {e}")

    async def mark_seen(self, page_id: str, recipient_id: str) -> Dict[str, Any]:
        """Gửi hành động mark_seen lên Facebook Send API để hiện avatar Page đã xem tin nhắn ở máy khách."""
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            return {"success": False, "error": f"Page or page access token not found for Page ID {page_id}"}

        url = f"{FACEBOOK_BASE_URL}/me/messages"
        payload = {
            "recipient": {"id": recipient_id},
            "sender_action": "mark_seen"
        }
        params = {"access_token": page.page_access_token}

        try:
            response = await asyncio.to_thread(
                requests.post, url, params=params, json=payload, timeout=10
            )
            return response.json()
        except Exception as e:
            print(f"[Mark Seen Error] Page {page_id}, Recipient {recipient_id}: {e}")
            return {"success": False, "error": str(e)}

