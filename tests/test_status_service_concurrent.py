"""Unit tests for concurrent Live/Die status checks without batching or HTTP throttling."""
import asyncio
import sys
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Prevent core.database.connection from opening a live PostgreSQL pool during unit tests.
if "core.database.connection" not in sys.modules:
    _stub_conn = types.ModuleType("core.database.connection")
    _stub_conn.db = None
    sys.modules["core.database.connection"] = _stub_conn

from modules.module_02_account_manager.services import status_service  # noqa: E402


class TestStatusServiceConcurrent(unittest.IsolatedAsyncioTestCase):
    async def test_check_statuses_runs_all_http_checks_concurrently(self):
        uids = [f"100000{i:02d}" for i in range(25)]
        db = MagicMock()
        known_rows = [SimpleNamespace(uid=uid) for uid in uids]

        started = 0
        all_started = asyncio.Event()

        async def fake_http_check(uid, client):
            nonlocal started
            started += 1
            if started == len(uids):
                all_started.set()
            # If any semaphore or batching capped concurrency < 25, this wait would time out.
            await asyncio.wait_for(all_started.wait(), timeout=2.0)
            return "live" if int(uid[-1]) % 2 == 0 else "die"

        with patch.object(status_service.Repo, "get_all", return_value=known_rows), \
             patch.object(status_service.Repo, "update_profile_statuses") as mock_update, \
             patch.object(status_service, "broadcast") as mock_broadcast, \
             patch.object(status_service, "check_profile_status_http_async", side_effect=fake_http_check), \
             patch.object(status_service, "_check_in_isolated_browser") as mock_browser:
            summary = await status_service.check_statuses(db, uids)

        self.assertEqual(started, 25)
        self.assertEqual(summary["live"] + summary["die"], 25)
        self.assertEqual(summary["inconclusive"], 0)
        mock_browser.assert_not_called()
        mock_update.assert_called_once()
        mock_broadcast.assert_called_once()

    async def test_browser_fallback_respects_concurrency_cap(self):
        uids = [f"200000{i:02d}" for i in range(10)]
        db = MagicMock()
        known_rows = [SimpleNamespace(uid=uid) for uid in uids]

        active = 0
        max_active = 0

        async def fake_http_none(uid, client):
            return None

        def fake_browser(uid):
            nonlocal active, max_active
            import time
            active += 1
            if active > max_active:
                max_active = active
            time.sleep(0.05)
            active -= 1
            return "live"

        with patch.object(status_service.Repo, "get_all", return_value=known_rows), \
             patch.object(status_service.Repo, "update_profile_statuses"), \
             patch.object(status_service, "broadcast"), \
             patch.object(status_service, "check_profile_status_http_async", side_effect=fake_http_none), \
             patch.object(status_service, "_check_in_isolated_browser", side_effect=fake_browser):
            summary = await status_service.check_statuses(db, uids)

        self.assertEqual(summary["live"], 10)
        self.assertLessEqual(max_active, status_service._BROWSER_FALLBACK_CONCURRENCY)
        self.assertGreaterEqual(max_active, 2)

    async def test_check_imported_runs_single_batch_without_chunking(self):
        uids = [f"300000{i:02d}" for i in range(35)]
        fake_db = MagicMock()
        calls = []

        async def fake_check_statuses(db, batch_uids):
            calls.append(list(batch_uids))
            return {"statuses": {}, "live": 20, "die": 10, "inconclusive": 5}

        with patch.object(status_service, "SessionLocal", return_value=fake_db), \
             patch.object(status_service, "check_statuses", side_effect=fake_check_statuses), \
             patch.object(status_service, "broadcast") as mock_broadcast:
            await status_service.check_imported(uids)

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0], uids)
        fake_db.close.assert_called_once()
        mock_broadcast.assert_called_once()

    async def test_error_in_single_uid_does_not_abort_others(self):
        uids = ["40000001", "40000002", "40000003"]
        db = MagicMock()
        known_rows = [SimpleNamespace(uid=uid) for uid in uids]

        async def fake_http(uid, client):
            if uid == "40000002":
                raise RuntimeError("Simulated network failure")
            return "live" if uid == "40000001" else "die"

        with patch.object(status_service.Repo, "get_all", return_value=known_rows), \
             patch.object(status_service.Repo, "update_profile_statuses") as mock_update, \
             patch.object(status_service, "broadcast"), \
             patch.object(status_service, "check_profile_status_http_async", side_effect=fake_http):
            summary = await status_service.check_statuses(db, uids)

        self.assertEqual(summary["live"], 1)
        self.assertEqual(summary["die"], 1)
        self.assertEqual(summary["inconclusive"], 1)
        self.assertEqual(summary["statuses"], {"40000001": "live", "40000003": "die"})
        mock_update.assert_called_once_with(db, {"40000001": "live", "40000003": "die"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
