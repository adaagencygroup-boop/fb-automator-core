"""Chuẩn hóa link và lấy ID mục tiêu (normalize_target_url, extract_fb_id)."""
import unittest

from .helpers import R

# Các dạng link hay gặp (dùng chung cho test chuẩn hóa và test so sánh với giao diện)
SAMPLE_LINKS = [
    ("POST", "https://www.facebook.com/share/p/1AbCd2EfGh/"),
    ("POST", "m.facebook.com/share/p/1AbCd2EfGh?mibextid=xyz"),
    ("POST", "1HuNarJSLn"),
    ("POST", "100089123456_987654321"),
    ("POST", "https://web.facebook.com/permalink.php?story_fbid=pfbid0AAA111&id=100064"),
    ("POST", "https://www.facebook.com/QuanAP/posts/pfbid02abcDEF123?__cft__=x"),
    ("POST", "https://www.facebook.com/photo/?fbid=123456789&set=a.1"),
    ("POST", "https://www.facebook.com/reel/987654321"),
    ("POST", "https://web.facebook.com/groups/123/posts/456/"),
    ("POST", "https://www.facebook.com/watch/?v=555"),
    ("POST", "https://fb.watch/abcDEF/"),
    ("PAGE", "www.facebook.com/QuanAP/"),
    ("PAGE", "https://facebook.com/profile.php?id=100064&ref=bookmarks"),
    ("PAGE", "QuanAP"),
    ("PAGE", "https://www.facebook.com/p/Ten-Page-100064123/"),
    ("PROFILE", "100012345678"),
    ("PROFILE", "https://m.facebook.com/people/Nguyen-Van-A/100012345678/"),
    ("PROFILE", "https://www.facebook.com/dhn.integrity?mibextid=ZbWKwL"),
    ("PROFILE", "https://www.facebook.com/profile.php?id=100012345678&sk=about"),
]


class NormalizeUrlTests(unittest.TestCase):
    def test_share_link_variants_become_one_canonical_link(self):
        for raw in (
            "https://www.facebook.com/share/p/1AbCd2EfGh/",
            "facebook.com/share/p/1AbCd2EfGh",
            "m.facebook.com/share/p/1AbCd2EfGh?mibextid=xyz",
            "share/p/1AbCd2EfGh",
        ):
            with self.subTest(raw=raw):
                self.assertEqual(R.normalize_target_url(raw, "POST"), "https://web.facebook.com/share/p/1AbCd2EfGh")

    def test_tracking_params_removed_but_real_params_kept(self):
        url = "https://m.facebook.com/profile.php?id=100012345678&ref=bookmarks&mibextid=abc&__tn__=R"
        self.assertEqual(R.normalize_target_url(url, "PROFILE"), "https://web.facebook.com/profile.php?id=100012345678")

    def test_post_token_and_uid_post_id(self):
        self.assertEqual(R.normalize_target_url("1HuNarJSLn", "POST"), "https://web.facebook.com/share/p/1HuNarJSLn")
        self.assertEqual(R.normalize_target_url("100089123456_987654321", "POST"),
                         "https://web.facebook.com/100089123456_987654321")

    def test_page_username_and_uid(self):
        self.assertEqual(R.normalize_target_url("www.facebook.com/QuanAP/", "PAGE"), "https://web.facebook.com/QuanAP")
        self.assertEqual(R.normalize_target_url("100012345678", "PROFILE"), "https://web.facebook.com/100012345678")

    def test_empty_input(self):
        self.assertEqual(R.normalize_target_url("   ", "POST"), "")

    def test_normalizing_twice_gives_the_same_link(self):
        # Giao diện chuẩn hóa link trước khi gửi, backend chuẩn hóa lại lần nữa: lần 2 không được làm hỏng link
        # (vd UID_PostID từng bị đổi thành /share/p/UID_PostID -> link không tồn tại).
        for target_type, raw in SAMPLE_LINKS:
            with self.subTest(raw=raw):
                once = R.normalize_target_url(raw, target_type)
                self.assertEqual(R.normalize_target_url(once, target_type), once)
        self.assertEqual(R.normalize_target_url("https://web.facebook.com/100089123456_987654321", "POST"),
                         "https://web.facebook.com/100089123456_987654321")


class ExtractFbIdTests(unittest.TestCase):
    def test_common_link_shapes(self):
        cases = {
            "https://web.facebook.com/share/p/1HuNarJSLn": "1HuNarJSLn",
            "https://web.facebook.com/permalink.php?story_fbid=123456789&id=100": "123456789",
            "https://web.facebook.com/profile.php?id=100012345678": "100012345678",
            "https://web.facebook.com/people/Nguyen-Van-A/100012345678/": "100012345678",
            "https://web.facebook.com/QuanAP/posts/pfbid02abcDEF123": "pfbid02abcDEF123",
            "https://web.facebook.com/QuanAP": "QuanAP",
            "https://web.facebook.com/reel/987654321": "987654321",
        }
        for url, expected in cases.items():
            with self.subTest(url=url):
                self.assertEqual(R.extract_fb_id(url), expected)

    def test_permalink_with_pfbid_token_is_the_post_not_the_page(self):
        # Link bài viết kiểu mới: story_fbid là chuỗi pfbid..., id là ID của Page.
        # Nếu lấy nhầm id của Page thì 2 bài khác nhau của cùng 1 Page bị gộp thành 1 mục tiêu.
        url_a = "https://web.facebook.com/permalink.php?story_fbid=pfbid0AAA111&id=100064"
        url_b = "https://web.facebook.com/permalink.php?story_fbid=pfbid0BBB222&id=100064"
        self.assertEqual(R.extract_fb_id(url_a), "pfbid0AAA111")
        self.assertNotEqual(R.extract_fb_id(url_a), R.extract_fb_id(url_b))

    def test_empty(self):
        self.assertEqual(R.extract_fb_id(""), "unknown")


if __name__ == "__main__":
    unittest.main()
