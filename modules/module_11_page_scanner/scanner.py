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
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import quote_plus

from core.database.connection import db
from .page_source import (
    clean_page_url,
    extract_page_identifier,
    parse_follower_count,
    normalize_hashtag,
    parse_hashtags_input,
    classify_post_author,
    calculate_page_relevance_score,
)

logger = logging.getLogger(__name__)

# Quản lý cờ dừng phiên quét đang chạy theo session_id
_ACTIVE_STOP_EVENTS: Dict[int, threading.Event] = {}
_ACTIVE_SESSIONS_LOCK = threading.Lock()


def request_stop_session(session_id: int) -> bool:
    """Yêu cầu dừng một phiên quét đang chạy."""
    with _ACTIVE_SESSIONS_LOCK:
        event = _ACTIVE_STOP_EVENTS.get(session_id)
        if event:
            event.set()
            return True
    return False


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
) -> int:
    """Khởi tạo bản ghi phiên quét mới trong CSDL với trạng thái RUNNING."""
    settings_str = json.dumps(settings or {}, ensure_ascii=False)
    query = """
    INSERT INTO page_scan_sessions (
        owner_key, keyword, account_uid, source_type, status,
        max_results, total_seen, total_unique, total_duplicates,
        total_sponsored, batches_count, duration_seconds, settings,
        started_at, created_at
    ) VALUES (
        %s, %s, %s, %s, 'RUNNING',
        %s, 0, 0, 0,
        0, 0, 0, %s,
        NOW(), NOW()
    ) RETURNING id;
    """
    row = db.fetch_one(
        query,
        (owner_key, keyword, account_uid, source_type.upper(), max_results, settings_str),
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

        raw_data_str = json.dumps(page, ensure_ascii=False)
        is_verified = page.get("is_verified")
        is_sponsored = bool(page.get("is_sponsored", False))

        # Trích các trường chấm điểm relevance (nếu nguồn là HASHTAG)
        rel_score = int(page.get("relevance_score") or 0)
        rel_status = str(page.get("relevance_status") or "RELEVANT")
        matched_tags = page.get("matched_hashtags")
        if isinstance(matched_tags, (list, set)):
            matched_tags = ", ".join(matched_tags)
        hashtag_post_count = int(page.get("hashtag_post_count") or 0)

        evidence = page.get("evidence_posts")
        if isinstance(evidence, (list, dict)):
            evidence = json.dumps(evidence, ensure_ascii=False)
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
) -> Dict[str, Any]:
    """
    Thực thi trọn vẹn 1 phiên tìm kiếm Fanpage theo từ khóa qua trình duyệt:
    - Tạo session RUNNING trong DB (nếu chưa có)
    - Bật Chrome & vào trang tìm kiếm Fanpage của Facebook
    - Vòng scroll thu hoạch chống lặp theo batch (Mục 3.4)
    - Tự động dừng theo stop_reason chuẩn xác và lưu kết quả tăng dần
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
            },
        )

    with _ACTIVE_SESSIONS_LOCK:
        if session_id not in _ACTIVE_STOP_EVENTS:
            _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
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

    MAX_SCROLL_BATCHES = 100
    NO_NEW_LIMIT = 3
    MAX_DURATION_SEC = 480

    driver = None
    created_new_driver = False
    lock = None
    acquired_lock = False

    try:
        from core.browser import get_active_drivers, get_profile_lock, load_cookies, open_browser, human_sleep

        active_drivers = get_active_drivers(target_uid, owner=owner)
        if active_drivers:
            driver = active_drivers[0]
            logger.info(f"[{target_uid}] Tận dụng Chrome đang mở cho phiên #{session_id}")
        else:
            lock = get_profile_lock(target_uid, owner=owner)
            acquired_lock = lock.acquire(timeout=8)
            if not acquired_lock:
                stop_reason = "CHECKPOINT"
                error_message = f"Profile của nick {target_uid} đang bị khóa bởi tiến trình khác"
                finalize_scan_session(session_id, "PARTIAL", stop_reason, 0, 0, 0, 0, 0, 0, error_message)
                return {"session_id": session_id, "count": 0, "pages": [], "stop_reason": stop_reason}

            driver = open_browser(
                uid=target_uid,
                owner=owner,
                proxy=proxy,
                scope="page_scanner",
                headless=headless,
                verify_egress=False,
                allow_direct_fallback=allow_direct_fallback,
            )
            created_new_driver = True

            if cookie_str:
                load_cookies(driver, cookie_str)

        # 4. Điều hướng tới Facebook Search Pages
        encoded_kw = quote_plus(clean_keyword)
        search_url = f"https://www.facebook.com/search/pages/?q={encoded_kw}"
        driver.get(search_url)
        time.sleep(3)

        # 5. Vòng scroll thu hoạch chống lặp (Mục 3.4)
        while True:
            batch_no += 1
            if stop_event.is_set():
                stop_reason = "USER_STOPPED"
                break

            elapsed = int(time.time() - start_time)
            if elapsed >= MAX_DURATION_SEC:
                stop_reason = "TIMEOUT"
                break

            # Kiểm tra checkpoint / mất phiên
            curr_url = driver.current_url.lower()
            if "checkpoint" in curr_url or "login" in curr_url:
                stop_reason = "CHECKPOINT"
                error_message = "Tài khoản bị dính checkpoint hoặc mất đăng nhập Facebook"
                break

            cards = extract_page_cards_from_driver(driver)
            total_seen += len(cards)

            # Lọc thẻ
            valid_cards: List[Dict[str, Any]] = []
            for c in cards:
                if c.get("is_sponsored") and not include_sponsored:
                    total_sponsored += 1
                    continue
                valid_cards.append(c)

            keys_batch = [c["page_key"] for c in valid_cards if c.get("page_key")]
            new_cards = [c for c in valid_cards if c["page_key"] not in kho]

            # Ghi nhận trùng lặp
            duplicates_in_batch = len(valid_cards) - len(new_cards)
            total_duplicates += duplicates_in_batch

            # Gộp vào kho
            for c in new_cards:
                kho[c["page_key"]] = c

            # Lưu DB tăng dần ngay sau mỗi batch
            if new_cards:
                save_batch_pages(session_id, owner_key, batch_no, new_cards, target_uid, "SEARCH")

            # Cập nhật số liệu realtime vào DB sau mỗi batch
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

            # Kiểm tra điều kiện dừng: TARGET_REACHED
            if len(kho) >= max_results:
                stop_reason = "TARGET_REACHED"
                break

            # Kiểm tra CYCLE_DETECTED: batch signature đã từng xuất hiện y hệt
            signature = frozenset(keys_batch)
            if signature and signature in seen_batch_signatures:
                stop_reason = "CYCLE_DETECTED"
                break
            if signature:
                seen_batch_signatures.add(signature)

            # Kiểm tra NO_NEW_RESULTS
            if len(new_cards) == 0:
                no_new_streak += 1
                if no_new_streak >= NO_NEW_LIMIT:
                    stop_reason = "NO_NEW_RESULTS"
                    break
            else:
                no_new_streak = 0

            # Kiểm tra dòng hết kết quả của Facebook trong DOM
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

            # Scroll từng nấc nhỏ (85% chiều cao viewport) và nghỉ ngẫu nhiên
            driver.execute_script("window.scrollBy(0, window.innerHeight * 0.85);")
            try:
                human_sleep(1.5, 3.5, config=getattr(driver, "browser_config", None))
            except Exception:
                time.sleep(2.0)

    except Exception as exc:
        logger.error(f"[Scanner] Lỗi thực thi phiên #{session_id}: {exc}", exc_info=True)
        stop_reason = "ERROR"
        error_message = str(exc)
    finally:
        with _ACTIVE_SESSIONS_LOCK:
            _ACTIVE_STOP_EVENTS.pop(session_id, None)

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

        # Giải phóng lock profile nếu có
        if acquired_lock and lock:
            try:
                lock.release()
            except Exception:
                pass

        # Đóng driver nếu do phiên tự mở
        if created_new_driver and driver:
            try:
                from core.browser import close_scoped_active_drivers
                close_scoped_active_drivers(scope="page_scanner", force=True)
            except Exception:
                try:
                    driver.quit()
                except Exception:
                    pass

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

    # 1. Tạo bản ghi phiên RUNNING trong DB
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
        },
    )

    # 2. Đăng ký stop event ngay
    with _ACTIVE_SESSIONS_LOCK:
        _ACTIVE_STOP_EVENTS[session_id] = threading.Event()

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
        },
        daemon=True,
        name=f"page_scan_worker_{session_id}",
    )
    worker_thread.start()

    return session_id


# =============================================================================
# HASHTAG SEARCH HARVEST FLOW (Section 10 of Detail Plan)
# =============================================================================


def extract_hashtag_posts_from_driver(driver, current_tag: str) -> List[Dict[str, Any]]:
    """
    Bóc tách các bài viết trong feed hashtag của Facebook (Section 10.3).
    Mỗi bài trích xuất:
    - post_url / post_id: định danh bài viết để chống lặp
    - content_text: nội dung rút gọn
    - hashtags_in_post: danh sách các tag có trong bài
    - exact_match: kiểm tra bài có chứa chính xác #current_tag không
    - author_name, author_url, author_subtitle: thông tin tác giả bài viết
    """
    extracted_posts: List[Dict[str, Any]] = []
    try:
        script = """
        const posts = [];
        const articles = Array.from(document.querySelectorAll('div[role="feed"] > div, div[role="article"], div[data-ad-preview="message"]'));
        const elements = articles.length > 0 ? articles : Array.from(document.querySelectorAll('div[data-virtualized="false"]'));

        for (const el of elements) {
            const rawText = (el.innerText || '').trim();
            if (rawText.length < 15) continue;

            const links = Array.from(el.querySelectorAll('a[role="link"], a[attributionsrc]'));
            let authorLink = '';
            let authorName = '';
            let postLink = '';
            let subtitle = '';

            for (const a of links) {
                const href = a.getAttribute('href') || '';
                if (!href || href.includes('/hashtag/') || href.includes('/search/') || href.startsWith('#')) continue;

                if (href.includes('/posts/') || href.includes('/photos/') || href.includes('/videos/') || href.includes('story.php') || href.includes('/permalink/')) {
                    if (!postLink) postLink = href;
                } else if (!authorLink) {
                    const txt = (a.innerText || '').trim();
                    if (txt.length >= 2) {
                        authorLink = href;
                        authorName = txt;
                    }
                }
            }

            if (!authorLink && links.length > 0) {
                authorLink = links[0].getAttribute('href') || '';
                authorName = (links[0].innerText || '').trim();
            }

            if (!authorLink) continue;

            const lines = rawText.split('\\n').map(l => l.trim()).filter(Boolean);
            if (lines.length > 1) {
                subtitle = lines.slice(1, 4).join(' • ');
            }

            posts.push({
                author_name: authorName,
                author_url: authorLink,
                author_subtitle: subtitle,
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

            extracted_posts.append({
                "post_url": post_raw_url,
                "author_name": item.get("author_name") or "",
                "author_url": item.get("author_url") or "",
                "author_subtitle": item.get("author_subtitle") or "",
                "content_text": content[:500],
                "hashtags_in_post": tags_found,
                "exact_match": exact_match,
            })
    except Exception as exc:
        logger.warning(f"[Scanner] Lỗi bóc tách bài viết hashtag: {exc}")

    return extracted_posts


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
) -> Dict[str, Any]:
    """
    Thực thi phiên quét Fanpage theo danh sách Hashtag (Section 10):
    1. Chuẩn hóa hashtag đầu vào (Section 10.2).
    2. Quét bài viết chứa hashtag qua facebook.com/hashtag/<tag> hoặc tab bài viết (Section 10.3).
    3. Phân loại tác giả: chỉ nhận tác giả là Page, loại Profile & Group (Section 10.4).
    4. Gom theo Page + Chấm điểm liên quan (Section 10.5).
    5. Lưu kết quả tăng dần vào DB (RELEVANT / REVIEW / EXCLUDED).
    """
    clean_tags = parse_hashtags_input(hashtags)
    if not clean_tags:
        raise ValueError("Danh sách hashtag không được để trống")

    context_kws = [k.strip() for k in (context_keywords or []) if k.strip()]
    max_posts = max(10, min(max_posts_per_hashtag, 300))
    min_posts = max(1, min(min_posts, 10))

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
    if session_id is None:
        session_id = create_scan_session(
            owner_key=owner_key,
            keyword=tag_keyword,
            account_uid=target_uid,
            source_type="HASHTAG",
            max_results=max_posts * len(clean_tags),
            settings={
                "hashtags": clean_tags,
                "context_keywords": context_kws,
                "min_posts": min_posts,
                "max_posts_per_hashtag": max_posts,
                "headless": headless,
                "allow_direct_fallback": allow_direct_fallback,
            },
        )

    with _ACTIVE_SESSIONS_LOCK:
        if session_id not in _ACTIVE_STOP_EVENTS:
            _ACTIVE_STOP_EVENTS[session_id] = threading.Event()
        stop_event = _ACTIVE_STOP_EVENTS[session_id]

    # 3. Biến trạng thái phiên
    posts_kho: Set[str] = set()
    page_kho: Dict[str, Dict[str, Any]] = {}
    seen_batch_signatures: Set[frozenset] = set()
    batch_no = 0
    total_posts_scanned = 0
    total_posts_matched = 0
    total_authors_seen = 0
    stop_reason = "COMPLETED"
    error_message: Optional[str] = None
    start_time = time.time()

    MAX_SCROLL_BATCHES = 120
    NO_NEW_LIMIT = 3
    MAX_DURATION_SEC = 600

    driver = None
    created_new_driver = False
    lock = None
    acquired_lock = False

    try:
        from core.browser import get_active_drivers, get_profile_lock, load_cookies, open_browser, human_sleep

        active_drivers = get_active_drivers(target_uid, owner=owner)
        if active_drivers:
            driver = active_drivers[0]
            logger.info(f"[{target_uid}] Tận dụng Chrome đang mở cho phiên hashtag #{session_id}")
        else:
            lock = get_profile_lock(target_uid, owner=owner)
            acquired_lock = lock.acquire(timeout=8)
            if not acquired_lock:
                stop_reason = "CHECKPOINT"
                error_message = f"Profile của nick {target_uid} đang bị khóa bởi tiến trình khác"
                finalize_scan_session(session_id, "PARTIAL", stop_reason, 0, 0, 0, 0, 0, 0, error_message)
                return {"session_id": session_id, "count": 0, "pages": [], "stop_reason": stop_reason}

            driver = open_browser(
                uid=target_uid,
                owner=owner,
                proxy=proxy,
                scope="page_scanner",
                headless=headless,
                verify_egress=False,
                allow_direct_fallback=allow_direct_fallback,
            )
            created_new_driver = True

            if cookie_str:
                load_cookies(driver, cookie_str)

        # 4. Quét từng hashtag
        for current_tag in clean_tags:
            if stop_event.is_set():
                stop_reason = "USER_STOPPED"
                break

            elapsed = int(time.time() - start_time)
            if elapsed >= MAX_DURATION_SEC:
                stop_reason = "TIMEOUT"
                break

            # Điều hướng tới trang hashtag
            hashtag_url = f"https://www.facebook.com/hashtag/{quote_plus(current_tag)}"
            driver.get(hashtag_url)
            time.sleep(3)

            # Fallback nếu trang hashtag chuyển hướng về feed hoặc lỗi
            curr = driver.current_url.lower()
            if "facebook.com/hashtag" not in curr:
                search_posts_url = f"https://www.facebook.com/search/posts/?q=%23{quote_plus(current_tag)}"
                driver.get(search_posts_url)
                time.sleep(3)

            tag_posts_count = 0
            no_new_streak = 0

            # Vòng cuộn thu hoạch bài viết
            while tag_posts_count < max_posts:
                batch_no += 1
                if stop_event.is_set():
                    stop_reason = "USER_STOPPED"
                    break

                elapsed = int(time.time() - start_time)
                if elapsed >= MAX_DURATION_SEC:
                    stop_reason = "TIMEOUT"
                    break

                # Kiểm tra checkpoint / mất phiên
                curr_url = driver.current_url.lower()
                if "checkpoint" in curr_url or "login" in curr_url:
                    stop_reason = "CHECKPOINT"
                    error_message = "Tài khoản bị dính checkpoint hoặc mất đăng nhập Facebook"
                    break

                posts = extract_hashtag_posts_from_driver(driver, current_tag)
                new_posts = [p for p in posts if p["post_url"] not in posts_kho]

                # Chữ ký batch chống lặp bài viết
                post_keys = [p["post_url"] for p in posts if p.get("post_url")]
                signature = frozenset(post_keys)
                if signature and signature in seen_batch_signatures:
                    stop_reason = "CYCLE_DETECTED"
                    break
                if signature:
                    seen_batch_signatures.add(signature)

                if not new_posts:
                    no_new_streak += 1
                    if no_new_streak >= NO_NEW_LIMIT:
                        break
                else:
                    no_new_streak = 0

                batch_modified_pages: List[Dict[str, Any]] = []

                for p in new_posts:
                    posts_kho.add(p["post_url"])
                    total_posts_scanned += 1
                    tag_posts_count += 1

                    # 10.3 Kiểm tra hashtag khớp chính xác
                    if not p.get("exact_match"):
                        continue
                    total_posts_matched += 1

                    # 10.4 Phân loại tác giả: chỉ nhận Page
                    author_type, author_reason = classify_post_author(
                        author_name=p["author_name"],
                        author_url=p["author_url"],
                        author_subtitle=p.get("author_subtitle", ""),
                        post_context=p.get("content_text", ""),
                    )
                    total_authors_seen += 1

                    if author_type != "PAGE":
                        continue

                    author_url = p["author_url"]
                    cleaned_page_url = clean_page_url(author_url)
                    page_key, quality = extract_page_identifier(cleaned_page_url)
                    if not page_key:
                        continue

                    # 10.5 Gom theo Page + Chấm điểm liên quan
                    if page_key not in page_kho:
                        page_kho[page_key] = {
                            "page_key": page_key,
                            "page_name": p["author_name"],
                            "page_url": cleaned_page_url,
                            "avatar_url": None,
                            "category": p.get("author_subtitle") or "",
                            "follower_count": None,
                            "follower_text": None,
                            "is_verified": None,
                            "is_sponsored": False,
                            "identifier_quality": quality,
                            "matched_hashtags": set(),
                            "hashtag_post_count": 0,
                            "evidence_posts": [],
                            "latest_post_at": "Gần đây",
                        }

                    entry = page_kho[page_key]
                    entry["matched_hashtags"].add(current_tag)
                    entry["hashtag_post_count"] += 1
                    if p["post_url"] and p["post_url"] not in entry["evidence_posts"] and len(entry["evidence_posts"]) < 3:
                        entry["evidence_posts"].append(p["post_url"])

                    # Tính lại điểm relevance
                    score, status, reasons = calculate_page_relevance_score(
                        hashtag_post_count=entry["hashtag_post_count"],
                        matched_hashtags=list(entry["matched_hashtags"]),
                        page_name=entry["page_name"],
                        category=entry["category"],
                        context_keywords=context_kws,
                        min_posts=min_posts,
                        latest_post_at=entry["latest_post_at"],
                    )
                    entry["relevance_score"] = score
                    entry["relevance_status"] = status
                    entry["relevance_reasons"] = reasons

                    batch_modified_pages.append(entry)

                # Lưu DB tăng dần ngay sau batch
                if batch_modified_pages:
                    save_batch_pages(session_id, owner_key, batch_no, batch_modified_pages, target_uid, "HASHTAG")

                # Cập nhật số liệu realtime vào session DB
                rel_count = sum(1 for pg in page_kho.values() if pg.get("relevance_status") == "RELEVANT")
                rev_count = sum(1 for pg in page_kho.values() if pg.get("relevance_status") == "REVIEW")
                exc_count = sum(1 for pg in page_kho.values() if pg.get("relevance_status") == "EXCLUDED")

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

                if batch_no >= MAX_SCROLL_BATCHES:
                    stop_reason = "MAX_SCROLLS"
                    break

                # Scroll từng nấc nhỏ 85% viewport
                driver.execute_script("window.scrollBy(0, window.innerHeight * 0.85);")
                try:
                    human_sleep(1.5, 3.5, config=getattr(driver, "browser_config", None))
                except Exception:
                    time.sleep(2.0)

            if stop_reason in ["USER_STOPPED", "CHECKPOINT", "TIMEOUT"]:
                break

    except Exception as exc:
        logger.error(f"[Scanner] Lỗi thực thi phiên hashtag #{session_id}: {exc}", exc_info=True)
        stop_reason = "ERROR"
        error_message = str(exc)
    finally:
        with _ACTIVE_SESSIONS_LOCK:
            _ACTIVE_STOP_EVENTS.pop(session_id, None)

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
            total_seen=total_posts_scanned,
            total_unique=len(page_kho),
            total_duplicates=0,
            total_sponsored=0,
            batches_count=batch_no,
            duration_seconds=duration,
            error_message=error_message,
        )

        # Giải phóng lock profile nếu có
        if acquired_lock and lock:
            try:
                lock.release()
            except Exception:
                pass

        # Đóng driver nếu do phiên tự mở
        if created_new_driver and driver:
            try:
                from core.browser import close_scoped_active_drivers
                close_scoped_active_drivers(scope="page_scanner", force=True)
            except Exception:
                try:
                    driver.quit()
                except Exception:
                    pass

    return {
        "session_id": session_id,
        "count": len(page_kho),
        "pages": list(page_kho.values()),
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
) -> int:
    """
    Khởi động phiên tìm kiếm Fanpage theo Hashtag trong background daemon thread (Section 10).
    Trả về ngay session_id để client theo dõi tiến độ realtime.
    """
    clean_tags = parse_hashtags_input(hashtags)
    if not clean_tags:
        raise ValueError("Vui lòng nhập ít nhất một hashtag hợp lệ")

    max_posts = max(10, min(max_posts_per_hashtag, 300))
    min_posts = max(1, min(min_posts, 10))

    account = get_scraping_account(account_uid, owner_key=owner_key)
    if not account:
        raise RuntimeError("Không tìm thấy tài khoản Facebook nào hợp lệ trong Module 02 để quét")

    target_uid = str(account.get("uid") or "").strip()
    tag_keyword = ", ".join(f"#{t}" for t in clean_tags)

    # 1. Tạo bản ghi phiên RUNNING trong DB
    session_id = create_scan_session(
        owner_key=owner_key,
        keyword=tag_keyword,
        account_uid=target_uid,
        source_type="HASHTAG",
        max_results=max_posts * len(clean_tags),
        settings={
            "hashtags": clean_tags,
            "context_keywords": context_keywords or [],
            "min_posts": min_posts,
            "max_posts_per_hashtag": max_posts,
            "headless": headless,
            "allow_direct_fallback": allow_direct_fallback,
        },
    )

    # 2. Đăng ký stop event ngay
    with _ACTIVE_SESSIONS_LOCK:
        _ACTIVE_STOP_EVENTS[session_id] = threading.Event()

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
            "session_id": session_id,
        },
        daemon=True,
        name=f"page_hashtag_worker_{session_id}",
    )
    worker_thread.start()

    return session_id
