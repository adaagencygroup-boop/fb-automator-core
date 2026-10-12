"""Sync cookies only from the current owner's active browser/profile."""
import sqlite3
from ..context import owner_context
from ..database.repository import AccountRepository as Repo
from ..utils.paths import profile_path
from .events import broadcast

def sync_cookies(db, uid):
    from ..automation.browser_manager import _active_drivers, _active_drivers_lock, extract_cookies_as_string
    with _active_drivers_lock:
        drivers = [driver for driver, info in _active_drivers.items() if info.get("uid") == uid and info.get("owner") == owner_context.get()]
    for driver in drivers:
        cookie = extract_cookies_as_string(driver)
        if cookie and "c_user=" in cookie:
            Repo.update_cookies(db, uid, cookie)
            Repo.update_login_status(db, uid, "logged_in")
            broadcast("success", f"Đã đồng bộ cookie cho {uid}", uid=uid)
            return {"success": True, "uid": uid, "source": "active_driver"}
    root = profile_path(uid)
    for relative in ("Default/Network/Cookies", "Default/Cookies"):
        path = root / relative
        if not path.is_file():
            continue
        try:
            connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
            try:
                found = connection.execute("SELECT 1 FROM cookies WHERE name='c_user' AND (host_key='facebook.com' OR host_key LIKE '%.facebook.com') LIMIT 1").fetchone()
            finally:
                connection.close()
            if found:
                Repo.update_login_status(db, uid, "logged_in")
                return {"success": True, "uid": uid, "source": "profile_disk"}
        except sqlite3.Error:
            continue
    return {"success": False, "uid": uid, "message": "Không tìm thấy session đang hoạt động."}
