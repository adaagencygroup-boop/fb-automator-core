"""
=============================================================================
MODULE 11: FACEBOOK PAGE SCANNER - SCANNER ENGINE & HARVEST LOOP
=============================================================================
Triển khai vòng lặp cuộn trang thu hoạch theo batch, khử trùng tuyệt đối bằng
page_key, lưu DB tăng dần theo batch, và quản lý dừng phiên theo đúng Section 3.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
import unicodedata
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import quote_plus

from core.database.connection import db
from .page_source import (
    clean_page_url,
    extract_page_identifier,
    parse_follower_count,
    normalize_hashtag,
    parse_hashtags_input,
    classify_header_action,
    normalize_page_candidate_key,
    calculate_page_relevance_score,
    is_media_facebook_url,
    is_valid_author_candidate_url,
    author_name_looks_like_url,
    author_verify_cache_key,
    purge_invalid_author_cache_keys,
)
from .entity_classify import (
    build_about_url,
    classify_page_entity,
    should_open_about,
    is_valid_profile_header,
)
from .header_select import author_tab_url_matches

logger = logging.getLogger(__name__)


def _json_default(obj: Any) -> Any:
    """
    Chuyển các kiểu Python không tự JSON-serializable về dạng an toàn khi
    json.dumps(..., default=_json_default):
    - set / frozenset -> list đã sắp xếp (ổn định, không phụ thuộc thứ tự
      duyệt của set — đây là nguyên nhân lỗi "Object of type set is not
      JSON serializable" ở luồng HASHTAG, nơi matched_hashtags là set).
    - datetime / date -> chuỗi ISO.
    """
    if isinstance(obj, (set, frozenset)):
        return sorted(obj, key=lambda v: str(v))
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(
        f"Object of type {type(obj).__name__} is not JSON serializable"
    )


def _dumps_json(value: Any) -> str:
    """json.dumps an toàn cho dữ liệu quét (page dict, settings, evidence)."""
    return json.dumps(value, ensure_ascii=False, default=_json_default)

# Quản lý cờ dừng / tạm dừng phiên (pause ≠ stop — chỉ dẫn 1.1)
_ACTIVE_STOP_EVENTS: Dict[int, threading.Event] = {}
_ACTIVE_PAUSE_EVENTS: Dict[int, threading.Event] = {}  # set = đang PAUSED
_ACTIVE_SESSIONS_LOCK = threading.Lock()


def request_stop_session(session_id: int) -> bool:
    """Dừng hẳn phiên (DỪNG KHẨN CẤP). Đồng thời gỡ pause nếu đang treo."""
    with _ACTIVE_SESSIONS_LOCK:
        pause_ev = _ACTIVE_PAUSE_EVENTS.get(session_id)
        if pause_ev:
            pause_ev.clear()
        event = _ACTIVE_STOP_EVENTS.get(session_id)
        if event:
            event.set()
            return True
    return False


def request_pause_session(session_id: int) -> bool:
    """Tạm dừng tại điểm an toàn (không dùng stop event)."""
    with _ACTIVE_SESSIONS_LOCK:
        if session_id not in _ACTIVE_STOP_EVENTS:
            return False
        if session_id not in _ACTIVE_PAUSE_EVENTS:
            _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()
        _ACTIVE_PAUSE_EVENTS[session_id].set()
    try:
        db.execute(
            "UPDATE page_scan_sessions SET status = 'PAUSED' WHERE id = %s AND status = 'RUNNING'",
            (session_id,),
        )
    except Exception as exc:
        logger.warning(f"[Scanner] Không cập nhật PAUSED cho phiên #{session_id}: {exc}")
    return True


def request_resume_session(session_id: int) -> bool:
    """Tiếp tục đúng phiên đang PAUSED."""
    with _ACTIVE_SESSIONS_LOCK:
        pause_ev = _ACTIVE_PAUSE_EVENTS.get(session_id)
        if pause_ev:
            pause_ev.clear()
        if session_id not in _ACTIVE_STOP_EVENTS:
            return False
    try:
        db.execute(
            "UPDATE page_scan_sessions SET status = 'RUNNING' WHERE id = %s AND status = 'PAUSED'",
            (session_id,),
        )
    except Exception as exc:
        logger.warning(f"[Scanner] Không cập nhật RUNNING cho phiên #{session_id}: {exc}")
    return True


def append_session_log(
    session_id: int,
    message: str,
    level: str = "info",
    max_lines: int = 500,
) -> None:
    """Lưu log kèm phiên (tối đa ~500 dòng gần nhất) — reload vẫn còn lịch sử."""
    try:
        row = db.fetch_one(
            "SELECT logs FROM page_scan_sessions WHERE id = %s",
            (session_id,),
        )
        logs: List[Dict[str, Any]] = []
        raw = (row or {}).get("logs")
        if raw:
            if isinstance(raw, str):
                try:
                    logs = json.loads(raw) or []
                except Exception:
                    logs = []
            elif isinstance(raw, list):
                logs = list(raw)
        logs.append(
            {
                "ts": datetime.now().strftime("%H:%M:%S"),
                "level": level,
                "message": str(message)[:1000],
            }
        )
        logs = logs[-max_lines:]
        db.execute(
            "UPDATE page_scan_sessions SET logs = %s WHERE id = %s",
            (_dumps_json(logs), session_id),
        )
    except Exception as exc:
        logger.debug(f"[Scanner] append_session_log #{session_id}: {exc}")


def _wait_if_paused(session_id: int, stop_event: threading.Event) -> bool:
    """
    Treo tại điểm an toàn khi pause. Trả True nếu bị stop trong lúc pause.
    """
    while True:
        with _ACTIVE_SESSIONS_LOCK:
            pause_ev = _ACTIVE_PAUSE_EVENTS.get(session_id)
            paused = bool(pause_ev and pause_ev.is_set())
        if not paused:
            return False
        if stop_event.is_set():
            return True
        time.sleep(0.4)


def _dom_scroll_metrics(driver) -> Tuple[frozenset, int, int]:
    """Lấy chữ ký page_key hiện có + scrollY + scrollHeight."""
    cards = extract_page_cards_from_driver(driver)
    keys = frozenset(c["page_key"] for c in cards if c.get("page_key"))
    try:
        metrics = driver.execute_script(
            "return [window.scrollY || 0, document.documentElement.scrollHeight || document.body.scrollHeight || 0];"
        )
        scroll_y = int(metrics[0] or 0)
        scroll_h = int(metrics[1] or 0)
    except Exception:
        scroll_y, scroll_h = 0, 0
    return keys, scroll_y, scroll_h


def _scroll_results_step(driver, use_container: bool = False) -> None:
    """Cuộn 1 nấc ~85% viewport; tuỳ chọn cuộn container gần thẻ kết quả."""
    if use_container:
        try:
            driver.execute_script(
                """
                const links = Array.from(document.querySelectorAll('a[href*="facebook.com/"]'));
                let el = null;
                for (const a of links) {
                  const href = (a.getAttribute('href') || '');
                  if (/search|login|watch|marketplace|gaming|events|help/.test(href)) continue;
                  let p = a.parentElement;
                  while (p && p !== document.body) {
                    const st = window.getComputedStyle(p);
                    const oy = st.overflowY;
                    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 40) {
                      el = p; break;
                    }
                    p = p.parentElement;
                  }
                  if (el) break;
                }
                if (el) {
                  el.scrollBy(0, Math.floor(el.clientHeight * 0.85));
                  return true;
                }
                window.scrollBy(0, window.innerHeight * 0.85);
                return false;
                """
            )
            return
        except Exception:
            pass
    driver.execute_script("window.scrollBy(0, window.innerHeight * 0.85);")


def _wait_dom_settle_after_scroll(
    driver,
    keys_before: frozenset,
    scroll_h_before: int,
    timeout_sec: float = 6.0,
    poll_sec: float = 0.5,
) -> None:
    """
    Sau scroll: poll tối đa ~6s đến khi tập page_key hoặc scrollHeight đổi.
    Hết giờ vẫn tiếp tục — không treo phiên.
    """
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        time.sleep(poll_sec)
        keys_now, _, h_now = _dom_scroll_metrics(driver)
        if keys_now != keys_before or h_now != scroll_h_before:
            return


def get_scraping_account(
    account_uid: Optional[str] = None,
    owner_key: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Lấy tài khoản quét từ Module 02 theo tiêu chí preflight:
    - Nếu có account_uid, ưu tiên kiểm tra đúng nick đó.
    - Nếu không có, lấy nick LIVE, có cookie, ít được dùng nhất trong ngày.
    """
    try:
        if account_uid and str(account_uid).strip():
            acc = db.fetch_one(
                "SELECT id, uid, user_id, cookie, proxy, profile_name, status FROM accounts WHERE uid = %s LIMIT 1",
                (str(account_uid).strip(),),
            )
            if acc:
                return acc

        # Vòng quay chọn acc đủ điều kiện, ưu tiên status LIVE / NEW và có cookie
        acc = db.fetch_one(
            """
            SELECT id, uid, user_id, cookie, proxy, profile_name, status 
            FROM accounts 
            WHERE cookie IS NOT NULL 
              AND status NOT IN ('DIE', 'CHECKPOINT', 'ERROR')
            ORDER BY id ASC 
            LIMIT 1
            """
        )
        return acc
    except Exception as exc:
        logger.warning(f"[Scanner] Lỗi truy vấn tài khoản cào: {exc}")
        return None


def create_scan_session(
    owner_key: str,
    keyword: Optional[str],
    account_uid: Optional[str],
    source_type: str,
    max_results: int = 100,
    settings: Optional[Dict[str, Any]] = None,
    campaign_id: Optional[str] = None,
) -> int:
    """Khởi tạo bản ghi phiên quét mới trong CSDL với trạng thái RUNNING."""
    settings_str = _dumps_json(settings or {})
    query = """
    INSERT INTO page_scan_sessions (
        owner_key, keyword, account_uid, source_type, status,
        max_results, total_seen, total_unique, total_duplicates,
        total_sponsored, batches_count, duration_seconds, settings,
        campaign_id, logs,
        started_at, created_at
    ) VALUES (
        %s, %s, %s, %s, 'RUNNING',
        %s, 0, 0, 0,
        0, 0, 0, %s,
        %s, %s,
        NOW(), NOW()
    ) RETURNING id;
    """
    row = db.fetch_one(
        query,
        (
            owner_key,
            keyword,
            account_uid,
            source_type.upper(),
            max_results,
            settings_str,
            campaign_id,
            _dumps_json([]),
        ),
    )
    if not row:
        raise RuntimeError("Không thể tạo phiên quét trong CSDL")
    return int(row["id"])


def finalize_scan_session(
    session_id: int,
    status: str,
    stop_reason: str,
    total_seen: int,
    total_unique: int,
    total_duplicates: int,
    total_sponsored: int,
    batches_count: int,
    duration_seconds: int,
    error_message: Optional[str] = None,
):
    """Cập nhật trạng thái cuối cùng và thống kê tổng kết cho phiên quét."""
    query = """
    UPDATE page_scan_sessions
    SET status = %s,
        stop_reason = %s,
        total_seen = %s,
        total_unique = %s,
        total_duplicates = %s,
        total_sponsored = %s,
        batches_count = %s,
        duration_seconds = %s,
        error_message = %s,
        finished_at = NOW()
    WHERE id = %s
    """
    db.execute(
        query,
        (
            status,
            stop_reason,
            total_seen,
            total_unique,
            total_duplicates,
            total_sponsored,
            batches_count,
            duration_seconds,
            error_message,
            session_id,
        ),
    )


def save_batch_pages(
    session_id: int,
    owner_key: str,
    batch_index: int,
    pages: List[Dict[str, Any]],
    account_uid: Optional[str],
    source_type: str = "SEARCH",
) -> Tuple[int, int]:
    """
    Lưu tăng dần các trang cào được vào kho scanned_pages và page_scan_session_pages.
    Trả về: (số trang mới toàn cục, số trang đã tồn tại từ trước).
    """
    if not pages:
        return (0, 0)

    new_global_count = 0
    existing_count = 0

    for page in pages:
        page_key = page.get("page_key")
        if not page_key:
            continue

        # page của luồng HASHTAG chứa matched_hashtags là set -> phải dumps
        # qua _dumps_json (có default chuyển set thành list), dumps thường sẽ
        # ném TypeError "Object of type set is not JSON serializable".
        raw_data_str = _dumps_json(page)
        is_verified = page.get("is_verified")
        is_sponsored = bool(page.get("is_sponsored", False))

        # Trích các trường chấm điểm relevance (nếu nguồn là HASHTAG)
        rel_score = int(page.get("relevance_score") or 0)
        rel_status = str(page.get("relevance_status") or "RELEVANT")
        matched_tags = page.get("matched_hashtags")
        if isinstance(matched_tags, (list, set, frozenset)):
            # sorted: thứ tự ổn định, không để thứ tự duyệt set thay đổi dữ liệu
            matched_tags = ", ".join(sorted(str(t) for t in matched_tags))
        hashtag_post_count = int(page.get("hashtag_post_count") or 0)

        evidence = page.get("evidence_posts")
        if isinstance(evidence, (list, dict)):
            evidence = _dumps_json(evidence)
        latest_post_at = str(page.get("latest_post_at") or "")

        # 1. Upsert vào kho tổng scanned_pages
        upsert_query = """
        INSERT INTO scanned_pages (
            owner_key, page_key, page_name, page_url, avatar_url,
            category, follower_count, follower_text, is_verified,
            is_sponsored, identifier_quality, relevance_score, relevance_status,
            matched_hashtags, hashtag_post_count, first_found_by_account_uid,
            first_source_type, first_session_id, raw_data, created_at, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, NOW(), NOW()
        )
        ON CONFLICT (owner_key, page_key) DO UPDATE
        SET page_name = COALESCE(EXCLUDED.page_name, scanned_pages.page_name),
            page_url = EXCLUDED.page_url,
            avatar_url = COALESCE(EXCLUDED.avatar_url, scanned_pages.avatar_url),
            category = COALESCE(EXCLUDED.category, scanned_pages.category),
            follower_count = COALESCE(EXCLUDED.follower_count, scanned_pages.follower_count),
            follower_text = COALESCE(EXCLUDED.follower_text, scanned_pages.follower_text),
            is_verified = COALESCE(EXCLUDED.is_verified, scanned_pages.is_verified),
            relevance_score = GREATEST(scanned_pages.relevance_score, EXCLUDED.relevance_score),
            relevance_status = EXCLUDED.relevance_status,
            matched_hashtags = COALESCE(EXCLUDED.matched_hashtags, scanned_pages.matched_hashtags),
            hashtag_post_count = GREATEST(scanned_pages.hashtag_post_count, EXCLUDED.hashtag_post_count),
            updated_at = NOW()
        RETURNING (xmax = 0) AS is_new;
        """
        try:
            res = db.fetch_one(
                upsert_query,
                (
                    owner_key,
                    page_key,
                    page.get("page_name"),
                    page.get("page_url"),
                    page.get("avatar_url"),
                    page.get("category"),
                    page.get("follower_count"),
                    page.get("follower_text"),
                    is_verified,
                    is_sponsored,
                    page.get("identifier_quality", "high"),
                    rel_score,
                    rel_status,
                    matched_tags,
                    hashtag_post_count,
                    account_uid,
                    source_type,
                    session_id,
                    raw_data_str,
                ),
            )
            is_new = bool(res and res.get("is_new"))
        except Exception:
            # Fallback nếu DB không hỗ trợ xmax
            is_new = True

        if is_new:
            new_global_count += 1
        else:
            existing_count += 1

        # 2. Ghi liên kết vào page_scan_session_pages
        link_query = """
        INSERT INTO page_scan_session_pages (
            session_id, page_key, batch_index, is_new_globally,
            relevance_score, relevance_status, hashtag_post_count,
            matched_hashtags, evidence_posts, latest_post_at, created_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (session_id, page_key) DO UPDATE
        SET relevance_score = EXCLUDED.relevance_score,
            relevance_status = EXCLUDED.relevance_status,
            hashtag_post_count = EXCLUDED.hashtag_post_count,
            matched_hashtags = EXCLUDED.matched_hashtags,
            evidence_posts = EXCLUDED.evidence_posts,
            latest_post_at = EXCLUDED.latest_post_at;
        """
        try:
            db.execute(
                link_query,
                (
                    session_id,
                    page_key,
                    batch_index,
                    is_new,
                    rel_score,
                    rel_status,
                    hashtag_post_count,
                    matched_tags,
                    evidence,
                    latest_post_at,
                ),
            )
        except Exception as exc:
            logger.debug(f"[Scanner] Session page link insert: {exc}")

    return (new_global_count, existing_count)


def extract_page_cards_from_driver(driver) -> List[Dict[str, Any]]:
    """
    Trích xuất danh sách thẻ kết quả Fanpage đang hiện diện trong DOM của container chính.
    Bóc tách nông: Tên, Link, Avatar, Danh mục, Lượng theo dõi, Tích xanh, Tài trợ.
    """
    extracted_cards: List[Dict[str, Any]] = []
    try:
        from selenium.webdriver.common.by import By

        # Tìm các link hoặc container có chứa link dẫn tới Fanpage
        # Facebook search results thường là các block div[role='article'] hoặc các thẻ a có href chứa fanpage
        script = """
        const results = [];
        // Lấy tất cả các thẻ a dẫn tới profile/page
        const links = Array.from(document.querySelectorAll('a[role="presentation"], a[attributionsrc], div[role="feed"] a, div[role="main"] a'));
        const seenHrefs = new Set();

        for (const a of links) {
            const href = a.getAttribute('href');
            if (!href || href.includes('/search/') || href.includes('/groups/') || seenHrefs.has(href)) continue;

            // Tìm container thẻ cha bao quanh thẻ a
            let card = a.closest('div[role="article"]') || a.closest('div[data-virtualized="false"]') || a.parentElement;
            let cardText = card ? card.innerText : a.innerText;
            if (!cardText || cardText.length < 3) continue;

            // Tìm avatar nếu có
            let img = card ? card.querySelector('image, img') : null;
            let avatarUrl = img ? (img.getAttribute('xlink:href') || img.getAttribute('src')) : null;

            // Kiểm tra tích xanh (Verified)
            let isVerified = null;
            if (card) {
                const verifiedEl = card.querySelector('svg[aria-label*="xác minh"], svg[aria-label*="Verified"], div[aria-label*="Đã xác minh"]');
                if (verifiedEl) isVerified = true;
            }

            // Kiểm tra Được tài trợ (Sponsored)
            let isSponsored = false;
            if (cardText.includes('Được tài trợ') || cardText.includes('Sponsored')) {
                isSponsored = true;
            }

            seenHrefs.add(href);
            results.push({
                href: href,
                raw_text: cardText,
                avatar_url: avatarUrl,
                is_verified: isVerified,
                is_sponsored: isSponsored
            });
        }
        return results;
        """
        raw_items = driver.execute_script(script) or []

        for item in raw_items:
            href = item.get("href") or ""
            cleaned = clean_page_url(href)
            if not cleaned:
                continue

            page_key, quality = extract_page_identifier(cleaned)
            if not page_key:
                continue

            raw_text = item.get("raw_text") or ""
            text_lines = [l.strip() for l in raw_text.splitlines() if l.strip()]

            # Tên page thường là dòng đầu tiên
            page_name = text_lines[0] if text_lines else page_key

            # Phân tích follower count từ text
            follower_count, follower_text = parse_follower_count(raw_text)

            # Phân tích category (dòng thứ 2 hoặc dòng chứa Trang / Page / Dịch vụ...)
            category = ""
            for l in text_lines[1:4]:
                if any(k in l.lower() for k in ["trang", "page", "dịch vụ", "công ty", "bán lẻ", "thương mại"]):
                    category = l
                    break
            if not category and len(text_lines) > 1:
                category = text_lines[1]

            extracted_cards.append({
                "page_key": page_key,
                "page_name": page_name,
                "page_url": cleaned,
                "avatar_url": item.get("avatar_url"),
                "category": category,
                "follower_count": follower_count,
                "follower_text": follower_text,
                "is_verified": item.get("is_verified"),
                "is_sponsored": bool(item.get("is_sponsored", False)),
                "identifier_quality": quality,
            })
    except Exception as exc:
        logger.warning(f"[Scanner] Lỗi bóc tách DOM thẻ: {exc}")

    return extracted_cards


def run_page_search_flow(
    keyword: str,
    account_uid: Optional[str] = None,
    max_results: int = 100,
    include_sponsored: bool = False,
    owner_key: str = "system",
    headless: bool = False,
    allow_direct_fallback: bool = True,
    session_id: Optional[int] = None,
    campaign_id: Optional[str] = None,
    keep_browser: bool = False,
) -> Dict[str, Any]:
    """
    Thực thi trọn vẹn 1 phiên tìm kiếm Fanpage theo từ khóa qua trình duyệt:
    - Tạo session RUNNING trong DB (nếu chưa có)
    - Bật Chrome & vào trang tìm kiếm Fanpage của Facebook
    - Vòng scroll thu hoạch chống lặp theo batch (Mục 3.4)
    - Tự động dừng theo stop_reason chuẩn xác và lưu kết quả tăng dần
    - keep_browser=True: giữ Chrome page_scanner khi kết thúc bình thường (job kế cùng acc)
    """
    clean_keyword = keyword.strip()
    if not clean_keyword:
        raise ValueError("Từ khóa tìm kiếm không được để trống")

    max_results = max(1, min(max_results, 500))

    # 1. Chọn tài khoản & Preflight check
    account = get_scraping_account(account_uid, owner_key=owner_key)
    if not account:
        raise RuntimeError("Không tìm thấy tài khoản Facebook nào hợp lệ trong Module 02 để quét")

    target_uid = str(account.get("uid") or "").strip()
    owner = account.get("user_id") or owner_key
    cookie_str = account.get("cookie") or ""
    proxy = account.get("proxy")

    # 2. Tạo phiên RUNNING (nếu chưa có)
    if session_id is None:
        session_id = create_scan_session(
            owner_key=owner_key,
            keyword=clean_keyword,
            account_uid=target_uid,
            source_type="SEARCH",
            max_results=max_results,
            settings={
                "include_sponsored": include_sponsored,
                "headless": headless,
                "allow_direct_fallback": allow_direct_fallback,
                "keep_browser": keep_browser,
            },
            campaign_id=campaign_id,
        )

    with _ACTIVE_SESSIONS_LOCK:
        if session_id not in _ACTIVE_STOP_EVENTS:
            _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        if session_id not in _ACTIVE_PAUSE_EVENTS:
            _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()
        stop_event = _ACTIVE_STOP_EVENTS[session_id]

    # 3. Khởi tạo biến trạng thái vòng scroll
    kho: Dict[str, Dict[str, Any]] = {}
    seen_batch_signatures: Set[frozenset] = set()
    no_new_streak = 0
    batch_no = 0
    total_seen = 0
    total_duplicates = 0
    total_sponsored = 0
    stop_reason = "COMPLETED"
    error_message: Optional[str] = None
    start_time = time.time()
    stagnant_scroll_streak = 0
    use_container_scroll = False

    MAX_SCROLL_BATCHES = 100
    NO_NEW_LIMIT = 5  # SEARCH: 5 (chỉ dẫn 3.2); HASHTAG giữ 3
    MAX_DURATION_SEC = 480

    driver = None
    created_new_driver = False
    lock = None
    acquired_lock = False

    try:
        from core.browser import human_sleep

        try:
            driver, created_new_driver, lock, acquired_lock = _acquire_page_scanner_browser(
                target_uid=target_uid,
                owner=owner,
                proxy=proxy,
                cookie_str=cookie_str,
                headless=headless,
                allow_direct_fallback=allow_direct_fallback,
            )
        except RuntimeError as lock_err:
            stop_reason = "CHECKPOINT"
            error_message = str(lock_err)
            finalize_scan_session(session_id, "PARTIAL", stop_reason, 0, 0, 0, 0, 0, 0, error_message)
            return {"session_id": session_id, "count": 0, "pages": [], "stop_reason": stop_reason}

        if created_new_driver:
            append_session_log(
                session_id,
                f"Khởi chạy Chrome Profile {target_uid} · proxy={proxy or 'direct'}",
                "warn",
            )
        else:
            append_session_log(session_id, f"Tái sử dụng Chrome profile {target_uid}", "info")

        # 4. Điều hướng tới Facebook Search Pages
        encoded_kw = quote_plus(clean_keyword)
        search_url = f"https://www.facebook.com/search/pages/?q={encoded_kw}"
        driver.get(search_url)
        time.sleep(3)
        append_session_log(
            session_id,
            f"Từ khóa mục tiêu: {clean_keyword} · giới hạn {max_results} page",
            "info",
        )

        # 5. Vòng scroll thu hoạch chống lặp (chỉ dẫn mục 3)
        while True:
            if _wait_if_paused(session_id, stop_event):
                stop_reason = "USER_STOPPED"
                break

            batch_no += 1
            if stop_event.is_set():
                stop_reason = "USER_STOPPED"
                break

            elapsed = int(time.time() - start_time)
            if elapsed >= MAX_DURATION_SEC:
                stop_reason = "TIMEOUT"
                break

            curr_url = driver.current_url.lower()
            if "checkpoint" in curr_url or "login" in curr_url:
                stop_reason = "CHECKPOINT"
                error_message = "Tài khoản bị dính checkpoint hoặc mất đăng nhập Facebook"
                break

            cards = extract_page_cards_from_driver(driver)
            total_seen += len(cards)

            valid_cards: List[Dict[str, Any]] = []
            for c in cards:
                if c.get("is_sponsored") and not include_sponsored:
                    total_sponsored += 1
                    continue
                valid_cards.append(c)

            keys_batch = [c["page_key"] for c in valid_cards if c.get("page_key")]
            new_cards = [c for c in valid_cards if c["page_key"] not in kho]
            new_keys_count = len(new_cards)

            duplicates_in_batch = len(valid_cards) - len(new_cards)
            total_duplicates += duplicates_in_batch

            for c in new_cards:
                kho[c["page_key"]] = c

            if new_cards:
                save_batch_pages(session_id, owner_key, batch_no, new_cards, target_uid, "SEARCH")
                for c in new_cards[:3]:
                    append_session_log(
                        session_id,
                        f"Quét thành công [{c.get('page_name')}] FL={c.get('follower_count') or c.get('follower_text') or '?'}",
                        "success",
                    )

            try:
                db.execute(
                    """
                    UPDATE page_scan_sessions
                    SET total_seen = %s, total_unique = %s, total_duplicates = %s,
                        total_sponsored = %s, batches_count = %s, duration_seconds = %s
                    WHERE id = %s
                    """,
                    (total_seen, len(kho), total_duplicates, total_sponsored, batch_no, int(time.time() - start_time), session_id),
                )
            except Exception:
                pass

            if len(kho) >= max_results:
                stop_reason = "TARGET_REACHED"
                break

            # CYCLE: chỉ khi batch 0 Page mới VÀ chữ ký đã từng xuất hiện
            signature = frozenset(keys_batch)
            if new_keys_count == 0 and signature and signature in seen_batch_signatures:
                stop_reason = "CYCLE_DETECTED"
                break
            if signature:
                seen_batch_signatures.add(signature)

            if new_keys_count == 0:
                no_new_streak += 1
                if no_new_streak >= NO_NEW_LIMIT:
                    stop_reason = "NO_NEW_RESULTS"
                    break
            else:
                no_new_streak = 0

            try:
                page_source_text = driver.page_source.lower()
                if "hết kết quả" in page_source_text or "end of results" in page_source_text:
                    stop_reason = "END_MARKER"
                    break
            except Exception:
                pass

            if batch_no >= MAX_SCROLL_BATCHES:
                stop_reason = "MAX_SCROLLS"
                break

            # Scroll + chờ DOM ổn định (chỉ dẫn 3.2 điểm 2–3)
            keys_before, scroll_y_before, scroll_h_before = _dom_scroll_metrics(driver)
            _scroll_results_step(driver, use_container=use_container_scroll)
            try:
                human_sleep(1.5, 3.5, config=getattr(driver, "browser_config", None))
            except Exception:
                time.sleep(2.0)
            _wait_dom_settle_after_scroll(driver, keys_before, scroll_h_before)

            _, scroll_y_after, scroll_h_after = _dom_scroll_metrics(driver)
            if scroll_y_after == scroll_y_before and scroll_h_after == scroll_h_before:
                stagnant_scroll_streak += 1
            else:
                stagnant_scroll_streak = 0
            # 2 batch liên tiếp scroll không hiệu lực → cuộn container kết quả
            if stagnant_scroll_streak >= 2 and not use_container_scroll:
                use_container_scroll = True
                append_session_log(
                    session_id,
                    "Scroll window đứng yên — chuyển cuộn container kết quả",
                    "warn",
                )

            append_session_log(
                session_id,
                f"Batch {batch_no}: DOM={len(keys_batch)} mới={new_keys_count} unique={len(kho)} scrollY={scroll_y_after}",
                "info",
            )

    except Exception as exc:
        logger.error(f"[Scanner] Lỗi thực thi phiên #{session_id}: {exc}", exc_info=True)
        stop_reason = "ERROR"
        error_message = str(exc)
    finally:
        with _ACTIVE_SESSIONS_LOCK:
            _ACTIVE_STOP_EVENTS.pop(session_id, None)
            _ACTIVE_PAUSE_EVENTS.pop(session_id, None)

        duration = int(time.time() - start_time)
        final_status = "COMPLETED" if stop_reason in ["TARGET_REACHED", "NO_NEW_RESULTS", "CYCLE_DETECTED", "END_MARKER"] else "PARTIAL"
        if stop_reason == "ERROR":
            final_status = "FAILED"
        elif stop_reason == "USER_STOPPED":
            final_status = "STOPPED"

        finalize_scan_session(
            session_id=session_id,
            status=final_status,
            stop_reason=stop_reason,
            total_seen=total_seen,
            total_unique=len(kho),
            total_duplicates=total_duplicates,
            total_sponsored=total_sponsored,
            batches_count=batch_no,
            duration_seconds=duration,
            error_message=error_message,
        )

        _release_page_scanner_browser(
            stop_reason=stop_reason,
            keep_browser=keep_browser,
            acquired_lock=acquired_lock,
            lock=lock,
        )

    return {
        "session_id": session_id,
        "count": len(kho),
        "pages": list(kho.values())[:max_results],
        "stop_reason": stop_reason,
        "status": final_status,
        "error_message": error_message,
    }


def start_page_search_background(
    keyword: str,
    account_uid: Optional[str] = None,
    max_results: int = 100,
    include_sponsored: bool = False,
    owner_key: str = "system",
    headless: bool = False,
    allow_direct_fallback: bool = True,
    campaign_id: Optional[str] = None,
    settings: Optional[Dict[str, Any]] = None,
    keep_browser: bool = False,
) -> int:
    """
    Khởi động phiên tìm kiếm Fanpage trong background thread không chặn HTTP request.
    Tạo bản ghi session RUNNING ngay lập tức và trả về session_id cho client.
    """
    clean_keyword = keyword.strip()
    if not clean_keyword:
        raise ValueError("Từ khóa tìm kiếm không được để trống")

    max_results = max(1, min(max_results, 500))

    account = get_scraping_account(account_uid, owner_key=owner_key)
    if not account:
        raise RuntimeError("Không tìm thấy tài khoản Facebook nào hợp lệ trong Module 02 để quét")

    target_uid = str(account.get("uid") or "").strip()

    merged_settings = {
        "include_sponsored": include_sponsored,
        "headless": headless,
        "allow_direct_fallback": allow_direct_fallback,
        "keep_browser": keep_browser,
        **(settings or {}),
    }
    keep_browser = bool(merged_settings.get("keep_browser", keep_browser))

    # 1. Tạo bản ghi phiên RUNNING trong DB
    session_id = create_scan_session(
        owner_key=owner_key,
        keyword=clean_keyword,
        account_uid=target_uid,
        source_type="SEARCH",
        max_results=max_results,
        settings=merged_settings,
        campaign_id=campaign_id,
    )

    # 2. Đăng ký stop/pause event ngay
    with _ACTIVE_SESSIONS_LOCK:
        _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()

    # 3. Kích hoạt worker trong daemon thread
    worker_thread = threading.Thread(
        target=run_page_search_flow,
        kwargs={
            "keyword": clean_keyword,
            "account_uid": target_uid,
            "max_results": max_results,
            "include_sponsored": include_sponsored,
            "owner_key": owner_key,
            "headless": headless,
            "allow_direct_fallback": allow_direct_fallback,
            "session_id": session_id,
            "campaign_id": campaign_id,
            "keep_browser": keep_browser,
        },
        daemon=True,
        name=f"page_scan_worker_{session_id}",
    )
    worker_thread.start()

    return session_id


# =============================================================================
# HASHTAG SEARCH HARVEST FLOW (Section 10 of Detail Plan)
# =============================================================================

# Ô Search Facebook (cùng bộ locator Module 10 — EN trước, VI sau)
_FB_SEARCH_INPUT_LOCATORS = [
    '//input[@aria-label="Search Facebook"]',
    '//input[@placeholder="Search Facebook"]',
    '//input[@type="search" and @aria-label="Search Facebook"]',
    '//input[@role="combobox" and @aria-label="Search Facebook"]',
    '//input[@aria-label="Tìm kiếm trên Facebook"]',
    '//input[@placeholder="Tìm kiếm trên Facebook"]',
    '//input[@type="search" and (@aria-label="Tìm kiếm trên Facebook" or @aria-label="Search Facebook")]',
    '//input[@role="combobox" and (contains(@aria-label,"Tìm kiếm trên Facebook") or contains(@aria-label,"Search Facebook"))]',
    '//input[@type="search" and (contains(@aria-label,"Tìm kiếm") or contains(@aria-label,"Search") or contains(@placeholder,"Tìm kiếm") or contains(@placeholder,"Search Facebook"))]',
]

# Tab Posts: ưu tiên href /search/posts (ổn định hơn text), rồi role=tab / span
_FB_POSTS_TAB_LOCATORS = [
    '//a[contains(@href,"/search/posts")]',
    '//a[contains(@href,"search/posts/?q=")]',
    '//*[@role="tab"][contains(@href,"/search/posts") or .//span[normalize-space()="Posts" or normalize-space()="Bài viết"]]',
    '//*[@role="tab"][normalize-space()="Posts" or normalize-space()="Bài viết"]',
    '//div[@role="list"]//a[.//span[normalize-space()="Posts" or normalize-space()="Bài viết"]]',
    '//div[@role="navigation"]//a[contains(@href,"/search/posts")]',
    '//span[normalize-space()="Posts" or normalize-space()="Bài viết"]/ancestor::a[1]',
    '//span[normalize-space()="Posts" or normalize-space()="Bài viết"]/ancestor::*[@role="link" or @role="tab" or @role="button"][1]',
    '//*[@role="list"]//span[normalize-space()="Posts" or normalize-space()="Bài viết"]',
    '//*[@role="list"]//*[@role="listitem" or @role="link" or @role="button"][.//span[normalize-space()="Posts" or normalize-space()="Bài viết"]]',
    '//*[@role="link" or @role="button"][normalize-space()="Posts" or normalize-space()="Bài viết"]',
]


def _clear_fb_search_input(driver, search_el) -> None:
    from selenium.webdriver.common.keys import Keys

    try:
        search_el.click()
    except Exception:
        try:
            driver.execute_script("arguments[0].click();", search_el)
        except Exception:
            pass
    try:
        search_el.clear()
    except Exception:
        pass
    try:
        search_el.send_keys(Keys.CONTROL, "a")
        search_el.send_keys(Keys.BACKSPACE)
    except Exception:
        pass
    try:
        driver.execute_script(
            "arguments[0].value='';"
            "arguments[0].dispatchEvent(new Event('input',{bubbles:true}));",
            search_el,
        )
    except Exception:
        pass


def _click_posts_search_tab(driver, wait_and_find, human_sleep) -> bool:
    """
    Click tab Posts/Bài viết trên trang kết quả search.
    Chờ filter bar render (poll ngắn), ưu tiên link /search/posts;
    xác nhận URL đổi sang posts. Fallback caller giữ search_posts URL.
    """
    from selenium.webdriver.common.by import By

    # Cho filter bar render — poll thay vì sleep dài cố định
    human_sleep(0.6, 1.0)
    el = None
    last_err = None
    for attempt_timeout in (4, 6, 8):
        try:
            el = wait_and_find(driver, _FB_POSTS_TAB_LOCATORS, timeout=attempt_timeout)
            if el:
                break
        except Exception as exc:
            last_err = exc
            human_sleep(0.4, 0.7)
    if not el:
        logger.debug(f"[Scanner] Posts tab không tìm thấy: {last_err}")
        return False

    targets = [el]
    try:
        parent = el.find_element(
            By.XPATH,
            "./ancestor::a[1] | ./ancestor::*[@role='link' or @role='button' or @role='tab' or @role='listitem'][1]",
        )
        if parent and parent not in targets:
            targets.insert(0, parent)
    except Exception:
        pass

    before_url = (driver.current_url or "").lower()
    for target in targets:
        try:
            driver.execute_script(
                "arguments[0].scrollIntoView({block:'center', inline:'nearest'});",
                target,
            )
        except Exception:
            pass
        clicked = False
        try:
            target.click()
            clicked = True
        except Exception:
            try:
                driver.execute_script("arguments[0].click();", target)
                clicked = True
            except Exception:
                continue
        if not clicked:
            continue
        # Chờ URL/filter chuyển sang posts (tối đa ~2.5s)
        deadline = time.time() + 2.5
        while time.time() < deadline:
            cur = (driver.current_url or "").lower()
            if "/search/posts" in cur or ("posts" in cur and "search" in cur):
                human_sleep(0.4, 0.8)
                return True
            # Một số UI đổi filter không đổi URL ngay — kiểm tra aria-selected
            try:
                selected = driver.execute_script(
                    """
                    const t = arguments[0];
                    const tab = t.closest('[role="tab"]') || t;
                    return (tab.getAttribute('aria-selected') === 'true')
                      || (tab.getAttribute('aria-current') === 'page');
                    """,
                    target,
                )
                if selected and cur != before_url:
                    human_sleep(0.4, 0.8)
                    return True
                if selected:
                    human_sleep(0.5, 0.9)
                    return True
            except Exception:
                pass
            time.sleep(0.2)
        # Click được nhưng chưa chắc URL — vẫn coi thành công nếu không lỗi
        human_sleep(0.5, 1.0)
        return True
    return False


def navigate_hashtag_via_search_box(
    driver,
    current_tag: str,
    session_id: int,
    *,
    reset_home: bool = True,
) -> str:
    """
    Gõ #tag vào ô Search Facebook → Enter → tab Posts/Bài viết.
    Fallback lần lượt: /search/posts/?q=%23tag → /hashtag/tag.
    Trả về kênh đã vào: search_box | search_posts | hashtag_url
    """
    from selenium.webdriver.common.keys import Keys
    from core.browser import wait_and_find, human_sleep, human_type

    tag = (current_tag or "").strip().lstrip("#")
    query = f"#{tag}"

    if reset_home:
        append_session_log(session_id, f"Về trang chủ rồi gõ ô Search «{query}»", "info")
        try:
            driver.get("https://www.facebook.com/")
            human_sleep(2.0, 3.0)
        except Exception as exc:
            append_session_log(session_id, f"Không về được trang chủ: {exc}", "warn")

    typed = False
    try:
        search_el = wait_and_find(driver, _FB_SEARCH_INPUT_LOCATORS, timeout=20)
        _clear_fb_search_input(driver, search_el)
        human_sleep(0.25, 0.45)
        try:
            search_el = wait_and_find(driver, _FB_SEARCH_INPUT_LOCATORS, timeout=8)
        except Exception:
            pass
        human_type(search_el, query)
        human_sleep(0.3, 0.6)
        append_session_log(session_id, f"Đã gõ «{query}» vào ô Search — Enter", "success")
        search_el.send_keys(Keys.ENTER)
        human_sleep(2.5, 3.5)
        typed = True
    except Exception as exc:
        append_session_log(session_id, f"Không gõ được ô Search («{query}»): {exc}", "warn")

    if typed:
        append_session_log(session_id, f"«{query}» — click tab Posts / Bài viết", "info")
        clicked = _click_posts_search_tab(driver, wait_and_find, human_sleep)
        if clicked:
            try:
                cur = (driver.current_url or "").lower()
                if "/search/posts" not in cur and "posts" not in cur:
                    driver.get(f"https://www.facebook.com/search/posts/?q={quote_plus(query)}")
                    human_sleep(2.0, 3.0)
            except Exception:
                pass
            append_session_log(session_id, f"Đã vào kết quả Posts qua ô Search «{query}»", "success")
            return "search_box"

        # Đã gõ nhưng không click được tab → URL search posts
        posts_url = f"https://www.facebook.com/search/posts/?q={quote_plus(query)}"
        append_session_log(session_id, f"Không click được Posts — mở {posts_url}", "warn")
        driver.get(posts_url)
        human_sleep(2.5, 3.5)
        return "search_posts"

    # Không gõ được ô search → fallback URL
    posts_url = f"https://www.facebook.com/search/posts/?q={quote_plus(query)}"
    append_session_log(session_id, f"Fallback search posts: {posts_url}", "warn")
    try:
        driver.get(posts_url)
        human_sleep(2.5, 3.5)
        if check_search_posts_availability(driver):
            return "search_posts"
    except Exception:
        pass

    hashtag_url = f"https://www.facebook.com/hashtag/{quote_plus(tag)}"
    append_session_log(session_id, f"Fallback cuối /hashtag/: {hashtag_url}", "warn")
    driver.get(hashtag_url)
    human_sleep(2.5, 3.5)
    return "hashtag_url"


def check_search_posts_availability(driver) -> bool:
    """True nếu đang ở trang search (posts/top) và không hiện lỗi unavailable."""
    try:
        curr = (driver.current_url or "").lower()
        if "facebook.com/search" not in curr:
            return False
        page_text = driver.execute_script(
            "return (document.body ? (document.body.innerText || '') : '');"
        ).lower()
        for sig in (
            "this content isn't available",
            "isn't available right now",
            "trang này hiện không khả dụng",
            "nội dung này hiện không khả dụng",
        ):
            if sig in page_text:
                return False
        return True
    except Exception:
        return True


def check_hashtag_page_availability(driver) -> Tuple[bool, str]:
    """
    Kiểm tra trang hashtag (fallback cuối) có mở được không.
    Trả về (is_available, unavailable_reason)
    """
    try:
        curr = driver.current_url.lower()
        if "facebook.com/hashtag" not in curr:
            return (False, f"URL chuyển hướng ra ngoài hashtag: {curr}")

        page_text = driver.execute_script(
            "return (document.body ? (document.body.innerText || '') : '');"
        ).lower()

        signatures = [
            ("this content isn't available", "This content isn't available right now"),
            ("isn't available right now", "This content isn't available right now"),
            ("trang này hiện không khả dụng", "Trang này hiện không khả dụng"),
            ("nội dung này hiện không khả dụng", "Nội dung này hiện không khả dụng"),
            ("content not found", "Content Not Found"),
            ("liên kết bạn đã theo dõi có thể bị hỏng", "Liên kết có thể bị hỏng"),
        ]
        for sig, label in signatures:
            if sig in page_text:
                return (False, label)

        return (True, "")
    except Exception:
        return (True, "")


def _fold_hashtag_text(text: str) -> str:
    """Bỏ dấu tiếng Việt để so khớp #thoitrang ≈ #thờitrang."""
    if not text:
        return ""
    norm = unicodedata.normalize("NFD", str(text).lower())
    return "".join(c for c in norm if unicodedata.category(c) != "Mn")


def _post_matches_hashtag(content: str, tags_found: List[str], target_tag: str) -> bool:
    """True nếu bài có hashtag mục tiêu (kể cả khác dấu / hoa thường)."""
    tag = (target_tag or "").lower().lstrip("#").strip()
    if not tag:
        return False
    content_l = (content or "").lower()
    if f"#{tag}" in content_l or tag in [(t or "").lower() for t in tags_found]:
        return True
    tag_f = _fold_hashtag_text(tag)
    content_f = _fold_hashtag_text(content)
    tags_f = {_fold_hashtag_text(t) for t in tags_found}
    if f"#{tag_f}" in content_f or tag_f in tags_f:
        return True
    # Text cắt ngắn đôi khi mất dấu # nhưng còn token hashtag
    if tag_f and re.search(rf"(?<![a-z0-9_]){re.escape(tag_f)}(?![a-z0-9_])", content_f):
        return True
    return False


def extract_hashtag_posts_from_driver(driver, current_tag: str) -> List[Dict[str, Any]]:
    """
    Bóc tách bài viết feed hashtag / search posts.
    Chỉ lấy link tác giả gốc (/tenpage hoặc profile.php?id=…); loại reel/story/watch.
    Không click Follow — chỉ đọc href + chữ hành động.
    """
    extracted_posts: List[Dict[str, Any]] = []
    try:
        script = r"""
        const ACTION_RE = /^(Follow|Following|Theo dõi|Đang theo dõi|Join|Tham gia)$/i;
        const MEDIA_RE = /\/(reels?|stories?|watch|videos?|photos?|posts|permalink|share)(\/|$|\?)|story\.php/i;
        const LPHP_RE = /(?:^|\/)l\.php(?:\?|$)|l\.facebook\.com|lm\.facebook\.com/i;
        const URLISH_NAME_RE = /^(?:https?:\/\/|www\.)|[\w\-]+\.(?:com|vn|net|org|ly|me|shop|store|io)\b/i;
        const posts = [];

        function isFacebookHost(host) {
          const h = (host || '').toLowerCase();
          return h === 'facebook.com' || h === 'www.facebook.com' || h === 'm.facebook.com'
            || h === 'fb.com' || h === 'www.fb.com';
        }

        function isAuthorHref(href) {
          if (!href || href.startsWith('#') || href.includes('/hashtag/') || href.includes('/search/')) return false;
          if (MEDIA_RE.test(href)) return false;
          if (LPHP_RE.test(href)) return false;
          try {
            const u = new URL(href, location.origin);
            if (!isFacebookHost(u.hostname)) return false;
            const path = u.pathname || '';
            if (/\/l\.php$/i.test(path) || path.toLowerCase().includes('/l.php')) return false;
            if (path.includes('profile.php')) {
              return !!(new URLSearchParams(u.search).get('id'));
            }
            const people = path.match(/^\/people\/[^/]+\/(\d{6,})\/?$/i);
            if (people) return true;
            const parts = path.split('/').filter(Boolean);
            // Chỉ 1 đoạn path = link gốc tác giả (không sub-path)
            if (parts.length !== 1) return false;
            const slug = (parts[0] || '').toLowerCase();
            if (slug === 'l.php' || slug === 'ls.php') return false;
            return true;
          } catch (e) { return false; }
        }

        function isMediaHref(href) {
          return !!(href && MEDIA_RE.test(href));
        }

        function looksLikeUrlName(txt) {
          const t = (txt || '').trim();
          if (!t) return true;
          return URLISH_NAME_RE.test(t);
        }

        const articles = Array.from(document.querySelectorAll(
          'div[role="feed"] > div, div[role="article"], div[data-ad-preview="message"]'
        ));
        const elements = articles.length > 0
          ? articles
          : Array.from(document.querySelectorAll('div[data-virtualized="false"]'));

        for (const el of elements) {
            const rawText = (el.innerText || '').trim();
            if (rawText.length < 15) continue;

            let authorLink = '';
            let authorName = '';
            let postLink = '';
            let headerAction = '';

            // Ưu tiên anchor bao quanh ĐÚNG tên tác giả (h2/h3/strong/profile_name)
            const nameAnchors = Array.from(el.querySelectorAll(
              'h2 a[href], h3 a[href], h4 a[href], strong a[href], [data-ad-rendering-role="profile_name"] a[href]'
            ));
            const earlyAnchors = Array.from(el.querySelectorAll('a[role="link"][href], a[href]')).slice(0, 12);

            function tryPickAuthor(anchors, requireNameText) {
              for (const a of anchors) {
                const href = a.getAttribute('href') || '';
                if (!href || href.includes('/hashtag/') || href.includes('/search/') || href.startsWith('#')) continue;
                if (isMediaHref(href)) {
                  if (!postLink) postLink = href;
                  continue;
                }
                if (LPHP_RE.test(href) || !isAuthorHref(href)) continue;
                const txt = (a.innerText || '').trim().replace(/\s+/g, ' ');
                if (ACTION_RE.test(txt)) continue;
                if (txt.length < 2) continue;
                if (looksLikeUrlName(txt)) continue; // tên đã là URL → bỏ
                if (requireNameText && txt.length < 2) continue;
                return { href, name: txt.split('\n')[0].trim() };
              }
              return null;
            }

            let picked = tryPickAuthor(nameAnchors, true);
            if (!picked) picked = tryPickAuthor(earlyAnchors, true);
            if (picked) {
              authorLink = picked.href;
              authorName = picked.name;
            }

            // Chữ hành động gần header — chỉ ĐỌC, không click
            const headerNodes = Array.from(el.querySelectorAll('a, span, div[role="button"]')).slice(0, 40);
            for (const node of headerNodes) {
                const t = (node.innerText || '').trim().replace(/\s+/g, ' ');
                if (ACTION_RE.test(t)) {
                    headerAction = t;
                    break;
                }
            }
            if (!headerAction) {
                const firstLine = rawText.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
                const m = firstLine.match(/[·•|]\s*(Follow|Following|Theo dõi|Đang theo dõi|Join|Tham gia)\s*$/i);
                if (m) headerAction = m[1];
            }

            // Không fallback sang links[0] mù quáng (thường là reel/story/l.php)
            if (!authorLink) continue;

            const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
            const subtitle = lines.length > 1 ? lines.slice(1, 4).join(' • ') : '';

            posts.push({
                author_name: authorName,
                author_url: authorLink,
                author_subtitle: subtitle,
                header_action: headerAction,
                post_url: postLink || authorLink,
                content_text: rawText
            });
        }
        return posts;
        """
        raw_items = driver.execute_script(script) or []
        target_tag_lower = current_tag.lower().lstrip("#")

        for item in raw_items:
            content = item.get("content_text") or ""
            tags_found = [t.lower() for t in re.findall(r"#([\w\d_]+)", content, flags=re.UNICODE)]

            exact_match = _post_matches_hashtag(content, tags_found, target_tag_lower)

            author_url = item.get("author_url") or ""
            author_name = item.get("author_name") or ""
            # Lọc media / l.php / ngoài FB / tên là URL — không mở tab
            if is_media_facebook_url(author_url):
                logger.info(
                    f"[Scanner] skipped_non_author media: name={author_name!r} url={author_url!r}"
                )
                continue
            if author_name_looks_like_url(author_name):
                logger.info(
                    f"[Scanner] skipped_non_author urlish_name: name={author_name!r} url={author_url!r}"
                )
                continue
            ok, _q, skip_reason = is_valid_author_candidate_url(author_url)
            if not ok:
                logger.info(
                    f"[Scanner] skipped_non_author {skip_reason}: name={author_name!r} url={author_url!r}"
                )
                continue

            post_raw_url = item.get("post_url") or author_url
            header_action = (item.get("header_action") or "").strip()

            extracted_posts.append({
                "post_url": post_raw_url,
                "author_name": author_name,
                "author_url": author_url,
                "author_subtitle": item.get("author_subtitle") or "",
                "header_action": header_action,
                "content_text": content[:500],
                "hashtags_in_post": tags_found,
                "exact_match": exact_match,
            })
    except Exception as exc:
        logger.warning(f"[Scanner] Lỗi bóc tách bài viết hashtag: {exc}")

    return extracted_posts


# JS collector: h1 + role=heading + aria-level=1 + text khớp tên trong main.
# arguments[0] = authorName từ feed
_VERIFY_EXTRACT_HEADER_JS = r"""
const authorName = (arguments[0] || '').toString().trim();
const href = (location.href || '');
const mainRoot = document.querySelector('[role="main"]') || document.body;

const GENERIC = new Set([
  'notifications','thông báo','home','trang chủ','search','tìm kiếm',
  'messages','tin nhắn','menu','facebook','feeds','watch','marketplace',
  'groups','nhóm','friends','bạn bè','profile','your profile'
]);

function norm(s) {
  return (s || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
}
function isGeneric(text) {
  const n = norm(text);
  if (!n) return true;
  if (GENERIC.has(n)) return true;
  if (n.startsWith('notification') || n.startsWith('thông báo')) return true;
  return false;
}
function namesMatch(candText, author) {
  const a = norm(author);
  const h = norm(candText);
  if (!a || !h || isGeneric(h)) return false;
  if (h === a || h.indexOf(a) >= 0 || a.indexOf(h) >= 0) return true;
  const strip = t => t.replace(/[^\p{L}\p{N}\s]/gu, '');
  const a2 = strip(a), h2 = strip(h);
  return !!(a2 && h2 && (h2 === a2 || h2.indexOf(a2) >= 0 || a2.indexOf(h2) >= 0));
}
function isVisible(el) {
  if (!el) return false;
  try {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    let p = el;
    for (let i = 0; i < 8 && p; i++) {
      if (p.getAttribute && p.getAttribute('aria-hidden') === 'true') return false;
      p = p.parentElement;
    }
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return false;
    // Không phụ thuộc offsetParent (FB fixed/sticky vẫn hiện)
    return true;
  } catch (e) { return false; }
}
function exactLabel(el) {
  const aria = (el.getAttribute('aria-label') || '').trim();
  const txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
  return { aria, txt };
}
function describeEl(el, source) {
  const text = ((el.innerText || el.textContent || '').trim().split('\n')[0] || '').trim();
  const r = el.getBoundingClientRect();
  return {
    el: el,
    text: text,
    tag: (el.tagName || '').toLowerCase(),
    role: (el.getAttribute('role') || ''),
    visible: isVisible(el),
    aria_hidden: el.getAttribute('aria-hidden') === 'true',
    width: r ? r.width : 0,
    height: r ? r.height : 0,
    generic: isGeneric(text),
    in_main: !!(mainRoot && mainRoot.contains(el)),
    source: source
  };
}
function isPostOnlyContainer(node) {
  if (!node) return false;
  const sample = ((node.innerText || '') + '').slice(0, 1200);
  if (/Actions for this post|Tùy chọn bài viết|Tuỳ chọn bài viết/i.test(sample)) return true;
  const btns = Array.from(node.querySelectorAll('[role="button"], a[role="link"]')).slice(0, 40);
  let profileAction = 0;
  let postOnly = 0;
  for (const el of btns) {
    const t = ((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '')).trim().replace(/\s+/g, ' ');
    if (!t || t.length > 80) continue;
    if (/Theo dõi|Follow|Nhắn tin|Message|Thêm bạn|Add friend|Bạn bè|Friends|Subscribe|Learn more|Call now/i.test(t)) {
      profileAction++;
    } else if (/^(Like|React|Leave a comment|Comment|Share|Thích|Bình luận|Chia sẻ)$/i.test(t)) {
      postOnly++;
    }
  }
  if (postOnly >= 2 && profileAction === 0) return true;
  const fbHits = (sample.match(/\bFacebook\b/gi) || []).length;
  if (fbHits >= 3 && profileAction === 0 && !/(người theo dõi|followers?)/i.test(sample)) return true;
  return false;
}

function getAuthorHeaderRoot(seed, preferCover) {
  if (!seed) return null;
  // preferCover: neo gần đầu main / cover thay vì leo quá sâu vào bài đăng
  if (preferCover && mainRoot) {
    const coverCand = mainRoot.querySelector('[data-pagelet*="Profile"], [data-pagelet*="profile"], [role="banner"]')
      || seed.closest('[data-pagelet]')
      || null;
    if (coverCand && !isPostOnlyContainer(coverCand)) {
      const hasName = namesMatch((coverCand.innerText || '').slice(0, 400), authorName);
      if (hasName || !authorName) return coverCand;
    }
  }
  let best = seed.parentElement;
  let node = seed.parentElement;
  for (let depth = 0; depth < 7 && node; depth++) {
    const role = (node.getAttribute && node.getAttribute('role')) || '';
    if (role === 'main' || role === 'navigation' || role === 'complementary') break;
    if (node === document.body || node === document.documentElement) break;
    try { if ((node.innerText || '').length > 12000) break; } catch (e) {}
    if (isPostOnlyContainer(node)) {
      node = node.parentElement;
      continue;
    }
    best = node;
    const hasAction = Array.from(node.querySelectorAll('[role="button"], a[role="link"], a')).slice(0, 60).some(el => {
      if (el.closest('[role="navigation"]')) return false;
      if (el.closest('[aria-label="Notifications"], [aria-label="Thông báo"]')) return false;
      const t = ((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '')).trim().replace(/\s+/g, ' ');
      if (t.length < 2 || t.length > 80) return false;
      if (/^(Like|React|Leave a comment|Comment|Share)$/i.test(t)) return false;
      return /Theo dõi|Follow|Nhắn tin|Message|Thêm bạn|Add friend|Bạn bè|Friends|Subscribe|Learn more|Call now/i.test(t);
    });
    if (hasAction && depth >= 1) return node;
    node = node.parentElement;
  }
  if (best && isPostOnlyContainer(best)) return null;
  return best;
}

// —— Collector mở rộng (không chỉ h1) ——
const seen = new Set();
const collected = [];
function pushCand(el, source) {
  if (!el || seen.has(el)) return;
  seen.add(el);
  collected.push(describeEl(el, source));
}
Array.from(document.querySelectorAll('h1')).forEach(el => pushCand(el, 'h1'));
Array.from(document.querySelectorAll('[role="heading"]')).forEach(el => pushCand(el, 'heading'));
Array.from(document.querySelectorAll('[aria-level="1"]')).forEach(el => pushCand(el, 'aria-level-1'));
// Trong main: element text ngắn khớp tên tác giả
if (authorName && mainRoot) {
  const want = norm(authorName);
  const walk = Array.from(mainRoot.querySelectorAll('h1, h2, span, div, a, strong')).slice(0, 400);
  for (const el of walk) {
    const t = ((el.innerText || el.textContent || '').trim().split('\n')[0] || '').trim();
    if (!t || t.length > 120) continue;
    if (!namesMatch(t, authorName)) continue;
    // Ưu tiên node gần đúng độ dài tên (tránh cả khối lớn)
    if (Math.abs(norm(t).length - want.length) > Math.max(40, want.length)) continue;
    pushCand(el, 'main_text');
  }
}

const allH1s = collected.map(c => ({
  text: c.text, tag: c.tag, role: c.role, visible: c.visible,
  aria_hidden: c.aria_hidden, width: c.width, height: c.height,
  generic: c.generic, in_main: c.in_main, source: c.source
}));

const authorInMain = !!(authorName && mainRoot && namesMatch(
  ((mainRoot.innerText || '').slice(0, 2500)), authorName
));

let chosenEl = null;
let chosenMeta = null;
if (authorName) {
  // Ưu tiên heading-like visible khớp tên
  const rank = (c) => {
    if (c.source === 'h1') return 0;
    if (c.source === 'heading' || c.source === 'aria-level-1') return 1;
    return 2;
  };
  const ranked = collected.slice().sort((a, b) => rank(a) - rank(b));
  for (const c of ranked) {
    if (!c.visible || c.aria_hidden || c.generic) continue;
    if (c.width <= 0 || c.height <= 0) continue;
    if (!namesMatch(c.text, authorName)) continue;
    chosenEl = c.el;
    chosenMeta = c;
    break;
  }
}

const preferCover = !!(arguments[1]);
const h1Matched = !!chosenEl;
let pageName = chosenMeta ? chosenMeta.text : '';
let headerRoot = chosenEl ? getAuthorHeaderRoot(chosenEl, preferCover) : null;
if (headerRoot && isPostOnlyContainer(headerRoot)) {
  headerRoot = chosenEl ? getAuthorHeaderRoot(chosenEl, true) : null;
  if (headerRoot && isPostOnlyContainer(headerRoot)) headerRoot = null;
}

let headerText = '';
let headerButtons = [];
let headerTabs = [];
let category = '';
let followerText = '';
let headerContainerHint = '';

if (headerRoot && chosenEl) {
  // Chỉ lấy trong container của h1 đúng — không lấy topbar/Notifications / bài đăng
  headerContainerHint = (headerRoot.getAttribute && (headerRoot.getAttribute('data-pagelet') || headerRoot.getAttribute('role'))) || (headerRoot.tagName || '');
  headerText = (headerRoot.innerText || '').slice(0, 1500).replace(/\s+/g, ' ').trim();
  const seenBtn = new Set();
  const nodes = Array.from(headerRoot.querySelectorAll(
    '[role="button"], a[role="link"], a, div[role="button"], [aria-label]'
  )).slice(0, 100);
  for (const el of nodes) {
    if (el.closest('[role="navigation"]')) continue;
    if (el.closest('[aria-label="Notifications"], [aria-label="Thông báo"]')) continue;
    const { aria, txt } = exactLabel(el);
    // Cho phép aria dài hơn (Add Friend + tên)
    const label = (aria && aria.length <= 80) ? aria : txt;
    if (!label || label.length < 2 || label.length > 80) continue;
    if (/notification/i.test(label)) continue;
    const key = label.toLowerCase();
    if (seenBtn.has(key)) continue;
    seenBtn.add(key);
    headerButtons.push(label);
  }
  Array.from(headerRoot.querySelectorAll('[role="tab"]')).slice(0, 24).forEach(t => {
    const lab = (t.innerText || t.getAttribute('aria-label') || '').trim();
    if (lab) headerTabs.push(lab.split('\n')[0].trim());
  });
  const catMatch = headerText.match(/(?:Trang|Page)\s*[·•]\s*([^\n·•|]{2,80})/i);
  if (catMatch) category = catMatch[1].trim();
  const likeFollow = headerText.match(
    /([\d.,]+)\s*(?:nghìn|ngàn|triệu|k|m)?\s*(?:lượt\s*thích|likes?)\s*[·•]\s*([\d.,]+)\s*(?:nghìn|ngàn|triệu|n|k|m)?\s*(?:người\s*theo\s*dõi|followers?)/i
  );
  if (likeFollow) followerText = likeFollow[0];
  else {
    const mFl = headerText.match(
      /([\d]+(?:[.,][\d]+)*)\s*(nghìn|ngàn|triệu|n|k|tr|m)?\s*(người\s*theo\s*dõi|followers?)\b/i
    );
    if (mFl) followerText = mFl[0];
  }
}

const mainSample = ((mainRoot && mainRoot.innerText) || '').slice(0, 3500);
let isVerified = null;
if (headerRoot && headerRoot.querySelector('[aria-label*="Verified"], [aria-label*="Đã xác minh"], [aria-label*="Xác minh"]')) {
  isVerified = true;
}
let avatarUrl = null;
if (headerRoot) {
  const img = headerRoot.querySelector('image, img[src*="scontent"], svg image');
  if (img) {
    avatarUrl = img.getAttribute('xlink:href') || img.getAttribute('href') || img.getAttribute('src') || null;
  }
}

// Có dòng phụ / nút / follower trong container → header "đủ"
const hasSubtitle = !!(followerText || category ||
  /(?:Trang|Page)\s*[·•]|người theo dõi|followers?|lượt thích|likes?/i.test(headerText));
const headerReady = h1Matched && (!!hasSubtitle || headerButtons.length > 0);

return {
  page_name: pageName,
  page_url: href,
  header_text: headerText,
  header_buttons: headerButtons,
  header_tabs: headerTabs,
  follower_text: followerText,
  category: category,
  main_sample: mainSample.slice(0, 2000),
  is_verified: isVerified,
  avatar_url: avatarUrl,
  header_root_found: !!headerRoot,
  header_container_selector: headerContainerHint || '',
  h1_found: h1Matched,
  h1_matched_author: h1Matched,
  header_ready: headerReady,
  author_in_main: authorInMain,
  all_h1s: allH1s.slice(0, 30),
  author_name_arg: authorName,
  chosen_tag: chosenMeta ? (chosenMeta.tag || '') : '',
  chosen_source: chosenMeta ? (chosenMeta.source || '') : '',
  prefer_cover: preferCover
};
"""


_VERIFY_ABOUT_TEXT_JS = r"""
const body = (document.body && document.body.innerText) ? document.body.innerText : '';
let category = '';
const catMatch = body.match(/(?:Hạng mục|Category)\s*[:\n]\s*([^\n]{2,80})/i);
if (catMatch) category = catMatch[1].trim();
return { about_text: body.slice(0, 5000), category: category };
"""

VERIFY_AUTHOR_DEADLINE_SEC = 15.0
VERIFY_PAGE_LOAD_TIMEOUT_SEC = 18.0
_FIXTURE_DUMP_PATH = None  # set khi cần dump live


def _remaining_timeout(deadline: float, step_cap: float) -> float:
    left = max(0.05, deadline - time.time())
    return min(step_cap, left)


def _deadline_exceeded(deadline: float) -> bool:
    return time.time() >= deadline


def _is_tab_closed_exc(exc: BaseException) -> bool:
    """NoSuchWindow / target closed / invalid session khi tab verify bị đóng."""
    name = type(exc).__name__
    msg = str(exc).lower()
    if name in ("NoSuchWindowException", "NoSuchFrameException"):
        return True
    if "no such window" in msg or "target window already closed" in msg:
        return True
    if "web view not found" in msg or "invalid session id" in msg:
        return True
    if name == "WebDriverException" and (
        "no such window" in msg or "already closed" in msg or "not connected" in msg
    ):
        return True
    return False


def _ensure_scanner_page_load_timeout(driver) -> None:
    try:
        driver.set_page_load_timeout(int(VERIFY_PAGE_LOAD_TIMEOUT_SEC))
    except Exception:
        pass


def _window_stop(driver) -> None:
    """Chặn load tiếp sau khi header đã đủ — không chờ vòng xoay."""
    try:
        driver.execute_script("try { window.stop(); } catch (e) {}")
    except Exception:
        pass


def _probe_header_name_follower(driver, author_name: str) -> Dict[str, Any]:
    """
    Probe nhẹ: tên + follower trong vùng chính/header.
    Không chờ readyState complete / spinner biến mất.
    """
    script = r"""
const authorName = (arguments[0] || '').toString().trim();
function norm(s) {
  return (s || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
}
const main = document.querySelector('[role="main"]') || document.body;
const sample = ((main && main.innerText) || '').slice(0, 3500);
const sampleN = norm(sample);
const nameN = norm(authorName);
const hasName = !!(nameN && sampleN.indexOf(nameN) >= 0);
const flRe = /([\d]+(?:[.,][\d]+)*)\s*(nghìn|ngàn|triệu|n|k|tr|m)?\s*(người\s*theo\s*dõi|followers?)\b/i;
const likeFl = /(?:lượt\s*thích|likes?)\s*[·•].*(?:người\s*theo\s*dõi|followers?)/i;
const hasFollower = flRe.test(sample) || likeFl.test(sample);
let spinner = false;
try {
  const spins = document.querySelectorAll('[role="progressbar"], [aria-busy="true"], svg[aria-valuetext]');
  for (const el of spins) {
    const r = el.getBoundingClientRect();
    if (r && r.width > 8 && r.height > 8) { spinner = true; break; }
  }
} catch (e) {}
return {
  has_name: hasName,
  has_follower: hasFollower,
  readyState: (document.readyState || ''),
  spinner: spinner,
  sample_len: sample.length
};
"""
    try:
        return driver.execute_script(script, author_name or "") or {}
    except Exception as exc:
        if _is_tab_closed_exc(exc):
            raise
        logger.debug(f"[Scanner] probe header: {exc}")
        return {}


def _read_header_signals(
    driver,
    author_name: str = "",
    *,
    prefer_cover: bool = False,
) -> Dict[str, Any]:
    try:
        return driver.execute_script(
            _VERIFY_EXTRACT_HEADER_JS, author_name or "", bool(prefer_cover)
        ) or {}
    except Exception as exc:
        if _is_tab_closed_exc(exc):
            raise
        logger.warning(f"[Scanner] _read_header_signals exception: {exc}")
        return {"_extract_error": str(exc)[:200]}


def _format_all_h1s_log(all_h1s: Any) -> str:
    rows = []
    for h in (all_h1s or [])[:30]:
        if not isinstance(h, dict):
            continue
        rows.append(
            f"tag={h.get('tag') or h.get('source')!r} text={h.get('text')!r} "
            f"visible={h.get('visible')} hidden={h.get('aria_hidden')} "
            f"generic={h.get('generic')} size={h.get('width')}x{h.get('height')} "
            f"src={h.get('source')!r}"
        )
    return " | ".join(rows) if rows else "(none)"


def _safe_current_url(driver) -> Tuple[Optional[str], Optional[str]]:
    """Đọc current_url; không nuốt exception — trả (url_or_None, error_or_None)."""
    try:
        url = driver.current_url
        if url is None:
            return None, "current_url_returned_None"
        return str(url), None
    except Exception as exc:
        if _is_tab_closed_exc(exc):
            raise
        logger.warning(f"[Scanner] đọc current_url exception: {exc}")
        return None, f"{type(exc).__name__}:{exc}"


def _open_and_switch_verify_tab(
    driver,
    author_url: str,
    cleaned_author: str,
    deadline: float,
    main_handle: str,
) -> Tuple[Optional[str], Optional[str], Dict[str, Any]]:
    """
    window.open → chờ handle mới → switch → chờ current_url chứa slug/id tác giả.
    Trả (new_handle, current_url, meta). meta.reason = tab_switch_failed nếu lỗi.
    """
    meta: Dict[str, Any] = {
        "main_handle": main_handle,
        "handles_before": list(driver.window_handles),
    }
    before = set(driver.window_handles)
    try:
        driver.execute_script("window.open(arguments[0], '_blank');", author_url)
    except Exception as exc:
        meta["reason"] = "tab_switch_failed"
        meta["detail"] = f"window_open_exc:{exc}"
        logger.warning(f"[Scanner] window.open exception: {exc}")
        return None, None, meta

    tab_wait_end = time.time() + _remaining_timeout(deadline, 2.5)
    opened: List[str] = []
    while time.time() < tab_wait_end and not opened:
        opened = list(set(driver.window_handles) - before)
        if opened:
            break
        time.sleep(0.12)
    if not opened:
        handles = list(driver.window_handles)
        meta["handles_after"] = handles
        if len(handles) <= 1:
            meta["reason"] = "tab_switch_failed"
            meta["detail"] = "no_new_handle"
            return None, None, meta
        new_handle = handles[-1]
    else:
        new_handle = opened[0]

    meta["new_handle"] = new_handle
    meta["handles_after"] = list(driver.window_handles)
    try:
        driver.switch_to.window(new_handle)
    except Exception as exc:
        meta["reason"] = "tab_switch_failed"
        meta["detail"] = f"switch_exc:{exc}"
        logger.warning(f"[Scanner] switch_to window exception: {exc}")
        return None, None, meta

    # Timeout + chặn media ngay sau switch — trước khi poll URL/header
    _ensure_scanner_page_load_timeout(driver)
    try:
        meta["cdp_blocked"] = _cdp_block_heavy_resources(driver)
    except Exception:
        meta["cdp_blocked"] = False

    # Chờ URL ổn định & khớp tác giả (không chờ document complete)
    curr: Optional[str] = None
    url_err: Optional[str] = None
    url_deadline = time.time() + _remaining_timeout(deadline, 4.0)
    ok_url = False
    url_detail = "pending"
    while time.time() < url_deadline:
        curr, url_err = _safe_current_url(driver)
        if url_err:
            meta["url_error"] = url_err
        if curr:
            ok_url, url_detail = author_tab_url_matches(curr, cleaned_author)
            if ok_url:
                break
            cl = curr.lower()
            if cl not in ("about:blank", "") and url_detail not in (
                "blank_tab",
                "empty_current_url",
            ):
                # URL đã resolve nhưng không phải author → fail sớm
                break
        time.sleep(0.12)
    else:
        curr, url_err = _safe_current_url(driver)
        if url_err:
            meta["url_error"] = url_err
        if curr:
            ok_url, url_detail = author_tab_url_matches(curr, cleaned_author)
        else:
            ok_url, url_detail = False, url_err or "empty_current_url"

    meta["current_url"] = curr
    meta["url_match"] = ok_url
    meta["url_detail"] = url_detail
    logger.info(
        f"[Scanner] tab switch: main={main_handle!r} new={new_handle!r}"
        f" handles={len(meta.get('handles_after') or [])}"
        f" current_url={curr!r} match={ok_url} detail={url_detail!r}"
        f" url_err={url_err!r}"
    )

    if not curr or not ok_url:
        meta["reason"] = "tab_switch_failed"
        meta["detail"] = url_detail if curr else (url_err or "empty_current_url")
        return new_handle, curr, meta

    meta["reason"] = "ok"
    return new_handle, curr, meta


def _wait_header_ready(
    driver,
    deadline: float,
    author_name: str = "",
    poll_sec: float = 0.5,
) -> Dict[str, Any]:
    """
    Chỉ chờ tên tác giả + follower trong vùng chính/header (poll 0.5s).
    Không chờ readyState complete, không chờ spinner biến mất, không chờ network idle.
    Đủ → window.stop() → đọc header đầy đủ.
    """
    last_probe: Dict[str, Any] = {}
    while not _deadline_exceeded(deadline):
        last_probe = _probe_header_name_follower(driver, author_name)
        has_name = bool(last_probe.get("has_name"))
        has_fl = bool(last_probe.get("has_follower"))
        # Đủ tên + follower → dừng load rồi extract
        if has_name and has_fl:
            _window_stop(driver)
            info = _read_header_signals(driver, author_name)
            info["readyState"] = last_probe.get("readyState")
            info["spinner"] = last_probe.get("spinner")
            info["probed_early"] = True
            logger.info(
                f"[Scanner] header đủ (name+follower) readyState={last_probe.get('readyState')!r}"
                f" spinner={last_probe.get('spinner')} — window.stop() rồi đọc"
            )
            return info
        # Có tên + nút hành động (profile không follower) — vẫn stop & đọc
        if has_name:
            peek = _read_header_signals(driver, author_name)
            if peek.get("h1_matched_author") and (
                peek.get("follower_text")
                or peek.get("header_buttons")
                or peek.get("category")
            ):
                _window_stop(driver)
                peek["readyState"] = last_probe.get("readyState")
                peek["spinner"] = last_probe.get("spinner")
                peek["probed_early"] = True
                return peek
        time.sleep(min(poll_sec, _remaining_timeout(deadline, poll_sec)))

    # Hết deadline — thử stop + đọc lần cuối (có thể thiếu follower)
    _window_stop(driver)
    info = _read_header_signals(driver, author_name) or {}
    info["readyState"] = last_probe.get("readyState")
    info["spinner"] = last_probe.get("spinner")
    info["probed_early"] = False
    info["probe_has_name"] = last_probe.get("has_name")
    info["probe_has_follower"] = last_probe.get("has_follower")
    if not info.get("h1_matched_author") and not last_probe.get("has_name"):
        info["_page_load_timeout"] = True
    return info


def _fetch_about_text(driver, author_url: str, deadline: float) -> Dict[str, Any]:
    try:
        cleaned = clean_page_url(author_url) or author_url
        about_url = build_about_url(cleaned)
        if not about_url or _deadline_exceeded(deadline):
            return {}
        try:
            driver.get(about_url)
        except Exception as get_exc:
            # Timeout / eager: trang có thể đã có nội dung — tiếp tục nếu còn cửa sổ
            if _is_tab_closed_exc(get_exc):
                raise
            logger.debug(f"[Scanner] about get (có thể timeout): {get_exc}")
        wait_left = _remaining_timeout(deadline, 2.0)
        time.sleep(min(0.4, wait_left))
        if _deadline_exceeded(deadline):
            return {}
        _window_stop(driver)
        return driver.execute_script(_VERIFY_ABOUT_TEXT_JS) or {}
    except Exception as exc:
        if _is_tab_closed_exc(exc):
            raise
        logger.debug(f"[Scanner] about fetch lỗi: {exc}")
        return {}


def _is_media_current_url(url: str) -> bool:
    lower = (url or "").lower()
    return any(
        x in lower
        for x in ("/reel", "/stories", "/story", "/watch", "/reels/")
    )


def _cdp_block_heavy_resources(driver) -> bool:
    """Chặn ảnh/video/font trên tab hiện tại. Trả True nếu bật được."""
    try:
        driver.execute_cdp_cmd("Network.enable", {})
        driver.execute_cdp_cmd(
            "Network.setBlockedURLs",
            {
                "urls": [
                    "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.svg",
                    "*.mp4", "*.webm", "*.m4v",
                    "*.woff", "*.woff2", "*.ttf", "*.otf",
                ]
            },
        )
        return True
    except Exception:
        return False


def _cdp_unblock_resources(driver) -> None:
    try:
        driver.execute_cdp_cmd("Network.setBlockedURLs", {"urls": []})
    except Exception:
        pass


def _dump_classify_fixture(signals: Dict[str, Any], entity: str, reason: str) -> None:
    """Ghi một mẫu header khi chạy live (append JSONL) để bổ sung fixture."""
    try:
        import os
        dump_dir = os.path.join(os.path.dirname(__file__), "fixtures")
        os.makedirs(dump_dir, exist_ok=True)
        path = os.path.join(dump_dir, "classify_headers_live.jsonl")
        row = {
            "page_name": signals.get("page_name"),
            "url": signals.get("page_url"),
            "header_text": (signals.get("header_text") or "")[:800],
            "header_buttons": signals.get("header_buttons") or [],
            "header_tabs": signals.get("header_tabs") or [],
            "follower_text": signals.get("follower_text") or "",
            "entity": entity,
            "reason": reason,
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _cache_is_definitive(result: Optional[Dict[str, Any]]) -> bool:
    """Chỉ PAGE chắc / PROFILE reject cứng mới được cache — không cache soft-fail."""
    if not result or not isinstance(result, dict):
        return False
    if result.get("_soft_fail"):
        return False
    if result.get("_verify_rejected"):
        return True
    if result.get("page_key") and not result.get("_soft_fail"):
        return True
    return False


def _cache_lookup(
    author_cache: Optional[Dict[str, Any]],
    author_url: str,
) -> Optional[Dict[str, Any]]:
    if not author_cache:
        return None
    key = author_verify_cache_key(author_url)
    if not key or "l.php" in key.lower():
        return None
    hit = author_cache.get(key)
    if hit is not None and _cache_is_definitive(hit):
        return dict(hit)
    # Tương thích key cũ = cleaned URL
    cleaned = clean_page_url(author_url) or author_url
    if cleaned and "l.php" not in cleaned.lower():
        hit2 = author_cache.get(cleaned)
        if hit2 is not None and _cache_is_definitive(hit2):
            return dict(hit2)
    page_key, _ = extract_page_identifier(cleaned)
    if page_key and "l.php" not in page_key.lower():
        hit3 = author_cache.get(f"page_key:{page_key}") or author_cache.get(page_key)
        if hit3 is not None and _cache_is_definitive(hit3):
            return dict(hit3)
    return None


def _cache_store(
    author_cache: Optional[Dict[str, Any]],
    author_url: str,
    result: Dict[str, Any],
) -> None:
    """Chỉ ghi cache kết quả dứt khoát (PAGE / PROFILE). Không ghi soft-fail / l.php."""
    if author_cache is None or not author_url:
        return
    if not _cache_is_definitive(result):
        return
    key = author_verify_cache_key(author_url)
    if not key or "l.php" in key.lower():
        return
    author_cache[key] = dict(result)
    cleaned = clean_page_url(author_url) or ""
    if cleaned and "l.php" not in cleaned.lower():
        author_cache[cleaned] = dict(result)
    pk = result.get("page_key")
    if pk and "l.php" not in str(pk).lower():
        author_cache[f"page_key:{pk}"] = dict(result)
        author_cache[pk] = dict(result)


def _feed_tab_still_alive(driver, main_handle: Optional[str]) -> bool:
    try:
        handles = list(driver.window_handles or [])
    except Exception:
        return False
    if not handles:
        return False
    if main_handle and main_handle in handles:
        return True
    # Feed có thể đổi handle — còn ≥1 tab khác coi như còn phiên
    return len(handles) >= 1


def verify_and_extract_page_in_new_tab(
    driver,
    author_url: str,
    *,
    author_name: str = "",
    author_cache: Optional[Dict[str, Any]] = None,
    deadline_sec: float = VERIFY_AUTHOR_DEADLINE_SEC,
    dump_fixture: bool = True,
) -> Optional[Dict[str, Any]]:
    """
    Mở tab verify (window.open), chờ tên+follower rồi classify.
    Không chờ page load complete / spinner. Tab đóng → soft-fail, không ném lên phiên.
    """
    if not author_url:
        return None
    if is_media_facebook_url(author_url):
        logger.info(f"[Scanner] verify bỏ qua media url: {author_url}")
        return None
    ok_url, _aq, skip_r = is_valid_author_candidate_url(author_url)
    if not ok_url:
        logger.info(f"[Scanner] skipped_non_author {skip_r}: url={author_url!r}")
        return None
    if author_name_looks_like_url(author_name):
        logger.info(f"[Scanner] skipped_non_author urlish_name: name={author_name!r}")
        return None

    cleaned_author = clean_page_url(author_url) or author_url
    if "l.php" in cleaned_author.lower():
        logger.info(f"[Scanner] skipped_non_author lphp_cleaned: {cleaned_author!r}")
        return None
    author_name = (author_name or "").strip()
    if author_cache:
        purge_invalid_author_cache_keys(author_cache)
    cached = _cache_lookup(author_cache, author_url) or _cache_lookup(author_cache, cleaned_author)
    if cached is not None:
        cached["_cache_hit"] = True
        logger.info(f"[Scanner] verify cache hit: {author_verify_cache_key(author_url) or cleaned_author}")
        return cached

    deadline = time.time() + max(5.0, float(deadline_sec or VERIFY_AUTHOR_DEADLINE_SEC))
    try:
        main_handle = driver.current_window_handle
    except Exception as exc:
        if _is_tab_closed_exc(exc):
            return {
                "_soft_fail": True,
                "reason": "tab_closed_by_user_or_error",
                "detail": "feed_or_session_gone_before_verify",
                "_feed_gone": True,
            }
        raise
    new_handle = None
    cdp_on = False
    curr_url: Optional[str] = None
    try:
        _ensure_scanner_page_load_timeout(driver)
        new_handle, curr_url, switch_meta = _open_and_switch_verify_tab(
            driver, author_url, cleaned_author, deadline, main_handle
        )
        if switch_meta.get("reason") == "tab_switch_failed":
            # Phân biệt đóng tab vs switch fail thường
            detail = switch_meta.get("detail") or "tab_switch_failed"
            reason = "tab_switch_failed"
            if "no such window" in str(detail).lower() or "closed" in str(detail).lower():
                reason = "tab_closed_by_user_or_error"
            out = {
                "_soft_fail": True,
                "reason": reason,
                "detail": detail,
                "current_url": curr_url,
                "cleaned_author": cleaned_author,
                "main_handle": switch_meta.get("main_handle"),
                "new_handle": switch_meta.get("new_handle"),
                "handles": len(switch_meta.get("handles_after") or []),
                "url_error": switch_meta.get("url_error"),
                "_feed_gone": not _feed_tab_still_alive(driver, main_handle),
            }
            return out

        # CDP có thể đã bật trong _open_and_switch; bật lại an toàn nếu chưa
        cdp_on = bool(switch_meta.get("cdp_blocked")) or _cdp_block_heavy_resources(driver)

        if _deadline_exceeded(deadline):
            # Vẫn thử đọc nếu header đã có (không coi timeout Selenium là lỗi cứng)
            try:
                _window_stop(driver)
                info_early = _read_header_signals(driver, author_name)
                if info_early.get("h1_matched_author") and (
                    info_early.get("follower_text") or info_early.get("header_buttons")
                ):
                    info = info_early
                    info["readyState"] = info.get("readyState")
                    info["probed_early"] = True
                else:
                    probe_rs = None
                    probe_sp = None
                    try:
                        pr = _probe_header_name_follower(driver, author_name)
                        probe_rs, probe_sp = pr.get("readyState"), pr.get("spinner")
                    except Exception:
                        pass
                    return {
                        "_soft_fail": True,
                        "reason": "page_load_timeout",
                        "detail": "deadline_before_read",
                        "current_url": curr_url,
                        "header_text": (info_early or {}).get("header_text"),
                        "header_buttons": (info_early or {}).get("header_buttons"),
                        "follower_text": (info_early or {}).get("follower_text"),
                        "all_h1s": (info_early or {}).get("all_h1s"),
                        "all_h1s_log": _format_all_h1s_log((info_early or {}).get("all_h1s")),
                        "readyState": (info_early or {}).get("readyState") or probe_rs,
                        "spinner": (info_early or {}).get("spinner") if (info_early or {}).get("spinner") is not None else probe_sp,
                        "header_container_selector": (info_early or {}).get("header_container_selector") or "",
                        "header_valid": False,
                    }
            except Exception as early_exc:
                if _is_tab_closed_exc(early_exc):
                    raise
                return {
                    "_soft_fail": True,
                    "reason": "page_load_timeout",
                    "detail": "deadline_before_read",
                    "current_url": curr_url,
                    "header_valid": False,
                    "readyState": None,
                    "spinner": None,
                }
        else:
            info = _wait_header_ready(driver, deadline, author_name=author_name, poll_sec=0.5)
        # Refresh URL sau khi chờ header (có thể navigate)
        curr2, url_err2 = _safe_current_url(driver)
        if curr2:
            curr_url = curr2
        elif url_err2:
            logger.warning(f"[Scanner] current_url sau header: {url_err2}")

        def _soft_out(reason: str, detail: str = "", **extra: Any) -> Dict[str, Any]:
            """Soft-fail thống nhất log — không cache."""
            base = {
                "_soft_fail": True,
                "reason": reason,
                "detail": detail,
                "header_text": (info.get("header_text") or "")[:400],
                "header_buttons": list(info.get("header_buttons") or []),
                "header_tabs": list(info.get("header_tabs") or []),
                "follower_text": (info.get("follower_text") or "").strip(),
                "page_name": (info.get("page_name") or "").strip(),
                "current_url": curr_url,
                "readyState": info.get("readyState"),
                "spinner": info.get("spinner"),
                "header_container_selector": info.get("header_container_selector") or "",
                "header_valid": extra.pop("header_valid", False),
                "all_h1s_log": _format_all_h1s_log(info.get("all_h1s")),
                "author_name": author_name,
            }
            base.update(extra)
            return base

        page_name = (info.get("page_name") or "").strip()
        follower_raw = (info.get("follower_text") or "").strip()
        header_text = info.get("header_text") or ""
        header_buttons = list(info.get("header_buttons") or [])
        header_tabs = list(info.get("header_tabs") or [])
        main_sample = info.get("main_sample") or ""
        all_h1s = info.get("all_h1s") or []
        h1s_log = _format_all_h1s_log(all_h1s)

        # Probe readyState/spinner nếu extract chưa có
        if info.get("readyState") is None or info.get("spinner") is None:
            try:
                probe = _probe_header_name_follower(driver, author_name)
                if info.get("readyState") is None:
                    info["readyState"] = probe.get("readyState")
                if info.get("spinner") is None:
                    info["spinner"] = probe.get("spinner")
            except Exception:
                pass

        logger.info(
            f"[Scanner] header probe readyState={info.get('readyState')!r}"
            f" spinner={info.get('spinner')!r} matched={info.get('h1_matched_author')}"
            f" follower={follower_raw!r}"
            f" container={info.get('header_container_selector')!r}"
        )

        # Không lấy được heading khớp tên tác giả
        if not info.get("h1_matched_author"):
            detail = "page_load_timeout" if info.get("_page_load_timeout") else "no_author_h1"
            reason = "page_load_timeout" if info.get("_page_load_timeout") else "load"
            logger.warning(
                f"[Scanner] không tìm heading khớp {author_name!r}."
                f" current_url={curr_url!r} readyState={info.get('readyState')!r}"
                f" spinner={info.get('spinner')!r} candidates: {h1s_log}"
            )
            return _soft_out(reason, detail, header_valid=False, all_h1s=all_h1s,
                             chosen_tag=info.get("chosen_tag"),
                             author_in_main=info.get("author_in_main"))

        # Header vẫn là Notifications (phòng thủ)
        _ht0 = header_text.strip().lower()
        if _ht0 == "notifications" or _ht0.startswith("notifications"):
            logger.warning(
                f"[Scanner] header vẫn Notifications sau chọn heading. candidates: {h1s_log}"
            )
            return _soft_out("load", "header_still_notifications", header_valid=False, all_h1s=all_h1s)

        load_ok = bool(page_name) and bool(header_text)
        if not load_ok:
            return _soft_out("load", "no_header", header_valid=False, all_h1s=all_h1s)

        # Phân biệt header hợp lệ vs container bài đăng
        header_ok, header_why = is_valid_profile_header(
            header_text=header_text,
            header_buttons=header_buttons,
            follower_text=follower_raw,
            category=info.get("category") or "",
            page_name=page_name,
        )
        if not header_ok:
            # Retry 1 lần: cuộn đầu trang + prefer_cover
            if not _deadline_exceeded(deadline):
                try:
                    driver.execute_script("try { window.scrollTo(0, 0); } catch (e) {}")
                    time.sleep(min(0.35, _remaining_timeout(deadline, 0.35)))
                    _window_stop(driver)
                    info_retry = _read_header_signals(driver, author_name, prefer_cover=True)
                    if info_retry.get("readyState") is None:
                        try:
                            probe2 = _probe_header_name_follower(driver, author_name)
                            info_retry["readyState"] = probe2.get("readyState")
                            info_retry["spinner"] = probe2.get("spinner")
                        except Exception:
                            pass
                    pn2 = (info_retry.get("page_name") or "").strip()
                    fl2 = (info_retry.get("follower_text") or "").strip()
                    ht2 = info_retry.get("header_text") or ""
                    hb2 = list(info_retry.get("header_buttons") or [])
                    ok2, why2 = is_valid_profile_header(
                        header_text=ht2,
                        header_buttons=hb2,
                        follower_text=fl2,
                        category=info_retry.get("category") or "",
                        page_name=pn2,
                    )
                    if ok2 and info_retry.get("h1_matched_author"):
                        info = info_retry
                        page_name = pn2
                        follower_raw = fl2
                        header_text = ht2
                        header_buttons = hb2
                        header_tabs = list(info_retry.get("header_tabs") or [])
                        main_sample = info_retry.get("main_sample") or main_sample
                        all_h1s = info_retry.get("all_h1s") or all_h1s
                        h1s_log = _format_all_h1s_log(all_h1s)
                        header_ok, header_why = True, why2
                        logger.info(
                            f"[Scanner] header retry prefer_cover OK reason={why2!r}"
                            f" buttons={header_buttons[:6]!r}"
                        )
                    else:
                        logger.warning(
                            f"[Scanner] header_not_found after retry: why={why2!r}"
                            f" first_why={header_why!r}"
                            f" readyState={info_retry.get('readyState')!r}"
                            f" spinner={info_retry.get('spinner')!r}"
                            f" container={info_retry.get('header_container_selector')!r}"
                            f" header={ht2[:160]!r} buttons={hb2[:8]!r}"
                        )
                        info = info_retry or info
                        return _soft_out(
                            "header_not_found",
                            why2 or header_why,
                            header_valid=False,
                            header_invalid_reason=why2 or header_why,
                            all_h1s=info.get("all_h1s"),
                        )
                except Exception as retry_exc:
                    if _is_tab_closed_exc(retry_exc):
                        raise
                    logger.warning(f"[Scanner] header retry error: {retry_exc}")
                    return _soft_out(
                        "header_not_found",
                        header_why,
                        header_valid=False,
                        header_invalid_reason=header_why,
                    )
            else:
                return _soft_out(
                    "header_not_found",
                    header_why,
                    header_valid=False,
                    header_invalid_reason=header_why,
                )

        entity, reason, debug = classify_page_entity(
            url=info.get("page_url") or author_url,
            header_text=header_text,
            header_buttons=header_buttons,
            header_tabs=header_tabs,
            about_text="",
            main_sample=main_sample,
        )

        # /about chỉ khi thiếu follower VÀ thiếu friend signal
        if entity == "UNKNOWN" and should_open_about(
            entity, header_text, header_buttons, header_tabs
        ):
            if not _deadline_exceeded(deadline):
                about = _fetch_about_text(driver, cleaned_author, deadline)
                about_text = about.get("about_text") or ""
                if about.get("category") and not info.get("category"):
                    info["category"] = about["category"]
                entity, reason, debug = classify_page_entity(
                    url=info.get("page_url") or author_url,
                    header_text=header_text,
                    header_buttons=header_buttons,
                    header_tabs=header_tabs,
                    about_text=about_text,
                    main_sample=main_sample,
                )
                # Quay lại trang chính nếu cần follower (còn thời gian)
                if entity == "PAGE" and not follower_raw and not _deadline_exceeded(deadline):
                    try:
                        try:
                            driver.get(cleaned_author)
                        except Exception as nav_exc:
                            if _is_tab_closed_exc(nav_exc):
                                raise
                            logger.debug(f"[Scanner] reload author (timeout ok): {nav_exc}")
                        time.sleep(min(0.4, _remaining_timeout(deadline, 0.4)))
                        _window_stop(driver)
                        info2 = _read_header_signals(driver, author_name, prefer_cover=True)
                        if info2.get("follower_text"):
                            follower_raw = (info2.get("follower_text") or "").strip()
                            info["follower_text"] = follower_raw
                        if info2.get("page_name"):
                            page_name = (info2.get("page_name") or page_name).strip()
                        if info2.get("header_buttons"):
                            header_buttons = list(info2.get("header_buttons") or header_buttons)
                    except Exception as reload_exc:
                        if _is_tab_closed_exc(reload_exc):
                            raise
                        pass

        if dump_fixture:
            _dump_classify_fixture(info, entity, reason)

        elapsed = time.time() - (deadline - max(5.0, float(deadline_sec or VERIFY_AUTHOR_DEADLINE_SEC)))
        logger.info(
            f"[Scanner] classify={entity} reason={reason!r} name={page_name!r}"
            f" elapsed={elapsed:.1f}s readyState={info.get('readyState')!r}"
            f" spinner={info.get('spinner')!r} buttons={header_buttons[:6]!r}"
            f" follower={follower_raw!r} header_valid={header_ok}"
            f" friend_zone={debug.get('friend_zone')!r}"
            f" friend_src={debug.get('friend_signal_source')!r}"
            f" header={header_text[:120]!r}"
        )

        if entity == "PROFILE":
            out = {
                "_verify_rejected": True,
                "reason": f"profile:{reason}",
                "classify_reason": reason,
                "friend_button_debug": {
                    "zone": debug.get("friend_zone") or "header",
                    "label": debug.get("friend_button"),
                    "source": debug.get("friend_signal_source") or "none",
                    "buttons": header_buttons[:10],
                },
                "header_text": header_text[:400],
                "header_buttons": header_buttons,
                "follower_text": follower_raw,
                "header_valid": True,
                "readyState": info.get("readyState"),
                "spinner": info.get("spinner"),
            }
            _cache_store(author_cache, author_url, out)
            return out

        if entity != "PAGE":
            # Header hợp lệ nhưng không đủ tín hiệu → UNKNOWN, không cache, không retry
            return _soft_out(
                "unknown",
                reason or "no_strong_signal",
                header_valid=True,
                header_invalid_reason="",
                classify_reason=reason,
            )

        if reason == "fallback_page_no_friend_signal":
            logger.info(
                f"[Scanner] FALLBACK PAGE: {page_name!r} reason={reason}"
                f" friend_zone={debug.get('friend_zone')!r}"
                f" friend_signal_source={debug.get('friend_signal_source')!r}"
                f" header={header_text[:200]!r} buttons={header_buttons!r}"
            )

        if not page_name or not follower_raw:
            return _soft_out(
                "load",
                "page_missing_name_or_follower",
                header_valid=True,
                classify_reason=reason,
            )

        page_url = clean_page_url(info.get("page_url") or author_url)
        if is_media_facebook_url(page_url):
            return _soft_out("wrong_url", page_url, header_valid=True)
        page_key, quality = extract_page_identifier(page_url)
        if not page_key or quality == "weak":
            return _soft_out("unknown", "weak_page_key", header_valid=True)

        follower_count, follower_text = parse_follower_count(follower_raw)
        if follower_count is None:
            return _soft_out("load", "follower_parse_fail", header_valid=True)

        out = {
            "page_key": page_key,
            "page_name": page_name,
            "page_url": page_url,
            "avatar_url": info.get("avatar_url"),
            "category": info.get("category") or "",
            "follower_count": follower_count,
            "follower_text": follower_text or follower_raw,
            "is_verified": info.get("is_verified"),
            "is_sponsored": False,
            "identifier_quality": quality,
            "classify_reason": reason,
            "header_text": header_text[:400],
            "header_buttons": header_buttons,
            "header_valid": True,
            "friend_zone": debug.get("friend_zone"),
            "friend_signal_source": debug.get("friend_signal_source"),
            "readyState": info.get("readyState"),
            "spinner": info.get("spinner"),
        }
        _cache_store(author_cache, author_url, out)
        return out
    except Exception as exc:
        if _is_tab_closed_exc(exc):
            feed_alive = _feed_tab_still_alive(driver, main_handle)
            logger.warning(
                f"[Scanner] tab verify đóng giữa chừng ({author_url}): {exc}"
                f" · feed_alive={feed_alive}"
            )
            out = {
                "_soft_fail": True,
                "reason": "tab_closed_by_user_or_error",
                "detail": f"{type(exc).__name__}:{exc}"[:240],
                "current_url": curr_url,
                "_feed_gone": not feed_alive,
            }
            # Không cache — lần sau / batch sau có thể thử lại
            return out
        logger.warning(f"[Scanner] Lỗi xác minh Page tab mới ({author_url}): {exc}")
        return {"_soft_fail": True, "reason": "load", "detail": str(exc)[:200]}
    finally:
        try:
            handles_now = list(driver.window_handles or [])
        except Exception:
            handles_now = []
        try:
            if cdp_on and new_handle and new_handle in handles_now:
                driver.switch_to.window(new_handle)
                _cdp_unblock_resources(driver)
        except Exception:
            pass
        try:
            if new_handle and new_handle in handles_now:
                driver.switch_to.window(new_handle)
                driver.close()
        except Exception:
            pass
        try:
            handles_now = list(driver.window_handles or [])
            if main_handle and main_handle in handles_now:
                driver.switch_to.window(main_handle)
            elif handles_now:
                driver.switch_to.window(handles_now[0])
        except Exception:
            pass


def _feed_post_keys_and_height(driver, current_tag: str) -> Tuple[frozenset, int]:
    posts = extract_hashtag_posts_from_driver(driver, current_tag)
    keys = frozenset(p["post_url"] for p in posts if p.get("post_url"))
    try:
        h = int(
            driver.execute_script(
                "return document.documentElement.scrollHeight || document.body.scrollHeight || 0;"
            )
            or 0
        )
    except Exception:
        h = 0
    return keys, h


def _wait_feed_settle_after_scroll(
    driver,
    current_tag: str,
    keys_before: frozenset,
    scroll_h_before: int,
    timeout_sec: float = 6.0,
    poll_sec: float = 0.5,
) -> None:
    """Chờ feed đổi (post keys hoặc scrollHeight) sau scroll — chỉ dẫn 2.5 / 3.2."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        time.sleep(poll_sec)
        keys_now, h_now = _feed_post_keys_and_height(driver, current_tag)
        if keys_now != keys_before or h_now != scroll_h_before:
            return


def _acquire_page_scanner_browser(
    target_uid: str,
    owner: str,
    proxy: Any,
    cookie_str: str,
    headless: bool,
    allow_direct_fallback: bool,
) -> Tuple[Any, bool, Any, bool]:
    """
    1 browser / 1 acc trong scope page_scanner:
    - Có driver đúng uid → tái sử dụng (không mở thêm).
    - Không có → đóng mọi driver page_scanner (acc cũ) rồi mở mới cho uid này.
    Trả về (driver, created_new_driver, lock, acquired_lock).
    """
    from core.browser import (
        close_driver_for_uid,
        get_active_drivers,
        get_profile_lock,
        load_cookies,
        open_browser,
        close_scoped_active_drivers,
    )

    active = get_active_drivers(target_uid, owner=owner, scope="page_scanner")
    if active:
        logger.info(f"[{target_uid}] Tái sử dụng Chrome page_scanner đang mở")
        try:
            _ensure_scanner_page_load_timeout(active[0])
        except Exception:
            pass
        return active[0], False, None, False

    # Đổi acc hoặc phiên đầu: dọn browser scope cũ rồi mở mới
    try:
        close_scoped_active_drivers(scope="page_scanner", force=True)
    except Exception:
        pass

    lock = get_profile_lock(target_uid, owner=owner)
    acquired_lock = lock.acquire(timeout=8)
    if not acquired_lock:
        raise RuntimeError(f"Profile của nick {target_uid} đang bị khóa bởi tiến trình khác")

    driver = None
    try:
        driver = open_browser(
            uid=target_uid,
            owner=owner,
            proxy=proxy,
            scope="page_scanner",
            headless=headless,
            verify_egress=False,
            allow_direct_fallback=allow_direct_fallback,
        )
        if cookie_str:
            load_cookies(driver, cookie_str)
    except Exception:
        # Nơi gọi không nhận được lock khi hàm này ném lỗi → phải tự nhả ở đây,
        # nếu không profile bị khóa vĩnh viễn (kể cả Module 02) tới khi restart app.
        if driver is not None:
            try:
                close_driver_for_uid(target_uid, owner=owner)
            except Exception:
                pass
        lock.release()
        raise

    try:
        _ensure_scanner_page_load_timeout(driver)
    except Exception:
        pass
    return driver, True, lock, True


def _release_page_scanner_browser(
    stop_reason: str,
    keep_browser: bool,
    acquired_lock: bool,
    lock: Any,
) -> None:
    """
    Giữ Chrome nếu phiên kết thúc bình thường và keep_browser=True (job kế cùng acc).
    Đóng scope khi dừng khẩn cấp / lỗi / hết đợt (keep_browser=False).
    """
    force_close = stop_reason in ("USER_STOPPED", "CHECKPOINT", "ERROR")
    should_close = force_close or not keep_browser

    if acquired_lock and lock:
        try:
            lock.release()
        except Exception:
            pass

    if should_close:
        try:
            from core.browser import close_scoped_active_drivers
            close_scoped_active_drivers(scope="page_scanner", force=True)
        except Exception:
            pass


def run_hashtag_search_flow(
    hashtags: List[str],
    context_keywords: Optional[List[str]] = None,
    min_posts: int = 2,
    max_posts_per_hashtag: int = 100,
    account_uid: Optional[str] = None,
    owner_key: str = "system",
    headless: bool = False,
    allow_direct_fallback: bool = True,
    session_id: Optional[int] = None,
    campaign_id: Optional[str] = None,
    keep_browser: bool = False,
    min_followers: int = 1000,
    target_pages: Optional[int] = None,
    idle_timeout_s: float = 90.0,
) -> Dict[str, Any]:
    """
    Quét Fanpage theo Hashtag:
    1. Gõ #tag vào ô Search Facebook → tab Posts (fallback search/posts → /hashtag/).
    2. exact_match + header_action (chỉ loại Join/Group).
    3. Tab phụ xác minh Page + follower; chỉ lưu follower_count > min_followers.
    4. Dừng TARGET_REACHED khi đủ target_pages; idle_timeout_s không có page mới đạt lọc.
    max_posts_per_hashtag chỉ là giới hạn an toàn số bài/tag.
    """
    clean_tags = parse_hashtags_input(hashtags)
    if not clean_tags:
        raise ValueError("Danh sách hashtag không được để trống")

    context_kws = [k.strip() for k in (context_keywords or []) if k.strip()]
    max_posts = max(10, min(max_posts_per_hashtag, 300))
    min_posts = max(1, min(min_posts, 10))
    min_followers = max(0, int(min_followers or 0))
    idle_timeout_s = max(5.0, float(idle_timeout_s or 90.0))
    if target_pages is not None:
        target_pages = max(1, int(target_pages))

    # 1. Chọn tài khoản & Preflight check
    account = get_scraping_account(account_uid, owner_key=owner_key)
    if not account:
        raise RuntimeError("Không tìm thấy tài khoản Facebook nào hợp lệ trong Module 02 để quét")

    target_uid = str(account.get("uid") or "").strip()
    owner = account.get("user_id") or owner_key
    cookie_str = account.get("cookie") or ""
    proxy = account.get("proxy")

    # 2. Tạo phiên RUNNING (nếu chưa có)
    tag_keyword = ", ".join(f"#{t}" for t in clean_tags)
    session_max_results = target_pages if target_pages is not None else max_posts * len(clean_tags)
    if session_id is None:
        session_id = create_scan_session(
            owner_key=owner_key,
            keyword=tag_keyword,
            account_uid=target_uid,
            source_type="HASHTAG",
            max_results=session_max_results,
            settings={
                "hashtags": clean_tags,
                "context_keywords": context_kws,
                "min_posts": min_posts,
                "max_posts_per_hashtag": max_posts,
                "min_followers": min_followers,
                "target_pages": target_pages,
                "idle_timeout_s": idle_timeout_s,
                "headless": headless,
                "allow_direct_fallback": allow_direct_fallback,
                "keep_browser": keep_browser,
            },
            campaign_id=campaign_id,
        )

    with _ACTIVE_SESSIONS_LOCK:
        if session_id not in _ACTIVE_STOP_EVENTS:
            _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        if session_id not in _ACTIVE_PAUSE_EVENTS:
            _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()
        stop_event = _ACTIVE_STOP_EVENTS[session_id]

    # 3. Biến trạng thái phiên
    posts_kho: Set[str] = set()
    candidates: Dict[str, Dict[str, Any]] = {}
    # Chỉ chứa author đã xác nhận Profile / không phải Page
    rejected_author_urls: Set[str] = set()
    # Cache quyết định verify (chỉ PAGE / PROFILE cứng) theo page_key trong phiên
    author_verify_cache: Dict[str, Any] = {}
    purge_invalid_author_cache_keys(author_verify_cache)
    page_kho: Dict[str, Dict[str, Any]] = {}
    seen_batch_signatures: Set[frozenset] = set()
    batch_no = 0
    total_posts_scanned = 0
    total_posts_matched = 0
    total_authors_seen = 0
    total_pages_excluded_filter = 0
    pending_verify_count = 0
    stop_reason = "COMPLETED"
    error_message: Optional[str] = None
    start_time = time.time()
    last_qualified_at = start_time
    stagnant_scroll_streak = 0
    use_container_scroll = False

    MAX_SCROLL_BATCHES = 200
    NO_NEW_LIMIT = 5
    MAX_DURATION_SEC = 900

    driver = None
    created_new_driver = False
    lock = None
    acquired_lock = False

    try:
        from core.browser import human_sleep

        try:
            driver, created_new_driver, lock, acquired_lock = _acquire_page_scanner_browser(
                target_uid=target_uid,
                owner=owner,
                proxy=proxy,
                cookie_str=cookie_str,
                headless=headless,
                allow_direct_fallback=allow_direct_fallback,
            )
        except RuntimeError as lock_err:
            stop_reason = "CHECKPOINT"
            error_message = str(lock_err)
            finalize_scan_session(session_id, "PARTIAL", stop_reason, 0, 0, 0, 0, 0, 0, error_message)
            return {"session_id": session_id, "count": 0, "pages": [], "stop_reason": stop_reason}

        append_session_log(
            session_id,
            (
                f"Hashtag · tags={clean_tags} · max_posts/tag={max_posts}"
                f" · min_fl>{min_followers} · target_pages={target_pages or '∞'}"
                f" · idle={idle_timeout_s}s"
                f" · {'mới' if created_new_driver else 'tái sử dụng'} Chrome {target_uid}"
            ),
            "warn",
        )

        # 4. Quét từng hashtag
        for current_tag in clean_tags:
            if stop_event.is_set():
                stop_reason = "USER_STOPPED"
                break

            elapsed = int(time.time() - start_time)
            if elapsed >= MAX_DURATION_SEC:
                stop_reason = "TIMEOUT"
                break

            if time.time() - last_qualified_at >= idle_timeout_s:
                stop_reason = "NO_NEW_RESULTS"
                append_session_log(
                    session_id,
                    f"Idle {idle_timeout_s:.0f}s không có Page mới đạt lọc — dừng phiên",
                    "warn",
                )
                break

            logger.info(f"[{target_uid}] Bắt đầu quét hashtag #{current_tag} qua ô Search")
            nav_channel = navigate_hashtag_via_search_box(
                driver,
                current_tag,
                session_id,
                reset_home=True,
            )
            append_session_log(
                session_id,
                f"#{current_tag} sẵn sàng quét (kênh={nav_channel})",
                "info",
            )

            tag_posts_count = 0
            no_new_streak = 0
            stagnant_scroll_streak = 0
            use_container_scroll = False

            while tag_posts_count < max_posts:
                if _wait_if_paused(session_id, stop_event):
                    stop_reason = "USER_STOPPED"
                    break
                batch_no += 1
                if stop_event.is_set():
                    stop_reason = "USER_STOPPED"
                    break

                # Idle: chỉ tính theo Page mới đạt lọc đã lưu
                if time.time() - last_qualified_at >= idle_timeout_s:
                    stop_reason = "NO_NEW_RESULTS"
                    append_session_log(
                        session_id,
                        f"Idle {idle_timeout_s:.0f}s không có Page mới đạt lọc — dừng phiên",
                        "warn",
                    )
                    break

                elapsed = int(time.time() - start_time)
                if elapsed >= MAX_DURATION_SEC:
                    stop_reason = "TIMEOUT"
                    break

                if target_pages is not None and len(page_kho) >= target_pages:
                    stop_reason = "TARGET_REACHED"
                    break

                curr_url = driver.current_url.lower()
                if "checkpoint" in curr_url or "login" in curr_url:
                    stop_reason = "CHECKPOINT"
                    error_message = "Tài khoản bị dính checkpoint hoặc mất đăng nhập Facebook"
                    break

                posts = extract_hashtag_posts_from_driver(driver, current_tag)
                # Feed search/hashtag đã lọc theo query — text DOM thường cắt "Xem thêm"
                # nên thiếu #tag dù FB đã match. Cho phép verify khi đang đúng kênh search.
                if nav_channel in ("search_box", "search_posts", "hashtag_url"):
                    for _p in posts:
                        if not _p.get("exact_match") and _p.get("author_url"):
                            _p["exact_match"] = True
                            _p["match_reason"] = "search_feed_context"

                new_posts = [p for p in posts if p.get("post_url") and p["post_url"] not in posts_kho]
                new_posts_count = len(new_posts)

                post_keys = [p["post_url"] for p in posts if p.get("post_url")]
                signature = frozenset(post_keys)
                # CYCLE chỉ khi lặp chữ ký VÀ đã hết bài mới liên tiếp đủ NO_NEW_LIMIT
                # (trước đây dừng ngay batch 2 → không kịp mở tab verify)
                seen_before = bool(signature and signature in seen_batch_signatures)
                if signature:
                    seen_batch_signatures.add(signature)

                if new_posts_count == 0:
                    no_new_streak += 1
                    if no_new_streak >= NO_NEW_LIMIT:
                        stop_reason = "CYCLE_DETECTED" if seen_before else "NO_NEW_RESULTS"
                        append_session_log(
                            session_id,
                            (
                                f"#{current_tag}: {stop_reason} sau {NO_NEW_LIMIT} batch"
                                f" (extract={len(posts)}, chưa mở thêm tab)"
                            ),
                            "info",
                        )
                        break
                else:
                    no_new_streak = 0

                batch_verified_pages: List[Dict[str, Any]] = []
                batch_skip_nomatch = 0

                append_session_log(
                    session_id,
                    (
                        f"#{current_tag} batch#{batch_no}: extract={len(posts)}"
                        f" · mới={new_posts_count}"
                        f" · match={sum(1 for x in new_posts if x.get('exact_match'))}"
                    ),
                    "info",
                )

                # Dedupe verify trong cùng batch (kể cả soft-fail)
                batch_verify_attempted: Set[str] = set()

                for p in new_posts:
                    # Idle giữa các tác giả trong batch — không chờ hết batch
                    if time.time() - last_qualified_at >= idle_timeout_s:
                        stop_reason = "NO_NEW_RESULTS"
                        append_session_log(
                            session_id,
                            (
                                f"Idle {idle_timeout_s:.0f}s không có Page mới đạt lọc"
                                f" — dừng trong batch (không verify tiếp)"
                            ),
                            "warn",
                        )
                        break

                    if target_pages is not None and len(page_kho) >= target_pages:
                        stop_reason = "TARGET_REACHED"
                        break

                    posts_kho.add(p["post_url"])
                    total_posts_scanned += 1
                    tag_posts_count += 1

                    if not p.get("exact_match"):
                        batch_skip_nomatch += 1
                        continue
                    total_posts_matched += 1

                    # Chỉ loại ngay khi Join/Group; còn lại đưa tab xác minh
                    action_kind, _action_reason = classify_header_action(p.get("header_action") or "")
                    if action_kind == "GROUP":
                        continue

                    total_authors_seen += 1
                    author_url = p.get("author_url") or ""
                    author_name = p.get("author_name") or ""
                    cleaned_author = clean_page_url(author_url) or author_url

                    # Chặn trước khi mở tab: media / l.php / ngoài FB / tên là URL
                    if author_name_looks_like_url(author_name):
                        append_session_log(
                            session_id,
                            (
                                f"skipped_non_author urlish_name: {author_name}"
                                f" · raw={author_url!r} · không mở tab"
                            ),
                            "info",
                        )
                        continue
                    ok_author, _aq, skip_reason = is_valid_author_candidate_url(author_url)
                    if not ok_author:
                        append_session_log(
                            session_id,
                            (
                                f"skipped_non_author {skip_reason}: {author_name}"
                                f" · raw={author_url!r} · cleaned={cleaned_author!r}"
                                f" · không mở tab"
                            ),
                            "info",
                        )
                        continue

                    cand_key = normalize_page_candidate_key(author_name, cleaned_author)

                    if cand_key in candidates:
                        cand = candidates[cand_key]
                        cand["hashtag_post_count"] = int(cand.get("hashtag_post_count") or 0) + 1
                        cand.setdefault("matched_hashtags", set()).add(current_tag)
                        ev = cand.setdefault("evidence_posts", [])
                        if p["post_url"] and p["post_url"] not in ev and len(ev) < 3:
                            ev.append(p["post_url"])
                        if cand.get("verified_page_key") and cand["verified_page_key"] in page_kho:
                            entry = page_kho[cand["verified_page_key"]]
                            entry["matched_hashtags"].add(current_tag)
                            entry["hashtag_post_count"] = cand["hashtag_post_count"]
                            if p["post_url"] and p["post_url"] not in entry["evidence_posts"] and len(entry["evidence_posts"]) < 3:
                                entry["evidence_posts"].append(p["post_url"])
                            score, status, reasons = calculate_page_relevance_score(
                                hashtag_post_count=entry["hashtag_post_count"],
                                matched_hashtags=list(entry["matched_hashtags"]),
                                page_name=entry["page_name"],
                                category=entry.get("category") or "",
                                context_keywords=context_kws,
                                min_posts=min_posts,
                                latest_post_at=entry.get("latest_post_at") or "",
                            )
                            entry["relevance_score"] = score
                            entry["relevance_status"] = status
                            entry["relevance_reasons"] = reasons
                            batch_verified_pages.append(entry)
                        continue

                    if cleaned_author in rejected_author_urls:
                        continue

                    # Dedupe trong batch: đã thử (kể cả soft-fail) → không verify lại
                    if cleaned_author in batch_verify_attempted:
                        append_session_log(
                            session_id,
                            (
                                f"Verify skipped (batch attempted): {author_name}"
                                f" · cleaned={cleaned_author!r}"
                            ),
                            "info",
                        )
                        continue

                    # Cache hit — chỉ PAGE / PROFILE cứng (không cache soft-fail)
                    cached = _cache_lookup(author_verify_cache, author_url) or _cache_lookup(
                        author_verify_cache, cleaned_author
                    )
                    if cached is not None:
                        append_session_log(
                            session_id,
                            (
                                f"Verify cache hit: {author_name}"
                                f" · key={author_verify_cache_key(author_url) or cleaned_author!r}"
                                f" · reason={cached.get('reason') or cached.get('classify_reason')!r}"
                            ),
                            "info",
                        )
                        verified = dict(cached)
                        verified["_cache_hit"] = True
                        batch_verify_attempted.add(cleaned_author)
                    else:
                        candidates[cand_key] = {
                            "candidate_key": cand_key,
                            "author_name": author_name,
                            "author_url": cleaned_author,
                            "matched_hashtags": {current_tag},
                            "hashtag_post_count": 1,
                            "evidence_posts": [p["post_url"]] if p.get("post_url") else [],
                            "header_action": p.get("header_action"),
                            "verified_page_key": None,
                            "verify_status": "PENDING",
                        }

                        append_session_log(
                            session_id,
                            f"Verify mở tab: {author_name} · raw={author_url!r} · cleaned={cleaned_author!r}",
                            "info",
                        )

                        batch_verify_attempted.add(cleaned_author)
                        # Chỉ retry khi tab_switch_failed — không retry no_author_h1/UNKNOWN
                        verified = verify_and_extract_page_in_new_tab(
                            driver,
                            cleaned_author,
                            author_name=author_name,
                            author_cache=author_verify_cache,
                            deadline_sec=VERIFY_AUTHOR_DEADLINE_SEC,
                        )
                        if (
                            verified
                            and verified.get("_soft_fail")
                            and verified.get("reason") == "tab_switch_failed"
                        ):
                            append_session_log(
                                session_id,
                                f"Retry verify (tab_switch_failed): {author_name}",
                                "warn",
                            )
                            verified = verify_and_extract_page_in_new_tab(
                                driver,
                                cleaned_author,
                                author_name=author_name,
                                author_cache=author_verify_cache,
                                deadline_sec=VERIFY_AUTHOR_DEADLINE_SEC,
                            )

                    if cand_key not in candidates:
                        candidates[cand_key] = {
                            "candidate_key": cand_key,
                            "author_name": author_name,
                            "author_url": cleaned_author,
                            "matched_hashtags": {current_tag},
                            "hashtag_post_count": 1,
                            "evidence_posts": [p["post_url"]] if p.get("post_url") else [],
                            "header_action": p.get("header_action"),
                            "verified_page_key": None,
                            "verify_status": "PENDING",
                        }

                    if verified and verified.get("_verify_rejected"):
                        rejected_author_urls.add(cleaned_author)
                        candidates[cand_key]["verify_status"] = "REJECTED"
                        fdbg = verified.get("friend_button_debug") or {}
                        append_session_log(
                            session_id,
                            (
                                f"Phân loại PROFILE — reject: {author_name}"
                                f" · reason={verified.get('reason')!r}"
                                f" · friend_zone={fdbg.get('zone')!r}"
                                f" · friend_signal_source={fdbg.get('source')!r}"
                                f" · buttons={verified.get('header_buttons')!r}"
                                f" · header={verified.get('header_text')!r}"
                            ),
                            "info",
                        )
                        continue

                    if not verified or verified.get("_soft_fail") or not verified.get("page_key"):
                        candidates[cand_key]["verify_status"] = "PENDING"
                        soft = verified or {}
                        append_session_log(
                            session_id,
                            (
                                f"Soft-fail {soft.get('reason') or 'empty'}:"
                                f" {author_name}"
                                f" · detail={soft.get('detail') or soft.get('classify_reason')!r}"
                                f" · header_valid={soft.get('header_valid')!r}"
                                f" · header_invalid_reason={soft.get('header_invalid_reason') or soft.get('detail')!r}"
                                f" · header_container_selector={soft.get('header_container_selector')!r}"
                                f" · header={soft.get('header_text')!r}"
                                f" · buttons={soft.get('header_buttons')!r}"
                                f" · follower={soft.get('follower_text')!r}"
                                f" · readyState={soft.get('readyState')!r}"
                                f" · spinner={soft.get('spinner')!r}"
                                f" · all_h1s={soft.get('all_h1s_log') or soft.get('all_h1s')!r}"
                                f" · current_url={soft.get('current_url')!r}"
                                f" · không reject · không cache"
                            ),
                            "warn",
                        )
                        candidates.pop(cand_key, None)
                        # Tab verify đóng: chỉ dừng phiên nếu tab feed cũng mất
                        if soft.get("reason") == "tab_closed_by_user_or_error":
                            feed_gone = bool(soft.get("_feed_gone"))
                            if not feed_gone:
                                try:
                                    feed_gone = not _feed_tab_still_alive(
                                        driver, driver.current_window_handle
                                    )
                                except Exception:
                                    feed_gone = True
                            if feed_gone:
                                stop_reason = "USER_STOPPED"
                                error_message = "Tab feed/browser đã đóng — dừng phiên (USER_STOPPED)"
                                append_session_log(
                                    session_id,
                                    "Tab feed không còn — dừng phiên USER_STOPPED (không ERROR)",
                                    "warn",
                                )
                                break
                            append_session_log(
                                session_id,
                                "Tab verify đóng — tiếp tục tác giả tiếp theo (feed còn sống)",
                                "info",
                            )
                        continue

                    reason = verified.get("classify_reason") or ""
                    if reason == "fallback_page_no_friend_signal":
                        append_session_log(
                            session_id,
                            (
                                f"FALLBACK PAGE: {verified.get('page_name') or author_name}"
                                f" · reason={reason}"
                                f" · friend_zone={verified.get('friend_zone')!r}"
                                f" · friend_signal_source={verified.get('friend_signal_source')!r}"
                                f" · header={verified.get('header_text')!r}"
                                f" · buttons={verified.get('header_buttons')!r}"
                            ),
                            "warn",
                        )
                    else:
                        append_session_log(
                            session_id,
                            (
                                f"Phân loại PAGE: {verified.get('page_name') or author_name}"
                                f" · reason={reason!r}"
                                f" · key={verified.get('page_key')}"
                                f" · cache={bool(verified.get('_cache_hit'))}"
                            ),
                            "info",
                        )

                    fl_count = verified.get("follower_count")
                    if fl_count is None or int(fl_count) <= min_followers:
                        total_pages_excluded_filter += 1
                        candidates[cand_key]["verify_status"] = "EXCLUDED_FOLLOWERS"
                        append_session_log(
                            session_id,
                            (
                                f"Excluded (follower): {verified.get('page_name') or author_name}"
                                f" FL={fl_count} ≤ {min_followers}"
                            ),
                            "info",
                        )
                        # Đã xác minh nhưng không đạt lọc — không mở lại cùng URL trong phiên
                        rejected_author_urls.add(cleaned_author)
                        continue

                    page_key = verified["page_key"]
                    candidates[cand_key]["verified_page_key"] = page_key
                    candidates[cand_key]["verify_status"] = "VERIFIED"

                    is_new_qualified = page_key not in page_kho
                    if is_new_qualified:
                        page_kho[page_key] = {
                            **verified,
                            "matched_hashtags": set(candidates[cand_key]["matched_hashtags"]),
                            "hashtag_post_count": candidates[cand_key]["hashtag_post_count"],
                            "evidence_posts": list(candidates[cand_key]["evidence_posts"]),
                            "latest_post_at": "Gần đây",
                        }
                        last_qualified_at = time.time()
                    else:
                        entry = page_kho[page_key]
                        entry["matched_hashtags"].update(candidates[cand_key]["matched_hashtags"])
                        entry["hashtag_post_count"] = max(
                            int(entry.get("hashtag_post_count") or 0),
                            candidates[cand_key]["hashtag_post_count"],
                        )
                        for evu in candidates[cand_key]["evidence_posts"]:
                            if evu not in entry["evidence_posts"] and len(entry["evidence_posts"]) < 3:
                                entry["evidence_posts"].append(evu)
                        if verified.get("follower_count") is not None:
                            entry["follower_count"] = verified["follower_count"]
                            entry["follower_text"] = verified.get("follower_text")
                        if verified.get("category"):
                            entry["category"] = verified["category"]
                        if verified.get("avatar_url"):
                            entry["avatar_url"] = verified["avatar_url"]

                    entry = page_kho[page_key]
                    score, status, reasons = calculate_page_relevance_score(
                        hashtag_post_count=entry["hashtag_post_count"],
                        matched_hashtags=list(entry["matched_hashtags"]),
                        page_name=entry["page_name"],
                        category=entry.get("category") or "",
                        context_keywords=context_kws,
                        min_posts=min_posts,
                        latest_post_at=entry.get("latest_post_at") or "",
                    )
                    entry["relevance_score"] = score
                    entry["relevance_status"] = status
                    entry["relevance_reasons"] = reasons
                    batch_verified_pages.append(entry)
                    append_session_log(
                        session_id,
                        f"Xác minh Page OK: {entry.get('page_name')} FL={entry.get('follower_count')}",
                        "success",
                    )

                if stop_reason == "TARGET_REACHED":
                    break

                if batch_verified_pages:
                    uniq = {pg["page_key"]: pg for pg in batch_verified_pages}
                    save_batch_pages(
                        session_id,
                        owner_key,
                        batch_no,
                        list(uniq.values()),
                        target_uid,
                        "HASHTAG",
                    )

                pending_verify_count = sum(
                    1 for c in candidates.values() if c.get("verify_status") == "PENDING"
                )
                rel_count = sum(1 for pg in page_kho.values() if pg.get("relevance_status") == "RELEVANT")
                rev_count = sum(1 for pg in page_kho.values() if pg.get("relevance_status") == "REVIEW")
                exc_count = total_pages_excluded_filter + sum(
                    1 for pg in page_kho.values() if pg.get("relevance_status") == "EXCLUDED"
                )

                try:
                    db.execute(
                        """
                        UPDATE page_scan_sessions
                        SET total_seen = %s, total_unique = %s, total_duplicates = 0,
                            total_sponsored = 0, batches_count = %s, duration_seconds = %s,
                            total_posts_scanned = %s, total_posts_matched = %s,
                            total_authors_seen = %s, total_pages_relevant = %s,
                            total_pages_review = %s, total_pages_excluded = %s
                        WHERE id = %s
                        """,
                        (
                            total_posts_scanned,
                            len(page_kho),
                            batch_no,
                            int(time.time() - start_time),
                            total_posts_scanned,
                            total_posts_matched,
                            total_authors_seen,
                            rel_count,
                            rev_count,
                            exc_count,
                            session_id,
                        ),
                    )
                except Exception:
                    pass

                if target_pages is not None and len(page_kho) >= target_pages:
                    stop_reason = "TARGET_REACHED"
                    break

                if batch_no >= MAX_SCROLL_BATCHES:
                    stop_reason = "MAX_SCROLLS"
                    break

                keys_before, scroll_h_before = _feed_post_keys_and_height(driver, current_tag)
                try:
                    scroll_y_before = int(
                        driver.execute_script("return window.scrollY || 0;") or 0
                    )
                except Exception:
                    scroll_y_before = 0
                _scroll_results_step(driver, use_container=use_container_scroll)
                try:
                    human_sleep(1.5, 3.5, config=getattr(driver, "browser_config", None))
                except Exception:
                    time.sleep(2.0)
                _wait_feed_settle_after_scroll(driver, current_tag, keys_before, scroll_h_before)

                try:
                    scroll_y_after = int(
                        driver.execute_script("return window.scrollY || 0;") or 0
                    )
                    scroll_h_after = int(
                        driver.execute_script(
                            "return document.documentElement.scrollHeight || document.body.scrollHeight || 0;"
                        )
                        or 0
                    )
                except Exception:
                    scroll_y_after, scroll_h_after = scroll_y_before, scroll_h_before

                if scroll_y_after == scroll_y_before and scroll_h_after == scroll_h_before:
                    stagnant_scroll_streak += 1
                else:
                    stagnant_scroll_streak = 0
                if stagnant_scroll_streak >= 2 and not use_container_scroll:
                    use_container_scroll = True
                    append_session_log(
                        session_id,
                        "Hashtag scroll đứng yên — chuyển cuộn container",
                        "warn",
                    )

            if stop_reason in [
                "USER_STOPPED",
                "CHECKPOINT",
                "TIMEOUT",
                "CYCLE_DETECTED",
                "MAX_SCROLLS",
                "TARGET_REACHED",
                "NO_NEW_RESULTS",
            ]:
                break

        pending_verify_count = sum(
            1 for c in candidates.values() if c.get("verify_status") == "PENDING"
        )
        if pending_verify_count:
            append_session_log(
                session_id,
                f"{pending_verify_count} ứng viên còn PENDING_VERIFY — không tính kết quả hoàn chỉnh",
                "warn",
            )

    except Exception as exc:
        if _is_tab_closed_exc(exc):
            logger.warning(
                f"[Scanner] Cửa sổ đóng giữa phiên hashtag #{session_id}: {exc}"
            )
            stop_reason = "USER_STOPPED"
            error_message = f"Browser/tab đóng: {exc}"
            try:
                append_session_log(
                    session_id,
                    "Tab/browser đóng — dừng USER_STOPPED (không ERROR)",
                    "warn",
                )
            except Exception:
                pass
        else:
            logger.error(f"[Scanner] Lỗi thực thi phiên hashtag #{session_id}: {exc}", exc_info=True)
            stop_reason = "ERROR"
            error_message = str(exc)
    finally:
        with _ACTIVE_SESSIONS_LOCK:
            _ACTIVE_STOP_EVENTS.pop(session_id, None)
            _ACTIVE_PAUSE_EVENTS.pop(session_id, None)

        duration = int(time.time() - start_time)
        # Idle NO_NEW_RESULTS: đã có Page đạt lọc → PARTIAL; không có → COMPLETED (quy ước cũ)
        if stop_reason == "NO_NEW_RESULTS" and len(page_kho) > 0:
            final_status = "PARTIAL"
        elif stop_reason in ["TARGET_REACHED", "NO_NEW_RESULTS", "CYCLE_DETECTED", "END_MARKER"]:
            final_status = "COMPLETED"
        else:
            final_status = "PARTIAL"
        if stop_reason == "ERROR":
            final_status = "FAILED"
        elif stop_reason == "USER_STOPPED":
            final_status = "STOPPED"

        finalize_scan_session(
            session_id=session_id,
            status=final_status,
            stop_reason=stop_reason,
            total_seen=total_posts_scanned,
            total_unique=len(page_kho),
            total_duplicates=0,
            total_sponsored=0,
            batches_count=batch_no,
            duration_seconds=duration,
            error_message=error_message,
        )

        _release_page_scanner_browser(
            stop_reason=stop_reason,
            keep_browser=keep_browser,
            acquired_lock=acquired_lock,
            lock=lock,
        )

    # Trả về bản sao an toàn JSON: matched_hashtags đang là set trong page_kho,
    # chuyển thành list đã sắp xếp để nơi gọi (API/test) serialize không lỗi.
    result_pages: List[Dict[str, Any]] = []
    for _pg in page_kho.values():
        _pg = dict(_pg)
        if isinstance(_pg.get("matched_hashtags"), (set, frozenset)):
            _pg["matched_hashtags"] = sorted(_pg["matched_hashtags"])
        result_pages.append(_pg)

    return {
        "session_id": session_id,
        "count": len(page_kho),
        "pages": result_pages,
        "stop_reason": stop_reason,
        "status": final_status,
        "error_message": error_message,
    }


def start_hashtag_search_background(
    hashtags: List[str],
    context_keywords: Optional[List[str]] = None,
    min_posts: int = 2,
    max_posts_per_hashtag: int = 100,
    account_uid: Optional[str] = None,
    owner_key: str = "system",
    headless: bool = False,
    allow_direct_fallback: bool = True,
    campaign_id: Optional[str] = None,
    keep_browser: bool = False,
    min_followers: int = 1000,
    target_pages: Optional[int] = None,
    idle_timeout_s: float = 90.0,
) -> int:
    """
    Khởi động phiên tìm kiếm Fanpage theo Hashtag trong background daemon thread.
    Trả về ngay session_id để client theo dõi tiến độ realtime.
    Chữ ký mở rộng (tuỳ chọn): min_followers, target_pages, idle_timeout_s.
    """
    clean_tags = parse_hashtags_input(hashtags)
    if not clean_tags:
        raise ValueError("Vui lòng nhập ít nhất một hashtag hợp lệ")

    max_posts = max(10, min(max_posts_per_hashtag, 300))
    min_posts = max(1, min(min_posts, 10))
    min_followers = max(0, int(min_followers or 0))
    idle_timeout_s = max(5.0, float(idle_timeout_s or 90.0))
    if target_pages is not None:
        target_pages = max(1, int(target_pages))

    account = get_scraping_account(account_uid, owner_key=owner_key)
    if not account:
        raise RuntimeError("Không tìm thấy tài khoản Facebook nào hợp lệ trong Module 02 để quét")

    target_uid = str(account.get("uid") or "").strip()
    tag_keyword = ", ".join(f"#{t}" for t in clean_tags)
    session_max_results = target_pages if target_pages is not None else max_posts * len(clean_tags)

    # 1. Tạo bản ghi phiên RUNNING trong DB
    session_id = create_scan_session(
        owner_key=owner_key,
        keyword=tag_keyword,
        account_uid=target_uid,
        source_type="HASHTAG",
        max_results=session_max_results,
        settings={
            "hashtags": clean_tags,
            "context_keywords": context_keywords or [],
            "min_posts": min_posts,
            "max_posts_per_hashtag": max_posts,
            "min_followers": min_followers,
            "target_pages": target_pages,
            "idle_timeout_s": idle_timeout_s,
            "headless": headless,
            "allow_direct_fallback": allow_direct_fallback,
            "keep_browser": keep_browser,
        },
        campaign_id=campaign_id,
    )

    # 2. Đăng ký stop/pause event ngay
    with _ACTIVE_SESSIONS_LOCK:
        _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()

    # 2b. Khóa 1 job / 1 acc (chung với FOLLOW / POST_SCAN)
    from .browser_session import (
        AccountBusyError,
        get_active_job_for_account,
        release_account_job,
        try_acquire_account_job,
    )

    busy = get_active_job_for_account(target_uid)
    if busy:
        # Phiên vừa tạo → fail nhanh, không để RUNNING orphan
        try:
            finalize_scan_session(
                session_id,
                "FAILED",
                "ERROR",
                0,
                0,
                0,
                0,
                0,
                0,
                f"BUSY: acc đang chạy phiên #{busy.get('session_id')} ({busy.get('job_type')})",
            )
        except Exception:
            pass
        with _ACTIVE_SESSIONS_LOCK:
            _ACTIVE_STOP_EVENTS.pop(session_id, None)
            _ACTIVE_PAUSE_EVENTS.pop(session_id, None)
        raise AccountBusyError(
            target_uid, int(busy["session_id"]), str(busy.get("job_type") or "")
        )
    try_acquire_account_job(target_uid, session_id, "HASHTAG")

    # 3. Kích hoạt worker trong daemon thread
    def _hashtag_runner(**kwargs):
        try:
            run_hashtag_search_flow(**kwargs)
        finally:
            release_account_job(target_uid, session_id)

    worker_thread = threading.Thread(
        target=_hashtag_runner,
        kwargs={
            "hashtags": clean_tags,
            "context_keywords": context_keywords,
            "min_posts": min_posts,
            "max_posts_per_hashtag": max_posts,
            "account_uid": target_uid,
            "owner_key": owner_key,
            "headless": headless,
            "allow_direct_fallback": allow_direct_fallback,
            "campaign_id": campaign_id,
            "session_id": session_id,
            "keep_browser": keep_browser,
            "min_followers": min_followers,
            "target_pages": target_pages,
            "idle_timeout_s": idle_timeout_s,
        },
        daemon=True,
        name=f"page_hashtag_worker_{session_id}",
    )
    worker_thread.start()

    return session_id
