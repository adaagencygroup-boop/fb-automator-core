import unittest
from unittest.mock import Mock, patch

from selenium.common.exceptions import TimeoutException

from modules.module_03_acc_farm.browser import login_flow
from modules.module_03_acc_farm.browser.locators import LOGIN


def chooser_driver(display_name="Example Person", cookie_uid=None):
    driver = Mock()
    switch = Mock()
    continue_button = Mock()
    password_input = Mock()
    login_button = Mock()
    stage = {"value": "chooser"}
    driver.stage = stage
    driver.current_url = "https://www.facebook.com/"
    continue_button.click.side_effect = lambda: stage.update(value="password")
    driver.execute_script.return_value = f"{display_name}\nTiếp tục\nDùng trang cá nhân khác"
    driver.get_cookie.return_value = {"value": cookie_uid} if cookie_uid else None

    def find_elements(_by, locator):
        if locator in LOGIN["saved_account_switch"]:
            return [switch]
        if locator in LOGIN["saved_account_continue"]:
            return [continue_button]
        if locator in LOGIN["password_input"] and stage["value"] == "password":
            return [password_input]
        return []

    driver.find_elements.side_effect = find_elements
    return driver, continue_button, password_input, login_button


class SavedAccountChooserTests(unittest.TestCase):
    @patch.object(login_flow, "_wait_after_saved_account_continue")
    @patch.object(login_flow, "human_sleep")
    def test_continue_only_when_saved_name_matches(self, _sleep, _wait):
        driver, button, _, _ = chooser_driver("Example Person")
        self.assertTrue(login_flow._advance_saved_account_chooser(
            driver, "12345", "Example Person"))
        button.click.assert_called_once_with()

    def test_wrong_saved_account_is_not_selected(self):
        driver, button, _, _ = chooser_driver("Another Person")
        with self.assertRaisesRegex(RuntimeError, "Không xác nhận được"):
            login_flow._advance_saved_account_chooser(driver, "12345", "Example Person")
        button.click.assert_not_called()

    def test_other_uid_cookie_blocks_continue_even_when_name_matches(self):
        driver, button, _, _ = chooser_driver("Example Person", cookie_uid="99999")
        with self.assertRaisesRegex(RuntimeError, "không khớp UID"):
            login_flow._advance_saved_account_chooser(driver, "12345", "Example Person")
        button.click.assert_not_called()

    def test_chooser_is_not_clicked_again_on_password_overlay(self):
        driver, button, _, _ = chooser_driver(cookie_uid="12345")
        button.click()
        self.assertFalse(login_flow._advance_saved_account_chooser(driver, "12345"))
        button.click.assert_called_once_with()

    def test_clicks_actionable_button_again_when_page_does_not_advance(self):
        driver, button, _, _ = chooser_driver(cookie_uid="12345")
        with patch.object(login_flow, "_wait_after_saved_account_continue",
                          side_effect=[TimeoutException("not advanced"), None]), \
                patch.object(login_flow, "human_click", return_value=True) as click:
            self.assertTrue(login_flow._advance_saved_account_chooser(driver, "12345"))
        # Bấm lại bằng chuột giống người, không bắn sự kiện CDP / JS vào giữa nút
        self.assertEqual([c.args[1] for c in click.call_args_list], [button, button])
        driver.execute_cdp_cmd.assert_not_called()
        button.click.assert_not_called()

    def test_human_click_failure_falls_back_to_real_click_never_js(self):
        driver, button, _, _ = chooser_driver(cookie_uid="12345")
        with patch.object(login_flow, "_wait_after_saved_account_continue"), \
                patch.object(login_flow, "human_click", return_value=False):
            self.assertTrue(login_flow._advance_saved_account_chooser(driver, "12345"))
        button.click.assert_called_once_with()
        self.assertFalse(any("click()" in str(c.args[0]) for c in driver.execute_script.call_args_list))

    @patch.object(login_flow, "_wait_after_saved_account_continue")
    @patch.object(login_flow, "_wait_after_password_submit")
    @patch.object(login_flow, "human_sleep")
    @patch.object(login_flow, "human_type")
    @patch.object(login_flow, "_is_2fa_required", return_value=False)
    @patch.object(login_flow, "_check_logged_in", return_value=False)
    def test_saved_account_password_only_form(self, _logged_in, _two_fa, human_type,
                                              _sleep, _wait_password, _wait):
        driver, button, password_input, login_button = chooser_driver(cookie_uid="12345")

        def find_form(_driver, locators, timeout=8):
            if locators == LOGIN["password_input"]:
                return password_input
            if locators == LOGIN["login_button"]:
                return login_button
            raise AssertionError("Unexpected email field lookup")

        with patch.object(login_flow, "wait_and_find", side_effect=find_form):
            login_flow._submit_login_form(driver, "12345", "example-password")

        button.click.assert_called_once_with()
        human_type.assert_called_once_with(password_input, "example-password")
        login_button.click.assert_called_once_with()

    @patch.object(login_flow, "_wait_after_saved_account_continue")
    @patch.object(login_flow, "human_sleep")
    @patch.object(login_flow, "human_type")
    @patch.object(login_flow, "_is_2fa_required", side_effect=lambda driver: driver.stage["value"] == "password")
    @patch.object(login_flow, "_check_logged_in", return_value=False)
    def test_2fa_after_continue_does_not_retry_password(self, _logged_in, _two_fa, human_type, _sleep, _wait):
        driver, button, _, _ = chooser_driver(cookie_uid="12345")
        login_flow._submit_login_form(driver, "12345", "example-password")
        button.click.assert_called_once_with()
        human_type.assert_not_called()

    def test_waits_for_2fa_transition_before_accepting_cookie(self):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        elapsed = [0.0]

        def visible(_driver, locators):
            if locators == LOGIN["saved_account_switch"] and elapsed[0] < 1:
                return Mock()
            return None

        def sleep(seconds):
            elapsed[0] += seconds

        with patch.object(login_flow, "_visible_login_element", side_effect=visible), \
             patch.object(login_flow, "_is_2fa_required", side_effect=lambda _driver: elapsed[0] >= 2), \
             patch.object(login_flow, "_check_logged_in", return_value=True) as logged_in, \
             patch.object(login_flow.time, "monotonic", side_effect=lambda: elapsed[0]), \
             patch.object(login_flow.time, "sleep", side_effect=sleep):
            login_flow._wait_after_saved_account_continue(driver)

        self.assertEqual(elapsed[0], 2)
        logged_in.assert_not_called()

    def test_password_form_wins_over_chooser_left_in_background(self):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"

        def visible(_driver, locators):
            if locators in (LOGIN["saved_account_switch"], LOGIN["password_input"]):
                return Mock()
            return None

        with patch.object(login_flow, "_visible_login_element", side_effect=visible), \
             patch.object(login_flow, "_is_2fa_required", return_value=False), \
             patch.object(login_flow.time, "sleep", side_effect=AssertionError("must not wait")):
            login_flow._wait_after_saved_account_continue(driver)

    @patch.object(login_flow, "_wait_after_password_submit")
    @patch.object(login_flow, "human_sleep")
    @patch.object(login_flow, "human_type")
    @patch.object(login_flow, "_check_logged_in", return_value=False)
    def test_email_field_is_never_treated_as_2fa(self, _logged_in, human_type,
                                                 _sleep, _wait_password):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/login/"
        email = Mock()
        email.is_displayed.return_value = True
        email.get_attribute.side_effect = lambda name: {"id": "email", "name": "email", "type": "text"}.get(name)
        password = Mock()
        password.is_displayed.return_value = True
        submit = Mock()

        def find_elements(_by, locator):
            if locator in LOGIN["two_fa_input"] or locator in LOGIN["email_input"]:
                return [email]
            if locator in LOGIN["password_input"]:
                return [password]
            return []

        driver.find_elements.side_effect = find_elements
        self.assertFalse(login_flow._is_2fa_required(driver))
        self.assertIsNone(login_flow._visible_2fa_input(driver))

        def find_form(_driver, locators, timeout=8):
            if locators == LOGIN["password_input"]:
                return password
            if locators == LOGIN["login_button"]:
                return submit
            raise AssertionError("Unexpected field lookup")

        with patch.object(login_flow, "wait_and_find", side_effect=find_form):
            login_flow._submit_login_form(driver, "12345", "example-password")
        self.assertEqual(human_type.call_count, 2)
        human_type.assert_any_call(email, "12345")
        human_type.assert_any_call(password, "example-password")
        submit.click.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
