"""
Configuration & Settings Manager
"""
import json
import os
import threading
from typing import Any, Dict
from config.constants import CONFIG_PATH

DEFAULT_CONFIG = {
    "app_name": "Facebook Automator Pro",
    "version": "2.0.0",
    "max_threads": 5,
    "request_timeout": 30,
    "anti_spam": {
        "delay_min_seconds": 300,
        "delay_max_seconds": 600,
        "max_posts_per_page_day": 5
    },
    "gemini": {
        "model_name": "gemini-3.8-flash",
        "batch_size": 10,
        "timeout_seconds": 120,
        "temperature": 0.7
    },
    "scrapers": {
        "tiktok_max_workers": 4,
        "youtube_quality": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "use_browser_cookies": "chrome"
    },
    "google_sheets": {
        "enabled": False,
        "credentials_path": "",
        "sheet_id": ""
    }
}

class SettingsManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(SettingsManager, cls).__new__(cls)
                cls._instance._config = cls._instance._load_config()
        return cls._instance

    def _load_config(self) -> Dict[str, Any]:
        if not CONFIG_PATH.exists():
            self._save_to_disk(DEFAULT_CONFIG)
            return DEFAULT_CONFIG.copy()
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Merge default keys if missing
                for k, v in DEFAULT_CONFIG.items():
                    if k not in data:
                        data[k] = v
                return data
        except Exception:
            return DEFAULT_CONFIG.copy()

    def _save_to_disk(self, config_data: Dict[str, Any]):
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(config_data, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving config: {e}")

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            parts = key.split(".")
            val = self._config
            for p in parts:
                if isinstance(val, dict) and p in val:
                    val = val[p]
                else:
                    return default
            return val

    def set(self, key: str, value: Any):
        with self._lock:
            parts = key.split(".")
            target = self._config
            for p in parts[:-1]:
                if p not in target or not isinstance(target[p], dict):
                    target[p] = {}
                target = target[p]
            target[parts[-1]] = value
            self._save_to_disk(self._config)

    def get_all(self) -> Dict[str, Any]:
        with self._lock:
            return self._config.copy()

settings = SettingsManager()
