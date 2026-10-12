import unittest
from unittest.mock import Mock, patch

from modules.module_02_account_manager.automation.login_flow import _check_logged_in, is_checkpoint_url, run_login
from modules.module_02_account_manager.automation.locators import LOGIN


class LoginStatusTests(unittest.TestCase):
    def test_checkpoint_path_is_detected_even_with_redirect_query(self):
        url = "https://www.facebook.com/checkpoint/1501092823525282/?next=https%3A%2F%2Fwww.facebook.com%2Fme#"
        self.assertTrue(is_checkpoint_url(url))
        self.assertFalse(is_checkpoint_url("https://www.facebook.com/me?next=/checkpoint/123"))

    def test_checkpoint_never_counts_as_logged_in(self):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/checkpoint/123/?next=/me"
        driver.get_cookies.return_value = [{"name": "c_user", "value": "123"}]
        self.assertFalse(_check_logged_in(driver))

    def test_public_profile_or_saved_cookie_alone_is_not_logged_in(self):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/123"
        driver.get_cookies.return_value = []
        driver.find_elements.return_value = []
        self.assertFalse(_check_logged_in(driver))
        driver.get_cookies.return_value = [{"name": "c_user", "value": "123"}]
        self.assertTrue(_check_logged_in(driver))

    @patch("modules.module_02_account_manager.automation.login_flow.time.sleep")
    @patch("modules.module_02_account_manager.automation.login_flow._get_profile_name", return_value="")
    @patch("modules.module_02_account_manager.automation.login_flow._try_cookie_login", return_value=True)
    @patch("modules.module_02_account_manager.automation.login_flow.create_driver")
    def test_cookie_login_without_accessible_profile_fails(self, create_driver, _try_cookie_login, _get_profile_name, _sleep):
        driver = create_driver.return_value
        driver.current_url = "https://www.facebook.com/checkpoint/123/"
        result = run_login("123", "", cookie="c_user=123")
        self.assertFalse(result["success"])
        self.assertIn("Checkpoint", result["error"])

    @patch("modules.module_02_account_manager.automation.login_flow.time.sleep")
    @patch("modules.module_02_account_manager.automation.login_flow._get_profile_name", return_value="")
    @patch("modules.module_02_account_manager.automation.login_flow._try_cookie_login", return_value=True)
    @patch("modules.module_02_account_manager.automation.login_flow.create_driver")
    def test_authenticated_session_succeeds_even_if_name_is_missing(self, create_driver, _try_cookie_login, _get_profile_name, _sleep):
        driver = create_driver.return_value
        driver.current_url = "https://www.facebook.com/123"
        driver.get_cookies.return_value = [{"name": "c_user", "value": "123"}]
        driver.find_elements.return_value = []
        result = run_login("123", "", cookie="c_user=123")
        self.assertTrue(result["success"])
        self.assertEqual(result["profile_name"], "")

    def test_profile_heading_locator_exists(self):
        self.assertIn('//h1', LOGIN["profile_name_h1"])

    @patch("modules.module_02_account_manager.automation.login_flow.time.sleep")
    @patch("modules.module_02_account_manager.automation.login_flow._try_cookie_login", return_value=False)
    @patch("modules.module_02_account_manager.automation.login_flow.create_driver")
    def test_cookie_checkpoint_stops_before_form_login(self, create_driver, _try_cookie_login, _sleep):
        driver = create_driver.return_value
        driver.current_url = "https://www.facebook.com/checkpoint/123/?next=/me"
        result = run_login("123", "password", cookie="c_user=123")
        self.assertFalse(result["success"])
        self.assertIn("Checkpoint", result["error"])

    def test_trust_device_locators_exist(self):
        self.assertIn("trust_device_button", LOGIN)
        self.assertTrue(len(LOGIN["trust_device_button"]) > 0)
        has_trust_text = any("Trust this device" in loc for loc in LOGIN["trust_device_button"])
        self.assertTrue(has_trust_text)

    @patch("modules.module_02_account_manager.automation.login_flow.human_sleep")
    @patch("modules.module_02_account_manager.automation.login_flow.time.sleep")
    def test_handle_trust_device_screen_clicks_when_present(self, mock_sleep, mock_human_sleep):
        from modules.module_02_account_manager.automation.login_flow import _handle_trust_device_screen
        driver = Mock()
        driver.current_url = "https://www.facebook.com/two_factor/remember_browser/?context=123"
        driver.get_cookies.return_value = [{"name": "c_user", "value": "123"}]

        mock_button = Mock()
        mock_button.is_displayed.return_value = True

        def find_elements_side_effect(by, loc):
            if "Trust this device" in loc:
                return [mock_button]
            return []

        driver.find_elements.side_effect = find_elements_side_effect

        clicked = _handle_trust_device_screen(driver, max_wait_sec=2.0)
        self.assertTrue(clicked)
        mock_button.click.assert_called()

    @patch("modules.module_02_account_manager.automation.login_flow._check_logged_in", return_value=True)
    def test_handle_trust_device_screen_skips_if_already_logged_in(self, mock_check_logged_in):
        from modules.module_02_account_manager.automation.login_flow import _handle_trust_device_screen
        driver = Mock()
        driver.current_url = "https://www.facebook.com/home.php"
        driver.get_cookies.return_value = [{"name": "c_user", "value": "123"}]

        result = _handle_trust_device_screen(driver, max_wait_sec=2.0)
        self.assertTrue(result)
        driver.find_elements.assert_not_called()


    def test_2fa_locators_exist(self):
        self.assertIn("two_fa_input", LOGIN)
        self.assertIn("two_fa_submit", LOGIN)
        self.assertTrue(len(LOGIN["two_fa_input"]) > 0)
        self.assertTrue(len(LOGIN["two_fa_submit"]) > 0)
        has_continue = any("Continue" in loc for loc in LOGIN["two_fa_submit"])
        self.assertTrue(has_continue)

    @patch("modules.module_02_account_manager.automation.login_flow.human_sleep")
    @patch("modules.module_02_account_manager.automation.login_flow.time.sleep")
    @patch("modules.module_02_account_manager.automation.login_flow.generate_totp", return_value="123456")
    @patch("modules.module_02_account_manager.automation.login_flow._handle_trust_device_screen", return_value=True)
    @patch("modules.module_02_account_manager.automation.login_flow._handle_post_login_popups", return_value=True)
    @patch("modules.module_02_account_manager.automation.login_flow._check_logged_in", return_value=True)
    def test_handle_2fa_direct_input_clicks_continue(
        self, mock_logged_in, mock_popups, mock_trust, mock_totp, mock_sleep, mock_human_sleep
    ):
        from modules.module_02_account_manager.automation.login_flow import _handle_2fa

        driver = Mock()
        mock_input = Mock()
        mock_input.is_displayed.return_value = True

        mock_continue_btn = Mock()
        mock_continue_btn.is_displayed.return_value = True
        mock_continue_btn.get_attribute.return_value = "false"

        def find_elements_side_effect(by, loc):
            if "Continue" in loc or "checkpointSubmitButton" in loc:
                return [mock_continue_btn]
            if "two_fa_input" in str(loc) or "Code" in loc or "approvals" in loc or "form" in loc:
                return [mock_input]
            return []

        driver.find_elements.side_effect = find_elements_side_effect

        result = _handle_2fa(driver, "JBSWY3DPEHPK3PXP")
        self.assertTrue(result)
        mock_continue_btn.click.assert_called()


if __name__ == "__main__":
    unittest.main()


class PersistentSessionTests(unittest.TestCase):
    @patch("modules.module_02_account_manager.automation.login_flow.human_sleep")
    @patch("modules.module_02_account_manager.automation.login_flow._get_profile_name", return_value="Saved User")
    @patch("modules.module_02_account_manager.automation.login_flow.create_driver")
    def test_navigates_before_checking_saved_session(self, create_driver, name, sleep):
        driver = create_driver.return_value
        driver.current_url = "data:,"
        driver.get.side_effect = lambda url: setattr(driver, "current_url", url)
        driver.get_cookies.return_value = [{"name": "c_user", "value": "123"}]
        result = run_login("123", "")
        self.assertTrue(result["success"])
        self.assertEqual(result["cookie"], "c_user=123")
        driver.quit.assert_called_once()

    @patch("modules.module_02_account_manager.automation.login_flow.human_sleep")
    @patch("modules.module_02_account_manager.automation.login_flow._check_logged_in", return_value=True)
    @patch("modules.module_02_account_manager.automation.login_flow.ensure_personal_profile")
    def test_ensure_logged_in_already_active(self, ensure_personal, check_login, sleep):
        from modules.module_02_account_manager.automation.login_flow import ensure_logged_in
        driver = Mock()
        driver.current_url = "https://www.facebook.com"
        result = ensure_logged_in(driver, "123")
        self.assertTrue(result["success"])
        self.assertFalse(result["reloaded"])
        ensure_personal.assert_called_once_with(driver, "123")
        driver.quit.assert_not_called()

