"""AI provider adapters used by the local Module 7 API."""
from __future__ import annotations
import re
from typing import Any, Callable, Protocol

import requests

from ..core.constants import DEEPSEEK_API_URL, GEMINI_API_BASE, OPENAI_RESPONSES_URL
from ..core.settings import model_spec

_POST_MARKER = "===BAI_DANG_MOI==="
_EXCLUDED_GEMINI_MODELS = ("embedding", "imagen", "veo", "lyria", "tts", "live", "robotics", "computer-use")
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

def _request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    json: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    timeout: int = 90,
    timeout_message: str = "Kết nối AI quá thời gian chờ",
    connect_message: str = "Không thể kết nối tới nhà cung cấp AI",
) -> dict[str, Any]:
    try:
        if method.upper() == "GET":
            response = requests.get(url, headers=headers, params=params, timeout=timeout)
        else:
            response = requests.post(url, headers=headers, json=json, params=params, timeout=timeout)
    except requests.Timeout as exc:
        raise AIProviderError(timeout_message) from exc
    except requests.RequestException as exc:
        raise AIProviderError(connect_message) from exc

    if response.status_code != 200:
        raise _request_error(response)
    return response.json()


# adapter functions to extract text from each provider's response format
def _openai_text(data: dict[str, Any]) -> str:
    for item in data.get("output", []):
        if item.get("type") != "message":
            continue
        for part in item.get("content", []):
            if part.get("type") == "output_text" and part.get("text"):
                return str(part["text"]).strip()
    return ""


def _deepseek_text(data: dict[str, Any]) -> str:
    choices = data.get("choices", [])
    if choices and choices[0].get("message", {}).get("content"):
        return str(choices[0]["message"]["content"]).strip()
    return ""


def _gemini_text(data: dict[str, Any]) -> str:
    chunks = []
    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            if part.get("text"):
                chunks.append(str(part["text"]))
    return "\n".join(chunks).strip()


def _post_and_extract(
    provider_label: str,
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, Any],
    extractor: Callable[[dict[str, Any]], str],
    timeout: int = 90,
) -> str:
    data = _request_json("POST", url, headers=headers, json=payload, timeout=timeout)
    text = extractor(data)
    if not text:
        raise AIProviderError(f"{provider_label} không trả về nội dung văn bản")
    return text


class AIProvider(Protocol):
    """Contract chung cho các nhà cung cấp AI (mở rộng bằng cách thêm class mới, không sửa code cũ)."""

    def generate(self, api_model: str, api_key: str, prompt: str, timeout: int = 90) -> str:
        ...

    def test_connection(self, api_model: str, api_key: str) -> None:
        ...


class OpenAIProvider:
    def generate(self, api_model: str, api_key: str, prompt: str, timeout: int = 90) -> str:
        return _post_and_extract(
            "OpenAI",
            OPENAI_RESPONSES_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            payload={"model": api_model, "input": prompt, "max_output_tokens": 4096, "store": False},
            extractor=_openai_text,
            timeout=timeout,
        )

    def test_connection(self, api_model: str, api_key: str) -> None:
        _request_json(
            "GET",
            f"https://api.openai.com/v1/models/{api_model}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=20,
            timeout_message="Kiểm tra API quá thời gian chờ",
        )


class DeepSeekProvider:
    def generate(self, api_model: str, api_key: str, prompt: str, timeout: int = 90) -> str:
        return _post_and_extract(
            "DeepSeek",
            DEEPSEEK_API_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            payload={
                "model": api_model,
                "messages": [
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.8,
                "max_tokens": 4096,
            },
            extractor=_deepseek_text,
            timeout=timeout,
        )

    def test_connection(self, api_model: str, api_key: str) -> None:
        _request_json(
            "GET",
            "https://api.deepseek.com/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=20,
            timeout_message="Kiểm tra API quá thời gian chờ",
        )


class GeminiProvider:
    def generate(self, api_model: str, api_key: str, prompt: str, timeout: int = 90) -> str:
        return _post_and_extract(
            "Gemini",
            f"{GEMINI_API_BASE}/{api_model}:generateContent",
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            payload={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.8, "maxOutputTokens": 4096},
            },
            extractor=_gemini_text,
            timeout=timeout,
        )

    def test_connection(self, api_model: str, api_key: str) -> None:
        _request_json(
            "GET",
            f"{GEMINI_API_BASE}/{api_model}",
            headers={"x-goog-api-key": api_key},
            timeout=20,
            timeout_message="Kiểm tra API quá thời gian chờ",
        )


PROVIDERS: dict[str, AIProvider] = {
    "openai": OpenAIProvider(),
    "deepseek": DeepSeekProvider(),
    "gemini": GeminiProvider(),
}


def register_provider(name: str, provider: AIProvider) -> None:
    """Đăng ký thêm AI provider mới mà không cần sửa call_model hay test_connection."""
    PROVIDERS[name.strip().lower()] = provider


def _get_provider(provider_name: str) -> AIProvider:
    return PROVIDERS.get(provider_name, PROVIDERS["gemini"])


def call_model(model: str, api_key: str, prompt: str, timeout: int = 90) -> str:
    if not api_key:
        raise AIProviderError("Chưa cấu hình API Key cho model đã chọn")
    spec = model_spec(model)
    return _get_provider(spec["provider"]).generate(spec["api_model"], api_key, prompt, timeout)


def test_connection(model: str, api_key: str) -> None:
    spec = model_spec(model)
    _get_provider(spec["provider"]).test_connection(spec["api_model"], api_key)





def _parse_gemini_model(item: dict[str, Any]) -> dict[str, str] | None:
    methods = item.get("supportedGenerationMethods") or []
    model_id = str(item.get("name") or "").removeprefix("models/")
    lowered = model_id.lower()
    if (
        model_id.startswith("gemini-")
        and "generateContent" in methods
        and not any(part in lowered for part in _EXCLUDED_GEMINI_MODELS)
    ):
        return {"id": model_id, "name": str(item.get("displayName") or model_id)}
    return None


def list_gemini_models(api_key: str) -> list[dict[str, str]]:
    """Return text-capable generateContent models visible to this AI Studio key."""
    if not api_key:
        raise AIProviderError("Chưa cấu hình Google AI Studio API Key")
    models: list[dict[str, str]] = []
    page_token = None
    while True:
        params: dict[str, Any] = {"pageSize": 1000}
        if page_token:
            params["pageToken"] = page_token
        body = _request_json(
            "GET",
            GEMINI_API_BASE,
            headers={"x-goog-api-key": api_key},
            params=params,
            timeout=30,
            timeout_message="Tải danh sách model Google quá thời gian chờ",
            connect_message="Không thể kết nối tới Google AI",
        )
        for item in body.get("models", []):
            parsed = _parse_gemini_model(item)
            if parsed is not None:
                models.append(parsed)
        page_token = body.get("nextPageToken")
        if not page_token:
            break
    unique = {item["id"]: item for item in models}
    return sorted(unique.values(), key=lambda item: item["id"], reverse=True)


def _build_generation_prompt(topic: str, count: int, *, comment: bool = False) -> str:
    cleaned_topic = topic.strip()
    if comment:
        return (
            f"Bạn hãy tạo đúng {count} bình luận Facebook mới bằng tiếng Việt dựa trên NỘI DUNG BÌNH LUẬN MẪU bên dưới. "
            "Hãy giữ lại ý chính, thông điệp và giọng điệu của bình luận mẫu nhưng diễn đạt thành các biến thể tự nhiên, phù hợp để đăng độc lập. "
            "Không trả lời bình luận mẫu, không đối thoại với người viết mẫu, không đặt câu hỏi phản hồi và không mô tả quá trình tạo. "
            "Mỗi bình luận ngắn gọn, tự nhiên, không bịa thông tin, không hashtag. "
            f"Chỉ trả về các bình luận, phân cách bằng một dòng `{_POST_MARKER}`.\n\n"
            f"NỘI DUNG BÌNH LUẬN MẪU:\n{cleaned_topic}"
        )
    return (
        "Bạn là chuyên gia nội dung Facebook bằng tiếng Việt. "
        f"Hãy viết đúng {count} bài đăng khác nhau dựa trên chủ đề bên dưới. "
        "Mỗi bài tự nhiên, rõ ràng, không bịa thông tin, tối đa 1800 ký tự và có thể dùng 3-5 hashtag phù hợp. "
        f"Chỉ trả về các bài viết, phân cách mỗi bài bằng một dòng `{_POST_MARKER}`.\n\n"
        f"CHỦ ĐỀ:\n{cleaned_topic}"
    )


# xử lí kết quả trả về từ AI provider, tách ra thành các bài đăng riêng biệt
def _parse_generated_items(raw: str, count: int) -> list[str]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:text|markdown)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    posts = [part.strip() for part in cleaned.split(_POST_MARKER) if part.strip()]
    if len(posts) != count:
        # Tolerate providers numbering each result even when they ignored the requested marker.
        numbered = [
            part.strip()
            for part in re.split(r"(?:^|\n)\s*(?:Bài\s*)?\d+[.):]\s*", cleaned, flags=re.IGNORECASE)
            if part.strip()
        ]
        if len(numbered) >= count:
            posts = numbered
    if len(posts) < count:
        raise AIProviderError(f"AI chỉ trả về {len(posts)}/{count} bài hợp lệ; vui lòng thử tạo lại")
    return posts[:count]


def generate_posts(
    model: str,
    api_key: str,
    topic: str,
    count: int,
    *,
    comment: bool = False,
    caller: Callable[[str, str, str], str] = call_model,
) -> list[str]:
    prompt = _build_generation_prompt(topic, count, comment=comment)
    raw = caller(model, api_key, prompt)
    return _parse_generated_items(raw, count)
