import json
import time
import os
import requests
import asyncio
from typing import Dict, Any, Optional, Tuple
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

    @staticmethod
    def _extract_attachment_from_graph(att: Dict[str, Any], fallback_type: str = "file") -> Tuple[str, Optional[str]]:
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
        att_type = fallback_type
        if "image" in mime or img_data:
            att_type = "image"
        elif "video" in mime or video_data:
            att_type = "video"
        elif "audio" in mime or audio_data:
            att_type = "audio"
        elif att.get("file_url"):
            att_type = "file"
        return att_type, att_url

    async def _fetch_facebook_attachment_url(
        self,
        message_id: str,
        page_access_token: str,
        fallback_type: str = "file",
    ) -> Tuple[str, Optional[str]]:
        url = f"{FACEBOOK_BASE_URL}/{message_id}"
        params = {
            "fields": "attachments{id,mime_type,file_url,image_data,video_data,audio_data,type,name}",
            "access_token": page_access_token,
        }
        for attempt in range(2):
            try:
                resp = await asyncio.to_thread(requests.get, url, params=params, timeout=15)
                data = resp.json() if resp.content else {}
                attachments = (data.get("attachments") or {}).get("data") or []
                if attachments and isinstance(attachments, list):
                    att_type, att_url = self._extract_attachment_from_graph(attachments[0], fallback_type)
                    if att_url:
                        return att_type, att_url
            except Exception as e:
                print(f"[Attachment CDN] Fetch failed for {message_id}: {e}")
            if attempt == 0:
                await asyncio.sleep(0.35)
        return fallback_type, None

    def _save_and_broadcast_attachment(
        self,
        page: Any,
        page_id: str,
        recipient_id: str,
        message_id: str,
        attachment_type: str,
        media_url: str,
        reply_to_message_id: Optional[str] = None,
    ) -> None:
        media_text = f"[{attachment_type}] {media_url}"
        saved_msg = self.message_repo.save_message(
            facebook_message_id=message_id,
            page_id=page_id,
            sender_id=recipient_id,
            text=media_text,
            timestamp=int(time.time() * 1000),
            direction="outbound",
            is_read=False,
            reply_to_message_id=reply_to_message_id,
        )

        try:
            self.conv_repo.upsert_conversation(
                page_id=page_id,
                customer_psid=recipient_id,
                last_message=media_text,
                last_message_at=saved_msg.created_at,
                is_read=True,
                is_replied=True,
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
                    "created_at": saved_msg.created_at.isoformat(),
                },
            },
        ))

    async def send_attachment_file(
        self,
        page_id: str,
        recipient_id: str,
        attachment_type: str,
        file_bytes: bytes,
        filename: str,
        content_type: Optional[str] = None,
        reply_to_message_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Gửi trực tiếp filedata lên Facebook Graph API (không lưu file trên ổ đĩa VPS/local)."""
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        url = f"{FACEBOOK_BASE_URL}/me/messages"
        form_data: Dict[str, str] = {
            "recipient": json.dumps({"id": recipient_id}),
            "message": json.dumps({
                "attachment": {
                    "type": attachment_type,
                    "payload": {"is_reusable": True},
                }
            }),
            "messaging_type": "RESPONSE",
        }

        if reply_to_message_id:
            ref_msg = self.message_repo.get_by_id_or_fb_id(str(reply_to_message_id))
            resolved_mid = ref_msg.facebook_message_id if (ref_msg and ref_msg.facebook_message_id) else reply_to_message_id
            form_data["reply_to"] = json.dumps({"mid": resolved_mid})

        params = {"access_token": page.page_access_token}
        mime = content_type or "application/octet-stream"

        def _post_multipart(data_payload: Dict[str, str]) -> Dict[str, Any]:
            resp = requests.post(
                url,
                params=params,
                data=data_payload,
                files={"filedata": (filename or "attachment", file_bytes, mime)},
                timeout=60,
            )
            return resp.json()

        try:
            response_json = await asyncio.to_thread(_post_multipart, form_data)
            if "error" in response_json and "reply_to" in form_data:
                del form_data["reply_to"]
                response_json = await asyncio.to_thread(_post_multipart, form_data)
        except Exception as e:
            raise FacebookAPIError(f"Network error sending attachment file: {str(e)}")

        self.auth_service.handle_api_errors(response_json)
        message_id = response_json.get("message_id")
        cdn_url = None

        if message_id:
            resolved_type, cdn_url = await self._fetch_facebook_attachment_url(
                message_id, page.page_access_token, fallback_type=attachment_type
            )
            stored_url = cdn_url or f"facebook:{message_id}"
            self._save_and_broadcast_attachment(
                page=page,
                page_id=page_id,
                recipient_id=recipient_id,
                message_id=message_id,
                attachment_type=resolved_type,
                media_url=stored_url,
                reply_to_message_id=reply_to_message_id,
            )

        return {**response_json, "url": cdn_url}

    async def refresh_message_media(self, message_id: str) -> Dict[str, Any]:
        """Lấy lại URL CDN mới từ Facebook theo facebook_message_id khi link cũ hết hạn."""
        msg = self.message_repo.get_by_id_or_fb_id(str(message_id))
        if not msg or not msg.facebook_message_id:
            raise ValueError("Message not found or missing facebook_message_id")

        page = self.page_repo.get_by_page_id(msg.page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {msg.page_id}")

        resolved_type, fresh_url = await self._fetch_facebook_attachment_url(
            msg.facebook_message_id, page.page_access_token
        )
        if not fresh_url:
            raise FacebookAPIError("Could not resolve fresh attachment URL from Facebook")

        msg.text = f"[{resolved_type}] {fresh_url}"
        self.db.commit()
        self.db.refresh(msg)
        return {
            "success": True,
            "url": fresh_url,
            "type": resolved_type,
            "message_id": msg.id,
            "facebook_message_id": msg.facebook_message_id,
        }

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
            self._save_and_broadcast_attachment(
                page=page,
                page_id=page_id,
                recipient_id=recipient_id,
                message_id=message_id,
                attachment_type=attachment_type,
                media_url=url_link,
                reply_to_message_id=reply_to_message_id,
            )

        return response_json

    async def react_to_message(
        self,
        page_id: str,
        recipient_id: str,
        message_id: str,
        reaction: Optional[str]
    ) -> Dict[str, Any]:
        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        # Resolve real facebook_message_id if internal numeric ID was passed
        target_msg = self.message_repo.get_by_id_or_fb_id(message_id)
        fb_mid = target_msg.facebook_message_id if target_msg else message_id

        # Normalize emoji
        # If reaction is provided, ensure heart has variation selector if needed, or map text to emoji
        text_to_emoji = {
            "like": "👍",
            "love": "❤️",
            "haha": "😆",
            "wow": "😮",
            "sad": "😢",
            "angry": "😡",
            "❤": "❤️",
        }
        emoji_reaction = text_to_emoji.get(reaction.lower() if isinstance(reaction, str) and reaction.isalpha() else reaction, reaction) if reaction else None

        sender_action = "react" if emoji_reaction else "unreact"
        payload = {
            "recipient": {"id": recipient_id},
            "sender_action": sender_action,
            "payload": {
                "message_id": fb_mid,
            }
        }
        if emoji_reaction:
            payload["payload"]["reaction"] = emoji_reaction

        url = f"{FACEBOOK_BASE_URL}/me/messages"
        params = {"access_token": page.page_access_token}

        try:
            response = await asyncio.to_thread(
                requests.post, url, params=params, json=payload, timeout=10
            )
            response_json = response.json()
        except Exception as e:
            raise FacebookAPIError(f"Network error reacting to message: {str(e)}")

        self.auth_service.handle_api_errors(response_json)

        saved_emoji = emoji_reaction if emoji_reaction else None
        if target_msg:
            self.message_repo.save_reaction(target_msg.facebook_message_id, saved_emoji)

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

