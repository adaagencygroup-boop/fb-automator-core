import argparse
import asyncio
import json
import os
import sys
import threading
from urllib.parse import unquote
from contextlib import asynccontextmanager
sys.modules["simplejson"] = json
import anyio
import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request, Depends
from modules.module_02_account_manager.api.router import scoped_owner
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from config.settings import settings
from config.constants import UPLOADS_DIR
from core.database.connection import db
from core.database.models import init_core_tables, init_database
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
  print(f"[Local Engine] Module 03 (Farm) Not Loaded: {_farm_import_error}")
try:
  from modules.module_03_acc_farm.post_routes import (
    router as post_router,
  )
except Exception as _post_import_error:
  post_router = None
  print(f"[Local Engine] Module 03 (Post) Not Loaded: {_post_import_error}")
if hasattr(sys.stdout, "reconfigure"):
  try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
  except Exception:
    pass
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
def _warm_auth_hwid():
  try:
    from modules.module_auth.hwid import get_hwid
    get_hwid()
    print("[Startup] HWID Cache Ready", flush=True)
  except Exception as exc:
    print(f"[Local Engine] HWID Warmup Note: {exc}", flush=True)
threading.Thread(target=_warm_auth_hwid, name="hwid-warm", daemon=True).start()
def _init_remaining_schemas():
  with startup_step("Core Database And Module Schemas"):
    init_database()
  with startup_step("Module 02 Account Manager"):
    initialize_accounts()
  with startup_step("Module 08 Seeding Post Fetch"):
    from modules.module_08_interaction_seeding.automation.post_fetcher import (
      init_post_fetch_schema,
    )
    try:
      init_post_fetch_schema()
    except Exception as exc:
      # Không chặn khởi động: API lấy bài sẽ tạo bảng lại ở lần gọi đầu
      print(f"[Module 08] Bỏ qua tạo bảng lấy bài lúc khởi động: {exc}", flush=True)
  with startup_step("Module 04 Created Pages"):
    from modules.module_04_page_creator.database import (
      ensure_schema as ensure_creator_schema,
    )
    ensure_creator_schema()
  with startup_step("Module 05 Page Manager"):
    from modules.module_05_page_manager.models import (
      init_models as init_page_models,
    )
    init_page_models()
  with startup_step("Module 06 Omnichannel Chat"):
    from modules.module_06_omnichannel_chat.database import (
      init_models as init_chat_models,
    )
    init_chat_models()
  with startup_step("Module 07 Group Posting"):
    from modules.module_07_group_spam.app.models import init_models as init_group_models
    init_group_models()
  with startup_step("Module 10 Group Scan"):
    from modules.module_10_group_scan.models import init_models as init_group_scan_models
    init_group_scan_models()
  with startup_step("Module 11 Page Scanner"):
    from modules.module_11_page_scanner.models import (
      init_models as init_page_scanner_models,
    )
    init_page_scanner_models()
  with startup_step("Module 12 Post Engagement"):
    from modules.module_12_post_engagement.models import init_models as init_post_engagement_models
    init_post_engagement_models()
  with startup_step("Module 13 Profile Scan"):
    from modules.module_13_profile_scan.models import (
      init_models as init_profile_scan_models,
    )
    init_profile_scan_models()
async def _finish_engine_startup(fast_startup: bool):
  if not fast_startup:
    await asyncio.to_thread(_init_remaining_schemas)
  else:
    await asyncio.to_thread(initialize_accounts)
  with startup_step("Backend Module Imports"):
    loaded = load_backend_modules()
  print(
    f"[Local Engine] PostgreSQL Production Ready. Loaded {len(loaded)} Backend Modules"
  )
  try:
    from modules.module_06_omnichannel_chat.queue_worker import start_queue_worker
    from modules.module_06_omnichannel_chat.services.sync_service import watch_and_sync_webhook_loop
    asyncio.create_task(start_queue_worker())
    asyncio.create_task(watch_and_sync_webhook_loop())
  except Exception as qe:
    print(f"[Local Engine] Queue Worker Note: {qe}")
  if farm_on_startup:
    try:
      with startup_step("Module 03 Farm Runtime"):
        await farm_on_startup(ws_manager)
    except Exception as e:
      print(f"[Local Engine] Module 03 (Farm) Startup Error: {e}")
  try:
    from modules.module_02_account_manager.services.events import register_ws_log_channel
    register_ws_log_channel(ws_manager, asyncio.get_running_loop())
  except Exception as e:
    print(f"[Local Engine] Account WS Log Channel Note: {e}")
  print("[Startup] Backend Ready", flush=True)
@asynccontextmanager
async def lifespan(app: FastAPI):
  fast_startup = os.environ.get("FB_FAST_STARTUP", "").strip().lower() in {"1", "true", "yes"}
  deferred = None
  if fast_startup:
    print("[Startup] Fast Mode Enabled (FB_FAST_STARTUP=1): Skipping Remote DB Schema Checks")
    await _finish_engine_startup(True)
  else:
    with startup_step("Core Tables"):
      await asyncio.to_thread(init_core_tables)
    with startup_step("Authentication Schema"):
      await asyncio.to_thread(init_auth_tables)
    with startup_step("Admin Account"):
      await asyncio.to_thread(ensure_admin)
    print("[Startup] Auth Ready — Accepting Login/HWID", flush=True)
    deferred = asyncio.create_task(_finish_engine_startup(False))
  try:
    yield
  finally:
    if deferred and not deferred.done():
      deferred.cancel()
      try:
        await deferred
      except asyncio.CancelledError:
        pass
    await shutdown_accounts()
    if farm_on_shutdown:
      await farm_on_shutdown()
  print("[Local Engine] Shutting Down Cleanly!")
app = FastAPI(
  title="Facebook Automator Local Engine", version="2.0.0", lifespan=lifespan
)
app.include_router(auth_router)
app.include_router(admin_router)
from modules.module_06_omnichannel_chat.routers import all_routers as module_06_routers
for r in module_06_routers:
  app.include_router(r)
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
uploads_dir = str(UPLOADS_DIR)
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")
@app.get("/media/{bucket}/{object_path:path}")
async def serve_stored_object(bucket: str, object_path: str):
  from core.storage.postgres_objects import read_object
  found = await anyio.to_thread.run_sync(read_object, bucket, unquote(object_path))
  if not found or not found.get("data"):
    raise HTTPException(status_code=404, detail="Không Có File")
  return Response(content=found["data"], media_type=found["content_type"] or "application/octet-stream")
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
  "/api/pages/select-folder",
  "/api/pages/reels/select-folder",
  "/api/groups/source/template",
  "/api/page-scanner/source/template",
  "/oauth/meta/callback",
  "/api/pages/web-oauth/callback-submit",
}
class LicenseMiddleware:
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
  raw = os.environ.get("CORS_ORIGINS", "").strip()
  if not raw:
    return []
  return [part.strip().rstrip("/") for part in raw.split(",") if part.strip()]
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
try:
  from prometheus_fastapi_instrumentator import Instrumentator
  Instrumentator(should_group_status_codes=False).instrument(app).expose(
    app, endpoint="/metrics", include_in_schema=False
  )
except ImportError:
  pass
@app.get("/api/health")
async def health_check():
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
  def kill_soon():
    import time
    time.sleep(0.5)
    os._exit(0)
  import threading
  threading.Thread(target=kill_soon).start()
  return {"message": "Engine Shutting Down"}
@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
  await ws_manager.connect(websocket)
  try:
    while True:
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
@app.get("/api/dashboard/stats", dependencies=[Depends(scoped_owner)])
def get_dashboard_stats():
  from modules.module_02_account_manager.context import owner_context
  owner = owner_context.get()
  if not owner:
    raise HTTPException(401, "Phiên Đăng Nhập Không Hợp Lệ!")
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
    return {
      "accounts": {"total": 0, "live": 0, "die": 0},
      "pages_total": 0,
      "posts_today": 0,
      "proxies_active": 0,
      "recent_activity": [],
    }
app.include_router(account_router)
app.include_router(account_alias_router)
app.include_router(group_router)
app.include_router(group_scan_router)
app.include_router(seeding_router, prefix="/api")
from modules.module_04_page_creator.routes import router as creator_router
app.include_router(creator_router)
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
from modules.module_11_page_scanner.api.router import router as page_scanner_router
app.include_router(page_scanner_router)
from modules.module_12_post_engagement.router import router as post_engagement_router
app.include_router(post_engagement_router)
from modules.module_13_profile_scan.api.router import router as profile_scan_router
app.include_router(profile_scan_router)
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
def _crash_log(msg: str) -> None:
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
    "--port", type=int, default=28129, help="Port To Run Engine On (Default: 28129)"
  )
  parser.add_argument(
    "--host", type=str, default="127.0.0.1", help="Host (Default: 127.0.0.1)"
  )
  parser.add_argument(
    "--reload", action="store_true", help="Enable Auto-Reload On Code Change (Development)"
  )
  parser.add_argument(
    "--fast", action="store_true", help="Skip Remote DB Schema Checks On Startup (Fast Dev Restart)"
  )
  args = parser.parse_args()
  if args.fast:
    os.environ["FB_FAST_STARTUP"] = "1"
  print(f"[Local Engine] Starting On http://{args.host}:{args.port}")
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