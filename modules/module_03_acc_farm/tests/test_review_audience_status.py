"""Review audience không được nhận là acc chết, và thiếu fb_accounts không được giết luồng."""
import unittest
from unittest.mock import Mock, patch

from modules.module_03_acc_farm import post_flow, post_repository
from modules.module_03_acc_farm.post_flow import PostAccountDead


class _Shown:
    def is_displayed(self):
        return True


class _Driver:
    def __init__(self, mode="none"):
        self.current_url = "https://www.facebook.com/"
        self.mode = mode
        self.xpaths = []

    def find_elements(self, by, sel):
        self.xpaths.append(sel)
        if self.mode == "switch" and "Use another" in sel:
            return [_Shown()]
        if (
            self.mode == "page_continue"
            and "Tiếp tục" in sel
            and "ancestor::div[@role='dialog']" in sel
        ):
            return [_Shown()]
        return []


class SavedAccountScreenTests(unittest.TestCase):
    def test_continue_inside_dialog_is_not_saved_account(self):
        driver = _Driver("none")
        self.assertFalse(post_flow.is_saved_account_screen(driver))
        continue_xpaths = [x for x in driver.xpaths if "Tiếp tục" in x or "Continue" in x]
        self.assertTrue(continue_xpaths)
        self.assertTrue(all("ancestor::div[@role='dialog']" in x for x in continue_xpaths))

    def test_full_page_continue_still_saved_account(self):
        self.assertTrue(post_flow.is_saved_account_screen(_Driver("page_continue")))

    def test_use_another_still_saved_account(self):
        self.assertTrue(post_flow.is_saved_account_screen(_Driver("switch")))


class HealthGuardTests(unittest.TestCase):
    def test_open_composer_skips_saved_account_check(self):
        driver = _Driver()
        with patch.object(post_flow, "_dialog_text", return_value=""), \
                patch.object(post_flow, "is_composer_dialog_open", return_value=True), \
                patch.object(post_flow, "is_saved_account_screen", return_value=True) as saved:
            post_flow.check_account_health(driver)
        saved.assert_not_called()

    def test_saved_account_still_dead_when_composer_closed(self):
        driver = _Driver()
        with patch.object(post_flow, "_dialog_text", return_value=""), \
                patch.object(post_flow, "is_composer_dialog_open", return_value=False), \
                patch.object(post_flow, "is_saved_account_screen", return_value=True):
            with self.assertRaises(PostAccountDead):
                post_flow.check_account_health(driver)


class _Cursor:
    def __init__(self, bag):
        self.bag = bag

    def execute(self, sql, params=None):
        self.bag.append(sql)


class _Session:
    def __init__(self, bag):
        self.bag = bag

    def __enter__(self):
        return _Cursor(self.bag)

    def __exit__(self, *args):
        return False


class FinishPostTests(unittest.TestCase):
    def test_die_without_fb_accounts_does_not_raise(self):
        bag = []
        executed = []

        def execute(sql, params=()):
            executed.append(sql)
            if "fb_accounts" in sql:
                raise Exception('relation "fb_accounts" does not exist')

        with patch.object(post_repository.db, "_normalize_query", side_effect=lambda q: q), \
                patch.object(post_repository.db, "session", return_value=_Session(bag)), \
                patch.object(post_repository.db, "execute", side_effect=execute):
            post_repository.finish_post("p1", "61577610087404", "DIE", message="dead")

        joined = "\n".join(bag)
        self.assertIn("UPDATE posts", joined)
        self.assertIn("status = 'PENDING'", joined)
        self.assertNotIn("fb_accounts", joined)
        self.assertTrue(any("fb_accounts" in sql for sql in executed))


class SaveClickTests(unittest.TestCase):
    def _driver(self, state):
        driver = Mock()
        save = Mock()

        def script(src, *args):
            if "return document.querySelector" in src:
                return save
            return state

        driver.execute_script.side_effect = script
        return driver

    def test_disabled_save_does_not_count_as_saved(self):
        state = {
            "found": True,
            "disabled": True,
            "aria": "true",
            "rect": {"top": 12, "bottom": 40, "boxHeight": 320},
            "inView": True,
            "hitOk": True,
            "hitText": "Save",
        }
        logs = []
        with patch.object(post_flow.HumanInteraction, "click", return_value=None):
            result = post_flow._click_update_settings_save(self._driver(state), logs.append)
        self.assertEqual(result, "failed")
        self.assertTrue(any("Save disabled sau khi chọn Public" in line for line in logs))
        self.assertTrue(any("rect=" in line for line in logs))

    def test_success_only_when_dialog_closes(self):
        state = {
            "found": True,
            "disabled": False,
            "aria": None,
            "rect": {"top": 12, "bottom": 40, "boxHeight": 320},
            "inView": True,
            "hitOk": True,
            "hitText": "Save",
        }
        logs = []
        with patch.object(post_flow.HumanInteraction, "click", return_value=None), \
                patch.object(post_flow, "_settings_dialog_still", return_value=False):
            result = post_flow._click_update_settings_save(self._driver(state), logs.append)
        self.assertEqual(result, "closed")
        self.assertTrue(any("disabled=False" in line for line in logs))


class DismissReviewAudienceTests(unittest.TestCase):
    def test_missing_dialog_returns_false(self):
        driver = Mock()
        driver.execute_script.return_value = "none"
        self.assertTrue(post_flow._dismiss_review_audience_dialog(driver))
        self.assertEqual(driver.execute_script.call_count, 1)

    def test_script_error_does_not_raise(self):
        driver = Mock()
        driver.execute_script.side_effect = RuntimeError("dead driver")
        self.assertFalse(post_flow._dismiss_review_audience_dialog(driver))

    def test_clicks_continue_then_public_save(self):
        driver = Mock()
        driver.execute_script.side_effect = ["review", False, "settings_ready", "none"]
        logs = []
        with patch.object(post_flow, "_click_update_settings_save", return_value="closed"):
            self.assertTrue(post_flow._dismiss_review_audience_dialog(driver, logs.append))
        self.assertIn("Đã đóng modal Review audience", logs)
        self.assertIn("Đã chọn Public và lưu audience mặc định", logs)

    def test_save_not_closed_does_not_log_success(self):
        driver = Mock()
        driver.execute_script.return_value = "settings_ready"
        logs = []
        with patch.object(post_flow, "_click_update_settings_save", return_value="failed"):
            self.assertFalse(post_flow._dismiss_review_audience_dialog(driver, logs.append))
        self.assertNotIn("Đã chọn Public và lưu audience mặc định", logs)

    def test_does_not_log_save_when_public_not_selected(self):
        driver = Mock()
        driver.execute_script.return_value = "public_unconfirmed"
        logs = []
        with patch.object(post_flow, "_select_update_settings_public", return_value="public_failed"):
            self.assertEqual(post_flow._dismiss_review_audience_dialog(driver, logs.append), "public_failed")
        self.assertNotIn("Đã chọn Public và lưu audience mặc định", logs)
        self.assertIn("public_failed", logs)

    def test_public_confirmed_requires_friends_off(self):
        self.assertTrue(post_flow._public_radios_confirmed([
            {"text": "Public Anyone on or off Facebook", "checked": "true"},
            {"text": "Friends Your Facebook friends", "checked": "false"},
        ]))
        self.assertFalse(post_flow._public_radios_confirmed([
            {"text": "Public Anyone on or off Facebook", "checked": "false"},
            {"text": "Friends Your Facebook friends", "checked": "true"},
        ]))


if __name__ == "__main__":
    unittest.main()
