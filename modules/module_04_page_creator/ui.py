"""
Module 4: Tạo Page Hàng Loạt
Phụ trách: Minh
Chức năng: Nhập danh sách tên Fanpage, chọn danh mục, chọn tài khoản tạo, tự động lấy token và nạp sang Module 5
"""
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, 
    QTextEdit, QComboBox, QFrame, QTableWidget, QTableWidgetItem, 
    QHeaderView, QMessageBox
)
from core.base_module import BaseModuleTab
from core.database.connection import db
from modules.module_04_page_creator.worker import PageCreatorWorker

class PageCreatorTab(BaseModuleTab):
    def __init__(self, parent=None):
        super().__init__(
            module_id="module_04_page_creator",
            module_title="Tạo Fanpage Hàng Loạt",
            author="Minh",
            parent=parent
        )

    def init_ui(self):
        # Action Button trên Header
        self.btn_start = QPushButton("🚀 Bắt Đầu Tạo Page")
        self.btn_start.setProperty("class", "btn-primary")
        self.btn_start.clicked.connect(self.start_create_pages)
        self.header_actions_layout.addWidget(self.btn_start)

        # Khung cấu hình tạo Page
        card_config = QFrame()
        card_config.setProperty("class", "card")
        layout_cfg = QVBoxLayout(card_config)

        lbl_cfg = QLabel("📝 THIẾT LẬP THÔNG TIN TRANG MỚI")
        lbl_cfg.setStyleSheet("font-weight: bold; color: #00f0ff; font-size: 13px;")
        layout_cfg.addWidget(lbl_cfg)

        row_cat = QHBoxLayout()
        row_cat.addWidget(QLabel("Danh mục (Category):"))
        self.cb_category = QComboBox()
        self.cb_category.addItems(["COMMUNITY", "BLOGGER", "MEDIA_NEWS", "DIGITAL_CREATOR", "ENTERTAINMENT"])
        row_cat.addWidget(self.cb_category)
        row_cat.addStretch()
        layout_cfg.addLayout(row_cat)

        layout_cfg.addWidget(QLabel("Danh sách tên Fanpage cần tạo (Mỗi dòng 1 tên):"))
        self.txt_names = QTextEdit()
        self.txt_names.setPlaceholderText("Góc Thư Giãn Mỗi Ngày\nBóng Đá 24h Pro\nTin Nóng Showbiz Hôm Nay\nĐọc Truyện Đêm Khuya")
        self.txt_names.setMaximumHeight(120)
        layout_cfg.addWidget(self.txt_names)

        self.main_layout.addWidget(card_config)

        # Bảng lịch sử tạo page
        lbl_hist = QLabel("📑 LỊCH SỬ TẠO PAGE GẦN NHẤT")
        lbl_hist.setStyleSheet("font-weight: bold; color: #94a3b8; font-size: 12px;")
        self.main_layout.addWidget(lbl_hist)

        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["ID", "Account UID", "Page Name", "Page ID", "Thời Gian"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.main_layout.addWidget(self.table)

        self.load_history()

    def load_history(self):
        rows = db.fetch_all("SELECT * FROM created_pages_log ORDER BY id DESC LIMIT 20")
        self.table.setRowCount(len(rows))
        for i, r in enumerate(rows):
            self.table.setItem(i, 0, QTableWidgetItem(str(r["id"])))
            self.table.setItem(i, 1, QTableWidgetItem(str(r.get("account_uid", ""))))
            self.table.setItem(i, 2, QTableWidgetItem(str(r.get("page_name", ""))))
            self.table.setItem(i, 3, QTableWidgetItem(str(r.get("page_id", ""))))
            self.table.setItem(i, 4, QTableWidgetItem(str(r.get("created_at", ""))))

    def start_create_pages(self):
        raw_text = self.txt_names.toPlainText().strip()
        if not raw_text:
            QMessageBox.warning(self, "Thông báo", "Vui lòng nhập danh sách tên Page cần tạo!")
            return

        names = [line.strip() for line in raw_text.split("\n") if line.strip()]
        accounts = db.fetch_all("SELECT * FROM accounts WHERE status = 'LIVE' OR status = 'NEW'")
        if not accounts:
            QMessageBox.warning(self, "Thông báo", "Không có tài khoản nào trong hệ thống để thực hiện tạo page!")
            return

        self.btn_start.setEnabled(False)
        self.worker = PageCreatorWorker(accounts, names, category=self.cb_category.currentText())
        self.worker.sig_log.connect(self.sig_log.emit)
        self.worker.sig_finished.connect(self._on_finished)
        self.worker.start()

    def _on_finished(self, success: bool, msg: str):
        self.btn_start.setEnabled(True)
        self.load_history()
        QMessageBox.information(self, "Kết quả", msg)
