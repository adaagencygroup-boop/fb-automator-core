"""
YouTube Shorts & Video Scraper (yt-dlp based)
Hỗ trợ:
- Tải Shorts & Video theo URL, Kênh hoặc Từ khóa tìm kiếm
- Tích hợp Cookies từ trình duyệt (Chrome, Edge, Firefox) chống bot detection
- Tổ chức theo cấu trúc thư mục 1, 2, 3... tương thích dây chuyền đăng của Module 5
"""
import os
import yt_dlp
from pathlib import Path
from typing import Optional, Dict, Any
from core.database.connection import db

class YouTubeScraper:
    def __init__(self, browser_cookies: Optional[str] = None):
        self.browser_cookies = browser_cookies

    def is_downloaded(self, video_id: str) -> bool:
        row = db.fetch_one("SELECT id FROM videos_cache WHERE video_id = ? AND platform = 'youtube'", (video_id,))
        return row is not None

    def mark_downloaded(self, video_id: str, page_id: str, source_url: str, file_path: str):
        db.execute(
            "INSERT OR IGNORE INTO videos_cache (video_id, platform, page_id, source_url, file_path) VALUES (?, 'youtube', ?, ?, ?)",
            (video_id, page_id, source_url, file_path)
        )

    def download_to_page_pipeline(self, url: str, page_folder: str, page_id: str = "") -> Optional[Dict[str, Any]]:
        target_base = Path(page_folder)
        target_base.mkdir(parents=True, exist_ok=True)

        existing_subdirs = [int(p.name) for p in target_base.iterdir() if p.is_dir() and p.name.isdigit()]
        next_idx = max(existing_subdirs) + 1 if existing_subdirs else 1
        video_subfolder = target_base / str(next_idx)
        video_subfolder.mkdir(parents=True, exist_ok=True)

        ydl_opts = {
            "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "outtmpl": str(video_subfolder / "%(id)s.%(ext)s"),
            "quiet": True,
            "no_warnings": True
        }

        if self.browser_cookies:
            ydl_opts["cookiesfrombrowser"] = (self.browser_cookies,)

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if not info:
                    return None
                
                video_id = info.get("id")
                title = info.get("title", "")
                ext = info.get("ext", "mp4")
                video_path = video_subfolder / f"{video_id}.{ext}"

                # Ghi caption
                caption_path = video_subfolder / "caption.txt"
                with open(caption_path, "w", encoding="utf-8") as f:
                    f.write(title)

                self.mark_downloaded(video_id, page_id, url, str(video_path))

                return {
                    "success": True,
                    "video_id": video_id,
                    "folder_index": next_idx,
                    "video_path": str(video_path),
                    "caption": title
                }
        except Exception as e:
            return {"success": False, "error": str(e)}

youtube_scraper = YouTubeScraper()
