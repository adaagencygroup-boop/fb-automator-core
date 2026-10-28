"""
Chọn heading header tác giả — hàm thuần, test offline được.
Không bắt buộc thẻ h1; chấp nhận role=heading / aria-level=1 / text trong main.
Không lấy Notifications / panel chrome chung.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse


GENERIC_H1_TEXTS = frozenset(
    {
        "notifications",
        "thông báo",
        "home",
        "trang chủ",
        "search",
        "tìm kiếm",
        "messages",
        "tin nhắn",
        "menu",
        "facebook",
        "feeds",
        "watch",
        "marketplace",
        "groups",
        "nhóm",
        "friends",
        "bạn bè",
        "profile",
        "your profile",
        "trang cá nhân của bạn",
    }
)


def normalize_header_name(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def is_generic_h1_text(text: str) -> bool:
    n = normalize_header_name(text)
    if not n:
        return True
    if n in GENERIC_H1_TEXTS:
        return True
    if n.startswith("notification") or n.startswith("thông báo"):
        return True
    return False


def names_match(candidate_text: str, author_name: str) -> bool:
    """Text bằng hoặc chứa tên tác giả (không phân biệt hoa thường, gọn khoảng trắng)."""
    a = normalize_header_name(author_name)
    h = normalize_header_name(candidate_text)
    if not a or not h:
        return False
    if is_generic_h1_text(h):
        return False
    if h == a or a in h or h in a:
        return True
    a2 = re.sub(r"[^\w\s]", "", a, flags=re.UNICODE)
    h2 = re.sub(r"[^\w\s]", "", h, flags=re.UNICODE)
    if a2 and h2 and (a2 in h2 or h2 in a2 or a2 == h2):
        return True
    return False


def _catalog_entry(raw: Dict[str, Any]) -> Dict[str, Any]:
    text = (raw.get("text") or "").strip().split("\n")[0].strip()
    visible = bool(raw.get("visible"))
    aria_hidden = bool(raw.get("aria_hidden"))
    width = float(raw.get("width") or 0)
    height = float(raw.get("height") or 0)
    tag = (raw.get("tag") or raw.get("tag_name") or "unknown").lower()
    return {
        "text": text,
        "tag": tag,
        "role": (raw.get("role") or "") or "",
        "visible": visible,
        "aria_hidden": aria_hidden,
        "width": width,
        "height": height,
        "generic": is_generic_h1_text(text),
        "in_main": bool(raw.get("in_main", True)),
        "source": raw.get("source") or tag,
    }


def select_author_heading(
    candidates: List[Dict[str, Any]],
    author_name: str,
) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Chọn heading đúng từ danh sách mô tả (h1 / role=heading / span|div trong main).
    Không yêu cầu bắt buộc thẻ h1.
    Trả (selected_or_None, catalog).
    """
    catalog: List[Dict[str, Any]] = []
    visible_ok: List[Dict[str, Any]] = []

    for raw in candidates or []:
        entry = _catalog_entry(raw)
        catalog.append(entry)
        if not entry["visible"] or entry["aria_hidden"]:
            continue
        if entry["width"] <= 0 or entry["height"] <= 0:
            continue
        if entry["generic"]:
            continue
        visible_ok.append(entry)

    if not author_name or not str(author_name).strip():
        for e in visible_ok:
            return e, catalog
        return None, catalog

    # Ưu tiên: khớp tên + tag heading-like
    heading_like = []
    text_like = []
    for e in visible_ok:
        if not names_match(e["text"], author_name):
            continue
        tag = e["tag"]
        role = (e.get("role") or "").lower()
        if tag == "h1" or role == "heading" or e.get("source") in ("h1", "heading", "aria-level-1"):
            heading_like.append(e)
        else:
            text_like.append(e)

    if heading_like:
        return heading_like[0], catalog
    if text_like:
        return text_like[0], catalog
    return None, catalog


# Alias tương thích test/code cũ
def select_author_h1(
    h1_candidates: List[Dict[str, Any]],
    author_name: str,
) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    return select_author_heading(h1_candidates, author_name)


def author_tab_url_matches(current_url: str, cleaned_author: str) -> Tuple[bool, str]:
    """
    So current_url tab verify với cleaned author URL.
    Trả (ok, detail).
    """
    curr = (current_url or "").strip()
    auth = (cleaned_author or "").strip()
    if not curr:
        return False, "empty_current_url"
    cl = curr.lower()
    if "checkpoint" in cl or "/login" in cl:
        return False, "checkpoint_or_login"
    if any(x in cl for x in ("/reel", "/stories", "/story", "/watch", "/reels/")):
        return False, "media_url"
    if "/search" in cl or "/notifications" in cl:
        return False, "chrome_or_search_url"
    if cl in ("about:blank", "chrome://newtab/", "chrome://new-tab-page/"):
        return False, "blank_tab"
    # Feed home
    if re.match(r"^https?://(www\.)?facebook\.com/?$", cl):
        return False, "feed_home"

    try:
        from .page_source import clean_page_url, extract_page_identifier

        c_clean = clean_page_url(curr) or curr
        a_clean = clean_page_url(auth) or auth
        if c_clean.rstrip("/") == a_clean.rstrip("/"):
            return True, "exact_clean"
        k1, q1 = extract_page_identifier(c_clean)
        k2, q2 = extract_page_identifier(a_clean)
        if k1 and k2 and k1 == k2 and q1 != "weak" and q2 != "weak":
            return True, f"same_page_key:{k1}"

        pc = urlparse(c_clean)
        pa = urlparse(a_clean)
        path_c = (pc.path or "").rstrip("/").lower()
        path_a = (pa.path or "").rstrip("/").lower()
        if path_c and path_a and path_c == path_a:
            return True, "same_path"
        if "profile.php" in path_c and "profile.php" in path_a:
            id_c = (parse_qs(pc.query).get("id") or [""])[0]
            id_a = (parse_qs(pa.query).get("id") or [""])[0]
            if id_c and id_a and id_c == id_a:
                return True, "same_profile_id"
        # Slug / id xuất hiện trong URL hiện tại
        slug = path_a.rsplit("/", 1)[-1] if path_a else ""
        if slug and slug not in ("profile.php", "pages") and slug in cl:
            return True, f"slug_in_url:{slug}"
        if "profile.php" in path_a:
            id_a = (parse_qs(pa.query).get("id") or [""])[0]
            if id_a and id_a in cl:
                return True, f"id_in_url:{id_a}"
    except Exception as exc:
        return False, f"compare_error:{exc}"

    return False, f"mismatch curr={curr!r} auth={auth!r}"
