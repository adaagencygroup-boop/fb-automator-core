"""
Test cô lập dữ liệu giữa các profile.
Kiểm tra: profile path riêng, BrowserConfig khác nhau, fingerprint seed cô lập.
"""
import os
import unittest
from unittest.mock import patch

from modules.module_03_acc_farm.browser.manager import (
    BrowserConfig, WINDOW_SIZES, LOCALE_CONFIGS, TYPING_PROFILES,
    _pick_by_seed,
)
from modules.module_03_acc_farm.browser.paths import get_profile_path


class TestProfilePathIsolation(unittest.TestCase):
    """Mỗi UID có thư mục profile riêng, không trùng nhau."""

    def test_different_uids_get_different_paths(self):
        path_a = get_profile_path("111111")
        path_b = get_profile_path("222222")
        self.assertNotEqual(path_a, path_b)

    def test_same_uid_gets_same_path(self):
        self.assertEqual(get_profile_path("333333"), get_profile_path("333333"))

    def test_profile_path_contains_uid(self):
        path = get_profile_path("444444")
        self.assertIn("444444", path)

    def test_profile_path_is_absolute(self):
        self.assertTrue(os.path.isabs(get_profile_path("555555")))


class TestBrowserConfigIsolation(unittest.TestCase):
    """Khác seed → khác config; cùng seed → cùng config."""

    def _make_config(self, seed: int, mode: str = "native") -> BrowserConfig:
        return BrowserConfig.from_fingerprint(f"uid_{seed}", {"canvas_seed": seed, "mode": mode})

    def test_same_seed_produces_same_config(self):
        a = self._make_config(42)
        b = self._make_config(42)
        self.assertEqual(a.window_size, b.window_size)
        self.assertEqual(a.lang_flag, b.lang_flag)
        self.assertEqual(a.languages_js, b.languages_js)
        self.assertEqual(a.type_delay, b.type_delay)
        self.assertEqual(a.sleep_factor, b.sleep_factor)

    def test_different_seeds_can_differ(self):
        configs = [self._make_config(s) for s in range(20)]
        window_sizes = {c.window_size for c in configs}
        lang_flags = {c.lang_flag for c in configs}
        self.assertGreater(len(window_sizes), 1, "20 seed khác nhau phải tạo ra nhiều hơn 1 window size")
        self.assertGreater(len(lang_flags), 1, "20 seed khác nhau phải tạo ra nhiều hơn 1 lang flag")

    def test_legacy_mode_uses_seed_1_as_default(self):
        cfg = self._make_config(seed=0, mode="legacy")
        self.assertEqual(cfg.mode, "legacy")
        self.assertEqual(cfg.seed, 1)

    def test_all_window_sizes_are_reachable(self):
        seen = set()
        for s in range(1000):
            seen.add(_pick_by_seed(s, WINDOW_SIZES))
        self.assertEqual(len(seen), len(WINDOW_SIZES))

    def test_all_locale_configs_are_reachable(self):
        seen = set()
        for s in range(1000):
            cfg = _pick_by_seed(s, LOCALE_CONFIGS)
            seen.add(cfg["lang_flag"])
        self.assertEqual(len(seen), len({lc["lang_flag"] for lc in LOCALE_CONFIGS}))

    def test_all_typing_profiles_are_reachable(self):
        seen = set()
        for s in range(1000):
            tp = _pick_by_seed(s, TYPING_PROFILES)
            seen.add(tp["sleep_factor"])
        self.assertEqual(len(seen), len(TYPING_PROFILES))


class TestFingerprintSeedIsolation(unittest.TestCase):
    """Fingerprint seed xác định → JS noise khác nhau giữa các nick."""

    def test_noise_js_contains_seed(self):
        from modules.module_03_acc_farm.browser.manager import _FINGERPRINT_NOISE_JS
        self.assertIn("__SEED__", _FINGERPRINT_NOISE_JS)

    def test_noise_js_has_audio_context(self):
        from modules.module_03_acc_farm.browser.manager import _FINGERPRINT_NOISE_JS
        self.assertIn("AnalyserNode", _FINGERPRINT_NOISE_JS)
        self.assertIn("AudioBuffer", _FINGERPRINT_NOISE_JS)
        self.assertIn("getFloatFrequencyData", _FINGERPRINT_NOISE_JS)
        self.assertIn("getChannelData", _FINGERPRINT_NOISE_JS)


if __name__ == "__main__":
    unittest.main()
