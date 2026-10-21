"""Ảnh đại diện Fanpage lấy từ thẻ og:image của chính page.

Graph `/{id}/picture` với page mới trả silhouette xám (is_silhouette), không phải
ảnh trong SVG profile picture (xlink:href trên scontent). og:image trùng file đó.
"""
import re
import threading
from html import unescape
from urllib.parse import urlparse

import httpx

_SILHOUETTE = "84628273_176159830277856"
_cache_lock = threading.Lock()
_cache: dict[str, str] = {}


def valid_page_avatar(url: str) -> bool:
    if not isinstance(url, str) or not url.startswith("https://"):
        return False
    if _SILHOUETTE in url or "rsrc.php" in url.lower():
        return False
    host = (urlparse(url).hostname or "").lower()
    return host.endswith(".fbcdn.net") and not host.startswith("static.")


def avatar_from_html(html: str) -> str:
    """URL trong <meta property=\"og:image\">. Bỏ ảnh silhouette mặc định của Facebook."""
    match = re.search(r'property=["\']og:image["\']\s+content=["\']([^"\']+)', html or "")
    if not match:
        return ""
    url = unescape(match.group(1)).replace("\\/", "/").strip()
    return url if valid_page_avatar(url) else ""


def page_avatar(url: str = "", graph_id: str = "") -> str:
    """Ảnh đại diện public của page. Cache trong process để lần tải sau không gọi lại Facebook."""
    page_url = (url or "").strip()
    graph = (graph_id or "").strip()
    if "facebook.com" not in page_url:
        page_url = f"https://www.facebook.com/profile.php?id={graph}" if graph.isdigit() else ""
    key = graph or page_url
    if not key:
        return ""
    with _cache_lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached
    found = ""
    if page_url:
        try:
            response = httpx.get(
                page_url,
                headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "vi"},
                timeout=8,
                follow_redirects=True,
            )
            if response.status_code == 200:
                found = avatar_from_html(response.text)
        except httpx.HTTPError:
            found = ""
    with _cache_lock:
        _cache[key] = found
    return found
