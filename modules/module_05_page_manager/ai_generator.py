# -*- coding: utf-8 -*-
"""
File: core/ai_generator.py
"""
import time
import re
import concurrent.futures
from google import genai

class AIGenerator:
    def __init__(self, api_keys, model_name, prompt_template, log_func):
        self.api_keys = [k.strip() for k in api_keys if k.strip()]
        self.model_name = model_name
        self.prompt_template = prompt_template
        self.log_func = log_func
        self.current_key_idx = 0

    def rotate_key(self):
        if len(self.api_keys) > 1:
            self.current_key_idx = (self.current_key_idx + 1) % len(self.api_keys)
            self.log_func(f"[INFO] Chuyển sang API Key dự phòng số {self.current_key_idx + 1}...")
        else:
            self.log_func("[WARNING] Chỉ có 1 API Key, không thể xoay vòng key. Thử lại sau ít phút...")

    def get_client(self):
        if not self.api_keys:
            raise ValueError("Danh sách API Keys trống!")
        return genai.Client(api_key=self.api_keys[self.current_key_idx])

    def call_ai_with_timeout(self, client, prompt):
        return client.models.generate_content(
            model=self.model_name, 
            contents=prompt
        )

    def generate_batch_content(self, batch_pages, check_running_func):
        batch_names = [p['name'] for p in batch_pages]
        self.log_func(f"[*] Đang gọi AI xử lý nhóm 10 trang: {', '.join(batch_names)}")
        
        prompt = f"{self.prompt_template}\n\nDANH SÁCH 10 FANPAGE BẮT BUỘC PHẢI VIẾT VỚI CHỦ ĐỀ/TỪ KHÓA TƯƠNG ỨNG:\n"
        for p in batch_pages:
            name = p.get('name', '')
            keyword = p.get('ai_keyword', name)
            prompt += f"- Page: {name} (Chủ đề/Từ khóa: {keyword})\n"
        
        prompt += "\nĐịnh dạng trả về cho MỖI trang phải chính xác như sau (ngăn cách các trang bằng ===):\n"
        prompt += "PAGE_NAME: [Điền chính xác tên Fanpage]\n"
        prompt += "KEYWORD: [Điền 1 từ khóa tiếng Anh tìm ảnh]\n"
        prompt += "CONTENT: [Điền nội dung bài viết Facebook]\n"
        prompt += "===\n"

        attempts = 0
        max_attempts = len(self.api_keys) * 2
        
        while attempts < max_attempts and check_running_func():
            try:
                client = self.get_client()
                
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(self.call_ai_with_timeout, client, prompt)
                    response = future.result(timeout=120)
                    
                raw_text = response.text.strip()
                raw_text = raw_text.replace("```text", "").replace("```", "").strip()
                return raw_text
            except concurrent.futures.TimeoutError:
                attempts += 1
                self.log_func(f"[WARNING] Quá thời gian 2 phút (Timeout)! Server AI phản hồi quá chậm. Đang đổi Key...")
                self.rotate_key()
                time.sleep(2)
            except Exception as e:
                attempts += 1
                err_str = str(e)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    self.log_func(f"[WARNING] Key hiện tại (vị trí {self.current_key_idx + 1}) hết hạn ngạch. Đang đổi key...")
                    self.rotate_key()
                    time.sleep(2)
                elif "503" in err_str or "UNAVAILABLE" in err_str:
                    self.log_func(f"[WARNING] Server quá tải (503). Đang đổi key...")
                    self.rotate_key()
                    time.sleep(3)
                elif "401" in err_str or "403" in err_str or "UNAUTHENTICATED" in err_str or "PERMISSION_DENIED" in err_str:
                    self.log_func(f"[CRITICAL] Key lỗi xác thực (401/403/Chết). Đang đổi key...")
                    self.rotate_key()
                    time.sleep(1)
                else:
                    self.log_func(f"[ERROR] Lỗi gọi AI: {err_str}. Đang đổi key để thử lại...")
                    self.rotate_key()
                    time.sleep(3)
        return ""
