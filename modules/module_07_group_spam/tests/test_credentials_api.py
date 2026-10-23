import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from modules.module_07_group_spam.app.routes.router import router
from modules.module_07_group_spam.app.core.settings import group_settings


class CredentialsApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.original_path = group_settings.path
        group_settings.path = Path(self.temp.name) / "settings.json"
        self.addCleanup(setattr, group_settings, "path", self.original_path)
        for name, fn in [("encrypt_data", lambda key: "cipher:" + key[::-1]), ("decrypt_data", lambda key: key.removeprefix("cipher:")[::-1])]:
            mock = patch(f"modules.module_07_group_spam.app.core.settings.{name}", side_effect=fn)
            mock.start()
            self.addCleanup(mock.stop)
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def add(self, name="Main", key="secret-one", model="gpt-4o"):
        response = self.client.post("/api/groups/credentials", json={"name": name, "model": model, "api_key": key})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertNotIn(key, response.text)
        return response.json()

    def test_multiple_keys_same_provider_resolve_exact_selection_for_posts_and_comments(self):
        first = self.add()
        second = self.add("Backup", "secret-two")
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(len(self.client.get("/api/groups/credentials").json()), 2)
        with patch("modules.module_07_group_spam.app.routes.settings.generate_posts", return_value=["Generated"]) as generate:
            for entry, key, endpoint in [(first, "secret-one", "generate-posts"), (second, "secret-two", "generate-comments")]:
                result = self.client.post(f"/api/groups/ai/{endpoint}", json={"model": "gpt-4o", "credential_id": entry["id"], "prompt": "Topic", "count": 1})
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(generate.call_args.args[1], key)
        self.assertNotIn("secret-one", group_settings.path.read_text())

    def test_add_without_name_uses_model_as_default(self):
        response = self.client.post("/api/groups/credentials", json={"model": "gpt-4o-mini", "api_key": "secret-three"})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["name"], "gpt-4o-mini")
        self.assertEqual(response.json()["hint"], "••••hree")
        self.assertNotIn("secret-three", response.text)

    def test_edit_preserves_key_and_runtime_settings_then_replaces_key(self):
        entry = self.add()
        response = self.client.put("/api/groups/settings", json={"model": entry["model"], "credential_id": entry["id"], "threads": 4, "rest_minutes": 0, "max_posts": 42})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["api_key_configured"])
        response = self.client.put(f"/api/groups/credentials/{entry['id']}", json={"name": "Renamed", "model": "gpt-4o-mini", "api_key": ""})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(group_settings.credential_key(entry["id"], "gpt-4o-mini"), "secret-one")
        state = self.client.get("/api/groups/settings").json()
        self.assertEqual((state["threads"], state["rest_minutes"], state["max_posts"]), (4, 0, 42))
        stale = self.client.post("/api/groups/ai/generate-posts", json={"model": "gpt-4o", "credential_id": entry["id"], "prompt": "Topic", "count": 1})
        self.assertEqual(stale.status_code, 422)
        response = self.client.put(f"/api/groups/credentials/{entry['id']}", json={"name": "New key", "model": "gpt-4o-mini", "api_key": "secret-new"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(group_settings.credential_key(entry["id"], "gpt-4o-mini"), "secret-new")

    def test_delete_clears_selection_and_never_falls_back_to_another_key(self):
        first = self.add()
        self.add("Backup", "secret-two")
        self.client.put("/api/groups/settings", json={"model": "gpt-4o", "credential_id": first["id"], "threads": 1, "rest_minutes": 0, "max_posts": 1})
        self.assertEqual(self.client.delete(f"/api/groups/credentials/{first['id']}").status_code, 200)
        self.assertIsNone(self.client.get("/api/groups/settings").json()["credential_id"])
        with patch("modules.module_07_group_spam.app.routes.settings.generate_posts") as generate:
            result = self.client.post("/api/groups/ai/generate-posts", json={"model": "gpt-4o", "credential_id": first["id"], "prompt": "Topic", "count": 1})
            self.assertEqual(result.status_code, 404)
            generate.assert_not_called()

    def test_legacy_keys_migrate_with_stable_ids_and_stay_deleted(self):
        group_settings.path.write_text(json.dumps({"model": "gpt-4o", "api_keys": {"openai": "cipher:" + "legacy-secret"[::-1]}}))
        first = self.client.get("/api/groups/credentials").json()[0]
        self.assertEqual(first["id"], "legacy-openai")
        self.assertEqual(group_settings.credential_key(first["id"], first["model"]), "legacy-secret")
        self.client.delete("/api/groups/credentials/legacy-openai")
        self.add()
        items = self.client.get("/api/groups/credentials").json()
        self.assertEqual(len(items), 1)
        self.assertNotEqual(items[0]["id"], "legacy-openai")

    def test_validation_and_provider_change_require_new_key(self):
        for body in [{"name": " ", "model": "gpt-4o", "api_key": "key"}, {"name": "Missing", "model": "gpt-4o"}]:
            self.assertEqual(self.client.post("/api/groups/credentials", json=body).status_code, 422)
        entry = self.add()
        result = self.client.put(f"/api/groups/credentials/{entry['id']}", json={"name": "Google", "model": "gemini-2.5-flash"})
        self.assertEqual(result.status_code, 422)
        self.assertEqual(group_settings.credential_key(entry["id"], "gpt-4o"), "secret-one")


if __name__ == "__main__":
    unittest.main()
