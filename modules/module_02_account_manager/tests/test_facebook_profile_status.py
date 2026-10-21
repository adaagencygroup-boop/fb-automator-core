import unittest
from unittest.mock import Mock, patch

import httpx

from modules.module_02_account_manager.utils.facebook_profile_status import check_profile_status, profile_exists


def response(html, url="https://www.facebook.com/123", status=200):
    return httpx.Response(status, text=html, request=httpx.Request("GET", url))


class ProfileStatusTests(unittest.TestCase):
    def test_profile_metadata_confirms_uid(self):
        html = '<meta property="og:url" content="https://www.facebook.com/profile.php?id=123"><meta property="og:title" content="Example Person">'
        self.assertTrue(profile_exists("123", response(html)))

    def test_other_uid_and_generic_login_are_not_live(self):
        other_profile = '<meta property="og:url" content="https://www.facebook.com/456"><meta property="og:title" content="Example Person">'
        login = '<title>Log into Facebook</title><form action="/login/">Log in</form>'
        self.assertFalse(profile_exists("123", response(other_profile)))
        self.assertFalse(profile_exists("123", response(login, "https://www.facebook.com/login/")))
        self.assertFalse(profile_exists("123", response(other_profile.replace("456", "123"), "https://www.facebook.com/login/")))

    def test_unavailable_message_overrides_profile_metadata(self):
        html = '<meta property="og:url" content="https://www.facebook.com/123"><meta property="og:title" content="Example Person"><p>This content isn\'t available</p>'
        self.assertFalse(profile_exists("123", response(html)))
        vietnamese_html = '<meta property="og:url" content="https://www.facebook.com/123"><meta property="og:title" content="Example Person"><h1>Bạn hiện không xem được nội dung này</h1>'
        self.assertFalse(profile_exists("123", response(vietnamese_html)))

    def test_viewable_profile_with_login_prompt_is_live(self):
        html = '<header>facebook <button>Đăng nhập</button></header><h1>Vina Suryadi</h1><nav>Bạn bè Ảnh</nav><section>Giới thiệu</section><footer>Hãy đăng nhập hoặc đăng ký Facebook để kết nối với bạn bè</footer>'
        self.assertTrue(profile_exists("123", response(html)))

    def test_status_and_host_must_be_valid(self):
        html = '<meta property="og:url" content="https://www.facebook.com/123"><meta property="og:type" content="profile">'
        self.assertFalse(profile_exists("123", response(html, status=404)))
        self.assertFalse(profile_exists("123", response(html, "https://example.com/123")))

    def test_unavailable_text_inside_script_is_not_conclusive(self):
        script_only = "<script>const hint = \"This content isn't available\";</script><h1>Example Person</h1><nav>Friends Photos About</nav>"
        visible_unavailable = "<h1>This content isn't available</h1>"
        self.assertTrue(profile_exists("123", response(script_only)))
        self.assertFalse(profile_exists("123", response(visible_unavailable)))

    def test_expected_live_and_dead_uid_examples(self):
        live_uid = "61594413526026"
        dead_uid = "61594414780297"
        live_html = f'<meta property="og:url" content="https://www.facebook.com/profile.php?id={live_uid}"><meta property="og:title" content="Example Person">'
        dead_html = '<h1>This content isn\'t available</h1>'
        self.assertTrue(profile_exists(live_uid, response(live_html, f"https://www.facebook.com/profile.php?id={live_uid}")))
        self.assertFalse(profile_exists(dead_uid, response(dead_html, f"https://www.facebook.com/profile.php?id={dead_uid}")))


P = "modules.module_02_account_manager.utils.facebook_profile_status"


class ProfileRequestTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        patches = [patch("modules.module_02_account_manager.utils.paths.PROFILES_DIR", self.temp.name),
                   patch(P + ".httpx.Client"), patch(P + "._find_chrome", return_value="chrome"),
                   patch(P + "._check_in_browser", return_value=None)]
        self.mocks = [item.start() for item in patches]
        for item in patches:
            self.addCleanup(item.stop)
        self.client = self.mocks[1].return_value.__enter__.return_value
        self.browser = self.mocks[3]
        self.picture = httpx.Response(404, request=httpx.Request("GET", "https://graph.facebook.com/123/picture"))

    def test_graph_image_short_circuits(self):
        self.client.get.return_value = httpx.Response(200, content=b"image", headers={"content-type": "image/jpeg"},
            request=httpx.Request("GET", "https://scontent.xx.fbcdn.net/avatar.jpg"))
        self.assertEqual(check_profile_status("123"), "live")
        self.assertEqual(self.client.get.call_count, 1)
        self.browser.assert_not_called()

    def test_static_image_and_graph_errors_fall_back_to_http(self):
        html = '<meta property="og:url" content="https://www.facebook.com/123"><meta property="og:type" content="profile">'
        for picture in (self.picture, httpx.ConnectError("offline"),
                        httpx.Response(200, content=b"image", headers={"content-type": "image/png"},
                        request=httpx.Request("GET", "https://static.xx.fbcdn.net/rsrc.php"))):
            with self.subTest(picture=picture):
                self.client.get.side_effect = [picture, response(html)]
                self.assertEqual(check_profile_status("123"), "live")
        self.browser.assert_not_called()
        self.assertEqual(self.client.get.call_args.args[0], "https://m.facebook.com/profile.php?id=123")

    def test_public_unavailable_is_die(self):
        self.client.get.side_effect = [self.picture, response("<h1>This content isn't available</h1>")]
        self.assertEqual(check_profile_status("123"), "die")
        self.browser.assert_not_called()

    def test_http_login_and_network_error_fall_back_to_browser(self):
        self.browser.return_value = "live"
        for public in (response("Log in", "https://www.facebook.com/login/"), httpx.ReadTimeout("timeout"),
                       response("server error", status=503), response("<h1>Something unclear</h1>")):
            with self.subTest(public=public):
                self.client.get.side_effect = [self.picture, public]
                self.assertEqual(check_profile_status("123"), "live")
        self.assertEqual(self.browser.call_count, 4)
        from pathlib import Path
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_no_chrome_is_inconclusive(self):
        self.client.get.side_effect = [self.picture, response("Log in")]
        self.mocks[2].return_value = None
        self.assertIsNone(check_profile_status("123"))
        self.browser.assert_not_called()

    def test_browser_failure_still_cleans_temporary_profile(self):
        self.client.get.side_effect = [self.picture, response("Unknown page")]
        self.browser.side_effect = OSError("browser failed")
        self.assertIsNone(check_profile_status("123"))
        from pathlib import Path
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_invalid_uid_skips_network(self):
        self.assertIsNone(check_profile_status("bad"))
        self.client.get.assert_not_called()


class ProfileClassificationTests(unittest.TestCase):
    def test_checkpoint_login_and_errors_are_inconclusive(self):
        from modules.module_02_account_manager.utils.facebook_profile_status import _classify_profile
        for page in (response("This content isn't available", "https://www.facebook.com/checkpoint/"),
                     response("Confirm your identity"), response("Account temporarily locked"),
                     response("This content isn't available", status=429),
                     response("This content isn't available", "https://example.com/123"),
                     response("This content isn't available", "https://www.facebook.com/456")):
            self.assertIsNone(_classify_profile("123", page))


class BrowserStatusTests(unittest.TestCase):
    @patch("selenium.webdriver.Chrome")
    def test_browser_uses_final_url_and_closes_driver(self, chrome):
        from modules.module_02_account_manager.utils.facebook_profile_status import _check_in_browser
        driver = chrome.return_value
        driver.current_url = "https://m.facebook.com/profile.php?id=123"
        driver.page_source = '<meta property="og:url" content="https://www.facebook.com/123"><meta property="og:type" content="profile">'
        driver.find_element.return_value.text = "Example Person"
        self.assertEqual(_check_in_browser("123", "chrome", "temp-profile"), "live")
        driver.set_page_load_timeout.assert_called_once_with(30)
        driver.quit.assert_called_once()
        self.assertIn("--user-data-dir=temp-profile", chrome.call_args.kwargs["options"].arguments)
        driver.page_source = "<h1>This content isn't available</h1>"
        driver.find_element.return_value.text = "This content isn't available"
        self.assertEqual(_check_in_browser("123", "chrome", "temp-profile"), "die")

    @patch("selenium.webdriver.support.ui.WebDriverWait")
    @patch("selenium.webdriver.Chrome")
    def test_unclear_redirect_and_browser_errors_are_inconclusive(self, chrome, wait):
        from selenium.common.exceptions import TimeoutException
        from modules.module_02_account_manager.utils.facebook_profile_status import _check_in_browser
        driver = chrome.return_value
        driver.current_url = "https://m.facebook.com/login/"
        driver.page_source = '<meta property="og:url" content="https://www.facebook.com/123"><meta property="og:type" content="profile">'
        driver.find_element.return_value.text = "Log in"
        def timeout(predicate):
            self.assertIsNone(predicate(driver))
            raise TimeoutException()
        wait.return_value.until.side_effect = timeout
        self.assertIsNone(_check_in_browser("123", "chrome", "temp-profile"))
        driver.quit.assert_called_once()
        driver.quit.reset_mock()
        driver.get.side_effect = TimeoutException()
        self.assertIsNone(_check_in_browser("123", "chrome", "temp-profile"))
        driver.quit.assert_called_once()
        chrome.side_effect = OSError("Chrome unavailable")
        self.assertIsNone(_check_in_browser("123", "chrome", "temp-profile"))


if __name__ == "__main__":
    unittest.main()
