"""
TikTok Video Scraper & Downloader
Hỗ trợ:
- Tải không logo qua TikWM API & fallback
- Lưu caption thành file .txt đi kèm video
- Chống tải trùng lặp qua bảng videos_cache
- Tự động đánh số thư mục 1, 2, 3... tương thích dây chuyền đăng Reels của Module 5
"""
import os
import re
import requests
from pathlib import Path
from typing import Optional, Dict, Any
from core.database.connection import db

class TikTokScraper:
    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })

    def is_downloaded(self, video_id: str) -> bool:
        """Kiểm tra video_id đã từng được tải chưa"""
        row = db.fetch_one("SELECT id FROM videos_cache WHERE video_id = ? AND platform = 'tiktok'", (video_id,))
        return row is not None

    def mark_downloaded(self, video_id: str, page_id: str, source_url: str, file_path: str):
        db.execute(
            "INSERT OR IGNORE INTO videos_cache (video_id, platform, page_id, source_url, file_path) VALUES (?, 'tiktok', ?, ?, ?)",
            (video_id, page_id, source_url, file_path)
        )

    def extract_video_info_tikwm(self, video_url: str) -> Optional[Dict[str, Any]]:
        """Lấy link tải trực tiếp và caption qua TikWM API"""
        api_url = "https://www.tikwm.com/api/"
        try:
            res = self.session.post(api_url, data={"url": video_url, "count": 12, "cursor": 0, "web": 1, "hd": 1}, timeout=self.timeout)
            if res.status_code == 200:
                data = res.json()
                if data.get("code") == 0:
                    d = data.get("data", {})
                    return {
                        "video_id": d.get("id"),
                        "title": d.get("title", ""),
                        "play_url": d.get("play") or d.get("wmplay"),
                        "hd_url": d.get("hdplay")
                    }
        except Exception:
            pass
        return None

    def download_to_page_pipeline(self, video_url: str, page_folder: str, page_id: str = "") -> Optional[Dict[str, Any]]:
        """
        Tải video về thư mục chuẩn cho Page (ví dụ: folder/1/video.mp4 và folder/1/caption.txt)
        """
        info = self.extract_video_info_tikwm(video_url)
        if not info or not info.get("play_url"):
            return None

        video_id = str(info["video_id"])
        if self.is_downloaded(video_id):
            return {"skipped": True, "reason": "Already downloaded", "video_id": video_id}

        target_base = Path(page_folder)
        target_base.mkdir(parents=True, exist_ok=True)

        # Tìm số thứ tự thư mục tiếp theo (1, 2, 3...)
        existing_subdirs = [int(p.name) for p in target_base.iterdir() if p.is_dir() and p.name.isdigit()]
        next_idx = max(existing_subdirs) + 1 if existing_subdirs else 1
        video_subfolder = target_base / str(next_idx)
        video_subfolder.mkdir(parents=True, exist_ok=True)

        video_file_path = video_subfolder / f"{video_id}.mp4"
        caption_file_path = video_subfolder / "caption.txt"

        # Tải file mp4
        download_url = info.get("hd_url") or info.get("play_url")
        res = self.session.get(download_url, stream=True, timeout=60)
        if res.status_code == 200:
            with open(video_file_path, "wb") as f:
                for chunk in res.iter_content(chunk_size=1024 * 64):
                    f.write(chunk)

            # Lưu caption
            with open(caption_file_path, "w", encoding="utf-8") as f:
                f.write(info.get("title", ""))

            self.mark_downloaded(video_id, page_id, video_url, str(video_file_path))

            return {
                "success": True,
                "video_id": video_id,
                "folder_index": next_idx,
                "video_path": str(video_file_path),
                "caption": info.get("title", "")
            }

        return None

tiktok_scraper = TikTokScraper()
