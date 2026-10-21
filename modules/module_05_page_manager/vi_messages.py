"""Đổi thông báo lỗi tiếng Anh từ Gemini/Pixabay sang tiếng Việt cho log và toast."""
from __future__ import annotations

import re

_SUGGESTED_MODEL = re.compile(r"use models/([A-Za-z0-9._-]+)")
_VI_CHARS = re.compile(
    r"[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]",
    re.I,
)


def suggested_replacement(message: str) -> str:
    match = _SUGGESTED_MODEL.search(message or "")
    return match.group(1) if match else ""


def vi_gemini_message(raw: str) -> str:
    text = str(raw or "").strip()
    if not text:
        return "Gemini đang gặp lỗi tạm thời."
    lower = text.lower()
    replacement = suggested_replacement(text)

    if "high demand" in lower or "try again later" in lower or "unavailable" in lower:
        return "Máy chủ Gemini đang quá tải. Thử lại sau ít phút."
    if "resource_exhausted" in lower or "quota" in lower or "rate limit" in lower:
        return "Key Gemini đã hết hạn ngạch. Đợi hoặc đổi key khác."
    if "api key not valid" in lower or "invalid api key" in lower or "api_key_invalid" in lower:
        return "Gemini key không hợp lệ."
    if "permission_denied" in lower or "unauthenticated" in lower:
        return "Gemini key bị từ chối xác thực."
    if "no longer available" in lower or "not_found" in lower:
        if replacement:
            return f"Model này không còn dùng được. Hãy chọn {replacement}."
        return "Model Gemini không tìm thấy hoặc không còn dùng được."
    if "timeout" in lower or "timed out" in lower or "deadline" in lower:
        return "Gemini phản hồi quá chậm (hết thời gian chờ)."
    if "503" in text:
        return "Máy chủ Gemini đang quá tải (503). Thử lại sau ít phút."
    if "429" in text:
        return "Key Gemini bị giới hạn lượt gọi. Đợi hoặc đổi key khác."
    if "401" in text or "403" in text:
        return "Gemini key lỗi xác thực."
    if "404" in text:
        if replacement:
            return f"Model này không còn dùng được. Hãy chọn {replacement}."
        return "Model Gemini không tìm thấy."
    if replacement:
        return f"Model này không còn dùng được. Hãy chọn {replacement}."
    if _VI_CHARS.search(text):
        return text
    return "Gemini đang gặp lỗi tạm thời. Thử lại sau."


def vi_pixabay_message(raw: str, status_code: int | None = None) -> str:
    text = str(raw or "").strip()
    lower = text.lower()
    if status_code == 401 or "api key" in lower or "invalid" in lower:
        return "Pixabay key không hợp lệ."
    if status_code == 429 or "rate" in lower:
        return "Pixabay đang giới hạn lượt gọi. Thử lại sau."
    if status_code and status_code >= 500:
        return "Máy chủ Pixabay đang lỗi. Thử lại sau."
    if status_code and status_code != 200:
        return f"Pixabay trả về lỗi (mã {status_code})."
    if text and _VI_CHARS.search(text):
        return text
    return "Pixabay key không dùng được. Kiểm tra lại key."
