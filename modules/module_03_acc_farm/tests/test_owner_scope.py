"""
Owner của nick = id người đang đăng nhập (giống Module 02): Tab 1 phải đọc tài khoản, khóa profile và mở Chrome
theo đúng owner đó, kể cả các lệnh ghi cookie / trạng thái trong login_flow.
"""
import asyncio
import threading
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from modules.module_03_acc_farm import adapters
from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.farming import flow as farming_flow


def fake_request(cookie=None, auth=None):
    req = Mock()
    req.cookies = {"fb_access": cookie} if cookie else {}
    req.headers = {"Authorization": auth} if auth else {}
    return req


class OwnerFromRequestTests(unittest.TestCase):
    def test_no_login_means_local(self):
        self.assertIsNone(adapters.owner_from_request(fake_request()))

    def test_logged_in_user_id_is_owner(self):
        with patch("modules.module_auth.service.bearer_user", return_value={"id": 7, "username": "binh"}) as bearer:
            self.assertEqual(adapters.owner_from_request(fake_request(cookie="tok")), "7")
        self.assertTrue(bearer.call_args.kwargs["require_session"])

    def test_revoked_session_is_rejected(self):
        with patch("modules.module_auth.service.bearer_user", side_effect=HTTPException(401, "SESSION_REVOKED")):
            with self.assertRaises(HTTPException):
                adapters.owner_from_request(fake_request(auth="Bearer x"))


class AccountOwnerTests(unittest.TestCase):
    def setUp(self):
        self.repo = Mock()
        self.repo.get_by_uid.return_value = None
        session = Mock()
        session.__enter__ = Mock(return_value=Mock())
        session.__exit__ = Mock(return_value=False)
        self.patch = patch.object(adapters, "_m02", return_value=(Mock(return_value=session), self.repo))
        self.patch.start()

    def tearDown(self):
        self.patch.stop()

    def owner_used(self):
        return self.repo.get_by_uid.call_args.kwargs["owner_username"]

    def test_default_is_local(self):
        adapters.get_account("100")
        self.assertIsNone(self.owner_used())

    def test_scope_applies_to_calls_without_owner(self):
        with adapters.owner_scope("7"):
            adapters.get_account("100")
            self.assertEqual(self.owner_used(), "7")
            adapters.save_cookie("100", "c_user=100")
            self.assertEqual(self.repo.update_cookies.call_args.kwargs["owner_username"], "7")
            adapters.set_login_status("100", "logged_in")
            self.assertEqual(self.repo.update_login_status.call_args.kwargs["owner_username"], "7")
        adapters.get_account("100")
        self.assertIsNone(self.owner_used())

    def test_explicit_owner_wins(self):
        with adapters.owner_scope("7"):
            adapters.get_account("100", owner="9")
        self.assertEqual(self.owner_used(), "9")

    def test_scope_is_per_thread(self):
        seen = {}

        def other():
            seen["owner"] = adapters.current_owner()

        with adapters.owner_scope("7"):
            t = threading.Thread(target=other)
            t.start()
            t.join()
        self.assertIsNone(seen["owner"])


class WorkerOwnerTests(unittest.TestCase):
    def test_worker_opens_profile_and_reads_account_of_owner(self):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        owners_seen = []
        farm_routes._control = farming_flow.FarmControl()

        def get_account(uid):
            owners_seen.append(adapters.current_owner())
            return {"uid": uid, "profile_name": "Ayu", "proxy": None, "cookie": None,
                    "status": "live", "login_status": "logged_in"}

        with patch.object(farm_routes, "_set_account"), \
                patch.object(farm_routes, "_record_action"), \
                patch.object(farm_routes, "_emit"), \
                patch.object(farm_routes, "_uid_has_other_browser", return_value=False) as other_browser, \
                patch.object(farm_routes, "_build_plan", return_value=[]), \
                patch.object(farm_routes, "dismiss_notice_dialogs"), \
                patch.object(farm_routes.adapters, "get_account", side_effect=get_account), \
                patch.object(farm_routes.adapters, "get_credentials", return_value=("", None)), \
                patch.object(farm_routes.random, "uniform", return_value=0), \
                patch("core.browser.open_browser", return_value=driver) as open_browser, \
                patch("core.browser.get_profile_lock", return_value=threading.Lock()) as get_lock, \
                patch("core.browser.extract_cookies_as_string", return_value=""), \
                patch("modules.module_03_acc_farm.browser.login_flow.ensure_logged_in", return_value={"success": True}):
            farm_routes._farm_worker("100", 1, farm_routes.FarmScenarioConfig(enabled_newsfeed=True), "7")

        self.assertEqual(owners_seen, ["7"])
        other_browser.assert_called_once_with("100", "7")
        get_lock.assert_called_once_with("100", "7")
        self.assertEqual(open_browser.call_args.kwargs["owner"], "7")
        self.assertIsNone(adapters.current_owner())  # không rò owner sang việc khác của thread


class StartOwnerTests(unittest.TestCase):
    def test_start_checks_accounts_of_logged_in_user(self):
        req = farm_routes.FarmStartRequest(uids=["100"], threads=1,
                                           config=farm_routes.FarmScenarioConfig(enabled_newsfeed=True))
        with patch.object(farm_routes.adapters, "owner_from_request", return_value="7"), \
                patch.object(farm_routes.adapters, "get_account", return_value=None) as get_account:
            with self.assertRaises(HTTPException):
                asyncio.run(farm_routes.start_farm_interactions(req, Mock()))
        get_account.assert_called_once_with("100", "7")


if __name__ == "__main__":
    unittest.main()
