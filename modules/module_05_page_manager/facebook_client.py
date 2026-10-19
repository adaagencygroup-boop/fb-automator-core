# -*- coding: utf-8 -*-
"""
File: core/facebook_client.py
"""
import os
import time
import requests

def reset_file_pointers(data=None, files=None):
    if data and hasattr(data, 'seek'):
        try:
            data.seek(0)
        except Exception:
            pass
    if files:
        if isinstance(files, dict):
            for key, val in files.items():
                if hasattr(val, 'seek'):
                    try:
                        val.seek(0)
                    except Exception:
                        pass
                elif isinstance(val, (tuple, list)):
                    for item in val:
                        if hasattr(item, 'seek'):
                            try:
                                item.seek(0)
                            except Exception:
                                pass

def requests_post_with_retry(url, data=None, files=None, headers=None, timeout=30, max_retries=3, backoff_factor=2, log_func=None, page_name=""):
    for attempt in range(1, max_retries + 1):
        if attempt > 1:
            reset_file_pointers(data, files)
        try:
            response = requests.post(url, data=data, files=files, headers=headers, timeout=timeout)
            if response.status_code >= 500:
                response.raise_for_status()
            return response
        except (requests.exceptions.RequestException, requests.exceptions.HTTPError) as e:
            if attempt == max_retries:
                raise e
            sleep_time = backoff_factor ** attempt
            if log_func:
                log_func(f"[WARNING] [Lỗi kết nối] Thử lại lần {attempt}/{max_retries} sau {sleep_time}s cho page {page_name} do: {str(e)}")
            time.sleep(sleep_time)

def post_to_facebook_page(page_name, page_id, page_token, message, image_url, fb_version, log_func, save_posted_func):
    try:
        if image_url:
            url = f"https://graph.facebook.com/{fb_version}/{page_id}/photos"
            payload = {'url': image_url, 'caption': message, 'access_token': page_token}
        else:
            url = f"https://graph.facebook.com/{fb_version}/{page_id}/feed"
            payload = {'message': message, 'access_token': page_token}

        response = requests_post_with_retry(url, data=payload, timeout=20, log_func=log_func, page_name=page_name)
        result = response.json()
        
        if 'id' in result:
            log_func(f"[SUCCESS] Đã đăng bài thành công lên Page: {page_name}! Post ID: {result['id']}")
            save_posted_func(page_name, result['id'])
            return True
        else:
            error_msg = result.get('error', {}).get('message', 'Không rõ nguyên nhân')
            log_func(f"[ERROR] Facebook từ chối đăng lên page {page_name}: {error_msg}")
            if image_url:
                log_func("[*] Thử đăng lại dạng TEXT ONLY (không kèm ảnh) để cứu bài viết...")
                return post_to_facebook_page(page_name, page_id, page_token, message, None, fb_version, log_func, save_posted_func)
            return False
    except Exception as e:
        log_func(f"[EXCEPTION] Lỗi mạng khi kết nối Facebook Graph API sau các lần thử lại: {str(e)}")
        return False

def upload_reel_to_facebook(page_name, page_id, page_token, video_path, message, fb_version, log_func, save_posted_func):
    try:
        log_func(f"[*] [REELS] Bắt đầu khởi tạo phiên tải lên Reels cho {page_name}...")
        # Bước 1: Khởi tạo
        url = f"https://graph.facebook.com/{fb_version}/{page_id}/video_reels"
        payload = {
            "upload_phase": "start",
            "access_token": page_token
        }
        response = requests_post_with_retry(url, data=payload, timeout=20, log_func=log_func, page_name=page_name)
        data = response.json()
        if 'video_id' not in data or 'upload_url' not in data:
            error_msg = data.get('error', {}).get('message', 'Không rõ nguyên nhân')
            log_func(f"[ERROR] Facebook từ chối khởi tạo Reels: {error_msg}")
            return False
        
        video_id = data['video_id']
        upload_url = data['upload_url']
        
        # Bước 2: Tải video nhị phân lên
        file_size = os.path.getsize(video_path)
        log_func(f"[*] [REELS] Đang truyền tải file: {os.path.basename(video_path)} ({file_size} bytes)...")
        
        headers = {
            "Authorization": f"OAuth {page_token}",
            "Content-Type": "application/octet-stream",
            "offset": "0",
            "file_size": str(file_size)
        }
        
        with open(video_path, "rb") as f:
            response2 = requests_post_with_retry(upload_url, headers=headers, data=f, timeout=120, log_func=log_func, page_name=page_name)
        
        res2 = response2.json()
        if not res2.get('success'):
            log_func(f"[ERROR] Truyền tải file video thất bại: {res2}")
            return False
            
        # Bước 3: Hoàn tất và xuất bản
        log_func(f"[*] [REELS] Đang hoàn tất và xuất bản Reels lên Facebook...")
        finish_url = f"https://graph.facebook.com/{fb_version}/{page_id}/video_reels"
        payload_finish = {
            "upload_phase": "finish",
            "video_id": video_id,
            "access_token": page_token,
            "video_state": "PUBLISHED",
            "description": message
        }
        response3 = requests_post_with_retry(finish_url, data=payload_finish, timeout=30, log_func=log_func, page_name=page_name)
        res3 = response3.json()
        
        if res3.get('success') or 'video_id' in res3:
            reel_url = f"https://www.facebook.com/reel/{video_id}"
            log_func(f"[SUCCESS] Đã đăng Reels thành công lên Page: {page_name}! Link bài viết: {reel_url}")
            save_posted_func(page_name, video_id)
            return reel_url
        else:
            error_msg = res3.get('error', {}).get('message', 'Không rõ nguyên nhân')
            log_func(f"[ERROR] Hoàn tất Reels thất bại: {error_msg}")
            return False
    except Exception as e:
        log_func(f"[EXCEPTION] Lỗi mạng khi tải lên Reels sau các lần thử lại: {str(e)}")
        return False

def upload_video_to_facebook(page_name, page_id, page_token, video_path, message, fb_version, log_func, save_posted_func):
    try:
        log_func(f"[*] [VIDEO] Đang đăng tải video dài lên Page {page_name}...")
        url = f"https://graph-video.facebook.com/{fb_version}/{page_id}/videos"
        payload = {
            "description": message,
            "access_token": page_token
        }
        with open(video_path, "rb") as f:
            files = {
                "source": f
            }
            response = requests_post_with_retry(url, data=payload, files=files, timeout=300, log_func=log_func, page_name=page_name) # 5 phút timeout cho video dài
        
        result = response.json()
        if 'id' in result:
            log_func(f"[SUCCESS] Đã đăng video dài thành công lên Page: {page_name}! Video ID: {result['id']}")
            save_posted_func(page_name, result['id'])
            return True
        else:
            error_msg = result.get('error', {}).get('message', 'Không rõ nguyên nhân')
            log_func(f"[ERROR] Đăng video dài thất bại: {error_msg}")
            return False
    except Exception as e:
        log_func(f"[EXCEPTION] Lỗi kết nối mạng khi tải lên video dài sau các lần thử lại: {str(e)}")
        return False
