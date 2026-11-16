"""'Khoảng cách giữa các lần quét: từ X đến Y giây' = giãn cách ngẫu nhiên giữa 2 Page."""
from __future__ import annotations

import importlib
import threading
import time
import unittest
from unittest import mock

from pydantic import ValidationError

from modules.module_11_page_scanner.scanner import pick_page_delay, sleep_page_delay

router = importlib.import_module("modules.module_11_page_scanner.api.router")


class TestPickPageDelay(unittest.TestCase):
    def test_random_within_range(self):
        values = [pick_page_delay(5, 10) for _ in range(200)]
        self.assertTrue(all(5 <= v <= 10 for v in values))
        self.assertGreater(max(values) - min(values), 1)  # thực sự ngẫu nhiên

    def test_fallback_when_no_range(self):
        self.assertEqual(pick_page_delay(None, None, 2.5), 2.5)

    def test_single_bound_and_inverted_range(self):
        self.assertEqual(pick_page_delay(7, None), 7)
        self.assertEqual(pick_page_delay(None, 4), 4)
        self.assertEqual(pick_page_delay(9, 3), 9)  # max < min → dùng min
        self.assertEqual(pick_page_delay(-5, -1), 0)


class TestSleepPageDelay(unittest.TestCase):
    def test_stop_interrupts_wait(self):
        ev = threading.Event()
        threading.Timer(0.05, ev.set).start()
        t0 = time.monotonic()
        self.assertTrue(sleep_page_delay(30, ev))
        self.assertLess(time.monotonic() - t0, 2)

    def test_zero_delay_returns_immediately(self):
        self.assertFalse(sleep_page_delay(0, threading.Event()))


class TestDelaySchema(unittest.TestCase):
    def test_ui_range_up_to_180_is_accepted(self):
        for model in (router.PostSessionInput, router.FollowerSessionInput):
            item = model(page_keys=["user:p"], page_delay_min_s=120, page_delay_max_s=180)
            self.assertEqual((item.page_delay_min_s, item.page_delay_max_s), (120, 180))

    def test_above_180_rejected(self):
        with self.assertRaises(ValidationError):
            router.PostSessionInput(page_keys=["user:p"], page_delay_max_s=181)

    def test_posts_endpoint_forwards_delay_range(self):
        import asyncio

        item = router.PostSessionInput(page_keys=["user:p"], page_delay_min_s=5, page_delay_max_s=10)
        with mock.patch.object(router, "_get_owner", return_value="42"), \
                mock.patch.object(router, "start_post_scan_background", return_value=77) as start:
            res = asyncio.run(router.create_post_scan_session(item))
        self.assertEqual(res["session_id"], 77)
        kwargs = start.call_args.kwargs
        self.assertEqual((kwargs["page_delay_min_s"], kwargs["page_delay_max_s"]), (5, 10))
        self.assertNotIn("scroll_delay_s", {k for k, v in kwargs.items() if v == 10})


if __name__ == "__main__":
    unittest.main()
