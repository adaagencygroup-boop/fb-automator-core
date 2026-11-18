"""Kiểm tra tách riêng post_url (link đăng Reel) và object_path ở API Lịch sử."""
import unittest
from unittest.mock import patch

from modules.module_05_page_manager.routes_download import get_history_list


class TestHistoryPostUrl(unittest.TestCase):
    def test_get_history_list_queries_separate_post_url_and_object_path(self):
        with patch("modules.module_05_page_manager.routes_download.ensure_page_activity_table"), patch(
            "modules.module_05_page_manager.routes_download.db.fetch_all", return_value=[]
        ) as mock_fetch:
            res = get_history_list(post_type="REEL")
            self.assertEqual(res, {"history": []})
            sql = mock_fetch.call_args[0][0]
            self.assertIn("coalesce(h.post_url, '') as post_url", sql)
            self.assertIn("coalesce(h.media_path, '') as object_path", sql)
            self.assertNotIn("coalesce(h.media_path, h.post_url", sql)


if __name__ == "__main__":
    unittest.main()
