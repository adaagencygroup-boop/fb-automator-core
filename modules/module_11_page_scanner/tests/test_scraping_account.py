"""Chọn acc cào chỉ trong acc của đúng owner — không dùng nhầm acc user khác."""
from __future__ import annotations

import unittest
from unittest import mock

from modules.module_11_page_scanner import scanner
from modules.module_11_page_scanner.scanner import accounts_owner_for, get_scraping_account

ACC = {"id": 1, "uid": "100001", "user_id": "42", "cookie": "c_user=1", "proxy": None,
       "profile_name": "acc", "status": "LIVE"}


def _sql(call) -> str:
    return " ".join(call.args[0].split())


class TestAccountsOwnerFor(unittest.TestCase):
    def test_system_or_empty_means_not_logged_in(self):
        for raw in ("system", "", "   ", None):
            self.assertIsNone(accounts_owner_for(raw))

    def test_real_owner_is_trimmed(self):
        self.assertEqual(accounts_owner_for(" 42 "), "42")


class TestGetScrapingAccount(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(scanner.db, "fetch_one")
        self.fetch_one = p.start()
        self.addCleanup(p.stop)

    def test_explicit_uid_is_scoped_to_owner(self):
        self.fetch_one.return_value = dict(ACC)
        acc = get_scraping_account("100001", owner_key="42")
        self.assertEqual(acc["uid"], "100001")
        call = self.fetch_one.call_args
        self.assertIn("user_id IS NOT DISTINCT FROM %s", _sql(call))
        self.assertEqual(call.args[1], ("100001", "42"))

    def test_explicit_uid_not_owned_raises_and_does_not_fall_back(self):
        self.fetch_one.return_value = None
        with self.assertRaises(ValueError) as ctx:
            get_scraping_account("100001", owner_key="42")
        self.assertIn("không thuộc về bạn", str(ctx.exception))
        self.assertEqual(self.fetch_one.call_count, 1)

    def test_explicit_uid_blocked_status_raises(self):
        for status in ("DIE", "die", "Checkpoint", "ERROR"):
            self.fetch_one.return_value = {**ACC, "status": status}
            with self.assertRaises(ValueError):
                get_scraping_account("100001", owner_key="42")

    def test_explicit_uid_new_status_allowed(self):
        self.fetch_one.return_value = {**ACC, "status": "NEW"}
        self.assertEqual(get_scraping_account("100001", owner_key="42")["status"], "NEW")

    def test_auto_pick_is_scoped_to_owner(self):
        self.fetch_one.return_value = dict(ACC)
        get_scraping_account(None, owner_key="42")
        call = self.fetch_one.call_args
        sql = _sql(call)
        self.assertIn("user_id IS NOT DISTINCT FROM %s", sql)
        self.assertIn("cookie IS NOT NULL", sql)
        self.assertEqual(call.args[1], ("42",))

    def test_auto_pick_for_system_owner_uses_null_user_id(self):
        self.fetch_one.return_value = None
        self.assertIsNone(get_scraping_account("", owner_key="system"))
        self.assertEqual(self.fetch_one.call_args.args[1], (None,))

    def test_db_error_returns_none(self):
        self.fetch_one.side_effect = RuntimeError("db down")
        self.assertIsNone(get_scraping_account("100001", owner_key="42"))
        self.assertIsNone(get_scraping_account(None, owner_key="42"))


if __name__ == "__main__":
    unittest.main()
