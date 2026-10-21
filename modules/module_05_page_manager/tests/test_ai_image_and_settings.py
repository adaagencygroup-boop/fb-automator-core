import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.module_05_page_manager.ai_settings import normalize_settings
from modules.module_05_page_manager.image_downloader import (
    get_image_from_internet,
    keyword_cache_name,
    read_keyword_image,
    remember_keyword_image,
)


class _Response:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._payload = payload or {}

    def json(self):
        return self._payload


class PixabayLimitTests(unittest.TestCase):
    def test_429_stops_after_one_call_and_one_limit_line(self):
        calls = []
        logs = []

        def fake_get(url, params=None, timeout=None):
            calls.append(params["q"])
            return _Response(429)

        with patch("modules.module_05_page_manager.image_downloader.requests.get", fake_get):
            result = get_image_from_internet("spa mỹ phẩm", "pixabay-key", logs.append)

        self.assertIsNone(result)
        self.assertEqual(calls, ["spa mỹ phẩm"])
        self.assertEqual(logs[-1], "[!] Pixabay giới hạn lượt gọi.")
        self.assertFalse(any("không có ảnh" in line for line in logs))
        self.assertFalse(any("ảnh tạm" in line for line in logs))

    def test_no_hits_does_not_promise_a_random_image(self):
        logs = []

        def fake_get(url, params=None, timeout=None):
            return _Response(200, {"hits": []})

        with patch("modules.module_05_page_manager.image_downloader.requests.get", fake_get):
            result = get_image_from_internet("spa mỹ phẩm", "pixabay-key", logs.append)

        self.assertIsNone(result)
        self.assertIn("[!] Pixabay không có ảnh phù hợp.", logs)
        self.assertFalse(any("ảnh tạm" in line for line in logs))


class KeywordCacheTests(unittest.TestCase):
    def test_same_keyword_reuses_the_last_image(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertTrue(remember_keyword_image(folder, "Mỹ phẩm", b"jpeg-a"))
            self.assertTrue(remember_keyword_image(folder, "  mỹ phẩm ", b"jpeg-b"))
            self.assertEqual(read_keyword_image(folder, "Mỹ phẩm"), b"jpeg-b")
            self.assertEqual(keyword_cache_name("Mỹ phẩm"), keyword_cache_name("mỹ phẩm"))
            self.assertEqual(keyword_cache_name("   "), "")
            self.assertIsNone(read_keyword_image(folder, ""))
            self.assertEqual(len(list(Path(folder).glob("*.jpg"))), 1)


class SettingsNormalizeTests(unittest.TestCase):
    def test_keeps_schedule_model_sleep_and_keywords(self):
        config = normalize_settings({
            "gemini_key": " gemini ",
            "pixabay_key": "pix",
            "model_name": "gemini-3-flash-preview",
            "prompt": "xin chào",
            "schedule_enabled": True,
            "schedule_times": ["09:00", "99:00", "15:00", "09:00"],
            "sleep_min": 900,
            "sleep_max": 100,
            "keywords": {"12": "  mỹ phẩm  ", "": "bỏ"},
        })
        self.assertEqual(config["gemini_key"], "gemini")
        self.assertEqual(config["model_name"], "gemini-3-flash-preview")
        self.assertEqual(config["schedule_times"], ["09:00", "15:00"])
        self.assertEqual(config["sleep_min"], 900)
        self.assertEqual(config["sleep_max"], 900)
        self.assertEqual(config["keywords"], {"12": "mỹ phẩm"})
        self.assertNotIn("fb_version", config)

    def test_rejects_unknown_model(self):
        config = normalize_settings({"model_name": "not a model"})
        self.assertEqual(config["model_name"], "gemini-3-flash-preview")


if __name__ == "__main__":
    unittest.main()
