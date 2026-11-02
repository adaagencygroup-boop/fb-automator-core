"""Bcrypt + JWT, cùng quy ước token 365 ngày và fingerprint SHA-256 của repo nguồn."""
import hashlib
import os
from datetime import datetime, timedelta
from typing import Optional
from uuid import uuid4

import bcrypt
import jwt

TOKEN_EXPIRE_DAYS = 365
# Desktop + automation chạy dài: access 12h, refresh 180 ngày (tránh đá phiên giữa job).
ACCESS_TOKEN_MINUTES = 12 * 60
REFRESH_TOKEN_DAYS = 180
ALGORITHM = "HS256"


def secret_key() -> str:
    return os.environ.get("JWT_SECRET") or os.environ.get("SECRET_KEY") or "change-me-in-production-fb-automator"


def hash_password(password: str) -> str:
    pwd_bytes = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pwd_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        if not hashed:
            return False
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(days=TOKEN_EXPIRE_DAYS))
    to_encode.update({"exp": expire, "jti": str(uuid4())})
    return jwt.encode(to_encode, secret_key(), algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_DAYS)
    to_encode.update({"exp": expire, "jti": str(uuid4()), "typ": "refresh"})
    return jwt.encode(to_encode, secret_key(), algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, secret_key(), algorithms=[ALGORITHM])


def token_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
