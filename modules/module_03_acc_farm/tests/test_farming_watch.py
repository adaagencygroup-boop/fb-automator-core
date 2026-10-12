import unittest
from unittest.mock import Mock, patch

from modules.module_03_acc_farm.farming import flow as farming_flow


class FakeControl:
    def __init__(self):
        self.elapsed = 0.0

    def checkpoint(self):
        pass

    def sleep(self, seconds):
        self.elapsed += seconds


class FakeTimer:
    def __init__(self, ctl, total_seconds):
        self.ctl = ctl
        self.total = total_seconds

    def elapsed(self):
        return self.ctl.elapsed

    def remaining(self):
        return self.total - self.ctl.elapsed


class FakeVideoDriver:
    def __init__(self, ctl, video_ids, playing=True, url="https://www.facebook.com/watch/"):
        self.ctl = ctl
        self.current_url = url
        self.video_ids = video_ids
        self.index = 0
        self.playing = playing
        self.video = object()

    def execute_script(self, script, *args):
        if script == farming_flow._VISIBLE_VIDEO_JS:
            return self.video
        if script == farming_flow._VIDEO_STATE_JS:
            video_id = self.video_ids[self.index]
            return {
                "keys": video_id if isinstance(video_id, list) else ([video_id] if video_id else []),
                "currentTime": self.ctl.elapsed if self.playing else 0,
                "duration": 30,
                "playing": self.playing,
            }
        if "muted === true" in script or "paused === true" in script:
            return False
        return None

    def scroll(self):
        self.index = (self.index + 1) % len(self.video_ids)


class WatchCountingTests(unittest.TestCase):
    def run_scenario(self, video_ids, playing=True, url="https://www.facebook.com/watch/",
                     arrow_advances=True, total=15):
        ctl = FakeControl()
        driver = FakeVideoDriver(ctl, video_ids, playing, url)
        self.driver = driver
        chains = Mock()
        chains.move_to_element.return_value = chains
        chains.pause.return_value = chains
        self.scrolls = []
        self.arrows = []

        def send_keys(key):
            self.arrows.append(key)
            if arrow_advances and key == farming_flow.Keys.ARROW_DOWN:
                driver.scroll()
            return chains

        chains.send_keys.side_effect = send_keys
        with patch.object(farming_flow, "_open") as self.open_mock, \
             patch.object(farming_flow, "ActiveTimer", FakeTimer), \
             patch.object(farming_flow, "ActionChains", return_value=chains), \
             patch.object(farming_flow, "_find_visible", return_value=[]), \
             patch.object(farming_flow, "human_scroll",
                          side_effect=lambda *a, **k: (self.scrolls.append(k), driver.scroll())), \
             patch.object(farming_flow, "check_account_state"):
            return farming_flow.run_watch(driver, ctl, total, 2, 2, lambda _: None)

    def test_repeated_short_videos_count_once_each(self):
        result = self.run_scenario(["fb:12345", "fb:67890", "fb:12345"])
        self.assertEqual(result["status"], "SUCCESS")
        self.assertEqual(result["quantity"], 2)
        self.assertIn("2 video khác nhau", result["details"])

    def test_video_without_verified_playback_is_not_counted(self):
        result = self.run_scenario(["fb:12345"], playing=False)
        self.assertEqual(result["status"], "SKIPPED")
        self.assertEqual(result["quantity"], 0)

    def test_same_video_with_different_link_still_counts_once(self):
        result = self.run_scenario([
            ["fb:12345", "media:cdn.example/clip.mp4"],
            ["fb:67890", "media:cdn.example/clip.mp4"],
        ])
        self.assertEqual(result["quantity"], 1)

    def test_reel_viewer_advances_with_arrow_down_not_space(self):
        result = self.run_scenario(["fb:111", "fb:222", "fb:333"], url="https://web.facebook.com/reel/111")
        self.assertEqual(result["quantity"], 3)
        self.assertTrue(self.arrows)
        self.assertTrue(all(k == farming_flow.Keys.ARROW_DOWN for k in self.arrows))
        self.assertEqual(self.scrolls, [])

    def test_feed_scroll_never_uses_keys(self):
        self.run_scenario(["fb:12345", "fb:67890"])
        self.assertTrue(self.scrolls)
        self.assertTrue(all(k.get("allow_keys") is False for k in self.scrolls))

    def test_stuck_reel_reloads_watch_then_stops(self):
        result = self.run_scenario(["fb:111"], url="https://web.facebook.com/reel/111",
                                   arrow_advances=False, total=600)
        self.assertEqual(result["quantity"], 1)
        # 1 lần mở đầu + WATCH_MAX_RELOADS lần tải lại, rồi dừng sớm thay vì kẹt hết 600 giây
        self.assertEqual(self.open_mock.call_count, 1 + farming_flow.WATCH_MAX_RELOADS)
        self.assertLess(self.ctl_elapsed(), 600)

    def ctl_elapsed(self):
        return self.driver.ctl.elapsed

    def test_video_without_identity_is_not_counted(self):
        result = self.run_scenario([None])
        self.assertEqual(result["status"], "SKIPPED")
        self.assertEqual(result["quantity"], 0)


if __name__ == "__main__":
    unittest.main()
