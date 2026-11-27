"""
post_now_service.py
Module 03 - Tab 2: "Đăng ngay" bài Status từ ô soạn bài chung.

Không hẹn giờ = đăng ngay: tách bài trong ô soạn, kiểm tra kho, chia bài/ảnh cho từng nick
(trong cùng lượt không nick nào trùng bài/ảnh), tạo phiên + bài PENDING rồi chạy runner.
Không lưu thành chiến dịch, không xoá nháp; kết quả xem ở Lịch sử.
"""
import logging
import os
import random
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

from modules.module_03_acc_farm import post_repository
from modules.module_03_acc_farm.compose_service import (
    IMAGE_NONE,
    allocate_round,
    clamp_image_range,
    normalize_content_mode,
    normalize_image_mode,
    normalize_pool_images,
    parse_compose_text,
    validate_plan,
)

logger = logging.getLogger(__name__)

# Chặn 2 yêu cầu (Đăng ngay / khung chiến dịch) cùng lúc lọt qua bước kiểm tra runner bận
start_lock = threading.Lock()


class PostNowError(Exception):
    def __init__(self, message: str, status_code: int = 400, errors: Optional[List[str]] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.errors = errors or [message]


@dataclass
class ComposeInput:
    content_text: str = ""
    content_mode: str = "MULTI"
    image_mode: str = IMAGE_NONE
    image_paths: List[str] = field(default_factory=list)
    min_images: int = 1
    max_images: int = 1


def _format_eta(seconds: Optional[int]) -> str:
    if seconds is None:
        return ""
    finish = datetime.now() + timedelta(seconds=seconds)
    return f", dự kiến xong khoảng {finish.strftime('%H:%M')}"


# session_id -> khung chiến dịch (None = phiên Đăng ngay). Phiên không bao giờ đổi chiến dịch nên nhớ luôn.
_session_campaign_cache: Dict[str, Optional[Dict[str, Any]]] = {}
_SESSION_CACHE_LIMIT = 200


def _campaign_slot_for_session(session_id: str) -> Optional[Dict[str, Any]]:
    if session_id in _session_campaign_cache:
        return _session_campaign_cache[session_id]
    try:
        from core.database.connection import db
        row = db.fetch_one(
            """
            SELECT c.id::text AS campaign_id, c.name AS campaign_name, s.id::text AS slot_id, s.run_at
            FROM post_campaign_slots s JOIN post_campaigns c ON c.id = s.campaign_id
            WHERE s.session_id = %s
            LIMIT 1
            """,
            (session_id,),
        )
    except Exception as exc:  # bảng chiến dịch chưa tạo / lỗi DB: vẫn báo bận chung
        logger.debug("Không tra được khung chiến dịch của phiên %s: %s", session_id, exc)
        return None
    if len(_session_campaign_cache) >= _SESSION_CACHE_LIMIT:
        _session_campaign_cache.clear()
    _session_campaign_cache[session_id] = row
    return row


def campaign_of_session(session_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Khung chiến dịch của 1 phiên (cho FE: phiên chiến dịch thì trang Status không tự nhảy sang tiến trình)."""
    if not session_id:
        return None
    row = _campaign_slot_for_session(session_id)
    if not row:
        return None
    run_at = row.get("run_at")
    return {
        "campaign_id": row.get("campaign_id"),
        "campaign_name": row.get("campaign_name"),
        "slot_id": row.get("slot_id"),
        "run_at": run_at.astimezone().strftime("%H:%M") if isinstance(run_at, datetime) else run_at,
    }


def busy_message(runner) -> Optional[str]:
    """Câu báo lỗi khi runner đang bận (nêu tên chiến dịch + khung giờ nếu phiên thuộc chiến dịch)."""
    if not runner.is_busy():
        return None
    session_id = runner.active_session_id()
    eta = _format_eta(runner.estimate_remaining_seconds())
    slot = _campaign_slot_for_session(session_id) if session_id else None
    if slot:
        run_at = slot.get("run_at")
        if isinstance(run_at, datetime):
            run_at = run_at.astimezone().strftime("%H:%M")
        return (
            f"Chiến dịch \"{slot.get('campaign_name')}\" đang chạy khung {run_at}{eta}. "
            "Đợi khung này xong rồi đăng ngay."
        )
    return f"Đang có một phiên đăng bài khác chạy{eta}. Đợi phiên đó xong hoặc dừng nó trước."


def _unique_accounts(accounts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen, out = set(), []
    for acc in accounts or []:
        uid = str(acc.get("uid") or "").strip()
        if uid and uid not in seen:
            seen.add(uid)
            out.append(acc)
    return out


def start_status_post_now(
    runner,
    accounts: List[Dict[str, Any]],
    compose: ComposeInput,
    *,
    thread_count: int = 1,
    min_delay: int = 600,
    max_delay: int = 900,
    rng: Optional[random.Random] = None,
    file_exists: Callable[[str], bool] = os.path.isfile,
) -> Dict[str, Any]:
    accounts = _unique_accounts(accounts)
    content_mode = normalize_content_mode(compose.content_mode)
    image_mode = normalize_image_mode(compose.image_mode)
    lo, hi = clamp_image_range(compose.min_images, compose.max_images)
    parsed = parse_compose_text(compose.content_text, content_mode)
    images = normalize_pool_images(compose.image_paths) if image_mode != IMAGE_NONE else []

    missing = [p for p in images if not file_exists(p)]
    if missing:
        names = ", ".join(os.path.basename(p) for p in missing[:5])
        more = f" và {len(missing) - 5} ảnh khác" if len(missing) > 5 else ""
        raise PostNowError(f"{len(missing)} ảnh trong kho không còn trên máy ({names}{more}). Xoá ảnh đó khỏi kho rồi thử lại.")

    check = validate_plan(
        parsed, images, account_count=len(accounts), slot_count=1,
        content_mode=content_mode, image_mode=image_mode, min_images=lo, max_images=hi,
    )
    if not check.ok:
        raise PostNowError(" ".join(check.errors), errors=check.errors)

    with start_lock:
        busy = busy_message(runner)
        if busy:
            raise PostNowError(busy, status_code=409)

        alloc = allocate_round(
            [str(a["uid"]).strip() for a in accounts], parsed.posts, images,
            content_mode=content_mode, image_mode=image_mode, min_images=lo, max_images=hi,
            rng=rng or random.Random(),
        )
        if not alloc.assignments:
            raise PostNowError("Không chia được bài cho nick nào. " + " ".join(alloc.skipped.values()))

        by_uid = {str(a["uid"]).strip(): a for a in accounts}
        session_id = post_repository.create_post_session("status")
        try:
            for item in alloc.assignments:
                acc = by_uid[item.account_uid]
                post_repository.create_post(
                    session_id=session_id,
                    post_type="status",
                    account_uid=item.account_uid,
                    account_name=str(acc.get("name") or ""),
                    content=item.content,
                    image_path=post_repository.primary_image_path(item.images),
                    image_paths=item.images,
                    status="PENDING",
                )
            chosen = [by_uid[item.account_uid] for item in alloc.assignments]
            runner.start_session_with_existing(
                session_id=session_id,
                post_type="status",
                account_count=len(alloc.assignments),
                thread_count=max(1, int(thread_count or 1)),
                min_delay=int(min_delay if min_delay is not None else 600),
                max_delay=int(max_delay if max_delay is not None else 900),
                accounts=chosen,
            )
        except Exception:
            logger.exception("Đăng ngay lỗi sau khi tạo phiên %s — huỷ các bài chờ", session_id)
            try:
                post_repository.stop_all_session_posts(session_id)
                post_repository.update_post_session(session_id, "STOPPED", finished=True)
            except Exception:
                logger.exception("Không huỷ được phiên %s", session_id)
            raise

    skipped = [
        {"uid": uid, "name": str(by_uid[uid].get("name") or uid), "reason": reason}
        for uid, reason in alloc.skipped.items()
    ]
    return {
        "success": True,
        "session_id": session_id,
        "inserted_count": len(alloc.assignments),
        "skipped": skipped,
        "warnings": check.warnings,
        "parsed": parsed.summary(),
    }
