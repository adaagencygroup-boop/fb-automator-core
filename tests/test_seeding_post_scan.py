"""Focused checks for the post scanner's full-feed and account rotation behavior."""

import importlib.util
import re
import sys
import types
import unittest
from pathlib import Path
from threading import Lock
from unittest.mock import patch

from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from sqlalchemy.sql import column
from urllib.parse import quote


def load_scanner():
    # Load the scanner without starting the production database through package imports.
    package = types.ModuleType("modules.module_11_page_scanner")
    package.__path__ = []
    facebook_time = types.ModuleType("modules.module_11_page_scanner.facebook_time")
    facebook_time.parse_facebook_published_at = lambda *args, **kwargs: (None, None)
    path = Path(__file__).resolve().parents[1] / "modules/module_08_interaction_seeding/automation/seeding_post_flow_v2.py"
    spec = importlib.util.spec_from_file_location("post_scan_under_test", path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {
        "modules.module_11_page_scanner": package,
        "modules.module_11_page_scanner.facebook_time": facebook_time,
    }):
        spec.loader.exec_module(module)
    return module


class FakeStop:
    def is_set(self):
        return False

    def wait(self, _seconds):
        return False


class FakeFeed:
    def __init__(self, posts):
        self.posts = posts
        self.offset = 0
        self.current_url = ""
        self.get_calls = 0

    def set_page_load_timeout(self, _seconds):
        pass

    def get(self, url):
        self.current_url = url
        self.get_calls += 1

    def execute_script(self, script):
        if "window.scrollBy" in script:
            self.offset = min(self.offset + 10, len(self.posts))
            return None
        return self.posts[self.offset:self.offset + 10]


class PostScanTests(unittest.TestCase):
    def setUp(self):
        self.scanner = load_scanner()
        self.rows = [
            {"id": str(number), "post_url": f"https://www.facebook.com/page/posts/{number}",
             "content": f"Post {number}", "post_type": "text", "published_at": "2026-11-23",
             "reaction_count": None}
            for number in range(125)
        ]
        self.collect_patch = patch.object(self.scanner, "_collect_post", side_effect=lambda row: row)
        self.collect_patch.start()
        self.addCleanup(self.collect_patch.stop)

    def test_facebook_caption_selector_matches_post_text_element(self):
        selector = re.search(r"const preferredCaption = '([^']+)'", self.scanner._READ_FEED).group(1)
        html = (
            '<div class="xdj266r x14z9mp xat24cr x1lziwak x1vvkbs x126k92a">'
            '<div dir="auto" style="text-align: start;">'
            'Điều tuyệt vời nhất của một tấm ảnh là nó sẽ không bao giờ thay đổi'
            '</div></div>'
        )
        node = BeautifulSoup(html, "html.parser").select_one(selector)
        self.assertIsNotNone(node)
        self.assertIn("Điều tuyệt vời nhất", node.get_text())

    def test_page_caption_includes_nested_hashtag_text(self):
        selector = re.search(r"const preferredCaption = '([^']+)'", self.scanner._READ_FEED).group(1)
        html = (
            '<div role="article"><a href="/page/posts/123">Bài viết</a>'
            '<div class="xdj266r x14z9mp xat24cr x1lziwak x1vvkbs x126k92a">'
            '<div dir="auto" style="text-align: start;">Dạ lỗi em '
            '<span class="html-span"><a href="/watch/hashtag/kietdauroi/" role="link">'
            '#kietdauroi</a></span></div></div></div>'
        )
        node = BeautifulSoup(html, "html.parser").select_one(selector)
        self.assertIsNotNone(node)
        self.assertEqual(node.get_text(), "Dạ lỗi em #kietdauroi")

    def test_one_account_reads_past_fifty_until_feed_ends(self):
        driver = FakeFeed(self.rows)
        cursor = {}
        posts = self.scanner.collect_visible_posts(
            driver, "https://www.facebook.com/page", FakeStop(), cursor=cursor
        )
        self.assertEqual(len(posts), 125)
        self.assertTrue(cursor["done"])
        self.assertEqual(driver.get_calls, 1)

    def test_two_accounts_take_fifty_new_posts_per_turn(self):
        first, second = FakeFeed(self.rows), FakeFeed(self.rows)
        first_cursor, second_cursor = {}, {}
        collected = {}
        turns = []
        for driver, cursor in [(first, first_cursor), (second, second_cursor),
                               (first, first_cursor), (second, second_cursor)]:
            batch = self.scanner.collect_visible_posts(
                driver, "https://www.facebook.com/page", FakeStop(),
                seen_ids=collected, limit=50, cursor=cursor,
            )
            turns.append(len(batch))
            collected.update((post["id"], post) for post in batch)
        self.assertEqual(turns, [50, 50, 25, 0])
        self.assertEqual(len(collected), 125)
        self.assertEqual(first.get_calls, 1)
        self.assertEqual(second.get_calls, 1)

    def test_proxy_failure_skips_to_next_logged_in_live_account(self):
        class FakeProxyError(Exception):
            pass

        class FakeAccount:
            uid = column("uid")
            proxy = column("proxy")
            cookie = column("cookie")
            user_id = column("user_id")
            status = column("status")
            login_status = column("login_status")
            id = column("id")

        class FakeSession:
            predicates = []

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                pass

            def query(self, *_columns):
                return self

            def filter(self, *predicates):
                self.predicates = predicates
                return self

            def order_by(self, *_columns):
                return self

            def all(self):
                return [("bad", "bad-proxy", ""), ("good", "", "")]

        browser = types.ModuleType("core.browser")
        browser.__path__ = []
        browser.close_scoped_active_drivers = lambda *_args, **_kwargs: None
        browser.get_active_drivers = lambda *_args, **_kwargs: []
        locks = {}
        browser.get_profile_lock = lambda uid, **_kwargs: locks.setdefault(uid, Lock())
        browser.load_cookies = lambda *_args: None
        opened = []

        def open_browser(*, uid, proxy, allow_direct_fallback, **_kwargs):
            opened.append((uid, proxy, allow_direct_fallback))
            if uid == "bad":
                raise FakeProxyError("HTTP 407")
            return FakeFeed(self.rows[:60])

        browser.open_browser = open_browser
        proxy_bridge = types.ModuleType("core.browser.proxy_bridge")
        proxy_bridge.ProxyError = FakeProxyError
        connection = types.ModuleType("modules.module_02_account_manager.database.connection")
        fake_session = FakeSession()
        connection.SessionLocal = lambda: fake_session
        models = types.ModuleType("modules.module_02_account_manager.database.models")
        models.Account = FakeAccount

        with patch.dict(sys.modules, {
            "core.browser": browser,
            "core.browser.proxy_bridge": proxy_bridge,
            "modules.module_02_account_manager.database.connection": connection,
            "modules.module_02_account_manager.database.models": models,
        }):
            posts = self.scanner.scan_source_posts(
                "https://www.facebook.com/page", "owner", FakeStop()
            )

        self.assertEqual(len(posts), 60)
        self.assertEqual(opened, [("bad", "bad-proxy", True), ("good", "", True)])
        criteria = [str(item.compile(compile_kwargs={"literal_binds": True})) for item in fake_session.predicates]
        self.assertTrue(any("'LIVE'" in item for item in criteria))
        self.assertTrue(any("'LOGGED_IN'" in item for item in criteria))


class CommentFilterTests(unittest.TestCase):
    def setUp(self):
        self.scanner = load_scanner()

    def test_collect_post_rejects_comment_id_and_reply_comment_id(self):
        post = self.scanner._collect_post({
            "url": "https://www.facebook.com/kietdauroi.box/posts/pfbid0abc123?comment_id=111222333",
            "content": "Bình luận không được trở thành bài viết",
        })
        self.assertIsNone(post)

        reply = self.scanner._collect_post({
            "url": "https://www.facebook.com/kietdauroi.box/posts/pfbid0abc123?reply_comment_id=444555",
            "content": "Phản hồi bình luận",
        })
        self.assertIsNone(reply)

        valid = self.scanner._collect_post({
            "url": "https://www.facebook.com/kietdauroi.box/posts/pfbid0abc123",
            "content": "Dạ lỗi em #kietdauroi",
            "type": "photo",
        })
        self.assertIsNotNone(valid)
        self.assertEqual(valid["id"], "pfbid0abc123")
        self.assertEqual(valid["content"], "Dạ lỗi em #kietdauroi")

    def test_read_feed_excludes_comments_and_keeps_clean_post_caption(self):
        from urllib.parse import quote
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options

        html = """<!DOCTYPE html>
        <html><body><div role="main">
          <div data-pagelet="FeedUnit_1">
            <div class="header">
              <h2><a href="https://www.facebook.com/kietdauroi.box">Kiệt Đâu Rồi</a></h2>
              <a href="https://www.facebook.com/kietdauroi.box/posts/pfbid0abc123" role="link">
                <time datetime="2026-11-20T10:00:00">2 giờ</time>
              </a>
            </div>
            <div class="xdj266r x14z9mp xat24cr x1lziwak x1vvkbs x126k92a">
              <div dir="auto" style="text-align: start;">Dạ lỗi em <span class="html-span"><a href="/watch/hashtag/kietdauroi/">#kietdauroi</a></span></div>
            </div>
            <div class="media"><a href="https://www.facebook.com/photo/?fbid=987654321"><img src="photo.jpg" /></a></div>
            <div role="toolbar">
              <div role="button" aria-label="Thích">Thích</div>
              <div role="button" aria-label="Bình luận">Bình luận</div>
            </div>
            <div class="comment-section" data-pagelet="CommentList">
              <div role="article" aria-label="Bình luận của Nguyễn Văn A">
                <strong>Nguyễn Văn A</strong>
                <div class="xdj266r x14z9mp xat24cr x1lziwak x1vvkbs x126k92a">
                  <div dir="auto">Video hay quá anh ơi!</div>
                </div>
                <a href="https://www.facebook.com/kietdauroi.box/posts/pfbid0abc123?comment_id=111222333"><time>1 giờ</time></a>
              </div>
            </div>
          </div>
          <div role="article" aria-posinset="2">
            <div class="header">
              <h2><a href="https://www.facebook.com/kietdauroi.box">Kiệt Đâu Rồi</a></h2>
              <a href="https://www.facebook.com/kietdauroi.box/posts/pfbid0def456" role="link">
                <time datetime="2026-11-19T08:00:00">Hôm qua</time>
              </a>
            </div>
            <div class="media"><a href="https://www.facebook.com/photo/?fbid=888999000"><img src="photo2.jpg" /></a></div>
            <div role="toolbar">
              <div role="button" aria-label="Thích">Thích</div>
              <div role="button" aria-label="Bình luận">Bình luận</div>
            </div>
            <div class="comment-section">
              <div role="article" aria-label="Bình luận của Lê Văn C">
                <div class="xdj266r x14z9mp xat24cr x1lziwak x1vvkbs x126k92a"><div dir="auto">Ảnh đẹp quá Kiệt ơi!</div></div>
                <a href="https://www.facebook.com/kietdauroi.box/posts/pfbid0def456?comment_id=777888999"><time>5 giờ</time></a>
              </div>
            </div>
          </div>
        </div></body></html>"""

        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        driver = webdriver.Chrome(options=options)
        try:
            driver.get("data:text/html;charset=utf-8," + quote(html))
            items = driver.execute_script(self.scanner._READ_FEED)
            self.assertEqual(len(items), 2)
            self.assertEqual(items[0]["url"], "https://www.facebook.com/kietdauroi.box/posts/pfbid0abc123")
            self.assertEqual(items[0]["content"], "Dạ lỗi em #kietdauroi")
            self.assertEqual(items[1]["url"], "https://www.facebook.com/kietdauroi.box/posts/pfbid0def456")
            self.assertEqual(items[1]["content"], "Bài viết không có nội dung")
        finally:
            driver.quit()

    def test_read_feed_excludes_avatar_updates_and_reels(self):
        html = """<!DOCTYPE html><html><body>
          <div data-pagelet="ProfileHeader">
            <a href="https://www.facebook.com/photo/?fbid=111111&set=a.100"><img src="avatar.jpg" alt="Ảnh đại diện" /></a>
          </div>
          <div role="main">
            <!-- Normal post with quote -->
            <div role="article" aria-posinset="1">
              <div class="header">
                <h2><a href="https://www.facebook.com/kietdauroi.box">Kiệt Đâu Rồi</a></h2>
                <a href="https://www.facebook.com/kietdauroi.box/posts/pfbid0quote123" role="link">
                  <time datetime="2026-11-20T10:00:00">2 giờ</time>
                </a>
              </div>
              <div class="xdj266r x14z9mp xat24cr x1lziwak x1vvkbs x126k92a">
                <div dir="auto" style="text-align: start;">“Điều tuyệt vời nhất của một tấm ảnh là nó sẽ không bao giờ thay đổi, thậm chí cả khi con người trong bức ảnh ấy đã đổi thay”</div>
              </div>
              <div class="media"><a href="https://www.facebook.com/photo/?fbid=987654321"><img src="photo.jpg" /></a></div>
              <div role="toolbar"><div role="button">Thích</div><div role="button">Bình luận</div></div>
            </div>

            <!-- Avatar update post: SHOULD BE EXCLUDED -->
            <div role="article" aria-posinset="2">
              <div class="header">
                <h2><a href="https://www.facebook.com/kietdauroi.box">Kiệt Đâu Rồi</a> đã cập nhật ảnh đại diện của mình.</h2>
                <a href="https://www.facebook.com/photo/?fbid=222222&set=a.200" role="link">
                  <time datetime="2026-11-19T10:00:00">Hôm qua</time>
                </a>
              </div>
              <div class="media"><a href="https://www.facebook.com/photo/?fbid=222222"><img src="avatar2.jpg" /></a></div>
              <div role="toolbar"><div role="button">Thích</div></div>
            </div>

            <!-- Reel post: SHOULD BE EXCLUDED -->
            <div role="article" aria-posinset="3">
              <div class="header">
                <h2><a href="https://www.facebook.com/kietdauroi.box">Kiệt Đâu Rồi</a></h2>
                <a href="https://www.facebook.com/reel/999888777" role="link">
                  <time datetime="2026-11-18T10:00:00">2 ngày</time>
                </a>
              </div>
              <div data-ad-preview="message">Video reel vui nhộn</div>
              <video src="reel.mp4"></video>
              <div role="toolbar"><div role="button">Thích</div></div>
            </div>

            <!-- Normal post without caption: default content -->
            <div role="article" aria-posinset="4">
              <div class="header">
                <h2><a href="https://www.facebook.com/kietdauroi.box">Kiệt Đâu Rồi</a></h2>
                <a href="https://www.facebook.com/kietdauroi.box/posts/pfbid0notext" role="link">
                  <time datetime="2026-11-17T10:00:00">3 ngày</time>
                </a>
              </div>
              <div class="media"><a href="https://www.facebook.com/photo/?fbid=333333"><img src="photo3.jpg" /></a></div>
              <div role="toolbar"><div role="button">Thích</div></div>
            </div>
          </div>
        </body></html>"""

        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        driver = webdriver.Chrome(options=options)
        try:
            driver.get("data:text/html;charset=utf-8," + quote(html))
            items = driver.execute_script(self.scanner._READ_FEED)
            self.assertEqual(len(items), 2)
            self.assertEqual(items[0]["url"], "https://www.facebook.com/kietdauroi.box/posts/pfbid0quote123")
            self.assertEqual(items[0]["content"], "“Điều tuyệt vời nhất của một tấm ảnh là nó sẽ không bao giờ thay đổi, thậm chí cả khi con người trong bức ảnh ấy đã đổi thay”")
            self.assertEqual(items[1]["url"], "https://www.facebook.com/kietdauroi.box/posts/pfbid0notext")
            self.assertEqual(items[1]["content"], "Bài viết không có nội dung")
        finally:
            driver.quit()

    def test_collect_post_excludes_reels_and_defaults_empty_content(self):
        # Reels should be ignored
        reel_raw = {"url": "https://www.facebook.com/reel/1234567890", "content": "Reel test"}
        self.assertIsNone(self.scanner._collect_post(reel_raw))

        reels_raw = {"url": "https://www.facebook.com/reels/1234567890", "content": "Reels test"}
        self.assertIsNone(self.scanner._collect_post(reels_raw))

        # Normal post with empty content should default to "Bài viết không có nội dung"
        post_raw = {
            "url": "https://www.facebook.com/kietdauroi.box/posts/pfbid0abc123",
            "content": "",
            "type": "photo",
        }
        res = self.scanner._collect_post(post_raw)
        self.assertIsNotNone(res)
        self.assertEqual(res["content"], "Bài viết không có nội dung")
        self.assertEqual(res["id"], "pfbid0abc123")


    def test_read_feed_profile_multiple_posts_without_role_article(self):
        html = """<!DOCTYPE html><html><body><div role="main">
          <div class="timeline-container">
            <div class="feed-unit-1">
              <div class="header">
                <h2><a href="/luuminhhuyeen">Lưu Minh Huyền</a></h2>
                <a href="https://www.facebook.com/luuminhhuyeen/posts/1001"><time datetime="2026-11-20T10:00:00">1h</time></a>
                <button aria-label="Tùy chọn bài viết">...</button>
              </div>
              <div class="xdj266r x14z9mp xat24cr x1lziwak x1vvkbs x126k92a"><div dir="auto">Bài viết số 1 của Huyền</div></div>
              <div class="media"><a href="https://www.facebook.com/photo/?fbid=photo1"><img src="p1.jpg" /></a></div>
              <div role="toolbar"><div role="button" aria-label="Thích">Thích</div></div>
            </div>
            <div class="feed-unit-2">
              <div class="header">
                <h2><a href="/luuminhhuyeen">Lưu Minh Huyền</a></h2>
                <a href="https://www.facebook.com/luuminhhuyeen/posts/1002"><time datetime="2026-11-19T10:00:00">2h</time></a>
              </div>
              <div class="media"><a href="https://www.facebook.com/photo/?fbid=photo2"><img src="p2.jpg" /></a></div>
              <div role="toolbar"><div role="button" aria-label="Thích">Thích</div></div>
            </div>
            <div class="feed-unit-3">
              <div class="header">
                <h2><a href="/luuminhhuyeen">Lưu Minh Huyền</a></h2>
                <a href="https://www.facebook.com/luuminhhuyeen/posts/1003"><time datetime="2026-11-18T10:00:00">3h</time></a>
              </div>
              <div class="xdj266r x14z9mp xat24cr x1lziwak x1vvkbs x126k92a"><div dir="auto">Bài viết số 3 của Huyền</div></div>
              <div role="toolbar"><div role="button" aria-label="Thích">Thích</div></div>
            </div>
          </div>
        </div></body></html>"""

        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        driver = webdriver.Chrome(options=options)
        try:
            driver.get("data:text/html;charset=utf-8," + quote(html))
            items = driver.execute_script(self.scanner._READ_FEED)
            self.assertEqual(len(items), 3)
            self.assertEqual(items[0]["url"], "https://www.facebook.com/luuminhhuyeen/posts/1001")
            self.assertEqual(items[0]["content"], "Bài viết số 1 của Huyền")
            self.assertEqual(items[1]["url"], "https://www.facebook.com/luuminhhuyeen/posts/1002")
            self.assertEqual(items[1]["content"], "Bài viết không có nội dung")
            self.assertEqual(items[2]["url"], "https://www.facebook.com/luuminhhuyeen/posts/1003")
            self.assertEqual(items[2]["content"], "Bài viết số 3 của Huyền")
        finally:
            driver.quit()


if __name__ == "__main__":
    unittest.main()
