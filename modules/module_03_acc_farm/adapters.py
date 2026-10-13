"""
adapters.py
Cổng nối giữa luồng Tab 1 và phần xung quanh: tài khoản (Module 02), định danh máy, license, log.
Luồng farm chỉ gọi qua file này; nguồn bên ngoài đổi thì chỉ sửa ở đây, không sửa luồng.
"""
import asyncio
import hashlib
import logging
import threading
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, Optional, Tuple

from config.constants import LOGS_DIR

logger = logging.getLogger(__name__)

LOG_PATH = str(LOGS_DIR / "module_03_farm.log")

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


# ─────────────────────────── TÀI KHOẢN (bảng accounts của Module 02) ────────────────────────────

# Owner của nick (accounts.user_id) dùng để đọc tài khoản và tìm profile Chrome (core.browser).
# Tab 1 chưa nhận owner từ giao diện: chỉ dùng nick local (user_id NULL).
ACCOUNT_OWNER: Optional[str] = None

# Module 02 lưu trạng thái chữ hoa; luồng farm dùng chữ thường như trước
_LOGIN_STATUS_FROM_M02 = {"LOGGED_IN": "logged_in", "NOT_LOGGED": "not_logged_in", "ERROR": "failed"}


def _m02():
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_02_account_manager.database.repository import AccountRepository
    return SessionLocal, AccountRepository


def get_account(uid: str) -> Optional[Dict[str, Any]]:
    SessionLocal, Repo = _m02()
    with SessionLocal() as db:
        try:
            acc = Repo.get_by_uid(db, uid, owner_username=ACCOUNT_OWNER)
        except ValueError:  # UID sai định dạng
            return None
        if not acc:
            return None
        return {
            "uid": acc.uid,
            "profile_name": acc.profile_name or "",
            "proxy": acc.proxy,
            "cookie": acc.cookie,
            "status": (acc.status or "").lower() or None,
            "login_status": _LOGIN_STATUS_FROM_M02.get(acc.login_status, (acc.login_status or "").lower()),
            "has_password": bool(acc.password),
            "has_2fa": bool(acc.two_fa),
        }


def get_credentials(uid: str) -> Tuple[str, Optional[str]]:
    """(mật khẩu, 2FA secret) đã giải mã; giải mã lỗi thì trả rỗng để luồng thử phiên cookie."""
    from modules.module_02_account_manager.security.encryption import decrypt_data
    SessionLocal, Repo = _m02()
    with SessionLocal() as db:
        acc = Repo.get_by_uid(db, uid, owner_username=ACCOUNT_OWNER)
        if not acc:
            return "", None
        try:
            password = decrypt_data(acc.password)
        except ValueError:
            password = ""
        try:
            two_fa = decrypt_data(acc.two_fa) or None
        except ValueError:
            two_fa = None
        return password, two_fa


def save_cookie(uid: str, cookie: str):
    SessionLocal, Repo = _m02()
    with SessionLocal() as db:
        Repo.update_cookies(db, uid, cookie, owner_username=ACCOUNT_OWNER)


def set_login_status(uid: str, status: str, profile_name: Optional[str] = None):
    """status: logged_in / not_logged_in / failed / checkpoint (checkpoint = ERROR + nick CHECKPOINT ở Module 02)."""
    SessionLocal, Repo = _m02()
    with SessionLocal() as db:
        if status != "checkpoint":
            Repo.update_login_status(db, uid, status, profile_name, owner_username=ACCOUNT_OWNER)
            return
        acc = Repo.update_login_status(db, uid, "failed", profile_name, owner_username=ACCOUNT_OWNER)
        if acc:
            acc.status = "CHECKPOINT"
            acc.status_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()


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
