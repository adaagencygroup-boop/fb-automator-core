"""Bộ lọc trạng thái ở Lịch sử không có "Acc chết": lọc "Lỗi hệ thống" ra cả lượt DIE (tester 2026-11-06)."""
import unittest

from modules.module_03_acc_farm import repository


class HistoryStatusFilterTests(unittest.TestCase):
    def where(self, status):
        where, params = repository._history_where("m1", {"status": status})
        return where, list(params)

    def test_failed_includes_dead_accounts(self):
        where, params = self.where("FAILED")
        self.assertIn("h.final_status IN (?, ?)", where)
        self.assertEqual(params[-2:], ["FAILED", "DIE"])

    def test_other_status_unchanged(self):
        where, params = self.where("COMPLETED")
        self.assertIn("h.final_status IN (?)", where)
        self.assertEqual(params[-1], "COMPLETED")

    def test_no_status_no_condition(self):
        where, _ = self.where("")
        self.assertNotIn("final_status", where)


if __name__ == "__main__":
    unittest.main()
