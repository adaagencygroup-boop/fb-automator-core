import os
import shutil
import time
import math
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import text, func, or_
from typing import List, Optional, Union
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.schemas import (
    MessageOut,
    SendReplyInput,
    ReactInput,
    TagUpdateInput,
    StarUpdateInput,
    SendAttachmentUrlInput,
    PaginatedConversationsOut,
)
from modules.module_06_omnichannel_chat.repositories import (
    MessageRepository,
    PageRepository,
    ConversationRepository,
    CustomerRepository,
)
from modules.module_06_omnichannel_chat.services import FacebookSyncService, FacebookAuthError, FacebookAPIError
from modules.module_06_omnichannel_chat.auth import get_current_user_optional
from modules.module_06_omnichannel_chat.routers.pages import resolve_current_user_id
from modules.module_06_omnichannel_chat.models import Message, Page, Account, SystemUser, Conversation, Customer

router = APIRouter(prefix="/api/facebook", tags=["Messages"])

from urllib.parse import quote

UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../uploads"))

# Facebook phai TAI DUOC file dinh kem tu Internet, nen URL gui cho Graph API phai la dia chi cong khai.
# Chay local thi dat PUBLIC_MEDIA_BASE_URL tro toi tunnel (ngrok/cloudflared) cua engine nay.
PUBLIC_MEDIA_BASE_URL = os.getenv("PUBLIC_MEDIA_BASE_URL", "https://phanmemchat.online").rstrip("/")

@router.get("/messages", response_model=List[MessageOut])
def get_messages(
    page_id: Optional[str] = None,
    facebook_user_id: Optional[str] = None,
    sender_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Message)
    if page_id:
        query = query.filter(Message.page_id == page_id)
    if sender_id:
        query = query.filter(Message.sender_id == sender_id)
    if facebook_user_id:
        query = query.join(Page, Page.page_id == Message.page_id).filter(Page.facebook_user_id == facebook_user_id)

    msgs = query.order_by(Message.created_at.asc()).all()
    return msgs

@router.get("/conversations", response_model=Union[PaginatedConversationsOut, List[dict]])
def get_conversations(
    request: Request,
    page_id: Optional[str] = None,
    facebook_user_id: Optional[str] = None,
    user_id: Optional[str] = None,
    page: Optional[int] = Query(None, ge=1, description="Số trang (1-indexed)"),
    page_size: Optional[int] = Query(None, ge=1, le=100, description="Số lượng cuộc hội thoại trên 1 trang"),
    limit: Optional[int] = Query(None, ge=1, le=100, description="Số lượng cuộc hội thoại cần lấy"),
    offset: Optional[int] = Query(None, ge=0, description="Vị trí bắt đầu"),
    search: Optional[str] = Query(None, description="Tìm kiếm theo tên khách, nội dung, hoặc PSID"),
    filter: Optional[str] = Query(None, description="Lọc: all, unread, replied, unreplied, starred"),
    sort: Optional[str] = Query("newest", description="Sắp xếp: newest hoặc oldest"),
    db: Session = Depends(get_db),
    current_user: Optional[SystemUser] = Depends(get_current_user_optional)
):
    logged_in_uid = (user_id or "").strip() or resolve_current_user_id(request, current_user)

    params = {}
    where_clauses = []

    if logged_in_uid:
        where_clauses.append("(CAST(a.user_id AS VARCHAR) = :user_id OR CAST(va.system_user_id AS VARCHAR) = :user_id)")
        params["user_id"] = str(logged_in_uid)

    if facebook_user_id:
        where_clauses.append("p.facebook_user_id = :fb_uid")
        params["fb_uid"] = str(facebook_user_id)

    if page_id:
        where_clauses.append("p.page_id = :page_id")
        params["page_id"] = str(page_id)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    sql = text(f"""
        SELECT DISTINCT p.page_id, p.page_name, p.facebook_user_id
        FROM v_pages p
        LEFT JOIN v_accounts va ON p.facebook_user_id = va.facebook_user_id
        LEFT JOIN accounts a ON (
            p.facebook_user_id = a.uid 
            OR va.user_access_token = a.token
            OR va.facebook_user_id = a.uid
            OR (va.name IS NOT NULL AND va.name != '' AND va.name = a.profile_name)
        )
        {where_sql}
    """)
    page_rows = db.execute(sql, params).mappings().all()
    page_dict = {str(r["page_id"]): r["page_name"] for r in page_rows}
    page_ids = list(page_dict.keys())

    p_page = page if isinstance(page, int) else None
    p_size = page_size if isinstance(page_size, int) else None
    p_limit = limit if isinstance(limit, int) else None
    p_offset = offset if isinstance(offset, int) else None
    s_query = search.strip().lower() if isinstance(search, str) else ""
    s_filter = filter.strip().lower() if isinstance(filter, str) else ""
    s_sort = sort.strip().lower() if isinstance(sort, str) else "newest"

    is_paginated = p_page is not None or p_limit is not None or p_offset is not None or p_size is not None
    effective_page_size = p_size or p_limit or 20
    effective_page = p_page or ((p_offset // effective_page_size) + 1 if p_offset is not None else 1)
    effective_offset = p_offset if p_offset is not None else (effective_page - 1) * effective_page_size

    if not page_ids:
        if is_paginated:
            return PaginatedConversationsOut(items=[], conversations=[], total=0, page=1, page_size=effective_page_size, total_pages=0)
        return []

    # Priority 1: Check fast indexed v_conversations table
    query = db.query(Conversation).filter(Conversation.page_id.in_(page_ids))

    if s_query:
        s = f"%{s_query}%"
        query = query.filter(
            or_(
                func.lower(Conversation.customer_name).like(s),
                Conversation.customer_psid.like(s),
                func.lower(Conversation.last_message).like(s)
            )
        )

    if s_filter == "unread":
        query = query.filter(Conversation.is_read == False)
    elif s_filter == "starred":
        query = query.filter(Conversation.is_starred == True)
    elif s_filter == "replied":
        query = query.filter(Conversation.is_replied == True)
    elif s_filter == "unreplied":
        query = query.filter(Conversation.is_replied == False)

    total_convs = query.count()
    if total_convs > 0 or not s_query:
        if s_sort == "oldest":
            query = query.order_by(Conversation.last_message_at.asc())
        else:
            query = query.order_by(Conversation.last_message_at.desc())

        if is_paginated:
            db_convs = query.offset(effective_offset).limit(effective_page_size).all()
            total_pages = math.ceil(total_convs / effective_page_size) if effective_page_size else 1
        else:
            db_convs = query.all()
            total_pages = 1

        results = []
        for c in db_convs:
            p_name = page_dict.get(str(c.page_id)) or "Trang Facebook"
            latest_msg = c.last_message
            latest_time = c.last_message_at
            is_replied = c.is_replied
            direction = "outbound" if is_replied else "inbound"

            # Cross-check với v_messages để đảm bảo luôn lấy đúng tin nhắn mới nhất
            latest_db_msg = db.query(Message.text, Message.created_at, Message.direction)\
                .filter(Message.page_id == c.page_id, Message.sender_id == c.customer_psid)\
                .order_by(Message.created_at.desc(), Message.id.desc())\
                .first()

            if latest_db_msg:
                latest_msg = latest_db_msg.text
                latest_time = latest_db_msg.created_at
                direction = latest_db_msg.direction or ("outbound" if is_replied else "inbound")
                is_replied = (direction == "outbound")
                if c.last_message != latest_msg or c.is_replied != is_replied:
                    c.last_message = latest_msg
                    c.last_message_at = latest_time
                    c.is_replied = is_replied
                    try:
                        db.commit()
                    except Exception:
                        db.rollback()

            results.append({
                "page_id": c.page_id,
                "page_name": p_name,
                "avatar_url": c.customer_avatar or f"https://graph.facebook.com/v19.0/{c.page_id}/picture?type=large",
                "sender_id": c.customer_psid,
                "customer_name": c.customer_name or f"Khách hàng {c.customer_psid[:8]}",
                "last_message": latest_msg,
                "timestamp": int(latest_time.timestamp() * 1000) if latest_time else 0,
                "direction": direction,
                "is_read": c.is_read,
                "is_replied": is_replied,
                "is_starred": c.is_starred,
                "tags": c.tags or "",
                "created_at": latest_time.isoformat() if latest_time else ""
            })

        if is_paginated:
            return PaginatedConversationsOut(
                items=results,
                conversations=results,
                total=total_convs,
                page=effective_page,
                page_size=effective_page_size,
                total_pages=total_pages
            )
        return results

    # Priority 2: Fallback to messages table
    all_messages = db.query(Message)\
        .filter(Message.page_id.in_(page_ids))\
        .order_by(Message.timestamp.desc(), Message.created_at.desc())\
        .all()

    conv_map = {}
    for msg in all_messages:
        key = f"{msg.page_id}_{msg.sender_id}"
        if key not in conv_map:
            p_name = page_dict.get(str(msg.page_id)) or "Trang Facebook"
            conv_map[key] = {
                "page_id": msg.page_id,
                "page_name": p_name,
                "avatar_url": f"https://graph.facebook.com/v19.0/{msg.page_id}/picture?type=large",
                "sender_id": msg.sender_id,
                "customer_name": f"Khách hàng {msg.sender_id[:8]}",
                "last_message": msg.text,
                "timestamp": msg.timestamp,
                "direction": msg.direction,
                "is_read": msg.is_read,
                "is_replied": True if msg.direction == "outbound" else False,
                "is_starred": False,
                "tags": "",
                "created_at": msg.created_at.isoformat()
            }
        else:
            if not msg.is_read:
                conv_map[key]["is_read"] = False
            if msg.direction == "outbound":
                conv_map[key]["is_replied"] = True

    sorted_convs = sorted(list(conv_map.values()), key=lambda c: c["timestamp"] or 0, reverse=(sort != "oldest"))
    total_convs = len(sorted_convs)

    if is_paginated:
        sliced = sorted_convs[effective_offset : effective_offset + effective_page_size]
        total_pages = math.ceil(total_convs / effective_page_size) if effective_page_size else 1
        return PaginatedConversationsOut(
            items=sliced,
            conversations=sliced,
            total=total_convs,
            page=effective_page,
            page_size=effective_page_size,
            total_pages=total_pages
        )

    return sorted_convs

@router.put("/conversations/{page_id}/{sender_id}/read")
def mark_conversation_read(
    page_id: str,
    sender_id: str,
    db: Session = Depends(get_db)
):
    unread_msgs = db.query(Message).filter(
        Message.page_id == page_id,
        Message.sender_id == sender_id,
        Message.is_read == False
    ).all()
    for msg in unread_msgs:
        msg.is_read = True

    conv = db.query(Conversation).filter(
        Conversation.page_id == page_id,
        Conversation.customer_psid == sender_id
    ).first()
    if conv:
        conv.is_read = True

    db.commit()
    return {"success": True, "message": "Marked as read"}

@router.post("/conversations/tag")
def update_conversation_tags(
    payload: TagUpdateInput,
    db: Session = Depends(get_db)
):
    """Cập nhật nhãn phân loại hội thoại và thông tin khách hàng."""
    conv_repo = ConversationRepository(db)
    cust_repo = CustomerRepository(db)
    conv = conv_repo.update_tags(payload.page_id, payload.customer_psid, payload.tags)
    cust = cust_repo.update_tags(payload.customer_psid, payload.tags)
    return {"success": True, "tags": payload.tags, "updated": bool(conv or cust)}

@router.post("/conversations/star")
def toggle_conversation_star(
    payload: StarUpdateInput,
    db: Session = Depends(get_db)
):
    """Bật/tắt đánh dấu sao hội thoại quan trọng."""
    conv_repo = ConversationRepository(db)
    conv = conv_repo.toggle_star(payload.page_id, payload.customer_psid, payload.is_starred)
    return {"success": True, "is_starred": payload.is_starred, "updated": bool(conv)}

@router.post("/send-reply")
async def send_reply(
    payload: SendReplyInput,
    db: Session = Depends(get_db)
):
    sync_service = FacebookSyncService(db)
    try:
        res = await sync_service.send_message_reply(
            page_id=payload.page_id,
            recipient_id=payload.recipient_id,
            text=payload.text,
            reply_to_message_id=payload.reply_to_message_id
        )
        return {"success": True, "data": res}
    except FacebookAuthError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except FacebookAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/send-attachment")
async def send_attachment_file(
    page_id: str = Form(...),
    recipient_id: str = Form(...),
    attachment_type: str = Form(...),
    reply_to_message_id: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    sync_service = FacebookSyncService(db)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{int(time.time())}_{file.filename}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    local_file_url = f"/uploads/{quote(filename)}"  # ten file co dau cach/ngoac -> phai encode
    public_url = f"{PUBLIC_MEDIA_BASE_URL}{local_file_url}"

    try:
        res = await sync_service.send_attachment_by_url(
            page_id=page_id,
            recipient_id=recipient_id,
            attachment_type=attachment_type,
            url_link=public_url,
            reply_to_message_id=reply_to_message_id
        )
        return {"success": True, "data": res, "url": public_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/upload-media")
async def upload_media(
    file: UploadFile = File(...)
):
    """Generic endpoint to upload a media file and get a public URL."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{int(time.time())}_{file.filename}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    local_file_url = f"/uploads/{quote(filename)}"  # ten file co dau cach/ngoac -> phai encode
    public_url = f"{PUBLIC_MEDIA_BASE_URL}{local_file_url}"

    return {"success": True, "url": public_url}

@router.post("/send-attachment-url")
async def send_attachment_url(
    page_id: str = Form(...),
    recipient_id: str = Form(...),
    attachment_type: str = Form(...),
    url: str = Form(...),
    reply_to_message_id: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    sync_service = FacebookSyncService(db)
    try:
        res = await sync_service.send_attachment_by_url(
            page_id=page_id,
            recipient_id=recipient_id,
            attachment_type=attachment_type,
            url_link=url,
            reply_to_message_id=reply_to_message_id
        )
        return {"success": True, "data": res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/messages/{message_id}/react")
async def react_message(
    message_id: str,
    payload: ReactInput,
    db: Session = Depends(get_db)
):
    sync_service = FacebookSyncService(db)
    try:
        res = await sync_service.react_to_message(
            page_id=payload.page_id,
            recipient_id=payload.recipient_id,
            message_id=message_id,
            reaction=payload.reaction
        )
        return {"success": True, "data": res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/messages/{message_id}")
async def unsend_message(
    message_id: str,
    page_id: str,
    db: Session = Depends(get_db)
):
    sync_service = FacebookSyncService(db)
    success = await sync_service.delete_message(page_id, message_id)
    if success:
        return {"success": True, "message": "Message deleted locally"}
    raise HTTPException(status_code=404, detail="Message not found")
