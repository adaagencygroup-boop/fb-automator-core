"""
Module 6: Quản lý Chat Page (Omnichannel)
Phụ trách: Mạnh, Minh
Chức năng: Quản lý hộp thư tập trung nhiều Page, tự động phản hồi AI thông minh
"""
from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, 
    QListWidget, QTextEdit, QLineEdit, QSplitter, QFrame, QMessageBox
)
from PyQt5.QtCore import Qt
from core.base_module import BaseModuleTab
from core.database.connection import db
from modules.module_06_omnichannel_chat.worker import ChatSyncWorker

class OmnichannelChatTab(BaseModuleTab):
    def __init__(self, parent=None):
        super().__init__(
            module_id="module_06_omnichannel_chat",
            module_title="Quản Lý Chat Page (Omnichannel & AI Bot)",
            author="Mạnh, Minh",
            parent=parent
        )

    def init_ui(self):
        # Header Action
        self.btn_toggle_bot = QPushButton("🤖 Bật Tự Động Trả Lời AI")
        self.btn_toggle_bot.setProperty("class", "btn-success")
        self.btn_toggle_bot.setCheckable(True)
        self.btn_toggle_bot.clicked.connect(self.toggle_bot)
        self.header_actions_layout.addWidget(self.btn_toggle_bot)

        splitter = QSplitter(Qt.Horizontal)

        # Cột trái: Danh sách hội thoại
        left_panel = QFrame()
        left_panel.setProperty("class", "card")
        layout_left = QVBoxLayout(left_panel)

        lbl_conv = QLabel("💬 HỘP THƯ TẬP TRUNG TẤT CẢ PAGE")
        lbl_conv.setStyleSheet("font-weight: bold; color: #00f0ff;")
        layout_left.addWidget(lbl_conv)

        self.list_conversations = QListWidget()
        self.list_conversations.itemClicked.connect(self.on_conversation_selected)
        layout_left.addWidget(self.list_conversations)

        # Cột phải: Khung chat chi tiết
        right_panel = QFrame()
        right_panel.setProperty("class", "card")
        layout_right = QVBoxLayout(right_panel)

        self.lbl_chat_header = QLabel("Chi Tiết Cuộc Trò Chuyện")
        self.lbl_chat_header.setStyleSheet("font-weight: bold; color: #f1f5f9; font-size: 13px;")
        layout_right.addWidget(self.lbl_chat_header)

        self.txt_chat_history = QTextEdit()
        self.txt_chat_history.setReadOnly(True)
        layout_right.addWidget(self.txt_chat_history)

        row_send = QHBoxLayout()
        self.txt_reply = QLineEdit()
        self.txt_reply.setPlaceholderText("Nhập tin nhắn phản hồi thủ công...")
        btn_send = QPushButton("Gửi")
        btn_send.setProperty("class", "btn-primary")
        btn_send.clicked.connect(self.send_reply)

        row_send.addWidget(self.txt_reply)
        row_send.addWidget(btn_send)
        layout_right.addLayout(row_send)

        splitter.addWidget(left_panel)
        splitter.addWidget(right_panel)
        splitter.setSizes([300, 600])

        self.main_layout.addWidget(splitter)
        self.load_mock_conversations()

    def load_mock_conversations(self):
        # Nạp dữ liệu mẫu vào SQLite nếu trống
        count = db.fetch_one("SELECT COUNT(*) as c FROM chat_messages")["c"]
        if count == 0:
            db.execute(
                """INSERT INTO chat_messages (page_id, conversation_id, sender_id, sender_name, message, is_outgoing) 
                VALUES ('PAGE_1', 'C1', 'USER_123', 'Nguyễn Văn An', 'Shop còn mẫu áo thun này không ạ?', 0)"""
            )
            db.execute(
                """INSERT INTO chat_messages (page_id, conversation_id, sender_id, sender_name, message, is_outgoing) 
                VALUES ('PAGE_2', 'C2', 'USER_456', 'Trần Thị Mai', 'Cho mình xin giá ship về Đà Nẵng với!', 0)"""
            )

        messages = db.fetch_all("SELECT DISTINCT sender_name, conversation_id FROM chat_messages")
        self.list_conversations.clear()
        for m in messages:
            self.list_conversations.addItem(f"👤 {m['sender_name']} (Mã: {m['conversation_id']})")

    def on_conversation_selected(self, item):
        self.txt_chat_history.clear()
        text = item.text()
        conv_id = text.split("Mã: ")[-1].replace(")", "").strip()
        self.lbl_chat_header.setText(f"Hội thoại: {text}")

        msgs = db.fetch_all("SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC", (conv_id,))
        for m in msgs:
            sender = "🤖 BẠN (PAGE)" if m["is_outgoing"] else f"👤 {m['sender_name']}"
            color = "#38bdf8" if m["is_outgoing"] else "#10b981"
            self.txt_chat_history.append(f"<b style='color:{color}'>{sender}:</b> {m['message']}<br>")

    def send_reply(self):
        text = self.txt_reply.text().strip()
        if not text:
            return
        self.txt_chat_history.append(f"<b style='color:#38bdf8'>🤖 BẠN (PAGE):</b> {text}<br>")
        self.txt_reply.clear()
        self.log("INFO", f"Đã gửi tin nhắn: {text}")

    def toggle_bot(self, checked: bool):
        if checked:
            self.btn_toggle_bot.setText("⏹ Tắt Trả Lời AI")
            self.worker = ChatSyncWorker()
            self.worker.sig_log.connect(self.sig_log.emit)
            self.worker.start()
            self.log("SUCCESS", "Đã kích hoạt AI Chatbot tự động trả lời tin nhắn.")
        else:
            self.btn_toggle_bot.setText("🤖 Bật Tự Động Trả Lời AI")
            if self.worker and self.worker.isRunning():
                self.worker.stop()
                self.worker.wait(1000)
            self.log("INFO", "Đã dừng AI Chatbot.")
