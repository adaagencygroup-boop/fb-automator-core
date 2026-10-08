"""
Worker kiểm tra Live / Die tài khoản Facebook
Phụ trách: Mạnh Cường
"""
import requests
from typing import List, Dict, Any
from core.base_module import BaseWorker
from core.database.connection import db

class CheckLiveAccountWorker(BaseWorker):
    def __init__(self, accounts: List[Dict[str, Any]], parent=None):
        super().__init__(module_name="Quản Lý Tài Khoản", parent=parent)
        self.accounts = accounts

    def run(self):
        total = len(self.accounts)
        self.log_info(f"Bắt đầu kiểm tra trạng thái {total} tài khoản Facebook...")

        live_count = 0
        die_count = 0

        for idx, acc in enumerate(self.accounts, 1):
            if not self.is_active():
                self.log_warning("Tiến trình kiểm tra tài khoản đã bị hủy bởi người dùng.")
                break

            self.check_paused()

            uid = acc.get("uid")
            acc_id = acc.get("id")
            token = acc.get("token")

            status = "LIVE"
            # 1. Kiểm tra qua UID Avatar endpoint không cần login
            try:
                check_url = f"https://graph.facebook.com/{uid}/picture?type=normal"
                res = requests.get(check_url, timeout=10, allow_redirects=False)
                if res.status_code == 302:
                    location = res.headers.get("location", "")
                    if "static.xx.fbcdn.net" in location and "profile_pic" not in location:
                        status = "DIE"
                    else:
                        status = "LIVE"
                else:
                    status = "DIE"
            except Exception:
                status = "UNKNOWN"

            if status == "LIVE":
                live_count += 1
            elif status == "DIE":
                die_count += 1

            # Cập nhật Database
            db.execute("UPDATE accounts SET status = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?", (status, acc_id))

            self.sig_progress.emit(idx, total, f"Đã kiểm tra UID: {uid} -> [{status}]")
            self.msleep(150)  # Sleep nhẹ để tránh spam

        summary = f"Hoàn tất kiểm tra: {live_count} LIVE, {die_count} DIE trên tổng số {total} tài khoản."
        self.log_success(summary)
        self.sig_finished.emit(True, summary)
