# -*- coding: utf-8 -*-
"""Gọi Gemini để viết nội dung bài đăng — ưu tiên model to, hết hạn ngạch thì xuống model nhỏ hơn."""
import time
import concurrent.futures
from google import genai

from modules.module_05_page_manager.vi_messages import suggested_replacement, vi_gemini_message

__all__ = ["AIGenerator", "suggested_replacement", "MODEL_FALLBACK_CHAIN", "models_to_try"]

# To → nhẹ: model key mới (AI Studio) còn dùng được. Hết RPD/404 thì xuống con dưới.
MODEL_FALLBACK_CHAIN = [
    "gemini-3.1-pro-preview",
    "gemini-3.8-flash",
    "gemini-3-flash-preview",
    "gemini-flash-latest",
    "gemini-pro-latest",
    "gemini-3.1-flash-lite-preview",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
]


def models_to_try(selected: str) -> list[str]:
    """Bắt đầu từ model user chọn, rồi lần lượt xuống các model nhẹ hơn."""
    name = (selected or "").strip().split("/")[-1]
    if not name:
        return list(MODEL_FALLBACK_CHAIN)
    if name in MODEL_FALLBACK_CHAIN:
        return MODEL_FALLBACK_CHAIN[MODEL_FALLBACK_CHAIN.index(name) :]
    # Model lạ: thử nó trước, rồi cả chuỗi.
    return [name] + [m for m in MODEL_FALLBACK_CHAIN if m != name]


def _should_downgrade_model(err: str) -> bool:
    lower = (err or "").lower()
    return any(
        token in lower
        for token in (
            "429",
            "resource_exhausted",
            "quota",
            "rate limit",
            "rate_limit",
            "404",
            "not_found",
            "no longer available",
            "not available",
            "503",
            "unavailable",
            "high demand",
        )
    )


class AIGenerator:
    def __init__(self, api_keys, model_name, prompt_template, log_func):
        self.api_keys = [k.strip() for k in api_keys if k.strip()]
        self.model_name = (model_name or "gemini-3.8-flash").strip().split("/")[-1]
        self.prompt_template = prompt_template
        self.log_func = log_func
        self.current_key_idx = 0
        self._models = models_to_try(self.model_name)
        self._model_idx = 0

    def rotate_key(self):
        if len(self.api_keys) > 1:
            self.current_key_idx = (self.current_key_idx + 1) % len(self.api_keys)
            self.log_func(f"[THÔNG TIN] Chuyển sang Gemini key dự phòng số {self.current_key_idx + 1}...")
        else:
            self.log_func("[CẢNH BÁO] Chỉ có 1 Gemini key — sẽ thử model nhỏ hơn nếu vẫn lỗi.")

    def downgrade_model(self) -> bool:
        """Xuống model kế tiếp trong chuỗi. False nếu đã hết model."""
        if self._model_idx + 1 >= len(self._models):
            return False
        old = self._models[self._model_idx]
        self._model_idx += 1
        self.model_name = self._models[self._model_idx]
        self.log_func(f"[THÔNG TIN] Model {old} hết hạn ngạch/không dùng được → xuống {self.model_name}")
        return True

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
        self.log_func(f"[*] Đang gọi Gemini ({self.model_name}) viết bài cho: {', '.join(batch_names)}")

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

        max_attempts = max(len(self.api_keys) * len(self._models) * 2, 6)
        attempts = 0
        key_fails_on_model = 0

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
                self.log_func("[CẢNH BÁO] Gemini phản hồi quá chậm (quá 2 phút). Đang đổi key/model...")
                self.rotate_key()
                key_fails_on_model += 1
                if key_fails_on_model >= max(len(self.api_keys), 1):
                    key_fails_on_model = 0
                    if not self.downgrade_model():
                        break
                time.sleep(2)
            except Exception as exc:
                attempts += 1
                err_str = str(exc)
                vi = vi_gemini_message(err_str)
                replacement = suggested_replacement(err_str)

                if replacement and replacement != self.model_name and replacement in self._models:
                    # Google gợi ý model cụ thể → nhảy tới đó nếu còn trong chuỗi (hoặc chèn).
                    if replacement not in self._models[self._model_idx :]:
                        self._models.insert(self._model_idx + 1, replacement)
                    while self._models[self._model_idx] != replacement and self._model_idx + 1 < len(self._models):
                        self._model_idx += 1
                    self.model_name = replacement
                    self.log_func(f"[THÔNG TIN] Đổi sang model Google gợi ý: {replacement}")
                    key_fails_on_model = 0
                    time.sleep(1)
                    continue

                if _should_downgrade_model(err_str):
                    self.log_func(f"[CẢNH BÁO] {vi}")
                    self.rotate_key()
                    key_fails_on_model += 1
                    # Hết key trên model này (hoặc chỉ 1 key) → xuống model nhỏ hơn.
                    if key_fails_on_model >= max(len(self.api_keys), 1) or len(self.api_keys) <= 1:
                        key_fails_on_model = 0
                        if not self.downgrade_model():
                            self.log_func("[LỖI] Đã thử hết model dự phòng.")
                            return ""
                    time.sleep(2)
                    continue

                if "401" in err_str or "403" in err_str or "UNAUTHENTICATED" in err_str or "PERMISSION_DENIED" in err_str:
                    self.log_func(f"[NGHIÊM TRỌNG] {vi} Đang đổi key...")
                    self.rotate_key()
                    time.sleep(1)
                    continue

                self.log_func(f"[LỖI] {vi} Đang đổi key/model để thử lại...")
                self.rotate_key()
                key_fails_on_model += 1
                if key_fails_on_model >= max(len(self.api_keys), 1):
                    key_fails_on_model = 0
                    if not self.downgrade_model():
                        return ""
                time.sleep(2)
        return ""
