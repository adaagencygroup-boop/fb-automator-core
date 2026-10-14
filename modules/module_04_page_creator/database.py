"""Lịch sử page tạo bằng trình duyệt. Dùng chung engine PostgreSQL của Module 2."""
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import Column, DateTime, Integer, String, Text

from modules.module_02_account_manager.context import owner_context
from modules.module_02_account_manager.database.connection import Base, SessionLocal
from modules.module_02_account_manager.database.models import Account
from modules.module_02_account_manager.database.repository import AccountRepository as Repo

VN_TZ = timezone(timedelta(hours=7))


def to_vn_iso(dt):
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(VN_TZ).isoformat()


class CreatedPage(Base):
    __tablename__ = "created_pages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_username = Column(String(100), nullable=True, index=True)
    creator_fb_uid = Column(String(50), nullable=False)
    shared_admin_uid = Column(String(50), nullable=False, default="")
    page_name = Column(String(255), nullable=False)
    page_category = Column(String(100), nullable=True)
    page_url = Column(Text, nullable=True)
    status = Column(String(30), nullable=False)
    log_detail = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))


class CreatorSetting(Base):
    __tablename__ = "creator_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_username = Column(String(100), nullable=False, default="", index=True)
    key = Column(String(100), nullable=False)
    value = Column(Text, nullable=True)


_ADDITIVE_COLUMNS = {
    "created_pages": {
        "owner_username": "VARCHAR(100)",
        "creator_fb_uid": "VARCHAR(50)",
        "shared_admin_uid": "VARCHAR(50) DEFAULT ''",
        "page_name": "VARCHAR(255)",
        "page_category": "VARCHAR(100)",
        "page_url": "TEXT",
        "status": "VARCHAR(30)",
        "log_detail": "TEXT",
        "created_at": "TIMESTAMP",
    },
    "creator_settings": {
        "owner_username": "VARCHAR(100) DEFAULT ''",
        "key": "VARCHAR(100)",
        "value": "TEXT",
    },
}


def ensure_schema():
    """Tạo bảng nếu chưa có, rồi thêm cột còn thiếu. Không xóa dữ liệu cũ."""
    from sqlalchemy import inspect, text

    from modules.module_02_account_manager.database.connection import engine

    if engine is None:
        raise RuntimeError("Engine tài khoản chưa sẵn sàng")
    CreatedPage.__table__.create(bind=engine, checkfirst=True)
    CreatorSetting.__table__.create(bind=engine, checkfirst=True)
    inspector = inspect(engine)
    added = []
    with engine.begin() as conn:
        for table, columns in _ADDITIVE_COLUMNS.items():
            existing = {column["name"] for column in inspector.get_columns(table)}
            for name, kind in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {kind}"))
                    added.append(f"{table}.{name}")
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_created_pages_owner_username ON created_pages (owner_username)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_creator_settings_owner_username ON creator_settings (owner_username)"
        ))
    return added


class PageRepo:
    @staticmethod
    def get_all(db, owner_username=None):
        query = db.query(CreatedPage)
        if owner_username and str(owner_username).strip():
            owner = str(owner_username).strip()
            query = query.filter(
                (CreatedPage.owner_username == owner) | (CreatedPage.owner_username.is_(None))
            )
        return query.order_by(CreatedPage.created_at.desc()).all()

    @staticmethod
    def get_owned(db, page_id, owner_username=None):
        query = db.query(CreatedPage).filter(CreatedPage.id == page_id)
        if owner_username and str(owner_username).strip():
            owner = str(owner_username).strip()
            query = query.filter(
                (CreatedPage.owner_username == owner) | (CreatedPage.owner_username.is_(None))
            )
        return query.first()

    @staticmethod
    def delete_owned(db, page_id, owner_username=None):
        page = PageRepo.get_owned(db, page_id, owner_username)
        if not page:
            return False
        db.delete(page)
        db.commit()
        return True

    @staticmethod
    def create(db, data, owner_username=None):
        payload = dict(data)
        owner = (owner_username or payload.get("owner_username") or "").strip()
        if owner:
            payload["owner_username"] = owner
        payload.setdefault("shared_admin_uid", "")
        page = CreatedPage(**payload)
        db.add(page)
        db.commit()
        db.refresh(page)
        return page


def _setting_owner():
    return owner_context.get() or ""


class SettingRepo:
    @staticmethod
    def get(db, key):
        owner = _setting_owner()
        row = (
            db.query(CreatorSetting)
            .filter(CreatorSetting.owner_username == owner, CreatorSetting.key == key)
            .first()
        )
        if row and row.value:
            return row.value
        if key == "gemini_api_key":
            raw = os.getenv("GEMINI_API_KEYS") or os.getenv("GEMINI_API_KEY") or ""
            first = raw.split(",")[0].strip()
            return first or None
        if key == "gemini_model":
            return os.getenv("GEMINI_MODEL") or None
        return None

    @staticmethod
    def set(db, key, value):
        owner = _setting_owner()
        row = (
            db.query(CreatorSetting)
            .filter(CreatorSetting.owner_username == owner, CreatorSetting.key == key)
            .first()
        )
        if row:
            row.value = value
        else:
            db.add(CreatorSetting(owner_username=owner, key=key, value=value))
        db.commit()

    @staticmethod
    def get_all(db):
        owner = _setting_owner()
        rows = db.query(CreatorSetting).filter(CreatorSetting.owner_username == owner).all()
        return {row.key: row.value for row in rows}


class AccountRepo:
    """Bọc kho tài khoản Module 2 để worker tạo page không đụng luồng import."""

    @staticmethod
    def get_by_uid(db, uid, owner_username=None):
        if owner_username:
            return Repo.get_by_uid(db, uid, owner_username=owner_username)
        return db.query(Account).filter(Account.uid == str(uid).strip()).first()

    @staticmethod
    def _owner_of(db, uid, owner_username=None):
        if owner_username:
            return owner_username
        row = AccountRepo.get_by_uid(db, uid)
        if row is not None and row.user_id:
            return str(row.user_id)
        return None

    @staticmethod
    def update_login_status(db, uid, status, profile_name=None, owner_username=None):
        owner = AccountRepo._owner_of(db, uid, owner_username)
        if owner:
            return Repo.update_login_status(db, uid, status, profile_name, owner_username=owner)
        return Repo.update_login_status(db, uid, status, profile_name)

    @staticmethod
    def update_cookies(db, uid, cookie_str, owner_username=None):
        owner = AccountRepo._owner_of(db, uid, owner_username)
        if owner:
            return Repo.update_cookies(db, uid, cookie_str, owner_username=owner)
        return Repo.update_cookies(db, uid, cookie_str)
