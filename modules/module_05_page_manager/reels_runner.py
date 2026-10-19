# -*- coding: utf-8 -*-
"""
File: modules/module_05_page_manager/reels_runner.py
Quản lý background worker thực thi đăng video Reels (Immediate & Scheduler Mode),
kèm hàng đợi SSE cho real-time console log.
"""
import os
import re
import time
import random
import threading
import datetime
from typing import Dict, Any, List, Optional
from collections import deque

from core.database.connection import db
from modules.module_05_page_manager.facebook_client import upload_reel_to_facebook
from modules.module_05_page_manager.reels_service import get_next_reel_video

from .meta_config import GRAPH_API_VERSION as FB_GRAPH_VERSION
from modules.module_02_account_manager.context import owner_scope, owner_context

class ReelsTaskRunner:
    _instances = {}
    _lock = threading.Lock()

    def __new__(cls, owner=None):
        owner = owner if owner is not None else owner_context.get()
        with cls._lock:
            if owner not in cls._instances:
                instance = super().__new__(cls)
                instance.owner = owner
                instance._init_runner()
                cls._instances[owner] = instance
            return cls._instances[owner]

    def _init_runner(self):
        self._start_lock = threading.Lock()
        self.is_running = False
        self.status = "IDLE"  # IDLE, RUNNING, STOPPED, COMPLETED
        self.thread: Optional[threading.Thread] = None
        self.config: Dict[str, Any] = {}
        self.stats = {
            "total_pages": 0,
            "processed": 0,
            "success": 0,
            "failed": 0,
            "current_page": ""
        }
        self.logs: deque = deque(maxlen=500)
        self._listeners: List[Any] = []
        self._listeners_lock = threading.Lock()

    def subscribe(self, callback):
        """Đăng ký listener để nhận log thời gian thực qua SSE."""
        with self._listeners_lock:
            self._listeners.append(callback)

    def unsubscribe(self, callback):
        """Hủy đăng ký listener."""
        with self._listeners_lock:
            if callback in self._listeners:
                self._listeners.remove(callback)

    def log(self, message: str, level: str = "INFO"):
        """Ghi log có timestamp và broadcast ra toàn bộ listeners SSE."""
        now_str = datetime.datetime.now().strftime("%H:%M:%S")
        log_entry = {
            "timestamp": now_str,
            "level": level,
            "message": message
        }
        self.logs.append(log_entry)

        with self._listeners_lock:
            dead_listeners = []
            for cb in self._listeners:
                try:
                    cb(log_entry)
                except Exception:
                    dead_listeners.append(cb)
            for d in dead_listeners:
                if d in self._listeners:
                    self._listeners.remove(d)

    def clear_logs(self):
        """Xóa toàn bộ console log hiện có."""
        self.logs.clear()

    def get_status(self) -> Dict[str, Any]:
        """Lấy trạng thái hiện tại của runner và tóm tắt tiến trình."""
        return {
            "is_running": self.is_running,
            "status": self.status,
            "stats": self.stats,
            "recent_logs": list(self.logs)[-50:]
        }

    def start_job(self, config: Dict[str, Any]) -> Dict[str, Any]:
        with self._start_lock:
            return self._start_job(config)

    def _start_job(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Bắt đầu tiến trình đăng Reels trong luồng nền."""
        if not self.owner:
            return {"success": False, "error": "Thiếu owner cho tác vụ Reels."}
        if self.is_running or (self.thread and self.thread.is_alive()):
            return {"success": False, "error": "Một tiến trình đang chạy dở. Vui lòng dừng hoặc chờ kết thúc."}

        pages_config = config.get("pages_config", [])
        root_dir = config.get("root_dir", "")

        if not pages_config:
            return {"success": False, "error": "Chưa chọn Fanpage nào để đăng Reels."}
        if not root_dir or not os.path.exists(root_dir):
            return {"success": False, "error": "Thư mục gốc chứa video không tồn tại."}

        schedule_enabled = bool(config.get("schedule_enabled", False))
        schedule_times = config.get("schedule_times", [])
        if schedule_enabled and not schedule_times:
            return {"success": False, "error": "Chế độ hẹn giờ đang bật nhưng chưa có khung giờ đăng nào."}

        self.config = config
        self.is_running = True
        self.status = "RUNNING"
        self.stats = {
            "total_pages": len(pages_config),
            "processed": 0,
            "success": 0,
            "failed": 0,
            "current_page": ""
        }

        self.log(f">>> BẮT ĐẦU TIẾN TRÌNH ĐĂNG VIDEO REELS ({len(pages_config)} Fanpage đã chọn) <<<", "INFO")
        self.log(f"Thư mục gốc video: {root_dir}", "INFO")

        def run_owned():
            with owner_scope(self.owner):
                self._run_loop()
        self.thread = threading.Thread(target=run_owned, daemon=True)
        self.thread.start()
        return {"success": True, "message": "Đã kích hoạt luồng đăng Reels thành công."}

    def stop_job(self) -> Dict[str, Any]:
        """Yêu cầu dừng tiến trình đăng an toàn."""
        if not self.is_running:
            return {"success": False, "message": "Không có tiến trình nào đang chạy."}

        self.is_running = False
        self.status = "STOPPED"
        self.log("[STOPPED] Người dùng đã yêu cầu dừng luồng đăng bài.", "WARNING")
        return {"success": True, "message": "Đang dừng tiến trình..."}

    def _run_loop(self):
        """Vòng lặp chính xử lý hoặc lặp theo lịch hẹn giờ."""
        try:
            pages = self.config.get("pages_config", [])
            root_dir = self.config.get("root_dir", "")
            sleep_min = int(self.config.get("sleep_min", 600))
            sleep_max = int(self.config.get("sleep_max", 900))
            schedule_enabled = bool(self.config.get("schedule_enabled", False))
            schedule_times = self.config.get("schedule_times", [])

            if not schedule_enabled:
                # Chế độ chạy 1 lượt ngay lập tức (Immediate Mode)
                self.log("Chế độ: Đăng ngay lập tức 1 lượt cho các Page đã chọn.", "INFO")
                self._execute_reels_phase(pages, root_dir, sleep_min, sleep_max)
                if self.is_running:
                    self.status = "COMPLETED"
                    self.log(f"[FINISHED] Hoàn tất toàn bộ lượt đăng. Thành công: {self.stats['success']}/{len(pages)}.", "SUCCESS")
                self.is_running = False
            else:
                # Chế độ chạy theo lịch hẹn giờ (Scheduler Mode)
                self.log(f"Chế độ: Hẹn giờ đăng hàng ngày theo các khung giờ: {', '.join(schedule_times)}", "INFO")
                executed_slots = set()
                last_checked_date = datetime.date.today()

                while self.is_running:
                    now = datetime.datetime.now()
                    current_date = now.date()
                    if current_date != last_checked_date:
                        executed_slots.clear()
                        last_checked_date = current_date

                    current_time_str = now.strftime("%H:%M")
                    if current_time_str in schedule_times and current_time_str not in executed_slots:
                        self.log(f"\n[SCHEDULER] >>> Đến khung giờ đăng Reels hẹn trước: {current_time_str} <<<", "INFO")
                        executed_slots.add(current_time_str)
                        self._execute_reels_phase(pages, root_dir, sleep_min, sleep_max)
                        self.log(f"[SCHEDULER] Kết thúc lượt đăng lúc {current_time_str}. Tiếp tục chờ khung giờ tiếp theo...", "INFO")

                    # Sleep 10s kiểm tra dừng
                    for _ in range(10):
                        if not self.is_running:
                            break
                        time.sleep(1)

        except Exception as e:
            self.status = "ERROR"
            self.log(f"[EXCEPTION] Lỗi nghiêm trọng trong luồng chạy Reels: {e}", "ERROR")
        finally:
            self.is_running = False
            if self.status == "RUNNING":
                self.status = "COMPLETED"

    def _execute_reels_phase(self, pages: List[Dict[str, Any]], root_dir: str, sleep_min: int, sleep_max: int):
        """Thực thi đăng 1 video Reels cho mỗi Page trong danh sách."""
        for idx, page in enumerate(pages):
            if not self.is_running:
                self.log("[STOPPED] Luồng dừng trước khi xử lý các Page tiếp theo.", "WARNING")
                break

            p_id = str(page.get("page_id") or page.get("id"))
            p_name = page.get("page_name") or page.get("name") or f"Page {p_id}"
            stored = db.fetch_one(
                "SELECT page_name, access_token, account_uid FROM pages WHERE user_id = %s AND page_id = %s",
                (self.owner, p_id),
            )
            if not stored:
                self.log(f"Page {p_id} không còn thuộc owner của tác vụ.", "ERROR")
                self.stats["failed"] += 1
                self.stats["processed"] += 1
                continue
            p_name = stored["page_name"]
            p_token = (stored.get("access_token") or "").strip()
            folder_name = page.get("folder_name", "").strip()
            acc_uid = stored.get("account_uid")

            self.stats["current_page"] = p_name
            self.log(f"\n[{idx + 1}/{len(pages)}] Bắt đầu xử lý Reels cho Page: {p_name} (ID: {p_id})", "INFO")

            if not p_token:
                self.log(f"[ERROR] Fanpage '{p_name}' chưa có Access Token. Bỏ qua.", "ERROR")
                self.stats["failed"] += 1
                self.stats["processed"] += 1
                continue

            page_folder_path = os.path.join(root_dir, folder_name) if folder_name else os.path.join(root_dir, p_name)
            if not os.path.exists(page_folder_path):
                self.log(f"[WARNING] Thư mục nội dung không tồn tại: {page_folder_path}. Bỏ qua.", "WARNING")
                self.stats["failed"] += 1
                self.stats["processed"] += 1
                continue

            # 1. Lấy tiến trình đăng trước đó từ DB
            last_index = 0
            try:
                prog = db.fetch_one(
                    "SELECT last_folder_index FROM posting_progress WHERE user_id = ? AND page_id = ? AND post_type = 'REEL'",
                    (self.owner, p_id,)
                )
                if prog and prog.get("last_folder_index"):
                    last_index = int(prog["last_folder_index"])
            except Exception as ex:
                self.log(f"[DB Warning] Không đọc được tiến trình cũ ({ex}), tìm từ video đầu tiên.", "WARNING")

            # 2. Tìm video Reels tiếp theo
            video_post = get_next_reel_video(p_id, page_folder_path, last_index)
            if not video_post:
                self.log(
                    f"[WARNING] Không tìm thấy video Reels mới (Tiến trình đã đăng đến video số: {last_index}) cho: {p_name}. Vui lòng bổ sung thư mục/video từ số {last_index + 1} trở lên.",
                    "WARNING"
                )
                self.stats["failed"] += 1
                self.stats["processed"] += 1
                continue

            video_path = video_post["video_path"]
            caption = video_post["caption"]
            folder_num = video_post["folder_number"]
            video_id = video_post["video_id"]

            self.log(f"[*] Khớp video: {os.path.basename(video_path)} (Thứ tự: {folder_num})", "INFO")
            if caption:
                self.log(f"[*] Caption: {caption[:120]}...", "INFO")

            # 3. Upload lên Facebook Graph API
            success = False
            error_detail = ""
            try:
                def local_logger(msg):
                    msg = str(msg).replace(p_token, "[REDACTED]")
                    msg = re.sub(r"(?i)(access_token|client_secret)=([^&\s]+)", r"\1=[REDACTED]", msg)
                    self.log(msg, "INFO" if "[SUCCESS]" not in msg and "[ERROR]" not in msg else ("SUCCESS" if "[SUCCESS]" in msg else "ERROR"))

                success = upload_reel_to_facebook(
                    page_name=p_name,
                    page_id=p_id,
                    page_token=p_token,
                    video_path=video_path,
                    message=caption,
                    fb_version=FB_GRAPH_VERSION,
                    log_func=local_logger,
                    save_posted_func=lambda pn, pid: None
                )
            except Exception as e:
                error_detail = "Không thể đăng video qua Facebook Graph API."
                self.log(f"[ERROR] {p_name}: {error_detail}", "ERROR")

            # 4. Cập nhật kết quả vào database
            self.stats["processed"] += 1
            if success:
                reel_url = str(success) if isinstance(success, str) and success.startswith("http") else f"https://www.facebook.com/reel/{video_id}"
                self.stats["success"] += 1
                self._save_progress(p_id, folder_num, video_id)
                self._save_history(p_id, acc_uid, caption, video_path, "SUCCESS", None, reel_url=reel_url)
            else:
                self.stats["failed"] += 1
                self._save_history(p_id, acc_uid, caption, video_path, "FAILED", error_detail or "Facebook API error")

            # 5. Nghỉ ngẫu nhiên giữa các Page nếu còn Page tiếp theo
            if idx < len(pages) - 1 and self.is_running:
                delay = random.randint(min(sleep_min, sleep_max), max(sleep_min, sleep_max))
                self.log(f"[*] Nghỉ giãn cách {delay} giây trước khi chuyển sang Page kế tiếp...", "INFO")
                for _ in range(delay):
                    if not self.is_running:
                        break
                    time.sleep(1)

        self.stats["current_page"] = ""

    def _save_progress(self, page_id: str, folder_number: int, video_id: str):
        """Lưu tiến trình video đã đăng vào bảng posting_progress."""
        try:
            db.execute(
                """
                INSERT INTO posting_progress (user_id, page_id, post_type, last_folder_index, last_video_id, updated_at)
                VALUES (?, ?, 'REEL', ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id, page_id, post_type)
                DO UPDATE SET last_folder_index = EXCLUDED.last_folder_index,
                              last_video_id = EXCLUDED.last_video_id,
                              updated_at = CURRENT_TIMESTAMP
                """,
                (self.owner, page_id, folder_number, video_id)
            )
        except Exception as e:
            self.log("[DB Warning] Không thể cập nhật tiến trình vào DB.", "WARNING")

    def _save_history(self, page_id: str, account_uid: str, caption: str, media_path: str, status: str, error_msg: Optional[str], reel_url: Optional[str] = None):
        """Lưu kết quả đăng bài vào bảng posting_history."""
        try:
            db.execute(
                """
                INSERT INTO posting_history (user_id, page_id, account_uid, post_type, caption, media_path, status, error_message, post_url, posted_at)
                VALUES (?, ?, ?, 'REEL', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (self.owner, page_id, account_uid or None, caption or "", media_path, status, error_msg, reel_url)
            )
        except Exception as e:
            self.log("[DB Warning] Không thể ghi lịch sử bài đăng.", "WARNING")


reels_runner = ReelsTaskRunner()
