"""Lazy database lifecycle owned by the accounts plugin."""
import os
import sys
from pathlib import Path
from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()
engine = None
SessionLocal = sessionmaker(autoflush=False, expire_on_commit=False)

def initialize(database_url=None):
    global engine
    if engine is not None:
        return engine
    url = database_url or os.getenv("SUPABASE_DB_URL") or os.getenv("DATABASE_URL")
    if not url:
        if os.getenv("FB_ACCOUNT_DATA_DIR") or getattr(sys, "frozen", False):
            try:
                from ..utils.paths import BASE_DIR
                path = Path(BASE_DIR) / "fb_automator.db"
            except (ImportError, ValueError):
                path = Path(__file__).resolve().parents[3] / "data" / "fb_automator.db"
        else:
            path = Path(__file__).resolve().parents[3] / "data" / "fb_automator.db"
        path.parent.mkdir(parents=True, exist_ok=True)
        url = "sqlite:///" + str(path)
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
        if url in ("sqlite://", "sqlite:///:memory:"):
            from sqlalchemy.pool import StaticPool
            kwargs["poolclass"] = StaticPool
    candidate = create_engine(url, **kwargs)
    if candidate.dialect.name == "sqlite":
        @event.listens_for(candidate, "connect")
        def pragmas(connection, _):
            cursor = connection.cursor()
            for sql in ("PRAGMA journal_mode=WAL", "PRAGMA busy_timeout=30000", "PRAGMA foreign_keys=ON"):
                cursor.execute(sql)
            cursor.close()
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
