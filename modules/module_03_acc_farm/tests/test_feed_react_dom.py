"""
Chọn nút thả cảm xúc trên Newsfeed: chạy đúng đoạn JS của flow trong Chrome headless với HTML mẫu dựng theo DOM
Facebook đo thật 2026-10-30 (giao diện mới "React with Like to <Tên>'s post") và giao diện cũ ("Like").
Không có Playwright / Chrome thì bỏ qua.
"""
import os
import unittest
from pathlib import Path

from modules.module_03_acc_farm.farming import flow

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

BUTTON = 'style="display:inline-block;width:60px;height:30px;background:#ddd;margin:2px"'


def _button(label, element_id=""):
    return f'<div role="button" tabindex="0" aria-label="{label}" id="{element_id}" {BUTTON}></div>'


def _comment(author, *buttons, label="Comment by {author} 5 days ago"):
    return f'<div role="article" aria-label="{label.format(author=author)}">{"".join(buttons)}</div>'


VI_COMMENT = "Bình luận dưới tên {author} vào 6 giờ trước"
VI_REPLY = "Phản hồi bình luận của Hiền An Lành dưới tên {author} vào 6 giờ trước"


FEED_HTML = f"""
<html><body style="margin:0">
<div style="height:100px"></div>
<div aria-posinset="1" id="post-comment" style="height:180px">
  {_button("React with Like to Vi Xuân Định's post", "like-comment")}
  {_button("React to Vi Xuân Định's post")}
  {_button("Comment on Vi Xuân Định's post")}
  {_button("Like: 47 people")}
  {_comment("Lương Trọng Thức", _button("Like", "comment-like"), _button("React"))}
</div>
<div aria-posinset="2" id="post-comment-first" style="height:180px">
  {_comment("Nha Khoa Kim", _button("Like", "comment-first-like"), _button("React"))}
  {_button("React with Like to MSD Pet Health Vietnam's post", "like-comment-first")}
</div>
<div aria-posinset="3" id="post-plain" style="height:120px">
  {_button("React with Like to YODY's post", "like-plain")}
  {_button("Like: 6K people")}
</div>
<div aria-posinset="4" id="post-reacted" style="height:120px">
  {_button("Remove Love from Tran Thu Thao's post", "like-reacted")}
  {_button("Change Love reaction")}
</div>
<div aria-posinset="5" id="post-old-ui" style="height:120px">
  {_button("Like", "like-old")}
  {_comment("Hồ Tiệp", _button("Like"))}
</div>
<div aria-posinset="6" id="post-unknown-label" style="height:120px">
  {_button("Thích bài viết của Mai Linh")}
  {_comment("Py Tồ Store", _button("Like", "unknown-comment-like"))}
</div>
<div aria-posinset="7" id="post-suggestions" style="height:120px">
  {_button("Remove recommendation for Kiều Thuy Nga")}
  {_button("Add Friend Kiều Thuy Nga")}
</div>
<div aria-posinset="8" id="post-vi-comment-first" style="height:180px">
  {_comment("lâm hồ", _button("Thích", "vi-comment-like"), _button("Bày tỏ cảm xúc"), label=VI_COMMENT)}
  {_comment("lâm hồ", _button("Thích"), label=VI_REPLY)}
  {_button("Bày tỏ cảm xúc Thích về bài viết của lâm hồ", "like-vi")}
  {_button("Bày tỏ cảm xúc về bài viết của lâm hồ")}
  {_button("Thích: 11 người")}
</div>
<div aria-posinset="9" id="post-vi-reacted" style="height:120px">
  {_button("Gỡ Thích khỏi bài viết của Sàn Nam Long", "like-vi-reacted")}
  {_button("Thay đổi cảm xúc Thích")}
</div>
</body></html>
"""

VIDEO_HTML = f"""
<html><body>
<div id="reel-vi"><div><video id="video-vi"></video></div>
  {_button("Thích", "reel-like-vi")}{_button("Bày tỏ cảm xúc")}{_button("Bình luận")}
</div>
<div id="reel-en-reacted"><div><video id="video-en-reacted"></video></div>
  {_button("Remove Love", "reel-like-en")}{_button("Change Love reaction")}
</div>
<div id="reel-vi-reacted"><div><video id="video-vi-reacted"></video></div>
  {_button("Gỡ Yêu thích", "reel-like-vi-reacted")}{_button("Thay đổi cảm xúc Yêu thích")}
</div>
<div id="reel-counted"><div><video id="video-counted"></video></div>
  {_button("Like, 860 reactions", "reel-like-counted")}{_button("React")}{_button("Comment, 17 comments")}
</div>
<div id="reel-one"><div><video id="video-one"></video></div>
  {_button("Like, 1 reaction", "reel-like-one")}{_button("React")}
</div>
<div id="reel-vi-counted"><div><video id="video-vi-counted"></video></div>
  {_button("Thích, 860 cảm xúc", "reel-like-vi-counted")}{_button("Bày tỏ cảm xúc")}
</div>
<div id="reel-reacted-counted"><div><video id="video-reacted-counted"></video></div>
  {_button("Remove Love, 861 reactions", "reel-like-reacted-counted")}{_button("Change Love reaction")}
</div>
<div id="reel-vi-reacted-counted"><div><video id="video-vi-reacted-counted"></video></div>
  {_button("Gỡ Yêu thích, 861 cảm xúc", "reel-like-vi-reacted-counted")}
</div>
</body></html>
"""

HAS_LIKE_HTML = {
    "new-ui": f'<div aria-posinset="1">{_button("React with Like to YODY&#39;s post")}</div>',
    "reacted": f'<div aria-posinset="1">{_button("Remove Love from YODY&#39;s post")}</div>',
    "only-comment": f'<div aria-posinset="1">{_comment("Hồ Tiệp", _button("Like"))}</div>',
    "only-count": f'<div aria-posinset="1">{_button("Like: 47 people")}</div>',
    "no-posts": f'<div>{_button("Like")}</div>',
}

STATE_HTML = f"""
<html><body>
<div id="new-ui">{_button("Remove Haha from YODY's post")}{_button("Change Haha reaction")}</div>
<div id="old-ui">{_button("Remove Wow")}</div>
<div id="only-comment-liked">
  {_button("React with Like to YODY's post")}
  {_comment("Hồ Tiệp", _button("Remove Like"))}
</div>
<div id="not-reacted">{_button("React with Like to YODY's post")}{_button("Remove recommendation for Mat Bao")}</div>
<div id="vi-feed">{_button("Gỡ Yêu thích khỏi bài viết của Vi Xuân Định")}{_button("Thay đổi cảm xúc Yêu thích")}</div>
<div id="vi-reel">{_button("Gỡ Phẫn nộ")}</div>
<div id="vi-like">{_button("Gỡ Thích khỏi bài viết của Sàn Nam Long")}</div>
<div id="vi-only-comment-liked">
  {_button("Bày tỏ cảm xúc Thích về bài viết của lâm hồ")}
  {_comment("lâm hồ", _button("Gỡ Thích"), label=VI_COMMENT)}
</div>
</body></html>
"""

# Đoạn JS của flow dùng arguments[...] như Selenium execute_script: bọc vào Function rồi đổi phần tử trả về sang id
RUN_CANDIDATES = "(js) => (new Function(js)() || []).map(([post, like]) => [post.id, like.id])"
RUN_STATE = "([js, id]) => new Function(js).call(null, document.getElementById(id))"
RUN_VIDEO = """([js, id]) => {
  const found = new Function(js).call(null, document.getElementById(id));
  return found && [found[0].id || null, found[1].id, found[2]];
}"""


class ReactionLocatorTests(unittest.TestCase):
    def test_bar_button_matches_both_languages(self):
        self.assertEqual(flow._reaction_locator("Love"), '//*[@aria-label="Love" or @aria-label="Yêu thích"]')
        self.assertEqual(flow._reaction_locator("Haha"), '//*[@aria-label="Haha" or @aria-label="Haha"]')


@unittest.skipIf(sync_playwright is None, "chưa cài Playwright")
class FeedReactDomTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        chrome = Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe"
        options = {"headless": True}
        if chrome.is_file():
            options["executable_path"] = str(chrome)
        try:
            cls.browser = cls.playwright.chromium.launch(**options)
        except Exception as e:  # pragma: no cover
            cls.playwright.stop()
            raise unittest.SkipTest(f"không mở được Chrome headless: {e}")

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page(viewport={"width": 1000, "height": 1400})
        self.addCleanup(self.page.close)

    def candidates(self):
        return self.page.evaluate(RUN_CANDIDATES, flow._FEED_REACT_CANDIDATES_JS)

    def test_picks_post_like_never_comment_like(self):
        self.page.set_content(FEED_HTML)
        self.assertEqual(self.candidates(), [
            ["post-comment", "like-comment"],
            ["post-comment-first", "like-comment-first"],
            ["post-plain", "like-plain"],
            ["post-old-ui", "like-old"],
            ["post-vi-comment-first", "like-vi"],
        ])

    def test_each_post_checked_once(self):
        self.page.set_content(FEED_HTML)
        self.candidates()
        self.assertEqual(self.candidates(), [])

    def test_like_out_of_view_not_marked(self):
        self.page.set_viewport_size({"width": 1000, "height": 300})
        self.page.set_content(FEED_HTML)
        self.assertEqual(self.candidates(), [["post-comment", "like-comment"]])
        self.page.set_viewport_size({"width": 1000, "height": 1400})
        self.assertEqual([post for post, _ in self.candidates()],
                         ["post-comment-first", "post-plain", "post-old-ui", "post-vi-comment-first"])

    def test_reaction_state(self):
        self.page.set_content(STATE_HTML)
        state = lambda box: self.page.evaluate(RUN_STATE, [flow._REACTION_STATE_JS, box])  # noqa: E731
        self.assertEqual(state("new-ui"), "Haha")
        self.assertEqual(state("old-ui"), "Wow")
        self.assertIsNone(state("only-comment-liked"))
        self.assertIsNone(state("not-reacted"))
        self.assertEqual(state("vi-feed"), "Love")
        self.assertEqual(state("vi-reel"), "Angry")
        self.assertEqual(state("vi-like"), "Like")
        self.assertIsNone(state("vi-only-comment-liked"))

    def test_video_like_button(self):
        self.page.set_content(VIDEO_HTML)
        video = lambda vid: self.page.evaluate(RUN_VIDEO, [flow._VIDEO_LIKE_JS, vid])  # noqa: E731
        self.assertEqual(video("video-vi"), ["reel-vi", "reel-like-vi", True])
        self.assertEqual(video("video-en-reacted"), ["reel-en-reacted", "reel-like-en", False])
        self.assertEqual(video("video-vi-reacted"), ["reel-vi-reacted", "reel-like-vi-reacted", False])

    def test_video_like_with_reaction_count(self):
        # Facebook đổi nhãn nút reel 2026-11-04: "Like, 860 reactions"
        self.page.set_content(VIDEO_HTML)
        video = lambda vid: self.page.evaluate(RUN_VIDEO, [flow._VIDEO_LIKE_JS, vid])  # noqa: E731
        self.assertEqual(video("video-counted"), ["reel-counted", "reel-like-counted", True])
        self.assertEqual(video("video-one"), ["reel-one", "reel-like-one", True])
        self.assertEqual(video("video-vi-counted"), ["reel-vi-counted", "reel-like-vi-counted", True])
        self.assertEqual(video("video-reacted-counted"), ["reel-reacted-counted", "reel-like-reacted-counted", False])
        self.assertEqual(video("video-vi-reacted-counted"),
                         ["reel-vi-reacted-counted", "reel-like-vi-reacted-counted", False])

    def test_reaction_state_with_reaction_count(self):
        self.page.set_content(VIDEO_HTML)
        state = lambda box: self.page.evaluate(RUN_STATE, [flow._REACTION_STATE_JS, box])  # noqa: E731
        self.assertEqual(state("reel-reacted-counted"), "Love")
        self.assertEqual(state("reel-vi-reacted-counted"), "Love")
        self.assertIsNone(state("reel-counted"))

    def test_lookalike_labels_are_not_like_button(self):
        self.page.set_content(f'<body>{_button("Like: 47 people")}{_button("Like Page")}{_button("Liked by Mai")}'
                              f'<div id="box">{_button("Thích: 11 người")}{_button("Thích trang này")}</div></body>')
        labels = self.page.evaluate("""(js) => Array.from(document.querySelectorAll('[aria-label]'))
            .filter((b) => new Function('label', js + 'return UNREACTED.test(label) || REACTED.test(label);')(b.getAttribute('aria-label')))
            .map((b) => b.getAttribute('aria-label'))""", flow._REACT_LABELS_JS)
        self.assertEqual(labels, [])

    def test_feed_has_like(self):
        expected = {"new-ui": True, "reacted": True, "only-comment": False, "only-count": False, "no-posts": False}
        for name, html in HAS_LIKE_HTML.items():
            with self.subTest(name):
                self.page.set_content(f"<body>{html}</body>")
                self.assertEqual(self.page.evaluate("(js) => new Function(js)()", flow._FEED_HAS_LIKE_JS), expected[name])


if __name__ == "__main__":
    unittest.main()
