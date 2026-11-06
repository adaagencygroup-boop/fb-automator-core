"""Dừng / lỗi giữa chừng: log + lịch sử báo phần đã làm được của kịch bản đang chạy dở."""
import threading
import unittest
from unittest.mock import Mock, patch

from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.farming import flow as farming_flow
from modules.module_03_acc_farm.tests.test_farm_optimizations import ACCOUNT

JOIN_PLAN = [("JOIN_GROUP", {"target": 5, "keywords": ["trọ cầu giấy"]})]


def groups(*names, result=None):
    return [{"name": n, "url": f"https://www.facebook.com/groups/{i}", "status": "joined",
             **({"result": result} if result else {})} for i, n in enumerate(names)]


class PartialDoneTextTests(unittest.TestCase):
    def test_join_lists_names(self):
        self.assertEqual(farm_routes._partial_done("JOIN_GROUP", 2, {"targets": groups("Nhóm A", "Nhóm B")}),
                         "đã tham gia 2 nhóm: Nhóm A, Nhóm B")

    def test_many_names_are_shortened(self):
        names = [f"Nhóm {i}" for i in range(7)]
        self.assertEqual(farm_routes._partial_done("JOIN_GROUP", 7, {"targets": groups(*names)}),
                         "đã tham gia 7 nhóm: Nhóm 0, Nhóm 1, Nhóm 2, Nhóm 3, Nhóm 4 và 2 nhóm khác")

    def test_skipped_links_not_listed(self):
        targets = groups("Nhóm A") + groups("Nhóm bỏ qua", result="skipped_done")
        self.assertEqual(farm_routes._partial_done("JOIN_GROUP", 1, {"targets": targets}), "đã tham gia 1 nhóm: Nhóm A")

    def test_nothing_done_yet(self):
        self.assertEqual(farm_routes._partial_done("JOIN_GROUP", 0, {}), "chưa tham gia được nhóm nào")
        self.assertEqual(farm_routes._partial_done("ADD_FRIEND", 0, {}), "chưa gửi được lời mời nào")
        self.assertEqual(farm_routes._partial_done("NEWSFEED", 0, {}), "chưa lướt được")

    def test_other_scenarios(self):
        friends = [{"name": "Mai", "url": "https://www.facebook.com/mai", "result": "sent"}]
        self.assertEqual(farm_routes._partial_done("ADD_FRIEND", 1, {"targets": friends}), "đã gửi 1 lời mời: Mai")
        self.assertEqual(farm_routes._partial_done("WATCH", 6, {"seconds": 90, "reactions": 2}),
                         "đã xem 6 video, thả 2 cảm xúc")
        self.assertEqual(farm_routes._partial_done("STORY", 3, {}), "đã xem 3 story")
        self.assertEqual(farm_routes._partial_done("NEWSFEED", 0, {"seconds": 90, "scrolls": 12}),
                         "đã lướt 1.5 phút, cuộn 12 lần")
        self.assertEqual(farm_routes._partial_done("CHECK_NOTIF", 0, {}), "")


class WorkerStopLogTests(unittest.TestCase):
    def run_worker(self, plan, runners):
        """runners: tên hàm kịch bản -> hàm giả. Ghi hành động thật (chỉ bỏ ghi CSDL) để có dòng tóm tắt cuối lượt."""
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        emitted, accounts = [], []
        farm_routes._control = farming_flow.FarmControl()
        farm_routes._history_data.clear()
        for name, fn in runners.items():
            runner_patch = patch.object(farm_routes, name, side_effect=fn)
            runner_patch.start()
            self.addCleanup(runner_patch.stop)
        with patch.object(farm_routes, "_set_account", side_effect=lambda uid, **f: accounts.append(f)), \
                patch.object(farm_routes.repository, "add_log"), \
                patch.object(farm_routes, "_emit", side_effect=lambda level, text, *a: emitted.append((level, text))), \
                patch.object(farm_routes, "_uid_has_other_browser", return_value=False), \
                patch.object(farm_routes, "_build_plan", return_value=plan), \
                patch.object(farm_routes, "_target_owners", return_value=None), \
                patch.object(farm_routes, "dismiss_notice_dialogs"), \
                patch.object(farm_routes.adapters, "get_account", return_value=dict(ACCOUNT)), \
                patch.object(farm_routes.adapters, "get_credentials", return_value=("", None)), \
                patch.object(farm_routes.adapters, "set_login_status"), \
                patch.object(farm_routes.random, "uniform", return_value=0), \
                patch("core.browser.open_browser", return_value=driver), \
                patch("core.browser.get_profile_lock", return_value=threading.Lock()), \
                patch("core.browser.extract_cookies_as_string", return_value=""), \
                patch("modules.module_03_acc_farm.browser.login_flow.ensure_logged_in", return_value={"success": True}):
            farm_routes._farm_worker("100", 1, farm_routes.FarmScenarioConfig(enabled_join_groups=True), None)
        final = [a for a in accounts if "status" in a][-1]
        records = list((farm_routes._history_data.get("100") or {}).get("actions") or [])
        return records, emitted, final

    @staticmethod
    def joining(error, joined):
        def run(driver, ctl, target, keywords, report, progress, **kwargs):
            progress(len(joined))
            error.partial = {"keywords": keywords, "targets": joined}
            raise error
        return run

    def test_stop_logs_groups_already_joined(self):
        stop = farming_flow.FarmStopped()
        records, emitted, final = self.run_worker(JOIN_PLAN, {"run_join_groups": self.joining(stop, groups("Nhóm A", "Nhóm B"))})
        line = "Tham gia nhóm: Dừng giữa chừng, đã tham gia 2 nhóm: Nhóm A, Nhóm B"
        self.assertIn(("warning", line), emitted)
        self.assertEqual(records[0]["details"], "Dừng giữa chừng, đã tham gia 2 nhóm: Nhóm A, Nhóm B")
        summary = "Đã dừng theo yêu cầu. Đã làm: Tham gia nhóm 2 nhóm (dừng giữa chừng)"
        self.assertEqual((final["status"], final["activity"]), ("STOPPED", summary))
        self.assertEqual(emitted[-1], ("warning", summary))

    def test_stop_before_anything_joined(self):
        records, emitted, final = self.run_worker(JOIN_PLAN, {"run_join_groups": self.joining(farming_flow.FarmStopped(), [])})
        self.assertIn(("warning", "Tham gia nhóm: Dừng giữa chừng, chưa tham gia được nhóm nào"), emitted)
        self.assertEqual(final["activity"], "Đã dừng theo yêu cầu. Chưa làm xong việc nào")

    def test_dead_account_logs_what_was_done(self):
        dead = farming_flow.FarmAccountDead("Phiên đăng nhập không còn hợp lệ")
        records, emitted, final = self.run_worker(JOIN_PLAN, {"run_join_groups": self.joining(dead, groups("Nhóm A"))})
        details = "Tài khoản chết giữa chừng: Phiên đăng nhập không còn hợp lệ (trước đó đã tham gia 1 nhóm: Nhóm A)"
        self.assertIn(("error", f"Tham gia nhóm: {details}"), emitted)
        self.assertEqual(records[0]["details"], details)
        self.assertEqual(final["status"], "DIE")
        self.assertTrue(emitted[-1][1].endswith(". Đã làm: Tham gia nhóm 1 nhóm (lỗi giữa chừng)"))

    def test_action_error_keeps_running_and_mentions_done_part(self):
        error = RuntimeError("Không đọc được danh sách nhóm")
        records, emitted, final = self.run_worker(JOIN_PLAN, {"run_join_groups": self.joining(error, groups("Nhóm A"))})
        self.assertEqual(records[0]["details"], "Không đọc được danh sách nhóm (trước đó đã tham gia 1 nhóm: Nhóm A)")
        self.assertEqual(final["status"], "COMPLETED")

    def test_stop_during_watch_summarises_finished_scenarios(self):
        plan = [("JOIN_GROUP", {"target": 3, "keywords": ["trọ"]}), ("ADD_FRIEND", {"target": 5}),
                ("WATCH", {"total_seconds": 600, "delay": (5, 9)})]
        stop = farming_flow.FarmStopped()
        stop.partial = {"seconds": 80, "quantity": 4}

        def watching(*args, **kwargs):
            raise stop

        joined = {"status": "SUCCESS", "quantity": 3, "details": "Đã tham gia 3/3 nhóm", "targets": groups("A", "B", "C")}
        sent = {"status": "SUCCESS", "quantity": 5, "details": "Đã gửi 5/5 lời mời kết bạn"}
        _, emitted, final = self.run_worker(plan, {
            "run_join_groups": lambda *a, **k: joined, "run_add_friends": lambda *a, **k: sent, "run_watch": watching,
        })
        self.assertIn(("warning", "Xem Video Watch: Dừng giữa chừng, đã xem 4 video"), emitted)
        summary = ("Đã dừng theo yêu cầu. Đã làm: Tham gia nhóm 3 nhóm, Kết bạn 5 lời mời, "
                   "Xem Watch 4 video (dừng giữa chừng)")
        self.assertEqual(emitted[-1], ("warning", summary))
        self.assertEqual(final["activity"], summary)

    def test_completed_run_also_summarised(self):
        joined = {"status": "SUCCESS", "quantity": 2, "details": "Đã tham gia 2/2 nhóm", "targets": groups("A", "B")}
        _, emitted, final = self.run_worker(JOIN_PLAN, {"run_join_groups": lambda *a, **k: joined})
        self.assertTrue(emitted[-1][1].startswith("Hoàn thành toàn bộ kịch bản"))
        self.assertTrue(emitted[-1][1].endswith(". Đã làm: Tham gia nhóm 2 nhóm"))
        self.assertNotIn("Đã làm", final["activity"])


class SessionTotalsTests(unittest.TestCase):
    def test_totals_across_nicks(self):
        totals = farm_routes._done_totals({
            "a": [{"action": "JOIN_GROUP", "status": "SUCCESS", "quantity": 2},
                  {"action": "NEWSFEED", "status": "SUCCESS", "seconds": 90}],
            "b": [{"action": "JOIN_GROUP", "status": "SKIPPED", "quantity": 1, "details": "Dừng giữa chừng"},
                  {"action": "ADD_FRIEND", "status": "BLOCKED", "quantity": 4},
                  {"action": "WATCH", "status": "SUCCESS", "quantity": 0}],
        })
        self.assertEqual(totals, "tham gia 3 nhóm, gửi 4 lời mời, lướt Newsfeed 1.5 phút")

    def test_nothing_done(self):
        self.assertEqual(farm_routes._done_totals({"a": [], "b": [{"action": "WATCH", "status": "FAILED"}]}), "")

    def test_nick_summary_marks(self):
        self.assertEqual(farm_routes._done_summary([
            {"action": "CHECK_NOTIF", "status": "SUCCESS"},
            {"action": "ADD_FRIEND", "status": "BLOCKED", "quantity": 2},
            {"action": "STORY", "status": "FAILED", "quantity": 3},
            {"action": "LEAVE_GROUP", "status": "SKIPPED", "quantity": 0},
        ]), "Check thông báo, Kết bạn 2 lời mời (bị chặn), Xem Story 3 story (lỗi giữa chừng)")


class SuccessLogNamesTests(unittest.TestCase):
    """Chạy xong theo từ khóa / gợi ý: dòng kết quả kèm tên nhóm / người; theo danh sách link thì không lặp lại."""

    run_worker = WorkerStopLogTests.run_worker

    @staticmethod
    def finished(action_result):
        return lambda *a, **k: action_result

    def test_keyword_join_lists_names(self):
        result = {"status": "SUCCESS", "quantity": 2, "details": "Đã tham gia 2/2 nhóm (từ khóa 'trọ')",
                  "targets": groups("Nhóm A", "Nhóm B")}
        _, emitted, _ = self.run_worker(JOIN_PLAN, {"run_join_groups": self.finished(result)})
        self.assertIn(("success", "Tham gia nhóm: Đã tham gia 2/2 nhóm (từ khóa 'trọ'): Nhóm A, Nhóm B"), emitted)

    def test_suggested_friends_list_names(self):
        result = {"status": "SUCCESS", "quantity": 1, "details": "Đã gửi 1/1 lời mời kết bạn",
                  "targets": [{"name": "Mai", "url": "https://www.facebook.com/mai"}]}
        _, emitted, _ = self.run_worker([("ADD_FRIEND", {"target": 1})], {"run_add_friends": self.finished(result)})
        self.assertIn(("success", "Kết bạn theo gợi ý: Đã gửi 1/1 lời mời kết bạn: Mai"), emitted)

    def test_link_list_mode_not_repeated(self):
        plan = [("JOIN_GROUP", {"target": 2, "links": [{"key": "group:1", "url": "u", "source": "u"}]})]
        result = {"status": "SUCCESS", "quantity": 1, "details": "Đã tham gia 1/2 nhóm theo danh sách",
                  "targets": groups("Nhóm A")}
        _, emitted, _ = self.run_worker(plan, {"run_join_groups_from_links": self.finished(result)})
        self.assertIn(("success", "Tham gia nhóm theo danh sách: Đã tham gia 1/2 nhóm theo danh sách"), emitted)


if __name__ == "__main__":
    unittest.main()
