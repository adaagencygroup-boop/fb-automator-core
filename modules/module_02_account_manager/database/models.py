"""
=============================================================================
MODULE 2: ACCOUNT MODEL & SCHEMA DESIGN
Định nghĩa bảng 'accounts' sử dụng SQLAlchemy ORM 2.0.
Kế thừa cấu trúc từ dự án tạo page Facebook (fb_accounts).
Tích hợp UniqueConstraint("user_id", "uid") phục vụ multi-tenant trên Supabase.
=============================================================================
"""
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, func, UniqueConstraint
)
from .connection import Base


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "uid", name="uq_accounts_user_id_uid"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
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
    profile_path = Column(String(255), nullable=True)                # Đường dẫn thư mục Chrome Profile
    status = Column(String(20), default="NEW", nullable=False)       # NEW, LIVE, DIE, CHECKPOINT
    login_status = Column(String(30), default="NOT_LOGGED", nullable=False) # NOT_LOGGED, LOGGED_IN, ERROR
    status_checked_at = Column(DateTime, nullable=True)              # Thời điểm check Live/Die gần nhất
    last_login_at = Column(DateTime, nullable=True)                  # Thời điểm đăng nhập Chrome gần nhất
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

