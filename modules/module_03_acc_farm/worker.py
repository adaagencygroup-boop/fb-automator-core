"""
Worker Nuôi Acc Facebook (Account Farming)
Phụ trách: Cường Trần, Bình Kiến
Mô phỏng hành vi: Lướt Newsfeed, Like ngẫu nhiên, Xem Reels/Story, Giãn cách an toàn
"""
import time
import random
from typing import List, Dict, Any
from core.base_module import BaseWorker

class AccFarmWorker(BaseWorker):
    def __init__(self, accounts: List[Dict[str, Any]], actions: List[str], delay_sec: int = 5, parent=None):
        super().__init__(module_name="Nuôi Acc Facebook", parent=parent)
        self.accounts = accounts
        self.actions = actions
        self.delay_sec = delay_sec

    def run(self):
        total = len(self.accounts)
        self.log_info(f"Bắt đầu chu trình nuôi {total} tài khoản Facebook...")

        for idx, acc in enumerate(self.accounts, 1):
            if not self.is_active():
                self.log_warning("Chu trình nuôi tài khoản đã bị dừng.")
                break

            self.check_paused()

            uid = acc.get("uid")
            self.log_info(f"[{idx}/{total}] Đang nuôi tài khoản UID: {uid}...")

            for action in self.actions:
                if not self.is_active():
                    break
                self.check_paused()

                if action == "surf_newsfeed":
                    duration = random.randint(5, 12)
                    self.log_info(f"UID {uid}: Lướt Newsfeed trong {duration}s...")
                    self.msleep(duration * 1000)

                elif action == "like_random":
                    self.log_info(f"UID {uid}: Thả tim / Like ngẫu nhiên 1-2 bài viết bạn bè.")
                    self.msleep(2000)

                elif action == "watch_reels":
                    duration = random.randint(8, 15)
                    self.log_info(f"UID {uid}: Xem video Reels giải trí trong {duration}s...")
                    self.msleep(duration * 1000)

                elif action == "check_notifications":
                    self.log_info(f"UID {uid}: Mở xem bảng thông báo...")
                    self.msleep(1500)

                # Giãn cách giữa các hành động
                self.msleep(self.delay_sec * 1000)

            self.sig_progress.emit(idx, total, f"Hoàn thành nuôi UID: {uid}")

        self.log_success("Hoàn tất phiên nuôi tài khoản thành công!")
        self.sig_finished.emit(True, f"Đã nuôi xong {total} tài khoản.")
