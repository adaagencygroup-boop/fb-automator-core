"""Phiên mồ côi sau khi app tắt: heartbeat + đánh FAILED đúng phạm vi (nhiều engine chung DB)."""
from __future__ import annotations

import importlib
import threading
import unittest
from unittest import mock

from core.database.connection import db
from modules.module_11_page_scanner import scanner
from modules.module_11_page_scanner.browser_session import (
    ORPHAN_ERROR_MESSAGE,
    STALE_HEARTBEAT_SECONDS,
    STALE_RUNNING_MINUTES,
    mark_stale_running_sessions,
)

# api/__init__.py export biến `router` (APIRouter) che mất module cùng tên → import module trực tiếp
router = importlib.import_module("modules.module_11_page_scanner.api.router")


def _flat(sql: str) -> str:
    return " ".join(sql.split())


class TestMarkStaleRunningSessions(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(db, "_is_postgres", True)
        p.start()
        self.addCleanup(p.stop)
        p = mock.patch.object(db, "fetch_all", return_value=[{"id": 7}, {"id": 9}])
        self.fetch_all = p.start()
        self.addCleanup(p.stop)

    def test_startup_sweep_uses_heartbeat_and_legacy_rule_for_all_owners(self):
        self.assertEqual(mark_stale_running_sessions(), [7, 9])
        sql, params = self.fetch_all.call_args.args
        flat = _flat(sql)
        self.assertIn("SET status = 'FAILED'", flat)
        self.assertIn("status IN ('RUNNING', 'PAUSED')", flat)
        self.assertIn("heartbeat_at IS NOT NULL AND heartbeat_at < NOW()", flat)
        self.assertIn("heartbeat_at IS NULL AND COALESCE(started_at, created_at) < NOW()", flat)
        self.assertNotIn("owner_key", flat)
        self.assertNotIn("ANY", flat)
        self.assertEqual(params, (ORPHAN_ERROR_MESSAGE, STALE_HEARTBEAT_SECONDS, STALE_RUNNING_MINUTES))

    def test_api_sweep_is_owner_scoped_and_skips_local_sessions(self):
        mark_stale_running_sessions(owner_key="42", exclude_session_ids=[3, 4])
        sql, params = self.fetch_all.call_args.args
        flat = _flat(sql)
        self.assertIn("owner_key = %s", flat)
        self.assertIn("NOT (id = ANY(%s))", flat)
        self.assertEqual(params[-2:], ("42", [3, 4]))

    def test_thresholds_have_floor(self):
        mark_stale_running_sessions(heartbeat_timeout_s=1, legacy_max_age_minutes=1)
        params = self.fetch_all.call_args.args[1]
        self.assertEqual(params[1:3], (30, 30))

    def test_db_error_returns_empty(self):
        self.fetch_all.side_effect = RuntimeError("db down")
        self.assertEqual(mark_stale_running_sessions(owner_key="42"), [])

    def test_non_postgres_noop(self):
        with mock.patch.object(db, "_is_postgres", False):
            self.assertEqual(mark_stale_running_sessions(), [])
        self.fetch_all.assert_not_called()


class TestHeartbeat(unittest.TestCase):
    def setUp(self):
        self._saved_events = dict(scanner._ACTIVE_STOP_EVENTS)
        scanner._ACTIVE_STOP_EVENTS.clear()
        p = mock.patch.object(scanner.db, "execute")
        self.execute = p.start()
        self.addCleanup(p.stop)

    def tearDown(self):
        scanner._ACTIVE_STOP_EVENTS.clear()
        scanner._ACTIVE_STOP_EVENTS.update(self._saved_events)

    def test_heartbeat_noop_without_local_sessions(self):
        self.assertEqual(scanner._heartbeat_once(), 0)
        self.execute.assert_not_called()

    def test_heartbeat_updates_only_local_running_sessions(self):
        scanner._ACTIVE_STOP_EVENTS[11] = threading.Event()
        scanner._ACTIVE_STOP_EVENTS[12] = threading.Event()
        self.assertEqual(scanner._heartbeat_once(), 2)
        sql, params = self.execute.call_args.args
        self.assertIn("SET heartbeat_at = NOW()", _flat(sql))
        self.assertIn("status IN ('RUNNING', 'PAUSED')", _flat(sql))
        self.assertEqual(sorted(params[0]), [11, 12])

    def test_ensure_heartbeat_starts_single_thread(self):
        saved = scanner._HEARTBEAT_THREAD
        stop = threading.Event()
        scanner._HEARTBEAT_THREAD = None
        try:
            with mock.patch.object(scanner, "_heartbeat_loop", side_effect=lambda: stop.wait(5)):
                scanner.ensure_session_heartbeat()
                first = scanner._HEARTBEAT_THREAD
                scanner.ensure_session_heartbeat()
                self.assertIs(scanner._HEARTBEAT_THREAD, first)
                self.assertTrue(first.is_alive())
        finally:
            stop.set()
            scanner._HEARTBEAT_THREAD = saved

    def test_create_session_sets_heartbeat_and_starts_thread(self):
        with mock.patch.object(scanner.db, "fetch_one", return_value={"id": 5}) as fetch_one, \
                mock.patch.object(scanner, "ensure_session_heartbeat") as ensure:
            sid = scanner.create_scan_session("42", "#tag", "100001", "HASHTAG")
        self.assertEqual(sid, 5)
        ensure.assert_called_once()
        self.assertIn("heartbeat_at", fetch_one.call_args.args[0])


class TestRouterOrphanHelpers(unittest.TestCase):
    def test_sweep_passes_owner_and_local_ids(self):
        with mock.patch.object(router, "get_local_active_session_ids", return_value=[1, 2]), \
                mock.patch.object(router, "mark_stale_running_sessions", return_value=[8]) as mark:
            self.assertEqual(router._sweep_orphan_sessions("42"), [8])
        mark.assert_called_once_with(owner_key="42", exclude_session_ids=[1, 2])

    def test_orphan_candidate_only_when_not_running_locally(self):
        with mock.patch.object(router, "get_local_active_session_ids", return_value=[1]):
            self.assertFalse(router._is_orphan_candidate(1, "RUNNING"))
            self.assertTrue(router._is_orphan_candidate(2, "RUNNING"))
            self.assertTrue(router._is_orphan_candidate(2, "PAUSED"))
            self.assertFalse(router._is_orphan_candidate(2, "COMPLETED"))


if __name__ == "__main__":
    unittest.main()
