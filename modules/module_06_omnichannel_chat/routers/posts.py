from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.schemas import PostCommentInput
from modules.module_06_omnichannel_chat.services.facebook_posts import FacebookPostService
from modules.module_06_omnichannel_chat.services.facebook_auth import FacebookAPIError
from typing import Any, Dict

router = APIRouter(prefix="/api/facebook/posts", tags=["Posts"])

@router.get("/{post_id}")
async def get_post_details(post_id: str, page_id: str, db: Session = Depends(get_db)) -> Dict[str, Any]:
    service = FacebookPostService(db)
    try:
        return await service.get_post_details(post_id, page_id)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except FacebookAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

@router.post("/{post_id}/comments")
async def create_post_comment(
    post_id: str,
    payload: PostCommentInput,
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """Tạo bình luận mới dưới tên Page vào bài viết."""
    service = FacebookPostService(db)
    try:
        res = await service.create_post_comment(
            post_id=post_id,
            page_id=payload.page_id,
            message=payload.message,
            attachment_url=payload.attachment_url
        )
        return {"success": True, "data": res}
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except FacebookAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")
