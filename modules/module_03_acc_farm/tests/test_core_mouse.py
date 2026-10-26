"""core.browser.human: chuột giống người (đường cong nhiều bước, lệch tâm, không bấm bằng JS)."""
import math
import random
import unittest
from unittest.mock import Mock, patch

from selenium.common.exceptions import WebDriverException

from core.browser import human

HUMAN = "core.browser.human"


STILL = human.MouseProfile(jitter=0.0)  # không rung tay, để kiểm hình dạng đường đi


class MousePathTests(unittest.TestCase):
    def test_ends_exactly_on_target(self):
        rng = random.Random(1)
        for _ in range(50):
            start = (rng.uniform(0, 1200), rng.uniform(0, 700))
            end = (rng.uniform(0, 1200), rng.uniform(0, 700))
            path = human.mouse_path(start, end, rng=rng)
            self.assertEqual(path[-1][:2], (round(end[0]), round(end[1])))

    def test_one_event_every_16ms_so_steps_grow_with_duration(self):
        # Chuột thật phát sự kiện theo thời gian (60-125/giây), không theo quãng đường: rê lâu thì nhiều điểm hơn
        rng = random.Random(2)
        for distance in (40, 200, 1000):
            ms = human.move_duration_ms(distance, rng=random.Random(9))
            path = human.mouse_path((0, 300), (distance, 300), rng=rng, duration_ms=ms)
            self.assertAlmostEqual(len(path), ms / human.MOUSE_STEP_MS, delta=ms / human.MOUSE_STEP_MS * 0.12 + 1)
            self.assertTrue(all(p[2] <= human.MOUSE_STEP_PAUSE[1] for p in path))

    def test_duration_grows_with_distance_like_fitts(self):
        rng = random.Random(3)
        short, mid, far = (sum(human.move_duration_ms(d, rng=rng) for _ in range(20)) / 20 for d in (30, 300, 1200))
        self.assertLess(short, mid)
        self.assertLess(mid, far)
        self.assertLess(far - mid, mid - short + 400)  # tăng chậm dần (log), không tỉ lệ thẳng quãng đường

    def test_slow_at_both_ends_fast_in_middle(self):
        path = human.mouse_path((0, 0), (900, 0), curve=0, rng=random.Random(3), profile=STILL)
        xs = [0] + [p[0] for p in path]
        steps = [b - a for a, b in zip(xs, xs[1:])]
        middle = max(steps)
        self.assertGreater(middle, steps[0] * 3)
        self.assertGreater(middle, steps[-1] * 3)

    def test_curve_bends_path(self):
        rng = random.Random(4)
        bends = [max(abs(p[1] - 400) for p in human.mouse_path((100, 400), (900, 400), curve=1.0, rng=rng,
                                                                  profile=STILL)) for _ in range(20)]
        self.assertGreater(max(bends), 30)
        flat = human.mouse_path((100, 400), (900, 400), curve=0.0, rng=random.Random(5), profile=STILL)
        self.assertLessEqual(max(abs(p[1] - 400) for p in flat), 1)

    def test_hand_tremor_is_smooth_not_random_spikes(self):
        path = human.mouse_path((100, 400), (900, 400), curve=0.0, rng=random.Random(6),
                                profile=human.MouseProfile(jitter=1.2))
        ys = [p[1] - 400 for p in path[:-1]]
        self.assertGreater(max(abs(y) for y in ys), 0)
        jumps = [abs(b - a) for a, b in zip(ys, ys[1:])]
        self.assertLessEqual(max(jumps), 8)


class MouseProfileTests(unittest.TestCase):
    """Mỗi nick 1 thói quen tay cố định (theo seed), khác nick thì khác: cả dàn không chung 1 khuôn."""

    def test_same_nick_same_habit_other_nick_different(self):
        from core.browser.fingerprint import BrowserConfig
        a1 = BrowserConfig.from_fingerprint("100", {"canvas_seed": 11, "mode": "native"}).mouse
        a2 = BrowserConfig.from_fingerprint("100", {"canvas_seed": 11, "mode": "native"}).mouse
        b = BrowserConfig.from_fingerprint("200", {"canvas_seed": 12, "mode": "native"}).mouse
        self.assertEqual(a1, a2)
        self.assertNotEqual(a1, b)

    def test_legacy_nicks_do_not_share_one_habit(self):
        from core.browser.fingerprint import BrowserConfig
        habits = {BrowserConfig.from_fingerprint(str(uid), {"canvas_seed": None, "mode": "legacy"}).mouse
                  for uid in range(1000, 1010)}
        self.assertEqual(len(habits), 10)

    def test_habits_stay_in_human_ranges(self):
        for seed in range(1, 300):
            p = human.MouseProfile.from_seed(seed)
            self.assertTrue(0.8 <= p.speed <= 1.3 and 0.1 <= p.bend <= 0.3)
            self.assertTrue(0.1 <= p.hover[0] < p.hover[1] <= 0.8)
            self.assertTrue(0.04 <= p.hold[0] < p.hold[1] <= 0.15)
            self.assertTrue(0.38 <= p.aim[0] <= 0.62 and 0.42 <= p.aim[1] <= 0.58)

    def test_driver_profile_used_or_default(self):
        driver = Mock()
        driver.browser_config.mouse = human.MouseProfile.from_seed(5)
        self.assertEqual(human.mouse_profile(driver), human.MouseProfile.from_seed(5))
        self.assertEqual(human.mouse_profile(Mock(spec=[])), human.DEFAULT_MOUSE)

    def test_click_points_cluster_like_a_bell_around_the_habit(self):
        driver = fake_driver(rect=(0, 0, 200, 100))
        driver.browser_config = Mock(mouse=human.MouseProfile(aim=(0.4, 0.5), spread=(0.1, 0.1)))
        rng = random.Random(7)
        xs = [human.click_point(driver, Mock(), rng)[0] for _ in range(400)]
        mean = sum(xs) / len(xs)
        self.assertAlmostEqual(mean, 80, delta=4)  # quanh vùng ưa thích 40% bề ngang
        near = sum(1 for x in xs if abs(x - 80) <= 20) / len(xs)
        edge = sum(1 for x in xs if abs(x - 80) > 40) / len(xs)
        self.assertGreater(near, 0.6)   # dày ở giữa
        self.assertLess(edge, 0.1)      # thưa dần ra rìa (không đều như hình chữ nhật)


class LegsTests(unittest.TestCase):
    def legs(self, distance, profile, seed=1, overshoot=True):
        return human._legs((100, 300), (100 + distance, 300), 1.0, overshoot, profile, random.Random(seed), 1280, 800)

    def test_short_moves_and_precise_moves_are_single_leg(self):
        self.assertEqual(len(self.legs(50, human.MouseProfile(overshoot=1, submove=1))), 1)
        self.assertEqual(len(self.legs(600, human.MouseProfile(overshoot=1, submove=1), overshoot=False)), 1)

    def test_overshoot_goes_past_then_returns(self):
        legs = self.legs(600, human.MouseProfile(overshoot=1.0, submove=0.0))
        self.assertGreater(legs[0][0][0], 700)
        self.assertEqual(legs[-1][0], (700, 300))

    def test_submovement_stops_short_then_corrects(self):
        legs = self.legs(600, human.MouseProfile(overshoot=0.0, submove=1.0))
        self.assertLess(legs[0][0][0], 700)
        self.assertIn(len(legs), (2, 3))
        self.assertEqual(legs[-1][0], (700, 300))
        self.assertTrue(all(human.CORRECTION_MS[0] <= leg[2] <= human.CORRECTION_MS[1] for leg in legs[1:]))


def fake_driver(rect=(200, 300, 100, 40), viewport=(1280, 800), hits=True):
    driver = Mock(spec=["execute_script"])

    def script(js, *args):
        if js == human._VIEWPORT_JS:
            return list(viewport)
        if js == human._RECT_JS:
            return [*rect, *viewport] if rect else None
        if js == human._HIT_JS:
            return hits(args[1], args[2]) if callable(hits) else hits
        raise AssertionError(f"script lạ: {js[:40]}")

    driver.execute_script.side_effect = script
    return driver


class ClickTests(unittest.TestCase):
    def setUp(self):
        self.moves, self.presses = [], []
        patcher_move = patch(f"{HUMAN}.mouse_to", side_effect=lambda d, x, y, **k: self.moves.append((x, y)) or (x, y))
        patcher_press = patch(f"{HUMAN}.press_mouse", side_effect=lambda d, *a: self.presses.append(d))
        patcher_sleep = patch(f"{HUMAN}.time.sleep")
        for p in (patcher_move, patcher_press, patcher_sleep):
            p.start()
            self.addCleanup(p.stop)

    def test_click_point_inside_element_and_not_always_center(self):
        driver = fake_driver()
        points = {human.click_point(driver, Mock(), random.Random(i)) for i in range(20)}
        for x, y in points:
            self.assertTrue(200 <= x <= 300 and 300 <= y <= 340)
        self.assertGreater(len(points), 5)

    def test_human_click_moves_then_presses_never_js(self):
        driver = fake_driver()
        self.assertTrue(human.human_click(driver, Mock(), rng=random.Random(1)))
        self.assertEqual(len(self.presses), 1)
        self.assertEqual(len(self.moves), 1)
        scripts = [c.args[0] for c in driver.execute_script.call_args_list]
        self.assertFalse(any("click()" in s for s in scripts))

    def test_covered_element_is_not_clicked(self):
        driver = fake_driver(hits=False)
        with patch(f"{HUMAN}.ActionChains"):
            self.assertFalse(human.human_click(driver, Mock(), rng=random.Random(1)))
        self.assertEqual(self.presses, [])

    def test_layout_shift_reaims_before_pressing(self):
        state = {"n": 0}

        def hits(x, y):
            state["n"] += 1
            return state["n"] != 2  # điểm đầu trúng, lúc sắp bấm thì trang xô lệch, điểm mới lại trúng

        driver = fake_driver(hits=hits)
        self.assertTrue(human.human_click(driver, Mock(), rng=random.Random(2)))
        self.assertEqual(len(self.moves), 2)
        self.assertEqual(len(self.presses), 1)

    def test_offscreen_element_scrolls_with_wheel_first(self):
        driver = fake_driver(rect=(200, 2000, 100, 40))
        with patch(f"{HUMAN}.ActionChains") as chains:
            self.assertFalse(human.human_click(driver, Mock(), rng=random.Random(1)))
        chains.return_value.scroll_to_element.assert_called()

    def test_hover_over_covered_video_without_scrolling(self):
        # Video có lớp phủ đè lên: rê qua vẫn được, không cuộn trang (Reels cuộn là sang video khác)
        driver = fake_driver(hits=False)
        with patch(f"{HUMAN}.ActionChains") as chains:
            self.assertTrue(human.hover_element(driver, Mock(), rng=random.Random(1), need_hit=False))
            chains.return_value.scroll_to_element.assert_not_called()
            self.assertFalse(human.hover_element(fake_driver(rect=(200, 2000, 100, 40), hits=False), Mock(),
                                                 rng=random.Random(1), need_hit=False))
            chains.return_value.scroll_to_element.assert_not_called()
        self.assertEqual(len(self.moves), 1)
        self.assertEqual(self.presses, [])

    def test_webdriver_error_returns_false(self):
        driver = fake_driver()
        driver.execute_script.side_effect = WebDriverException("stale")
        self.assertFalse(human.human_click(driver, Mock(), rng=random.Random(1)))


class MouseToTests(unittest.TestCase):
    def test_tracks_position_and_starts_inside_viewport(self):
        driver = fake_driver()
        with patch(f"{HUMAN}.ActionBuilder") as builder:
            human.mouse_to(driver, 5000, -20, rng=random.Random(1))
        self.assertEqual(human.mouse_position(driver), (1278, 1))  # kéo vào trong khung nhìn
        moves = builder.return_value.pointer_action.move_to_location.call_args_list
        self.assertGreater(len(moves), 20)  # quãng dài, ~1 điểm mỗi 16ms
        for call in moves:
            x, y = call.args
            self.assertTrue(1 <= x <= 1278 and 1 <= y <= 798)
        builder.return_value.perform.assert_called_once()


if __name__ == "__main__":
    unittest.main()
