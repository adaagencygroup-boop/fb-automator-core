import sys
import time
import threading
import random
import os
import hashlib
import uuid
import datetime
import re
import shutil 
from concurrent.futures import ThreadPoolExecutor
from openai import OpenAI
from PyQt5.QtWidgets import (
    QApplication, QWidget, QLabel, QLineEdit, QTextEdit, QPushButton,
    QFileDialog, QVBoxLayout, QTableWidget, QTableWidgetItem, QHeaderView, 
    QSpinBox, QHBoxLayout, QListWidget, QListWidgetItem, QGroupBox, QCheckBox, 
    QMessageBox, QDateTimeEdit, QDialog, QScrollArea, QFrame, QSizePolicy, QInputDialog,
    QComboBox
)
from PyQt5.QtCore import Qt, pyqtSignal, QObject, QTimer, QDateTime, QSize
from PyQt5.QtGui import QColor, QPixmap, QIcon, QFont

import pyperclip
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import chromedriver_autoinstaller

chromedriver_autoinstaller.install()

PROFILE_ROOT_PATH = "C:/SeleniumProfile_thuan"

# ============================================================================
# PHẦN 0: CLASS HIỂN THỊ ẢNH THU NHỎ
# ============================================================================
class MediaThumbnail(QFrame):
    removed = pyqtSignal(str) 

    def __init__(self, file_path):
        super().__init__()
        self.file_path = file_path
        self.setFixedSize(85, 105) # Làm nhỏ khung hiển thị ảnh
        self.setStyleSheet("background-color: #161622; border: 1.5px solid #2d2d3d; border-radius: 6px;")
        
        layout = QVBoxLayout()
        layout.setContentsMargins(4, 4, 4, 4)
        
        self.lbl_img = QLabel()
        self.lbl_img.setFixedSize(77, 55) # Làm nhỏ ảnh xem trước
        self.lbl_img.setAlignment(Qt.AlignCenter)
        self.lbl_img.setStyleSheet("border: none; background-color: #0f0f18; border-radius: 4px;")
        
        if file_path.lower().endswith(('.jpg', '.jpeg', '.png')):
            pixmap = QPixmap(file_path)
            self.lbl_img.setPixmap(pixmap.scaled(77, 55, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        elif file_path.lower().endswith(('.mp4', '.avi')):
            self.lbl_img.setText("🎬 VIDEO")
            self.lbl_img.setStyleSheet("background-color: black; color: #f87171; font-weight: bold; font-size: 9px; border: none; border-radius: 4px;")
        
        layout.addWidget(self.lbl_img)
        
        self.btn_del = QPushButton("❌ Xóa")
        self.btn_del.setFixedHeight(20) # Làm thấp nút xóa cho gọn
        self.btn_del.setStyleSheet("""
            QPushButton { background-color: #ef4444; color: white; border: none; border-radius: 4px; font-weight: bold; font-size: 9px; }
            QPushButton:hover { background-color: #dc2626; }
        """)
        self.btn_del.clicked.connect(self.on_delete)
        layout.addWidget(self.btn_del)
        
        self.setLayout(layout)

    def on_delete(self):
        self.removed.emit(self.file_path)
        self.deleteLater() 

# ============================================================================
# PHẦN 1: HỆ THỐNG BẢO MẬT (LICENSE)
# ============================================================================
class LicenseManager:
    def get_hwid(self):
        mac = ':'.join(['{:02x}'.format((uuid.getnode() >> ele) & 0xff) for ele in range(0, 8 * 6, 8)][::-1])
        return hashlib.md5(mac.encode()).hexdigest().upper()

    def check_license(self):
        hwid = self.get_hwid()
        if not os.path.exists("license.key"):
            return False, 0, None, hwid
        try:
            with open("license.key", "r") as f: saved_key = f.read().strip()
            parts = saved_key.split("|")
            if len(parts) != 2: return False, 0, None, hwid
            signature, expire_str = parts
            secret = "THUAN_TOOL_PRO_2024" 
            expected_sig = hashlib.md5((hwid + secret).encode()).hexdigest()
            if signature != expected_sig: return False, 0, None, hwid
            expire_date = datetime.datetime.strptime(expire_str, "%Y-%m-%d")
            days_left = (expire_date - datetime.datetime.now()).days
            if days_left < 0: return False, days_left, expire_str, hwid
            return True, days_left, expire_str, hwid
        except Exception as e: return False, 0, None, hwid

class LoginDialog(QDialog):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("🔐 Kích hoạt bản quyền")
        self.resize(400, 320)
        self.lm = LicenseManager()
        layout = QVBoxLayout()
        
        self.lbl_hwid = QLabel(f"Mã máy (HWID): {self.lm.get_hwid()}")
        self.lbl_hwid.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.lbl_hwid.setStyleSheet("font-size: 11px; color: #94a3b8;")
        layout.addWidget(self.lbl_hwid)
        
        contact_info = (
            "<div style='text-align: center; background-color: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #ddd;'>"
            "<b style='font-size:16px; color: #333;'>LIÊN HỆ MUA KEY: Nguyễn Văn Thuần</b><br>"
            "<span style='color: #007bff; font-size: 18px; font-weight: bold;'>📞 Zalo/Call: 0327.385.018</span><br>"
            "<i style='font-size: 12px; color: #666;'>(Nhắn tin Zalo để lấy khóa kích hoạt nhanh nhất)</i>"
            "</div>"
        )
        self.lbl_contact = QLabel(contact_info)
        self.lbl_contact.setAlignment(Qt.AlignCenter) 
        self.lbl_contact.setOpenExternalLinks(True)
        layout.addWidget(self.lbl_contact)
        
        self.input_key = QLineEdit()
        self.input_key.setPlaceholderText("Dán Key bản quyền vào đây...")
        self.input_key.setFixedHeight(40) 
        self.input_key.setStyleSheet("font-size: 14px; padding: 5px;")
        layout.addWidget(self.input_key)
        
        self.btn_ok = QPushButton("🔓 KÍCH HOẠT NGAY")
        self.btn_ok.setFixedHeight(45)
        self.btn_ok.setStyleSheet("""
            QPushButton { background-color: #28a745; color: white; font-weight: bold; font-size: 14px; border-radius: 5px; }
            QPushButton:hover { background-color: #218838; }
        """)
        self.btn_ok.clicked.connect(self.verify)
        layout.addWidget(self.btn_ok)
        
        self.setLayout(layout)
        
    def verify(self):
        with open("license.key", "w") as f: f.write(self.input_key.text().strip())
        valid, msg, _, _ = self.lm.check_license()
        if valid: 
            QMessageBox.information(self, "Thành công", f"Kích hoạt thành công!\n{msg}")
            self.accept()
        else: 
            QMessageBox.warning(self, "Lỗi Kích Hoạt", "Key không hợp lệ hoặc đã hết hạn!\nVui lòng liên hệ Zalo: 0327.385.018")

# ============================================================================
# PHẦN 2: WORKER SIGNALS
# ============================================================================
def generate_ai_variants(api_key, keyword, original_content):
    try:
        # Sử dụng OpenAI client tương thích với API của Gemini
        client_ai = OpenAI(
            api_key=api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
        )
        
        # Prompt mới: Chế độ "Bảo toàn cấu trúc"
        prompt = f"""
        Bạn là một chuyên gia Content Marketing. Nhiệm vụ của bạn là tạo ra 10 biến thể bài viết nhưng phải TUÂN THỦ TUYỆT ĐỐI cấu trúc trình bày của bản gốc.

        DỮ LIỆU GỐC:
        \"\"\"
        {original_content}
        \"\"\"

        YÊU CẦU XỬ LÝ (QUAN TRỌNG):
        1. BỐ CỤC (LAYOUT): 
           - Bản gốc có bao nhiêu đoạn, bao nhiêu dòng trống, bao nhiêu gạch đầu dòng -> Bản mới phải y hệt như vậy.
           - Nếu bản gốc chia làm 5 khổ tách biệt -> Bản mới cũng phải có 5 khổ tách biệt.

        2. NỘI DUNG (CONTENT):
           - Các câu văn mô tả, cảm xúc: Hãy viết lại (paraphrase) cho mới mẻ, hấp dẫn hơn, dùng icon khác đi.
           - DỮ LIỆU CỐ ĐỊNH (BẮT BUỘC GIỮ NGUYÊN): Số điện thoại, Link Website, Tên riêng sản phẩm (Volkswagen Viloran...), Hashtag (#...), Địa chỉ.

        3. OUTPUT:
           - Chỉ trả về nội dung bài viết.
           - Ngăn cách các biến thể bằng chuỗi duy nhất: "---NEXT---"
           - Không được tự ý thêm số thứ tự (1., 2.) vào đầu bài.
        """
        
        response = client_ai.chat.completions.create(
            model="gemini-2.5-flash", 
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7 # Độ sáng tạo vừa phải để không phá vỡ cấu trúc
        )
        
        raw_text = response.choices[0].message.content
        raw_list = raw_text.split("---NEXT---")
        
        clean_list = []
        for p in raw_list:
            clean_p = p.strip()
            # Xóa số thứ tự nếu AI lỡ thêm vào
            clean_p = re.sub(r'^[\d]+\.\s*', '', clean_p)
            if len(clean_p) > 20:
                clean_list.append(clean_p)
                
        return clean_list
        
    except Exception as e:
        print(f"AI Error: {e}")
        return [original_content]

    
class WorkerSignals(QObject):
    log = pyqtSignal(str, str, str) 
    ai_generated = pyqtSignal(str)  
    countdown_set = pyqtSignal(str, int) 
    finished = pyqtSignal()

# ============================================================================
# PHẦN 3: GIAO DIỆN CHÍNH (GUI)
# ============================================================================
class FacebookPosterGUI(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("🚀 FB Post Group Multi-Thread Pro (Thuần)")
        self.setGeometry(100, 100, 1200, 950)
        
        if os.path.exists("logo.ico"):
            self.setWindowIcon(QIcon("logo.ico"))
        else:
            pass
        
        self.lm = LicenseManager()
        valid, days_left, expire_date, hwid = self.lm.check_license()
        
        if not valid:
            if LoginDialog().exec_() != QDialog.Accepted: sys.exit()
            valid, days_left, expire_date, hwid = self.lm.check_license()
        
        self.media_paths = [] 
        self.group_file_path = ""
        self.is_running = False
        self.countdown_map = {} 
        self.manual_drivers = [] 
        self.clipboard_lock = threading.Lock() # Khóa tránh xung đột Clipboard đa luồng
        
        self.signals = WorkerSignals()
        self.signals.log.connect(self.append_log)
        self.signals.ai_generated.connect(self.display_ai_content) 
        self.signals.countdown_set.connect(self.set_countdown)
        self.signals.finished.connect(self.on_finished)
        
        self.ui_timer = QTimer(); self.ui_timer.timeout.connect(self.update_countdowns); self.ui_timer.start(1000)
        self.init_ui(days_left, expire_date)

    def init_ui(self, days_left, expire_date):
        layout = QVBoxLayout()
        
        # --- HEADER ---
        h_header_container = QHBoxLayout()
        gb_sess = QGroupBox("💻 Phiên làm việc")
        gb_sess.setStyleSheet("font-weight: bold;")
        l_sess = QHBoxLayout()
        self.session_input = QLineEdit("Nganh_Hang_A")
        l_sess.addWidget(self.session_input)
        gb_sess.setLayout(l_sess)
        h_header_container.addWidget(gb_sess, stretch=6)
        
        frame_license = QFrame()
        frame_license.setFrameShape(QFrame.StyledPanel)
        
        # Thiết kế lại thẻ License với tông màu Neon tối giản, sang trọng phù hợp Dark Mode
        if days_left > 5:
            bg_color = "#132d1b"
            border_color = "#22c55e"
            text_color = "#4ade80"
        else:
            bg_color = "#3c151b"
            border_color = "#ef4444"
            text_color = "#f87171"
            
        frame_license.setStyleSheet(f"background-color: {bg_color}; border: 1.5px solid {border_color}; border-radius: 6px;")
        
        l_lic = QVBoxLayout(frame_license)
        l_lic.setContentsMargins(10, 5, 10, 5)
        lbl_days = QLabel(f"⏳ Còn lại: {days_left} ngày"); lbl_days.setAlignment(Qt.AlignCenter)
        lbl_days.setStyleSheet(f"color: {text_color}; font-size: 13px; font-weight: bold; border: none; background: transparent;")
        try: nice_date = datetime.datetime.strptime(expire_date, "%Y-%m-%d").strftime("%d/%m/%Y")
        except: nice_date = "Unknown"
        lbl_date = QLabel(f"Hết hạn: {nice_date}"); lbl_date.setAlignment(Qt.AlignCenter)
        lbl_date.setStyleSheet(f"color: {text_color}; font-size: 10px; border: none; background: transparent;")
        
        l_lic.addWidget(lbl_days); l_lic.addWidget(lbl_date)
        h_header_container.addWidget(frame_license, stretch=4)
        layout.addLayout(h_header_container)

        # --- 1. PROFILES & QUẢN LÝ ---
        gb_prof = QGroupBox("1. Quản lý Profiles")
        l_prof = QVBoxLayout()
        
        h_tool = QHBoxLayout()
        self.chk_all = QCheckBox("Chọn tất cả"); self.chk_all.stateChanged.connect(self.toggle_all)
        h_tool.addWidget(self.chk_all)
        
        # NÚT MỞ PROFILE (MỚI)
        btn_open = QPushButton("🌐 Mở Profile")
        btn_open.clicked.connect(self.open_profile_manual)
        btn_open.setStyleSheet("color: #c084fc; font-weight: bold;")
        h_tool.addWidget(btn_open)

        btn_create = QPushButton("➕ Tạo Mới"); btn_create.clicked.connect(self.create_profile)
        btn_create.setStyleSheet("color: #4ade80; font-weight: bold;")
        h_tool.addWidget(btn_create)

        btn_edit = QPushButton("✏️ Sửa Tên"); btn_edit.clicked.connect(self.rename_profile)
        btn_edit.setStyleSheet("color: #60a5fa; font-weight: bold;")
        h_tool.addWidget(btn_edit)

        btn_del = QPushButton("🗑️ Xóa"); btn_del.clicked.connect(self.delete_profile)
        btn_del.setStyleSheet("color: #f87171; font-weight: bold;")
        h_tool.addWidget(btn_del)

        btn_load = QPushButton("🔄 Tải lại"); btn_load.clicked.connect(self.load_profiles)
        h_tool.addWidget(btn_load)
        
        l_prof.addLayout(h_tool)
        
        self.list_profiles = QListWidget(); self.list_profiles.setFixedHeight(120)
        l_prof.addWidget(self.list_profiles)
        gb_prof.setLayout(l_prof)
        layout.addWidget(gb_prof)

        # --- 2. CẤU HÌNH & API KEY ---
        gb_conf = QGroupBox("2. Cấu hình & Nguồn Nhóm")
        l_conf = QVBoxLayout()
        
        h_api = QHBoxLayout()
        h_api.addWidget(QLabel("🔑 API Key Gemini:"))
        self.txt_api_key = QLineEdit()
        self.txt_api_key.setPlaceholderText("AIzaSy...")
        # Key mặc định nếu có
        self.txt_api_key.setText("") 
        h_api.addWidget(self.txt_api_key)
        
        # === [THÊM MỚI] CHECKBOX KHÔNG DÙNG AI ===
        self.chk_no_ai = QCheckBox("Giữ nguyên nội dung (Ko dùng AI)")
        self.chk_no_ai.setStyleSheet("color: #f87171; font-weight: bold;")
        self.chk_no_ai.toggled.connect(lambda: self.txt_api_key.setDisabled(self.chk_no_ai.isChecked())) # Tự động ẩn nhập Key nếu chọn
        h_api.addWidget(self.chk_no_ai)
        # =========================================

        l_conf.addLayout(h_api)

        h_row1 = QHBoxLayout()
        self.spin_thread = QSpinBox(); self.spin_thread.setValue(2); self.spin_thread.setPrefix("Luồng: ")
        self.spin_delay = QSpinBox(); self.spin_delay.setRange(1, 9999); self.spin_delay.setValue(10); self.spin_delay.setPrefix("Nghỉ (phút): ")
        self.spin_limit = QSpinBox(); self.spin_limit.setValue(10); self.spin_limit.setPrefix("Max bài: ")
        h_row1.addWidget(self.spin_thread); h_row1.addWidget(self.spin_delay); h_row1.addWidget(self.spin_limit)
        l_conf.addLayout(h_row1)

        # === CHỌN CHẾ ĐỘ CHẠY ===
        h_mode = QHBoxLayout()
        h_mode.addWidget(QLabel("⚙️ Chế độ chạy:"))
        self.combo_mode = QComboBox()
        self.combo_mode.addItems(["Đăng bài viết mới (Post)", "Bình luận bài viết khác (Comment)"])
        self.combo_mode.setStyleSheet("background-color: #161622; color: #f1f5f9; padding: 5px; border-radius: 6px; font-weight: bold;")
        h_mode.addWidget(self.combo_mode)
        l_conf.addLayout(h_mode)
        
        h_row2 = QHBoxLayout()
        self.btn_group_file = QPushButton("📂 File Link Nhóm"); self.btn_group_file.clicked.connect(self.select_group_file)
        self.lbl_group_file = QLabel("Mặc định dùng Từ khóa")
        self.lbl_group_file.setStyleSheet("color: #60a5fa; font-weight: bold;")
        self.txt_keyword = QLineEdit(); self.txt_keyword.setPlaceholderText("Từ khóa tìm nhóm...")
        h_row2.addWidget(self.btn_group_file); h_row2.addWidget(self.lbl_group_file); h_row2.addWidget(self.txt_keyword)
        l_conf.addLayout(h_row2)

        h_row3 = QHBoxLayout()
        h_row3.addWidget(QLabel("⏰ Hẹn giờ:"))
        self.dt_picker = QDateTimeEdit(QDateTime.currentDateTime()); 
        self.dt_picker.setDisplayFormat("dd/MM/yyyy HH:mm")
        self.dt_picker.setCalendarPopup(True)
        self.dt_picker.setMinimumDateTime(QDateTime.currentDateTime())
        self.chk_schedule = QCheckBox("Bật")
        h_row3.addWidget(self.chk_schedule); 
        h_row3.addWidget(self.dt_picker)
        l_conf.addLayout(h_row3)
        gb_conf.setLayout(l_conf)
        layout.addWidget(gb_conf)

        # 3. Nội dung & Media
        gb_cont = QGroupBox("3. Nội dung & Media (Hiển thị ảnh)")
        l_cont = QVBoxLayout()
        
        h_med_tools = QHBoxLayout()
        self.btn_media = QPushButton("📂 Chọn Media (Ảnh/Video)")
        self.btn_media.clicked.connect(self.select_media)
        h_med_tools.addWidget(self.btn_media)
        lbl_min_med = QLabel("Min Media:")
        lbl_min_med.setStyleSheet("border: none; background: transparent; font-weight: bold;")
        h_med_tools.addWidget(lbl_min_med)
        self.spin_min_media = QSpinBox()
        self.spin_min_media.setRange(0, 10)
        self.spin_min_media.setValue(1)
        h_med_tools.addWidget(self.spin_min_media)
        lbl_max_med = QLabel("Max Media:")
        lbl_max_med.setStyleSheet("border: none; background: transparent; font-weight: bold;")
        h_med_tools.addWidget(lbl_max_med)
        self.spin_max_media = QSpinBox()
        self.spin_max_media.setRange(0, 10)
        self.spin_max_media.setValue(2)
        h_med_tools.addWidget(self.spin_max_media)
        l_cont.addLayout(h_med_tools)
        self.scroll_area = QScrollArea()
        self.scroll_area.setFixedHeight(120) # Giảm chiều cao thanh cuộn ảnh xuống 120px cho gọn gàng
        self.scroll_area.setWidgetResizable(True)
        self.scroll_content = QWidget()
        self.media_layout = QHBoxLayout(self.scroll_content); self.media_layout.setAlignment(Qt.AlignLeft) 
        self.scroll_area.setWidget(self.scroll_content)
        l_cont.addWidget(self.scroll_area)
        
        h_txt = QHBoxLayout()
        self.txt_content = QTextEdit(); self.txt_content.setPlaceholderText("Nội dung gốc...")
        self.txt_ai = QTextEdit(); self.txt_ai.setReadOnly(True); self.txt_ai.setPlaceholderText("👉 Nội dung AI...")
        h_txt.addWidget(self.txt_content); h_txt.addWidget(self.txt_ai)
        l_cont.addLayout(h_txt)
        gb_cont.setLayout(l_cont)
        layout.addWidget(gb_cont)
 
        # Buttons
        h_btn = QHBoxLayout()
        self.btn_start = QPushButton("🔥 START"); self.btn_start.clicked.connect(self.start_campaign)
        self.btn_start.setObjectName("btn_start") # Đặt tên định danh để áp dụng kiểu QSS gradient riêng
        self.btn_stop = QPushButton("🛑 STOP"); self.btn_stop.clicked.connect(self.stop_campaign); self.btn_stop.setEnabled(False)
        self.btn_stop.setObjectName("btn_stop") # Đặt tên định danh để áp dụng kiểu QSS gradient riêng
        h_btn.addWidget(self.btn_start); h_btn.addWidget(self.btn_stop)
        layout.addLayout(h_btn)
        
        self.table = QTableWidget(0, 4); self.table.setHorizontalHeaderLabels(["Nick", "Hành động", "Kết quả", "Wait"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.setMinimumHeight(280) # Tăng chiều cao tối thiểu của bảng tiến trình để hiển thị rộng rãi, to hơn
        layout.addWidget(self.table)
        self.setLayout(layout)
        self.load_profiles()
        
        # ÁP DỤNG BỘ STYLE SHEET DARK MODE SAAS CAO CẤP
        self.setStyleSheet("""
            QWidget {
                background-color: #1a1a24;
                color: #e2e8f0;
                font-family: 'Segoe UI', Arial, sans-serif;
                font-size: 12px;
            }
            
            QGroupBox {
                font-weight: bold;
                border: 2px solid #2d2d3d;
                border-radius: 8px;
                margin-top: 10px;
                padding-top: 15px;
                background-color: #222232;
            }
            
            QGroupBox::title {
                subcontrol-origin: margin;
                subcontrol-position: top left;
                left: 15px;
                padding: 0 5px;
                color: #60a5fa;
            }
            
            QLineEdit, QTextEdit, QSpinBox, QDateTimeEdit {
                background-color: #161622;
                border: 1px solid #3b3b54;
                border-radius: 6px;
                padding: 6px 10px;
                color: #f1f5f9;
            }
            
            QLineEdit:focus, QTextEdit:focus, QSpinBox:focus, QDateTimeEdit:focus {
                border: 1px solid #3b82f6;
                background-color: #1c1c2e;
            }
            
            QPushButton {
                background-color: #2d2d3d;
                border: 1px solid #3b3b54;
                border-radius: 6px;
                color: #e2e8f0;
                padding: 6px 12px;
                font-weight: bold;
            }
            
            QPushButton:hover {
                background-color: #3b3b54;
                border-color: #60a5fa;
            }
            
            QPushButton:pressed {
                background-color: #1e1e2d;
            }
            
            QPushButton#btn_start {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #1d4ed8, stop:1 #3b82f6);
                border: none;
                color: white;
                font-size: 13px;
                padding: 10px;
            }
            
            QPushButton#btn_start:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #1e40af, stop:1 #2563eb);
            }
            
            QPushButton#btn_start:disabled {
                background-color: #334155;
                color: #64748b;
            }
            
            QPushButton#btn_stop {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #b91c1c, stop:1 #ef4444);
                border: none;
                color: white;
                font-size: 13px;
                padding: 10px;
            }
            
            QPushButton#btn_stop:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #991b1b, stop:1 #dc2626);
            }
            
            QPushButton#btn_stop:disabled {
                background-color: #334155;
                color: #64748b;
            }
            
            QTableWidget {
                background-color: #222232;
                gridline-color: #2d2d3d;
                border: 1px solid #2d2d3d;
                border-radius: 8px;
            }
            
            QTableWidget::item {
                padding: 6px;
                color: #e2e8f0;
            }
            
            QHeaderView::section {
                background-color: #161622;
                color: #94a3b8;
                font-weight: bold;
                padding: 6px;
                border: none;
                border-bottom: 2px solid #2d2d3d;
            }
            
            QListWidget {
                background-color: #161622;
                border: 1px solid #3b3b54;
                border-radius: 6px;
                padding: 5px;
            }
            
            QListWidget::item {
                padding: 6px;
                border-bottom: 1px solid #2d2d3d;
                color: #e2e8f0;
            }
            
            QListWidget::item:hover {
                background-color: #252538;
                border-radius: 4px;
            }
            
            QListWidget::item:selected {
                background-color: #2563eb;
                color: white;
                border-radius: 4px;
            }
            
            QScrollBar:vertical {
                border: none;
                background-color: #161622;
                width: 8px;
                margin: 0px;
            }
            
            QScrollBar::handle:vertical {
                background-color: #3b3b54;
                min-height: 20px;
                border-radius: 4px;
            }
            
            QScrollBar::handle:vertical:hover {
                background-color: #4b4b69;
            }
            
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                border: none;
                background: none;
            }
            
            QCheckBox {
                color: #e2e8f0;
            }
            
            QCheckBox::indicator {
                width: 16px;
                height: 16px;
                border: 1px solid #3b3b54;
                border-radius: 4px;
                background-color: #161622;
            }
            
            QCheckBox::indicator:checked {
                background-color: #3b82f6;
                border-color: #3b82f6;
            }
        """)

    # --- GUI LOGIC ---
    def toggle_all(self, state):
        for i in range(self.list_profiles.count()):
            self.list_profiles.item(i).setCheckState(Qt.Checked if state == Qt.Checked else Qt.Unchecked)

    def load_profiles(self):
        self.list_profiles.clear()
        path = "C:/SeleniumProfile_thuan" 
        if os.path.exists(path):
            for f in os.listdir(path):
                if os.path.isdir(os.path.join(path, f)) and ("Profile" in f):
                    item = QListWidgetItem(f); item.setCheckState(Qt.Unchecked)
                    self.list_profiles.addItem(item)

    # --- CÁC HÀM QUẢN LÝ PROFILE (MỚI) ---
    def create_profile(self):
        text, ok = QInputDialog.getText(self, 'Tạo Profile', 'Nhập tên Profile mới:')
        if ok and text:
            new_path = os.path.join(PROFILE_ROOT_PATH, text)
            if not os.path.exists(new_path):
                os.makedirs(new_path)
                QMessageBox.information(self, "OK", f"Đã tạo profile: {text}")
                self.load_profiles()
            else:
                QMessageBox.warning(self, "Lỗi", "Tên profile này đã tồn tại!")

    def rename_profile(self):
        current_item = self.list_profiles.currentItem()
        if not current_item:
            QMessageBox.warning(self, "Lỗi", "Vui lòng chọn 1 Profile để sửa tên!")
            return
        
        old_name = current_item.text()
        text, ok = QInputDialog.getText(self, 'Sửa tên', f'Nhập tên mới cho "{old_name}":', text=old_name)
        if ok and text and text != old_name:
            old_path = os.path.join(PROFILE_ROOT_PATH, old_name)
            new_path = os.path.join(PROFILE_ROOT_PATH, text)
            try:
                os.rename(old_path, new_path)
                QMessageBox.information(self, "OK", "Đổi tên thành công!")
                self.load_profiles()
            except Exception as e:
                QMessageBox.critical(self, "Lỗi", f"Không thể đổi tên: {e}")

    def delete_profile(self):
        current_item = self.list_profiles.currentItem()
        if not current_item:
            QMessageBox.warning(self, "Lỗi", "Vui lòng chọn 1 Profile để xóa!")
            return
        
        name = current_item.text()
        reply = QMessageBox.question(self, 'Xác nhận', f"Bạn có chắc muốn xóa vĩnh viễn profile: {name}?", QMessageBox.Yes | QMessageBox.No)
        
        if reply == QMessageBox.Yes:
            path = os.path.join(PROFILE_ROOT_PATH, name)
            try:
                shutil.rmtree(path) # Xóa thư mục và nội dung bên trong
                QMessageBox.information(self, "OK", "Đã xóa profile!")
                self.load_profiles()
            except Exception as e:
                QMessageBox.critical(self, "Lỗi", f"Không thể xóa: {e}")

    # --- MỞ PROFILE THỦ CÔNG ---
    def open_profile_manual(self):
        current_item = self.list_profiles.currentItem()
        if not current_item: return QMessageBox.warning(self, "Lỗi", "Chọn 1 Profile để mở!")
        profile_name = current_item.text()
        threading.Thread(target=self._open_browser_thread, args=(profile_name,), daemon=True).start()

    def _open_browser_thread(self, profile_name):
        try:
            options = webdriver.ChromeOptions()
            p_path = os.path.join(PROFILE_ROOT_PATH, profile_name).replace("/", "\\")
            options.add_argument(f"--user-data-dir={p_path}")
            options.add_argument("--disable-notifications")
            driver = webdriver.Chrome(options=options)
            driver.get("https://www.facebook.com")
            
            # Lưu driver vào list để không bị đóng
            self.manual_drivers.append(driver)
        except Exception as e:
            print(f"Lỗi mở manual: {e}")

    # ---------------------------

    def select_group_file(self):
        f, _ = QFileDialog.getOpenFileName(self, "Chọn File", "", "Text Files (*.txt)")
        if f:
            self.group_file_path = f
            self.lbl_group_file.setText(f"✅ {os.path.basename(f)}")
            self.txt_keyword.setDisabled(True)
        else:
            self.group_file_path = ""
            self.lbl_group_file.setText("...")
            self.txt_keyword.setDisabled(False)

    def select_media(self):
        files, _ = QFileDialog.getOpenFileNames(self, "Chọn Media", "", "All (*.jpg *.png *.mp4 *.avi)")
        if files:
            for f in files:
                if f not in self.media_paths: 
                    self.media_paths.append(f)
                    self.add_thumbnail_to_ui(f)

    def add_thumbnail_to_ui(self, file_path):
        thumb = MediaThumbnail(file_path)
        thumb.removed.connect(self.remove_media) 
        self.media_layout.addWidget(thumb)

    def remove_media(self, file_path):
        if file_path in self.media_paths:
            self.media_paths.remove(file_path)

    def display_ai_content(self, text):
        self.txt_ai.setText(text)
        self.txt_ai.setStyleSheet("color: #60a5fa; font-weight: bold; border: 1px solid #3b82f6;")

    def append_log(self, nick, action, status):
        row = -1
        for r in range(self.table.rowCount()):
            if self.table.item(r, 0).text() == nick: row = r; break
        if row == -1:
            row = self.table.rowCount(); self.table.insertRow(row)
            self.table.setItem(row, 0, QTableWidgetItem(nick))
            self.table.setItem(row, 3, QTableWidgetItem("--"))
        
        self.table.setItem(row, 1, QTableWidgetItem(action))
        it_res = QTableWidgetItem(status)
        
        # Bảng màu trạng thái phối hợp hài hòa trong giao diện tối
        if "Thành công" in status or "Done" in status:
            it_res.setForeground(QColor("#4ade80")) # Xanh neon dịu
        elif "Lỗi" in status or "Crash" in status or "LỖI" in status:
            it_res.setForeground(QColor("#f87171")) # Đỏ pastel
        elif "Đang" in action or "Wait" in status or "Search" in action:
            it_res.setForeground(QColor("#fb923c")) # Cam nhạt
        else:
            it_res.setForeground(QColor("#cdd6f4")) # Màu chữ trắng bạc mặc định
            
        self.table.setItem(row, 2, it_res)
        
        if "Đang" in action: 
            self.table.setItem(row, 3, QTableWidgetItem("--"))
            if nick in self.countdown_map: del self.countdown_map[nick]

    def set_countdown(self, nick, seconds):
        self.countdown_map[nick] = time.time() + seconds

    def update_countdowns(self):
        for r in range(self.table.rowCount()):
            nick = self.table.item(r, 0).text()
            if nick in self.countdown_map:
                rem = int(self.countdown_map[nick] - time.time())
                if rem > 0:
                    m, s = divmod(rem, 60); h, m = divmod(m, 60)
                    self.table.setItem(r, 3, QTableWidgetItem(f"{h:02d}:{m:02d}:{s:02d}"))
                else:
                    self.table.setItem(r, 3, QTableWidgetItem("Sẵn sàng"))
                    del self.countdown_map[nick]

    def start_campaign(self):
        profs = [self.list_profiles.item(i).text() for i in range(self.list_profiles.count()) if self.list_profiles.item(i).checkState() == Qt.Checked]
        if not profs: return QMessageBox.warning(self, "Lỗi", "Chưa chọn Nick!")
        if not self.txt_content.toPlainText(): return QMessageBox.warning(self, "Lỗi", "Chưa nhập nội dung!")
        
        # === [SỬA ĐỔI] CHỈ KIỂM TRA KEY NẾU DÙNG AI ===
        use_original = self.chk_no_ai.isChecked()
        api_key = self.txt_api_key.text().strip()
        
        if not use_original and not api_key: 
            return QMessageBox.warning(self, "Lỗi", "Chưa nhập API Key Gemini!\n(Hoặc tích chọn 'Giữ nguyên nội dung')")
        # ==============================================

        if self.chk_schedule.isChecked():
            diff = QDateTime.currentDateTime().secsTo(self.dt_picker.dateTime())
            if diff > 0:
                QMessageBox.information(self, "Hẹn giờ", f"Chạy sau {diff} giây.")
                QTimer.singleShot(diff * 1000, self.execute_threads)
                return
        self.execute_threads()

    def execute_threads(self):
        self.is_running = True
        self.btn_start.setEnabled(False); self.btn_stop.setEnabled(True)
        profiles = [self.list_profiles.item(i).text() for i in range(self.list_profiles.count()) if self.list_profiles.item(i).checkState() == Qt.Checked]
        keyword = self.txt_keyword.text().strip()
        content = self.txt_content.toPlainText()
        hist_file = f"posted_{self.session_input.text().strip()}.txt"
        min_media = self.spin_min_media.value()
        max_media = self.spin_max_media.value()
        
        use_original = self.chk_no_ai.isChecked()
        # Lấy API Key từ ô nhập
        api_key = self.txt_api_key.text().strip()
        
        run_mode = self.combo_mode.currentText()
        
        threading.Thread(target=self.run_logic_wrapper, args=(profiles, keyword, content, hist_file, min_media, max_media, api_key, use_original, run_mode), daemon=True).start()

    def stop_campaign(self):
        self.is_running = False
        self.btn_stop.setEnabled(False); self.btn_start.setEnabled(True)

    def on_finished(self):
        self.is_running = False
        self.btn_start.setEnabled(True); self.btn_stop.setEnabled(False)
        QMessageBox.information(self, "Hoàn tất", "Đã chạy xong chiến dịch!")

    # ========================================================================
    # LOGIC CHÍNH
    # ========================================================================
    def run_logic_wrapper(self, profiles, keyword, content, hist_file, min_media, max_media, api_key, use_original, run_mode):
        is_comment_mode = "Bình luận" in run_mode
        mode_label = "Bình luận dạo" if is_comment_mode else "Đăng bài"
        self.signals.log.emit("System", "Mode", f"Chế độ chạy: {mode_label}")
            
        if use_original:
            # === TRƯỜNG HỢP 1: DÙNG NỘI DUNG GỐC ===
            self.signals.log.emit("System", "Info", "Chế độ: GIỮ NGUYÊN NỘI DUNG GỐC")
            content_pool = [content] # Chỉ có 1 nội dung duy nhất
            self.signals.ai_generated.emit(f"📝 ĐANG SỬ DỤNG NỘI DUNG GỐC:\n\n{content}")
        else:
            # === TRƯỜNG HỢP 2: DÙNG AI (CODE CŨ) ===
            self.signals.log.emit("System", "AI", "Đang soạn nội dung...")
            content_pool = generate_ai_variants(api_key, keyword if keyword else "General", content)
            full_text_display = f"---- {len(content_pool)} BIẾN THỂ ĐÃ TẠO ----\n" + "\n\n----------------\n\n".join(content_pool)
            self.signals.ai_generated.emit(full_text_display)
        
        limit = self.spin_limit.value()
        delay_min = self.spin_delay.value() 
        
        pool = ThreadPoolExecutor(max_workers=self.spin_thread.value())
        for prof in profiles:
            if not self.is_running: break
            pool.submit(self.worker_task, prof, keyword, content_pool, hist_file, limit, delay_min, min_media, max_media, is_comment_mode)
            
        pool.shutdown(wait=True)
        self.signals.finished.emit()
    
    def safe_copy_to_clipboard(self, text, max_retries=10):
        for i in range(max_retries):
            try:
                pyperclip.copy(text)
                return True 
            except Exception:
                time.sleep(0.2)
        return False 
    
    def worker_task(self, profile_name, search_term, content_pool, history_file, limit, delay_min, min_media, max_media, is_comment_mode=False):
        if not self.is_running: return

        options = webdriver.ChromeOptions()
        p_path = os.path.join(PROFILE_ROOT_PATH, profile_name).replace("/", "\\")
        options.add_argument(f"--user-data-dir={p_path}")
        options.add_argument("--disable-notifications")
        options.add_argument("--no-sandbox")
        options.add_experimental_option('excludeSwitches', ['enable-logging'])
        
        driver = None
        try:
            driver = webdriver.Chrome(options=options)
            driver.maximize_window()
            
            driver.get("https://www.facebook.com/")
            time.sleep(3)
            if "login" in driver.current_url:
                self.signals.log.emit(profile_name, "LỖI", "Chưa đăng nhập FB!")
                time.sleep(5)
                return 

            posted_groups = set()
            if os.path.exists(history_file):
                with open(history_file, 'r', encoding='utf-8') as f: posted_groups = set(l.strip() for l in f)

            group_links = []
            if self.group_file_path and os.path.exists(self.group_file_path):
                self.signals.log.emit(profile_name, "File Mode", "Đọc link nhóm...")
                with open(self.group_file_path, "r", encoding="utf-8") as f:
                    for line in f:
                         if "facebook.com/groups" in line: group_links.append(line.strip().split("?")[0])
            elif search_term:
                self.signals.log.emit(profile_name, "Search", f"Tìm: {search_term}")
                driver.get(f"https://www.facebook.com/groups/search/groups/?q={search_term}")
                time.sleep(5)
                for _ in range(3): 
                    driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                    time.sleep(3)
                links = driver.find_elements(By.TAG_NAME, 'a')
                for a in links:
                    h = a.get_attribute('href')
                    if h and '/groups/' in h and 30 < len(h) < 150:
                        if "/user/" not in h and "/my_groups/" not in h:
                            clean = h.split("?")[0]
                            if clean not in group_links: group_links.append(clean)
            
            if not group_links:
                self.signals.log.emit(profile_name, "STOP", "Không tìm thấy nhóm nào!")
                time.sleep(5) 
                return

            group_links = [g for g in group_links if g not in posted_groups] 
            if not group_links:
                self.signals.log.emit(profile_name, "STOP", "Đã hết nhóm mới!")
                time.sleep(5)
                return

            self.signals.log.emit(profile_name, "Info", f"Chạy {len(group_links)} nhóm")

            count = 0
            for group_link in group_links:
                if not self.is_running: break
                if count >= limit: break

                try:
                    driver.get(group_link)
                    time.sleep(random.uniform(4, 6))

                    try:
                        join_btns = driver.find_elements(By.XPATH, "//div[@aria-label='Tham gia nhóm' or @aria-label='Join Group' or @aria-label='グループに参加']")
                        if join_btns:
                            join_btns[0].click()
                            self.signals.log.emit(profile_name, "Join", "Đã bấm tham gia")
                            time.sleep(4)
                            try: driver.find_element(By.XPATH, "//div[@aria-label='Đóng' or @aria-label='Close' or @aria-label='閉じる']").click()
                            except: pass
                    except: pass

                    if is_comment_mode:
                        # ====================================================
                        # CHẾ ĐỘ 2: BÌNH LUẬN DẠO BÀI VIẾT NGƯỜI KHÁC
                        # ====================================================
                        self.signals.log.emit(profile_name, "Comment", "Tìm bài viết...")
                        driver.execute_script("window.scrollTo(0, 500);")
                        time.sleep(3)

                        self.signals.log.emit(profile_name, "Comment", "Đang tìm nút bình luận...")
                        
                        # 1. Tìm nút "Bình luận" (Comment button) dưới bài viết
                        comment_btns = driver.find_elements(By.XPATH, "//*[@aria-label='Bình luận' or @aria-label='Comment' or @aria-label='Write a comment' or @aria-label='Viết bình luận' or @aria-label='コメント' or @aria-label='コメントする']")
                        if not comment_btns:
                            comment_btns = driver.find_elements(By.XPATH, "//*[text()='Bình luận' or text()='Comment' or text()='コメント' or text()='コメントする']")

                        if not comment_btns:
                            self.signals.log.emit(profile_name, "Skip", "Không thấy nút bình luận")
                            continue

                        # Click nút Bình luận của bài viết đầu tiên để kích hoạt ô comment
                        btn = comment_btns[0]
                        try:
                            driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", btn)
                            time.sleep(2)
                            btn.click()
                            time.sleep(2)
                        except Exception as e:
                            try:
                                driver.execute_script("arguments[0].click();", btn)
                                time.sleep(2)
                            except:
                                pass

                        # 2. Định vị ô nhập liệu contenteditable="true"
                        comment_box = None
                        
                        # Thử lấy phần tử đang được active (focus)
                        try:
                            active_element = driver.switch_to.active_element
                            if active_element and active_element.get_attribute("contenteditable") == "true":
                                comment_box = active_element
                        except:
                            pass

                        # Nếu không lấy được qua active_element, tìm tất cả div contenteditable="true"
                        if not comment_box:
                            editable_divs = driver.find_elements(By.XPATH, "//div[@contenteditable='true']")
                            # Lọc tìm ô có nhãn hoặc placeholder liên quan đến comment
                            for div in editable_divs:
                                placeholder = str(div.get_attribute("aria-placeholder") or div.get_attribute("aria-label") or "").lower()
                                if "viết bình luận" in placeholder or "write a comment" in placeholder or "comment" in placeholder or "bình luận" in placeholder or "コメント" in placeholder:
                                    comment_box = div
                                    break
                            
                            # Fallback cuối cùng: lấy ô contenteditable đầu tiên không phải ô đăng bài chính
                            if not comment_box and editable_divs:
                                for div in editable_divs:
                                    placeholder = str(div.get_attribute("aria-placeholder") or div.get_attribute("aria-label") or "").lower()
                                    if "tạo bài viết" not in placeholder and "bạn viết gì đi" not in placeholder and "write something" not in placeholder and "書き込" not in placeholder and "投稿を作成" not in placeholder:
                                        comment_box = div
                                        break

                        if not comment_box:
                            self.signals.log.emit(profile_name, "Skip", "Không tìm thấy ô comment")
                            continue

                        # Đảm bảo click và focus vào ô comment
                        try:
                            driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", comment_box)
                            time.sleep(1)
                            comment_box.click()
                            time.sleep(1)
                        except Exception as click_err:
                            print(f"Lỗi click vào ô comment: {click_err}")

                        # Đính kèm hình ảnh (nếu người dùng có chọn ảnh ở phần Media)
                        if self.media_paths:
                            try:
                                # Định vị thẻ input file tương ứng của khung bình luận này
                                file_input = None
                                try:
                                    editor_container = comment_box.find_element(By.XPATH, "./parent::div/parent::div/parent::div/parent::div")
                                    file_input = editor_container.find_element(By.XPATH, ".//input[@type='file']")
                                except:
                                    pass
                                    
                                if not file_input:
                                    try:
                                        file_input = comment_box.find_element(By.XPATH, "./ancestor::div[contains(@class,'x1iyjqo2') or contains(@class,'x1a2a7zl') or contains(@class,'x6s0dn4')]//input[@type='file']")
                                    except:
                                        pass
                                        
                                if not file_input:
                                    try:
                                        file_input = driver.find_element(By.XPATH, "//input[@type='file' and contains(@accept, 'image')]")
                                    except:
                                        pass

                                if file_input:
                                    img_path = random.choice(self.media_paths)
                                    file_input.send_keys(img_path)
                                    self.signals.log.emit(profile_name, "Upload ảnh", "Đang đính kèm ảnh...")
                                    time.sleep(5) # Chờ ảnh tải lên xong
                            except Exception as img_err:
                                print(f"Lỗi đính kèm ảnh comment: {img_err}")

                        # Dán nội dung và gửi bình luận
                        success_sent = False
                        is_spammed = False
                        try:
                            post_text = random.choice(content_pool)
                            for attempt in range(3):
                                # Focus và click để đảm bảo ô comment được mở rộng
                                try:
                                    driver.execute_script("arguments[0].focus();", comment_box)
                                    time.sleep(0.5)
                                    comment_box.click()
                                    time.sleep(1)
                                except:
                                    pass
                                
                                with self.clipboard_lock:
                                    if self.safe_copy_to_clipboard(post_text):
                                        # Xóa nội dung cũ để tránh dán thừa
                                        try:
                                            comment_box.send_keys(Keys.CONTROL, 'a')
                                            comment_box.send_keys(Keys.BACKSPACE)
                                        except:
                                            pass
                                        
                                        comment_box.send_keys(Keys.CONTROL, 'v')
                                        time.sleep(2) # Chờ clipboard đồng bộ
                                
                                # Kiểm tra xem chữ đã được điền vào ô comment chưa
                                current_val = comment_box.text or comment_box.get_attribute("innerText") or ""
                                if len(current_val.strip()) > 0:
                                    comment_box.send_keys(Keys.ENTER)
                                    self.signals.log.emit(profile_name, "Comment", "Đang gửi bình luận...")
                                    time.sleep(5)
                                    
                                    # Kiểm tra cảnh báo spam từ Facebook (hỗ trợ đa ngôn ngữ)
                                    # limit_msgs = driver.find_elements(By.XPATH, "//*[contains(text(),'giới hạn') or contains(text(),'tần suất') or contains(text(),'đã bị giới hạn') or contains(text(),'chặn') or contains(text(),'limit') or contains(text(),'restricted') or contains(text(),'block') or contains(text(),'制限') or contains(text(),'ブロック')]")
                                    # if limit_msgs:
                                    #     self.signals.log.emit(profile_name, "Spam Warning", "⚠️ Bị chặn comment, dừng lại.")
                                    #     is_spammed = True
                                    #     break
                                    
                                    limit_msgs = driver.find_elements(By.XPATH, "//*[contains(text(),'giới hạn') or contains(text(),'tần suất') or contains(text(),'đã bị giới hạn')]")
                                    if limit_msgs:
                                        self.signals.log.emit(profile_name, "Spam Warning", "⚠️ Bị giới hạn spam, dừng lại.")
                                        break

                                    success_sent = True
                                    break
                                else:
                                    print(f"Thử lại dán nội dung comment lần {attempt + 1}...")
                                    time.sleep(1)
                        except Exception as post_err:
                            self.signals.log.emit(profile_name, "Lỗi Comment", str(post_err)[:20])
                            continue

                        if is_spammed:
                            break # Thoát vòng lặp đăng bài của nick này

                        if not success_sent:
                            self.signals.log.emit(profile_name, "Lỗi Comment", "Không điền được chữ")
                            continue

                        count += 1
                        with open(history_file, 'a', encoding='utf-8') as f: f.write(group_link + '\n')
                        self.signals.log.emit(profile_name, "Done", f"Đã comment ({count})")

                        # Đóng cửa sổ bài viết chi tiết (modal popup) bằng phím ESC để quay lại nhóm
                        try:
                            driver.find_element(By.TAG_NAME, 'body').send_keys(Keys.ESCAPE)
                            time.sleep(2)
                        except:
                            pass

                        if count < limit:
                            sleep_sec = delay_min * 60
                            self.signals.countdown_set.emit(profile_name, sleep_sec)
                            time.sleep(sleep_sec)

                    else:
                        # ====================================================
                        # CHẾ ĐỘ 1: ĐĂNG BÀI VIẾT MỚI (NGUYÊN BẢN)
                        # ====================================================
                        try:
                            create_btn = WebDriverWait(driver, 10).until(EC.element_to_be_clickable((By.XPATH, "//div[contains(@class,'x1lkfr7t') and contains(@class,'x13faqbe')]")))
                            create_btn.click()
                            time.sleep(4)
                        except:
                            self.signals.log.emit(profile_name, "Skip", "Không thấy nút viết bài")
                            continue

                        qty_for_this_post = random.randint(min_media, max_media)
                        actual_qty = min(len(self.media_paths), qty_for_this_post)
                        current_media = random.sample(self.media_paths, actual_qty) if self.media_paths else []
                        
                        if current_media:
                            try:
                                file_input = driver.find_element(By.XPATH, "//div[@class ='x78zum5']//input[@type='file']")
                                file_input.send_keys("\n".join(current_media))
                                wait_time = 20 if any(f.endswith(".mp4") for f in current_media) else 5 + (actual_qty * 2)
                                self.signals.log.emit(profile_name, "Upload", f"Up {actual_qty} file, chờ {wait_time}s...")
                                time.sleep(wait_time)
                            except Exception as e:
                                print(f"Lỗi upload: {e}")
                        
                        try:
                            post_text = random.choice(content_pool)
                            post_box = driver.find_element(By.XPATH,
                            "//div[contains(@aria-placeholder,'Bạn viết gì đi...') or contains(@aria-placeholder, 'Tạo bài viết công khai...') or contains(@aria-placeholder, 'Write something...') or contains(@aria-placeholder, 'Create a public post...') or contains(@aria-placeholder, '書き込') or contains(@aria-placeholder, '投稿を作成') or contains(@aria-label, 'Bạn viết gì đi...') or contains(@aria-label, 'Tạo bài viết công khai...') or contains(@aria-label, 'Write something...') or contains(@aria-label, 'Create a public post...') or contains(@aria-label, '書き込') or contains(@aria-label, '投稿を作成')]")       
                            post_box.click()
                            time.sleep(1)

                            # Sử dụng clipboard_lock để đảm bảo các luồng không tranh giành dán đè Clipboard
                            with self.clipboard_lock:
                                if self.safe_copy_to_clipboard(post_text):
                                    post_box.send_keys(Keys.CONTROL, 'v')
                                    time.sleep(2) # Giữ luồng để dán hoàn tất trước khi mở khóa cho luồng tiếp theo
                                    print(f"-> Đã dán nội dung (có Emoji) cho: {profile_name}")
                                else:
                                    print(f"-> Lỗi: Không thể chiếm quyền Clipboard cho: {profile_name}")
                                    self.signals.log.emit(profile_name, "Lỗi Clipboard", "Busy")

                        except Exception as e:
                            self.signals.log.emit(profile_name, "Lỗi Post", str(e))
                            print(f"Chi tiết lỗi: {e}")

                        # Bấm nút Đăng bài tự động (Kích hoạt lại & Tối ưu hóa)
                        try:
                            btn_dang = driver.find_element(By.XPATH, "//div[@aria-label='Đăng' or @aria-label='Post' or @aria-label='投稿' or @aria-label='投稿する']")
                            driver.execute_script("arguments[0].click();", btn_dang)
                            self.signals.log.emit(profile_name, "Đăng bài", "Đang xử lý đăng...")
                            time.sleep(10) # Chờ FB tải bài viết lên máy chủ
                        except Exception as e:
                            self.signals.log.emit(profile_name, "Lỗi Đăng", "Không click được nút Đăng")
                            print(f"Lỗi click Đăng: {e}")
                            continue
                        
                        # Check limit/spam (Chạy sau khi bấm đăng - hỗ trợ đa ngôn ngữ)
                        # limit_msgs = driver.find_elements(By.XPATH, "//*[contains(text(),'giới hạn') or contains(text(),'tần suất') or contains(text(),'đã bị giới hạn') or contains(text(),'chặn') or contains(text(),'limit') or contains(text(),'restricted') or contains(text(),'block') or contains(text(),'制限') or contains(text(),'ブロック')]")
                        # if limit_msgs:
                        #     self.signals.log.emit(profile_name, "Spam Warning", "⚠️ Bị giới hạn spam, dừng lại.")
                        #     break
                        
                        limit_msgs = driver.find_elements(By.XPATH, "//*[contains(text(),'giới hạn') or contains(text(),'tần suất') or contains(text(),'đã bị giới hạn')]")
                        if limit_msgs:
                            self.signals.log.emit(profile_name, "Spam Warning", "⚠️ Bị giới hạn spam, dừng lại.")
                            break

                        
                        count += 1
                        with open(history_file, 'a', encoding='utf-8') as f: f.write(group_link + '\n')
                        self.signals.log.emit(profile_name, "Done", f"Đã đăng ({count})")

                        if count < limit:
                            sleep_sec = delay_min * 60
                            self.signals.countdown_set.emit(profile_name, sleep_sec)
                            time.sleep(sleep_sec)

                except Exception as e:
                    self.signals.log.emit(profile_name, "Error Loop", str(e)[:20])
                    continue
                    
        except Exception as e:
            self.signals.log.emit(profile_name, "Crash", str(e))
        finally:
            if driver: driver.quit()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    win = FacebookPosterGUI()
    win.show()
    sys.exit(app.exec_())