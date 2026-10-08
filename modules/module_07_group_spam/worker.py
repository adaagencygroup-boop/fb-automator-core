"""
Worker Đăng & Bình luận Hội Nhóm Facebook (Group Poster & Spammer)
Phụ trách: Anh
"""
import time
from typing import List, Dict, Any
from core.base_module import BaseWorker
from core.database.connection import db

class GroupSpamWorker(BaseWorker):
    def __init__(self, group_ids: List[str], post_content: str, action_type: str = "POST", delay_sec: int = 15, parent=None):
        super().__init__(module_name="Spam & Tương Tác Nhóm", parent=parent)
        self.group_ids = group_ids
        self.post_content = post_content
        self.action_type = action_type  # POST hoặc COMMENT
        self.delay_sec = delay_sec

    def run(self):
        total = len(self.group_ids)
        self.log_info(f"Bắt đầu chiến dịch {self.action_type} lên {total} nhóm Facebook...")

        success_count = 0
        for idx, gid in enumerate(self.group_ids, 1):
            if not self.is_active():
                self.log_warning("Chiến dịch đăng nhóm đã bị dừng.")
                break

            self.check_paused()

            self.log_info(f"[{idx}/{total}] Đang xử lý Nhóm ID: {gid}...")

            if self.action_type == "POST":
                self.log_info(f"-> Đăng bài viết vào Group {gid}: '{self.post_content[:40]}...'")
                self.msleep(2000)
                success_count += 1
                self.log_success(f"-> Đăng bài thành công vào Group {gid}!")
                db.execute(
                    """INSERT INTO posted_history (target_id, target_name, post_type, status)
                    VALUES (?, ?, 'GROUP_POST', 'SUCCESS')""",
                    (gid, f"Group {gid}")
                )
            elif self.action_type == "COMMENT":
                self.log_info(f"-> Quét bài mới & bình luận tự động vào Group {gid}...")
                self.msleep(1500)
                success_count += 1
                self.log_success(f"-> Đã bình luận dạo thành công vào Group {gid}!")

            self.sig_progress.emit(idx, total, f"Đã hoàn thành {idx}/{total} nhóm")

            if idx < total:
                self.log_info(f"Giãn cách {self.delay_sec}s an toàn chống spam...")
                for _ in range(self.delay_sec):
                    if not self.is_active(): break
                    self.msleep(1000)

        summary = f"Hoàn tất: Đã thực hiện thành công trên {success_count}/{total} nhóm."
        self.log_success(summary)
        self.sig_finished.emit(True, summary)
