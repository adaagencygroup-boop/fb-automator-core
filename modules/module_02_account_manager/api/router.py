"""HTTP adapter for the independent account plugin."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from ..context import owner_scope, normalize_owner, owner_context
from ..services.scoped import run_owned, stream_owned
from ..database.connection import get_db
from ..database.repository import AccountRepository as Repo
from ..services import account_service as accounts, status_service, login_service
from ..services.browser_service import queue_open_browser
from ..services.events import event_stream
from ..utils.paths import validate_uid
from .schemas import AccountInput, ImportRequest, UidsRequest, LoginRequest, OpenBrowserRequest, TestProxyRequest

router = APIRouter(prefix="/api/accounts", tags=["Module 02: Account Manager"])

async def scoped_owner(request: Request):
    values = [request.headers.get("X-Owner-Username"), request.query_params.get("owner_username"), request.query_params.get("user_id")]
    if request.method == "POST":
        try:
            body = await request.json()
        except ValueError:
            body = {}
        if isinstance(body, dict):
            values.append(body.get("owner_username"))
            items = body.get("accounts")
            if isinstance(items, list):
                values.extend(item.get("owner_username") for item in items if isinstance(item, dict))
    owners = {normalize_owner(value) for value in values if normalize_owner(value) is not None}
    if len(owners) > 1 or any(len(owner) > 100 for owner in owners):
        raise HTTPException(422, "Owner không hợp lệ hoặc mâu thuẫn")
    owner = next(iter(owners), None)
    with owner_scope(owner):
        yield owner

router.dependencies.append(Depends(scoped_owner))

def checked_uid(uid):
    try:
        return validate_uid(uid)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

@router.get("")
@router.get("/", include_in_schema=False)
async def list_accounts(db: Session = Depends(get_db)):
    return [accounts.serialize(a) for a in Repo.get_all(db)]

@router.post("/import")
async def import_accounts(req: ImportRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    result, uids = accounts.import_accounts(db, req.accounts)
    result["checking"] = len(uids) if req.check_status else 0
    if req.check_status and uids:
        background_tasks.add_task(run_owned, owner_context.get(), status_service.check_imported, uids)
    return result

@router.post("/single")
async def save_single(item: AccountInput, db: Session = Depends(get_db)):
    try:
        account = accounts.save_account(db, item)
    except Exception as exc:
        db.rollback()
        raise HTTPException(400, "Không thể lưu tài khoản") from exc
    return {"success": True, "uid": account.uid}

@router.post("/bulk-delete")
async def bulk_delete(req: UidsRequest, db: Session = Depends(get_db)):
    return accounts.bulk_delete(db, req.uids)

@router.post("/check-status")
async def check_status(req: UidsRequest, db: Session = Depends(get_db)):
    return await status_service.check_statuses(db, req.uids)

@router.post("/test-proxy")
async def test_proxy(req: TestProxyRequest):
    import asyncio
    from ..automation.proxy_bridge import parse_proxy, test_proxy_connectivity, ProxyError
    try:
        info = parse_proxy(req.proxy)
        if not info:
            raise HTTPException(400, "Proxy không hợp lệ")
        result = await asyncio.to_thread(test_proxy_connectivity, info, 12)
        return {"success": True, "host": info["host"], "port": info["port"], "has_auth": info["has_auth"], "egress_ip": result.get("egress_ip"), "message": "Kết nối proxy thành công"}
    except ProxyError as exc:
        raise HTTPException(400, str(exc)) from exc

@router.post("/login")
async def login(req: LoginRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    for uid in req.uids:
        accounts.require_account(db, uid)
    background_tasks.add_task(run_owned, owner_context.get(), login_service.login_batch, req.uids, req.threads)
    return {"started": True, "count": len(req.uids)}

@router.post("/open-browser")
async def open_browser(req: OpenBrowserRequest, db: Session = Depends(get_db)):
    accounts.require_account(db, req.uid)
    return queue_open_browser(req.uid)

@router.get("/stream")
async def stream():
    return StreamingResponse(stream_owned(owner_context.get(), event_stream), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@router.post("/{uid}/sync-cookies")
async def sync_cookies(uid: str, db: Session = Depends(get_db)):
    uid = checked_uid(uid)
    accounts.require_account(db, uid)
    from ..services.cookie_service import sync_cookies
    return sync_cookies(db, uid)

@router.get("/{uid}")
async def detail(uid: str, db: Session = Depends(get_db)):
    return accounts.serialize(accounts.require_account(db, checked_uid(uid)), detail=True)

@router.delete("/{uid}")
async def delete(uid: str, db: Session = Depends(get_db)):
    return accounts.delete_account(db, checked_uid(uid))

# ── Route Aliases for legacy clients ──
alias_router = APIRouter(tags=["Module 02: Account Manager Aliases"])
alias_router.dependencies.append(Depends(scoped_owner))

@alias_router.post("/tasks/open-browser")
@router.post("/tasks/open-browser", include_in_schema=False)
async def task_open_browser_alias(req: OpenBrowserRequest, db: Session = Depends(get_db)):
    return await open_browser(req, db)

@alias_router.post("/tasks/login")
@router.post("/tasks/login", include_in_schema=False)
async def task_login_alias(req: LoginRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    return await login(req, background_tasks, db)

@alias_router.get("/stream")
async def stream_alias():
    return await stream()

@alias_router.get("/accounts")
@alias_router.get("/accounts/", include_in_schema=False)
async def list_accounts_alias(db: Session = Depends(get_db)):
    return await list_accounts(db)

@alias_router.post("/accounts/import")
async def import_accounts_alias(req: ImportRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    return await import_accounts(req, background_tasks, db)

@alias_router.post("/accounts/single")
async def save_single_alias(item: AccountInput, db: Session = Depends(get_db)):
    return await save_single(item, db)

@alias_router.post("/accounts/bulk-delete")
async def bulk_delete_alias(req: UidsRequest, db: Session = Depends(get_db)):
    return await bulk_delete(req, db)

@alias_router.post("/accounts/check-status")
async def check_status_alias(req: UidsRequest, db: Session = Depends(get_db)):
    return await check_status(req, db)

@alias_router.post("/accounts/test-proxy")
async def test_proxy_alias(req: TestProxyRequest):
    return await test_proxy(req)

@alias_router.post("/accounts/{uid}/sync-cookies")
async def sync_cookies_alias(uid: str, db: Session = Depends(get_db)):
    return await sync_cookies(uid, db)

@alias_router.get("/accounts/{uid}")
async def detail_alias(uid: str, db: Session = Depends(get_db)):
    return await detail(uid, db)

@alias_router.delete("/accounts/{uid}")
async def delete_alias(uid: str, db: Session = Depends(get_db)):
    return await delete(uid, db)

