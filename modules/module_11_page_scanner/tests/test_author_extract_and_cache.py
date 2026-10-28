"""Offline: link ngoài/l.php, Add Friend PROFILE, header_not_found, không cache soft-fail."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from modules.module_11_page_scanner.entity_classify import (
    classify_page_entity,
    is_valid_profile_header,
)
from modules.module_11_page_scanner.page_source import (
    author_name_looks_like_url,
    author_verify_cache_key,
    is_valid_author_candidate_url,
    purge_invalid_author_cache_keys,
)
from modules.module_11_page_scanner.scanner import _cache_lookup, _cache_store

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "classify_headers.json"


EXTERNAL_FIXTURES = [
    "https://bit.ly/KS_Dauanhthao",
    "https://l.facebook.com/l.php?u=https%3A%2F%2Fbit.ly%2FKS_Dauanhthao",
    "https://www.facebook.com/l.php?u=https%3A%2F%2Fbetumi.vn",
    "https://s.shopee.vn/8AWi0dSOKw",
    "https://s.shopee.vn/8V9YOR8CiT",
    "https://khosimyphamluy.com/",
    "https://Betumi.vn",
]


class TestExternalAuthorReject(unittest.TestCase):
    def test_external_and_lphp_rejected(self):
        for url in EXTERNAL_FIXTURES:
            with self.subTest(url=url):
                ok, _q, reason = is_valid_author_candidate_url(url)
                self.assertFalse(ok, f"must reject {url}, got ok reason={reason}")
                self.assertEqual(author_verify_cache_key(url), "")

    def test_urlish_author_names(self):
        self.assertTrue(author_name_looks_like_url("https://bit.ly/KS_Dauanhthao"))
        self.assertTrue(author_name_looks_like_url("Betumi.vn"))
        self.assertTrue(author_name_looks_like_url("s.shopee.vn/8AWi0dSOKw"))
        self.assertTrue(author_name_looks_like_url("khosimyphamluy.com"))
        self.assertFalse(author_name_looks_like_url("Innisfree Vietnam Store"))
        self.assertFalse(author_name_looks_like_url("Lê Thị Ánh Tuyết"))

    def test_valid_facebook_author_ok(self):
        ok, q, reason = is_valid_author_candidate_url("https://www.facebook.com/tuyets.anhs.3139")
        self.assertTrue(ok, reason)
        self.assertEqual(q, "high")
        ok2, _, r2 = is_valid_author_candidate_url(
            "https://www.facebook.com/profile.php?id=100078396304282"
        )
        self.assertTrue(ok2, r2)


class TestAddFriendProfileGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(FIXTURE_PATH, encoding="utf-8") as f:
            cls.data = json.load(f)

    def test_le_thi_anh_tuyet_is_profile_not_fallback(self):
        case = next(c for c in self.data["profiles"] if c["id"] == "le_thi_anh_tuyet")
        entity, reason, debug = classify_page_entity(
            url=case.get("url") or "",
            header_text=case.get("header_text") or "",
            header_buttons=case.get("header_buttons") or [],
            header_tabs=case.get("header_tabs") or [],
            about_text=case.get("about_text") or "",
        )
        self.assertEqual(entity, "PROFILE", f"got {entity}/{reason} debug={debug}")
        self.assertNotEqual(reason, "fallback_page_no_friend_signal")
        self.assertIn("friend_button", reason)
        self.assertNotEqual(debug.get("friend_signal_source"), "none")

    def test_real_pages_still_page(self):
        for pid in ("lem_beauty", "mam_cosmetics", "bong_beauty", "the_whoo", "hannaholala"):
            case = next(c for c in self.data["pages_extra"] if c["id"] == pid)
            with self.subTest(pid):
                entity, reason, _ = classify_page_entity(
                    url=case.get("url") or "",
                    header_text=case.get("header_text") or "",
                    header_buttons=case.get("header_buttons") or [],
                    header_tabs=case.get("header_tabs") or [],
                )
                self.assertEqual(entity, "PAGE", f"{pid} → {entity}/{reason}")


class TestHeaderValidity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(FIXTURE_PATH, encoding="utf-8") as f:
            cls.data = json.load(f)

    def test_post_containers_invalid(self):
        for case in self.data.get("invalid_headers") or []:
            with self.subTest(case["id"]):
                ok, why = is_valid_profile_header(
                    header_text=case.get("header_text") or "",
                    header_buttons=case.get("header_buttons") or [],
                    follower_text=case.get("follower_text") or "",
                    category=case.get("category") or "",
                    page_name=case.get("name") or "",
                )
                self.assertFalse(ok, f"{case['id']} should be invalid, why={why}")

    def test_shop_header_valid(self):
        case = self.data["shops"][0]
        ok, why = is_valid_profile_header(
            header_text=case.get("header_text") or "",
            header_buttons=case.get("header_buttons") or [],
            follower_text=case.get("follower_text") or "",
            page_name=case.get("name") or "",
        )
        self.assertTrue(ok, why)


class TestCacheNoSoftFail(unittest.TestCase):
    def test_soft_fail_not_cached(self):
        cache: dict = {}
        soft = {
            "_soft_fail": True,
            "reason": "unknown",
            "detail": "no_strong_signal",
        }
        _cache_store(cache, "https://www.facebook.com/ComboQuaTang", soft)
        self.assertEqual(cache, {})
        hit = _cache_lookup(cache, "https://www.facebook.com/ComboQuaTang")
        self.assertIsNone(hit)

    def test_header_not_found_not_cached(self):
        cache: dict = {}
        soft = {"_soft_fail": True, "reason": "header_not_found", "detail": "post_actions_menu"}
        _cache_store(cache, "https://www.facebook.com/MocBeautiful", soft)
        self.assertIsNone(_cache_lookup(cache, "https://www.facebook.com/MocBeautiful"))

    def test_page_and_profile_cached(self):
        cache: dict = {}
        page = {
            "page_key": "user:lembeauty",
            "page_name": "Lem Beauty",
            "classify_reason": "fallback_page_no_friend_signal",
        }
        _cache_store(cache, "https://www.facebook.com/lembeauty", page)
        hit = _cache_lookup(cache, "https://www.facebook.com/lembeauty")
        self.assertIsNotNone(hit)
        self.assertEqual(hit["page_key"], "user:lembeauty")

        profile = {
            "_verify_rejected": True,
            "reason": "profile:friend_button:Add Friend X",
        }
        _cache_store(cache, "https://www.facebook.com/tuyets.anhs.3139", profile)
        hit2 = _cache_lookup(cache, "https://www.facebook.com/tuyets.anhs.3139")
        self.assertIsNotNone(hit2)
        self.assertTrue(hit2.get("_verify_rejected"))

    def test_purge_lphp_keys(self):
        cache = {
            "https://www.facebook.com/l.php": {"_soft_fail": True},
            "user:l.php": {"page_key": "user:l.php"},
            "user:tutustore": {"page_key": "user:tutustore", "page_name": "TuTu"},
        }
        n = purge_invalid_author_cache_keys(cache)
        self.assertGreaterEqual(n, 2)
        self.assertIn("user:tutustore", cache)
        self.assertNotIn("user:l.php", cache)


if __name__ == "__main__":
    unittest.main()
