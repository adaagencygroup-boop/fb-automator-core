"""
seeding_routes.py
API endpoints cho Module 8: Interaction Seeding (Seeding Page, Seeding Profile, Seeding Post, History).
Tuân thủ chuẩn DBML Module 8 (fb_automator_seeding).
Quản lý chiến dịch, sinh hàng đợi tác vụ và điều phối worker chạy nền đa luồng tự động hóa bằng Selenium thật.
"""

from contextlib import contextmanager
import hashlib
import logging
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
)
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.orm import Session

from modules.module_02_account_manager.automation.browser_manager import (
    close_driver_for_uid,
    close_scoped_active_drivers,
    create_driver,
    safe_close_driver,
)
from modules.module_02_account_manager.context import owner_context
from modules.module_02_account_manager.database.connection import SessionLocal, get_db
from modules.module_02_account_manager.database.models import Account
from modules.module_08_interaction_seeding.models.seeding_models import vn_now
from modules.module_02_account_manager.services import events as m2_events
from modules.module_02_account_manager.services.browser_service import HWID
from modules.module_08_interaction_seeding.automation import FacebookSeedingBot
from modules.module_08_interaction_seeding.models import (
    SeedingCampaign,
    SeedingCampaignTarget,
    SeedingComment,
    SeedingTarget,
    SeedingTask,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/seeding", tags=["Seeding"])
seeding_router = router

# Global state cho việc quản lý dừng chiến dịch seeding đang chạy
_active_seeding_campaigns = {}  # campaign_id -> {"stop_requested": bool, "running": bool}
_batch_campaign_chains: dict[
    int, list[int]
] = {}  # campaign_id -> [camp1_id, camp2_id, ...]
# Lô đang được bộ chạy lô (_execute_campaign_runner) chạy thật: campaign đầu lô -> chuỗi chiến dịch.
# Mỗi lúc mỗi user chỉ được chạy 1 lô seeding (mọi loại trang) vì các lô dùng chung nick / Chrome profile.
_running_batches: dict[int, list[int]] = {}


@contextmanager
def _scoped_db():
    """Tạo DB session ngắn hạn, tự commit khi thành công, rollback khi lỗi và luôn close giải phóng kết nối về pool."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def broadcast(
    level: str,
    message: str,
    uid: str | None = None,
    extra: dict[str, Any] | None = None,
    owner: Any | None = None,
):
    """
    Phát sự kiện log realtime đến luồng SSE cho đúng người dùng sở hữu chiến dịch.
    Đảm bảo các luồng nền của Selenium bot luôn chuyển được log đến client.
    """
    target_owner = str(owner).strip() if owner is not None else None
    if not target_owner:
        try:
            ctx_owner = owner_context.get()
            if ctx_owner:
                target_owner = str(ctx_owner).strip()
        except Exception:
            target_owner = None

    now_utc = datetime.now(UTC)
    time_str = datetime.now(VN_TZ).strftime("%H:%M:%S")

    payload = {
        "time": time_str,
        "timestamp": time_str,
        "iso_time": now_utc.isoformat(),
        "level": level,
        "type": level,
        "message": message,
        "uid": uid,
        **(extra or {}),
    }

    try:
        with m2_events._lock:
            targets = tuple(m2_events._subscribers)

        for loop, queue, subscriber_owner in targets:
            if loop.is_closed():
                continue

            sub_owner_str = (
                str(subscriber_owner).strip() if subscriber_owner is not None else None
            )
            # Điều kiện gửi:
            # 1. Khớp owner giữa chiến dịch và người nghe SSE
            # 2. Hoặc người nghe ở chế độ không đăng nhập (sub_owner_str is None)
            # 3. Hoặc log hệ thống chung (target_owner is None)
            should_deliver = (
                target_owner is None
                or sub_owner_str is None
                or target_owner == sub_owner_str
            )

            if not should_deliver:
                continue

            def deliver(q=queue, item=payload):
                if q.full():
                    try:
                        q.get_nowait()
                    except Exception:
                        pass
                q.put_nowait(item)

            try:
                loop.call_soon_threadsafe(deliver)
            except Exception:
                pass
    except Exception as e:
        logger.debug(f"broadcast error: {e}")


def get_current_user_info(
    request: Request | None = None, authorization: str | None = None
) -> dict[str, Any] | None:
    """
    Xác định người dùng hiện tại từ Bearer token (Authorization header) hoặc Cookie fb_access.
    Trả về dict thông tin user từ bảng users hoặc None nếu chưa đăng nhập.
    """
    try:
        from modules.module_auth.service import bearer_user

        return bearer_user(authorization, require_session=False, request=request)
    except Exception as e:
        logger.debug(f"get_current_user_info: Khong co user hop le ({e})")
        return None


# ─────────────────────────────────────────────────────────────
# HELPER FUNCTIONS (TRÍCH XUẤT FB_ID & QUẢN LÝ COMMENT NHÁP)
# ─────────────────────────────────────────────────────────────
TRACKING_PARAMS = {
    "mibextid", "ref", "rc", "rdid", "epa", "notif_t", "notif_id",
    "locale", "set", "type", "__tn__", "__cft__", "fref", "sfnsn",
    "fbclid", "utm_source", "utm_medium", "utm_campaign", "paipv", "eav",
    "comment_tracking", "feed_referrer", "acontext"
}


def clean_tracking_params(url: str) -> str:
    """Loại bỏ các query parameter tracking của Facebook như mibextid, ref, locale..."""
    if not url or "?" not in url:
        return url.rstrip("/")
    base, query = url.split("?", 1)
    base = base.rstrip("/")
    parts = query.split("&")
    kept = []
    for p in parts:
        if not p:
            continue
        k = p.split("=")[0].lower()
        if k not in TRACKING_PARAMS and not k.startswith("utm_"):
            kept.append(p)
    if kept:
        return f"{base}?{'&'.join(kept)}"
    return base


def normalize_target_url(raw_url: str, target_type: str = "") -> str:
    """Tự động chuẩn hóa link hoặc UID / Share post token:
    - Nếu target_type là POST hoặc chuỗi là token share post (vd: 18NvrpA3BJ) -> https://web.facebook.com/share/p/{token}
    - Nếu link là facebook.com/{token} trong POST -> tự động chuyển sang https://web.facebook.com/share/p/{token}
    - Nếu có tiền tố share/(p|r|v)/... -> https://web.facebook.com/share/...
    - Nếu nhập UID cho PAGE / PROFILE -> https://web.facebook.com/{uid}
    - Loại bỏ tham số tracking rác (?mibextid=..., ?ref=...)
    """
    if not raw_url:
        return ""
    val = raw_url.strip()
    if not val:
        return ""

    t_type = (target_type or "").upper()

    # 1. Kiểm tra nếu là dạng share link có domain hoặc không domain
    m_share = re.match(
        r"^(?:(?:https?://)?(?:(?:www\.|web\.|m\.)?facebook\.com|fb\.com)/)?share/(p|r|v)/([a-zA-Z0-9_\-]+)",
        val,
        re.IGNORECASE,
    )
    if m_share:
        return f"https://web.facebook.com/share/{m_share.group(1)}/{m_share.group(2)}"

    m_short_p = re.match(
        r"^(?:(?:https?://)?(?:(?:www\.|web\.|m\.)?facebook\.com|fb\.com)/)?(p|r|v)/([a-zA-Z0-9_\-]+)",
        val,
        re.IGNORECASE,
    )
    if m_short_p and not val.lower().startswith("http"):
        return f"https://web.facebook.com/share/{m_short_p.group(1)}/{m_short_p.group(2)}"

    # 2. Đã có protocol http:// hoặc https://
    if re.match(r"^https?://", val, re.IGNORECASE):
        # Nếu trong POST seeding mà link lại là https://web.facebook.com/18NvrpA3BJ (chỉ có slug token, thiếu /share/p/)
        if t_type == "POST":
            m_single_slug = re.match(
                r"^https?://(?:(?:www\.|web\.|m\.)?facebook\.com|fb\.com)/([a-zA-Z0-9_\-]{6,30})/?$",
                val,
                re.IGNORECASE,
            )
            if m_single_slug:
                slug = m_single_slug.group(1)
                system_slugs = {
                    "watch",
                    "groups",
                    "pages",
                    "photo",
                    "events",
                    "gaming",
                    "marketplace",
                    "reel",
                    "reels",
                }
                # UID_PostID (vd 100089123456_987654321) là link bài viết thật, giữ nguyên, không đổi sang /share/p/
                if slug.lower() not in system_slugs and not re.fullmatch(r"\d+_\d+", slug):
                    return f"https://web.facebook.com/share/p/{slug}"

        cleaned = clean_tracking_params(val)
        # Chuẩn hóa host về web.facebook.com
        cleaned = re.sub(
            r"^https?://(?:(?:www\.|m\.)?facebook\.com|fb\.com)",
            "https://web.facebook.com",
            cleaned,
            flags=re.IGNORECASE,
        )
        return cleaned

    # 3. Chứa domain Facebook nhưng thiếu protocol
    if re.match(r"^(?:(?:www\.|web\.|m\.)?facebook\.com|fb\.watch|fb\.com)", val, re.IGNORECASE):
        full_url = f"https://{val.lstrip('/')}"
        if t_type == "POST":
            m_single_slug = re.match(
                r"^https?://(?:(?:www\.|web\.|m\.)?facebook\.com|fb\.com)/([a-zA-Z0-9_\-]{6,30})/?$",
                full_url,
                re.IGNORECASE,
            )
            if m_single_slug:
                slug = m_single_slug.group(1)
                system_slugs = {
                    "watch",
                    "groups",
                    "pages",
                    "photo",
                    "events",
                    "gaming",
                    "marketplace",
                    "reel",
                    "reels",
                }
                # UID_PostID (vd 100089123456_987654321) là link bài viết thật, giữ nguyên, không đổi sang /share/p/
                if slug.lower() not in system_slugs and not re.fullmatch(r"\d+_\d+", slug):
                    return f"https://web.facebook.com/share/p/{slug}"

        cleaned = clean_tracking_params(full_url)
        cleaned = re.sub(
            r"^https?://(?:(?:www\.|m\.)?facebook\.com|fb\.com)",
            "https://web.facebook.com",
            cleaned,
            flags=re.IGNORECASE,
        )
        return cleaned

    clean = val.lstrip("/").rstrip("/")

    # 4. Khi nhập trực tiếp token hoặc UID không có domain:
    # Nếu là POST seeding:
    if t_type == "POST":
        # Dạng UID_PostID (vd: 100089123456_987654321) -> giữ dạng https://web.facebook.com/{clean}
        if re.match(r"^\d+_\d+$", clean):
            return f"https://web.facebook.com/{clean}"
        # Mã share post như 18NvrpA3BJ hoặc id bài viết thông thường
        return f"https://web.facebook.com/share/p/{clean}"

    # Tự động phát hiện share token (chứa cả chữ và số, độ dài 8-25 ký tự)
    if (
        re.match(r"^[a-zA-Z0-9]{8,25}$", clean)
        and any(c.isalpha() for c in clean)
        and any(c.isdigit() for c in clean)
    ):
        if t_type in ("", "POST"):
            return f"https://web.facebook.com/share/p/{clean}"

    # 5. Mặc định cho PAGE / PROFILE hoặc UID số thuần
    return f"https://web.facebook.com/{clean}"


def extract_fb_id(url: str, target_type: str = "") -> str:
    """Trích xuất UID / Page ID / Post ID sau khi xác thực link (chuẩn DBML: fb_id varchar(100) not null)."""
    if not url:
        return "unknown"
    clean = url.strip()

    # Share link Facebook: /share/(?:p|r|v)/([a-zA-Z0-9_\-]+)
    m = re.search(r"/share/(?:p|r|v)/([a-zA-Z0-9_\-]+)", clean)
    if m:
        return m.group(1)

    # 1. Post ID từ permalink: story_fbid / fbid là số hoặc chuỗi pfbid... (link kiểu mới).
    #    Phải lấy trước [?&]id= vì id= trong permalink là ID của Page, không phải của bài viết.
    m = re.search(r"[?&](?:story_fbid|fbid)=([A-Za-z0-9]+)", clean)
    if m:
        return m.group(1)

    # 2. Profile / UID từ query param: ?id=1000...
    m = re.search(r"[?&]id=(\d+)", clean)
    if m:
        return m.group(1)

    # 3. Post ID từ /posts/(\d+) hoặc /posts/(\w+)
    m = re.search(r"/posts/([a-zA-Z0-9_\-]+)", clean)
    if m:
        return m.group(1)

    # 4. Reel / Video: /reel/(\d+) hoặc /videos/(\d+) hoặc /watch/?v=(\d+)
    m = re.search(r"/(?:reel|videos)/([a-zA-Z0-9_\-]+)", clean)
    if m:
        return m.group(1)
    m = re.search(r"[?&]v=(\d+)", clean)
    if m:
        return m.group(1)

    # 5. Page format: /p/Ten-Page-(\d+)
    m = re.search(r"/p/[^/]+-(\d+)", clean)
    if m:
        return m.group(1)

    # 6. Username / slug sau domain: facebook.com/username
    m = re.search(
        r"facebook\.com/(?:people/[^/]+/(\d+)|profile\.php\?id=(\d+)|([a-zA-Z0-9._\-]+))",
        clean,
    )
    if m:
        val = m.group(1) or m.group(2) or m.group(3)
        if val and val.lower() not in (
            "groups",
            "pages",
            "watch",
            "photo",
            "events",
            "share",
            "profile.php",
        ):
            return val

    # Fallback: Trích xuất slug cuối URL hoặc md5 hash
    clean_no_query = clean.split("?")[0].rstrip("/")
    slug = clean_no_query.split("/")[-1]
    if slug and len(slug) <= 100:
        return slug
    return hashlib.md5(clean.encode("utf-8")).hexdigest()[:32]


VN_TZ = timezone(timedelta(hours=7))


def to_vn_iso(dt: datetime | None) -> str | None:
    """Đổi datetime trong DB (đã là giờ Việt Nam, naive - xem vn_now) sang chuỗi ISO có múi giờ +07:00."""
    vn = to_vn(dt)
    return vn.isoformat() if vn else None


def to_vn(dt: datetime | None) -> datetime | None:
    """Gắn múi giờ Việt Nam (UTC+7) cho datetime trong DB. Các bảng seeding_* lưu sẵn giờ Việt Nam (naive)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=VN_TZ)
    return dt.astimezone(VN_TZ)


def to_vn_display(dt: datetime | None) -> str:
    """Chuỗi 'dd/mm/YYYY HH:MM:SS (UTC+7)' theo giờ Việt Nam, '-' nếu không có giá trị."""
    vn = to_vn(dt)
    return vn.strftime("%d/%m/%Y %H:%M:%S (UTC+7)") if vn else "-"


def vn_date_bound(date_str: str, end_of_day: bool = False) -> datetime:
    """Ngày 'YYYY-MM-DD' -> mốc 00:00 giờ Việt Nam (naive) để so với cột trong DB (đã lưu giờ Việt Nam).
    end_of_day=True trả về 00:00 của ngày hôm sau (dùng với phép <)."""
    d = datetime.strptime(date_str[:10], "%Y-%m-%d")
    if end_of_day:
        d += timedelta(days=1)
    return d


def share_range_per_post(total: int, parts: int) -> tuple:
    """Khoảng số lượt chia sẻ mỗi bài: ±20% quanh mức chia đều (vd 50 lượt / 4 bài -> 10..15).
    Mỗi bài luôn có ít nhất 1 lượt: đủ nick thì tối thiểu 1, ít nick hơn số bài thì mỗi bài đúng 1 lượt
    (bài không được chia sẽ được giao thêm cho nick đang share ít nhất, xem create_seeding_campaign).
    Dùng số nguyên để tránh sai số float. Frontend (PostSummaryCards.jsx) hiển thị cùng công thức."""
    if parts <= 1:
        return (total, total)
    if total < parts:
        return (1, 1)
    return (max(1, (4 * total) // (5 * parts)), -(-6 * total // (5 * parts)))


def _split_share_accounts(uids: list[str], post_count: int) -> list[list[str]]:
    """Chia các nick cho các bài để chia sẻ: tổng lượt chia sẻ = số nick, mỗi nick chỉ share 1 bài.
    Bắt đầu chia đều rồi dịch ngẫu nhiên từng lượt giữa các bài, giữ mỗi bài trong share_range_per_post."""
    if post_count <= 0:
        return []
    total = len(uids)
    sizes = [
        total // post_count + (1 if i < total % post_count else 0)
        for i in range(post_count)
    ]
    if post_count > 1:
        lo, hi = share_range_per_post(total, post_count)
        for _ in range(total * 2):
            a, b = random.sample(range(post_count), 2)
            if sizes[a] - 1 >= lo and sizes[b] + 1 <= hi:
                sizes[a] -= 1
                sizes[b] += 1
    shuffled = list(uids)
    random.shuffle(shuffled)
    groups, start = [], 0
    for size in sizes:
        groups.append(shuffled[start : start + size])
        start += size
    return groups


def get_user_draft_comments(db: Session, user_id: int | None = None) -> list[str]:
    """Lấy danh sách các câu bình luận mẫu (campaign_id IS NULL) từ bảng seeding_comments theo user sở hữu."""
    try:
        q = db.query(SeedingComment.content).filter(SeedingComment.campaign_id == None)
        if user_id is not None:
            q = q.filter(SeedingComment.created_by == user_id)
        else:
            q = q.filter(SeedingComment.created_by == None)
        rows = q.order_by(SeedingComment.id.asc()).all()
        return [r[0] for r in rows if r[0]]
    except Exception as e:
        logger.warning(f"Lỗi lấy seeding_comments từ DB: {e}")
        return []


# ─────────────────────────────────────────────────────────────
# SCHEMAS
# ─────────────────────────────────────────────────────────────
class TargetInputItem(BaseModel):
    url: str
    fb_id: str | None = None
    display_name: str | None = None
    content_preview: str | None = None
    note: str | None = None
    source: str | None = "MANUAL"


class ValidateTargetsRequest(BaseModel):
    target_type: str  # 'PAGE', 'PROFILE', 'POST'
    urls: list[str]


class CreateCampaignRequest(BaseModel):
    name: str | None = None
    campaign_type: str  # 'PAGE', 'PROFILE', 'POST'
    actions: list[str]  # ['FOLLOW'] hoặc ['REACT', 'COMMENT', 'SHARE']
    reactions: list[str] | None = (
        None  # ['LIKE', 'LOVE', 'CARE', 'HAHA', 'WOW', 'SAD', 'ANGRY']
    )
    comments: list[str] | None = None
    targets: list[TargetInputItem]
    account_count: int = 50
    threads: int = 1
    uids: list[str] | None = None
    delay_seconds_min: int = 30
    delay_seconds_max: int = 60
    owner_username: str | None = None
    created_by: int | None = None


class AddCommentsRequest(BaseModel):
    comments: list[str]


# ─────────────────────────────────────────────────────────────
# 1. QUẢN LÝ MỤC TIÊU SEEDING (LƯU TRỰC TIẾP VÀO DATABASE PHÂN THEO NGƯỜI DÙNG)
# ─────────────────────────────────────────────────────────────
@router.get("/targets")
def list_seeding_targets(
    target_type: str | None = None,
    include_completed: bool = Query(False),
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Lấy danh sách các mục tiêu seeding đã lưu trong bảng seeding_targets lọc theo người dùng sở hữu.
    Mặc định loại trừ các mục tiêu đã chạy thành công trong lịch sử hoặc đang chạy.
    """
    current_user = get_current_user_info(request, authorization)
    query = db.query(SeedingTarget)
    if target_type:
        query = query.filter(SeedingTarget.target_type == target_type.upper())

    # Phân quyền: User thường CHỈ xem các targets do chính mình tạo/import
    if current_user:
        role = (
            current_user.get("role") or current_user.get("_role_claim") or "user"
        ).lower()
        is_admin = role in ("admin", "superadmin", "administrator")
        if not is_admin:
            query = query.filter(SeedingTarget.created_by == current_user["id"])

    # Chỉ loại trừ các link đã chạy THÀNH CÔNG (COMPLETED)
    # Các link chưa chạy hoặc chạy thất bại (FAILED), bị dừng (STOPPED) vẫn tiếp tục hiển thị
    if not include_completed:
        completed_stmt = (
            select(SeedingCampaignTarget.target_id)
            .join(SeedingCampaign, SeedingCampaignTarget.campaign_id == SeedingCampaign.id)
            .where(
                or_(
                    SeedingCampaign.status == "COMPLETED",
                    and_(
                        SeedingCampaignTarget.success_count > 0,
                        SeedingCampaignTarget.failed_count == 0,
                    ),
                )
            )
        )
        query = query.filter(~SeedingTarget.id.in_(completed_stmt))

    targets = query.order_by(SeedingTarget.id.asc()).all()
    return {
        "total": len(targets),
        "targets": [
            {
                "id": t.id,
                "stt": idx + 1,
                "url": t.url,
                "fb_id": t.fb_id,
                "display_name": t.display_name,
                "target_type": t.target_type,
                "created_by": t.created_by,
                "created_at": to_vn_iso(t.created_at),
            }
            for idx, t in enumerate(targets)
        ],
    }


@router.post("/targets/validate")
def validate_targets(
    req: ValidateTargetsRequest,
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Lọc trùng, kiểm tra định dạng và LƯU TRỰC TIẾP vào bảng seeding_targets gắn với created_by của user."""
    current_user = get_current_user_info(request, authorization)
    user_id = current_user.get("id") if current_user else None

    valid_targets = []
    seen_urls = set()
    seen_fb_ids = set()
    camp_type = req.target_type.upper()

    for idx, raw_url in enumerate(req.urls):
        url = normalize_target_url(raw_url, camp_type)
        if not url:
            continue

        fb_id = extract_fb_id(url, camp_type)

        # Lọc trùng lặp qua cả URL chuẩn hóa và fb_id cốt lõi
        if url in seen_urls or (fb_id and fb_id != "unknown" and fb_id in seen_fb_ids):
            continue
        seen_urls.add(url)
        if fb_id and fb_id != "unknown":
            seen_fb_ids.add(fb_id)

        # Trích xuất display_name chuẩn: Page / Trang cá nhân / Bài viết + fb_id
        if camp_type == "PAGE":
            display_name = f"Page {fb_id}"
        elif camp_type == "PROFILE":
            display_name = f"Trang cá nhân {fb_id}"
        elif camp_type == "POST":
            display_name = f"Bài viết {fb_id}"
        else:
            display_name = f"{fb_id}"

        # Kiểm tra đối tượng theo (target_type, fb_id/url, created_by) để mỗi user có mục tiêu độc lập
        target_obj_q = db.query(SeedingTarget).filter(
            SeedingTarget.target_type == camp_type,
            or_(SeedingTarget.fb_id == fb_id, SeedingTarget.url == url),
        )
        if user_id is not None:
            target_obj_q = target_obj_q.filter(SeedingTarget.created_by == user_id)
        else:
            target_obj_q = target_obj_q.filter(SeedingTarget.created_by.is_(None))
        target_obj = target_obj_q.first()

        if not target_obj:
            target_obj = SeedingTarget(
                target_type=camp_type,
                fb_id=fb_id,
                url=url,
                display_name=display_name,
                created_by=user_id,
            )
            db.add(target_obj)
            db.flush()
        else:
            target_obj.display_name = display_name
            if not target_obj.fb_id:
                target_obj.fb_id = fb_id

        valid_targets.append(
            {
                "id": target_obj.id,
                "stt": len(valid_targets) + 1,
                "url": target_obj.url,
                "fb_id": target_obj.fb_id,
                "display_name": target_obj.display_name or display_name,
                "created_by": target_obj.created_by,
            }
        )

    db.commit()

    # Lấy toàn bộ danh sách các link CHƯA HOÀN THÀNH THÀNH CÔNG của user này trong DB để đồng bộ giao diện
    all_current_q = db.query(SeedingTarget).filter(
        SeedingTarget.target_type == camp_type
    )
    if user_id is not None:
        all_current_q = all_current_q.filter(SeedingTarget.created_by == user_id)

    # CHỈ ẨN CÁC LINK ĐÃ CHẠY THÀNH CÔNG (COMPLETED)
    completed_stmt = (
        select(SeedingCampaignTarget.target_id)
        .join(SeedingCampaign, SeedingCampaignTarget.campaign_id == SeedingCampaign.id)
        .where(
            or_(
                SeedingCampaign.status == "COMPLETED",
                and_(
                    SeedingCampaignTarget.success_count > 0,
                    SeedingCampaignTarget.failed_count == 0,
                ),
            )
        )
    )
    all_current_q = all_current_q.filter(~SeedingTarget.id.in_(completed_stmt))
    all_current = all_current_q.order_by(SeedingTarget.id.asc()).all()

    return {
        "total": len(all_current),
        "targets": [
            {
                "id": t.id,
                "stt": idx + 1,
                "url": t.url,
                "fb_id": t.fb_id,
                "display_name": t.display_name,
                "created_by": t.created_by,
            }
            for idx, t in enumerate(all_current)
        ],
    }


@router.delete("/targets/by-url")
def delete_target_by_url(
    url: str = Query(...),
    target_type: str | None = Query(None),
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Xóa mục tiêu theo URL khỏi database của user.
    Dữ liệu lịch sử đã được lưu trực tiếp display_name và target_url vào seeding_tasks và seeding_campaign_targets nên vẫn bảo toàn 100%.
    """
    current_user = get_current_user_info(request, authorization)
    query = db.query(SeedingTarget).filter(SeedingTarget.url == url.strip())
    if target_type:
        query = query.filter(SeedingTarget.target_type == target_type.upper())
    if current_user:
        role = (
            current_user.get("role") or current_user.get("_role_claim") or "user"
        ).lower()
        if role not in ("admin", "superadmin", "administrator"):
            query = query.filter(SeedingTarget.created_by == current_user["id"])

    targets = query.all()
    for t in targets:
        # Ngắt tham chiếu target_id ở tasks và campaign_targets để không lỗi FK và bảo toàn lịch sử
        db.query(SeedingTask).filter(SeedingTask.target_id == t.id).update(
            {SeedingTask.target_id: None}, synchronize_session=False
        )
        db.query(SeedingCampaignTarget).filter(SeedingCampaignTarget.target_id == t.id).update(
            {SeedingCampaignTarget.target_id: None}, synchronize_session=False
        )
        db.delete(t)
    db.commit()
    return {"success": True}


@router.delete("/targets/clear")
def clear_seeding_targets(
    target_type: str | None = Query(None),
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Xóa toàn bộ mục tiêu theo loại của user hiện tại khỏi database.
    Dữ liệu lịch sử đã được lưu trực tiếp display_name và target_url vào seeding_tasks và seeding_campaign_targets nên vẫn bảo toàn 100%.
    """
    current_user = get_current_user_info(request, authorization)
    query = db.query(SeedingTarget)
    if target_type:
        query = query.filter(SeedingTarget.target_type == target_type.upper())
    if current_user:
        role = (
            current_user.get("role") or current_user.get("_role_claim") or "user"
        ).lower()
        if role not in ("admin", "superadmin", "administrator"):
            query = query.filter(SeedingTarget.created_by == current_user["id"])

    # Chỉ xóa những targets chưa thành công khỏi danh sách hiển thị của user
    completed_stmt = (
        select(SeedingCampaignTarget.target_id)
        .join(SeedingCampaign, SeedingCampaignTarget.campaign_id == SeedingCampaign.id)
        .where(
            or_(
                SeedingCampaign.status == "COMPLETED",
                and_(
                    SeedingCampaignTarget.success_count > 0,
                    SeedingCampaignTarget.failed_count == 0,
                ),
            )
        )
    )
    targets_to_clear = query.filter(~SeedingTarget.id.in_(completed_stmt)).all()
    deleted_count = len(targets_to_clear)
    for t in targets_to_clear:
        db.query(SeedingTask).filter(SeedingTask.target_id == t.id).update(
            {SeedingTask.target_id: None}, synchronize_session=False
        )
        db.query(SeedingCampaignTarget).filter(SeedingCampaignTarget.target_id == t.id).update(
            {SeedingCampaignTarget.target_id: None}, synchronize_session=False
        )
        db.delete(t)
    db.commit()
    return {"success": True, "deleted": deleted_count}


# 1.1 QUẢN LÝ BÌNH LUẬN NHÁP (KHO BÌNH LUẬN)
# ─────────────────────────────────────────────────────────────
@router.get("/comments")
def list_seeding_comments(
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Lấy danh sách các câu bình luận đã lưu trong Database của user hiện tại."""
    current_user = get_current_user_info(request, authorization)
    user_id = current_user.get("id") if current_user else None
    drafts = get_user_draft_comments(db, user_id)
    return {"total": len(drafts), "comments": drafts}


@router.post("/comments/add")
def add_seeding_comments(
    req: AddCommentsRequest,
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Lưu danh sách bình luận trực tiếp vào bảng seeding_comments (campaign_id IS NULL) cho user hiện tại."""
    current_user = get_current_user_info(request, authorization)
    user_id = current_user.get("id") if current_user else None

    existing_comments = get_user_draft_comments(db, user_id)
    existing_set = set(c.strip() for c in existing_comments)

    added = []
    for raw in req.comments:
        c = (raw or "").strip()
        if c and c not in existing_set:
            new_obj = SeedingComment(campaign_id=None, created_by=user_id, content=c)
            db.add(new_obj)
            existing_set.add(c)
            added.append(c)

    if added:
        db.commit()

    updated = get_user_draft_comments(db, user_id)
    return {
        "success": True,
        "added_count": len(added),
        "total": len(updated),
        "comments": updated,
    }


@router.delete("/comments/delete")
def delete_seeding_comment(
    content: str = Query(...),
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Xóa 1 câu bình luận nháp khỏi kho của user hiện tại."""
    current_user = get_current_user_info(request, authorization)
    user_id = current_user.get("id") if current_user else None

    q = db.query(SeedingComment).filter(
        SeedingComment.campaign_id == None, SeedingComment.content == content.strip()
    )
    if user_id is not None:
        q = q.filter(SeedingComment.created_by == user_id)
    else:
        q = q.filter(SeedingComment.created_by == None)

    q.delete(synchronize_session=False)
    db.commit()
    return {"success": True}


@router.delete("/comments/clear")
def clear_seeding_comments(
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Xóa tất cả câu bình luận nháp của user hiện tại."""
    current_user = get_current_user_info(request, authorization)
    user_id = current_user.get("id") if current_user else None

    q = db.query(SeedingComment).filter(SeedingComment.campaign_id == None)
    if user_id is not None:
        q = q.filter(SeedingComment.created_by == user_id)
    else:
        q = q.filter(SeedingComment.created_by == None)

    q.delete(synchronize_session=False)
    db.commit()
    return {"success": True, "deleted": True}


def _get_action_label(act: str, camp_type: str = "POST") -> str:
    """Trả về tên hành động tiếng Việt chuẩn xác để ghi thông báo lỗi khi đã tương tác."""
    act_upper = (act or "").upper().strip()
    if act_upper in ("FOLLOW", "LIKE_PAGE"):
        return "theo dõi" if camp_type == "PAGE" else "follow"
    elif act_upper == "REACT":
        return "thả cảm xúc"
    elif act_upper == "COMMENT":
        return "bình luận"
    elif act_upper == "SHARE":
        return "chia sẻ"
    return "tương tác"


# ─────────────────────────────────────────────────────────────
# 2. TẠO CHIẾN DỊCH SEEDING & SINH TÁC VỤ THẬT
# ─────────────────────────────────────────────────────────────
@router.post("/campaigns/create")
def create_seeding_campaign(
    req: CreateCampaignRequest,
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Tạo mới chiến dịch Seeding chuẩn DBML Module 8, liên kết tài khoản thật trong DB và tạo hàng đợi task."""
    if not req.targets:
        raise HTTPException(
            status_code=400, detail="Danh sách mục tiêu không được rỗng"
        )

    # Xác định người dùng tạo chiến dịch (created_by: users.id)
    current_user = get_current_user_info(request, authorization)
    created_by_int = None
    if current_user and current_user.get("id"):
        created_by_int = current_user["id"]
    elif req.created_by is not None:
        created_by_int = req.created_by
    elif req.owner_username:
        try:
            created_by_int = int(req.owner_username)
        except ValueError:
            try:
                u_row = db.execute(
                    text("SELECT id FROM users WHERE username = :u LIMIT 1"),
                    {"u": req.owner_username},
                ).fetchone()
                if u_row:
                    created_by_int = u_row[0]
            except Exception:
                created_by_int = None

    # Mỗi lúc chỉ chạy 1 lô seeding (mọi loại trang): các lô dùng chung nick / Chrome profile
    running = _find_running_campaign(db, created_by_int)
    if running:
        raise HTTPException(status_code=409, detail=_running_conflict_detail(running))

    if req.campaign_type.upper() == "POST":
        chosen_actions = {a.upper().strip() for a in (req.actions or [])}
        if "REACT" in chosen_actions and not any(
            r and r.strip() for r in (req.reactions or [])
        ):
            raise HTTPException(
                status_code=400, detail="Vui lòng chọn ít nhất 1 cảm xúc Facebook!"
            )
        if "COMMENT" in chosen_actions:
            comment_src = req.comments or get_user_draft_comments(db, created_by_int)
            if not any(c and c.strip() for c in comment_src):
                raise HTTPException(
                    status_code=400, detail="Vui lòng nhập ít nhất 1 câu bình luận mẫu!"
                )
    # 1. Lấy danh sách UID tài khoản Facebook thật từ DB (bắt buộc Live và Đã đăng nhập)
    # Xác định danh tính người dùng sở hữu (ID dạng chuỗi và username nếu có)
    owner_identifiers = []
    if created_by_int is not None:
        owner_identifiers.append(str(created_by_int))
    if current_user and current_user.get("username"):
        owner_identifiers.append(str(current_user["username"]))
    if req.owner_username:
        owner_identifiers.append(str(req.owner_username))

    owner_identifiers = list(set([str(x).strip() for x in owner_identifiers if x]))

    q = db.query(Account).filter(
        Account.status == "LIVE", Account.login_status == "LOGGED_IN"
    )

    # ĐẢM BẢO CHỈ LẤY TÀI KHOẢN MÀ CHÍNH USER ĐÓ ĐÃ IMPORT VÀ SỞ HỮU
    if owner_identifiers:
        q = q.filter(Account.user_id.in_(owner_identifiers))

    if req.account_count <= 0:
        raise HTTPException(status_code=400, detail="Số lượng tài khoản muốn chạy phải lớn hơn 0!")

    if req.uids and len(req.uids) > 0:
        q = q.filter(Account.uid.in_(req.uids))
    # Chọn NGẪU NHIÊN account_count nick trong số nick khả dụng (không lấy cố định N nick đầu danh sách),
    # để mọi nick đều được dùng qua các lần chạy. random.sample trả về thứ tự ngẫu nhiên nên thứ tự chạy cũng ngẫu nhiên.
    eligible_accounts = q.all()
    available_accounts = random.sample(eligible_accounts, min(req.account_count, len(eligible_accounts)))

    if not available_accounts:
        raise HTTPException(
            status_code=400,
            detail="Không có tài khoản Facebook nào khả dụng thuộc quyền sở hữu của bạn! Yêu cầu tài khoản do bạn import phải có trạng thái 'Live' và 'Đã đăng nhập' (logged_in). Vui lòng vào trang Quản lý tài khoản (Accounts) để kiểm tra.",
        )

    account_uids = [acc.uid for acc in available_accounts]
    used_uids = account_uids[: req.account_count]
    actual_account_count = len(used_uids)

    # ─────────────────────────────────────────────────────────────
    # TÁCH MỖI MỤC TIÊU (PAGE, PROFILE, POST) THÀNH 1 CHIẾN DỊCH ĐỘC LẬP
    # Số lượng (total_planned) bằng đúng số nick Facebook thực tế chạy!
    # ─────────────────────────────────────────────────────────────
    camp_type = req.campaign_type.upper()
    if camp_type == "PAGE":
        type_label = "Page"
    elif camp_type == "PROFILE":
        type_label = "Trang cá nhân"
    else:
        type_label = "Bài viết"

    created_campaigns = []
    total_tasks_all = 0
    reactions_pool = req.reactions or ["LIKE"]

    # Phân bổ lượt cho chiến dịch Bài viết:
    # - Cảm xúc: mọi nick trên mỗi bài.
    # - Bình luận: random 1 nửa số nick trên mỗi bài (vd 50 nick -> 25 bình luận mỗi bài).
    # - Chia sẻ: tổng = số nick, chia ngẫu nhiên cho các bài (vd 50 nick / 4 bài -> mỗi bài 10..15).
    post_actions = (
        {a.upper().strip() for a in (req.actions or [])}
        if camp_type == "POST"
        else set()
    )
    comment_quota = max(1, actual_account_count // 2)
    share_groups = (
        _split_share_accounts(used_uids, len(req.targets))
        if "SHARE" in post_actions
        else []
    )
    share_load = {u: 0 for u in used_uids}   # số bài mỗi nick đang được giao share
    for group in share_groups:
        for u in group:
            share_load[u] += 1

    # Thời gian nghỉ: không âm, nhập ngược (vd 20 - 10) thì đảo lại cho đúng thứ tự
    delay_min = max(0, min(req.delay_seconds_min, req.delay_seconds_max))
    delay_max = max(0, req.delay_seconds_min, req.delay_seconds_max)

    for idx, item in enumerate(req.targets):
        fb_id = item.fb_id or extract_fb_id(item.url, camp_type)

        # Chuẩn hóa display_name chuẩn: Page / Trang cá nhân / Bài viết + fb_id
        if camp_type == "PAGE":
            auto_display_name = f"Page {fb_id}"
        elif camp_type == "PROFILE":
            auto_display_name = f"Trang cá nhân {fb_id}"
        elif camp_type == "POST":
            auto_display_name = f"Bài viết {fb_id}"
        else:
            auto_display_name = f"{fb_id}"

        # 1. Tìm hoặc tạo SeedingTarget tuân thủ created_by của người dùng
        target_q = db.query(SeedingTarget).filter(
            SeedingTarget.target_type == camp_type,
            or_(SeedingTarget.fb_id == fb_id, SeedingTarget.url == item.url),
        )
        if created_by_int is not None:
            target_q = target_q.filter(SeedingTarget.created_by == created_by_int)
        target = target_q.first()

        if not target:
            target = SeedingTarget(
                target_type=camp_type,
                fb_id=fb_id,
                url=item.url,
                display_name=auto_display_name,
                created_by=created_by_int,
            )
            db.add(target)
            db.flush()
        else:
            target.display_name = auto_display_name
            if not target.fb_id:
                target.fb_id = fb_id

        # Chuỗi hành động: POST lấy req.actions, PAGE/PROFILE mặc định FOLLOW
        actions_str = (
            ",".join(req.actions) if (camp_type == "POST" and req.actions) else "FOLLOW"
        )

        # 2. Tạo record SeedingCampaign chuẩn DBML (không còn cột name)
        camp = SeedingCampaign(
            campaign_type=camp_type,
            actions=actions_str,
            reactions=",".join(req.reactions) if req.reactions else None,
            account_count=actual_account_count,
            delay_seconds_min=delay_min,
            delay_seconds_max=delay_max,
            status="PENDING",
            total_planned=actual_account_count,
            total_success=0,
            total_failed=0,
            created_by=created_by_int,
            created_at=vn_now(),
        )
        db.add(camp)
        db.flush()

        # 3. Chuẩn bị kho comment để random (chỉ khi chiến dịch POST có chọn COMMENT).
        # Chưa lưu vào DB: chỉ câu nào được random trúng cho task mới được lưu ở bước 5.
        comment_texts = []
        if "COMMENT" in post_actions:
            # Fallback lấy kho comment mẫu từ database của user nếu req.comments rỗng
            src = req.comments or get_user_draft_comments(db, created_by_int)
            comment_texts = [t.strip() for t in src if t and t.strip()]
        saved_comment_by_text = {}

        # 4. Tạo SeedingCampaignTarget chuẩn DBML
        camp_target = SeedingCampaignTarget(
            campaign_id=camp.id,
            target_id=target.id,
            display_name=target.display_name or auto_display_name,
            target_url=target.url,
            note=item.note,
            source=item.source or "MANUAL",
            planned_count=actual_account_count,
            success_count=0,
            failed_count=0,
        )
        db.add(camp_target)
        db.flush()

        # 5. Sinh task chi tiết trong seeding_tasks theo đúng thứ tự ưu tiên:
        # 1. Like bài viết (REACT) -> 2. Bình luận (COMMENT) -> 3. Chia sẻ (SHARE)
        if camp_type == "POST" and req.actions:
            desired_order = ["REACT", "COMMENT", "SHARE"]
            cleaned_actions = [x.upper().strip() for x in req.actions]
            actions_list = [a for a in desired_order if a in cleaned_actions]
            for a in cleaned_actions:
                if a not in actions_list:
                    actions_list.append(a)
        else:
            actions_list = ["FOLLOW"]

        # Nick được giao bình luận / chia sẻ ở bài này. Bình luận ưu tiên nick chưa bình luận bài này.
        comment_uids = set()
        if "COMMENT" in post_actions:
            done_comment_uids = {
                u
                for (u,) in db.query(SeedingTask.account_uid)
                .filter(
                    SeedingTask.target_id == target.id,
                    SeedingTask.action == "COMMENT",
                    SeedingTask.status.in_(["PENDING", "RUNNING", "SUCCESS"]),
                )
                .all()
            }
            eligible_uids = [u for u in used_uids if u not in done_comment_uids]
            if eligible_uids:
                comment_uids = set(
                    random.sample(eligible_uids, min(comment_quota, len(eligible_uids)))
                )
            else:
                # Nếu tất cả nick đều đã bình luận từ trước, vẫn đưa vào để đánh dấu thất bại
                comment_uids = set(used_uids)

        share_uids = set(share_groups[idx]) if share_groups else set()
        if "SHARE" in post_actions and not share_uids and used_uids:
            # Ít nick hơn số bài: bài không được chia lượt nào vẫn có đúng 1 nick share (nick đang share ít nhất),
            # không để cả loạt nick cùng share 1 bài.
            least = min(share_load.values())
            pick = random.choice([u for u, n in share_load.items() if n == least])
            share_load[pick] += 1
            share_uids = {pick}

        planned_uids = set()
        uids_with_pending = set()

        for uid in used_uids:
            for action_name in actions_list:
                act = action_name.upper().strip()

                if act == "COMMENT" and uid not in comment_uids:
                    continue
                if act == "SHARE" and uid not in share_uids:
                    continue

                # Kiểm tra PARTIAL INDEX uq_seeding_tasks_once:
                # Nếu tài khoản đã thực hiện hành động này thành công (hoặc đang chạy) trên mục tiêu này trước đó:
                # Đánh dấu tác vụ là THẤT BẠI (FAILED) để thông báo rõ ràng trong lịch sử chi tiết.
                existing_active = (
                    db.query(SeedingTask)
                    .filter(
                        SeedingTask.account_uid == uid,
                        SeedingTask.target_id == target.id,
                        SeedingTask.action == act,
                        SeedingTask.status.in_(["PENDING", "RUNNING", "SUCCESS"]),
                    )
                    .first()
                )
                if existing_active:
                    act_label = _get_action_label(act, camp_type)
                    type_text = (
                        "Page"
                        if camp_type == "PAGE"
                        else (
                            "trang cá nhân"
                            if camp_type == "PROFILE"
                            else "bài viết"
                        )
                    )
                    task = SeedingTask(
                        campaign_id=camp.id,
                        campaign_target_id=camp_target.id,
                        target_id=target.id,
                        display_name=target.display_name or auto_display_name,
                        target_url=target.url,
                        account_uid=uid,
                        action=act,
                        reaction=None,
                        comment_id=None,
                        status="FAILED",
                        error_message=f"Tài khoản đã {act_label} {type_text} này rồi",
                        started_at=vn_now(),
                        finished_at=vn_now(),
                    )
                    db.add(task)
                    planned_uids.add(uid)
                    total_tasks_all += 1
                    continue

                uids_with_pending.add(uid)
                assigned_reaction = None
                if act == "REACT":
                    assigned_reaction = random.choice(reactions_pool)

                assigned_comment_id = None
                if act == "COMMENT" and comment_texts:
                    chosen_text = random.choice(comment_texts)
                    chosen_comment = saved_comment_by_text.get(chosen_text)
                    if chosen_comment is None:
                        chosen_comment = SeedingComment(
                            campaign_id=camp.id,
                            created_by=created_by_int,
                            content=chosen_text,
                        )
                        db.add(chosen_comment)
                        db.flush()  # để có chosen_comment.id
                        saved_comment_by_text[chosen_text] = chosen_comment
                    assigned_comment_id = chosen_comment.id

                task = SeedingTask(
                    campaign_id=camp.id,
                    campaign_target_id=camp_target.id,
                    target_id=target.id,
                    display_name=target.display_name or auto_display_name,
                    target_url=target.url,
                    account_uid=uid,
                    action=act,
                    reaction=assigned_reaction,
                    comment_id=assigned_comment_id,
                    status="PENDING",
                )
                db.add(task)
                planned_uids.add(uid)
                total_tasks_all += 1

        # Số lượng = số nick thực sự có tác vụ ở bài này (mỗi nick = 1 lượt, giống cách đếm thành công / thất bại)
        # Các nick chỉ toàn task FAILED (do đã follow/like từ trước) thì tính vào total_failed ngay
        pre_failed_count = len(planned_uids - uids_with_pending)
        camp.total_planned = len(planned_uids)
        camp.total_failed = pre_failed_count
        camp_target.planned_count = len(planned_uids)
        camp_target.failed_count = pre_failed_count

        created_campaigns.append(camp)

    db.commit()

    first_camp = created_campaigns[0]
    camp_ids = [c.id for c in created_campaigns]

    # Lưu liên kết chuỗi chiến dịch trong bộ nhớ để điều phối tuần tự
    for cid in camp_ids:
        _batch_campaign_chains[cid] = camp_ids

    return {
        "id": first_camp.id,
        "name": first_camp.target_summary,
        "campaign_type": camp_type,
        "status": first_camp.status,
        "total_targets": len(created_campaigns),
        "total_accounts": actual_account_count,
        "total_tasks": total_tasks_all,
        "campaign_ids": camp_ids,
        "message": f"Tạo thành công {len(created_campaigns)} chiến dịch cho {len(created_campaigns)} {type_label} riêng biệt. Mỗi {type_label} gồm {actual_account_count} tài khoản.",
    }


# ─────────────────────────────────────────────────────────────
# 3. THI HÀNH CHIẾN DỊCH BẰNG SELENIUM ĐA LUỒNG THẬT (NO MOCK)
# ─────────────────────────────────────────────────────────────
def _fail_remaining_campaign_tasks(
    db: Session,
    campaign_id: int,
    reason: str = "Người dùng yêu cầu dừng chiến dịch (Đã dừng thủ công)",
) -> int:
    """Đánh dấu tất cả các tác vụ chưa hoàn tất (PENDING, RUNNING) của chiến dịch thành FAILED
    với lý do dừng rõ ràng, đồng thời đồng bộ lại failed_count và total_failed."""
    now = vn_now()
    pending_or_running_tasks = (
        db.query(SeedingTask)
        .filter(
            SeedingTask.campaign_id == campaign_id,
            SeedingTask.status.in_(["PENDING", "RUNNING"]),
        )
        .all()
    )
    count = len(pending_or_running_tasks)
    for tk in pending_or_running_tasks:
        tk.status = "FAILED"
        tk.error_message = reason
        tk.finished_at = now

    camp = db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
    if camp:
        if camp.status in ("PENDING", "RUNNING"):
            camp.status = "STOPPED"
        camp.finished_at = now
        camp.total_failed = max(0, (camp.total_planned or 0) - (camp.total_success or 0))

    camp_targets = (
        db.query(SeedingCampaignTarget)
        .filter(SeedingCampaignTarget.campaign_id == campaign_id)
        .all()
    )
    for ct in camp_targets:
        ct.failed_count = max(0, (ct.planned_count or 0) - (ct.success_count or 0))

    return count


def _count_account_result(db: Session, campaign_id: int, success: bool):
    """Cộng kết quả của 1 nick vào chiến dịch (mỗi nick = 1 lượt thành công hoặc thất bại).
    Cộng bằng 1 câu UPDATE trong DB (cột = cột + 1), không đọc lên rồi cộng trong Python:
    2 nick chạy song song (2 luồng) cùng đọc total_failed = 0 rồi cùng ghi 1 -> mất 1 lượt."""
    camp_col = SeedingCampaign.total_success if success else SeedingCampaign.total_failed
    tar_col = SeedingCampaignTarget.success_count if success else SeedingCampaignTarget.failed_count
    db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).update(
        {camp_col: camp_col + 1}, synchronize_session=False
    )
    db.query(SeedingCampaignTarget).filter(SeedingCampaignTarget.campaign_id == campaign_id).update(
        {tar_col: tar_col + 1}, synchronize_session=False
    )
    db.commit()


def _process_account_tasks(
    campaign_id: int,
    uid: str,
    task_ids: list[int],
    delay_min: int,
    delay_max: int,
    owner: str | None = None,
):
    """Xử lý toàn bộ tác vụ của một tài khoản trên trình duyệt Chrome riêng biệt."""
    # Thời gian nghỉ lưu từ trước có thể bị ngược / âm: random.randint(20, 10) sẽ lỗi và làm sập luồng của nick
    delay_min, delay_max = sorted((max(0, delay_min or 0), max(0, delay_max or 0)))
    token = owner_context.set(owner) if owner else None
    driver = None
    account_counted = False   # đã cộng lượt thành công / thất bại của nick này vào chiến dịch chưa
    try:
        if _active_seeding_campaigns.get(campaign_id, {}).get("stop_requested"):
            with _scoped_db() as s:
                for tid in task_ids:
                    rem_t = s.query(SeedingTask).filter(SeedingTask.id == tid).first()
                    if rem_t and rem_t.status in ("PENDING", "RUNNING"):
                        rem_t.status = "FAILED"
                        rem_t.error_message = "Người dùng yêu cầu dừng chiến dịch (Đã dừng thủ công)"
                        rem_t.finished_at = vn_now()
            return

        with _scoped_db() as s:
            account_record = s.query(Account).filter(Account.uid == uid).first()
            if not account_record:
                logger.error(f"Account {uid} not found in DB")
                return

            proxy = account_record.proxy
            acc_label = account_record.profile_name or uid

            # Thứ tự thực thi luôn đúng: 1. Like (REACT) -> 2. Comment (COMMENT) -> 3. Share (SHARE)
            action_priority = {
                "REACT": 1,
                "LIKE": 1,
                "COMMENT": 2,
                "SHARE": 3,
                "FOLLOW": 4,
                "LIKE_PAGE": 4,
            }
            task_objs = s.query(SeedingTask).filter(SeedingTask.id.in_(task_ids)).all()
            task_objs.sort(key=lambda t: action_priority.get(t.action, 99))
            sorted_task_ids = [t.id for t in task_objs]
            task_info_by_id = {
                t.id: {
                    "id": t.id,
                    "action": t.action,
                    "reaction": t.reaction or "LIKE",
                    "target_id": t.target_id,
                    "comment_id": t.comment_id,
                    "status": t.status,
                }
                for t in task_objs
            }

            target_ids = {t.target_id for t in task_objs}
            targets = s.query(SeedingTarget).filter(SeedingTarget.id.in_(target_ids)).all()
            targets_by_id = {
                tg.id: {
                    "id": tg.id,
                    "url": tg.url,
                    "target_type": tg.target_type or "POST",
                }
                for tg in targets
            }

            comment_ids = {t.comment_id for t in task_objs if t.comment_id}
            comments = (
                s.query(SeedingComment).filter(SeedingComment.id.in_(comment_ids)).all()
                if comment_ids
                else []
            )
            comments_by_id = {c.id: c.content for c in comments if c.content}
            any_cmts = (
                s.query(SeedingComment)
                .filter(SeedingComment.campaign_id == campaign_id)
                .all()
            )
            fallback_comments = [c.content for c in any_cmts if c.content]

        broadcast("info", f"[{uid}] 🚀 Khởi động trình duyệt Chrome Profile...")
        driver = create_driver(uid=uid, headless=False, proxy=proxy, scope="seeding")
        bot = FacebookSeedingBot(driver)

        # 1. Kiểm tra phiên đăng nhập Facebook
        if not bot.is_facebook_session_alive(navigate=True):
            broadcast(
                "warning",
                f"[{uid}] Chưa có phiên đăng nhập, đang nạp Cookie / thông tin tài khoản...",
            )
            login_ok = bot.apply_facebook_support_data(
                account_record, HWID, callback=lambda m: broadcast("info", m)
            )
            if not login_ok:
                broadcast(
                    "error",
                    f"[{uid}] ❌ Không thể đăng nhập Facebook. Đánh dấu thất bại các tác vụ của nick này.",
                )
                failed_any = False
                with _scoped_db() as s:
                    for tid in task_ids:
                        t = s.query(SeedingTask).filter(SeedingTask.id == tid).first()
                        if t and t.status == "PENDING":
                            t.status = "FAILED"
                            t.error_message = "Không thể đăng nhập Facebook"
                            t.finished_at = vn_now()
                            failed_any = True
                    if failed_any:
                        _count_account_result(s, campaign_id, success=False)
                        account_counted = True
                return
        else:
            broadcast("success", f"[{uid}] ✓ Phiên đăng nhập Facebook sẵn sàng.")

        # 2. Thi hành các task của tài khoản này
        account_has_failure = False
        for idx, tid in enumerate(sorted_task_ids):
            if _active_seeding_campaigns.get(campaign_id, {}).get("stop_requested"):
                broadcast(
                    "warning",
                    f"[{uid}] Dừng tác vụ do người dùng yêu cầu dừng chiến dịch.",
                    owner=owner,
                )
                account_has_failure = True
                with _scoped_db() as s:
                    for remaining_tid in sorted_task_ids[idx:]:
                        rem_task = (
                            s.query(SeedingTask)
                            .filter(SeedingTask.id == remaining_tid)
                            .first()
                        )
                        if rem_task and rem_task.status in ("PENDING", "RUNNING"):
                            rem_task.status = "FAILED"
                            rem_task.error_message = (
                                "Người dùng yêu cầu dừng chiến dịch (Đã dừng thủ công)"
                            )
                            rem_task.finished_at = vn_now()
                break

            info = task_info_by_id.get(tid)
            if not info:
                continue

            target_info = targets_by_id.get(info["target_id"])
            if not target_info:
                continue

            with _scoped_db() as s:
                ut = s.query(SeedingTask).filter(SeedingTask.id == tid).first()
                if not ut or ut.status != "PENDING":
                    continue
                ut.status = "RUNNING"
                ut.started_at = vn_now()

            success = False
            msg = ""
            comment_text = None

            if info["action"] in ("FOLLOW", "LIKE_PAGE"):
                success, msg = bot.execute_follow(
                    target_info["url"],
                    target_type=target_info["target_type"] or "PAGE",
                    account_name=acc_label,
                    callback=lambda m: broadcast("info", f"[{uid}] {m}"),
                )
            elif info["action"] == "REACT":
                success, msg = bot.execute_react(
                    target_info["url"],
                    reaction_type=info["reaction"] or "LIKE",
                    callback=lambda m: broadcast("info", f"[{uid}] {m}"),
                )
            elif info["action"] == "COMMENT":
                comment_text = "Tuyệt vời!"
                if info["comment_id"] and info["comment_id"] in comments_by_id:
                    comment_text = comments_by_id[info["comment_id"]]
                elif fallback_comments:
                    comment_text = random.choice(fallback_comments)

                success, msg = bot.execute_comment(
                    target_info["url"],
                    content=comment_text,
                    callback=lambda m: broadcast("info", f"[{uid}] {m}"),
                )
            elif info["action"] == "SHARE":
                success, msg = bot.execute_share(
                    target_info["url"], callback=lambda m: broadcast("info", f"[{uid}] {m}")
                )

            # Bấm xong chưa chắc Facebook đã ghi nhận: có lúc Facebook hiện cảnh báo rồi hoàn tác thao tác.
            # Đợi một lúc rồi kiểm tra lại; bị cảnh báo / hoàn tác thì ghi thất bại thay vì thành công.
            # Bỏ qua khi thao tác đã có từ trước (bot không bấm gì).
            if success and "từ trước" not in (msg or ""):
                kept, why = bot.verify_action_kept(
                    info["action"],
                    target_type=target_info["target_type"] or "POST",
                    comment_text=comment_text,
                    callback=lambda m: broadcast("info", f"[{uid}] {m}"),
                )
                if not kept:
                    success, msg = False, why

            with _scoped_db() as s:
                ut = s.query(SeedingTask).filter(SeedingTask.id == tid).first()
                if ut:
                    ut.finished_at = vn_now()
                    ut.error_message = msg
                    if success:
                        ut.status = "SUCCESS"
                        broadcast("success", f"[{uid}] ✓ {msg}")
                    else:
                        ut.status = "FAILED"
                        account_has_failure = True
                        broadcast("error", f"[{uid}] ❌ {msg}")

            # Còn tác vụ tiếp theo: nghỉ ngẫu nhiên delay_min..delay_max giây theo cấu hình "Thời gian nghỉ giữa
            # 2 lần tương tác", kể cả giữa các thao tác trên cùng 1 bài viết (Like -> Bình luận -> Chia sẻ).
            # Cùng bài viết thì bot vẫn ở nguyên trang đang mở, không mở lại bài (xem PostSeedingFlow._open_post).
            if idx < len(sorted_task_ids) - 1:
                next_id = sorted_task_ids[idx + 1]
                next_info = task_info_by_id.get(next_id)
                same_post = next_info is not None and next_info["target_id"] == info["target_id"]
                delay_s = random.randint(delay_min, delay_max)
                broadcast(
                    "info",
                    f"[{uid}] Nghỉ an toàn {delay_s}s trước "
                    + ("thao tác tiếp theo trên bài viết này..." if same_post else "tác vụ tiếp theo..."),
                )
                time.sleep(delay_s)
            else:
                # Đã hoàn thành toàn bộ tác vụ của nick, nghỉ 1.5s rồi đóng trình duyệt an toàn
                time.sleep(1.5)

        # Cập nhật kết quả số tài khoản thành công / thất bại cho chiến dịch (mỗi nick = 1 lượt)
        with _scoped_db() as s:
            _count_account_result(s, campaign_id, success=not account_has_failure)
            account_counted = True

    except Exception as e:
        logger.error(f"Error in _process_account_tasks for {uid}: {e}")
        is_stopped = _active_seeding_campaigns.get(campaign_id, {}).get(
            "stop_requested", False
        )
        if is_stopped:
            broadcast(
                "warning",
                f"[{uid}] Dừng tác vụ do người dùng yêu cầu dừng chiến dịch.",
                owner=owner,
            )
        else:
            broadcast("error", f"[{uid}] Lỗi luồng: {str(e)[:80]}", owner=owner)

        try:
            err_msg = (
                "Người dùng yêu cầu dừng chiến dịch (Đã dừng thủ công)"
                if is_stopped
                else f"Lỗi luồng: {str(e)[:80]}"
            )
            with _scoped_db() as s:
                for tid in task_ids:
                    rem_t = s.query(SeedingTask).filter(SeedingTask.id == tid).first()
                    if rem_t and rem_t.status in ("PENDING", "RUNNING"):
                        rem_t.status = "FAILED"
                        rem_t.error_message = err_msg
                        rem_t.finished_at = vn_now()
                if not account_counted:
                    _count_account_result(s, campaign_id, success=False)
                    account_counted = True
        except Exception as cleanup_error:
            logger.error(f"Không ghi được kết quả lỗi luồng của {uid}: {cleanup_error}")
    finally:
        if driver:
            try:
                safe_close_driver(driver)
            except Exception:
                pass
            close_driver_for_uid(uid)
        if token:
            try:
                owner_context.reset(token)
            except Exception:
                pass


def _run_single_campaign(campaign_id: int):
    """Hàm chạy nền điều phối đa luồng (ThreadPoolExecutor) cho một chiến dịch seeding."""
    db = SessionLocal()
    tasks_by_uid: dict[str, list[int]] = {}
    delay_min = 30
    delay_max = 60
    has_tasks = False
    camp_owner = None
    try:
        campaign = (
            db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
        )
        if not campaign:
            return

        camp_owner = (
            str(campaign.created_by) if campaign.created_by is not None else None
        )
        if (
            _active_seeding_campaigns.get(campaign_id, {}).get("stop_requested")
            or campaign.status == "STOPPED"
        ):
            _fail_remaining_campaign_tasks(
                db,
                campaign_id,
                reason="Người dùng yêu cầu dừng chiến dịch (Đã dừng thủ công)",
            )
            db.commit()
            return

        campaign.status = "RUNNING"
        campaign.started_at = vn_now()
        db.commit()

        _active_seeding_campaigns[campaign_id] = {
            "stop_requested": False,
            "running": True,
        }
        broadcast(
            "info",
            f"🚀 BẮT ĐẦU CHẠY CHIẾN DỊCH SEEDING #{campaign_id}: {campaign.target_summary}",
            owner=camp_owner,
        )

        # Lấy danh sách tasks PENDING
        tasks = (
            db.query(SeedingTask)
            .filter(
                SeedingTask.campaign_id == campaign_id, SeedingTask.status == "PENDING"
            )
            .order_by(SeedingTask.id.asc())
            .all()
        )

        if not tasks:
            all_tasks_count = (
                db.query(SeedingTask)
                .filter(SeedingTask.campaign_id == campaign_id)
                .count()
            )
            if all_tasks_count == 0:
                # Không có bất kỳ tác vụ nào được tạo -> xóa chiến dịch khỏi DB, không lưu lịch sử!
                broadcast(
                    "info",
                    f"Chiến dịch #{campaign_id} không có tác vụ nào cần chạy.",
                    owner=camp_owner,
                )
                chain = _batch_campaign_chains.get(campaign_id, [])
                if campaign_id in chain:
                    chain.remove(campaign_id)
                _batch_campaign_chains.pop(campaign_id, None)
                db.delete(campaign)
                db.commit()
                return
            else:
                # Đã có tác vụ nhưng tất cả đều thất bại hoặc chiến dịch đã bị yêu cầu dừng
                is_stop = (
                    _active_seeding_campaigns.get(campaign_id, {}).get("stop_requested")
                    or campaign.status == "STOPPED"
                )
                if is_stop:
                    campaign.status = "STOPPED"
                    campaign.finished_at = vn_now()
                    db.commit()
                    broadcast(
                        "warning",
                        f"⏹ Chiến dịch #{campaign_id} ({campaign.target_summary}) đã dừng theo yêu cầu của người dùng.",
                        owner=camp_owner,
                    )
                else:
                    campaign.status = "FAILED"
                    campaign.finished_at = vn_now()
                    db.commit()
                    broadcast(
                        "warning",
                        f"⚠️ Chiến dịch #{campaign_id} ({campaign.target_summary}): Tất cả {campaign.total_planned} tài khoản đều thất bại do đã tương tác với link này từ trước.",
                        owner=camp_owner,
                    )
                return

        # Nhóm tasks theo UID
        for t in tasks:
            tasks_by_uid.setdefault(t.account_uid, []).append(t.id)

        has_tasks = True
        # Dùng `is None` thay vì `or`: nghỉ 0 giây là giá trị hợp lệ, không được biến thành 30
        delay_min = 30 if campaign.delay_seconds_min is None else campaign.delay_seconds_min
        delay_max = 60 if campaign.delay_seconds_max is None else campaign.delay_seconds_max
    finally:
        db.close()

    if not has_tasks or not tasks_by_uid:
        _active_seeding_campaigns.pop(campaign_id, None)
        return

    # Số luồng chạy đồng thời
    max_workers = 2
    broadcast(
        "info",
        f"⚙️ Điều phối tự động với {max_workers} luồng Chrome song song trên {len(tasks_by_uid)} tài khoản.",
        owner=camp_owner,
    )

    try:
        # Khởi chạy đa luồng thật mà không giữ connection của DB ở luồng điều phối
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = []
            for uid, t_ids in tasks_by_uid.items():
                if _active_seeding_campaigns.get(campaign_id, {}).get("stop_requested"):
                    break
                f = executor.submit(
                    _process_account_tasks,
                    campaign_id=campaign_id,
                    uid=uid,
                    task_ids=t_ids,
                    delay_min=delay_min,
                    delay_max=delay_max,
                    owner=camp_owner,
                )
                futures.append(f)

            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as ex:
                    logger.error(f"Worker future exception: {ex}")

        # Chốt trạng thái sau khi tất cả worker hoàn tất
        db_end = SessionLocal()
        try:
            if _active_seeding_campaigns.get(campaign_id, {}).get("stop_requested"):
                _fail_remaining_campaign_tasks(
                    db_end,
                    campaign_id,
                    reason="Người dùng yêu cầu dừng chiến dịch (Đã dừng thủ công)",
                )
                db_end.commit()

            camp_end = (
                db_end.query(SeedingCampaign)
                .filter(SeedingCampaign.id == campaign_id)
                .first()
            )
            if camp_end:
                if _active_seeding_campaigns.get(campaign_id, {}).get("stop_requested"):
                    camp_end.status = "STOPPED"
                elif camp_end.total_success == 0 and camp_end.total_failed > 0:
                    camp_end.status = "FAILED"
                else:
                    camp_end.status = "COMPLETED"
                camp_end.finished_at = vn_now()
                db_end.commit()
                if camp_end.status == "STOPPED":
                    broadcast(
                        "warning",
                        f"⏹ ĐÃ DỪNG CHIẾN DỊCH #{campaign_id} ({camp_end.target_summary}): Thành công {camp_end.total_success}, Thất bại {camp_end.total_failed} (Các tác vụ còn lại đã dừng thủ công).",
                        owner=camp_owner,
                    )
                else:
                    broadcast(
                        "success" if camp_end.status == "COMPLETED" else "warning",
                        f"🎉 KẾT THÚC CHIẾN DỊCH #{campaign_id} ({camp_end.target_summary}): Thành công {camp_end.total_success}, Thất bại {camp_end.total_failed}.",
                        owner=camp_owner,
                    )
        finally:
            db_end.close()

    finally:
        _active_seeding_campaigns.pop(campaign_id, None)


def _campaign_status(campaign_id: int) -> str | None:
    """Đọc trạng thái hiện tại của chiến dịch trong DB."""
    db = SessionLocal()
    try:
        row = (
            db.query(SeedingCampaign.status)
            .filter(SeedingCampaign.id == campaign_id)
            .first()
        )
        return row[0] if row else None
    finally:
        db.close()


def _rest_before_next_post(chain: list[int], next_cid: int) -> bool:
    """Nghỉ delay_seconds_min..max giây (cấu hình của chiến dịch) trước khi sang bài viết tiếp theo trong lô
    (mỗi bài là 1 chiến dịch, các nick mở Chrome lại cho bài sau).
    Kiểm tra yêu cầu dừng trong lúc nghỉ. Trả về False nếu lô bị dừng."""
    db = SessionLocal()
    try:
        camp = db.query(SeedingCampaign).filter(SeedingCampaign.id == next_cid).first()
        if not camp or camp.campaign_type != "POST":
            return True
        lo = 30 if camp.delay_seconds_min is None else camp.delay_seconds_min
        hi = 60 if camp.delay_seconds_max is None else camp.delay_seconds_max
        owner = str(camp.created_by) if camp.created_by is not None else None
    finally:
        db.close()

    lo, hi = sorted((max(0, lo), max(0, hi)))
    delay_s = random.randint(lo, hi)
    broadcast("info", f"⏳ Nghỉ an toàn {delay_s}s trước khi sang bài viết tiếp theo...", owner=owner)
    for sec in range(delay_s):
        if any(_active_seeding_campaigns.get(c, {}).get("stop_requested", False) for c in chain):
            return False
        # Trạng thái STOPPED trong DB (do API dừng ghi) thì đọc thưa hơn để đỡ tốn kết nối DB
        if sec % 5 == 0 and _campaign_status(next_cid) == "STOPPED":
            return False
        time.sleep(1)
    return True


SEEDING_TYPE_LABELS = {"POST": "Bài viết", "PAGE": "Page", "PROFILE": "Trang cá nhân"}


def _find_running_campaign(db: Session, user_id: int | None, campaign_type: str | None = None):
    """Chiến dịch đang chạy (hoặc đang chờ tới lượt) trong các lô mà engine này đang chạy, của user, có thể lọc loại trang.
    Chỉ xét lô đang chạy thật (_running_batches): chiến dịch bị kẹt RUNNING / PENDING từ lần chạy trước (engine đã tắt
    giữa chừng) hoặc mới tạo mà chưa chạy thì không tính."""
    ids = [cid for chain in list(_running_batches.values()) for cid in chain]
    if not ids:
        return None
    q = db.query(SeedingCampaign).filter(
        SeedingCampaign.id.in_(ids), SeedingCampaign.status.in_(["RUNNING", "PENDING"])
    )
    if campaign_type:
        q = q.filter(SeedingCampaign.campaign_type == campaign_type.upper())
    if user_id is not None:
        q = q.filter(SeedingCampaign.created_by == user_id)
    return q.order_by(SeedingCampaign.id.asc()).first()


def _running_conflict_detail(camp: SeedingCampaign) -> str:
    label = SEEDING_TYPE_LABELS.get(camp.campaign_type, camp.campaign_type)
    return f"Đang chạy seeding {label} #{camp.id}. Hãy dừng lô đó trước khi bắt đầu seeding mới."


def _execute_campaign_runner(initial_campaign_id: int):
    """Hàm chạy nền điều phối tuần tự các chiến dịch trong cùng một batch."""
    chain = _batch_campaign_chains.get(initial_campaign_id, [initial_campaign_id])
    # Đánh dấu lô đang chạy: khoá không cho bắt đầu lô seeding khác cùng lúc (xem _find_running_campaign)
    _running_batches[initial_campaign_id] = chain
    try:
        for idx, cid in enumerate(chain):
            if idx > 0 and not _rest_before_next_post(chain, cid):
                break
            # Kiểm tra nếu có yêu cầu dừng toàn batch
            stop_req = any(
                _active_seeding_campaigns.get(c, {}).get("stop_requested", False)
                for c in chain
            )
            if stop_req:
                break
            # Cờ stop_requested mất khi chiến dịch trước chạy xong, nên các chiến dịch kế tiếp
            # phải dựa vào trạng thái STOPPED mà API dừng đã ghi vào DB.
            if idx > 0 and _campaign_status(cid) == "STOPPED":
                break
            _run_single_campaign(cid)

        # Nếu chuỗi bị dừng dở chừng, đảm bảo mọi chiến dịch còn lại trong chuỗi được hoàn tất trạng thái FAILED/STOPPED
        stop_req = any(
            _active_seeding_campaigns.get(c, {}).get("stop_requested", False)
            for c in chain
        )
        if stop_req:
            db_cleanup = SessionLocal()
            try:
                for cid in chain:
                    _fail_remaining_campaign_tasks(
                        db_cleanup,
                        cid,
                        reason="Người dùng yêu cầu dừng chiến dịch (Đã dừng thủ công)",
                    )
                db_cleanup.commit()
            finally:
                db_cleanup.close()

    finally:
        _running_batches.pop(initial_campaign_id, None)


@router.post("/campaigns/{campaign_id}/start")
def start_seeding_campaign(
    campaign_id: int,
    background_tasks: BackgroundTasks,
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Bắt đầu chạy chiến dịch seeding trong background thread pool."""
    campaign = (
        db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
    )
    if not campaign:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")

    # Kiểm tra phân quyền theo created_by: User thường không được start campaign của người khác
    current_user = get_current_user_info(request, authorization)
    if current_user:
        role = (
            current_user.get("role") or current_user.get("_role_claim") or "user"
        ).lower()
        is_admin = role in ("admin", "superadmin", "administrator")
        if (
            not is_admin
            and campaign.created_by is not None
            and campaign.created_by != current_user["id"]
        ):
            raise HTTPException(
                status_code=403, detail="Bạn không có quyền điều khiển chiến dịch này"
            )

    if campaign_id in _active_seeding_campaigns and _active_seeding_campaigns[
        campaign_id
    ].get("running"):
        return {"message": "Chiến dịch đang chạy", "status": "RUNNING"}

    # Đang có lô seeding khác (của user này) chạy thì không cho chạy thêm lô thứ hai
    running = _find_running_campaign(db, campaign.created_by)
    if running and running.id not in _batch_campaign_chains.get(campaign_id, [campaign_id]):
        raise HTTPException(status_code=409, detail=_running_conflict_detail(running))

    background_tasks.add_task(_execute_campaign_runner, campaign_id)
    return {
        "message": "Đã bắt đầu chạy chiến dịch",
        "campaign_id": campaign_id,
        "status": "RUNNING",
    }


@router.post("/campaigns/{campaign_id}/stop")
def stop_seeding_campaign(
    campaign_id: int,
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Dừng khẩn cấp toàn bộ các luồng trình duyệt Chrome đang chạy của chiến dịch và toàn bộ chuỗi kế tiếp."""
    campaign = (
        db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
    )
    if not campaign:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")

    # Kiểm tra phân quyền theo created_by: User thường không được stop campaign của người khác
    current_user = get_current_user_info(request, authorization)
    if current_user:
        role = (
            current_user.get("role") or current_user.get("_role_claim") or "user"
        ).lower()
        is_admin = role in ("admin", "superadmin", "administrator")
        if (
            not is_admin
            and campaign.created_by is not None
            and campaign.created_by != current_user["id"]
        ):
            raise HTTPException(
                status_code=403, detail="Bạn không có quyền dừng chiến dịch này"
            )

    chain = _batch_campaign_chains.get(campaign_id, [campaign_id])
    total_remaining_failed = 0
    for cid in chain:
        _active_seeding_campaigns.setdefault(cid, {})["stop_requested"] = True
        total_remaining_failed += _fail_remaining_campaign_tasks(
            db, cid, reason="Người dùng yêu cầu dừng chiến dịch (Đã dừng thủ công)"
        )
    db.commit()

    # Đóng ngay lập tức các trình duyệt đang thuộc scope seeding
    close_scoped_active_drivers(scope="seeding", force=True)

    camp_owner = str(campaign.created_by) if campaign.created_by is not None else None
    broadcast(
        "warning",
        f"⏹ Đã dừng khẩn cấp chiến dịch #{campaign_id}. Đã đánh dấu thất bại {total_remaining_failed} tác vụ chưa hoàn thành do dừng thủ công.",
        owner=camp_owner,
    )
    return {
        "message": f"Đã dừng chiến dịch. {total_remaining_failed} tác vụ còn lại đã được đánh dấu thất bại.",
        "campaign_id": campaign_id,
        "failed_tasks_count": total_remaining_failed,
    }


@router.post("/stop-all")
def stop_all_seeding(
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Dừng khẩn cấp mọi chiến dịch seeding đang chạy trên engine này (khi giao diện không còn giữ campaign_id)."""
    current_user = get_current_user_info(request, authorization)
    is_user_limited = False
    allowed_user_id = None
    if current_user:
        role = (
            current_user.get("role") or current_user.get("_role_claim") or "user"
        ).lower()
        is_admin = role in ("admin", "superadmin", "administrator")
        if not is_admin:
            is_user_limited = True
            allowed_user_id = current_user["id"]

    campaign_ids = set()
    # 1. Chiến dịch mà engine (máy) này đang chạy hoặc sắp chạy, kèm cả lô của chúng
    running_here = list(_active_seeding_campaigns.keys()) + [
        cid for chain in list(_running_batches.values()) for cid in chain
    ]
    for cid in running_here:
        campaign_ids.update(_batch_campaign_chains.get(cid, [cid]))

    # 2. Chiến dịch bị kẹt RUNNING / PENDING trong DB (vd tắt app giữa chừng) — CHỈ của chính người đang bấm.
    #    DB dùng chung cả team: không đụng chiến dịch người khác đang chạy trên máy khác (kể cả khi là admin).
    if current_user and current_user.get("id") is not None:
        stuck_in_db = (
            db.query(SeedingCampaign.id)
            .filter(
                SeedingCampaign.status.in_(["PENDING", "RUNNING"]),
                SeedingCampaign.created_by == current_user["id"],
            )
            .all()
        )
        for (aid,) in stuck_in_db:
            campaign_ids.add(aid)
            campaign_ids.update(_batch_campaign_chains.get(aid, [aid]))

    stopped_ids = []
    total_remaining_failed = 0
    for cid in campaign_ids:
        c = db.query(SeedingCampaign).filter(SeedingCampaign.id == cid).first()
        if c:
            # User thường chỉ dừng được chiến dịch của chính mình
            if is_user_limited and c.created_by != allowed_user_id:
                continue
            _active_seeding_campaigns.setdefault(cid, {})["stop_requested"] = True
            total_remaining_failed += _fail_remaining_campaign_tasks(
                db, cid, reason="Người dùng yêu cầu dừng chiến dịch (Đã dừng thủ công)"
            )
            stopped_ids.append(cid)

    db.commit()

    # Đóng các trình duyệt thuộc scope seeding nếu có chiến dịch bị dừng
    if stopped_ids:
        close_scoped_active_drivers(scope="seeding", force=True)

    camp_owner = str(allowed_user_id) if allowed_user_id is not None else None
    broadcast(
        "warning",
        f"⏹ Đã dừng khẩn cấp {len(stopped_ids)} chiến dịch seeding. Đã đánh dấu thất bại {total_remaining_failed} tác vụ chưa hoàn thành do dừng thủ công.",
        owner=camp_owner,
    )
    return {
        "message": f"Đã dừng {len(stopped_ids)} chiến dịch seeding. {total_remaining_failed} tác vụ còn lại đã được đánh dấu thất bại.",
        "campaign_ids": sorted(stopped_ids),
        "failed_tasks_count": total_remaining_failed,
    }


# ─────────────────────────────────────────────────────────────
# 4. DANH SÁCH LỊCH SỬ SEEDING (CHO TRANG LỊCH SỬ)
# ─────────────────────────────────────────────────────────────
@router.get("/campaigns/active")
def get_active_seeding_campaign(
    campaign_type: str | None = Query(None, description="PAGE | PROFILE | POST, bỏ trống = mọi loại"),
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """
    Lô seeding đang chạy (hoặc đang chờ tới lượt) của user hiện tại trên engine này.
    Giao diện các trang Seeding gọi định kỳ (không truyền loại trang):
    - Lô của chính trang đó: giữ nút "Dừng seeding" khi chuyển trang rồi quay lại.
    - Lô của trang khác: khoá nút "Bắt đầu seeding", nút Dừng dừng lô đó (mỗi lúc chỉ chạy 1 lô).
    """
    current_user = get_current_user_info(request, authorization)
    user_id = current_user.get("id") if current_user else None
    camp = _find_running_campaign(db, user_id, campaign_type)
    if not camp:
        return {"campaign_id": None, "campaign_type": None, "name": None}
    return {"campaign_id": camp.id, "campaign_type": camp.campaign_type, "name": camp.target_summary}


@router.get("/campaigns")
def list_seeding_campaigns(
    campaign_type: str | None = Query(None, description="PAGE | PROFILE | POST | ALL"),
    status: str | None = Query(None, description="COMPLETED | RUNNING | FAILED | ALL"),
    search: str | None = Query(
        None, description="Tìm kiếm theo tên chiến dịch hoặc mục tiêu"
    ),
    from_date: str | None = Query(None),
    to_date: str | None = Query(None),
    user_id: int | None = Query(
        None, description="Lọc theo created_by (dành cho Admin)"
    ),
    all_records: bool = Query(
        False, description="Lấy toàn bộ bản ghi theo bộ lọc không giới hạn phân trang (dành cho xuất Excel)"
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100000),
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Lấy danh sách lịch sử chiến dịch seeding thật trong DB kèm bộ lọc phân quyền người dùng (created_by) & phân trang."""
    q = db.query(SeedingCampaign)

    # ─── PHÂN QUYỀN HIỂN THỊ THEO CREATED_BY ───
    # Seeding của user nào thì CHỈ hiển thị cho mỗi user đó. Admin được xem tất cả.
    current_user = get_current_user_info(request, authorization)
    if current_user:
        role = (
            current_user.get("role") or current_user.get("_role_claim") or "user"
        ).lower()
        is_admin = role in ("admin", "superadmin", "administrator")
        if not is_admin:
            # User thường: BẮT BUỘC chỉ xem chiến dịch do chính user này tạo
            q = q.filter(SeedingCampaign.created_by == current_user["id"])
        else:
            # Admin: xem tất cả hoặc lọc theo user_id nếu được truyền
            if user_id is not None:
                q = q.filter(SeedingCampaign.created_by == user_id)
    else:
        # Nếu chưa đăng nhập / chế độ local test:
        if user_id is not None:
            q = q.filter(SeedingCampaign.created_by == user_id)

    if campaign_type and campaign_type.upper().strip() not in ("ALL", "TẤT CẢ", "TAT_CA", ""):
        q = q.filter(SeedingCampaign.campaign_type == campaign_type.upper().strip())

    if status and status.upper().strip() not in ("ALL", "TẤT CẢ", "TAT_CA", ""):
        clean_status = status.upper().strip()
        if clean_status in ("HOÀN THÀNH", "COMPLETED", "SUCCESS"):
            q = q.filter(SeedingCampaign.status == "COMPLETED")
        elif clean_status in ("ĐANG CHẠY", "RUNNING"):
            q = q.filter(SeedingCampaign.status == "RUNNING")
        elif clean_status in ("KHÔNG HOÀN THÀNH", "FAILED", "STOPPED", "THẤT BẠI"):
            q = q.filter(SeedingCampaign.status.in_(["FAILED", "STOPPED"]))

    if search and search.strip():
        raw_search = search.strip()
        term = f"%{raw_search}%"
        clean_num = raw_search.lstrip("#")
        id_filters = []
        if clean_num.isdigit():
            id_filters.append(SeedingCampaign.id == int(clean_num))

        target_campaign_ids = (
            db.query(SeedingCampaignTarget.campaign_id)
            .outerjoin(SeedingTarget, SeedingCampaignTarget.target_id == SeedingTarget.id)
            .filter(
                or_(
                    SeedingTarget.display_name.ilike(term),
                    SeedingTarget.url.ilike(term),
                    SeedingTarget.fb_id.ilike(term),
                    SeedingCampaignTarget.display_name.ilike(term),
                    SeedingCampaignTarget.target_url.ilike(term),
                    SeedingCampaignTarget.note.ilike(term),
                )
            )
        )
        q = q.filter(
            or_(
                SeedingCampaign.id.in_(target_campaign_ids),
                *id_filters,
            )
        )

    # from_date / to_date là ngày theo giờ Việt Nam ('YYYY-MM-DD'), lấy trọn ngày to_date
    if from_date and from_date.strip():
        try:
            q = q.filter(SeedingCampaign.created_at >= vn_date_bound(from_date.strip()))
        except Exception:
            pass

    if to_date and to_date.strip():
        try:
            q = q.filter(SeedingCampaign.created_at < vn_date_bound(to_date.strip(), end_of_day=True))
        except Exception:
            pass

    total = q.count()
    ordered_q = q.order_by(SeedingCampaign.created_at.desc(), SeedingCampaign.id.desc())
    if all_records:
        items = ordered_q.all()
    else:
        items = ordered_q.offset((page - 1) * page_size).limit(page_size).all()

    results = []
    for c in items:
        results.append(
            {
                "id": c.id,
                "created_by": c.created_by,
                "created_at": to_vn_iso(c.created_at),
                "created_at_display": to_vn_display(c.created_at),
                "name": c.target_summary,
                "campaign_type": c.campaign_type,
                "campaign_type_display": "Page"
                if c.campaign_type == "PAGE"
                else ("Trang cá nhân" if c.campaign_type == "PROFILE" else "Bài viết"),
                "target_summary": c.target_summary or "-",
                "actions": [
                    a.strip() for a in (c.actions or "").split(",") if a.strip()
                ],
                "reactions": [
                    r.strip() for r in (c.reactions or "").split(",") if r.strip()
                ],
                "account_count": c.account_count,
                "total_planned": c.total_planned,
                "total_success": c.total_success,
                "total_failed": c.total_failed,
                "status": c.status,
                "status_display": "Hoàn thành"
                if c.status == "COMPLETED"
                else (
                    "Đang chạy"
                    if c.status == "RUNNING"
                    else (
                        "Không hoàn thành"
                        if c.status in ("FAILED", "STOPPED")
                        else "Chờ chạy"
                    )
                ),
            }
        )

    return {"total": total, "page": page, "page_size": page_size if not all_records else total, "items": results}


# ─────────────────────────────────────────────────────────────
# 5. CHI TIẾT CHIẾN DỊCH & LINK MỤC TIÊU THẬT (CHO NÚT "Chi tiết")
# ─────────────────────────────────────────────────────────────
@router.get("/campaigns/{campaign_id}/detail")
def get_seeding_campaign_detail(
    campaign_id: int,
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """
    Trả về chi tiết chiến dịch, LINK MỤC TIÊU VÀ DANH SÁCH CHI TIẾT CÁC TÀI KHOẢN KÈM LỖI/GHI CHÚ.
    Dùng để hiển thị Modal khi bấm nút 'Chi tiết' ở màn hình Lịch sử.
    """
    campaign = (
        db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
    )
    if not campaign:
        chain = _batch_campaign_chains.get(campaign_id, [])
        is_batch_active = False
        if chain:
            active_camps = (
                db.query(SeedingCampaign)
                .filter(
                    SeedingCampaign.id.in_(chain),
                    SeedingCampaign.status.in_(["RUNNING", "PENDING"]),
                )
                .count()
            )
            is_batch_active = active_camps > 0
        if is_batch_active:
            return {
                "id": campaign_id,
                "status": "RUNNING",
                "status_display": "Đang chạy",
                "is_batch_active": True,
            }
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")

    # Kiểm tra quyền truy cập theo created_by: User thường không được xem chi tiết của user khác
    current_user = get_current_user_info(request, authorization)
    if current_user:
        role = (
            current_user.get("role") or current_user.get("_role_claim") or "user"
        ).lower()
        is_admin = role in ("admin", "superadmin", "administrator")
        if (
            not is_admin
            and campaign.created_by is not None
            and campaign.created_by != current_user["id"]
        ):
            raise HTTPException(
                status_code=403, detail="Bạn không có quyền truy cập chiến dịch này"
            )

    # 1. Lấy thông tin các mục tiêu (Targets) của chiến dịch này
    targets_data = []
    for ct in campaign.campaign_targets:
        t = ct.target
        target_id = t.id if t else ct.target_id
        target_type = (t.target_type if t else None) or campaign.campaign_type
        fb_id = t.fb_id if t else None
        url = (t.url if t else None) or ct.target_url
        display_name = (t.display_name if t else None) or ct.display_name

        # Nếu chưa có url hoặc display_name, fallback từ các task thuộc ct
        if not url or not display_name:
            first_task = next(
                (tk for tk in ct.tasks if tk.display_name or tk.target_url), None
            )
            if first_task:
                display_name = display_name or first_task.display_name
                url = url or first_task.target_url

        targets_data.append(
            {
                "target_id": target_id,
                "target_type": target_type,
                "fb_id": fb_id,
                "url": url,
                "display_name": display_name
                or (
                    f"Page {fb_id}"
                    if target_type == "PAGE"
                    else (
                        f"Trang cá nhân {fb_id}"
                        if target_type == "PROFILE"
                        else f"Bài viết {fb_id}"
                    )
                )
                if fb_id
                else (display_name or "Mục tiêu"),
                "note": ct.note,
                "source": ct.source,
                "planned_count": ct.planned_count,
                "success_count": ct.success_count,
                "failed_count": ct.failed_count,
            }
        )

    # 2. Lấy danh sách nhiệm vụ chi tiết theo từng tài khoản (Tasks)
    tasks_data = []
    # Thống kê chi tiết từng loại tương tác thực tế từ tasks (Like, Love, Haha, Comment, Share...)
    interactions_breakdown = {}

    # Tải danh sách tên tài khoản theo UID để hiển thị
    task_uids = list(set(tk.account_uid for tk in campaign.tasks if tk.account_uid))
    acc_map = {}
    if task_uids:
        try:
            acc_records = db.query(Account).filter(Account.uid.in_(task_uids)).all()
            for a in acc_records:
                acc_map[a.uid] = a.profile_name or a.uid
        except Exception:
            pass

    for tk in campaign.tasks:
        acc_name = acc_map.get(tk.account_uid, "Tài khoản")

        st_disp = "Chờ chạy"
        if tk.status == "SUCCESS":
            st_disp = "Thành công"
        elif tk.status == "FAILED":
            st_disp = "Thất bại"
        elif tk.status == "RUNNING":
            st_disp = "Đang chạy"

        # Hiển thị hành động trực quan (VD: Thả cảm xúc LOVE, Bình luận...)
        action_disp = tk.action
        if tk.action == "REACT":
            react_label = tk.reaction or "LIKE"
            action_disp = f"Cảm xúc {react_label}"
            if tk.status == "SUCCESS":
                interactions_breakdown[react_label] = (
                    interactions_breakdown.get(react_label, 0) + 1
                )
        elif tk.action == "FOLLOW":
            action_disp = "Theo dõi"
            if tk.status == "SUCCESS":
                interactions_breakdown["FOLLOW"] = (
                    interactions_breakdown.get("FOLLOW", 0) + 1
                )
        elif tk.action == "COMMENT":
            action_disp = "Bình luận"
            if tk.status == "SUCCESS":
                interactions_breakdown["COMMENT"] = (
                    interactions_breakdown.get("COMMENT", 0) + 1
                )
        elif tk.action == "SHARE":
            action_disp = "Chia sẻ"
            if tk.status == "SUCCESS":
                interactions_breakdown["SHARE"] = (
                    interactions_breakdown.get("SHARE", 0) + 1
                )

        tasks_data.append(
            {
                "id": tk.id,
                "task_id": tk.id,
                "account_uid": tk.account_uid,
                "account_name": acc_name,
                "target_id": tk.target_id,
                "display_name": tk.display_name
                or (tk.target.display_name if tk.target else None),
                "target_url": tk.target_url or (tk.target.url if tk.target else None),
                "action": tk.action,
                "action_display": action_disp,
                "reaction": tk.reaction,
                "comment_content": tk.comment.content if tk.comment else None,
                "status": tk.status,
                "status_display": st_disp,
                "error_message": tk.error_message,
                "started_at": to_vn_iso(tk.started_at),
                "finished_at": to_vn_iso(tk.finished_at),
            }
        )

    actions_list = [a.strip() for a in (campaign.actions or "").split(",") if a.strip()]
    reactions_list = [
        r.strip() for r in (campaign.reactions or "").split(",") if r.strip()
    ]
    comments_list = [c.content for c in campaign.comments]

    # Kiểm tra xem toàn bộ batch chiến dịch này có đang hoạt động hay không
    is_batch_active = False
    chain = _batch_campaign_chains.get(campaign.id, [campaign.id])
    if chain:
        active_camps = (
            db.query(SeedingCampaign)
            .filter(
                SeedingCampaign.id.in_(chain),
                SeedingCampaign.status.in_(["RUNNING", "PENDING"]),
            )
            .count()
        )
        is_batch_active = (active_camps > 0) or any(
            _active_seeding_campaigns.get(cid, {}).get("running", False)
            for cid in chain
        )

    # Trạng thái tổng thể trả về: Nếu lô vẫn còn đang chạy mục tiêu khác thì báo RUNNING
    # để nút Bắt đầu luôn bị disable và nút Dừng luôn bấm được trên giao diện
    effective_status = "RUNNING" if is_batch_active else campaign.status
    effective_status_display = (
        "Đang chạy"
        if is_batch_active
        else (
            "Hoàn thành"
            if campaign.status == "COMPLETED"
            else (
                "Đang chạy"
                if campaign.status == "RUNNING"
                else (
                    "Không hoàn thành"
                    if campaign.status in ("FAILED", "STOPPED")
                    else "Chờ chạy"
                )
            )
        )
    )

    first_task = campaign.tasks[0] if campaign.tasks else None
    primary_target_url = (
        (targets_data[0]["url"] if targets_data else None)
        or (first_task.target_url if first_task else None)
        or ""
    )
    primary_target_name = (
        (targets_data[0]["display_name"] if targets_data else None)
        or (first_task.display_name if first_task else None)
        or campaign.target_summary
    )

    return {
        "id": campaign.id,
        "created_by": campaign.created_by,
        "name": primary_target_name or campaign.target_summary,
        "campaign_type": campaign.campaign_type,
        "campaign_type_display": "Page"
        if campaign.campaign_type == "PAGE"
        else ("Trang cá nhân" if campaign.campaign_type == "PROFILE" else "Bài viết"),
        "actions": actions_list,
        "reactions": reactions_list,
        "comments": comments_list,
        "interactions_breakdown": interactions_breakdown,
        "status": effective_status,
        "status_display": effective_status_display,
        "is_batch_active": is_batch_active,
        "created_at_display": to_vn_display(campaign.created_at),
        "total_planned": campaign.total_planned,
        "total_success": campaign.total_success,
        "total_failed": campaign.total_failed,
        "account_count": campaign.account_count,
        "primary_target_url": primary_target_url,
        "primary_target_name": primary_target_name,
        "targets": targets_data,
        "tasks": tasks_data,
    }


# ─────────────────────────────────────────────────────────────
# 6. THỐNG KÊ TỔNG QUAN (4 CARD Ở MÀN HÌNH LỊCH SỬ)
# ─────────────────────────────────────────────────────────────
@router.get("/stats")
def get_seeding_stats(
    user_id: int | None = Query(None, description="Lọc theo user id (Admin)"),
    request: Request = None,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Trả về số liệu thống kê thật từ database có phân quyền theo created_by của người dùng."""
    current_user = get_current_user_info(request, authorization)
    q = db.query(SeedingCampaign)
    sums_q = db.query(
        func.coalesce(func.sum(SeedingCampaign.total_planned), 0),
        func.coalesce(func.sum(SeedingCampaign.total_success), 0),
        func.coalesce(func.sum(SeedingCampaign.total_failed), 0),
    )

    if current_user:
        role = (
            current_user.get("role") or current_user.get("_role_claim") or "user"
        ).lower()
        is_admin = role in ("admin", "superadmin", "administrator")
        if not is_admin:
            # User thường: chỉ tính thống kê của các chiến dịch do chính user tạo
            q = q.filter(SeedingCampaign.created_by == current_user["id"])
            sums_q = sums_q.filter(SeedingCampaign.created_by == current_user["id"])
        elif user_id is not None:
            # Admin lọc theo user_id nếu được truyền
            q = q.filter(SeedingCampaign.created_by == user_id)
            sums_q = sums_q.filter(SeedingCampaign.created_by == user_id)
    elif user_id is not None:
        q = q.filter(SeedingCampaign.created_by == user_id)
        sums_q = sums_q.filter(SeedingCampaign.created_by == user_id)

    total_campaigns = q.count()
    sums = sums_q.first()

    total_interactions = int(sums[0]) if sums else 0
    total_success = int(sums[1]) if sums else 0
    total_failed = int(sums[2]) if sums else 0

    return {
        "total_campaigns": total_campaigns,
        "total_interactions": total_interactions,
        "total_success": total_success,
        "total_failed": total_failed,
    }
