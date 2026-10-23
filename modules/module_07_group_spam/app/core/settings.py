"""Local, device-bound settings for Module 7."""
from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path
from typing import Any

from config.constants import DATA_DIR
from modules.module_02_account_manager.security.encryption import decrypt_data, encrypt_data
from .constants import DEFAULT_SETTINGS, MODEL_SPECS


def model_spec(model: str) -> dict[str, str]:
    if model in MODEL_SPECS:
        return MODEL_SPECS[model]
    if re.fullmatch(r"gemini-[A-Za-z0-9._-]{1,100}", model or ""):
        return {"provider": "gemini", "api_model": model}
    if (model or "").startswith("deepseek"):
        return {"provider": "deepseek", "api_model": "deepseek-flash"}
    raise ValueError("Model AI không được hỗ trợ")


class GroupSettingsStore:
    """Persist non-secret settings and encrypted provider keys on this machine."""

    def __init__(self, path: str | Path | None = None):
        configured = path or os.getenv("MODULE7_SETTINGS_PATH")
        self.path = Path(configured) if configured else DATA_DIR / "module_07_group_spam" / "settings.json"
        self._lock = threading.RLock()

    def _load_unlocked(self) -> dict[str, Any]:
        data: dict[str, Any] = {}
        if self.path.exists():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data = loaded
            except (OSError, ValueError, TypeError):
                data = {}
        merged = {
            **DEFAULT_SETTINGS,
            **{key: value for key, value in data.items() if key != "api_keys"},
            "api_keys": data.get("api_keys") if isinstance(data.get("api_keys"), dict) else {},
        }
        if merged["model"] == "gemini":
            merged["model"] = "gemini-2.5-flash"
        return merged

        if "credentials" not in merged:
            defaults = {"openai": "gpt-4o", "gemini": "gemini-2.5-flash", "deepseek": "deepseek-v4-flash"}
            merged["credentials"] = [
                {"id": f"legacy-{provider}", "name": f"{provider} (đã lưu)",
                 "model": merged["model"] if model_spec(merged["model"])["provider"] == provider else defaults[provider],
                 "encrypted_key": key}
                for provider, key in merged["api_keys"].items() if key and provider in defaults
            ]
        return merged

    def credentials(self) -> list[dict[str, Any]]:
        with self._lock:
            return [self._public_credential(item) for item in self._load_unlocked()["credentials"]]

    def _public_credential(self, item):
        key = self._decrypt_key(item["encrypted_key"])
        return {"id": item["id"], "name": item["name"], "model": item["model"],
                "provider": model_spec(item["model"])["provider"], "configured": bool(key),
                "hint": f"••••{key[-4:]}" if len(key) > 4 else "••••"}

    def credential_key(self, credential_id: str, model: str, *, exact_model: bool = True) -> str:
        with self._lock:
            item = next((item for item in self._load_unlocked()["credentials"] if item["id"] == credential_id), None)
            if not item:
                raise KeyError("API đã bị xóa hoặc không tồn tại. Vui lòng chọn lại API.")
            if model_spec(item["model"])["provider"] != model_spec(model)["provider"] or (exact_model and item["model"] != model):
                raise ValueError("Cấu hình API đã thay đổi. Vui lòng tải lại và chọn lại API.")
            return self._decrypt_key(item["encrypted_key"])

    def save_credential(self, *, name: str, model: str, api_key: str | None, credential_id: str | None = None):
        provider = model_spec(model)["provider"]
        with self._lock:
            data = self._load_unlocked()
            item = next((item for item in data["credentials"] if item["id"] == credential_id), None)
            if credential_id and not item:
                raise KeyError("API không tồn tại")
            key = (api_key or "").strip()
            if not key and (not item or model_spec(item["model"])["provider"] != provider or not self._decrypt_key(item["encrypted_key"])):
                raise ValueError("Hãy nhập API Key cho cấu hình mới hoặc khi đổi nhà cung cấp")
            if not item:
                item = {"id": uuid.uuid4().hex}
                data["credentials"].append(item)
            item.update(name=name.strip(), model=model)
            if key:
                item["encrypted_key"] = encrypt_data(key)
            self._save_unlocked(data)
            return self._public_credential(item)

    def delete_credential(self, credential_id: str):
        with self._lock:
            data = self._load_unlocked()
            item = next((item for item in data["credentials"] if item["id"] == credential_id), None)
            if not item:
                raise KeyError("API không tồn tại")
            data["credentials"].remove(item)
            if credential_id.startswith("legacy-"):
                data["api_keys"].pop(credential_id.removeprefix("legacy-"), None)
            if data.get("credential_id") == credential_id:
                data["credential_id"] = None
            self._save_unlocked(data)

    def _save_unlocked(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.path)

    @staticmethod
    def _decrypt_key(cipher_text: str | None) -> str:
        if not cipher_text:
            return ""
        try:
            return decrypt_data(cipher_text)
        except ValueError:
            return ""

    def get_api_key(self, model: str, supplied_key: str | None = None) -> str:
        if supplied_key and supplied_key.strip():
            return supplied_key.strip()
        provider = model_spec(model)["provider"]
        with self._lock:
            data = self._load_unlocked()
            return self._decrypt_key(data["api_keys"].get(provider))

    def public(self) -> dict[str, Any]:
        with self._lock:
            data = self._load_unlocked()
            providers: dict[str, dict[str, Any]] = {}
            for provider in {spec["provider"] for spec in MODEL_SPECS.values()}:
                key = self._decrypt_key(data["api_keys"].get(provider))
                providers[provider] = {
                    "configured": bool(key),
                    "hint": f"••••{key[-4:]}" if key else "",
                }
            current_provider = model_spec(data["model"])["provider"]
            credentials = self.credentials()
            selected = next((item for item in credentials if item["id"] == data.get("credential_id")), None)
            return {
                "model": data["model"],
                "threads": int(data["threads"]),
                "rest_minutes": int(data["rest_minutes"]),
                "max_posts": int(data["max_posts"]),
                "api_key_configured": providers[current_provider]["configured"],
                "api_key_hint": providers[current_provider]["hint"],
                "providers": providers,
            }

    def save(self, *, model: str, threads: int, rest_minutes: int, max_posts: int,
             api_key: str | None = None) -> dict[str, Any]:
        provider = model_spec(model)["provider"]
        with self._lock:
            data = self._load_unlocked()
            data.update({
                "api_key_configured": selected["configured"] if selected else providers[current_provider]["configured"],
                "api_key_hint": selected["hint"] if selected else providers[current_provider]["hint"],
                "providers": providers,
                "credentials": credentials,
                "credential_id": data.get("credential_id"),
            }

    def save(self, *, model: str, threads: int, rest_minutes: int, max_posts: int,
             api_key: str | None = None, credential_id: str | None = None) -> dict[str, Any]:
        provider = model_spec(model)["provider"]
        with self._lock:
            data = self._load_unlocked()
            if credential_id:
                if not self.credential_key(credential_id, model):
                    raise ValueError("Khóa API không khả dụng")
            data.update({
                "credential_id": credential_id,
                "model": model,
                "threads": threads,
                "rest_minutes": rest_minutes,
                "max_posts": max_posts,
            })
            if api_key and api_key.strip():
                data["api_keys"][provider] = encrypt_data(api_key.strip())
                legacy_id = f"legacy-{provider}"
                data["credentials"] = [item for item in data["credentials"] if item["id"] != legacy_id]
                data["credentials"].append({"id": legacy_id, "name": f"{provider} (đã lưu)", "model": model, "encrypted_key": data["api_keys"][provider]})
            self._save_unlocked(data)
            return self.public()


group_settings = GroupSettingsStore()
