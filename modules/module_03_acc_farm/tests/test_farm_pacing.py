import unittest
from unittest.mock import Mock, patch

from modules.module_03_acc_farm.browser import manager as browser_manager
from modules.module_03_acc_farm.farming import flow as farming_flow
from modules.module_03_acc_farm import routes as farm_routes


class DelayConfigTests(unittest.TestCase):
    def normalize(self, **fields):
        return farm_routes._normalize_config(farm_routes.FarmScenarioConfig(**fields))

    def test_defaults_match_previous_fixed_delays(self):
        cfg = self.normalize()
        self.assertEqual((cfg.friends_delay_min, cfg.friends_delay_max), (5, 15))
        self.assertEqual((cfg.groups_delay_min, cfg.groups_delay_max), (10, 20))

    def test_floor_swap_and_cap(self):
        cfg = self.normalize(friends_delay_min=0, friends_delay_max=1,
                             groups_delay_min=9999, groups_delay_max=2)
        self.assertEqual((cfg.friends_delay_min, cfg.friends_delay_max), (3, 3))
        self.assertEqual((cfg.groups_delay_min, cfg.groups_delay_max), (5, 3600))


class PickButtonTests(unittest.TestCase):
    def test_picks_randomly_within_window_and_skips_clicked(self):
        buttons = [Mock(id=str(i)) for i in range(15)]
        picked = set()
        with patch.object(farming_flow, "_find_visible", return_value=buttons), \
                patch.object(farming_flow, "human_scroll"), \
                patch.object(farming_flow.random, "random", return_value=0.99):
            for _ in range(200):
                picked.add(farming_flow._pick_button(Mock(), Mock(), [], {"0"}).id)
        self.assertNotIn("0", picked)
        self.assertTrue(picked.issubset({str(i) for i in range(1, 11)}))
        self.assertGreater(len(picked), 3)

    def test_returns_none_when_nothing_left(self):
        with patch.object(farming_flow, "_find_visible", return_value=[Mock(id="a")]):
            self.assertIsNone(farming_flow._pick_button(Mock(), Mock(), [], {"a"}))


class PauseBetweenTests(unittest.TestCase):
    def test_normal_pause_stays_in_user_range(self):
        ctl = Mock()
        with patch.object(farming_flow.random, "random", return_value=0.9):
            farming_flow._pause_between(Mock(), ctl, (7, 9), Mock(), "x")
        self.assertEqual(ctl.sleep.call_count, 1)
        self.assertTrue(7 <= ctl.sleep.call_args[0][0] <= 9)

    def test_long_pause_scrolls_and_reports(self):
        clock = {"t": 0.0}
        ctl = Mock()
        ctl.sleep.side_effect = lambda s: clock.__setitem__("t", clock["t"] + s)
        report = Mock()
        with patch.object(farming_flow.random, "random", return_value=0.0), \
                patch.object(farming_flow.time, "time", side_effect=lambda: clock["t"]), \
                patch.object(farming_flow, "human_scroll") as scroll:
            farming_flow._pause_between(Mock(), ctl, (5, 15), report, "Kết bạn 1/3")
        self.assertGreaterEqual(clock["t"], farming_flow.LONG_PAUSE_RANGE[0])
        self.assertTrue(scroll.called)
        self.assertIn("nghỉ", report.call_args[0][0])


class CookiePersistTests(unittest.TestCase):
    def test_injected_cookies_have_expiry_so_profile_keeps_session(self):
        driver = Mock()
        with patch.object(browser_manager.time, "sleep"):
            browser_manager.load_cookies(driver, "c_user=100;xs=abc;fr=zzz")
        added = [c.args[0] for c in driver.add_cookie.call_args_list if c.args[0]["name"] != "locale"]
        self.assertEqual({c["name"] for c in added}, {"c_user", "xs", "fr"})
        for cookie in added:
            self.assertTrue(cookie["secure"])
            self.assertGreater(cookie["expiry"], browser_manager.time.time() + 300 * 24 * 3600)


if __name__ == "__main__":
    unittest.main()
