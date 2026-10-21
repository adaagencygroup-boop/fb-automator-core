from datetime import datetime, timedelta
from typing import Optional
import os
import jwt
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from modules.module_06_omnichannel_chat.database import get_db
from modules.module_06_omnichannel_chat.models import SystemUser

SECRET_KEY = os.environ.get("JWT_SECRET") or os.environ.get("SECRET_KEY") or os.environ.get("JWT_SECRET_KEY", "super-secret-omni-key-change-in-prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8")[:72], hashed_password.encode("utf-8"))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> SystemUser:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except Exception:
        raise credentials_exception

    user = None
    if str(user_id).isdigit():
        user = db.query(SystemUser).filter(SystemUser.id == int(user_id)).first()
    if not user:
        user = db.query(SystemUser).filter(SystemUser.email == str(user_id)).first()

    if user is None:
        raise credentials_exception
    return user

def get_current_active_user(current_user: SystemUser = Depends(get_current_user)) -> SystemUser:
    if current_user.status == "pending":
        raise HTTPException(status_code=403, detail="Account is pending approval by Admin.")
    if current_user.status == "suspended":
        raise HTTPException(status_code=403, detail="Account is suspended.")
    if current_user.role != "admin" and current_user.expires_at and current_user.expires_at < datetime.utcnow():
        raise HTTPException(status_code=403, detail="Account expired. Please contact Admin to renew.")
    return current_user

def get_current_admin_user(current_user: SystemUser = Depends(get_current_active_user)) -> SystemUser:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not enough privileges.")
    return current_user

def get_current_user_optional(token: Optional[str] = Depends(oauth2_scheme_optional), db: Session = Depends(get_db)) -> Optional[SystemUser]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            return None
        if str(user_id).isdigit():
            user = db.query(SystemUser).filter(SystemUser.id == int(user_id)).first()
            if user:
                return user
        return db.query(SystemUser).filter(SystemUser.email == str(user_id)).first()
    except Exception:
        return None
