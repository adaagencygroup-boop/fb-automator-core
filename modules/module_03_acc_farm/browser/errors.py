# -*- coding: utf-8 -*-
"""
Đổi lỗi kỹ thuật (Selenium, urllib3, proxy, CSDL) sang câu người dùng đọc được, dùng cho giao diện và lịch sử.
Chi tiết gốc chỉ ghi trong log. Câu tool tự viết (tiếng Việt) giữ nguyên.
"""
import re

from selenium.common.exceptions import (
    ElementClickInterceptedException,
    ElementNotInteractableException,
    InvalidElementStateException,
    InvalidSessionIdException,
    JavascriptException,
    MoveTargetOutOfBoundsException,
    NoSuchElementException,
    NoSuchFrameException,
    NoSuchWindowException,
    SessionNotCreatedException,
    StaleElementReferenceException,
    TimeoutException,
    WebDriverException,
)
from urllib3.exceptions import HTTPError, MaxRetryError, ReadTimeoutError

from core.browser import ProxyError

BROWSER_HUNG = "Trình duyệt không phản hồi nên đã bị đóng. Phần đã chạy vẫn được lưu, bạn có thể chạy lại."
BROWSER_SLOW = "Trình duyệt phản hồi quá chậm, đã bỏ qua hoạt động này."
BROWSER_CLOSED = "Trình duyệt bị đóng giữa chừng. Phần đã chạy vẫn được lưu."
BROWSER_NOT_OPENED = "Không mở được Chrome. Đóng Chrome đang mở của nick này rồi chạy lại."
PAGE_CHANGED = "Trang Facebook thay đổi trong lúc thao tác."
PAGE_SLOW = "Trang Facebook tải quá lâu."
PAGE_NETWORK = "Không tải được trang Facebook, kiểm tra lại mạng hoặc proxy."
DATABASE_DOWN = "Mất kết nối cơ sở dữ liệu, chạy lại sau khi có mạng."

_MAX_LENGTH = 300
_PAGE_ERRORS = (
    ElementClickInterceptedException, ElementNotInteractableException, InvalidElementStateException,
    JavascriptException, MoveTargetOutOfBoundsException, NoSuchElementException, NoSuchFrameException,
    StaleElementReferenceException,
)
_BROWSER_GONE_TEXTS = ("chrome not reachable", "disconnected", "session deleted", "tab crashed", "target closed",
                       "not connected to devtools")


def _is_hang(e: BaseException) -> bool:
    if isinstance(e, MaxRetryError):
        return isinstance(e.reason, ReadTimeoutError)
    return isinstance(e, (ReadTimeoutError, TimeoutError))


def _own_message(e: BaseException) -> str:
    """
    Câu tool tự viết, không có thì trả chuỗi rỗng. Câu tự viết luôn là tiếng Việt có dấu, lỗi của thư viện toàn ASCII.
    Tool tự ném WebDriverException (vd TimeoutException("Không tìm thấy ô nhập mã 2FA")) thì không có stacktrace của
    chromedriver. Lỗi hệ điều hành bỏ qua: Windows dịch thông báo sang tiếng Việt.
    """
    if isinstance(e, WebDriverException):
        text = "" if e.stacktrace else (e.msg or "")
    elif isinstance(e, (OSError, HTTPError)):
        text = ""
    else:
        text = str(e)
    return text.strip() if any(ord(c) > 127 for c in text) else ""


def _short(text: str) -> str:
    return text.strip().splitlines()[0][:_MAX_LENGTH]


def _proxy_text(e: ProxyError) -> str:
    text = str(e)
    # Lỗi kiểm tra kết nối kèm nguyên văn lỗi HTTP + SOCKS5: rút lại theo nguyên nhân. Câu khác (sai định dạng...) giữ nguyên.
    if "test failed" not in text and "kiểm tra kết nối thất bại" not in text:
        return _short(text)
    address = re.search(r"Proxy(?: SOCKS5)? (\S+:\d+)", text)
    name = f"Proxy {address.group(1)}" if address else "Proxy"
    lowered = text.lower()
    if "407" in text or "proxy authentication" in lowered or "sai username" in lowered:
        return f"{name} từ chối user/pass (sai hoặc đã hết hạn). Cập nhật proxy rồi chạy lại."
    if "timed out" in lowered or "timeout" in lowered:
        return f"{name} không phản hồi. Kiểm tra lại proxy rồi chạy lại."
    return f"{name} không kết nối được. Kiểm tra lại proxy rồi chạy lại."


def _driver_gone(e: WebDriverException) -> bool:
    if isinstance(e, (InvalidSessionIdException, NoSuchWindowException)):
        return True
    lowered = (e.msg or "").lower()
    return any(text in lowered for text in _BROWSER_GONE_TEXTS)


def is_browser_gone(e: BaseException) -> bool:
    """Trình duyệt treo / đã đóng: mọi lệnh sau đó đều hỏng, không đọc được gì về nick."""
    if isinstance(e, WebDriverException):
        return _driver_gone(e)
    return _is_hang(e) or isinstance(e, (HTTPError, ConnectionError))


def is_technical_error(e: BaseException) -> bool:
    """Lỗi kỹ thuật, không nói lên điều gì về nick (khác với câu tool tự viết khi đăng nhập không được)."""
    return is_browser_gone(e) or not _own_message(e)


def _webdriver_text(e: WebDriverException) -> str:
    if isinstance(e, SessionNotCreatedException):
        return BROWSER_NOT_OPENED
    if isinstance(e, _PAGE_ERRORS):
        return PAGE_CHANGED
    if isinstance(e, TimeoutException):
        return PAGE_SLOW
    if _driver_gone(e):
        return BROWSER_CLOSED
    if "net::err_" in (e.msg or "").lower():
        return PAGE_NETWORK
    return f"Lỗi trình duyệt ({type(e).__name__}). Xem chi tiết trong log."


def friendly_error(e: BaseException, still_open: bool = False) -> str:
    """Câu báo lỗi cho người dùng. still_open: trình duyệt vẫn chạy tiếp (lỗi 1 hoạt động), không báo là đã đóng."""
    if isinstance(e, ProxyError):
        return _proxy_text(e)
    own = _own_message(e)
    if own:
        return _short(own)
    if _is_hang(e):
        return BROWSER_SLOW if still_open else BROWSER_HUNG
    if isinstance(e, WebDriverException):
        return _webdriver_text(e)
    if isinstance(e, (HTTPError, ConnectionError)):
        return BROWSER_CLOSED
    if type(e).__module__.startswith("psycopg"):
        return DATABASE_DOWN
    return f"Lỗi không xác định ({type(e).__name__}). Xem chi tiết trong log."
