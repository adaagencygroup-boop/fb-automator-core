"""
gemini_client.py
Gọi Google Gemini 2.5 Flash API để sinh nội dung cho Page Facebook.
Trả về JSON thuần túy gồm: category, bio, post_content, avatar_prompt, cover_prompt.
"""
import json
import logging
import re
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Bạn là chuyên gia marketing và xây dựng thương hiệu số chuyên nghiệp.
Nhiệm vụ của bạn là tạo nội dung hoàn chỉnh cho Fanpage Facebook dựa trên tên thương hiệu được cung cấp.
Luôn trả về JSON thuần túy (không dùng markdown code block, không thêm giải thích)."""

USER_PROMPT_TEMPLATE = """Dựa vào tên Page: '{page_name}', hãy trả về định dạng JSON thuần túy gồm:
1. "category": 1 hạng mục chuẩn xác và phổ biến của Facebook (ví dụ: "Nhà hàng", "Quần áo (Thương hiệu)", "Dịch vụ kinh doanh", "Cửa hàng tạp hóa").
2. "bio": Mô tả ngắn dưới 150 ký tự, chuẩn SEO, hấp dẫn, gợi cảm giác tin tưởng.
3. "post_content": Bài viết chào mừng ra mắt trang khoảng 150-200 từ, văn phong chuyên nghiệp và thân thiện, có kèm hashtag #{tag} và các hashtag liên quan. QUY TẮC: Không dùng dấu ngoặc kép " bên trong nội dung văn bản (thay bằng dấu ' nếu có).
4. "avatar_prompt": Prompt tiếng Anh chi tiết (dưới 60 từ) để AI tạo ảnh logo avatar dạng Emblem Badge tròn/vuông cực đẹp, sang trọng, màu sắc rực rỡ bắt mắt, thể hiện biểu tượng ngành nghề.
5. "cover_prompt": Prompt tiếng Anh chi tiết (dưới 70 từ) để AI tạo ảnh bìa Facebook Banner 16:9 / 2.63:1 (1640x624), thiết kế đồ họa banner quảng cáo chuyên nghiệp, 3D typography tên trang, phối màu sống động, họa tiết sang trọng hợp chủ đề.
6. "post_image_prompt": Prompt tiếng Anh chi tiết (dưới 70 từ) để AI tạo ảnh bài đăng chào mừng (1:1 square post poster), hình ảnh minh họa hoàn hảo khớp 100% với nội dung bài viết '{page_name}', màu sắc nổi bật, phong cách graphic poster bắt mắt.

Chỉ trả về JSON thuần túy, không thêm bất kỳ văn bản nào khác."""


def _extract_json(text: str) -> dict:
    """Trích xuất JSON từ response, xử lý trường hợp có markdown wrapper hoặc unescaped newlines."""
    cleaned = text.strip()
    
    # Loại bỏ markdown code fences nếu có
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    
    # Thử parse trực tiếp với strict=False
    try:
        return json.loads(cleaned, strict=False)
    except json.JSONDecodeError:
        pass

    # Trích xuất đoạn từ dấu '{' ĐẦU TIÊN đến dấu '}' CUỐI CÙNG (tránh lỗi non-greedy của regex)
    start_idx = cleaned.find("{")
    end_idx = cleaned.rfind("}")
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        json_candidate = cleaned[start_idx : end_idx + 1]
        try:
            return json.loads(json_candidate, strict=False)
        except json.JSONDecodeError:
            pass

        # Xử lý dọn dẹp các ký tự xuống dòng rác trong string
        try:
            sanitized = re.sub(r'(?<!\\)\n', r'\\n', json_candidate)
            return json.loads(sanitized, strict=False)
        except Exception:
            pass

    # Thử dọn dẹp toàn bộ cleaned string
    try:
        sanitized = re.sub(r'(?<!\\)\n', r'\\n', cleaned)
        return json.loads(sanitized, strict=False)
    except Exception:
        pass

    raise ValueError(f"Cannot extract valid JSON from Gemini response: {text[:200]}")


class GeminiClient:
    """Client giao tiếp với Google Gemini API."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        logger.info("Gemini client initialized with API Key")

    def _call_model(self, model_name: str, prompt: str, json_mode: bool) -> str:
        config = {"temperature": 0.7, "maxOutputTokens": 2048}
        if json_mode:
            config["responseMimeType"] = "application/json"
        response = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
            params={"key": self.api_key},
            json={
                "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": config,
            },
            timeout=90,
        )
        response.raise_for_status()
        parts = response.json()["candidates"][0]["content"]["parts"]
        return "".join(part.get("text", "") for part in parts)

    def generate_page_content(self, page_name: str, preferred_model: str = None) -> dict:
        """
        Sinh nội dung cho một Page Facebook với tùy chọn Model từ người dùng.
        Args:
            page_name: Tên trang cần tạo nội dung.
            preferred_model: Model do người dùng chọn (ví dụ: gemini-1.5-flash, gemini-2.0-flash, v.v.)
        Returns:
            dict với các key: category, bio, post_content, avatar_prompt, cover_prompt, post_image_prompt
        """
        tag = page_name.replace(" ", "").replace("-", "")
        prompt = USER_PROMPT_TEMPLATE.format(page_name=page_name, tag=tag)

        # Danh sách các model chính thức từ cao đến thấp (xịn -> nhẹ chống 429)
        official_defaults = [
            "gemini-3.8-flash",
            "gemini-3.6-flash",
            "gemini-3.5-flash",
            "gemini-2.5-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.1-flash-lite",
            "gemini-2.5-flash-lite",
        ]

        # Xây dựng danh sách ưu tiên: Gọi đúng model đã chọn trước, sau đó fall back lần lượt XUỐNG DƯỚI
        candidate_models = []
        if preferred_model:
            candidate_models.append(preferred_model)

        clean_pref = preferred_model.replace("models/", "") if preferred_model else ""
        if clean_pref in official_defaults:
            idx = official_defaults.index(clean_pref)
            # Lần lượt đi xuống các model nhẹ hơn phía sau
            for m in official_defaults[idx + 1:]:
                if m not in candidate_models:
                    candidate_models.append(m)
        else:
            # Nếu là model khác ngoài danh sách chuẩn, duyệt lần lượt từ cao xuống thấp
            for m in official_defaults:
                if m not in candidate_models:
                    candidate_models.append(m)

        last_error = None
        for model_name in candidate_models:
            try:
                logger.info(f"Calling Gemini model '{model_name}' for page: '{page_name}'")
                
                raw_text = None
                try:
                    raw_text = self._call_model(model_name, prompt, json_mode=True)
                except Exception as config_err:
                    logger.warning(f"Failed JSON mode for '{model_name}': {config_err}. Retrying standard config...")
                    raw_text = self._call_model(model_name, prompt, json_mode=False)

                if not raw_text:
                    raise ValueError("Gemini returned empty response")

                logger.debug(f"Gemini raw response ({model_name}): {raw_text[:200]}")

                result = _extract_json(raw_text)

                required_keys = ["category", "bio", "post_content", "avatar_prompt", "cover_prompt"]
                missing = [k for k in required_keys if k not in result]
                if missing:
                    raise ValueError(f"Gemini response thiếu các trường: {missing}")

                # Nếu thiếu post_image_prompt thì tự bổ sung dựa trên cover_prompt & post_content
                if "post_image_prompt" not in result:
                    result["post_image_prompt"] = f"Vibrant advertising promotional poster illustration for {page_name}, {result.get('category', '')} concept, colorful dynamic graphic design"

                logger.info(f"Gemini content generated successfully using '{model_name}' for '{page_name}'")
                result["_used_model"] = model_name
                if preferred_model and model_name not in [preferred_model, f"models/{preferred_model}"]:
                    result["_fallback_from"] = preferred_model
                    result["_fallback_reason"] = str(last_error) if last_error else "Model ban đầu không phản hồi"
                return result

            except Exception as e:
                logger.warning(f"Gemini model '{model_name}' failed: {e}")
                last_error = e

        raise ValueError(f"Tất cả các model Gemini ({candidate_models}) đều thất bại. Lỗi chi tiết: {last_error}")

    def generate_image_prompt_enhanced(self, base_prompt: str, style: str = "logo") -> str:
        """Nâng cao prompt tạo ảnh với style chuyên nghiệp hơn."""
        if style == "logo":
            return f"{base_prompt}, square format, professional logo design, clean background, high quality, vector style"
        elif style == "cover":
            return f"{base_prompt}, 820x312 banner format, professional business cover photo, vibrant colors, modern design"
        return base_prompt
