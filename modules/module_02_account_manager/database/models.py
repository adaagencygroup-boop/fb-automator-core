"""
=============================================================================
MODULE 2: ACCOUNT MODEL & SCHEMA DESIGN
Định nghĩa bảng 'accounts' sử dụng SQLAlchemy ORM 2.0.
Kế thừa cấu trúc từ dự án tạo page Facebook (fb_accounts).
Tích hợp UniqueConstraint("user_id", "uid") phục vụ multi-tenant trên Supabase.
=============================================================================
"""
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, func, UniqueConstraint, ForeignKey, Index
)
from .connection import Base


class AccountCategory(Base):
    __tablename__ = "account_categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(100), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    color = Column(String(7), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


Index("uq_account_categories_owner_name", AccountCategory.user_id, func.lower(AccountCategory.name), unique=True,
      sqlite_where=AccountCategory.user_id.isnot(None), postgresql_where=AccountCategory.user_id.isnot(None))
Index("uq_account_categories_local_name", func.lower(AccountCategory.name), unique=True,
      sqlite_where=AccountCategory.user_id.is_(None), postgresql_where=AccountCategory.user_id.is_(None))


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "uid", name="uq_accounts_user_id_uid"),
        Index("ix_accounts_user_category", "user_id", "category_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    category_id = Column(Integer, ForeignKey("account_categories.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(String(100), nullable=True, index=True)         # ID người dùng sở hữu (lọc như NoSQL)
    uid = Column(String(50), nullable=False, index=True)             # UID Facebook (kết hợp với user_id tạo thành duy nhất)
    credential_encryption_version = Column(Integer, nullable=False, default=2, server_default="2")
    password = Column(Text, nullable=True)                    # Mật khẩu (AES-256 encrypted)
    two_fa = Column(Text, nullable=True)                      # 2FA Secret Key (AES-256 encrypted)
    cookie = Column(Text, nullable=True)                             # Cookie phiên đăng nhập
    token = Column(Text, nullable=True)                              # Access Token EAA...
    email = Column(String(150), nullable=True)                       # Email tài khoản
    pass_mail = Column(Text, nullable=True)                   # Mật khẩu Email (AES-256 encrypted)
    mail_recovery = Column(String(150), nullable=True)               # Email khôi phục
    token_hotmail = Column(Text, nullable=True)
    client_id = Column(String(100), nullable=True)
    proxy = Column(String(255), nullable=True)                       # Proxy dạng ip:port:user:pass
    profile_name = Column(String(150), nullable=True)                # Tên hiển thị Facebook
    avatar_url = Column(Text, nullable=True)
    profile_path = Column(String(255), nullable=True)                # Đường dẫn thư mục Chrome Profile
    status = Column(String(20), default="NEW", nullable=False)       # NEW, LIVE, DIE, CHECKPOINT
    login_status = Column(String(30), default="NOT_LOGGED", nullable=False) # NOT_LOGGED, LOGGED_IN, ERROR
    status_checked_at = Column(DateTime, nullable=True)              # Thời điểm check Live/Die gần nhất
    last_login_at = Column(DateTime, nullable=True)                  # Thời điểm đăng nhập Chrome gần nhất
    first_login_at = Column(DateTime, nullable=True)                 # Mốc bắt đầu nuôi, chỉ ghi một lần
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

