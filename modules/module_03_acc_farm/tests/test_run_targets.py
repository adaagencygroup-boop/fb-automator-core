"""API danh sách nhóm đã vào / đã rời + người đã gửi lời mời của 1 lượt, dùng cho popup ở Giám sát tiến trình."""
import asyncio
import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from modules.module_03_acc_farm import repository
from modules.module_03_acc_farm import routes as farm_routes


def _row(action, *targets):
    return {"action_type": action, "targets": json.dumps(targets) if targets else None}


class RunTargetsRouteTests(unittest.TestCase):
    def call(self, rows):
        with patch.object(farm_routes.adapters, "get_machine_id", return_value="m1"), \
                patch.object(repository, "get_run_targets", return_value=rows) as read:
            result = asyncio.run(farm_routes.farm_run_targets(7))
        read.assert_called_once_with("m1", 7)
        return result

    def test_splits_by_action(self):
        joined = {"name": "Nhóm A", "url": "https://www.facebook.com/groups/a", "status": "joined"}
        left = {"name": "Nhóm B", "url": "https://www.facebook.com/groups/b", "status": "left"}
        friend = {"name": "Mai", "url": "https://www.facebook.com/mai"}
        self.assertEqual(self.call([_row("JOIN_GROUP", joined), _row("LEAVE_GROUP", left), _row("ADD_FRIEND", friend)]),
                         {"groups_joined": [joined], "groups_left": [left], "friends_sent": [friend]})

    def test_merges_rows_of_same_action(self):
        one, two = {"name": "Mai"}, {"name": "Lan"}
        self.assertEqual(self.call([_row("ADD_FRIEND", one), _row("ADD_FRIEND", two)])["friends_sent"], [one, two])

    def test_skipped_links_are_not_listed(self):
        kept = {"name": "Nhóm A", "result": "joined"}
        skipped = {"name": "Nhóm B", "result": "skipped_done"}
        self.assertEqual(self.call([_row("JOIN_GROUP", kept, skipped)])["groups_joined"], [kept])

    def test_empty_or_broken_targets(self):
        empty = {"groups_joined": [], "groups_left": [], "friends_sent": []}
        self.assertEqual(self.call([]), empty)
        self.assertEqual(self.call([_row("JOIN_GROUP"), {"action_type": "ADD_FRIEND", "targets": "{hỏng"}]), empty)
        self.assertEqual(self.call([{"action_type": "JOIN_GROUP", "targets": json.dumps(["chuỗi"])}]), empty)

    def test_database_error_is_readable(self):
        with patch.object(farm_routes.adapters, "get_machine_id", return_value="m1"), \
                patch.object(repository, "get_run_targets", side_effect=RuntimeError("password=secret host=db")):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(farm_routes.farm_run_targets(7))
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertNotIn("secret", ctx.exception.detail)


class RunTargetsQueryTests(unittest.TestCase):
    def test_scoped_to_run_and_machine(self):
        with patch.object(repository.db, "fetch_all", return_value=[]) as fetch:
            repository.get_run_targets("m1", 7)
        sql, params = fetch.call_args.args
        self.assertIn("run_id = ?", sql)
        self.assertIn("machine_id = ?", sql)
        self.assertEqual(params, (7, "m1"))


if __name__ == "__main__":
    unittest.main()
