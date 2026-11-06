"""
=============================================================================
MODULE 07 BACKEND: NGUỒN NHÓM FACEBOOK (Group Source Service)
Kế thừa & chuẩn hóa nghiệp vụ từ FaceBook_Post_Group.py:
1. Đọc & chuẩn hóa link nhóm từ File link (.txt, .csv)
   - Tách query parameters '?' (line.split('?')[0])
   - Khử trùng lặp (dedup)
   - Lọc bỏ link hỏng/rác
   - Kiểm tra nhóm đã đăng trong lịch sử cloud (cloud_group_logs)
2. Tìm kiếm nhóm theo từ khóa (Keyword Group Search)
   - Tương thích cơ chế quét URL: https://www.facebook.com/search/groups/?q={search_term}
3. Cung cấp file mẫu link nhóm (Template)
=============================================================================
"""
from __future__ import annotations

import logging
import re
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)


def clean_group_url(raw_url: str) -> str:
    """
    Chuẩn hóa URL nhóm Facebook (Tương tự logic line.split('?')[0] trong FaceBook_Post_Group.py).
    Loại bỏ giao thức http://, https://, query string ?ref=..., và dấu gạch chéo cuối.
    """
    if not raw_url:
        return ""
    text = raw_url.strip()
    # Loại bỏ query string đằng sau dấu ?
    text = text.split("?")[0].strip()
    # Loại bỏ hash #
    text = text.split("#")[0].strip()
    # Loại bỏ tiền tố giao thức
    text = re.sub(r"^https?://", "", text, flags=re.IGNORECASE)
    # Loại bỏ m.facebook.com, web.facebook.com thành facebook.com
    text = re.sub(r"^(m|web|touch|mbasic)\.facebook\.com", "facebook.com", text, flags=re.IGNORECASE)
    # Nếu là dãy số thuần UID
    if re.match(r"^\d{6,}$", text):
        return f"facebook.com/groups/{text}"
    # Nếu là đường dẫn nhóm thiếu domain
    if text.startswith("groups/"):
        return f"facebook.com/{text.rstrip('/')}"
    if not text.startswith("facebook.com/"):
        if "facebook.com" in text:
            # Lấy từ facebook.com trở đi
            idx = text.find("facebook.com")
            text = text[idx:]
        else:
            text = f"facebook.com/groups/{text}"
    return text.rstrip("/")


def extract_group_identifier(url: str) -> str:
    """
    Trích xuất UID hoặc tên định danh nhóm từ URL.
    VD: 'facebook.com/groups/vieclamonline2024' -> 'vieclamonline2024'
    """
    cleaned = clean_group_url(url)
    match = re.search(r"groups/([^/?#]+)", cleaned, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()
    # Fallback nếu là UID số
    digits = re.findall(r"\d+", cleaned)
    if digits:
        return digits[-1]
    return cleaned.replace("/", "_")


def is_valid_group_entry(line: str) -> bool:
    """Kiểm tra 1 dòng có phải là link nhóm hoặc UID nhóm hợp lệ."""
    if not line:
        return False
    lower = line.lower().strip()
    if any(bad in lower for bad in ["/groups/search", "/groups/feed", "/groups/discover", "/groups/create"]):
        return False
    if "facebook.com/groups/" in lower or "fb.com/groups/" in lower:
        return True
    if "facebook.com" in lower and ("/groups" in lower or "/permalink" in lower):
        return True
    # Dãy số UID nhóm
    if re.match(r"^\d{6,25}$", line.strip()):
        return True
    # Đường dẫn rút gọn groups/abc
    if lower.startswith("groups/") and len(lower) > 8:
        return True
    return False


def get_posted_group_keys(owner: str | None = None) -> Set[str]:
    """
    Lấy danh sách các group_key đã đăng thành công trong lịch sử từ DB (tránh spam trùng).
    Tương tự history_file trong FaceBook_Post_Group.py.
    """
    posted: Set[str] = set()
    try:
        from core.database.connection import db

        rows = db.fetch_all(
            """SELECT DISTINCT log.group_key, log.group_url
               FROM cloud_group_logs log
               WHERE log.owner_key = ?
                 AND log.status IN ('SUCCESS', 'PENDING_APPROVAL')""",
            (owner or "",),
        )
        for r in rows or []:
            if r.get("group_key"):
                posted.add(str(r["group_key"]).strip().lower())
            if r.get("group_url"):
                cleaned = clean_group_url(str(r["group_url"]))
                posted.add(cleaned.lower())
    except Exception as exc:
        # Nếu bảng chưa khởi tạo hoặc lỗi kết nối, bỏ qua không làm crash
        logger.warning("Cannot read posted-group history", exc_info=True)
    return posted


def get_cached_scanned_groups(
    identifiers_or_urls: List[str], owner: str | None = None
) -> Dict[str, Dict[str, Any]]:
    """Đọc dữ liệu nhóm thật đã từng quét từ CSDL scanned_groups."""
    cached: Dict[str, Dict[str, Any]] = {}
    if not identifiers_or_urls:
        return cached
    try:
        from core.database.connection import db

        clean_ids = [str(x).strip().lower() for x in identifiers_or_urls if str(x).strip()]
        if not clean_ids:
            return cached
        placeholders = ",".join(["?"] * len(clean_ids))
        query = f"""
            SELECT group_id, group_url, group_name, privacy, members_label, members_count
            FROM scanned_groups
            WHERE LOWER(group_id) IN ({placeholders})
               OR LOWER(group_url) IN ({placeholders})
        """
        rows = db.fetch_all(query, tuple(clean_ids) + tuple(clean_ids)) or []
        for r in rows:
            gid = str(r.get("group_id") or "").strip().lower()
            gurl = str(r.get("group_url") or "").strip().lower()
            cleaned_u = clean_group_url(gurl).lower() if gurl else ""
            gdata = {
                "name": r.get("group_name") or "",
                "privacy": r.get("privacy") or "public",
                "members": r.get("members_label") or "Công khai",
                "members_count": r.get("members_count"),
                "frequency": "Hoạt động",
            }
            if gid:
                cached[gid] = gdata
            if gurl:
                cached[gurl] = gdata
            if cleaned_u:
                cached[cleaned_u] = gdata
    except Exception as e:
        logger.warning(f"Lỗi khi đọc cache scanned_groups: {e}")
    return cached


def scrape_real_groups_via_browser(
    groups_to_scrape: List[Dict[str, Any]],
    account_uid: Optional[str] = None,
    owner: str | None = None,
    max_scrape: int = 30,
) -> Dict[str, Dict[str, Any]]:
    """
    Quét trực tiếp từng nhóm Facebook bằng trình duyệt thật để lấy tên thật,
    quyền riêng tư, số lượng thành viên, tần suất hoạt động và trạng thái tham gia.
    Lưu kết quả vào CSDL `scanned_groups` để tái sử dụng ngay lập tức cho các lần sau.
    """
    scraped_map: Dict[str, Dict[str, Any]] = {}
    if not groups_to_scrape:
        return scraped_map

    account = get_scraping_account(account_uid, owner)
    if not account:
        logger.info("Không có tài khoản phù hợp để quét nhóm trực tiếp.")
        return scraped_map

    target_uid = str(account.get("uid") or "").strip()
    if not target_uid:
        return scraped_map

    owner_val = account.get("user_id") or owner or "admin"
    cookie_str = account.get("cookie") or ""
    proxy = account.get("proxy")

    driver = None
    created_new_driver = False
    lock = None
    acquired_lock = False

    try:
        from core.browser import get_active_drivers, get_profile_lock, load_cookies, open_browser

        active_drivers = get_active_drivers(target_uid, owner=owner_val)
        if active_drivers:
            driver = active_drivers[0]
            logger.info(f"[{target_uid}] Tận dụng trình duyệt Chrome đang mở để quét nhóm từ file.")
        else:
            lock = get_profile_lock(target_uid, owner=owner_val)
            acquired_lock = lock.acquire(timeout=8)
            if not acquired_lock:
                logger.warning(f"[{target_uid}] Profile đang bị khóa bởi tiến trình khác.")
                return scraped_map

            logger.info(f"[{target_uid}] Khởi động Chrome để quét thông tin thật cho {len(groups_to_scrape)} nhóm...")
            driver = open_browser(
                uid=target_uid,
                owner=owner_val,
                proxy=proxy,
                scope="group_scraper",
                headless=True,
                verify_egress=False,
                allow_direct_fallback=True,
            )
            created_new_driver = True

            if cookie_str:
                load_cookies(driver, cookie_str)

        js_extract_script = """
        const res = {};
        let name = '';
        const title = document.title || '';
        if (title && !/error|lỗi|content not found|không tìm thấy|log in|đăng nhập/i.test(title)) {
          name = title.replace(/^\\(\\d+\\)\\s*/, '').replace(/\\s*\\|\\s*Facebook.*$/i, '').trim();
        }
        const h1Elements = Array.from(document.querySelectorAll('h1'));
        for (const el of h1Elements) {
          const t = (el.innerText || '').trim();
          if (t && !/notifications|thông báo/i.test(t)) {
            name = t.split('\\n')[0].trim();
            break;
          }
        }
        res.name = name;
        const mainArea = document.querySelector('[role="main"]') || document.body;
        const text = mainArea ? mainArea.innerText.slice(0, 4000) : '';

        res.is_private = /riêng tư|private/i.test(text);
        res.is_public = /công khai|public/i.test(text);

        const memMatch = text.match(/([\\d.,]+\\s*[KMBkmb]?)\\s*(?:members?|thành viên)/i);
        res.members = memMatch ? memMatch[1].trim() : '';

        const freqMatch = text.match(/([\\d.,]+\\+?\\s*(bài|bài viết|posts)?\\s*(\\/|\\s*mỗi\\s*|\\s*trên\\s*|\\s*a\\s*)(ngày|day|tháng|month))/i) ||
                          text.match(/([\\d.,]+\\+?\\s*(bài viết mới|bài mới|new posts)\\s*(hôm nay|today))/i);
        res.frequency = freqMatch ? freqMatch[0].trim() : '';

        res.is_joined = /\\b(joined|đã tham gia)\\b/i.test(text);
        res.is_not_joined = /\\b(join group|join|tham gia nhóm|tham gia)\\b/i.test(text);
        return res;
        """

        for item in groups_to_scrape[:max_scrape]:
            url = item.get("url") or ""
            uid = item.get("uid") or ""
            if not url.startswith("http"):
                full_url = f"https://www.{url}" if not url.startswith("www.") else f"https://{url}"
            else:
                full_url = url

            try:
                driver.get(full_url)
                time.sleep(2)
                data = driver.execute_script(js_extract_script) or {}
                scraped_name = (data.get("name") or "").strip()
                forbidden = {"facebook", "error", "lỗi", "log in", "đăng nhập", "login"}
                if scraped_name and scraped_name.lower() not in forbidden:
                    privacy = "private" if data.get("is_private") else ("public" if data.get("is_public") else "public")
                    members_label = data.get("members") or ""
                    if members_label and not any(members_label.endswith(x) for x in ["K", "M", "B", "k", "m", "b"]):
                        members_label = f"{members_label} thành viên"
                    
                    status = "joined" if data.get("is_joined") else ("not_joined" if data.get("is_not_joined") else "unknown")
                    frequency = data.get("frequency") or "Hoạt động"

                    entry_result = {
                        "name": scraped_name,
                        "privacy": privacy,
                        "members": members_label or "Công khai",
                        "frequency": frequency,
                        "membership_status": status,
                    }
                    if uid:
                        scraped_map[uid.lower()] = entry_result
                    if url:
                        scraped_map[clean_group_url(url).lower()] = entry_result

                    # Lưu vào CSDL scanned_groups để các lần sau không cần quét lại
                    try:
                        from modules.module_10_group_scan.models import upsert_scanned_group
                        upsert_scanned_group(
                            owner=str(owner_val),
                            keyword="file_import",
                            group={
                                "group_id": uid,
                                "url": full_url,
                                "name": scraped_name,
                                "privacy": privacy,
                                "members_label": members_label or "—",
                            },
                            source_uid=target_uid,
                        )
                    except Exception as save_err:
                        logger.debug(f"Không thể lưu nhóm {uid} vào DB scanned_groups: {save_err}")
            except Exception as scrape_one_err:
                logger.warning(f"Lỗi khi quét nhóm {url}: {scrape_one_err}")

    except Exception as e:
        logger.error(f"Lỗi khi quét nhóm Facebook thật qua trình duyệt: {e}")
    finally:
        if created_new_driver and driver:
            try:
                driver.quit()
            except Exception:
                pass
        if acquired_lock and lock:
            try:
                lock.release()
            except Exception:
                pass

    return scraped_map


def parse_group_file_content(
    content: str,
    filter_posted: bool = False,
    owner: str | None = None,
    account_uid: str | None = None,
) -> Dict[str, Any]:
    """
    Phân tích nội dung file link nhóm (.txt, .csv) và quét thông tin nhóm thật:
    - Tách từng dòng, loại bỏ rác/lỗi, khử trùng lặp
    - Tra cứu dữ liệu nhóm thật từ CSDL đã quét (scanned_groups)
    - Quét trực tiếp qua trình duyệt Facebook bằng tài khoản nick để lấy tên thật, số TV, loại nhóm
    - Tùy chọn lọc nhóm đã đăng trong lịch sử (filter_posted)
    """
    if not content:
        return {
            "groups": [],
            "total_lines": 0,
            "valid_count": 0,
            "dedup_count": 0,
            "invalid_count": 0,
            "already_posted_count": 0,
        }

    raw_lines = [line.strip() for line in content.splitlines()]
    non_empty = [l for l in raw_lines if l and not l.startswith("#")]
    total_lines = len(non_empty)

    # Làm sạch từng dòng
    cleaned_entries: List[str] = []
    for l in non_empty:
        # Bỏ query param đằng sau dấu ? giống FaceBook_Post_Group.py:903
        cleaned = l.split("?")[0].strip()
        if cleaned:
            cleaned_entries.append(cleaned)

    # Khử trùng lặp
    unique_entries: List[str] = []
    seen: Set[str] = set()
    dedup_count = 0

    for item in cleaned_entries:
        item_lower = item.lower()
        if item_lower in seen:
            dedup_count += 1
        else:
            seen.add(item_lower)
            unique_entries.append(item)

    # Lọc hợp lệ / không hợp lệ
    valid_entries: List[str] = []
    invalid_count = 0
    for item in unique_entries:
        if is_valid_group_entry(item):
            valid_entries.append(item)
        else:
            invalid_count += 1

    # Kiểm tra lịch sử đã đăng nếu yêu cầu
    posted_set = get_posted_group_keys(owner) if filter_posted else set()
    already_posted_count = 0

    # 1. Thu thập danh sách metadata của từng nhóm
    items_meta: List[Dict[str, Any]] = []
    query_identifiers: List[str] = []
    for raw_group in valid_entries:
        url = clean_group_url(raw_group)
        identifier = extract_group_identifier(url)
        items_meta.append({"raw": raw_group, "url": url, "uid": identifier})
        if identifier:
            query_identifiers.append(identifier)
        if url:
            query_identifiers.append(url)

    # 2. Đọc từ CSDL scanned_groups đã có thông tin thật từ trước
    cached_groups = get_cached_scanned_groups(query_identifiers, owner)

    # 3. Tìm các nhóm chưa có thông tin thật để quét qua trình duyệt
    uncached_groups = []
    for it in items_meta:
        uid_key = it["uid"].lower() if it["uid"] else ""
        url_key = it["url"].lower() if it["url"] else ""
        if uid_key not in cached_groups and url_key not in cached_groups:
            uncached_groups.append(it)

    # 4. Nếu có nhóm chưa có thông tin thật và có tài khoản được chỉ định, thực hiện quét thật qua trình duyệt
    scraped_groups = {}
    if uncached_groups and account_uid:
        scraped_groups = scrape_real_groups_via_browser(
            uncached_groups, account_uid=account_uid, owner=owner
        )

    # 5. Tổng hợp dữ liệu thật vào kết quả trả về
    parsed_groups: List[Dict[str, Any]] = []
    for idx, it in enumerate(items_meta, 1):
        url = it["url"]
        identifier = it["uid"]
        key = f"group_{identifier}"

        is_already_posted = (key.lower() in posted_set) or (url.lower() in posted_set)
        if is_already_posted:
            already_posted_count += 1

        if filter_posted and is_already_posted:
            continue

        uid_key = identifier.lower() if identifier else ""
        url_key = url.lower() if url else ""

        real_data = (
            scraped_groups.get(uid_key)
            or scraped_groups.get(url_key)
            or cached_groups.get(uid_key)
            or cached_groups.get(url_key)
        )

        if real_data and real_data.get("name"):
            group_name = real_data["name"]
            privacy = real_data.get("privacy") or "public"
            members = real_data.get("members") or "Công khai"
            frequency = real_data.get("frequency") or "Hoạt động"
            membership_status = real_data.get("membership_status") or "unknown"
        else:
            # Fallback tên thân thiện nếu chưa thể quét
            if identifier.isdigit():
                group_name = f"Nhóm Facebook [ID: {identifier}]"
            else:
                pretty = identifier.replace("_", " ").replace("-", " ").strip().title()
                if pretty.lower().startswith(("hội", "nhóm", "cộng đồng", "diễn đàn", "chợ")):
                    group_name = pretty
                else:
                    group_name = f"Hội {pretty}"
            privacy = "public"
            members = "Công khai"
            frequency = "Hoạt động"
            membership_status = "unknown"

        parsed_groups.append({
            "id": f"{idx:02d}",
            "key": key,
            "name": group_name,
            "url": url,
            "uid": identifier,
            "frequency": frequency,
            "members": members,
            "privacy": privacy,
            "membership_status": membership_status,
            "already_posted": is_already_posted,
        })

    return {
        "groups": parsed_groups,
        "total_lines": total_lines,
        "valid_count": len(parsed_groups),
        "dedup_count": dedup_count,
        "invalid_count": invalid_count,
        "already_posted_count": already_posted_count,
    }


import unicodedata


def remove_accents(input_str: str) -> str:
    """Loại bỏ dấu tiếng Việt để đối chiếu từ khóa chính xác."""
    if not input_str:
        return ""
    nfkd = unicodedata.normalize("NFKD", input_str)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower().replace("đ", "d").replace("Đ", "d")


def normalize_search_text(value: str) -> str:
    """Chuẩn hóa tên/URL để đối chiếu từ khóa không dấu và theo ranh giới từ."""
    decoded = urllib.parse.unquote(str(value or ""))
    normalized = remove_accents(decoded)
    return re.sub(r"[^a-z0-9]+", " ", normalized).strip()


def clean_scraped_group_name(value: str) -> str:
    """Loại các nhãn trợ năng Facebook bị ghép vào tên nhóm trong DOM."""
    name = re.sub(r"\s+", " ", str(value or "").replace("\u00a0", " ")).strip()
    wrapped = re.search(
        r"(?:unread\s*)?welcome\s+to\s+(.+?)(?:\s+now\s+you\s+can\s+post\b|$)",
        name,
        flags=re.IGNORECASE,
    )
    if wrapped:
        name = wrapped.group(1).strip()
    name = re.sub(r"^unread\s*", "", name, flags=re.IGNORECASE).strip()
    name = re.sub(
        r"\s+now\s+you\s+can\s+post,?\s+connect\s+with\s+other\s+members\s+and\s+more\..*$",
        "",
        name,
        flags=re.IGNORECASE,
    ).strip()
    return name


def is_group_relevant(keyword: str, name: str, url: str = "") -> bool:
    """Chỉ nhận nhóm có cụm từ khóa hoặc đầy đủ các token trong tên/URL."""
    normalized_keyword = normalize_search_text(keyword)
    if not normalized_keyword:
        return False

    normalized_name = normalize_search_text(name)
    normalized_url = normalize_search_text(url)
    haystack = f"{normalized_name} {normalized_url}".strip()
    if normalized_keyword in haystack:
        return True

    compact_keyword = normalized_keyword.replace(" ", "")
    compact_haystack = haystack.replace(" ", "")
    if len(compact_keyword) >= 3 and compact_keyword in compact_haystack:
        return True

    tokens = [token for token in normalized_keyword.split() if len(token) >= 2]
    return bool(tokens) and all(
        re.search(rf"\b{re.escape(token)}\b", haystack) for token in tokens
    )


def get_posted_group_records(owner: str | None = None) -> List[Dict[str, Any]]:
    """
    Lấy danh sách chi tiết các nhóm Facebook đã từng chạy thành công từ cloud_group_logs.
    """
    records: List[Dict[str, Any]] = []
    try:
        from core.database.connection import db

        rows = db.fetch_all(
            """SELECT * FROM (
                   SELECT DISTINCT ON (log.group_key)
                        log.group_key, log.group_url, log.group_name,
                        log.status, log.finished_at
                    FROM cloud_group_logs log
                    WHERE log.owner_key = ?
                      AND log.status IN ('SUCCESS', 'PENDING_APPROVAL')
                    ORDER BY log.group_key, log.finished_at DESC
               ) latest
               ORDER BY finished_at DESC LIMIT 100""",
            (owner or "",),
        ) or []
        for idx, r in enumerate(rows, 1):
            url = clean_group_url(str(r.get("group_url") or ""))
            uid = extract_group_identifier(url)
            mem_cnt = r.get("member_count")
            records.append({
                "id": f"{idx:02d}",
                "key": r.get("group_key") or f"group_{uid}",
                "name": r.get("group_name") or f"Nhóm Facebook [ID: {uid}]",
                "url": url,
                "uid": uid,
                "frequency": "Đã từng đăng",
                "members": f"{mem_cnt}K" if mem_cnt else "Công khai",
                "privacy": "public",
                "already_posted": True,
            })
    except Exception:
        logger.warning("Cannot read detailed group history", exc_info=True)
    return records


# =============================================================================
# DANH MỤC NHÓM FACEBOOK THỰC TẾ (REAL FACEBOOK GROUPS REPOSITORY)
# Danh sách nhóm Facebook thật, có link group hoạt động thực tế trên Facebook
# =============================================================================


def get_scraping_account(
    account_uid: Optional[str] = None, owner: str | None = None
) -> Optional[Dict[str, Any]]:
    """
    Lấy thông tin tài khoản dùng để cào dữ liệu nhóm thật:
    - Nếu có account_uid truyền vào, ưu tiên lấy tài khoản đó.
    - Nếu không có, tự động lấy tài khoản đầu tiên trong CSDL (ưu tiên có cookie và status != 'DIE').
    """
    try:
        from core.database.connection import db

        if account_uid and str(account_uid).strip():
            acc = db.fetch_one(
                """SELECT id, uid, user_id, cookie, proxy, profile_name, status
                   FROM accounts WHERE uid = ? AND user_id IS NOT DISTINCT FROM ? LIMIT 1""",
                (str(account_uid).strip(), owner),
            )
            if acc:
                return acc
        # Ưu tiên tài khoản đầu tiên có cookie hợp lệ và trạng thái LIVE/NEW
        acc = db.fetch_one(
            """SELECT id, uid, user_id, cookie, proxy, profile_name, status FROM accounts
               WHERE user_id IS NOT DISTINCT FROM ? AND cookie IS NOT NULL AND status != 'DIE'
               ORDER BY id ASC LIMIT 1""",
            (owner,),
        )
        if acc:
            return acc
        # Fallback bất kỳ tài khoản đầu tiên nào trong DB
        return db.fetch_one(
            """SELECT id, uid, user_id, cookie, proxy, profile_name, status FROM accounts
               WHERE user_id IS NOT DISTINCT FROM ? ORDER BY id ASC LIMIT 1""",
            (owner,),
        )
    except Exception as e:
        logger.warning(f"Lỗi khi truy vấn tài khoản cào nhóm từ CSDL: {e}")
        return None


def search_facebook_via_browser(
    keyword: str,
    account_uid: Optional[str] = None,
    max_results: int = 10,
    owner: str | None = None,
) -> List[Dict[str, Any]]:
    """
    Quét trực tiếp nhóm Facebook bằng tài khoản thật qua Chrome.
    - Tìm tài khoản chỉ định hoặc tài khoản đầu tiên trong CSDL.
    - Tận dụng Chrome đang mở nếu có; nếu chưa mở thì tự khởi động Chrome với cookie & profile của nick.
    - Điều hướng tới https://www.facebook.com/search/groups/?q=...
    - Tự động cuộn trang và bóc tách thông tin nhóm thật: Tên, Link, UID, Quyền riêng tư, Số thành viên, Tần suất bài viết.
    """
    clean_keyword = keyword.strip()
    if not clean_keyword:
        return []

    account = get_scraping_account(account_uid, owner)
    if not account:
        logger.warning("Không tìm thấy tài khoản Facebook nào trong CSDL để cào dữ liệu nhóm.")
        return []

    target_uid = str(account.get("uid") or "").strip()
    if not target_uid:
        return []

    owner = account.get("user_id")
    cookie_str = account.get("cookie") or ""
    proxy = account.get("proxy")

    driver = None
    created_new_driver = False
    lock = None
    acquired_lock = False

    try:
        from core.browser import get_active_drivers, get_profile_lock, load_cookies, open_browser

        active_drivers = get_active_drivers(target_uid, owner=owner)
        if active_drivers:
            driver = active_drivers[0]
            logger.info(f"[{target_uid}] Tận dụng trình duyệt Chrome đang mở để cào nhóm.")
        else:
            lock = get_profile_lock(target_uid, owner=owner)
            acquired_lock = lock.acquire(timeout=8)
            if not acquired_lock:
                logger.warning(f"[{target_uid}] Profile đang bị khóa bởi tiến trình khác.")
                return []

            logger.info(f"[{target_uid}] Khởi động Chrome để cào dữ liệu nhóm cho từ khóa '{clean_keyword}'...")
            driver = open_browser(
                uid=target_uid,
                owner=owner,
                proxy=proxy,
                scope="group_scraper",
                headless=True,
                verify_egress=False,
                allow_direct_fallback=True,
            )
            created_new_driver = True

            if cookie_str:
                load_cookies(driver, cookie_str)

        # Điều hướng tìm kiếm nhóm trên Facebook
        search_term = urllib.parse.quote(clean_keyword)
        search_url = f"https://www.facebook.com/search/groups/?q={search_term}"
        logger.info(f"[{target_uid}] Truy cập: {search_url}")
        driver.get(search_url)
        time.sleep(4)

        # Cuộn trang từ 2-4 lần để nạp thêm kết quả
        scroll_count = min(4, max(2, (max_results // 10)))
        for _ in range(scroll_count):
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(2)

        # Trích xuất dữ liệu thẻ nhóm bằng JavaScript DOM Inspector
        js_extract_script = """
        const results = [];
        const seen = new Set();
        const searchRoot = document.querySelector('[role="main"]') || document.querySelector('main') || document;
        const anchors = Array.from(searchRoot.querySelectorAll('a[href*="/groups/"]'));
        
        for (const a of anchors) {
            const rawHref = a.getAttribute('href') || a.href || '';
            if (!rawHref.includes('/groups/')) continue;
            
            // Lọc các URL không phải link trang chủ nhóm (loại bỏ các tab tìm kiếm /groups/search)
            const badPatterns = [
                '/search/', '/groups/search', '/user/', '/my_groups/', '/your_groups/',
                '/permalink/', '/posts/', '/hashtag/', '/events/', '/media/', '/about/',
                '/members/', '/files/', '/photos/', '/videos/', '/buy_sell_discussion/',
                '/edit/', '/member-requests/', '/categories/', '/feed/', '/discover/', '/joins/'
            ];
            if (badPatterns.some(bad => rawHref.includes(bad))) continue;
            
            let fullHref = a.href || rawHref;
            try {
                const u = new URL(fullHref, window.location.origin);
                fullHref = u.origin + u.pathname;
            } catch(e) {
                fullHref = fullHref.split('?')[0];
            }
            fullHref = fullHref.replace(/\\/+$/, '');
            
            // Loại bỏ các đường dẫn hệ thống và tab menu Facebook
            if (
                fullHref.endsWith('/groups') ||
                fullHref.endsWith('/groups/feed') ||
                fullHref.endsWith('/groups/discover') ||
                fullHref.endsWith('/groups/create') ||
                fullHref.includes('/search/')
            ) {
                continue;
            }

            // Kiểm tra slug nhóm hợp lệ
            const groupParts = fullHref.split('/groups/')[1] ? fullHref.split('/groups/')[1].split('/') : [];
            const groupSlug = (groupParts[0] || '').toLowerCase().trim();
            const systemSlugs = [
                'search', 'feed', 'discover', 'create', 'joins', 'notifications',
                'categories', 'explore', 'manage', 'my_groups', 'your_groups',
                'groups_home', 'group_posts'
            ];
            if (!groupSlug || systemSlugs.includes(groupSlug)) continue;
            
            if (seen.has(fullHref)) continue;
            
            // Tìm container chứa thông tin thẻ nhóm
            let container = a;
            let hasGroupMetadata = false;
            for (let i = 0; i < 6; i++) {
                if (container.parentElement && container.parentElement !== document.body) {
                    container = container.parentElement;
                    const text = container.innerText || '';
                    if (text.includes('thành viên') || text.includes('members') || text.includes('bài viết') || text.includes('posts')) {
                        hasGroupMetadata = true;
                        break;
                    }
                }
            }
            if (!hasGroupMetadata) continue;
            
            const cardText = container.innerText || a.innerText || '';
            const lines = cardText.split('\\n').map(l => l.trim()).filter(Boolean);
            
            let name = a.innerText.trim();
            if (!name || name.length < 2) {
                name = lines.length > 0 ? lines[0] : '';
            }

            // Bỏ qua các nhãn menu của Facebook (ví dụ: Tất cả, Bài viết trong nhóm)
            const rawName = (name || '').trim().toLowerCase();
            const menuNames = ['tất cả', 'bài viết trong nhóm', 'nhóm', 'bài viết', 'mọi người', 'trang', 'ảnh', 'video', 'tìm kiếm'];
            if (menuNames.includes(rawName)) continue;
            
            let privacy = 'public';
            let membershipStatus = 'unknown';
            let members = '—';
            let frequency = '—';
            
            for (const line of lines) {
                const lower = line.toLowerCase();
                if (lower.includes('riêng tư') || lower.includes('private')) {
                    privacy = 'private';
                }
                if (lower.includes('công khai') || lower.includes('public')) {
                    privacy = 'public';
                }
                if (lower.includes('đã tham gia') || lower === 'joined') {
                    membershipStatus = 'joined';
                } else if (
                    lower.includes('chưa tham gia') || lower.includes('not joined') ||
                    lower.includes('tham gia nhóm') || lower.includes('join group') ||
                    lower === 'tham gia' || lower === 'join'
                ) {
                    membershipStatus = 'not_joined';
                }
                // Tìm số thành viên (vd: 120K thành viên, 50 nghìn thành viên, 1.2M members)
                const memMatch = line.match(/([\\d]+([.,][\\d]+)?\\s*(k|triệu|nghìn|tr|m)?)\\s*(thành viên|members)/i);
                if (memMatch) {
                    members = memMatch[1].toUpperCase().replace('NGHÌN', 'K').replace('TRIỆU', 'M').replace(/\\s+/g, '') + (memMatch[1].match(/[a-zA-Z]/) ? '' : ' thành viên');
                }
                // Tìm tần suất bài đăng
                const freqMatch = line.match(/([\\d]+\\+?\\s*(bài|bài viết|posts)?\\s*(\\/|\\s*a\\s*|\\s*mỗi\\s*|\\s*trên\\s*)(ngày|day|tuần|week))/i);
                if (freqMatch) {
                    frequency = freqMatch[0];
                }
            }
            
            seen.add(fullHref);
            results.push({
                url: fullHref,
                name: name || 'Nhóm Facebook',
                privacy: privacy,
                membership_status: membershipStatus,
                members: members,
                frequency: frequency
            });
        }
        return results;
        """

        raw_items = driver.execute_script(js_extract_script) or []
        logger.info(f"[{target_uid}] Trích xuất được {len(raw_items)} nhóm Facebook thật từ DOM.")

        SYSTEM_GROUP_SLUGS = {
            "search", "feed", "discover", "create", "joins", "notifications",
            "categories", "explore", "manage", "my_groups", "your_groups",
            "groups_home", "group_posts", "about", "members", "media", "events"
        }
        FORBIDDEN_NAMES = {
            "tất cả", "bài viết trong nhóm", "nhóm", "bài viết", "mọi người", "trang", "ảnh", "video", "tìm kiếm"
        }

        posted_set = get_posted_group_keys()
        parsed_groups: List[Dict[str, Any]] = []

        for idx, item in enumerate(raw_items, 1):
            clean_url = clean_group_url(item["url"])
            uid = extract_group_identifier(clean_url)
            name = clean_scraped_group_name(item.get("name") or "")

            # Bỏ qua các URL điều hướng, tab tìm kiếm của Facebook
            if not uid or uid.lower() in SYSTEM_GROUP_SLUGS or "/search" in clean_url.lower():
                continue
            if name.lower() in FORBIDDEN_NAMES:
                continue
            if not is_group_relevant(clean_keyword, name, clean_url):
                continue

            group_key = f"group_{uid}"
            is_already_posted = (group_key.lower() in posted_set) or (clean_url.lower() in posted_set)

            # Tính toán mem_num float để phục vụ lọc nếu cần
            mem_raw = item.get("members") or "—"
            mem_k = 0.0
            mem_digits = re.search(r"([\d]+([.,][\d]+)?)", str(mem_raw))
            if mem_digits:
                val = float(mem_digits.group(1).replace(",", "."))
                if "M" in str(mem_raw).upper():
                    mem_k = val * 1000
                elif "K" in str(mem_raw).upper():
                    mem_k = val
                else:
                    mem_k = val / 1000 if val > 100 else val

            grp_dict = {
                "id": f"{len(parsed_groups) + 1:02d}",
                "key": group_key,
                "name": name or f"Nhóm Facebook [ID: {uid}]",
                "url": clean_url,
                "uid": uid,
                "frequency": item.get("frequency") or "—",
                "members": f"{mem_k:.1f}K" if mem_k else str(mem_raw),
                "privacy": item.get("privacy") or "public",
                "membership_status": item.get("membership_status") or "unknown",
                "already_posted": is_already_posted,
                "mem_num": mem_k,
            }
            parsed_groups.append(grp_dict)
            if len(parsed_groups) >= max_results:
                break

        return parsed_groups

    except Exception as e:
        logger.error(f"Lỗi khi cào nhóm Facebook thật qua trình duyệt: {e}")
        return []
    finally:
        if created_new_driver and driver:
            try:
                driver.quit()
            except Exception:
                pass
        if acquired_lock and lock:
            try:
                lock.release()
            except Exception:
                pass


# Search results must come from Facebook. Empty scraping results stay empty.
REAL_FACEBOOK_GROUPS: tuple[dict[str, Any], ...] = ()


def search_facebook_groups(
    keyword: str,
    max_results: int = 10,
    member_filter: str = "all",
    group_type: str = "all",
    frequency_filter: str = "all",
    account_uid: Optional[str] = None,
    owner: str | None = None,
    membership_filter: str = "all",
) -> List[Dict[str, Any]]:
    """
    Tìm kiếm nhóm Facebook thật theo từ khóa và bộ lọc.
    Kế thừa nghiệp vụ từ FaceBook_Post_Group.py:905-918.
    Ưu tiên cào dữ liệu thật từ Facebook bằng tài khoản đầu tiên (hoặc tài khoản chỉ định).
    Tự động lọc theo quyền riêng tư, số lượng thành viên, tần suất bài đăng và lịch sử đã đăng.
    """
    clean_keyword = keyword.strip()
    if not clean_keyword:
        return []

    # 1. Cào trực tiếp nhóm Facebook thật bằng trình duyệt Chrome qua tài khoản đầu tiên / chỉ định
    browser_results = search_facebook_via_browser(clean_keyword, account_uid, max_results * 2, owner)
    if browser_results:
        filtered: List[Dict[str, Any]] = []
        for grp in browser_results:
            clean_name = clean_scraped_group_name(grp.get("name") or "")
            clean_url = clean_group_url(grp.get("url") or "")
            if not clean_name or not is_group_relevant(clean_keyword, clean_name, clean_url):
                continue

            grp["name"] = clean_name
            grp["url"] = clean_url
            mem_num = float(grp.get("mem_num") or 0.0)
            privacy = grp.get("privacy", "public")
            freq = grp.get("frequency", "")
            membership_status = grp.get("membership_status", "unknown")

            # Áp dụng bộ lọc số lượng thành viên
            if member_filter == "10k" and mem_num < 10:
                continue
            if member_filter == "50k" and mem_num < 50:
                continue
            if member_filter == "100k" and mem_num < 100:
                continue

            # Áp dụng bộ lọc loại nhóm
            if group_type == "public" and privacy != "public":
                continue
            if group_type == "private" and privacy != "private":
                continue

            # Áp dụng bộ lọc trạng thái tham gia nhóm
            if membership_filter == "joined" and membership_status != "joined":
                continue
            if membership_filter == "not_joined" and membership_status != "not_joined":
                continue

            # Áp dụng bộ lọc tần suất bài viết
            if frequency_filter and frequency_filter != "all":
                freq_match = re.search(r"(\d+)", freq)
                freq_val = int(freq_match.group(1)) if freq_match else 0
                filter_match = re.search(r"(\d+)", str(frequency_filter))
                if filter_match:
                    target_freq = int(filter_match.group(1))
                    if freq_val < target_freq:
                        continue

            filtered.append(grp)
            if len(filtered) >= max_results:
                break

        if filtered:
            for idx, item in enumerate(filtered, 1):
                item["id"] = f"{idx:02d}"
            return filtered

    # 2. Dự phòng: Tìm kiếm nhóm Facebook từ kho dữ liệu nhóm đã chuẩn hóa (nếu cào trực tiếp không có kết quả)
    posted_set = get_posted_group_keys(owner)
    norm_kw = remove_accents(clean_keyword)
    kw_tokens = [t.strip() for t in re.split(r"[,;\s]+", norm_kw) if len(t.strip()) >= 2]

    matched_groups: List[tuple[int, Dict[str, Any]]] = []

    for grp in REAL_FACEBOOK_GROUPS:
        # Tính điểm liên quan giữa từ khóa tìm kiếm và nhóm
        grp_name_norm = remove_accents(grp["name"])
        grp_url_norm = remove_accents(grp["url"])
        grp_tags_norm = [remove_accents(t) for t in grp.get("tags", [])]

        score = 0
        if norm_kw in grp_name_norm or norm_kw in grp_url_norm:
            score += 15

        for token in kw_tokens:
            if token in grp_name_norm:
                score += 5
            elif token in grp_url_norm:
                score += 4
            elif any(token in tag for tag in grp_tags_norm):
                score += 3

        # Nếu không có từ khóa nào khớp nhưng tổng từ khóa tìm kiếm chung chung, gán điểm cơ bản
        if score == 0 and any(w in grp_name_norm for w in ["hoi", "nhom", "cong dong", "cho", "dien dan"]):
            score = 1

        if score > 0:
            mem_num = grp["mem_num"]
            privacy = grp["privacy"]
            freq = grp["frequency"]
            membership_status = grp.get("membership_status", "unknown")

            # Áp dụng bộ lọc số lượng thành viên
            if member_filter == "10k" and mem_num < 10:
                continue
            if member_filter == "50k" and mem_num < 50:
                continue
            if member_filter == "100k" and mem_num < 100:
                continue

            # Áp dụng bộ lọc loại nhóm
            if group_type == "public" and privacy != "public":
                continue
            if group_type == "private" and privacy != "private":
                continue

            if membership_filter == "joined" and membership_status != "joined":
                continue
            if membership_filter == "not_joined" and membership_status != "not_joined":
                continue

            # Áp dụng bộ lọc tần suất bài viết
            if frequency_filter and frequency_filter != "all":
                freq_match = re.search(r"(\d+)", freq)
                freq_val = int(freq_match.group(1)) if freq_match else 0
                filter_match = re.search(r"(\d+)", str(frequency_filter))
                if filter_match:
                    target_freq = int(filter_match.group(1))
                    if freq_val < target_freq:
                        continue

            group_key = f"group_{grp['uid']}"
            is_already_posted = (group_key.lower() in posted_set) or (grp["url"].lower() in posted_set)

            item = {
                "key": group_key,
                "name": grp["name"],
                "url": grp["url"],
                "uid": grp["uid"],
                "frequency": freq,
                "members": f"{mem_num:.1f}K",
                "privacy": privacy,
                "membership_status": membership_status,
                "already_posted": is_already_posted,
            }
            matched_groups.append((score, item))

    # Sắp xếp theo độ liên quan cao nhất
    matched_groups.sort(key=lambda x: x[0], reverse=True)

    results: List[Dict[str, Any]] = []
    seen_urls: Set[str] = set()

    for idx, (_, grp) in enumerate(matched_groups, 1):
        if grp["url"] not in seen_urls:
            seen_urls.add(grp["url"])
            grp["id"] = f"{len(results) + 1:02d}"
            results.append(grp)
        if len(results) >= max_results:
            break

    return results


def get_sample_template() -> str:
    """Nội dung file text danh sách link nhóm mẫu chuẩn."""
    return (
        "# ==========================================================================\n"
        "# DANH SÁCH LINK NHÓM FACEBOOK ĐĂNG BÀI (Mỗi dòng 1 link hoặc UID nhóm)\n"
        "# Hỗ trợ: https://www.facebook.com/groups/<tên_hoặc_uid_nhóm>\n"
        "# Tự động loại bỏ dấu '?' và các tham số ref không cần thiết\n"
        "# ==========================================================================\n"
        "https://www.facebook.com/groups/vieclamonline2024\n"
        "https://www.facebook.com/groups/muabanonline2024\n"
        "https://www.facebook.com/groups/tuyendungctvhn\n"
        "https://www.facebook.com/groups/congdongmarketingvn\n"
        "https://www.facebook.com/groups/khoinghiepkinhdoanh2024\n"
        "https://www.facebook.com/groups/sinhvientimvieclam\n"
        "https://www.facebook.com/groups/chodocu247\n"
        "https://www.facebook.com/groups/freelancervietnam\n"
        "https://www.facebook.com/groups/kinhdoanhonlinevietnam\n"
        "https://www.facebook.com/groups/mebimsuakinhdoanh\n"
        "https://www.facebook.com/groups/timvieclamnhanh24h\n"
        "https://www.facebook.com/groups/hoicongdongthietkeweb\n"
    )
