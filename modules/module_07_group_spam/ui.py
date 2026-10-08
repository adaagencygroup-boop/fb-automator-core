"""
Module 7: Spam Group (Đăng & Bình luận Hội nhóm)
Phụ trách: Anh
Chức năng: Quét nhóm theo từ khóa, tham gia nhóm, đăng bài tự động, bình luận dạo
"""
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, 
    QTextEdit, QSpinBox, QComboBox, QFrame, QTableWidget, 
    QTableWidgetItem, QHeaderView, QMessageBox
)
from core.base_module import BaseModuleTab
from core.database.connection import db
from modules.module_07_group_spam.worker import GroupSpamWorker

class GroupSpamTab(BaseModuleTab):
    def __init__(self, parent=None):
        super().__init__(
            module_id="module_07_group_spam",
            module_title="Spam & Tương Tác Hội Nhóm (Group)",
            author="Anh",
            parent=parent
        )

    def init_ui(self):
        # Action Toolbar trên Header
        self.btn_start = QPushButton("▶ Bắt Đầu Đăng Nhóm")
        self.btn_start.setProperty("class", "btn-primary")
        self.btn_start.clicked.connect(self.start_group_action)
        self.header_actions_layout.addWidget(self.btn_start)

        self.btn_stop = QPushButton("⏹ Dừng Lại")
        self.btn_stop.setProperty("class", "btn-danger")
        self.btn_stop.setEnabled(False)
        self.btn_stop.clicked.connect(self.stop_action)
        self.header_actions_layout.addWidget(self.btn_stop)

        # Cấu hình đăng nhóm
        card_config = QFrame()
        card_config.setProperty("class", "card")
        layout_cfg = QVBoxLayout(card_config)

        row_type = QHBoxLayout()
        row_type.addWidget(QLabel("Hình thức tương tác:"))
        self.cb_action_type = QComboBox()
        self.cb_action_type.addItems(["Đăng bài lên nhóm (POST)", "Bình luận dạo bài hot (COMMENT)"])
        row_type.addWidget(self.cb_action_type)

        row_type.addWidget(QLabel("Giãn cách (giây):"))
        self.spn_delay = QSpinBox()
        self.spn_delay.setRange(5, 300)
        self.spn_delay.setValue(15)
        row_type.addWidget(self.spn_delay)
        row_type.addStretch()
        layout_cfg.addLayout(row_type)

        layout_cfg.addWidget(QLabel("Nội dung bài đăng / bình luận (Hỗ trợ Spin syntax {a|b|c}):"))
        self.txt_content = QTextEdit()
        self.txt_content.setPlaceholderText("Chào mọi người {nhé|ạ}! Hôm nay em xin phép chia sẻ bí quyết...")
        self.txt_content.setMaximumHeight(90)
        layout_cfg.addWidget(self.txt_content)

        layout_cfg.addWidget(QLabel("Danh sách ID Nhóm mục tiêu (Mỗi dòng 1 ID nhóm):"))
        self.txt_groups = QTextEdit()
        self.txt_groups.setPlaceholderText("1049284729182\n9283749281742\n4829104829102")
        self.txt_groups.setMaximumHeight(90)
        layout_cfg.addWidget(self.txt_groups)

        self.main_layout.addWidget(card_config)

        # Bảng lịch sử đăng nhóm
        lbl_hist = QLabel("📊 NHẬT KÝ ĐĂNG NHÓM")
        lbl_hist.setStyleSheet("font-weight: bold; color: #94a3b8;")
        self.main_layout.addWidget(lbl_hist)

        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["ID", "Group ID / Tên", "Trạng Thái", "Thời Gian"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.main_layout.addWidget(self.table)

        self.load_history()

    def load_history(self):
        rows = db.fetch_all("SELECT * FROM posted_history WHERE post_type = 'GROUP_POST' ORDER BY id DESC LIMIT 15")
        self.table.setRowCount(len(rows))
        for i, r in enumerate(rows):
            self.table.setItem(i, 0, QTableWidgetItem(str(r["id"])))
            self.table.setItem(i, 1, QTableWidgetItem(str(r.get("target_id", ""))))
            self.table.setItem(i, 2, QTableWidgetItem(str(r.get("status", ""))))
            self.table.setItem(i, 3, QTableWidgetItem(str(r.get("posted_at", ""))))

    def start_group_action(self):
        content = self.txt_content.toPlainText().strip()
        groups_raw = self.txt_groups.toPlainText().strip()
        if not content or not groups_raw:
            QMessageBox.warning(self, "Thông báo", "Vui lòng nhập nội dung và danh sách ID Nhóm!")
            return

        group_ids = [line.strip() for line in groups_raw.split("\n") if line.strip()]
        action_type = "POST" if "POST" in self.cb_action_type.currentText() else "COMMENT"

        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)

        self.worker = GroupSpamWorker(group_ids, content, action_type=action_type, delay_sec=self.spn_delay.value())
        self.worker.sig_log.connect(self.sig_log.emit)
        self.worker.sig_finished.connect(self._on_finished)
        self.worker.start()

    def stop_action(self):
        if self.worker and self.worker.isRunning():
            self.worker.stop()
            self.worker.wait(1500)
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)

    def _on_finished(self, success: bool, msg: str):
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self.load_history()
        QMessageBox.information(self, "Kết quả", msg)
