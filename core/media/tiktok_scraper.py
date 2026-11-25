import os
import re
import time
import tempfile
import requests
import yt_dlp
from pathlib import Path
from typing import Callable, Optional, Dict, Any, Iterable, List, Tuple
from core.database.connection import db
from core.media.tiktok_browser import (
  DEFAULT_DESKTOP_UA,
  get_session_data,
  search_tiktok_via_browser,
  fetch_tiktok_channel_via_browser,
  resolve_tiktok_video_via_browser,
)
try:
  import curl_cffi.requests as c_requests
  HAS_CURL_CFFI = True
except ImportError:
  c_requests = None
  HAS_CURL_CFFI = False
def _should_stop(stop_check: Optional[Callable[[], bool]]) -> bool:
  if not stop_check:
    return False
  try:
    return bool(stop_check())
  except Exception:
    return False
def _normalize_cookies_list(cookies: Any = None) -> List[Dict[str, Any]]:
  if isinstance(cookies, list) and cookies:
    return [c for c in cookies if isinstance(c, dict) and c.get("name")]
  if isinstance(cookies, dict) and cookies:
    return [
      {"name": k, "value": str(v), "domain": ".tiktok.com", "path": "/", "secure": True}
      for k, v in cookies.items()
      if k
    ]
  session_data = get_session_data()
  raw_list = session_data.get("cookies", []) if isinstance(session_data, dict) else []
  return [c for c in raw_list if isinstance(c, dict) and c.get("name")]
def _cookies_to_dict(cookies: Any = None) -> Dict[str, str]:
  return {
    str(c["name"]): str(c.get("value") or "")
    for c in _normalize_cookies_list(cookies)
    if c.get("name") and c.get("value") is not None
  }
def _write_netscape_cookie_file(cookies: Any = None) -> Optional[str]:
  cookie_list = _normalize_cookies_list(cookies)
  if not cookie_list:
    return None
  fd, tmp_path = tempfile.mkstemp(prefix="tt_cookies_", suffix=".txt")
  try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
      f.write("# Netscape HTTP Cookie File\n")
      for c in cookie_list:
        name = str(c.get("name") or "").strip()
        val = str(c.get("value") or "")
        if not name:
          continue
        domain = str(c.get("domain") or ".tiktok.com")
        if not domain.startswith(".") and "tiktok" in domain:
          domain = "." + domain
        include_sub = "TRUE" if domain.startswith(".") else "FALSE"
        path = str(c.get("path") or "/")
        secure = "TRUE" if c.get("secure", True) else "FALSE"
        expiry = int(c.get("expiry") or c.get("expires") or (int(time.time()) + 86400 * 30))
        f.write(f"{domain}\t{include_sub}\t{path}\t{secure}\t{expiry}\t{name}\t{val}\n")
    return tmp_path
  except Exception:
    try:
      os.remove(tmp_path)
    except Exception:
      pass
    return None
def _is_valid_video_file(file_path: str) -> bool:
  if not os.path.exists(file_path) or os.path.getsize(file_path) <= 1000:
    return False
  try:
    with open(file_path, "rb") as f:
      head = f.read(64).lstrip().lower()
    if head.startswith(b"<html") or head.startswith(b"<!doctype") or head.startswith(b"{"):
      return False
  except Exception:
    return False
  return True
def fetch_tiktok_user_videos(
  username_or_url: str,
  count: int = 15,
  driver=None,
  exclude_ids: Optional[Iterable[str]] = None,
  match_keywords: Optional[List[str]] = None,
  stop_check: Optional[Callable[[], bool]] = None,
) -> List[Dict[str, Any]]:
  return fetch_tiktok_channel_via_browser(
    username_or_url,
    count=count,
    driver=driver,
    exclude_ids=exclude_ids,
    match_keywords=match_keywords,
    stop_check=stop_check,
  )
def search_tiktok_videos(
  keywords: str,
  cursor: int = 0,
  count: int = 15,
  driver=None,
  exclude_ids: Optional[Iterable[str]] = None,
  stop_check: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
  browser_vids = search_tiktok_via_browser(
    keywords,
    count=count,
    driver=driver,
    exclude_ids=exclude_ids,
    stop_check=stop_check,
  )
  if browser_vids:
    return {"code": 0, "msg": "success", "data": {"videos": browser_vids}}
  return {"code": -1, "msg": "No TikTok videos found", "data": {"videos": []}}
def resolve_tiktok_video_detail(
  raw_url_or_id: str,
  driver=None,
  stop_check: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
  return resolve_tiktok_video_via_browser(raw_url_or_id, driver=driver, stop_check=stop_check)
def resolve_tiktok_video_url(
  raw_url_or_id: str,
  driver=None,
  stop_check: Optional[Callable[[], bool]] = None,
) -> Tuple[Optional[str], str]:
  meta = resolve_tiktok_video_detail(raw_url_or_id, driver=driver, stop_check=stop_check)
  play_urls = meta.get("play_urls") or []
  return (play_urls[0] if play_urls else None), (meta.get("title") or "")
def download_stream_to_file(
  download_url: str,
  save_path: str,
  cookies: Any = None,
  user_agent: Optional[str] = None,
  referer: str = "https://www.tiktok.com/",
  stop_check: Optional[Callable[[], bool]] = None,
) -> bool:
  if not download_url:
    return False
  cookie_dict = _cookies_to_dict(cookies)
  headers = {
    "User-Agent": user_agent or DEFAULT_DESKTOP_UA,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": referer,
    "Origin": "https://www.tiktok.com",
    "Range": "bytes=0-",
    "Sec-Fetch-Dest": "video",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
  }
  for attempt in range(3):
    if _should_stop(stop_check):
      return False
    use_cffi = HAS_CURL_CFFI and c_requests is not None and attempt < 2
    try:
      if use_cffi:
        resp_ctx = c_requests.get(
          download_url,
          headers=headers,
          cookies=cookie_dict or None,
          impersonate="chrome124",
          stream=True,
          timeout=35,
        )
      else:
        resp_ctx = requests.get(
          download_url,
          headers=headers,
          cookies=cookie_dict or None,
          stream=True,
          timeout=35,
        )
      with resp_ctx as r:
        content_type = (r.headers.get("Content-Type") or "").lower()
        if r.status_code in (200, 206) and not content_type.startswith(("text/", "application/json")):
          with open(save_path, "wb") as f:
            iterator = r.iter_content(chunk_size=256 * 1024)
            for chunk in iterator:
              if _should_stop(stop_check):
                f.close()
                if os.path.exists(save_path):
                  try:
                    os.remove(save_path)
                  except Exception:
                    pass
                return False
              if chunk:
                f.write(chunk)
          if _is_valid_video_file(save_path):
            return True
    except Exception:
      pass
    if os.path.exists(save_path):
      try:
        os.remove(save_path)
      except Exception:
        pass
    time.sleep(0.5)
  return False
def download_tiktok_video_ytdlp(
  video_url: str,
  save_path: str,
  cookies: Any = None,
  user_agent: Optional[str] = None,
) -> Tuple[bool, str]:
  if not video_url:
    return False, ""
  cookie_file = _write_netscape_cookie_file(cookies)
  base_no_ext = os.path.splitext(save_path)[0]
  outtmpl = base_no_ext + ".%(ext)s"
  ydl_opts: Dict[str, Any] = {
    "outtmpl": outtmpl,
    "format": "mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "merge_output_format": "mp4",
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "socket_timeout": 30,
    "retries": 5,
    "http_headers": {
      "User-Agent": user_agent or DEFAULT_DESKTOP_UA,
      "Referer": "https://www.tiktok.com/",
    },
  }
  if cookie_file:
    ydl_opts["cookiefile"] = cookie_file
  title = ""
  try:
    if os.path.exists(save_path):
      try:
        os.remove(save_path)
      except Exception:
        pass
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
      info = ydl.extract_info(video_url, download=True)
      if isinstance(info, dict):
        title = str(info.get("description") or info.get("title") or "").strip()
    if not _is_valid_video_file(save_path):
      for ext in (".mp4", ".mkv", ".webm", ".mov"):
        candidate = base_no_ext + ext
        if os.path.exists(candidate) and _is_valid_video_file(candidate):
          if candidate != save_path:
            os.replace(candidate, save_path)
          break
    return _is_valid_video_file(save_path), title
  except Exception:
    return False, title
  finally:
    if cookie_file and os.path.exists(cookie_file):
      try:
        os.remove(cookie_file)
      except Exception:
        pass
def download_tiktok_video(
  video_url_or_id: str,
  save_path: str,
  driver=None,
  stop_check: Optional[Callable[[], bool]] = None,
) -> Tuple[bool, Dict[str, Any]]:
  if _should_stop(stop_check):
    return False, {}
  meta = resolve_tiktok_video_detail(video_url_or_id, driver=driver, stop_check=stop_check)
  if _should_stop(stop_check):
    return False, meta
  cookies = meta.get("cookies") or None
  user_agent = meta.get("user_agent") or DEFAULT_DESKTOP_UA
  play_urls = meta.get("play_urls") or []
  canonical_url = meta.get("source_url") or (
    video_url_or_id
    if str(video_url_or_id).startswith("http")
    else f"https://www.tiktok.com/@_/video/{video_url_or_id}"
  )
  for cdn_url in play_urls:
    if _should_stop(stop_check):
      return False, meta
    if download_stream_to_file(
      cdn_url,
      save_path,
      cookies=cookies,
      user_agent=user_agent,
      stop_check=stop_check,
    ):
      return True, meta
  if _should_stop(stop_check):
    return False, meta
  ok, ydl_title = download_tiktok_video_ytdlp(
    canonical_url,
    save_path,
    cookies=cookies,
    user_agent=user_agent,
  )
  if ok and ydl_title and not meta.get("title"):
    meta["title"] = ydl_title
  return ok, meta
def convert_tiktok_hashtags_to_facebook(text: str) -> str:
  if not text:
    return ""
  replacements = {
    r"#fyp\b": "#reels",
    r"#xuhuong\b": "#facebook",
    r"#tiktok\b": "#facebook",
    r"#tik_tok\b": "#fb",
    r"#trending\b": "#viral",
    r"#fypシ\b": "#viral",
    r"#foryou\b": "#reels",
  }
  for pattern, repl in replacements.items():
    text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
  return text
class TikTokScraper:
  def __init__(self, timeout: int = 30):
    self.timeout = timeout
  def is_downloaded(self, video_id: str) -> bool:
    row = db.fetch_one("SELECT id FROM videos_cache WHERE video_id = %s AND platform = 'tiktok'", (video_id,))
    return row is not None
  def mark_downloaded(self, video_id: str, page_id: str, source_url: str, file_path: str):
    db.execute(
      "INSERT INTO videos_cache (video_id, platform, page_id, source_url, file_path) "
      "VALUES (%s, 'tiktok', %s, %s, %s) ON CONFLICT (video_id, platform) DO NOTHING",
      (video_id, page_id, source_url, file_path),
    )
  def extract_video_info(self, video_url: str, driver=None) -> Optional[Dict[str, Any]]:
    meta = resolve_tiktok_video_detail(video_url, driver=driver)
    play_urls = meta.get("play_urls") or []
    if play_urls or meta.get("video_id"):
      return {
        "video_id": meta.get("video_id") or str(int(time.time() * 1000)),
        "title": meta.get("title") or "",
        "play_url": play_urls[0] if play_urls else None,
        "hd_url": play_urls[0] if play_urls else None,
      }
    return None
  def download_to_page_pipeline(self, video_url: str, page_folder: str, page_id: str = "") -> Optional[Dict[str, Any]]:
    vid_match = re.search(r"(\d{15,22})", video_url)
    video_id = vid_match.group(1) if vid_match else str(int(time.time() * 1000))
    if vid_match and self.is_downloaded(video_id):
      return {"skipped": True, "reason": "Already downloaded", "video_id": video_id}
    target_base = Path(page_folder)
    target_base.mkdir(parents=True, exist_ok=True)
    existing_subdirs = [int(p.name) for p in target_base.iterdir() if p.is_dir() and p.name.isdigit()]
    next_idx = max(existing_subdirs) + 1 if existing_subdirs else 1
    video_subfolder = target_base / str(next_idx)
    video_subfolder.mkdir(parents=True, exist_ok=True)
    video_file_path = video_subfolder / f"{video_id}.mp4"
    ok, meta = download_tiktok_video(video_url, str(video_file_path))
    if ok:
      final_vid = meta.get("video_id") or video_id
      if final_vid != video_id:
        new_video_path = video_subfolder / f"{final_vid}.mp4"
        try:
          os.replace(str(video_file_path), str(new_video_path))
          video_file_path = new_video_path
        except Exception:
          pass
      title = meta.get("title") or ""
      caption_file_path = video_subfolder / "caption.txt"
      with open(caption_file_path, "w", encoding="utf-8") as f:
        f.write(convert_tiktok_hashtags_to_facebook(title))
      self.mark_downloaded(final_vid, page_id, meta.get("source_url") or video_url, str(video_file_path))
      return {
        "success": True,
        "video_id": final_vid,
        "folder_index": next_idx,
        "video_path": str(video_file_path),
        "caption": title,
      }
    return None
tiktok_scraper = TikTokScraper()
