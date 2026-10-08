# -*- coding: utf-8 -*-
"""
File: gui/tab_ai.py
"""
import json
import os
from PyQt5.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
                             QLineEdit, QTextEdit, QPushButton, QComboBox, 
                             QGroupBox, QFileDialog, QTableWidget, 
                             QTableWidgetItem, QCheckBox, QHeaderView, QMessageBox)
from PyQt5.QtCore import Qt

class AITab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.initUI()

    def initUI(self):
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(10, 10, 10, 10)
        
        # Hàng trên: 2 Cột cấu hình và prompt
        top_layout = QHBoxLayout()
        
        # Cột trái AI: Cấu hình hệ thống & Sheet
        col_left_ai = QVBoxLayout()
        
        group_sys = QGroupBox("Cấu hình Hệ Thống & API Keys")
        layout_sys = QVBoxLayout()
        layout_sys.setContentsMargins(10, 8, 10, 8)
        layout_sys.setSpacing(6)
        layout_sys.addWidget(QLabel("File chứa danh sách Gemini API Keys (Mỗi dòng 1 key):"))
        box_key = QHBoxLayout()
        self.input_key_file = QLineEdit("keys.txt")
        btn_browse_key = QPushButton("Chọn File Key")
        btn_browse_key.clicked.connect(self.browse_key_file)
        box_key.addWidget(self.input_key_file)
        box_key.addWidget(btn_browse_key)
        layout_sys.addLayout(box_key)

        layout_sys.addWidget(QLabel("Pixabay API Key (Tìm ảnh chất lượng cao chống lỗi 403):"))
        self.input_pixabay = QLineEdit("ĐIỀN_KEY_PIXABAY_VÀO_ĐÂY")
        layout_sys.addWidget(self.input_pixabay)

        box_api_utils = QHBoxLayout()
        self.combo_fb = QComboBox()
        self.combo_fb.addItems(["v25.0", "v24.0", "v23.0", "v22.0"])
        self.combo_model = QComboBox()
        self.combo_model.addItems(["gemini-3.5-flash", "gemini-3.1-flash-Lite", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"])
        box_api_utils.addWidget(QLabel("FB API:"))
        box_api_utils.addWidget(self.combo_fb)
        box_api_utils.addWidget(QLabel("Model Gemini:"))
        box_api_utils.addWidget(self.combo_model)
        layout_sys.addLayout(box_api_utils)
        group_sys.setLayout(layout_sys)
        col_left_ai.addWidget(group_sys)

        group_sheet = QGroupBox("Cấu hình Đồng Bộ Báo Cáo Google Sheets")
        layout_sheet = QVBoxLayout()
        layout_sheet.setContentsMargins(10, 8, 10, 8)
        layout_sheet.setSpacing(6)
        layout_sheet.addWidget(QLabel("Google Sheet ID (Chuỗi mã trên đường dẫn URL bảng tính):"))
        self.input_sheet_id = QLineEdit()
        self.input_sheet_id.setPlaceholderText("Ví dụ: 1BxiMVs0XRA5nFMdKvXdBAnb_f345... ")
        layout_sheet.addWidget(self.input_sheet_id)
        
        layout_sheet.addWidget(QLabel("File Credentials JSON (Tài khoản dịch vụ Google Cloud):"))
        box_creds = QHBoxLayout()
        self.input_creds_path = QLineEdit()
        self.input_creds_path.setPlaceholderText("Đường dẫn đến file credentials.json")
        btn_browse_creds = QPushButton("Chọn File JSON")
        btn_browse_creds.clicked.connect(self.browse_creds)
        box_creds.addWidget(self.input_creds_path)
        box_creds.addWidget(btn_browse_creds)
        layout_sheet.addLayout(box_creds)
        group_sheet.setLayout(layout_sheet)
        col_left_ai.addWidget(group_sheet)
        
        group_sched = QGroupBox("Hẹn giờ đăng bài viết AI")
        layout_sched = QVBoxLayout()
        layout_sched.setContentsMargins(10, 8, 10, 8)
        layout_sched.setSpacing(6)
        self.chk_ai_schedule = QCheckBox("Kích hoạt hẹn giờ đăng (AI)")
        self.chk_ai_schedule.setStyleSheet("font-weight: bold; color: #ff3366;")
        self.input_ai_schedule_times = QLineEdit("09:00, 15:00, 21:00")
        self.input_ai_schedule_times.setPlaceholderText("Ví dụ: 09:00, 15:00, 21:00")
        self.input_ai_schedule_times.setStyleSheet("background-color: #0d0d0d; color: #ffffff; border: 1px solid #ff3366; border-radius: 4px; padding: 4px;")
        layout_sched.addWidget(self.chk_ai_schedule)
        layout_sched.addWidget(QLabel("Khung giờ đăng bài trong ngày (cách nhau bằng dấu phẩy):"))
        layout_sched.addWidget(self.input_ai_schedule_times)
        group_sched.setLayout(layout_sched)
        col_left_ai.addWidget(group_sched)
        
        top_layout.addLayout(col_left_ai, 45)

        # Cột phải AI: Bảng chọn AI và các nút chọn
        col_right_table = QVBoxLayout()
        
        # Thanh công cụ bảng AI
        box_ai_controls = QHBoxLayout()
        btn_ai_select_all = QPushButton("☑ Chọn Tất Cả AI")
        btn_ai_select_all.setProperty("class", "neon-green")
        btn_ai_deselect_all = QPushButton("☐ Bỏ Chọn Tất Cả")
        btn_ai_deselect_all.setProperty("class", "neon-red")
        
        btn_ai_select_all.clicked.connect(self.ai_select_all)
        btn_ai_deselect_all.clicked.connect(self.ai_deselect_all)
        
        box_ai_controls.addWidget(btn_ai_select_all)
        box_ai_controls.addWidget(btn_ai_deselect_all)
        box_ai_controls.addStretch()
        
        col_right_table.addLayout(box_ai_controls)

        # Bảng hiển thị danh sách trang chạy AI
        self.table_ai = QTableWidget()
        self.table_ai.setColumnCount(3)
        self.table_ai.setHorizontalHeaderLabels(["Chạy AI", "Tên Fanpage", "Từ khóa tìm kiếm ảnh / Chủ đề viết bài"])
        self.table_ai.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table_ai.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.table_ai.verticalHeader().setVisible(True)
        self.table_ai.verticalHeader().setDefaultSectionSize(35)
        self.table_ai.setSelectionBehavior(QTableWidget.SelectRows)
        
        col_right_table.addWidget(self.table_ai)
        
        top_layout.addLayout(col_right_table, 55)

        main_layout.addLayout(top_layout, 1)

        # Khung prompt AI ở dưới cùng (dàn trải hết chiều ngang)
        group_prompt = QGroupBox("Cấu hình Khung Prompt AI cấu trúc bài đăng")
        layout_prompt = QVBoxLayout()
        layout_prompt.setContentsMargins(10, 8, 10, 8)
        layout_prompt.setSpacing(6)
        self.text_prompt = QTextEdit()
        default_prompt = """Bạn là chuyên gia tối ưu hóa nội dung truyền thông đại chúng thế hệ mới trên mạng xã hội Facebook.
Hãy phân tích cẩn thận định hướng ngách nội dung độc bản dựa hoàn toàn trên tên thương hiệu của từng Fanpage được cung cấp. Viết nội dung mang tính viral cao, chia sẻ kiến thức sâu sắc hoặc mẹo vặt thực tế đời sống. Trình bày tối ưu cấu trúc bài đăng Facebook (tiêu đề in hoa nổi bật kèm biểu tượng emoji, chia nhỏ 2-3 đoạn ngắn dễ đọc, kèm lời kêu gọi hành động tương tác và 3-5 hashtag cốt lõi).

QUY ĐỊNH ĐẦU RA SẮT ĐÁ: Trả về văn bản thuần túy, tuyệt đối cấm sử dụng các block mã code markdown như ```text hay ```. Phải tuân thủ cấu trúc phân tách khối văn bản chính xác."""
        self.text_prompt.setText(default_prompt)
        self.text_prompt.setMaximumHeight(150)
        layout_prompt.addWidget(self.text_prompt)
        group_prompt.setLayout(layout_prompt)
        
        main_layout.addWidget(group_prompt, 0)

        # Kết nối tín hiệu tự động lưu cấu hình
        self.input_key_file.textChanged.connect(self.save_config)
        self.input_pixabay.textChanged.connect(self.save_config)
        self.combo_fb.currentTextChanged.connect(self.save_config)
        self.combo_model.currentTextChanged.connect(self.save_config)
        self.input_sheet_id.textChanged.connect(self.save_config)
        self.input_creds_path.textChanged.connect(self.save_config)
        self.text_prompt.textChanged.connect(self.save_config)
        self.chk_ai_schedule.stateChanged.connect(self.save_config)
        self.input_ai_schedule_times.textChanged.connect(self.save_config)

        # Tải cấu hình đã lưu
        self.load_config()

    def browse_key_file(self):
        fname, _ = QFileDialog.getOpenFileName(self, 'Chọn file danh sách keys.txt', '', 'Text Files (*.txt);;All Files (*)')
        if fname:
            self.input_key_file.setText(fname)

    def browse_creds(self):
        fname, _ = QFileDialog.getOpenFileName(self, 'Chọn file credentials.json Google Cloud', '', 'JSON Files (*.json);;All Files (*)')
        if fname:
            self.input_creds_path.setText(fname)

    def load_pages(self, pages_list):
        self.table_ai.setRowCount(0)
        self.table_ai.setRowCount(len(pages_list))

        for idx, page in enumerate(pages_list):
            page_name = page.get("name", "Unknown Page")
            ai_keyword = page.get("ai_keyword", page_name)
            
            ai_enabled = page.get("ai_enabled")
            if ai_enabled is None:
                ai_enabled = (page.get("post_type") == "ai")

            chk_ai = QCheckBox()
            chk_ai.setChecked(bool(ai_enabled))
            self.table_ai.setCellWidget(idx, 0, chk_ai)

            self.table_ai.setItem(idx, 1, QTableWidgetItem(page_name))

            txt_keyword = QLineEdit(ai_keyword)
            txt_keyword.setStyleSheet("padding: 3px 6px;")
            self.table_ai.setCellWidget(idx, 2, txt_keyword)

    def get_page_selection(self, idx):
        chk = self.table_ai.cellWidget(idx, 0)
        txt = self.table_ai.cellWidget(idx, 2)
        is_checked = chk.isChecked() if chk else False
        keyword = txt.text().strip() if txt else ""
        return is_checked, keyword

    def ai_select_all(self):
        for row in range(self.table_ai.rowCount()):
            chk = self.table_ai.cellWidget(row, 0)
            if chk:
                chk.setChecked(True)

    def ai_deselect_all(self):
        for row in range(self.table_ai.rowCount()):
            chk = self.table_ai.cellWidget(row, 0)
            if chk:
                chk.setChecked(False)

    # Getter methods
    def get_prompt_template(self):
        return self.text_prompt.toPlainText()

    def get_model_name(self):
        return self.combo_model.currentText()

    def get_fb_version(self):
        return self.combo_fb.currentText()

    def get_creds_file(self):
        return self.input_creds_path.text().strip()

    def get_sheet_id(self):
        return self.input_sheet_id.text().strip()

    def get_pixabay_key(self):
        return self.input_pixabay.text().strip()

    def get_key_file_path(self):
        return self.input_key_file.text().strip()

    def load_config(self):
        if os.path.exists("gui_config.json"):
            try:
                with open("gui_config.json", 'r', encoding='utf-8') as f:
                    config = json.load(f)
                
                # Chặn kết nối đè ngược khi load dữ liệu để tránh gọi save_config vô hạn
                self.input_key_file.blockSignals(True)
                self.input_pixabay.blockSignals(True)
                self.combo_fb.blockSignals(True)
                self.combo_model.blockSignals(True)
                self.input_sheet_id.blockSignals(True)
                self.input_creds_path.blockSignals(True)
                self.text_prompt.blockSignals(True)
                self.chk_ai_schedule.blockSignals(True)
                self.input_ai_schedule_times.blockSignals(True)

                self.input_key_file.setText(config.get("gemini_key_file", "keys.txt"))
                self.input_pixabay.setText(config.get("pixabay_key", "ĐIỀN_KEY_PIXABAY_VÀO_ĐÂY"))
                
                fb_ver = config.get("fb_api_version", "v25.0")
                idx_fb = self.combo_fb.findText(fb_ver)
                if idx_fb >= 0:
                    self.combo_fb.setCurrentIndex(idx_fb)
                    
                model = config.get("gemini_model", "gemini-3.5-flash")
                idx_model = self.combo_model.findText(model)
                if idx_model >= 0:
                    self.combo_model.setCurrentIndex(idx_model)
                    
                self.input_sheet_id.setText(config.get("google_sheet_id", ""))
                self.input_creds_path.setText(config.get("google_sheet_creds_path", ""))
                
                saved_prompt = config.get("prompt_template", "")
                if saved_prompt:
                    self.text_prompt.setText(saved_prompt)
                
                self.chk_ai_schedule.setChecked(config.get("ai_schedule_enabled", False))
                self.input_ai_schedule_times.setText(config.get("ai_schedule_times", "09:00, 15:00, 21:00"))

                self.input_key_file.blockSignals(False)
                self.input_pixabay.blockSignals(False)
                self.combo_fb.blockSignals(False)
                self.combo_model.blockSignals(False)
                self.input_sheet_id.blockSignals(False)
                self.input_creds_path.blockSignals(False)
                self.text_prompt.blockSignals(False)
                self.chk_ai_schedule.blockSignals(False)
                self.input_ai_schedule_times.blockSignals(False)
            except Exception:
                pass

    def save_config(self):
        config = {}
        if os.path.exists("gui_config.json"):
            try:
                with open("gui_config.json", 'r', encoding='utf-8') as f:
                    config = json.load(f)
            except Exception:
                pass
        
        config["gemini_key_file"] = self.input_key_file.text().strip()
        config["pixabay_key"] = self.input_pixabay.text().strip()
        config["fb_api_version"] = self.combo_fb.currentText()
        config["gemini_model"] = self.combo_model.currentText()
        config["google_sheet_id"] = self.input_sheet_id.text().strip()
        config["google_sheet_creds_path"] = self.input_creds_path.text().strip()
        config["prompt_template"] = self.text_prompt.toPlainText()
        config["ai_schedule_enabled"] = self.chk_ai_schedule.isChecked()
        config["ai_schedule_times"] = self.input_ai_schedule_times.text().strip()
        
        try:
            with open("gui_config.json", 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=4)
        except Exception:
            pass
