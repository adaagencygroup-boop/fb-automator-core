import json
import unittest
from datetime import timedelta
from unittest.mock import Mock, patch

from modules.module_03_acc_farm import repository
from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.farming import flow as farming_flow

FLOW = "modules.module_03_acc_farm.farming.flow"


class ParseAgoTests(unittest.TestCase):
    def test_formats_seen_on_facebook(self):
        cases = {"a few seconds ago": 3 / 86400, "about a minute ago": 1 / 1440, "50 minutes ago": 50 / 1440,
                 "about an hour ago": 1 / 24, "2 hours ago": 2 / 24, "a day ago": 1, "5 days ago": 5, "a week ago": 7,
                 "3 weeks ago": 21, "about a month ago": 30, "2 years ago": 730, "  5   Days ago ": 5, "yesterday": 1}
        for text, days in cases.items():
            self.assertAlmostEqual(farming_flow.parse_ago_days(text), days, msg=text)

    def test_unknown_returns_none(self):
        for text in (None, "", "5 ngày trước", "Last active", "recently", "5 days"):
            self.assertIsNone(farming_flow.parse_ago_days(text), text)


class LeaveConfigTests(unittest.TestCase):
    def test_defaults_and_normalize(self):
        cfg = farm_routes.FarmScenarioConfig()
        self.assertEqual((cfg.enabled_leave_groups, cfg.leave_min, cfg.leave_max, cfg.leave_delay_min,
                          cfg.leave_delay_max, cfg.leave_criteria, cfg.leave_keep_admin),
                         (False, 3, 5, 10, 30, "not_visited", True))
        cfg = farm_routes._normalize_config(farm_routes.FarmScenarioConfig(leave_min=6, leave_max=2,
                                                                           leave_delay_min=1, leave_delay_max=0))
        self.assertEqual((cfg.leave_min, cfg.leave_max, cfg.leave_delay_min, cfg.leave_delay_max), (2, 6, 5, 5))

    def test_invalid_criteria_rejected(self):
        with self.assertRaises(ValueError):
            farm_routes.FarmScenarioConfig(leave_criteria="all")

    def test_leave_always_before_join(self):
        cfg = farm_routes._normalize_config(farm_routes.FarmScenarioConfig(
            enabled_newsfeed=True, enabled_watch=True, enabled_join_groups=True, enabled_leave_groups=True,
            enabled_add_friends=True, enabled_check_notif=True))
        for _ in range(40):
            names = [a for a, _ in farm_routes._build_plan(cfg)]
            self.assertEqual(names[0], "CHECK_NOTIF")
            self.assertLess(names.index("LEAVE_GROUP"), names.index("JOIN_GROUP"))
            self.assertEqual(len(names), 6)

    def test_threshold_days_by_criteria(self):
        for criteria, (low, high) in (("not_visited", (5, 7)), ("inactive", (5, 7)), ("recent", (2, 3))):
            cfg = farm_routes._normalize_config(farm_routes.FarmScenarioConfig(enabled_leave_groups=True,
                                                                               leave_criteria=criteria))
            days = {dict(farm_routes._build_plan(cfg))["LEAVE_GROUP"]["days"] for _ in range(40)}
            self.assertTrue(days <= set(range(low, high + 1)), (criteria, days))

    def test_summarize_groups_left(self):
        out = repository.summarize_actions([{"action": "LEAVE_GROUP", "status": "SUCCESS", "quantity": 3}])
        self.assertEqual(out["groups_left"], 3)
        self.assertIn("groups_left", repository.HISTORY_COLUMNS)


class RecentJoinedTests(unittest.TestCase):
    @staticmethod
    def row(run_id, action, targets, days_ago):
        return {"run_id": run_id, "action_type": action, "targets": json.dumps(targets),
                "created_at": repository.utc_now() - timedelta(days=days_ago)}

    def recent(self, rows, days=3, current=99):
        with patch.object(repository, "group_target_history", return_value=rows):
            return farm_routes._recent_joined_groups("100", days, current)

    def test_only_joined_in_window_from_previous_sessions(self):
        url = lambda g: f"https://www.facebook.com/groups/{g}/"  # noqa: E731
        out = self.recent([
            self.row(1, "JOIN_GROUP", [{"url": url("old"), "status": "joined"}], 5),
            self.row(2, "JOIN_GROUP", [{"url": url("keyword"), "status": "joined"}], 1),
            self.row(3, "JOIN_GROUP", [{"url": url("list"), "source_url": "fb.com/groups/list", "result": "joined"}], 2),
            self.row(4, "JOIN_GROUP", [{"url": url("pending"), "result": "pending"}], 1),
            self.row(5, "JOIN_GROUP", [{"url": url("unknown"), "result": None}], 1),
            self.row(6, "JOIN_GROUP", [{"url": url("left"), "result": "joined"}], 2),
            self.row(7, "LEAVE_GROUP", [{"url": url("left"), "result": "left"}], 1),
            self.row(99, "JOIN_GROUP", [{"url": url("this_session"), "result": "joined"}], 0),
        ])
        self.assertEqual(set(out), {"group:keyword", "group:list"})
        self.assertAlmostEqual(out["group:keyword"], 1, places=2)

    def test_db_error_raises(self):
        with patch.object(repository, "group_target_history", side_effect=OSError("offline")):
            with self.assertRaises(RuntimeError):
                farm_routes._recent_joined_groups("100", 3, None)


def group(gid, visited=None, active=None, admin=False, card=True):
    return {"id": gid, "name": f"Nhóm {gid}", "visited": visited, "active": active, "admin": admin, "card": card}


class RunLeaveGroupsTests(unittest.TestCase):
    def run_flow(self, groups, target, criteria="not_visited", days=5, keep_admin=True, outcomes=None, recent=None):
        left_calls, logs, counts = [], [], []
        outcomes = outcomes or {}

        def leave(drv, ctl, gid):
            left_calls.append(gid)
            return outcomes.get(gid, "left")

        with patch(f"{FLOW}._open"), patch(f"{FLOW}._wait_for_any"), \
                patch(f"{FLOW}._load_joined_groups", return_value=groups), \
                patch(f"{FLOW}._leave_group", side_effect=leave), \
                patch(f"{FLOW}._pause_between"), \
                patch(f"{FLOW}.random.shuffle", side_effect=lambda items: None):
            result = farming_flow.run_leave_groups(
                Mock(), farming_flow.FarmControl(), target, criteria, days, keep_admin, Mock(),
                progress=counts.append, recent=recent, log=lambda level, text: logs.append((level, text)))
        return result, left_calls, logs, counts

    def test_not_visited_threshold_unreadable_and_admin(self):
        groups = [group("a", visited="9 days ago"), group("b", visited="2 hours ago"), group("c", visited=None),
                  group("d", visited="a week ago", admin=True), group("e", visited="5 days ago"),
                  group("f", visited="3 weeks ago", card=False)]
        result, calls, logs, counts = self.run_flow(groups, target=5)
        self.assertEqual(calls, ["a", "e"])  # b chưa đủ ngày, c không đọc được, d admin, f không có thẻ
        self.assertEqual((result["status"], result["quantity"], counts), ("SUCCESS", 2, [1, 2]))
        self.assertIn("chỉ có 2 nhóm đủ tiêu chí", result["details"])
        self.assertEqual(result["targets"][0], {"name": "Nhóm a", "url": "https://www.facebook.com/groups/a/",
                                                "reason": "You last visited 9 days ago", "result": "left",
                                                "status": "left"})
        self.assertIn("1 nhóm không đọc được thời gian, không rời", logs[0][1])
        self.assertIn("1 nhóm là Admin/Mod, giữ lại", logs[0][1])

    def test_inactive_uses_last_active(self):
        groups = [group("a", visited="9 days ago", active="2 hours ago"), group("b", visited=None, active="6 days ago")]
        _, calls, _, _ = self.run_flow(groups, target=5, criteria="inactive", days=6)
        self.assertEqual(calls, ["b"])

    def test_target_limits_and_admin_allowed_when_unticked(self):
        groups = [group(g, visited="10 days ago", admin=(g == "a")) for g in "abcd"]
        result, calls, _, _ = self.run_flow(groups, target=2, keep_admin=False)
        self.assertEqual((calls, result["quantity"]), (["a", "b"], 2))
        self.assertNotIn("chỉ có", result["details"])

    def test_last_admin_cancelled_and_not_counted(self):
        groups = [group(g, visited="10 days ago") for g in "abc"]
        result, calls, _, _ = self.run_flow(groups, target=2, keep_admin=False, outcomes={"a": "last_admin"})
        self.assertEqual((calls, result["quantity"]), (["a", "b", "c"], 2))
        self.assertEqual(result["targets"][0]["result"], "skipped_last_admin")

    def test_recent_uses_tool_history(self):
        groups = [group("old", visited="2 hours ago"), group("new", visited="2 hours ago")]
        result, calls, _, _ = self.run_flow(groups, target=3, criteria="recent", days=3, recent={"group:new": 1.2})
        self.assertEqual(calls, ["new"])
        self.assertEqual(result["targets"][0]["reason"], "tool vào nhóm 1.2 ngày trước")

    def test_nothing_eligible(self):
        result, calls, _, _ = self.run_flow([group("a", visited="1 day ago")], target=3)
        self.assertEqual((result["status"], calls), ("SKIPPED", []))

    def test_blocked_stops(self):
        groups = [group(g, visited="10 days ago") for g in "abc"]
        result, calls, _, _ = self.run_flow(groups, target=3, outcomes={"b": "blocked"})
        self.assertEqual((result["status"], result["quantity"], calls), ("BLOCKED", 1, ["a", "b"]))

    def test_left_target_feeds_rejoin_rule(self):
        # Mục "left" ghi ra được Tham gia nhóm theo danh sách đọc lại (vào lại sau 7 ngày)
        result, _, _, _ = self.run_flow([group("123", visited="10 days ago")], target=1)
        rows = [{"run_id": 1, "action_type": "LEAVE_GROUP", "targets": json.dumps(result["targets"]),
                 "created_at": repository.utc_now()}]
        with patch.object(repository, "group_target_history", return_value=rows):
            skips = farm_routes._group_history_skips("100")
        self.assertIn("chưa đủ 7 ngày", skips["group:123"])


if __name__ == "__main__":
    unittest.main()
