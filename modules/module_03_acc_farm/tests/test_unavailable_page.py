"""
Câu "không xem được" trên trang cá nhân / nhóm theo link: chỉ tính khi không thấy nút của chủ trang / nhóm và câu đó
nằm ngoài bài đăng (bài chia sẻ có bài gốc đã xóa cũng hiện câu này, tester gặp 2026-11-06 với trang vẫn mở bình thường).
"""
import os
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from modules.module_03_acc_farm.farming import flow as farming_flow

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

FLOW = "modules.module_03_acc_farm.farming.flow"


class Hit:
    text = "This content isn't available right now"


def friend_flow(state, outside):
    """state: trạng thái nút chủ trang; outside: kết quả lọc câu báo ngoài bài đăng (None = script lỗi)."""
    driver = Mock()
    driver.current_url = ""
    clicked = []

    def open_link(drv, ctl, url):
        drv.current_url = url
        return True

    def script(drv, js, *args):
        if js is farming_flow._OUTSIDE_POSTS_JS:
            return outside
        return {"owner": "Mạnh", "state": state, "button": "btn" if state == "add" else None}

    def find(drv, locators, root=None):
        return [Hit()] if locators is farming_flow.FARM_COMMON["unavailable_page"] else []

    links = [{"key": "user:manh.889566", "url": "https://www.facebook.com/manh.889566", "source": "fb.com/manh.889566"}]
    with patch(f"{FLOW}._open_link", side_effect=open_link), patch(f"{FLOW}._wait_for_any", return_value=True), \
            patch(f"{FLOW}._find_visible", side_effect=find), patch(f"{FLOW}._script", side_effect=script), \
            patch(f"{FLOW}._human_click", side_effect=lambda d, b: clicked.append(b) or True), \
            patch(f"{FLOW}.check_account_state", return_value=None), patch(f"{FLOW}._close_dialogs"), \
            patch(f"{FLOW}._pause_between"), patch(f"{FLOW}.random.uniform", return_value=0):
        result = farming_flow.run_add_friends_from_links(driver, Mock(), links, 1, Mock())
    return result, clicked


def group_flow(join_button, outside):
    driver = Mock()
    driver.current_url = ""

    def open_link(drv, ctl, url):
        drv.current_url = url
        return True

    def script(drv, js, *args):
        if js is farming_flow._OUTSIDE_POSTS_JS:
            return outside
        if js is farming_flow._PAGE_NAME_JS:
            return "Nhóm trọ"
        return None

    def find(drv, locators, root=None):
        if locators is farming_flow.FARM_COMMON["unavailable_page"]:
            return [Hit()]
        if locators is farming_flow.FARM_GROUP["page_join_button"]:
            return ["join"] if join_button else []
        return []

    links = [{"key": "group:123", "url": "https://www.facebook.com/groups/123/", "source": "fb.com/groups/123"}]
    with patch(f"{FLOW}._open_link", side_effect=open_link), patch(f"{FLOW}._wait_for_any", return_value=True), \
            patch(f"{FLOW}._find_visible", side_effect=find), patch(f"{FLOW}._script", side_effect=script), \
            patch(f"{FLOW}._human_click", return_value=True), patch(f"{FLOW}.check_account_state", return_value=None), \
            patch(f"{FLOW}._close_dialogs"), patch(f"{FLOW}._handle_group_dialog", return_value="none"), \
            patch(f"{FLOW}._pause_between"), patch(f"{FLOW}.random.uniform", return_value=0):
        return farming_flow.run_join_groups_from_links(driver, Mock(), links, 1, Mock())


class FriendLinkTests(unittest.TestCase):
    def test_owner_button_wins_over_text_in_post(self):
        result, clicked = friend_flow("add", outside=[Hit()])
        self.assertEqual(clicked, ["btn"])
        self.assertEqual(result["targets"][0]["result"], "sent")

    def test_text_only_inside_post_is_not_unavailable(self):
        result, clicked = friend_flow("none", outside=[])
        self.assertEqual(clicked, [])
        self.assertEqual((result["targets"][0]["result"], result["targets"][0]["reason"]),
                         ("skipped_done", "trang không có nút Thêm bạn bè"))

    def test_really_unavailable_page(self):
        with self.assertLogs(farming_flow.logger, "INFO") as logs:
            result, clicked = friend_flow("none", outside=[Hit()])
        self.assertEqual(clicked, [])
        self.assertEqual(result["targets"][0]["reason"], "trang cá nhân không tồn tại hoặc không xem được")
        self.assertTrue(any("This content isn't available right now" in line for line in logs.output))

    def test_script_error_keeps_old_behaviour(self):
        result, _ = friend_flow("none", outside=None)
        self.assertEqual(result["targets"][0]["reason"], "trang cá nhân không tồn tại hoặc không xem được")


class GroupLinkTests(unittest.TestCase):
    def test_join_button_wins_over_text_in_post(self):
        result = group_flow(join_button=True, outside=[Hit()])
        self.assertEqual(result["quantity"], 1)

    def test_text_only_inside_post_is_not_unavailable(self):
        result = group_flow(join_button=False, outside=[])
        self.assertEqual(result["targets"][0]["reason"], "trang không có nút Tham gia nhóm")

    def test_really_unavailable_group(self):
        result = group_flow(join_button=False, outside=[Hit()])
        self.assertEqual(result["targets"][0]["reason"], "nhóm không tồn tại hoặc không xem được")


PAGE_HTML = """
<html><body>
<div role="main">
  <div aria-posinset="1"><span id="in-post">This content isn't available right now</span></div>
  <div role="article" aria-label="Comment by Mai"><span id="in-comment">This content isn't available right now</span></div>
  <div role="feed"><div><span id="in-feed">This content isn't available right now</span></div></div>
  <h2 id="whole-page">This content isn't available right now</h2>
</div>
</body></html>
"""


@unittest.skipIf(sync_playwright is None, "chưa cài Playwright")
class OutsidePostsJsTests(unittest.TestCase):
    def test_only_text_outside_posts_counts(self):
        with sync_playwright() as p:
            chrome = Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe"
            options = {"headless": True}
            if chrome.is_file():
                options["executable_path"] = str(chrome)
            try:
                browser = p.chromium.launch(**options)
            except Exception as e:  # pragma: no cover
                self.skipTest(f"không mở được Chrome headless: {e}")
            page = browser.new_page()
            page.set_content(PAGE_HTML)
            ids = page.evaluate("""(js) => {
                const hits = Array.from(document.querySelectorAll('span, h2'));
                return new Function(js).call(null, hits).map((el) => el.id);
            }""", farming_flow._OUTSIDE_POSTS_JS)
            browser.close()
        self.assertEqual(ids, ["whole-page"])


if __name__ == "__main__":
    unittest.main()
