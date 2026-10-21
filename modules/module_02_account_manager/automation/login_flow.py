"""
login_flow.py
Kịch bản tự động đăng nhập Facebook:
  1. Thử đăng nhập bằng Cookie (nếu có)
  2. Đăng nhập bằng UID/Password form
  3. Xử lý 2FA tự động bằng TOTP
  4. Bóc tách tên profile từ trang /me
"""
import time
import logging
from urllib.parse import urlparse
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

from ..automation.browser_manager import (
    create_driver, human_type, human_sleep, wait_and_find, load_cookies
)
from ..automation.locators import LOGIN
from ..utils.otp_generator import generate_totp

logger = logging.getLogger(__name__)

FB_HOME = "https://www.facebook.com"
FB_ME = "https://www.facebook.com/me"


def is_checkpoint_url(url: str) -> bool:
    """A checkpoint page is a failed login, even when Facebook set c_user."""
    path = urlparse(url).path.lower()
    return path == "/checkpoint" or path.startswith("/checkpoint/")


def _handle_saved_account_screen(driver: webdriver.Chrome, sleep_before_click: float = 10.0) -> bool:
    """
    Nếu vào phải trang lưu tài khoản (có nút 'Dùng trang cá nhân khác' / 'Đăng nhập bằng tài khoản khác'):
    Chờ khoảng 10s rồi click nút đó để Facebook quay về form đăng nhập chuẩn.
    """
    locators = LOGIN.get("saved_account_switch", [])
    for loc in locators:
        try:
            elements = driver.find_elements(By.XPATH, loc)
            for el in elements:
                if el.is_displayed():
                    logger.info(f"Phát hiện màn hình lưu nick; chờ {sleep_before_click}s rồi bấm nút chuyển tài khoản...")
                    time.sleep(sleep_before_click)
                    try:
                        el.click()
                    except Exception:
                        driver.execute_script("arguments[0].click();", el)
                    time.sleep(2.0)
                    return True
        except Exception:
            pass
    return False


def _check_logged_in(driver: webdriver.Chrome) -> bool:
    """Only an authenticated Facebook session outside login/checkpoint is valid."""
    try:
        current_url = driver.current_url or ""
        parsed = urlparse(current_url)
        if parsed.hostname not in {"facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com"}:
            return False
        if is_checkpoint_url(current_url) or parsed.path.lower().startswith(("/login", "/recover", "/two_step", "/approvals", "/two_factor")):
            return False

        cookies = driver.get_cookies()
        has_user_cookie = any(cookie.get("name") == "c_user" and cookie.get("value") for cookie in cookies)
        if not has_user_cookie:
            return False

        # Nếu đã có c_user và không ở URL login/checkpoint, chỉ coi là chưa login nếu có ô mật khẩu hiển thị rõ ràng trên màn hình
        try:
            pass_inputs = driver.find_elements(By.XPATH, '//input[@type="password" and (@name="pass" or @id="pass")]')
            has_visible_pass = any(el.is_displayed() for el in pass_inputs if el)
            if has_visible_pass and parsed.path.lower() in ("/", "", "/login.php"):
                return False
        except Exception:
            pass

        return True
    except Exception as cookie_error:
        logger.debug(f"Could not inspect Facebook cookies: {cookie_error}")
        return False


def ensure_personal_profile(driver: webdriver.Chrome, uid: str = "") -> bool:
    """
    Đảm bảo phiên Facebook đang ở đúng Trang cá nhân gốc của UID,
    không bị kẹt trong Profile của Fanpage vừa tạo (New Pages Experience / i_user).
    """
    try:
        # 1. Kiểm tra cookie i_user (Facebook gán i_user khi switch sang Page)
        i_user_cookie = driver.get_cookie("i_user")
        c_user_cookie = driver.get_cookie("c_user")

        need_reset = False
        if isinstance(i_user_cookie, dict) and i_user_cookie.get("value"):
            c_val = c_user_cookie.get("value") if isinstance(c_user_cookie, dict) else ""
            i_val = i_user_cookie.get("value", "")
            if not c_val or i_val != c_val:
                logger.info(f"[{uid}] Phát hiện phiên đang ở Fanpage (i_user={i_val}, c_user={c_val}). Đang xóa cookie i_user để về Profile cá nhân...")
                need_reset = True
            else:
                need_reset = True

        if need_reset:
            try:
                driver.delete_cookie("i_user")
            except Exception as del_err:
                logger.debug(f"[{uid}] Cookie delete error: {del_err}")

            driver.get(FB_HOME)
            human_sleep(2.0, 3.5)

        # 2. Xử lý nút switch profile trên UI nếu Facebook còn lưu context trên giao diện
        switch_locators = [
            '//div[@role="button" and (contains(., "Chuyển sang") or contains(., "Switch to") or contains(., "Chuyển về") or contains(., "Chuyển ngay") or contains(., "Switch now"))]',
            '//div[contains(@aria-label, "Chuyển sang") or contains(@aria-label, "Switch to")]',
            '//span[contains(text(), "Chuyển sang") or contains(text(), "Switch to")]/ancestor::div[@role="button"]',
        ]
        for loc in switch_locators:
            try:
                btns = driver.find_elements(By.XPATH, loc)
                for b in btns:
                    if b.is_displayed():
                        logger.info(f"[{uid}] Tìm thấy nút chuyển về profile cá nhân ({loc}). Đang click...")
                        try:
                            b.click()
                        except Exception:
                            driver.execute_script("arguments[0].click();", b)
                        human_sleep(2.5, 4.0)
                        break
            except Exception:
                pass

        return True
    except Exception as e:
        logger.warning(f"[{uid}] ensure_personal_profile exception: {e}")
        return False


def _try_cookie_login(driver: webdriver.Chrome, cookie_string: str) -> bool:
    """
    Thử đăng nhập bằng cookie.
    Returns: True nếu thành công.
    """
    logger.info("Attempting cookie login...")
    load_cookies(driver, cookie_string)
    driver.refresh()
    human_sleep(2.0, 3.5)
    _handle_post_login_popups(driver)
    return _check_logged_in(driver)


def _handle_2fa(driver: webdriver.Chrome, two_fa_secret: str) -> bool:
    """
    Xử lý màn hình 2FA tự động:
      - Nếu đã có ô nhập mã 2FA: Điền TOTP và chỉ bấm đúng nút Continue của form 2FA.
      - Nếu chưa có ô nhập mã (màn hình chọn phương thức): Thử 'Try another way' -> 'Authentication app' -> 'Continue'.
      - Tự động xử lý 'Trust this device' / 'Lưu trình duyệt' và 'Dismiss' popup.
    Returns: True nếu pass được 2FA.
    """
    logger.info("Detected 2FA screen, generating TOTP...")

    # ── 1. Kiểm tra xem ô nhập mã 2FA đã có sẵn trên màn hình chưa ──
    has_input = False
    for loc in LOGIN.get("two_fa_input", []):
        try:
            elements = driver.find_elements(By.XPATH, loc)
            if any(el.is_displayed() for el in elements):
                has_input = True
                break
        except Exception:
            pass

    # Chỉ khi chưa có ô nhập mã mới thử bấm 'Try another way'
    if not has_input:
        try:
            try_other_el = None
            for loc in LOGIN.get("try_another_way_button", []):
                elements = driver.find_elements(By.XPATH, loc)
                for el in elements:
                    if el.is_displayed():
                        try_other_el = el
                        break
                if try_other_el:
                    break

            if try_other_el:
                logger.info("Found 'Try another way' option. Clicking...")
                try:
                    try_other_el.click()
                except Exception:
                    driver.execute_script("arguments[0].click();", try_other_el)
                human_sleep(1.5, 2.5)

                # ── 2. Chọn "Authentication app" ──
                auth_app_el = None
                for loc in LOGIN.get("auth_app_option", []):
                    elements = driver.find_elements(By.XPATH, loc)
                    for el in elements:
                        if el.is_displayed():
                            auth_app_el = el
                            break
                    if auth_app_el:
                        break

                if auth_app_el:
                    logger.info("Found 'Authentication app' option. Selecting...")
                    try:
                        auth_app_el.click()
                    except Exception:
                        driver.execute_script("arguments[0].click();", auth_app_el)
                    human_sleep(1.0, 2.0)

                # ── 3. Bấm "Continue" trong popup chọn phương thức ──
                cont_el = None
                for loc in LOGIN.get("continue_button", []):
                    elements = driver.find_elements(By.XPATH, loc)
                    for el in elements:
                        if el.is_displayed():
                            cont_el = el
                            break
                    if cont_el:
                        break

                if cont_el:
                    logger.info("Clicking 'Continue' button after selecting Authentication app...")
                    try:
                        cont_el.click()
                    except Exception:
                        driver.execute_script("arguments[0].click();", cont_el)
                    human_sleep(2.0, 3.5)

        except Exception as try_err:
            logger.info(f"Try another way flow check note: {try_err}")

    # ── 4. Nhập mã 2FA TOTP ──
    otp_code = generate_totp(two_fa_secret)

    try:
        otp_input = wait_and_find(driver, LOGIN["two_fa_input"], timeout=12)
        try:
            otp_input.clear()
        except Exception:
            pass
        human_type(otp_input, otp_code)
        human_sleep(0.5, 1.2)

        # ── 5. Tìm và bấm nút 'Continue' (Tiếp tục) cho 2FA ──
        submit_btn = None
        start_wait = time.time()
        while time.time() - start_wait < 6.0:
            for loc in LOGIN.get("two_fa_submit", []):
                try:
                    elements = driver.find_elements(By.XPATH, loc)
                    for el in elements:
                        if el.is_displayed():
                            submit_btn = el
                            break
                    if submit_btn:
                        break
                except Exception:
                    pass
            # Nếu tìm thấy nút và React đã kích hoạt (aria-disabled != 'true')
            if submit_btn:
                if submit_btn.get_attribute("aria-disabled") != "true":
                    break
            time.sleep(0.3)

        if not submit_btn:
            submit_btn = wait_and_find(driver, LOGIN["two_fa_submit"], timeout=4)

        logger.info("Clicking 2FA 'Continue' submit button...")
        clicked = False
        try:
            submit_btn.click()
            clicked = True
        except Exception as click_err:
            logger.debug(f"Direct click on 2FA Continue button failed: {click_err}")

        if not clicked:
            try:
                driver.execute_script("arguments[0].click();", submit_btn)
                clicked = True
            except Exception as js_err:
                logger.debug(f"JS click on 2FA Continue button failed: {js_err}")

        # Dispatch click event & fallback Enter
        try:
            driver.execute_script("""
                var btn = arguments[0];
                if (btn) {
                    btn.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, view: window}));
                    btn.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, cancelable: true, view: window}));
                    btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
                }
            """, submit_btn)
        except Exception:
            pass

        try:
            from selenium.webdriver.common.keys import Keys
            otp_input.send_keys(Keys.ENTER)
        except Exception:
            pass

        human_sleep(2.5, 4.0)

        # ── 6. Kiểm tra và xử lý màn hình Trust this device / Lưu trình duyệt (nếu có) ──
        _handle_trust_device_screen(driver)

        _handle_post_login_popups(driver)
        return _check_logged_in(driver)
    except TimeoutException:
        logger.warning("2FA input not found after handling 2FA flow")
        return False


def _is_2fa_required(driver: webdriver.Chrome) -> bool:
    """Kiểm tra có màn hình 2FA không."""
    # 1. Kiểm tra có ô nhập mã 2FA không
    try:
        for loc in LOGIN.get("two_fa_input", []):
            elements = driver.find_elements(By.XPATH, loc)
            if any(el.is_displayed() for el in elements):
                return True
    except Exception:
        pass

    # 2. Kiểm tra element 2FA (label Code / approvals_code)
    try:
        els = driver.find_elements(
            By.XPATH,
            '//input[@id="approvals_code"] | //label[normalize-space(text())="Code" or normalize-space(text())="Mã"] | //input[@autocomplete="one-time-code"]'
        )
        if any(el.is_displayed() for el in els):
            return True
    except Exception:
        pass

    # 3. Kiểm tra nút "Try another way" hoặc "Authentication app"
    try:
        els = driver.find_elements(
            By.XPATH,
            '//span[contains(text(),"Try another way") or contains(text(),"Thử phương thức khác") or contains(text(),"Authentication app") or contains(text(),"Ứng dụng xác thực")]'
        )
        if any(el.is_displayed() for el in els):
            return True
    except Exception:
        pass

    url = (driver.current_url or "").lower()
    return "two_step" in url or "approvals" in url or "two_factor" in url


def _handle_trust_device_screen(driver: webdriver.Chrome, max_wait_sec: float = 7.0) -> bool:
    """
    Tự động kiểm tra và click màn hình 'Trust this device' / 'Lưu trình duyệt'
    sau khi xác thực 2FA. Nếu không xuất hiện màn hình này thì tự động bỏ qua.
    """
    start_time = time.time()
    clicked = False

    while time.time() - start_time < max_wait_sec:
        current_url = driver.current_url or ""
        parsed = urlparse(current_url)

        # Nếu đã ra khỏi 2FA và có session hợp lệ -> không có màn hình trust device
        if "remember_browser" not in current_url and not parsed.path.lower().startswith("/two_factor"):
            if _check_logged_in(driver):
                logger.info("Phiên đã đăng nhập thành công ngoài 2FA, bỏ qua bước Trust this device.")
                return True

        # Tìm nút Trust this device
        try:
            for loc in LOGIN.get("trust_device_button", []):
                elements = driver.find_elements(By.XPATH, loc)
                for el in elements:
                    if el.is_displayed():
                        logger.info("Phát hiện màn hình 'Trust this device' (Lưu trình duyệt). Đang click...")
                        try:
                            el.click()
                        except Exception:
                            driver.execute_script("arguments[0].click();", el)
                        human_sleep(2.0, 3.5)
                        clicked = True
                        break
                if clicked:
                    break
        except Exception as e:
            logger.debug(f"Trust device check note: {e}")

        if clicked:
            break
        time.sleep(0.5)

    # Đợi điều hướng sau khi click
    nav_start = time.time()
    while time.time() - nav_start < 8.0:
        cur_url = driver.current_url or ""
        parsed = urlparse(cur_url)
        has_c_user = any(cookie.get("name") == "c_user" and cookie.get("value") for cookie in driver.get_cookies())

        # Nếu đã có c_user nhưng mạng/SPA bị treo tại /two_factor
        if has_c_user and parsed.path.lower().startswith("/two_factor"):
            if time.time() - nav_start >= 3.0:
                logger.info("Đã có cookie c_user nhưng URL vẫn ở /two_factor. Đang chủ động điều hướng về trang chủ...")
                driver.get(FB_HOME)
                human_sleep(2.0, 3.0)
                break

        if not parsed.path.lower().startswith(("/two_factor", "/two_step", "/approvals", "/login")):
            break
        time.sleep(0.5)

    return clicked


def _handle_post_login_popups(driver: webdriver.Chrome, max_wait_sec: float = 3.0) -> bool:
    """
    Tự động bắt và click popup 'Dismiss' / 'Bỏ qua' nếu xuất hiện sau khi đăng nhập.
    Bắt element:
    <div role="none" class="x1ja2u2z ..."><span ...><span ...>Dismiss</span></span></div>
    """
    clicked = False
    start_time = time.time()
    while time.time() - start_time < max_wait_sec:
        try:
            for locator in LOGIN.get("dismiss_button", []):
                elements = driver.find_elements(By.XPATH, locator)
                for el in elements:
                    if el.is_displayed():
                        logger.info("Found post-login 'Dismiss' popup. Clicking...")
                        try:
                            el.click()
                        except Exception:
                            driver.execute_script("arguments[0].click();", el)
                        human_sleep(1.0, 2.0)
                        clicked = True
                        break
                if clicked:
                    break
        except Exception as e:
            logger.info(f"Post-login Dismiss check note: {e}")
        if clicked:
            break
        time.sleep(0.5)
    return clicked


def _clean_profile_name(text: str) -> str:
    """Loại bỏ các chuỗi giao diện FB không phải tên người dùng."""
    if not text:
        return ""
    cleaned = text.strip()
    ignore_labels = {
        "facebook", "home", "trang chủ", "menu", "bạn bè", "nhóm", "group", "groups",
        "video", "watch", "marketplace", "feeds", "bảng feed", "saved", "đã lưu",
        "dismiss", "bỏ qua", "lúc khác", "not now", "log in", "đăng nhập", "close", "đóng",
        "post", "đăng", "see all", "xem tất cả", "notifications", "thông báo", "friends"
    }
    if cleaned.lower() in ignore_labels or len(cleaned) < 2:
        return ""
    lines = [l.strip() for l in cleaned.splitlines() if l.strip()]
    if lines:
        for line in lines:
            if line.lower() not in ignore_labels and len(line) >= 2:
                return line
    return cleaned


def _get_profile_name(driver: webdriver.Chrome) -> str:
    """
    Bắt element text để lấy tên profile:
    Bắt element: <span class="x1lliihq x6ikm8r x10wlt62 x1n2onr6" style="-webkit-box-orient:vertical;-webkit-line-clamp:2;display:-webkit-box">Lukito Kusuma</span>
    1. Ưu tiên tìm trực tiếp trên giao diện hiện tại (span profile_name_span).
    2. Nếu chưa thấy, điều hướng sang /me để bóc tách từ span hoặc thẻ H1.
    Returns: Tên profile hoặc chuỗi rỗng nếu thất bại.
    """
    # ── Cách 1: Tìm trực tiếp span tên trên màn hình hiện tại ──
    try:
        for locator in LOGIN.get("profile_name_span", []):
            elements = driver.find_elements(By.XPATH, locator)
            for el in elements:
                if el.is_displayed():
                    name = _clean_profile_name(el.text)
                    if name:
                        logger.info(f"Found profile name on current page: '{name}'")
                        return name
    except Exception as err:
        logger.info(f"Current page profile name extraction note: {err}")

    # ── Cách 2: Truy cập /me để bóc tách tên ──
    try:
        driver.get(FB_ME)
        human_sleep(2.5, 4.0)
        if not _check_logged_in(driver):
            return ""

        # Đóng popup Dismiss nếu có
        _handle_post_login_popups(driver, max_wait_sec=1.5)

        # Thử tìm từ profile_name_span
        for locator in LOGIN.get("profile_name_span", []):
            try:
                el = WebDriverWait(driver, 4).until(
                    EC.presence_of_element_located((By.XPATH, locator))
                )
                name = _clean_profile_name(el.text)
                if name:
                    return name
            except TimeoutException:
                continue

        # Fallback qua thẻ H1
        for locator in LOGIN.get("profile_name_h1", ["//h1"]):
            try:
                h1 = WebDriverWait(driver, 3).until(
                    EC.presence_of_element_located((By.XPATH, locator))
                )
                name = _clean_profile_name(h1.text)
                if name:
                    return name
            except TimeoutException:
                continue
    except Exception as e:
        logger.warning(f"Failed to get profile name: {e}")

    return ""


def _valid_avatar_url(url) -> bool:
    if not isinstance(url, str):
        return False
    parsed = urlparse(url)
    host = parsed.hostname or ""
    return (parsed.scheme == "https" and host.endswith(".fbcdn.net")
            and not host.startswith("static.") and "rsrc.php" not in parsed.path.lower())


def _read_profile_link_avatar(driver, uid: str, profile_data=None) -> str | None:
    """Read the homepage profile shortcut's SVG without following its link."""
    from ..utils.facebook_profile_status import _points_to_uid

    for anchor in driver.find_elements(By.CSS_SELECTOR, f'a[href*="profile.php"], a[href*="{uid}"]'):
        try:
            if not anchor.is_displayed() or not _points_to_uid(anchor.get_attribute("href") or "", uid):
                continue
            # This homepage shortcut contains both the displayed name and SVG.
            text = anchor.text
            if profile_data is not None and isinstance(text, str):
                name = _clean_profile_name(text)
                if name and not profile_data.get("profile_name"):
                    profile_data["profile_name"] = name
            for image in anchor.find_elements(By.XPATH, ".//*[local-name()='svg']//*[local-name()='image']"):
                url = image.get_attribute("xlink:href") or image.get_attribute("href")
                if _valid_avatar_url(url):
                    return url
        except Exception:
            continue
    return None


def _get_avatar_url(driver, uid: str, profile_data=None) -> str | None:
    """Read the homepage UID shortcut SVG, falling back to the account menu."""
    original_timeout = None
    deadline = time.monotonic() + 10
    try:
        cookie = driver.get_cookie("c_user")
        if not isinstance(cookie, dict) or cookie.get("value") != uid:
            return None
        original_timeout = driver.timeouts.page_load
        driver.set_page_load_timeout(10)
        switched_profile = bool(driver.get_cookie("i_user"))
        if switched_profile:
            driver.delete_cookie("i_user")

        def read_avatar(current):
            if not _check_logged_in(current):
                return False
            page_cookie = current.get_cookie("i_user")
            if isinstance(page_cookie, dict) and page_cookie.get("value") not in (None, "", uid):
                return False
            profile_avatar = _read_profile_link_avatar(current, uid, profile_data)
            if profile_avatar:
                return profile_avatar
            # Facebook renders the account menu with an SVG <image xlink:href>.
            urls = current.execute_script("""
                const selectors = [
                  '[aria-label="Your profile"]',
                  '[aria-label="Account"]',
                  '[aria-label="Trang cá nhân của bạn"]',
                  '[aria-label="Tài khoản"]'
                ];
                const named = Array.from(document.querySelectorAll(selectors.join(',')))
                  .filter(el => el.getClientRects().length)
                  .flatMap(el => Array.from(el.querySelectorAll('svg image')));
                // Some Facebook layouts omit the account label/role. The 36px
                // circular SVG in the header is the account avatar, not feed media.
                const header = Array.from(document.querySelectorAll('[role="banner"] svg image, header svg image'))
                  .filter(el => {
                    const svg = el.closest('svg');
                    const rect = svg.getBoundingClientRect();
                    return rect.width >= 35 && rect.width <= 37
                      && rect.height >= 35 && rect.height <= 37
                      && svg.querySelector('mask circle');
                  });
                const candidates = named.length ? named : [...new Set(header)];
                const urls = candidates.map(el => el.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
                    || el.getAttribute('href') || el.getAttribute('xlink:href'));
                const unique = [...new Set(urls.filter(Boolean))];
                return unique.length === 1 ? unique : [];
            """)
            for url in urls or []:
                if _valid_avatar_url(url):
                    return url
            return False

        on_homepage = urlparse(driver.current_url or "").path.rstrip("/") in ("", "/home.php")
        if not switched_profile and on_homepage:
            avatar = read_avatar(driver)
            if avatar:
                return avatar
        # Name extraction may have visited /me. Read the avatar only on home;
        # the profile shortcut href identifies the account and is never opened.
        driver.set_page_load_timeout(max(0.1, deadline - time.monotonic()))
        try:
            driver.get(FB_HOME)
        except TimeoutException:
            pass  # The header may already be available despite a slow feed.
        remaining = deadline - time.monotonic()
        avatar = read_avatar(driver)
        if avatar:
            return avatar
        if remaining > 0:
            return WebDriverWait(driver, remaining, poll_frequency=0.25).until(read_avatar)
    except Exception:
        pass
    finally:
        if original_timeout is not None:
            try:
                driver.set_page_load_timeout(original_timeout)
            except Exception:
                pass
    return None


def _get_account_identity(driver, uid: str) -> dict:
    """Collect name and avatar together from the homepage account shortcut."""
    identity = {"profile_name": "", "avatar_url": None}
    identity["avatar_url"] = _get_avatar_url(driver, uid, identity)
    # Preserve the existing name fallback only when the shortcut has no name.
    if not identity["profile_name"]:
        identity["profile_name"] = _get_profile_name(driver)
    return identity


def run_login(uid: str, password: str, two_fa: str = None, cookie: str = None, proxy: str = None) -> dict:
    """
    Thực thi toàn bộ luồng đăng nhập cho một tài khoản.
    Args:
        uid: UID / Email đăng nhập Facebook.
        password: Mật khẩu plaintext (đã giải mã AES từ DB).
        two_fa: Secret key 2FA (Base32), None nếu không có.
        cookie: Cookie string, None nếu không có.
        proxy: Chuỗi Proxy (None nếu không dùng).
    Returns:
        dict với keys: success (bool), profile_name (str), error (str)
    """
    result = {"success": False, "profile_name": "", "avatar_url": None, "error": ""}
    driver = None

    try:
        driver = create_driver(uid, proxy=proxy, scope="login")
        driver.get(FB_HOME)
        human_sleep(2.0, 3.5)

        if _check_logged_in(driver):
            result["success"] = True
            return result

        # ── Bước 1: Thử cookie login ──
        if cookie and cookie.strip():
            if _try_cookie_login(driver, cookie):
                _handle_post_login_popups(driver)
                if not _check_logged_in(driver):
                    result["error"] = f"Checkpoint or profile unavailable, URL: {driver.current_url}"
                    return result
                logger.info(f"[{uid}] Cookie login SUCCESS")
                result["success"] = True
                return result
            if is_checkpoint_url(driver.current_url or ""):
                result["error"] = f"Checkpoint, URL: {driver.current_url}"
                return result
            logger.info(f"[{uid}] Cookie expired, falling back to form login")

        # ── Bước 2: Form login ──
        if not password:
            result["error"] = "No usable password and no authenticated cookie session"
            return result
        driver.get(FB_HOME)
        human_sleep(2.0, 3.5)

        _handle_saved_account_screen(driver)

        email_el = wait_and_find(driver, LOGIN["email_input"])
        human_type(email_el, uid)
        human_sleep(0.3, 0.8)

        pass_el = wait_and_find(driver, LOGIN["password_input"])
        human_type(pass_el, password)
        human_sleep(0.5, 1.2)

        # ── Nhấn nút Đăng Nhập (với fallback Enter / JS Click) ──
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
            logger.info(f"[{uid}] Login button XPath not clicked directly: {err}. Sending ENTER key...")

        if not clicked:
            from selenium.webdriver.common.keys import Keys
            pass_el.send_keys(Keys.ENTER)

        human_sleep(4.0, 6.0)

        # ── Bước 3: Xử lý 2FA nếu cần hoặc Checkpoint ──
        if _is_2fa_required(driver):
            if two_fa:
                if not _handle_2fa(driver, two_fa):
                    result["error"] = f"Checkpoint, URL: {driver.current_url}" if is_checkpoint_url(driver.current_url or "") else "2FA authentication failed"
                    return result
            else:
                result["error"] = "2FA required but no secret key provided"
                return result
        elif is_checkpoint_url(driver.current_url or ""):
            result["error"] = f"Checkpoint, URL: {driver.current_url}"
            return result

        # ── Bước 4: Kiểm tra đăng nhập thành công & bắt Dismiss popup ──
        human_sleep(2.0, 3.0)
        _handle_post_login_popups(driver)

        if not _check_logged_in(driver):
            _handle_post_login_popups(driver)
            if not _check_logged_in(driver):
                current_url = driver.current_url
                result["error"] = f"Login failed, URL: {current_url}"
                return result

        # ── Bước 5: Bắt Dismiss popup; identity được lấy chung ở finally ──
        _handle_post_login_popups(driver)
        if not _check_logged_in(driver):
            result["error"] = f"Checkpoint or profile unavailable, URL: {driver.current_url}"
            return result
        result["success"] = True
        logger.info(f"[{uid}] Login SUCCESS")

    except Exception as e:
        logger.exception(f"[{uid}] Unexpected error during login: {e}")
        result["error"] = str(e)
    finally:
        if driver:
            from ..automation.browser_manager import unregister_active_driver, extract_cookies_as_string, safe_close_driver
            unregister_active_driver(driver)
            if result.get("success"):
                try:
                    result.update(_get_account_identity(driver, uid))
                    if not _check_logged_in(driver):
                        result["success"] = False
                        result["error"] = "Checkpoint or session unavailable after identity extraction"
                except Exception:
                    logger.warning("Could not collect account identity for UID %s", uid, exc_info=True)
            if result.get("success"):
                try:
                    result["cookie"] = extract_cookies_as_string(driver)
                except Exception:
                    pass
            try:
                # Về trang chủ để sync session trước khi đóng
                driver.get(FB_HOME)
                time.sleep(2)
                driver.quit()
            except Exception:
                safe_close_driver(driver)

    return result


def ensure_logged_in(
    driver: webdriver.Chrome,
    uid: str,
    password: str = "",
    two_fa: str = None,
    cookie: str = None,
) -> dict:
    """
    Đảm bảo driver hiện tại đang có phiên đăng nhập Facebook hợp lệ.
    Nếu phiên còn sống: Trả về success ngay trong 1-2 giây.
    Nếu phiên bị hết hạn / văng ra trang login: Tự động đăng nhập lại (Cookie hoặc Form + 2FA).
    Không đóng trình duyệt driver khi hoàn tất.
    """
    result = {"success": False, "error": "", "reloaded": False}

    def _sync_fresh_cookie():
        try:
            from ..automation.browser_manager import extract_cookies_as_string
            fresh_c = extract_cookies_as_string(driver)
            if fresh_c and "c_user" in fresh_c:
                from ..database.connection import SessionLocal
                from ..database.repository import AccountRepository as AccountRepo
                with SessionLocal() as _db:
                    AccountRepo.update_cookies(_db, uid, fresh_c)
                    AccountRepo.update_login_status(_db, uid, "logged_in")
        except Exception:
            pass

    try:
        current_url = (driver.current_url or "").lower()
        if "facebook.com" in current_url and not any(k in current_url for k in ["/login", "checkpoint", "two_step"]):
            if _check_logged_in(driver):
                ensure_personal_profile(driver, uid)
                _sync_fresh_cookie()
                result["success"] = True
                return result
        else:
            driver.get(FB_HOME)
            # Chờ tối đa 6-8 giây cho phiên Facebook load xong cookie qua proxy
            for _ in range(5):
                human_sleep(1.0, 1.5)
                if _check_logged_in(driver):
                    ensure_personal_profile(driver, uid)
                    _sync_fresh_cookie()
                    result["success"] = True
                    return result
    except Exception as e:
        logger.debug(f"[{uid}] Quick session check exception: {e}")

    logger.info(f"[{uid}] Phiên đăng nhập chưa active trên driver. Đang tiến hành đăng nhập lại...")
    result["reloaded"] = True

    # 1. Thử login bằng cookie nếu có
    if cookie and cookie.strip():
        if _try_cookie_login(driver, cookie):
            logger.info(f"[{uid}] Đăng nhập lại bằng Cookie THÀNH CÔNG trong ensure_logged_in")
            _handle_post_login_popups(driver)
            ensure_personal_profile(driver, uid)
            _sync_fresh_cookie()
            result["success"] = True
            return result
        logger.info(f"[{uid}] Cookie hết hạn hoặc không hợp lệ, chuyển sang form login")

    # 2. Thử login bằng tài khoản mật khẩu
    if not password:
        result["error"] = "Tài khoản bị mất phiên đăng nhập và không có mật khẩu để tự động login"
        return result

    try:
        driver.get(FB_HOME)
        human_sleep(2.0, 3.5)

        _handle_saved_account_screen(driver)

        email_el = wait_and_find(driver, LOGIN["email_input"], timeout=8)
        human_type(email_el, uid)
        human_sleep(0.3, 0.8)

        pass_el = wait_and_find(driver, LOGIN["password_input"], timeout=8)
        human_type(pass_el, password)
        human_sleep(0.5, 1.2)

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
            logger.info(f"[{uid}] Click login btn fallback enter: {err}")

        if not clicked:
            from selenium.webdriver.common.keys import Keys
            pass_el.send_keys(Keys.ENTER)

        human_sleep(4.0, 6.0)

        # Xử lý 2FA nếu có
        if _is_2fa_required(driver):
            if two_fa:
                if not _handle_2fa(driver, two_fa):
                    result["error"] = "Xác thực mã 2FA thất bại"
                    return result
            else:
                result["error"] = "Facebook yêu cầu mã 2FA nhưng tài khoản chưa có Secret Key 2FA"
                return result
        elif is_checkpoint_url(driver.current_url or ""):
            result["error"] = f"Checkpoint, URL: {driver.current_url}"
            return result

        human_sleep(2.0, 3.0)
        _handle_post_login_popups(driver)

        if _check_logged_in(driver):
            ensure_personal_profile(driver, uid)
            _sync_fresh_cookie()
            result["success"] = True
            logger.info(f"[{uid}] Tự động đăng nhập lại THÀNH CÔNG")
            return result
        else:
            _handle_post_login_popups(driver)
            if _check_logged_in(driver):
                ensure_personal_profile(driver, uid)
                _sync_fresh_cookie()
                result["success"] = True
                return result
            current_url = driver.current_url
            result["error"] = f"Đăng nhập thất bại (URL: {current_url})"
            return result
    except Exception as e:
        logger.exception(f"[{uid}] Lỗi khi tự động đăng nhập trong ensure_logged_in: {e}")
        result["error"] = str(e)
        return result
