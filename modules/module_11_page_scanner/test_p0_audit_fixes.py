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
    _clean_address_line,
    _clean_labeled_website,
    _valid_address,
    clean_category,
    extract_category,
    extract_contact_info,
    find_phone,
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
        # Các mẫu rác thật từ DB phải bị chặn
        for garbage, pname in (
            ("Sinh tồn lương 5tr", "Sinh tồn lương 5tr"),
            ("heybesties1201", "HiBesties"),
            ("HiBesties", "HiBesties"),
            ("trường utt rất quy mô và hoành tráng, rất là tuyệt vời ạ", "Đại học Công nghệ Giao thông vận tải"),
            ("0 comments", None),
            ("1 comment", None),
            ("Mở cửa 7 ngày trong tuần", None),
        ):
            with self.subTest(garbage=garbage):
                self.assertIsNone(_clean_address_line(garbage, page_name=pname, require_hint=True))

        # Mô phỏng Contact info có dòng Messenger = tên Page chứa số ("Sinh tồn lương 5tr")
        contact_text = "Contact info\n0868 236 823\nsale@mevinetwork.com\nSinh tồn lương 5tr"
        res = extract_contact_info(contact_text, page_name="Sinh tồn lương 5tr")
        self.assertEqual(res["phone"], "0868 236 823")
        self.assertIsNone(res["address"])

        # Toàn bộ mẫu địa chỉ thật lấy từ DB phải vượt qua 100%
        real_addresses = [
            "Ho Chi Minh City, Vietnam, 70000",
            "Đường Nguyễn Văn Trác, phường Yên Nghĩa, quận Hà Đông, Hanoi, Vietnam",
            "Cầu Giấy, Hanoi, Vietnam",
            "Số 29A, ngõ 124 phố Vĩnh Tuy, phường Vĩnh Hưng, Hanoi, Vietnam, 100000",
            "số 41A Đường Phú Diễn, Phường Phú Diễn, Hanoi, Vietnam",
            "Hanoi, Vietnam",
            "298 Cầu Diễn Minh Khai Bắc Từ Liêm Hà Nội, Hanoi, Vietnam, 84",
            "Toà nhà A2, số 298, đường Cầu Diễn, phường Minh Khai, thành phố Hà Nội, Hanoi, Vietnam",
            "Trụ sở chính: Số 22A/25 ngõ 629 Kim Mã, 100000",
            "Quận Ba Đình, Hanoi",
            "Tầng 3 toà nhà Ellipse . Số 112 Trần Phú , Mộ Lao , Hà Đông , Hanoi, Vietnam, 10000",
            "56 CMT8, Phường Long Khánh, Đồng Nai, Long Khanh, Vietnam",
            "194 Phạm Cự Lượng, Phường An Hải, TP Đà Nẵng, Da Nang, Vietnam",
            "141 Chiến Thắng - Phường Thanh Liệt - TP. Hà Nội, Thanh Tri, Vietnam, 7000",
            "22 Cao Xuân Huy, Mỹ Đình 2, Nam Từ Liêm, Hanoi, Vietnam, 11309",
            "Hà Nội, 100000",
            "146 đường B2, phường An Khánh, Ho Chi Minh City, Vietnam",
            "Lives in Ho Chi Minh City, Vietnam",
        ]
        for addr in real_addresses:
            with self.subTest(real_address=addr):
                self.assertEqual(_clean_address_line(addr, require_hint=True), addr)

    def test_find_phone_strict_vn_and_international_plus(self):
        # SĐT thật VN + quốc tế có '+'
        valid_cases = [
            ("Hotline: 091 508 58 93", "091 508 58 93"),
            ("Liên hệ 0868 236 823", "0868 236 823"),
            ("Tel: 024 3552 6713", "024 3552 6713"),
            ("SĐT: 028 7307 7807", "028 7307 7807"),
            ("CSKH 1800 6601", "1800 6601"),
            ("Tổng đài 1900 633695", "1900 633695"),
            ("Call +84 912 345 678", "+84 912 345 678"),
            ("US Office: +1 415 555 2671", "+1 415 555 2671"),
        ]
        for text, expected in valid_cases:
            with self.subTest(valid_phone=text):
                self.assertEqual(find_phone(text), expected)

        # Mã số thuế, STK, đầu 01 cũ, URL ID phải bị loại
        invalid_cases = [
            "MST: 0101234567",
            "Mã số thuế: 0312345678",
            "STK: 0912345678",
            "Số tài khoản: 001100123456",
            "0123456789",
            "https://facebook.com/0912345678",
            "id=0912345678",
        ]
        for text in invalid_cases:
            with self.subTest(invalid_phone=text):
                self.assertIsNone(find_phone(text))

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


class TestHashtagDetailSync(unittest.TestCase):
    def test_read_detail_in_verify_tab_matches_paste_link_for_viettel_digital(self):
        import threading
        import time
        from unittest.mock import MagicMock
        from modules.module_11_page_scanner.scanner import _read_detail_in_verify_tab

        main_header = (
            "Viettel Digital\n"
            "13K followers • 15 following\n"
            "Message\nFollow\nSearch\n"
            "Tổng Công ty Dịch vụ số Viettel hoạt động chuyên nghiệp trong lĩnh vực Fintech và Big Data.\n"
            "Information Technology Company\n"
            " · $$\n"
            "More\nAll\nAbout\nReels\nPhotos\nFollowers\nMore\n"
            "Details\n1 review\n$$\nClosing Soon\n"
            "Keangnam Hanoi Landmark Tower, Phạm Hùng, Mễ Trì, Nam Từ Liêm, Hanoi, Vietnam, 10000\n"
            "Links\nviettel.vn\nFeatured\n"
        )
        main_links = [
            {"href": "https://l.facebook.com/l.php?u=https%3A%2F%2F360vds.viettel.vn%2F", "text": "viettel.vn"},
        ]
        main_panel = [
            {"section": "details", "heading": "Details", "text": "1 review", "href": "", "icon": "", "row": 1},
            {"section": "details", "heading": "Details", "text": "$$", "href": "", "icon": "", "row": 1},
            {"section": "details", "heading": "Details", "text": "Closing Soon", "href": "", "icon": "", "row": 1},
            {
                "section": "details",
                "heading": "Details",
                "text": "Keangnam Hanoi Landmark Tower, Phạm Hùng, Mễ Trì, Nam Từ Liêm, Hanoi, Vietnam, 10000",
                "href": "",
                "icon": "",
                "row": 1,
            },
            {
                "section": "links",
                "heading": "Links",
                "text": "viettel.vn",
                "href": "https://l.facebook.com/l.php?u=https%3A%2F%2F360vds.viettel.vn%2F",
                "icon": "",
                "row": 2,
            },
        ]
        about_page = {
            "about_text": (
                "About\nIntro\nCategory\nDetails\nLinks\nContact info\n"
                "Bio\nTổng Công ty Dịch vụ số Viettel.\n"
            ),
            "links": [
                {"href": "https://www.facebook.com/ViettelDigitalFinance/directory_contact_info", "text": "Contact info"},
                {"href": "https://www.facebook.com/ViettelDigitalFinance/directory_links", "text": "Links"},
            ],
            "panel_items": [],
            "current_url": "https://www.facebook.com/ViettelDigitalFinance/about",
        }
        contact_page = {
            "about_text": (
                "About\nIntro\nCategory\nDetails\nLinks\nContact info\n"
                "Phone\n024 6656 6595\nMobile\n"
                "Email\ntuyendung.digital@viettel.com.vn\nEmail\n"
                "Messenger\nViettel Digital\n"
            ),
            "links": [
                {"href": "https://www.facebook.com/messages/t/ViettelDigitalFinance/", "text": "Viettel Digital"},
            ],
            "panel_items": [],
            "current_url": "https://www.facebook.com/ViettelDigitalFinance/directory_contact_info",
        }

        driver = MagicMock()

        def fake_exec(script, *_args):
            # Panel state JS (poll nhiều lần) / header JS (bọc JSON) — trả theo loại script, không theo số lần gọi
            if "doClick" in script:
                return {"has": False, "any": True, "headings": ["details", "links"], "clicked": False}
            return {"header_text": main_header, "links": main_links, "panel_items": main_panel}

        driver.execute_script.side_effect = fake_exec

        def fake_read_about(_drv, url, _ev):
            if "directory_contact_info" in url:
                return contact_page
            return about_page

        with patch("modules.module_11_page_scanner.page_detail_scan._read_about", side_effect=fake_read_about), \
             patch("modules.module_11_page_scanner.page_detail_scan.dump_debug_text", return_value=None):
            res = _read_detail_in_verify_tab(
                driver,
                "https://www.facebook.com/ViettelDigitalFinance",
                "Viettel Digital",
                "user:vietteldigitalfinance",
                time.time() + 10.0,
                stop_event=threading.Event(),
            )

        self.assertEqual(res["detail_status"], "SCANNED")
        self.assertEqual(res["category"], "Information Technology Company")
        self.assertEqual(res["phone"], "024 6656 6595")
        self.assertEqual(res["email"], "tuyendung.digital@viettel.com.vn")
        self.assertEqual(res["website"], "https://360vds.viettel.vn/")
        self.assertEqual(
            res["address"],
            "Keangnam Hanoi Landmark Tower, Phạm Hùng, Mễ Trì, Nam Từ Liêm, Hanoi, Vietnam, 10000",
        )

    def test_read_detail_in_verify_tab_keeps_not_scanned_when_empty(self):
        import threading
        import time
        from unittest.mock import MagicMock
        from modules.module_11_page_scanner.scanner import _read_detail_in_verify_tab

        driver = MagicMock()
        driver.execute_script.side_effect = [
            {"has": False, "any": False, "headings": [], "clicked": False},
            {"has": False, "any": False, "headings": [], "clicked": False},
            {"has": False, "any": False, "headings": [], "clicked": False},
            {"header_text": "", "links": [], "panel_items": []},
        ]
        with patch("modules.module_11_page_scanner.page_detail_scan._read_about", return_value={}), \
             patch("modules.module_11_page_scanner.scanner.time.sleep", return_value=None):
            res = _read_detail_in_verify_tab(
                driver,
                "https://www.facebook.com/EmptyPage",
                "EmptyPage",
                "user:emptypage",
                time.time() + 0.5,
                stop_event=threading.Event(),
            )
        self.assertEqual(res["detail_status"], "NOT_SCANNED")

    def test_fetch_about_text_rejects_tab_label_details_as_category(self):
        import time
        from unittest.mock import MagicMock
        from modules.module_11_page_scanner.scanner import _fetch_about_text

        driver = MagicMock()
        driver.execute_script.side_effect = [
            None,  # _window_stop
            {"about_text": "Category\nDetails\nLinks\nContact info", "category": "Details"},
        ]
        with patch("modules.module_11_page_scanner.scanner.time.sleep", return_value=None):
            res = _fetch_about_text(driver, "https://www.facebook.com/Rikkeisoftcareers", time.time() + 5.0)
        self.assertEqual(res.get("category"), "")

    def test_verify_skips_detail_below_min_followers_and_runs_above(self):
        from unittest.mock import MagicMock
        from modules.module_11_page_scanner import scanner

        def _run_with(follower_text: str, min_followers: int):
            driver = MagicMock()
            driver.current_window_handle = "main_h"
            driver.window_handles = ["main_h", "new_h"]
            header_info = {
                "page_name": "Viettel Digital",
                "page_url": "https://www.facebook.com/ViettelDigitalFinance",
                "header_text": f"Viettel Digital {follower_text}",
                "header_buttons": ["Message", "Follow"],
                "header_tabs": ["All", "About"],
                "follower_text": follower_text,
                "category": "",
                "phone": None,
                "main_sample": "",
                "is_verified": True,
                "avatar_url": "https://scontent.xx.fbcdn.net/v/t39.30808-1/av.jpg",
                "h1_matched_author": True,
                "readyState": "interactive",
                "spinner": False,
                "header_container_selector": "main",
                "all_h1s": [],
            }
            detail_mock = MagicMock(return_value={
                "category": "Information Technology Company",
                "phone": "024 6656 6595",
                "email": "tuyendung.digital@viettel.com.vn",
                "website": "https://360vds.viettel.vn/",
                "address": "Keangnam Hanoi Landmark Tower, Hanoi, Vietnam",
                "description": None,
                "detail_status": "SCANNED",
                "detail_scanned_at": "2026-11-27 10:00:00",
            })
            with patch.object(scanner, "_open_and_switch_verify_tab", return_value=("new_h", "https://www.facebook.com/ViettelDigitalFinance", {"reason": "ok", "cdp_blocked": True})), \
                 patch.object(scanner, "_wait_header_ready", return_value=header_info), \
                 patch.object(scanner, "_safe_current_url", return_value=("https://www.facebook.com/ViettelDigitalFinance", None)), \
                 patch.object(scanner, "is_valid_profile_header", return_value=(True, "ok")), \
                 patch.object(scanner, "classify_page_entity", return_value=("PAGE", "fallback_page_no_friend_signal", {})), \
                 patch.object(scanner, "_read_detail_in_verify_tab", detail_mock), \
                 patch.object(scanner, "_dump_classify_fixture", return_value=None), \
                 patch.object(scanner, "_window_stop", return_value=None), \
                 patch.object(scanner, "_cdp_unblock_resources", return_value=None):
                out = scanner.verify_and_extract_page_in_new_tab(
                    driver,
                    "https://www.facebook.com/ViettelDigitalFinance",
                    author_name="Viettel Digital",
                    min_followers=min_followers,
                )
            return out, detail_mock.call_count

        out_low, calls_low = _run_with("500 followers", 1000)
        self.assertEqual(calls_low, 0)
        self.assertEqual(out_low["detail_status"], "NOT_SCANNED")

        out_ok, calls_ok = _run_with("13K followers", 1000)
        self.assertEqual(calls_ok, 1)
        self.assertEqual(out_ok["detail_status"], "SCANNED")
        self.assertEqual(out_ok["category"], "Information Technology Company")
        self.assertEqual(out_ok["phone"], "024 6656 6595")
        self.assertEqual(out_ok["email"], "tuyendung.digital@viettel.com.vn")
        self.assertEqual(out_ok["website"], "https://360vds.viettel.vn/")


class TestListPagesFilterSql(unittest.TestCase):
    def test_region_regex_matches_vi_en_strict_word_boundary_and_no_old_province_merge(self):
        import re
        from modules.module_11_page_scanner.api.router import (
            _build_page_filter_sql,
            _fold_vi,
            _normalize_region_key,
        )

        def _norm_addr(addr: str) -> str:
            return re.sub(r"[.,/\\\-]+", " ", _fold_vi(addr))

        self.assertEqual(_normalize_region_key("TP. Hồ Chí Minh"), "ho chi minh")
        self.assertEqual(_normalize_region_key("Hà Nội"), "ha noi")
        self.assertEqual(_normalize_region_key("Đà Nẵng"), "da nang")
        self.assertEqual(_normalize_region_key("Huế"), "hue")
        self.assertEqual(_normalize_region_key("Đắk Lắk"), "dak lak")

        # TP. Hồ Chí Minh — khớp tên mới & tiếng Anh/viết tắt, KHÔNG gộp Bình Dương / Bà Rịa - Vũng Tàu
        conds_hcm, params_hcm = _build_page_filter_sql("sp", None, None, "TP. Hồ Chí Minh")
        self.assertEqual(len(conds_hcm), 1)
        pat_hcm = re.compile(params_hcm[0], re.IGNORECASE)
        for ok_addr in (
            "Ho Chi Minh City, Vietnam, 79000",
            "146 đường B2, phường An Khánh, Ho Chi Minh City, Vietnam",
            "244 Cong Quynh, Pham Ngu Lao, District 1, HCM City, 70000",
            "Quận 1, TP. Hồ Chí Minh",
            "TP.HCM, Việt Nam",
            "Saigon, Vietnam",
        ):
            self.assertRegex(_norm_addr(ok_addr), pat_hcm)
        for bad_addr in (
            "Hanoi, Vietnam, 10000",
            "Thủ Dầu Một, Bình Dương, Vietnam",
            "TP. Vũng Tàu, Bà Rịa - Vũng Tàu",
        ):
            self.assertNotRegex(_norm_addr(bad_addr), pat_hcm)

        # Hà Nội
        conds_hn, params_hn = _build_page_filter_sql("sp", None, None, "Hà Nội")
        pat_hn = re.compile(params_hn[0], re.IGNORECASE)
        for ok_addr in (
            "Hanoi, Vietnam, 10000",
            "Keangnam Hanoi Landmark Tower, Phạm Hùng, Hanoi, Vietnam",
            "Hà Nội, 100000",
            "Ha Noi, Vietnam",
        ):
            self.assertRegex(_norm_addr(ok_addr), pat_hn)
        self.assertNotRegex(_norm_addr("Ho Chi Minh City, Vietnam"), pat_hn)

        # Đà Nẵng — KHÔNG gộp Quảng Nam
        conds_dn, params_dn = _build_page_filter_sql("", None, None, "Đà Nẵng")
        pat_dn = re.compile(params_dn[0], re.IGNORECASE)
        self.assertRegex(_norm_addr("194 Phạm Cự Lượng, TP Đà Nẵng, Da Nang, Vietnam"), pat_dn)
        self.assertRegex(_norm_addr("Da Nang, Vietnam"), pat_dn)
        self.assertNotRegex(_norm_addr("Hội An, Quảng Nam, Vietnam"), pat_dn)

        # Huế — ranh giới từ nghiêm ngặt: KHÔNG khớp nhầm "Nhà Thuê" hay "Sông Nhuệ"
        _, params_hue = _build_page_filter_sql("sp", None, None, "Huế")
        pat_hue = re.compile(params_hue[0], re.IGNORECASE)
        self.assertRegex(_norm_addr("TP. Huế, Việt Nam"), pat_hue)
        self.assertRegex(_norm_addr("Hue, Vietnam"), pat_hue)
        self.assertNotRegex(_norm_addr("Quang Vĩ Nhà Thuê Hà Nội"), pat_hue)
        self.assertNotRegex(_norm_addr("Đường Sông Nhuệ, Hà Nội"), pat_hue)

        # Tỉnh khác trong 34 tỉnh/thành (Đắk Lắk, Bắc Ninh, Cần Thơ, Hải Phòng)
        _, params_dl = _build_page_filter_sql("sp", None, None, "Đắk Lắk")
        pat_dl = re.compile(params_dl[0], re.IGNORECASE)
        self.assertRegex(_norm_addr("Buôn Ma Thuột, Đắk Lắk"), pat_dl)
        self.assertRegex(_norm_addr("Dak Lak, Vietnam"), pat_dl)
        self.assertNotRegex(_norm_addr("Tuy Hòa, Phú Yên"), pat_dl)

        _, params_bn = _build_page_filter_sql("sp", None, None, "Bắc Ninh")
        pat_bn = re.compile(params_bn[0], re.IGNORECASE)
        self.assertRegex(_norm_addr("TP. Bắc Ninh, Vietnam"), pat_bn)
        self.assertRegex(_norm_addr("BacNinh, Vietnam"), pat_bn)
        self.assertNotRegex(_norm_addr("TP. Bắc Giang, Vietnam"), pat_bn)

        # NO_ADDRESS
        conds_no_addr, params_no_addr = _build_page_filter_sql("sp", None, None, "NO_ADDRESS")
        self.assertEqual(params_no_addr, [])
        self.assertIn("IS NULL", conds_no_addr[0])
        self.assertIn("sp.address", conds_no_addr[0])

    def test_keyword_diacritics_insensitive_and_all_info_filters(self):
        from modules.module_11_page_scanner.api.router import _build_page_filter_sql, _fold_vi

        self.assertEqual(_fold_vi("Bán Mình Cho Tư Bản"), "ban minh cho tu ban")

        conds, params = _build_page_filter_sql("sp", "024 6656 6595", "HAS_BOTH", "ALL")
        self.assertEqual(len(conds), 2)
        self.assertIn("TRANSLATE(LOWER(NORMALIZE(COALESCE(sp.page_key", conds[0])
        self.assertIn("REGEXP_REPLACE(COALESCE(sp.phone,''), '[^0-9+]', '', 'g') ILIKE %s", conds[0])
        self.assertIn("%02466566595%", params)
        self.assertIn("sp.phone", conds[1])
        self.assertIn("sp.email", conds[1])

        conds_kw, params_kw = _build_page_filter_sql("sp", "Bán Mình", "HAS_WEBSITE", "ALL")
        self.assertEqual(len(conds_kw), 2)
        self.assertTrue(all(p == "%ban minh%" for p in params_kw))
        self.assertIn("sp.website", conds_kw[1])

        conds_nc, params_nc = _build_page_filter_sql("sp", None, "NO_CONTACT", "ALL")
        self.assertEqual(params_nc, [])
        self.assertIn("sp.phone", conds_nc[0])
        self.assertIn("sp.email", conds_nc[0])
        self.assertEqual(conds_nc[0].count("IS NULL"), 2)


class TestVietnameseSessionLogs(unittest.TestCase):
    def test_follow_and_post_reason_formatters_have_no_raw_jargon(self):
        from modules.module_11_page_scanner.followers_scan import (
            REASON_CHECKPOINT,
            REASON_DIALOG_NOT_FOUND,
            REASON_LIST_EXHAUSTED,
            REASON_LIST_PRIVATE,
            REASON_PROFILE_PHP,
            _format_follow_reason_vi,
            _format_follow_stop_reason_vi,
        )
        from modules.module_11_page_scanner.posts_scan import _format_post_stop_reason_vi

        for r in (
            REASON_LIST_PRIVATE,
            REASON_DIALOG_NOT_FOUND,
            REASON_PROFILE_PHP,
            REASON_CHECKPOINT,
            "extract_empty",
            "scroll_stuck",
            "all_duplicates",
            REASON_LIST_EXHAUSTED,
        ):
            msg = _format_follow_reason_vi(r)
            self.assertTrue(msg)
            self.assertNotIn("_", msg)

        for sr in ("TARGET_REACHED", "COMPLETED", "NO_NEW_RESULTS", "USER_STOPPED", "CHECKPOINT", "TIMEOUT", "ERROR"):
            self.assertNotIn("_", _format_follow_stop_reason_vi(sr))
            self.assertNotIn("_", _format_post_stop_reason_vi(sr))


class TestPageListMove(unittest.TestCase):
    def _make_fake_db(self, *, categories, memberships, scanned_keys):
        from contextlib import contextmanager

        state = {
            "categories": {cid: dict(info) for cid, info in categories.items()},
            "memberships": {cid: set(keys) for cid, keys in memberships.items()},
            "scanned": set(scanned_keys),
            "deleted_queries": [],
        }

        class FakeCursor:
            def __init__(self):
                self._one = None
                self._all = []

            def execute(self, sql, params=()):
                s = " ".join(sql.split())
                if s.startswith("SELECT id, name FROM page_list_categories WHERE owner_key = %s AND id = %s"):
                    _, cid = params
                    cat = state["categories"].get(cid)
                    self._one = dict(cat) if cat else None
                elif "INSERT INTO page_list_category_pages" in s:
                    _, keys, dest_id, _ = params
                    found = [k for k in keys if k in state["scanned"]]
                    dest_set = state["memberships"].setdefault(dest_id, set())
                    added = 0
                    for k in found:
                        if k not in dest_set:
                            dest_set.add(k)
                            added += 1
                    self._one = {"found": len(found), "added": added}
                elif s.startswith("DELETE FROM page_list_category_pages"):
                    _, src_id, keys = params
                    state["deleted_queries"].append((src_id, list(keys)))
                    src_set = state["memberships"].setdefault(src_id, set())
                    removed = [k for k in keys if k in state["scanned"] and k in src_set]
                    for k in removed:
                        src_set.remove(k)
                    self._all = [{"page_key": k} for k in removed]
                elif s.startswith("UPDATE page_list_categories"):
                    (cid,) = params
                    cnt = len([k for k in state["memberships"].get(cid, set()) if k in state["scanned"]])
                    self._one = {"page_count": cnt}
                else:
                    raise AssertionError(f"Unexpected SQL: {s}")

            def fetchone(self):
                return self._one

            def fetchall(self):
                return self._all

        class FakeDB:
            @contextmanager
            def session(self_inner):
                yield FakeCursor()

        return FakeDB(), state

    def test_move_removes_only_from_source_category_and_keeps_other_categories(self):
        import importlib
        router_mod = importlib.import_module("modules.module_11_page_scanner.api.router")

        fake_db, state = self._make_fake_db(
            categories={1: {"id": 1, "name": "A"}, 2: {"id": 2, "name": "B"}, 3: {"id": 3, "name": "C"}},
            memberships={1: {"p1", "p2"}, 2: set(), 3: {"p1"}},
            scanned_keys={"p1", "p2"},
        )
        with patch.object(router_mod, "db", fake_db), patch.object(router_mod, "_get_owner", return_value="u1"):
            res = router_mod.save_pages_to_list(
                router_mod.PageListSaveInput(category_id=2, source_category_id=1, page_keys=["p1"])
            )

        self.assertEqual(state["memberships"][1], {"p2"})
        self.assertEqual(state["memberships"][2], {"p1"})
        self.assertEqual(state["memberships"][3], {"p1"})  # giữ nguyên danh mục C
        self.assertEqual(res["moved"], 1)
        self.assertEqual(res["added"], 1)
        self.assertEqual(res["source_category"]["page_count"], 1)
        self.assertEqual(res["category"]["page_count"], 1)
        self.assertIn("Đã chuyển 1 page từ «A» sang «B»", res["message"])

    def test_move_when_page_already_in_destination_still_removes_from_source(self):
        import importlib
        router_mod = importlib.import_module("modules.module_11_page_scanner.api.router")

        fake_db, state = self._make_fake_db(
            categories={1: {"id": 1, "name": "A"}, 2: {"id": 2, "name": "B"}},
            memberships={1: {"p1"}, 2: {"p1"}},
            scanned_keys={"p1"},
        )
        with patch.object(router_mod, "db", fake_db), patch.object(router_mod, "_get_owner", return_value="u1"):
            res = router_mod.save_pages_to_list(
                router_mod.PageListSaveInput(category_id=2, source_category_id=1, page_keys=["p1"])
            )

        self.assertEqual(state["memberships"][1], set())
        self.assertEqual(state["memberships"][2], {"p1"})
        self.assertEqual(res["moved"], 1)
        self.assertIn("Đã chuyển 1 page từ «A» sang «B»", res["message"])
        self.assertIn("1 page đã có sẵn ở «B»", res["message"])

    def test_move_to_same_category_raises_422_and_save_without_source_does_not_delete(self):
        import importlib
        from fastapi import HTTPException
        router_mod = importlib.import_module("modules.module_11_page_scanner.api.router")

        fake_db, state = self._make_fake_db(
            categories={1: {"id": 1, "name": "A"}, 2: {"id": 2, "name": "B"}},
            memberships={1: {"p1"}, 2: set()},
            scanned_keys={"p1"},
        )
        with patch.object(router_mod, "db", fake_db), patch.object(router_mod, "_get_owner", return_value="u1"):
            with self.assertRaises(HTTPException) as ctx:
                router_mod.save_pages_to_list(
                    router_mod.PageListSaveInput(category_id=1, source_category_id=1, page_keys=["p1"])
                )
            self.assertEqual(ctx.exception.status_code, 422)

            res = router_mod.save_pages_to_list(router_mod.PageListSaveInput(category_id=2, page_keys=["p1"]))
            self.assertEqual(state["deleted_queries"], [])
            self.assertEqual(state["memberships"][1], {"p1"})
            self.assertEqual(state["memberships"][2], {"p1"})
            self.assertIsNone(res["source_category"])
            self.assertEqual(res["moved"], 0)


if __name__ == "__main__":
    unittest.main()
