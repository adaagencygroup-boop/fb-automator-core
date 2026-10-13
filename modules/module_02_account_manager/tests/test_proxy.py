"""
test_proxy_integration.py
Bộ test tự động toàn diện kiểm tra cơ chế Proxy và Local Proxy Bridge theo tài liệu:
- PROXY_GUIDE.md
- PROXY_INTEGRATION_STEPS (1).md
"""

import base64
import os
import select
import socket
import threading
import unittest
from unittest.mock import MagicMock, patch

from modules.module_02_account_manager.automation.proxy_bridge import (
    parse_proxy,
    test_proxy_connectivity,
    ProxyBridge,
    verify_chrome_egress_ip,
    get_direct_ip,
    ProxyError,
    ProxyFormatError,
    ProxyConnectionError,
    ProxyLeakError,
)
from modules.module_02_account_manager.automation.browser_manager import (
    register_active_bridge,
    get_active_bridge,
    close_bridge_for_uid,
    close_all_active_bridges,
    create_driver,
    close_driver_for_uid,
    _active_bridges,
)


class ProxyParserTests(unittest.TestCase):
    """Kiểm tra parser và chuẩn hóa các định dạng Proxy (Mục 1, 2 trong integration steps)."""

    def test_parse_host_port_user_pass(self):
        result = parse_proxy("123.45.67.89:8080:testuser:secret123")
        self.assertIsNotNone(result)
        self.assertEqual(result["host"], "123.45.67.89")
        self.assertEqual(result["port"], 8080)
        self.assertEqual(result["username"], "testuser")
        self.assertEqual(result["password"], "secret123")
        self.assertEqual(result["user"], "testuser")
        self.assertEqual(result["pass"], "secret123")
        self.assertTrue(result["has_auth"])
        self.assertEqual(result["server"], "http://123.45.67.89:8080")

    def test_parse_host_port_no_auth(self):
        result = parse_proxy("192.168.1.100:3128")
        self.assertIsNotNone(result)
        self.assertEqual(result["host"], "192.168.1.100")
        self.assertEqual(result["port"], 3128)
        self.assertIsNone(result["username"])
        self.assertIsNone(result["password"])
        self.assertFalse(result["has_auth"])
        self.assertEqual(result["server"], "http://192.168.1.100:3128")

    def test_parse_http_url_with_auth(self):
        result = parse_proxy("http://admin:p%40ssword@proxy.domain.com:8888")
        self.assertIsNotNone(result)
        self.assertEqual(result["host"], "proxy.domain.com")
        self.assertEqual(result["port"], 8888)
        self.assertEqual(result["username"], "admin")
        self.assertEqual(result["password"], "p@ssword")  # URL-decode thành công
        self.assertTrue(result["has_auth"])

    def test_reject_socks_protocols(self):
        with self.assertRaises(ProxyFormatError):
            parse_proxy("socks5://127.0.0.1:1080")
        with self.assertRaises(ProxyFormatError):
            parse_proxy("socks4://127.0.0.1:1080")

    def test_reject_invalid_ports(self):
        with self.assertRaises(ProxyFormatError):
            parse_proxy("127.0.0.1:99999:user:pass")
        with self.assertRaises(ProxyFormatError):
            parse_proxy("127.0.0.1:0:user:pass")
        with self.assertRaises(ProxyFormatError):
            parse_proxy("127.0.0.1:invalidport:user:pass")

    def test_empty_proxy_returns_none(self):
        self.assertIsNone(parse_proxy(None))
        self.assertIsNone(parse_proxy(""))
        self.assertIsNone(parse_proxy("   "))


class LocalProxyBridgeTests(unittest.TestCase):
    """Kiểm tra Local Proxy Bridge: inject Basic Auth, forward HTTP và CONNECT HTTPS (Mục 4)."""

    def setUp(self):
        close_all_active_bridges()

    def tearDown(self):
        close_all_active_bridges()

    def test_bridge_start_and_close(self):
        bridge = ProxyBridge("127.0.0.1", 8080, "test", "pass")
        port = bridge.start()
        self.assertGreater(port, 0)
        self.assertTrue(bridge._running)

        # Đóng bridge an toàn
        bridge.close()
        self.assertFalse(bridge._running)
        # Gọi close lần 2 không lỗi (idempotent)
        bridge.close()

    def test_bridge_injects_auth_on_http_request(self):
        """Khởi tạo mock HTTP upstream server để kiểm tra header Proxy-Authorization."""
        received_headers = []

        mock_server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        mock_server.bind(("127.0.0.1", 0))
        mock_server.listen(1)
        mock_port = mock_server.getsockname()[1]

        def mock_upstream():
            try:
                conn, _ = mock_server.accept()
                req_data = conn.recv(4096)
                received_headers.append(req_data)
                conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK")
                conn.close()
            except Exception:
                pass
            finally:
                mock_server.close()

        upstream_thread = threading.Thread(target=mock_upstream, daemon=True)
        upstream_thread.start()

        # Tạo bridge trỏ tới mock upstream
        bridge = ProxyBridge("127.0.0.1", mock_port, "alice", "secret123")
        bridge_port = bridge.start()

        # Gửi request HTTP từ client tới Bridge (mô phỏng Chrome)
        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client.connect(("127.0.0.1", bridge_port))
        client.sendall(b"GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n")

        resp = client.recv(4096)
        client.close()
        bridge.close()
        upstream_thread.join(timeout=2.0)

        # Kiểm tra kết quả
        self.assertIn(b"200 OK", resp)
        self.assertTrue(len(received_headers) > 0)
        req_text = received_headers[0].decode("latin-1")

        # Xác minh header Proxy-Authorization: Basic BASE64(alice:secret123)
        expected_auth = base64.b64encode(b"alice:secret123").decode("ascii")
        self.assertIn(f"Proxy-Authorization: Basic {expected_auth}", req_text)

    def test_bridge_handles_connect_https_tunnel(self):
        """Kiểm tra xử lý CONNECT tunnel cho HTTPS."""
        connect_received = []

        mock_server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        mock_server.bind(("127.0.0.1", 0))
        mock_server.listen(1)
        mock_port = mock_server.getsockname()[1]

        def mock_upstream_tunnel():
            try:
                conn, _ = mock_server.accept()
                data = conn.recv(4096)
                connect_received.append(data)
                # Upstream proxy trả về 200 Connection Established
                conn.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                # Đọc dữ liệu payload sau tunnel
                payload = conn.recv(4096)
                conn.sendall(b"ECHO:" + payload)
                conn.close()
            except Exception:
                pass
            finally:
                mock_server.close()

        upstream_thread = threading.Thread(target=mock_upstream_tunnel, daemon=True)
        upstream_thread.start()

        bridge = ProxyBridge("127.0.0.1", mock_port, "bob", "pwd999")
        bridge_port = bridge.start()

        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client.connect(("127.0.0.1", bridge_port))
        # Chrome gửi CONNECT
        client.sendall(b"CONNECT www.facebook.com:443 HTTP/1.1\r\nHost: www.facebook.com:443\r\n\r\n")

        tunnel_resp = client.recv(4096)
        self.assertIn(b"200 Connection Established", tunnel_resp)

        # Gửi dữ liệu qua tunnel
        client.sendall(b"HELLOTUNNEL")
        echo_resp = client.recv(4096)
        client.close()
        bridge.close()
        upstream_thread.join(timeout=2.0)

        self.assertEqual(echo_resp, b"ECHO:HELLOTUNNEL")
        self.assertTrue(len(connect_received) > 0)
        expected_auth = base64.b64encode(b"bob:pwd999").decode("ascii")
        self.assertIn(f"Proxy-Authorization: Basic {expected_auth}", connect_received[0].decode("latin-1"))


class BridgeLifecycleTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        p = patch("modules.module_02_account_manager.utils.paths.PROFILES_DIR", self.temp.name)
        p.start()
        self.addCleanup(p.stop)

    # Each test owns a temporary profile root.


    def tearDown(self):
        close_all_active_bridges()

    def test_multi_uid_bridge_isolation(self):
        """Hai UID chạy đồng thời phải có 2 port bridge riêng biệt, đóng 1 UID không ảnh hưởng UID còn lại."""
        b1 = ProxyBridge("127.0.0.1", 8081, "user1", "pass1")
        p1 = b1.start()
        register_active_bridge("111", b1)

        b2 = ProxyBridge("127.0.0.1", 8082, "user2", "pass2")
        p2 = b2.start()
        register_active_bridge("222", b2)

        self.assertNotEqual(p1, p2)
        self.assertEqual(get_active_bridge("111"), b1)
        self.assertEqual(get_active_bridge("222"), b2)

        # Đóng 111
        close_bridge_for_uid("111")
        self.assertIsNone(get_active_bridge("111"))
        self.assertFalse(b1._running)

        # 222 vẫn phải đang chạy bình thường
        self.assertTrue(b2._running)
        self.assertEqual(get_active_bridge("222"), b2)

        close_bridge_for_uid("222")
        self.assertFalse(b2._running)

    def test_close_driver_cleans_up_bridge(self):
        """close_driver_for_uid phải tự động dọn dẹp bridge tương ứng."""
        bridge = ProxyBridge("127.0.0.1", 8080, "u", "p")
        bridge.start()
        register_active_bridge("999", bridge)

        self.assertTrue(bridge._running)
        close_driver_for_uid("999")
        self.assertFalse(bridge._running)
        self.assertIsNone(get_active_bridge("999"))


class LeakDetectionTests(unittest.TestCase):
    """Kiểm tra cơ chế phát hiện và ngăn chặn rò rỉ IP mạng thật (Mục 6)."""

    def test_verify_egress_detects_ip_leak(self):
        """Nếu Chrome Egress IP trùng với IP mạng thật của máy -> Ném ProxyLeakError!"""
        mock_driver = MagicMock()
        mock_driver.window_handles = ["tab1", "tab2"]
        mock_driver.current_window_handle = "tab1"

        mock_body = MagicMock()
        mock_body.text = "14.161.50.25"  # IP mạng thật
        mock_driver.find_element.return_value = mock_body

        with self.assertRaises(ProxyLeakError):
            verify_chrome_egress_ip(mock_driver, direct_ip="14.161.50.25")

    def test_verify_egress_success_when_different_ip(self):
        """Nếu Chrome Egress IP khác IP mạng thật -> Xác nhận thành công."""
        mock_driver = MagicMock()
        mock_driver.window_handles = ["tab1", "tab2"]
        mock_driver.current_window_handle = "tab1"

        mock_body = MagicMock()
        mock_body.text = "103.150.20.88"  # IP proxy
        mock_driver.find_element.return_value = mock_body

        egress = verify_chrome_egress_ip(mock_driver, direct_ip="14.161.50.25")
        self.assertEqual(egress, "103.150.20.88")


