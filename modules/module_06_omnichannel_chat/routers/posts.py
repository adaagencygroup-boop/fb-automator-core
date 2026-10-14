from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from modules.module_06_omnichannel_chat.database import get_db
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
