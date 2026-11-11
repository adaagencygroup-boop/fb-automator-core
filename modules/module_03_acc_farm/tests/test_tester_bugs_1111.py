"""
Bug tester 2026-11-11: nguồn nhóm "Theo đề xuất" (Theo từ khóa thì bắt buộc nhập), giới hạn mỗi ngày tách riêng
Tham gia nhóm / Kết bạn, tạm dừng không tính vào thời gian thực thi.
"""
import asyncio
import time
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.farming import flow as farming_flow


def normalized(**kw):
    return farm_routes._normalize_config(farm_routes.FarmScenarioConfig(**kw))


class GroupSourceTests(unittest.TestCase):
    def start(self, **config):
        req = farm_routes.FarmStartRequest(uids=["1"], threads=1, config=farm_routes.FarmScenarioConfig(**config))
        farm_routes._state["running"] = False
        with patch.object(farm_routes.adapters, "owner_from_request", return_value=None), \
                patch.object(farm_routes.adapters, "get_accounts", return_value={}):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(farm_routes.start_farm_interactions(req, Mock()))
        return ctx.exception.detail

    def test_keyword_source_requires_keyword(self):
        for keyword in ("", "  ", " , ,"):
            self.assertEqual(self.start(enabled_join_groups=True, group_source="keyword", group_keyword=keyword),
                             farm_routes.GROUP_KEYWORD_REQUIRED)

    def test_suggested_source_needs_no_keyword(self):
        # Qua bước kiểm từ khóa, dừng ở bước kiểm tài khoản
        self.assertIn("đủ điều kiện", self.start(enabled_join_groups=True, group_source="suggested"))

    def test_suggested_drops_keyword(self):
        cfg = normalized(enabled_join_groups=True, group_source="suggested", group_keyword="trọ")
        self.assertEqual(cfg.group_keyword, "")
        steps = dict(farm_routes._build_plan(cfg, {}))
        self.assertEqual(steps["JOIN_GROUP"]["keywords"], [])

    def test_suggested_split_note(self):
        cfg = normalized(enabled_join_groups=True, group_source="suggested", groups_split_enabled=True)
        _, notes = farm_routes._assign_targets(cfg, ["1", "2"], "machine:m1")
        self.assertTrue(any("Nhóm đề xuất" in n for n in notes))


class DailyLimitSplitTests(unittest.TestCase):
    def test_old_single_switch_applies_to_both(self):
        cfg = normalized(daily_limit_enabled=True)
        self.assertEqual((cfg.daily_friend_limit_enabled, cfg.daily_group_limit_enabled), (True, True))

    def test_separate_switches(self):
        cfg = normalized(daily_friend_limit_enabled=False, daily_group_limit_enabled=True, daily_group_limit=3)
        self.assertTrue(cfg.daily_limit_enabled)
        with patch.object(farm_routes.repository, "sum_today", return_value=1) as sum_today:
            self.assertEqual(farm_routes._apply_daily_limit("100", "ADD_FRIEND", 5, cfg), (5, 0, 0))
            sum_today.assert_not_called()
            self.assertEqual(farm_routes._apply_daily_limit("100", "JOIN_GROUP", 5, cfg), (2, 1, 3))

    def test_settings_keys(self):
        for key in ("farm_daily_friend_limit_enabled", "farm_daily_group_limit_enabled"):
            self.assertEqual(farm_routes.SETTING_KEYS[key][0], "bool")


class PauseTimeTests(unittest.TestCase):
    def setUp(self):
        farm_routes._control = farming_flow.FarmControl()
        farm_routes._state["running"] = True
        farm_routes._state["accounts"] = {
            "1": {"uid": "1", "status": "RUNNING", "paused_seconds": 0.0, "paused_at": None},
            "2": {"uid": "2", "status": "PENDING", "paused_seconds": 0.0, "paused_at": None},
        }

    def tearDown(self):
        farm_routes._state["running"] = False
        farm_routes._state["accounts"] = {}

    def test_pause_resume_accumulates_for_running_nick(self):
        clock = {"now": 100.0}
        with patch.object(farm_routes, "_emit"), patch.object(farm_routes.time, "time", side_effect=lambda: clock["now"]):
            asyncio.run(farm_routes.pause_farm())
            clock["now"] = 130.0
            asyncio.run(farm_routes.resume_farm())
        acc = farm_routes._state["accounts"]
        self.assertEqual((acc["1"]["paused_seconds"], acc["1"]["paused_at"]), (30.0, None))
        self.assertEqual(acc["2"]["paused_seconds"], 0.0)

    def test_paused_seconds_counts_ongoing_pause(self):
        now = time.time()
        self.assertAlmostEqual(farm_routes._paused_seconds({"paused_seconds": 5.0, "paused_at": now - 10}), 15.0, delta=1)
        self.assertEqual(farm_routes._paused_seconds({}), 0.0)


if __name__ == "__main__":
    unittest.main()
