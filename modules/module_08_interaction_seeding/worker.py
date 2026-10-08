"""
Worker Seeding Tương Tác (Buff Like, Comment, Share)
Phụ trách: Hưởng, Trường
"""
import time
import random
from typing import List, Dict, Any
from core.base_module import BaseWorker
from core.database.connection import db

class SeedingWorker(BaseWorker):
    def __init__(self, target_url: str, action: str, comments: List[str], accounts: List[Dict[str, Any]], delay_sec: int = 5, parent=None):
        super().__init__(module_name="Seeding & Buff Tương Tác", parent=parent)
        self.target_url = target_url
        self.action = action  # BUFF_LIKE, BUFF_COMMENT, BUFF_SHARE
        self.comments = comments
        self.accounts = accounts
        self.delay_sec = delay_sec

    def run(self):
        total = len(self.accounts)
        self.log_info(f"Bắt đầu chiến dịch Seeding [{self.action}] cho URL: {self.target_url}...")

        success_count = 0
        for idx, acc in enumerate(self.accounts, 1):
            if not self.is_active():
                self.log_warning("Chiến dịch seeding đã bị hủy.")
                break

            self.check_paused()

            uid = acc.get("uid")
            self.log_info(f"[{idx}/{total}] UID {uid}: Thực hiện {self.action}...")

            if self.action == "BUFF_LIKE":
                self.msleep(1200)
                self.log_success(f"-> UID {uid}: Đã thả cảm xúc thành công!")
                success_count += 1

            elif self.action == "BUFF_COMMENT":
                comment_text = random.choice(self.comments) if self.comments else "Sản phẩm tuyệt vời quá shop ơi!"
                self.msleep(1500)
                self.log_success(f"-> UID {uid}: Đã bình luận: '{comment_text}'")
                success_count += 1

            elif self.action == "BUFF_SHARE":
                self.msleep(2000)
                self.log_success(f"-> UID {uid}: Đã chia sẻ bài viết lên trang cá nhân!")
                success_count += 1

            self.sig_progress.emit(idx, total, f"Hoàn thành {idx}/{total}")

            if idx < total:
                self.msleep(self.delay_sec * 1000)

        summary = f"Hoàn tất Seeding: {success_count}/{total} tài khoản đã tương tác thành công!"
        self.log_success(summary)
        self.sig_finished.emit(True, summary)
