"""Case test parser ngày giờ POST_SCAN — đủ 4 nhóm EN/VI + utime/iso."""
from __future__ import annotations

import unittest
from datetime import datetime

from modules.module_11_page_scanner.facebook_time import parse_facebook_published_at
from modules.module_11_page_scanner.posts_scan import date_in_range

# Neo cố định để relative ổn định
NOW = datetime(2025, 10, 28, 12, 0, 0)


class TestUtimeAndIso(unittest.TestCase):
    def test_utime_priority(self):
        # Oct 21, 2025 00:00 UTC approx — chỉ cần đúng ngày
        # 1761004800 = 2025-10-21 00:00:00 UTC
        d, src = parse_facebook_published_at("a day ago", now=NOW, utime=1761004800)
        self.assertEqual(d, "2025-10-21")
        self.assertEqual(src, "utime")

    def test_iso_attr(self):
        d, src = parse_facebook_published_at(None, iso_attr="2025-10-21T07:39:00+07:00")
        self.assertEqual(d, "2025-10-21")
        self.assertEqual(src, "iso_attr")


class TestGroup1RelativeShort(unittest.TestCase):
    """Header feed: Just now, 1 min, 1 hr, Yesterday at …"""

    def test_just_now(self):
        self.assertEqual(parse_facebook_published_at("Just now", now=NOW)[0], "2025-10-28")
        self.assertEqual(parse_facebook_published_at("Vừa xong", now=NOW)[0], "2025-10-28")

    def test_mins_hrs(self):
        self.assertEqual(parse_facebook_published_at("1 min", now=NOW)[0], "2025-10-28")
        self.assertEqual(parse_facebook_published_at("5 mins", now=NOW)[0], "2025-10-28")
        self.assertEqual(parse_facebook_published_at("1 hr", now=NOW)[0], "2025-10-28")
        self.assertEqual(parse_facebook_published_at("2 hrs", now=NOW)[0], "2025-10-28")

    def test_yesterday_at(self):
        self.assertEqual(
            parse_facebook_published_at("Yesterday at 7:39 AM", now=NOW)[0],
            "2025-10-27",
        )
        self.assertEqual(
            parse_facebook_published_at("Hôm qua lúc 7:39", now=NOW)[0],
            "2025-10-27",
        )


class TestGroup2Ago(unittest.TestCase):
    """… ago / … trước — gồm a/an và số."""

    def test_en_ago(self):
        cases = [
            ("a minute ago", "2025-10-28"),
            ("2 minutes ago", "2025-10-28"),
            ("an hour ago", "2025-10-28"),
            ("3 hours ago", "2025-10-28"),
            ("a day ago", "2025-10-27"),
            ("2 days ago", "2025-10-26"),
            ("a week ago", "2025-10-21"),
            ("3 weeks ago", "2025-10-07"),
            ("a month ago", "2025-09-28"),
            ("2 months ago", "2025-08-29"),
            ("a year ago", "2024-10-28"),
            ("2 years ago", "2023-10-29"),  # 730 ngày (có năm nhuận 2024)
            ("1 hr ago", "2025-10-28"),
            ("2 hrs ago", "2025-10-28"),
        ]
        for text, expect in cases:
            with self.subTest(text=text):
                d, src = parse_facebook_published_at(text, now=NOW)
                self.assertEqual(d, expect, msg=f"{text} -> {d} ({src})")
                self.assertEqual(src, "relative")

    def test_vi_truoc(self):
        cases = [
            ("5 phút trước", "2025-10-28"),
            ("2 giờ trước", "2025-10-28"),
            ("1 ngày trước", "2025-10-27"),
            ("2 ngày trước", "2025-10-26"),
            ("1 tuần trước", "2025-10-21"),
            ("3 tháng trước", "2025-07-30"),
            ("1 năm trước", "2024-10-28"),
        ]
        for text, expect in cases:
            with self.subTest(text=text):
                d, src = parse_facebook_published_at(text, now=NOW)
                self.assertEqual(d, expect)


class TestGroup3Absolute(unittest.TestCase):
    def test_en_absolute(self):
        self.assertEqual(
            parse_facebook_published_at("October 21 at 7:39 AM", now=NOW)[0],
            "2025-10-21",
        )
        self.assertEqual(
            parse_facebook_published_at("October 21, 2025 at 7:39 AM", now=NOW)[0],
            "2025-10-21",
        )
        self.assertEqual(
            parse_facebook_published_at("October 21, 2025", now=NOW)[0],
            "2025-10-21",
        )

    def test_vi_absolute(self):
        self.assertEqual(
            parse_facebook_published_at("21 tháng 10 lúc 7:39", now=NOW)[0],
            "2025-10-21",
        )
        self.assertEqual(
            parse_facebook_published_at("21 tháng 10 năm 2025 lúc 7:39", now=NOW)[0],
            "2025-10-21",
        )


class TestGroup4Compact(unittest.TestCase):
    def test_compact(self):
        cases = [
            ("5m", "2025-10-28"),
            ("2h", "2025-10-28"),
            ("1d", "2025-10-27"),
            ("2d", "2025-10-26"),
            ("1w", "2025-10-21"),
            ("3w", "2025-10-07"),
            ("1y", "2024-10-28"),
            ("Just now", "2025-10-28"),
        ]
        for text, expect in cases:
            with self.subTest(text=text):
                d, _ = parse_facebook_published_at(text, now=NOW)
                self.assertEqual(d, expect)


class TestDateFilter(unittest.TestCase):
    """Lọc khớp input Từ ngày / Đến ngày (yyyy-mm-dd từ <input type=date>)."""

    def test_range_includes_absolute(self):
        d, _ = parse_facebook_published_at("October 21, 2025 at 7:39 AM", now=NOW)
        self.assertTrue(date_in_range(d, "2025-10-01", "2025-10-31"))
        self.assertFalse(date_in_range(d, "2025-10-22", "2025-10-31"))

    def test_range_relative_day_ago(self):
        d, _ = parse_facebook_published_at("a day ago", now=NOW)
        self.assertEqual(d, "2025-10-27")
        self.assertTrue(date_in_range(d, "2025-10-27", "2025-10-27"))
        self.assertFalse(date_in_range(d, "2025-10-28", None))

    def test_unparsed_passes_filter(self):
        # Không parse được → vẫn giữ (không loại nhầm)
        self.assertTrue(date_in_range(None, "2025-10-01", "2025-10-31"))


if __name__ == "__main__":
    unittest.main()
