"""
=============================================================================
MODULE 11: FACEBOOK PAGE SCANNER - PAGE SOURCE & URL STANDARDIZATION
=============================================================================
Xử lý làm sạch, chuẩn hóa định danh page_key, chống lặp và parse file input.
Tuân thủ nghiêm ngặt nguyên tắc Section 3 & 4 của Module 11 detail plan.
"""
from __future__ import annotations

import csv
import io
import logging
import re
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger(__name__)

# Các slug hệ thống của Facebook không phải là Fanpage cá nhân/doanh nghiệp
SYSTEM_SLUGS = {
    "search", "watch", "marketplace", "gaming", "events", "help",
    "login", "messages", "friends", "groups", "reel", "reels",
    "stories", "story", "share", "settings", "photo", "photos",
    "video", "videos", "permalink", "hashtag", "bookmarks",
    "notifications", "saved", "pages",
    "l.php", "ls.php", "sharer.php", "dialog",
}

# Host / path redirect ngoài — không bao giờ là tác giả Page
EXTERNAL_REDIRECT_MARKERS = (
    "l.php",
    "lm.facebook.com",
    "l.facebook.com",
    "/l.php?",
    "facebook.com/l.php",
)

# Tên hiển thị trông như URL/domain (bit.ly, shopee.vn, …)
_AUTHOR_NAME_URL_RE = re.compile(
    r"(?i)(?:https?://|www\.)|"
    r"(?:^|[\s/])[\w\-]+(?:\.[\w\-]+)+(?:/[\w\-./?=&%]*)?$|"
    r"\b[\w\-]+\.(?:com|vn|net|org|ly|me|shop|store|io|co|info|biz)\b"
)

# Path media — không bao giờ dùng làm link tác giả Page
MEDIA_PATH_MARKERS = (
    "/reel/",
    "/reels/",
    "/stories/",
    "/story/",
    "story.php",
    "/watch/",
    "/videos/",
    "/photos/",
    "/posts/",
    "/permalink/",
    "/share/",
)

# Các sub-path con thường gặp trên trang Page
SUB_PATHS = {
    "about", "photos", "videos", "reviews", "followers", "posts",
    "community", "events", "reels", "services", "shop", "offers",
    "mentions", "subscribers",
}


def clean_page_url(raw_url: str) -> str:
    """
    Chuẩn hóa URL Facebook Page về dạng chuẩn duy nhất:
    - Host luôn là https://www.facebook.com
    - Giữ lại query id nếu là profile.php?id=...
    - Cắt bỏ mọi query tracking: mibextid, ref, fref, tsid, ...
    - Cắt các sub-path con (/about, /photos, /posts, ...) về link gốc của Page
    - Bỏ dấu / cuối cùng.
    """
    if not raw_url:
        return ""
    text = raw_url.strip()

    # Bỏ khoảng trắng và dấu quote bọc ngoài nếu có
    text = text.strip("\"' ")

    # Chuẩn hóa nếu user chỉ nhập UID số thuần (VD: 100084729103941)
    if re.match(r"^\d{6,25}$", text):
        return f"https://www.facebook.com/profile.php?id={text}"

    # Bỏ hash fragment
    text = text.split("#")[0].strip()

    # Thêm protocol nếu thiếu
    if not re.match(r"^https?://", text, flags=re.IGNORECASE):
        # Kiểm tra xem có bắt đầu bằng domain không
        if text.startswith("facebook.com") or text.startswith("fb.com") or text.startswith("m.facebook.com"):
            text = "https://" + text
        else:
            # Nếu chỉ là path /username hoặc username
            text = "https://www.facebook.com/" + text.lstrip("/")

    parsed = urlparse(text)
    host = parsed.netloc.lower()

    # Chuẩn hóa subdomain thành www.facebook.com
    if any(host == d or host.endswith("." + d) for d in ["facebook.com", "fb.com"]):
        norm_host = "www.facebook.com"
    else:
        # Giữ nguyên host nếu không phải facebook (sẽ bị coi là invalid sau đó)
        norm_host = host

    path = parsed.path.strip()

    # Trường hợp 1: profile.php?id=123456
    if "profile.php" in path:
        q = parse_qs(parsed.query)
        profile_ids = q.get("id") or []
        if profile_ids and profile_ids[0].strip().isdigit():
            return f"https://{norm_host}/profile.php?id={profile_ids[0].strip()}"
        return f"https://{norm_host}/profile.php"

    # Trường hợp 2: /pages/Tên-Page/123456789...
    pages_match = re.search(r"^/pages/(?:[^/?#]+/)?(\d{6,25})(?:/.*)?$", path, flags=re.IGNORECASE)
    if pages_match:
        page_id = pages_match.group(1)
        return f"https://{norm_host}/pages/{page_id}"

    # Trường hợp 2b: /people/Name/123456...
    people_match = re.search(r"^/people/[^/]+/(\d{6,25})/?$", path, flags=re.IGNORECASE)
    if people_match:
        return f"https://{norm_host}/profile.php?id={people_match.group(1)}"

    # Trường hợp 3: /<username>[/sub-path]
    parts = [p for p in path.split("/") if p]
    if not parts:
        return f"https://{norm_host}"

    first_segment = parts[0]
    first_lower = first_segment.lower()

    # Nếu segment đầu là system slug
    if first_lower in SYSTEM_SLUGS:
        # Nếu là /pages/... nhưng không match regex số ở trên
        if first_lower == "pages" and len(parts) >= 2:
            last_part = parts[-1]
            if last_part.isdigit():
                return f"https://{norm_host}/pages/{last_part}"
            return f"https://{norm_host}/pages/{parts[1]}"
        return f"https://{norm_host}/{first_segment}"

    # Cắt các sub-path con nếu segment thứ 2 là about, photos, ...
    if len(parts) >= 2 and parts[1].lower() in SUB_PATHS:
        return f"https://{norm_host}/{first_segment}"

    # Link chuẩn 1 segment: /username
    return f"https://{norm_host}/{first_segment}"


def is_media_facebook_url(url: str) -> bool:
    """True nếu URL là reel/story/watch/posts/... — không phải trang tác giả."""
    if not url:
        return False
    lower = str(url).lower()
    if any(m in lower for m in MEDIA_PATH_MARKERS):
        return True
    # /reel /reels /stories /story /watch đứng một mình (sau clean)
    try:
        parts = [p for p in urlparse(lower if "://" in lower else f"https://x/{lower}").path.split("/") if p]
    except Exception:
        parts = []
    if parts and parts[0] in (
        "reel", "reels", "stories", "story", "watch", "share",
        "photo", "photos", "video", "videos", "permalink",
    ):
        return True
    return False


def is_external_or_redirect_url(url: str) -> bool:
    """True nếu l.php / lm.facebook / host ngoài Facebook."""
    if not url or not str(url).strip():
        return False
    lower = str(url).strip().lower()
    if any(m in lower for m in EXTERNAL_REDIRECT_MARKERS):
        return True
    try:
        text = lower if "://" in lower else f"https://{lower.lstrip('/')}"
        host = (urlparse(text).netloc or "").lower()
    except Exception:
        return False
    if not host:
        return False
    if host in ("facebook.com", "www.facebook.com", "m.facebook.com", "fb.com", "www.fb.com"):
        return False
    if host.endswith(".facebook.com") or host.endswith(".fb.com"):
        # l.facebook.com / lm.facebook.com đã bắt ở trên; subdomain khác cũng không phải profile
        return True
    return True


def author_name_looks_like_url(name: str) -> bool:
    """Tên hiển thị bản thân đã là URL/domain → không phải tên tác giả."""
    n = (name or "").strip()
    if not n or len(n) < 3:
        return False
    if " " in n and "://" not in n and not re.search(r"\.\w{2,6}(?:/|$)", n):
        # Tên người có khoảng trắng, không domain → OK
        return False
    return bool(_AUTHOR_NAME_URL_RE.search(n))


def is_valid_author_candidate_url(url: str) -> Tuple[bool, str, str]:
    """
    Kiểm tra URL có đủ điều kiện làm link tác giả trước khi mở tab.
    Chỉ chấp nhận facebook.com/<slug> root hoặc profile.php?id=<id>.
    Trả về (ok, quality, reason).
    """
    if not url or not str(url).strip():
        return (False, "weak", "empty_url")
    if is_external_or_redirect_url(url):
        return (False, "weak", "external_or_lphp")
    if is_media_facebook_url(url):
        return (False, "weak", "media_url")

    cleaned = clean_page_url(url)
    if not cleaned:
        return (False, "weak", "clean_failed")
    if is_external_or_redirect_url(cleaned):
        return (False, "weak", "external_after_clean")
    if is_media_facebook_url(cleaned):
        return (False, "weak", "media_after_clean")
    # l.php sau clean → https://www.facebook.com/l.php
    if re.search(r"facebook\.com/l\.php\b", cleaned, re.I) or cleaned.rstrip("/").endswith("/l.php"):
        return (False, "weak", "lphp_after_clean")

    page_key, quality = extract_page_identifier(cleaned)
    if not page_key:
        return (False, "weak", "no_page_key")
    if quality == "weak":
        return (False, "weak", "weak_identifier")
    if page_key.startswith("user:"):
        slug = page_key.split(":", 1)[-1]
        if slug in SYSTEM_SLUGS or slug in ("l.php", "ls.php"):
            return (False, "weak", f"system_slug:{page_key}")
    return (True, quality, "ok")


def author_verify_cache_key(raw_url: str) -> str:
    """
    Key cache = định danh gốc (page_key slug/id, hoặc raw href trước clean).
    Không bao giờ dùng cleaned l.php / user:l.php.
    """
    raw = (raw_url or "").strip()
    if not raw:
        return ""
    if is_external_or_redirect_url(raw):
        return ""
    ok, _q, _reason = is_valid_author_candidate_url(raw)
    if not ok:
        return ""
    cleaned = clean_page_url(raw) or raw
    page_key, quality = extract_page_identifier(cleaned)
    if page_key and quality != "weak" and "l.php" not in page_key.lower():
        return page_key
    # Fallback: raw href gốc (không phải cleaned l.php)
    if "l.php" in raw.lower():
        return ""
    return raw


def purge_invalid_author_cache_keys(cache: Optional[Dict[str, Any]]) -> int:
    """Xóa entry cache có key l.php / external khi session bắt đầu hoặc định kỳ."""
    if not cache:
        return 0
    removed = 0
    for k in list(cache.keys()):
        kl = str(k).lower()
        if "l.php" in kl or kl.startswith("user:l.php") or kl.endswith("/l.php"):
            del cache[k]
            removed += 1
            continue
        # Key dạng URL đầy đủ không hợp lệ
        if ("http://" in kl or "https://" in kl) and not is_valid_author_candidate_url(str(k))[0]:
            del cache[k]
            removed += 1
    return removed


def extract_page_identifier(url: str) -> Tuple[str, str]:
    """
    Trích xuất định danh chuẩn (page_key) và chất lượng (quality: 'high' | 'weak'):
    - profile.php?id=123456 -> ('id:123456', 'high')
    - /pages/<id> hoặc /pages/<name>/<id> -> ('id:<id>', 'high')
    - /username -> ('user:<username_lowercase>', 'high')
    - Link media / slug hệ thống -> ('', 'weak') hoặc url:… weak — không bao giờ user:reels
    """
    if is_media_facebook_url(url or ""):
        return ("", "weak")

    cleaned = clean_page_url(url)
    if not cleaned:
        return ("", "weak")

    if is_media_facebook_url(cleaned):
        return ("", "weak")

    # 1. profile.php?id=...
    match_id = re.search(r"profile\.php\?id=(\d+)", cleaned)
    if match_id:
        return (f"id:{match_id.group(1)}", "high")

    # 2. pages/<id>
    match_pages = re.search(r"/pages/(\d+)", cleaned)
    if match_pages:
        return (f"id:{match_pages.group(1)}", "high")

    # 2b. /people/Name/<id>
    match_people = re.search(r"/people/[^/]+/(\d{6,25})", cleaned, flags=re.IGNORECASE)
    if match_people:
        return (f"id:{match_people.group(1)}", "high")

    # 3. UID số thuần
    match_pure_id = re.search(r"facebook\.com/(\d{6,25})$", cleaned)
    if match_pure_id:
        return (f"id:{match_pure_id.group(1)}", "high")

    parsed = urlparse(cleaned)
    parts = [p for p in parsed.path.split("/") if p]

    if parts:
        slug = parts[0]
        slug_lower = slug.lower()
        # Tuyệt đối không trả user:reels / user:stories / user:watch …
        if slug_lower in SYSTEM_SLUGS:
            return ("", "weak")
        if re.match(r"^[a-zA-Z0-9._\-]+$", slug):
            return (f"user:{slug_lower}", "high")

    # Fallback cho link lạ hoặc không tách được
    return (f"url:{cleaned.replace('https://', '').replace('http://', '').lower()}", "weak")


def is_valid_page_entry(line: str) -> bool:
    """Kiểm tra một dòng có phải là định danh hoặc link Page hợp lệ không."""
    if not line:
        return False
    lower = line.lower().strip()

    # Loại bỏ các link tìm kiếm, nhóm, reel/reels/story, watch, login...
    if any(bad in lower for bad in [
        "/search", "/groups/", "/groups", "/reel/", "/reels/",
        "/stories/", "/story/", "/watch/",
        "/events/", "/marketplace/", "/login", "/messages/",
    ]):
        return False
    if is_media_facebook_url(lower):
        return False

    # UID số thuần
    if re.match(r"^\d{6,25}$", lower):
        return True

    # Link facebook / fb
    if "facebook.com" in lower or "fb.com" in lower:
        return True

    # Slug đơn giản nếu nhập dạng username (ít nhất 3 ký tự, không dấu cách)
    if re.match(r"^[a-zA-Z0-9._\-]{3,50}$", lower) and lower not in SYSTEM_SLUGS:
        return True

    return False


def parse_follower_count(text: Optional[str]) -> Tuple[Optional[int], str]:
    """
    Phân tích chuỗi số lượng người theo dõi thành số nguyên.
    Dùng regex alternation cho đơn vị (không dùng character class).
    Chỉ nhận nhãn followers / người theo dõi — không lấy lượt thích / likes.
    Ví dụ:
    - '12 N người theo dõi' -> 12000
    - '1.200 người theo dõi' -> 1200
    - '1,2 nghìn người theo dõi' -> 1200
    - '1,2 triệu người theo dõi' -> 1200000
    - '15K followers' -> 15000
    - '520 người theo dõi' -> 520
    """
    if not text:
        return (None, "")
    clean_text = str(text).strip()
    if not clean_text:
        return (None, "")

    lower = clean_text.lower()

    # Không lấy số lượt thích làm follower
    if re.search(r"(?:lượt\s*thích|\blikes?\b)", lower) and not re.search(
        r"(?:người\s*theo\s*dõi|\bfollowers?\b)", lower
    ):
        return (None, clean_text)

    # Đơn vị: nghìn|ngàn|N|k|triệu|tr|m — alternation, không phải [... ]
    match = re.search(
        r"([\d]+(?:[.,][\d]+)*)\s*"
        r"(nghìn|ngàn|triệu|n|k|tr|m)?\s*"
        r"(?:người\s*theo\s*dõi|followers?)\b",
        lower,
        flags=re.IGNORECASE,
    )
    if not match:
        return (None, clean_text)

    num_str = match.group(1).strip()
    unit_str = (match.group(2) or "").strip().lower()

    try:
        # 1.200 / 1.200.000 — dấu chấm phân cách hàng nghìn (VN/EU)
        if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", num_str):
            val = float(num_str.replace(".", ""))
        # 1,200,000 — dấu phẩy phân cách hàng nghìn (EN)
        elif re.fullmatch(r"\d{1,3}(?:,\d{3})+", num_str):
            val = float(num_str.replace(",", ""))
        # 1,2 — phẩy thập phân
        elif "," in num_str and "." not in num_str:
            val = float(num_str.replace(",", "."))
        # 1.2 kèm đơn vị — chấm thập phân
        elif re.fullmatch(r"\d+\.\d{1,2}", num_str) and unit_str:
            val = float(num_str)
        else:
            val = float(num_str.replace(",", "."))

        if unit_str in ("triệu", "m", "tr"):
            val *= 1_000_000
        elif unit_str in ("nghìn", "ngàn", "n", "k"):
            val *= 1_000

        return (int(val), clean_text)
    except (ValueError, TypeError):
        return (None, clean_text)


def parse_compact_count(text: Optional[str]) -> Optional[int]:
    """
    Parse số compact kiểu reaction/comment/share — tái dùng quy tắc đơn vị
    của parse_follower_count (“1,2K”, “12 N”, “1.200”) nhưng không cần nhãn followers.
    """
    if not text:
        return None
    clean_text = str(text).strip()
    if not clean_text:
        return None
    lower = clean_text.lower().replace("\u00a0", " ")

    match = re.search(
        r"([\d]+(?:[.,][\d]+)*)\s*(nghìn|ngàn|triệu|n|k|tr|m)?\b",
        lower,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    num_str = match.group(1).strip()
    unit_str = (match.group(2) or "").strip().lower()
    try:
        if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", num_str):
            val = float(num_str.replace(".", ""))
        elif re.fullmatch(r"\d{1,3}(?:,\d{3})+", num_str):
            val = float(num_str.replace(",", ""))
        elif "," in num_str and "." not in num_str:
            val = float(num_str.replace(",", "."))
        elif re.fullmatch(r"\d+\.\d{1,2}", num_str) and unit_str:
            val = float(num_str)
        else:
            val = float(num_str.replace(",", "."))

        if unit_str in ("triệu", "m", "tr"):
            val *= 1_000_000
        elif unit_str in ("nghìn", "ngàn", "n", "k"):
            val *= 1_000
        return int(val)
    except (ValueError, TypeError):
        return None


def normalize_post_key(url_or_key: str) -> str:
    """
    Chuẩn hóa post_key: /posts/, /permalink.php, /videos/, /reel/, /watch/
    của cùng một bài → một key ổn định (story_fbid / numeric id / path id).
    """
    raw = (url_or_key or "").strip()
    if not raw:
        return ""
    if raw.startswith("post:"):
        return raw.lower()

    lower = raw.lower()
    # Query ids
    for param in ("story_fbid", "fbid", "v", "video_id", "multi_permalinks"):
        m = re.search(rf"[?&]{param}=(\d{{6,30}})", lower)
        if m:
            return f"post:{m.group(1)}"

    # /posts/<id>, /permalink/<id>, /videos/<id>, /reel/<id>, /watch/<id>
    m = re.search(
        r"/(?:posts|permalink|videos?|reels?|watch|photo\.php)/(?:[^/?#]+/)?(\d{6,30})",
        lower,
    )
    if m:
        return f"post:{m.group(1)}"

    m = re.search(r"permalink\.php\?[^#]*?(?:story_fbid|fbid)=(\d{6,30})", lower)
    if m:
        return f"post:{m.group(1)}"

    m = re.search(r"story\.php\?[^#]*?story_fbid=(\d{6,30})", lower)
    if m:
        return f"post:{m.group(1)}"

    # Fallback: cleaned path without protocol/query noise
    cleaned = re.sub(r"^https?://(www\.|m\.)?facebook\.com", "", lower)
    cleaned = cleaned.split("?")[0].split("#")[0].rstrip("/")
    if cleaned:
        return f"url:{cleaned}"
    return f"url:{lower[:200]}"


def parse_page_file_content(
    content: str,
    filter_existing: bool = False,
    owner_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Phân tích nội dung file import (.txt, .csv) hoặc danh sách link dán trực tiếp.
    Khử trùng bằng page_key chuẩn hóa.
    Tùy chọn đối chiếu DB để thống kê số Page đã tồn tại trước đó.
    """
    if not content:
        return {
            "pages": [],
            "total_lines": 0,
            "valid_count": 0,
            "dedup_count": 0,
            "invalid_count": 0,
            "already_existing_count": 0,
        }

    lines = [line.strip() for line in content.splitlines()]
    non_empty = [l for l in lines if l and not l.startswith("#")]
    total_lines = len(non_empty)

    raw_candidates: List[str] = []

    # Kiểm tra xem có phải định dạng CSV có header không
    is_csv = False
    if non_empty:
        header_candidate = non_empty[0].lower()
        if "," in header_candidate and any(col in header_candidate for col in ["page_url", "link", "url", "fanpage"]):
            is_csv = True

    if is_csv:
        reader = csv.DictReader(io.StringIO("\n".join(non_empty)))
        for row in reader:
            val = (
                row.get("page_url")
                or row.get("link")
                or row.get("url")
                or row.get("fanpage")
                or ""
            )
            if val and val.strip():
                raw_candidates.append(val.strip())
    else:
        for line in non_empty:
            # Tách dòng nếu có phẩy hoặc tab
            parts = re.split(r"[\t,]", line)
            if parts and parts[0].strip():
                raw_candidates.append(parts[0].strip())

    seen_keys: Set[str] = set()
    pages: List[Dict[str, Any]] = []
    dedup_count = 0
    invalid_count = 0

    for raw in raw_candidates:
        if not is_valid_page_entry(raw):
            invalid_count += 1
            continue

        cleaned_url = clean_page_url(raw)
        page_key, quality = extract_page_identifier(cleaned_url)

        if not page_key:
            invalid_count += 1
            continue

        if page_key in seen_keys:
            dedup_count += 1
            continue

        seen_keys.add(page_key)
        pages.append({
            "page_key": page_key,
            "page_url": cleaned_url,
            "raw_input": raw,
            "identifier_quality": quality,
        })

    valid_count = len(pages)
    already_existing_count = 0

    if filter_existing and owner_key and pages:
        try:
            from core.database.connection import db
            # Lấy danh sách page_key đã có trong kho scanned_pages của owner
            keys = [p["page_key"] for p in pages]
            placeholders = ",".join(["%s"] * len(keys))
            query = f"SELECT page_key FROM scanned_pages WHERE owner_key = %s AND page_key IN ({placeholders})"
            existing_rows = db.fetch_all(query, (owner_key, *keys))
            existing_set = {r["page_key"] for r in (existing_rows or [])}
            already_existing_count = len(existing_set)
            for p in pages:
                p["is_existing"] = p["page_key"] in existing_set
        except Exception as exc:
            logger.warning(f"[PageSource] Lỗi kiểm tra trùng DB: {exc}")

    return {
        "pages": pages,
        "total_lines": total_lines,
        "valid_count": valid_count,
        "dedup_count": dedup_count,
        "invalid_count": invalid_count,
        "already_existing_count": already_existing_count,
    }


def get_sample_template() -> str:
    """Tạo nội dung mẫu cho file danh sách Fanpage."""
    return (
        "# DANH SÁCH FANPAGE FACEBOOK MẪU CHO MODULE 11 (PAGE SCANNER)\n"
        "# Mỗi dòng có thể là link Page, link profile.php, hoặc UID số của Page\n"
        "# Các liên kết con như /about, /photos hay tham số theo dõi (?ref=...) sẽ được tự động lọc bỏ\n"
        "https://www.facebook.com/innisfreevietnam\n"
        "https://www.facebook.com/biluxuryvn\n"
        "https://www.facebook.com/profile.php?id=1098642819\n"
        "https://www.facebook.com/pages/Gia-Dung-Thong-Minh/1098642820\n"
        "1098642821\n"
    )


# =============================================================================
# HASHTAG SOURCE EXTENSIONS (Section 10 of Detail Plan)
# =============================================================================


def normalize_hashtag(raw_tag: str) -> str:
    """
    Chuẩn hoá hashtag đầu vào (Section 10.2):
    - Bỏ tiền tố #, dấu phẩy, dấu chấm phẩy, khoảng trắng
    - Chuyển thành chữ thường để làm khóa gộp
    - Không tự ý gộp biến thể có dấu/không dấu (người dùng nhập gì quét nấy)
    """
    if not raw_tag:
        return ""
    tag = str(raw_tag).strip()
    tag = tag.strip(" \t\r\n,#;:.!?'\"()[]{}<>")
    tag = re.sub(r"\s+", "", tag)
    tag = re.sub(r"^[#]+", "", tag)
    return tag.lower()


def parse_hashtags_input(raw_input: Any) -> List[str]:
    """
    Nhận chuỗi hoặc danh sách hashtag, chuẩn hoá và loại bỏ trùng lặp.
    Hỗ trợ phân cách bằng dấu phẩy, khoảng trắng, chấm phẩy hoặc xuống dòng.
    Đặc biệt xử lý triệt để trường hợp truyền danh sách các chuỗi có chứa dấu phẩy (vd: ["#thoitrang, #mypham"]).
    """
    if not raw_input:
        return []

    # Thu thập tất cả các mẩu chuỗi, hỗ trợ lồng list/tuple/set hoặc chuỗi đơn
    raw_pieces: List[str] = []
    if isinstance(raw_input, (list, tuple, set)):
        for x in raw_input:
            if x is not None:
                raw_pieces.append(str(x))
    else:
        raw_pieces.append(str(raw_input))

    tokens: List[str] = []
    for piece in raw_pieces:
        # Luôn tách nhỏ từng mẩu theo dấu phẩy, chấm phẩy, khoảng trắng hoặc xuống dòng
        parts = re.split(r"[,;\s\n\r]+", piece)
        tokens.extend(parts)

    result: List[str] = []
    seen: Set[str] = set()
    for tok in tokens:
        norm = normalize_hashtag(tok)
        if norm and norm not in seen:
            seen.add(norm)
            result.append(norm)
    return result


def classify_post_author(
    author_name: str,
    author_url: str,
    author_subtitle: str = "",
    post_context: str = "",
) -> Tuple[str, str]:
    """
    Phân loại tác giả bài viết: PAGE / PROFILE / GROUP (Section 10.4 — legacy).
    CHỈ DẪN 2.5: không dùng làm cổng quyết định hashtag nữa; giữ để tương thích test/cũ.
    """
    auth_url_lower = (author_url or "").lower()
    post_ctx_lower = (post_context or "").lower()
    subtitle_lower = (author_subtitle or "").lower()

    if "/groups/" in auth_url_lower or "trong nhóm" in post_ctx_lower or "in group" in post_ctx_lower:
        return ("GROUP", "Bài viết đăng trong Group hoặc tác giả là Group")

    if any(k in subtitle_lower for k in ["bạn bè", "bạn chung", "mutual friends", "thêm bạn bè", "add friend"]):
        return ("PROFILE", "Tác giả mang dấu hiệu Profile cá nhân")

    if any(k in subtitle_lower for k in [
        "trang", "page", "người theo dõi", "followers", "thích", "likes",
        "doanh nghiệp", "công ty", "bán lẻ", "dịch vụ", "thương mại", "sáng tạo"
    ]):
        return ("PAGE", "Tác giả mang dấu hiệu Fanpage (hạng mục / follower / thích)")

    cleaned = clean_page_url(author_url)
    page_key, _ = extract_page_identifier(cleaned)
    if not page_key:
        return ("PROFILE", "Không trích xuất được page_key hợp lệ")

    return ("PAGE", "Đạt chuẩn liên kết trang Fanpage ứng viên")


def classify_header_action(header_action: str) -> Tuple[str, str]:
    """
    Cổng header_action (nới):
    - Join / Tham gia → GROUP (loại ngay)
    - Follow / Theo dõi / Following / Đang theo dõi → PAGE_CANDIDATE
    - Trống hoặc không nhận diện → PAGE_CANDIDATE (để tab xác minh quyết định)
    """
    raw = (header_action or "").strip().lower()
    raw = re.sub(r"\s+", " ", raw)

    if not raw:
        return ("PAGE_CANDIDATE", "Không có header action — chuyển tab xác minh")

    join_markers = ("join", "tham gia")
    if any(m == raw or m in raw.split() or raw.startswith(m) for m in join_markers):
        return ("GROUP", f"Header action là Join/Tham gia: {header_action!r}")

    follow_markers = (
        "follow",
        "following",
        "theo dõi",
        "đang theo dõi",
        "dang theo doi",
    )
    for m in follow_markers:
        if raw == m or raw.startswith(m) or m in raw:
            return ("PAGE_CANDIDATE", f"Header action Follow/Theo dõi: {header_action!r}")

    return ("PAGE_CANDIDATE", f"Header action không rõ ({header_action!r}) — chuyển tab xác minh")


def normalize_page_candidate_key(page_name: str, author_url: str) -> str:
    """
    Khóa khử trùng tầng ứng viên (chỉ dẫn 2.5 bước 3):
    tên Page viết thường, gọn khoảng trắng + link tác giả đã chuẩn hoá.
    """
    name = re.sub(r"\s+", " ", (page_name or "").strip().lower())
    cleaned = clean_page_url(author_url) or (author_url or "").strip().lower()
    return f"{name}|{cleaned}"


def strip_accents_and_spaces(text: str) -> str:
    """Loại bỏ dấu tiếng Việt và khoảng trắng để so khớp hashtag với tên Page."""
    if not text:
        return ""
    import unicodedata
    nfkd = unicodedata.normalize('NFKD', text)
    unaccented = "".join([c for c in nfkd if not unicodedata.combining(c)])
    unaccented = unaccented.replace('đ', 'd').replace('Đ', 'D')
    return re.sub(r"[\s\-_]+", "", unaccented.lower())


def calculate_page_relevance_score(
    hashtag_post_count: int,
    matched_hashtags: List[str],
    page_name: str = "",
    category: str = "",
    context_keywords: Optional[List[str]] = None,
    min_posts: int = 2,
    latest_post_at: str = "",
) -> Tuple[int, str, List[str]]:
    """
    Chấm điểm liên quan (Relevance Score) của Page theo Section 10.5:
    Thang điểm 100:
    - Tần suất: +10/bài khớp, tối đa +40.
    - Có bài ở >= 2 hashtag khác nhau: +15.
    - Tên Page chứa hashtag hoặc từ khóa ngữ cảnh: +20.
    - Hạng mục / giới thiệu chứa từ khóa ngữ cảnh: +15.
    - Bài khớp gần nhất trong thời gian gần: +10.

    Ngưỡng phân loại:
    - Điều kiện cứng: hashtag_post_count >= min_posts (mặc định 2).
      (Ngoại lệ: nếu tên Page chứa hashtag hoặc từ khóa ngữ cảnh thì được tính dù chỉ có 1 bài).
    - Score >= 40: RELEVANT (Liên quan)
    - 20 <= Score < 40: REVIEW (Cần xem lại)
    - Score < 20 hoặc không qua điều kiện cứng: EXCLUDED (Bị loại)
    """
    score = 0
    reasons: List[str] = []
    page_name_lower = (page_name or "").lower()
    page_name_normalized = strip_accents_and_spaces(page_name)
    cat_lower = (category or "").lower()
    cat_normalized = strip_accents_and_spaces(category)
    context_kws = [k.strip().lower() for k in (context_keywords or []) if k.strip()]

    # 1. Điểm tần suất bài viết
    freq_pts = min(40, hashtag_post_count * 10)
    score += freq_pts
    if freq_pts > 0:
        reasons.append(f"+{freq_pts}đ: {hashtag_post_count} bài viết khớp hashtag")

    # 2. Xuất hiện ở nhiều hashtag khác nhau
    if len(set(matched_hashtags)) >= 2:
        score += 15
        reasons.append("+15đ: Xuất hiện ở >= 2 hashtag khác nhau")

    # 3. Tên Page chứa hashtag hoặc từ khóa ngữ cảnh
    name_matched = False
    for tag in matched_hashtags:
        clean_tag = tag.lower().lstrip("#")
        clean_tag_norm = strip_accents_and_spaces(clean_tag)
        if clean_tag in page_name_lower or (clean_tag_norm and clean_tag_norm in page_name_normalized):
            name_matched = True
            break
    if not name_matched:
        for kw in context_kws:
            kw_norm = strip_accents_and_spaces(kw)
            if kw in page_name_lower or (kw_norm and kw_norm in page_name_normalized):
                name_matched = True
                break

    if name_matched:
        score += 20
        reasons.append("+20đ: Tên Page chứa hashtag hoặc từ khóa ngữ cảnh")

    # 4. Hạng mục / giới thiệu chứa từ khóa ngữ cảnh
    cat_matched = False
    for kw in context_kws:
        if kw in cat_lower:
            cat_matched = True
            break
    if cat_matched:
        score += 15
        reasons.append("+15đ: Ngành nghề/mô tả chứa từ khóa ngữ cảnh")

    # 5. Bài khớp gần nhất
    recent_markers = ["giờ", "phút", "hôm qua", "ngày", "vừa xong", "hour", "min", "yesterday", "day"]
    if any(m in (latest_post_at or "").lower() for m in recent_markers) or not latest_post_at:
        score += 10
        reasons.append("+10đ: Có bài đăng hoạt động gần đây")

    score = min(100, score)

    # Điều kiện cứng (Hard gate)
    passed_hard_gate = False
    if hashtag_post_count >= min_posts:
        passed_hard_gate = True
    elif name_matched and hashtag_post_count >= 1:
        passed_hard_gate = True
        reasons.append(f"Miễn điều kiện min_posts ({min_posts}) do tên Page khớp ngữ cảnh")
    else:
        reasons.append(f"Không đạt điều kiện cứng (có {hashtag_post_count}/{min_posts} bài)")

    if not passed_hard_gate or score < 20:
        status = "EXCLUDED"
    elif score >= 40:
        status = "RELEVANT"
    else:
        status = "REVIEW"

    return (score, status, reasons)

