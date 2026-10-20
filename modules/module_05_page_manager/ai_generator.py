# -*- coding: utf-8 -*-
"""Gọi Gemini để viết nội dung bài đăng."""
import time
import concurrent.futures
from google import genai

from modules.module_05_page_manager.vi_messages import suggested_replacement, vi_gemini_message

# Giữ tên cũ cho test / import cũ
__all__ = ["AIGenerator", "suggested_replacement"]


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
            self.log_func(f"[THÔNG TIN] Chuyển sang Gemini key dự phòng số {self.current_key_idx + 1}...")
        else:
            self.log_func("[CẢNH BÁO] Chỉ có 1 Gemini key, không thể xoay vòng. Thử lại sau ít phút...")

    def get_client(self):
        if not self.api_keys:
            raise ValueError("Danh sách Gemini key đang trống.")
        return genai.Client(api_key=self.api_keys[self.current_key_idx])

    def call_ai_with_timeout(self, client, prompt):
        return client.models.generate_content(
            model=self.model_name,
            contents=prompt,
        )

    def generate_batch_content(self, batch_pages, check_running_func):
        batch_names = [p["name"] for p in batch_pages]
        self.log_func(f"[*] Đang gọi Gemini viết bài cho: {', '.join(batch_names)}")

        prompt = (
            f"{self.prompt_template}\n\n"
            "Viết bài theo đúng khung cấu trúc ở trên. Chủ đề từng page là từ khóa bên dưới:\n"
        )
        for page in batch_pages:
            name = page.get("name", "")
            keyword = page.get("ai_keyword", name)
            prompt += f"- Page: {name} (Chủ đề/Từ khóa: {keyword})\n"

        prompt += (
            "\nĐịnh dạng trả về cho MỖI trang phải chính xác như sau (ngăn cách các trang bằng ===):\n"
            "PAGE_NAME: [Điền chính xác tên Fanpage]\n"
            "KEYWORD: [Điền 1 từ khóa tiếng Anh tìm ảnh]\n"
            "CONTENT: [Điền nội dung bài viết Facebook]\n"
            "===\n"
        )

        attempts = 0
        max_attempts = len(self.api_keys) * 2

        while attempts < max_attempts and check_running_func():
            try:
                client = self.get_client()
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(self.call_ai_with_timeout, client, prompt)
                    response = future.result(timeout=120)
                raw_text = response.text.strip()
                return raw_text.replace("```text", "").replace("```", "").strip()
            except concurrent.futures.TimeoutError:
                attempts += 1
                self.log_func("[CẢNH BÁO] Gemini phản hồi quá chậm (quá 2 phút). Đang đổi key...")
                self.rotate_key()
                time.sleep(2)
            except Exception as exc:
                attempts += 1
                err_str = str(exc)
                vi = vi_gemini_message(err_str)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    self.log_func(f"[CẢNH BÁO] {vi} Đang đổi key...")
                    self.rotate_key()
                    time.sleep(2)
                elif "503" in err_str or "UNAVAILABLE" in err_str or "high demand" in err_str.lower():
                    self.log_func(f"[CẢNH BÁO] {vi} Đang đổi key...")
                    self.rotate_key()
                    time.sleep(3)
                elif "401" in err_str or "403" in err_str or "UNAUTHENTICATED" in err_str or "PERMISSION_DENIED" in err_str:
                    self.log_func(f"[NGHIÊM TRỌNG] {vi} Đang đổi key...")
                    self.rotate_key()
                    time.sleep(1)
                else:
                    replacement = suggested_replacement(err_str)
                    current = self.model_name.split("/")[-1]
                    if ("404" in err_str or "NOT_FOUND" in err_str) and replacement and replacement != current:
                        self.model_name = replacement
                        self.log_func(f"[THÔNG TIN] Model {current} không còn. Đổi sang {replacement} rồi viết lại.")
                        continue
                    if "404" in err_str or "NOT_FOUND" in err_str:
                        self.log_func(f"[LỖI] {vi}")
                        return ""
                    self.log_func(f"[LỖI] {vi} Đang đổi key để thử lại...")
                    self.rotate_key()
                    time.sleep(3)
        return ""
