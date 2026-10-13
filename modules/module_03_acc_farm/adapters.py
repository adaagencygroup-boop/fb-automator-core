"""
adapters.py
Cổng nối giữa luồng Tab 1 và phần xung quanh chưa có trong repo tổng.
Luồng farm chỉ gọi qua file này; khi Module 02 (tài khoản) / đăng nhập / license của repo hoàn thiện
thì chỉ sửa ở đây, không sửa luồng.
"""
import asyncio
import hashlib
import logging
import threading
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, Optional, Tuple

from modules.module_03_acc_farm.browser.paths import LOG_PATH

logger = logging.getLogger(__name__)

MODULE_LOG_NAME = "Tương tác tài khoản"
VN_TZ = timezone(timedelta(hours=7))

_hwid: Optional[str] = None
_hwid_lock = threading.Lock()


# ─────────────────────────── ĐỊNH DANH MÁY ────────────────────────────

def get_hwid() -> str:
    """HWID của máy (khóa nguồn để mã hóa mật khẩu); chỉ tính 1 lần vì phải gọi lệnh hệ thống."""
    global _hwid
    with _hwid_lock:
        if _hwid is None:
            from modules.module_03_acc_farm.browser.hwid import get_hwid as _collect
            _hwid = _collect()
        return _hwid


def get_machine_id() -> str:
    """Định danh máy lưu lên CSDL chung: băm lại HWID, không bao giờ đưa HWID gốc ra khỏi máy."""
    return hashlib.sha256(f"m03-machine::{get_hwid()}".encode("utf-8")).hexdigest()


# ─────────────────────────── TÀI KHOẢN (tạm: _temp/local_db.py) ────────────────────────────

def get_account(uid: str) -> Optional[Dict[str, Any]]:
    from modules.module_03_acc_farm._temp.local_db import AccountRepo, SessionLocal
    db = SessionLocal()
    try:
        acc = AccountRepo.get_by_uid(db, uid)
        if not acc:
            return None
        return {
            "uid": acc.uid,
            "profile_name": acc.profile_name or "",
            "proxy": acc.proxy,
            "cookie": acc.cookie,
            "status": acc.status,
            "login_status": acc.login_status,
            "has_password": bool(acc.password),
            "has_2fa": bool(acc.two_fa),
        }
    finally:
        db.close()


def get_credentials(uid: str) -> Tuple[str, Optional[str]]:
    """(mật khẩu, 2FA secret) đã giải mã; giải mã lỗi thì trả rỗng để luồng thử phiên cookie."""
    from modules.module_03_acc_farm._temp.local_db import AccountRepo, SessionLocal
    from modules.module_03_acc_farm.browser.encryption import decrypt
    db = SessionLocal()
    try:
        acc = AccountRepo.get_by_uid(db, uid)
        if not acc:
            return "", None
        try:
            password = decrypt(acc.password, get_hwid()) if acc.password else ""
        except Exception:
            password = ""
        try:
            two_fa = decrypt(acc.two_fa, get_hwid()) if acc.two_fa else None
        except Exception:
            two_fa = None
        return password, two_fa
    finally:
        db.close()


def save_cookie(uid: str, cookie: str):
    from modules.module_03_acc_farm._temp.local_db import AccountRepo, SessionLocal
    db = SessionLocal()
    try:
        AccountRepo.update_cookies(db, uid, cookie)
    finally:
        db.close()


def set_login_status(uid: str, status: str, profile_name: Optional[str] = None):
    from modules.module_03_acc_farm._temp.local_db import AccountRepo, SessionLocal
    db = SessionLocal()
    try:
        AccountRepo.update_login_status(db, uid, status, profile_name)
    finally:
        db.close()


# ─────────────────────────── LICENSE / NGƯỜI DÙNG ────────────────────────────

def get_owner_username() -> Optional[str]:
    """Repo tổng chưa có đăng nhập: chưa xác định được người dùng."""
    return None


def is_license_valid(owner: Optional[str]) -> bool:
    """Repo tổng chưa có kiểm tra bản quyền: luôn cho phép."""
    return True


# ─────────────────────────── LOG ────────────────────────────

_ws_manager = None
_loop: Optional[asyncio.AbstractEventLoop] = None
_logging_ready = False


def setup_logging():
    """Ghi log của Module 03 ra logs/module_03_farm.log (uvicorn chạy log_level=warning nên không thấy logger.info)."""
    global _logging_ready
    if _logging_ready:
        return
    handler = RotatingFileHandler(LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    module_logger = logging.getLogger("modules.module_03_acc_farm")
    module_logger.setLevel(logging.INFO)
    module_logger.addHandler(handler)
    _logging_ready = True


def register_log_channel(ws_manager, loop: asyncio.AbstractEventLoop):
    """engine.py gọi lúc khởi động để log realtime của module đi qua WebSocket /ws/logs."""
    global _ws_manager, _loop
    _ws_manager, _loop = ws_manager, loop


async def _send(payload: Dict[str, Any]):
    for connection in list(_ws_manager.active_connections):
        try:
            await connection.send_json(payload)
        except Exception:
            _ws_manager.disconnect(connection)


def emit_log(level: str, message: str, uid: Optional[str] = None, slot: Optional[int] = None):
    """
    Gửi 1 dòng log realtime lên giao diện; gọi được từ mọi thread.
    Tự dựng payload (cùng định dạng ws_manager.broadcast_log) thay vì gọi broadcast_log,
    vì hàm đó query CSDL lấy giờ cho mỗi dòng log.
    """
    payload = {
        "module": MODULE_LOG_NAME,
        "level": (level or "info").upper(),
        "message": message,
        "timestamp": datetime.now(VN_TZ).strftime("%Y-%m-%d %H:%M:%S"),
        "uid": uid,
        "thread": slot,
        "farm": True,
    }
    if _ws_manager is None or _loop is None or _loop.is_closed():
        return
    try:
        asyncio.run_coroutine_threadsafe(_send(payload), _loop)
    except Exception as e:
        logger.debug(f"Không gửi được log realtime: {e}")
