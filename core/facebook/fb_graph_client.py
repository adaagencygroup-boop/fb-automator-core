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
import time
import requests
from typing import Optional, Dict, Any, List

GRAPH_API_VERSION = "v20.0"
GRAPH_BASE_URL = f"https://graph.facebook.com/{GRAPH_API_VERSION}"
GRAPH_VIDEO_URL = f"https://graph-video.facebook.com/{GRAPH_API_VERSION}"

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

    def fetch_managed_pages(self, user_access_token: str) -> List[Dict[str, Any]]:
        """Lấy toàn bộ danh sách Fanpage và Page Access Token vĩnh viễn từ User Token"""
        url = f"{GRAPH_BASE_URL}/me/accounts?limit=200&access_token={user_access_token}"
        res = self.request_with_retry("GET", url)
        data = res.json()
        pages = []
        if "data" in data:
            for item in data["data"]:
                pages.append({
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "access_token": item.get("access_token"),
                    "category": item.get("category", "")
                })
        return pages

fb_client = FacebookGraphClient()
