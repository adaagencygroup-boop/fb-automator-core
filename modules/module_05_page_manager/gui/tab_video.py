# -*- coding: utf-8 -*-
"""
File: gui/tab_video.py
"""
import os
from PyQt5.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
                             QPushButton, QComboBox, QFileDialog, QTableWidget, 
                             QTableWidgetItem, QCheckBox, QHeaderView, QMessageBox, QLineEdit)
from PyQt5.QtCore import Qt

from config.styles_video import VIDEO_STYLE_QSS

class VideoTab(QWidget):
    def __init__(self, main_window, parent=None):
        super().__init__(parent)
        self.main_window = main_window
        self.initUI()
        self.load_config()
        self.chk_video_schedule.stateChanged.connect(self.save_config)
        self.input_video_schedule_times.textChanged.connect(self.save_config)

    def initUI(self):
        # Apply Video-specific styles
        self.setStyleSheet(VIDEO_STYLE_QSS)

        layout_tab_video = QVBoxLayout(self)
        layout_tab_video.setContentsMargins(10, 10, 10, 10)
        
        # Chọn thư mục gốc Video dài
        box_video_root = QHBoxLayout()
        self.btn_video_root = QPushButton("📂 Chọn Thư mục Gốc...")
        self.btn_video_root.setProperty("class", "neon-blue")
        self.btn_video_root.clicked.connect(self.choose_video_root)
        self.lbl_video_root = QLabel(f"Đã chọn: {self.main_window.video_root_dir if self.main_window.video_root_dir else 'Chưa chọn'}")
        self.lbl_video_root.setStyleSheet("font-weight: bold; color: #45f3ff;")
        box_video_root.addWidget(self.btn_video_root)
        box_video_root.addWidget(self.lbl_video_root)
        box_video_root.addStretch()
        layout_tab_video.addLayout(box_video_root)

        # Hẹn giờ đăng Video dài
        box_video_schedule = QHBoxLayout()
        self.chk_video_schedule = QCheckBox("Kích hoạt hẹn giờ đăng (Video Dài)")
        self.chk_video_schedule.setStyleSheet("font-weight: bold; color: #ff3366;")
        self.input_video_schedule_times = QLineEdit("19:00")
        self.input_video_schedule_times.setPlaceholderText("Ví dụ: 19:00")
        self.input_video_schedule_times.setStyleSheet("background-color: #0d0d0d; color: #ffffff; border: 1px solid #ff3366; border-radius: 4px; padding: 4px;")
        self.input_video_schedule_times.setMinimumWidth(300)
        box_video_schedule.addWidget(self.chk_video_schedule)
        box_video_schedule.addWidget(QLabel("Các khung giờ đăng:"))
        box_video_schedule.addWidget(self.input_video_schedule_times)
        box_video_schedule.addStretch()
        layout_tab_video.addLayout(box_video_schedule)

        # Thanh công cụ chọn nhanh / hàng loạt cho Video dài
        box_video_controls = QHBoxLayout()
        btn_video_select_all = QPushButton("☑ Chọn Tất Cả")
        btn_video_select_all.setProperty("class", "neon-green")
        btn_video_deselect_all = QPushButton("☐ Bỏ Chọn Tất Cả")
        btn_video_deselect_all.setProperty("class", "neon-red")
        
        btn_video_select_all.clicked.connect(self.video_select_all)
        btn_video_deselect_all.clicked.connect(self.video_deselect_all)
        
        box_video_controls.addWidget(btn_video_select_all)
        box_video_controls.addWidget(btn_video_deselect_all)
        
        box_video_controls.addWidget(QLabel(" |  Dòng bôi đen:"))
        btn_video_check_sel = QPushButton("☑ Tích Chọn")
        btn_video_check_sel.setProperty("class", "neon-green")
        btn_video_uncheck_sel = QPushButton("☐ Bỏ Tích")
        btn_video_uncheck_sel.setProperty("class", "neon-red")
        self.combo_bulk_video = QComboBox()
        self.combo_bulk_video.setMinimumWidth(150)
        btn_video_assign_sel = QPushButton("⚙ Gán Thư Mục")
        btn_video_assign_sel.setProperty("class", "neon-blue")
        btn_video_auto_match = QPushButton("⚡ Tự Động Gán Theo Tên")
        btn_video_auto_match.setProperty("class", "neon-blue")
        
        btn_video_check_sel.clicked.connect(self.video_check_selected)
        btn_video_uncheck_sel.clicked.connect(self.video_uncheck_selected)
        btn_video_assign_sel.clicked.connect(self.video_assign_selected)
        btn_video_auto_match.clicked.connect(self.video_auto_match)
        
        box_video_controls.addWidget(btn_video_check_sel)
        box_video_controls.addWidget(btn_video_uncheck_sel)
        box_video_controls.addWidget(self.combo_bulk_video)
        box_video_controls.addWidget(btn_video_assign_sel)
        box_video_controls.addWidget(btn_video_auto_match)
        box_video_controls.addStretch()
        layout_tab_video.addLayout(box_video_controls)
        
        # Bảng hiển thị danh sách trang cho Video
        self.table_video = QTableWidget()
        self.table_video.setColumnCount(4)
        self.table_video.setHorizontalHeaderLabels(["Chạy", "Tên Fanpage", "Bộ Nội dung (Thư mục con)", "Trạng thái Gán"])
        self.table_video.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table_video.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.table_video.verticalHeader().setVisible(True)
        self.table_video.verticalHeader().setDefaultSectionSize(35)
        self.table_video.setSelectionBehavior(QTableWidget.SelectRows)
        layout_tab_video.addWidget(self.table_video)

    def choose_video_root(self):
        dir_path = QFileDialog.getExistingDirectory(self, "Chọn Thư mục Gốc chứa Video Dài")
        if dir_path:
            self.main_window.video_root_dir = os.path.abspath(dir_path)
            self.lbl_video_root.setText(f"Đã chọn: {self.main_window.video_root_dir}")
            from config.settings import save_gui_configs
            save_gui_configs(self.main_window.reels_root_dir, self.main_window.video_root_dir)
            self.main_window.load_pages_to_tables()

    def load_pages(self, pages_list):
        self.table_video.setRowCount(0)
        self.table_video.setRowCount(len(pages_list))

        video_subdirs = []
        if self.main_window.video_root_dir and os.path.exists(self.main_window.video_root_dir):
            try:
                video_subdirs = [d for d in os.listdir(self.main_window.video_root_dir) 
                                 if os.path.isdir(os.path.join(self.main_window.video_root_dir, d))]
            except Exception:
                pass

        self.combo_bulk_video.clear()
        self.combo_bulk_video.addItem("")
        for d in video_subdirs:
            self.combo_bulk_video.addItem(d)

        for idx, page in enumerate(pages_list):
            page_name = page.get("name", "Unknown Page")
            
            video_enabled = page.get("video_enabled")
            if video_enabled is None:
                video_enabled = (page.get("post_type") == "video")

            video_folder = page.get("video_folder", "")
            # If it was a legacy reels page, the video_folder field was actually reels folder.
            if page.get("post_type") == "reel" and "reels_folder" not in page:
                video_folder = ""

            chk_vid = QCheckBox()
            self.table_video.setCellWidget(idx, 0, chk_vid)
            self.table_video.setItem(idx, 1, QTableWidgetItem(page_name))

            combo_vid = QComboBox()
            combo_vid.addItem("")
            for d in video_subdirs:
                combo_vid.addItem(d)
            self.table_video.setCellWidget(idx, 2, combo_vid)

            lbl_status_vid = QLabel("Chưa gán")
            lbl_status_vid.setStyleSheet("color: #ff3366; font-weight: bold; background-color: transparent;")
            lbl_status_vid.setAlignment(Qt.AlignCenter)
            self.table_video.setCellWidget(idx, 3, lbl_status_vid)

            # Signal connections
            combo_vid.currentTextChanged.connect(
                lambda text, cb=chk_vid, lbl=lbl_status_vid: self.on_combo_changed(text, cb, lbl)
            )
            chk_vid.stateChanged.connect(
                lambda state, combo=combo_vid: self.on_checkbox_changed(state, combo)
            )

            # Fill existing mapping if matched, or fallback to auto-matching by page name
            has_assigned = False
            if video_folder and os.path.exists(video_folder):
                subfolder_name = os.path.basename(video_folder)
                idx_in_combo = combo_vid.findText(subfolder_name)
                if idx_in_combo >= 0:
                    combo_vid.setCurrentIndex(idx_in_combo)
                    chk_vid.setChecked(bool(video_enabled))
                    lbl_status_vid.setText("Đã gán")
                    lbl_status_vid.setStyleSheet("color: #00ff66; font-weight: bold; background-color: transparent;")
                    has_assigned = True

            if not has_assigned:
                # Tự động gán nếu trùng tên (không phân biệt hoa thường)
                for d in video_subdirs:
                    if d.strip().lower() == page_name.strip().lower():
                        idx_in_combo = combo_vid.findText(d)
                        if idx_in_combo >= 0:
                            combo_vid.setCurrentIndex(idx_in_combo)
                            chk_vid.setChecked(True)
                            lbl_status_vid.setText("Đã gán (Tự động)")
                            lbl_status_vid.setStyleSheet("color: #00ff66; font-weight: bold; background-color: transparent;")
                            break

    def on_combo_changed(self, text, checkbox, label_status):
        if text:
            label_status.setText("Đã gán")
            label_status.setStyleSheet("color: #00ff66; font-weight: bold; background-color: transparent;")
            checkbox.setChecked(True)
        else:
            label_status.setText("Chưa gán")
            label_status.setStyleSheet("color: #ff3366; font-weight: bold; background-color: transparent;")
            checkbox.setChecked(False)

    def on_checkbox_changed(self, state, combo):
        if state == Qt.Unchecked:
            combo.setCurrentIndex(0)

    def get_page_selection(self, idx):
        chk = self.table_video.cellWidget(idx, 0)
        combo = self.table_video.cellWidget(idx, 2)
        is_checked = chk.isChecked() if chk else False
        subfolder = combo.currentText().strip() if combo else ""
        return is_checked, subfolder

    # --- Bulk action handlers ---
    def video_select_all(self):
        for row in range(self.table_video.rowCount()):
            chk = self.table_video.cellWidget(row, 0)
            if chk:
                chk.setChecked(True)

    def video_deselect_all(self):
        for row in range(self.table_video.rowCount()):
            chk = self.table_video.cellWidget(row, 0)
            if chk:
                chk.setChecked(False)

    def video_check_selected(self):
        selected_rows = set()
        for range_ in self.table_video.selectedRanges():
            for r in range(range_.topRow(), range_.bottomRow() + 1):
                selected_rows.add(r)
        if not selected_rows:
            QMessageBox.information(self, "Thông báo", "Vui lòng bôi đen (chọn) các dòng trong bảng Video trước!")
            return
        for r in selected_rows:
            chk = self.table_video.cellWidget(r, 0)
            if chk:
                chk.setChecked(True)

    def video_uncheck_selected(self):
        selected_rows = set()
        for range_ in self.table_video.selectedRanges():
            for r in range(range_.topRow(), range_.bottomRow() + 1):
                selected_rows.add(r)
        if not selected_rows:
            QMessageBox.information(self, "Thông báo", "Vui lòng bôi đen (chọn) các dòng trong bảng Video trước!")
            return
        for r in selected_rows:
            chk = self.table_video.cellWidget(r, 0)
            if chk:
                chk.setChecked(False)

    def video_assign_selected(self):
        selected_rows = set()
        for range_ in self.table_video.selectedRanges():
            for r in range(range_.topRow(), range_.bottomRow() + 1):
                selected_rows.add(r)
        if not selected_rows:
            QMessageBox.information(self, "Thông báo", "Vui lòng bôi đen (chọn) các dòng trong bảng Video trước!")
            return
        target_dir = self.combo_bulk_video.currentText()
        for r in selected_rows:
            combo = self.table_video.cellWidget(r, 2)
            if combo:
                idx = combo.findText(target_dir)
                if idx >= 0:
                    combo.setCurrentIndex(idx)

    def video_auto_match(self):
        matched_count = 0
        for row in range(self.table_video.rowCount()):
            page_name_item = self.table_video.item(row, 1)
            if not page_name_item:
                continue
            page_name = page_name_item.text().strip().lower()
            
            combo = self.table_video.cellWidget(row, 2)
            chk = self.table_video.cellWidget(row, 0)
            lbl = self.table_video.cellWidget(row, 3)
            
            if combo and chk and lbl:
                for i in range(combo.count()):
                    item_text = combo.itemText(i).strip().lower()
                    if item_text and item_text == page_name:
                        combo.setCurrentIndex(i)
                        chk.setChecked(True)
                        lbl.setText("Đã gán (Tự động)")
                        lbl.setStyleSheet("color: #00ff66; font-weight: bold; background-color: transparent;")
                        matched_count += 1
                        break
        QMessageBox.information(self, "Tự động gán", f"Đã tự động gán thành công {matched_count} thư mục có tên khớp với tên Fanpage!")

    def load_config(self):
        if os.path.exists("gui_config.json"):
            try:
                with open("gui_config.json", 'r', encoding='utf-8') as f:
                    config = json.load(f)
                self.chk_video_schedule.blockSignals(True)
                self.input_video_schedule_times.blockSignals(True)
                
                self.chk_video_schedule.setChecked(config.get("video_schedule_enabled", False))
                self.input_video_schedule_times.setText(config.get("video_schedule_times", "19:00"))
                
                self.chk_video_schedule.blockSignals(False)
                self.input_video_schedule_times.blockSignals(False)
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
        config["video_schedule_enabled"] = self.chk_video_schedule.isChecked()
        config["video_schedule_times"] = self.input_video_schedule_times.text().strip()
        try:
            with open("gui_config.json", 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=4)
        except Exception:
            pass
