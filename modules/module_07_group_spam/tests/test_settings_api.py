import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.module_07_group_spam.api.router import router
from modules.module_07_group_spam.ai_service import list_gemini_models
from modules.module_07_group_spam.settings import GroupSettingsStore, group_settings


class GroupSettingsStoreTests(unittest.TestCase):
    def test_secret_is_encrypted_and_public_response_is_masked(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            store = GroupSettingsStore(path)
            with patch("modules.module_07_group_spam.settings.encrypt_data", return_value="encrypted-value"), \
                 patch("modules.module_07_group_spam.settings.decrypt_data", return_value="sk-real-secret"):
                public = store.save(
                    model="gpt-4o", api_key="sk-real-secret",
                    threads=3, rest_minutes=12, max_posts=25,
                )
                raw = json.loads(path.read_text(encoding="utf-8"))

            self.assertEqual(raw["api_keys"]["openai"], "encrypted-value")
            self.assertNotIn("sk-real-secret", path.read_text(encoding="utf-8"))
            self.assertEqual(public["api_key_hint"], "••••cret")
            self.assertEqual((public["threads"], public["rest_minutes"], public["max_posts"]), (3, 12, 25))

    def test_dynamic_gemini_model_is_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            store = GroupSettingsStore(Path(directory) / "settings.json")
            with patch("modules.module_07_group_spam.settings.encrypt_data", return_value="cipher"), \
                 patch("modules.module_07_group_spam.settings.decrypt_data", return_value="google-key"):
                public = store.save(
                    model="gemini-custom-preview-01", api_key="google-key",
                    threads=1, rest_minutes=0, max_posts=1,
                )
            self.assertEqual(public["model"], "gemini-custom-preview-01")


class GeminiModelDiscoveryTests(unittest.TestCase):
    def test_only_text_generate_content_models_are_returned(self):
        response = Mock(status_code=200)
        response.json.return_value = {"models": [
            {"name": "models/gemini-3.8-flash", "displayName": "Gemini 3.8 Flash", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-embedding-001", "displayName": "Embedding", "supportedGenerationMethods": ["embedContent"]},
            {"name": "models/gemini-3.8-flash-tts", "displayName": "TTS", "supportedGenerationMethods": ["generateContent"]},
        ]}
        with patch("modules.module_07_group_spam.ai_service.requests.get", return_value=response):
            models = list_gemini_models("google-key")
        self.assertEqual(models, [{"id": "gemini-3.8-flash", "name": "Gemini 3.8 Flash"}])


class GroupSettingsApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_path = group_settings.path
        group_settings.path = Path(self.temp.name) / "settings.json"
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def tearDown(self):
        group_settings.path = self.original_path
        self.temp.cleanup()

    def test_round_trip_settings_without_exposing_key(self):
        with patch("modules.module_07_group_spam.settings.encrypt_data", return_value="cipher"), \
             patch("modules.module_07_group_spam.settings.decrypt_data", return_value="AIza-example-key"):
            response = self.client.put("/api/groups/settings", json={
                "model": "gemini-3.8-flash",
                "api_key": "AIza-example-key",
                "threads": 4,
                "rest_minutes": 20,
                "max_posts": 30,
            })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["model"], "gemini-3.8-flash")
        self.assertTrue(body["api_key_configured"])
        self.assertNotIn("AIza-example-key", response.text)

    def test_rejects_invalid_runtime_values(self):
        response = self.client.put("/api/groups/settings", json={
            "model": "gpt-4o",
            "threads": 0,
            "rest_minutes": -1,
            "max_posts": 0,
        })
        self.assertEqual(response.status_code, 422)

    def test_api_key_is_required_when_provider_has_no_saved_key(self):
        response = self.client.put("/api/groups/settings", json={
            "model": "gpt-4o",
            "threads": 2,
            "rest_minutes": 10,
            "max_posts": 10,
        })
        self.assertEqual(response.status_code, 422)

    def test_connection_check_uses_saved_or_supplied_key(self):
        with patch("modules.module_07_group_spam.api.router.group_settings.get_api_key", return_value="secret"), \
             patch("modules.module_07_group_spam.api.router.test_connection") as check:
            response = self.client.post("/api/groups/settings/test", json={"model": "gpt-4o"})
        self.assertEqual(response.status_code, 200)
        check.assert_called_once_with("gpt-4o", "secret")

    def test_generate_posts_returns_provider_output(self):
        with patch("modules.module_07_group_spam.api.router.group_settings.get_api_key", return_value="secret"), \
             patch("modules.module_07_group_spam.api.router.generate_posts", return_value=["Bài một", "Bài hai"]):
            response = self.client.post("/api/groups/ai/generate-posts", json={
                "model": "gpt-4o-mini", "prompt": "Chủ đề kiểm thử", "count": 2,
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["posts"], ["Bài một", "Bài hai"])

    def test_lists_models_visible_to_google_ai_studio_key(self):
        visible = [{"id": "gemini-3.8-flash", "name": "Gemini 3.8 Flash"}]
        with patch("modules.module_07_group_spam.api.router.group_settings.get_api_key", return_value="secret"), \
             patch("modules.module_07_group_spam.api.router.list_gemini_models", return_value=visible):
            response = self.client.post("/api/groups/ai/gemini-models", json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"models": visible, "count": 1})


if __name__ == "__main__":
    unittest.main()
