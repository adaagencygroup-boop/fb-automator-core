"""Offline tests: tách SĐT / Email / Website / Địa chỉ từ trang About (job DETAIL) + endpoint."""
from __future__ import annotations

import asyncio
import importlib
import unittest
from unittest import mock

from fastapi import HTTPException

from modules.module_11_page_scanner.page_detail_scan import (
    _normalize_pages,
    about_contact_url,
    clean_category,
    extract_category,
    extract_contact_info,
    extract_followers,
    find_phone,
    find_tab_link,
    first_text_line,
    intro_text,
    merge_contacts,
    page_tab_url,
    unwrap_facebook_redirect,
)

# Text thật (rút gọn) từ Page kiểu mới — logs/page_detail_debug/user_runningmanvnchayngaydi.txt
NEW_LAYOUT_HEADER = """Running Man Việt Nam Chạy Ngay Đi
696K followers • 15 following
Subscribe
Message
Follow
Official fanpage of Running Man Vietnam - Chạy Ngay Đi
Produced by Forest Studio & SBS TV (Prism Studio).

Sponsors & Partnership Contact: partnership@forest-studio.vn
Arts & entertainment
More
All
About
Reels
Photos
Followers
More
Details
146 đường B2, phường An Khánh, Ho Chi Minh City, Vietnam
Ho Chi Minh City, Vietnam
Links
forest-studio.vn
Featured
Running Man Việt Nam Chạy Ngay Đi
Liên hệ quảng cáo 0909 999 999 ở bài đăng
Posts
"""

NEW_LAYOUT_ABOUT = """Running Man Việt Nam Chạy Ngay Đi
696K followers • 15 following
Arts & entertainment
About
Intro
Category
Details
Links
Contact info
Bio
Official fanpage of Running Man Vietnam - Chạy Ngay Đi
Sponsors & Partnership Contact: partnership@forest-studio.vn
"""

router = importlib.import_module("modules.module_11_page_scanner.api.router")

ABOUT_LABELED = """Giới thiệu
Thông tin liên hệ
Quận 1, TP. Hồ Chí Minh, Việt Nam
Địa chỉ
0982 114 882
Di động
contact@innisfree.com.vn
Email
innisfree.vn
Trang web
Hạng mục
Sức khỏe/Sắc đẹp
"""

ABOUT_ENGLISH = """Contact info
Cau Giay, Ha Noi, Vietnam
Address
+84 944 328 999
Mobile
cskh@biluxury.vn
Email
"""


class TestExtractContactInfo(unittest.TestCase):
    def test_labeled_vietnamese_layout(self):
        info = extract_contact_info(ABOUT_LABELED)
        self.assertEqual(info["phone"], "0982 114 882")
        self.assertEqual(info["email"], "contact@innisfree.com.vn")
        self.assertEqual(info["website"], "innisfree.vn")
        self.assertEqual(info["address"], "Quận 1, TP. Hồ Chí Minh, Việt Nam")

    def test_labeled_english_layout(self):
        info = extract_contact_info(ABOUT_ENGLISH)
        self.assertEqual(info["phone"], "+84 944 328 999")
        self.assertEqual(info["email"], "cskh@biluxury.vn")
        self.assertEqual(info["address"], "Cau Giay, Ha Noi, Vietnam")
        self.assertIsNone(info["website"])

    def test_links_take_priority(self):
        links = [
            {"href": "tel:+84912000123"},
            {"href": "mailto:info@organicclinic.vn"},
            {"href": "https://l.facebook.com/l.php?u=https%3A%2F%2Forganicclinic.vn%2F%3Ffbclid%3Dabc&h=x"},
        ]
        info = extract_contact_info("Organic Cosmetic Spa", links)
        self.assertEqual(info["phone"], "+84912000123")
        self.assertEqual(info["email"], "info@organicclinic.vn")
        self.assertEqual(info["website"], "https://organicclinic.vn")

    def test_social_links_are_not_website(self):
        links = [{"href": "https://l.facebook.com/l.php?u=https%3A%2F%2Finstagram.com%2Fshop"}]
        info = extract_contact_info("instagram.com/shop\nfacebook.com/shop", links)
        self.assertIsNone(info["website"])

    def test_numbers_and_follower_counts_not_taken(self):
        text = "12.000\n4.9\n1.234.567 người theo dõi\nPage.Transparency"
        info = extract_contact_info(text)
        self.assertIsNone(info["phone"])
        self.assertIsNone(info["website"])
        self.assertIsNone(info["address"])

    def test_empty(self):
        self.assertEqual(
            extract_contact_info(""),
            {"phone": None, "email": None, "website": None, "address": None},
        )


class TestNewPageLayout(unittest.TestCase):
    def test_intro_column_sections(self):
        info = extract_contact_info(intro_text(NEW_LAYOUT_HEADER))
        self.assertEqual(info["address"], "146 đường B2, phường An Khánh, Ho Chi Minh City, Vietnam")
        self.assertEqual(info["website"], "forest-studio.vn")
        self.assertEqual(info["email"], "partnership@forest-studio.vn")
        # SĐT nằm trong bài đăng (sau "Featured") → không lấy
        self.assertIsNone(info["phone"])

    def test_page_name_is_not_address(self):
        info = extract_contact_info(NEW_LAYOUT_ABOUT)
        self.assertIsNone(info["address"])
        self.assertEqual(info["email"], "partnership@forest-studio.vn")

    def test_name_from_first_line(self):
        self.assertEqual(first_text_line(NEW_LAYOUT_HEADER), "Running Man Việt Nam Chạy Ngay Đi")
        self.assertIsNone(first_text_line("696K followers\nAbc"))

    def test_category_rejects_tab_labels(self):
        self.assertIsNone(clean_category("Details"))
        self.assertEqual(clean_category("Arts & entertainment"), "Arts & entertainment")

    def test_tab_links(self):
        links = [
            {"href": "https://www.facebook.com/runningmanvnchayngaydi/directory_links"},
            {"href": "/runningmanvnchayngaydi/directory_contact_info"},
        ]
        self.assertEqual(
            find_tab_link(links, "directory_contact_info"),
            "https://www.facebook.com/runningmanvnchayngaydi/directory_contact_info",
        )
        self.assertIsNone(find_tab_link(links, "directory_basic_info"))
        self.assertEqual(
            page_tab_url("https://www.facebook.com/profile.php?id=1&sk=about", "directory_links"),
            "https://www.facebook.com/profile.php?id=1&sk=directory_links",
        )

    def test_merge_priority(self):
        merged = merge_contacts({"phone": "0901", "email": None}, {"phone": "0902", "email": "a@b.vn"})
        self.assertEqual(merged["phone"], "0901")
        self.assertEqual(merged["email"], "a@b.vn")


class TestSessionCookie(unittest.TestCase):
    def test_has_session_cookie(self):
        from modules.module_11_page_scanner.page_detail_scan import has_session_cookie

        driver = mock.MagicMock()
        driver.get_cookie.return_value = {"name": "c_user", "value": "100"}
        self.assertTrue(has_session_cookie(driver))
        driver.get_cookie.return_value = None
        self.assertFalse(has_session_cookie(driver))
        driver.get_cookie.side_effect = RuntimeError("tab closed")
        self.assertTrue(has_session_cookie(driver))


class TestHelpers(unittest.TestCase):
    def test_phone_followed_by_punctuation(self):
        self.assertEqual(find_phone("Gọi ngay 0904.551.789."), "0904.551.789")
        self.assertEqual(find_phone("Hotline 1900 6750, hỗ trợ 24/7"), "1900 6750")
        self.assertIsNone(find_phone("ID 100083456789012"))

    def test_unwrap_redirect(self):
        self.assertEqual(
            unwrap_facebook_redirect("https://l.facebook.com/l.php?u=https%3A%2F%2Flockncare.com%2F&h=AT0"),
            "https://lockncare.com/",
        )
        self.assertEqual(unwrap_facebook_redirect("https://shop.vn/?a=1&fbclid=xyz"), "https://shop.vn/?a=1")

    def test_followers_and_category(self):
        header = "Biluxury - Thời Trang Nam\n12 N lượt thích • 318 N người theo dõi\nTrang · Cửa hàng quần áo"
        count, text = extract_followers(header)
        self.assertEqual(count, 318_000)
        self.assertEqual(text, "318 N người theo dõi")
        self.assertEqual(extract_category(header), "Cửa hàng quần áo")
        self.assertEqual(extract_followers("không có số"), (None, None))

    def test_about_contact_url(self):
        self.assertEqual(
            about_contact_url("https://www.facebook.com/biluxuryvn"),
            "https://www.facebook.com/biluxuryvn/about_contact_and_basic_info",
        )
        self.assertEqual(
            about_contact_url("https://www.facebook.com/profile.php?id=123"),
            "https://www.facebook.com/profile.php?id=123&sk=about_contact_and_basic_info",
        )

    def test_normalize_pages_dedup_and_url_fallback(self):
        pages = _normalize_pages([
            {"page_key": "user:biluxuryvn", "page_url": ""},
            {"page_key": "user:biluxuryvn", "page_url": "https://www.facebook.com/biluxuryvn"},
            {"page_key": "", "page_url": "x"},
            {"page_key": "id:123"},
        ])
        self.assertEqual(
            pages,
            [
                {"page_key": "user:biluxuryvn", "page_url": "https://www.facebook.com/biluxuryvn"},
                {"page_key": "id:123", "page_url": "https://www.facebook.com/profile.php?id=123"},
            ],
        )


class TestDetailEndpoint(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(router, "_get_owner", return_value="42")
        p.start()
        self.addCleanup(p.stop)

    def _payload(self, **kw):
        base = {"pages": [{"page_key": "user:abc", "page_url": "https://www.facebook.com/abc"}]}
        base.update(kw)
        return router.DetailSessionInput(**base)

    def test_starts_background_session(self):
        with mock.patch.object(router, "start_page_detail_background", return_value=(7, 1)) as start:
            res = asyncio.run(router.create_detail_scan_session(self._payload(min_followers=1000)))
        self.assertEqual(res["session_id"], 7)
        self.assertEqual(res["job_type"], "DETAIL")
        kwargs = start.call_args.kwargs
        self.assertEqual(kwargs["owner_key"], "42")
        self.assertEqual(kwargs["min_followers"], 1000)
        self.assertEqual(kwargs["pages"], [{"page_key": "user:abc", "page_url": "https://www.facebook.com/abc"}])

    def test_busy_account_returns_409(self):
        busy = router.AccountBusyError("100", 5, "FOLLOW")
        with mock.patch.object(router, "start_page_detail_background", side_effect=busy):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(router.create_detail_scan_session(self._payload()))
        self.assertEqual(ctx.exception.status_code, 409)

    def test_invalid_account_returns_422(self):
        with mock.patch.object(router, "start_page_detail_background", side_effect=ValueError("acc lỗi")):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(router.create_detail_scan_session(self._payload()))
        self.assertEqual(ctx.exception.status_code, 422)

    def test_detail_job_restorable(self):
        self.assertIn("DETAIL", router.ACTIVE_JOB_TYPES)


if __name__ == "__main__":
    unittest.main()
