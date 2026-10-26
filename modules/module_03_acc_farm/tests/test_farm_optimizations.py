import threading
import unittest
from unittest.mock import Mock, PropertyMock, patch

from modules.module_03_acc_farm import repository
from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.browser import login_flow
from modules.module_03_acc_farm.farming import flow as farming_flow

ACCOUNT = {"uid": "100", "profile_name": "Ayu", "proxy": None, "cookie": None,
           "status": "live", "login_status": "logged_in", "has_password": False, "has_2fa": False}


class WorkerPartialProgressTests(unittest.TestCase):
    def run_worker(self, run_side_effect):
        logs, updates = [], []
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        farm_routes._control = farming_flow.FarmControl()
        with patch.object(farm_routes, "_set_account", side_effect=lambda uid, **f: updates.append(f)), \
                patch.object(farm_routes, "_record_action", side_effect=lambda *a: logs.append(a)), \
                patch.object(farm_routes, "_emit"), \
                patch.object(farm_routes, "_uid_has_other_browser", return_value=False), \
                patch.object(farm_routes, "_build_plan", return_value=[("ADD_FRIEND", {"target": 5})]), \
                patch.object(farm_routes, "_apply_daily_limit", return_value=(5, 0, 20)), \
                patch.object(farm_routes, "run_add_friends", side_effect=run_side_effect), \
                patch.object(farm_routes, "dismiss_notice_dialogs"), \
                patch.object(farm_routes.adapters, "get_account", return_value=dict(ACCOUNT)), \
                patch.object(farm_routes.adapters, "get_credentials", return_value=("", None)), \
                patch.object(farm_routes.random, "uniform", return_value=0), \
                patch("core.browser.open_browser", return_value=driver), \
                patch("core.browser.get_profile_lock", return_value=threading.Lock()), \
                patch("core.browser.extract_cookies_as_string", return_value=""), \
                patch("modules.module_03_acc_farm.browser.login_flow.ensure_logged_in", return_value={"success": True}):
            farm_routes._farm_worker("100", 1, farm_routes.FarmScenarioConfig(enabled_add_friends=True), None)
        return logs, updates

    def test_stop_midway_logs_sent_invitations(self):
        def run(driver, ctl, target, report, progress, **_):
            progress(1)
            progress(2)
            raise farming_flow.FarmStopped()

        logs, updates = self.run_worker(run)
        self.assertEqual(len(logs), 1)
        uid, action, result = logs[0][:3]
        self.assertEqual((uid, action, result["status"], result["quantity"]), ("100", "ADD_FRIEND", "SKIPPED", 2))
        self.assertIn({"friends_sent": 2}, updates)
        self.assertEqual(updates[-1]["status"], "STOPPED")

    def test_error_midway_keeps_partial_quantity(self):
        def run(driver, ctl, target, report, progress, **_):
            progress(3)
            raise RuntimeError("boom")

        logs, _ = self.run_worker(run)
        self.assertEqual((logs[0][2]["status"], logs[0][2]["quantity"]), ("FAILED", 3))


class StopKeepsPartialProgressTests(unittest.TestCase):
    def test_newsfeed_stop_attaches_seconds_and_scrolls(self):
        clock = {"t": 0.0}
        ctl = Mock()
        ctl.paused_total.return_value = 0
        ctl.sleep.side_effect = lambda s: clock.__setitem__("t", clock["t"] + s)
        calls = {"n": 0}

        def checkpoint():
            calls["n"] += 1
            if calls["n"] > 3:
                raise farming_flow.FarmStopped()
        ctl.checkpoint.side_effect = checkpoint
        with patch.object(farming_flow.time, "time", side_effect=lambda: clock["t"]), \
                patch.object(farming_flow, "_open"), patch.object(farming_flow, "human_scroll"), \
                patch.object(farming_flow, "check_account_state"), \
                patch.object(farming_flow.random, "random", return_value=0.99), \
                patch.object(farming_flow.random, "uniform", return_value=10):
            with self.assertRaises(farming_flow.FarmStopped) as ctx:
                farming_flow.run_newsfeed(Mock(current_url="https://www.facebook.com/"), ctl, 600, 5, 15, Mock())
        # uniform giả = 10 nên mỗi vòng có cả nghỉ cuộn ngược 10s lẫn nghỉ đọc 10s: 3 vòng = 60s
        self.assertEqual(ctx.exception.partial, {"seconds": 60, "scrolls": 3, "reactions": 0, "reaction_types": {}})

    def test_worker_records_partial_seconds_when_stopped(self):
        stopped = farming_flow.FarmStopped()
        stopped.partial = {"seconds": 42, "scrolls": 7}
        logs = []
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        farm_routes._control = farming_flow.FarmControl()
        with patch.object(farm_routes, "_set_account"), \
                patch.object(farm_routes, "_record_action", side_effect=lambda *a: logs.append(a)), \
                patch.object(farm_routes, "_emit"), \
                patch.object(farm_routes, "_uid_has_other_browser", return_value=False), \
                patch.object(farm_routes, "_build_plan", return_value=[("NEWSFEED", {"total_seconds": 60, "delay": (5, 9)})]), \
                patch.object(farm_routes, "run_newsfeed", side_effect=stopped), \
                patch.object(farm_routes, "dismiss_notice_dialogs"), \
                patch.object(farm_routes.adapters, "get_account", return_value=dict(ACCOUNT)), \
                patch.object(farm_routes.adapters, "get_credentials", return_value=("", None)), \
                patch.object(farm_routes.random, "uniform", return_value=0), \
                patch("core.browser.open_browser", return_value=driver), \
                patch("core.browser.get_profile_lock", return_value=threading.Lock()), \
                patch("core.browser.extract_cookies_as_string", return_value=""), \
                patch("modules.module_03_acc_farm.browser.login_flow.ensure_logged_in", return_value={"success": True}):
            farm_routes._farm_worker("100", 1, farm_routes.FarmScenarioConfig(enabled_newsfeed=True), None)
        result = logs[0][2]
        self.assertEqual((result["status"], result["seconds"], result["scrolls"]), ("SKIPPED", 42, 7))
        summary = repository.summarize_actions([{"action": "NEWSFEED", **result}])
        self.assertEqual((summary["newsfeed_seconds"], summary["newsfeed_scrolls"]), (42, 7))

    def test_newsfeed_error_attaches_seconds_and_scrolls(self):
        clock = {"t": 0.0}
        ctl = Mock()
        ctl.paused_total.return_value = 0
        ctl.sleep.side_effect = lambda s: clock.__setitem__("t", clock["t"] + s)
        scrolls = {"n": 0}

        def scroll(*_a, **_k):
            scrolls["n"] += 1
            if scrolls["n"] > 2:
                raise TimeoutError("chromedriver không phản hồi")
        with patch.object(farming_flow.time, "time", side_effect=lambda: clock["t"]), \
                patch.object(farming_flow, "_open"), patch.object(farming_flow, "human_scroll", side_effect=scroll), \
                patch.object(farming_flow, "check_account_state"), \
                patch.object(farming_flow.random, "random", return_value=0.99), \
                patch.object(farming_flow.random, "uniform", return_value=10):
            with self.assertRaises(TimeoutError) as ctx:
                farming_flow.run_newsfeed(Mock(current_url="https://www.facebook.com/"), ctl, 600, 5, 15, Mock())
        # Mỗi vòng gọi human_scroll 2 lần (cuộn xuống + cuộn ngược) và nghỉ 2 x 10s: lỗi ở lần cuộn đầu của vòng 2
        self.assertEqual(ctx.exception.partial, {"seconds": 20, "scrolls": 1, "reactions": 0, "reaction_types": {}})


class NewsfeedLeavesHomeTests(unittest.TestCase):
    HOME = "https://www.facebook.com/"
    GROUPS = "https://www.facebook.com/groups/feed/"

    def run_newsfeed(self, open_returns_home, total=200):
        """Lần cuộn thứ 2: người dùng bấm sang Nhóm. open_returns_home=False: mở lại Trang chủ không được."""
        clock = {"t": 0.0}
        ctl = Mock()
        ctl.paused_total.return_value = 0
        ctl.sleep.side_effect = lambda s: clock.__setitem__("t", clock["t"] + s)
        driver = Mock(current_url=self.HOME)
        scrolls = {"n": 0}

        def scroll(*_a, **_k):
            scrolls["n"] += 1
            if scrolls["n"] == 2:
                driver.current_url = self.GROUPS

        def open_page(*_a, **_k):
            if open_returns_home:
                driver.current_url = self.HOME

        with patch.object(farming_flow.time, "time", side_effect=lambda: clock["t"]), \
                patch.object(farming_flow, "_open", side_effect=open_page) as open_mock, \
                patch.object(farming_flow, "human_scroll", side_effect=scroll), \
                patch.object(farming_flow, "check_account_state"), \
                patch.object(farming_flow.random, "random", return_value=0.99), \
                patch.object(farming_flow.random, "uniform", return_value=10):
            result = farming_flow.run_newsfeed(driver, ctl, total, 5, 15, Mock())
        return result, open_mock.call_count, clock["t"]

    def test_leaving_home_reopens_home_and_keeps_scrolling(self):
        result, opens, elapsed = self.run_newsfeed(open_returns_home=True)
        self.assertEqual(result["status"], "SUCCESS")
        self.assertEqual(opens, 2)  # mở đầu + 1 lần mở lại
        self.assertGreaterEqual(elapsed, 200)

    def test_page_keeps_leaving_home_stops_after_reopen_limit(self):
        result, opens, elapsed = self.run_newsfeed(open_returns_home=False, total=600)
        self.assertEqual(result["status"], "SUCCESS")
        self.assertEqual(opens, 1 + farming_flow.NEWSFEED_MAX_REOPENS)
        self.assertLess(elapsed, 600)

    def test_on_home_feed(self):
        def on(url, landing=""):
            return farming_flow._on_home_feed(Mock(current_url=url), landing)
        self.assertTrue(on("https://www.facebook.com/"))
        self.assertTrue(on("https://web.facebook.com/?sk=h_chr"))
        self.assertTrue(on("https://www.facebook.com/home.php"))
        self.assertFalse(on("https://www.facebook.com/groups/feed/"))
        self.assertFalse(on("https://www.facebook.com/watch/"))
        self.assertFalse(on("https://www.facebook.com/profile.php?id=1"))
        self.assertFalse(on("https://example.com/"))
        self.assertTrue(on("https://www.facebook.com/feed/", "/feed/"))

    def test_worker_records_partial_watch_when_browser_hangs(self):
        # Chrome treo giữa Watch: lệnh tiếp theo và cả lệnh kiểm tra driver.title đều timeout
        hung = TimeoutError("Read timed out")
        hung.partial = {"seconds": 1680, "quantity": 12}
        logs = []
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        type(driver).title = PropertyMock(side_effect=TimeoutError("Read timed out"))
        farm_routes._control = farming_flow.FarmControl()
        with patch.object(farm_routes, "_set_account"), \
                patch.object(farm_routes, "_record_action", side_effect=lambda *a: logs.append(a)), \
                patch.object(farm_routes, "_emit"), \
                patch.object(farm_routes, "_uid_has_other_browser", return_value=False), \
                patch.object(farm_routes, "_build_plan", return_value=[("WATCH", {"total_seconds": 1800, "delay": (5, 9)})]), \
                patch.object(farm_routes, "run_watch", side_effect=hung), \
                patch.object(farm_routes, "dismiss_notice_dialogs"), \
                patch.object(farm_routes.adapters, "get_account", return_value=dict(ACCOUNT)), \
                patch.object(farm_routes.adapters, "get_credentials", return_value=("", None)), \
                patch.object(farm_routes.random, "uniform", return_value=0), \
                patch("core.browser.open_browser", return_value=driver), \
                patch("core.browser.get_profile_lock", return_value=threading.Lock()), \
                patch("core.browser.extract_cookies_as_string", return_value=""), \
                patch("modules.module_03_acc_farm.browser.login_flow.ensure_logged_in", return_value={"success": True}):
            farm_routes._farm_worker("100", 1, farm_routes.FarmScenarioConfig(enabled_watch=True), None)
        result = logs[0][2]
        self.assertEqual((result["status"], result["quantity"], result["seconds"]), ("FAILED", 12, 1680))
        summary = repository.summarize_actions([{"action": "WATCH", **result}])
        self.assertEqual((summary["watch_seconds"], summary["watch_videos"]), (1680, 12))


class ProfileNameTests(unittest.TestCase):
    def test_composer_prompt_is_not_a_name(self):
        self.assertEqual(login_flow._clean_profile_name("What's on your mind, Erwin?"), "")
        self.assertEqual(login_flow._clean_profile_name("What’s on your mind, Erwin?"), "")
        self.assertEqual(login_flow._clean_profile_name("Bạn đang nghĩ gì, Riska?"), "")
        self.assertEqual(login_flow._clean_profile_name("Apa yang Anda pikirkan, Ayu?"), "")
        self.assertEqual(login_flow._clean_profile_name("Erwin Mulyadi"), "Erwin Mulyadi")
        self.assertEqual(login_flow._clean_profile_name("What's on your mind, Erwin?\nErwin Mulyadi"), "Erwin Mulyadi")


class DailyLimitDbErrorTests(unittest.TestCase):
    def test_db_error_blocks_action_instead_of_ignoring_limit(self):
        cfg = farm_routes.FarmScenarioConfig(daily_limit_enabled=True)
        with patch.object(farm_routes.repository, "sum_today", side_effect=RuntimeError("db down")):
            with self.assertRaises(RuntimeError):
                farm_routes._apply_daily_limit("100", "ADD_FRIEND", 5, cfg)


class HistorySummaryTests(unittest.TestCase):
    def test_summarize_actions_keeps_order_and_counts(self):
        actions = [
            {"action": "CHECK_NOTIF", "status": "SUCCESS", "quantity": 1, "details": "mở 1"},
            {"action": "WATCH", "status": "SUCCESS", "quantity": 4, "details": "4 video", "seconds": 130},
            {"action": "NEWSFEED", "status": "SUCCESS", "quantity": 0, "details": "x", "seconds": 61, "scrolls": 9},
            {"action": "ADD_FRIEND", "status": "BLOCKED", "quantity": 2, "details": "y", "source": "group_members"},
            {"action": "JOIN_GROUP", "status": "SKIPPED", "quantity": 0, "details": "z"},
        ]
        out = repository.summarize_actions(actions)
        self.assertEqual((out["watch_videos"], out["watch_seconds"]), (4, 130))
        self.assertEqual((out["newsfeed_seconds"], out["newsfeed_scrolls"]), (61, 9))
        self.assertEqual((out["friends_sent"], out["friends_source"]), (2, "group_members"))
        self.assertTrue(out["notif_checked"] and out["notif_opened"])
        self.assertEqual((out["actions_success"], out["actions_blocked"], out["actions_skipped"]), (3, 1, 1))
        import json
        self.assertEqual([a["action"] for a in json.loads(out["actions_summary"])],
                         ["CHECK_NOTIF", "WATCH", "NEWSFEED", "ADD_FRIEND", "JOIN_GROUP"])

    def test_finalize_writes_history_once_and_marks_unfinished_as_failed(self):
        cfg = farm_routes.FarmScenarioConfig(enabled_watch=True)
        state = {"running": True, "accounts": {"100": {"uid": "100", "name": "Ayu", "run_id": 7,
                                                       "status": "RUNNING", "activity": "x", "error": None}}}
        with patch.dict(farm_routes._state, state), \
                patch.dict(farm_routes._history_data, {"100": {"proxy_mode": "none", "actions": []}}, clear=True), \
                patch.object(farm_routes.adapters, "get_machine_id", return_value="m1"), \
                patch.object(farm_routes.repository, "finish_run") as finish:
            farm_routes._finalize("100", cfg, None)
            farm_routes._finalize("100", cfg, None)
        self.assertEqual(finish.call_count, 1)
        run_id, status, error, _activity, history = finish.call_args[0]
        self.assertEqual((run_id, status, history["final_status"], history["machine_id"]), (7, "FAILED", "FAILED", "m1"))
        self.assertTrue(error)


class CsvCellTests(unittest.TestCase):
    def test_formula_like_values_are_escaped(self):
        self.assertEqual(farm_routes._csv_cell("=HYPERLINK(1)"), "'=HYPERLINK(1)")
        self.assertEqual(farm_routes._csv_cell(True), "Có")
        self.assertEqual(farm_routes._csv_cell("Ayu"), "Ayu")


class ProxyHostTests(unittest.TestCase):
    def test_credentials_are_not_kept(self):
        self.assertEqual(farm_routes._proxy_host("1.2.3.4:8080:user:secret"), "1.2.3.4:8080")
        self.assertIsNone(farm_routes._proxy_host(""))


class WriteQueueTests(unittest.TestCase):
    def test_failed_write_is_retried_in_order(self):
        q = repository._WriteQueue()
        calls, attempts = [], {"a": 0}

        def first():
            attempts["a"] += 1
            if attempts["a"] == 1:
                raise RuntimeError("offline")
            calls.append("a")

        with patch.object(repository, "RETRY_SECONDS", 0.05):
            q.start()
            q.put("a", first)
            q.put("b", lambda: calls.append("b"))
            for _ in range(100):
                if len(calls) == 2:
                    break
                threading.Event().wait(0.02)
            q.stop()
        self.assertEqual(calls, ["a", "b"])
        self.assertEqual(attempts["a"], 2)


class WaitForButtonsTests(unittest.TestCase):
    def make_ctl(self, clock):
        ctl = Mock()
        ctl.paused_total.return_value = 0
        ctl.sleep.side_effect = lambda s: clock.__setitem__("t", clock["t"] + s)
        return ctl

    def test_waits_until_slow_page_shows_buttons(self):
        clock = {"t": 0.0}
        ctl = self.make_ctl(clock)
        with patch.object(farming_flow.time, "time", side_effect=lambda: clock["t"]), \
                patch.object(farming_flow, "_find_visible", side_effect=lambda *_: [Mock()] if clock["t"] >= 6 else []):
            self.assertTrue(farming_flow._wait_for_any(Mock(), ctl, []))
        self.assertEqual(clock["t"], 6)

    def test_gives_up_after_timeout_on_empty_page(self):
        clock = {"t": 0.0}
        ctl = self.make_ctl(clock)
        with patch.object(farming_flow.time, "time", side_effect=lambda: clock["t"]), \
                patch.object(farming_flow, "_find_visible", return_value=[]):
            self.assertFalse(farming_flow._wait_for_any(Mock(), ctl, [], timeout=15))
        self.assertEqual(clock["t"], 15)


class OpenReuseTests(unittest.TestCase):
    def test_reuse_skips_reload_on_same_page_only(self):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/?sk=h_chr"
        ctl = Mock()
        with patch.object(farming_flow, "check_account_state"):
            farming_flow._open(driver, ctl, farming_flow.FB_HOME, reuse=True)
            driver.get.assert_not_called()
            farming_flow._open(driver, ctl, farming_flow.FB_HOME)
            driver.get.assert_called_once_with(farming_flow.FB_HOME)
            driver.current_url = "https://www.facebook.com/watch/"
            farming_flow._open(driver, ctl, farming_flow.FB_HOME, reuse=True)
            self.assertEqual(driver.get.call_count, 2)


class EnsureLoggedInTests(unittest.TestCase):
    @patch.object(login_flow, "extract_cookies_as_string", return_value="")
    @patch.object(login_flow, "ensure_personal_profile")
    @patch.object(login_flow, "human_sleep")
    @patch.object(login_flow, "_try_cookie_login")
    @patch.object(login_flow, "_check_logged_in", side_effect=[False, False, True])
    def test_waits_for_slow_session_before_relogin(self, check, cookie_login, *_):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        result = login_flow.ensure_logged_in(driver, "100", password="x", cookie="c_user=100")
        self.assertTrue(result["success"])
        self.assertEqual(check.call_count, 3)
        cookie_login.assert_not_called()
        driver.get.assert_not_called()


class GroupDialogLocatorTests(unittest.TestCase):
    HTML = """
    <html><body>
      <div role="dialog" id="chat"><span>Tin nhắn</span><div role="button" aria-label="Close"></div></div>
      <div role="dialog" id="rules"><input type="checkbox"/><span>Submit</span></div>
    </body></html>
    """

    def test_only_form_dialog_counts_as_group_form(self):
        import urllib.parse
        try:
            from selenium import webdriver
            from selenium.webdriver.common.by import By
            options = webdriver.ChromeOptions()
            options.add_argument("--headless=new")
            driver = webdriver.Chrome(options=options)
        except Exception as e:
            self.skipTest(f"Không mở được Chrome headless: {e}")
        try:
            driver.get("data:text/html;charset=utf-8," + urllib.parse.quote(self.HTML))
            from modules.module_03_acc_farm.farming.locators import FARM_GROUP
            found = driver.find_elements(By.XPATH, FARM_GROUP["open_dialog"][0])
            self.assertEqual([e.get_attribute("id") for e in found], ["rules"])
        finally:
            driver.quit()


class ChromedriverPathTests(unittest.TestCase):
    def setUp(self):
        from core.browser import driver
        self.bm = driver
        self.bm._reset_chromedriver_path()

    def tearDown(self):
        self.bm._reset_chromedriver_path()

    def test_install_called_once_across_threads(self):
        with patch.object(self.bm, "ChromeDriverManager") as manager:
            manager.return_value.install.return_value = "C:/drv/chromedriver.exe"
            results = []
            threads = [threading.Thread(target=lambda: results.append(self.bm._get_chromedriver_path()))
                       for _ in range(5)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        self.assertEqual(manager.return_value.install.call_count, 1)
        self.assertEqual(results, ["C:/drv/chromedriver.exe"] * 5)

    def test_failed_install_falls_back_and_retries_later(self):
        with patch.object(self.bm, "ChromeDriverManager") as manager:
            manager.return_value.install.side_effect = [RuntimeError("offline"), "C:/drv/chromedriver.exe"]
            self.assertIsNone(self.bm._get_chromedriver_path())
            self.assertEqual(self.bm._get_chromedriver_path(), "C:/drv/chromedriver.exe")


if __name__ == "__main__":
    unittest.main()
