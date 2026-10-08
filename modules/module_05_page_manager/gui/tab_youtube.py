# -*- coding: utf-8 -*-
"""
File: gui/tab_youtube.py
"""
import os
import json
from PyQt5.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
                             QPushButton, QComboBox, QFileDialog, QTableWidget, 
                             QTableWidgetItem, QHeaderView, QMessageBox, QTextEdit, 
                             QSpinBox, QLineEdit, QGroupBox)
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QTextCursor

from config.styles_youtube import YOUTUBE_STYLE_QSS
from core.youtube_downloader import YouTubeBulkDownloader, YouTubeSingleDownloader

class YouTubeTab(QWidget):
    def __init__(self, main_window, parent=None):
        super().__init__(parent)
        self.main_window = main_window
        self.youtube_root_dir = ""
        self.quick_save_dir = ""
        self.cookie_file = ""
        self.cookie_browser = "Không dùng (None)"
        self.downloader = None
        self.single_downloader = None
        self.load_youtube_config()
        self.initUI()

    def load_youtube_config(self):
        if os.path.exists("gui_config.json"):
            try:
                with open("gui_config.json", 'r', encoding='utf-8') as f:
                    config = json.load(f)
                self.youtube_root_dir = config.get("youtube_root_dir", "")
                self.quick_save_dir = config.get("youtube_quick_save_dir", "")
                self.cookie_file = config.get("youtube_cookie_file", "")
                self.cookie_browser = config.get("youtube_cookie_browser", "Không dùng (None)")
            except Exception:
                pass

    def save_youtube_config(self):
        config = {}
        if os.path.exists("gui_config.json"):
            try:
                with open("gui_config.json", 'r', encoding='utf-8') as f:
                    config = json.load(f)
            except Exception:
                pass
        config["youtube_root_dir"] = self.youtube_root_dir
        config["youtube_quick_save_dir"] = self.quick_save_dir
        config["youtube_cookie_file"] = self.cookie_file
        config["youtube_cookie_browser"] = self.cookie_browser
        try:
            with open("gui_config.json", 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=4)
        except Exception:
            pass

    def initUI(self):
        self.setStyleSheet(YOUTUBE_STYLE_QSS)
        
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(10, 10, 10, 10)

        # Cấu hình Thư mục lưu tổng
        box_folder = QHBoxLayout()
        self.btn_choose_folder = QPushButton("📂 Chọn Thư mục Lưu Tổng...")
        self.btn_choose_folder.setProperty("class", "neon-blue")
        self.btn_choose_folder.clicked.connect(self.choose_youtube_root)
        self.lbl_youtube_root = QLabel(f"Đã chọn: {self.youtube_root_dir if self.youtube_root_dir else 'Chưa chọn'}")
        self.lbl_youtube_root.setStyleSheet("font-weight: bold; color: #ff3333;")
        box_folder.addWidget(self.btn_choose_folder)
        box_folder.addWidget(self.lbl_youtube_root)
        box_folder.addStretch()
        main_layout.addLayout(box_folder)

        # ⚡ TẢI NHANH 1 VIDEO YOUTUBE
        group_quick = QGroupBox("⚡ TẢI NHANH 1 VIDEO YOUTUBE (LƯU THƯ MỤC TỰ CHỌN)")
        group_quick.setStyleSheet("QGroupBox { border: 1px solid #ff3333; border-radius: 6px; margin-top: 5px; margin-bottom: 5px; padding: 10px; color: #ff3333; font-weight: bold; } QLabel { color: #e0e0e0; }")
        layout_quick = QVBoxLayout(group_quick)
        layout_quick.setSpacing(6)
        
        box_quick_url = QHBoxLayout()
        box_quick_url.addWidget(QLabel("Đường dẫn Video:"))
        self.input_quick_url = QLineEdit()
        self.input_quick_url.setPlaceholderText("Dán liên kết YouTube Shorts hoặc Video dài tại đây...")
        self.input_quick_url.setStyleSheet("background-color: #0d0d0d; color: #ffffff; border: 1px solid #ff3333; border-radius: 4px; padding: 4px;")
        box_quick_url.addWidget(self.input_quick_url)
        layout_quick.addLayout(box_quick_url)
        
        box_quick_actions = QHBoxLayout()
        self.btn_quick_folder = QPushButton("📂 Chọn Thư mục Lưu...")
        self.btn_quick_folder.setProperty("class", "neon-blue")
        self.btn_quick_folder.clicked.connect(self.choose_quick_folder)
        
        self.lbl_quick_folder = QLabel(f"Thư mục lưu: {self.quick_save_dir if self.quick_save_dir else 'Chưa chọn (sẽ lưu theo thư mục tổng)'}")
        self.lbl_quick_folder.setStyleSheet("color: #aaaaaa; font-family: 'Consolas'; font-size: 9pt;")
        
        self.btn_quick_download = QPushButton("⚡ TẢI NGAY")
        self.btn_quick_download.setProperty("class", "neon-green")
        self.btn_quick_download.clicked.connect(self.start_quick_download)
        
        self.btn_quick_stop = QPushButton("🛑 DỪNG")
        self.btn_quick_stop.setProperty("class", "neon-red")
        self.btn_quick_stop.setEnabled(False)
        self.btn_quick_stop.clicked.connect(self.stop_quick_download)
        
        box_quick_actions.addWidget(self.btn_quick_folder)
        box_quick_actions.addWidget(self.lbl_quick_folder, 1)
        box_quick_actions.addWidget(self.btn_quick_download)
        box_quick_actions.addWidget(self.btn_quick_stop)
        layout_quick.addLayout(box_quick_actions)
        
        main_layout.addWidget(group_quick)

        # Hàng cấu hình Cookies
        box_cookies = QHBoxLayout()
        
        # Chọn trình duyệt
        box_cookies.addWidget(QLabel("Cookies từ trình duyệt:"))
        self.combo_cookies_browser = QComboBox()
        self.combo_cookies_browser.addItems(["Không dùng (None)", "chrome", "edge", "brave", "opera", "firefox"])
        idx_b = self.combo_cookies_browser.findText(self.cookie_browser)
        if idx_b >= 0:
            self.combo_cookies_browser.setCurrentIndex(idx_b)
        self.combo_cookies_browser.currentTextChanged.connect(self.on_browser_changed)
        box_cookies.addWidget(self.combo_cookies_browser)
        
        # Chọn file cookies.txt
        box_cookies.addWidget(QLabel(" |  Hoặc file cookies.txt:"))
        self.input_cookies_path = QLineEdit(self.cookie_file)
        self.input_cookies_path.setPlaceholderText("Đường dẫn file cookies.txt (Netscape format)...")
        self.input_cookies_path.textChanged.connect(self.on_file_changed)
        btn_browse_cookies = QPushButton("Chọn File...")
        btn_browse_cookies.setProperty("class", "neon-blue")
        btn_browse_cookies.clicked.connect(self.browse_cookies_file)
        
        box_cookies.addWidget(self.input_cookies_path)
        box_cookies.addWidget(btn_browse_cookies)
        main_layout.addLayout(box_cookies)

        # Hàng cấu hình số giây và giới hạn video
        box_configs = QHBoxLayout()
        self.spin_delay = QSpinBox()
        self.spin_delay.setRange(1, 60)
        self.spin_delay.setValue(2)
        
        self.spin_limit = QSpinBox()
        self.spin_limit.setRange(1, 100)
        self.spin_limit.setValue(5)

        self.spin_workers = QSpinBox()
        self.spin_workers.setRange(1, 20)
        self.spin_workers.setValue(2)

        box_configs.addWidget(QLabel("Delay giữa request (s):"))
        box_configs.addWidget(self.spin_delay)
        box_configs.addWidget(QLabel("Số video tối đa mỗi Page:"))
        box_configs.addWidget(self.spin_limit)
        box_configs.addWidget(QLabel("Số luồng song song:"))
        box_configs.addWidget(self.spin_workers)
        box_configs.addStretch()
        main_layout.addLayout(box_configs)

        # Nút điều khiển hàng loạt
        box_controls = QHBoxLayout()
        self.btn_start = QPushButton("▶ BẮT ĐẦU TẢI HÀNG LOẠT (YT)")
        self.btn_start.setProperty("class", "neon-green")
        self.btn_start.clicked.connect(self.start_download)
        
        self.btn_stop = QPushButton("🛑 DỪNG TẢI")
        self.btn_stop.setProperty("class", "neon-red")
        self.btn_stop.setEnabled(False)
        self.btn_stop.clicked.connect(self.stop_download)

        box_controls.addWidget(self.btn_start)
        box_controls.addWidget(self.btn_stop)
        box_controls.addStretch()
        main_layout.addLayout(box_controls)

        # Bảng hiển thị tiến trình của từng Fanpage
        self.table_progress = QTableWidget()
        self.table_progress.setColumnCount(4)
        self.table_progress.setHorizontalHeaderLabels(["STT", "Tên Fanpage", "Từ khóa tìm kiếm / Link", "Trạng thái"])
        self.table_progress.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table_progress.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.table_progress.verticalHeader().setVisible(False)
        self.table_progress.verticalHeader().setDefaultSectionSize(35)
        self.table_progress.setSelectionBehavior(QTableWidget.SelectRows)

        # Bố cục chia đôi: Trái (Bảng chọn), Phải (Nhật ký log)
        split_layout = QHBoxLayout()
        
        # Cột trái
        col_left = QVBoxLayout()
        col_left.addWidget(self.table_progress)
        
        # Cột phải
        col_right = QVBoxLayout()
        col_right.addWidget(QLabel("Nhật ký tải chi tiết YouTube Shorts:"))
        
        self.log_console = QTextEdit()
        self.log_console.setReadOnly(True)
        self.log_console.setStyleSheet("background-color: #050608; color: #00ff66; font-family: 'Consolas', monospace; font-size: 10pt; border: 1px solid #1c2333; border-radius: 4px; padding: 5px;")
        col_right.addWidget(self.log_console)
        
        split_layout.addLayout(col_left, 50)
        split_layout.addLayout(col_right, 50)
        
        main_layout.addLayout(split_layout, 1)

    def choose_youtube_root(self):
        dir_path = QFileDialog.getExistingDirectory(self, "Chọn Thư mục Tổng lưu Video YouTube Shorts")
        if dir_path:
            self.youtube_root_dir = os.path.abspath(dir_path)
            self.lbl_youtube_root.setText(f"Đã chọn: {self.youtube_root_dir}")
            self.save_youtube_config()

    def choose_quick_folder(self):
        dir_path = QFileDialog.getExistingDirectory(self, "Chọn Thư mục Lưu video tải nhanh")
        if dir_path:
            self.quick_save_dir = os.path.abspath(dir_path)
            self.lbl_quick_folder.setText(f"Thư mục lưu: {self.quick_save_dir}")
            self.save_youtube_config()

    def browse_cookies_file(self):
        fname, _ = QFileDialog.getOpenFileName(self, 'Chọn file cookies.txt của YouTube', '', 'Text Files (*.txt);;All Files (*)')
        if fname:
            self.input_cookies_path.setText(fname)

    def on_browser_changed(self, text):
        self.cookie_browser = text
        self.save_youtube_config()

    def on_file_changed(self, text):
        self.cookie_file = text
        self.save_youtube_config()

    def load_pages(self, pages_list):
        self.table_progress.setRowCount(0)
        self.table_progress.setRowCount(len(pages_list))

        for idx, page in enumerate(pages_list):
            page_name = page.get("name", "Unknown Page")
            youtube_search = page.get("youtube_search") or page_name
            
            stt_item = QTableWidgetItem(str(idx + 1))
            stt_item.setFlags(stt_item.flags() & ~Qt.ItemIsEditable)
            
            name_item = QTableWidgetItem(page_name)
            name_item.setFlags(name_item.flags() & ~Qt.ItemIsEditable)
            
            search_item = QTableWidgetItem(youtube_search)
            
            status_item = QTableWidgetItem("Chờ lệnh...")
            status_item.setFlags(status_item.flags() & ~Qt.ItemIsEditable)

            self.table_progress.setItem(idx, 0, stt_item)
            self.table_progress.setItem(idx, 1, name_item)
            self.table_progress.setItem(idx, 2, search_item)
            self.table_progress.setItem(idx, 3, status_item)

    def get_page_selection(self, idx):
        if 0 <= idx < self.table_progress.rowCount():
            item = self.table_progress.item(idx, 2)
            if item:
                return item.text().strip()
        return ""

    def sync_table_to_list(self):
        pages_list = self.main_window.pages_list
        if not pages_list:
            return
        for idx in range(self.table_progress.rowCount()):
            if idx < len(pages_list):
                item = self.table_progress.item(idx, 2)
                if item:
                    pages_list[idx]["youtube_search"] = item.text().strip()

    def start_download(self):
        if not self.youtube_root_dir:
            QMessageBox.warning(self, "Thiếu thông tin", "Vui lòng chọn thư mục lưu tổng trước!")
            return

        self.sync_table_to_list()
        pages_list = self.main_window.pages_list
        if not pages_list:
            QMessageBox.warning(self, "Không có dữ liệu", "Danh sách Fanpage trống! Vui lòng kiểm tra lại file cấu hình trang.")
            return

        # Save to pages_data.json
        pages_file = self.main_window.input_pages_file.text().strip()
        from config.settings import save_pages_list
        save_pages_list(pages_file, pages_list)
        self.main_window.update_page_stats()

        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.log_console.clear()

        # Làm mới lại cột trạng thái bảng
        for idx in range(len(pages_list)):
            self.table_progress.setItem(idx, 3, QTableWidgetItem("Chờ tải..."))

        self.downloader = YouTubeBulkDownloader(
            pages_list=pages_list,
            download_folder=self.youtube_root_dir,
            cookie_browser=self.cookie_browser,
            cookie_file=self.cookie_file,
            delay_seconds=self.spin_delay.value(),
            max_videos_per_page=self.spin_limit.value(),
            max_workers=self.spin_workers.value()
        )
        self.downloader.log_signal.connect(self.write_log)
        self.downloader.page_status_signal.connect(self.update_page_status)
        self.downloader.finished_signal.connect(self.download_finished)
        self.downloader.start()

    def stop_download(self):
        if self.downloader and self.downloader.isRunning():
            self.downloader.stop()
            self.btn_stop.setEnabled(False)
            self.write_log("[INFO] Đang gửi yêu cầu dừng luồng tải Shorts. Vui lòng đợi kết thúc phiên hiện tại...")

    def start_quick_download(self):
        video_url = self.input_quick_url.text().strip()
        if not video_url:
            QMessageBox.warning(self, "Thiếu thông tin", "Vui lòng nhập đường dẫn video YouTube!")
            return

        save_folder = self.quick_save_dir.strip()
        if not save_folder:
            save_folder = self.youtube_root_dir.strip()
        if not save_folder:
            QMessageBox.warning(self, "Thiếu Thư Mục", "Vui lòng chọn thư mục lưu (hoặc chọn Thư mục Lưu Tổng trước)!")
            return

        self.btn_quick_download.setEnabled(False)
        self.btn_quick_stop.setEnabled(True)

        self.single_downloader = YouTubeSingleDownloader(
            video_url=video_url,
            save_folder=save_folder,
            cookie_browser=self.cookie_browser,
            cookie_file=self.cookie_file
        )
        self.single_downloader.log_signal.connect(self.write_log)
        self.single_downloader.finished_signal.connect(self.quick_download_finished)
        self.single_downloader.start()

    def stop_quick_download(self):
        if self.single_downloader and self.single_downloader.isRunning():
            self.single_downloader.stop()
            self.btn_quick_stop.setEnabled(False)
            self.write_log("[INFO] Đang gửi yêu cầu dừng tải video...")

    def quick_download_finished(self, success, message):
        self.btn_quick_download.setEnabled(True)
        self.btn_quick_stop.setEnabled(False)
        if success:
            QMessageBox.information(self, "Hoàn thành", f"Tải thành công:\n{message}")
        else:
            QMessageBox.critical(self, "Lỗi", f"Tải thất bại:\n{message}")

    def update_page_status(self, idx, status_text):
        if 0 <= idx < self.table_progress.rowCount():
            self.table_progress.setItem(idx, 3, QTableWidgetItem(status_text))

    def write_log(self, message):
        self.log_console.append(message)
        self.log_console.moveCursor(QTextCursor.End)

    def download_finished(self):
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self.write_log("[INFO] Tiến trình tải video YouTube Shorts đã kết thúc an toàn.")
        QMessageBox.information(self, "Hoàn thành", "Đã kết thúc quy trình tải video YouTube Shorts!")
