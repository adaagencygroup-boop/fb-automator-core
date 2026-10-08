"""
AutoPostWorker - Trọng tâm Đăng bài & Điều phối Fanpage
Phụ trách: Bình Ka, Kiệt
Kế thừa & Nâng cấp từ lõi dự án mẫu:
- Xáo trộn danh sách Page ngẫu nhiên (random.shuffle)
- Hỗ trợ độc lập 3 hình thức: Đăng bài AI, Reels 3-phase, Video dài
- Hẹn giờ tự động theo khung giờ (Scheduler)
- Quản lý tiến trình thư mục cục bộ (1, 2, 3...)
- Giãn cách an toàn ngẫu nhiên chống khóa Fanpage
- Fallback thông minh khi lỗi
"""
import os
import random
import time
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

from core.base_module import BaseWorker
from core.database.connection import db
from core.facebook.fb_graph_client import fb_client
from core.ai.gemini_engine import ai_engine
from core.media.image_search import image_searcher
from config.settings import settings

class AutoPostWorker(BaseWorker):
    def __init__(self, mode: str = "ALL", parent=None):
        """
        mode: 'AI', 'REELS', 'VIDEO', hoặc 'ALL'
        """
        super().__init__(module_name="Quản Lý & Nuôi Fanpage", parent=parent)
        self.mode = mode

    def run(self):
        self.log_info(f"Khởi động tiến trình Đăng bài tự động (Chế độ: {self.mode})...")

        # 1. Lấy danh sách Fanpage đang kích hoạt
        pages = db.fetch_all("SELECT * FROM pages WHERE status = 'ACTIVE'")
        if not pages:
            self.log_warning("Không tìm thấy Fanpage nào đang ở trạng thái ACTIVE!")
            self.sig_finished.emit(False, "Không có Fanpage nào để đăng bài.")
            return

        # 2. Xáo trộn thứ tự Page mô phỏng hành vi tự nhiên
        shuffled_pages = list(pages)
        random.shuffle(shuffled_pages)
        total_pages = len(shuffled_pages)

        self.log_info(f"Đã nạp và xáo trộn {total_pages} Fanpage. Bắt đầu dây chuyền đăng bài...")

        # 3. Chạy xử lý từng Fanpage
        for idx, page in enumerate(shuffled_pages, 1):
            if not self.is_active():
                self.log_warning("Tiến trình đăng bài đã bị hủy bởi người dùng.")
                break

            self.check_paused()

            page_id = page["page_id"]
            page_name = page.get("page_name", page_id)
            token = page["access_token"]

            self.log_info(f"[{idx}/{total_pages}] Đang xử lý Fanpage: {page_name} (ID: {page_id})")

            # --- A. ĐĂNG BÀI AI NỘI DUNG MỚI ---
            if (self.mode in ["AI", "ALL"]) and page.get("auto_ai_enabled"):
                self._handle_ai_post(page)

            # --- B. ĐĂNG VIDEO REELS CỤC BỘ ---
            if (self.mode in ["REELS", "ALL"]) and page.get("auto_reels_enabled"):
                self._handle_reels_post(page)

            # --- C. ĐĂNG VIDEO DÀI CỤC BỘ ---
            if (self.mode in ["VIDEO", "ALL"]) and page.get("auto_video_enabled"):
                self._handle_long_video_post(page)

            self.sig_progress.emit(idx, total_pages, f"Xong Page: {page_name}")

            # Giãn cách an toàn ngẫu nhiên giữa các Fanpage
            if idx < total_pages:
                delay_min = settings.get("anti_spam.delay_min_seconds", 10)
                delay_max = settings.get("anti_spam.delay_max_seconds", 30)
                sleep_sec = random.randint(delay_min, delay_max)
                self.log_info(f"Nghỉ an toàn {sleep_sec}s trước khi chuyển sang Fanpage tiếp theo...")
                for _ in range(sleep_sec):
                    if not self.is_active(): break
                    self.msleep(1000)

        self.log_success("Hoàn thành toàn bộ chu kỳ đăng bài cho tất cả Fanpage!")
        self.sig_finished.emit(True, f"Đã chạy xong cho {total_pages} Fanpage.")

    def _handle_ai_post(self, page: Dict[str, Any]):
        page_id = page["page_id"]
        page_name = page.get("page_name", page_id)
        token = page["access_token"]

        try:
            self.log_info(f"-> Tạo nội dung AI cho {page_name}...")
            # Gọi Gemini AI Batching hoặc Single
            content_dict = ai_engine.generate_batch_pages([{
                "page_id": page_id,
                "page_name": page_name,
                "topic": page.get("category", "Đời sống, giải trí")
            }])
            content = content_dict.get(page_id, f"Chào ngày mới mọi người! Chúc cả nhà tràn đầy năng lượng tích cực! #facebook #{page_name}")

            # Tìm ảnh minh họa
            image_path = image_searcher.search_and_download(page.get("category", "vietnam nature landscape"))

            # Đăng lên Facebook
            res = fb_client.post_photo_or_feed(page_id, token, content, image_path)
            if res.get("success"):
                post_id = res.get("post_id")
                self.log_success(f"-> Đăng bài AI thành công lên {page_name} (ID: {post_id})")
                self._record_history(page_id, page_name, "AI_PHOTO", post_id, "SUCCESS")
            else:
                self.log_error(f"-> Đăng bài AI thất bại lên {page_name}: {res.get('error')}")
                self._record_history(page_id, page_name, "AI_PHOTO", "", "FAILED", res.get("error"))

        except Exception as e:
            self.log_error(f"Lỗi ngoại lệ đăng bài AI cho {page_name}: {e}")

    def _handle_reels_post(self, page: Dict[str, Any]):
        page_id = page["page_id"]
        page_name = page.get("page_name", page_id)
        token = page["access_token"]
        reels_base = page.get("reels_folder")

        if not reels_base or not os.path.exists(reels_base):
            return

        last_folder = page.get("last_posted_reels_folder", 0)
        next_folder_idx = last_folder + 1
        folder_path = Path(reels_base) / str(next_folder_idx)

        if not folder_path.exists():
            self.log_warning(f"Reels {page_name}: Không tìm thấy thư mục #{next_folder_idx}. Đã hết video mới!")
            return

        # Tìm file video mp4 trong thư mục
        mp4_files = list(folder_path.glob("*.mp4"))
        if not mp4_files:
            return

        video_file = mp4_files[0]
        caption_file = folder_path / "caption.txt"
        caption = ""
        if caption_file.exists():
            try:
                caption = caption_file.read_text(encoding="utf-8")
            except Exception:
                pass
        if not caption:
            caption = f"Xem video hay cùng {page_name}! #reels #trending"

        self.log_info(f"-> Đang tải lên Reels từ thư mục #{next_folder_idx}: {video_file.name}...")
        res = fb_client.upload_reel(page_id, token, str(video_file), caption)
        if res.get("success"):
            v_id = res.get("video_id")
            self.log_success(f"-> Đăng Reels thành công lên {page_name} (Video ID: {v_id})")
            db.execute("UPDATE pages SET last_posted_reels_folder = ? WHERE page_id = ?", (next_folder_idx, page_id))
            self._record_history(page_id, page_name, "REELS", v_id, "SUCCESS")
        else:
            self.log_error(f"-> Đăng Reels thất bại lên {page_name}: {res.get('error')}")
            self._record_history(page_id, page_name, "REELS", "", "FAILED", res.get("error"))

    def _handle_long_video_post(self, page: Dict[str, Any]):
        page_id = page["page_id"]
        page_name = page.get("page_name", page_id)
        token = page["access_token"]
        video_base = page.get("video_folder")

        if not video_base or not os.path.exists(video_base):
            return

        last_folder = page.get("last_posted_video_folder", 0)
        next_folder_idx = last_folder + 1
        folder_path = Path(video_base) / str(next_folder_idx)

        if not folder_path.exists():
            return

        mp4_files = list(folder_path.glob("*.mp4"))
        if not mp4_files:
            return

        video_file = mp4_files[0]
        title = f"Video đặc sắc - {page_name}"
        desc = f"Theo dõi Fanpage {page_name} để đón xem nhiều nội dung hấp dẫn hơn nhé!"

        self.log_info(f"-> Đang tải lên Video dài từ thư mục #{next_folder_idx}...")
        res = fb_client.upload_long_video(page_id, token, str(video_file), title, desc)
        if res.get("success"):
            v_id = res.get("video_id")
            self.log_success(f"-> Đăng Video dài thành công lên {page_name} (ID: {v_id})")
            db.execute("UPDATE pages SET last_posted_video_folder = ? WHERE page_id = ?", (next_folder_idx, page_id))
            self._record_history(page_id, page_name, "VIDEO", v_id, "SUCCESS")
        else:
            self.log_error(f"-> Đăng Video dài thất bại: {res.get('error')}")

    def _record_history(self, target_id: str, target_name: str, post_type: str, post_id: str, status: str, err: str = ""):
        try:
            db.execute(
                """INSERT INTO posted_history 
                (target_id, target_name, post_type, fb_post_id, status, error_message) 
                VALUES (?, ?, ?, ?, ?, ?)""",
                (target_id, target_name, post_type, post_id, status, err)
            )
        except Exception:
            pass
