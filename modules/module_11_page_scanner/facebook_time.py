"""
Parse thời gian Facebook cho POST_SCAN / lọc Từ ngày–Đến ngày.

Ưu tiên (ổn định nhất → kém hơn):
1. Unix `data-utime` / ISO `datetime` attribute trong HTML
2. Tooltip tuyệt đối (title / aria-label đầy đủ)
3. Parse text hiển thị (tương đối / tuyệt đối / rút gọn, EN + VI)

Trả về date ISO `YYYY-MM-DD` để so với input type=date của FE.
Giữ `published_text` thô riêng — hàm này không ghi đè text.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Optional, Tuple

_MONTH_EN = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}


def _safe_date(y: int, m: int, d: int) -> Optional[str]:
    try:
        return datetime(y, m, d).strftime("%Y-%m-%d")
    except ValueError:
        return None


def _from_utime(utime: Optional[int]) -> Optional[str]:
    if utime is None:
        return None
    try:
        ts = int(utime)
        if ts <= 0:
            return None
        # FB đôi khi gửi ms
        if ts > 10_000_000_000:
            ts //= 1000
        return datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _from_iso_attr(iso_attr: Optional[str]) -> Optional[str]:
    if not iso_attr:
        return None
    s = str(iso_attr).strip()
    # 2025-10-21T07:39:00+07:00 / 2025-10-21
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def parse_facebook_published_at(
    text: Optional[str] = None,
    *,
    now: Optional[datetime] = None,
    utime: Optional[int] = None,
    iso_attr: Optional[str] = None,
) -> Tuple[Optional[str], str]:
    """
    Trả (YYYY-MM-DD | None, source).
    source: utime | iso_attr | absolute | relative | compact | unparsed
    """
    got = _from_utime(utime)
    if got:
        return got, "utime"
    got = _from_iso_attr(iso_attr)
    if got:
        return got, "iso_attr"

    if not text or not str(text).strip():
        return None, "unparsed"

    t = str(text).strip()
    t = re.sub(r"\s+", " ", t)
    # Bỏ prefix tooltip thừa
    t_clean = re.sub(r"^(Posted\s+|Đã đăng\s+)", "", t, flags=re.I).strip()
    ref = now or datetime.now()

    # --- Absolute EN: October 21, 2025 at 7:39 AM / October 21 at 7:39 AM / October 21, 2025 ---
    m = re.search(
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December|"
        r"Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+"
        r"(\d{1,2})(?:,?\s*(\d{4}))?"
        r"(?:\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?",
        t_clean,
        flags=re.I,
    )
    if m:
        mon = _MONTH_EN.get(m.group(1).lower().rstrip("."))
        day = int(m.group(2))
        year = int(m.group(3)) if m.group(3) else ref.year
        # Nếu không có năm và tháng/ngày ở tương lai xa so với ref → năm trước
        if not m.group(3) and mon and (mon > ref.month or (mon == ref.month and day > ref.day)):
            year = ref.year - 1
        if mon:
            got = _safe_date(year, mon, day)
            if got:
                return got, "absolute"

    # --- Absolute VI: 21 tháng 10 năm 2025 lúc 7:39 / 21 tháng 10 lúc 7:39 ---
    m = re.search(
        r"(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{4}))?(?:\s+lúc\s+\d{1,2}[:h]\d{2})?",
        t_clean,
        flags=re.I,
    )
    if m:
        day, mon = int(m.group(1)), int(m.group(2))
        year = int(m.group(3)) if m.group(3) else ref.year
        if not m.group(3) and (mon > ref.month or (mon == ref.month and day > ref.day)):
            year = ref.year - 1
        got = _safe_date(year, mon, day)
        if got:
            return got, "absolute"

    # ISO / yyyy-mm-dd trong text
    got = _from_iso_attr(t_clean)
    if got:
        return got, "absolute"

    low = t_clean.lower()

    # --- Just now / Vừa xong ---
    if re.fullmatch(r"(just\s*now|vừa\s*xong)", low):
        return ref.strftime("%Y-%m-%d"), "relative"

    # --- Yesterday at … / Hôm qua lúc … ---
    if re.match(r"^(yesterday|hôm\s*qua)\b", low):
        return (ref - timedelta(days=1)).strftime("%Y-%m-%d"), "relative"

    # --- EN relative short header: 1 min / 5 mins / 1 hr / 2 hrs ---
    m = re.fullmatch(
        r"(\d+)\s*(mins?|minutes?|hrs?|hours?|secs?|seconds?)\b",
        low,
    )
    if m:
        n = int(m.group(1))
        unit = m.group(2)
        delta = _delta(n, unit)
        if delta is not None:
            return (ref - delta).strftime("%Y-%m-%d"), "relative"

    # --- EN … ago (a/an/N): a day ago, 2 days ago, an hour ago, a week ago … ---
    m = re.fullmatch(
        r"(?:an?\s+|(\d+)\s+)?(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|secs?|seconds?)\s+ago",
        low,
    )
    if m:
        n = int(m.group(1)) if m.group(1) else 1
        delta = _delta(n, m.group(2))
        if delta is not None:
            return (ref - delta).strftime("%Y-%m-%d"), "relative"

    # Variant: 1 hr ago / 2 hrs ago / 1 minute ago
    m = re.fullmatch(
        r"(\d+)\s*(mins?|minutes?|hrs?|hours?|days?|weeks?|months?|years?)\s+ago",
        low,
    )
    if m:
        delta = _delta(int(m.group(1)), m.group(2))
        if delta is not None:
            return (ref - delta).strftime("%Y-%m-%d"), "relative"

    # --- VI: 5 phút trước, 2 giờ trước, 1 ngày trước, 3 tuần trước, 2 tháng trước, 1 năm trước ---
    m = re.fullmatch(
        r"(\d+)\s*(phút|giờ|ngày|tuần|tháng|năm)\s+trước",
        low,
    )
    if m:
        delta = _delta(int(m.group(1)), m.group(2))
        if delta is not None:
            return (ref - delta).strftime("%Y-%m-%d"), "relative"

    # --- Compact: 5m, 2h, 1d, 2d, 1w, 3w, 1y ---
    m = re.fullmatch(r"(\d+)\s*([mhdwy])\b", low)
    if m:
        n = int(m.group(1))
        u = m.group(2)
        mapping = {"m": "minute", "h": "hour", "d": "day", "w": "week", "y": "year"}
        delta = _delta(n, mapping[u])
        if delta is not None:
            return (ref - delta).strftime("%Y-%m-%d"), "compact"

    # Compact VI-ish mixed in feed: 5 phút / 2 giờ (không "trước") — cẩn thận, chỉ khi fullmatch ngắn
    m = re.fullmatch(r"(\d+)\s*(phút|giờ|ngày|tuần|tháng|năm)\b", low)
    if m:
        delta = _delta(int(m.group(1)), m.group(2))
        if delta is not None:
            return (ref - delta).strftime("%Y-%m-%d"), "relative"

    return None, "unparsed"


def _delta(n: int, unit: str) -> Optional[timedelta]:
    u = (unit or "").lower().rstrip("s")
    # normalize plurals already stripped roughly
    if u in ("sec", "second"):
        return timedelta(seconds=n)
    if u in ("min", "minute"):
        return timedelta(minutes=n)
    if u in ("hr", "hour", "giờ"):
        return timedelta(hours=n)
    if u in ("day", "ngày"):
        return timedelta(days=n)
    if u in ("week", "tuần"):
        return timedelta(weeks=n)
    if u in ("month", "tháng"):
        return timedelta(days=30 * n)  # đủ cho lọc khoảng ngày
    if u in ("year", "năm"):
        return timedelta(days=365 * n)
    if u == "phút":
        return timedelta(minutes=n)
    # already singular forms from compact
    return None


# Alias tương thích posts_scan cũ
def try_parse_published_at(
    published_text: Optional[str],
    *,
    now: Optional[datetime] = None,
) -> Optional[str]:
    date_s, _src = parse_facebook_published_at(published_text, now=now)
    return date_s
