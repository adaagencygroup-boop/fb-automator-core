# -*- coding: utf-8 -*-
"""
File: core/image_downloader.py
"""
import random
import requests
try:
    from duckduckgo_search import DDGS
except Exception:
    DDGS = None

def search_wikimedia_images(keyword, log_func):
    try:
        log_func(f"[*] Đang tìm ảnh trên Wikimedia Commons: '{keyword}'...")
        url = "https://commons.wikimedia.org/w/api.php"
        headers = {
            "User-Agent": "AutoPostBot/1.0 (contact@example.com)"
        }
        
        # Bước 1: Tìm kiếm file
        params = {
            "action": "query",
            "format": "json",
            "list": "search",
            "srsearch": keyword,
            "srnamespace": 6,  # File namespace
            "srlimit": 3
        }
        response = requests.get(url, params=params, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            search_results = data.get("query", {}).get("search", [])
            
            # Bước 2: Lấy URL ảnh trực tiếp từ các kết quả tìm thấy
            for item in search_results:
                title = item.get("title")
                if not title:
                    continue
                
                params_info = {
                    "action": "query",
                    "format": "json",
                    "prop": "imageinfo",
                    "titles": title,
                    "iiprop": "url"
                }
                res_info = requests.get(url, params=params_info, headers=headers, timeout=10)
                if res_info.status_code == 200:
                    data_info = res_info.json()
                    pages = data_info.get("query", {}).get("pages", {})
                    for page_id, page_data in pages.items():
                        imageinfo = page_data.get("imageinfo", [])
                        if imageinfo:
                            img_url = imageinfo[0].get("url")
                            if img_url and img_url.startswith("http"):
                                # Bỏ qua các định dạng fb/web không thích
                                if img_url.lower().endswith((".webp", ".svg", ".ogv", ".ogg", ".pdf", ".tiff")):
                                    continue
                                return img_url
        log_func("[!] Wikimedia Commons không tìm thấy ảnh phù hợp.")
        return None
    except Exception as e:
        log_func(f"[ERROR] Lỗi Wikimedia Commons: {str(e)}")
        return None

def get_image_from_internet(query_keyword, pixabay_key, log_func):
    clean_keyword = query_keyword.replace("[", "").replace("]", "").replace('"', '').replace("'", "").strip()
    if not clean_keyword:
        clean_keyword = "beautiful background"

    # 1. Thử tìm trên Pixabay
    if pixabay_key and pixabay_key != "ĐIỀN_KEY_PIXABAY_VÀO_ĐÂY" and pixabay_key.strip():
        try:
            log_func(f"[*] Đang tìm ảnh trên Pixabay: '{clean_keyword}'...")
            url = "https://pixabay.com/api/"
            params = {
                'key': pixabay_key.strip(),
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
                    log_func("[!] Pixabay không tìm thấy ảnh phù hợp.")
                except Exception as json_err:
                    log_func(f"[!] Pixabay trả về phản hữu không hợp lệ: {str(json_err)}")
            else:
                log_func(f"[!] Lỗi gọi API Pixabay (Mã trạng thái {response.status_code})")
        except Exception as e:
            log_func(f"[ERROR] Lỗi gọi API Pixabay: {str(e)}")

    # 2. Thử tìm trên DuckDuckGo
    try:
        log_func(f"[*] Đang quét DuckDuckGo tìm ảnh: '{clean_keyword}'...")
        with DDGS() as ddgs:
            results = list(ddgs.images(keywords=clean_keyword, max_results=5))
            if results:
                valid_images = []
                for res in results:
                    img_url = res.get('image') or res.get('url')
                    if img_url and img_url.startswith('http'):
                        if img_url.endswith('.webp'):
                            continue
                        lower_url = img_url.lower()
                        if 'fbsbx.com' in lower_url or 'fbcdn.net' in lower_url or 'facebook.com' in lower_url:
                            continue
                        valid_images.append(img_url)
                if valid_images:
                    return random.choice(valid_images)
        log_func("[!] DuckDuckGo không tìm thấy ảnh phù hợp.")
    except Exception as e:
        log_func(f"[ERROR] Lỗi DuckDuckGo: {str(e)}")

    # 3. Thử tìm trên Wikimedia Commons (Không cần key, không bị Cloudflare bot block)
    wikimedia_url = search_wikimedia_images(clean_keyword, log_func)
    if wikimedia_url:
        return wikimedia_url

    return None
