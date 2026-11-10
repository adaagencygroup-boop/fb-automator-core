"""
Test core/browser: profile dùng chung với Module 02, khóa profile, cấu hình theo seed, script dấu vân tay,
danh sách Chrome đang mở và xử lý proxy chết. Không mở Chrome, không cần DB.
"""
import os
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

from core.browser import driver as core_driver
from core.browser import fingerprint, profile
from core.browser.fingerprint import (
    LOCALE_CONFIGS, TYPING_PROFILES, WINDOW_SIZES, BrowserConfig, _pick_by_seed, build_init_script,
)


class TestProfilePath(unittest.TestCase):
    """Đường dẫn profile phải trùng Module 02 để 2 module mở cùng 1 thư mục cho 1 nick."""

    def test_matches_module_02_layout(self):
        from modules.module_02_account_manager.context import owner_scope
        from modules.module_02_account_manager.utils import paths as m02_paths

        for owner in (None, "", "  alice  ", "bob@example.com"):
            with owner_scope(owner):
                expected = m02_paths.profile_path("61594939420665")
            self.assertEqual(profile.profile_path("61594939420665", owner), expected, f"owner={owner!r}")

    def test_local_and_owner_directories(self):
        self.assertEqual(profile.owner_directory(None), "local")
        self.assertEqual(profile.owner_directory("   "), "local")
        self.assertEqual(len(profile.owner_directory("alice")), 64)
        self.assertNotEqual(profile.owner_directory("alice"), profile.owner_directory("bob"))

    def test_rejects_invalid_uid(self):
        for bad in ("", "abc", "12/34", "..", "1" * 51):
            with self.assertRaises(ValueError):
                profile.profile_path(bad)

    def test_get_profile_path_creates_directory(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(profile, "PROFILES_DIR", tmp):
            path = profile.get_profile_path("123456", "alice")
            self.assertTrue(os.path.isdir(path))
            self.assertTrue(path.startswith(os.path.realpath(tmp)))


class TestProfileLock(unittest.TestCase):

    def test_same_profile_same_lock(self):
        self.assertIs(profile.get_profile_lock("111"), profile.get_profile_lock("111", None))
        self.assertIs(profile.get_profile_lock("111", "alice"), profile.get_profile_lock("111", " alice "))

    def test_other_uid_or_owner_other_lock(self):
        self.assertIsNot(profile.get_profile_lock("111"), profile.get_profile_lock("222"))
        self.assertIsNot(profile.get_profile_lock("111"), profile.get_profile_lock("111", "alice"))


class TestBrowserConfig(unittest.TestCase):
    """Cùng seed -> cùng cấu hình; khác seed -> khác cấu hình."""

    def _config(self, seed, mode="native"):
        return BrowserConfig.from_fingerprint(f"uid_{seed}", {"canvas_seed": seed, "mode": mode})

    def test_same_seed_same_config(self):
        self.assertEqual(self._config(42), self._config(42))

    def test_different_seeds_spread(self):
        configs = [self._config(s) for s in range(20)]
        self.assertGreater(len({c.window_size for c in configs}), 1)
        self.assertGreater(len({c.languages_js for c in configs}), 1)

    def test_legacy_uses_seed_1(self):
        cfg = BrowserConfig.from_fingerprint("u", {"canvas_seed": None, "mode": "legacy"})
        self.assertEqual((cfg.mode, cfg.seed), ("legacy", 1))

    def test_all_table_entries_reachable(self):
        for table in (WINDOW_SIZES, LOCALE_CONFIGS, TYPING_PROFILES):
            seen = {repr(_pick_by_seed(s, table)) for s in range(1000)}
            self.assertEqual(len(seen), len(table))


class TestInitScript(unittest.TestCase):

    def test_native_has_noise_with_seed(self):
        script = build_init_script(BrowserConfig.from_fingerprint("u", {"canvas_seed": 777, "mode": "native"}))
        self.assertIn("const SEED = 777 >>> 0", script)
        for api in ("getImageData", "toDataURL", "readPixels", "getFloatFrequencyData", "getChannelData"):
            self.assertIn(api, script)

    def test_legacy_has_no_noise(self):
        script = build_init_script(BrowserConfig.from_fingerprint("u", {"canvas_seed": None, "mode": "legacy"}))
        self.assertNotIn("SEED", script)
        self.assertIn("navigator, 'webdriver'", script)

    def test_languages_follow_seed(self):
        cfg = BrowserConfig.from_fingerprint("u", {"canvas_seed": 3, "mode": "native"})
        self.assertIn(cfg.languages_js, build_init_script(cfg))

    def test_no_user_agent_or_plugins_override(self):
        script = build_init_script(BrowserConfig.from_fingerprint("u", {"canvas_seed": 5, "mode": "native"}))
        self.assertNotIn("userAgent", script)
        self.assertNotIn("plugins", script)


class TestResolveFingerprint(unittest.TestCase):

    def test_new_profile_is_native_used_profile_is_legacy(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(fingerprint, "get_or_create_fingerprint",
                             side_effect=lambda uid, used: {"mode": "legacy" if used else "native",
                                                            "canvas_seed": None if used else 9}) as get:
            self.assertEqual(fingerprint.resolve_fingerprint("1", tmp)["mode"], "native")
            os.makedirs(os.path.join(tmp, "Default"))
            self.assertEqual(fingerprint.resolve_fingerprint("1", tmp)["mode"], "legacy")
            self.assertEqual([c.args[1] for c in get.call_args_list], [False, True])

    def test_db_error_blocks_browser(self):
        with patch.object(fingerprint, "get_or_create_fingerprint", side_effect=Exception("db down")):
            with self.assertRaises(RuntimeError):
                fingerprint.resolve_fingerprint("1", tempfile.gettempdir())


class TestActiveDrivers(unittest.TestCase):

    def setUp(self):
        core_driver._active_drivers.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.dir_patch = patch.object(profile, "PROFILES_DIR", self.tmp.name)
        self.dir_patch.start()

    def tearDown(self):
        core_driver._active_drivers.clear()
        self.dir_patch.stop()
        self.tmp.cleanup()

    def test_filter_by_uid_owner_and_scope(self):
        a, b, c = object(), object(), object()
        core_driver.register_active_driver(a, "1", scope="farm")
        core_driver.register_active_driver(b, "1", owner="alice", scope="seeding")
        core_driver.register_active_driver(c, "2", scope="farm")
        self.assertEqual(core_driver.get_active_drivers("1"), [a])
        self.assertEqual(core_driver.get_active_drivers("1", "alice"), [b])
        self.assertEqual(set(core_driver.get_active_drivers(scope="farm")), {a, c})

    def test_close_driver_for_uid_runs_hook_then_closes_only_that_profile(self):
        events = []
        mine, other = MagicMock(), MagicMock()
        mine.window_handles = []
        mine.quit.side_effect = lambda: events.append("quit")
        core_driver.register_active_driver(mine, "1", on_before_close=lambda d: events.append("hook"))
        core_driver.register_active_driver(other, "2")
        core_driver.close_driver_for_uid("1")
        self.assertEqual(events, ["hook", "quit"])
        other.quit.assert_not_called()
        self.assertEqual(core_driver.get_active_drivers(), [other])

    def test_close_scoped_default_closes_whole_scope(self):
        a, b, c = MagicMock(), MagicMock(), MagicMock()
        for d in (a, b, c):
            d.window_handles = []
        core_driver.register_active_driver(a, "1", scope="scan")
        core_driver.register_active_driver(b, "2", scope="scan")
        core_driver.register_active_driver(c, "3", scope="farm")
        closed = core_driver.close_scoped_active_drivers(scope="scan")
        self.assertEqual(sorted(closed), ["1", "2"])
        self.assertEqual(core_driver.get_active_drivers(), [c])

    def test_close_scoped_filters_by_uids_and_exclude_uids(self):
        a, b, c = MagicMock(), MagicMock(), MagicMock()
        for d in (a, b, c):
            d.window_handles = []
        core_driver.register_active_driver(a, "1", scope="scan")
        core_driver.register_active_driver(b, "2", scope="scan")
        core_driver.register_active_driver(c, "3", scope="scan")

        self.assertEqual(core_driver.close_scoped_active_drivers(scope="scan", uids=["2"]), ["2"])
        b.quit.assert_called_once()
        self.assertEqual(set(core_driver.get_active_drivers(scope="scan")), {a, c})

        self.assertEqual(core_driver.close_scoped_active_drivers(scope="scan", exclude_uids={"1"}), ["3"])
        a.quit.assert_not_called()
        self.assertEqual(core_driver.get_active_drivers(scope="scan"), [a])


class TestProxyFailure(unittest.TestCase):
    """Proxy chết: mặc định chạy IP máy (như hiện tại); allow_direct_fallback=False thì không mở Chrome."""

    def _open(self, allow):
        cfg = BrowserConfig.from_fingerprint("1", {"canvas_seed": 2, "mode": "native"})
        fake = MagicMock()
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(profile, "PROFILES_DIR", tmp), \
                patch.object(core_driver, "resolve_browser_config", return_value=cfg), \
                patch.object(core_driver, "test_proxy_connectivity", side_effect=Exception("timeout")), \
                patch.object(core_driver, "_get_chromedriver_path", return_value=None), \
                patch.object(core_driver.webdriver, "Chrome", return_value=fake) as chrome:
            try:
                driver = core_driver.open_browser("1", proxy="1.2.3.4:8080:u:p", allow_direct_fallback=allow)
            finally:
                core_driver._active_drivers.clear()
            return driver, chrome

    def test_fallback_opens_without_proxy(self):
        driver, chrome = self._open(True)
        args = chrome.call_args.kwargs["options"].arguments
        self.assertFalse(any(a.startswith("--proxy-server") for a in args))
        self.assertEqual(driver.proxy_mode, "none")

    def test_no_fallback_raises_and_never_opens(self):
        from core.browser import ProxyConnectionError
        with self.assertRaises(ProxyConnectionError):
            self._open(False)

    def test_flags_follow_config_and_no_user_agent(self):
        driver, chrome = self._open(True)
        args = chrome.call_args.kwargs["options"].arguments
        cfg = driver.browser_config
        self.assertIn(f"--lang={cfg.lang_flag}", args)
        self.assertIn(f"--window-size={cfg.window_size[0]},{cfg.window_size[1]}", args)
        self.assertFalse(any(a.startswith("--user-agent") for a in args))

    def test_window_not_maximized_and_webrtc_proxied_only(self):
        _, chrome = self._open(True)
        options = chrome.call_args.kwargs["options"]
        # --start-maximized đè --window-size: mọi nick cùng 1 khung bằng màn hình máy
        self.assertNotIn("--start-maximized", options.arguments)
        # STUN không đi thẳng ra mạng, không lộ IP thật của máy
        self.assertIn("--force-webrtc-ip-handling-policy=disable_non_proxied_udp", options.arguments)
        prefs = options.experimental_options["prefs"]
        self.assertEqual(prefs["webrtc.ip_handling_policy"], "disable_non_proxied_udp")
        self.assertFalse(prefs["webrtc.nonproxied_udp_enabled"])


class TestProfileRelease(unittest.TestCase):
    def test_matches_only_the_automation_profile(self):
        profile_path = r"F:\app\tool py\fb-automator-core\data\browser_profiles\abc\61577351974413"
        self.assertTrue(core_driver._command_uses_profile(
            ["chrome.exe", f"--user-data-dir={profile_path}"],
            profile_path,
        ))
        self.assertFalse(core_driver._command_uses_profile(
            ["chrome.exe", r"--user-data-dir=C:\Users\me\AppData\Local\Google\Chrome\User Data"],
            profile_path,
        ))
        self.assertFalse(core_driver._command_uses_profile(["chromedriver.exe", "--port=1"], profile_path))


if __name__ == "__main__":
    unittest.main()
