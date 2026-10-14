"""
adapters.py
Cổng nối giữa luồng Tab 1 và phần xung quanh: tài khoản (Module 02), định danh máy, license, log.
Luồng farm chỉ gọi qua file này; nguồn bên ngoài đổi thì chỉ sửa ở đây, không sửa luồng.
"""
import asyncio
import hashlib
import logging
import threading
from contextlib import contextmanager
from contextvars import ContextVar
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

# Owner của nick = accounts.user_id = id người đang đăng nhập (Module 02 tự gán khi import, router.scoped_owner).
# Dùng để đọc / ghi tài khoản và tìm profile Chrome (core.browser). None = nick local (user_id NULL).
# Worker đặt owner cho luồng của mình (owner_scope), các hàm tài khoản bên dưới tự đọc khi không truyền owner.
_current_owner: ContextVar[Optional[str]] = ContextVar("m03_account_owner", default=None)


@contextmanager
def owner_scope(owner: Optional[str]):
    token = _current_owner.set(owner)
    try:
        yield
    finally:
        _current_owner.reset(token)


def current_owner() -> Optional[str]:
    return _current_owner.get()


_UNSET = object()


def _owner(owner) -> Optional[str]:
    return _current_owner.get() if owner is _UNSET else owner


# Module 02 lưu trạng thái chữ hoa; luồng farm dùng chữ thường như trước
_LOGIN_STATUS_FROM_M02 = {"LOGGED_IN": "logged_in", "NOT_LOGGED": "not_logged_in", "ERROR": "failed"}


def _m02():
    from modules.module_02_account_manager.database.connection import SessionLocal
    from modules.module_02_account_manager.database.repository import AccountRepository
    return SessionLocal, AccountRepository


def get_account(uid: str, owner=_UNSET) -> Optional[Dict[str, Any]]:
    SessionLocal, Repo = _m02()
    with SessionLocal() as db:
        try:
            acc = Repo.get_by_uid(db, uid, owner_username=_owner(owner))
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


def get_credentials(uid: str, owner=_UNSET) -> Tuple[str, Optional[str]]:
    """(mật khẩu, 2FA secret) đã giải mã; giải mã lỗi thì trả rỗng để luồng thử phiên cookie."""
    from modules.module_02_account_manager.security.encryption import decrypt_data
    SessionLocal, Repo = _m02()
    with SessionLocal() as db:
        acc = Repo.get_by_uid(db, uid, owner_username=_owner(owner))
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


def save_cookie(uid: str, cookie: str, owner=_UNSET):
    SessionLocal, Repo = _m02()
    with SessionLocal() as db:
        Repo.update_cookies(db, uid, cookie, owner_username=_owner(owner))


def set_login_status(uid: str, status: str, profile_name: Optional[str] = None, owner=_UNSET):
    """status: logged_in / not_logged_in / failed / checkpoint (checkpoint = ERROR + nick CHECKPOINT ở Module 02)."""
    SessionLocal, Repo = _m02()
    owner = _owner(owner)
    with SessionLocal() as db:
        if status != "checkpoint":
            Repo.update_login_status(db, uid, status, profile_name, owner_username=owner)
            return
        acc = Repo.update_login_status(db, uid, "failed", profile_name, owner_username=owner)
        if acc:
            acc.status = "CHECKPOINT"
            acc.status_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()


# ─────────────────────────── LICENSE / NGƯỜI DÙNG ────────────────────────────

def owner_from_request(request) -> Optional[str]:
    """
    Owner của request = id người đang đăng nhập (Bearer hoặc cookie phiên), giống Module 02 router.scoped_owner,
    để Tab 1 thấy đúng nick người đó đã import và mở đúng thư mục profile. Không đăng nhập thì None (nick local).
    Cookie phiên lấy qua module_auth.token_from_request (app gửi X-Auth-Client: user -> fb_user_access).
    """
    from fastapi import HTTPException
    from modules.module_auth.service import bearer_user, token_from_request

    auth_header = request.headers.get("Authorization")
    if not ((auth_header and auth_header.strip()) or token_from_request(None, request)):
        return None
    try:
        user = bearer_user(auth_header, require_session=True, request=request)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Không đọc được người dùng đăng nhập: {e}")
        return None
    return str(user["id"]) if user and user.get("id") is not None else None


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
