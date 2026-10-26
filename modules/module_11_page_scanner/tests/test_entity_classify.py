"""Test classifier offline trên fixture — không mở Facebook."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from modules.module_11_page_scanner.entity_classify import (
    build_about_url,
    classify_page_entity,
    should_open_about,
)

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "classify_headers.json"


def _load_fixture() -> dict:
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        return json.load(f)


def _run_case(case: dict):
    entity, reason, debug = classify_page_entity(
        url=case.get("url") or "",
        header_text=case.get("header_text") or "",
        header_buttons=case.get("header_buttons") or [],
        header_tabs=case.get("header_tabs") or [],
        about_text=case.get("about_text") or "",
        main_sample=case.get("header_text") or "",
    )
    return entity, reason, debug


class TestEntityClassifyFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = _load_fixture()

    def test_five_shops_are_page(self):
        shops = self.data["shops"]
        self.assertEqual(len(shops), 5)
        for case in shops:
            with self.subTest(case["name"]):
                entity, reason, _ = _run_case(case)
                self.assertEqual(
                    entity,
                    "PAGE",
                    f"{case['name']} → {entity}/{reason}, expect PAGE",
                )
                # Phải tới được bước lọc follower (có follower_text trong fixture)
                self.assertTrue(
                    case.get("follower_text") or "theo dõi" in (case.get("header_text") or "").lower()
                    or "follower" in (case.get("header_text") or "").lower(),
                    f"{case['name']} thiếu follower để lọc",
                )

    def test_profile_add_friend(self):
        case = next(c for c in self.data["profiles"] if c["id"] == "profile_add_friend")
        entity, reason, _ = _run_case(case)
        self.assertEqual(entity, "PROFILE")
        self.assertIn("friend_button", reason)

    def test_profile_already_friends(self):
        case = next(c for c in self.data["profiles"] if c["id"] == "profile_already_friends")
        entity, reason, _ = _run_case(case)
        self.assertEqual(entity, "PROFILE")

    def test_pages_id_url(self):
        case = next(c for c in self.data["pages_extra"] if c["id"] == "pages_id_url")
        entity, reason, _ = _run_case(case)
        self.assertEqual(entity, "PAGE")
        self.assertEqual(reason, "url_pages_id")

    def test_about_url_profile_php(self):
        u = build_about_url("https://www.facebook.com/profile.php?id=100012345678901")
        self.assertIn("profile.php?id=100012345678901", u)
        self.assertIn("sk=about", u)
        self.assertTrue(u.endswith("sk=about") or "&sk=about" in u)

    def test_about_url_slug(self):
        u = build_about_url("https://www.facebook.com/tutustore")
        self.assertEqual(u, "https://www.facebook.com/tutustore/about")

    def test_follow_only_with_friends_tab_not_fallback_page(self):
        case = next(
            c for c in self.data["profiles"] if c["id"] == "profile_follow_only_with_friends_tab"
        )
        entity, reason, _ = _run_case(case)
        self.assertEqual(entity, "PROFILE")
        self.assertNotEqual(reason, "fallback_page_no_friend_signal")

    def test_known_limit_follow_only_reports_fallback(self):
        """Giới hạn đã biết — không tính PASS độ chính xác, chỉ kiểm tra hành vi hiện tại."""
        case = next(
            c for c in self.data["profiles"] if c["id"] == "profile_follow_only_no_friend_signal"
        )
        entity, reason, debug = _run_case(case)
        self.assertTrue(case.get("known_limitation"))
        self.assertEqual(entity, "PAGE")
        self.assertEqual(reason, "fallback_page_no_friend_signal")
        self.assertTrue(debug.get("fallback"))

    def test_should_open_about_only_when_missing_signals(self):
        self.assertFalse(
            should_open_about(
                "UNKNOWN",
                header_text="Shop\n12N người theo dõi",
                header_buttons=["Theo dõi"],
                header_tabs=[],
            )
        )
        self.assertFalse(
            should_open_about(
                "UNKNOWN",
                header_text="User",
                header_buttons=["Thêm bạn bè"],
                header_tabs=[],
            )
        )
        self.assertTrue(
            should_open_about(
                "UNKNOWN",
                header_text="Empty header name only",
                header_buttons=[],
                header_tabs=[],
            )
        )
        self.assertFalse(should_open_about("PAGE", header_text="", header_buttons=[], header_tabs=[]))

    def test_author_cache_reuse(self):
        from modules.module_11_page_scanner.scanner import _cache_lookup, _cache_store

        cache: dict = {}
        cleaned = "https://www.facebook.com/tutustore"
        result = {
            "page_key": "user:tutustore",
            "page_name": "TuTu Store",
            "classify_reason": "h1_page_category",
        }
        _cache_store(cache, cleaned, result)
        hit = _cache_lookup(cache, cleaned)
        self.assertIsNotNone(hit)
        self.assertEqual(hit["page_key"], "user:tutustore")
        hit2 = _cache_lookup(cache, "https://www.facebook.com/tutustore")
        self.assertEqual(hit2["page_name"], "TuTu Store")


if __name__ == "__main__":
    unittest.main()
