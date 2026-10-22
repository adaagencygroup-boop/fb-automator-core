"""AI provider adapters used by the local Module 7 API."""
from __future__ import annotations

import json
import re
from typing import Any

import requests

from ..core.constants import DEEPSEEK_API_URL, GEMINI_API_BASE, OPENAI_RESPONSES_URL
from ..core.settings import model_spec


class AIProviderError(RuntimeError):
    pass


def _request_error(response: requests.Response) -> AIProviderError:
    message = "Nhà cung cấp AI từ chối yêu cầu"
    try:
        body = response.json()
        detail = body.get("error", body)
        if isinstance(detail, dict):
            message = detail.get("message") or detail.get("status") or message
        elif isinstance(detail, str):
            message = detail
    except ValueError:
        pass
    return AIProviderError(f"{message} (HTTP {response.status_code})")


def _openai_text(data: dict[str, Any]) -> str:
    for item in data.get("output", []):
        if item.get("type") != "message":
            continue
        for part in item.get("content", []):
            if part.get("type") == "output_text" and part.get("text"):
                return str(part["text"]).strip()
    return ""


def _gemini_text(data: dict[str, Any]) -> str:
    chunks = []
    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            if part.get("text"):
                chunks.append(str(part["text"]))
    return "\n".join(chunks).strip()


def _call_openai(api_model: str, api_key: str, prompt: str, timeout: int = 90) -> str:
    response = requests.post(
        OPENAI_RESPONSES_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": api_model, "input": prompt, "max_output_tokens": 4096, "store": False},
        timeout=timeout,
    )
    if response.status_code != 200:
        raise _request_error(response)
    text = _openai_text(response.json())
    if not text:
        raise AIProviderError("OpenAI không trả về nội dung văn bản")
    return text


def _call_deepseek(api_model: str, api_key: str, prompt: str, timeout: int = 90) -> str:
    response = requests.post(
        DEEPSEEK_API_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": api_model,
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.8,
            "max_tokens": 4096,
        },
        timeout=timeout,
    )
    if response.status_code != 200:
        raise _request_error(response)
    data = response.json()
    choices = data.get("choices", [])
    if not choices or not choices[0].get("message", {}).get("content"):
        raise AIProviderError("DeepSeek không trả về nội dung văn bản")
    return str(choices[0]["message"]["content"]).strip()


def _call_gemini(api_model: str, api_key: str, prompt: str, timeout: int = 90) -> str:
    response = requests.post(
        f"{GEMINI_API_BASE}/{api_model}:generateContent",
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json={
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.8, "maxOutputTokens": 4096},
        },
        timeout=timeout,
    )
    if response.status_code != 200:
        raise _request_error(response)
    text = _gemini_text(response.json())
    if not text:
        raise AIProviderError("Gemini không trả về nội dung văn bản")
    return text


def call_model(model: str, api_key: str, prompt: str, timeout: int = 90) -> str:
    if not api_key:
        raise AIProviderError("Chưa cấu hình API Key cho model đã chọn")
    spec = model_spec(model)
    try:
        if spec["provider"] == "openai":
            return _call_openai(spec["api_model"], api_key, prompt, timeout)
        elif spec["provider"] == "deepseek":
            return _call_deepseek(spec["api_model"], api_key, prompt, timeout)
        return _call_gemini(spec["api_model"], api_key, prompt, timeout)
    except requests.Timeout as exc:
        raise AIProviderError("Kết nối AI quá thời gian chờ") from exc
    except requests.RequestException as exc:
        raise AIProviderError("Không thể kết nối tới nhà cung cấp AI") from exc


def test_connection(model: str, api_key: str) -> None:
    spec = model_spec(model)
    try:
        if spec["provider"] == "openai":
            response = requests.get(
                f"https://api.openai.com/v1/models/{spec['api_model']}",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=20,
            )
        elif spec["provider"] == "deepseek":
            response = requests.get(
                "https://api.deepseek.com/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=20,
            )
        else:
            response = requests.get(
                f"{GEMINI_API_BASE}/{spec['api_model']}",
                headers={"x-goog-api-key": api_key},
                timeout=20,
            )
    except requests.Timeout as exc:
        raise AIProviderError("Kiểm tra API quá thời gian chờ") from exc
    except requests.RequestException as exc:
        raise AIProviderError("Không thể kết nối tới nhà cung cấp AI") from exc
    if response.status_code != 200:
        raise _request_error(response)


def list_gemini_models(api_key: str) -> list[dict[str, str]]:
    """Return text-capable generateContent models visible to this AI Studio key."""
    if not api_key:
        raise AIProviderError("Chưa cấu hình Google AI Studio API Key")
    models: list[dict[str, str]] = []
    page_token = None
    try:
        while True:
            params = {"pageSize": 1000}
            if page_token:
                params["pageToken"] = page_token
            response = requests.get(
                GEMINI_API_BASE,
                headers={"x-goog-api-key": api_key},
                params=params,
                timeout=30,
            )
            if response.status_code != 200:
                raise _request_error(response)
            body = response.json()
            for item in body.get("models", []):
                methods = item.get("supportedGenerationMethods") or []
                model_id = str(item.get("name") or "").removeprefix("models/")
                lowered = model_id.lower()
                excluded = ("embedding", "imagen", "veo", "lyria", "tts", "live", "robotics", "computer-use")
                if (
                    model_id.startswith("gemini-")
                    and "generateContent" in methods
                    and not any(part in lowered for part in excluded)
                ):
                    models.append({
                        "id": model_id,
                        "name": str(item.get("displayName") or model_id),
                    })
            page_token = body.get("nextPageToken")
            if not page_token:
                break
    except requests.Timeout as exc:
        raise AIProviderError("Tải danh sách model Google quá thời gian chờ") from exc
    except requests.RequestException as exc:
        raise AIProviderError("Không thể kết nối tới Google AI") from exc
    unique = {item["id"]: item for item in models}
    return sorted(unique.values(), key=lambda item: item["id"], reverse=True)


def generate_posts(model: str, api_key: str, topic: str, count: int, *, comment: bool = False) -> list[str]:
    marker = "===BAI_DANG_MOI==="
    prompt = (
        "Bạn là chuyên gia nội dung Facebook bằng tiếng Việt. "
        f"Hãy viết đúng {count} bài đăng khác nhau dựa trên chủ đề bên dưới. "
        "Mỗi bài tự nhiên, rõ ràng, không bịa thông tin, tối đa 1800 ký tự và có thể dùng 3-5 hashtag phù hợp. "
        f"Chỉ trả về các bài viết, phân cách mỗi bài bằng một dòng `{marker}`.\n\n"
        f"CHỦ ĐỀ:\n{topic.strip()}"
    )
    if comment:
        prompt = (
            f"Viết đúng {count} bình luận Facebook bằng tiếng Việt dựa trên nội dung bên dưới. "
            "Mỗi bình luận ngắn gọn, tự nhiên, không bịa thông tin, không hashtag. "
            f"Chỉ trả về các bình luận, phân cách bằng một dòng `{marker}`.\n\n{topic.strip()}"
        )
    raw = call_model(model, api_key, prompt)
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:text|markdown)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    posts = [part.strip() for part in cleaned.split(marker) if part.strip()]
    if len(posts) != count:
        # Tolerate providers numbering each result even when they ignored the requested marker.
        numbered = [part.strip() for part in re.split(r"(?:^|\n)\s*(?:Bài\s*)?\d+[.):]\s*", cleaned, flags=re.IGNORECASE) if part.strip()]
        if len(numbered) >= count:
            posts = numbered
    if len(posts) < count:
        raise AIProviderError(f"AI chỉ trả về {len(posts)}/{count} bài hợp lệ; vui lòng thử tạo lại")
    return posts[:count]
