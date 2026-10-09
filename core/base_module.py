"""
Base Worker abstraction cho các module backend (QThread + signals).
UI đã chuyển sang Next.js — không còn BaseModuleTab PyQt.
"""
from PyQt5.QtCore import QThread, pyqtSignal, QObject
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
