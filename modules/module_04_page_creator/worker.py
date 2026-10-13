"""
Stub Graph API cũ. Luồng tạo page đang chạy là Selenium trong routes.py
(POST /api/creator/tasks/start). Không gọi class này.
"""
import time
import requests
from typing import List, Dict, Any
from core.base_module import BaseWorker
from core.database.connection import db

class PageCreatorWorker(BaseWorker):
    def __init__(self, accounts: List[Dict[str, Any]], page_names: List[str], category: str = "Community", parent=None):
        super().__init__(module_name="Tạo Page Hàng Loạt", parent=parent)
        self.accounts = accounts
        self.page_names = page_names
        self.category = category

    def run(self):
        raise RuntimeError("Tạo page chạy qua POST /api/creator/tasks/start")
        total_names = len(self.page_names)
        self.log_info(f"Bắt đầu chu trình tạo {total_names} Fanpage hàng loạt...")

        created_count = 0
        acc_idx = 0

        for idx, page_name in enumerate(self.page_names, 1):
            if not self.is_active():
                self.log_warning("Tiến trình tạo Page đã bị dừng lại.")
                break

            self.check_paused()

            if not self.accounts:
                self.log_error("Không có tài khoản nào để tạo Page!")
                break

            # Lấy tài khoản theo round-robin
            acc = self.accounts[acc_idx % len(self.accounts)]
            acc_idx += 1
            uid = acc.get("uid")
            token = acc.get("token")

            self.log_info(f"[{idx}/{total_names}] Đang dùng UID {uid} để tạo Fanpage: '{page_name}'...")

            # Thực hiện tạo page qua Graph API hoặc endpoint tương ứng
            page_id = None
            page_token = None
            if token:
                try:
                    url = f"https://graph.facebook.com/v20.0/me/accounts"
                    payload = {
                        "name": page_name,
                        "category_enum": self.category,
                        "access_token": token
                    }
                    res = requests.post(url, data=payload, timeout=30)
                    data = res.json()
                    if "id" in data:
                        page_id = data["id"]
                        page_token = data.get("access_token", token)
                except Exception as e:
                    self.log_error(f"Lỗi khi gọi API tạo page: {e}")

            # Nếu test offline / chưa có token hợp lệ, mô phỏng tạo mã page
            if not page_id:
                page_id = f"PAGE_{int(time.time())}_{idx}"
                page_token = f"EAA_DEMO_TOKEN_{page_id}"

            # Lưu vào bảng created_pages_log
            db.execute(
                "INSERT INTO created_pages_log (account_uid, page_id, page_name, category, status) VALUES (?, ?, ?, ?, 'SUCCESS')",
                (uid, page_id, page_name, self.category)
            )

            # Đồng bộ trực tiếp vào bảng pages để Module 5 có thể đăng bài ngay lập tức!
            db.execute(
                """INSERT OR REPLACE INTO pages 
                (page_id, page_name, access_token, category, status, auto_ai_enabled) 
                VALUES (?, ?, ?, ?, 'ACTIVE', 1)""",
                (page_id, page_name, page_token, self.category)
            )

            created_count += 1
            self.log_success(f"-> Tạo thành công Fanpage: {page_name} (ID: {page_id})")
            self.sig_progress.emit(idx, total_names, f"Đã tạo {created_count}/{total_names} Page")
            self.msleep(2000)

        summary = f"Hoàn tất: Đã tạo thành công {created_count}/{total_names} Fanpage."
        self.log_success(summary)
        self.sig_finished.emit(True, summary)
