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


class ProfileRequestTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        p = patch("modules.module_02_account_manager.utils.paths.PROFILES_DIR", self.temp.name)
        p.start()
        self.addCleanup(p.stop)

    @patch("modules.module_02_account_manager.utils.facebook_profile_status._find_chrome", return_value="chrome")
    @patch("modules.module_02_account_manager.utils.facebook_profile_status.tempfile.TemporaryDirectory")
    @patch("modules.module_02_account_manager.utils.facebook_profile_status.subprocess.run")
    def test_checks_public_profile_php_url_without_saved_cookie(self, run, temp_dir, _find_chrome):
        temp_dir.return_value.__enter__.return_value = "status-profile"
        run.return_value.returncode = 0
        run.return_value.stdout = '<meta property="og:url" content="https://www.facebook.com/profile.php?id=123"><meta property="og:title" content="Example Person">'
        self.assertEqual(check_profile_status("123"), "live")
        self.assertEqual(run.call_args.args[0][-1], "https://www.facebook.com/profile.php?id=123")
        self.assertIn("--dump-dom", run.call_args.args[0])

    @patch("modules.module_02_account_manager.utils.facebook_profile_status._find_chrome", return_value="chrome")
    @patch("modules.module_02_account_manager.utils.facebook_profile_status.tempfile.TemporaryDirectory")
    @patch("modules.module_02_account_manager.utils.facebook_profile_status.subprocess.run")
    def test_non_profile_response_is_die(self, run, temp_dir, _find_chrome):
        temp_dir.return_value.__enter__.return_value = "status-profile"
        run.return_value.returncode = 0
        run.return_value.stdout = '<title>Log into Facebook</title><form action="/login/">Log in</form>'
        self.assertEqual(check_profile_status("123"), "die")

    @patch("modules.module_02_account_manager.utils.facebook_profile_status._find_chrome", return_value="chrome")
    @patch("modules.module_02_account_manager.utils.facebook_profile_status.tempfile.TemporaryDirectory")
    @patch("modules.module_02_account_manager.utils.facebook_profile_status.subprocess.run")
    def test_unavailable_profile_is_die(self, run, temp_dir, _find_chrome):
        temp_dir.return_value.__enter__.return_value = "status-profile"
        run.return_value.returncode = 0
        run.return_value.stdout = '<h1>This content isn\'t available</h1>'
        self.assertEqual(check_profile_status("123"), "die")

    @patch("modules.module_02_account_manager.utils.facebook_profile_status._find_chrome", return_value="chrome")
    @patch("modules.module_02_account_manager.utils.facebook_profile_status.tempfile.TemporaryDirectory")
    @patch("modules.module_02_account_manager.utils.facebook_profile_status.subprocess.run")
    def test_browser_failure_is_die(self, run, temp_dir, _find_chrome):
        temp_dir.return_value.__enter__.return_value = "status-profile"
        run.side_effect = OSError("Chrome unavailable")
        self.assertEqual(check_profile_status("123"), "die")


if __name__ == "__main__":
    unittest.main()
