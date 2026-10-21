"""
Thao tác trên trình duyệt: nút Like, chia sẻ ở chế độ Public, kiểm tra lại sau thao tác.
Chạy Chrome headless trên trang HTML giả mô phỏng Facebook (tests/fixtures), không vào Facebook thật.
Bỏ qua nhóm test này: MODULE8_SKIP_BROWSER=1 (hoặc tự bỏ qua nếu máy không mở được Chrome).
"""
import os
import time
import unittest
from pathlib import Path
from urllib.parse import urlencode

from .helpers import R  # noqa: F401  (nạp helpers trước để chặn kết nối DB thật)
from modules.module_08_interaction_seeding.automation import FacebookSeedingBot

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class BrowserTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.getenv("MODULE8_SKIP_BROWSER"):
            raise unittest.SkipTest("MODULE8_SKIP_BROWSER=1")
        from selenium import webdriver
        opts = webdriver.ChromeOptions()
        for arg in ("--headless=new", "--no-sandbox", "--window-size=1280,900"):
            opts.add_argument(arg)
        try:
            cls.driver = webdriver.Chrome(options=opts)
        except Exception as e:  # máy không có Chrome / chromedriver
            raise unittest.SkipTest(f"Không mở được Chrome headless: {e}")
        cls.bot = FacebookSeedingBot(cls.driver)
        cls.bot.random_sleep = lambda a=0, b=0: time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        cls.driver.quit()

    def page(self, name, **params):
        self.driver.get("about:blank")
        return (FIXTURES / name).as_uri() + "?" + urlencode(params)

    def js(self, expr):
        return self.driver.execute_script("return " + expr)


class LikeButtonTests(BrowserTestCase):
    def test_like_only_clicks_once_and_post_ends_liked(self):
        ok, msg = self.bot.execute_react(self.page("like.html", mode="unliked"), reaction_type="LIKE")
        self.assertTrue(ok, msg)
        self.assertEqual(self.js("[window.__clicks, window.__liked]"), [1, True])

    def test_already_liked_post_is_not_clicked(self):
        # Quy tắc chung của Module 8: nick đã làm từ trước thì ghi thất bại kèm lý do, và không bấm lại (bấm lại = bỏ thích)
        ok, msg = self.bot.execute_react(self.page("like.html", mode="liked"), reaction_type="LIKE")
        self.assertFalse(ok)
        self.assertIn("từ trước", msg)
        self.assertEqual(self.js("[window.__clicks, window.__liked]"), [0, True])

    def test_like_that_does_not_register_is_reported_as_failed(self):
        ok, msg = self.bot.execute_react(self.page("like.html", mode="dead"), reaction_type="LIKE")
        self.assertFalse(ok, msg)
        self.assertFalse(self.js("window.__liked"))


class SharePublicTests(BrowserTestCase):
    def test_friends_default_is_switched_to_public_and_saved_as_default(self):
        ok, msg = self.bot.execute_share(self.page("share.html", mode="friends"))
        self.assertTrue(ok, msg)
        self.assertEqual(self.js("[window.__shared, window.__default]"), ["Public", "Public"])

    def test_already_public_shares_directly(self):
        ok, msg = self.bot.execute_share(self.page("share.html", mode="public"))
        self.assertTrue(ok, msg)
        self.assertEqual(self.js("window.__shared"), "Public")

    def test_never_shares_when_public_cannot_be_confirmed(self):
        ok, msg = self.bot.execute_share(self.page("share.html", mode="broken"))
        self.assertFalse(ok, msg)
        self.assertIsNone(self.js("window.__shared || null"))


class VerifyAfterActionTests(BrowserTestCase):
    CASES = [  # kịch bản, hành động, loại trang, bình luận, còn giữ được không
        ("follow_kept", "FOLLOW", "PAGE", None, True),
        ("follow_revert", "FOLLOW", "PROFILE", None, False),
        ("warn", "FOLLOW", "PAGE", None, False),
        ("security", "FOLLOW", "PAGE", None, False),
        ("react_kept", "REACT", "POST", None, True),
        ("react_count", "REACT", "POST", None, True),
        ("react_revert", "REACT", "POST", None, False),
        ("comment_kept", "COMMENT", "POST", "Cố lên mọi người", True),
        ("comment_removed", "COMMENT", "POST", "Cố lên mọi người", False),
        ("post_modal", "SHARE", "POST", None, True),
    ]

    def test_scenarios(self):
        for scenario, action, target_type, comment, expected in self.CASES:
            with self.subTest(scenario=scenario):
                self.driver.get(self.page("verify.html", s=scenario))
                time.sleep(0.3)
                kept, why = self.bot.verify_action_kept(action, target_type=target_type, comment_text=comment,
                                                        wait_range=(4.0, 4.0))
                self.assertEqual(kept, expected, why)


if __name__ == "__main__":
    unittest.main()
