import unittest
from unittest.mock import Mock, patch

from modules.module_02_account_manager.services.browser_service import _open_live_browser_worker, _watch_open_browser_login


class OpenBrowserStatusTests(unittest.TestCase):
    def setUp(self):
        from ..services.runtime import stopping
        stopping.clear()

    def test_existing_session_skips_bad_saved_password_and_updates_status(self):
        account = Mock(password="unreadable", two_fa="unreadable", cookie="stored", proxy=None)
        with patch("modules.module_02_account_manager.database.connection.SessionLocal") as session_local, \
             patch("modules.module_02_account_manager.database.repository.AccountRepository.get_by_uid", return_value=account), \
             patch("modules.module_02_account_manager.database.repository.AccountRepository.update_login_status") as update_status, \
             patch("modules.module_02_account_manager.automation.browser_manager.create_driver"), \
             patch("modules.module_02_account_manager.automation.browser_manager.human_sleep"), \
             patch("modules.module_02_account_manager.automation.login_flow._check_logged_in", return_value=True), \
             patch("modules.module_02_account_manager.automation.login_flow._get_profile_name", return_value=""), \
             patch("modules.module_02_account_manager.services.browser_service.decrypt") as decrypt, \
             patch("modules.module_02_account_manager.services.browser_service.broadcast"):
            _open_live_browser_worker("123")
        decrypt.assert_not_called()
        update_status.assert_called_once_with(session_local.return_value, "123", "logged_in", "")

    def test_manual_login_updates_status_after_browser_opens(self):
        driver = Mock(current_url="https://www.facebook.com/")
        mock_db = Mock()
        with patch("modules.module_02_account_manager.database.connection.SessionLocal", return_value=mock_db), \
             patch("modules.module_02_account_manager.services.browser_service.time.sleep"), \
             patch("modules.module_02_account_manager.automation.login_flow._check_logged_in", side_effect=[False, True, True]), \
             patch("modules.module_02_account_manager.automation.login_flow._get_profile_name", return_value="Example Person"), \
             patch("modules.module_02_account_manager.database.repository.AccountRepository.update_login_status") as update_status, \
             patch("modules.module_02_account_manager.services.browser_service.broadcast"):
            _watch_open_browser_login(driver, "123", checks=3, interval=0)
        update_status.assert_called_once_with(mock_db, "123", "logged_in", "Example Person")

    def test_checkpoint_in_open_browser_is_login_failure(self):
        driver = Mock(current_url="https://www.facebook.com/checkpoint/123/?next=/me")
        mock_db = Mock()
        with patch("modules.module_02_account_manager.database.connection.SessionLocal", return_value=mock_db), \
             patch("modules.module_02_account_manager.services.browser_service.time.sleep"), \
             patch("modules.module_02_account_manager.database.repository.AccountRepository.update_login_status") as update_status, \
             patch("modules.module_02_account_manager.services.browser_service.broadcast"):
            _watch_open_browser_login(driver, "123", checks=1, interval=0)
        update_status.assert_called_once_with(mock_db, "123", "failed")


if __name__ == "__main__":
    unittest.main()
