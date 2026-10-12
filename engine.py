"""
=============================================================================
LOCAL ENGINE (Python Sidecar) - Facebook Automator Pro
Chạy ngầm tại cổng 28129 cho ứng dụng Tauri Desktop
=============================================================================
"""
import sys
import os
import argparse
import asyncio
from typing import List, Dict, Any, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

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
    # Khởi tạo CSDL SQLite khi Engine bật
    init_database()
    initialize_accounts()
    print("[Local Engine] Database connection initialized.")
    try:
        yield
    finally:
        await shutdown_accounts()
    print("[Local Engine] Shutting down cleanly...")

app = FastAPI(
    title="Facebook Automator Local Engine",
    version="2.0.0",
    lifespan=lifespan
)

# Cho phép Web UI (localhost:3000, tauri://localhost) gọi API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== SYSTEM & HEALTH CHECK ====================
@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "app": "Facebook Automator Pro",
        "version": "2.0.0",
        "port": 28129
    }

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
