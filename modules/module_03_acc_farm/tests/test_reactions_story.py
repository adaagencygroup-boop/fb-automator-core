import asyncio
import unittest
from unittest.mock import ANY, Mock, patch

from fastapi import HTTPException

from modules.module_03_acc_farm import repository
from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.farming import flow as farming_flow

FLOW = "modules.module_03_acc_farm.farming.flow"


class ReactConfigTests(unittest.TestCase):
    def normalize(self, **kwargs):
        return farm_routes._normalize_config(farm_routes.FarmScenarioConfig(**kwargs))

    def test_defaults_off(self):
        cfg = farm_routes.FarmScenarioConfig()
        self.assertEqual((cfg.enabled_story, cfg.story_min, cfg.story_max, cfg.story_delay_min, cfg.story_delay_max),
                         (False, 5, 10, 3, 8))
        for scenario in farm_routes.REACT_SCENARIOS:
            self.assertFalse(getattr(cfg, f"{scenario}_react_enabled"))

    def test_types_filtered_ordered_and_deduplicated(self):
        cfg = self.normalize(newsfeed_react_enabled=True, newsfeed_react_types=["Sad", "Angry", "Like", "Sad", "x"])
        self.assertEqual((cfg.newsfeed_react_enabled, cfg.newsfeed_react_types), (True, ["Like", "Sad"]))

    def test_enabled_without_valid_type_turns_off(self):
        cfg = self.normalize(watch_react_enabled=True, watch_react_types=["Angry"])
        self.assertEqual((cfg.watch_react_enabled, cfg.watch_react_types), (False, []))

    def test_disabled_drops_types(self):
        cfg = self.normalize(story_react_enabled=False, story_react_types=["Love"])
        self.assertEqual(cfg.story_react_types, [])

    def test_story_ranges(self):
        cfg = self.normalize(story_min=9, story_max=0, story_delay_min=9000, story_delay_max=2)
        self.assertEqual((cfg.story_min, cfg.story_max), (1, 9))
        self.assertEqual((cfg.story_delay_min, cfg.story_delay_max), (2, 3600))

    def test_plan(self):
        cfg = self.normalize(enabled_newsfeed=True, newsfeed_react_enabled=True, newsfeed_react_types=["Love"],
                             enabled_watch=True, enabled_story=True, story_min=4, story_max=4,
                             story_react_enabled=True, story_react_types=["Haha", "Wow"])
        plan = dict(farm_routes._build_plan(cfg))
        self.assertEqual(plan["NEWSFEED"]["react"], ["Love"])
        self.assertIsNone(plan["WATCH"]["react"])
        self.assertEqual((plan["STORY"]["target"], plan["STORY"]["delay"], plan["STORY"]["react"]),
                         (4, (3, 8), ["Haha", "Wow"]))
        self.assertEqual(farm_routes.ACTION_LABELS["STORY"], "Xem Story")

    def test_story_only_passes_scenario_check(self):
        req = farm_routes.FarmStartRequest(uids=["1"], threads=1,
                                           config=farm_routes.FarmScenarioConfig(enabled_story=True))
        with patch.object(farm_routes.adapters, "owner_from_request", return_value=None), \
                patch.object(farm_routes.adapters, "get_account", return_value=None):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(farm_routes.start_farm_interactions(req, Mock()))
        self.assertIn("đủ điều kiện", ctx.exception.detail)


class SummarizeReactionTests(unittest.TestCase):
    def test_columns(self):
        out = repository.summarize_actions([
            {"action": "NEWSFEED", "status": "SUCCESS", "seconds": 60, "scrolls": 5, "reactions": 2},
            {"action": "WATCH", "status": "SUCCESS", "quantity": 3, "seconds": 90, "reactions": 1},
            {"action": "STORY", "status": "SUCCESS", "quantity": 7, "seconds": 40, "reactions": 3},
        ])
        self.assertEqual((out["newsfeed_reactions"], out["watch_reactions"]), (2, 1))
        self.assertEqual((out["story_frames"], out["story_seconds"], out["story_reactions"]), (7, 40, 3))
        for column in ("newsfeed_reactions", "watch_reactions", "story_frames", "story_seconds", "story_reactions"):
            self.assertIn(column, repository.HISTORY_COLUMNS)


class ReactHelperTests(unittest.TestCase):
    def react(self, kind, bar_after=None, state="Love", visible=None, park=True):
        """bar_after: số lần _find_visible gọi mới thấy nút trên thanh cảm xúc (None = không bao giờ hiện)."""
        driver = Mock()
        driver.execute_script.return_value = state
        calls = {"find": 0}
        mouse = Mock()  # các hàm chuột của core.browser.human dùng trong flow
        mouse.hover_element.return_value = True
        mouse.element_box.return_value = (100, 500, 160, 530)   # nút Like, tâm x = 130
        mouse.click_point.return_value = (250, 480)              # điểm bấm trên nút cảm xúc
        mouse.mouse_position.return_value = (400, 300)
        like = Mock(rect={"x": 100})
        bar_button = Mock(rect={"x": 230})

        def find(drv, locators, root=None):
            calls["find"] += 1
            return [bar_button] if bar_after is not None and calls["find"] >= bar_after else []

        visible = visible or (lambda drv, el: True)
        with patch(f"{FLOW}.random.choice", return_value=kind), \
                patch(f"{FLOW}._find_visible", side_effect=find), \
                patch(f"{FLOW}._human_click", return_value=True) as click, \
                patch(f"{FLOW}.hover_element", mouse.hover_element), \
                patch(f"{FLOW}.mouse_to", mouse.mouse_to), \
                patch(f"{FLOW}.press_mouse", mouse.press_mouse), \
                patch(f"{FLOW}.element_box", mouse.element_box), \
                patch(f"{FLOW}.click_point", mouse.click_point), \
                patch(f"{FLOW}.mouse_position", mouse.mouse_position), \
                patch(f"{FLOW}._release_focus"), \
                patch(f"{FLOW}._really_visible", side_effect=visible), \
                patch(f"{FLOW}._park_mouse", return_value=park) as parked, \
                patch(f"{FLOW}.REACTION_BAR_WAIT", 0.05), \
                patch(f"{FLOW}.time.sleep"):
            ctl = farming_flow.FarmControl()
            with patch.object(ctl, "sleep"):
                result = farming_flow._react(driver, ctl, "box", like, [kind])
        self.parked = parked
        return result, click, mouse, (like, bar_button)

    def test_like_clicks_button_directly(self):
        result, click, mouse, _ = self.react("Like", state="Like")
        self.assertEqual(result, "Like")
        click.assert_called_once()
        mouse.hover_element.assert_not_called()

    def test_other_kind_uses_reaction_bar(self):
        result, click, mouse, (like, bar) = self.react("Love", bar_after=2, state="Love")
        self.assertEqual(result, "Love")
        click.assert_not_called()
        mouse.hover_element.assert_called_with(ANY, like)
        # Rê lên thẳng phía trên nút Like (x ~ 130, cùng hàng với nút cảm xúc) rồi mới sang ngang tới nút, gần như thẳng
        up, side = mouse.mouse_to.call_args_list
        self.assertLessEqual(abs(up.args[1] - 130), 3)
        self.assertEqual(up.args[2], 480)
        self.assertEqual(side.args[1:], (250, 480))
        for call in (up, side):
            self.assertEqual((call.kwargs["curve"], call.kwargs["overshoot"]), (0.1, False))
        mouse.press_mouse.assert_called_once()

    def test_bar_never_shows_after_two_hovers_skips(self):
        result, _, mouse, (like, _) = self.react("Haha", bar_after=None)
        self.assertIsNone(result)
        hovers = [c for c in mouse.hover_element.call_args_list if c.args[1] is like]
        self.assertEqual(len(hovers), farming_flow.REACTION_HOVER_TRIES)
        # Rê ra giữa 2 lần rê vào = đưa chuột ra điểm trống (không rê lên trên); lần cuối cũng đưa ra lề
        self.assertEqual(self.parked.call_count, 2)
        mouse.mouse_to.assert_not_called()

    def test_rehover_falls_back_to_sideways_when_no_safe_point(self):
        _, _, mouse, _ = self.react("Haha", bar_after=None, park=False)
        _, x, y = mouse.mouse_to.call_args.args
        self.assertEqual(y, 300)  # sang ngang từ vị trí chuột (400, 300), không lên trên
        self.assertGreater(x, 400)

    def test_not_counted_when_label_unchanged(self):
        result, _, _, _ = self.react("Like", state=None)
        self.assertIsNone(result)

    def test_hidden_like_button_not_touched(self):
        # Màn hình đang ở giữa ảnh / video, nút Like bị che: không rê chuột, không bấm gì
        result, click, mouse, _ = self.react("Love", bar_after=1, visible=lambda drv, el: False)
        self.assertIsNone(result)
        click.assert_not_called()
        mouse.hover_element.assert_not_called()
        self.parked.assert_not_called()

    def test_bar_button_gone_before_click_not_clicked(self):
        # Chỉ nút Like còn thấy (rect x = 100), nút trên thanh đã biến mất
        result, _, mouse, _ = self.react("Love", bar_after=1, visible=lambda drv, el: el.rect["x"] == 100)
        self.assertIsNone(result)
        mouse.press_mouse.assert_not_called()
        self.parked.assert_called_once()

    def test_mouse_parked_after_react(self):
        self.react("Like", state="Like")
        self.parked.assert_called_once()


class StoryReactMouseTests(unittest.TestCase):
    """Chuột nằm trên thanh cảm xúc thì story dừng: thả xong rê chuột lên vùng khung story."""

    def test_mouse_moves_up_off_reaction_bar(self):
        with patch(f"{FLOW}.random.choice", return_value="Love"),                 patch(f"{FLOW}._find_visible", return_value=["love-button"]),                 patch(f"{FLOW}._human_click", return_value=True),                 patch(f"{FLOW}._release_focus"),                 patch(f"{FLOW}.mouse_position", return_value=(870, 665)),                 patch(f"{FLOW}.mouse_to") as moved:
            self.assertEqual(farming_flow._react_story(Mock(), ["Love"]), "Love")
        _, x, y = moved.call_args.args
        self.assertLessEqual(y, 665 - farming_flow.STORY_LEAVE_UP_PX[0])
        self.assertLessEqual(abs(x - 870), 40)

    def test_failed_react_does_not_move(self):
        with patch(f"{FLOW}._find_visible", return_value=[]), patch(f"{FLOW}.mouse_to") as moved:
            self.assertIsNone(farming_flow._react_story(Mock(), ["Love"]))
        moved.assert_not_called()


class StoryNextTests(unittest.TestCase):
    """Phím mũi tên phải không sang được khung (focus ngoài trình xem sau khi thả cảm xúc): bấm nút Next bằng chuột."""

    def run_next(self, states, buttons):
        driver = Mock()
        clicked = []
        seq = iter(states)

        def find(drv, locators, root=None):
            self.assertIs(locators, farming_flow.FARM_STORY["next"])
            return buttons

        with patch(f"{FLOW}._focus_is_text_field", return_value=False), \
                patch(f"{FLOW}._story_state", side_effect=lambda d: next(seq)), \
                patch(f"{FLOW}.ActionChains"), patch(f"{FLOW}.time.sleep"), \
                patch(f"{FLOW}._find_visible", side_effect=find), \
                patch(f"{FLOW}._human_click", side_effect=lambda d, el: clicked.append(el) or True):
            farming_flow._story_next(driver)
        return clicked

    def test_key_worked_no_click(self):
        clicked = self.run_next([{"sig": "a", "end": False}, {"sig": "b", "end": False}], ["next-card"])
        self.assertEqual(clicked, [])

    def test_key_ignored_clicks_next_button(self):
        clicked = self.run_next([{"sig": "a", "end": False}, {"sig": "a", "end": False}], ["next-card", "next-bucket"])
        self.assertEqual(clicked, ["next-card"])

    def test_next_card_locator_before_next_bucket(self):
        locators = farming_flow.FARM_STORY["next"]
        self.assertIn("Next card", locators[0])
        self.assertIn("Next Bucket", locators[1])


class StoryTrayReloadTests(unittest.TestCase):
    """Vừa lướt Newsfeed xa: khay story bị gỡ khỏi DOM, phải mở lại Trang chủ (không dùng lại trang đang cuộn)."""

    def open_reuse(self, scroll_y, url="https://www.facebook.com/"):
        driver = Mock(current_url=url)
        with patch(f"{FLOW}._open") as opened, patch(f"{FLOW}._wait_for_any"), \
                patch(f"{FLOW}._find_visible", return_value=[]), \
                patch(f"{FLOW}._script", return_value=scroll_y):
            result = farming_flow.run_story(driver, farming_flow.FarmControl(), 3, 3, 8, Mock())
        self.assertEqual(result["status"], "SKIPPED")
        return opened.call_args.kwargs["reuse"]

    def test_scrolled_home_is_reloaded(self):
        self.assertFalse(self.open_reuse(5000))

    def test_home_near_top_is_reused(self):
        self.assertTrue(self.open_reuse(100))

    def test_other_page_opens_home(self):
        self.assertTrue(self.open_reuse(5000, url="https://www.facebook.com/watch/"))


class StoryTests(unittest.TestCase):
    def run_story(self, states, target, react=None, react_ok=True, stop_at=None):
        """states: danh sách kết quả lần lượt của _story_state (mỗi khung đọc 2 lần: trước + sau khi xem)."""
        seq = iter(states)
        nexts = []
        ctl = farming_flow.FarmControl()
        sleeps = {"n": 0}

        self.sleeps = []

        def sleep(seconds):
            self.sleeps.append(seconds)
            sleeps["n"] += 1
            if stop_at and sleeps["n"] >= stop_at:
                raise farming_flow.FarmStopped()

        with patch(f"{FLOW}._open"), patch(f"{FLOW}._wait_for_any"), \
                patch(f"{FLOW}._find_visible", return_value=["card"]), \
                patch(f"{FLOW}._human_click", return_value=True), \
                patch(f"{FLOW}.check_account_state"), \
                patch(f"{FLOW}._story_state", side_effect=lambda d: next(seq)), \
                patch(f"{FLOW}._story_next", side_effect=lambda d: nexts.append(1)), \
                patch(f"{FLOW}._react_story", return_value="Love" if react_ok else None), \
                patch(f"{FLOW}.random.random", return_value=0.0), \
                patch.object(ctl, "sleep", side_effect=sleep):
            result = farming_flow.run_story(Mock(current_url=""), ctl, target, 3, 8, Mock(), react=react)
        return result, len(nexts)

    @staticmethod
    def frame(sig, end=False, reacts=7):
        return {"sig": sig, "end": end, "reacts": reacts}

    def test_counts_frames_until_target(self):
        f = self.frame
        result, nexts = self.run_story([f("a"), f("a"), f("b"), f("b"), f("c"), f("c")], target=3)
        self.assertEqual((result["status"], result["quantity"], nexts), ("SUCCESS", 3, 2))
        self.assertNotIn("hết story", result["details"])

    def test_preview_image_then_video_same_frame_counts_once(self):
        # Khung video: lúc mở là ảnh xem trước, xem xong là video; khung kế mới đổi
        f = self.frame
        result, _ = self.run_story([f("IMG:p"), f("VIDEO:v1:9"), f("VIDEO:v1:9"), f("IMG:x")], target=2)
        self.assertEqual(result["quantity"], 2)

    def test_end_of_stories(self):
        f = self.frame
        result, _ = self.run_story([f("a"), f("a"), f("b"), f(None, end=True, reacts=0)], target=10)
        self.assertEqual((result["status"], result["quantity"]), ("SUCCESS", 2))
        self.assertIn("(hết story)", result["details"])

    def test_end_screen_reached_during_view_not_counted(self):
        # Màn cuối chưa kịp hiện "Create story" lúc đọc trước khi xem: không có nút cảm xúc thì không tính
        f = self.frame
        result, _ = self.run_story([f("a"), f("a"), f("IMG:end", reacts=0), f(None, end=True, reacts=0)], target=5)
        self.assertEqual(result["quantity"], 1)

    def test_stuck_frame_stops(self):
        f = self.frame
        states = [f("a"), f("a")] + [f("a")] * (2 * farming_flow.STORY_MAX_STUCK)
        result, nexts = self.run_story(states, target=10)
        self.assertEqual((result["quantity"], nexts), (1, farming_flow.STORY_MAX_STUCK))

    def test_no_tray_card(self):
        with patch(f"{FLOW}._open"), patch(f"{FLOW}._wait_for_any"), patch(f"{FLOW}._find_visible", return_value=[]):
            result = farming_flow.run_story(Mock(current_url=""), farming_flow.FarmControl(), 5, 3, 8, Mock())
        self.assertEqual((result["status"], result["quantity"]), ("SKIPPED", 0))

    def test_reactions_counted_per_new_frame(self):
        f = self.frame
        result, _ = self.run_story([f("a"), f("a"), f("b"), f("b")], target=2, react=["Love"])
        self.assertEqual((result["reactions"], result["reaction_types"]), (2, {"Love": 2}))
        self.assertIn("thả 2 cảm xúc (Love 2)", result["details"])

    def test_no_reaction_buttons_no_react(self):
        f = self.frame
        result, _ = self.run_story([f("a", reacts=0), f("a", reacts=0)], target=1, react=["Love"])
        self.assertEqual(result["reactions"], 0)

    def test_stop_keeps_partial(self):
        f = self.frame
        with self.assertRaises(farming_flow.FarmStopped) as ctx:
            self.run_story([f("a"), f("a"), f("b"), f("b")], target=5, stop_at=4)
        self.assertEqual(ctx.exception.partial["quantity"], 1)
        self.assertIn("seconds", ctx.exception.partial)


class NewsfeedReactTests(unittest.TestCase):
    def test_reacts_on_candidates_and_reports_counts(self):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        ctl = farming_flow.FarmControl()
        timer = Mock()
        timer.remaining.side_effect = [10, 10, 10, 0, 0, 0]
        timer.elapsed.return_value = 30
        with patch(f"{FLOW}._open"), patch(f"{FLOW}.ActiveTimer", return_value=timer), \
                patch(f"{FLOW}.human_scroll"), patch(f"{FLOW}.check_account_state"), \
                patch(f"{FLOW}._feed_react_candidates", return_value=[("p1", "l1"), ("p2", "l2")]), \
                patch(f"{FLOW}._react", side_effect=["Love", None]), \
                patch(f"{FLOW}.random.random", return_value=0.0), \
                patch.object(ctl, "sleep"):
            result = farming_flow.run_newsfeed(driver, ctl, 60, 1, 2, Mock(), react=["Love"])
        self.assertEqual((result["reactions"], result["reaction_types"]), (1, {"Love": 1}))
        self.assertIn("thả 1 cảm xúc (Love 1)", result["details"])

    def test_no_react_when_disabled(self):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        ctl = farming_flow.FarmControl()
        timer = Mock()
        timer.remaining.side_effect = [10, 10, 0, 0, 0]
        timer.elapsed.return_value = 30
        with patch(f"{FLOW}._open"), patch(f"{FLOW}.ActiveTimer", return_value=timer), \
                patch(f"{FLOW}.human_scroll"), patch(f"{FLOW}.check_account_state"), \
                patch(f"{FLOW}._feed_react_candidates") as candidates, patch.object(ctl, "sleep"):
            result = farming_flow.run_newsfeed(driver, ctl, 60, 1, 2, Mock())
        candidates.assert_not_called()
        self.assertEqual(result["reactions"], 0)

    def run_feed_like_check(self, has_like, rounds, react=("Love",)):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        ctl = farming_flow.FarmControl()
        scrolls, logs = [], []
        timer = Mock()
        timer.remaining.side_effect = lambda: 10 if len(scrolls) < rounds else 0
        timer.elapsed.return_value = 30
        with patch(f"{FLOW}._open"), patch(f"{FLOW}.ActiveTimer", return_value=timer), \
                patch(f"{FLOW}.human_scroll", side_effect=lambda *a, **k: scrolls.append(a)), \
                patch(f"{FLOW}.check_account_state"), patch(f"{FLOW}._feed_react_candidates", return_value=[]), \
                patch(f"{FLOW}._feed_has_like", side_effect=has_like) as check, \
                patch(f"{FLOW}.random.random", return_value=0.99), patch.object(ctl, "sleep"):
            farming_flow.run_newsfeed(driver, ctl, 60, 1, 2, Mock(), react=list(react) if react else None,
                                      log=lambda level, text: logs.append((level, text)))
        return logs, check

    def test_warns_once_when_no_like_button_after_scrolls(self):
        logs, _ = self.run_feed_like_check(lambda _: False, farming_flow.REACT_NO_LIKE_SCROLLS + 3)
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0][0], "warning")
        self.assertIn("chưa thấy nút Like", logs[0][1])

    def test_no_warning_before_enough_scrolls(self):
        logs, _ = self.run_feed_like_check(lambda _: False, farming_flow.REACT_NO_LIKE_SCROLLS - 2)
        self.assertEqual(logs, [])

    def test_like_seen_once_stops_checking(self):
        logs, check = self.run_feed_like_check(lambda _: True, farming_flow.REACT_NO_LIKE_SCROLLS + 3)
        self.assertEqual(logs, [])
        self.assertEqual(check.call_count, 1)

    def test_no_like_check_when_react_off(self):
        logs, check = self.run_feed_like_check(lambda _: False, farming_flow.REACT_NO_LIKE_SCROLLS + 3, react=None)
        self.assertEqual(logs, [])
        check.assert_not_called()


class ReactWarningWiringTests(unittest.TestCase):
    def test_action_passes_log_to_newsfeed_and_watch(self):
        log = Mock()
        params = {"total_seconds": 60, "delay": (1, 2), "react": ["Love"]}
        for action, target in (("NEWSFEED", "run_newsfeed"), ("WATCH", "run_watch")):
            with self.subTest(action), patch(f"modules.module_03_acc_farm.routes.{target}") as run:
                farm_routes._run_action(Mock(), Mock(), "a", action, params, Mock(), Mock(), log=log)
                self.assertIs(run.call_args.kwargs["log"], log)


if __name__ == "__main__":
    unittest.main()
