"""
local_db.py (TẠM)
SQLite local lưu tài khoản Facebook cho Module 3 - Tab 1 (bê từ repo cũ).
Mật khẩu / 2FA / mật khẩu mail mã hóa AES-256 bằng khóa sinh từ HWID của máy.
Khi Module 02 (Quản lý tài khoản) hoàn thiện thì thay bằng nguồn tài khoản của Module 02 qua adapters.py.
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import Column, DateTime, Integer, String, Text, create_engine, event
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from modules.module_03_acc_farm.browser.paths import ACCOUNTS_DB_PATH

logger = logging.getLogger(__name__)

engine = create_engine(
    f"sqlite:///{ACCOUNTS_DB_PATH}",
    connect_args={
        "check_same_thread": False,
        "timeout": 30,  # Chờ 30 giây khi SQLite bị bận/khóa thay vì ném lỗi OperationalError
    },
    pool_pre_ping=True,
    echo=False,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class FbAccount(Base):
    __tablename__ = "fb_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_username = Column(String(100), nullable=True, index=True)
    uid = Column(String(50), nullable=False, index=True)
    password = Column(String(255), nullable=False)        # AES-256 encrypted
    two_fa = Column(String(100), nullable=True)           # AES-256 encrypted
    cookie = Column(Text, nullable=True)
    token = Column(Text, nullable=True)
    email = Column(String(150), nullable=True)
    pass_mail = Column(String(255), nullable=True)        # AES-256 encrypted
    mail_recovery = Column(String(150), nullable=True)
    token_hotmail = Column(Text, nullable=True)
    client_id = Column(String(100), nullable=True)
    proxy = Column(String(255), nullable=True)
    profile_name = Column(String(150), nullable=True)
    profile_path = Column(String(255), nullable=False)
    login_status = Column(String(30), default="not_logged_in")
    status = Column(String(10), nullable=True)
    status_checked_at = Column(DateTime, nullable=True)
    last_login_at = Column(DateTime, nullable=True)


def init_local_db():
    Base.metadata.create_all(bind=engine)
    logger.info(f"Module 03 local accounts DB initialized at: {ACCOUNTS_DB_PATH}")


class AccountRepo:
    """Repository cho bảng fb_accounts (local)."""

    @staticmethod
    def get_all(db: Session) -> List[FbAccount]:
        return db.query(FbAccount).order_by(FbAccount.id).all()

    @staticmethod
    def get_by_uid(db: Session, uid: str) -> Optional[FbAccount]:
        return db.query(FbAccount).filter(FbAccount.uid == str(uid)).first()

    @staticmethod
    def upsert(db: Session, data: dict) -> FbAccount:
        """Thêm mới hoặc cập nhật nếu UID đã tồn tại."""
        existing = db.query(FbAccount).filter(FbAccount.uid == data["uid"]).first()
        if existing:
            for key, value in data.items():
                if key == "login_status" and existing.login_status == "logged_in" and value == "not_logged_in":
                    continue
                setattr(existing, key, value)
            db.commit()
            db.refresh(existing)
            return existing
        account = FbAccount(**data)
        db.add(account)
        db.commit()
        db.refresh(account)
        return account

    @staticmethod
    def update_login_status(db: Session, uid: str, status: str, profile_name: str = None):
        account = db.query(FbAccount).filter(FbAccount.uid == str(uid)).first()
        if account:
            account.login_status = status
            if status == "logged_in":
                account.last_login_at = utc_now()
                account.status = "live"
                account.status_checked_at = utc_now()
            if profile_name:
                account.profile_name = profile_name
            db.commit()

    @staticmethod
    def update_cookies(db: Session, uid: str, cookie_str: str):
        """Lưu chuỗi cookie mới nhất đã trích xuất từ phiên đăng nhập thực tế của Chrome."""
        if not cookie_str or not cookie_str.strip():
            return
        account = db.query(FbAccount).filter(FbAccount.uid == str(uid)).first()
        if account:
            account.cookie = cookie_str.strip()
            db.commit()

    @staticmethod
    def update_profile_statuses(db: Session, statuses: dict):
        statuses = {uid: status for uid, status in statuses.items() if status in ("live", "die")}
        if not statuses:
            return
        for account in db.query(FbAccount).filter(FbAccount.uid.in_(statuses)).all():
            account.status = statuses[account.uid]
            account.status_checked_at = utc_now()
        db.commit()

    @staticmethod
    def delete(db: Session, uid: str) -> bool:
        account = db.query(FbAccount).filter(FbAccount.uid == str(uid)).first()
        if account:
            db.delete(account)
            db.commit()
            return True
        return False
