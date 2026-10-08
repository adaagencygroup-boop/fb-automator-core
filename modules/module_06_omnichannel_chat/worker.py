"""
Worker Đồng Bộ Tin Nhắn & Tự Động Trả Lời (Omnichannel Chatbot)
Phụ trách: Mạnh, Minh
"""
import time
from core.base_module import BaseWorker
from core.database.connection import db
from core.ai.gemini_engine import ai_engine

class ChatSyncWorker(BaseWorker):
    def __init__(self, parent=None):
        super().__init__(module_name="Quản Lý Chat Page", parent=parent)

    def run(self):
        self.log_info("Bắt đầu dịch vụ lắng nghe & phản hồi tin nhắn tự động...")

        while self.is_active():
            self.check_paused()

            # Lấy các tin nhắn chưa phản hồi
            pending = db.fetch_all("SELECT * FROM chat_messages WHERE is_outgoing = 0 AND ai_auto_replied = 0 LIMIT 5")
            for msg in pending:
                if not self.is_active():
                    break
                
                msg_id = msg["id"]
                sender_name = msg.get("sender_name", "Khách hàng")
                customer_text = msg.get("message", "")

                self.log_info(f"Nhận tin nhắn mới từ {sender_name}: '{customer_text}'")

                # Sinh câu trả lời qua Gemini AI
                try:
                    prompt = f"Khách hàng nhắn tin cho Fanpage: '{customer_text}'. Hãy đóng vai nhân viên tư vấn nhiệt tình, ngắn gọn, lịch sự trả lời khách hàng."
                    reply_text = ai_engine.generate_content(prompt)
                except Exception:
                    reply_text = "Dạ chào bạn! Shop đã nhận được tin nhắn và sẽ phản hồi sớm nhất ạ!"

                # Ghi nhận tin nhắn phản hồi vào CSDL
                db.execute(
                    """INSERT INTO chat_messages 
                    (page_id, conversation_id, sender_id, sender_name, message, is_outgoing, ai_auto_replied)
                    VALUES (?, ?, 'PAGE', 'Fanpage Bot', ?, 1, 1)""",
                    (msg.get("page_id", ""), msg.get("conversation_id", ""), reply_text)
                )

                db.execute("UPDATE chat_messages SET ai_auto_replied = 1 WHERE id = ?", (msg_id,))
                self.log_success(f"-> Đã tự động trả lời cho {sender_name}: '{reply_text[:60]}...'")

            self.msleep(3000)

        self.log_info("Dịch vụ Chatbot đã dừng.")
