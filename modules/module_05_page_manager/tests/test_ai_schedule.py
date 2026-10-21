import time
import unittest
from unittest.mock import patch

from datetime import datetime

from modules.module_05_page_manager.ai_job import (
    _content_for,
    _format_remain,
    _has_later_page,
    _next_slot,
    due_slot,
    parse_schedule_times,
)
from modules.module_05_page_manager.page_poster import PostInterrupted, _guard
from modules.module_05_page_manager.vi_messages import suggested_replacement, vi_gemini_message


class ScheduleTimeTests(unittest.TestCase):
    def test_accepts_hhmm_list(self):
        self.assertEqual(parse_schedule_times("09:00, 15:00;21:00"), ["09:00", "15:00", "21:00"])

    def test_rejects_bad_hour(self):
        with self.assertRaises(ValueError):
            parse_schedule_times("25:00")

    def test_late_slot_runs_as_soon_as_free(self):
        now = datetime(2026, 10, 21, 9, 7, 0)
        fired = set()
        slot, late = due_slot(["09:00", "09:05", "15:00"], fired, now=now)
        self.assertEqual(slot, "09:00")
        self.assertTrue(late)
        slot, late = due_slot(["09:00", "09:05", "15:00"], fired, now=now)
        self.assertEqual(slot, "09:05")
        self.assertTrue(late)
        slot, late = due_slot(["09:00", "09:05", "15:00"], fired, now=now)
        self.assertIsNone(slot)
        self.assertFalse(late)
        upcoming, remain = _next_slot(["09:00", "09:05", "15:00"], fired, now=now)
        self.assertEqual(upcoming, "15:00")
        self.assertGreater(remain, 0)

    def test_exact_minute_is_not_marked_late(self):
        now = datetime(2026, 10, 21, 9, 0, 30)
        slot, late = due_slot(["09:00"], set(), now=now)
        self.assertEqual(slot, "09:00")
        self.assertFalse(late)

    def test_next_slot_is_the_nearest_upcoming(self):
        now = datetime(2026, 10, 16, 9, 50, 0)
        slot, remain = _next_slot(["09:55", "15:00", "21:00"], set(), now=now)
        self.assertEqual(slot, "09:55")
        self.assertEqual(remain, 5 * 60)

    def test_last_page_does_not_wait(self):
        pages = [{"url": "https://facebook.com/a"}, {"url": ""}, {"url": "https://facebook.com/b"}]
        self.assertTrue(_has_later_page(pages, 0))
        self.assertTrue(_has_later_page(pages, 1))
        self.assertFalse(_has_later_page(pages, 2))

    def test_guard_distinguishes_stop_and_timeout(self):
        with self.assertRaises(PostInterrupted) as stopped:
            _guard(lambda: True, time.monotonic() + 30)
        self.assertEqual(stopped.exception.kind, "stopped")
        with self.assertRaises(PostInterrupted) as expired:
            _guard(lambda: False, time.monotonic() - 1)
        self.assertEqual(expired.exception.kind, "timeout")

    def test_countdown_text(self):
        self.assertEqual(_format_remain(90), "1 phút 30 giây")
        self.assertEqual(_format_remain(45), "45 giây")


class ModelFallbackTests(unittest.TestCase):
    def test_reads_the_model_google_names(self):
        message = (
            "This model models/gemini-2.5-flash is no longer available to new users. "
            "Please update your code to use models/gemini-3.8-flash"
        )
        self.assertEqual(suggested_replacement(message), "gemini-3.8-flash")

    def test_translates_high_demand_to_vietnamese(self):
        message = "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later."
        translated = vi_gemini_message(message)
        self.assertEqual(translated, "Máy chủ Gemini đang quá tải. Thử lại sau ít phút.")
        self.assertNotIn("high demand", translated.lower())
        self.assertNotIn("Please try again", translated)

    def test_blank_ai_uses_temporary_topic_post(self):
        with patch(
            "modules.module_05_page_manager.ai_generator.AIGenerator.generate_batch_content",
            return_value="",
        ), patch("modules.module_05_page_manager.ai_job._progress"):
            text, keyword = _content_for(
                {"name": "Bếp Nhà Mẹ Nấu", "category": "cơm mẹ nấu"},
                {"api_keys": ["x"], "model_name": "gemini-2.5-flash", "prompt": "Mở đầu 1 câu gây tò mò."},
                lambda: True,
            )
        self.assertIn("cơm mẹ nấu", text)
        self.assertNotIn("Mở đầu 1 câu gây tò mò", text)
        self.assertEqual(keyword, "cơm mẹ nấu")

    def test_missing_key_uses_temporary_topic_post(self):
        with patch("modules.module_05_page_manager.ai_job._progress"):
            text, keyword = _content_for(
                {"name": "Bếp Nhà Mẹ Nấu", "category": "cơm mẹ nấu"},
                {"api_keys": [], "model_name": "gemini-3.8-flash", "prompt": ""},
                lambda: True,
            )
        self.assertIn("cơm mẹ nấu", text)
        self.assertEqual(keyword, "cơm mẹ nấu")


if __name__ == "__main__":
    unittest.main()
