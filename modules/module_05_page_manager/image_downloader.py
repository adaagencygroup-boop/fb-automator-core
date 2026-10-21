# -*- coding: utf-8 -*-
"""Tải ảnh minh họa từ Pixabay. Hết kết quả thì caller dùng ảnh fallback tạm."""
import random
import requests

_FALLBACK_QUERIES = (
    "spa beauty",
    "nature landscape",
    "flowers",
    "vietnamese food",
    "coffee shop",
)


def get_image_from_internet(query_keyword, pixabay_key, log_func):
    """Lấy URL ảnh từ Pixabay. Không có key / hết hit → None."""
    key = (pixabay_key or "").strip()
    if not key or key == "ĐIỀN_KEY_PIXABAY_VÀO_ĐÂY":
        log_func("[*] Chưa có Pixabay key.")
        return None

    queries = []
    for raw in [query_keyword, *_FALLBACK_QUERIES]:
        clean = (
            str(raw or "")
            .replace("[", "")
            .replace("]", "")
            .replace('"', "")
            .replace("'", "")
            .strip()
        )
        if clean and clean.lower() not in {q.lower() for q in queries}:
            queries.append(clean)

    try:
        log_func(f"[*] Đang tìm ảnh trên Pixabay: '{queries[0]}'...")
        for clean_keyword in queries:
            response = requests.get(
                "https://pixabay.com/api/",
                params={
                    "key": key,
                    "q": clean_keyword,
                    "image_type": "photo",
                    "orientation": "horizontal",
                    "safesearch": "true",
                    "per_page": 10,
                },
                timeout=12,
            )
            if response.status_code == 429:
                log_func("[!] Pixabay giới hạn lượt gọi.")
                break
            if response.status_code != 200:
                continue
            try:
                hits = (response.json() or {}).get("hits") or []
            except Exception:
                continue
            if hits:
                hit = random.choice(hits)
                return hit.get("largeImageURL") or hit.get("webformatURL")
        log_func("[!] Pixabay không có ảnh phù hợp — sẽ dùng ảnh tạm.")
    except Exception as exc:
        log_func(f"[LỖI] Không gọi được Pixabay: {exc}")

    return None
