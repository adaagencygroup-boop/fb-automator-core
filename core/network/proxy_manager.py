"""
Proxy Manager & Rotator
Hỗ trợ:
- Proxy format: IP:PORT hoặc IP:PORT:USER:PASS
- HTTP, SOCKS5
- Health check & đo latency
- Xoay tua proxy theo round-robin
"""
import time
import requests
from typing import Optional, Dict, List, Any
from core.database.connection import db

class ProxyManager:
    def __init__(self):
        self._current_idx = 0

    def parse_proxy(self, proxy_str: str) -> Optional[Dict[str, str]]:
        proxy_str = proxy_str.strip()
        if not proxy_str:
            return None
        parts = proxy_str.split(":")
        if len(parts) == 2:
            ip, port = parts
            url = f"http://{ip}:{port}"
        elif len(parts) == 4:
            ip, port, user, pwd = parts
            url = f"http://{user}:{pwd}@{ip}:{port}"
        else:
            url = proxy_str if "://" in proxy_str else f"http://{proxy_str}"

        return {"http": url, "https": url}

    def check_proxy(self, proxy_str: str, timeout: int = 10) -> Dict[str, Any]:
        proxies = self.parse_proxy(proxy_str)
        if not proxies:
            return {"status": "DEAD", "latency_ms": 0}

        start_time = time.time()
        try:
            res = requests.get("https://api.ipify.org?format=json", proxies=proxies, timeout=timeout)
            if res.status_code == 200:
                latency = int((time.time() - start_time) * 1000)
                ip = res.json().get("ip")
                return {"status": "ACTIVE", "latency_ms": latency, "ip": ip}
        except Exception:
            pass

        return {"status": "DEAD", "latency_ms": 0}

    def get_active_proxies(self) -> List[str]:
        rows = db.fetch_all("SELECT proxy_str FROM proxies WHERE status = 'ACTIVE'")
        return [r["proxy_str"] for r in rows]

    def get_rotated_proxy(self) -> Optional[Dict[str, str]]:
        proxies = self.get_active_proxies()
        if not proxies:
            return None
        proxy_str = proxies[self._current_idx % len(proxies)]
        self._current_idx += 1
        return self.parse_proxy(proxy_str)

proxy_manager = ProxyManager()
