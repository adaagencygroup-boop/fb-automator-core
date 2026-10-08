"""
=============================================================================
FACEBOOK AUTOMATOR PRO - ENTERPRISE MULTI-MODULE PLATFORM
Điểm khởi chạy ứng dụng chính (Entry Point)
=============================================================================
"""
import sys
import os
from PyQt5.QtWidgets import QApplication
from PyQt5.QtCore import Qt
from gui.main_window import MainWindow

def main():
    # Kích hoạt tính năng hỗ trợ màn hình High DPI (màn hình độ phân giải cao)
    if hasattr(Qt, "AA_EnableHighDpiScaling"):
        QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    if hasattr(Qt, "AA_UseHighDpiPixmaps"):
        QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)

    app = QApplication(sys.argv)
    app.setApplicationName("Facebook Automator Pro")
    app.setApplicationVersion("2.0.0")

    window = MainWindow()
    window.show()

    sys.exit(app.exec_())

if __name__ == "__main__":
    main()
