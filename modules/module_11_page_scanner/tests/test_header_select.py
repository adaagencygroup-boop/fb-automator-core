"""Test chọn heading tác giả — không bắt buộc thẻ h1."""
from __future__ import annotations

import unittest

from modules.module_11_page_scanner.header_select import (
    author_tab_url_matches,
    is_generic_h1_text,
    names_match,
    select_author_heading,
    select_author_h1,
)
from modules.module_11_page_scanner.scanner import VERIFY_AUTHOR_DEADLINE_SEC


class TestHeaderSelect(unittest.TestCase):
    def test_picks_heading_div_not_notifications_h1(self):
        """Fixture: h1 Notifications ẩn + div role=heading tên tác giả + span tên."""
        candidates = [
            {
                "text": "Notifications",
                "tag": "h1",
                "role": "",
                "visible": False,
                "aria_hidden": False,
                "width": 0,
                "height": 0,
                "source": "h1",
            },
            {
                "text": "Moon Doãn",
                "tag": "div",
                "role": "heading",
                "visible": True,
                "aria_hidden": False,
                "width": 220,
                "height": 32,
                "source": "heading",
                "in_main": True,
            },
            {
                "text": "Moon Doãn",
                "tag": "span",
                "role": "",
                "visible": True,
                "aria_hidden": False,
                "width": 180,
                "height": 24,
                "source": "main_text",
                "in_main": True,
            },
        ]
        chosen, catalog = select_author_heading(candidates, "Moon Doãn")
        self.assertIsNotNone(chosen)
        self.assertEqual(chosen["text"], "Moon Doãn")
        self.assertNotEqual(chosen.get("tag"), "h1")
        self.assertIn(chosen.get("role") or chosen.get("source"), ("heading", "main_text", ""))
        self.assertTrue(any(c["text"] == "Notifications" for c in catalog))
        # Ưu tiên heading hơn span
        self.assertEqual(chosen.get("source"), "heading")

    def test_picks_span_in_main_when_no_h1(self):
        candidates = [
            {
                "text": "Notifications",
                "tag": "h1",
                "visible": False,
                "aria_hidden": True,
                "width": 0,
                "height": 0,
                "source": "h1",
            },
            {
                "text": "HDL MEDIA",
                "tag": "span",
                "visible": True,
                "aria_hidden": False,
                "width": 160,
                "height": 28,
                "source": "main_text",
                "in_main": True,
            },
        ]
        chosen, _ = select_author_heading(candidates, "HDL MEDIA")
        self.assertEqual(chosen["text"], "HDL MEDIA")
        self.assertEqual(chosen["tag"], "span")

    def test_alias_select_author_h1_still_works(self):
        chosen, _ = select_author_h1(
            [
                {
                    "text": "Notifications",
                    "visible": True,
                    "aria_hidden": False,
                    "width": 100,
                    "height": 20,
                },
                {
                    "text": "MAN88 Sàn Đấu Bóng Chuyền",
                    "visible": True,
                    "aria_hidden": False,
                    "width": 300,
                    "height": 30,
                    "tag": "h1",
                    "source": "h1",
                },
            ],
            "MAN88 Sàn Đấu Bóng Chuyền",
        )
        self.assertEqual(chosen["text"], "MAN88 Sàn Đấu Bóng Chuyền")

    def test_generic_and_names(self):
        self.assertTrue(is_generic_h1_text("Notifications"))
        self.assertTrue(names_match("Moon Doãn", "Moon Doãn"))
        self.assertFalse(names_match("Notifications", "Moon Doãn"))

    def test_author_tab_url_contains_slug(self):
        ok, detail = author_tab_url_matches(
            "https://www.facebook.com/moondoan.shop",
            "https://www.facebook.com/moondoan.shop",
        )
        self.assertTrue(ok, detail)
        ok2, _ = author_tab_url_matches(
            "https://www.facebook.com/profile.php?id=100012345678901",
            "https://www.facebook.com/profile.php?id=100012345678901",
        )
        self.assertTrue(ok2)
        ok3, d3 = author_tab_url_matches(None or "", "https://www.facebook.com/x")
        self.assertFalse(ok3)
        self.assertEqual(d3, "empty_current_url")

    def test_deadline_is_15_not_30(self):
        self.assertLessEqual(VERIFY_AUTHOR_DEADLINE_SEC, 15.0)
        self.assertGreaterEqual(VERIFY_AUTHOR_DEADLINE_SEC, 10.0)

    def test_batch_dedupe_set(self):
        """Cùng author 2 bài trong batch → chỉ 1 lần verify."""
        batch_attempted = set()
        authors = ["https://www.facebook.com/moon", "https://www.facebook.com/moon"]
        verify_count = 0
        for a in authors:
            if a in batch_attempted:
                continue
            batch_attempted.add(a)
            verify_count += 1
        self.assertEqual(verify_count, 1)
        self.assertEqual(len(batch_attempted), 1)

    def test_tab_closed_exc_detection(self):
        from modules.module_11_page_scanner.scanner import _is_tab_closed_exc

        class NoSuchWindowException(Exception):
            pass

        class WebDriverException(Exception):
            pass

        self.assertTrue(_is_tab_closed_exc(NoSuchWindowException("no such window: target window already closed")))
        self.assertTrue(
            _is_tab_closed_exc(WebDriverException("no such window: target window already closed"))
        )
        self.assertFalse(_is_tab_closed_exc(ValueError("bad header")))
        self.assertFalse(_is_tab_closed_exc(WebDriverException("element click intercepted")))


if __name__ == "__main__":
    unittest.main()
