"""
Base Module and Base Worker Abstractions
Đảm bảo tất cả 9 Modules tuân thủ đúng chuẩn kiến trúc, dễ ghép nối, tránh conflict Git.
"""
from PyQt5.QtCore import QThread, pyqtSignal, QObject
from PyQt5.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QFrame
from typing import Optional
from config.constants import LogLevel

class BaseWorker(QThread):
    """
    QThread chuẩn cho mọi Worker xử lý tác vụ ngầm trong hệ thống.
    Đã tích hợp sẵn Signal log, tiến trình, cờ dừng/tạm dừng an toàn.
    """
    sig_log = pyqtSignal(str, str, str)       # (module_name, level, message)
    sig_progress = pyqtSignal(int, int, str)  # (current, total, status_text)
    sig_finished = pyqtSignal(bool, str)      # (is_success, summary_msg)
    sig_data = pyqtSignal(dict)               # Trả về dữ liệu kết quả nếu cần

    def __init__(self, module_name: str, parent: Optional[QObject] = None):
        super().__init__(parent)
        self.module_name = module_name
        self._is_running = True
        self._is_paused = False

    def log(self, level: str, message: str):
        self.sig_log.emit(self.module_name, level, message)

    def log_info(self, message: str):
        self.log(LogLevel.INFO.value, message)

    def log_success(self, message: str):
        self.log(LogLevel.SUCCESS.value, message)

    def log_warning(self, message: str):
        self.log(LogLevel.WARNING.value, message)

    def log_error(self, message: str):
        self.log(LogLevel.ERROR.value, message)

    def stop(self):
        self._is_running = False

    def pause(self):
        self._is_paused = True

    def resume(self):
        self._is_paused = False

    def is_active(self) -> bool:
        return self._is_running and not self.isInterruptionRequested()

    def check_paused(self):
        """Nếu worker đang pause, vòng lặp sẽ đợi cho đến khi resume hoặc stop"""
        while self._is_paused and self._is_running:
            self.msleep(200)


class BaseModuleTab(QWidget):
    """
    Giao diện mẫu chuẩn cho tất cả 9 Tabs / Modules.
    Cung cấp Header chuẩn, nút chức năng, và liên kết sự kiện.
    """
    sig_log = pyqtSignal(str, str, str)  # (module_name, level, message)

    def __init__(self, module_id: str, module_title: str, author: str, parent: Optional[QWidget] = None):
        super().__init__(parent)
        self.module_id = module_id
        self.module_title = module_title
        self.author = author
        self.worker: Optional[BaseWorker] = None

        self.main_layout = QVBoxLayout(self)
        self.main_layout.setContentsMargins(16, 16, 16, 16)
        self.main_layout.setSpacing(12)

        self._build_header()
        self.init_ui()

    def _build_header(self):
        """Header card hiển thị tên Module và tác giả phụ trách"""
        header_card = QFrame()
        header_card.setProperty("class", "card")
        header_layout = QHBoxLayout(header_card)
        header_layout.setContentsMargins(12, 10, 12, 10)

        title_box = QVBoxLayout()
        lbl_title = QLabel(self.module_title)
        lbl_title.setStyleSheet("font-size: 16px; font-weight: bold; color: #00f0ff;")
        lbl_author = QLabel(f"👨‍💻 Phụ trách: {self.author} | Mã định danh: {self.module_id}")
        lbl_author.setStyleSheet("font-size: 11px; color: #64748b;")
        title_box.addWidget(lbl_title)
        title_box.addWidget(lbl_author)

        header_layout.addLayout(title_box)
        header_layout.addStretch()

        self.header_actions_layout = QHBoxLayout()
        header_layout.addLayout(self.header_actions_layout)

        self.main_layout.addWidget(header_card)

    def init_ui(self):
        """Method để các module con override và vẽ giao diện riêng"""
        pass

    def log(self, level: str, message: str):
        self.sig_log.emit(self.module_title, level, message)
