"""
Module 1: Dashboard (Bảng điều khiển trung tâm)
Phụ trách: Đức
Chức năng: Tổng quan hệ thống, thống kê chỉ số, biểu đồ thời gian thực, giám sát sức khỏe Proxy/API
"""
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QGridLayout, 
    QLabel, QPushButton, QFrame, QTableWidget, QTableWidgetItem, QHeaderView
)
from PyQt5.QtCore import Qt, QTimer
from core.base_module import BaseModuleTab
from gui.components.stat_card import StatCard
from core.database.connection import db

class DashboardTab(BaseModuleTab):
    def __init__(self, parent=None):
        super().__init__(
            module_id="module_01_dashboard",
            module_title="Dashboard Trung Tâm",
            author="Đức",
            parent=parent
        )

    def init_ui(self):
        # Nút làm mới dữ liệu trên Header
        btn_refresh = QPushButton("🔄 Cập Nhật Thống Kê")
        btn_refresh.setProperty("class", "btn-primary")
        btn_refresh.clicked.connect(self.refresh_stats)
        self.header_actions_layout.addWidget(btn_refresh)

        # Lưới thẻ thống kê (Stat Cards)
        stats_grid = QGridLayout()
        stats_grid.setSpacing(12)

        self.card_accounts = StatCard("Tổng Tài Khoản", "0", "Live: 0 | Die: 0", "#38bdf8")
        self.card_pages = StatCard("Tổng Fanpage", "0", "Đang tự động đăng bài", "#00f0ff")
        self.card_posts = StatCard("Bài Đăng Hôm Nay", "0", "Reels & Video & AI", "#10b981")
        self.card_proxies = StatCard("Proxy Sẵn Sàng", "0", "Đang hoạt động tốt", "#f59e0b")

        stats_grid.addWidget(self.card_accounts, 0, 0)
        stats_grid.addWidget(self.card_pages, 0, 1)
        stats_grid.addWidget(self.card_posts, 0, 2)
        stats_grid.addWidget(self.card_proxies, 0, 3)

        self.main_layout.addLayout(stats_grid)

        # Bảng hoạt động gần nhất
        card_recent = QFrame()
        card_recent.setProperty("class", "card")
        layout_recent = QVBoxLayout(card_recent)

        lbl_recent = QLabel("📊 LỊCH SỬ ĐĂNG BÀI & HOẠT ĐỘNG GẦN ĐÂY")
        lbl_recent.setStyleSheet("font-weight: bold; color: #f1f5f9; font-size: 13px;")
        layout_recent.addWidget(lbl_recent)

        self.tbl_recent = QTableWidget(0, 5)
        self.tbl_recent.setHorizontalHeaderLabels(["Thời Gian", "Mục Tiêu", "Hình Thức", "Trạng Thái", "Mã Bài Đăng"])
        self.tbl_recent.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        layout_recent.addWidget(self.tbl_recent)

        self.main_layout.addWidget(card_recent)

        # Tự động nạp dữ liệu ban đầu
        self.refresh_stats()

        # Timer tự động cập nhật mỗi 30s
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh_stats)
        self.timer.start(30000)

    def refresh_stats(self):
        try:
            # Query thống kê accounts
            acc_total = db.fetch_one("SELECT COUNT(*) as c FROM accounts")["c"]
            acc_live = db.fetch_one("SELECT COUNT(*) as c FROM accounts WHERE status = 'LIVE'")["c"]
            acc_die = db.fetch_one("SELECT COUNT(*) as c FROM accounts WHERE status = 'DIE'")["c"]
            self.card_accounts.set_value(str(acc_total))
            self.card_accounts.lbl_subtitle.setText(f"Live: {acc_live} | Die: {acc_die}")

            # Query thống kê pages
            pages_total = db.fetch_one("SELECT COUNT(*) as c FROM pages")["c"]
            self.card_pages.set_value(str(pages_total))

            # Query bài đăng hôm nay
            posts_today = db.fetch_one(
                "SELECT COUNT(*) as c FROM posted_history WHERE date(posted_at) = date('now')"
            )["c"]
            self.card_posts.set_value(str(posts_today))

            # Query proxies
            proxies_active = db.fetch_one("SELECT COUNT(*) as c FROM proxies WHERE status = 'ACTIVE'")["c"]
            self.card_proxies.set_value(str(proxies_active))

            # Nạp bảng recent posts
            rows = db.fetch_all("SELECT * FROM posted_history ORDER BY id DESC LIMIT 10")
            self.tbl_recent.setRowCount(len(rows))
            for i, r in enumerate(rows):
                self.tbl_recent.setItem(i, 0, QTableWidgetItem(str(r.get("posted_at", ""))))
                self.tbl_recent.setItem(i, 1, QTableWidgetItem(str(r.get("target_name", r.get("target_id", "")))))
                self.tbl_recent.setItem(i, 2, QTableWidgetItem(str(r.get("post_type", ""))))
                self.tbl_recent.setItem(i, 3, QTableWidgetItem(str(r.get("status", ""))))
                self.tbl_recent.setItem(i, 4, QTableWidgetItem(str(r.get("fb_post_id", ""))))

            self.log("INFO", "Đã cập nhật dữ liệu Dashboard thành công.")
        except Exception as e:
            self.log("ERROR", f"Lỗi cập nhật Dashboard: {e}")
