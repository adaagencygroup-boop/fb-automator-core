"""API Module 10 — Quét thông tin nhóm. Tài khoản lấy từ Module 2."""
from __future__ import annotations

import re
from typing import Optional

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
from modules.module_10_group_scan.models import (
    keyword_counts,
    list_groups_for_keywords,
    normalize_keyword,
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
    uid: str = Field(..., min_length=1, description="UID tài khoản Module 2 đã chọn")
    # Tương thích: FE mới gửi keywords[]; FE/Engine cũ có thể gửi keyword=
    keyword: Optional[str] = Field(default=None, description="Từ khóa đơn (tương thích cũ)")
    keywords: Optional[list[KeywordQuota]] = Field(
        default=None,
        description="Danh sách từ khóa + hạn mức — quét lần lượt cùng 1 nick",
    )
    delay_min: float = Field(5, ge=0, le=3600, description="Nghỉ tối thiểu giữa 2 từ khóa (giây)")
    delay_max: float = Field(10, ge=0, le=3600, description="Nghỉ tối đa giữa 2 từ khóa (giây)")
    public_only: bool = Field(False, description="True = chỉ giữ nhóm Public / Công khai")
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

    @model_validator(mode="after")
    def _require_keyword_source(self):
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
    owner = get_owner_username()
    accounts = Repo.get_all(db, owner_username=owner) if owner else []
    rows = []
    for account in accounts:
        login = _login_status(account)
        status = _status(account)
        rows.append(
            {
                "id": account.id,
                "uid": account.uid,
                "profile_name": account.profile_name or "",
                "email": getattr(account, "email", None) or "",
                "status": status,
                "login_status": login,
                "ready": login == "logged_in" and status != "die",
            }
        )
    ready = [row for row in rows if row["ready"]]
    return {
        "accounts": rows,
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
    min_members = body.min_members if body.min_members and body.min_members > 0 else None

    try:
        result = start_keyword_check(
            owner=owner,
            uid=uid,
            keywords=items,
            delay_min=delay_min,
            delay_max=delay_max,
            public_only=public_only,
            min_members=min_members,
            force=bool(body.force),
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
