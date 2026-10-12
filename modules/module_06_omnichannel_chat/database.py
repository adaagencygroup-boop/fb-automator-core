import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from config.constants import DATABASE_URL as GLOBAL_DB_URL

DATABASE_URL = os.getenv("DATABASE_URL", GLOBAL_DB_URL)
if not DATABASE_URL or DATABASE_URL.startswith("sqlite"):
    raise RuntimeError("Module chat chỉ dùng PostgreSQL production. Không dùng SQLite local.")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {}

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
