# -*- coding: utf-8 -*-
"""
File: gui/tab_reels.py
"""
import os
from PyQt5.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
                             QPushButton, QComboBox, QFileDialog, QTableWidget, 
                             QTableWidgetItem, QCheckBox, QHeaderView, QMessageBox, QLineEdit)
from PyQt5.QtCore import Qt

from config.styles_reels import REELS_STYLE_QSS

class ReelsTab(QWidget):
    def __init__(self, main_window, parent=None):
        super().__init__(parent)
        self.main_window = main_window
        self.initUI()
        self.load_config()
        self.chk_reels_schedule.stateChanged.connect(self.save_config)
        self.input_reels_schedule_times.textChanged.connect(self.save_config)

    def initUI(self):
        # Apply Reels-specific styles
        self.setStyleSheet(REELS_STYLE_QSS)

        layout_tab_reels = QVBoxLayout(self)
        layout_tab_reels.setContentsMargins(10, 10, 10, 10)
        
        # Chọn thư mục gốc Reels
        box_reels_root = QHBoxLayout()
        self.btn_reels_root = QPushButton("📂 Chọn Thư mục Gốc...")
        self.btn_reels_root.setProperty("class", "neon-blue")
        self.btn_reels_root.clicked.connect(self.choose_reels_root)
        self.lbl_reels_root = QLabel(f"Đã chọn: {self.main_window.reels_root_dir if self.main_window.reels_root_dir else 'Chưa chọn'}")
        self.lbl_reels_root.setStyleSheet("font-weight: bold; color: #45f3ff;")
        box_reels_root.addWidget(self.btn_reels_root)
        box_reels_root.addWidget(self.lbl_reels_root)
        box_reels_root.addStretch()
        layout_tab_reels.addLayout(box_reels_root)

        # Hẹn giờ đăng Reels
        box_reels_schedule = QHBoxLayout()
        self.chk_reels_schedule = QCheckBox("Kích hoạt hẹn giờ đăng (Reels)")
        self.chk_reels_schedule.setStyleSheet("font-weight: bold; color: #ff3366;")
        self.input_reels_schedule_times = QLineEdit("08:00, 12:00, 18:00, 21:00")
        self.input_reels_schedule_times.setPlaceholderText("Ví dụ: 08:00, 12:00, 18:00, 21:00")
        self.input_reels_schedule_times.setStyleSheet("background-color: #0d0d0d; color: #ffffff; border: 1px solid #ff3366; border-radius: 4px; padding: 4px;")
        self.input_reels_schedule_times.setMinimumWidth(300)
        box_reels_schedule.addWidget(self.chk_reels_schedule)
        box_reels_schedule.addWidget(QLabel("Các khung giờ đăng:"))
        box_reels_schedule.addWidget(self.input_reels_schedule_times)
        box_reels_schedule.addStretch()
        layout_tab_reels.addLayout(box_reels_schedule)

        # Thanh công cụ chọn nhanh / hàng loạt cho Reels
        box_reels_controls = QHBoxLayout()
        btn_reels_select_all = QPushButton("☑ Chọn Tất Cả")
        btn_reels_select_all.setProperty("class", "neon-green")
        btn_reels_deselect_all = QPushButton("☐ Bỏ Chọn Tất Cả")
        btn_reels_deselect_all.setProperty("class", "neon-red")
        
        btn_reels_select_all.clicked.connect(self.reels_select_all)
        btn_reels_deselect_all.clicked.connect(self.reels_deselect_all)
        
        box_reels_controls.addWidget(btn_reels_select_all)
        box_reels_controls.addWidget(btn_reels_deselect_all)
        
        box_reels_controls.addWidget(QLabel(" |  Dòng bôi đen:"))
        btn_reels_check_sel = QPushButton("☑ Tích Chọn")
        btn_reels_check_sel.setProperty("class", "neon-green")
        btn_reels_uncheck_sel = QPushButton("☐ Bỏ Tích")
        btn_reels_uncheck_sel.setProperty("class", "neon-red")
        self.combo_bulk_reels = QComboBox()
        self.combo_bulk_reels.setMinimumWidth(150)
        btn_reels_assign_sel = QPushButton("⚙ Gán Thư Mục")
        btn_reels_assign_sel.setProperty("class", "neon-blue")
        btn_reels_auto_match = QPushButton("⚡ Tự Động Gán Theo Tên")
        btn_reels_auto_match.setProperty("class", "neon-blue")
        
        btn_reels_check_sel.clicked.connect(self.reels_check_selected)
        btn_reels_uncheck_sel.clicked.connect(self.reels_uncheck_selected)
        btn_reels_assign_sel.clicked.connect(self.reels_assign_selected)
        btn_reels_auto_match.clicked.connect(self.reels_auto_match)
        
        box_reels_controls.addWidget(btn_reels_check_sel)
        box_reels_controls.addWidget(btn_reels_uncheck_sel)
        box_reels_controls.addWidget(self.combo_bulk_reels)
        box_reels_controls.addWidget(btn_reels_assign_sel)
        box_reels_controls.addWidget(btn_reels_auto_match)
        box_reels_controls.addStretch()
        layout_tab_reels.addLayout(box_reels_controls)
        
        # Bảng hiển thị danh sách trang cho Reels
        self.table_reels = QTableWidget()
        self.table_reels.setColumnCount(4)
        self.table_reels.setHorizontalHeaderLabels(["Chạy", "Tên Fanpage", "Bộ Nội dung (Thư mục con)", "Trạng thái Gán"])
        self.table_reels.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.table_reels.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.table_reels.verticalHeader().setVisible(True)
        self.table_reels.verticalHeader().setDefaultSectionSize(35)
        self.table_reels.setSelectionBehavior(QTableWidget.SelectRows)
        layout_tab_reels.addWidget(self.table_reels)

    def choose_reels_root(self):
        dir_path = QFileDialog.getExistingDirectory(self, "Chọn Thư mục Gốc chứa Video Reels")
        if dir_path:
            self.main_window.reels_root_dir = os.path.abspath(dir_path)
            self.lbl_reels_root.setText(f"Đã chọn: {self.main_window.reels_root_dir}")
            from config.settings import save_gui_configs
            save_gui_configs(self.main_window.reels_root_dir, self.main_window.video_root_dir)
            self.main_window.load_pages_to_tables()

    def load_pages(self, pages_list):
        self.table_reels.setRowCount(0)
        self.table_reels.setRowCount(len(pages_list))

        reels_subdirs = []
        if self.main_window.reels_root_dir and os.path.exists(self.main_window.reels_root_dir):
            try:
                reels_subdirs = [d for d in os.listdir(self.main_window.reels_root_dir) 
                                 if os.path.isdir(os.path.join(self.main_window.reels_root_dir, d))]
            except Exception:
                pass

        self.combo_bulk_reels.clear()
        self.combo_bulk_reels.addItem("")
        for d in reels_subdirs:
            self.combo_bulk_reels.addItem(d)

        for idx, page in enumerate(pages_list):
            page_name = page.get("name", "Unknown Page")
            
            reels_enabled = page.get("reels_enabled")
            if reels_enabled is None:
                reels_enabled = (page.get("post_type") == "reel")

            reels_folder = page.get("reels_folder")
            if reels_folder is None:
                if page.get("post_type") == "reel":
                    reels_folder = page.get("video_folder", "")
                else:
                    reels_folder = ""

            chk_reel = QCheckBox()
            self.table_reels.setCellWidget(idx, 0, chk_reel)
            self.table_reels.setItem(idx, 1, QTableWidgetItem(page_name))

            combo_reel = QComboBox()
            combo_reel.addItem("")
            for d in reels_subdirs:
                combo_reel.addItem(d)
            self.table_reels.setCellWidget(idx, 2, combo_reel)

            lbl_status_reel = QLabel("Chưa gán")
            lbl_status_reel.setStyleSheet("color: #ff3366; font-weight: bold; background-color: transparent;")
            lbl_status_reel.setAlignment(Qt.AlignCenter)
            self.table_reels.setCellWidget(idx, 3, lbl_status_reel)

            # Signal connections
            combo_reel.currentTextChanged.connect(
                lambda text, cb=chk_reel, lbl=lbl_status_reel: self.on_combo_changed(text, cb, lbl)
            )
            chk_reel.stateChanged.connect(
                lambda state, combo=combo_reel: self.on_checkbox_changed(state, combo)
            )

            # Fill existing mapping if matched, or fallback to auto-matching by page name
            has_assigned = False
            if reels_folder and os.path.exists(reels_folder):
                subfolder_name = os.path.basename(reels_folder)
                idx_in_combo = combo_reel.findText(subfolder_name)
                if idx_in_combo >= 0:
                    combo_reel.setCurrentIndex(idx_in_combo)
                    chk_reel.setChecked(bool(reels_enabled))
                    lbl_status_reel.setText("Đã gán")
                    lbl_status_reel.setStyleSheet("color: #00ff66; font-weight: bold; background-color: transparent;")
                    has_assigned = True

            if not has_assigned:
                # Tự động gán nếu trùng tên (không phân biệt hoa thường)
                for d in reels_subdirs:
                    if d.strip().lower() == page_name.strip().lower():
                        idx_in_combo = combo_reel.findText(d)
                        if idx_in_combo >= 0:
                            combo_reel.setCurrentIndex(idx_in_combo)
                            chk_reel.setChecked(True)
                            lbl_status_reel.setText("Đã gán (Tự động)")
                            lbl_status_reel.setStyleSheet("color: #00ff66; font-weight: bold; background-color: transparent;")
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
        chk = self.table_reels.cellWidget(idx, 0)
        combo = self.table_reels.cellWidget(idx, 2)
        is_checked = chk.isChecked() if chk else False
        subfolder = combo.currentText().strip() if combo else ""
        return is_checked, subfolder

    # --- Bulk action handlers ---
    def reels_select_all(self):
        for row in range(self.table_reels.rowCount()):
            chk = self.table_reels.cellWidget(row, 0)
            if chk:
                chk.setChecked(True)

    def reels_deselect_all(self):
        for row in range(self.table_reels.rowCount()):
            chk = self.table_reels.cellWidget(row, 0)
            if chk:
                chk.setChecked(False)

    def reels_check_selected(self):
        selected_rows = set()
        for range_ in self.table_reels.selectedRanges():
            for r in range(range_.topRow(), range_.bottomRow() + 1):
                selected_rows.add(r)
        if not selected_rows:
            QMessageBox.information(self, "Thông báo", "Vui lòng bôi đen (chọn) các dòng trong bảng Reels trước!")
            return
        for r in selected_rows:
            chk = self.table_reels.cellWidget(r, 0)
            if chk:
                chk.setChecked(True)

    def reels_uncheck_selected(self):
        selected_rows = set()
        for range_ in self.table_reels.selectedRanges():
            for r in range(range_.topRow(), range_.bottomRow() + 1):
                selected_rows.add(r)
        if not selected_rows:
            QMessageBox.information(self, "Thông báo", "Vui lòng bôi đen (chọn) các dòng trong bảng Reels trước!")
            return
        for r in selected_rows:
            chk = self.table_reels.cellWidget(r, 0)
            if chk:
                chk.setChecked(False)

    def reels_assign_selected(self):
        selected_rows = set()
        for range_ in self.table_reels.selectedRanges():
            for r in range(range_.topRow(), range_.bottomRow() + 1):
                selected_rows.add(r)
        if not selected_rows:
            QMessageBox.information(self, "Thông báo", "Vui lòng bôi đen (chọn) các dòng trong bảng Reels trước!")
            return
        target_dir = self.combo_bulk_reels.currentText()
        for r in selected_rows:
            combo = self.table_reels.cellWidget(r, 2)
            if combo:
                idx = combo.findText(target_dir)
                if idx >= 0:
                    combo.setCurrentIndex(idx)

    def reels_auto_match(self):
        matched_count = 0
        for row in range(self.table_reels.rowCount()):
            page_name_item = self.table_reels.item(row, 1)
            if not page_name_item:
                continue
            page_name = page_name_item.text().strip().lower()
            
            combo = self.table_reels.cellWidget(row, 2)
            chk = self.table_reels.cellWidget(row, 0)
            lbl = self.table_reels.cellWidget(row, 3)
            
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
                self.chk_reels_schedule.blockSignals(True)
                self.input_reels_schedule_times.blockSignals(True)
                
                self.chk_reels_schedule.setChecked(config.get("reels_schedule_enabled", False))
                self.input_reels_schedule_times.setText(config.get("reels_schedule_times", "08:00, 12:00, 18:00, 21:00"))
                
                self.chk_reels_schedule.blockSignals(False)
                self.input_reels_schedule_times.blockSignals(False)
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
        config["reels_schedule_enabled"] = self.chk_reels_schedule.isChecked()
        config["reels_schedule_times"] = self.input_reels_schedule_times.text().strip()
        try:
            with open("gui_config.json", 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=4)
        except Exception:
            pass
