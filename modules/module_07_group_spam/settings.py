"""Local, device-bound settings for Module 7."""
from __future__ import annotations

import json
import os
import re
import threading
import uuid
from pathlib import Path
from typing import Any

from config.constants import DATA_DIR
from modules.module_02_account_manager.security.encryption import (
    decrypt_data,
    decrypt_legacy_data,
    encrypt_data,
)


MODEL_SPECS = {
    "gpt-4o": {"provider": "openai", "api_model": "gpt-4o"},
    "gpt-4o-mini": {"provider": "openai", "api_model": "gpt-4o-mini"},
    # Google AI Studio models. The API also accepts dynamically discovered
    # gemini-* model IDs returned by models.list for the user's own key.
    "gemini-3.8-flash": {"provider": "gemini", "api_model": "gemini-3.8-flash"},
    "gemini-3.7-flash": {"provider": "gemini", "api_model": "gemini-3.7-flash"},
    "gemini-3.6-flash": {"provider": "gemini", "api_model": "gemini-3.6-flash"},
    "gemini-3.5-flash": {"provider": "gemini", "api_model": "gemini-3.5-flash"},
    "gemini-3.5-flash-lite": {"provider": "gemini", "api_model": "gemini-3.5-flash-lite"},
    "gemini-3.1-pro-preview": {"provider": "gemini", "api_model": "gemini-3.1-pro-preview"},
    "gemini-2.5-flash": {"provider": "gemini", "api_model": "gemini-2.5-flash"},
    "gemini-2.5-flash-lite": {"provider": "gemini", "api_model": "gemini-2.5-flash-lite"},
    "gemini-2.5-pro": {"provider": "gemini", "api_model": "gemini-2.5-pro"},
    # Backward compatibility for settings saved by the first Module 7 version.
    "gemini": {"provider": "gemini", "api_model": "gemini-2.5-flash"},
}

DEFAULT_SETTINGS = {
    "model": "gpt-4o",
    "threads": 2,
    "rest_minutes": 10,
    "max_posts": 10,
    "api_keys": {},
}


def model_spec(model: str) -> dict[str, str]:
    if model in MODEL_SPECS:
        return MODEL_SPECS[model]
    if re.fullmatch(r"gemini-[A-Za-z0-9._-]{1,100}", model or ""):
        return {"provider": "gemini", "api_model": model}
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
            # Module 2 migrated saved credentials from the legacy HWID scheme.
            # Keep reading older Module 7 settings as well so existing API keys
            # remain available after that encryption migration.
            try:
                return decrypt_legacy_data(cipher_text)
            except ValueError:
                return ""

    @staticmethod
    def _provider_entries(data: dict[str, Any], provider: str) -> list[dict[str, str]]:
        value = data["api_keys"].get(provider)
        if isinstance(value, str):
            return [{"id": "legacy", "cipher": value}] if value else []
        if not isinstance(value, list):
            return []
        return [
            {"id": str(item["id"]), "cipher": str(item["cipher"])}
            for item in value
            if isinstance(item, dict) and item.get("id") and item.get("cipher")
        ]

    def get_api_key(self, model: str, supplied_key: str | None = None) -> str:
        if supplied_key and supplied_key.strip():
            return supplied_key.strip()
        provider = model_spec(model)["provider"]
        with self._lock:
            data = self._load_unlocked()
            entries = self._provider_entries(data, provider)
            active_id = data.get("active_api_keys", {}).get(provider)
            entries.sort(key=lambda item: item["id"] != active_id)
            for entry in entries:
                key = self._decrypt_key(entry["cipher"])
                if key:
                    return key
            return ""

    def public(self) -> dict[str, Any]:
        with self._lock:
            data = self._load_unlocked()
            providers: dict[str, dict[str, Any]] = {}
            for provider in {spec["provider"] for spec in MODEL_SPECS.values()}:
                entries = self._provider_entries(data, provider)
                keys = []
                for entry in entries:
                    key = self._decrypt_key(entry["cipher"])
                    keys.append({
                        "id": entry["id"],
                        "configured": bool(key),
                        "hint": f"••••{key[-4:]}" if key else "",
                    })
                active_id = data.get("active_api_keys", {}).get(provider)
                if not any(item["id"] == active_id and item["configured"] for item in keys):
                    active_id = next((item["id"] for item in keys if item["configured"]), None)
                active_key = next((item for item in keys if item["id"] == active_id), None)
                providers[provider] = {
                    "stored": bool(keys),
                    "configured": any(item["configured"] for item in keys),
                    "hint": active_key["hint"] if active_key else "",
                    "keys": keys,
                    "active_key_id": active_id,
                }
            current_provider = model_spec(data["model"])["provider"]
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
        with self._lock:
            data = self._load_unlocked()
            data.update({
                "model": model,
                "threads": threads,
                "rest_minutes": rest_minutes,
                "max_posts": max_posts,
            })
            self._save_unlocked(data)
            if api_key and api_key.strip():
                return self.save_api_key(model=model, api_key=api_key)
            return self.public()

    def save_api_key(self, *, model: str, api_key: str, key_id: str | None = None) -> dict[str, Any]:
        provider = model_spec(model)["provider"]
        api_key = api_key.strip()
        if not api_key:
            raise ValueError("API Key không được để trống")
        with self._lock:
            data = self._load_unlocked()
            entries = self._provider_entries(data, provider)
            target = next((entry for entry in entries if entry["id"] == key_id), None) if key_id else None
            if key_id and target is None:
                raise ValueError("API Key không tồn tại")
            if target:
                target["cipher"] = encrypt_data(api_key)
            else:
                target = {"id": uuid.uuid4().hex, "cipher": encrypt_data(api_key)}
                entries.append(target)
            data["api_keys"][provider] = entries
            data.setdefault("active_api_keys", {})[provider] = target["id"]
            self._save_unlocked(data)
            return self.public()

    def delete_api_key(self, *, model: str, key_id: str) -> dict[str, Any]:
        provider = model_spec(model)["provider"]
        with self._lock:
            data = self._load_unlocked()
            entries = self._provider_entries(data, provider)
            if not any(entry["id"] == key_id for entry in entries):
                raise ValueError("API Key không tồn tại")
            entries = [entry for entry in entries if entry["id"] != key_id]
            data["api_keys"][provider] = entries
            active_id = data.setdefault("active_api_keys", {}).get(provider)
            if active_id == key_id:
                usable = [entry for entry in entries if self._decrypt_key(entry["cipher"])]
                data["active_api_keys"][provider] = usable[0]["id"] if usable else None
            self._save_unlocked(data)
            return self.public()


group_settings = GroupSettingsStore()
