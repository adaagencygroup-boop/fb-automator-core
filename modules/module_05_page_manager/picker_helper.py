import sys
import os
import ctypes

# 1. Kích hoạt Per-Monitor V2 DPI Awareness cấp hệ điều hành Windows để chống mờ chữ
try:
    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
except Exception:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass

# 2. Bật cờ High DPI của Qt để khớp tỷ lệ hiển thị của màn hình (125%, 150%, 200%)
os.environ["QT_AUTO_SCREEN_SCALE_FACTOR"] = "1"
os.environ["QT_ENABLE_HIGHDPI_SCALING"] = "1"

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

def pick_folder(initial_dir=""):
    try:
        from PyQt5.QtWidgets import QApplication, QFileDialog
        from PyQt5.QtCore import Qt, QCoreApplication

        if not QCoreApplication.instance():
            QCoreApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
            QCoreApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)

        app = QApplication.instance()
        if not app:
            app = QApplication([sys.argv[0]])

        flags = QFileDialog.ShowDirsOnly | QFileDialog.DontResolveSymlinks
        init = initial_dir if (initial_dir and os.path.exists(initial_dir)) else ""
        folder = QFileDialog.getExistingDirectory(None, "Chọn thư mục gốc chứa video Reels", init, flags)
        if folder:
            print(os.path.normpath(folder))
    except Exception as e:
        sys.stderr.write(str(e))
        sys.exit(1)

if __name__ == "__main__":
    init_arg = sys.argv[1] if len(sys.argv) > 1 else ""
    pick_folder(init_arg)
