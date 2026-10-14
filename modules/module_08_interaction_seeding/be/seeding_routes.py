"""
seeding_routes.py
API endpoints cho Module 8: Interaction Seeding (Seeding Page, Seeding Profile, Seeding Post, History).
Tuân thủ chuẩn DBML Module 8 (fb_automator_seeding).
Quản lý chiến dịch, sinh hàng đợi tác vụ và điều phối worker chạy nền đa luồng tự động hóa bằng Selenium thật.
"""
import os
import time
import random
import logging
import json
import re
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, or_

from modules.module_02_account_manager.database.connection import get_db, SessionLocal
from modules.module_02_account_manager.database.models import Account
from modules.module_02_account_manager.database.repository import utc_now
from modules.module_08_interaction_seeding.be.seeding_models import (
    SeedingTarget, SeedingCampaign, SeedingCampaignTarget, SeedingComment, SeedingTask
)
from modules.module_02_account_manager.services.events import broadcast
from modules.module_02_account_manager.automation.browser_manager import (
    create_driver, safe_close_driver, close_driver_for_uid, close_scoped_active_drivers
)
from modules.module_08_interaction_seeding.be.seeding_flow import FacebookSeedingBot
from modules.module_02_account_manager.services.browser_service import HWID

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/seeding", tags=["Seeding"])
seeding_router = router

# Global state cho việc quản lý dừng chiến dịch seeding đang chạy
_active_seeding_campaigns = {}  # campaign_id -> {"stop_requested": bool, "running": bool}
_batch_campaign_chains: Dict[int, List[int]] = {}  # campaign_id -> [camp1_id, camp2_id, ...]


# ─────────────────────────────────────────────────────────────
# HELPER FUNCTIONS (TRÍCH XUẤT FB_ID & QUẢN LÝ COMMENT NHÁP)
# ─────────────────────────────────────────────────────────────
def extract_fb_id(url: str, target_type: str = "") -> str:
    """Trích xuất UID / Page ID / Post ID sau khi xác thực link (chuẩn DBML: fb_id varchar(100) not null)."""
    if not url:
        return "unknown"
    clean = url.strip()

    # 1. Post ID từ permalink: story_fbid=(\d+) hoặc fbid=(\d+)
    m = re.search(r'[?&](?:story_fbid|fbid)=(\d+)', clean)
    if m:
        return m.group(1)

    # 2. Profile / UID từ query param: ?id=1000...
    m = re.search(r'[?&]id=(\d+)', clean)
    if m:
        return m.group(1)

    # 3. Post ID từ /posts/(\d+) hoặc /posts/(\w+)
    m = re.search(r'/posts/([a-zA-Z0-9_\-]+)', clean)
    if m:
        return m.group(1)

    # 4. Reel / Video: /reel/(\d+) hoặc /videos/(\d+) hoặc /watch/?v=(\d+)
    m = re.search(r'/(?:reel|videos)/([a-zA-Z0-9_\-]+)', clean)
    if m:
        return m.group(1)
    m = re.search(r'[?&]v=(\d+)', clean)
    if m:
        return m.group(1)

    # 5. Page format: /p/Ten-Page-(\d+)
    m = re.search(r'/p/[^/]+-(\d+)', clean)
    if m:
        return m.group(1)

    # 6. Username / slug sau domain: facebook.com/username
    m = re.search(r'facebook\.com/(?:people/[^/]+/(\d+)|profile\.php\?id=(\d+)|([a-zA-Z0-9._\-]+))', clean)
    if m:
        val = m.group(1) or m.group(2) or m.group(3)
        if val and val.lower() not in ("groups", "pages", "watch", "photo", "events", "share", "profile.php"):
            return val

    # Fallback: Trích xuất slug cuối URL hoặc md5 hash
    clean_no_query = clean.split("?")[0].rstrip("/")
    slug = clean_no_query.split("/")[-1]
    if slug and len(slug) <= 100:
        return slug
    return hashlib.md5(clean.encode("utf-8")).hexdigest()[:32]


VN_TZ = timezone(timedelta(hours=7))


def to_vn_iso(dt: Optional[datetime]) -> Optional[str]:
    """Đổi datetime UTC (naive) trong DB sang chuỗi ISO giờ Việt Nam (UTC+7)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(VN_TZ).isoformat()


_draft_seeding_comments: List[str] = []


def get_draft_comments(db: Session) -> List[str]:
    """Lấy danh sách các câu bình luận từ cơ sở dữ liệu seeding_comments hoặc bộ đệm hiện tại."""
    global _draft_seeding_comments
    if _draft_seeding_comments:
        return list(_draft_seeding_comments)
    try:
        cmts = (
            db.query(SeedingComment.content)
            .distinct()
            .order_by(desc(SeedingComment.id))
            .limit(50)
            .all()
        )
        if cmts:
            _draft_seeding_comments = [c[0] for c in cmts if c[0]]
            return list(_draft_seeding_comments)
    except Exception as e:
        logger.warning(f"Lỗi lấy seeding_comments từ DB: {e}")
    return []


def save_draft_comments(db: Session, comments: List[str]):
    """Cập nhật danh sách câu bình luận vào bộ nhớ đệm."""
    global _draft_seeding_comments
    _draft_seeding_comments = list(comments)


# ─────────────────────────────────────────────────────────────
# SCHEMAS
# ─────────────────────────────────────────────────────────────
class TargetInputItem(BaseModel):
    url: str
    fb_id: Optional[str] = None
    display_name: Optional[str] = None
    content_preview: Optional[str] = None
    note: Optional[str] = None
    source: Optional[str] = "MANUAL"


class ValidateTargetsRequest(BaseModel):
    target_type: str  # 'PAGE', 'PROFILE', 'POST'
    urls: List[str]


class CreateCampaignRequest(BaseModel):
    name: Optional[str] = None
    campaign_type: str  # 'PAGE', 'PROFILE', 'POST'
    actions: List[str]  # ['FOLLOW'] hoặc ['REACT', 'COMMENT', 'SHARE']
    reactions: Optional[List[str]] = None  # ['LIKE', 'LOVE', 'CARE', 'HAHA', 'WOW', 'SAD', 'ANGRY']
    comments: Optional[List[str]] = None
    targets: List[TargetInputItem]
    account_count: int = 50
    threads: int = 1
    uids: Optional[List[str]] = None
    delay_seconds_min: int = 30
    delay_seconds_max: int = 60
    owner_username: Optional[str] = None
    created_by: Optional[int] = None


class AddCommentsRequest(BaseModel):
    comments: List[str]


# ─────────────────────────────────────────────────────────────
# 1. QUẢN LÝ MỤC TIÊU SEEDING (LƯU TRỰC TIẾP VÀO DATABASE)
# ─────────────────────────────────────────────────────────────
@router.get("/targets")
async def list_seeding_targets(target_type: Optional[str] = None, db: Session = Depends(get_db)):
    """Lấy danh sách các mục tiêu seeding đã lưu trong bảng seeding_targets."""
    query = db.query(SeedingTarget)
    if target_type:
        query = query.filter(SeedingTarget.target_type == target_type.upper())
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
                "created_at": to_vn_iso(t.created_at),
            }
            for idx, t in enumerate(targets)
        ]
    }


@router.post("/targets/validate")
async def validate_targets(req: ValidateTargetsRequest, db: Session = Depends(get_db)):
    """Lọc trùng, kiểm tra định dạng và LƯU TRỰC TIẾP vào bảng seeding_targets chuẩn DBML."""
    valid_targets = []
    seen_urls = set()
    camp_type = req.target_type.upper()

    for idx, raw_url in enumerate(req.urls):
        url = (raw_url or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)

        fb_id = extract_fb_id(url, camp_type)

        # Trích xuất display_name chuẩn: Page / Trang cá nhân / Bài viết + fb_id
        if camp_type == "PAGE":
            display_name = f"Page {fb_id}"
        elif camp_type == "PROFILE":
            display_name = f"Trang cá nhân {fb_id}"
        elif camp_type == "POST":
            display_name = f"Bài viết {fb_id}"
        else:
            display_name = f"{fb_id}"

        # Kiểm tra đối tượng theo unique_seeding_target(target_type, fb_id) hoặc url
        target_obj = db.query(SeedingTarget).filter(
            SeedingTarget.target_type == camp_type,
            or_(SeedingTarget.fb_id == fb_id, SeedingTarget.url == url)
        ).first()

        if not target_obj:
            target_obj = SeedingTarget(
                target_type=camp_type,
                fb_id=fb_id,
                url=url,
                display_name=display_name,
            )
            db.add(target_obj)
            db.flush()
        else:
            # Luôn cập nhật lại display_name theo chuẩn Page / Trang cá nhân / Bài viết + fb_id
            target_obj.display_name = display_name
            if not target_obj.fb_id:
                target_obj.fb_id = fb_id

        valid_targets.append({
            "id": target_obj.id,
            "stt": len(valid_targets) + 1,
            "url": target_obj.url,
            "fb_id": target_obj.fb_id,
            "display_name": target_obj.display_name or display_name,
        })

    db.commit()

    # Lấy toàn bộ danh sách hiện có của loại mục tiêu này trong DB để đồng bộ giao diện
    all_current = db.query(SeedingTarget).filter(
        SeedingTarget.target_type == camp_type
    ).order_by(SeedingTarget.id.asc()).all()

    return {
        "total": len(all_current),
        "targets": [
            {
                "id": t.id,
                "stt": idx + 1,
                "url": t.url,
                "fb_id": t.fb_id,
                "display_name": t.display_name,
            }
            for idx, t in enumerate(all_current)
        ]
    }


@router.delete("/targets/by-url")
async def delete_target_by_url(
    url: str = Query(...),
    target_type: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Xóa mục tiêu theo URL khỏi database."""
    query = db.query(SeedingTarget).filter(SeedingTarget.url == url)
    if target_type:
        query = query.filter(SeedingTarget.target_type == target_type.upper())
    targets = query.all()
    for t in targets:
        db.query(SeedingTask).filter(SeedingTask.target_id == t.id).delete(synchronize_session=False)
        db.query(SeedingCampaignTarget).filter(SeedingCampaignTarget.target_id == t.id).delete(synchronize_session=False)
        db.delete(t)
    db.commit()
    return {"success": True}


@router.delete("/targets/clear")
async def clear_seeding_targets(
    target_type: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Xóa toàn bộ mục tiêu của target_type khỏi database."""
    query = db.query(SeedingTarget)
    if target_type:
        query = query.filter(SeedingTarget.target_type == target_type.upper())
    targets = query.all()
    target_ids = [t.id for t in targets]
    if target_ids:
        db.query(SeedingTask).filter(SeedingTask.target_id.in_(target_ids)).delete(synchronize_session=False)
        db.query(SeedingCampaignTarget).filter(SeedingCampaignTarget.target_id.in_(target_ids)).delete(synchronize_session=False)
        for t in targets:
            db.delete(t)
    db.commit()
    return {"success": True, "deleted": len(targets)}


# ─────────────────────────────────────────────────────────────
# 1.1 QUẢN LÝ BÌNH LUẬN NHÁP (KHO BÌNH LUẬN)
# ─────────────────────────────────────────────────────────────
@router.get("/comments")
async def list_seeding_comments(db: Session = Depends(get_db)):
    """Lấy danh sách các câu bình luận đã lưu."""
    drafts = get_draft_comments(db)
    return {
        "total": len(drafts),
        "comments": drafts
    }


@router.post("/comments/add")
async def add_seeding_comments(req: AddCommentsRequest, db: Session = Depends(get_db)):
    """Lưu danh sách bình luận nháp vào local_settings."""
    current = get_draft_comments(db)
    added = []
    for raw in req.comments:
        c = (raw or "").strip()
        if c and c not in current:
            current.append(c)
            added.append(c)
    save_draft_comments(db, current)
    return {
        "success": True,
        "added_count": len(added),
        "total": len(current),
        "comments": current
    }


@router.delete("/comments/delete")
async def delete_seeding_comment(
    content: str = Query(...),
    db: Session = Depends(get_db)
):
    """Xóa 1 câu bình luận nháp khỏi kho."""
    current = get_draft_comments(db)
    current = [c for c in current if c != content]
    save_draft_comments(db, current)
    return {"success": True}


@router.delete("/comments/clear")
async def clear_seeding_comments(db: Session = Depends(get_db)):
    """Xóa tất cả câu bình luận nháp."""
    save_draft_comments(db, [])
    return {"success": True, "deleted": True}


# ─────────────────────────────────────────────────────────────
# 2. TẠO CHIẾN DỊCH SEEDING & SINH TÁC VỤ THẬT
# ─────────────────────────────────────────────────────────────
@router.post("/campaigns/create")
async def create_seeding_campaign(req: CreateCampaignRequest, db: Session = Depends(get_db)):
    """Tạo mới chiến dịch Seeding chuẩn DBML Module 8, liên kết tài khoản thật trong DB và tạo hàng đợi task."""
    if not req.targets:
        raise HTTPException(status_code=400, detail="Danh sách mục tiêu không được rỗng")

    # 1. Lấy danh sách UID tài khoản Facebook thật từ DB (bắt buộc Live và Đã đăng nhập)
    available_accounts = []
    if req.uids and len(req.uids) > 0:
        available_accounts = db.query(Account).filter(
            Account.uid.in_(req.uids),
            Account.status == "LIVE",
            Account.login_status == "LOGGED_IN"
        ).all()
        if not available_accounts:
            available_accounts = db.query(Account).filter(Account.uid.in_(req.uids)).all()
    else:
        # Lọc nghiêm ngặt: status == 'LIVE' VÀ login_status == 'LOGGED_IN'
        q = db.query(Account).filter(
            Account.status == "LIVE",
            Account.login_status == "LOGGED_IN"
        )
        if req.owner_username:
            q = q.filter(Account.user_id == req.owner_username)
        available_accounts = q.order_by(Account.id.asc()).limit(req.account_count).all()

    if not available_accounts:
        raise HTTPException(
            status_code=400,
            detail="Không có tài khoản Facebook nào khả dụng! Yêu cầu tài khoản phải có trạng thái 'Live' và 'Đã đăng nhập' (logged_in). Vui lòng vào trang Quản lý tài khoản (Accounts) để kiểm tra."
        )

    account_uids = [acc.uid for acc in available_accounts]
    used_uids = account_uids[:req.account_count]
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

    created_by_int = None
    if req.created_by is not None:
        created_by_int = req.created_by
    elif req.owner_username:
        try:
            created_by_int = int(req.owner_username)
        except ValueError:
            created_by_int = None

    created_campaigns = []
    total_tasks_all = 0
    reactions_pool = req.reactions or ["LIKE"]

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

        # 1. Tìm hoặc tạo SeedingTarget tuân thủ unique_seeding_target(target_type, fb_id)
        target = db.query(SeedingTarget).filter(
            SeedingTarget.target_type == camp_type,
            or_(SeedingTarget.fb_id == fb_id, SeedingTarget.url == item.url)
        ).first()

        if not target:
            target = SeedingTarget(
                target_type=camp_type,
                fb_id=fb_id,
                url=item.url,
                display_name=auto_display_name,
            )
            db.add(target)
            db.flush()
        else:
            target.display_name = auto_display_name
            if not target.fb_id:
                target.fb_id = fb_id

        # Chuỗi hành động: POST lấy req.actions, PAGE/PROFILE mặc định FOLLOW
        actions_str = ",".join(req.actions) if (camp_type == "POST" and req.actions) else "FOLLOW"

        # 2. Tạo record SeedingCampaign chuẩn DBML (không còn cột name)
        camp = SeedingCampaign(
            campaign_type=camp_type,
            actions=actions_str,
            reactions=",".join(req.reactions) if req.reactions else None,
            account_count=actual_account_count,
            delay_seconds_min=req.delay_seconds_min,
            delay_seconds_max=req.delay_seconds_max,
            status="PENDING",
            total_planned=actual_account_count,
            total_success=0,
            total_failed=0,
            created_by=created_by_int,
            created_at=utc_now()
        )
        db.add(camp)
        db.flush()

        # 3. Lưu kho comment nếu có cho chiến dịch này (áp dụng cho POST, campaign_id NOT NULL per DBML)
        saved_comments = []
        if req.comments:
            for cmt_text in req.comments:
                c = cmt_text.strip()
                if c:
                    comment_obj = SeedingComment(campaign_id=camp.id, content=c)
                    db.add(comment_obj)
                    saved_comments.append(comment_obj)
            db.flush()

        # 4. Tạo SeedingCampaignTarget chuẩn DBML
        camp_target = SeedingCampaignTarget(
            campaign_id=camp.id,
            target_id=target.id,
            note=item.note,
            source=item.source or "MANUAL",
            planned_count=actual_account_count,
            success_count=0,
            failed_count=0
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

        for uid in used_uids:
            for action_name in actions_list:
                act = action_name.upper().strip()

                # Kiểm tra PARTIAL INDEX uq_seeding_tasks_once:
                # Mỗi tài khoản chỉ thực hiện 1 lần mỗi hành động trên 1 mục tiêu (Follow/Like lần 2 = bỏ Follow/Like)
                existing_active = db.query(SeedingTask).filter(
                    SeedingTask.account_uid == uid,
                    SeedingTask.target_id == target.id,
                    SeedingTask.action == act,
                    SeedingTask.status.in_(["PENDING", "RUNNING", "SUCCESS"])
                ).first()
                if existing_active:
                    continue

                assigned_reaction = None
                if act == "REACT":
                    assigned_reaction = random.choice(reactions_pool)

                assigned_comment_id = None
                if act == "COMMENT" and saved_comments:
                    chosen_comment = random.choice(saved_comments)
                    assigned_comment_id = chosen_comment.id

                task = SeedingTask(
                    campaign_id=camp.id,
                    campaign_target_id=camp_target.id,
                    target_id=target.id,
                    account_uid=uid,
                    action=act,
                    reaction=assigned_reaction,
                    comment_id=assigned_comment_id,
                    status="PENDING",
                    attempts=0
                )
                db.add(task)
                total_tasks_all += 1

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
        "message": f"Tạo thành công {len(created_campaigns)} chiến dịch cho {len(created_campaigns)} {type_label} riêng biệt. Mỗi {type_label} gồm {actual_account_count} tài khoản."
    }


# ─────────────────────────────────────────────────────────────
# 3. THI HÀNH CHIẾN DỊCH BẰNG SELENIUM ĐA LUỒNG THẬT (NO MOCK)
# ─────────────────────────────────────────────────────────────
def _process_account_tasks(campaign_id: int, uid: str, task_ids: List[int], delay_min: int, delay_max: int):
    """Xử lý toàn bộ tác vụ của một tài khoản trên trình duyệt Chrome riêng biệt."""
    db = SessionLocal()
    driver = None
    try:
        if _active_seeding_campaigns.get(campaign_id, {}).get("stop_requested"):
            return

        account_record = db.query(Account).filter(Account.uid == uid).first()
        if not account_record:
            logger.error(f"Account {uid} not found in DB")
            return

        proxy = account_record.proxy if account_record else None

        broadcast("info", f"[{uid}] 🚀 Khởi động trình duyệt Chrome Profile...")
        driver = create_driver(uid=uid, headless=False, proxy=proxy, scope="seeding")
        bot = FacebookSeedingBot(driver)

        # 1. Kiểm tra phiên đăng nhập Facebook
        if not bot.is_facebook_session_alive(navigate=True):
            broadcast("warning", f"[{uid}] Chưa có phiên đăng nhập, đang nạp Cookie / thông tin tài khoản...")
            login_ok = bot.apply_facebook_support_data(account_record, HWID, callback=lambda m: broadcast("info", m))
            if not login_ok:
                broadcast("error", f"[{uid}] ❌ Không thể đăng nhập Facebook. Đánh dấu thất bại các tác vụ của nick này.")
                for tid in task_ids:
                    t = db.query(SeedingTask).filter(SeedingTask.id == tid).first()
                    if t and t.status == "PENDING":
                        t.status = "FAILED"
                        t.error_message = "Không thể đăng nhập Facebook"
                        t.finished_at = utc_now()
                        camp_tar = db.query(SeedingCampaignTarget).filter(SeedingCampaignTarget.id == t.campaign_target_id).first()
                        if camp_tar:
                            camp_tar.failed_count += 1
                        camp = db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
                        if camp:
                            camp.total_failed += 1
                db.commit()
                return
        else:
            broadcast("success", f"[{uid}] ✓ Phiên đăng nhập Facebook sẵn sàng.")

        # 2. Thi hành các task của tài khoản này
        # Đảm bảo thứ tự thực thi luôn đúng: 1. Like (REACT) -> 2. Comment (COMMENT) -> 3. Share (SHARE)
        action_priority = {"REACT": 1, "LIKE": 1, "COMMENT": 2, "SHARE": 3, "FOLLOW": 4, "LIKE_PAGE": 4}
        task_objs = db.query(SeedingTask).filter(SeedingTask.id.in_(task_ids)).all()
        task_objs.sort(key=lambda t: action_priority.get(t.action, 99))
        sorted_task_ids = [t.id for t in task_objs]

        account_has_failure = False
        for tid in sorted_task_ids:
            if _active_seeding_campaigns.get(campaign_id, {}).get("stop_requested"):
                broadcast("warning", f"[{uid}] Dừng tác vụ do có yêu cầu hủy.")
                account_has_failure = True
                break

            ut = db.query(SeedingTask).filter(SeedingTask.id == tid).first()
            if not ut or ut.status != "PENDING":
                continue

            target = db.query(SeedingTarget).filter(SeedingTarget.id == ut.target_id).first()
            if not target:
                continue

            ut.status = "RUNNING"
            ut.started_at = utc_now()
            db.commit()

            success = False
            msg = ""

            if ut.action in ("FOLLOW", "LIKE_PAGE"):
                acc_label = account_record.profile_name or uid if account_record else uid
                success, msg = bot.execute_follow(
                    target.url,
                    target_type=target.target_type or "PAGE",
                    account_name=acc_label,
                    callback=lambda m: broadcast("info", f"[{uid}] {m}")
                )
            elif ut.action == "REACT":
                success, msg = bot.execute_react(
                    target.url,
                    reaction_type=ut.reaction or "LIKE",
                    callback=lambda m: broadcast("info", f"[{uid}] {m}")
                )
            elif ut.action == "COMMENT":
                comment_text = "Tuyệt vời!"
                if ut.comment_id:
                    cmt_obj = db.query(SeedingComment).filter(SeedingComment.id == ut.comment_id).first()
                    if cmt_obj and cmt_obj.content:
                        comment_text = cmt_obj.content
                else:
                    any_cmts = db.query(SeedingComment).filter(
                        SeedingComment.campaign_id == campaign_id
                    ).all()
                    if any_cmts:
                        chosen = random.choice(any_cmts)
                        comment_text = chosen.content

                success, msg = bot.execute_comment(
                    target.url,
                    content=comment_text,
                    callback=lambda m: broadcast("info", f"[{uid}] {m}")
                )
            elif ut.action == "SHARE":
                success, msg = bot.execute_share(
                    target.url,
                    callback=lambda m: broadcast("info", f"[{uid}] {m}")
                )

            ut.finished_at = utc_now()
            ut.error_message = msg
            if success:
                ut.status = "SUCCESS"
                broadcast("success", f"[{uid}] ✓ {msg}")
            else:
                ut.status = "FAILED"
                account_has_failure = True
                broadcast("error", f"[{uid}] ❌ {msg}")

            db.commit()

            # Delay an toàn nếu còn tác vụ tiếp theo của tài khoản này
            if tid != sorted_task_ids[-1]:
                delay_s = random.randint(delay_min, delay_max)
                broadcast("info", f"[{uid}] Nghỉ an toàn {delay_s}s trước tác vụ tiếp theo...")
                time.sleep(delay_s)
            else:
                # Đã hoàn thành toàn bộ tác vụ của nick, nghỉ 1.5s rồi đóng trình duyệt an toàn
                time.sleep(1.5)

        # Cập nhật kết quả số tài khoản thành công / thất bại cho chiến dịch (mỗi nick = 1 lượt)
        camp = db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
        camp_tar = db.query(SeedingCampaignTarget).filter(SeedingCampaignTarget.campaign_id == campaign_id).first()
        if camp:
            if not account_has_failure:
                camp.total_success += 1
                if camp_tar:
                    camp_tar.success_count += 1
            else:
                camp.total_failed += 1
                if camp_tar:
                    camp_tar.failed_count += 1
            db.commit()

    except Exception as e:
        logger.error(f"Error in _process_account_tasks for {uid}: {e}")
        broadcast("error", f"[{uid}] Lỗi luồng: {str(e)[:80]}")
    finally:
        if driver:
            try:
                safe_close_driver(driver)
            except Exception:
                pass
            close_driver_for_uid(uid)
        db.close()


def _run_single_campaign(campaign_id: int):
    """Hàm chạy nền điều phối đa luồng (ThreadPoolExecutor) cho một chiến dịch seeding."""
    db = SessionLocal()
    try:
        campaign = db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
        if not campaign:
            return

        campaign.status = "RUNNING"
        campaign.started_at = utc_now()
        db.commit()

        _active_seeding_campaigns[campaign_id] = {"stop_requested": False, "running": True}
        broadcast("info", f"🚀 BẮT ĐẦU CHẠY CHIẾN DỊCH SEEDING #{campaign_id}: {campaign.target_summary}")

        # Lấy danh sách tasks PENDING
        tasks = db.query(SeedingTask).filter(
            SeedingTask.campaign_id == campaign_id,
            SeedingTask.status == "PENDING"
        ).order_by(SeedingTask.id.asc()).all()

        if not tasks:
            campaign.status = "COMPLETED"
            campaign.finished_at = utc_now()
            db.commit()
            broadcast("info", f"Chiến dịch #{campaign_id} không có tác vụ nào cần chạy.")
            return

        # Nhóm tasks theo UID
        tasks_by_uid: Dict[str, List[int]] = {}
        for t in tasks:
            tasks_by_uid.setdefault(t.account_uid, []).append(t.id)

        # Số luồng chạy đồng thời
        max_workers = 2
        broadcast("info", f"⚙️ Điều phối tự động với {max_workers} luồng Chrome song song trên {len(tasks_by_uid)} tài khoản.")

        delay_min = campaign.delay_seconds_min or 30
        delay_max = campaign.delay_seconds_max or 60

        # Khởi chạy đa luồng thật
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
                    delay_max=delay_max
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
            camp_end = db_end.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
            if camp_end:
                if _active_seeding_campaigns.get(campaign_id, {}).get("stop_requested"):
                    camp_end.status = "STOPPED"
                else:
                    camp_end.status = "COMPLETED"
                camp_end.finished_at = utc_now()
                db_end.commit()
                broadcast("success", f"🎉 KẾT THÚC CHIẾN DỊCH #{campaign_id} ({camp_end.target_summary}): Thành công {camp_end.total_success}, Thất bại {camp_end.total_failed}.")
        finally:
            db_end.close()

    finally:
        _active_seeding_campaigns.pop(campaign_id, None)
        db.close()


def _campaign_status(campaign_id: int) -> Optional[str]:
    """Đọc trạng thái hiện tại của chiến dịch trong DB."""
    db = SessionLocal()
    try:
        row = db.query(SeedingCampaign.status).filter(SeedingCampaign.id == campaign_id).first()
        return row[0] if row else None
    finally:
        db.close()


def _execute_campaign_runner(initial_campaign_id: int):
    """Hàm chạy nền điều phối tuần tự các chiến dịch trong cùng một batch."""
    chain = _batch_campaign_chains.get(initial_campaign_id, [initial_campaign_id])
    for idx, cid in enumerate(chain):
        # Kiểm tra nếu có yêu cầu dừng toàn batch
        stop_req = any(_active_seeding_campaigns.get(c, {}).get("stop_requested", False) for c in chain)
        if stop_req:
            break
        # Cờ stop_requested mất khi chiến dịch trước chạy xong, nên các chiến dịch kế tiếp
        # phải dựa vào trạng thái STOPPED mà API dừng đã ghi vào DB.
        if idx > 0 and _campaign_status(cid) == "STOPPED":
            break
        _run_single_campaign(cid)


@router.post("/campaigns/{campaign_id}/start")
async def start_seeding_campaign(campaign_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Bắt đầu chạy chiến dịch seeding trong background thread pool."""
    campaign = db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")

    if campaign_id in _active_seeding_campaigns and _active_seeding_campaigns[campaign_id].get("running"):
        return {"message": "Chiến dịch đang chạy", "status": "RUNNING"}

    background_tasks.add_task(_execute_campaign_runner, campaign_id)
    return {"message": "Đã bắt đầu chạy chiến dịch", "campaign_id": campaign_id, "status": "RUNNING"}


@router.post("/campaigns/{campaign_id}/stop")
async def stop_seeding_campaign(campaign_id: int, db: Session = Depends(get_db)):
    """Dừng khẩn cấp toàn bộ các luồng trình duyệt Chrome đang chạy của chiến dịch và toàn bộ chuỗi kế tiếp."""
    chain = _batch_campaign_chains.get(campaign_id, [campaign_id])
    for cid in chain:
        if cid in _active_seeding_campaigns:
            _active_seeding_campaigns[cid]["stop_requested"] = True
        c = db.query(SeedingCampaign).filter(SeedingCampaign.id == cid).first()
        if c and c.status in ("PENDING", "RUNNING"):
            c.status = "STOPPED"
    db.commit()

    # Đóng ngay lập tức các trình duyệt đang thuộc scope seeding
    close_scoped_active_drivers(scope="seeding", force=True)

    broadcast("warning", f"⏹ Đã dừng khẩn cấp chiến dịch #{campaign_id} và đóng toàn bộ trình duyệt.")
    return {"message": "Đã dừng chiến dịch", "campaign_id": campaign_id}


@router.post("/stop-all")
async def stop_all_seeding(db: Session = Depends(get_db)):
    """Dừng khẩn cấp mọi chiến dịch seeding đang chạy trên engine này (khi giao diện không còn giữ campaign_id)."""
    # Chỉ lấy các chiến dịch đang chạy trong tiến trình này và phần còn lại của batch của chúng,
    # không đụng tới chiến dịch RUNNING của máy khác trên cùng DB.
    campaign_ids = set()
    for cid in list(_active_seeding_campaigns.keys()):
        campaign_ids.update(_batch_campaign_chains.get(cid, [cid]))

    for cid in campaign_ids:
        if cid in _active_seeding_campaigns:
            _active_seeding_campaigns[cid]["stop_requested"] = True
        c = db.query(SeedingCampaign).filter(SeedingCampaign.id == cid).first()
        if c and c.status in ("PENDING", "RUNNING"):
            c.status = "STOPPED"
    db.commit()

    # Đóng ngay lập tức các trình duyệt đang thuộc scope seeding
    close_scoped_active_drivers(scope="seeding", force=True)

    broadcast("warning", f"⏹ Đã dừng khẩn cấp {len(campaign_ids)} chiến dịch seeding và đóng toàn bộ trình duyệt.")
    return {"message": "Đã dừng toàn bộ chiến dịch seeding", "campaign_ids": sorted(campaign_ids)}


# ─────────────────────────────────────────────────────────────
# 4. DANH SÁCH LỊCH SỬ SEEDING (CHO TRANG LỊCH SỬ)
# ─────────────────────────────────────────────────────────────
@router.get("/campaigns")
async def list_seeding_campaigns(
    campaign_type: Optional[str] = Query(None, description="PAGE | PROFILE | POST | ALL"),
    status: Optional[str] = Query(None, description="COMPLETED | RUNNING | FAILED | ALL"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo tên chiến dịch hoặc mục tiêu"),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """Lấy danh sách lịch sử chiến dịch seeding thật trong DB kèm bộ lọc & phân trang."""
    q = db.query(SeedingCampaign)

    if campaign_type and campaign_type.upper() not in ("ALL", "TẤT CẢ"):
        q = q.filter(SeedingCampaign.campaign_type == campaign_type.upper())

    if status and status.upper() not in ("ALL", "TẤT CẢ"):
        clean_status = status.upper()
        if clean_status in ("HOÀN THÀNH", "COMPLETED"):
            q = q.filter(SeedingCampaign.status == "COMPLETED")
        elif clean_status in ("ĐANG CHẠY", "RUNNING"):
            q = q.filter(SeedingCampaign.status == "RUNNING")
        elif clean_status in ("KHÔNG HOÀN THÀNH", "FAILED", "STOPPED"):
            q = q.filter(SeedingCampaign.status.in_(["FAILED", "STOPPED"]))

    if search and search.strip():
        term = f"%{search.strip()}%"
        # Tìm theo display_name / url / fb_id của SeedingTarget
        target_subquery = db.query(SeedingCampaignTarget.campaign_id).join(
            SeedingTarget, SeedingCampaignTarget.target_id == SeedingTarget.id
        ).filter(
            or_(
                SeedingTarget.display_name.ilike(term),
                SeedingTarget.url.ilike(term),
                SeedingTarget.fb_id.ilike(term)
            )
        ).subquery()
        q = q.filter(SeedingCampaign.id.in_(target_subquery))

    if from_date:
        try:
            dt_from = datetime.fromisoformat(from_date.replace("Z", "+00:00"))
            q = q.filter(SeedingCampaign.created_at >= dt_from)
        except Exception:
            pass

    if to_date:
        try:
            dt_to = datetime.fromisoformat(to_date.replace("Z", "+00:00"))
            q = q.filter(SeedingCampaign.created_at <= dt_to)
        except Exception:
            pass

    total = q.count()
    items = q.order_by(SeedingCampaign.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    results = []
    for c in items:
        results.append({
            "id": c.id,
            "created_at": to_vn_iso(c.created_at),
            "created_at_display": c.created_at.strftime("%d/%m/%Y %H:%M") if c.created_at else "-",
            "name": c.target_summary,
            "campaign_type": c.campaign_type,
            "campaign_type_display": "Page" if c.campaign_type == "PAGE" else ("Trang cá nhân" if c.campaign_type == "PROFILE" else "Bài viết"),
            "target_summary": c.target_summary or "-",
            "actions": [a.strip() for a in (c.actions or "").split(",") if a.strip()],
            "reactions": [r.strip() for r in (c.reactions or "").split(",") if r.strip()],
            "account_count": c.account_count,
            "total_planned": c.total_planned,
            "total_success": c.total_success,
            "total_failed": c.total_failed,
            "status": c.status,
            "status_display": "Hoàn thành" if c.status == "COMPLETED" else ("Đang chạy" if c.status == "RUNNING" else ("Không hoàn thành" if c.status in ("FAILED", "STOPPED") else "Chờ chạy"))
        })

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": results
    }


# ─────────────────────────────────────────────────────────────
# 5. CHI TIẾT CHIẾN DỊCH & LINK MỤC TIÊU THẬT (CHO NÚT "Chi tiết")
# ─────────────────────────────────────────────────────────────
@router.get("/campaigns/{campaign_id}/detail")
async def get_seeding_campaign_detail(campaign_id: int, db: Session = Depends(get_db)):
    """
    Trả về chi tiết chiến dịch, LINK MỤC TIÊU VÀ DANH SÁCH CHI TIẾT CÁC TÀI KHOẢN KÈM LỖI/GHI CHÚ.
    Dùng để hiển thị Modal khi bấm nút 'Chi tiết' ở màn hình Lịch sử.
    """
    campaign = db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")

    # 1. Lấy các mục tiêu kèm link từ seeding_campaign_targets JOIN seeding_targets
    camp_targets = db.query(
        SeedingCampaignTarget, SeedingTarget
    ).join(
        SeedingTarget, SeedingCampaignTarget.target_id == SeedingTarget.id
    ).filter(
        SeedingCampaignTarget.campaign_id == campaign_id
    ).order_by(SeedingCampaignTarget.id.asc()).all()

    targets_data = []
    for ct, t in camp_targets:
        targets_data.append({
            "target_id": t.id,
            "url": t.url,
            "fb_id": t.fb_id,
            "display_name": t.display_name or t.url,
            "target_type": t.target_type,
            "planned_count": ct.planned_count,
            "success_count": ct.success_count,
            "failed_count": ct.failed_count,
            "note": ct.note,
            "source": ct.source
        })

    # 2. Lấy danh sách chi tiết từng task của các tài khoản Facebook
    tasks = db.query(SeedingTask).filter(SeedingTask.campaign_id == campaign_id).order_by(SeedingTask.id.asc()).all()
    tasks_data = []
    for t in tasks:
        acc = db.query(Account).filter(Account.uid == t.account_uid).first()
        acc_name = acc.profile_name if (acc and acc.profile_name) else t.account_uid
        target = db.query(SeedingTarget).filter(SeedingTarget.id == t.target_id).first()

        action_disp = (
            "Follow Page" if (t.action == "FOLLOW" and campaign.campaign_type == "PAGE")
            else ("Follow Trang cá nhân" if (t.action == "FOLLOW" and campaign.campaign_type == "PROFILE")
            else (f"Like bài viết ({t.reaction})" if (t.action == "REACT" and t.reaction) else ("Like bài viết" if t.action == "REACT"
            else ("Bình luận" if t.action == "COMMENT"
            else ("Chia sẻ" if t.action == "SHARE"
            else t.action)))))
        )

        tasks_data.append({
            "id": t.id,
            "account_uid": t.account_uid,
            "account_name": acc_name,
            "action": t.action,
            "action_display": action_disp,
            "status": t.status,
            "status_display": "Thành công" if t.status == "SUCCESS" else ("Thất bại" if t.status == "FAILED" else ("Đang chạy" if t.status == "RUNNING" else "Chờ chạy")),
            "error_message": t.error_message,
            "target_url": target.url if target else None,
            "target_name": (target.display_name or target.url) if target else None,
        })

    # 3. Thống kê chi tiết 3 loại tương tác bài viết (Like, Bình luận, Chia sẻ)
    comments_list = [c.content for c in db.query(SeedingComment).filter(SeedingComment.campaign_id == campaign_id).all()]
    actions_list = [a.strip() for a in (campaign.actions or "").split(",") if a.strip()]
    reactions_list = [r.strip() for r in (campaign.reactions or "").split(",") if r.strip()]

    react_tasks = [t for t in tasks if t.action == "REACT"]
    comment_tasks = [t for t in tasks if t.action == "COMMENT"]
    share_tasks = [t for t in tasks if t.action == "SHARE"]

    interactions_breakdown = {
        "react": {
            "title": "Like bài viết",
            "subtitle": "Tương tác bài viết này",
            "enabled": "REACT" in actions_list,
            "planned": len(react_tasks),
            "success": sum(1 for t in react_tasks if t.status == "SUCCESS"),
            "failed": sum(1 for t in react_tasks if t.status == "FAILED"),
            "reactions": reactions_list
        },
        "comment": {
            "title": "Bình luận",
            "subtitle": "Tự động bình luận bài viết",
            "enabled": "COMMENT" in actions_list,
            "planned": len(comment_tasks),
            "success": sum(1 for t in comment_tasks if t.status == "SUCCESS"),
            "failed": sum(1 for t in comment_tasks if t.status == "FAILED"),
            "comments_count": len(comments_list),
            "comments": comments_list
        },
        "share": {
            "title": "Chia sẻ",
            "subtitle": "Chia sẻ về trang cá nhân",
            "enabled": "SHARE" in actions_list,
            "planned": len(share_tasks),
            "success": sum(1 for t in share_tasks if t.status == "SUCCESS"),
            "failed": sum(1 for t in share_tasks if t.status == "FAILED")
        }
    }

    # 4. Kiểm tra xem chuỗi chiến dịch liên kết có còn tiến trình nào đang chạy không
    chain = _batch_campaign_chains.get(campaign_id, [campaign_id])
    is_batch_active = any(
        _active_seeding_campaigns.get(cid, {}).get("running", False) for cid in chain
    )
    if not is_batch_active:
        active_camps = db.query(SeedingCampaign).filter(
            SeedingCampaign.id.in_(chain),
            SeedingCampaign.status.in_(["RUNNING", "PENDING"])
        ).count()
        is_batch_active = (active_camps > 1) if campaign.status in ("COMPLETED", "STOPPED", "FAILED") else (active_camps > 0)

    primary_target_url = targets_data[0]["url"] if targets_data else None
    primary_target_name = targets_data[0]["display_name"] if targets_data else campaign.target_summary

    return {
        "id": campaign.id,
        "name": primary_target_name or campaign.target_summary,
        "campaign_type": campaign.campaign_type,
        "campaign_type_display": "Page" if campaign.campaign_type == "PAGE" else ("Trang cá nhân" if campaign.campaign_type == "PROFILE" else "Bài viết"),
        "actions": actions_list,
        "reactions": reactions_list,
        "comments": comments_list,
        "interactions_breakdown": interactions_breakdown,
        "status": campaign.status,
        "status_display": "Hoàn thành" if campaign.status == "COMPLETED" else ("Đang chạy" if campaign.status == "RUNNING" else ("Không hoàn thành" if campaign.status in ("FAILED", "STOPPED") else "Chờ chạy")),
        "is_batch_active": is_batch_active,
        "created_at_display": campaign.created_at.strftime("%d/%m/%Y %H:%M") if campaign.created_at else "-",
        "total_planned": campaign.total_planned,
        "total_success": campaign.total_success,
        "total_failed": campaign.total_failed,
        "account_count": campaign.account_count,
        "primary_target_url": primary_target_url,
        "primary_target_name": primary_target_name,
        "targets": targets_data,
        "tasks": tasks_data
    }


# ─────────────────────────────────────────────────────────────
# 6. THỐNG KÊ TỔNG QUAN (4 CARD Ở MÀN HÌNH LỊCH SỬ)
# ─────────────────────────────────────────────────────────────
@router.get("/stats")
async def get_seeding_stats(db: Session = Depends(get_db)):
    """Trả về số liệu thống kê thật từ database."""
    total_campaigns = db.query(SeedingCampaign).count()

    sums = db.query(
        func.coalesce(func.sum(SeedingCampaign.total_planned), 0),
        func.coalesce(func.sum(SeedingCampaign.total_success), 0),
        func.coalesce(func.sum(SeedingCampaign.total_failed), 0)
    ).first()

    total_interactions = int(sums[0]) if sums else 0
    total_success = int(sums[1]) if sums else 0
    total_failed = int(sums[2]) if sums else 0

    return {
        "total_campaigns": total_campaigns,
        "total_interactions": total_interactions,
        "total_success": total_success,
        "total_failed": total_failed
    }
