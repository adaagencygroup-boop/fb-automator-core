"""
proxy_bridge.py — Local Proxy Bridge & Proxy Utilities.

Cung cấp:
1. parse_proxy: Chuẩn hóa và validate chuỗi proxy.
2. test_proxy_connectivity: Pre-flight test kết nối HTTP + HTTPS qua proxy.
3. get_direct_ip: Lấy IP thật của máy trạm để phát hiện rò rỉ.
4. ProxyBridge: Local HTTP/HTTPS Proxy Bridge chạy trên 127.0.0.1, tự động inject
   header Proxy-Authorization (Basic Auth) cho Google Chrome mà không cần Extension.
5. verify_chrome_egress_ip: Kiểm tra chéo IP đầu ra trong Chrome để chống rò rỉ IP máy.
"""

from __future__ import annotations

import base64
import logging
import re
import select
import socket
import threading
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional, Set, Tuple

logger = logging.getLogger(__name__)


class ProxyError(Exception):
    """Lỗi chung liên quan đến cấu hình hoặc kết nối proxy."""
    pass


class ProxyFormatError(ProxyError):
    """Lỗi định dạng proxy không hợp lệ."""
    pass


class ProxyConnectionError(ProxyError):
    """Lỗi khi không thể kết nối tới proxy hoặc proxy bị timeout/từ chối xác thực."""
    pass


class ProxyLeakError(ProxyError):
    """Cảnh báo nghiêm trọng: Chrome bị rò rỉ IP mạng thật của máy."""
    pass


# ─── 1. PARSE & NORMALIZE PROXY ──────────────────────────────────────────────

def parse_proxy(proxy_str: Optional[str]) -> Optional[Dict[str, Any]]:
    """
    Parse chuỗi proxy linh hoạt hỗ trợ các định dạng:
    - HOST:PORT:USERNAME:PASSWORD
    - HOST:PORT
    - http://USERNAME:PASSWORD@HOST:PORT
    - https://USERNAME:PASSWORD@HOST:PORT
    - http://HOST:PORT

    Returns:
        dict: {
            "scheme": "http",
            "host": str,
            "port": int,
            "username": Optional[str],
            "password": Optional[str],
            "server": str ("http://HOST:PORT"),
            "has_auth": bool,
            "raw": str,
        }
        hoặc None nếu proxy_str rỗng.
    """
    if not proxy_str or not str(proxy_str).strip():
        return None

    raw = str(proxy_str).strip()

    # 1. Từ chối SOCKS từ sớm
    lower_raw = raw.lower()
    if lower_raw.startswith("socks4://") or lower_raw.startswith("socks5://"):
        raise ProxyFormatError(
            "Proxy SOCKS chưa được hỗ trợ bởi trình duyệt này. Vui lòng sử dụng Proxy định dạng HTTP/HTTPS!"
        )

    scheme = "http"
    username: Optional[str] = None
    password: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None

    # 2. Xử lý định dạng URL đầy đủ: http(s)://[user:pass@]host:port
    if "://" in raw:
        parsed_url = urllib.parse.urlparse(raw)
        scheme = parsed_url.scheme.lower() or "http"
        if scheme not in ("http", "https"):
            raise ProxyFormatError(f"Giao thức '{scheme}' không được hỗ trợ. Hãy sử dụng http:// hoặc https://")

        host = parsed_url.hostname
        port = parsed_url.port
        if parsed_url.username is not None:
            username = urllib.parse.unquote(parsed_url.username)
        if parsed_url.password is not None:
            password = urllib.parse.unquote(parsed_url.password)

    # 3. Xử lý định dạng có user:pass@host:port (không có scheme)
    elif "@" in raw:
        auth_part, host_part = raw.split("@", 1)
        if ":" in auth_part:
            u, p = auth_part.split(":", 1)
            username = urllib.parse.unquote(u)
            password = urllib.parse.unquote(p)
        else:
            username = urllib.parse.unquote(auth_part)
            password = ""

        if ":" in host_part:
            h, pt = host_part.split(":", 1)
            host = h.strip()
            try:
                port = int(pt.strip())
            except ValueError:
                raise ProxyFormatError(f"Cổng kết nối proxy không hợp lệ: '{pt}'")
        else:
            host = host_part.strip()

    # 4. Xử lý định dạng phân cách bởi dấu hai chấm (host:port:user:pass hoặc host:port)
    else:
        parts = raw.split(":")
        if len(parts) == 4:
            # host:port:username:password
            host = parts[0].strip()
            try:
                port = int(parts[1].strip())
            except ValueError:
                raise ProxyFormatError(f"Cổng kết nối proxy không hợp lệ: '{parts[1]}'")
            username = urllib.parse.unquote(parts[2].strip())
            password = urllib.parse.unquote(parts[3].strip())
        elif len(parts) == 2:
            # host:port
            host = parts[0].strip()
            try:
                port = int(parts[1].strip())
            except ValueError:
                raise ProxyFormatError(f"Cổng kết nối proxy không hợp lệ: '{parts[1]}'")
        else:
            raise ProxyFormatError(
                f"Định dạng proxy không đúng chuẩn (yêu cầu HOST:PORT hoặc HOST:PORT:USER:PASS): '{raw}'"
            )

    # 5. Kiểm tra tính hợp lệ của Host & Port
    if not host:
        raise ProxyFormatError("Địa chỉ Host của proxy không được để trống!")

    if port is None or port < 1 or port > 65535:
        raise ProxyFormatError(f"Cổng (Port) của proxy phải nằm trong khoảng 1-65535 (nhận được: {port})")

    has_auth = bool(username and password)

    return {
        "scheme": scheme,
        "host": host,
        "port": port,
        "username": username if has_auth else None,
        "password": password if has_auth else None,
        "user": username if has_auth else None,
        "pass": password if has_auth else None,
        "server": f"{scheme}://{host}:{port}",
        "has_auth": has_auth,
        "raw": raw,
    }


# ─── 2. PRE-FLIGHT CONNECTIVITY TEST ──────────────────────────────────────────

def test_proxy_connectivity(proxy_info: Dict[str, Any], timeout: int = 15) -> Dict[str, Any]:
    """
    Thực hiện kiểm tra kết nối qua Proxy (Pre-flight test):
    - Kiểm tra kết nối HTTP qua http://httpbin.org/ip hoặc http://api.ipify.org
    - Kiểm tra kết nối HTTPS qua https://api.ipify.org hoặc https://httpbin.org/ip

    Chỉ khi cả 2 bài test đều thành công mới cho phép mở trình duyệt.
    Nếu thất bại, raise ProxyConnectionError kèm lý do chi tiết.
    """
    if not proxy_info:
        raise ProxyFormatError("Dữ liệu proxy rỗng")

    host = proxy_info["host"]
    port = proxy_info["port"]
    user = proxy_info.get("username")
    pwd = proxy_info.get("password")

    if user and pwd:
        # URL encode thông tin auth khi đưa vào urllib handler
        enc_user = urllib.parse.quote(user, safe="")
        enc_pwd = urllib.parse.quote(pwd, safe="")
        proxy_url = f"http://{enc_user}:{enc_pwd}@{host}:{port}"
    else:
        proxy_url = f"http://{host}:{port}"

    proxy_handler = urllib.request.ProxyHandler({
        "http": proxy_url,
        "https": proxy_url,
    })
    opener = urllib.request.build_opener(proxy_handler)

    logger.info(f"Testing proxy connectivity: http://{host}:{port} (auth={bool(user)})")

    egress_ip = None

    # Test HTTP
    http_endpoints = [
        "http://api.ipify.org",
        "http://httpbin.org/ip",
    ]
    http_ok = False
    last_http_err = None
    for ep in http_endpoints:
        try:
            req = urllib.request.Request(
                ep,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/127.0.0.0"}
            )
            with opener.open(req, timeout=timeout) as resp:
                if resp.status == 200:
                    http_ok = True
                    break
        except Exception as e:
            last_http_err = e

    if not http_ok:
        msg = f"Proxy {host}:{port} kiểm tra kết nối HTTP thất bại: {last_http_err}"
        logger.warning(msg)
        raise ProxyConnectionError(msg)

    # Test HTTPS
    https_endpoints = [
        "https://api.ipify.org",
        "https://httpbin.org/ip",
    ]
    https_ok = False
    last_https_err = None
    for ep in https_endpoints:
        try:
            req = urllib.request.Request(
                ep,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/127.0.0.0"}
            )
            with opener.open(req, timeout=timeout) as resp:
                if resp.status == 200:
                    body = resp.read().decode("utf-8", errors="ignore").strip()
                    ip_match = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", body)
                    if ip_match:
                        egress_ip = ip_match.group(0)
                    https_ok = True
                    break
        except Exception as e:
            last_https_err = e

    if not https_ok:
        msg = f"Proxy {host}:{port} kiểm tra kết nối HTTPS thất bại: {last_https_err}"
        logger.warning(msg)
        raise ProxyConnectionError(msg)

    logger.info(f"All proxy tests passed! Proxy supports HTTP/HTTPS, Egress IP={egress_ip}")
    return {"ok": True, "egress_ip": egress_ip}


# ─── 3. GET DIRECT MACHINE IP ────────────────────────────────────────────────

_cached_direct_ip: Optional[str] = None
_cached_direct_ip_time: float = 0.0

def get_direct_ip(timeout: int = 8) -> Optional[str]:
    """Lấy IP public trực tiếp của máy trạm (không qua proxy) để làm mốc đối chiếu rò rỉ."""
    global _cached_direct_ip, _cached_direct_ip_time
    import time
    now = time.time()
    if _cached_direct_ip and (now - _cached_direct_ip_time < 300):
        return _cached_direct_ip

    endpoints = [
        "https://api.ipify.org",
        "https://httpbin.org/ip",
        "https://icanhazip.com",
    ]
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for ep in endpoints:
        try:
            req = urllib.request.Request(
                ep,
                headers={"User-Agent": "Mozilla/5.0"}
            )
            with opener.open(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", errors="ignore")
                m = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", body)
                if m:
                    _cached_direct_ip = m.group(0)
                    _cached_direct_ip_time = now
                    return _cached_direct_ip
        except Exception:
            continue
    return _cached_direct_ip


# ─── 4. LOCAL PROXY BRIDGE (127.0.0.1) ──────────────────────────────────────

class ProxyBridge:
    """
    Local HTTP & HTTPS Proxy Bridge chạy ngầm trên 127.0.0.1:<random_port>.
    
    Giải quyết triệt để hạn chế: Chrome không hỗ trợ `--proxy-server` có username/password.
    Bridge tự động tiếp nhận request từ Chrome, gắn header `Proxy-Authorization: Basic ...`
    và forward tới máy chủ proxy thật, relay 2 chiều cho cả HTTP và HTTPS tunnel.
    """

    def __init__(
        self,
        upstream_host: str,
        upstream_port: int,
        username: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self.upstream_host = upstream_host
        self.upstream_port = upstream_port
        self.username = username
        self.password = password

        if self.username and self.password:
            creds = f"{self.username}:{self.password}".encode("utf-8")
            self.auth_header = b"Basic " + base64.b64encode(creds)
        else:
            self.auth_header = None

        self.server_sock: Optional[socket.socket] = None
        self.port: int = 0
        self._running = False
        self._active_sockets: Set[socket.socket] = set()
        self._sockets_lock = threading.Lock()
        self._server_thread: Optional[threading.Thread] = None

    def start(self) -> int:
        """Khởi động socket server trên 127.0.0.1 với cổng ngẫu nhiên do OS cấp phát."""
        self.server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server_sock.bind(("127.0.0.1", 0))
        self.server_sock.listen(64)
        self.port = self.server_sock.getsockname()[1]
        self._running = True

        self._server_thread = threading.Thread(
            target=self._accept_loop,
            name=f"ProxyBridge-127.0.0.1:{self.port}",
            daemon=True,
        )
        self._server_thread.start()
        logger.info(f"Local Proxy Bridge started on 127.0.0.1:{self.port} -> {self.upstream_host}:{self.upstream_port}")
        return self.port

    def _track_socket(self, sock: socket.socket):
        with self._sockets_lock:
            self._active_sockets.add(sock)

    def _untrack_socket(self, sock: socket.socket):
        with self._sockets_lock:
            self._active_sockets.discard(sock)

    def _accept_loop(self):
        """Lắng nghe các kết nối từ Chrome."""
        while self._running:
            try:
                client_sock, _ = self.server_sock.accept()
                client_sock.settimeout(60.0)
                self._track_socket(client_sock)
                t = threading.Thread(
                    target=self._handle_client,
                    args=(client_sock,),
                    daemon=True,
                )
                t.start()
            except (socket.error, OSError):
                break
            except Exception as e:
                if self._running:
                    logger.debug(f"[ProxyBridge:{self.port}] Accept error: {e}")

    def _handle_client(self, client_sock: socket.socket):
        """Xử lý từng kết nối HTTP hoặc HTTPS từ Chrome."""
        upstream_sock = None
        try:
            data = b""
            while b"\r\n\r\n" not in data:
                chunk = client_sock.recv(4096)
                if not chunk:
                    break
                data += chunk
                if len(data) > 65536:
                    break

            if not data:
                return

            header_end = data.find(b"\r\n\r\n")
            if header_end == -1:
                return

            header_bytes = data[:header_end]
            body_bytes = data[header_end + 4:]
            lines = header_bytes.split(b"\r\n")
            if not lines:
                return

            request_line = lines[0].decode("latin-1", errors="replace")
            parts = request_line.split(" ")
            if len(parts) < 3:
                return

            method, target = parts[0].upper(), parts[1]

            # ── 1. XỬ LÝ HTTPS (CONNECT METHOD) ──
            if method == "CONNECT":
                upstream_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                upstream_sock.settimeout(30.0)
                self._track_socket(upstream_sock)
                upstream_sock.connect((self.upstream_host, self.upstream_port))

                connect_req = [
                    f"CONNECT {target} HTTP/1.1\r\n".encode("latin-1"),
                    f"Host: {target}\r\n".encode("latin-1"),
                    b"Proxy-Connection: Keep-Alive\r\n",
                ]
                if self.auth_header:
                    connect_req.append(b"Proxy-Authorization: " + self.auth_header + b"\r\n")

                for line in lines[1:]:
                    low = line.lower()
                    if not low.startswith(b"proxy-authorization:") and not low.startswith(b"host:"):
                        connect_req.append(line + b"\r\n")

                connect_req.append(b"\r\n")
                upstream_sock.sendall(b"".join(connect_req))

                resp_data = b""
                while b"\r\n\r\n" not in resp_data:
                    chunk = upstream_sock.recv(4096)
                    if not chunk:
                        break
                    resp_data += chunk

                if not resp_data:
                    return

                first_line = resp_data.split(b"\r\n", 1)[0]
                if b" 200" in first_line:
                    client_sock.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                    self._relay_bidirectional(client_sock, upstream_sock)
                else:
                    client_sock.sendall(resp_data)
                return

            # ── 2. XỬ LÝ HTTP THÔNG THƯỜNG ──
            upstream_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            upstream_sock.settimeout(30.0)
            self._track_socket(upstream_sock)
            upstream_sock.connect((self.upstream_host, self.upstream_port))

            forward_headers = [lines[0] + b"\r\n"]
            if self.auth_header:
                forward_headers.append(b"Proxy-Authorization: " + self.auth_header + b"\r\n")

            for line in lines[1:]:
                if not line.lower().startswith(b"proxy-authorization:"):
                    forward_headers.append(line + b"\r\n")

            forward_headers.append(b"\r\n")
            upstream_sock.sendall(b"".join(forward_headers))
            if body_bytes:
                upstream_sock.sendall(body_bytes)

            self._relay_bidirectional(client_sock, upstream_sock)

        except Exception as e:
            if self._running:
                logger.debug(f"[ProxyBridge:{self.port}] Client error: {e}")
        finally:
            if upstream_sock:
                self._safe_close(upstream_sock)
            self._safe_close(client_sock)

    def _relay_bidirectional(self, s1: socket.socket, s2: socket.socket):
        """Relay luồng dữ liệu 2 chiều giữa 2 socket sử dụng select."""
        s1.setblocking(False)
        s2.setblocking(False)
        sockets = [s1, s2]

        while self._running:
            try:
                rlist, _, xlist = select.select(sockets, [], sockets, 60.0)
                if xlist or not rlist:
                    break

                for s in rlist:
                    other = s2 if s is s1 else s1
                    data = s.recv(32768)
                    if not data:
                        return
                    other.sendall(data)
            except (socket.error, OSError):
                break
            except Exception:
                break

    def _safe_close(self, sock: socket.socket):
        self._untrack_socket(sock)
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        try:
            sock.close()
        except Exception:
            pass

    def close(self):
        """Đóng an toàn server bridge và toàn bộ socket đang active."""
        if not self._running:
            return
        self._running = False

        if self.server_sock:
            try:
                self.server_sock.close()
            except Exception:
                pass
            self.server_sock = None

        with self._sockets_lock:
            for s in list(self._active_sockets):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except Exception:
                    pass
                try:
                    s.close()
                except Exception:
                    pass
            self._active_sockets.clear()

        logger.info(f"Local Proxy Bridge closed on 127.0.0.1:{self.port}")


# ─── 5. VERIFY CHROME EGRESS IP ──────────────────────────────────────────────

def verify_chrome_egress_ip(driver, direct_ip: Optional[str] = None, timeout: int = 15) -> str:
    """
    Kiểm tra IP đầu ra thực tế của Chrome để chống rò rỉ IP mạng thật của máy.
    - Nếu Chrome IP trùng với direct_ip -> Raise ProxyLeakError!
    - Trả về Egress IP đã được xác nhận.
    """
    if not direct_ip:
        direct_ip = get_direct_ip()

    original_handle = None
    test_handle = None
    try:
        original_handle = driver.current_window_handle
    except Exception:
        pass

    try:
        driver.execute_script("window.open('https://api.ipify.org', '_blank');")
        test_handle = driver.window_handles[-1]
        driver.switch_to.window(test_handle)

        import time
        start_t = time.time()
        chrome_ip = None

        while time.time() - start_t < timeout:
            page_text = driver.find_element("tag name", "body").text.strip()
            m = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", page_text)
            if m:
                chrome_ip = m.group(0)
                break
            time.sleep(0.5)

        if not chrome_ip:
            driver.get("https://httpbin.org/ip")
            time.sleep(1.0)
            page_text = driver.find_element("tag name", "body").text.strip()
            m = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", page_text)
            if m:
                chrome_ip = m.group(0)

        if not chrome_ip:
            raise ProxyConnectionError("Chrome không thể tải trang kiểm tra IP qua Proxy!")

        logger.info(f"Chrome egress IP detected: {chrome_ip} (Direct Machine IP: {direct_ip})")

        if direct_ip and chrome_ip == direct_ip:
            raise ProxyLeakError(
                f"Rò rỉ IP máy: Chrome đang sử dụng IP thật ({direct_ip}) thay vì IP của Proxy!"
            )

        return chrome_ip

    finally:
        try:
            if test_handle and test_handle in driver.window_handles:
                driver.switch_to.window(test_handle)
                driver.close()
            if original_handle and original_handle in driver.window_handles:
                driver.switch_to.window(original_handle)
        except Exception as e:
            logger.debug(f"Note closing test tab: {e}")
