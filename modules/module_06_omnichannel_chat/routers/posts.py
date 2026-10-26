from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.schemas import PostCommentInput, PostLikeInput
from modules.module_06_omnichannel_chat.services.facebook_posts import (
    FacebookPostService,
    COMMENTS_PAGE_SIZE,
    REPLIES_PAGE_SIZE,
)
from modules.module_06_omnichannel_chat.services.facebook_auth import FacebookAPIError
from typing import Any, Dict, Optional

router = APIRouter(prefix="/api/facebook/posts", tags=["Posts"])

@router.get("/{post_id}")
async def get_post_details(
    post_id: str,
    page_id: str,
    order: Optional[str] = None,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Chi tiet bai viet. `order` la thu tu binh luan (chronological |
    reverse_chronological); gia tri la se bi service bo qua chu khong bao loi."""
    service = FacebookPostService(db)
    try:
        return await service.get_post_details(post_id, page_id, order=order)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except FacebookAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

@router.get("/{post_id}/comments")
async def list_post_comments(
    post_id: str,
    page_id: str,
    order: Optional[str] = None,
    after: Optional[str] = None,
    limit: Optional[int] = None,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Mot trang binh luan GOC cua bai viet, kem vai cau tra loi dau moi binh
    luan. `after` la con tro lay tu paging.cursors.after cua trang truoc."""
    service = FacebookPostService(db)
    try:
        return await service.get_comments(
            post_id,
            page_id,
            order=order,
            after=after,
            limit=limit if limit is not None else COMMENTS_PAGE_SIZE,
            nest_replies=REPLIES_PAGE_SIZE,
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except FacebookAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


@router.get("/{post_id}/reactions")
async def list_post_reactions(
    post_id: str,
    page_id: str,
    type: Optional[str] = None,
    after: Optional[str] = None,
    limit: Optional[int] = None,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Nguoi da tha cam xuc len bai viet, loc duoc theo `type`.

    Luu y: Facebook chi tra ve nhung nguoi ma app duoc phep nhin thay, nen
    `data` co the rong trong khi `summary.total_count` van co so that."""
    service = FacebookPostService(db)
    try:
        return await service.get_post_reactions(
            post_id, page_id, reaction_type=type, after=after,
            limit=limit if limit is not None else 100,
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except FacebookAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


@router.get("/{comment_id}/replies")
async def list_comment_replies(
    comment_id: str,
    page_id: str,
    after: Optional[str] = None,
    limit: Optional[int] = None,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Cau tra loi duoi mot binh luan. Dung filter=stream nen gop phang moi cap
    con, giong cach Facebook hien mot mach tra loi duoi binh luan goc."""
    service = FacebookPostService(db)
    try:
        return await service.get_comments(
            comment_id,
            page_id,
            after=after,
            limit=limit if limit is not None else COMMENTS_PAGE_SIZE,
            deep=True,
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except FacebookAPIError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


@router.post("/{post_id}/like")
async def set_post_like(
    post_id: str,
    payload: PostLikeInput,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Thich (liked=true) hoac bo thich (liked=false) bai viet duoi ten Page."""
    service = FacebookPostService(db)
    try:
        res = await service.set_post_like(post_id, payload.page_id, payload.liked)
        return {"success": True, "data": res}
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
