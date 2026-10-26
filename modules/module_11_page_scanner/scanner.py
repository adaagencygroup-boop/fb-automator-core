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
)

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
            matched_hashtags, hashtag_post_count,
            phone, email, website, address,
            first_found_by_account_uid,
            first_source_type, first_session_id, raw_data, created_at, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s,
            %s, %s, %s, %s,
            %s,
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
            phone = COALESCE(EXCLUDED.phone, scanned_pages.phone),
            email = COALESCE(EXCLUDED.email, scanned_pages.email),
            website = COALESCE(EXCLUDED.website, scanned_pages.website),
            address = COALESCE(EXCLUDED.address, scanned_pages.address),
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
                    page.get("phone"),
                    page.get("email"),
                    page.get("website"),
                    page.get("address"),
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


def check_hashtag_page_availability(driver) -> Tuple[bool, str]:
    """
    Kiểm tra xem trang hashtag có mở được bình thường hay gặp lỗi không (Section 10.3):
    1. Chuyển hướng ra ngoài facebook.com/hashtag/...
    2. Gặp lỗi 'This content isn't available right now', 'Trang này hiện không khả dụng', v.v.
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


def extract_hashtag_posts_from_driver(driver, current_tag: str) -> List[Dict[str, Any]]:
    """
    Bóc tách bài viết feed hashtag / search posts (chỉ dẫn 2.5 bước 1–2).
    Thêm `header_action`: chữ hành động cạnh tên tác giả (Follow / Join / …).
    """
    extracted_posts: List[Dict[str, Any]] = []
    try:
        script = r"""
        const ACTION_RE = /^(Follow|Following|Theo dõi|Đang theo dõi|Join|Tham gia)$/i;
        const posts = [];
        const articles = Array.from(document.querySelectorAll(
          'div[role="feed"] > div, div[role="article"], div[data-ad-preview="message"]'
        ));
        const elements = articles.length > 0
          ? articles
          : Array.from(document.querySelectorAll('div[data-virtualized="false"]'));

        for (const el of elements) {
            const rawText = (el.innerText || '').trim();
            if (rawText.length < 15) continue;

            const links = Array.from(el.querySelectorAll('a[role="link"], a[href]'));
            let authorLink = '';
            let authorName = '';
            let postLink = '';
            let headerAction = '';

            for (const a of links) {
                const href = a.getAttribute('href') || '';
                if (!href || href.includes('/hashtag/') || href.includes('/search/') || href.startsWith('#')) continue;

                if (href.includes('/posts/') || href.includes('/photos/') || href.includes('/videos/')
                    || href.includes('story.php') || href.includes('/permalink/') || href.includes('/reel/')) {
                    if (!postLink) postLink = href;
                    continue;
                }

                const txt = (a.innerText || '').trim().replace(/\s+/g, ' ');
                if (!authorLink && txt.length >= 2 && !ACTION_RE.test(txt)) {
                    authorLink = href;
                    authorName = txt.split('\n')[0].trim();
                }
            }

            // Chữ hành động gần header: nút/span/link Follow|Join cạnh tên
            const headerNodes = Array.from(el.querySelectorAll('a, span, div[role="button"]')).slice(0, 40);
            for (const node of headerNodes) {
                const t = (node.innerText || '').trim().replace(/\s+/g, ' ');
                if (ACTION_RE.test(t)) {
                    headerAction = t;
                    break;
                }
            }
            // Fallback: dòng đầu thẻ dạng "Tên · Follow"
            if (!headerAction) {
                const firstLine = rawText.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
                const m = firstLine.match(/[·•|]\s*(Follow|Following|Theo dõi|Đang theo dõi|Join|Tham gia)\s*$/i);
                if (m) headerAction = m[1];
            }

            if (!authorLink && links.length > 0) {
                authorLink = links[0].getAttribute('href') || '';
                authorName = (links[0].innerText || '').trim().split('\n')[0].trim();
            }
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

            exact_match = (
                f"#{target_tag_lower}" in content.lower()
                or target_tag_lower in tags_found
            )

            post_raw_url = item.get("post_url") or item.get("author_url") or ""
            header_action = (item.get("header_action") or "").strip()

            extracted_posts.append({
                "post_url": post_raw_url,
                "author_name": item.get("author_name") or "",
                "author_url": item.get("author_url") or "",
                "author_subtitle": item.get("author_subtitle") or "",
                "header_action": header_action,
                "content_text": content[:500],
                "hashtags_in_post": tags_found,
                "exact_match": exact_match,
            })
    except Exception as exc:
        logger.warning(f"[Scanner] Lỗi bóc tách bài viết hashtag: {exc}")

    return extracted_posts


_VERIFY_PAGE_META_JS = r"""
const body = (document.body && document.body.innerText) ? document.body.innerText : '';
const lower = body.toLowerCase();
const isProfile = /thêm bạn bè|add friend|bạn chung|mutual friends/.test(lower)
  && !/người theo dõi|followers|thích trang|like page/.test(lower);
const hasFollowOrLike = /theo dõi|follow|thích|like/.test(lower);
const hasPageCategory = /trang\s*[·•]|page\s*[·•]|người theo dõi|followers/.test(lower);
const isPage = !isProfile && (hasFollowOrLike || hasPageCategory);

let pageName = '';
const h1 = document.querySelector('h1');
if (h1) pageName = (h1.innerText || '').trim().split('\n')[0].trim();
if (!pageName) {
  const title = document.title || '';
  pageName = title.replace(/\s*[|·•].*$/, '').trim();
}

let followerText = '';
// Chỉ bắt followers / người theo dõi; đơn vị gồm N|nghìn|k|triệu|… (không lấy likes)
const mFl = body.match(
  /([\d]+(?:[.,][\d]+)*)\s*(nghìn|ngàn|triệu|n|k|tr|m)?\s*(người\s*theo\s*dõi|followers?)\b/i
);
if (mFl) followerText = mFl[0];

let category = '';
const catMatch = body.match(/(?:Trang|Page)\s*[·•]\s*([^\n]{2,80})/i);
if (catMatch) category = catMatch[1].trim();

let isVerified = null;
if (document.querySelector('[aria-label*="Verified"], [aria-label*="Đã xác minh"], [aria-label*="Xác minh"]')) {
  isVerified = true;
}

let avatarUrl = null;
const img = document.querySelector('image, img[src*="scontent"], svg image');
if (img) {
  avatarUrl = img.getAttribute('xlink:href') || img.getAttribute('href') || img.getAttribute('src') || null;
}

let phone = null;
const phoneMatch = body.match(/(?:\+84|84|0)(?:3|5|7|8|9|2\d)\d(?:[\s.\-]?\d){7}\b/);
if (phoneMatch) phone = phoneMatch[0].trim();

let email = null;
const emailMatch = body.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
if (emailMatch) email = emailMatch[0].trim();

let website = null;
const extLinks = Array.from(document.querySelectorAll('a[href*="l.facebook.com/l.php?u="], a[target="_blank"][href^="http"]'));
for (const a of extLinks) {
  const href = a.getAttribute('href') || '';
  if (href.includes('l.facebook.com/l.php?u=')) {
    try {
      const u = new URL(href).searchParams.get('u');
      if (u && !/facebook\.com|fb\.com|instagram\.com/i.test(u)) {
        website = u;
        break;
      }
    } catch (e) {}
  } else if (!/facebook\.com|fb\.com|instagram\.com/i.test(href)) {
    website = href;
    break;
  }
}

return {
  is_page: isPage,
  is_profile: isProfile,
  page_name: pageName,
  page_url: location.href,
  follower_text: followerText,
  category: category,
  is_verified: isVerified,
  avatar_url: avatarUrl,
  phone: phone,
  email: email,
  website: website
};
"""


def _read_page_meta_from_driver(driver) -> Dict[str, Any]:
    try:
        return driver.execute_script(_VERIFY_PAGE_META_JS) or {}
    except Exception:
        return {}


def _wait_page_meta_ready(driver, timeout_sec: float = 10.0, poll_sec: float = 0.4) -> Dict[str, Any]:
    """Chờ tên Page và số follower xuất hiện (tối đa ~10s). Profile rõ ràng thì trả sớm."""
    deadline = time.time() + timeout_sec
    info: Dict[str, Any] = {}
    while time.time() < deadline:
        info = _read_page_meta_from_driver(driver)
        if info.get("is_profile"):
            return info
        name = (info.get("page_name") or "").strip()
        fl = (info.get("follower_text") or "").strip()
        if name and fl:
            return info
        time.sleep(poll_sec)
    return info or _read_page_meta_from_driver(driver)


def verify_and_extract_page_in_new_tab(driver, author_url: str) -> Optional[Dict[str, Any]]:
    """
    Mở link tác giả trong tab phụ, xác minh Page, trích thông tin thật.
    Trả về:
    - dict Page hợp lệ (có page_key)
    - {"_verify_rejected": True, ...} khi đã xác nhận Profile / không phải Page
    - None khi timeout / lỗi load / chưa đọc được follower (caller được retry, không reject vĩnh viễn)
    Luôn đóng tab phụ và quay lại tab feed.
    """
    if not author_url:
        return None

    main_handle = driver.current_window_handle
    new_handle = None
    try:
        before = set(driver.window_handles)
        driver.execute_script("window.open(arguments[0], '_blank');", author_url)
        time.sleep(1.0)
        after = set(driver.window_handles)
        opened = list(after - before)
        if not opened:
            handles = driver.window_handles
            if len(handles) <= 1:
                return None
            new_handle = handles[-1]
        else:
            new_handle = opened[0]

        driver.switch_to.window(new_handle)

        curr = (driver.current_url or "").lower()
        if "checkpoint" in curr or "/login" in curr:
            return None

        info = _wait_page_meta_ready(driver, timeout_sec=10.0)

        if info.get("is_profile"):
            return {"_verify_rejected": True, "reason": "profile"}

        # Đã chờ đủ mà vẫn không phải Page rõ ràng → loại cứng
        if info and not info.get("is_page") and (info.get("page_name") or info.get("follower_text")):
            return {"_verify_rejected": True, "reason": "not_page"}

        # Load chậm / chưa có meta → soft fail (retry)
        page_name = (info.get("page_name") or "").strip()
        follower_raw = (info.get("follower_text") or "").strip()
        if not info.get("is_page") or not page_name or not follower_raw:
            return None

        page_url = clean_page_url(info.get("page_url") or author_url)
        page_key, quality = extract_page_identifier(page_url)
        if not page_key:
            return None

        follower_count, follower_text = parse_follower_count(follower_raw)
        # Đã thấy chuỗi follower nhưng parse thất bại → soft fail để thử lại
        if follower_count is None:
            return None

        return {
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
            "phone": info.get("phone"),
            "email": info.get("email"),
            "website": info.get("website"),
        }
    except Exception as exc:
        logger.warning(f"[Scanner] Lỗi xác minh Page tab mới ({author_url}): {exc}")
        return None
    finally:
        try:
            if new_handle and new_handle in driver.window_handles:
                driver.switch_to.window(new_handle)
                driver.close()
        except Exception:
            pass
        try:
            if main_handle in driver.window_handles:
                driver.switch_to.window(main_handle)
            elif driver.window_handles:
                driver.switch_to.window(driver.window_handles[0])
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
        get_active_drivers,
        get_profile_lock,
        load_cookies,
        open_browser,
        close_scoped_active_drivers,
    )

    active = get_active_drivers(target_uid, owner=owner, scope="page_scanner")
    if active:
        logger.info(f"[{target_uid}] Tái sử dụng Chrome page_scanner đang mở")
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
    1. Feed hashtag (fallback search posts) + exact_match.
    2. header_action: chỉ loại Join/Group; còn lại đưa tab xác minh.
    3. Gom ứng viên theo tên+link; tab phụ xác minh Page + follower.
    4. Chỉ lưu Page có follower_count > min_followers.
    5. Dừng TARGET_REACHED khi đủ target_pages; idle_timeout_s không có page mới đạt lọc.
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

            hashtag_url = f"https://www.facebook.com/hashtag/{quote_plus(current_tag)}"
            logger.info(f"[{target_uid}] Bắt đầu quét hashtag #{current_tag}: {hashtag_url}")
            append_session_log(session_id, f"Mở feed #{current_tag}", "info")
            driver.get(hashtag_url)
            time.sleep(3)

            is_avail, unavail_reason = check_hashtag_page_availability(driver)
            if not is_avail:
                logger.warning(
                    f"[{target_uid}] Trang hashtag #{current_tag} không mở được ({unavail_reason}). "
                    f"Fallback /search/posts/?q=%23{current_tag}"
                )
                append_session_log(
                    session_id,
                    f"#{current_tag} unavailable ({unavail_reason}) → search posts",
                    "warn",
                )
                search_posts_url = f"https://www.facebook.com/search/posts/?q=%23{quote_plus(current_tag)}"
                driver.get(search_posts_url)
                time.sleep(3)

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
                new_posts = [p for p in posts if p.get("post_url") and p["post_url"] not in posts_kho]
                new_posts_count = len(new_posts)

                post_keys = [p["post_url"] for p in posts if p.get("post_url")]
                signature = frozenset(post_keys)
                if new_posts_count == 0 and signature and signature in seen_batch_signatures:
                    stop_reason = "CYCLE_DETECTED"
                    break
                if signature:
                    seen_batch_signatures.add(signature)

                if new_posts_count == 0:
                    no_new_streak += 1
                    if no_new_streak >= NO_NEW_LIMIT:
                        append_session_log(
                            session_id,
                            f"#{current_tag}: NO_NEW sau {NO_NEW_LIMIT} batch — chuyển tag",
                            "info",
                        )
                        break
                else:
                    no_new_streak = 0

                batch_verified_pages: List[Dict[str, Any]] = []

                for p in new_posts:
                    if target_pages is not None and len(page_kho) >= target_pages:
                        stop_reason = "TARGET_REACHED"
                        break

                    posts_kho.add(p["post_url"])
                    total_posts_scanned += 1
                    tag_posts_count += 1

                    if not p.get("exact_match"):
                        continue
                    total_posts_matched += 1

                    # Chỉ loại ngay khi Join/Group; còn lại đưa tab xác minh
                    action_kind, _action_reason = classify_header_action(p.get("header_action") or "")
                    if action_kind == "GROUP":
                        continue

                    total_authors_seen += 1
                    author_url = p.get("author_url") or ""
                    author_name = p.get("author_name") or ""
                    cand_key = normalize_page_candidate_key(author_name, author_url)
                    cleaned_author = clean_page_url(author_url) or author_url

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

                    # Xác minh tab phụ — soft fail thì thử lại 1 lần; chỉ reject khi chắc chắn
                    verified = verify_and_extract_page_in_new_tab(driver, cleaned_author)
                    if verified is None:
                        verified = verify_and_extract_page_in_new_tab(driver, cleaned_author)

                    if verified and verified.get("_verify_rejected"):
                        rejected_author_urls.add(cleaned_author)
                        candidates[cand_key]["verify_status"] = "REJECTED"
                        append_session_log(
                            session_id,
                            f"Loại ứng viên ({verified.get('reason') or 'not_page'}): {author_name}",
                            "info",
                        )
                        continue

                    if not verified or not verified.get("page_key"):
                        # Timeout / load chậm / chưa đọc follower — không reject vĩnh viễn
                        candidates[cand_key]["verify_status"] = "PENDING"
                        append_session_log(
                            session_id,
                            f"Chưa xác minh được (sẽ gặp lại nếu còn): {author_name}",
                            "warn",
                        )
                        # Cho phép gặp lại ứng viên này ở batch sau
                        candidates.pop(cand_key, None)
                        continue

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

    # 3. Kích hoạt worker trong daemon thread
    worker_thread = threading.Thread(
        target=run_hashtag_search_flow,
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


def run_link_scan_flow(
    pages: List[Dict[str, Any]],
    account_uid: Optional[str] = None,
    account_uids: Optional[List[str]] = None,
    max_results: int = 30,
    min_followers: int = 0,
    switch_account_every: int = 50,
    delay_min: int = 5,
    delay_max: int = 10,
    source_type: str = "PARSE",
    owner_key: str = "system",
    headless: bool = False,
    allow_direct_fallback: bool = True,
    session_id: Optional[int] = None,
    campaign_id: Optional[str] = None,
    keep_browser: bool = False,
) -> Dict[str, Any]:
    """
    Thực thi phiên quét chi tiết thông tin Fanpage theo danh sách Link (Nhập Link / Tải tệp):
    - Duyệt từng link hợp lệ (tối đa max_results)
    - Mở Chrome qua tài khoản Facebook được chọn, bóc tách Tên Page, Followers, Danh mục,
      Tích xanh, SĐT, Email, Website
    - Hỗ trợ lọc min_followers, đổi tài khoản sau switch_account_every Page,
      nghỉ ngẫu nhiên delay_min..delay_max giây, Tạm dừng / Tiếp tục / Dừng khẩn cấp.
    """
    import random

    target_list = list(pages or [])[: max(1, min(int(max_results or 30), 500))]
    uid_pool = [str(u).strip() for u in (account_uids or []) if str(u).strip()]
    if account_uid and str(account_uid).strip() and str(account_uid).strip() not in uid_pool:
        uid_pool.insert(0, str(account_uid).strip())

    primary_uid = uid_pool[0] if uid_pool else account_uid
    account = get_scraping_account(primary_uid, owner_key=owner_key)

    if session_id is None:
        session_id = create_scan_session(
            owner_key=owner_key,
            keyword="Quét theo danh sách Link" if source_type == "PARSE" else "Quét từ tệp tải lên",
            account_uid=str(account.get("uid") or "") if account else None,
            source_type=source_type,
            max_results=len(target_list),
            settings={
                "min_followers": min_followers,
                "switch_account_every": switch_account_every,
                "delay_min": delay_min,
                "delay_max": delay_max,
                "headless": headless,
            },
            campaign_id=campaign_id,
        )

    with _ACTIVE_SESSIONS_LOCK:
        if session_id not in _ACTIVE_STOP_EVENTS:
            _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        if session_id not in _ACTIVE_PAUSE_EVENTS:
            _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()
        stop_event = _ACTIVE_STOP_EVENTS[session_id]

    start_time = time.time()
    kho: Dict[str, Dict[str, Any]] = {}
    total_seen = 0
    stop_reason = "TARGET_REACHED"
    error_message: Optional[str] = None

    # Fallback: Nếu chưa có tài khoản Facebook LIVE trong Module 02, vẫn lưu danh sách link vào kho
    if not account:
        append_session_log(
            session_id,
            "Chưa có tài khoản Facebook LIVE — lưu trực tiếp danh sách Link hợp lệ vào kho dữ liệu.",
            "warn",
        )
        for idx, p in enumerate(target_list, start=1):
            slug_name = (p.get("page_key") or "").replace("user:", "").replace("id:", "") or p.get("page_url")
            item = {
                **p,
                "page_name": p.get("page_name") or slug_name,
            }
            kho[item["page_key"]] = item
        save_batch_pages(session_id, owner_key, 1, list(kho.values()), None, source_type)
        finalize_scan_session(
            session_id=session_id,
            status="COMPLETED",
            stop_reason="TARGET_REACHED",
            total_seen=len(target_list),
            total_unique=len(kho),
            total_duplicates=0,
            total_sponsored=0,
            batches_count=1,
            duration_seconds=int(time.time() - start_time),
        )
        with _ACTIVE_SESSIONS_LOCK:
            _ACTIVE_STOP_EVENTS.pop(session_id, None)
            _ACTIVE_PAUSE_EVENTS.pop(session_id, None)
        return {
            "session_id": session_id,
            "count": len(kho),
            "pages": list(kho.values()),
            "stop_reason": "TARGET_REACHED",
            "status": "COMPLETED",
        }

    driver = None
    acquired_lock = False
    lock = None
    curr_acc_idx = 0

    def _open_for_account(acc_obj: Dict[str, Any]):
        nonlocal driver, acquired_lock, lock
        if acquired_lock and lock:
            try:
                lock.release()
            except Exception:
                pass
            acquired_lock = False
            lock = None
        t_uid = str(acc_obj.get("uid") or "").strip()
        t_owner = acc_obj.get("user_id") or owner_key
        t_cookie = acc_obj.get("cookie") or ""
        t_proxy = acc_obj.get("proxy")
        driver, created_new, lock, acquired_lock = _acquire_page_scanner_browser(
            target_uid=t_uid,
            owner=t_owner,
            proxy=t_proxy,
            cookie_str=t_cookie,
            headless=headless,
            allow_direct_fallback=allow_direct_fallback,
        )
        append_session_log(
            session_id,
            f"Sử dụng tài khoản {t_uid} ({'mở mới' if created_new else 'tái sử dụng'} Chrome)",
            "info",
        )
        return t_uid

    try:
        current_uid = _open_for_account(account)
        append_session_log(
            session_id,
            f"Bắt đầu quét thông tin {len(target_list)} liên kết Fanpage...",
            "info",
        )

        for idx, item in enumerate(target_list, start=1):
            if _wait_if_paused(session_id, stop_event):
                stop_reason = "USER_STOPPED"
                break
            if stop_event.is_set():
                stop_reason = "USER_STOPPED"
                break

            # Đổi tài khoản định kỳ nếu có nhiều tài khoản
            if (
                len(uid_pool) > 1
                and switch_account_every > 0
                and idx > 1
                and (idx - 1) % switch_account_every == 0
            ):
                curr_acc_idx = (curr_acc_idx + 1) % len(uid_pool)
                next_acc = get_scraping_account(uid_pool[curr_acc_idx], owner_key=owner_key)
                if next_acc:
                    append_session_log(
                        session_id,
                        f"Đổi sang tài khoản tiếp theo sau {idx - 1} Page...",
                        "warn",
                    )
                    current_uid = _open_for_account(next_acc)

            target_url = item.get("page_url") or ""
            if not target_url:
                continue

            total_seen += 1
            append_session_log(
                session_id,
                f"[{idx}/{len(target_list)}] Đang truy cập: {target_url}",
                "info",
            )

            try:
                driver.get(target_url)
            except Exception as nav_err:
                append_session_log(
                    session_id,
                    f"Lỗi mở link {target_url}: {nav_err}",
                    "warn",
                )
                continue

            curr_url = (driver.current_url or "").lower()
            if "checkpoint" in curr_url or "/login" in curr_url:
                stop_reason = "CHECKPOINT"
                error_message = f"Tài khoản {current_uid} bị dính checkpoint hoặc mất đăng nhập"
                append_session_log(session_id, error_message, "warn")
                break

            info = _wait_page_meta_ready(driver, timeout_sec=10.0)
            cleaned_final = clean_page_url(info.get("page_url") or target_url) or target_url
            page_key, quality = extract_page_identifier(cleaned_final)
            if not page_key:
                page_key = item.get("page_key") or f"url:{target_url}"

            follower_raw = (info.get("follower_text") or "").strip()
            follower_count, follower_text = parse_follower_count(follower_raw)

            if min_followers > 0 and follower_count is not None and follower_count <= min_followers:
                append_session_log(
                    session_id,
                    f"Bỏ qua [{info.get('page_name') or page_key}]: {follower_count} ≤ {min_followers} followers",
                    "info",
                )
                continue

            slug_fallback = page_key.replace("user:", "").replace("id:", "")
            page_record = {
                "page_key": page_key,
                "page_name": (info.get("page_name") or "").strip() or slug_fallback,
                "page_url": cleaned_final,
                "avatar_url": info.get("avatar_url"),
                "category": info.get("category") or "",
                "follower_count": follower_count,
                "follower_text": follower_text or follower_raw,
                "is_verified": info.get("is_verified"),
                "is_sponsored": False,
                "identifier_quality": quality,
                "phone": info.get("phone"),
                "email": info.get("email"),
                "website": info.get("website"),
            }

            kho[page_key] = page_record
            save_batch_pages(session_id, owner_key, idx, [page_record], current_uid, source_type)

            try:
                db.execute(
                    """
                    UPDATE page_scan_sessions
                    SET total_seen = %s, total_unique = %s, batches_count = %s, duration_seconds = %s
                    WHERE id = %s
                    """,
                    (total_seen, len(kho), idx, int(time.time() - start_time), session_id),
                )
            except Exception:
                pass

            append_session_log(
                session_id,
                (
                    f"Quét thành công [{page_record['page_name']}]"
                    f" · FL={follower_count if follower_count is not None else (follower_raw or '—')}"
                    f"{' · SĐT=' + page_record['phone'] if page_record.get('phone') else ''}"
                ),
                "success",
            )

            if idx < len(target_list):
                d_lo = max(1, int(delay_min or 3))
                d_hi = max(d_lo, int(delay_max or 6))
                sleep_s = random.uniform(d_lo, d_hi)
                end_sleep = time.time() + sleep_s
                while time.time() < end_sleep:
                    if stop_event.is_set() or _wait_if_paused(session_id, stop_event):
                        break
                    time.sleep(0.3)

    except Exception as exc:
        logger.error(f"[Scanner] Lỗi phiên quét link #{session_id}: {exc}", exc_info=True)
        stop_reason = "ERROR"
        error_message = str(exc)
    finally:
        with _ACTIVE_SESSIONS_LOCK:
            _ACTIVE_STOP_EVENTS.pop(session_id, None)
            _ACTIVE_PAUSE_EVENTS.pop(session_id, None)

        duration = int(time.time() - start_time)
        final_status = "COMPLETED" if stop_reason == "TARGET_REACHED" else "PARTIAL"
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
            total_duplicates=0,
            total_sponsored=0,
            batches_count=total_seen,
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
        "pages": list(kho.values()),
        "stop_reason": stop_reason,
        "status": final_status,
        "error_message": error_message,
    }


def start_link_scan_background(
    content: str,
    account_uid: Optional[str] = None,
    account_uids: Optional[List[str]] = None,
    max_results: int = 30,
    min_followers: int = 0,
    switch_account_every: int = 50,
    delay_min: int = 5,
    delay_max: int = 10,
    source_type: str = "PARSE",
    owner_key: str = "system",
    headless: bool = False,
    allow_direct_fallback: bool = True,
    campaign_id: Optional[str] = None,
    keep_browser: bool = False,
) -> Dict[str, Any]:
    """
    Khởi động phiên quét thông tin Fanpage theo danh sách Link trong background thread.
    Trả về ngay session_id và thống kê parse ban đầu.
    """
    from .page_source import parse_page_file_content

    parsed = parse_page_file_content(content, filter_existing=True, owner_key=owner_key)
    valid_pages = parsed.get("pages") or []
    if not valid_pages:
        raise ValueError("Không tìm thấy đường dẫn Fanpage hợp lệ nào trong danh sách")

    max_results = max(1, min(int(max_results or 30), 500))
    target_pages = valid_pages[:max_results]

    uid_pool = [str(u).strip() for u in (account_uids or []) if str(u).strip()]
    if account_uid and str(account_uid).strip() and str(account_uid).strip() not in uid_pool:
        uid_pool.insert(0, str(account_uid).strip())
    primary_uid = uid_pool[0] if uid_pool else account_uid

    account = get_scraping_account(primary_uid, owner_key=owner_key)
    target_uid = str(account.get("uid") or "").strip() if account else None

    src_type = "UPLOAD" if str(source_type).upper() == "UPLOAD" else "PARSE"
    session_id = create_scan_session(
        owner_key=owner_key,
        keyword="Quét từ tệp tải lên" if src_type == "UPLOAD" else "Quét theo danh sách Link",
        account_uid=target_uid,
        source_type=src_type,
        max_results=len(target_pages),
        settings={
            "min_followers": min_followers,
            "switch_account_every": switch_account_every,
            "delay_min": delay_min,
            "delay_max": delay_max,
            "headless": headless,
            "total_lines": parsed.get("total_lines", 0),
            "valid_count": parsed.get("valid_count", 0),
            "dedup_count": parsed.get("dedup_count", 0),
        },
        campaign_id=campaign_id,
    )

    with _ACTIVE_SESSIONS_LOCK:
        _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        _ACTIVE_PAUSE_EVENTS[session_id] = threading.Event()

    worker_thread = threading.Thread(
        target=run_link_scan_flow,
        kwargs={
            "pages": target_pages,
            "account_uid": target_uid,
            "account_uids": uid_pool,
            "max_results": len(target_pages),
            "min_followers": min_followers,
            "switch_account_every": switch_account_every,
            "delay_min": delay_min,
            "delay_max": delay_max,
            "source_type": src_type,
            "owner_key": owner_key,
            "headless": headless,
            "allow_direct_fallback": allow_direct_fallback,
            "session_id": session_id,
            "campaign_id": campaign_id,
            "keep_browser": keep_browser,
        },
        daemon=True,
        name=f"page_link_scan_worker_{session_id}",
    )
    worker_thread.start()

    return {
        "session_id": session_id,
        "campaign_id": campaign_id,
        "status": "RUNNING",
        "target_count": len(target_pages),
        "parsed": parsed,
        "message": f"Phiên quét theo link #{session_id} ({len(target_pages)} Page) đã được khởi động",
    }

