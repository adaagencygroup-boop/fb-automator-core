import os
import requests
import asyncio
from typing import Dict, Any, Tuple, Optional
from sqlalchemy.orm import Session
from modules.module_06_omnichannel_chat.repositories import AccountRepository, PageRepository
from modules.module_06_omnichannel_chat.schemas import AccountCreate, PageCreate

FACEBOOK_API_VERSION = os.getenv("FACEBOOK_GRAPH_API_VERSION", "v19.0")
FACEBOOK_APP_ID = os.getenv("FACEBOOK_APP_ID", "")
FACEBOOK_APP_SECRET = os.getenv("FACEBOOK_APP_SECRET", "")

class AccountNotFoundError(Exception):
    pass

class FacebookAuthError(Exception):
    pass

class FacebookAPIError(Exception):
    pass

class FacebookAuthService:
    def __init__(self, db: Session):
        self.db = db
        self.account_repo = AccountRepository(db)
        self.page_repo = PageRepository(db)

    def handle_api_errors(self, response_json: Dict[str, Any]):
        if "error" in response_json:
            error_detail = response_json["error"]
            error_message = error_detail.get("message", "Unknown Facebook Error")
            error_code = error_detail.get("code")
            error_type = error_detail.get("type")

            if error_code == 10900:
                raise FacebookAPIError("Facebook từ chối: Bình luận này đã được gửi tin nhắn riêng trước đó. Mỗi bình luận chỉ được gửi tin nhắn riêng một lần.")
            elif error_code == 10:
                raise FacebookAPIError("Không có quyền thao tác qua API (Mã #10): Bài viết/Bình luận này nằm trong Nhóm hoặc trên Trang khác.")
            elif error_type == "OAuthException" or error_code in (190, 102):
                raise FacebookAuthError(f"Facebook authentication failed (Token expired or revoked): {error_message}")
            else:
                raise FacebookAPIError(f"Facebook Graph API error: {error_message} (Code: {error_code})")

    def exchange_token(self, short_lived_token: str) -> str:
        if not FACEBOOK_APP_ID or not FACEBOOK_APP_SECRET:
            print("[Warning] FACEBOOK_APP_ID or FACEBOOK_APP_SECRET not configured. Skipping token exchange.")
            return short_lived_token

        url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/oauth/access_token"
        params = {
            "grant_type": "fb_exchange_token",
            "client_id": FACEBOOK_APP_ID,
            "client_secret": FACEBOOK_APP_SECRET,
            "fb_exchange_token": short_lived_token,
        }

        try:
            response = requests.get(url, params=params, timeout=10)
            response_json = response.json()
        except Exception as e:
            print(f"[Token Exchange Warning] Network error: {e}. Fallback to short-lived token.")
            return short_lived_token

        if "error" in response_json:
            print(f"[Token Exchange Error] {response_json['error'].get('message')}. Fallback to short-lived token.")
            return short_lived_token

        return response_json.get("access_token", short_lived_token)

    def fetch_user_pages(self, user_access_token: str, system_user_id: Optional[int] = 1) -> Tuple[str, list]:
        me_url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/me"
        me_params = {"fields": "id,name", "access_token": user_access_token}
        
        try:
            me_res = requests.get(me_url, params=me_params, timeout=10)
            me_json = me_res.json()
        except Exception as e:
            raise FacebookAPIError(f"Network error fetching user profile: {str(e)}")

        self.handle_api_errors(me_json)
        facebook_user_id = me_json.get("id")
        facebook_user_name = me_json.get("name") or "Tài khoản Facebook"

        pages_data = []
        next_url = f"https://graph.facebook.com/{FACEBOOK_API_VERSION}/me/accounts"
        next_params = {
            "fields": "id,name,access_token,picture.type(large)",
            "access_token": user_access_token,
            "limit": "200"
        }

        while next_url:
            try:
                if next_params:
                    pages_res = requests.get(next_url, params=next_params, timeout=20)
                    next_params = None
                else:
                    pages_res = requests.get(next_url, timeout=20)
                pages_json = pages_res.json()
            except Exception as e:
                raise FacebookAPIError(f"Network error fetching user pages: {str(e)}")

            self.handle_api_errors(pages_json)
            items = pages_json.get("data", [])
            pages_data.extend(items)

            paging = pages_json.get("paging", {})
            next_url = paging.get("next")

        account_in = AccountCreate(
            facebook_user_id=facebook_user_id,
            name=facebook_user_name,
            user_access_token=user_access_token,
            system_user_id=system_user_id or 1
        )
        self.account_repo.create_or_update_account(account_in)

        synced_pages = []
        for p in pages_data:
            avatar_url = None
            if "picture" in p and "data" in p["picture"]:
                avatar_url = p["picture"]["data"].get("url")

            page_in = PageCreate(
                page_id=p["id"],
                page_name=p["name"],
                facebook_user_id=facebook_user_id,
                page_access_token=p["access_token"],
                avatar_url=avatar_url
            )
            saved_page = self.page_repo.upsert(page_in)
            synced_pages.append(saved_page)

        return facebook_user_id, synced_pages
