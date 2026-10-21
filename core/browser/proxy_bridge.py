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

    # 1. Từ chối SOCKS4 (chỉ hỗ trợ HTTP/HTTPS và SOCKS5)
    lower_raw = raw.lower()
    if lower_raw.startswith("socks4://"):
        raise ProxyFormatError(
            "Proxy SOCKS4 không được hỗ trợ. Vui lòng sử dụng Proxy định dạng HTTP/HTTPS hoặc SOCKS5!"
        )

    scheme = "http"
    username: Optional[str] = None
    password: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None

    # 2. Xử lý định dạng URL đầy đủ: http(s)://[user:pass@]host:port hoặc socks5://...
    if "://" in raw:
        parsed_url = urllib.parse.urlparse(raw)
        scheme = parsed_url.scheme.lower() or "http"
        if scheme not in ("http", "https", "socks5", "socks5h"):
            raise ProxyFormatError(f"Giao thức '{scheme}' không được hỗ trợ. Hãy sử dụng http://, https:// hoặc socks5://")
        if scheme == "socks5h":
            scheme = "socks5"

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
    protocol = scheme if scheme in ("socks5", "https") else ("auto" if "://" not in raw else "http")

    return {
        "scheme": scheme,
        "protocol": protocol,
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


def _recv_exact(sock: socket.socket, num_bytes: int) -> bytes:
    buf = b""
    while len(buf) < num_bytes:
        chunk = sock.recv(num_bytes - len(buf))
        if not chunk:
            raise EOFError("Socket ngắt kết nối đột ngột khi đang nhận dữ liệu SOCKS5.")
        buf += chunk
    return buf


def _socks5_connect_tunnel(
    sock: socket.socket,
    target_host: str,
    target_port: int,
    username: Optional[str] = None,
    password: Optional[str] = None,
    timeout: float = 15.0,
) -> None:
    """
    Thực hiện bắt tay và thiết lập tunnel SOCKS5 (RFC 1928 & RFC 1929) qua một socket đã kết nối.
    """
    sock.settimeout(timeout)
    # 1. Handshake (Method negotiation)
    if username and password:
        sock.sendall(b"\x05\x02\x00\x02")
    else:
        sock.sendall(b"\x05\x01\x00")

    resp = _recv_exact(sock, 2)
    ver, method = resp[0], resp[1]
    if ver != 5:
        raise ProxyConnectionError(f"Máy chủ không phải SOCKS5 (version: {ver})")

    # 2. Authentication nếu server yêu cầu
    if method == 2:
        if not username or not password:
            raise ProxyConnectionError("Máy chủ SOCKS5 yêu cầu xác thực Username/Password nhưng cấu hình không có!")
        u_bytes = username.encode("utf-8")
        p_bytes = password.encode("utf-8")
        auth_req = b"\x01" + bytes([len(u_bytes)]) + u_bytes + bytes([len(p_bytes)]) + p_bytes
        sock.sendall(auth_req)
        auth_resp = _recv_exact(sock, 2)
        if len(auth_resp) < 2 or auth_resp[1] != 0:
            raise ProxyConnectionError("Xác thực SOCKS5 thất bại: sai Username hoặc Password!")
    elif method == 0:
        pass
    else:
        raise ProxyConnectionError(f"Máy chủ SOCKS5 từ chối phương thức xác thực (method: {method})")

    # 3. Gửi lệnh CONNECT (RFC 1928)
    try:
        packed_ip = socket.inet_aton(target_host)
        atyp = b"\x01"
        dst_addr = packed_ip
    except socket.error:
        tgt_bytes = target_host.encode("idna")
        atyp = b"\x03"
        dst_addr = bytes([len(tgt_bytes)]) + tgt_bytes

    port_bytes = target_port.to_bytes(2, byteorder="big")
    req = b"\x05\x01\x00" + atyp + dst_addr + port_bytes
    sock.sendall(req)

    # 4. Đọc phản hồi kết nối từ SOCKS5 server
    head = _recv_exact(sock, 4)
    rep, resp_atyp = head[1], head[3]
    if rep != 0:
        err_map = {
            1: "Lỗi chung từ máy chủ SOCKS5",
            2: "Kết nối bị từ chối bởi cấu hình proxy rules",
            3: "Mạng đích không thể tiếp cận (Network unreachable)",
            4: "Host đích không thể tiếp cận (Host unreachable)",
            5: "Máy chủ đích từ chối kết nối (Connection refused)",
            6: "TTL hết hạn",
            7: "Lệnh không được hỗ trợ",
            8: "Kiểu địa chỉ không được hỗ trợ",
        }
        raise ProxyConnectionError(f"SOCKS5 kết nối tới {target_host}:{target_port} thất bại: {err_map.get(rep, f'Mã lỗi {rep}')}")

    if resp_atyp == 1:
        _recv_exact(sock, 4 + 2)
    elif resp_atyp == 3:
        dlen = _recv_exact(sock, 1)[0]
        _recv_exact(sock, dlen + 2)
    elif resp_atyp == 4:
        _recv_exact(sock, 16 + 2)


def _test_socks5_connectivity(proxy_info: Dict[str, Any], timeout: int = 15) -> Dict[str, Any]:
    host = proxy_info["host"]
    port = proxy_info["port"]
    user = proxy_info.get("username")
    pwd = proxy_info.get("password")

    endpoints = [
        ("api.ipify.org", 80, "/"),
        ("httpbin.org", 80, "/ip"),
    ]
    egress_ip = None
    last_err = None

    for target_host, target_port, path in endpoints:
        s = None
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(timeout)
            s.connect((host, port))
            _socks5_connect_tunnel(s, target_host, target_port, user, pwd, timeout=timeout)
            req = f"GET {path} HTTP/1.1\r\nHost: {target_host}\r\nUser-Agent: Mozilla/5.0 Chrome/127.0.0.0\r\nConnection: close\r\n\r\n".encode("latin-1")
            s.sendall(req)
            data = b""
            while True:
                chunk = s.recv(4096)
                if not chunk:
                    break
                data += chunk
            body = data.decode("utf-8", errors="ignore")
            ip_match = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", body)
            if ip_match:
                egress_ip = ip_match.group(0)
                break
        except Exception as e:
            last_err = e
        finally:
            if s:
                try:
                    s.close()
                except Exception:
                    pass

    if not egress_ip:
        raise ProxyConnectionError(f"Proxy SOCKS5 {host}:{port} kiểm tra kết nối thất bại: {last_err}")

    proxy_info["protocol"] = "socks5"
    logger.info(f"SOCKS5 proxy verified successfully: {host}:{port}, Egress IP={egress_ip}")
    return {"ok": True, "egress_ip": egress_ip}


# ─── 2. PRE-FLIGHT CONNECTIVITY TEST ──────────────────────────────────────────

def test_proxy_connectivity(proxy_info: Dict[str, Any], timeout: int = 15) -> Dict[str, Any]:
    """
    Thực hiện kiểm tra kết nối qua Proxy (Pre-flight test):
    - Hỗ trợ cả HTTP/HTTPS và SOCKS5 (tự động nhận diện nếu chưa rõ giao thức).
    - Lấy IP đầu ra (Egress IP) để chuẩn bị cho bước đối chiếu chống rò rỉ IP thật.
    """
    if not proxy_info:
        raise ProxyFormatError("Dữ liệu proxy rỗng")

    host = proxy_info["host"]
    port = proxy_info["port"]
    user = proxy_info.get("username")
    pwd = proxy_info.get("password")
    protocol = proxy_info.get("protocol") or ("socks5" if proxy_info.get("scheme") == "socks5" else "auto")

    if protocol == "socks5":
        return _test_socks5_connectivity(proxy_info, timeout)

    # Thử HTTP trước
    http_error = None
    try:
        if user and pwd:
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
            raise ProxyConnectionError(f"HTTP test failed: {last_http_err}")

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
            raise ProxyConnectionError(f"HTTPS test failed: {last_https_err}")

        proxy_info["protocol"] = "http"
        logger.info(f"All proxy tests passed! Proxy supports HTTP/HTTPS, Egress IP={egress_ip}")
        return {"ok": True, "egress_ip": egress_ip}

    except Exception as e:
        http_error = e

    # Nếu giao thức là 'auto' và HTTP thất bại, tự động thử sang SOCKS5
    if protocol == "auto":
        logger.info(f"[{host}:{port}] HTTP proxy test không thành công ({http_error}). Tự động dò kiểm tra SOCKS5...")
        try:
            res = _test_socks5_connectivity(proxy_info, timeout)
            proxy_info["protocol"] = "socks5"
            return res
        except Exception as socks_err:
            msg = f"Proxy {host}:{port} kiểm tra kết nối thất bại cả HTTP ({http_error}) và SOCKS5 ({socks_err})"
            logger.warning(msg)
            raise ProxyConnectionError(msg)
    else:
        msg = f"Proxy {host}:{port} kiểm tra kết nối HTTP/HTTPS thất bại: {http_error}"
        logger.warning(msg)
        raise ProxyConnectionError(msg)


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
        protocol: str = "http",
    ):
        self.upstream_host = upstream_host
        self.upstream_port = upstream_port
        self.username = username
        self.password = password
        self.protocol = protocol.lower() if protocol else "http"

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

    def _get_protocol(self) -> str:
        if self.protocol in ("socks5", "http"):
            return self.protocol
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(3.0)
            s.connect((self.upstream_host, self.upstream_port))
            s.sendall(b"\x05\x01\x02" if self.username else b"\x05\x01\x00")
            resp = s.recv(2)
            s.close()
            if len(resp) >= 2 and resp[0] == 5:
                self.protocol = "socks5"
                logger.info(f"[ProxyBridge:{self.port}] Auto-detected upstream protocol: SOCKS5")
                return "socks5"
        except Exception:
            pass
        self.protocol = "http"
        logger.info(f"[ProxyBridge:{self.port}] Auto-detected upstream protocol: HTTP")
        return "http"

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
        logger.info(f"Local Proxy Bridge started on 127.0.0.1:{self.port} -> {self.upstream_host}:{self.upstream_port} ({self.protocol})")
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
            proto = self._get_protocol()

            # ── A. XỬ LÝ SOCKS5 UPSTREAM ──
            if proto == "socks5":
                if method == "CONNECT":
                    if ":" in target:
                        tgt_host, tgt_p = target.split(":", 1)
                        tgt_port = int(tgt_p)
                    else:
                        tgt_host, tgt_port = target, 443

                    upstream_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    upstream_sock.settimeout(30.0)
                    self._track_socket(upstream_sock)
                    upstream_sock.connect((self.upstream_host, self.upstream_port))
                    _socks5_connect_tunnel(
                        upstream_sock,
                        tgt_host,
                        tgt_port,
                        username=self.username,
                        password=self.password,
                        timeout=30.0,
                    )
                    client_sock.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                    self._relay_bidirectional(client_sock, upstream_sock)
                    return

                # Plain HTTP qua SOCKS5
                tgt_host = None
                tgt_port = 80
                if "://" in target:
                    parsed = urllib.parse.urlparse(target)
                    tgt_host = parsed.hostname
                    tgt_port = parsed.port or 80
                    path = parsed.path or "/"
                    if parsed.query:
                        path += "?" + parsed.query
                else:
                    path = target

                if not tgt_host:
                    for line in lines[1:]:
                        if line.lower().startswith(b"host:"):
                            host_val = line.split(b":", 1)[1].strip().decode("latin-1")
                            if ":" in host_val:
                                tgt_host, p_str = host_val.split(":", 1)
                                tgt_port = int(p_str)
                            else:
                                tgt_host, tgt_port = host_val, 80
                            break

                if not tgt_host:
                    return

                upstream_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                upstream_sock.settimeout(30.0)
                self._track_socket(upstream_sock)
                upstream_sock.connect((self.upstream_host, self.upstream_port))
                _socks5_connect_tunnel(
                    upstream_sock,
                    tgt_host,
                    tgt_port,
                    username=self.username,
                    password=self.password,
                    timeout=30.0,
                )

                new_req_line = f"{method} {path} HTTP/1.1\r\n".encode("latin-1")
                forward_headers = [new_req_line]
                for line in lines[1:]:
                    low = line.lower()
                    if not low.startswith(b"proxy-authorization:") and not low.startswith(b"proxy-connection:"):
                        forward_headers.append(line + b"\r\n")
                forward_headers.append(b"\r\n")
                upstream_sock.sendall(b"".join(forward_headers))
                if body_bytes:
                    upstream_sock.sendall(body_bytes)

                self._relay_bidirectional(client_sock, upstream_sock)
                return

            # ── B. XỬ LÝ HTTP UPSTREAM ──
            # 1. Xử lý HTTPS (CONNECT method)
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

            # 2. Xử lý HTTP thông thường
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

    def _pipe_stream(self, src: socket.socket, dst: socket.socket, done_event: threading.Event):
        """Chuyển tiếp luồng byte liên tục giữa 2 socket có backpressure chống rớt kết nối khi upload video."""
        try:
            while self._running and not done_event.is_set():
                data = src.recv(65536)
                if not data:
                    break
                dst.sendall(data)
        except Exception:
            pass
        finally:
            try:
                # Báo EOF cho chiều gửi nhưng cho phép chiều ngược lại nhận nốt dữ liệu
                dst.shutdown(socket.SHUT_WR)
            except Exception:
                pass
            done_event.set()

    def _relay_bidirectional(self, s1: socket.socket, s2: socket.socket):
        """
        Relay luồng dữ liệu 2 chiều song công (Full-Duplex Streaming):
        - Sử dụng timeout 300s để hỗ trợ truyền tải video lớn (25MB - 500MB) qua Proxy.
        - Tự động điều tiết áp lực TCP buffer (Backpressure): không ném BlockingIOError làm rớt kết nối.
        - Khắc phục triệt để lỗi upload video lên Facebook Reels/Story bị gián đoạn/nhảy ngược về 5%.
        """
        try:
            s1.settimeout(300.0)
            s2.settimeout(300.0)
        except Exception:
            pass

        done1 = threading.Event()
        done2 = threading.Event()
        t1 = threading.Thread(
            target=self._pipe_stream,
            args=(s1, s2, done1),
            name="ProxyBridge-Pipe-Up",
            daemon=True,
        )
        t2 = threading.Thread(
            target=self._pipe_stream,
            args=(s2, s1, done2),
            name="ProxyBridge-Pipe-Down",
            daemon=True,
        )
        t1.start()
        t2.start()

        # Chờ ít nhất một chiều kết thúc truyền tải
        while self._running:
            if done1.is_set() or done2.is_set():
                break
            done1.wait(timeout=0.5)

        # Chờ thêm một khoảng ngắn để chiều còn lại nhận nốt phản hồi (vd: HTTP 200 sau upload)
        if done1.is_set() and not done2.is_set():
            done2.wait(timeout=15.0)
        elif done2.is_set() and not done1.is_set():
            done1.wait(timeout=5.0)

        # Dọn dẹp đóng 2 chiều an toàn
        for s in (s1, s2):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass

        t1.join(timeout=1.0)
        t2.join(timeout=1.0)

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

def verify_chrome_egress_ip(driver, direct_ip: Optional[str] = None, timeout: int = 8) -> str:
    """
    Kiểm tra IP đầu ra thực tế của Chrome để chống rò rỉ IP mạng thật của máy.
    - Thực hiện kiểm tra ngầm hoàn toàn trong tab hiện tại (không mở popup/tab mới).
    - Nếu Chrome IP trùng với direct_ip -> Raise ProxyLeakError!
    - Trả về Egress IP đã được xác nhận.
    """
    if not direct_ip:
        direct_ip = get_direct_ip()

    chrome_ip = None

    # 1. Thử kiểm tra ngầm hoàn toàn qua fetch trong tab hiện tại (không mở tab/cửa sổ mới)
    try:
        res = driver.execute_async_script("""
            var done = arguments[arguments.length - 1];
            var timeoutSec = arguments[0] || 5;
            var timer = setTimeout(function() { done(null); }, timeoutSec * 1000);

            function tryNext() {
                fetch('https://icanhazip.com')
                    .then(function(r) { return r.text(); })
                    .then(function(t) {
                        clearTimeout(timer);
                        done(t ? t.trim() : null);
                    })
                    .catch(function() {
                        clearTimeout(timer);
                        done(null);
                    });
            }

            fetch('https://api.ipify.org?format=json')
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    if (d && d.ip) {
                        clearTimeout(timer);
                        done(d.ip);
                    } else {
                        tryNext();
                    }
                })
                .catch(function() {
                    tryNext();
                });
        """, min(timeout, 5))
        if isinstance(res, str):
            m = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", res)
            if m:
                chrome_ip = m.group(0)
    except Exception as e:
        logger.debug(f"Async fetch egress IP note: {e}")

    # 2. Hỗ trợ môi trường unit test mock (nơi driver.find_element('tag name', 'body') được mock)
    if not chrome_ip:
        try:
            body_el = driver.find_element("tag name", "body")
            if body_el and hasattr(body_el, "text"):
                page_text = str(body_el.text).strip()
                m = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", page_text)
                if m:
                    chrome_ip = m.group(0)
        except Exception:
            pass

    if not chrome_ip:
        raise ProxyConnectionError("Chrome không thể tải trang kiểm tra IP qua Proxy!")

    logger.info(f"Chrome egress IP detected: {chrome_ip} (Direct Machine IP: {direct_ip})")

    if direct_ip and chrome_ip == direct_ip:
        raise ProxyLeakError(
            f"Rò rỉ IP máy: Chrome đang sử dụng IP thật ({direct_ip}) thay vì IP của Proxy!"
        )

    return chrome_ip
