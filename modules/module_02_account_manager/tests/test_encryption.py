import hashlib
import unittest
from unittest.mock import patch
from ..security import encryption
from ..security.hwid_collector import get_hwid as source_get_hwid

class TestEncryption(unittest.TestCase):
    def test_source_hwid_format_matches_original_collector(self):
        with patch("modules.module_02_account_manager.security.hwid_collector._run_cmd", side_effect=["uuid-1", "cpu-1"]):
            self.assertEqual(source_get_hwid(), hashlib.sha256(b"uuid-1::cpu-1").hexdigest())

    def test_source_aes_key_derivation_and_wire_format(self):
        hwid = "0123456789abcdef" * 4
        with patch.object(encryption, "get_hwid", return_value=hwid):
            encrypted = encryption.encrypt_data("secret value")
            raw = __import__("base64").b64decode(encrypted)
            self.assertEqual(len(raw[:16]), 16)
            self.assertEqual((len(raw) - 16) % 16, 0)
            self.assertEqual(encryption.decrypt_data(encrypted), "secret value")
        self.assertEqual(encryption._derive_key(hwid), hashlib.sha256(hwid.encode()).digest())

    def test_legacy_module2_key_can_be_read_for_migration(self):
        old_hwid = "legacy-machine-key"
        with patch.object(encryption, "get_legacy_hwid", return_value=old_hwid):
            old_cipher = encryption._crypt("legacy secret", old_hwid)
        with patch.object(encryption, "get_legacy_hwid", return_value=old_hwid):
            self.assertEqual(encryption.decrypt_legacy_data(old_cipher), "legacy secret")

    def test_invalid_ciphertext_fails_closed(self):
        with patch.object(encryption, "get_hwid", return_value="source-hwid"):
            with self.assertRaises(ValueError):
                encryption.decrypt_data("not-base64")
            self.assertEqual(encryption.encrypt_data(""), "")
            self.assertEqual(encryption.decrypt_data(""), "")

if __name__ == "__main__":
    unittest.main()
