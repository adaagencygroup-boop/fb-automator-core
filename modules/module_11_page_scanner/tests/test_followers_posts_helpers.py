"""Offline tests: spike followers extract, post_key, account lock, URL fallback."""
from __future__ import annotations

import unittest

from modules.module_11_page_scanner.browser_session import (
    AccountBusyError,
    get_active_job_for_account,
    release_account_job,
    try_acquire_account_job,
)
from modules.module_11_page_scanner.followers_scan import (
    REASON_PROFILE_PHP,
    can_build_followers_url,
    extract_followers_from_html_fixture,
    normalize_follower_key_from_url,
    page_key_to_url,
)
from modules.module_11_page_scanner.page_source import normalize_post_key, parse_compact_count
from modules.module_11_page_scanner.posts_scan import (
    _sanitize_engagement_text,
    try_parse_published_at,
)


FIXTURE_FOLLOWERS_HTML = """
<div role="dialog" aria-label="Người theo dõi">
  <a href="https://www.facebook.com/profile.php?id=1000123456789">Nguyen Van A</a>
  <a href="https://www.facebook.com/some.user.slug">Tran Thi B</a>
  <a href="https://www.facebook.com/page.slug/followers">Người theo dõi</a>
  <a href="/people/Le-Van-C/112233445566">Le Van C</a>
</div>
"""


class TestFollowersSpike(unittest.TestCase):
    def test_extract_follower_keys_stable(self):
        rows = extract_followers_from_html_fixture(FIXTURE_FOLLOWERS_HTML)
        keys = {r["follower_key"] for r in rows}
        self.assertIn("id:1000123456789", keys)
        self.assertIn("user:some.user.slug", keys)
        self.assertIn("id:112233445566", keys)
        # không lấy link /followers
        self.assertTrue(all("followers" not in (r.get("profile_url") or "") for r in rows))

    def test_profile_php_no_followers_url(self):
        ok, reason = can_build_followers_url(
            "https://www.facebook.com/profile.php?id=123",
            "id:123",
        )
        self.assertFalse(ok)
        self.assertEqual(reason, REASON_PROFILE_PHP)

    def test_slug_followers_url(self):
        ok, url = can_build_followers_url(
            "https://www.facebook.com/MyFanPage",
            "user:myfanpage",
        )
        self.assertTrue(ok)
        self.assertTrue(url.endswith("/followers"))

    def test_page_key_to_url(self):
        self.assertIn("profile.php?id=99", page_key_to_url("id:99"))
        self.assertIn("facebook.com/abc", page_key_to_url("user:abc"))


class TestPostKeyNormalize(unittest.TestCase):
    def test_same_post_different_urls(self):
        a = normalize_post_key("https://www.facebook.com/foo/posts/123456789012345")
        b = normalize_post_key("https://www.facebook.com/permalink.php?story_fbid=123456789012345&id=1")
        c = normalize_post_key("https://www.facebook.com/reel/123456789012345")
        d = normalize_post_key("https://www.facebook.com/foo/videos/123456789012345")
        self.assertEqual(a, "post:123456789012345")
        self.assertEqual(a, b)
        self.assertEqual(a, c)
        self.assertEqual(a, d)

    def test_parse_compact_count(self):
        self.assertEqual(parse_compact_count("1,2K"), 1200)
        self.assertEqual(parse_compact_count("12 N"), 12000)
        self.assertEqual(parse_compact_count("1.200"), 1200)

    def test_published_at_relative_and_absolute(self):
        # Relative ngắn (có/không "trước") đều parse được để lọc Từ–Đến ngày
        self.assertIsNotNone(try_parse_published_at("2 giờ trước"))
        self.assertIsNotNone(try_parse_published_at("a day ago"))
        self.assertEqual(try_parse_published_at("21 tháng 3 năm 2024"), "2024-03-21")

    def test_engagement_not_relative_time(self):
        # Bug cũ: regex reaction bắt "4" từ "4w" → hiện 4 react / 0 cmt / 0 share
        self.assertIsNone(_sanitize_engagement_text("4w"))
        self.assertIsNone(_sanitize_engagement_text("2h"))
        self.assertEqual(_sanitize_engagement_text("92"), "92")
        self.assertEqual(parse_compact_count("92"), 92)
        self.assertEqual(parse_compact_count("9"), 9)
        self.assertEqual(parse_compact_count("4"), 4)


class TestAccountLock(unittest.TestCase):
    def tearDown(self):
        release_account_job("uid_test_lock", 1)
        release_account_job("uid_test_lock", 2)

    def test_busy_second_job(self):
        try_acquire_account_job("uid_test_lock", 1, "FOLLOW")
        with self.assertRaises(AccountBusyError) as ctx:
            try_acquire_account_job("uid_test_lock", 2, "POST_SCAN")
        self.assertEqual(ctx.exception.active_session_id, 1)
        self.assertEqual(ctx.exception.job_type, "FOLLOW")
        # same session ok
        try_acquire_account_job("uid_test_lock", 1, "FOLLOW")
        self.assertEqual(get_active_job_for_account("uid_test_lock")["session_id"], 1)
        release_account_job("uid_test_lock", 1)
        self.assertIsNone(get_active_job_for_account("uid_test_lock"))


class TestFollowerKeyFromUrl(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(
            normalize_follower_key_from_url("https://www.facebook.com/profile.php?id=42"),
            "id:42",
        )


if __name__ == "__main__":
    unittest.main()
