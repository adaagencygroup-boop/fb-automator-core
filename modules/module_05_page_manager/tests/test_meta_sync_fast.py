import unittest
from unittest.mock import Mock, patch
from modules.module_05_page_manager.meta_sync import prepare_token, _verify_single_page


class MetaSyncFastTests(unittest.TestCase):
    @patch("modules.module_05_page_manager.meta_sync.fb_client")
    def test_prepare_token_fast_no_individual_inspect(self, mock_fb):
        mock_fb.inspect_token.side_effect = lambda t, user=True: {
            "user_id": "10001",
            "app_id": "app_123",
            "is_valid": True,
            "type": "USER" if user else "PAGE",
            "data_access_expires_at": 1899999999,
        }
        mock_fb.exchange_token.return_value = "long_lived_token_xyz"
        mock_fb.get_user_profile.return_value = {"id": "10001", "name": "Nguyen Van A"}
        mock_fb.fetch_managed_pages.return_value = [
            {"id": f"page_{i}", "name": f"Page {i}", "access_token": f"token_{i}"}
            for i in range(50)
        ]

        # Call prepare_token with 50 pages
        result = prepare_token("raw_token_short")

        self.assertEqual(len(result["pages"]), 50)
        self.assertEqual(result["identity"]["id"], "10001")
        self.assertEqual(result["token"], "long_lived_token_xyz")

        # Crucial check: inspect_token should ONLY have been called 2 times for user tokens (raw + long_lived),
        # NEVER called sequentially 50 times for each individual page!
        self.assertEqual(mock_fb.inspect_token.call_count, 2)

        # All 50 pages should have immediate permanent metadata
        for p in result["pages"]:
            meta = p["token_metadata"]
            self.assertEqual(meta["is_valid"], True)
            self.assertEqual(meta["expires_at"], 0)
            self.assertEqual(meta["type"], "PAGE")
            self.assertEqual(meta["app_id"], "app_123")

    @patch("modules.module_05_page_manager.meta_sync.db")
    @patch("modules.module_05_page_manager.meta_sync.fb_client")
    def test_verify_single_page_success(self, mock_fb, mock_db):
        mock_fb.inspect_token.return_value = {
            "user_id": "10001",
            "is_valid": True,
            "type": "PAGE",
            "scopes": ["pages_manage_posts"],
            "expires_at": 0,
        }
        mock_cur = Mock()
        mock_db.session.return_value.__enter__.return_value = mock_cur

        _verify_single_page("alice", "page_123", "token_abc", "10001")

        self.assertTrue(mock_cur.execute.called)
        query = mock_cur.execute.call_args[0][0]
        params = mock_cur.execute.call_args[0][1]
        self.assertIn("UPDATE pages", query)
        self.assertEqual(params[1], "ACTIVE")

    @patch("modules.module_05_page_manager.meta_sync.db")
    @patch("modules.module_05_page_manager.meta_sync.fb_client")
    def test_verify_single_page_failure_marks_error(self, mock_fb, mock_db):
        mock_fb.inspect_token.side_effect = Exception("Token revoked by user")
        mock_cur = Mock()
        mock_db.session.return_value.__enter__.return_value = mock_cur

        _verify_single_page("alice", "page_123", "bad_token", "10001")

        self.assertTrue(mock_cur.execute.called)
        params = mock_cur.execute.call_args[0][1]
        self.assertEqual(params[1], "ERROR")
        self.assertIn("Token revoked by user", params[0])


if __name__ == "__main__":
    unittest.main()
