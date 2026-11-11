"""API Module 10 — Quét thông tin nhóm. Tài khoản lấy từ Module 2."""
from __future__ import annotations

import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from modules.module_02_account_manager.api.router import scoped_owner
from modules.module_02_account_manager.context import owner_context
from modules.module_02_account_manager.database.connection import get_db
from modules.module_02_account_manager.database.repository import AccountRepository as Repo
from modules.module_04_page_creator.routes import get_owner_username
from modules.module_10_group_scan.keyword_check import (
    clear_pending_for_uid,
    get_check_status,
    set_job_control,
    start_keyword_check,
)
from modules.module_10_group_scan.member_check import (
    get_member_scan_status,
    set_member_scan_control,
    start_member_scan,
)
from modules.module_10_group_scan.post_check import (
    get_post_scan_status,
    set_post_scan_control,
    start_post_scan,
)
from modules.module_10_group_scan.models import (
    create_scan_category,
    delete_scan_category,
    delete_scan_session,
    delete_scan_sessions_bulk,
    delete_scanned_group,
    delete_scanned_groups_bulk,
    delete_scanned_group_member,
    delete_scanned_group_members_bulk,
    delete_scanned_group_post,
    delete_scanned_group_posts_bulk,
    get_group_members_summary,
    get_group_posts_summary,
    keyword_counts,
    list_all_scanned_groups,
    list_groups_for_keywords,
    list_groups_with_post_counts,
    list_scan_categories,
    list_scan_sessions,
    list_scanned_group_members,
    list_scanned_group_posts,
    move_groups_to_category,
    normalize_keyword,
    save_groups_to_category,
    update_scan_category,
)

router = APIRouter(prefix="/api/group-scan", tags=["Module 10: Group scan"])


def _login_status(account) -> str:
    raw = str(getattr(account, "login_status", "") or "").upper()
    if raw in {"LOGGED_IN", "SUCCESS"}:
        return "logged_in"
    if raw in {"ERROR", "FAILED"}:
        return "failed"
    return "not_logged_in"


def _status(account) -> str:
    raw = str(getattr(account, "status", "") or "").upper()
    if raw == "LIVE":
        return "live"
    if raw == "DIE":
        return "die"
    return "unknown"


class KeywordQuota(BaseModel):
    keyword: str = Field(..., min_length=1)
    limit: int = Field(30, ge=1, le=200, description="Số nhóm tối đa / từ khóa")


class CheckKeywordRequest(BaseModel):
    uid: Optional[str] = Field(default=None, description="UID tài khoản Module 2 đã chọn")
    uids: Optional[list[str]] = Field(default=None, description="Danh sách UIDs tài khoản thực thi (xoay vòng)")
    # Tương thích: FE mới gửi keywords[]; FE/Engine cũ có thể gửi keyword=
    keyword: Optional[str] = Field(default=None, description="Từ khóa đơn (tương thích cũ)")
    keywords: Optional[list[KeywordQuota]] = Field(
        default=None,
        description="Danh sách từ khóa + hạn mức — quét lần lượt cùng 1 nick",
    )
    delay_min: float = Field(5, ge=0, le=3600, description="Nghỉ tối thiểu giữa 2 từ khóa (giây)")
    delay_max: float = Field(10, ge=0, le=3600, description="Nghỉ tối đa giữa 2 từ khóa (giây)")
    public_only: bool = Field(False, description="True = chỉ giữ nhóm Public / Công khai")
    private_only: bool = Field(False, description="True = chỉ giữ nhóm Private / Riêng tư")
    min_members: Optional[int] = Field(
        None,
        ge=0,
        le=100_000_000,
        description="Chỉ giữ nhóm có thành viên > ngưỡng (None/0 = tắt)",
    )
    force: bool = Field(
        True,
        description="True = hủy job cũ bị kẹt (tắt browser/mất kết nối) rồi chạy lại",
    )
    auto_join: bool = Field(
        True,
        description="True = Tự động tham gia nhóm khi quét và trả lời câu hỏi nhóm riêng tư",
    )
    rotate_after: int = Field(
        50,
        ge=1,
        le=5000,
        description="Đổi nick mới khi quét được N nhóm / tài khoản (Bot Pool Round-robin)",
    )

    @model_validator(mode="after")
    def _require_keyword_source(self):
        if not self.uid and not self.uids:
            raise ValueError("Cần chọn ít nhất 1 tài khoản (uid hoặc uids)")
        if not self.uid and self.uids:
            self.uid = self.uids[0]
        has_list = bool(self.keywords)
        has_one = bool(str(self.keyword or "").strip())
        if not has_list and not has_one:
            raise ValueError("Cần gửi keywords[] hoặc keyword")
        return self


class ClearCheckRequest(BaseModel):
    uid: str = Field(..., min_length=1)


class JobControlRequest(BaseModel):
    job_id: str = Field(..., min_length=1)
    action: str = Field(..., description="pause | resume | abort")


class LookupKeywordsRequest(BaseModel):
    """Kiểm tra: đọc số nhóm đã lưu theo từ khóa + danh sách nhóm từ DB."""
    keywords: list[str] = Field(..., min_length=1, description="Danh sách từ khóa cần kiểm tra")
    include_groups: bool = Field(True, description="True = trả luôn danh sách nhóm đã lưu")


@router.get("/health")
def health():
    return {"ok": True, "module": 10, "name": "group-scan"}


@router.get("/accounts", dependencies=[Depends(scoped_owner)])
def list_ready_accounts(db: Session = Depends(get_db)):
    """Tài khoản Module 2 của user đang đăng nhập. FE dùng để chọn nick đi quét."""
    from datetime import datetime
    from modules.module_02_account_manager.database.models import Account, AccountCategory

    owner = owner_context.get() or get_owner_username()
    accounts = Repo.get_all(db, owner_username=owner) if owner else db.query(Account).order_by(Account.id.desc()).all()
    
    cat_names = {}
    try:
        categories = db.query(AccountCategory).all()
        cat_names = {c.id: c.name for c in categories}
    except Exception:
        pass

    category_list = sorted(list({name for name in cat_names.values() if name}))
    now = datetime.utcnow()

    rows = []
    for account in accounts:
        login = _login_status(account)
        status = _status(account)
        cat_name = cat_names.get(account.category_id) or "Mặc định"
        nurture_days = 0
        if getattr(account, "created_at", None):
            try:
                nurture_days = max(0, (now - account.created_at).days)
            except Exception:
                nurture_days = 0

        rows.append(
            {
                "id": account.id,
                "uid": account.uid,
                "profile_name": account.profile_name or "",
                "email": getattr(account, "email", None) or "",
                "status": status,
                "login_status": login,
                "proxy": getattr(account, "proxy", "") or "",
                "category": cat_name,
                "nurture_days": nurture_days,
                "ready": login == "logged_in" and status != "die",
            }
        )
    ready = [row for row in rows if row["ready"]]
    return {
        "accounts": rows,
        "categories": category_list,
        "ready_count": len(ready),
        "total": len(rows),
    }


@router.post("/check-keyword", dependencies=[Depends(scoped_owner)])
def check_keyword(body: CheckKeywordRequest, db: Session = Depends(get_db)):
    """
    Bắt đầu thực thi: mở Chrome 1 lần, quét lần lượt từng từ khóa
    (search → Groups → scrape tới hạn mức), nghỉ delay giữa các từ khóa.
    """
    uid = str(body.uid or "").strip()
    if not uid:
        raise HTTPException(422, "Thiếu UID tài khoản")

    items: list[dict] = []
    if body.keywords:
        items = [{"keyword": row.keyword, "limit": row.limit} for row in body.keywords]
    elif body.keyword:
        items = [{"keyword": str(body.keyword).strip(), "limit": 30}]

    if not items:
        raise HTTPException(422, "Thiếu từ khóa")

    owner = owner_context.get() or get_owner_username()
    account = Repo.get_by_uid(db, uid, owner_username=owner)
    if not account:
        raise HTTPException(404, f"Không tìm thấy tài khoản {uid}")

    login = _login_status(account)
    status = _status(account)
    if status == "die":
        raise HTTPException(400, "Tài khoản đang DIE — không dùng để quét")
    if login != "logged_in":
        raise HTTPException(400, "Tài khoản chưa đăng nhập Module 2 — hãy login trước")

    delay_min = float(body.delay_min)
    delay_max = max(delay_min, float(body.delay_max))
    public_only = bool(body.public_only)
    private_only = bool(body.private_only)
    # Tick cả hai = quét cả công khai + riêng tư
    if public_only and private_only:
        public_only = False
        private_only = False
    min_members = body.min_members if body.min_members and body.min_members > 0 else None

    # Đảm bảo mỗi từ khóa tạo thành 1 DANH MỤC trong bảng scanned_group_categories (bỏ qua liên kết URL)
    for it in items:
        kw = str(it.get("keyword") or "").strip()
        is_url = kw.startswith("http") or "/groups/" in kw or "facebook.com" in kw or "fb.com" in kw or kw.lower() == "directlink"
        if kw and not is_url:
            try:
                create_scan_category(owner, kw, f"Danh mục từ khóa: {kw}")
            except Exception as exc:
                print(f"[Module 10 Router] auto create category error: {exc}")

    auto_join = bool(getattr(body, "auto_join", True))
    rotate_after = max(1, int(getattr(body, "rotate_after", 50) or 50))
    all_uids = list(body.uids) if body.uids else [uid]
    try:
        result = start_keyword_check(
            owner=owner,
            uid=uid,
            uids=all_uids,
            rotate_after=rotate_after,
            keywords=items,
            delay_min=delay_min,
            delay_max=delay_max,
            public_only=public_only,
            private_only=private_only,
            min_members=min_members,
            force=bool(body.force),
            auto_join=auto_join,
        )
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    words = result.get("keywords") or [result.get("keyword")]
    limits = result.get("keyword_limits") or {}
    bits = [f"«{w}»×{limits.get(w, '?')}" for w in words[:5]]
    label = ", ".join(bits)
    if len(words) > 5:
        label += f" (+{len(words) - 5})"
    return {
        **result,
        "profile_name": account.profile_name or "",
        "message": (
            f"[scan-v2] Nick {uid}: {len(words)} từ khóa ({label}), "
            f"nghỉ {delay_min:.0f}–{delay_max:.0f}s giữa các lần."
        ),
    }


@router.post("/check-clear", dependencies=[Depends(scoped_owner)])
def check_clear(body: ClearCheckRequest):
    """Gỡ khóa job bị kẹt sau khi tắt browser / mất kết nối."""
    owner = owner_context.get() or get_owner_username()
    uid = str(body.uid or "").strip()
    if not uid:
        raise HTTPException(422, "Thiếu UID")
    released = clear_pending_for_uid(owner=owner, uid=uid, reason="manual-clear")
    return {"ok": True, "uid": uid, "released": released}


@router.post("/lookup-keywords", dependencies=[Depends(scoped_owner)])
def lookup_keywords(body: LookupKeywordsRequest):
    """
    Nút Kiểm tra: lấy số nhóm đã quét theo từng từ khóa từ Supabase
    (không mở Chrome). Fill bảng trạng thái + optionally bảng kết quả.
    """
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    words = []
    seen = set()
    for raw in body.keywords or []:
        w = re.sub(r"\s+", " ", str(raw or "").strip())
        key = normalize_keyword(w)
        if not w or not key or key in seen:
            continue
        seen.add(key)
        words.append(w)
    if not words:
        raise HTTPException(422, "Thiếu từ khóa")

    counts = keyword_counts(owner, words)
    stats = {}
    for word in words:
        n = int(counts.get(word) or 0)
        stats[word] = {
            "count": n,
            "status": "done" if n > 0 else "ready",
        }

    groups = []
    if body.include_groups:
        groups = list_groups_for_keywords(owner, words, limit=500)

    total = sum(int(counts.get(w) or 0) for w in words)
    return {
        "ok": True,
        "owner": owner,
        "keywords": words,
        "keyword_stats": stats,
        "groups": groups,
        "total_groups": total,
        "message": (
            f"Đã kiểm tra {len(words)} từ khóa — tổng {total} nhóm đã lưu trong DB."
            if total
            else f"Đã kiểm tra {len(words)} từ khóa — chưa có nhóm nào trong DB (bấm Bắt đầu để quét)."
        ),
    }


@router.post("/job-control", dependencies=[Depends(scoped_owner)])
def job_control(body: JobControlRequest):
    """Tạm dừng (sau từ khóa hiện tại) / dừng khẩn cấp / resume flag."""
    try:
        return set_job_control(body.job_id, body.action)
    except ValueError as exc:
        raise HTTPException(404 if "Không tìm thấy" in str(exc) else 422, str(exc)) from exc


@router.get("/check-status", dependencies=[Depends(scoped_owner)])
def check_status(job_id: Optional[str] = None, uid: Optional[str] = None):
    """Poll tiến trình / log / danh sách nhóm của lần quét gần nhất."""
    status = get_check_status(job_id=job_id, uid=uid)
    if not status:
        raise HTTPException(404, "Không tìm thấy job quét")
    return status


class BulkDeleteRequest(BaseModel):
    ids: list[Any] = Field(..., min_length=1)


@router.get("/groups", dependencies=[Depends(scoped_owner)])
def get_groups(
    keyword: Optional[str] = None,
    privacy: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 1000,
    offset: int = 0,
):
    """Lấy danh sách các nhóm đã quét từ Database."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    return list_all_scanned_groups(
        owner,
        keyword=keyword,
        privacy=privacy,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.delete("/groups/{id}", dependencies=[Depends(scoped_owner)])
def delete_group(id: str):
    """Xóa 1 nhóm đã quét khỏi Database."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    ok = delete_scanned_group(owner, id)
    return {"ok": ok, "id": id}


@router.post("/groups/delete-bulk", dependencies=[Depends(scoped_owner)])
def delete_groups_bulk(body: BulkDeleteRequest):
    """Xóa nhiều nhóm đã quét khỏi Database."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    deleted_count = delete_scanned_groups_bulk(owner, body.ids)
    return {"ok": True, "deleted": deleted_count}


@router.get("/history", dependencies=[Depends(scoped_owner)])
def get_history(
    search: Optional[str] = None,
    scan_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    """Lấy lịch sử các phiên quét nhóm từ Database."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    sessions = list_scan_sessions(
        owner,
        search=search,
        scan_type=scan_type,
        status=status,
        limit=limit,
        offset=offset,
    )
    return {"ok": True, "sessions": sessions, "total": len(sessions)}


@router.delete("/history/{id}", dependencies=[Depends(scoped_owner)])
def delete_history_session(id: str):
    """Xóa 1 phiên lịch sử quét nhóm khỏi Database."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    ok = delete_scan_session(owner, id)
    return {"ok": ok, "id": id}


@router.post("/history/delete-bulk", dependencies=[Depends(scoped_owner)])
def delete_history_sessions_bulk(body: BulkDeleteRequest):
    """Xóa nhiều phiên lịch sử quét nhóm khỏi Database."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    deleted_count = delete_scan_sessions_bulk(owner, body.ids)
    return {"ok": True, "deleted": deleted_count}


# ─────────────────────────────────────────────────────────────────────────────
# CATEGORIES & SHARED LIST ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

class CreateCategoryRequest(BaseModel):
    name: str = Field(..., min_length=1)
    description: Optional[str] = ""


class SaveToCategoryRequest(BaseModel):
    category_name: str = Field(..., min_length=1)
    groups: list[dict[str, Any]] = Field(..., min_length=1)
    deduplicate: bool = True


@router.get("/categories", dependencies=[Depends(scoped_owner)])
def get_categories():
    """Lấy danh sách các danh mục nhóm có sẵn."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    categories = list_scan_categories(owner)
    return {"ok": True, "categories": categories}


@router.post("/categories", dependencies=[Depends(scoped_owner)])
def post_category(body: CreateCategoryRequest):
    """Tạo mới một danh mục nhóm."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    res = create_scan_category(owner, body.name, body.description or "")
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "Không thể tạo danh mục")
    return res


class UpdateCategoryRequest(BaseModel):
    name: str = Field(..., min_length=1)


@router.put("/categories/{id}", dependencies=[Depends(scoped_owner)])
def put_category(id: str, body: UpdateCategoryRequest):
    """Cập nhật tên danh mục nhóm."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    res = update_scan_category(owner, id, body.name)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "Không thể cập nhật danh mục")
    return res


@router.delete("/categories/{id}", dependencies=[Depends(scoped_owner)])
def delete_category_endpoint(id: str):
    """Xóa danh mục nhóm khỏi Database."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    ok = delete_scan_category(owner, id)
    return {"ok": ok, "id": id}


class MoveGroupsRequest(BaseModel):
    category_name: str = Field(..., min_length=1)
    group_ids: list[Any] = Field(..., min_length=1)


@router.post("/categories/move-groups", dependencies=[Depends(scoped_owner)])
def post_move_groups(body: MoveGroupsRequest):
    """Chuyển các nhóm đã chọn sang danh mục khác."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    moved_count = move_groups_to_category(owner, body.category_name, body.group_ids)
    return {"ok": True, "moved_count": moved_count}


@router.post("/save-to-category", dependencies=[Depends(scoped_owner)])
def post_save_to_category(body: SaveToCategoryRequest):
    """Lưu danh sách nhóm vào danh mục chung."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    res = save_groups_to_category(
        owner,
        category_name=body.category_name,
        groups=body.groups,
        deduplicate=body.deduplicate,
    )
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "Lỗi khi lưu danh sách nhóm")
    return res


# =========================================================================
# PHÂN HỆ 10.2: QUÉT THÀNH VIÊN NHÓM & QUẢN LÝ DANH SÁCH THÀNH VIÊN
# =========================================================================


class StartMemberScanRequest(BaseModel):
    uids: list[str] = Field(..., min_length=1, description="Danh sách UID tài khoản thực thi")
    groups: list[dict[str, Any]] = Field(..., min_length=1, description="Danh sách nhóm mục tiêu (tối đa 20)")
    delay_min: float = Field(5.0, ge=1.0, le=3600.0)
    delay_max: float = Field(10.0, ge=1.0, le=3600.0)
    switch_acc_threshold: int = Field(50, ge=1, le=1000)
    members_limit: int = Field(50, ge=1, le=1000)
    skip_admin: bool = Field(True)
    auto_dedupe: bool = Field(True)
    new_members_only: bool = Field(True)

    @model_validator(mode="after")
    def validate_rules(self):
        if self.delay_max < self.delay_min:
            raise ValueError("Thời gian trễ tối đa phải lớn hơn hoặc bằng thời gian tối thiểu")
        if len(self.groups) > 20:
            raise ValueError("Số lượng nhóm mục tiêu trong một phiên quét không được vượt quá 20 nhóm")
        return self


class MemberJobControlRequest(BaseModel):
    job_id: str = Field(..., min_length=1)
    action: str = Field(..., pattern="^(pause|resume|abort)$")


class BulkDeleteMembersRequest(BaseModel):
    ids: list[int] = Field(..., min_length=1)


@router.post("/members/start", dependencies=[Depends(scoped_owner)])
def post_start_member_scan(body: StartMemberScanRequest):
    """Khởi chạy phiên quét thành viên nhóm (UC-GMS-01 -> UC-GMS-04)."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    try:
        res = start_member_scan(
            owner=owner,
            uids=body.uids,
            groups=body.groups,
            delay_min=body.delay_min,
            delay_max=body.delay_max,
            switch_acc_threshold=body.switch_acc_threshold,
            members_limit=body.members_limit,
            skip_admin=body.skip_admin,
            auto_dedupe=body.auto_dedupe,
            new_members_only=body.new_members_only,
        )
        return {"ok": True, **res}
    except ValueError as val_err:
        raise HTTPException(400, str(val_err))
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khởi chạy phiên quét thành viên: {exc}")


@router.get("/members/status")
def get_member_scan_status_endpoint(job_id: str):
    """Poll trạng thái, logs thời gian thực và danh sách thành viên đang quét."""
    status_data = get_member_scan_status(job_id)
    if not status_data:
        raise HTTPException(404, "Không tìm thấy phiên quét hoặc phiên đã kết thúc")
    return {"ok": True, "job": status_data}


@router.post("/members/control", dependencies=[Depends(scoped_owner)])
def post_member_scan_control(body: MemberJobControlRequest):
    """Tạm dừng / Tiếp tục / Hủy khẩn cấp phiên quét thành viên."""
    ok = set_member_scan_control(body.job_id, body.action)
    if not ok:
        raise HTTPException(400, f"Không thể gửi lệnh '{body.action}' tới phiên quét")
    return {"ok": True, "action": body.action}


@router.get("/members", dependencies=[Depends(scoped_owner)])
def get_scanned_members_endpoint(
    group_id: Optional[str] = None,
    category_id: Optional[str] = None,
    search: Optional[str] = None,
    friend_filter: Optional[str] = None,
    role: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
):
    """Lấy danh sách thành viên nhóm đã lưu trữ trong CSDL (UC-GMS-05)."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")

    offset = max(0, (page - 1) * page_size)
    items, total = list_scanned_group_members(
        owner=owner,
        group_id=group_id,
        category_id=category_id,
        search=search,
        friend_filter=friend_filter,
        role=role,
        limit=page_size,
        offset=offset,
    )
    return {
        "ok": True,
        "members": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/members/summary", dependencies=[Depends(scoped_owner)])
def get_members_summary_endpoint():
    """Lấy thống kê tổng quan (KPI cards) cho danh sách thành viên."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    summary = get_group_members_summary(owner)
    return {"ok": True, **summary}


@router.delete("/members/{id}", dependencies=[Depends(scoped_owner)])
def delete_scanned_member_endpoint(id: int):
    """Xóa 1 thành viên nhóm khỏi CSDL."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    ok = delete_scanned_group_member(owner, id)
    return {"ok": ok, "id": id}


@router.post("/members/delete-bulk", dependencies=[Depends(scoped_owner)])
def delete_scanned_members_bulk_endpoint(body: BulkDeleteMembersRequest):
    """Xóa hàng loạt thành viên nhóm khỏi CSDL."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    deleted_count = delete_scanned_group_members_bulk(owner, body.ids)
    return {"ok": True, "deleted_count": deleted_count}


# =========================================================================
# PHÂN HỆ 10.3: QUÉT BÀI VIẾT NHÓM & QUẢN LÝ KHO BÀI VIẾT
# =========================================================================


class StartPostScanRequest(BaseModel):
    uids: list[str] = Field(..., min_length=1, description="Danh sách UID tài khoản thực thi")
    groups: list[dict[str, Any]] = Field(..., min_length=1, description="Danh sách nhóm mục tiêu (tối đa 20)")
    delay_min: float = Field(5.0, ge=1.0, le=3600.0)
    delay_max: float = Field(10.0, ge=1.0, le=3600.0)
    switch_acc_threshold: int = Field(50, ge=1, le=100)
    posts_limit: int = Field(50, ge=1, le=100)
    days_limit: int = Field(7, ge=1, le=365)
    skip_pinned_posts: bool = Field(True)
    auto_dedupe_posts: bool = Field(True)

    @model_validator(mode="after")
    def validate_rules(self):
        if self.delay_max < self.delay_min:
            raise ValueError("Thời gian trễ tối đa phải lớn hơn hoặc bằng thời gian tối thiểu")
        if len(self.groups) > 20:
            raise ValueError("Số lượng nhóm mục tiêu trong một phiên quét không được vượt quá 20 nhóm")
        return self


class PostJobControlRequest(BaseModel):
    job_id: str = Field(..., min_length=1)
    action: str = Field(..., pattern="^(pause|resume|abort)$")


class BulkDeletePostsRequest(BaseModel):
    ids: list[int] = Field(..., min_length=1)


@router.post("/posts/start", dependencies=[Depends(scoped_owner)])
def post_start_post_scan(body: StartPostScanRequest):
    """Khởi chạy phiên quét bài viết nhóm (UC-GPS-01 -> UC-GPS-04)."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    try:
        res = start_post_scan(
            owner=owner,
            uids=body.uids,
            groups=body.groups,
            delay_min=body.delay_min,
            delay_max=body.delay_max,
            switch_acc_threshold=body.switch_acc_threshold,
            posts_limit=body.posts_limit,
            days_limit=body.days_limit,
            skip_pinned_posts=body.skip_pinned_posts,
            auto_dedupe_posts=body.auto_dedupe_posts,
        )
        return {"ok": True, **res}
    except ValueError as val_err:
        raise HTTPException(400, str(val_err))
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khởi chạy phiên quét bài viết: {exc}")


@router.get("/posts/status")
def get_post_scan_status_endpoint(job_id: str):
    """Poll trạng thái, logs thời gian thực và bài viết đang quét."""
    status_data = get_post_scan_status(job_id)
    if not status_data:
        raise HTTPException(404, "Không tìm thấy phiên quét hoặc phiên đã kết thúc")
    return {"ok": True, "job": status_data}


@router.post("/posts/control", dependencies=[Depends(scoped_owner)])
def post_post_scan_control(body: PostJobControlRequest):
    """Tạm dừng / Tiếp tục / Hủy khẩn cấp phiên quét bài viết."""
    ok = set_post_scan_control(body.job_id, body.action)
    if not ok:
        raise HTTPException(400, f"Không thể gửi lệnh '{body.action}' tới phiên quét")
    return {"ok": True, "action": body.action}


@router.get("/posts", dependencies=[Depends(scoped_owner)])
def get_scanned_posts_endpoint(
    group_id: Optional[str] = None,
    category_id: Optional[str] = None,
    search: Optional[str] = None,
    min_likes: Optional[int] = None,
    min_comments: Optional[int] = None,
    min_shares: Optional[int] = None,
    sort_by: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
):
    """Lấy danh sách bài viết nhóm đã lưu trữ trong CSDL (UC-GPS-05, UC-GPS-06)."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")

    items, total = list_scanned_group_posts(
        owner=owner,
        group_id=group_id,
        category_id=category_id,
        search=search,
        min_likes=min_likes,
        min_comments=min_comments,
        min_shares=min_shares,
        sort_by=sort_by,
        page=page,
        page_size=page_size,
    )
    return {
        "ok": True,
        "posts": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/posts/summary", dependencies=[Depends(scoped_owner)])
def get_posts_summary_endpoint():
    """Lấy thống kê tổng quan (KPI cards) cho kho bài viết."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    summary = get_group_posts_summary(owner)
    return {"ok": True, **summary}


@router.get("/posts/groups", dependencies=[Depends(scoped_owner)])
def get_posts_groups_endpoint():
    """Lấy danh sách các nhóm đã có bài viết (cột trái UC-GPS-06)."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    groups = list_groups_with_post_counts(owner)
    return {"ok": True, "groups": groups}


@router.delete("/posts/{id}", dependencies=[Depends(scoped_owner)])
def delete_scanned_post_endpoint(id: int):
    """Xóa 1 bài viết khỏi CSDL."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    ok = delete_scanned_group_post(owner, id)
    return {"ok": ok, "id": id}


@router.post("/posts/delete-bulk", dependencies=[Depends(scoped_owner)])
def delete_scanned_posts_bulk_endpoint(body: BulkDeletePostsRequest):
    """Xóa hàng loạt bài viết khỏi CSDL."""
    owner = owner_context.get() or get_owner_username()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    deleted_count = delete_scanned_group_posts_bulk(owner, body.ids)
    return {"ok": True, "deleted_count": deleted_count}



