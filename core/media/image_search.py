import os
import random
import requests
from typing import Optional
from config.constants import DOWNLOADS_DIR
class ImageSearchEngine:
  def __init__(self, pixabay_key: Optional[str] = None):
    self.pixabay_key = pixabay_key
    self.session = requests.Session()
    self.session.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
  def set_pixabay_key(self, key: Optional[str]):
    self.pixabay_key = (key or "").strip()
  def search_and_download(self, query: str, output_path: Optional[str] = None, pixabay_key: Optional[str] = None) -> Optional[str]:
    active_pixabay = pixabay_key or self.pixabay_key
    if not output_path:
      clean_name = "".join(c for c in query[:20] if c.isalnum() or c in (" ", "_")).rstrip()
      output_path = str(DOWNLOADS_DIR / f"img_{clean_name}_{os.getpid()}_{int(random.random()*10000)}.jpg")
    clean_kw = "".join(c for c in query if c.isalnum() or c.isspace()).strip() or "background"
    if active_pixabay and len(active_pixabay) > 5 and "ĐIỀN" not in active_pixabay:
      try:
        p_url = "https://pixabay.com/api/"
        p_params = {
          "key": active_pixabay,
          "q": clean_kw,
          "image_type": "photo",
          "orientation": "horizontal",
          "per_page": 5
        }
        res = self.session.get(p_url, params=p_params, timeout=10)
        if res.status_code == 200:
          hits = res.json().get("hits", [])
          if hits:
            pick = random.choice(hits)
            large_url = pick.get("largeImageURL") or pick.get("webformatURL")
            if large_url and self._download_file(large_url, output_path):
              return output_path
      except Exception:
        pass
    try:
      from duckduckgo_search import DDGS
      with DDGS() as ddgs:
        results = list(ddgs.images(clean_kw, max_results=5))
        for r in results:
          img_url = r.get("image")
          if img_url and self._download_file(img_url, output_path):
            return output_path
    except Exception:
      pass
    try:
      wiki_url = f"https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch={clean_kw}&gsrlimit=5&prop=imageinfo&iiprop=url&format=json"
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
        if os.path.exists(target_path) and os.path.getsize(target_path) > 1000:
          return True
    except Exception:
      pass
    return False
image_searcher = ImageSearchEngine()
