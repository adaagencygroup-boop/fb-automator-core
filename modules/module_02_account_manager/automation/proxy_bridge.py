"""
proxy_bridge.py (Module 02 alias)
Re-export toàn bộ tiện ích Proxy từ `core.browser.proxy_bridge` dùng chung cho dự án.
Giúp loại bỏ hoàn toàn 600+ dòng mã nguồn trùng lặp (DRY) trong khi vẫn đảm bảo tương thích 100%
cho router, schemas và các bài test của Module 02.
"""
from core.browser.proxy_bridge import (
    ProxyBridge,
    ProxyError,
    ProxyFormatError,
    ProxyConnectionError,
    ProxyLeakError,
    parse_proxy,
    test_proxy_connectivity,
    get_direct_ip,
    verify_chrome_egress_ip,
)

__all__ = [
    "ProxyBridge",
    "ProxyError",
    "ProxyFormatError",
    "ProxyConnectionError",
    "ProxyLeakError",
    "parse_proxy",
    "test_proxy_connectivity",
    "get_direct_ip",
    "verify_chrome_egress_ip",
]
