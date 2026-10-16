# -*- coding: utf-8 -*-
"""
File: core/image_downloader.py
"""
import random
import requests

def get_image_from_internet(query_keyword, pixabay_key, log_func):
    """Chỉ lấy ảnh từ Pixabay. Không có key thì đăng bài không kèm ảnh."""
    key = (pixabay_key or "").strip()
    if not key or key == "ĐIỀN_KEY_PIXABAY_VÀO_ĐÂY":
        log_func("[*] Chưa có Pixabay key, bài đăng không kèm ảnh.")
        return None

    clean_keyword = query_keyword.replace("[", "").replace("]", "").replace('"', '').replace("'", "").strip()
    if not clean_keyword:
        clean_keyword = "beautiful background"

    try:
        log_func(f"[*] Đang tìm ảnh trên Pixabay: '{clean_keyword}'...")
        url = "https://pixabay.com/api/"
        params = {
            'key': key,
            'q': clean_keyword,
            'image_type': 'photo',
            'orientation': 'horizontal',
            'per_page': 5
        }
        response = requests.get(url, params=params, timeout=10)
        if response.status_code == 200:
            try:
                data = response.json()
                if data.get('hits'):
                    return random.choice(data['hits'])['largeImageURL']
                log_func("[!] Pixabay không tìm thấy ảnh phù hợp. Đăng bài không kèm ảnh.")
            except Exception as json_err:
                log_func(f"[!] Pixabay trả về phản hồi không hợp lệ: {str(json_err)}")
        else:
            log_func(f"[!] Lỗi gọi API Pixabay (Mã trạng thái {response.status_code}). Đăng bài không kèm ảnh.")
    except Exception as e:
        log_func(f"[LỖI] Không gọi được Pixabay: {str(e)}")

    return None
