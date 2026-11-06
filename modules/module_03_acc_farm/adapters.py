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
from typing import Any, Dict, List, Optional, Set, Tuple

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
    from modules.module_02_account_manager.database.connection import SessionLocal, initialize
    initialize()
    from modules.module_02_account_manager.database.repository import AccountRepository
    return SessionLocal, AccountRepository


def get_account(uid: str, owner=_UNSET) -> Optional[Dict[str, Any]]:
    SessionLocal, Repo = _m02()
    with SessionLocal() as db:
        try:
            acc = Repo.get_by_uid(db, uid, owner_username=_owner(owner))
            if not acc:
                from modules.module_02_account_manager.database.models import Account
                acc = db.query(Account).filter(Account.uid == str(uid).strip()).first()
        except ValueError:  # UID sai định dạng
            return None
        return _account_info(acc) if acc else None


def get_accounts(uids: List[str], owner=_UNSET) -> Dict[str, Dict[str, Any]]:
    """
    Như get_account cho nhiều nick: {uid gửi lên: thông tin}, nick không tìm thấy / UID sai định dạng thì không có.
    Đọc 1 lần cho nick của owner (+ 1 lần cho nick còn thiếu) thay vì 1-2 lần mỗi nick: CSDL Supabase ở xa,
    mỗi lần gọi là 1 lượt đi về qua mạng (bấm Kích hoạt nhiều nick từng chậm quá 60s, tester gặp 2026-11-06).
    """
    from modules.module_02_account_manager.database.models import Account
    from modules.module_02_account_manager.database.repository import validate_uid
    wanted: Dict[str, str] = {}  # uid đã chuẩn hóa -> uid gửi lên
    for uid in uids:
        try:
            wanted.setdefault(validate_uid(uid), uid)
        except ValueError:
            continue
    if not wanted:
        return {}
    SessionLocal, Repo = _m02()
    found: Dict[str, Any] = {}
    with SessionLocal() as db:
        for acc in Repo.query(db, _owner(owner)).filter(Account.uid.in_(list(wanted))).order_by(Account.id).all():
            found.setdefault(acc.uid, acc)
        # Giống get_account: nick không thuộc owner thì lấy theo UID (nick local cũ)
        missing = [uid for uid in wanted if uid not in found]
        if missing:
            for acc in db.query(Account).filter(Account.uid.in_(missing)).order_by(Account.id).all():
                found.setdefault(acc.uid, acc)
        return {wanted[uid]: _account_info(acc) for uid, acc in found.items() if uid in wanted}


def get_profile_names(uids: List[str], owner=_UNSET) -> Dict[str, str]:
    """Tên nick ở Module 02 hiện tại của owner (chỉ đọc uid + tên), nick chưa có tên thì không có."""
    uids = [str(u).strip() for u in uids if str(u).strip()]
    if not uids:
        return {}
    SessionLocal, Repo = _m02()
    from modules.module_02_account_manager.database.models import Account
    with SessionLocal() as db:
        rows = (Repo.query(db, _owner(owner)).filter(Account.uid.in_(uids))
                .with_entities(Account.uid, Account.profile_name).all())
    return {str(row.uid).strip(): row.profile_name.strip() for row in rows if row.profile_name and row.profile_name.strip()}


def _account_info(acc) -> Dict[str, Any]:
    return {
        "uid": acc.uid,
        "profile_name": acc.profile_name or "",
        "proxy": acc.proxy,
        "cookie": acc.cookie,
        "status": (acc.status or "").lower() or None,
        "login_status": _LOGIN_STATUS_FROM_M02.get(acc.login_status, (acc.login_status or "").lower()),
        "has_password": bool(acc.password),
        "has_2fa": bool(acc.two_fa),
        "user_id": str(acc.user_id) if acc.user_id is not None else None,
        "profile_path": acc.profile_path,
    }


def list_owner_accounts(owner=_UNSET) -> Dict[str, str]:
    """
    UID -> trạng thái Module 02 (NEW / LIVE / DIE / CHECKPOINT) của mọi nick thuộc owner (owner None: mọi nick local,
    user_id NULL). Dùng cho dàn nick: không kết bạn với nick nhà, trả nhóm / người của nick đã die hoặc đã xóa.
    Chỉ đọc cột uid + status, không đọc mật khẩu / cookie.
    """
    SessionLocal, Repo = _m02()
    from modules.module_02_account_manager.database.models import Account
    with SessionLocal() as db:
        rows = Repo.query(db, _owner(owner)).with_entities(Account.uid, Account.status).all()
    return {str(row.uid).strip(): (row.status or "").upper() for row in rows if row.uid}


def list_owner_uids(owner=_UNSET) -> Set[str]:
    """UID mọi nick của owner (kể cả nick đã die), để kết bạn không mời trúng nick trong dàn."""
    return set(list_owner_accounts(owner))


def get_credentials(uid: str, owner=_UNSET) -> Tuple[str, Optional[str]]:
    """(mật khẩu, 2FA secret) đã giải mã; giải mã lỗi thì trả rỗng để luồng thử phiên cookie."""
    from modules.module_02_account_manager.security.encryption import decrypt_data
    SessionLocal, Repo = _m02()
    with SessionLocal() as db:
        acc = Repo.get_by_uid(db, uid, owner_username=_owner(owner))
        if not acc:
            from modules.module_02_account_manager.database.models import Account
            acc = db.query(Account).filter(Account.uid == str(uid).strip()).first()
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
