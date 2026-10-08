"""
Module 8: Seeding Bài & Page (Buff Tương tác)
Phụ trách: Hưởng, Trường
Chức năng: Buff Like, Reaction, Comment mồi theo kịch bản, Share bài viết
"""
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, 
    QLineEdit, QTextEdit, QComboBox, QSpinBox, QFrame, QMessageBox
)
from core.base_module import BaseModuleTab
from core.database.connection import db
from modules.module_08_interaction_seeding.worker import SeedingWorker

class InteractionSeedingTab(BaseModuleTab):
    def __init__(self, parent=None):
        super().__init__(
            module_id="module_08_interaction_seeding",
            module_title="Seeding Bài & Page (Buff Tương Tác)",
            author="Hưởng, Trường",
            parent=parent
        )

    def init_ui(self):
        # Action Toolbar trên Header
        self.btn_start = QPushButton("🚀 Bắt Đầu Seeding")
        self.btn_start.setProperty("class", "btn-primary")
        self.btn_start.clicked.connect(self.start_seeding)
        self.header_actions_layout.addWidget(self.btn_start)

        self.btn_stop = QPushButton("⏹ Dừng Lại")
        self.btn_stop.setProperty("class", "btn-danger")
        self.btn_stop.setEnabled(False)
        self.btn_stop.clicked.connect(self.stop_seeding)
        self.header_actions_layout.addWidget(self.btn_stop)

        # Cấu hình Seeding Card
        card_cfg = QFrame()
        card_cfg.setProperty("class", "card")
        layout_cfg = QVBoxLayout(card_cfg)

        layout_cfg.addWidget(QLabel("🎯 THIẾT LẬP CHIẾN DỊCH SEEDING"))

        row_url = QHBoxLayout()
        row_url.addWidget(QLabel("Link bài viết / Video:"))
        self.txt_url = QLineEdit()
        self.txt_url.setPlaceholderText("https://facebook.com/watch/?v=123456 hoặc link bài viết")
        row_url.addWidget(self.txt_url)
        layout_cfg.addLayout(row_url)

        row_opt = QHBoxLayout()
        row_opt.addWidget(QLabel("Hành động buff:"))
        self.cb_action = QComboBox()
        self.cb_action.addItems(["Thả Cảm Xúc (BUFF_LIKE)", "Bình Luận Mồi (BUFF_COMMENT)", "Chia Sẻ (BUFF_SHARE)"])
        self.cb_action.currentIndexChanged.connect(self.on_action_changed)
        row_opt.addWidget(self.cb_action)

        row_opt.addWidget(QLabel("Loại cảm xúc:"))
        self.cb_reaction = QComboBox()
        self.cb_reaction.addItems(["LIKE", "LOVE (Tim)", "HAHA", "WOW", "CARE (Thương thương)"])
        row_opt.addWidget(self.cb_reaction)

        row_opt.addWidget(QLabel("Giãn cách (s):"))
        self.spn_delay = QSpinBox()
        self.spn_delay.setRange(2, 60)
        self.spn_delay.setValue(5)
        row_opt.addWidget(self.spn_delay)
        row_opt.addStretch()
        layout_cfg.addLayout(row_opt)

        self.lbl_cmt = QLabel("Danh sách bình luận mồi (Mỗi dòng 1 comment):")
        layout_cfg.addWidget(self.lbl_cmt)
        self.txt_comments = QTextEdit()
        self.txt_comments.setPlaceholderText("Shop tư vấn em với ạ!\nChất lượng quá xịn xò shop ơi.\nĐã mua và thấy rất ưng ý nha mng!")
        self.txt_comments.setMaximumHeight(100)
        layout_cfg.addWidget(self.txt_comments)

        self.main_layout.addWidget(card_cfg)
        self.main_layout.addStretch()

    def on_action_changed(self, idx: int):
        is_comment = "COMMENT" in self.cb_action.currentText()
        self.lbl_cmt.setVisible(is_comment)
        self.txt_comments.setVisible(is_comment)

    def start_seeding(self):
        url = self.txt_url.text().strip()
        if not url:
            QMessageBox.warning(self, "Thông báo", "Vui lòng nhập link bài viết Facebook!")
            return

        accounts = db.fetch_all("SELECT * FROM accounts WHERE status = 'LIVE' OR status = 'NEW'")
        if not accounts:
            QMessageBox.warning(self, "Thông báo", "Không có tài khoản LIVE nào để thực hiện seeding!")
            return

        action_text = self.cb_action.currentText()
        if "LIKE" in action_text: action = "BUFF_LIKE"
        elif "COMMENT" in action_text: action = "BUFF_COMMENT"
        else: action = "BUFF_SHARE"

        comments = [c.strip() for c in self.txt_comments.toPlainText().split("\n") if c.strip()]

        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)

        self.worker = SeedingWorker(url, action, comments, accounts, delay_sec=self.spn_delay.value())
        self.worker.sig_log.connect(self.sig_log.emit)
        self.worker.sig_finished.connect(self._on_finished)
        self.worker.start()

    def stop_seeding(self):
        if self.worker and self.worker.isRunning():
            self.worker.stop()
            self.worker.wait(1500)
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)

    def _on_finished(self, success: bool, msg: str):
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        QMessageBox.information(self, "Kết quả", msg)
