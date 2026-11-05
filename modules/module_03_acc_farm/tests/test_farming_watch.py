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


class StaleVideoDriver(FakeVideoDriver):
    """Lần hỏi trạng thái video thứ stale_at: phần tử đã bị gỡ khỏi trang; leave_to = trang đã chuyển sang URL này."""

    def __init__(self, ctl, video_ids, stale_at, leave_to=None, **kwargs):
        super().__init__(ctl, video_ids, **kwargs)
        self.state_calls = 0
        self.stale_at = stale_at
        self.leave_to = leave_to

    def execute_script(self, script, *args):
        if script == farming_flow._VIDEO_STATE_JS:
            self.state_calls += 1
            if self.state_calls == self.stale_at:
                if self.leave_to:
                    self.current_url = self.leave_to
                raise farming_flow.StaleElementReferenceException("stale element reference")
        return super().execute_script(script, *args)


class LikeDriver(FakeVideoDriver):
    """likes[i]: kết quả tìm nút Like của video thứ i (theo thứ tự xem), hết danh sách thì không thấy nút."""

    def __init__(self, ctl, video_ids, likes):
        super().__init__(ctl, video_ids)
        self.likes = list(likes)

    def execute_script(self, script, *args):
        if script == farming_flow._VIDEO_LIKE_JS:
            return self.likes.pop(0) if self.likes else None
        return super().execute_script(script, *args)


class WatchCountingTests(unittest.TestCase):
    def run_scenario(self, video_ids, playing=True, url="https://www.facebook.com/watch/",
                     arrow_advances=True, total=15, driver=None, open_url=None, react=None, log=None):
        ctl = driver.ctl if driver else FakeControl()
        driver = driver or FakeVideoDriver(ctl, video_ids, playing, url)
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

        def open_page(*_args, **_kwargs):
            # Mở lại Watch thì trang về lại open_url (None: trang không đổi, mô phỏng mở lại không được)
            if open_url:
                driver.current_url = open_url

        with patch.object(farming_flow, "_open", side_effect=open_page) as self.open_mock, \
             patch.object(farming_flow, "ActiveTimer", FakeTimer), \
             patch.object(farming_flow, "ActionChains", return_value=chains), \
             patch.object(farming_flow, "hover_element", return_value=True), \
             patch.object(farming_flow, "_find_visible", return_value=[]), \
             patch.object(farming_flow, "human_scroll",
                          side_effect=lambda *a, **k: (self.scrolls.append(k), driver.scroll())), \
             patch.object(farming_flow, "check_account_state"):
            return farming_flow.run_watch(driver, ctl, total, 2, 2, lambda _: None, react=react, log=log)

    def run_react(self, count, likes, reacted="Love"):
        ctl, logs = FakeControl(), []
        driver = LikeDriver(ctl, [f"fb:{10000 + i}" for i in range(count)], likes)
        with patch.object(farming_flow, "_react", return_value=reacted) as react, \
                patch.object(farming_flow.random, "random", return_value=0.0):
            result = self.run_scenario([], driver=driver, total=count * 3 + 2, react=["Love"],
                                       log=lambda level, text: logs.append((level, text)))
        return result, react, logs

    def test_warns_once_after_consecutive_videos_without_like(self):
        result, react, logs = self.run_react(5, [])
        self.assertEqual(result["quantity"], 5)
        react.assert_not_called()
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0][0], "warning")
        self.assertIn("3 video liên tiếp không thấy nút Like", logs[0][1])

    def test_no_warning_when_like_found_between_misses(self):
        box, like = object(), object()
        _, react, logs = self.run_react(5, [None, None, [box, like, True], None, None])
        self.assertEqual(logs, [])
        react.assert_called_once()
        self.assertIs(react.call_args.args[2], box)
        self.assertIs(react.call_args.args[3], like)

    def test_already_reacted_video_is_not_reacted_and_not_a_miss(self):
        reacted_button = [object(), object(), False]
        _, react, logs = self.run_react(4, [reacted_button] * 4)
        react.assert_not_called()
        self.assertEqual(logs, [])

    def test_reaction_counted_in_result(self):
        result, _, _ = self.run_react(2, [[object(), object(), True]] * 2)
        self.assertEqual(result.get("reactions"), 2)

    def test_no_like_lookup_when_react_off(self):
        ctl = FakeControl()
        driver = LikeDriver(ctl, ["fb:10001", "fb:10002"], [])
        with patch.object(driver, "execute_script", wraps=driver.execute_script) as script:
            self.run_scenario([], driver=driver, total=8)
        self.assertNotIn(farming_flow._VIDEO_LIKE_JS, [call.args[0] for call in script.call_args_list])

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

    def test_video_removed_midway_is_skipped_not_fatal(self):
        # Lần hỏi thứ 2 (đang xem video đầu) phần tử đã bị Facebook gỡ: bỏ video đó, xem tiếp video khác
        driver = StaleVideoDriver(FakeControl(), ["fb:111", "fb:222", "fb:333"], stale_at=2)
        result = self.run_scenario(None, driver=driver)
        self.assertEqual(result["status"], "SUCCESS")
        self.assertGreaterEqual(result["quantity"], 1)
        self.assertEqual(self.open_mock.call_count, 1)

    def test_leaving_watch_page_reopens_watch(self):
        # Đang xem thì bấm sang Trang chủ: mở lại Watch và xem tiếp đủ thời gian
        driver = StaleVideoDriver(FakeControl(), ["fb:111", "fb:222", "fb:333"], stale_at=2,
                                  leave_to="https://www.facebook.com/")
        result = self.run_scenario(None, driver=driver, open_url="https://www.facebook.com/watch/")
        self.assertEqual(result["status"], "SUCCESS")
        self.assertEqual(self.open_mock.call_count, 2)
        self.assertGreaterEqual(driver.ctl.elapsed, 15)

    def test_page_keeps_leaving_watch_stops_after_reopen_limit(self):
        driver = StaleVideoDriver(FakeControl(), ["fb:111", "fb:222"], stale_at=2,
                                  leave_to="https://www.facebook.com/groups/feed/")
        result = self.run_scenario(None, driver=driver, total=600)
        self.assertIn(result["status"], ("SUCCESS", "SKIPPED"))
        self.assertEqual(self.open_mock.call_count, 1 + farming_flow.WATCH_MAX_REOPENS)
        self.assertLess(driver.ctl.elapsed, 600)

    def test_on_watch_page(self):
        def on(url, landing=""):
            return farming_flow._on_watch_page(Mock(current_url=url), landing)
        self.assertTrue(on("https://www.facebook.com/watch/?v=123"))
        self.assertTrue(on("https://web.facebook.com/reel/111"))
        self.assertTrue(on("https://www.facebook.com/somepage/videos/123/"))
        self.assertFalse(on("https://www.facebook.com/"))
        self.assertFalse(on("https://www.facebook.com/groups/feed/"))
        # Facebook đổi đường dẫn của Watch: trang được đưa tới khi mở Watch vẫn tính là Watch
        self.assertTrue(on("https://www.facebook.com/video/", "/video/"))


if __name__ == "__main__":
    unittest.main()
