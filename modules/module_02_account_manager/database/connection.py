"""Lazy database lifecycle owned by the accounts plugin."""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()
engine = None
SessionLocal = sessionmaker(autoflush=False, expire_on_commit=False)

def initialize(database_url=None):
    global engine
    if engine is not None:
        return engine
    url = database_url or os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not url or url.startswith("sqlite"):
        raise RuntimeError("Module tài khoản chỉ dùng PostgreSQL production. Không dùng SQLite local.")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    # Use the driver declared in requirements, independent of SQLAlchemy defaults.
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url[len("postgresql://"):]
    # Core/auth has a separate pool. SQLAlchemy's default 5 + 10 overflow
    # can consume all 15 Supabase session-pool connections by itself.
    kwargs = {"pool_pre_ping": True, "pool_size": 3, "max_overflow": 2, "pool_timeout": 10}
    candidate = create_engine(url, **kwargs)
    try:
        from .migrations import migrate
        migrate(candidate)
    except Exception:
        candidate.dispose()
        raise
    engine = candidate
    SessionLocal.configure(bind=engine)
    return engine

def init_db():
    return initialize()

def shutdown():
    global engine
    if engine is not None:
        engine.dispose()
        engine = None
        SessionLocal.configure(bind=None)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
