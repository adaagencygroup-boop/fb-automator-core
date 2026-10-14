"""Loopback-only real Module 2 router; no production startup or external services."""
import tempfile
import os
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from ..api.router import router
from ..database.connection import get_db
from ..database.models import Account
from ..utils import paths


@asynccontextmanager
async def lifespan(app):
    with tempfile.TemporaryDirectory(prefix="module2-browser-", dir=os.getenv("MODULE2_DATA")) as root:
        old = paths.PROFILES_DIR
        paths.PROFILES_DIR = str(Path(root) / "profiles")
        engine = create_engine("sqlite:///" + str(Path(root) / "test.db"), connect_args={"check_same_thread": False})
        Account.__table__.create(engine)
        sessions = sessionmaker(bind=engine)
        with sessions() as db:
            for owner in ("alice", "bob"):
                db.add_all(Account(uid=str(1000+i), user_id=owner, profile_name=f"{owner} Name {i}", email=f"mail{i}@example.com") for i in range(37))
            db.commit()
        def database():
            with sessions() as db:
                yield db
        app.dependency_overrides[get_db] = database
        try:
            with patch("modules.module_02_account_manager.security.encryption.get_hwid", return_value="browser-test"):
                yield
        finally:
            app.dependency_overrides.clear()
            engine.dispose()
            paths.PROFILES_DIR = old


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:3012"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def identity(request, call_next):
    # Auth is mocked at the boundary; account handlers and owner scope are real.
    if request.url.path.startswith("/api/accounts"):
        request.scope["headers"] = [(k, v) for k, v in request.scope["headers"] if k.lower() not in (b"cookie", b"authorization", b"x-owner-username")] + [(b"x-owner-username", b"alice")]
    return await call_next(request)


@app.get("/api/v1/auth/me")
def me():
    return {"id": "alice", "username": "alice", "status": "active", "modules_unlocked": True}


@app.get("/api/health")
def health():
    return {"status": "ok"}


app.include_router(router)
