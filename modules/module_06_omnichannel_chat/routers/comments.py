from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.schemas import CommentReplyInput, CommentReactInput
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
