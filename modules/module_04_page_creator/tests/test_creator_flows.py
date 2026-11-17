import asyncio
import unittest
from unittest.mock import MagicMock, patch

from modules.module_04_page_creator import routes
from modules.module_04_page_creator.automation import share_admin_flow


class CreatorStopAndLogsTest(unittest.TestCase):
    def setUp(self):
        routes.stop_task_requested = False
        routes.pause_task_requested = False
        routes._stop_broadcasted = False
        with routes._current_batch_logs_lock:
            routes._current_batch_logs.clear()

    def test_stop_tasks_suppresses_subsequent_worker_logs(self):
        emitted = []

        def fake_global(level, message, uid=None, extra=None):
            emitted.append((level, message, uid, extra))

        with patch.object(routes, "_broadcast_global", side_effect=fake_global), \
             patch.object(routes, "close_scoped_active_drivers", return_value=["10001"]), \
             patch.object(routes, "drain_active_round_queues", return_value=2):
            routes.current_task_status["running"] = True
            routes.current_task_status["batch_id"] = "batch_test_1"
            res = asyncio.run(routes.stop_tasks())

        self.assertTrue(res["stopped"])
        self.assertTrue(routes.stop_task_requested)
        self.assertTrue(routes._stop_broadcasted)
        self.assertEqual(len(emitted), 1)
        self.assertEqual(emitted[0][3].get("action"), "all_finished")

        # Worker cố phát log sau khi đã dừng khẩn cấp phải bị chặn hoàn toàn
        routes._broadcast_creator("info", "Log thừa sau khi dừng", uid="10001")
        self.assertEqual(len(emitted), 1)

    def test_get_task_status_returns_batch_logs_and_account_names(self):
        routes.current_task_status.update({
            "running": False,
            "batch_id": "batch_test_2",
            "finished_time": 1700000000000,
            "pages": [{"uid": "10001", "page_name": "Page Test"}],
            "account_names": {"10001": "Nguyen Van A"},
            "owner_username": "",
        })
        with patch.object(routes, "_broadcast_global"):
            routes._broadcast_creator("info", "Đã tạo xong Page", uid="10001")

        status = asyncio.run(routes.get_task_status(request=None, owner_username=None))
        self.assertEqual(status["batch_id"], "batch_test_2")
        self.assertEqual(status["account_names"], {"10001": "Nguyen Van A"})
        self.assertEqual(len(status["logs"]), 1)
        self.assertEqual(status["logs"][0]["message"], "Đã tạo xong Page")


class ShareAdminWelcomePostLogTest(unittest.TestCase):
    def setUp(self):
        routes.stop_task_requested = False
        routes.pause_task_requested = False

    def test_emits_step_6_and_success_log_for_welcome_post(self):
        logs = []

        def on_log(level, message, extra=None):
            logs.append((level, message, extra))

        driver = MagicMock()
        driver.current_url = "https://www.facebook.com/profile.php?id=999999"

        with patch.object(share_admin_flow, "_post_welcome_content", return_value=True), \
             patch("modules.module_02_account_manager.automation.login_flow.ensure_personal_profile", return_value=None), \
             patch.object(share_admin_flow, "human_sleep", return_value=None):
            res = share_admin_flow.run_share_admin(
                driver=driver,
                target_admin_uid="10001",
                creator_password="pw",
                post_content="Xin chào mọi người!",
                image_path=None,
                creator_uid="10001",
                on_log=on_log,
            )

        self.assertTrue(res["posted"])
        step_events = [e for _, _, e in logs if e and e.get("action") == "step"]
        self.assertTrue(any("Bước 6/6" in (e.get("step") or "") for e in step_events))
        self.assertTrue(any("đăng bài viết chào mừng" in msg.lower() and lvl == "success" for lvl, msg, _ in logs))

    def test_emits_warning_log_when_welcome_post_fails(self):
        logs = []

        def on_log(level, message, extra=None):
            logs.append((level, message, extra))

        driver = MagicMock()
        driver.current_url = "https://www.facebook.com/profile.php?id=999999"

        with patch.object(share_admin_flow, "_post_welcome_content", return_value=False), \
             patch("modules.module_02_account_manager.automation.login_flow.ensure_personal_profile", return_value=None), \
             patch.object(share_admin_flow, "human_sleep", return_value=None):
            res = share_admin_flow.run_share_admin(
                driver=driver,
                target_admin_uid="10001",
                creator_password="pw",
                post_content="Xin chào mọi người!",
                image_path=None,
                creator_uid="10001",
                on_log=on_log,
            )

        self.assertFalse(res["posted"])
        self.assertTrue(any("Không thể đăng bài viết chào mừng" in msg and lvl == "warning" for lvl, msg, _ in logs))


if __name__ == "__main__":
    unittest.main()
