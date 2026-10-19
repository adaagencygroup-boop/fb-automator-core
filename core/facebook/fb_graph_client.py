"""
Facebook Meta Graph API Client
Hỗ trợ:
- Đăng ảnh (Photos endpoint) kèm fallback về Feed Status thuần text
- Đăng Video Reels 3 bước chuẩn Meta (Start -> Upload Binary -> Finish)
- Đăng Video dài chuẩn Graph-Video
- Lấy Page Token từ User Token
- Cơ chế Exponential Backoff & Retry tự động reset file pointers
"""
import os
import re
import time
import requests
from typing import Optional, Dict, Any, List

from modules.module_05_page_manager.meta_config import GRAPH_API_VERSION, REQUIRED_SCOPES, credentials
GRAPH_BASE_URL = f"https://graph.facebook.com/{GRAPH_API_VERSION}"
GRAPH_VIDEO_URL = f"https://graph-video.facebook.com/{GRAPH_API_VERSION}"

class MetaAPIError(RuntimeError):
    """Safe API error without response bodies, request URLs or credentials."""


class FacebookGraphClient:
    def __init__(self, timeout: int = 60):
        self.timeout = timeout
        self.session = requests.Session()

    def _reset_file_pointers(self, files: Optional[Dict[str, Any]]):
        """Reset con trỏ file về 0 trước khi retry để tránh gửi luồng rỗng"""
        if not files:
            return
        for key, val in files.items():
            if hasattr(val, "seek"):
                val.seek(0)
            elif isinstance(val, tuple) and len(val) > 1 and hasattr(val[1], "seek"):
                val[1].seek(0)

    def request_with_retry(self, method: str, url: str, max_retries: int = 3, **kwargs) -> requests.Response:
        """Gửi request với Exponential Backoff tự động khi gặp lỗi mạng/rate limit"""
        files = kwargs.get("files")
        last_exception = None

        for attempt in range(1, max_retries + 1):
            try:
                self._reset_file_pointers(files)
                response = self.session.request(method, url, timeout=self.timeout, **kwargs)
                if response.status_code == 200:
                    return response
                
                # Check for transient Facebook error codes (1, 2, 4, 17, 341)
                try:
                    err_json = response.json()
                    fb_code = err_json.get("error", {}).get("code")
                    if fb_code in [1, 2, 4, 17, 341] and attempt < max_retries:
                        time.sleep(2 ** attempt)
                        continue
                except Exception:
                    pass

                return response
            except (requests.RequestException, ConnectionError, TimeoutError) as e:
                last_exception = e
                if attempt < max_retries:
                    time.sleep(2 ** attempt)
                else:
                    raise last_exception

        raise RuntimeError("Request failed after max retries")

    def post_photo_or_feed(self, page_id: str, access_token: str, message: str, image_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Đăng bài lên Fanpage.
        Ưu tiên đăng kèm ảnh nếu có image_path. Nếu lỗi ảnh, tự động fallback sang Feed Text.
        """
        if image_path and os.path.exists(image_path):
            url = f"{GRAPH_BASE_URL}/{page_id}/photos"
            try:
                with open(image_path, "rb") as img_file:
                    files = {"source": img_file}
                    data = {"caption": message, "access_token": access_token}
                    res = self.request_with_retry("POST", url, data=data, files=files)
                    res_json = res.json()
                    if "id" in res_json:
                        return {"success": True, "post_id": res_json["id"], "type": "PHOTO"}
            except Exception as e:
                pass  # Fallback to pure text post below

        # Fallback to Text Feed Status
        url = f"{GRAPH_BASE_URL}/{page_id}/feed"
        data = {"message": message, "access_token": access_token}
        res = self.request_with_retry("POST", url, data=data)
        res_json = res.json()
        if "id" in res_json:
            return {"success": True, "post_id": res_json["id"], "type": "TEXT_FEED"}
        else:
            err_msg = res_json.get("error", {}).get("message", "Unknown error")
            return {"success": False, "error": err_msg}

    def upload_reel(self, page_id: str, access_token: str, video_path: str, description: str) -> Dict[str, Any]:
        """
        Đăng Reels lên Facebook qua quy trình 3-Phase chuẩn Meta Graph API
        """
        if not os.path.exists(video_path):
            return {"success": False, "error": f"File video không tồn tại: {video_path}"}

        file_size = os.path.getsize(video_path)

        # Giai đoạn 1: Khởi tạo phiên Reels (Start phase)
        start_url = f"{GRAPH_BASE_URL}/{page_id}/video_reels"
        start_payload = {
            "upload_phase": "start",
            "access_token": access_token
        }
        res_start = self.request_with_retry("POST", start_url, data=start_payload)
        start_data = res_start.json()

        if "video_id" not in start_data or "upload_url" not in start_data:
            err = start_data.get("error", {}).get("message", "Không thể khởi tạo upload Reels")
            return {"success": False, "error": err}

        video_id = start_data["video_id"]
        upload_url = start_data["upload_url"]

        # Giai đoạn 2: Upload Binary Payload
        headers = {
            "Authorization": f"OAuth {access_token}",
            "offset": "0",
            "file_size": str(file_size)
        }
        with open(video_path, "rb") as vf:
            res_upload = self.request_with_retry("POST", upload_url, headers=headers, data=vf)
            if res_upload.status_code not in [200, 201]:
                return {"success": False, "error": f"Lỗi upload binary Reels: {res_upload.text}"}

        # Giai đoạn 3: Hoàn tất & Xuất bản (Finish phase)
        finish_payload = {
            "upload_phase": "finish",
            "access_token": access_token,
            "video_id": video_id,
            "video_state": "PUBLISHED",
            "description": description
        }
        res_finish = self.request_with_retry("POST", start_url, data=finish_payload)
        finish_data = res_finish.json()

        if finish_data.get("success") is True or "video_id" in finish_data:
            return {"success": True, "video_id": video_id, "type": "REELS"}
        else:
            err = finish_data.get("error", {}).get("message", "Lỗi hoàn tất Reels")
            return {"success": False, "error": err}

    def upload_long_video(self, page_id: str, access_token: str, video_path: str, title: str, description: str) -> Dict[str, Any]:
        """
        Đăng Video dài lên Fanpage thông qua graph-video endpoint
        """
        if not os.path.exists(video_path):
            return {"success": False, "error": f"File video không tồn tại: {video_path}"}

        url = f"{GRAPH_VIDEO_URL}/{page_id}/videos"
        data = {
            "title": title,
            "description": description,
            "access_token": access_token
        }
        with open(video_path, "rb") as vf:
            files = {"source": vf}
            res = self.request_with_retry("POST", url, data=data, files=files, timeout=300)
            res_json = res.json()
            if "id" in res_json:
                return {"success": True, "video_id": res_json["id"], "type": "VIDEO"}
            else:
                err = res_json.get("error", {}).get("message", "Lỗi đăng video dài")
                return {"success": False, "error": err}

    def _get_json(self, path, params):
        try:
            response = self.session.get(f"{GRAPH_BASE_URL}/{path}", params=params, timeout=20)
            data = response.json()
        except Exception:
            raise MetaAPIError("Không kết nối được Meta Graph API.") from None
        if response.status_code != 200 or not isinstance(data, dict) or "error" in data:
            code = data.get("error", {}).get("code") if isinstance(data, dict) else None
            raise MetaAPIError(f"Meta Graph API từ chối yêu cầu (mã {code}).")
        return data

    def exchange_token(self, short_lived_token: str) -> str:
        app_id, secret = credentials()
        if not short_lived_token:
            raise ValueError("Thiếu Access Token.")
        data = self._get_json("oauth/access_token", {
            "grant_type": "fb_exchange_token", "client_id": app_id,
            "client_secret": secret, "fb_exchange_token": short_lived_token,
        })
        if not data.get("access_token"):
            raise MetaAPIError("Meta không trả về token dài hạn.")
        return data["access_token"]

    def inspect_token(self, token, *, user=True):
        app_id, secret = credentials()
        data = self._get_json("debug_token", {
            "input_token": token, "access_token": f"{app_id}|{secret}",
        }).get("data") or {}
        if data.get("is_valid") is not True:
            raise ValueError("Token hết hạn hoặc đã bị thu hồi.")
        if str(data.get("app_id")) != app_id:
            raise ValueError("Token thuộc App ID khác.")
        for field in ("expires_at", "data_access_expires_at"):
            expiry = data.get(field)
            if expiry is not None and (not isinstance(expiry, (int, float)) or (expiry != 0 and expiry <= time.time())):
                raise ValueError("Token hoặc quyền truy cập dữ liệu đã hết hạn.")
        if user:
            if data.get("type") != "USER" or not data.get("user_id"):
                raise ValueError("Cần User Access Token hợp lệ.")
            missing = REQUIRED_SCOPES - set(data.get("scopes") or [])
            if missing:
                raise ValueError("Thiếu quyền: " + ", ".join(sorted(missing)))
        elif data.get("type") != "PAGE":
            raise ValueError("Meta không xác nhận Page Access Token.")
        return {key: data[key] for key in (
            "app_id", "user_id", "type", "scopes", "granular_scopes", "issued_at",
            "expires_at", "data_access_expires_at", "is_valid",
        ) if key in data}

    def get_user_profile(self, access_token: str) -> Dict[str, Any]:
        data = self._get_json("me", {"fields": "id,name,picture.type(large)", "access_token": access_token})
        if not data.get("id") or not data.get("name"):
            raise ValueError("Meta không trả về danh tính Facebook đầy đủ.")
        return data

    def fetch_managed_pages(self, user_access_token: str) -> List[Dict[str, Any]]:
        if not user_access_token:
            raise ValueError("Thiếu User Access Token.")
        pages, seen, cursors = [], set(), set()
        params = {"fields": "id,name,access_token,category,picture.type(large)",
                  "access_token": user_access_token, "limit": "200"}
        while True:
            data = self._get_json("me/accounts", params)
            if not isinstance(data.get("data"), list):
                raise ValueError("Danh sách Page không hợp lệ.")
            for item in data["data"]:
                if not isinstance(item, dict) or any(not item.get(key) for key in ("id", "name", "access_token")):
                    raise ValueError("Page thiếu ID, tên hoặc Access Token; chưa lưu dữ liệu.")
                pid = str(item["id"]).strip()
                if not pid or not isinstance(item["name"], str) or not item["name"].strip() or not isinstance(item["access_token"], str) or not item["access_token"].strip():
                    raise ValueError("Dữ liệu Page không hợp lệ; chưa lưu dữ liệu.")
                if pid not in seen:
                    seen.add(pid)
                    pages.append({"id": pid, "name": item["name"], "access_token": item["access_token"],
                                  "category": item.get("category") or "Fanpage Facebook"})
            paging = data.get("paging") or {}
            if not paging.get("next"):
                return pages
            # Keep credentials on graph.facebook.com, even if paging.next is malformed.
            from urllib.parse import urlsplit, parse_qs
            next_url = urlsplit(paging["next"])
            if next_url.scheme != "https" or next_url.hostname != "graph.facebook.com" or next_url.port not in (None, 443) or next_url.username or next_url.password or not next_url.path.endswith("/me/accounts") or paging["next"] in cursors:
                raise ValueError("Phân trang Meta không hợp lệ hoặc bị lặp.")
            cursors.add(paging["next"])
            params = {**params, **{key: values[-1] for key, values in parse_qs(next_url.query).items()}, "access_token": user_access_token}


def extract_token_from_text(text: str) -> Optional[str]:
    """Trích xuất access_token từ URL hash hoặc chuỗi query."""
    if not text:
        return None
    match = re.search(r"access_token=([^&]+)", text)
    if match:
        return match.group(1)
    return None

fb_client = FacebookGraphClient()
