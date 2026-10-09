import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from config.constants import DATABASE_URL as GLOBAL_DB_URL, DB_PATH

# Ưu tiên lấy DATABASE_URL từ môi trường, nếu không lấy từ GLOBAL_DB_URL hoặc SQLite fallback
DATABASE_URL = os.getenv("DATABASE_URL", GLOBAL_DB_URL or f"sqlite:///{DB_PATH}")

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
elif DATABASE_URL.startswith("postgres://"):
    # Fix URL định dạng cũ postgres:// thành postgresql://
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine_kwargs = {
    "connect_args": connect_args,
    "pool_pre_ping": True
}

if not DATABASE_URL.startswith("sqlite"):
    engine_kwargs.update({
        "pool_size": 5,
        "max_overflow": 5,
        "pool_timeout": 20,
        "pool_recycle": 300
    })

engine = create_engine(
    DATABASE_URL,
    **engine_kwargs
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    """FastAPI Dependency để cấp phát DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
