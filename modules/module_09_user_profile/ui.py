"""
Module 9: Hồ sơ cá nhân & Cài đặt hệ thống
Phụ trách: Trường, Kiệt
Chức năng: Quản lý Proxy, Quản lý Google Gemini Keys, Cài đặt Anti-spam & Google Sheets
"""
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, 
    QTextEdit, QLineEdit, QSpinBox, QTabWidget, QFrame, 
    QTableWidget, QTableWidgetItem, QHeaderView, QMessageBox
)
from core.base_module import BaseModuleTab
from core.database.connection import db
from core.network.proxy_manager import proxy_manager
from core.ai.gemini_engine import ai_engine
from config.settings import settings

class UserProfileTab(BaseModuleTab):
    def __init__(self, parent=None):
        super().__init__(
            module_id="module_09_user_profile",
            module_title="Cài Đặt Hệ Thống & Quản Lý Tài Nguyên",
            author="Trường, Kiệt",
            parent=parent
        )

    def init_ui(self):
        # Nút Lưu cấu hình trên Header
        btn_save = QPushButton("💾 Lưu Cài Đặt Hệ Thống")
        btn_save.setProperty("class", "btn-primary")
        btn_save.clicked.connect(self.save_settings)
        self.header_actions_layout.addWidget(btn_save)

        sub_tabs = QTabWidget()

        # --- SUB TAB 1: QUẢN LÝ PROXY ---
        tab_proxy = QWidget()
        layout_proxy = QVBoxLayout(tab_proxy)

        card_proxy_in = QFrame()
        card_proxy_in.setProperty("class", "card")
        layout_pin = QVBoxLayout(card_proxy_in)

        layout_pin.addWidget(QLabel("Nhập danh sách Proxy (Định dạng: IP:Port hoặc IP:Port:User:Pass, mỗi dòng 1 proxy):"))
        self.txt_proxies = QTextEdit()
        self.txt_proxies.setPlaceholderText("192.168.1.100:8080\n103.152.112.5:8080:user:pass")
        self.txt_proxies.setMaximumHeight(80)
        layout_pin.addWidget(self.txt_proxies)

        bar_proxy_btn = QHBoxLayout()
        btn_add_proxy = QPushButton("➕ Thêm Proxy")
        btn_add_proxy.clicked.connect(self.add_proxies)
        btn_check_proxy = QPushButton("⚡ Kiểm Tra Sức Khỏe Toàn Bộ Proxy")
        btn_check_proxy.setProperty("class", "btn-warning")
        btn_check_proxy.clicked.connect(self.check_all_proxies)

        bar_proxy_btn.addWidget(btn_add_proxy)
        bar_proxy_btn.addWidget(btn_check_proxy)
        bar_proxy_btn.addStretch()
        layout_pin.addLayout(bar_proxy_btn)

        layout_proxy.addWidget(card_proxy_in)

        self.tbl_proxies = QTableWidget(0, 4)
        self.tbl_proxies.setHorizontalHeaderLabels(["ID", "Proxy", "Trạng Thái", "Độ Trễ (ms)"])
        self.tbl_proxies.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        layout_proxy.addWidget(self.tbl_proxies)

        sub_tabs.addTab(tab_proxy, "🌐 Quản Lý Proxy")

        # --- SUB TAB 2: QUẢN LÝ GEMINI API KEYS ---
        tab_ai = QWidget()
        layout_ai = QVBoxLayout(tab_ai)

        card_ai_in = QFrame()
        card_ai_in.setProperty("class", "card")
        layout_ain = QVBoxLayout(card_ai_in)

        layout_ain.addWidget(QLabel("Nhập danh sách Google Gemini API Keys (Xoay tua tự động khi 429 Quota):"))
        self.txt_gemini_keys = QTextEdit()
        self.txt_gemini_keys.setPlaceholderText("AIzaSyA...\nAIzaSyB...\nAIzaSyC...")
        self.txt_gemini_keys.setMaximumHeight(100)
        layout_ain.addWidget(self.txt_gemini_keys)

        btn_add_keys = QPushButton("🔑 Lưu Danh Sách Keys")
        btn_add_keys.clicked.connect(self.add_gemini_keys)
        layout_ain.addWidget(btn_add_keys)

        layout_ai.addWidget(card_ai_in)

        self.tbl_keys = QTableWidget(0, 3)
        self.tbl_keys.setHorizontalHeaderLabels(["ID", "API Key (Mã hóa)", "Trạng Thái"])
        self.tbl_keys.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        layout_ai.addWidget(self.tbl_keys)

        sub_tabs.addTab(tab_ai, "🤖 Quản Lý Gemini Keys")

        # --- SUB TAB 3: THIẾT LẬP AN TOÀN & GOOGLE SHEET ---
        tab_general = QWidget()
        layout_gen = QVBoxLayout(tab_general)

        card_gen = QFrame()
        card_gen.setProperty("class", "card")
        layout_cgen = QVBoxLayout(card_gen)

        layout_cgen.addWidget(QLabel("⚙️ THÔNG SỐ CHỐNG SPAM & HOẠT ĐỘNG TOÀN HỆ THỐNG"))

        row_delay = QHBoxLayout()
        row_delay.addWidget(QLabel("Giãn cách đăng tối thiểu (giây):"))
        self.spn_delay_min = QSpinBox()
        self.spn_delay_min.setRange(5, 3600)
        self.spn_delay_min.setValue(settings.get("anti_spam.delay_min_seconds", 300))
        row_delay.addWidget(self.spn_delay_min)

        row_delay.addWidget(QLabel("Giãn cách đăng tối đa (giây):"))
        self.spn_delay_max = QSpinBox()
        self.spn_delay_max.setRange(10, 7200)
        self.spn_delay_max.setValue(settings.get("anti_spam.delay_max_seconds", 600))
        row_delay.addWidget(self.spn_delay_max)
        row_delay.addStretch()
        layout_cgen.addLayout(row_delay)

        row_sheet = QHBoxLayout()
        row_sheet.addWidget(QLabel("Google Sheet ID (Ghi nhận bài đăng):"))
        self.txt_sheet_id = QLineEdit()
        self.txt_sheet_id.setText(settings.get("google_sheets.sheet_id", ""))
        row_sheet.addWidget(self.txt_sheet_id)
        layout_cgen.addLayout(row_sheet)

        layout_gen.addWidget(card_gen)
        layout_gen.addStretch()

        sub_tabs.addTab(tab_general, "⚙️ Cài Đặt Chung")

        self.main_layout.addWidget(sub_tabs)
        self.load_data()

    def load_data(self):
        # Load proxies
        proxies = db.fetch_all("SELECT * FROM proxies")
        self.tbl_proxies.setRowCount(len(proxies))
        for i, p in enumerate(proxies):
            self.tbl_proxies.setItem(i, 0, QTableWidgetItem(str(p["id"])))
            self.tbl_proxies.setItem(i, 1, QTableWidgetItem(str(p["proxy_str"])))
            self.tbl_proxies.setItem(i, 2, QTableWidgetItem(str(p["status"])))
            self.tbl_proxies.setItem(i, 3, QTableWidgetItem(str(p.get("latency_ms", 0))))

        # Load keys
        keys = db.fetch_all("SELECT * FROM api_keys WHERE service = 'gemini'")
        self.tbl_keys.setRowCount(len(keys))
        for i, k in enumerate(keys):
            raw_k = k["api_key"]
            masked = raw_k[:6] + "..." + raw_k[-4:] if len(raw_k) > 10 else raw_k
            self.tbl_keys.setItem(i, 0, QTableWidgetItem(str(k["id"])))
            self.tbl_keys.setItem(i, 1, QTableWidgetItem(masked))
            self.tbl_keys.setItem(i, 2, QTableWidgetItem(str(k["status"])))

    def add_proxies(self):
        raw = self.txt_proxies.toPlainText().strip()
        if not raw:
            return
        lines = [line.strip() for line in raw.split("\n") if line.strip()]
        for p in lines:
            db.execute("INSERT OR IGNORE INTO proxies (proxy_str, status) VALUES (?, 'ACTIVE')", (p,))
        self.txt_proxies.clear()
        self.load_data()
        self.log("SUCCESS", f"Đã thêm {len(lines)} proxy vào hệ thống.")

    def check_all_proxies(self):
        proxies = db.fetch_all("SELECT * FROM proxies")
        self.log("INFO", f"Đang kiểm tra {len(proxies)} proxies...")
        for p in proxies:
            res = proxy_manager.check_proxy(p["proxy_str"])
            db.execute(
                "UPDATE proxies SET status = ?, latency_ms = ? WHERE id = ?",
                (res["status"], res["latency_ms"], p["id"])
            )
        self.load_data()
        self.log("SUCCESS", "Đã hoàn thành kiểm tra proxy!")

    def add_gemini_keys(self):
        raw = self.txt_gemini_keys.toPlainText().strip()
        if not raw:
            return
        lines = [line.strip() for line in raw.split("\n") if line.strip()]
        for k in lines:
            ai_engine.add_key(k)
        self.txt_gemini_keys.clear()
        self.load_data()
        self.log("SUCCESS", f"Đã nạp {len(lines)} Gemini API Keys thành công.")

    def save_settings(self):
        settings.set("anti_spam.delay_min_seconds", self.spn_delay_min.value())
        settings.set("anti_spam.delay_max_seconds", self.spn_delay_max.value())
        settings.set("google_sheets.sheet_id", self.txt_sheet_id.text().strip())
        self.log("SUCCESS", "Đã lưu cài đặt toàn hệ thống!")
        QMessageBox.information(self, "Thành công", "Đã lưu cài đặt hệ thống thành công!")
