"""
Module 3: Nuôi Acc (Farm Tài khoản)
Phụ trách: Cường Trần, Bình Kiến
Chức năng: Cấu hình kịch bản tương tác người dùng thật (Lướt tin, Like dạo, Xem video, kết bạn)
"""
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, 
    QLabel, QPushButton, QCheckBox, QSpinBox, QFrame, 
    QTableWidget, QTableWidgetItem, QHeaderView, QMessageBox
)
from PyQt5.QtCore import Qt
from core.base_module import BaseModuleTab
from core.database.connection import db
from modules.module_03_acc_farm.worker import AccFarmWorker

class AccFarmTab(BaseModuleTab):
    def __init__(self, parent=None):
        super().__init__(
            module_id="module_03_acc_farm",
            module_title="Nuôi Tài Khoản (Account Farm)",
            author="Cường Trần, Bình Kiến",
            parent=parent
        )

    def init_ui(self):
        # Action Toolbar trên Header
        self.btn_start = QPushButton("▶ Bắt Đầu Nuôi")
        self.btn_start.setProperty("class", "btn-success")
        self.btn_start.clicked.connect(self.start_farm)
        self.header_actions_layout.addWidget(self.btn_start)

        self.btn_stop = QPushButton("⏹ Dừng Lại")
        self.btn_stop.setProperty("class", "btn-danger")
        self.btn_stop.setEnabled(False)
        self.btn_stop.clicked.connect(self.stop_farm)
        self.header_actions_layout.addWidget(self.btn_stop)

        # Cấu hình kịch bản (Scenario Settings Card)
        card_config = QFrame()
        card_config.setProperty("class", "card")
        layout_cfg = QVBoxLayout(card_config)

        lbl_cfg = QLabel("⚙️ THIẾT LẬP KỊCH BẢN TƯƠNG TÁC (SCENARIO)")
        lbl_cfg.setStyleSheet("font-weight: bold; color: #00f0ff; font-size: 13px;")
        layout_cfg.addWidget(lbl_cfg)

        grid_actions = QGridLayout()
        self.chk_surf = QCheckBox("Lướt Newsfeed ngẫu nhiên (5-15s)")
        self.chk_surf.setChecked(True)
        self.chk_like = QCheckBox("Like / Reaction dạo bài viết bạn bè")
        self.chk_like.setChecked(True)
        self.chk_reels = QCheckBox("Xem Reels / Video đề xuất")
        self.chk_reels.setChecked(True)
        self.chk_noti = QCheckBox("Kiểm tra thông báo mới")
        self.chk_noti.setChecked(True)

        grid_actions.addWidget(self.chk_surf, 0, 0)
        grid_actions.addWidget(self.chk_like, 0, 1)
        grid_actions.addWidget(self.chk_reels, 1, 0)
        grid_actions.addWidget(self.chk_noti, 1, 1)

        layout_cfg.addLayout(grid_actions)

        # Tham số giãn cách
        row_params = QHBoxLayout()
        row_params.addWidget(QLabel("Giãn cách giữa các hành động (giây):"))
        self.spn_delay = QSpinBox()
        self.spn_delay.setRange(2, 120)
        self.spn_delay.setValue(5)
        row_params.addWidget(self.spn_delay)

        row_params.addStretch()
        layout_cfg.addLayout(row_params)

        self.main_layout.addWidget(card_config)

        # Bảng chọn tài khoản nuôi
        lbl_tbl = QLabel("📋 DANH SÁCH TÀI KHOẢN THAM GIA NUÔI (Chỉ chọn nick LIVE)")
        lbl_tbl.setStyleSheet("font-weight: bold; color: #94a3b8; font-size: 12px;")
        self.main_layout.addWidget(lbl_tbl)

        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["ID", "UID", "Trạng Thái", "Proxy"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.main_layout.addWidget(self.table)

        self.load_live_accounts()

    def load_live_accounts(self):
        accounts = db.fetch_all("SELECT * FROM accounts WHERE status = 'LIVE' OR status = 'NEW'")
        self.table.setRowCount(len(accounts))
        for i, acc in enumerate(accounts):
            self.table.setItem(i, 0, QTableWidgetItem(str(acc["id"])))
            self.table.setItem(i, 1, QTableWidgetItem(str(acc["uid"])))
            self.table.setItem(i, 2, QTableWidgetItem(str(acc["status"])))
            self.table.setItem(i, 3, QTableWidgetItem(str(acc.get("proxy") or "Mặc định")))

    def start_farm(self):
        accounts = db.fetch_all("SELECT * FROM accounts WHERE status = 'LIVE' OR status = 'NEW'")
        if not accounts:
            QMessageBox.warning(self, "Thông báo", "Không có tài khoản LIVE nào sẵn sàng để nuôi!")
            return

        actions = []
        if self.chk_surf.isChecked(): actions.append("surf_newsfeed")
        if self.chk_like.isChecked(): actions.append("like_random")
        if self.chk_reels.isChecked(): actions.append("watch_reels")
        if self.chk_noti.isChecked(): actions.append("check_notifications")

        if not actions:
            QMessageBox.warning(self, "Thông báo", "Vui lòng chọn ít nhất 1 hành động tương tác.")
            return

        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)

        self.worker = AccFarmWorker(accounts, actions, delay_sec=self.spn_delay.value())
        self.worker.sig_log.connect(self.sig_log.emit)
        self.worker.sig_finished.connect(self._on_farm_finished)
        self.worker.start()

    def stop_farm(self):
        if self.worker and self.worker.isRunning():
            self.worker.stop()
            self.worker.wait(2000)
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)

    def _on_farm_finished(self, success: bool, msg: str):
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        QMessageBox.information(self, "Kết quả", msg)
