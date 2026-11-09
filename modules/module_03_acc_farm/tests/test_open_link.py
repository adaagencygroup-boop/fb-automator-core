"""
Mở nhóm / trang cá nhân bằng Chrome của nick (2026-11-09): Chrome "Mở trình duyệt" của nick còn mở thì mở tab mới,
không thì nhờ Module 02 mở Chrome; nick đang chạy (profile bị khóa) thì báo bận; chỉ nick của người đang đăng nhập.
"""
import asyncio
import threading
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from modules.module_03_acc_farm import routes as farm_routes

G = "https://www.facebook.com/groups/111111111111111/"


class FakeDriver:
    def __init__(self, alive=True):
        self.handles = ["a"]
        self.alive = alive
        self.opened = []
        self.switched = None

    @property
    def window_handles(self):
        if not self.alive:
            raise RuntimeError("no such window")
        return list(self.handles)

    def execute_script(self, js, url):
        self.opened.append(url)
        self.handles.append("b")

    @property
    def switch_to(self):
        driver = self

        class Switch:
            def window(self, handle):
                driver.switched = handle
        return Switch()


def call(url=G, uid="100", owned=None, drivers=(), lock=None, queue=None):
    lock = lock or threading.Lock()
    queue = queue or Mock(return_value={"started": True, "uid": uid, "operation_id": "x"})
    owners_seen = []

    def queue_open_browser(u, target_url=None):
        from modules.module_02_account_manager.context import owner_context
        owners_seen.append(owner_context.get())
        return queue(u, target_url=target_url)

    with patch.object(farm_routes.adapters, "owner_from_request", return_value="7"), \
            patch.object(farm_routes.adapters, "list_owner_accounts", return_value=owned if owned is not None else {"100": "LIVE"}), \
            patch("core.browser.get_profile_lock", return_value=lock), \
            patch("core.browser.get_active_drivers", return_value=list(drivers)) as get_drivers, \
            patch("core.browser.bring_chrome_to_front"), \
            patch("modules.module_02_account_manager.services.browser_service.queue_open_browser",
                  side_effect=queue_open_browser):
        result = asyncio.run(farm_routes.open_link_in_nick_browser(farm_routes.OpenLinkRequest(uid=uid, url=url), Mock()))
    return result, queue, get_drivers, owners_seen


class OpenLinkTests(unittest.TestCase):
    def test_reuses_open_chrome_of_nick(self):
        driver = FakeDriver()
        result, queue, get_drivers, _ = call(drivers=[driver])
        self.assertEqual(result, {"mode": "tab"})
        self.assertEqual((driver.opened, driver.switched), ([G], "b"))
        queue.assert_not_called()
        get_drivers.assert_called_once_with("100", "7", scope="live")

    def test_closed_window_falls_back_to_module_02(self):
        result, queue, _, owners = call(drivers=[FakeDriver(alive=False)])
        self.assertEqual(result["mode"], "opening")
        queue.assert_called_once_with("100", target_url=G)
        self.assertEqual(owners, ["7"])  # Module 02 đọc nick theo người đang đăng nhập

    def test_no_window_opens_chrome_via_module_02(self):
        result, queue, _, _ = call()
        self.assertEqual(result["mode"], "opening")
        queue.assert_called_once_with("100", target_url=G)

    def test_busy_profile_is_not_touched(self):
        lock = threading.Lock()
        lock.acquire()
        driver = FakeDriver()
        with self.assertRaises(HTTPException) as ctx:
            call(drivers=[driver], lock=lock)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(driver.opened, [])

    def test_lock_released_after_opening_tab(self):
        lock = threading.Lock()
        call(drivers=[FakeDriver()], lock=lock)
        self.assertFalse(lock.locked())

    def test_nick_of_other_owner_or_deleted(self):
        with self.assertRaises(HTTPException) as ctx:
            call(owned={"200": "LIVE"})
        self.assertEqual(ctx.exception.status_code, 404)

    def test_only_https_facebook_links(self):
        for url in ("http://www.facebook.com/groups/1/", "https://evil.com/groups/1/", "javascript:alert(1)",
                    "https://facebook.com.evil.com/x", "file:///C:/x"):
            with self.assertRaises(HTTPException, msg=url) as ctx:
                call(url=url)
            self.assertEqual(ctx.exception.status_code, 400)
        for url in ("https://facebook.com/x", "https://web.facebook.com/groups/1/", "https://m.facebook.com/x"):
            self.assertEqual(call(url=url)[0]["mode"], "opening")


if __name__ == "__main__":
    unittest.main()
