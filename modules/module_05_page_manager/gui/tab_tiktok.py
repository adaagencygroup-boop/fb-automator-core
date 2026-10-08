# -*- coding: utf-8 -*-
"""
File: gui/tab_tiktok.py
"""
import os
import json
from PyQt5.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
                             QPushButton, QComboBox, QFileDialog, QTableWidget, 
                             QTableWidgetItem, QHeaderView, QMessageBox, QTextEdit, QSpinBox)
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QTextCursor

from config.styles_tiktok import TIKTOK_STYLE_QSS
from core.tiktok_downloader import TikTokBulkDownloader

class TikTokTab(QWidget):
    def __init__(self, main_window, parent=None):
        super().__init__(parent)
        self.main_window = main_window
        self.tiktok_root_dir = ""
        self.downloader = None
        self.load_tiktok_config()
        self.initUI()

    def load_tiktok_config(self):
        if os.path.exists("gui_config.json"):
            try:
                with open("gui_config.json", 'r', encoding='utf-8') as f:
                    config = json.load(f)
                self.tiktok_root_dir = config.get("tiktok_root_dir", "")
            except Exception:
                pass

    def save_tiktok_config(self):
        config = {}
        if os.path.exists("gui_config.json"):
            try:
                with open("gui_config.json", 'r', encoding='utf-8') as f:
                    config = json.load(f)
            except Exception:
                pass
        config["tiktok_root_dir"] = self.tiktok_root_dir
        try:
            with open("gui_config.json", 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=4)
        except Exception:
            pass

    def initUI(self):
        self.setStyleSheet(TIKTOK_STYLE_QSS)
        
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(10, 10, 10, 10)

        # Cấu hình Thư mục lưu tổng
        box_folder = QHBoxLayout()
        self.btn_choose_folder = QPushButton("📂 Chọn Thư mục Lưu Tổng...")
        self.btn_choose_folder.setProperty("class", "neon-blue")
        self.btn_choose_folder.clicked.connect(self.choose_tiktok_root)
        self.lbl_tiktok_root = QLabel(f"Đã chọn: {self.tiktok_root_dir if self.tiktok_root_dir else 'Chưa chọn'}")
        self.lbl_tiktok_root.setStyleSheet("font-weight: bold; color: #45f3ff;")
        box_folder.addWidget(self.btn_choose_folder)
        box_folder.addWidget(self.lbl_tiktok_root)
        box_folder.addStretch()
        main_layout.addLayout(box_folder)

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
        self.spin_workers.setValue(5)

        box_configs.addWidget(QLabel("Delay giữa request (s):"))
        box_configs.addWidget(self.spin_delay)
        box_configs.addWidget(QLabel("Số video tối đa mỗi Page:"))
        box_configs.addWidget(self.spin_limit)
        box_configs.addWidget(QLabel("Số luồng song song:"))
        box_configs.addWidget(self.spin_workers)
        box_configs.addStretch()
        main_layout.addLayout(box_configs)

        # Nút điều khiển
        box_controls = QHBoxLayout()
        self.btn_start = QPushButton("▶ BẮT ĐẦU TẢI HÀNG LOẠT")
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
        self.table_progress.setHorizontalHeaderLabels(["STT", "Tên Fanpage", "Từ khóa tìm kiếm", "Trạng thái"])
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
        col_right.addWidget(QLabel("Nhật ký tải chi tiết:"))
        
        self.log_console = QTextEdit()
        self.log_console.setReadOnly(True)
        self.log_console.setStyleSheet("background-color: #050608; color: #00ff66; font-family: 'Consolas', monospace; font-size: 10pt; border: 1px solid #1c2333; border-radius: 4px; padding: 5px;")
        col_right.addWidget(self.log_console)
        
        split_layout.addLayout(col_left, 50)
        split_layout.addLayout(col_right, 50)
        
        main_layout.addLayout(split_layout, 1)

    def choose_tiktok_root(self):
        dir_path = QFileDialog.getExistingDirectory(self, "Chọn Thư mục Tổng lưu Video TikTok")
        if dir_path:
            self.tiktok_root_dir = os.path.abspath(dir_path)
            self.lbl_tiktok_root.setText(f"Đã chọn: {self.tiktok_root_dir}")
            self.save_tiktok_config()

    def load_pages(self, pages_list):
        self.table_progress.setRowCount(0)
        self.table_progress.setRowCount(len(pages_list))

        for idx, page in enumerate(pages_list):
            page_name = page.get("name", "Unknown Page")
            self.table_progress.setItem(idx, 0, QTableWidgetItem(str(idx + 1)))
            self.table_progress.setItem(idx, 1, QTableWidgetItem(page_name))
            self.table_progress.setItem(idx, 2, QTableWidgetItem(page_name))
            self.table_progress.setItem(idx, 3, QTableWidgetItem("Chờ lệnh..."))

    def start_download(self):
        if not self.tiktok_root_dir:
            QMessageBox.warning(self, "Thiếu thông tin", "Vui lòng chọn thư mục lưu tổng trước!")
            return

        pages_list = self.main_window.pages_list
        if not pages_list:
            QMessageBox.warning(self, "Không có dữ liệu", "Danh sách Fanpage trống! Vui lòng kiểm tra lại file cấu hình trang.")
            return

        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.log_console.clear()

        # Làm mới lại cột trạng thái bảng
        for idx in range(len(pages_list)):
            self.table_progress.setItem(idx, 3, QTableWidgetItem("Chờ tải..."))

        self.downloader = TikTokBulkDownloader(
            pages_list=pages_list,
            download_folder=self.tiktok_root_dir,
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
            self.write_log("[INFO] Đang gửi yêu cầu dừng luồng tải. Vui lòng đợi kết thúc phiên hiện tại...")

    def update_page_status(self, idx, status_text):
        if 0 <= idx < self.table_progress.rowCount():
            self.table_progress.setItem(idx, 3, QTableWidgetItem(status_text))

    def write_log(self, message):
        self.log_console.append(message)
        self.log_console.moveCursor(QTextCursor.End)

    def download_finished(self):
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self.write_log("[INFO] Tiến trình tải video đã kết thúc an toàn.")
        QMessageBox.information(self, "Hoàn thành", "Đã kết thúc quy trình tải video TikTok!")
