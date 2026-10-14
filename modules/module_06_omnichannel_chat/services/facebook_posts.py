import os
import requests
import asyncio
from typing import Dict, Any
from sqlalchemy.orm import Session
from modules.module_06_omnichannel_chat.repositories import PageRepository
from modules.module_06_omnichannel_chat.services.facebook_auth import FacebookAPIError, FacebookAuthService

FACEBOOK_API_VERSION = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v19.0")

class FacebookPostService:
    def __init__(self, db: Session):
        self.db = db
        self.page_repo = PageRepository(db)
        self.auth_service = FacebookAuthService(db)

    def is_internal_page_post(self, post_id: str, page_id: str) -> bool:
        if not post_id or not page_id:
            return False
        if "_" in str(post_id):
            target_id = str(post_id).split("_")[0]
            return target_id == str(page_id)
        return True

    async def get_post_details(self, post_id: str, page_id: str) -> Dict[str, Any]:
        if not self.is_internal_page_post(post_id, page_id):
            print(f"[FacebookPostService] Post {post_id} belongs to external group/page. Returning external post payload.")
            return {
                "id": post_id,
                "is_external": True,
                "message": "📌 Bài viết này được đăng trong Nhóm hoặc Trang khác.",
                "created_time": None,
                "full_picture": None,
                "source": None,
                "comments": {"data": [], "summary": {"total_count": 0}},
                "reactions": {"summary": {"total_count": 0}},
                "shares": {"count": 0}
            }

        page = self.page_repo.get_by_page_id(page_id)
        if not page or not page.page_access_token:
            raise ValueError(f"Page or page access token not found for Page ID {page_id}")

        comment_fields = "id,message,from,created_time,like_count,reactions.summary(total_count),attachment{media,target,type,url,subattachments},parent{id}"
        fields = (
            "id,message,created_time,reactions.summary(true),attachments{media,url,type},"
            f"comments.filter(stream).summary(true).limit(100){{{comment_fields},"
            f"comments.filter(stream).limit(100){{{comment_fields},"
            f"comments.filter(stream).limit(100){{{comment_fields}}}}}}}"
        )
        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/{post_id}"
        params = {
            "fields": fields,
            "access_token": page.page_access_token
        }

        try:
            response = await asyncio.to_thread(
                requests.get, url, params=params, timeout=15
            )
            response_json = response.json()
        except Exception as e:
            raise FacebookAPIError(f"Network error fetching post details: {str(e)}")

        if "error" in response_json:
            err_detail = response_json.get("error", {})
            err_code = err_detail.get("code")
            if err_code in (10, 200, 100):
                return {
                    "id": post_id,
                    "is_external": True,
                    "message": f"📌 {err_detail.get('message', 'Bài viết không thuộc quyền quản lý của Fanpage.')}",
                    "comments": {"data": [], "summary": {"total_count": 0}},
                    "reactions": {"summary": {"total_count": 0}}
                }

        self.auth_service.handle_api_errors(response_json)

        if "attachments" in response_json and isinstance(response_json["attachments"], dict):
            attachments = response_json["attachments"].get("data", [])
            if attachments and isinstance(attachments, list) and len(attachments) > 0:
                att = attachments[0]
                if isinstance(att, dict):
                    att_type = att.get("type", "")
                    media = att.get("media") or {}
                    if not isinstance(media, dict):
                        media = {}

                    if "video" in str(att_type):
                        response_json["source"] = media.get("source", "") or att.get("url", "")
                    else:
                        img_dict = media.get("image") or {}
                        if not isinstance(img_dict, dict):
                            img_dict = {}
                        img_src = img_dict.get("src", "")
                        response_json["full_picture"] = img_src or att.get("url", "")

        return response_json
