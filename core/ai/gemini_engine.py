"""
Google Gemini AI Engine
Hỗ trợ:
- Batching 10 trang / lần gọi prompt để tối ưu quota & chi phí
- Auto Key Rotation: Tự động đổi API Key khi dính lỗi 429 (Resource Exhausted), 503 hoặc Timeout
- Nạp keys từ file keys.txt hoặc bảng api_keys trong SQLite
"""
import os
import time
import requests
from typing import List, Dict, Any, Optional
from config.constants import KEYS_PATH
from core.database.connection import db

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

class GeminiEngine:
    def __init__(self, model_name: str = "gemini-1.5-flash", timeout: int = 120):
        self.model_name = model_name
        self.timeout = timeout
        self.keys: List[str] = []
        self.current_key_index: int = 0
        self.load_keys()

    def load_keys(self):
        """Nạp danh sách Gemini API Keys từ Database và file keys.txt"""
        loaded = []
        # 1. Từ Database
        try:
            db_keys = db.fetch_all("SELECT api_key FROM api_keys WHERE service = 'gemini' AND status = 'ACTIVE'")
            for r in db_keys:
                k = r["api_key"].strip()
                if k and k not in loaded:
                    loaded.append(k)
        except Exception:
            pass

        # 2. Từ file keys.txt
        if KEYS_PATH.exists():
            try:
                with open(KEYS_PATH, "r", encoding="utf-8") as f:
                    for line in f:
                        k = line.strip()
                        if k and not k.startswith("#") and k not in loaded:
                            loaded.append(k)
            except Exception:
                pass

        self.keys = loaded

    def add_key(self, api_key: str):
        api_key = api_key.strip()
        if api_key and api_key not in self.keys:
            self.keys.append(api_key)
            try:
                db.execute(
                    "INSERT OR IGNORE INTO api_keys (service, api_key, status) VALUES (?, ?, 'ACTIVE')",
                    ("gemini", api_key)
                )
            except Exception:
                pass

    def get_current_key(self) -> Optional[str]:
        if not self.keys:
            self.load_keys()
        if not self.keys:
            return None
        return self.keys[self.current_key_index % len(self.keys)]

    def rotate_key(self) -> Optional[str]:
        """Chuyển sang key tiếp theo khi gặp quota limit hoặc lỗi"""
        if not self.keys:
            return None
        self.current_key_index = (self.current_key_index + 1) % len(self.keys)
        new_key = self.get_current_key()
        return new_key

    def generate_content(self, prompt: str, max_retries: int = 5) -> str:
        """Gửi prompt tới Gemini API với cơ chế tự động xoay key khi lỗi"""
        if not self.keys:
            raise ValueError("Chưa cấu hình Google Gemini API Key nào trong hệ thống!")

        for attempt in range(max_retries):
            current_key = self.get_current_key()
            if not current_key:
                raise ValueError("Không tìm thấy API Key khả dụng.")

            url = f"{GEMINI_API_BASE}/{self.model_name}:generateContent?key={current_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.7,
                    "maxOutputTokens": 2048
                }
            }

            try:
                res = requests.post(url, json=payload, timeout=self.timeout)
                if res.status_code == 200:
                    data = res.json()
                    candidates = data.get("candidates", [])
                    if candidates and "content" in candidates[0]:
                        parts = candidates[0]["content"].get("parts", [])
                        if parts:
                            return parts[0].get("text", "")
                    return ""

                # Gặp lỗi 429 Quota hoặc 503 Service Unavailable -> Xoay Key
                if res.status_code in [429, 503, 401, 403]:
                    self.rotate_key()
                    time.sleep(1)
                    continue
                else:
                    raise RuntimeError(f"Gemini API Error [{res.status_code}]: {res.text}")

            except (requests.Timeout, requests.ConnectionError):
                self.rotate_key()
                time.sleep(1)
                continue

        raise RuntimeError(f"Đã thử qua {max_retries} API Keys nhưng tất cả đều lỗi hoặc cạn quota.")

    def generate_batch_pages(self, pages_info: List[Dict[str, str]]) -> Dict[str, str]:
        """
        Tạo bài viết hàng loạt cho tối đa 10 Page trong 1 lần gọi (Batching)
        pages_info: [{"page_id": "123", "page_name": "Tên", "topic": "Chủ đề"}]
        Returns: {page_id: "Nội dung bài viết tạo bởi AI"}
        """
        if not pages_info:
            return {}

        prompt_builder = [
            "Bạn là chuyên gia sáng tạo nội dung mạng xã hội cho Facebook Fanpage.",
            "Hãy viết bài viết thu hút, tự nhiên kèm 3-5 hashtag cho từng Fanpage trong danh sách sau:",
            "QUY TẮC BẮT BUỘC ĐỊNH DẠNG ĐẦU RA:",
            "Với mỗi Fanpage, in theo định dạng chuẩn sau:",
            "===PAGE_START===",
            "PAGE_ID: <id>",
            "CONTENT:",
            "<Nội dung bài viết kèm hashtag>",
            "===PAGE_END===\n",
            "DANH SÁCH FANPAGE CẦN VIẾT BÀI:"
        ]

        for p in pages_info:
            prompt_builder.append(f"- ID: {p.get('page_id')} | Tên Page: {p.get('page_name')} | Chủ đề/Từ khóa: {p.get('topic', 'Tổng hợp')}")

        full_prompt = "\n".join(prompt_builder)
        raw_text = self.generate_content(full_prompt)

        # Phân tách kết quả trả về
        results = {}
        blocks = raw_text.split("===PAGE_START===")
        for b in blocks:
            if "===PAGE_END===" not in b:
                continue
            chunk = b.split("===PAGE_END===")[0]
            lines = chunk.strip().split("\n")
            p_id = None
            content_lines = []
            is_reading_content = False

            for line in lines:
                if line.startswith("PAGE_ID:"):
                    p_id = line.replace("PAGE_ID:", "").strip()
                elif line.startswith("CONTENT:"):
                    is_reading_content = True
                elif is_reading_content:
                    content_lines.append(line)

            if p_id:
                results[p_id] = "\n".join(content_lines).strip()

        return results

ai_engine = GeminiEngine()
