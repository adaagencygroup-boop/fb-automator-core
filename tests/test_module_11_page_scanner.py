"""
Unit tests for Module 11: Page Scanner URL standardization, dedup, and router.
"""
import unittest

from modules.module_11_page_scanner.page_source import (
    clean_page_url,
    extract_page_identifier,
    is_valid_page_entry,
    parse_follower_count,
    parse_page_file_content,
    get_sample_template,
)
from modules.module_11_page_scanner.api.router import router


class TestModule11PageSource(unittest.TestCase):
    def test_clean_page_url_and_subpaths(self):
        # 1. Bỏ query string và cắt subpaths (/about, /photos, ...)
        url1 = "https://www.facebook.com/innisfreevietnam/about?ref=bookmarks&mibextid=ZbWKwL"
        cleaned1 = clean_page_url(url1)
        self.assertEqual(cleaned1, "https://www.facebook.com/innisfreevietnam")

        # 2. profile.php?id=1098642819 giữ lại id, bỏ query rác
        url2 = "https://m.facebook.com/profile.php?id=1098642819&mibextid=LQQJ4d"
        cleaned2 = clean_page_url(url2)
        self.assertEqual(cleaned2, "https://www.facebook.com/profile.php?id=1098642819")

        # 3. /pages/Tên-Page/123456
        url3 = "https://www.facebook.com/pages/Gia-Dung-Thong-Minh/1098642820/"
        cleaned3 = clean_page_url(url3)
        self.assertEqual(cleaned3, "https://www.facebook.com/pages/1098642820")

    def test_extract_page_identifier_same_entity(self):
        # Ba dạng link khác nhau của cùng 1 page biluxuryvn
        u1 = "https://www.facebook.com/biluxuryvn"
        u2 = "https://m.facebook.com/biluxuryvn?ref=feed"
        u3 = "https://www.facebook.com/biluxuryvn/about#section"

        k1, q1 = extract_page_identifier(u1)
        k2, q2 = extract_page_identifier(u2)
        k3, q3 = extract_page_identifier(u3)

        self.assertEqual(k1, "user:biluxuryvn")
        self.assertEqual(k2, "user:biluxuryvn")
        self.assertEqual(k3, "user:biluxuryvn")
        self.assertEqual(q1, "high")

    def test_extract_numeric_id_identifier(self):
        u1 = "https://www.facebook.com/profile.php?id=100084729103941"
        k1, q1 = extract_page_identifier(u1)
        self.assertEqual(k1, "id:100084729103941")
        self.assertEqual(q1, "high")

        # Nhập thuần UID số
        k2, q2 = extract_page_identifier("100084729103941")
        self.assertEqual(k2, "id:100084729103941")

    def test_parse_follower_count(self):
        self.assertEqual(parse_follower_count("1,2 nghìn người theo dõi")[0], 1200)
        self.assertEqual(parse_follower_count("15K followers")[0], 15000)
        self.assertEqual(parse_follower_count("3,4 triệu người theo dõi")[0], 3400000)
        self.assertEqual(parse_follower_count("520 người theo dõi")[0], 520)
        self.assertIsNone(parse_follower_count("")[0])

    def test_parse_page_file_content_dedup_and_stats(self):
        # File gồm 5 dòng: 3 dòng trỏ về cùng 1 page, 1 page khác, 1 link rác
        raw_text = """
        https://www.facebook.com/biluxuryvn
        https://m.facebook.com/biluxuryvn?ref=share
        https://www.facebook.com/biluxuryvn/photos
        https://www.facebook.com/innisfreevietnam
        https://www.facebook.com/groups/123456789
        """
        res = parse_page_file_content(raw_text)
        self.assertEqual(res["total_lines"], 5)
        self.assertEqual(res["valid_count"], 2)  # biluxuryvn và innisfreevietnam
        self.assertEqual(res["dedup_count"], 2)  # 2 link trùng bị lọc
        self.assertEqual(res["invalid_count"], 1)  # link groups bị loại

        # Đối chiếu danh sách page_key duy nhất
        keys = [p["page_key"] for p in res["pages"]]
        self.assertIn("user:biluxuryvn", keys)
        self.assertIn("user:innisfreevietnam", keys)

    def test_is_valid_page_entry_rejection(self):
        self.assertFalse(is_valid_page_entry("https://www.facebook.com/search/pages/?q=ao_so_mi"))
        self.assertFalse(is_valid_page_entry("https://www.facebook.com/groups/congdongmarketing"))
        self.assertFalse(is_valid_page_entry("https://www.facebook.com/reel/123456789"))
        self.assertTrue(is_valid_page_entry("https://www.facebook.com/innisfreevietnam"))
        self.assertTrue(is_valid_page_entry("100084729103941"))

    def test_router_endpoints_registered(self):
        # Kiểm tra router Module 11 đã có đầy đủ các endpoints theo đặc tả Section 1.1
        paths = [route.path for route in router.routes]
        expected_endpoints = [
            "/api/page-scanner/source/search",
            "/api/page-scanner/source/parse",
            "/api/page-scanner/source/upload",
            "/api/page-scanner/source/template",
            "/api/page-scanner/source/hashtag-search",
            "/api/page-scanner/sessions",
            "/api/page-scanner/sessions/{session_id}",
            "/api/page-scanner/pages",
            "/api/page-scanner/sessions/{session_id}/stop",
        ]
        for ep in expected_endpoints:
            self.assertIn(ep, paths, f"Thiếu endpoint {ep} trong router Module 11")


class TestModule11HashtagScanner(unittest.TestCase):
    """Bộ kiểm thử cho Section 10: Tìm Page theo Hashtag (Section 10.8)."""

    def test_normalize_and_parse_hashtags(self):
        from modules.module_11_page_scanner.page_source import (
            normalize_hashtag,
            parse_hashtags_input,
        )
        self.assertEqual(normalize_hashtag("#thoitrang"), "thoitrang")
        self.assertEqual(normalize_hashtag("  #Thoi_Trang  "), "thoi_trang")
        # Giữ nguyên biến thể có dấu theo Section 10.2
        self.assertEqual(normalize_hashtag("#thờitrang"), "thờitrang")

        parsed = parse_hashtags_input("#thoitrang, #mypham thoitrang #phukien")
        self.assertEqual(parsed, ["thoitrang", "mypham", "phukien"])

    def test_classify_post_author_layers(self):
        from modules.module_11_page_scanner.page_source import classify_post_author

        # 1. Bài trong Group -> loại
        t1, _ = classify_post_author("User A", "https://www.facebook.com/groups/chotot/permalink/123", post_context="Đăng trong nhóm Chợ Tốt")
        self.assertEqual(t1, "GROUP")

        # 2. Tác giả có dấu hiệu Profile cá nhân (bạn bè) -> loại
        t2, _ = classify_post_author("Nguyen Van A", "https://www.facebook.com/nguyenvana", author_subtitle="5 bạn chung • Thêm bạn bè")
        self.assertEqual(t2, "PROFILE")

        # 3. Tác giả có dấu hiệu Fanpage (Người theo dõi / Trang) -> PAGE
        t3, _ = classify_post_author("Biluxury", "https://www.facebook.com/biluxuryvn", author_subtitle="Trang • 1,2 triệu người theo dõi")
        self.assertEqual(t3, "PAGE")

    def test_relevance_score_and_hard_gate(self):
        from modules.module_11_page_scanner.page_source import calculate_page_relevance_score

        # Case 1: Page có 1 bài gắn hashtag duy nhất, tên không liên quan -> bị loại bởi điều kiện cứng min_posts=2
        score1, status1, _ = calculate_page_relevance_score(
            hashtag_post_count=1,
            matched_hashtags=["thoitrang"],
            page_name="Quán Cà Phê Gió",
            min_posts=2,
        )
        self.assertEqual(status1, "EXCLUDED")

        # Case 2: Page có 1 bài nhưng tên Page chứa hashtag -> miễn điều kiện cứng
        score2, status2, _ = calculate_page_relevance_score(
            hashtag_post_count=1,
            matched_hashtags=["thoitrang"],
            page_name="Xưởng Thời Trang VN",
            min_posts=2,
        )
        self.assertIn(status2, ["RELEVANT", "REVIEW"])
        self.assertGreaterEqual(score2, 30)

        # Case 3: Page có 5 bài khớp, xuất hiện ở 2 hashtag -> đạt 'RELEVANT' (Liên quan)
        score3, status3, reasons3 = calculate_page_relevance_score(
            hashtag_post_count=5,
            matched_hashtags=["thoitrang", "mypham"],
            page_name="Shop Thời Trang Biluxury",
            context_keywords=["bán sỉ", "thời trang"],
            min_posts=2,
        )
        self.assertEqual(status3, "RELEVANT")
        self.assertGreaterEqual(score3, 60)


if __name__ == "__main__":
    unittest.main()

