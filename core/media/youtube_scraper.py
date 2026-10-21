import os
import re
import shutil
from pathlib import Path
from typing import Optional, Dict, Any
import yt_dlp
from core.database.connection import db
def get_ffmpeg_path() -> Optional[str]:
  exe = shutil.which("ffmpeg")
  if exe:
    return exe
  try:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()
  except Exception:
    pass
  return None
def convert_youtube_hashtags_to_facebook(text: str) -> str:
  if not text:
    return ""
  replacements = {
    r'#shorts\b': '#reels',
    r'#shortsvideo\b': '#reels',
    r'#youtube\b': '#facebook',
    r'#ytshorts\b': '#reels'
  }
  for pattern, repl in replacements.items():
    text = re.sub(pattern, repl, text, flags=re.IGNORECASE)
  return text
def build_youtube_ydl_opts(outtmpl: str, cookie_browser: Optional[str] = None, cookie_file: Optional[str] = None, max_downloads: Optional[int] = None) -> Dict[str, Any]:
  ffmpeg_exe = get_ffmpeg_path()
  opts = {
    "outtmpl": outtmpl,
    "quiet": True,
    "no_warnings": True,
    "extractor_args": {
      "youtube": {
        "player_client": ["ios", "android", "mweb", "web"],
        "player_skip": ["js"],
      }
    },
    "http_headers": {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      "Sec-Fetch-Mode": "navigate",
    },
    "socket_timeout": 30,
    "retries": 15,
    "fragment_retries": 15,
    "retry_sleep": "fragment:exp=1:20",
  }
  if ffmpeg_exe:
    opts["ffmpeg_location"] = ffmpeg_exe
    opts["format"] = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best"
    opts["merge_output_format"] = "mp4"
  else:
    opts["format"] = "best[ext=mp4]/best"
  if cookie_file and os.path.exists(cookie_file):
    opts["cookiefile"] = cookie_file
  elif cookie_browser and "không dùng" not in cookie_browser.lower():
    opts["cookiesfrombrowser"] = (cookie_browser,)
  return opts
class YouTubeScraper:
  def __init__(self, browser_cookies: Optional[str] = None, cookie_file: Optional[str] = None):
    self.browser_cookies = browser_cookies
    self.cookie_file = cookie_file
  def is_downloaded(self, video_id: str) -> bool:
    row = db.fetch_one("SELECT id FROM videos_cache WHERE video_id = %s AND platform = 'youtube'", (video_id,))
    return row is not None
  def mark_downloaded(self, video_id: str, page_id: str, source_url: str, file_path: str):
    db.execute(
      "INSERT INTO videos_cache (video_id, platform, page_id, source_url, file_path) VALUES (%s, 'youtube', %s, %s, %s) ON CONFLICT (video_id, platform) DO NOTHING",
      (video_id, page_id, source_url, file_path)
    )
  def download_to_page_pipeline(self, url: str, page_folder: str, page_id: str = "") -> Optional[Dict[str, Any]]:
    target_base = Path(page_folder)
    target_base.mkdir(parents=True, exist_ok=True)
    existing_subdirs = [int(p.name) for p in target_base.iterdir() if p.is_dir() and p.name.isdigit()]
    next_idx = max(existing_subdirs) + 1 if existing_subdirs else 1
    video_subfolder = target_base / str(next_idx)
    video_subfolder.mkdir(parents=True, exist_ok=True)
    outtmpl = str(video_subfolder / "%(id)s.%(ext)s")
    ydl_opts = build_youtube_ydl_opts(outtmpl=outtmpl, cookie_browser=self.browser_cookies, cookie_file=self.cookie_file)
    try:
      with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        if not info:
          return None
        video_id = info.get("id")
        raw_title = info.get("title", "")
        clean_caption = convert_youtube_hashtags_to_facebook(raw_title)
        ext = info.get("ext", "mp4")
        video_path = video_subfolder / f"{video_id}.{ext}"
        caption_path = video_subfolder / "caption.txt"
        with open(caption_path, "w", encoding="utf-8") as f:
          f.write(clean_caption)
        self.mark_downloaded(video_id, page_id, url, str(video_path))
        return {
          "success": True,
          "video_id": video_id,
          "folder_index": next_idx,
          "video_path": str(video_path),
          "caption": clean_caption
        }
    except Exception as e:
      return {"success": False, "error": str(e)}
youtube_scraper = YouTubeScraper()
