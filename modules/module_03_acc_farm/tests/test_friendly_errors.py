"""Câu báo lỗi cho người dùng: lỗi kỹ thuật không lọt ra giao diện / lịch sử, câu tool tự viết giữ nguyên."""
import unittest
from unittest.mock import Mock, PropertyMock, patch

from selenium.common.exceptions import (
    InvalidSessionIdException,
    NoSuchElementException,
    SessionNotCreatedException,
    StaleElementReferenceException,
    TimeoutException,
    WebDriverException,
)
from urllib3.exceptions import MaxRetryError, NewConnectionError, ReadTimeoutError

from core.browser import ProxyError
from modules.module_03_acc_farm import routes as farm_routes
from modules.module_03_acc_farm.browser import errors, login_flow
from modules.module_03_acc_farm.browser.errors import friendly_error, is_browser_gone, is_technical_error

HANG = MaxRetryError(None, "/session/2248/title", ReadTimeoutError(None, "/session/2248/title", "Read timed out. (read timeout=120)"))
PROXY_407 = ("Proxy không hoạt động: Proxy 103.82.195.219:31600 kiểm tra kết nối thất bại cả HTTP (HTTP test failed: "
             "HTTP Error 407: Proxy Authentication Required) và SOCKS5 (Máy chủ không phải SOCKS5 (version: 72))")


def _driver_error(cls, message):
    return cls(message, stacktrace=["chromedriver!GetHandleVerifier", "KERNEL32!BaseThreadInitThunk"])


class FriendlyErrorTests(unittest.TestCase):
    def test_hung_browser(self):
        self.assertEqual(friendly_error(HANG), errors.BROWSER_HUNG)
        self.assertEqual(friendly_error(TimeoutError("timed out")), errors.BROWSER_HUNG)
        self.assertEqual(friendly_error(HANG, still_open=True), errors.BROWSER_SLOW)

    def test_closed_browser(self):
        refused = MaxRetryError(None, "/session/1/url", NewConnectionError(None, "Failed to establish a new connection"))
        self.assertEqual(friendly_error(refused), errors.BROWSER_CLOSED)
        self.assertEqual(friendly_error(ConnectionResetError("reset")), errors.BROWSER_CLOSED)
        self.assertEqual(friendly_error(_driver_error(InvalidSessionIdException, "invalid session id")), errors.BROWSER_CLOSED)
        self.assertEqual(friendly_error(_driver_error(WebDriverException, "disconnected: not connected to DevTools")),
                         errors.BROWSER_CLOSED)

    def test_page_errors_hide_stacktrace(self):
        for cls in (StaleElementReferenceException, NoSuchElementException):
            self.assertEqual(friendly_error(_driver_error(cls, "stale element reference")), errors.PAGE_CHANGED)
        self.assertEqual(friendly_error(_driver_error(TimeoutException, "timeout: Timed out receiving message from renderer")),
                         errors.PAGE_SLOW)
        self.assertEqual(friendly_error(_driver_error(WebDriverException, "unknown error: net::ERR_TUNNEL_CONNECTION_FAILED")),
                         errors.PAGE_NETWORK)
        self.assertEqual(friendly_error(_driver_error(SessionNotCreatedException, "session not created")),
                         errors.BROWSER_NOT_OPENED)

    def test_unknown_driver_error_shows_only_type(self):
        text = friendly_error(_driver_error(WebDriverException, "unknown error: boom port=61925"))
        self.assertEqual(text, "Lỗi trình duyệt (WebDriverException). Xem chi tiết trong log.")

    def test_own_vietnamese_text_kept(self):
        self.assertEqual(friendly_error(TimeoutException("Không tìm thấy ô nhập mã 2FA hợp lệ")),
                         "Không tìm thấy ô nhập mã 2FA hợp lệ")
        self.assertEqual(friendly_error(RuntimeError("Không kiểm tra được giới hạn ngày (lỗi CSDL)")),
                         "Không kiểm tra được giới hạn ngày (lỗi CSDL)")

    def test_unknown_error_shows_only_type(self):
        self.assertEqual(friendly_error(KeyError("cookie")), "Lỗi không xác định (KeyError). Xem chi tiết trong log.")
        self.assertEqual(friendly_error(ValueError("")), "Lỗi không xác định (ValueError). Xem chi tiết trong log.")

    def test_database_error(self):
        psycopg_error = type("OperationalError", (Exception,), {"__module__": "psycopg2.errors"})
        self.assertEqual(friendly_error(psycopg_error("could not connect to server db.supabase.co")), errors.DATABASE_DOWN)

    def test_proxy_by_cause(self):
        self.assertEqual(friendly_error(ProxyError(PROXY_407)),
                         "Proxy 103.82.195.219:31600 từ chối user/pass (sai hoặc đã hết hạn). Cập nhật proxy rồi chạy lại.")
        self.assertEqual(friendly_error(ProxyError("Proxy 1.2.3.4:80 kiểm tra kết nối thất bại cả HTTP (timed out) và SOCKS5 (x)")),
                         "Proxy 1.2.3.4:80 không phản hồi. Kiểm tra lại proxy rồi chạy lại.")
        self.assertEqual(friendly_error(ProxyError("Proxy 1.2.3.4:80 kiểm tra kết nối thất bại cả HTTP (refused) và SOCKS5 (x)")),
                         "Proxy 1.2.3.4:80 không kết nối được. Kiểm tra lại proxy rồi chạy lại.")
        self.assertEqual(friendly_error(ProxyError("Cổng kết nối proxy không hợp lệ: 'abc'")),
                         "Cổng kết nối proxy không hợp lệ: 'abc'")


class BrowserProbeTests(unittest.TestCase):
    def test_short_timeout_only_during_probe(self):
        driver = Mock()
        config = driver.command_executor.client_config
        config.timeout = 120
        seen = []
        type(driver).title = property(lambda _: seen.append(config.timeout) or "Facebook")
        self.assertTrue(farm_routes._browser_responds(driver))
        self.assertEqual(seen, [farm_routes.BROWSER_PROBE_TIMEOUT])
        self.assertEqual(config.timeout, 120)

    def test_hung_browser_restores_timeout(self):
        driver = Mock()
        config = driver.command_executor.client_config
        config.timeout = 120

        def hang(_):
            raise HANG

        type(driver).title = property(hang)
        self.assertFalse(farm_routes._browser_responds(driver))
        self.assertEqual(config.timeout, 120)


class ErrorKindTests(unittest.TestCase):
    def test_windows_translated_os_error_is_not_own_text(self):
        translated = OSError("[WinError 10061] Không thể kết nối vì máy đích từ chối")
        self.assertEqual(friendly_error(translated), "Lỗi không xác định (OSError). Xem chi tiết trong log.")
        self.assertEqual(friendly_error(ConnectionRefusedError("Không thể kết nối")), errors.BROWSER_CLOSED)

    def test_browser_gone(self):
        self.assertTrue(is_browser_gone(HANG))
        self.assertTrue(is_browser_gone(ConnectionResetError("reset")))
        self.assertTrue(is_browser_gone(_driver_error(InvalidSessionIdException, "invalid session id")))
        self.assertFalse(is_browser_gone(_driver_error(StaleElementReferenceException, "stale")))
        self.assertFalse(is_browser_gone(RuntimeError("Không tìm thấy nút Tiếp tục")))

    def test_technical_or_verdict_about_account(self):
        self.assertTrue(is_technical_error(HANG))
        self.assertTrue(is_technical_error(_driver_error(StaleElementReferenceException, "stale")))
        self.assertTrue(is_technical_error(TimeoutException("None of 6 locators matched after 8s")))
        self.assertFalse(is_technical_error(TimeoutException("Facebook chưa hoàn tất bước đăng nhập bằng mật khẩu")))
        self.assertFalse(is_technical_error(RuntimeError("Cookie của tài khoản đã lưu không khớp UID cần đăng nhập")))


class LoginWithBrokenBrowserTests(unittest.TestCase):
    def hung_driver(self):
        driver = Mock()
        type(driver).current_url = PropertyMock(side_effect=HANG)
        return driver

    def test_check_logged_in_raises_when_hung(self):
        with self.assertRaises(MaxRetryError):
            login_flow._check_logged_in(self.hung_driver())

    def test_check_logged_in_false_on_other_errors(self):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/"
        driver.get_cookies.side_effect = _driver_error(WebDriverException, "unknown error")
        self.assertFalse(login_flow._check_logged_in(driver))

    def test_hung_browser_stops_before_cookie_and_form(self):
        with patch.object(login_flow, "_try_cookie_login") as cookie_login,                 patch.object(login_flow, "_submit_login_form") as form:
            result = login_flow.ensure_logged_in(self.hung_driver(), "1", password="pw", cookie="c_user=1")
        self.assertEqual((result["success"], result["browser_error"]), (False, True))
        self.assertEqual(result["error"], errors.BROWSER_HUNG)
        cookie_login.assert_not_called()
        form.assert_not_called()

    def run_form(self, error):
        driver = Mock()
        driver.current_url = "https://www.facebook.com/login"
        with patch.object(login_flow, "human_sleep"), patch.object(login_flow, "_check_logged_in", return_value=False),                 patch.object(login_flow, "_on_checkpoint", return_value=False),                 patch.object(login_flow, "_submit_login_form", side_effect=error):
            return login_flow.ensure_logged_in(driver, "1", password="pw")

    def test_page_error_in_form_is_browser_error(self):
        result = self.run_form(_driver_error(StaleElementReferenceException, "stale"))
        self.assertEqual((result["browser_error"], result["error"]), (True, errors.PAGE_CHANGED))

    def test_login_verdict_in_form_is_about_account(self):
        result = self.run_form(TimeoutException("Facebook chưa hoàn tất bước đăng nhập bằng mật khẩu"))
        self.assertEqual((result["browser_error"], result["error"]),
                         (False, "Facebook chưa hoàn tất bước đăng nhập bằng mật khẩu"))


if __name__ == "__main__":
    unittest.main()
