"""
human.py
Gõ phím / nghỉ ngẫu nhiên theo nhịp riêng của từng nick (lấy từ BrowserConfig của driver).
"""
import random
import time
from typing import Optional

from core.browser.fingerprint import BrowserConfig


def human_type(element, text: str, min_delay: float = 0.03, max_delay: float = 0.09,
               config: Optional[BrowserConfig] = None):
    """Gõ từng ký tự với độ trễ ngẫu nhiên; có config thì dùng khoảng trễ của nick."""
    if config:
        min_delay, max_delay = config.type_delay
    for char in text:
        element.send_keys(char)
        time.sleep(random.uniform(min_delay, max_delay))


def human_sleep(min_s: float = 2.0, max_s: float = 4.5, config: Optional[BrowserConfig] = None):
    """Nghỉ ngẫu nhiên trong [min_s, max_s] giây, nhân hệ số nhịp của nick nếu có config."""
    factor = config.sleep_factor if config else 1.0
    time.sleep(random.uniform(min_s * factor, max_s * factor))
