"""
run_routes.py
Seeding Bài viết — điều khiển lô đang chạy (Tạm dừng / Tiếp tục / tiến độ từng bài / Thử lại lượt lỗi),
Xem trước kế hoạch và Mẫu cấu hình. Gắn vào seeding_router → /api/seeding/...
Handler viết `def` (FastAPI chạy trong threadpool) để truy vấn DB không chặn event loop.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from modules.module_02_account_manager.database.connection import get_db
from modules.module_02_account_manager.database.models import Account
from modules.module_08_interaction_seeding.automation import post_fetcher
from modules.module_08_interaction_seeding.models import (
    SeedingCampaign,
    SeedingCampaignTarget,
    SeedingTarget,
    SeedingTask,
    SeedingTemplate,
)
from modules.module_08_interaction_seeding.models.seeding_models import vn_now
from modules.module_08_interaction_seeding.routes import seeding_routes as sr

router = APIRouter(tags=["Seeding"])

ACTIONS = ("REACT", "COMMENT", "SHARE")
PREVIEW_POSTS = 20
PROGRESS_POSTS = 500
# Lượt "đã làm từ trước" (ghi FAILED lúc tạo lô) — không tính là lỗi cần thử lại
_ALREADY_DONE_SQL = "error_message LIKE 'Tài khoản đã %rồi'"


def _is_admin(user: Dict[str, Any] | None) -> bool:
    role = ((user or {}).get("role") or (user or {}).get("_role_claim") or "user").lower()
    return role in ("admin", "superadmin", "administrator")


def _owned_campaign(db: Session, campaign_id: int, request: Request, authorization: Optional[str]) -> SeedingCampaign:
    camp = db.query(SeedingCampaign).filter(SeedingCampaign.id == campaign_id).first()
    if not camp:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")
    user = sr.get_current_user_info(request, authorization)
    if user and not _is_admin(user) and camp.created_by is not None and camp.created_by != user["id"]:
        raise HTTPException(status_code=403, detail="Bạn không có quyền điều khiển chiến dịch này")
    return camp


def _chain(campaign_id: int) -> List[int]:
    return list(sr._batch_campaign_chains.get(campaign_id) or [campaign_id])


def _batch_running(chain: List[int]) -> bool:
    ids = set(chain)
    return any(ids & set(c) for c in list(sr._running_batches.values()))


# ─────────────────────────────────────────────────────────────
# Tạm dừng / Tiếp tục
# ─────────────────────────────────────────────────────────────
@router.post("/campaigns/{campaign_id}/pause")
def pause_seeding_batch(
    campaign_id: int,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Tạm dừng cả lô: tác vụ đang làm dở vẫn làm xong, sau đó các nick chờ tới khi Tiếp tục."""
    camp = _owned_campaign(db, campaign_id, request, authorization)
    chain = _chain(campaign_id)
    if not _batch_running(chain):
        raise HTTPException(status_code=409, detail="Lô seeding này không còn chạy.")
    sr._paused_batches.add(chain[0])
    owner = str(camp.created_by) if camp.created_by is not None else None
    sr.broadcast("warning", "⏸ Đã tạm dừng lô seeding — tác vụ đang làm dở sẽ làm xong rồi chờ.", owner=owner)
    return {"paused": True, "batch_id": chain[0]}


@router.post("/campaigns/{campaign_id}/resume")
def resume_seeding_batch(
    campaign_id: int,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    camp = _owned_campaign(db, campaign_id, request, authorization)
    chain = _chain(campaign_id)
    sr._paused_batches.discard(chain[0])
    owner = str(camp.created_by) if camp.created_by is not None else None
    sr.broadcast("info", "▶ Tiếp tục lô seeding.", owner=owner)
    return {"paused": False, "batch_id": chain[0]}


# ─────────────────────────────────────────────────────────────
# Tiến độ cả lô (từng bài × từng loại tương tác)
# ─────────────────────────────────────────────────────────────
def _empty_counts() -> Dict[str, int]:
    return {"total": 0, "success": 0, "failed": 0, "skipped": 0, "pending": 0}


@router.get("/campaigns/{campaign_id}/batch-progress")
def get_batch_progress(
    campaign_id: int,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Tiến độ của lô chứa chiến dịch này: tổng + từng bài (cảm xúc / bình luận / chia sẻ)."""
    _owned_campaign(db, campaign_id, request, authorization)
    chain = _chain(campaign_id)
    rows = db.execute(
        text(
            "SELECT campaign_id, action,"
            f" CASE WHEN status = 'FAILED' AND {_ALREADY_DONE_SQL} THEN 'SKIPPED' ELSE status END AS st,"
            " COUNT(*) AS n"
            " FROM seeding_tasks WHERE campaign_id = ANY(:ids)"
            " GROUP BY campaign_id, action, st"
        ),
        {"ids": chain},
    ).mappings().all()
    status_by_id = dict(db.query(SeedingCampaign.id, SeedingCampaign.status).filter(SeedingCampaign.id.in_(chain)).all())
    info_by_id = {
        r.campaign_id: (r.display_name, r.target_url)
        for r in db.query(
            SeedingCampaignTarget.campaign_id, SeedingCampaignTarget.display_name, SeedingCampaignTarget.target_url
        ).filter(SeedingCampaignTarget.campaign_id.in_(chain))
    }

    per: Dict[int, Dict[str, Dict[str, int]]] = {}
    totals = _empty_counts()
    for r in rows:
        bucket = per.setdefault(r["campaign_id"], {a: _empty_counts() for a in ACTIONS})
        counts = bucket.setdefault(r["action"], _empty_counts())
        key = {"SUCCESS": "success", "FAILED": "failed", "SKIPPED": "skipped"}.get(r["st"], "pending")
        n = int(r["n"])
        counts[key] += n
        counts["total"] += n
        totals[key] += n
        totals["total"] += n

    posts = []
    for cid in chain[:PROGRESS_POSTS]:
        name, url = info_by_id.get(cid, (None, None))
        actions = per.get(cid, {a: _empty_counts() for a in ACTIONS})
        posts.append({
            "campaign_id": cid,
            "name": name or f"Chiến dịch #{cid}",
            "url": url,
            "status": status_by_id.get(cid),
            "actions": actions,
        })
    batch = chain[0]
    start_at = sr._batch_start_at.get(batch)
    return {
        "batch_id": batch,
        "running": _batch_running(chain),
        "paused": batch in sr._paused_batches,
        "scheduled_at": start_at.isoformat() if start_at and start_at > vn_now() else None,
        "totals": totals,
        "post_count": len(chain),
        "posts": posts,
        "retryable": totals["failed"],
    }


# ─────────────────────────────────────────────────────────────
# Thử lại các lượt lỗi của lô
# ─────────────────────────────────────────────────────────────
@router.post("/campaigns/{campaign_id}/retry-failed")
def retry_failed_tasks(
    campaign_id: int,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Tạo lô mới chỉ gồm các lượt lỗi của lô cũ (bỏ lượt "đã làm từ trước" và lượt đã thành công ở lô khác).
    Trả về id lô mới — giao diện gọi /start như bình thường."""
    camp = _owned_campaign(db, campaign_id, request, authorization)
    chain = _chain(campaign_id)
    if _batch_running(chain):
        raise HTTPException(status_code=409, detail="Lô seeding vẫn đang chạy — chờ chạy xong rồi thử lại lượt lỗi.")
    running = sr._find_running_campaign(db, camp.created_by)
    if running:
        raise HTTPException(status_code=409, detail=sr._running_conflict_detail(running))
    if post_fetcher.running_job_id(camp.created_by):
        raise HTTPException(status_code=409, detail="Đang lấy bài viết từ page. Dừng lấy bài trước khi chạy seeding.")

    failed = (
        db.query(SeedingTask)
        .filter(
            SeedingTask.campaign_id.in_(chain),
            SeedingTask.status == "FAILED",
            SeedingTask.target_id.isnot(None),
            ~func.coalesce(SeedingTask.error_message, "").like("Tài khoản đã %rồi"),
        )
        .order_by(SeedingTask.id.asc())
        .all()
    )
    if not failed:
        raise HTTPException(status_code=400, detail="Không có lượt lỗi nào để thử lại.")

    target_ids = {t.target_id for t in failed}
    active = {
        (u, tid, a)
        for u, tid, a in db.query(SeedingTask.account_uid, SeedingTask.target_id, SeedingTask.action)
        .filter(SeedingTask.target_id.in_(target_ids), SeedingTask.status.in_(["PENDING", "RUNNING", "SUCCESS"]))
        .all()
    }
    by_target: Dict[int, List[SeedingTask]] = {}
    for t in failed:
        key = (t.account_uid, t.target_id, t.action)
        if key in active:
            continue
        active.add(key)   # 1 nick chỉ thử lại 1 lần / loại / bài
        by_target.setdefault(t.target_id, []).append(t)
    if not by_target:
        raise HTTPException(status_code=400, detail="Các lượt lỗi đều đã được làm lại thành công ở lô khác.")

    origin_by_id = {c.id: c for c in db.query(SeedingCampaign).filter(SeedingCampaign.id.in_(chain)).all()}
    new_ids: List[int] = []
    total = 0
    for target_id, tasks in by_target.items():
        origin = origin_by_id.get(tasks[0].campaign_id) or camp
        uids = {t.account_uid for t in tasks}
        new_camp = SeedingCampaign(
            campaign_type=origin.campaign_type,
            actions=origin.actions,
            reactions=origin.reactions,
            account_count=len(uids),
            delay_seconds_min=origin.delay_seconds_min,
            delay_seconds_max=origin.delay_seconds_max,
            status="PENDING",
            total_planned=len(uids),
            total_success=0,
            total_failed=0,
            created_by=origin.created_by,
            created_at=vn_now(),
        )
        db.add(new_camp)
        db.flush()
        ct = SeedingCampaignTarget(
            campaign_id=new_camp.id,
            target_id=target_id,
            display_name=tasks[0].display_name,
            target_url=tasks[0].target_url,
            source="RETRY",
            planned_count=len(uids),
            success_count=0,
            failed_count=0,
        )
        db.add(ct)
        db.flush()
        for t in tasks:
            db.add(SeedingTask(
                campaign_id=new_camp.id,
                campaign_target_id=ct.id,
                target_id=target_id,
                display_name=t.display_name,
                target_url=t.target_url,
                account_uid=t.account_uid,
                action=t.action,
                reaction=t.reaction,
                comment_id=t.comment_id,
                status="PENDING",
            ))
            total += 1
        new_ids.append(new_camp.id)
    db.commit()

    threads = sr._campaign_threads.get(chain[0], sr.DEFAULT_CHROME_THREADS)
    for cid in new_ids:
        sr._batch_campaign_chains[cid] = new_ids
        sr._campaign_threads[cid] = threads
    return {
        "id": new_ids[0],
        "campaign_ids": new_ids,
        "total_tasks": total,
        "total_targets": len(new_ids),
        "message": f"Đã tạo lô thử lại {total} lượt lỗi trên {len(new_ids)} bài.",
    }


# ─────────────────────────────────────────────────────────────
# Xem trước kế hoạch (không ghi gì vào DB)
# ─────────────────────────────────────────────────────────────
@router.post("/campaigns/preview")
def preview_seeding_plan(
    req: sr.CreateCampaignRequest,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Ai làm gì ở bài nào — cùng cách chia lượt với lúc tạo chiến dịch (số liệu ngẫu nhiên có thể khác lần chạy thật)."""
    user = sr.get_current_user_info(request, authorization)
    created_by_int = user["id"] if user and user.get("id") is not None else req.created_by
    camp_type = (req.campaign_type or "POST").upper()
    if camp_type != "POST":
        raise HTTPException(status_code=400, detail="Xem trước kế hoạch chỉ hỗ trợ Seeding Bài viết.")

    if req.use_saved_targets:
        if created_by_int is None:
            raise HTTPException(status_code=400, detail="Không xác định được người dùng.")
        rows = (
            sr._visible_targets_query(db, "POST", {"id": created_by_int, "role": "user"})
            .order_by(SeedingTarget.id.asc())
            .all()
        )
        targets = [(t.fb_id, t.url, t.display_name) for t in rows]
    else:
        targets = [(i.fb_id or sr.extract_fb_id(i.url, "POST"), i.url, i.display_name) for i in req.targets]
    if not targets:
        raise HTTPException(status_code=400, detail="Danh sách bài viết đang trống.")

    used_uids = sr._resolve_used_uids(db, req, created_by_int, user)
    acc_count = len(used_uids)
    post_actions = {a.upper().strip() for a in (req.actions or [])}
    if not post_actions:
        raise HTTPException(status_code=400, detail="Chưa chọn loại tương tác.")

    comment_texts: List[str] = []
    if "COMMENT" in post_actions:
        src = req.comments or sr.get_user_draft_comments(db, created_by_int)
        comment_texts = [t.strip() for t in src if t and t.strip()]
    share_groups = sr._split_share_accounts(used_uids, len(targets)) if "SHARE" in post_actions else []
    share_load = {u: 0 for u in used_uids}
    for g in share_groups:
        for u in g:
            share_load[u] += 1

    # Tác vụ đã có trên các bài (để biết nick nào "đã làm rồi")
    existing = db.query(SeedingTarget.id, SeedingTarget.fb_id).filter(
        SeedingTarget.target_type == "POST",
        SeedingTarget.fb_id.in_({fb for fb, _, _ in targets}),
        SeedingTarget.created_by == created_by_int,
    ).all()
    target_id_by_fb = {fb: tid for tid, fb in existing}
    active_by_target: Dict[int, set] = {}
    if target_id_by_fb:
        for u, tid, a in (
            db.query(SeedingTask.account_uid, SeedingTask.target_id, SeedingTask.action)
            .filter(SeedingTask.target_id.in_(set(target_id_by_fb.values())), SeedingTask.status.in_(["PENDING", "RUNNING", "SUCCESS"]))
            .all()
        ):
            active_by_target.setdefault(tid, set()).add((u, a))

    names = dict(db.query(Account.uid, Account.profile_name).filter(Account.uid.in_(used_uids)).all())
    totals = {"REACT": 0, "COMMENT": 0, "SHARE": 0, "SKIPPED": 0}
    posts = []
    for idx, (fb_id, url, display_name) in enumerate(targets):
        active = active_by_target.get(target_id_by_fb.get(fb_id), set())
        a = sr._post_assignment(
            idx=idx,
            used_uids=used_uids,
            post_actions=post_actions,
            target_active=active,
            comment_quota=max(1, acc_count // 2),
            share_groups=share_groups,
            share_load=share_load,
            reactions_pool=req.reactions or ["LIKE"],
            comment_texts=comment_texts,
        )
        skipped = [
            {"uid": u, "action": act}
            for act, uids in (("REACT", a["react"]), ("COMMENT", a["comment"]), ("SHARE", a["share"]))
            for u in sorted(uids) if (u, act) in active
        ]
        react = [{"uid": u, "name": names.get(u), "reaction": r} for u, r in a["reaction_by_uid"].items()]
        comment = [{"uid": u, "name": names.get(u), "text": t} for u, t in a["comment_by_uid"].items()]
        share = [{"uid": u, "name": names.get(u)} for u in sorted(a["share"]) if (u, "SHARE") not in active]
        totals["REACT"] += len(react)
        totals["COMMENT"] += len(comment)
        totals["SHARE"] += len(share)
        totals["SKIPPED"] += len(skipped)
        if idx < PREVIEW_POSTS:
            posts.append({
                "index": idx + 1,
                "name": display_name or f"Bài viết {fb_id}",
                "url": url,
                "react": react,
                "comment": comment,
                "share": share,
                "skipped": skipped,
            })
    return {
        "accounts": acc_count,
        "post_count": len(targets),
        "shown": len(posts),
        "totals": totals,
        "posts": posts,
    }


# ─────────────────────────────────────────────────────────────
# Mẫu cấu hình
# ─────────────────────────────────────────────────────────────
class TemplateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    campaign_type: str = "POST"
    config: Dict[str, Any] = Field(default_factory=dict)


def _template_out(t: SeedingTemplate) -> Dict[str, Any]:
    try:
        config = json.loads(t.config or "{}")
    except ValueError:
        config = {}
    return {"id": t.id, "name": t.name, "campaign_type": t.campaign_type, "config": config, "updated_at": sr.to_vn_iso(t.updated_at)}


def _require_user_id(request: Request, authorization: Optional[str]) -> int:
    user = sr.get_current_user_info(request, authorization)
    if not user or user.get("id") is None:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại.")
    return int(user["id"])


@router.get("/templates")
def list_seeding_templates(
    campaign_type: str = Query("POST"),
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    post_fetcher.init_post_fetch_schema()
    user_id = _require_user_id(request, authorization)
    rows = (
        db.query(SeedingTemplate)
        .filter(SeedingTemplate.created_by == user_id, SeedingTemplate.campaign_type == campaign_type.upper())
        .order_by(SeedingTemplate.updated_at.desc(), SeedingTemplate.id.desc())
        .all()
    )
    return {"items": [_template_out(t) for t in rows]}


@router.post("/templates")
def save_seeding_template(
    body: TemplateIn,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Lưu mẫu cấu hình; trùng tên thì ghi đè mẫu cũ."""
    post_fetcher.init_post_fetch_schema()
    user_id = _require_user_id(request, authorization)
    name = " ".join(body.name.split())[:120]
    if not name:
        raise HTTPException(status_code=422, detail="Tên mẫu không được để trống.")
    ctype = (body.campaign_type or "POST").upper()
    tpl = (
        db.query(SeedingTemplate)
        .filter(SeedingTemplate.created_by == user_id, SeedingTemplate.campaign_type == ctype, SeedingTemplate.name == name)
        .first()
    )
    payload = json.dumps(body.config, ensure_ascii=False)
    created = tpl is None
    if tpl is None:
        tpl = SeedingTemplate(created_by=user_id, campaign_type=ctype, name=name, config=payload)
        db.add(tpl)
    else:
        tpl.config = payload
        tpl.updated_at = vn_now()
    db.commit()
    db.refresh(tpl)
    return {"item": _template_out(tpl), "created": created}


@router.delete("/templates/{template_id}")
def delete_seeding_template(
    template_id: int,
    request: Request = None,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    post_fetcher.init_post_fetch_schema()
    user_id = _require_user_id(request, authorization)
    tpl = db.query(SeedingTemplate).filter(SeedingTemplate.id == template_id, SeedingTemplate.created_by == user_id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Không tìm thấy mẫu.")
    db.delete(tpl)
    db.commit()
    return {"deleted": True}
