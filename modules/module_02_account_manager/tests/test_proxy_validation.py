import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from ..api.schemas import AccountInput, SingleAccountInput
from ..api.router import router
from ..database.connection import get_db


class TestProxyValidation(unittest.TestCase):
    def test_supported_formats_and_empty(self):
        for value in (None, "", " ", "host:1", "host:65535:user:pass", "user:pass@host:8080", "http://host:80", "https://host:443", "socks5://host:8080"):
            with self.subTest(value=value):
                self.assertEqual(AccountInput(uid="123", proxy=value).proxy, value.strip() if value is not None else None)

    def test_invalid_proxy_for_both_inputs(self):
        for model in (AccountInput, SingleAccountInput):
            for value in ("8b4ba9dd-3ea5-4e5f-86f1-ddba2230dcf2", "host:0", "host:65536", "host:abc", "socks4://host:8080"):
                with self.subTest(model=model, value=value), self.assertRaises(ValidationError):
                    model(uid="123", proxy=value)

    def test_invalid_requests_never_save(self):
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: None
        client = TestClient(app)
        invalid = {"uid": "123", "proxy": "8b4ba9dd-3ea5-4e5f-86f1-ddba2230dcf2"}
        with patch("modules.module_02_account_manager.services.account_service.save_single_account") as single, patch("modules.module_02_account_manager.services.account_service.import_accounts") as bulk:
            self.assertEqual(client.post("/api/accounts/single", json=invalid).status_code, 422)
            self.assertEqual(client.post("/api/accounts/import", json={"accounts": [invalid]}).status_code, 422)
            single.assert_not_called()
            bulk.assert_not_called()
