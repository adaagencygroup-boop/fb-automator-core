"""Xóa page / bài viết / followers: đếm đúng số dòng đã xóa, lỗi DB → 500 (không báo thành công giả)."""
from __future__ import annotations

import asyncio
import importlib
import unittest
from unittest import mock

from fastapi import HTTPException

router = importlib.import_module("modules.module_11_page_scanner.api.router")


def _flat(sql: str) -> str:
    return " ".join(sql.split())


class TestDeleteEndpoints(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(router, "_get_owner", return_value="42")
        p.start()
        self.addCleanup(p.stop)

    def _run(self, coro):
        return asyncio.run(coro)

    def test_delete_pages_counts_real_rows(self):
        with mock.patch.object(router.db, "fetch_all", return_value=[{"page_key": "user:a"}]) as fa:
            res = self._run(router.delete_scanned_pages(router.DeletePagesInput(page_keys=["user:a", "user:gone", "user:a"])))
        self.assertEqual(res, {"deleted": 1, "requested": 2})
        sql, params = fa.call_args.args
        self.assertIn("page_key = ANY(%s) RETURNING", _flat(sql))
        self.assertEqual(params, ("42", ["user:a", "user:gone"]))

    def test_delete_posts_by_id_and_key_in_one_statement(self):
        with mock.patch.object(router.db, "fetch_all", return_value=[{"id": 5}, {"id": 9}]) as fa:
            res = self._run(router.delete_scanned_posts(router.DeletePostsInput(post_ids=[5, "9", "post:123"])))
        self.assertEqual(res["deleted"], 2)
        sql, params = fa.call_args.args
        self.assertIn("(id = ANY(%s) OR post_key = ANY(%s))", _flat(sql))
        self.assertEqual(params, ("42", [5, 9], ["post:123"]))

    def test_delete_followers(self):
        with mock.patch.object(router.db, "fetch_all", return_value=[{"id": 1}]) as fa:
            res = self._run(router.delete_scanned_followers(router.DeleteFollowersInput(follower_ids=[1, 1, 2])))
        self.assertEqual(res, {"deleted": 1, "requested": 2})
        self.assertEqual(fa.call_args.args[1], ("42", [1, 2]))

    def test_empty_request_does_not_hit_db(self):
        with mock.patch.object(router.db, "fetch_all") as fa:
            self.assertEqual(self._run(router.delete_scanned_pages(router.DeletePagesInput(page_keys=[" "])))["deleted"], 0)
        fa.assert_not_called()

    def test_db_error_is_reported_not_swallowed(self):
        with mock.patch.object(router.db, "fetch_all", side_effect=RuntimeError("db down")):
            with self.assertRaises(HTTPException) as ctx:
                self._run(router.delete_scanned_pages(router.DeletePagesInput(page_keys=["user:a"])))
        self.assertEqual(ctx.exception.status_code, 500)


if __name__ == "__main__":
    unittest.main()
