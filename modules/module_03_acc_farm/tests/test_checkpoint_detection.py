import threading
import unittest
from datetime import datetime
from unittest.mock import Mock, PropertyMock, patch

from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.browser import login_flow
from modules.module_03_acc_farm.browser.errors import BROWSER_HUNG
from modules.module_03_acc_farm.farming import flow as farming_flow

LF = "modules.module_03_acc_farm.browser.login_flow"
HEAVY_URL = "https://www.facebook.com/checkpoint/1501092823525282/?next=https%3A%2F%2Fwww.facebook.com%2F#"
LIGHT_URL = "https://www.facebook.com/checkpoint/601051028565049/?next=https%3A%2F%2Fwww.facebook.com%2F"


def checkpoint_driver(url: str, dismiss_visible: bool = False) -> Mock:
    driver = Mock()
    driver.current_url = url
    button = Mock()
    button.is_displayed.return_value = True
    dismiss_xpaths = set(login_flow.LOGIN["dismiss_button"])
    driver.find_elements.side_effect = lambda by, loc: [button] if dismiss_visible and loc in dismiss_xpaths else []
    driver.get_cookies.return_value = [{"name": "c_user", "value": "1"}]
    return driver


class CheckpointKindTests(unittest.TestCase):
    def test_not_checkpoint(self):
        self.assertIsNone(login_flow.checkpoint_kind(checkpoint_driver("https://www.facebook.com/")))

    def test_dismiss_button_means_light(self):
        self.assertEqual(login_flow.checkpoint_kind(checkpoint_driver(LIGHT_URL, dismiss_visible=True)), "light")

    def test_no_dismiss_button_means_heavy(self):
        self.assertEqual(login_flow.checkpoint_kind(checkpoint_driver(HEAVY_URL)), "heavy")

    def test_message_has_label_code_and_no_query(self):
        msg = login_flow.checkpoint_message("heavy", HEAVY_URL)
        self.assertTrue(msg.startswith(login_flow.HEAVY_CHECKPOINT_PREFIX))
        self.assertIn("(1501092823525282)", msg)
        self.assertNotIn("?next", msg)
        self.assertTrue(login_flow.checkpoint_message("light", LIGHT_URL).startswith("Checkpoint nhẹ (601051028565049)"))


@patch(f"{LF}.human_sleep")
@patch(f"{LF}.ensure_personal_profile")
@patch(f"{LF}._handle_post_login_popups")
class EnsureLoggedInCheckpointTests(unittest.TestCase):
    def test_checkpoint_on_open_stops_before_cookie_and_form(self, *_):
        driver = checkpoint_driver(HEAVY_URL)
        with patch(f"{LF}._try_cookie_login") as cookie_login, patch(f"{LF}._submit_login_form") as submit:
            result = login_flow.ensure_logged_in(driver, "1", password="pw", two_fa="SECRET", cookie="c_user=1")
        cookie_login.assert_not_called()
        submit.assert_not_called()
        self.assertFalse(result["success"])
        self.assertEqual(result["checkpoint"], "heavy")
        self.assertTrue(result["error"].startswith("Checkpoint nặng (1501092823525282)"))

    def test_cookie_lands_on_checkpoint_skips_form_login(self, *_):
        driver = checkpoint_driver("https://www.facebook.com/")
        driver.get_cookies.return_value = []

        def cookie_login(drv, _cookie):
            drv.current_url = HEAVY_URL
            return False

        with patch(f"{LF}._try_cookie_login", side_effect=cookie_login), \
                patch(f"{LF}._submit_login_form") as submit:
            result = login_flow.ensure_logged_in(driver, "1", password="pw", cookie="c_user=1")
        submit.assert_not_called()
        self.assertEqual(result["checkpoint"], "heavy")

    def test_checkpoint_after_2fa_is_not_reported_as_wrong_code(self, *_):
        driver = checkpoint_driver("https://www.facebook.com/")
        driver.get_cookies.return_value = []

        def pass_2fa_then_checkpoint(drv, _secret):
            drv.current_url = HEAVY_URL
            return False

        with patch(f"{LF}._try_cookie_login", return_value=False), \
                patch(f"{LF}._submit_login_form"), \
                patch(f"{LF}._is_2fa_required", return_value=True), \
                patch(f"{LF}._handle_2fa", side_effect=pass_2fa_then_checkpoint):
            result = login_flow.ensure_logged_in(driver, "1", password="pw", two_fa="SECRET", cookie="c_user=1")
        self.assertEqual(result["checkpoint"], "heavy")
        self.assertNotIn("2FA", result["error"])

    def test_real_2fa_failure_keeps_2fa_message(self, *_):
        driver = checkpoint_driver("https://www.facebook.com/")
        driver.get_cookies.return_value = []
        with patch(f"{LF}._try_cookie_login", return_value=False), \
                patch(f"{LF}._submit_login_form"), \
                patch(f"{LF}._is_2fa_required", return_value=True), \
                patch(f"{LF}._handle_2fa", return_value=False):
            result = login_flow.ensure_logged_in(driver, "1", password="pw", two_fa="SECRET", cookie="c_user=1")
        self.assertIsNone(result["checkpoint"])
        self.assertEqual(result["error"], "Xác thực mã 2FA thất bại")

    def test_form_error_on_checkpoint_page_reports_checkpoint(self, *_):
        driver = checkpoint_driver("https://www.facebook.com/")
        driver.get_cookies.return_value = []

        def form_fails(drv, *_args):
            drv.current_url = HEAVY_URL
            raise RuntimeError("None of 6 locators matched after 8s")

        with patch(f"{LF}._try_cookie_login", return_value=False), \
                patch(f"{LF}._submit_login_form", side_effect=form_fails):
            result = login_flow.ensure_logged_in(driver, "1", password="pw", cookie="c_user=1")
        self.assertEqual(result["checkpoint"], "heavy")


class FarmCheckpointStateTests(unittest.TestCase):
    def test_check_account_state_raises_with_kind(self):
        driver = checkpoint_driver(HEAVY_URL)
        with self.assertRaises(farming_flow.FarmAccountDead) as ctx:
            farming_flow.check_account_state(driver)
        self.assertEqual(ctx.exception.checkpoint, "heavy")
        self.assertTrue(str(ctx.exception).startswith("Checkpoint nặng"))


class WorkerCheckpointTests(unittest.TestCase):
    def run_worker(self, login_result, other_status="PENDING", driver=None):
        driver = driver or Mock()
        driver.current_url = "https://www.facebook.com/"
        farm_routes._control = farming_flow.FarmControl()
        emitted, statuses = [], []
        with farm_routes._state_lock:
            farm_routes._state["accounts"] = {
                "1": {"uid": "1", "name": "Erwin", "status": "RUNNING"},
                "2": {"uid": "2", "name": "Ayu", "status": other_status},
            }
            farm_routes._state["checkpoint_alerts"] = []
        with patch.object(farm_routes, "_set_account"), \
                patch.object(farm_routes, "_emit", side_effect=lambda level, msg, *a: emitted.append((level, msg))), \
                patch.object(farm_routes, "_uid_has_other_browser", return_value=False), \
                patch.object(farm_routes, "dismiss_notice_dialogs"), \
                patch.object(farm_routes.adapters, "get_account", return_value={
                    "uid": "1", "profile_name": "Erwin", "proxy": None, "cookie": "c_user=1",
                    "status": "live", "login_status": "logged_in"}), \
                patch.object(farm_routes.adapters, "get_credentials", return_value=("pw", "SECRET")), \
                patch.object(farm_routes.adapters, "set_login_status",
                             side_effect=lambda uid, status, *a: statuses.append((uid, status))), \
                patch.object(farm_routes.random, "uniform", return_value=0), \
                patch("core.browser.open_browser", return_value=driver), \
                patch("core.browser.get_profile_lock", return_value=threading.Lock()), \
                patch("core.browser.force_kill_driver"), \
                patch("core.browser.extract_cookies_as_string", return_value=""), \
                patch("modules.module_03_acc_farm.browser.login_flow.ensure_logged_in", return_value=login_result):
            farm_routes._farm_worker("1", 1, farm_routes.FarmScenarioConfig(enabled_add_friends=True), None)
        with farm_routes._state_lock:
            alerts = list(farm_routes._state["checkpoint_alerts"])
            farm_routes._state["accounts"] = {}
            farm_routes._state["checkpoint_alerts"] = []
        return emitted, statuses, alerts

    def test_heavy_checkpoint_marks_account_and_warns(self):
        error = "Checkpoint nặng (1501092823525282), URL: https://www.facebook.com/checkpoint/1501092823525282/"
        emitted, statuses, alerts = self.run_worker({"success": False, "error": error, "checkpoint": "heavy"})
        self.assertEqual(statuses, [("1", "checkpoint")])
        self.assertEqual([(a["uid"], a["source"]) for a in alerts], [("1", "session")])
        warnings = [m for level, m in emitted if level == "warning" and "checkpoint nặng" in m]
        self.assertEqual(len(warnings), 1)
        self.assertIn("2", warnings[0])

    def test_light_checkpoint_marks_account_without_cluster_warning(self):
        _, statuses, alerts = self.run_worker({"success": False, "error": "Checkpoint nhẹ (6), URL: x", "checkpoint": "light"})
        self.assertEqual(statuses, [("1", "checkpoint")])
        self.assertEqual(alerts, [])

    def test_lost_session_stays_failed(self):
        _, statuses, alerts = self.run_worker({"success": False, "error": "Xác thực mã 2FA thất bại", "checkpoint": None})
        self.assertEqual(statuses, [("1", "failed")])
        self.assertEqual(alerts, [])

    def test_browser_error_at_login_keeps_account_status(self):
        emitted, statuses, alerts = self.run_worker({"success": False, "error": "Trang Facebook tải quá lâu.",
                                                     "checkpoint": None, "browser_error": True})
        self.assertEqual(statuses, [])
        self.assertEqual(alerts, [])
        self.assertEqual(emitted[-1], ("error", "Trang Facebook tải quá lâu."))

    def test_lost_session_while_browser_hung_keeps_account_status(self):
        # Lệnh đọc cookie treo nên ensure_logged_in báo mất phiên: không được coi là nick hỏng
        driver = Mock()
        type(driver).title = PropertyMock(side_effect=TimeoutError("Read timed out"))
        emitted, statuses, _ = self.run_worker({"success": False, "error": "Đăng nhập thất bại", "checkpoint": None},
                                               driver=driver)
        self.assertEqual(statuses, [])
        self.assertEqual(emitted[-1], ("error", BROWSER_HUNG))

    def test_checkpoint_counts_even_if_browser_hangs_after(self):
        driver = Mock()
        type(driver).title = PropertyMock(side_effect=TimeoutError("Read timed out"))
        _, statuses, _ = self.run_worker({"success": False, "error": "Checkpoint nhẹ (6), URL: x", "checkpoint": "light"},
                                         driver=driver)
        self.assertEqual(statuses, [("1", "checkpoint")])

    def test_warning_without_running_others_has_no_stop_hint(self):
        emitted, _, _ = self.run_worker({"success": False, "error": "Checkpoint nặng, URL: x", "checkpoint": "heavy"},
                                        other_status="COMPLETED")
        warning = next(m for level, m in emitted if level == "warning" and "checkpoint nặng" in m)
        self.assertNotIn("Cân nhắc dừng", warning)


class HistoryAlertTests(unittest.TestCase):
    def test_keeps_latest_per_uid(self):
        rows = [
            {"fb_uid": "1", "fb_name": "Erwin", "error": "Checkpoint nặng A", "finished_at": datetime(2026, 10, 11, 12, 0)},
            {"fb_uid": "2", "fb_name": None, "error": "Checkpoint nặng B", "finished_at": datetime(2026, 10, 11, 10, 0)},
            {"fb_uid": "1", "fb_name": "Erwin", "error": "Checkpoint nặng C", "finished_at": datetime(2026, 10, 10, 9, 0)},
        ]
        with patch.object(farm_routes.repository, "recent_heavy_checkpoints", return_value=rows) as query:
            alerts = farm_routes._history_checkpoint_alerts("m1")
        query.assert_called_once_with("m1", "Checkpoint nặng", farm_routes.CHECKPOINT_ALERT_HOURS)
        self.assertEqual([(a["uid"], a["error"], a["source"]) for a in alerts],
                         [("1", "Checkpoint nặng A", "history"), ("2", "Checkpoint nặng B", "history")])

    def test_db_error_does_not_block_start(self):
        with patch.object(farm_routes.repository, "recent_heavy_checkpoints", side_effect=RuntimeError("db down")):
            self.assertEqual(farm_routes._history_checkpoint_alerts("m1"), [])


if __name__ == "__main__":
    unittest.main()
