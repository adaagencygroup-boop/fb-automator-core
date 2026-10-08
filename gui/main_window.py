"""
Main Application Window
Cyberpunk UI, Dynamic Module Loader, Central Console Log
"""
from PyQt5.QtWidgets import (
    QMainWindow, QWidget, QHBoxLayout, QVBoxLayout, 
    QLabel, QPushButton, QStackedWidget, QFrame, QSplitter
)
from PyQt5.QtCore import Qt
from config.settings import settings
from config.theme import CYBERPUNK_QSS
from core.database.models import init_database
from gui.components.log_viewer import LogViewer

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("FACEBOOK AUTOMATOR PRO - ENTERPRISE MULTI-MODULE PLATFORM")
        self.resize(1350, 850)
        self.setMinimumSize(1100, 700)

        # Áp dụng Cyberpunk Dark Theme
        self.setStyleSheet(CYBERPUNK_QSS)

        # Khởi tạo CSDL SQLite
        init_database()

        self._init_ui()

    def _init_ui(self):
        central_widget = QWidget()
        central_widget.setObjectName("centralWidget")
        self.setCentralWidget(central_widget)

        root_layout = QHBoxLayout(central_widget)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        # --- CỘT TRÁI: SIDEBAR NAVIGATION ---
        sidebar = QWidget()
        sidebar.setObjectName("sidebarContainer")
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(10, 16, 10, 16)
        sidebar_layout.setSpacing(4)

        # Brand Logo & Title
        lbl_brand = QLabel("⚡ FB AUTOMATOR")
        lbl_brand.setObjectName("brandTitle")
        lbl_brand.setAlignment(Qt.AlignCenter)

        lbl_sub = QLabel("ENTERPRISE EDITION v2.0")
        lbl_sub.setObjectName("brandSubtitle")
        lbl_sub.setAlignment(Qt.AlignCenter)

        sidebar_layout.addWidget(lbl_brand)
        sidebar_layout.addWidget(lbl_sub)

        # Dải phân cách
        sep = QFrame()
        sep.setFrameShape(QFrame.HLine)
        sep.setStyleSheet("color: #1e293b; margin-bottom: 8px;")
        sidebar_layout.addWidget(sep)

        # Dynamic Navigation Buttons
        from modules import MODULE_REGISTRY
        self.nav_buttons = []
        self.stacked_widget = QStackedWidget()

        for idx, mod in enumerate(MODULE_REGISTRY):
            btn = QPushButton(f"{mod['icon']}  {mod['title']}")
            btn.setProperty("class", "nav-btn")
            btn.setCheckable(True)
            btn.clicked.connect(lambda checked, i=idx: self.switch_tab(i))

            sidebar_layout.addWidget(btn)
            self.nav_buttons.append(btn)

            # Khởi tạo UI Tab instance
            tab_class = mod["cls"]
            tab_instance = tab_class()
            self.stacked_widget.addWidget(tab_instance)

        sidebar_layout.addStretch()

        # Footer tác giả / trạng thái
        lbl_footer = QLabel("🚀 9 Core Modules System")
        lbl_footer.setStyleSheet("color: #475569; font-size: 11px; text-align: center;")
        lbl_footer.setAlignment(Qt.AlignCenter)
        sidebar_layout.addWidget(lbl_footer)

        root_layout.addWidget(sidebar)

        # --- KHU VỰC CHÍNH (NỘI DUNG TABS + CONSOLE LOG) ---
        main_area = QWidget()
        main_layout = QVBoxLayout(main_area)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # Header bar
        header_bar = QWidget()
        header_bar.setObjectName("headerBar")
        header_layout = QHBoxLayout(header_bar)
        header_layout.setContentsMargins(16, 10, 16, 10)

        self.lbl_current_module = QLabel("📊 Bảng Điều Khiển Trung Tâm (Dashboard)")
        self.lbl_current_module.setStyleSheet("font-size: 15px; font-weight: 800; color: #00f0ff;")
        header_layout.addWidget(self.lbl_current_module)

        header_layout.addStretch()

        lbl_status = QLabel("🟢 Hệ Thống: Sẵn Sàng (WAL Mode DB Active)")
        lbl_status.setStyleSheet("color: #10b981; font-weight: bold; font-size: 12px;")
        header_layout.addWidget(lbl_status)

        main_layout.addWidget(header_bar)

        # Dùng Splitter để người dùng có thể kéo thả kích thước Log
        splitter = QSplitter(Qt.Vertical)

        # Content Stack
        splitter.addWidget(self.stacked_widget)

        # Console Log Widget
        self.log_viewer = LogViewer()
        self.log_viewer.setMinimumHeight(140)
        splitter.addWidget(self.log_viewer)

        splitter.setSizes([600, 180])
        main_layout.addWidget(splitter)

        root_layout.addWidget(main_area)

        # Kết nối Log signals của tất cả các Module vào central LogViewer
        for i in range(self.stacked_widget.count()):
            tab = self.stacked_widget.widget(i)
            if hasattr(tab, "sig_log"):
                tab.sig_log.connect(self.log_viewer.append_log)

        # Kích hoạt tab mặc định là Dashboard
        self.switch_tab(0)
        self.log_viewer.append_log("System", "SUCCESS", "Đã khởi động Facebook Automator Pro thành công với đầy đủ 9 modules!")

    def switch_tab(self, index: int):
        self.stacked_widget.setCurrentIndex(index)
        for i, btn in enumerate(self.nav_buttons):
            is_active = (i == index)
            btn.setChecked(is_active)
            btn.setProperty("active", "true" if is_active else "false")
            btn.style().polish(btn)

        current_mod = MODULE_REGISTRY[index]
        self.lbl_current_module.setText(f"{current_mod['icon']} {current_mod['title']} | Phụ trách: {current_mod['author']}")
