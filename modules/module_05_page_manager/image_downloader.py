# -*- coding: utf-8 -*-
"""Tải ảnh minh họa từ Pixabay. Hết kết quả thì caller dùng ảnh tạm."""
import hashlib
import random
from pathlib import Path

import requests

_FALLBACK_QUERIES = (
    "spa beauty",
    "nature landscape",
    "flowers",
    "vietnamese food",
    "coffee shop",
)


def keyword_cache_name(keyword) -> str:
    """Tên file cache theo từ khóa. Từ khóa trống không dùng chung một file."""
    text = " ".join(str(keyword or "").split()).casefold()
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest() + ".jpg"


def remember_keyword_image(folder, keyword, content: bytes) -> bool:
    name = keyword_cache_name(keyword)
    if not name or not content:
        return False
    path = Path(folder)
    path.mkdir(parents=True, exist_ok=True)
    temporary = path / f"{name}.part"
    temporary.write_bytes(content)
    temporary.replace(path / name)
    return True


def read_keyword_image(folder, keyword):
    name = keyword_cache_name(keyword)
    if not name:
        return None
    target = Path(folder) / name
    if not target.is_file():
        return None
    data = target.read_bytes()
    return data or None


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
                return None
            if response.status_code != 200:
                continue
            try:
                hits = (response.json() or {}).get("hits") or []
            except Exception:
                continue
            if hits:
                hit = random.choice(hits)
                return hit.get("largeImageURL") or hit.get("webformatURL")
        log_func("[!] Pixabay không có ảnh phù hợp.")
    except Exception as exc:
        log_func(f"[LỖI] Không gọi được Pixabay: {exc}")

    return None
