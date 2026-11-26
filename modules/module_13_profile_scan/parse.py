"""Bóc tách chữ trên trang cá nhân Facebook (Việt / Anh). Hàm thuần, không đụng Selenium / DB."""
from __future__ import annotations

import html
import json
import re
import unicodedata
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

# ==================== Khóa profile ====================

_RESERVED = {
    "groups", "pages", "posts", "photo", "photo.php", "watch", "reel", "reels", "story.php", "stories", "events",
    "marketplace", "hashtag", "search", "share", "login", "help", "settings", "messages", "permalink.php", "home.php",
}


def profile_key(raw: Any) -> Optional[str]:
    """UID / username / link / 'id:…' / 'user:…' → 'id:123' hoặc 'user:abc'; không hợp lệ → None."""
    text = str(raw or "").strip()
    if not text:
        return None
    for prefix in ("id:", "user:"):
        if text.startswith(prefix):
            text = text[len(prefix):].strip()
            break
    if "/" in text or "facebook.com" in text.lower():
        try:
            u = urlparse(text if re.match(r"https?://", text, re.I) else f"https://{text}")
            host = (u.hostname or "").lower()
        except ValueError:
            return None
        if host not in ("facebook.com", "fb.com") and not host.endswith((".facebook.com", ".fb.com")):
            return None
        parts = [p for p in u.path.split("/") if p]
        if not parts:
            return None
        first = parts[0].lower()
        if first == "profile.php":
            text = (parse_qs(u.query).get("id") or [""])[0]
            return f"id:{text}" if re.fullmatch(r"\d{5,20}", text) else None
        if first == "people" and len(parts) > 2:
            text = parts[2]
        elif first in _RESERVED:
            return None
        else:
            text = parts[0]
    if re.fullmatch(r"[0-9]{5,20}", text):
        return f"id:{text}"
    low = text.lower()
    if low in _RESERVED or low.isdigit() or not re.fullmatch(r"[a-z0-9.]{3,60}", low):
        return None
    return f"user:{low}"


def key_to_url(key: str) -> str:
    kind, value = key.split(":", 1)
    return f"https://www.facebook.com/profile.php?id={value}" if kind == "id" else f"https://www.facebook.com/{value}"


def section_url(key: str, section: str) -> str:
    base = key_to_url(key)
    return base + ("&sk=" if key.startswith("id:") else "/") + section


# ==================== Số ====================

_SUFFIX = {
    "k": 1e3, "n": 1e3, "nghìn": 1e3, "ngàn": 1e3,
    "m": 1e6, "tr": 1e6, "triệu": 1e6, "million": 1e6, "b": 1e9, "tỷ": 1e9,
}
_COUNT_RE = re.compile(
    r"(?<![\w.,])(\d[\d.,]*)\s*(k|nghìn|ngàn|n|million|m|triệu|tr|tỷ|b)?\s+"
    r"(friends?|người bạn|bạn bè|followers?|người theo dõi)(?!\w)",
    re.IGNORECASE,
)


def parse_count(number: str, suffix: Optional[str] = None) -> Optional[int]:
    """'1.234' → 1234 · '1,2' + 'K' → 1200."""
    number = number.strip(".,")
    if suffix:
        try:
            return int(round(float(number.replace(",", ".")) * _SUFFIX[suffix.lower()]))
        except ValueError:
            return None
    digits = re.sub(r"\D", "", number)
    return int(digits) if digits else None


def parse_counts(text: str) -> Dict[str, Optional[int]]:
    """Số bạn bè / người theo dõi ở phần đầu trang. Không có → None (không tự điền 0)."""
    out: Dict[str, Optional[int]] = {"friends": None, "followers": None}
    for m in _COUNT_RE.finditer(_norm(text)):
        field = "followers" if m.group(3).lower() in ("follower", "followers", "người theo dõi") else "friends"
        if out[field] is None:
            out[field] = parse_count(m.group(1), m.group(2))
    return out


# ==================== Số điện thoại ====================

_BANK = (
    r"mb(?:\s?bank)?|vcb|vietcombank|tcb|techcombank|acb|bidv|agribank|vpbank|tpbank|sacombank|stb|vib|"
    r"vietinbank|ctg|hdbank|shb|ocb|msb|scb|eximbank|seabank|ngân hàng|bank"
)
_STK_BEFORE = re.compile(rf"(?:\bstk\b|số tài khoản|\btài khoản\b|\btk\b|\b(?:{_BANK})\b)[^\d\n]{{0,15}}$", re.IGNORECASE)
_STK_AFTER = re.compile(rf"^[ \t\-–|:()]{{0,4}}(?:{_BANK})\b", re.IGNORECASE)
_PHONE_RE = re.compile(
    r"(?<![\d+])(?:\(?\+?84\)?[ \t.\-_]*(?:\(0\)|0)?|\(?0)[ \t.\-_]*"
    r"(?:[35789](?:[ \t.\-_()]*\d){8}|2(?:[ \t.\-_()]*\d){9})(?!\d)"
)


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = re.sub("[​-‏‪-‮⁠️⃣﻿]", "", text)
    return text.replace("\xa0", " ")


def find_phones(text: str) -> List[str]:
    """SĐT Việt Nam dạng 09xxxxxxxx, không trùng; bỏ số tài khoản ngân hàng."""
    t = _norm(text)
    # Chữ O viết thay số 0: 'O912…', '09O8…'
    t = re.sub(r"(?<=\d)[oO](?=[ .\-]?\d)", "0", t)
    t = re.sub(r"(?<!\w)[oO](?=[ .\-]?[35789](?:[ .\-]?\d){8}(?!\d))", "0", t)
    out: List[str] = []
    for m in _PHONE_RE.finditer(t):
        if _STK_BEFORE.search(t[: m.start()][-40:]) or _STK_AFTER.search(t[m.end():][:20]):
            continue
        digits = re.sub(r"\D", "", m.group(0))
        if digits.startswith("84"):
            digits = digits[2:]
        phone = "0" + digits.lstrip("0")
        if phone not in out:
            out.append(phone)
    return out


# ==================== Giới thiệu ====================

_NAV_END = {
    "friends", "bạn bè", "photos", "ảnh", "videos", "video", "check-ins", "sports", "music", "movies", "tv shows",
    "books", "apps and games", "likes", "lượt thích", "events", "groups", "posts", "bài viết", "reels",
}
_OVERVIEW = {"overview", "tổng quan"}
_EMPTY = re.compile(
    r"^(?:no .+ to show|no .+ info to show|không có .+ để hiển thị|add (?:a |an |your )?.+|thêm .+|chưa có .+)$", re.IGNORECASE
)
# Khối "Bạn bè" nằm dưới phần Giới thiệu ở bố cục mới: bộ lọc của nó có cả nhãn "Current city" / "Hometown"
# ("All friends · Recently Added · Current city · Following") → gặp các dòng này là hết phần Giới thiệu
_FRIENDS_WIDGET = {
    "all friends", "recently added", "birthdays", "see all friends", "mutual friends",
    "tất cả bạn bè", "đã thêm gần đây", "mới thêm gần đây", "sinh nhật bạn bè", "xem tất cả bạn bè", "bạn chung",
}
_NOISE = {"public", "công khai", "shared with public", "edit", "chỉnh sửa"}

_LIVES = re.compile(r"^(?:lives in|sống tại|sống ở|đang sống (?:tại|ở))\s+(.+)$", re.IGNORECASE)
_FROM = re.compile(r"^(?:from|đến từ)\s+(.+)$", re.IGNORECASE)
_EDU = re.compile(
    r"^(?:(?:studied|studies)(?: .+?)? at|went to|(?:đã |từng |đang )?học(?: .+?)? tại)\s+(.+)$", re.IGNORECASE
)
_WORKS = re.compile(
    r"^(?:works at|worked at|(?:đang |từng |đã )?làm việc tại)\s+(.+)$", re.IGNORECASE
)
_TITLE_AT = re.compile(r"^(?:former\s+|cựu\s+|từng là\s+)?(.{2,80}?)\s+(?:at|tại)\s+(.{2,120})$", re.IGNORECASE)

_L_CITY = {"current city", "current town/city", "current town or city", "thành phố hiện tại", "tỉnh/thành phố hiện tại",
           "thành phố/thị xã hiện tại", "nơi ở hiện tại",
           # Trang chuyên nghiệp (profile chế độ Page): mục Chi tiết ghi 'Address / Địa chỉ'
           "address", "địa chỉ"}
_L_HOME = {"hometown", "home town", "quê quán"}
_L_BIRTH = {"birth date", "birthday", "date of birth", "ngày sinh", "sinh nhật"}
_L_BYEAR = {"birth year", "year of birth", "năm sinh"}
_L_PHONE = {"mobile", "phone", "phone number", "di động", "điện thoại", "số điện thoại", "điện thoại di động"}
_H_WORK = {"work", "công việc", "work experience", "kinh nghiệm làm việc"}
_H_EDU = {"college", "university", "high school", "secondary school", "đại học", "cao đẳng", "trung học",
          "trường trung học", "trung học phổ thông", "education", "học vấn"}
_H_OTHER = {"places lived", "nơi từng sống", "contact info", "thông tin liên hệ", "basic info", "thông tin cơ bản",
            "family members", "relationship", "mối quan hệ", "thành viên gia đình", "websites and social links",
            "trang web và liên kết xã hội", "other places lived", "gender", "giới tính", "languages", "ngôn ngữ"}
_LABELS = _L_CITY | _L_HOME | _L_BIRTH | _L_BYEAR | _L_PHONE | _H_WORK | _H_EDU | _H_OTHER

_DATE = re.compile(
    r"^(?:\d{1,2}[/\-]\d{1,2}(?:[/\-]\d{4})?|\d{1,2} (?:tháng|thg) \d{1,2}(?:,? (?:năm )?\d{4})?"
    r"|\d{1,2} [a-z]{3,9}(?:,? \d{4})?|[a-z]{3,9} \d{1,2}(?:, \d{4})?)$",
    re.IGNORECASE,
)


def clean_lines(text: str) -> List[str]:
    out = []
    for line in _norm(text).splitlines():
        line = re.sub(r"\s+", " ", line).strip(" ·•")
        if line and line.lower() not in _NOISE:
            out.append(line)
    return out


def about_region(text: str) -> List[str]:
    """Các dòng của khối Giới thiệu: bỏ menu phía trên, dừng ở khối Bạn bè / Ảnh phía dưới."""
    lines = clean_lines(text)
    start = next((i + 1 for i, line in enumerate(lines) if line.lower() in _OVERVIEW), None)
    if start is None:
        return lines
    end = next((i for i in range(start, len(lines)) if lines[i].lower() in _NAV_END), len(lines))
    return lines[start:end]


def _near(lines: List[str], i: int, ok) -> Optional[str]:
    """Facebook đặt giá trị ngay trên (bố cục cũ) hoặc ngay dưới (bố cục mới) nhãn."""
    for j in (i - 1, i + 1):
        if 0 <= j < len(lines) and ok(lines[j]):
            return lines[j]
    return None


def _is_value(line: str) -> bool:
    return line.lower() not in _LABELS and not _EMPTY.match(line)


def parse_about(lines: List[str]) -> Dict[str, str]:
    """Dòng chữ trong Giới thiệu → các trường tìm thấy (không có thì không trả khóa)."""
    out: Dict[str, str] = {}
    section = ""
    year = None

    def put(field: str, value: Optional[str]) -> None:
        value = (value or "").strip()
        if value and not _EMPTY.match(value):
            out.setdefault(field, value)

    for i, line in enumerate(lines):
        low = line.lower()
        if low in _FRIENDS_WIDGET:
            break
        if low in _LABELS:
            section = "work" if low in _H_WORK else "edu" if low in _H_EDU else ""
            if low in _L_CITY:
                put("location", _near(lines, i, _is_value))
            elif low in _L_HOME:
                put("hometown", _near(lines, i, _is_value))
            elif low in _L_BIRTH:
                put("birthday", _near(lines, i, lambda s: bool(_DATE.match(s))))
            elif low in _L_BYEAR:
                year = _near(lines, i, lambda s: bool(re.fullmatch(r"(?:19|20)\d\d", s)))
            elif low in _L_PHONE:
                phones = find_phones("\n".join(lines[max(0, i - 1): i + 2]))
                put("phone", ", ".join(phones))
            continue
        if m := _LIVES.match(line):
            put("location", m.group(1))
        elif m := _FROM.match(line):
            put("hometown", m.group(1))
        elif m := _EDU.match(line):
            put("education", m.group(1))
        elif m := _WORKS.match(line):
            put("job_place", m.group(1))
        elif section == "work" and "job_place" not in out and not _EMPTY.match(line):
            if m := _TITLE_AT.match(line):
                put("job_title", m.group(1))
                put("job_place", m.group(2))
            else:
                put("job_place", line)
        elif section == "edu" and not _EMPTY.match(line):
            put("education", line)
    if year and out.get("birthday") and year not in out["birthday"]:
        out["birthday"] += f", {year}"
    return out


def parse_intro(lines: List[str]) -> Dict[str, str]:
    """Thẻ Giới thiệu ở trang chính: 'CEO tại ABC' không có tiêu đề mục đi kèm."""
    out = parse_about(lines)
    if "job_place" not in out:
        for line in lines:
            if len(line) > 120 or _LIVES.match(line) or _FROM.match(line) or _EDU.match(line):
                continue
            m = _TITLE_AT.match(line)
            if m:
                out["job_title"], out["job_place"] = m.group(1), m.group(2)
                break
    return out


# ==================== Mã nguồn trang ====================


def _json_text(raw: str) -> str:
    try:
        return json.loads(f'"{raw}"')
    except ValueError:
        return raw


def bio_from_source(source: str) -> str:
    for pat in (
        r'"profile_intro_card"\s*:\s*\{.{0,600}?"bio"\s*:\s*\{.{0,120}?"text"\s*:\s*"((?:\\.|[^"\\])*)"',
        r'"profile_bio(?:_text)?"\s*:\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"',
    ):
        m = re.search(pat, source or "", re.S)
        if m and m.group(1):
            return _json_text(m.group(1)).strip()
    return ""


def uid_from_source(source: str, username: Optional[str] = None, own_uid: Optional[str] = None) -> Optional[str]:
    """UID số của CHỦ trang đang xem (không lấy nhầm UID tài khoản quét)."""
    src = source or ""
    own = str(own_uid or "")
    if username:
        name = re.escape(username)
        for pat in (
            rf'"userVanity"\s*:\s*"{name}"\s*,\s*"userID"\s*:\s*"(\d{{5,20}})"',
            rf'"userID"\s*:\s*"(\d{{5,20}})"\s*,\s*"userVanity"\s*:\s*"{name}"',
        ):
            m = re.search(pat, src, re.I)
            if m:
                return m.group(1)
    for pat in (r"fb://(?:profile|page)/(\d{5,20})", r'"profile_owner"\s*:\s*\{\s*"id"\s*:\s*"(\d{5,20})"', r'"profileID"\s*:\s*"(\d{5,20})"'):
        for m in re.finditer(pat, src):
            if m.group(1) != own:
                return m.group(1)
    return None


_UNAVAILABLE = (
    "this content isn't available", "this page isn't available", "trang này không hiển thị",
    "bạn hiện không xem được nội dung này", "nội dung này hiện không", "không xem được trang này",
)
_LOCKED = (
    "locked their profile", "locked her profile", "locked his profile", "profile is locked",
    "khóa bảo vệ trang cá nhân", "khoá bảo vệ trang cá nhân", "đã khóa trang cá nhân", "đã khoá trang cá nhân",
)
_BLOCKED = (
    "you're temporarily blocked", "you can't use this feature right now", "bạn tạm thời bị chặn",
    "hiện bạn không thể dùng tính năng này", "bạn bị chặn tạm thời",
)


def page_state(text: str, has_name: bool) -> str:
    """OK | UNAVAILABLE | LOCKED | BLOCKED (tài khoản quét bị Facebook chặn tạm thời)."""
    low = html.unescape(_norm(text)).replace("’", "'").lower()[:6000]
    # Bài đăng có thể nhắc các câu này → chỉ tin khi trang không có tên người
    if not has_name:
        if any(s in low for s in _BLOCKED):
            return "BLOCKED"
        if any(s in low for s in _UNAVAILABLE):
            return "UNAVAILABLE"
    if any(s in low[:1500] for s in _LOCKED):
        return "LOCKED"
    return "OK"
