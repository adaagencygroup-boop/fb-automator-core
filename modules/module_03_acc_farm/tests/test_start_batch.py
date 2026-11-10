"""
Kích hoạt đọc nick / tạo lượt chạy gộp 1 lần (CSDL Supabase ở xa: bấm Kích hoạt từng chậm quá 60s, tester gặp
2026-11-06) và API nick có lịch sử cho bộ lọc theo tài khoản.
"""
import asyncio
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from modules.module_03_acc_farm import routes as farm_routes

ACCOUNT = {"status": "live", "login_status": "logged_in"}


def start_request(uids):
    return farm_routes.FarmStartRequest(uids=uids, threads=1,
                                        config=farm_routes.FarmScenarioConfig(enabled_newsfeed=True))


class StartBatchTests(unittest.TestCase):
    def setUp(self):
        farm_routes._state["running"] = False

    def run_start(self, uids, found, run_ids):
        async def main():
            result = await farm_routes.start_farm_interactions(start_request(uids), Mock())
            if farm_routes._active_task:
                await farm_routes._active_task
            return result

        with patch.object(farm_routes.adapters, "owner_from_request", return_value="7"), \
                patch.object(farm_routes.adapters, "get_accounts", return_value=found) as get_accounts, \
                patch.object(farm_routes.adapters, "get_account", side_effect=AssertionError("đọc từng nick")), \
                patch.object(farm_routes.adapters, "get_machine_id", return_value="m1"), \
                patch.object(farm_routes.adapters, "list_owner_accounts", return_value={}), \
                patch.object(farm_routes, "_release_gone_owners", return_value=[]), \
                patch.object(farm_routes, "_assign_targets", return_value=({u: {} for u in found}, [])), \
                patch.object(farm_routes.repository, "create_runs", return_value=run_ids) as create_runs, \
                patch.object(farm_routes, "_history_checkpoint_alerts", return_value=[]), \
                patch.object(farm_routes, "_farm_worker"), patch.object(farm_routes, "_finalize"), \
                patch.object(farm_routes, "_emit"):
            with self.assertLogs(farm_routes.logger, "INFO") as logs:
                result = asyncio.run(main())
        return result, get_accounts, create_runs, logs.output

    def test_reads_accounts_and_creates_runs_once(self):
        found = {"1": {**ACCOUNT, "uid": "1", "profile_name": "Ayu"}, "2": {**ACCOUNT, "uid": "2", "profile_name": ""}}
        result, get_accounts, create_runs, logs = self.run_start(["1", "2", "3"], found, {"1": 11, "2": 12})
        get_accounts.assert_called_once_with(["1", "2", "3"], "7")
        create_runs.assert_called_once()
        machine_id, accounts, _session, owner = create_runs.call_args.args
        self.assertEqual((machine_id, owner), ("m1", "7"))
        self.assertEqual(accounts, [{"uid": "1", "name": "Ayu"}, {"uid": "2", "name": ""}])
        self.assertEqual((result["accepted"], result["rejected"]), (["1", "2"], ["3"]))
        self.assertEqual({u: a["run_id"] for u, a in farm_routes._state["accounts"].items()}, {"1": 11, "2": 12})
        # Thời gian từng bước nằm trong log để biết bước nào chậm
        timing = [line for line in logs if "Kích hoạt 2 nick: tổng" in line]
        self.assertEqual(len(timing), 1)
        for step in ("đọc 3 nick", "mã máy", "dàn nick", "chia link / từ khóa", "tạo lượt chạy", "cảnh báo checkpoint"):
            self.assertIn(step, timing[0])

    def test_missing_run_id_is_db_error(self):
        found = {"1": {**ACCOUNT, "uid": "1", "profile_name": ""}, "2": {**ACCOUNT, "uid": "2", "profile_name": ""}}
        with self.assertRaises(HTTPException) as ctx:
            self.run_start(["1", "2"], found, {"1": 11})
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertFalse(farm_routes._state["running"])


class StepTimerTests(unittest.TestCase):
    def test_summary(self):
        with patch.object(farm_routes.time, "perf_counter", side_effect=[0.0, 1.24, 3.5, 3.6]):
            timer = farm_routes._StepTimer()
            timer.mark("đọc 2 nick")
            timer.mark("mã máy")
            self.assertEqual(timer.summary(), "tổng 3.6s (đọc 2 nick 1.2s, mã máy 2.3s)")


class HistoryAccountsTests(unittest.TestCase):
    def call(self, rows, names=None, names_error=None):
        get_names = Mock(return_value=names or {}, side_effect=names_error)
        with patch.object(farm_routes.adapters, "owner_from_request", return_value="7"), \
                patch.object(farm_routes.adapters, "get_machine_id", return_value="m1"), \
                patch.object(farm_routes.repository, "history_accounts", return_value=rows) as history, \
                patch.object(farm_routes.adapters, "get_profile_names", get_names):
            result = asyncio.run(farm_routes.farm_history_accounts(Mock()))
        history.assert_called_once_with("m1")
        return result, get_names

    def test_names_from_module_02_then_history(self):
        rows = [{"fb_uid": "100", "fb_name": "Tên cũ"}, {"fb_uid": "200", "fb_name": "Bình"},
                {"fb_uid": "300", "fb_name": None}, {"fb_uid": None, "fb_name": "x"}]
        result, get_names = self.call(rows, names={"100": "An"})
        get_names.assert_called_once_with(["100", "200", "300"], "7")
        self.assertEqual(result, [{"uid": "300", "name": ""}, {"uid": "100", "name": "An"},
                                  {"uid": "200", "name": "Bình"}])

    def test_module_02_error_keeps_history_names(self):
        result, _ = self.call([{"fb_uid": "100", "fb_name": "Tên cũ"}], names_error=RuntimeError("db"))
        self.assertEqual(result, [{"uid": "100", "name": "Tên cũ"}])

    def test_history_db_error(self):
        with patch.object(farm_routes.adapters, "owner_from_request", return_value=None), \
                patch.object(farm_routes.adapters, "get_machine_id", return_value="m1"), \
                patch.object(farm_routes.repository, "history_accounts", side_effect=RuntimeError("db")):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(farm_routes.farm_history_accounts(Mock()))
        self.assertEqual(ctx.exception.status_code, 503)

    def test_route_declared_before_history_detail(self):
        paths = [r.path.rsplit("/history/", 1)[-1] for r in farm_routes.router.routes if "/history/" in r.path]
        self.assertLess(paths.index("accounts"), paths.index("{history_id}"))


if __name__ == "__main__":
    unittest.main()
