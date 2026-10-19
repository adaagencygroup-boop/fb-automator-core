from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from modules.module_06_omnichannel_chat.models import Page, Account
from modules.module_06_omnichannel_chat.schemas import PageCreate

class PageRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_page_id(self, page_id: str) -> Optional[Page]:
        """Fetch page metadata directly from v_pages using Facebook's page_id."""
        return self.db.query(Page).filter(Page.page_id == str(page_id)).first()

    def get_pages_by_facebook_user_id(self, facebook_user_id: str) -> List[Page]:
        """Fetch all pages associated with a specific Facebook User ID."""
        return self.db.query(Page).filter(Page.facebook_user_id == facebook_user_id).all()

    def upsert_page(self, page_in: PageCreate) -> Page:
        """Implements an UPSERT mechanism based on page_id."""
        page = self.get_by_page_id(page_in.page_id)
        if page:
            page.page_name = page_in.page_name
            page.page_access_token = page_in.page_access_token
            page.facebook_user_id = page_in.facebook_user_id
            page.avatar_url = page_in.avatar_url
            page.status = page_in.status
        else:
            page = Page(
                page_id=page_in.page_id,
                page_name=page_in.page_name,
                page_access_token=page_in.page_access_token,
                facebook_user_id=page_in.facebook_user_id,
                avatar_url=page_in.avatar_url,
                status=page_in.status
            )
            self.db.add(page)
        
        self.db.commit()
        self.db.refresh(page)
        return page

    def upsert(self, page_in: PageCreate) -> Page:
        return self.upsert_page(page_in)
