"""Open-browser flow ported from the accounts page backend."""
import logging
import threading
import time
from . import runtime
from .events import broadcast
from .credentials import decrypt
from ..utils.paths import account_key

logger = logging.getLogger(__name__)
HWID = None  # Credentials use the existing Module 2 key derivation.
_open_browser_pending = set()
_open_browser_pending_lock = threading.Lock()

def _save_logged_in_identity(db, uid, identity):
    from ..database.repository import AccountRepository

    avatar_url = identity.get("avatar_url")
    if avatar_url:
        broadcast("info", f"Đã đọc URL avatar {uid}: {avatar_url}", uid=uid)
    else:
        broadcast("warning", f"Không đọc được URL avatar từ trang chủ: {uid}; giữ ảnh cũ nếu có", uid=uid)
    AccountRepository.update_login_status(
        db, uid, "logged_in", identity.get("profile_name"), avatar_url=avatar_url,
    )
    if avatar_url:
        broadcast("success", f"Đã lấy và lưu URL avatar: {uid}", uid=uid)


def _watch_open_browser_login(driver, uid: str, checks: int = 150, interval: float = 2.0):
    """
    Theo dõi trong nền khi người dùng tự đăng nhập thủ công trên Chrome live.
    checks=150 * 2.0s = 300 giây (5 phút). Tự động lưu cookies và cập nhật login_status.
    """
    from ..automation.login_flow import _check_logged_in, _get_account_identity, is_checkpoint_url
    from ..automation.browser_manager import extract_cookies_as_string
    from ..database.connection import SessionLocal
    from ..database.repository import AccountRepository as AccountRepo

    for _ in range(checks):
        if runtime.stopping.wait(interval):
            return
        try:
            # Kiểm tra xem trình duyệt còn mở không
            if not getattr(driver, "window_handles", None):
                logger.info(f"[{uid}] Trình duyệt live đã được đóng.")
                return

            curr_url = ""
            try:
                curr_url = driver.current_url or ""
            except Exception:
                return

            if is_checkpoint_url(curr_url):
                db = SessionLocal()
                try:
                    AccountRepo.update_login_status(db, uid, "failed")
                finally:
                    db.close()
                broadcast("error", f"❌ Đăng nhập lỗi (checkpoint): {uid}", uid=uid)
                return

            if not _check_logged_in(driver):
                continue

            # Đã phát hiện c_user đăng nhập thành công
            identity = _get_account_identity(driver, uid)
            profile_name = identity.get("profile_name", "")
            c_str = extract_cookies_as_string(driver)

            db = SessionLocal()
            try:
                _save_logged_in_identity(db, uid, identity)
                if c_str and "c_user" in c_str:
                    AccountRepo.update_cookies(db, uid, c_str)
                    logger.info(f"[{uid}] Live watcher: Đã đồng bộ cookie vào DB ({len(c_str)} ký tự)")
            finally:
                db.close()

            display_name = f" — {profile_name}" if profile_name else ""
            broadcast("success", f"✅ Đăng nhập thành công: Nick {uid}{display_name} đã sẵn sàng và lưu cookie!", uid=uid)
            return

        except Exception as exc:
            logger.debug(f"[{uid}] Live watcher dừng: {exc}")
            return


def _open_live_browser_worker(uid: str):
    """Mở Chrome với profile của nick, tự động login và giữ trình duyệt chạy trên màn hình."""
    from ..automation.browser_manager import create_driver, human_sleep, get_profile_lock
    from ..database.connection import SessionLocal
    from ..database.repository import AccountRepository as AccountRepo

    profile_lock = get_profile_lock(uid)
    acquired = profile_lock.acquire(timeout=5)
    if not acquired:
        broadcast("warning", f"⚠️ Tài khoản {uid} đang bận xử lý bởi tiến trình khác (Tạo Page / Đăng nhập), vui lòng chờ!", uid=uid)
        with _open_browser_pending_lock:
            _open_browser_pending.discard(account_key(uid))
        return

    db = SessionLocal()
    try:
        account = AccountRepo.get_by_uid(db, uid)
        if not account:
            broadcast("error", f"❌ Không tìm thấy thông tin tài khoản UID: {uid}")
            return

        broadcast("info", f"🌐 Đang mở trình duyệt Chrome cho nick: {uid}...")

        # Gọi create_driver với detach=True để giữ trình duyệt mở trên màn hình
        driver = create_driver(uid, detach=True, proxy=account.proxy if account else None, scope="live")
        driver.get("https://www.facebook.com")
        human_sleep(2.0, 3.0)

        # Nếu chưa login, thực hiện auto-login nếu có mật khẩu/cookie
        from ..automation.login_flow import _check_logged_in, _try_cookie_login, _is_2fa_required, _handle_2fa, _handle_post_login_popups, is_checkpoint_url, _get_account_identity
        from ..automation.locators import LOGIN
        from ..automation.browser_manager import wait_and_find, human_type

        attempted_login = False
        if not _check_logged_in(driver):
            if account.cookie:
                attempted_login = True
                try:
                    _try_cookie_login(driver, account.cookie)
                except Exception as cookie_error:
                    logger.warning(f"[{uid}] Cookie login attempt failed: {cookie_error}")

            if not _check_logged_in(driver) and account.password and not is_checkpoint_url(driver.current_url or ""):
                attempted_login = True
                try:
                    password_plain = decrypt(account.password, HWID)
                    email_el = wait_and_find(driver, LOGIN["email_input"], timeout=5)
                    human_type(email_el, uid)
                    pass_el = wait_and_find(driver, LOGIN["password_input"], timeout=5)
                    human_type(pass_el, password_plain)
                    human_sleep(0.5, 1.0)

                    clicked = False
                    try:
                        login_btn = wait_and_find(driver, LOGIN["login_button"], timeout=5)
                        try:
                            login_btn.click()
                            clicked = True
                        except Exception:
                            driver.execute_script("arguments[0].click();", login_btn)
                            clicked = True
                    except Exception as err:
                        logger.info(f"[{uid}] Live browser login button click note: {err}")

                    if not clicked:
                        from selenium.webdriver.common.keys import Keys
                        pass_el.send_keys(Keys.ENTER)

                    human_sleep(4.0, 6.0)

                    if _is_2fa_required(driver) and account.two_fa:
                        _handle_2fa(driver, decrypt(account.two_fa, HWID))
                except Exception as e:
                    logger.warning(f"Auto-login form attempt note: {e}")

            # Tự động đóng popup Dismiss nếu xuất hiện sau khi mở trình duyệt
            _handle_post_login_popups(driver)

        if _check_logged_in(driver):
            identity = _get_account_identity(driver, uid)
            profile_name = identity.get("profile_name", "")
            _save_logged_in_identity(db, uid, identity)
            from ..automation.browser_manager import extract_cookies_as_string
            c_str = extract_cookies_as_string(driver)
            if c_str and "c_user" in c_str:
                AccountRepo.update_cookies(db, uid, c_str)
                logger.info(f"[{uid}] Đã đồng bộ cookie phiên đăng nhập vào database")
            display_name = f" — {profile_name}" if profile_name else ""
            broadcast("success", f"✅ Đăng nhập thành công: Nick {uid}{display_name} đã sẵn sàng!", uid=uid)
        else:
            login_status = "failed" if attempted_login or is_checkpoint_url(driver.current_url or "") else "not_logged_in"
            AccountRepo.update_login_status(db, uid, login_status)
            broadcast("warning", f"⚠️ Trình duyệt nick {uid} đã mở. Bạn có thể tự đăng nhập trực tiếp trên Chrome, hệ thống sẽ tự động bắt cookie.")
            if not is_checkpoint_url(driver.current_url or ""):
                # Chạy watcher trong daemon thread nền để không giữ profile_lock và kết nối DB
                runtime.watch(_watch_open_browser_login, driver, uid)

    except Exception as e:
        logger.exception(f"Lỗi mở trình duyệt cho {uid}: {e}")
        broadcast("error", f"❌ Không thể mở trình duyệt cho {uid}: {e}")
    finally:
        db.close()
        profile_lock.release()
        with _open_browser_pending_lock:
            _open_browser_pending.discard(account_key(uid))



def queue_open_browser(uid):
    from ..automation.browser_manager import get_profile_lock
    from fastapi import HTTPException
    key = account_key(uid)
    with _open_browser_pending_lock:
        if key in _open_browser_pending or get_profile_lock(uid).locked():
            raise HTTPException(409, "Tài khoản đang bận mở trình duyệt")
        _open_browser_pending.add(key)
    try:
        runtime.submit(_open_live_browser_worker, uid)
    except Exception:
        with _open_browser_pending_lock:
            _open_browser_pending.discard(key)
        raise
    return {"started": True, "uid": uid}
