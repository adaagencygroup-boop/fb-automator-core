"""
Central Real-time Console Log Viewer Component
"""
import datetime
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
    QPlainTextEdit, QPushButton, QComboBox, QFileDialog
)
from PyQt5.QtGui import QTextCursor, QColor
from PyQt5.QtCore import Qt
from config.constants import LogLevel, LOGS_DIR
from core.database.connection import db

class LogViewer(QWidget):
    MAX_LINES = 1500

    def __init__(self, parent=None):
        super().__init__(parent)
        self.current_filter = "ALL"

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        # Thanh công cụ Log
        toolbar = QHBoxLayout()
        toolbar.setSpacing(8)

        lbl_title = QLabel("💻 NHẬT KÝ HỆ THỐNG (CONSOLE LOG)")
        lbl_title.setStyleSheet("color: #00f0ff; font-weight: bold; font-size: 12px;")
        toolbar.addWidget(lbl_title)

        toolbar.addStretch()

        self.cb_filter = QComboBox()
        self.cb_filter.addItems(["ALL", "INFO", "SUCCESS", "WARNING", "ERROR"])
        self.cb_filter.currentTextChanged.connect(self._on_filter_changed)
        toolbar.addWidget(QLabel("Lọc:"))
        toolbar.addWidget(self.cb_filter)

        btn_clear = QPushButton("Xóa Log")
        btn_clear.clicked.connect(self.clear_logs)
        toolbar.addWidget(btn_clear)

        btn_export = QPushButton("Xuất File")
        btn_export.clicked.connect(self.export_logs)
        toolbar.addWidget(btn_export)

        layout.addLayout(toolbar)

        # Khu vực Text Console
        self.text_area = QPlainTextEdit()
        self.text_area.setObjectName("consoleLog")
        self.text_area.setReadOnly(True)
        self.text_area.setMaximumBlockCount(self.MAX_LINES)
        layout.addWidget(self.text_area)

    def append_log(self, module_name: str, level: str, message: str):
        """Thêm 1 dòng log theo chuẩn định dạng"""
        # Lưu vào SQLite Database hoạt động
        try:
            db.execute(
                "INSERT INTO activity_logs (module_name, level, message) VALUES (?, ?, ?)",
                (module_name, level, message)
            )
        except Exception:
            pass

        now_str = datetime.datetime.now().strftime("%H:%M:%S")
        color_map = {
            "INFO": "#38bdf8",
            "SUCCESS": "#10b981",
            "WARNING": "#f59e0b",
            "ERROR": "#ef4444",
            "DEBUG": "#94a3b8"
        }
        color = color_map.get(level.upper(), "#94a3b8")

        formatted_html = f"""<span style="color:#64748b;">[{now_str}]</span> 
<span style="color:{color}; font-weight:bold;">[{level.upper()}]</span> 
<span style="color:#a855f7;">[{module_name}]</span> 
<span style="color:#e2e8f0;">{message}</span>"""

        self.text_area.appendHtml(formatted_html)
        self.text_area.moveCursor(QTextCursor.End)

    def clear_logs(self):
        self.text_area.clear()

    def export_logs(self):
        filename, _ = QFileDialog.getSaveFileName(
            self, "Lưu File Nhật Ký", str(LOGS_DIR / "system_log.txt"), "Text Files (*.txt)"
        )
        if filename:
            try:
                with open(filename, "w", encoding="utf-8") as f:
                    f.write(self.text_area.toPlainText())
            except Exception as e:
                self.append_log("System", "ERROR", f"Không thể lưu file log: {e}")

    def _on_filter_changed(self, text: str):
        self.current_filter = text
