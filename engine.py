"""
=============================================================================
LOCAL ENGINE (Python Sidecar) - Facebook Automator Pro
Chạy ngầm tại cổng 28129 cho ứng dụng Tauri Desktop
=============================================================================
"""

import argparse
import asyncio
import json
import os
import sys
from urllib.parse import unquote
from contextlib import asynccontextmanager

import anyio
import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request, Depends
from modules.module_02_account_manager.api.router import scoped_owner
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config.settings import settings
from config.constants import UPLOADS_DIR
from core.database.connection import db
from core.database.models import init_database
from core.facebook.fb_graph_client import fb_client
from core.ai.gemini_engine import ai_engine
from core.media.tiktok_scraper import tiktok_scraper
from core.media.youtube_scraper import youtube_scraper
from core.network.proxy_manager import proxy_manager
from modules.module_02_account_manager.api.router import router as account_router, alias_router as account_alias_router
from modules.module_07_group_spam.app.routes import router as group_router
from modules.module_10_group_scan.router import router as group_scan_router
from modules.module_02_account_manager import initialize as initialize_accounts, shutdown as shutdown_accounts
from core.startup import startup_step
from modules import load_backend_modules
from modules.module_02_account_manager import initialize as initialize_accounts
from modules.module_02_account_manager import shutdown as shutdown_accounts
from modules.module_02_account_manager.api.router import (
    alias_router as account_alias_router,
)
from modules.module_02_account_manager.api.router import router as account_router
from modules.module_08_interaction_seeding.routes import seeding_router
from modules.module_auth.router import admin_router, assert_request_module_access, auth_router
from modules.module_auth.schema import init_auth_tables
from modules.module_auth.service import ensure_admin

# Module 03 - Tab 1 (Tương tác tài khoản): lỗi import của module không được làm sập cả engine
try:
    from modules.module_03_acc_farm.routes import (
        on_shutdown as farm_on_shutdown,
    )
    from modules.module_03_acc_farm.routes import (
        on_startup as farm_on_startup,
    )
    from modules.module_03_acc_farm.routes import (
        router as farm_router,
    )
except Exception as _farm_import_error:
    farm_router = farm_on_startup = farm_on_shutdown = None
    print(f"[Local Engine] Module 03 (Farm) not loaded: {_farm_import_error}")

# Module 03 - Tab 2 (Đăng bài Facebook: Status, Reels, Story):
try:
    from modules.module_03_acc_farm.post_routes import (
        router as post_router,
    )
except Exception as _post_import_error:
    post_router = None
    print(f"[Local Engine] Module 03 (Post) not loaded: {_post_import_error}")

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
        self.active_connections: list[WebSocket] = []

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
            "timestamp": db.fetch_one("SELECT datetime('now', 'localtime') as t")["t"],
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
        from modules.module_04_page_creator.database import (
            ensure_schema as ensure_creator_schema,
        )

        ensure_creator_schema()
    with startup_step("Module 05 page manager"):
        from modules.module_05_page_manager.models import (
            init_models as init_page_models,
        )

        init_page_models()
    with startup_step("Module 07 group posting"):
        from modules.module_07_group_spam.app.models import init_models as init_group_models

        init_group_models()
    with startup_step("Module 10 group scan"):
        from modules.module_10_group_scan.models import init_models as init_group_scan_models

        init_group_scan_models()
    with startup_step("Module 11 page scanner"):
        from modules.module_11_page_scanner.models import (
            init_models as init_page_scanner_models,
        )

        init_page_scanner_models()
    with startup_step("Backend module imports"):
        loaded = load_backend_modules()
    print(
        f"[Local Engine] PostgreSQL production ready. Loaded {len(loaded)} backend modules."
    )
    try:
        from modules.module_06_omnichannel_chat.queue_worker import start_queue_worker
        from modules.module_06_omnichannel_chat.services.sync_service import watch_and_sync_webhook_loop
        asyncio.create_task(start_queue_worker())
        asyncio.create_task(watch_and_sync_webhook_loop())
    except Exception as qe:
        print(f"[Local Engine] Queue worker note: {qe}")
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
    title="Facebook Automator Local Engine", version="2.0.0", lifespan=lifespan
)

app.include_router(auth_router)
app.include_router(admin_router)

from modules.module_06_omnichannel_chat.routers import all_routers as module_06_routers
for r in module_06_routers:
    app.include_router(r)

from fastapi.staticfiles import StaticFiles
uploads_dir = str(UPLOADS_DIR)
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

_PUBLIC_API = {
    "/api/health",
    "/api/shutdown",
    "/api/v1/auth/hwid",
    "/api/v1/auth/register",
    "/api/v1/auth/verify-license",
    "/api/v1/auth/me",
    "/api/v1/admin/login",
    "/api/facebook/webhook",
    "/api/facebook/config",
    "/api/post/dialog/file",
    "/api/post/dialog/folder",
    "/api/groups/source/template",
    "/api/page-scanner/source/template",
    "/oauth/meta/callback",
    "/api/pages/web-oauth/callback-submit",
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
        if (
            method != "OPTIONS"
            and path.startswith("/api/")
            and path not in _PUBLIC_API
            and not path.startswith("/api/v1/")
            and not path.startswith("/api/post")
        ):
            headers = {
                key.decode("latin1").lower(): value.decode("latin1")
                for key, value in scope.get("headers") or []
            }
            auth = (headers.get("authorization") or "").strip()
            if not auth:
                cookie_header = headers.get("cookie") or ""
                cookie_names = {part.strip().partition("=")[0] for part in cookie_header.split(";")}
                access_cookie = (
                    "fb_user_access"
                    if headers.get("x-auth-client") == "user" or "fb_user_access" in cookie_names
                    else "fb_access"
                )
                token = ""
                for part in cookie_header.split(";"):
                    name, _, value = part.strip().partition("=")
                    if name == access_cookie and value:
                        token = unquote(value.strip().strip('"'))
                if token:
                    auth = f"Bearer {token}"
            try:
                # NEVER gọi DB sync trực tiếp trên event loop — sẽ treo cả Engine
                # (FE poll /me + check-status ~1.7s/lần lên Supabase → "Mất kết nối máy chủ").
                await anyio.to_thread.run_sync(assert_request_module_access, auth, path, method)
            except HTTPException as exc:
                body = json.dumps({"detail": exc.detail}).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": exc.status_code,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


app.add_middleware(LicenseMiddleware)


def _cors_extra_origins() -> list[str]:
    """Render/admin: CORS_ORIGINS=https://fb-automator-core-web-admin.onrender.com[,…]"""
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if not raw:
        return []
    return [part.strip().rstrip("/") for part in raw.split(",") if part.strip()]


# Local/Tauri + origin cloud từ env CORS_ORIGINS (web-admin trên Render)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_extra_origins(),
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?|tauri://localhost|asset://localhost)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if farm_router:
    app.include_router(farm_router)
if post_router:
    app.include_router(post_router)
@app.get("/api/health")
async def health_check():
    """async: không phụ thuộc threadpool — luôn trả lời được khi Engine còn sống."""
    return {
        "status": "online",
        "app": "Facebook Automator Pro",
        "version": "2.0.0",
        "port": 28129,
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
        rows = db.fetch_all(
            "SELECT * FROM activity_logs ORDER BY id DESC LIMIT ?", (limit,)
        )
    except Exception:
        rows = []
    return {"logs": rows}


# ==================== MODULE 1: DASHBOARD ====================
@app.get("/api/dashboard/stats", dependencies=[Depends(scoped_owner)])
def get_dashboard_stats():
    from modules.module_02_account_manager.context import owner_context
    owner = owner_context.get()
    if not owner:
        raise HTTPException(401, "Phiên đăng nhập không hợp lệ.")
    try:
        acc_total = db.fetch_one("SELECT COUNT(*) as c FROM accounts WHERE user_id = %s", (owner,))["c"]
        acc_live = db.fetch_one(
            "SELECT COUNT(*) as c FROM accounts WHERE status = 'LIVE' AND user_id = %s", (owner,)
        )["c"]
        acc_die = db.fetch_one(
            "SELECT COUNT(*) as c FROM accounts WHERE status = 'DIE' AND user_id = %s", (owner,)
        )["c"]
        pages_total = db.fetch_one("SELECT COUNT(*) as c FROM pages WHERE user_id = %s", (owner,))["c"]
        posts_today = db.fetch_one(
            "SELECT COUNT(*) as c FROM posting_history WHERE user_id = %s AND date(posted_at) = CURRENT_DATE", (owner,)
        )["c"]
        proxies_active = db.fetch_one(
            "SELECT COUNT(*) as c FROM proxies WHERE status = 'ACTIVE'"
        )["c"]
        recent_posts = db.fetch_all(
            "SELECT * FROM posting_history WHERE user_id = %s ORDER BY id DESC LIMIT 10", (owner,)
        )
        return {
            "accounts": {"total": acc_total, "live": acc_live, "die": acc_die},
            "pages_total": pages_total,
            "posts_today": posts_today,
            "proxies_active": proxies_active,
            "recent_activity": recent_posts,
        }
    except Exception:
        # Fallback safe values khi DB Designer chua tao schema cac bang
        return {
            "accounts": {"total": 0, "live": 0, "die": 0},
            "pages_total": 0,
            "posts_today": 0,
            "proxies_active": 0,
            "recent_activity": [],
        }


# ==================== MODULE 2: ACCOUNT MANAGER ====================
app.include_router(account_router)
app.include_router(account_alias_router)

# ==================== MODULE 7: GROUP POSTING ====================
app.include_router(group_router)

# ==================== MODULE 10: GROUP SCAN ====================
app.include_router(group_scan_router)

# ==================== MODULE 8: INTERACTION SEEDING ====================
app.include_router(seeding_router, prefix="/api")
from modules.module_04_page_creator.routes import router as creator_router

app.include_router(creator_router)


# ==================== MODULE 5: PAGE MANAGER & POSTING ====================
from modules.module_05_page_manager.routes_reels import router as reels_router
app.include_router(reels_router, prefix="/api")

from modules.module_05_page_manager.routes_download import router as download_router
app.include_router(download_router, prefix="/api")
from modules.module_05_page_manager.routes_pages import router as page_manager_router
app.include_router(page_manager_router, prefix="/api")
from modules.module_05_page_manager.routes_oauth_callback import router as oauth_callback_router
app.include_router(oauth_callback_router)
from modules.module_05_page_manager.routes import router as ai_post_router
app.include_router(ai_post_router)

@app.get("/api/pages", dependencies=[Depends(scoped_owner)])
def get_pages(request: Request):
    from modules.module_05_page_manager.routes_pages import get_managed_pages
    return get_managed_pages(request)


class AddPageTokenRequest(BaseModel):
    user_token: str
    account_uid: str


@app.post("/api/pages/fetch-tokens", status_code=202, dependencies=[Depends(scoped_owner)])
def fetch_pages_tokens(req: AddPageTokenRequest, request: Request):
    from modules.module_05_page_manager.routes_pages import start_sync, require_owner
    return start_sync(require_owner(request), req.account_uid.strip(), req.user_token.strip())


# ==================== MODULE 11: PAGE SCANNER ====================
from modules.module_11_page_scanner.api.router import router as page_scanner_router
app.include_router(page_scanner_router)



# ==================== MODULE 9: SETTINGS & PROXIES ====================
@app.get("/api/settings")
def get_settings():
    return {"config": settings.get_all()}


@app.get("/api/proxies")
def get_proxies():
    try:
        return {"proxies": db.fetch_all("SELECT * FROM proxies ORDER BY id DESC")}
    except Exception:
        return {"proxies": []}


@app.get("/api/keys")
def get_keys():
    try:
        return {
            "keys": db.fetch_all(
                "SELECT id, service, status, usage_count, last_used FROM api_keys"
            )
        }
    except Exception:
        return {"keys": []}


# ==================== ENTRY POINT ====================
def _crash_log(msg: str) -> None:
    """Ghi crash khi không còn console (windowed PyInstaller)."""
    try:
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        path = os.path.join(base, "FB_Page_Automator", "local_engine.crash.log")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except Exception:
        pass
    try:
        print(msg, file=sys.stderr)
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="Facebook Automator Pro Local Engine")
    parser.add_argument(
        "--port", type=int, default=28129, help="Port to run engine on (default: 28129)"
    )
    parser.add_argument(
        "--host", type=str, default="127.0.0.1", help="Host (default: 127.0.0.1)"
    )
    parser.add_argument(
        "--reload", action="store_true", help="Enable auto-reload on code change (development)"
    )
    args = parser.parse_args()

    print(f"[Local Engine] Starting on http://{args.host}:{args.port}")
    if args.reload:
        uvicorn.run("engine:app", host=args.host, port=args.port, reload=True, log_level="info")
    else:
        uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        import traceback

        _crash_log("[Local Engine] FATAL:\n" + traceback.format_exc())
        raise
