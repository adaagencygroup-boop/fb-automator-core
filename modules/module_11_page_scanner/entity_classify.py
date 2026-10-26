"""
Phân loại PAGE / PROFILE / UNKNOWN — hàm thuần, không phụ thuộc Selenium.
Dùng cho verify tab và test offline trên fixture header.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


FRIEND_BUTTON_LABELS = (
    "Thêm bạn bè",
    "Add friend",
    "Bạn bè",
    "Friends",
)

FOLLOW_BUTTON_RE = re.compile(
    r"^(Theo dõi|Follow|Following|Đang theo dõi)$",
    re.IGNORECASE,
)

FRIEND_COUNT_RE = re.compile(
    r"([\d.,]+)\s*(?:nghìn|ngàn|triệu|k|m|n)?\s*(?:bạn bè|friends)\b",
    re.IGNORECASE,
)

FOLLOWER_IN_HEADER_RE = re.compile(
    r"([\d]+(?:[.,][\d]+)*)\s*(?:nghìn|ngàn|triệu|n|k|tr|m)?\s*"
    r"(?:người\s*theo\s*dõi|followers?)\b",
    re.IGNORECASE,
)

LIKE_FOLLOW_PAIR_RE = re.compile(
    r"(?:lượt\s*thích|likes?)\s*[·•].*(?:người\s*theo\s*dõi|followers?)",
    re.IGNORECASE,
)

PAGE_CATEGORY_RE = re.compile(r"(?:Trang|Page)\s*[·•]", re.IGNORECASE)

PAGE_TRANSPARENCY_RE = re.compile(
    r"page\s*id|tính minh bạch của trang|page transparency",
    re.IGNORECASE,
)

ABOUT_PROFILE_RE = re.compile(
    r"làm việc tại|học tại|sống tại|works at|studied at|lives in",
    re.IGNORECASE,
)


def _norm_btn(label: str) -> str:
    return re.sub(r"\s+", " ", (label or "").strip())


def _has_exact_friend_button(header_buttons: List[str]) -> Optional[str]:
    for raw in header_buttons or []:
        t = _norm_btn(raw)
        for lab in FRIEND_BUTTON_LABELS:
            if t == lab or t.lower() == lab.lower():
                return lab
    return None


def _has_follow_button(header_buttons: List[str]) -> bool:
    for raw in header_buttons or []:
        if FOLLOW_BUTTON_RE.match(_norm_btn(raw)):
            return True
    return False


def _tab_norm_list(header_tabs: List[str]) -> List[str]:
    return [_norm_btn(t).lower() for t in (header_tabs or []) if _norm_btn(t)]


def _has_friends_tab(header_tabs: List[str]) -> bool:
    return any(t in ("bạn bè", "friends") for t in _tab_norm_list(header_tabs))


def _has_page_nav_tab(header_tabs: List[str]) -> bool:
    for t in _tab_norm_list(header_tabs):
        if any(
            x in t
            for x in (
                "đánh giá",
                "reviews",
                "cửa hàng",
                "shop",
                "dịch vụ",
                "services",
            )
        ):
            return True
    return False


def build_about_url(cleaned_or_raw: str) -> str:
    """
    slug → https://www.facebook.com/slug/about
    profile.php?id=… → …&sk=about (hoặc ?sk=about)
    """
    url = (cleaned_or_raw or "").strip()
    if not url:
        return ""
    if "profile.php" in url.lower():
        if re.search(r"[?&]sk=", url, flags=re.IGNORECASE):
            return re.sub(r"([?&]sk=)[^&]*", r"\1about", url, count=1, flags=re.IGNORECASE)
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}sk=about"
    return url.rstrip("/") + "/about"


def classify_page_entity(
    *,
    url: str = "",
    header_text: str = "",
    header_buttons: Optional[List[str]] = None,
    header_tabs: Optional[List[str]] = None,
    about_text: str = "",
    main_sample: str = "",
) -> Tuple[str, str, Dict[str, Any]]:
    """
    Phân loại thuần: PAGE | PROFILE | UNKNOWN.
    Trả về (entity, reason, debug).
    Không dùng một mình: Follow, số follower, tích xanh, profile.php, tên/avatar.
    """
    buttons = list(header_buttons or [])
    tabs = list(header_tabs or [])
    header = header_text or ""
    main = main_sample or header
    about = about_text or ""
    href = url or ""
    path = ""
    try:
        from urllib.parse import urlparse

        path = urlparse(href).path or ""
    except Exception:
        path = href

    debug: Dict[str, Any] = {
        "header_text": header[:400],
        "header_buttons": buttons[:20],
        "header_tabs": tabs[:20],
        "url": href,
        "has_follower_in_header": bool(FOLLOWER_IN_HEADER_RE.search(header)),
        "has_follow_button": _has_follow_button(buttons),
        "friend_button": _has_exact_friend_button(buttons),
        "has_friends_tab": _has_friends_tab(tabs),
        "has_friend_count": bool(FRIEND_COUNT_RE.search(header)),
    }

    # —— PAGE cứng ——
    if re.search(r"/pages/(?:[^/?#]+/)?\d{6,}", href, re.I) or re.search(
        r"^/pages/(?:[^/?#]+/)?\d{6,}", path, re.I
    ):
        return ("PAGE", "url_pages_id", debug)

    if PAGE_CATEGORY_RE.search(header):
        return ("PAGE", "h1_page_category", debug)

    if LIKE_FOLLOW_PAIR_RE.search(header):
        return ("PAGE", "h1_likes_and_followers", debug)

    sample_for_transparency = f"{main}\n{about}"
    if PAGE_TRANSPARENCY_RE.search(sample_for_transparency) and about:
        # about có Page ID / Transparency
        if PAGE_TRANSPARENCY_RE.search(about):
            return ("PAGE", "about_page_id_or_transparency", debug)
    if PAGE_TRANSPARENCY_RE.search(main):
        return ("PAGE", "main_page_transparency", debug)

    if _has_page_nav_tab(tabs):
        return ("PAGE", "nav_tab_page", debug)

    # —— PROFILE ——
    friend_lab = _has_exact_friend_button(buttons)
    if friend_lab:
        debug["friend_button_zone"] = "header"
        return ("PROFILE", f"friend_button:{friend_lab}", debug)

    if _has_friends_tab(tabs):
        return ("PROFILE", "nav_tab_friends", debug)

    if about and ABOUT_PROFILE_RE.search(about) and not PAGE_TRANSPARENCY_RE.search(about):
        return ("PROFILE", "about_work_study_live", debug)

    # —— Fallback PAGE: follower + Follow, không Friend / tab Bạn bè / số bạn bè ——
    has_fl = bool(FOLLOWER_IN_HEADER_RE.search(header))
    has_follow = _has_follow_button(buttons)
    has_friend_btn = bool(friend_lab)
    has_fr_tab = _has_friends_tab(tabs)
    has_fr_count = bool(FRIEND_COUNT_RE.search(header))

    if has_fl and has_follow and not has_friend_btn and not has_fr_tab and not has_fr_count:
        debug["fallback"] = True
        return (
            "PAGE",
            "fallback_page_no_friend_signal",
            debug,
        )

    # about Page ID khi gọi với about_text (sau khi mở /about)
    if about and PAGE_TRANSPARENCY_RE.search(about):
        return ("PAGE", "about_page_id_or_transparency", debug)

    return ("UNKNOWN", "no_strong_signal", debug)


def should_open_about(
    entity: str,
    header_text: str = "",
    header_buttons: Optional[List[str]] = None,
    header_tabs: Optional[List[str]] = None,
) -> bool:
    """
    Chỉ mở /about khi header chưa đủ tín hiệu:
    thiếu cả follower VÀ tín hiệu Friend (nút / tab Bạn bè).
    """
    if (entity or "").upper() != "UNKNOWN":
        return False
    buttons = list(header_buttons or [])
    tabs = list(header_tabs or [])
    header = header_text or ""
    has_fl = bool(FOLLOWER_IN_HEADER_RE.search(header))
    has_friend = bool(_has_exact_friend_button(buttons)) or _has_friends_tab(tabs)
    # Đủ follower hoặc đã có friend signal → không cần about (fallback/profile đã xử lý)
    # Chỉ mở about khi thiếu cả hai
    return not has_fl and not has_friend
