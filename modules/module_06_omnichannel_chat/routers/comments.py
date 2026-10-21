from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.schemas import CommentReplyInput, CommentReactInput, CommentHideInput
from modules.module_06_omnichannel_chat.services import FacebookSyncService
from modules.module_06_omnichannel_chat.services.facebook_auth import FacebookAuthError, FacebookAPIError

router = APIRouter(prefix="/api/facebook", tags=["Comments"])

@router.post("/comments/{comment_id}/reply")
async def reply_comment(
    comment_id: str,
    payload: CommentReplyInput,
    db: Session = Depends(get_db)
):
    """Public reply to a Page comment."""
    sync_service = FacebookSyncService(db)
    try:
        res = await sync_service.reply_to_comment(
            comment_id=comment_id,
            page_id=payload.page_id,
            text=payload.text,
            attachment_url=payload.attachment_url
        )
        return {"success": True, "data": res}
    except (FacebookAuthError, FacebookAPIError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/comments/{comment_id}/private-reply")
async def private_reply_comment(
    comment_id: str,
    payload: CommentReplyInput,
    db: Session = Depends(get_db)
):
    """Private reply (Inbox) to a Page comment."""
    sync_service = FacebookSyncService(db)
    try:
        res = await sync_service.private_reply_to_comment(
            comment_id=comment_id,
            page_id=payload.page_id,
            text=payload.text,
            attachment_url=payload.attachment_url
        )
        return {"success": True, "data": res}
    except (FacebookAuthError, FacebookAPIError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/comments/{comment_id}/react")
async def react_comment(
    comment_id: str,
    payload: CommentReactInput,
    db: Session = Depends(get_db)
):
    """React to a Page comment."""
    sync_service = FacebookSyncService(db)
    try:
        res = await sync_service.react_to_comment(
            comment_id=comment_id,
            page_id=payload.page_id,
            reaction=payload.reaction
        )
        return {"success": True, "data": res}
    except (FacebookAuthError, FacebookAPIError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/comments/{comment_id}/hide")
async def hide_comment(
    comment_id: str,
    payload: CommentHideInput,
    db: Session = Depends(get_db)
):
    """Ẩn hoặc Hiện một bình luận trên Fanpage."""
    sync_service = FacebookSyncService(db)
    try:
        res = await sync_service.hide_comment(
            comment_id=comment_id,
            page_id=payload.page_id,
            is_hidden=payload.is_hidden
        )
        return {"success": True, "data": res}
    except (FacebookAuthError, FacebookAPIError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/comments/{comment_id}")
async def delete_comment(
    comment_id: str,
    page_id: str = Query(..., description="ID của Fanpage quản lý bài viết"),
    db: Session = Depends(get_db)
):
    """Xóa một bình luận trên Fanpage."""
    sync_service = FacebookSyncService(db)
    try:
        res = await sync_service.delete_comment(
            comment_id=comment_id,
            page_id=page_id
        )
        return {"success": True, "data": res}
    except (FacebookAuthError, FacebookAPIError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
