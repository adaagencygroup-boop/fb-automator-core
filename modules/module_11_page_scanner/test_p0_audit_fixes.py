"""
Unit tests cho Đợt 1 (Nhóm A + Nhóm B) — Module 11 Page Scanner.
Chạy thuần bộ nhớ, KHÔNG ghi DB, KHÔNG mở Chrome.
"""
from __future__ import annotations

import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from modules.module_11_page_scanner.browser_session import (
    AccountBusyError,
    _ACCOUNT_ACTIVE_JOBS,
    _ACCOUNT_JOB_LOCK,
    get_uids_for_sessions,
    release_account_job,
    try_acquire_account_job,
)
from modules.module_11_page_scanner.page_detail_scan import (
    _clean_labeled_website,
    _valid_address,
    clean_category,
    extract_category,
    extract_contact_info,
    intro_text,
    merge_contacts,
    resolve_detail_final_status,
    trim_about_noise,
)
from modules.module_11_page_scanner.page_source import (
    parse_follower_count,
    parse_page_file_content,
)
from modules.module_11_page_scanner.scanner import (
    accounts_owner_for,
    resolve_hashtag_final_status,
)


class TestGroupAParsing(unittest.TestCase):
    def test_extract_category_new_layout_samples(self):
        samples = [
            (
                "Anh Tú",
                "Anh Tú\n2M followers • 59 following\nMessage\nFollow\nSearch\nFor work: 0915085893 - Mr. Beo\nArtist\n\n · \nanhtu305\n · \n091 508 58 93\nMore\nAll\nAbout",
                "Artist",
            ),
            (
                "KodeKloud",
                "KodeKloud\n158K followers • 3 following\nShop now\nMessage\nFollow\nKodeKloud helps students across the world.\nEducation website\nMore\nAll\nAbout",
                "Education website",
            ),
            (
                "Bluegym Hà Đông",
                "Bluegym Hà Đông\n10K followers • 3 following\nMessage\nFollow\nSearch\nTrung tâm thể hình fitness lớn nhất Hà Đông\nSports & Recreation Venue\n · \n098 752 33 11\nMore\nAll\nAbout",
                "Sports & Recreation Venue",
            ),
            (
                "FPT Shop (Fptshop.com.vn)",
                "Active status indicator\nFPT Shop (Fptshop.com.vn)\n2.8M followers • 17 following\nFollow\nSearch\nFanpage chính thức của FPT Shop\nMobile Phone Shop\n · \nfptshop.official\nMore\nAll\nAbout",
                "Mobile Phone Shop",
            ),
            (
                "Ninh Dương Lan Ngọc",
                "Ninh Dương Lan Ngọc\n6M followers • 32 following\nMessage\nFollow\nSearch\nLiên hệ hợp tác / For Business: duytuongle@gmail.com\nActor\n · \nninh.duong.lan.ngoc\nMore\nAll\nAbout\nPosts\nQuỳnh Trang\n · \nFollow",
                "Actor",
            ),
            (
                "FIFA World Cup",
                "FIFA World Cup\n79M followers • 296 following\nFollow\nSearch\n🏆 Follow #U17WC action in Qatar!\nSports\nFIFA World Cup\nLinks\nlink.me",
                "Sports",
            ),
            (
                "Học viện Kỹ thuật mật mã - KMA",
                "Học viện Kỹ thuật mật mã - KMA\n53K followers • 7 following\nBook now\nFollow\nSearch\nhttp://actvn.edu.vn\nCollege & university\n · $\nMore\nAll\nAbout",
                "College & university",
            ),
        ]
        for page_name, header, expected in samples:
            with self.subTest(page=page_name):
                self.assertEqual(extract_category(header, page_name=page_name), expected)

    def test_extract_category_legacy_and_rejects_commenter_trang(self):
        self.assertEqual(extract_category("ABC\nTrang · Dịch vụ làm đẹp\nPosts"), "Dịch vụ làm đẹp")
        self.assertIsNone(extract_category("Some Page\nPosts\nQuỳnh Trang\n · \nFollow"))
        self.assertIsNone(clean_category("Personal details"))
        self.assertIsNone(clean_category("Details"))
        self.assertIsNone(clean_category("Follow"))

    def test_valid_address_rejects_handles_and_reviews(self):
        self.assertIsNone(_valid_address("anhtu305"))
        self.assertIsNone(_valid_address("fptshop.official"))
        self.assertIsNone(
            _valid_address(
                "I was scared to trade, because I have been scammed many times, but I had to take one last chance because I heard Tiffany… See more"
            )
        )
        self.assertEqual(
            _valid_address("Ho Chi Minh City, Vietnam, 70000"),
            "Ho Chi Minh City, Vietnam, 70000",
        )
        self.assertEqual(
            _valid_address("Tầng 3 toà nhà Ellipse . Số 112 Trần Phú , Mộ Lao , Hà Đông , Hanoi, Vietnam, 10000"),
            "Tầng 3 toà nhà Ellipse . Số 112 Trần Phú , Mộ Lao , Hà Đông , Hanoi, Vietnam, 10000",
        )

    def test_contact_extraction_ignores_reviews_and_ig_handle(self):
        about_with_review = (
            "KodeKloud\nAbout\nIntro\nCategory\nDetails\nLinks\nContact info\n"
            "Bio\nKodeKloud helps students\n"
            "Reviews\nNot yet rated (0 reviews)\n"
            "NgangiYithemba Baba recommends KodeKloud.\n3y\n"
            "I was scared to trade, because I have been scammed many times, 123 Main St… See more\n"
        )
        res = extract_contact_info(trim_about_noise(about_with_review))
        self.assertIsNone(res["address"])

        # Contact info có handle IG 'anhtu305' không được đè địa chỉ thật ở Details
        contact_panel = [
            {"section": "contact", "row": 1, "text": "anhtu305", "href": "https://www.instagram.com/anhtu305"},
            {"section": "contact", "row": 2, "text": "091 508 58 93", "href": ""},
        ]
        header_panel = [
            {"section": "details", "row": 1, "text": "Ho Chi Minh City, Vietnam, 70000", "href": ""},
        ]
        merged = merge_contacts(
            extract_contact_info("Contact info\nanhtu305\n091 508 58 93", [], contact_panel),
            extract_contact_info(intro_text("Details\nHo Chi Minh City, Vietnam, 70000\nPosts\nKENH14.VN"), [], header_panel),
        )
        self.assertEqual(merged["address"], "Ho Chi Minh City, Vietnam, 70000")
        self.assertEqual(merged["phone"], "091 508 58 93")
        self.assertIsNone(merged["website"])

    def test_labeled_website_accepts_social_with_path_and_rejects_bare_or_self(self):
        # Giống 100% DOM thật: có cả thanh tab đầu trang (All/About/Reels/Photos) lẫn khung About → Links
        links_tab_text = (
            "Anh Tú\n2M followers • 59 following\nAll\nAbout\nReels\nPhotos\nFollowers\nMore\n"
            "About\nIntro\nCategory\nDetails\nLinks\nContact info\nLinks\nfacebook.com/ats305\nWebsite\nReels\nAnh Tú's reels"
        )
        # Không truyền panel_items → kiểm chứng cả trim_about_noise lẫn nhãn Website thuần text
        res_text_only = extract_contact_info(
            trim_about_noise(links_tab_text),
            [],
            [],
            page_url="https://www.facebook.com/anhtusinger",
        )
        self.assertEqual(res_text_only["website"], "facebook.com/ats305")

        links_panel = [
            {"section": "links", "row": 1, "text": "facebook.com/ats305", "href": ""},
            {"section": "links", "row": 1, "text": "Website", "href": ""},
        ]
        res = extract_contact_info(
            trim_about_noise(links_tab_text),
            [],
            links_panel,
            page_url="https://www.facebook.com/anhtusinger",
        )
        self.assertEqual(res["website"], "facebook.com/ats305")

        # Chặn domain trần không có path (vd header "Links\nfacebook.com")
        self.assertIsNone(_clean_labeled_website("facebook.com", page_url="https://www.facebook.com/anhtusinger"))
        # Chặn tự trỏ chính Page đang quét
        self.assertIsNone(_clean_labeled_website("facebook.com/anhtusinger", page_url="https://www.facebook.com/anhtusinger"))
        # Chặn path nội bộ FB
        self.assertIsNone(_clean_labeled_website("facebook.com/about", page_url="https://www.facebook.com/anhtusinger"))
        # Chấp nhận social khác có path khi có nhãn Website
        self.assertEqual(_clean_labeled_website("instagram.com/anhtu305"), "instagram.com/anhtu305")
        # Link KHÔNG có nhãn Website (header chỉ có "Links\nfacebook.com/ats305") vẫn bị chặn để tránh rác
        unlabeled = extract_contact_info("Links\nfacebook.com/ats305\nContact info")
        self.assertIsNone(unlabeled["website"])

    def test_parse_page_file_content_uppercase_headers_and_url_keyword(self):
        csv_upper = "Name,URL\nLan Ngoc,https://www.facebook.com/fromninhduonglanngoc\nBlueGym,https://www.facebook.com/bluegymhd\n"
        r1 = parse_page_file_content(csv_upper)
        self.assertEqual(r1["valid_count"], 2)
        self.assertEqual([p["page_key"] for p in r1["pages"]], ["user:fromninhduonglanngoc", "user:bluegymhd"])

        csv_vn = "STT,Link Fanpage\n1,https://www.facebook.com/bluegymhd\n"
        r2 = parse_page_file_content(csv_vn)
        self.assertEqual(r2["valid_count"], 1)

        csv_semi = "STT;URL\n1;https://www.facebook.com/fromninhduonglanngoc\n"
        r3 = parse_page_file_content(csv_semi)
        self.assertEqual(r3["valid_count"], 1)

        # Dòng đầu là link có chứa chữ "url" nhưng KHÔNG phải header CSV
        no_header_url = "https://www.facebook.com/urlshortener,ghi chu\nhttps://www.facebook.com/bluegymhd,ghi chu 2\n"
        r4 = parse_page_file_content(no_header_url)
        self.assertEqual(r4["valid_count"], 2)

        # 1 cột có tiêu đề hoa
        one_col = "Link Fanpage\nhttps://www.facebook.com/bluegymhd\n"
        r5 = parse_page_file_content(one_col)
        self.assertEqual(r5["valid_count"], 1)
        self.assertEqual(r5["invalid_count"], 0)

    def test_parse_follower_count_truncates_text_to_100(self):
        long_text = "15K followers " + ("x" * 200)
        count, text = parse_follower_count(long_text)
        self.assertEqual(count, 15000)
        self.assertIsNotNone(text)
        self.assertLessEqual(len(text), 100)


class TestGroupBLocksAndOwners(unittest.TestCase):
    def tearDown(self):
        with _ACCOUNT_JOB_LOCK:
            _ACCOUNT_ACTIVE_JOBS.pop("test_uid_race", None)
            _ACCOUNT_ACTIVE_JOBS.pop("test_uid_rot", None)

    def test_try_acquire_account_job_startup_grace_prevents_race(self):
        # Giả lập DB không báo terminal status và chưa có worker thread start()
        with patch("core.database.db.fetch_one", return_value={"status": "RUNNING"}):
            try_acquire_account_job("test_uid_race", 999001, "DETAIL")
            with self.assertRaises(AccountBusyError):
                try_acquire_account_job("test_uid_race", 999002, "FOLLOW")
            self.assertEqual(get_uids_for_sessions([999001]), {"test_uid_race"})
            release_account_job("test_uid_race", 999001)
            self.assertEqual(get_uids_for_sessions([999001]), set())

    def test_accounts_owner_for_normalizes_system_and_none(self):
        self.assertIsNone(accounts_owner_for("system"))
        self.assertIsNone(accounts_owner_for(""))
        self.assertIsNone(accounts_owner_for(None))
        self.assertEqual(accounts_owner_for("user@example.com"), "user@example.com")

    def test_partial_final_status_when_below_target(self):
        # Hashtag: 21/30 Page phải đánh PARTIAL dù dừng vì NO_NEW_RESULTS / CYCLE_DETECTED / END_MARKER / SAFETY_LIMIT
        for reason in ("NO_NEW_RESULTS", "CYCLE_DETECTED", "END_MARKER", "SAFETY_LIMIT", "TIMEOUT", "CHECKPOINT"):
            with self.subTest(reason=reason):
                self.assertEqual(resolve_hashtag_final_status(reason, 21, 30), "PARTIAL")
        self.assertEqual(resolve_hashtag_final_status("TARGET_REACHED", 30, 30), "COMPLETED")
        self.assertEqual(resolve_hashtag_final_status("NO_NEW_RESULTS", 30, 30), "COMPLETED")
        self.assertEqual(resolve_hashtag_final_status("USER_STOPPED", 21, 30), "STOPPED")
        self.assertEqual(resolve_hashtag_final_status("ERROR", 0, 30), "FAILED")

        # Detail (Nhập link / Tải tệp): lưu thiếu mục tiêu → PARTIAL
        self.assertEqual(resolve_detail_final_status("COMPLETED", 21, 30), "PARTIAL")
        self.assertEqual(resolve_detail_final_status("NO_NEW_RESULTS", 0, 30), "PARTIAL")
        self.assertEqual(resolve_detail_final_status("TARGET_REACHED", 30, 30), "COMPLETED")
        self.assertEqual(resolve_detail_final_status("CHECKPOINT", 15, 30), "PARTIAL")
        self.assertEqual(resolve_detail_final_status("USER_STOPPED", 10, 30), "STOPPED")
        self.assertEqual(resolve_detail_final_status("ERROR", 0, 30), "FAILED")


if __name__ == "__main__":
    unittest.main()
