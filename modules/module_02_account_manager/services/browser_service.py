"""Open-browser flow ported from the accounts page backend."""
import logging
import threading
import time
from . import runtime
from .events import broadcast
from .credentials import decrypt
from . import operations
from ..utils.paths import account_key

logger = logging.getLogger(__name__)
HWID = None  # Credentials use the existing Module 2 key derivation.
_open_browser_pending = set()
_open_browser_pending_lock = threading.Lock()

def _save_logged_in_identity(db, uid, identity):
    from ..database.repository import AccountRepository

    avatar_url = identity.get("avatar_url")
    AccountRepository.update_identity(
        db, uid, identity.get("profile_name"), avatar_url=avatar_url,
    )


def _confirm_live_session(db, driver, uid):
    """Publish authentication before optional, potentially slow profile metadata."""
    from ..database.repository import AccountRepository
    from ..automation.browser_manager import extract_cookies_as_string
    from ..automation.login_flow import _get_account_identity

    AccountRepository.update_login_status(db, uid, "logged_in")
    saved_cookie = None

    def save_cookies():
        nonlocal saved_cookie
        try:
            cookie = extract_cookies_as_string(driver)
            if cookie and "c_user" in cookie and cookie != saved_cookie:
                AccountRepository.update_cookies(db, uid, cookie)
                saved_cookie = cookie
        except Exception:
            logger.warning("[%s] Could not save session cookies", uid)
            db.rollback()

    save_cookies()
    operations.publish(uid, "authenticated", db)
    identity = {}
    try:
        identity = _get_account_identity(driver, uid)
        _save_logged_in_identity(db, uid, identity)
    except Exception:
        db.rollback()
        logger.warning("[%s] Could not read optional profile metadata", uid)
    # Metadata may restore the personal profile (remove i_user); retain the same
    # final cookie state as the original flow, without repeating an identical write.
    save_cookies()
    operations.publish(uid, "completed", db)
    return identity


def _watch_open_browser_login(driver, uid: str, checks: int = 150, interval: float = 2.0, target_url: str | None = None):
    """
    Theo dõi trong nền khi người dùng tự đăng nhập thủ công trên Chrome live.
    checks=150 * 2.0s = 300 giây (5 phút). Tự động lưu cookies và cập nhật login_status.
    """
    from ..automation.login_flow import _check_logged_in, is_checkpoint_url
    from ..database.connection import SessionLocal
    from ..database.repository import AccountRepository as AccountRepo

    for _ in range(checks):
        if runtime.stopping.wait(interval):
            operations.update(uid, "closed")
            return
        try:
            # Kiểm tra xem trình duyệt còn mở không
            if not getattr(driver, "window_handles", None):
                operations.update(uid, "closed")
                logger.info(f"[{uid}] Trình duyệt live đã được đóng.")
                return

            curr_url = ""
            try:
                curr_url = driver.current_url or ""
            except Exception:
                operations.update(uid, "closed")
                return

            if is_checkpoint_url(curr_url):
                db = SessionLocal()
                try:
                    AccountRepo.update_login_status(db, uid, "failed")
                    operations.publish(uid, "failed", db)
                finally:
                    db.close()
                broadcast("error", f"❌ Đăng nhập lỗi (checkpoint): {uid}", uid=uid)
                return

            if not _check_logged_in(driver):
                continue

            # Đã phát hiện c_user đăng nhập thành công
            db = SessionLocal()
            try:
                identity = _confirm_live_session(db, driver, uid)
            finally:
                db.close()

            profile_name = identity.get("profile_name", "")
            display_name = f" — {profile_name}" if profile_name else ""
            if target_url:
                driver.get(target_url)
            broadcast("success", f"✅ Đăng nhập thành công: Nick {uid}{display_name} đã sẵn sàng và lưu cookie!", uid=uid)
            return

        except Exception as exc:
            operations.update(uid, "failed")
            logger.debug(f"[{uid}] Live watcher dừng: {exc}")
            return

    operations.update(uid, "timeout")


def _open_live_browser_worker(uid: str, target_url: str | None = None):
    """Mở Chrome với profile của nick, tự động login và giữ trình duyệt chạy trên màn hình."""
    from ..automation.browser_manager import create_driver, human_sleep, get_profile_lock
    from ..database.connection import SessionLocal
    from ..database.repository import AccountRepository as AccountRepo

    profile_lock = get_profile_lock(uid)
    acquired = profile_lock.acquire(timeout=5)
    if not acquired:
        operations.update(uid, "failed")
        broadcast("warning", f"⚠️ Tài khoản {uid} đang bận xử lý bởi tiến trình khác (Tạo Page / Đăng nhập), vui lòng chờ!", uid=uid)
        with _open_browser_pending_lock:
            _open_browser_pending.discard(account_key(uid))
        return

    db = SessionLocal()
    try:
        account = AccountRepo.get_by_uid(db, uid)
        if not account:
            operations.update(uid, "failed")
            broadcast("error", f"❌ Không tìm thấy thông tin tài khoản UID: {uid}")
            return

        operations.update(uid, "opening")
        broadcast("info", f"🌐 Đang mở trình duyệt Chrome cho nick: {uid}...")

        # Gọi create_driver với detach=True để giữ trình duyệt mở trên màn hình
        driver = create_driver(uid, detach=True, proxy=account.proxy if account else None, scope="live")
        driver.get("https://www.facebook.com")
        human_sleep(2.0, 3.0)

        # Nếu vào phải trang lưu nick, chờ 10s rồi bấm 'Dùng trang cá nhân khác'
        from ..automation.login_flow import _handle_saved_account_screen
        _handle_saved_account_screen(driver)

        # Nếu chưa login, thực hiện auto-login nếu có mật khẩu/cookie
        from ..automation.login_flow import _check_logged_in, _try_cookie_login, _is_2fa_required, _handle_2fa, _handle_post_login_popups, is_checkpoint_url
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
                    _handle_saved_account_screen(driver)
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
            identity = _confirm_live_session(db, driver, uid)
            profile_name = identity.get("profile_name", "")
            display_name = f" — {profile_name}" if profile_name else ""
            if target_url:
                driver.get(target_url)
            broadcast("success", f"✅ Đăng nhập thành công: Nick {uid}{display_name} đã sẵn sàng!", uid=uid)
        else:
            login_status = "failed" if is_checkpoint_url(driver.current_url or "") else "not_logged_in"
            AccountRepo.update_login_status(db, uid, login_status)
            operations.publish(uid, "failed" if is_checkpoint_url(driver.current_url or "") else "waiting", db)
            broadcast("warning", f"⚠️ Trình duyệt nick {uid} đã mở. Bạn có thể tự đăng nhập trực tiếp trên Chrome, hệ thống sẽ tự động bắt cookie.")
            if not is_checkpoint_url(driver.current_url or ""):
                # Chạy watcher trong daemon thread nền để không giữ profile_lock và kết nối DB
                runtime.watch(_watch_open_browser_login, driver, uid, 150, 2.0, target_url)

    except Exception as e:
        operations.update(uid, "failed")
        logger.exception(f"Lỗi mở trình duyệt cho {uid}: {e}")
        broadcast("error", f"❌ Không thể mở trình duyệt cho {uid}: {e}")
    finally:
        db.close()
        profile_lock.release()
        with _open_browser_pending_lock:
            _open_browser_pending.discard(account_key(uid))



def queue_open_browser(uid, target_url: str | None = None):
    from ..automation.browser_manager import get_profile_lock
    from fastapi import HTTPException
    key = account_key(uid)
    with _open_browser_pending_lock:
        if key in _open_browser_pending or get_profile_lock(uid).locked():
            raise HTTPException(409, "Tài khoản đang bận mở trình duyệt")
        _open_browser_pending.add(key)
    operation_id = operations.create("browser", [uid])
    try:
        with operations.scope(operation_id):
            runtime.submit(_open_live_browser_worker, uid, target_url)
    except Exception:
        with operations.scope(operation_id):
            operations.update(uid, "failed")
        with _open_browser_pending_lock:
            _open_browser_pending.discard(key)
        raise
    return {"started": True, "uid": uid, "operation_id": operation_id}
