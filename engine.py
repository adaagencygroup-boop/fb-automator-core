"""
=============================================================================
LOCAL ENGINE (Python Sidecar) - Facebook Automator Pro
Chạy ngầm tại cổng 28129 cho ứng dụng Tauri Desktop
=============================================================================
"""
import sys
import os
import json
import argparse
import asyncio
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from core.startup import startup_step
from config.settings import settings
from config.constants import AccountStatus, LogLevel
from core.database.models import init_database
from core.database.connection import db
from core.facebook.fb_graph_client import fb_client
from core.ai.gemini_engine import ai_engine
from core.media.tiktok_scraper import tiktok_scraper
from core.media.youtube_scraper import youtube_scraper
from core.network.proxy_manager import proxy_manager
from modules.module_02_account_manager.api.router import router as account_router, alias_router as account_alias_router
from modules.module_02_account_manager import initialize as initialize_accounts, shutdown as shutdown_accounts
from modules import load_backend_modules
from modules.module_auth.schema import init_auth_tables
from modules.module_auth.service import ensure_admin
from modules.module_auth.router import auth_router, admin_router, assert_module_access

# Module 03 - Tab 1 (Tương tác tài khoản): lỗi import của module không được làm sập cả engine
try:
    from modules.module_03_acc_farm.routes import (
        router as farm_router,
        on_startup as farm_on_startup,
        on_shutdown as farm_on_shutdown,
    )
except Exception as _farm_import_error:
    farm_router = farm_on_startup = farm_on_shutdown = None
    print(f"[Local Engine] Module 03 (Farm) not loaded: {_farm_import_error}")

# Reconfigure stdout for safe Windows console output
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# WebSocket Connection Manager để push Real-time Logs lên Web UI
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast_log(self, module_name: str, level: str, message: str):
        payload = {
            "module": module_name,
            "level": level,
            "message": message,
            "timestamp": db.fetch_one("SELECT datetime('now', 'localtime') as t")["t"]
        }
        for connection in list(self.active_connections):
            try:
                await connection.send_json(payload)
            except Exception:
                self.disconnect(connection)

ws_manager = ConnectionManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    with startup_step("Core database and module schemas"):
        init_database()
    with startup_step("Authentication schema"):
        init_auth_tables()
    with startup_step("Admin account"):
        ensure_admin()
    with startup_step("Module 02 account manager"):
        initialize_accounts()
    with startup_step("Module 04 created pages"):
        from modules.module_04_page_creator.database import ensure_schema as ensure_creator_schema
        ensure_creator_schema()
    with startup_step("Module 05 page manager"):
        from modules.module_05_page_manager.models import init_models as init_page_models
        init_page_models()
    with startup_step("Backend module imports"):
        loaded = load_backend_modules()
    print(f"[Local Engine] PostgreSQL production ready. Loaded {len(loaded)} backend modules.")
    if farm_on_startup:
        try:
            with startup_step("Module 03 farm runtime"):
                await farm_on_startup(ws_manager)
        except Exception as e:
            print(f"[Local Engine] Module 03 (Farm) startup error: {e}")
    print("[Startup] Backend ready", flush=True)
    try:
        yield
    finally:
        await shutdown_accounts()
        if farm_on_shutdown:
            await farm_on_shutdown()
    print("[Local Engine] Shutting down cleanly...")

app = FastAPI(
    title="Facebook Automator Local Engine",
    version="2.0.0",
    lifespan=lifespan
)

app.include_router(auth_router)
app.include_router(admin_router)

_PUBLIC_API = {
    "/api/health",
    "/api/shutdown",
    "/api/v1/auth/hwid",
    "/api/v1/auth/register",
    "/api/v1/auth/verify-license",
    "/api/v1/auth/me",
    "/api/v1/admin/login",
}


class LicenseMiddleware:
    """ASGI thuần. Middleware HTTP của Starlette nuốt stream SSE và làm treo các request sau."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path") or ""
        method = scope.get("method") or ""
        if method != "OPTIONS" and path.startswith("/api/") and path not in _PUBLIC_API and not path.startswith("/api/v1/"):
            headers = {key.decode("latin1").lower(): value.decode("latin1") for key, value in scope.get("headers") or []}
            auth = headers.get("authorization")
            if not auth:
                # EventSource cannot send custom headers; prefer the user cookie there too.
                cookie_names = {part.strip().partition("=")[0] for part in headers.get("cookie", "").split(";")}
                access_cookie = "fb_user_access" if headers.get("x-auth-client") == "user" or "fb_user_access" in cookie_names else "fb_access"
                for part in headers.get("cookie", "").split(";"):
                    name, _, value = part.strip().partition("=")
                    if name == access_cookie and value:
                        auth = f"Bearer {value}"
                        break
            try:
                assert_module_access(auth)
            except HTTPException as exc:
                body = json.dumps({"detail": exc.detail}).encode()
                await send({
                    "type": "http.response.start",
                    "status": exc.status_code,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                })
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


app.add_middleware(LicenseMiddleware)


# Cho phép Web UI (localhost:3000, tauri://localhost) gọi API
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|tauri://localhost)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if farm_router:
    app.include_router(farm_router)

# ==================== SYSTEM & HEALTH CHECK ====================
@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "app": "Facebook Automator Pro",
        "version": "2.0.0",
        "port": 28129
    }


@app.get("/api/modules")
def list_modules():
    from modules import MODULE_REGISTRY
    return {"count": len(MODULE_REGISTRY), "modules": MODULE_REGISTRY}

@app.post("/api/shutdown")
def shutdown_engine():
    """Tauri gọi endpoint này khi tắt app để đảm bảo tắt sạch tiến trình"""
    def kill_soon():
        import time
        time.sleep(0.5)
        os._exit(0)
    import threading
    threading.Thread(target=kill_soon).start()
    return {"message": "Engine shutting down"}

# ==================== WEBSOCKET REALTIME LOGS ====================
@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            # Giữ kết nối mở
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)

@app.get("/api/logs")
def get_recent_logs(limit: int = 50):
    try:
        rows = db.fetch_all("SELECT * FROM activity_logs ORDER BY id DESC LIMIT ?", (limit,))
    except Exception:
        rows = []
    return {"logs": rows}

# ==================== MODULE 1: DASHBOARD ====================
@app.get("/api/dashboard/stats")
def get_dashboard_stats():
    try:
        acc_total = db.fetch_one("SELECT COUNT(*) as c FROM accounts")["c"]
        acc_live = db.fetch_one("SELECT COUNT(*) as c FROM accounts WHERE status = 'LIVE'")["c"]
        acc_die = db.fetch_one("SELECT COUNT(*) as c FROM accounts WHERE status = 'DIE'")["c"]
        pages_total = db.fetch_one("SELECT COUNT(*) as c FROM pages")["c"]
        posts_today = db.fetch_one("SELECT COUNT(*) as c FROM posting_history WHERE date(posted_at) = date('now')")["c"]
        proxies_active = db.fetch_one("SELECT COUNT(*) as c FROM proxies WHERE status = 'ACTIVE'")["c"]
        recent_posts = db.fetch_all("SELECT * FROM posting_history ORDER BY id DESC LIMIT 10")
        return {
            "accounts": {"total": acc_total, "live": acc_live, "die": acc_die},
            "pages_total": pages_total,
            "posts_today": posts_today,
            "proxies_active": proxies_active,
            "recent_activity": recent_posts
        }
    except Exception:
        # Fallback safe values khi DB Designer chua tao schema cac bang
        return {
            "accounts": {"total": 0, "live": 0, "die": 0},
            "pages_total": 0,
            "posts_today": 0,
            "proxies_active": 0,
            "recent_activity": []
        }

# ==================== MODULE 2: ACCOUNT MANAGER ====================
app.include_router(account_router)
app.include_router(account_alias_router)

from modules.module_04_page_creator.routes import router as creator_router
app.include_router(creator_router)

# ==================== MODULE 5: PAGE MANAGER & POSTING ====================
@app.get("/api/pages")
def get_pages():
    return {"pages": db.fetch_all("SELECT * FROM pages ORDER BY id DESC")}

class AddPageTokenRequest(BaseModel):
    user_token: str

@app.post("/api/pages/fetch-tokens")
async def fetch_pages_tokens(req: AddPageTokenRequest):
    try:
        pages = fb_client.fetch_managed_pages(req.user_token.strip())
        count = 0
        for p in pages:
            db.execute(
                """INSERT OR REPLACE INTO pages 
                (page_id, page_name, access_token, category, auto_ai_enabled, auto_reels_enabled, status)
                VALUES (?, ?, ?, ?, 1, 1, 'ACTIVE')""",
                (p["id"], p["name"], p["access_token"], p.get("category", ""))
            )
            count += 1
        await ws_manager.broadcast_log("PageManager", "SUCCESS", f"Đã đồng bộ {count} Fanpage từ User Token.")
        return {"success": True, "count": count}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ==================== MODULE 9: SETTINGS & PROXIES ====================
@app.get("/api/settings")
def get_settings():
    return {"config": settings.get_all()}

@app.get("/api/proxies")
def get_proxies():
    return {"proxies": db.fetch_all("SELECT * FROM proxies ORDER BY id DESC")}

@app.get("/api/keys")
def get_keys():
    return {"keys": db.fetch_all("SELECT id, service, status, usage_count, last_used FROM api_keys")}

# ==================== ENTRY POINT ====================
def main():
    parser = argparse.ArgumentParser(description="Facebook Automator Pro Local Engine")
    parser.add_argument("--port", type=int, default=28129, help="Port to run engine on (default: 28129)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host (default: 127.0.0.1)")
    args = parser.parse_args()

    print(f"[Local Engine] Starting on http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")

if __name__ == "__main__":
    main()
