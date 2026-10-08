# -*- coding: utf-8 -*-
"""
File: gui/main_window.py
"""
import sys
import os
from PyQt5.QtWidgets import (QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, 
                             QLabel, QLineEdit, QTextEdit, QPushButton, QComboBox, 
                             QFileDialog, QSpinBox, QGroupBox, QMessageBox, QTabWidget)
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont, QTextCursor

from core.worker import AutoPostWorker
from config.styles import HACKER_STYLE_QSS, generate_check_icon
from config.settings import (load_gui_configs, save_gui_configs, 
                             load_api_keys, load_pages_list, save_pages_list)

from gui.tab_ai import AITab
from gui.tab_reels import ReelsTab
from gui.tab_video import VideoTab
from gui.tab_tiktok import TikTokTab
from gui.tab_youtube import YouTubeTab

class AutoPostGUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.worker = None
        self.pages_list = []
        generate_check_icon()
        self.reels_root_dir, self.video_root_dir = load_gui_configs()
        self.initUI()

    def initUI(self):
        self.setWindowTitle("Facebook Auto Poster AI Pro - Batching & Key Rotation System")
        self.setGeometry(100, 50, 1200, 850)

        # Apply global Hacker theme stylesheet
        self.setStyleSheet(HACKER_STYLE_QSS)

        main_widget = QWidget()
        self.setCentralWidget(main_widget)
        main_layout = QVBoxLayout()
        main_widget.setLayout(main_layout)

        # ================= BƯỚC 1: THIẾT LẬP NGUỒN NỘI DUNG VÀ PROFILE =================
        group_step1 = QGroupBox("Bước 1: Thiết lập Nguồn nội dung và Profile")
        layout_step1 = QVBoxLayout()
        
        # Tạo QTabWidget cho 3 mục đăng bài
        self.tabs = QTabWidget()
        self.tabs.setFont(QFont("Segoe UI", 9, QFont.Bold))
        
        # Instantiate child Tab Widgets
        self.tab_ai = AITab(self)
        self.tab_reels = ReelsTab(self)
        self.tab_video = VideoTab(self)
        self.tab_tiktok = TikTokTab(self)
        self.tab_youtube = YouTubeTab(self)
        
        self.tabs.addTab(self.tab_ai, "✍️ Đăng Bài Viết AI")
        self.tabs.addTab(self.tab_reels, "🎬 Đăng Video Reels (Cục bộ)")
        self.tabs.addTab(self.tab_video, "📽️ Đăng Video Dài (Cục bộ)")
        self.tabs.addTab(self.tab_tiktok, "📥 Tải Video TikTok Hàng Loạt")
        self.tabs.addTab(self.tab_youtube, "📥 Tải Video YouTube Shorts")

        layout_step1.addWidget(self.tabs)
        group_step1.setLayout(layout_step1)
        main_layout.addWidget(group_step1, 65) # Chiếm 65% chiều cao

        # ================= HÀNG DƯỚI: CHIA ĐÔI BƯỚC 2 & BƯỚC 3 =================
        bottom_layout = QHBoxLayout()

        # ================= BƯỚC 2: BẮT ĐẦU THỰC THI (Bên Trái) =================
        group_step2 = QGroupBox("Bước 2: Bắt đầu Thực thi")
        layout_step2 = QVBoxLayout()
        layout_step2.setContentsMargins(10, 8, 10, 8)
        layout_step2.setSpacing(6)
        
        box_token_file = QHBoxLayout()
        self.input_pages_file = QLineEdit("pages_data.json")
        btn_browse_file = QPushButton("Chọn File Page")
        btn_browse_file.clicked.connect(self.browse_pages_file)
        
        box_token_file.addWidget(self.input_pages_file)
        box_token_file.addWidget(btn_browse_file)
        
        layout_step2.addWidget(QLabel("File JSON Fanpages:"))
        layout_step2.addLayout(box_token_file)
        
        self.label_status_pages = QLabel("Chưa tải thống kê...")
        self.label_status_pages.setStyleSheet("color: #45f3ff; font-weight: bold; font-family: 'Consolas', monospace;")
        layout_step2.addWidget(self.label_status_pages)

        # Cấu hình Giãn cách nghỉ
        box_spin = QHBoxLayout()
        self.spin_min = QSpinBox()
        self.spin_min.setRange(1, 3600)
        self.spin_min.setValue(600)  # Mặc định 10 phút
        self.spin_max = QSpinBox()
        self.spin_max.setRange(1, 3600)
        self.spin_max.setValue(900)  # Mặc định 15 phút
        
        box_spin.addWidget(QLabel("Nghỉ từ (s):"))
        box_spin.addWidget(self.spin_min)
        box_spin.addWidget(QLabel("Đến (s):"))
        box_spin.addWidget(self.spin_max)
        
        layout_step2.addWidget(QLabel("Giãn cách đăng ngẫu nhiên:"))
        layout_step2.addLayout(box_spin)
        
        # Nút Kích hoạt và Dừng
        box_exec_buttons = QHBoxLayout()
        self.btn_start = QPushButton("▶ KÍCH HOẠT")
        self.btn_start.setProperty("class", "neon-large-green")
        self.btn_start.clicked.connect(self.start_process)
        
        self.btn_stop = QPushButton("🛑 DỪNG LUỒNG")
        self.btn_stop.setProperty("class", "neon-large-red")
        self.btn_stop.clicked.connect(self.stop_process)
        self.btn_stop.setEnabled(False)
        
        box_exec_buttons.addWidget(self.btn_start)
        box_exec_buttons.addWidget(self.btn_stop)
        layout_step2.addLayout(box_exec_buttons)
        
        group_step2.setLayout(layout_step2)

        # ================= BƯỚC 3: THEO DÕI TIẾN TRÌNH (Bên Phải) =================
        group_step3 = QGroupBox("Bước 3: Theo dõi Tiến trình")
        layout_step3 = QVBoxLayout()
        layout_step3.setContentsMargins(10, 8, 10, 8)
        
        self.log_console = QTextEdit()
        self.log_console.setReadOnly(True)
        self.log_console.setStyleSheet("background-color: #050608; color: #00ff66; font-family: 'Consolas', 'Courier New', monospace; font-size: 10pt; border: 1px solid #1c2333; border-radius: 4px; padding: 5px;")
        layout_step3.addWidget(self.log_console)
        
        group_step3.setLayout(layout_step3)

        bottom_layout.addWidget(group_step2, 45) # Trái: 45%
        bottom_layout.addWidget(group_step3, 55) # Phải: 55%
        
        main_layout.addLayout(bottom_layout, 35) # Dưới: 35%

        # Cài đặt kết nối tín hiệu
        self.input_pages_file.textChanged.connect(self.update_page_stats)
        self.input_pages_file.textChanged.connect(self.load_pages_to_tables)
        
        # Load dữ liệu ban đầu
        self.update_page_stats()
        self.load_pages_to_tables()

    def load_pages_to_tables(self):
        pages_file = self.input_pages_file.text().strip()
        self.pages_list = load_pages_list(pages_file)
        if not self.pages_list:
            return

        # Gọi các Tab tải dữ liệu tương ứng
        self.tab_reels.load_pages(self.pages_list)
        self.tab_video.load_pages(self.pages_list)
        self.tab_tiktok.load_pages(self.pages_list)
        self.tab_youtube.load_pages(self.pages_list)
        self.tab_ai.load_pages(self.pages_list)

    def sync_tables_to_pages_data(self):
        if not hasattr(self, 'pages_list') or not self.pages_list:
            return True

        for idx, page in enumerate(self.pages_list):
            is_reel_checked, reel_subfolder = self.tab_reels.get_page_selection(idx)
            is_vid_checked, vid_subfolder = self.tab_video.get_page_selection(idx)
            is_ai_checked, ai_keyword = self.tab_ai.get_page_selection(idx)

            # Reels config
            if reel_subfolder and self.reels_root_dir:
                page["reels_folder"] = os.path.join(self.reels_root_dir, reel_subfolder)
            else:
                page["reels_folder"] = ""
            page["reels_enabled"] = is_reel_checked

            # Video config
            if vid_subfolder and self.video_root_dir:
                page["video_folder"] = os.path.join(self.video_root_dir, vid_subfolder)
            else:
                page["video_folder"] = ""
            page["video_enabled"] = is_vid_checked

            # AI config
            page["ai_enabled"] = is_ai_checked
            page["ai_keyword"] = ai_keyword

            # YouTube config
            youtube_search = self.tab_youtube.get_page_selection(idx)
            page["youtube_search"] = youtube_search

        # Lưu lại pages_data.json
        pages_file = self.input_pages_file.text().strip()
        success = save_pages_list(pages_file, self.pages_list)
        if not success:
            QMessageBox.critical(self, "Lỗi Đồng Bộ", "Không thể lưu cấu hình trang!")
            return False
        return True

    def browse_pages_file(self):
        fname, _ = QFileDialog.getOpenFileName(self, 'Chọn file JSON tokens page', '', 'JSON Files (*.json);;All Files (*)')
        if fname: 
            self.input_pages_file.setText(fname)

    def write_log(self, message):
        self.log_console.append(message)
        self.log_console.moveCursor(QTextCursor.End)

    def start_process(self):
        if not self.sync_tables_to_pages_data():
            return

        key_file_path = self.tab_ai.get_key_file_path()
        api_keys = load_api_keys(key_file_path)
        if not api_keys:
            QMessageBox.warning(self, "Thiếu Dữ Liệu", "Không tìm thấy API keys hoặc file keys.txt trống!")
            return

        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.log_console.clear()

        self.worker = AutoPostWorker(
            api_keys=api_keys,
            fb_version=self.tab_ai.get_fb_version(),
            sleep_min=self.spin_min.value(),
            sleep_max=self.spin_max.value(),
            pages_file=self.input_pages_file.text().strip(),
            prompt_template=self.tab_ai.get_prompt_template(),
            model_name=self.tab_ai.get_model_name(),
            creds_file=self.tab_ai.get_creds_file(),
            sheet_id=self.tab_ai.get_sheet_id(),
            pixabay_key=self.tab_ai.get_pixabay_key(),
            ai_sched_enabled=self.tab_ai.chk_ai_schedule.isChecked(),
            ai_sched_times=self.tab_ai.input_ai_schedule_times.text().strip(),
            reels_sched_enabled=self.tab_reels.chk_reels_schedule.isChecked(),
            reels_sched_times=self.tab_reels.input_reels_schedule_times.text().strip(),
            video_sched_enabled=self.tab_video.chk_video_schedule.isChecked(),
            video_sched_times=self.tab_video.input_video_schedule_times.text().strip()
        )
        
        self.worker.log_signal.connect(self.write_log)
        self.worker.finished_signal.connect(self.process_finished)
        self.worker.start()

    def stop_process(self):
        if self.worker and self.worker.isRunning():
            self.worker.stop()
            self.btn_stop.setEnabled(False)
            self.write_log("[INFO] Đang gửi yêu cầu dừng luồng khẩn cấp. Vui lòng chờ nhịp cuối cùng...")

    def process_finished(self):
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self.write_log("[INFO] Tiến trình tổng thể đã dừng và chuyển về trạng thái nghỉ an toàn.")
        self.update_page_stats()

    def update_page_stats(self):
        pages_file = self.input_pages_file.text().strip()
        pages = load_pages_list(pages_file)
        if pages:
            reels_count = 0
            video_count = 0
            ai_count = 0
            disabled_count = 0
            for p in pages:
                # Reels
                reels_enabled = p.get("reels_enabled")
                if reels_enabled is None:
                    reels_enabled = (p.get("post_type") == "reel")
                # Video
                video_enabled = p.get("video_enabled")
                if video_enabled is None:
                    video_enabled = (p.get("post_type") == "video")
                # AI
                ai_enabled = p.get("ai_enabled")
                if ai_enabled is None:
                    ai_enabled = (p.get("post_type") == "ai")
                
                if reels_enabled:
                    reels_count += 1
                if video_enabled:
                    video_count += 1
                if ai_enabled:
                    ai_count += 1
                if not reels_enabled and not video_enabled and not ai_enabled:
                    disabled_count += 1
                    
            self.label_status_pages.setText(f"Tổng: {len(pages)} Page | Reels: {reels_count} | Video Dài: {video_count} | AI: {ai_count} | Bị tắt: {disabled_count}")
        else:
            self.label_status_pages.setText("Chưa tải cấu hình trang!")
