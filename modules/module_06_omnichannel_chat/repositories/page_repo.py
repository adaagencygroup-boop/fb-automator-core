from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from modules.module_06_omnichannel_chat.models import Page, Account
from modules.module_06_omnichannel_chat.schemas import PageCreate

class PageRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_page_id(self, page_id: str) -> Optional[Page]:
        """Fetch page metadata directly from Module 5 'pages' table (fallback to 'v_pages')."""
        pid = str(page_id).strip()
        # 1. Ưu tiên lấy trực tiếp từ bảng pages của Module 5
        try:
            row = self.db.execute(
                text("""
                    SELECT id, page_id, page_name, access_token, account_uid, status
                    FROM pages
                    WHERE page_id = :p_id
                    LIMIT 1
                """),
                {"p_id": pid}
            ).mappings().first()
            if row and row.get("access_token"):
                return Page(
                    id=row["id"],
                    page_id=str(row["page_id"]),
                    page_name=row["page_name"],
                    page_access_token=row["access_token"],
                    facebook_user_id=str(row.get("account_uid") or ""),
                    avatar_url=f"https://graph.facebook.com/v19.0/{row['page_id']}/picture?type=large",
                    status=(row.get("status") or "active").lower()
                )
        except Exception as e:
            print(f"[PageRepo] Error querying Module 5 pages: {e}")

        # 2. Fallback sang v_pages nếu chưa có trong bảng pages
        return self.db.query(Page).filter(Page.page_id == pid).first()

    def get_pages_by_facebook_user_id(self, facebook_user_id: str) -> List[Page]:
        """Fetch all pages associated with a specific Facebook User ID from Module 5 pages table."""
        try:
            rows = self.db.execute(
                text("""
                    SELECT id, page_id, page_name, access_token, account_uid, status
                    FROM pages
                    WHERE account_uid = :fb_uid
                """),
                {"fb_uid": str(facebook_user_id)}
            ).mappings().all()
            if rows:
                return [
                    Page(
                        id=r["id"],
                        page_id=str(r["page_id"]),
                        page_name=r["page_name"],
                        page_access_token=r["access_token"],
                        facebook_user_id=str(r.get("account_uid") or ""),
                        avatar_url=f"https://graph.facebook.com/v19.0/{r['page_id']}/picture?type=large",
                        status=(r.get("status") or "active").lower()
                    )
                    for r in rows
                ]
        except Exception:
            pass
        return self.db.query(Page).filter(Page.facebook_user_id == str(facebook_user_id)).all()

    def upsert_page(self, page_in: PageCreate) -> Page:
        """Upsert page into Module 5 'pages' table as well as 'v_pages'."""
        # 1. Cập nhật hoặc thêm vào bảng pages của Module 5
        try:
            self.db.execute(
                text("""
                    INSERT INTO pages (page_id, page_name, access_token, account_uid, status, updated_at)
                    VALUES (:pid, :name, :token, :acc_uid, :status, CURRENT_TIMESTAMP)
                    ON CONFLICT (page_id) 
                    DO UPDATE SET 
                        page_name = EXCLUDED.page_name,
                        access_token = EXCLUDED.access_token,
                        account_uid = COALESCE(EXCLUDED.account_uid, pages.account_uid),
                        status = EXCLUDED.status,
                        updated_at = CURRENT_TIMESTAMP
                """),
                {
                    "pid": str(page_in.page_id),
                    "name": page_in.page_name,
                    "token": page_in.page_access_token,
                    "acc_uid": str(page_in.facebook_user_id or ""),
                    "status": (page_in.status or "active").upper(),
                }
            )
            self.db.commit()
        except Exception as e:
            self.db.rollback()
            print(f"[PageRepo] Error upserting to Module 5 pages: {e}")

        # 2. Đồng thời cập nhật v_pages để tương thích ngược
        page = self.db.query(Page).filter(Page.page_id == str(page_in.page_id)).first()
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
