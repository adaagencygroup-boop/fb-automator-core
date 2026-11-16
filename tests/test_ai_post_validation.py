"""Kiểm tra giới hạn thời gian giãn cách (0..3600) và validate Từ/Đến cho Đăng bài AI."""
import unittest
from fastapi import HTTPException

from modules.module_05_page_manager.ai_settings import normalize_settings
from modules.module_05_page_manager.routes import StartBody, start


class TestAiPostValidation(unittest.TestCase):
    def test_normalize_settings_clamps_sleep_range_to_3600(self):
        low = normalize_settings({"sleep_min": -50, "sleep_max": -10})
        self.assertEqual(low["sleep_min"], 0)
        self.assertEqual(low["sleep_max"], 0)

        high = normalize_settings({"sleep_min": 5000, "sleep_max": 9999})
        self.assertEqual(high["sleep_min"], 3600)
        self.assertEqual(high["sleep_max"], 3600)

        inverted = normalize_settings({"sleep_min": 600, "sleep_max": 300})
        self.assertEqual(inverted["sleep_min"], 600)
        self.assertEqual(inverted["sleep_max"], 600)

    def test_start_rejects_invalid_sleep_bounds(self):
        for sleep_min, sleep_max in [(-1, 100), (100, 3601), (600, 300)]:
            body = StartBody(sleep_min=sleep_min, sleep_max=sleep_max, page_ids=["123"])
            with self.assertRaises(HTTPException) as ctx:
                start(body, db=None)
            self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
