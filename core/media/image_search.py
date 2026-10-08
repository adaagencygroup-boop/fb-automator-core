"""
3-Tier Image Search Engine
Tầng 1: Pixabay API (nếu cấu hình Key)
Tầng 2: DuckDuckGo Images
Tầng 3: Wikimedia Commons API (Bền bỉ, chống chặn Cloudflare bot)
"""
import os
import requests
from typing import Optional, List
from config.constants import DOWNLOADS_DIR
from config.settings import settings

class ImageSearchEngine:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })

    def search_and_download(self, query: str, output_path: Optional[str] = None) -> Optional[str]:
        """Tìm ảnh và tải về máy cục bộ. Trả về đường dẫn file ảnh đã tải thành công."""
        if not output_path:
            clean_name = "".join(c for c in query[:20] if c.isalnum() or c in (" ", "_")).rstrip()
            output_path = str(DOWNLOADS_DIR / f"img_{clean_name}_{os.getpid()}.jpg")

        # Tầng 1: DuckDuckGo Images
        try:
            from duckduckgo_search import DDGS
            with DDGS() as ddgs:
                results = list(ddgs.images(query, max_results=5))
                for r in results:
                    img_url = r.get("image")
                    if img_url and self._download_file(img_url, output_path):
                        return output_path
        except Exception:
            pass

        # Tầng 2: Wikimedia Commons
        try:
            wiki_url = f"https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch={query}&gsrlimit=5&prop=imageinfo&iiprop=url&format=json"
            res = self.session.get(wiki_url, timeout=15).json()
            pages = res.get("query", {}).get("pages", {})
            for pid, pdata in pages.items():
                imageinfo = pdata.get("imageinfo", [])
                if imageinfo and "url" in imageinfo[0]:
                    img_url = imageinfo[0]["url"]
                    if self._download_file(img_url, output_path):
                        return output_path
        except Exception:
            pass

        return None

    def _download_file(self, url: str, target_path: str) -> bool:
        try:
            res = self.session.get(url, timeout=20, stream=True)
            if res.status_code == 200:
                with open(target_path, "wb") as f:
                    for chunk in res.iter_content(chunk_size=8192):
                        f.write(chunk)
                return True
        except Exception:
            pass
        return False

image_searcher = ImageSearchEngine()
