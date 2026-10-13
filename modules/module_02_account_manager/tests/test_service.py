import asyncio
import unittest
from unittest.mock import patch
from ..context import owner_scope, owner_context
from ..services import events, runtime
from ..utils.paths import profile_path

class EventTests(unittest.IsolatedAsyncioTestCase):
    async def test_fanout_thread_safety_and_owner_isolation(self):
        with owner_scope("alice"):
            first = events.event_stream()
            second = events.event_stream()
            await anext(first)
            await anext(second)
        with owner_scope("bob"):
            third = events.event_stream()
            await anext(third)
        with owner_scope("alice"):
            await asyncio.to_thread(events.broadcast, "info", "alice-event")
        self.assertIn("alice-event", await asyncio.wait_for(anext(first), 1))
        self.assertIn("alice-event", await asyncio.wait_for(anext(second), 1))
        with owner_scope("bob"):
            events.broadcast("info", "bob-event")
        message = await asyncio.wait_for(anext(third), 1)
        self.assertIn("bob-event", message)
        self.assertNotIn("alice-event", message)
        for stream in (first, second, third):
            await stream.aclose()
        self.assertFalse(events._subscribers)

    async def test_executor_copies_owner(self):
        runtime.initialize()
        try:
            with owner_scope("alice"):
                future = runtime.submit(owner_context.get)
            self.assertEqual(await asyncio.wrap_future(future), "alice")
        finally:
            await runtime.shutdown()

    async def test_login_respects_requested_concurrency(self):
        from ..services.login_service import login_batch
        import threading
        import time
        guard = threading.Lock()
        active = maximum = 0
        def worker(uid):
            nonlocal active, maximum
            with guard:
                active += 1
                maximum = max(active, maximum)
            time.sleep(0.02)
            with guard:
                active -= 1
        runtime.initialize()
        try:
            with patch("modules.module_02_account_manager.services.login_service.login_one", side_effect=worker):
                await login_batch([str(i) for i in range(8)], 2)
            self.assertEqual(maximum, 2)
        finally:
            await runtime.shutdown()

class StorageTests(unittest.TestCase):
    def test_same_uid_different_owner_has_different_path_and_lock(self):
        from ..automation.browser_manager import get_profile_lock
        with owner_scope("alice"):
            first, lock = profile_path("123"), get_profile_lock("123")
        with owner_scope("bob"):
            self.assertNotEqual(first, profile_path("123"))
            self.assertIsNot(lock, get_profile_lock("123"))
        with self.assertRaises(ValueError):
            profile_path("../escape")

class CapturedStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_retains_owner_after_request_scope_ends(self):
        from ..services.scoped import stream_owned
        with owner_scope("alice"):
            stream = stream_owned(owner_context.get(), events.event_stream)
        self.assertIn("connected", await anext(stream))
        with owner_scope("alice"):
            events.broadcast("info", "captured-owner")
        self.assertIn("captured-owner", await asyncio.wait_for(anext(stream), 1))
        await stream.aclose()
