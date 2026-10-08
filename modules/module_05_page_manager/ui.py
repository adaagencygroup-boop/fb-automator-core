"""
Module 5: Quản lý Fanpage & Auto Post
Phụ trách: Bình Ka, Kiệt
Kế thừa & tích hợp trọn vẹn sức mạnh của dự án Facebook Auto Poster AI Pro:
- Quản lý danh sách Fanpage & Token vĩnh viễn
- Bật/tắt riêng biệt 3 hình thức: Bài viết AI, Reels, Video dài
- Gán thư mục Reels & Video dài cục bộ (tiến trình 1, 2, 3...)
- Tích hợp tải Video TikTok & YouTube Shorts trực tiếp vào pipeline
"""
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, 
    QTableWidget, QTableWidgetItem, QHeaderView, QCheckBox, 
    QFileDialog, QInputDialog, QMessageBox, QTabWidget, QLineEdit, QFrame
)
from core.base_module import BaseModuleTab
from core.database.connection import db
from core.facebook.fb_graph_client import fb_client
from core.media.tiktok_scraper import tiktok_scraper
from core.media.youtube_scraper import youtube_scraper
from modules.module_05_page_manager.worker import AutoPostWorker

class PageManagerTab(BaseModuleTab):
    def __init__(self, parent=None):
        super().__init__(
            module_id="module_05_page_manager",
            module_title="Quản Lý Fanpage & Auto Post (Lõi Hệ Thống)",
            author="Bình Ka, Kiệt",
            parent=parent
        )

    def init_ui(self):
        # Action Toolbar trên Header
        self.btn_run_all = QPushButton("🚀 Bắt Đầu Đăng Bài (Tất Cả)")
        self.btn_run_all.setProperty("class", "btn-success")
        self.btn_run_all.clicked.connect(lambda: self.start_posting("ALL"))
        self.header_actions_layout.addWidget(self.btn_run_all)

        self.btn_run_ai = QPushButton("🤖 Đăng Bài AI")
        self.btn_run_ai.setProperty("class", "btn-primary")
        self.btn_run_ai.clicked.connect(lambda: self.start_posting("AI"))
        self.header_actions_layout.addWidget(self.btn_run_ai)

        self.btn_run_reels = QPushButton("🎬 Đăng Reels")
        self.btn_run_reels.setProperty("class", "btn-warning")
        self.btn_run_reels.clicked.connect(lambda: self.start_posting("REELS"))
        self.header_actions_layout.addWidget(self.btn_run_reels)

        self.btn_stop = QPushButton("⏹ Dừng")
        self.btn_stop.setProperty("class", "btn-danger")
        self.btn_stop.setEnabled(False)
        self.btn_stop.clicked.connect(self.stop_posting)
        self.header_actions_layout.addWidget(self.btn_stop)

        # Tab Widget con chia thành: 1. Quản lý Page, 2. Cào Video TikTok/YouTube
        sub_tabs = QTabWidget()

        # --- SUB TAB 1: DANH SÁCH FANPAGE ---
        tab_pages = QWidget()
        layout_pages = QVBoxLayout(tab_pages)

        # Thanh nút tiện ích
        bar_util = QHBoxLayout()
        btn_fetch_tokens = QPushButton("🔑 Nạp Page Từ User Token")
        btn_fetch_tokens.clicked.connect(self.fetch_pages_from_user_token)
        bar_util.addWidget(btn_fetch_tokens)

        btn_assign_reels = QPushButton("📁 Gán Thư Mục Reels")
        btn_assign_reels.clicked.connect(self.assign_reels_folder)
        bar_util.addWidget(btn_assign_reels)

        btn_assign_video = QPushButton("📹 Gán Thư Mục Video")
        btn_assign_video.clicked.connect(self.assign_video_folder)
        bar_util.addWidget(btn_assign_video)

        bar_util.addStretch()
        layout_pages.addLayout(bar_util)

        # Bảng danh sách Pages
        self.tbl_pages = QTableWidget(0, 7)
        self.tbl_pages.setHorizontalHeaderLabels([
            "Page ID", "Tên Page", "AI Post", "Reels", "Tiến Trình Reels", "Video Dài", "Trạng Thái"
        ])
        self.tbl_pages.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        layout_pages.addWidget(self.tbl_pages)

        sub_tabs.addTab(tab_pages, "📋 Danh Sách Fanpage")

        # --- SUB TAB 2: CÀO & TẢI VIDEO (TIKTOK & YOUTUBE) ---
        tab_scraper = QWidget()
        layout_scraper = QVBoxLayout(tab_scraper)

        card_scrap = QFrame()
        card_scrap.setProperty("class", "card")
        layout_card = QVBoxLayout(card_scrap)

        layout_card.addWidget(QLabel("📥 CÀO VIDEO TỰ ĐỘNG ĐƯA VÀO DÂY CHUYỀN REELS CỦA PAGE"))
        
        row_scrap_url = QHBoxLayout()
        row_scrap_url.addWidget(QLabel("Link TikTok / YouTube:"))
        self.txt_video_url = QLineEdit()
        self.txt_video_url.setPlaceholderText("https://www.tiktok.com/@user/video/... hoặc https://youtube.com/shorts/...")
        row_scrap_url.addWidget(self.txt_video_url)
        layout_card.addLayout(row_scrap_url)

        row_scrap_btn = QHBoxLayout()
        btn_dl_tiktok = QPushButton("🎵 Tải Video TikTok")
        btn_dl_tiktok.setProperty("class", "btn-primary")
        btn_dl_tiktok.clicked.connect(self.download_tiktok_video)

        btn_dl_yt = QPushButton("🔴 Tải YouTube Shorts")
        btn_dl_yt.setProperty("class", "btn-danger")
        btn_dl_yt.clicked.connect(self.download_youtube_video)

        row_scrap_btn.addWidget(btn_dl_tiktok)
        row_scrap_btn.addWidget(btn_dl_yt)
        row_scrap_btn.addStretch()
        layout_card.addLayout(row_scrap_btn)

        layout_scraper.addWidget(card_scrap)
        layout_scraper.addStretch()

        sub_tabs.addTab(tab_scraper, "📥 Tải Video TikTok & YouTube")

        self.main_layout.addWidget(sub_tabs)
        self.load_pages()

    def load_pages(self):
        pages = db.fetch_all("SELECT * FROM pages")
        self.tbl_pages.setRowCount(len(pages))
        for i, p in enumerate(pages):
            self.tbl_pages.setItem(i, 0, QTableWidgetItem(str(p["page_id"])))
            self.tbl_pages.setItem(i, 1, QTableWidgetItem(str(p.get("page_name", ""))))
            self.tbl_pages.setItem(i, 2, QTableWidgetItem("Bật" if p.get("auto_ai_enabled") else "Tắt"))
            self.tbl_pages.setItem(i, 3, QTableWidgetItem("Bật" if p.get("auto_reels_enabled") else "Tắt"))
            self.tbl_pages.setItem(i, 4, QTableWidgetItem(f"Đã đăng: #{p.get('last_posted_reels_folder', 0)}"))
            self.tbl_pages.setItem(i, 5, QTableWidgetItem("Bật" if p.get("auto_video_enabled") else "Tắt"))
            self.tbl_pages.setItem(i, 6, QTableWidgetItem(str(p.get("status", "ACTIVE"))))

    def fetch_pages_from_user_token(self):
        token, ok = QInputDialog.getText(self, "Nhập User Access Token", "Dán User Access Token để lấy danh sách Page:")
        if ok and token:
            try:
                pages_data = fb_client.fetch_managed_pages(token.strip())
                if not pages_data:
                    QMessageBox.warning(self, "Thông báo", "Không tìm thấy Fanpage nào từ Token này!")
                    return

                count = 0
                for p in pages_data:
                    db.execute(
                        """INSERT OR REPLACE INTO pages 
                        (page_id, page_name, access_token, category, auto_ai_enabled, auto_reels_enabled, status)
                        VALUES (?, ?, ?, ?, 1, 1, 'ACTIVE')""",
                        (p["id"], p["name"], p["access_token"], p.get("category", ""))
                    )
                    count += 1

                self.load_pages()
                self.log("SUCCESS", f"Đã nạp thành công {count} Fanpage và Page Token vĩnh viễn!")
                QMessageBox.information(self, "Thành công", f"Đã thêm {count} Fanpage vào hệ thống.")
            except Exception as e:
                self.log("ERROR", f"Lỗi nạp Page: {e}")
                QMessageBox.critical(self, "Lỗi", str(e))

    def assign_reels_folder(self):
        selected_rows = set(idx.row() for idx in self.tbl_pages.selectedIndexes())
        if not selected_rows:
            QMessageBox.warning(self, "Thông báo", "Vui lòng chọn ít nhất 1 Fanpage trên bảng để gán thư mục!")
            return

        folder = QFileDialog.getExistingDirectory(self, "Chọn Thư Mục Gốc Chứa Reels (Chứa các thư mục 1, 2, 3...)")
        if folder:
            for row in selected_rows:
                page_id = self.tbl_pages.item(row, 0).text()
                db.execute("UPDATE pages SET reels_folder = ?, auto_reels_enabled = 1 WHERE page_id = ?", (folder, page_id))
            self.load_pages()
            self.log("SUCCESS", f"Đã gán thư mục Reels: {folder}")

    def assign_video_folder(self):
        selected_rows = set(idx.row() for idx in self.tbl_pages.selectedIndexes())
        if not selected_rows:
            QMessageBox.warning(self, "Thông báo", "Vui lòng chọn ít nhất 1 Fanpage trên bảng để gán thư mục!")
            return

        folder = QFileDialog.getExistingDirectory(self, "Chọn Thư Mục Gốc Chứa Video Dài")
        if folder:
            for row in selected_rows:
                page_id = self.tbl_pages.item(row, 0).text()
                db.execute("UPDATE pages SET video_folder = ?, auto_video_enabled = 1 WHERE page_id = ?", (folder, page_id))
            self.load_pages()
            self.log("SUCCESS", f"Đã gán thư mục Video dài: {folder}")

    def download_tiktok_video(self):
        url = self.txt_video_url.text().strip()
        if not url:
            QMessageBox.warning(self, "Thông báo", "Vui lòng nhập URL TikTok!")
            return

        # Lấy page đang chọn hoặc page đầu tiên
        pages = db.fetch_all("SELECT * FROM pages WHERE reels_folder IS NOT NULL LIMIT 1")
        if not pages or not pages[0].get("reels_folder"):
            QMessageBox.warning(self, "Thông báo", "Cần gán thư mục Reels cho ít nhất 1 Fanpage trước khi tải!")
            return

        target_folder = pages[0]["reels_folder"]
        self.log("INFO", f"Bắt đầu tải video TikTok: {url}...")
        res = tiktok_scraper.download_to_page_pipeline(url, target_folder, pages[0]["page_id"])
        if res and res.get("success"):
            self.log("SUCCESS", f"-> Tải thành công vào thư mục #{res['folder_index']}: {res['caption'][:40]}...")
            QMessageBox.information(self, "Thành công", f"Đã lưu vào thư mục #{res['folder_index']} chuẩn bị đăng!")
        elif res and res.get("skipped"):
            self.log("WARNING", f"Video {res.get('video_id')} đã tồn tại trong kho (chống tải trùng)!")
        else:
            self.log("ERROR", "Không thể tải video TikTok này.")

    def download_youtube_video(self):
        url = self.txt_video_url.text().strip()
        if not url:
            QMessageBox.warning(self, "Thông báo", "Vui lòng nhập URL YouTube!")
            return

        pages = db.fetch_all("SELECT * FROM pages WHERE reels_folder IS NOT NULL LIMIT 1")
        if not pages or not pages[0].get("reels_folder"):
            QMessageBox.warning(self, "Thông báo", "Cần gán thư mục Reels cho Fanpage trước khi tải!")
            return

        target_folder = pages[0]["reels_folder"]
        self.log("INFO", f"Bắt đầu tải YouTube Shorts: {url}...")
        res = youtube_scraper.download_to_page_pipeline(url, target_folder, pages[0]["page_id"])
        if res and res.get("success"):
            self.log("SUCCESS", f"-> Tải thành công YouTube vào thư mục #{res['folder_index']}!")
            QMessageBox.information(self, "Thành công", f"Đã lưu video YouTube vào thư mục #{res['folder_index']}")
        else:
            self.log("ERROR", f"Lỗi tải YouTube: {res.get('error') if res else 'Unknown'}")

    def start_posting(self, mode: str):
        self.btn_run_all.setEnabled(False)
        self.btn_run_ai.setEnabled(False)
        self.btn_run_reels.setEnabled(False)
        self.btn_stop.setEnabled(True)

        self.worker = AutoPostWorker(mode=mode)
        self.worker.sig_log.connect(self.sig_log.emit)
        self.worker.sig_finished.connect(self._on_post_finished)
        self.worker.start()

    def stop_posting(self):
        if self.worker and self.worker.isRunning():
            self.worker.stop()
            self.worker.wait(2000)
        self.btn_run_all.setEnabled(True)
        self.btn_run_ai.setEnabled(True)
        self.btn_run_reels.setEnabled(True)
        self.btn_stop.setEnabled(False)

    def _on_post_finished(self, success: bool, msg: str):
        self.btn_run_all.setEnabled(True)
        self.btn_run_ai.setEnabled(True)
        self.btn_run_reels.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self.load_pages()
        QMessageBox.information(self, "Kết quả", msg)
