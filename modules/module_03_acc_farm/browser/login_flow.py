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
from typing import Optional
from urllib.parse import urlparse
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

from core.browser import extract_cookies_as_string, human_sleep, human_type, load_cookies, wait_and_find
from modules.module_03_acc_farm.browser.locators import LOGIN
from modules.module_03_acc_farm.browser.otp import generate_totp

logger = logging.getLogger(__name__)

FB_HOME = "https://www.facebook.com"
FB_ME = "https://www.facebook.com/me"

CHECKPOINT_LIGHT = "light"
CHECKPOINT_HEAVY = "heavy"
_CHECKPOINT_LABELS = {CHECKPOINT_LIGHT: "nhẹ", CHECKPOINT_HEAVY: "nặng"}
# Đầu chuỗi lỗi của checkpoint nặng, dùng để tra lịch sử cảnh báo cụm nick trên cùng máy
HEAVY_CHECKPOINT_PREFIX = "Checkpoint nặng"


def is_checkpoint_url(url: str) -> bool:
    """A checkpoint page is a failed login, even when Facebook set c_user."""
    path = urlparse(url).path.lower()
    return path == "/checkpoint" or path.startswith("/checkpoint/")


def checkpoint_kind(driver: webdriver.Chrome) -> Optional[str]:
    """
    None nếu không ở trang checkpoint.
    "light" nếu trang có nút Dismiss / Bỏ qua (Facebook cho bỏ qua), còn lại "heavy" (bắt xác minh: captcha, selfie...).
    Phân loại theo nội dung trang thay vì mã checkpoint để Facebook đổi mã vẫn nhận đúng.
    """
    try:
        if not is_checkpoint_url(driver.current_url or ""):
            return None
    except Exception:
        return None
    return CHECKPOINT_LIGHT if _visible_login_element(driver, LOGIN["dismiss_button"]) else CHECKPOINT_HEAVY


def checkpoint_message(kind: str, url: str) -> str:
    """Ví dụ: "Checkpoint nặng (1501092823525282), URL: https://www.facebook.com/checkpoint/1501092823525282/"."""
    parts = urlparse(url).path.strip("/").split("/")
    code = f" ({parts[1]})" if len(parts) > 1 and parts[1] else ""
    return f"Checkpoint {_CHECKPOINT_LABELS.get(kind, 'nặng')}{code}, URL: {url.split('?')[0]}"


def _on_checkpoint(driver) -> bool:
    try:
        return driver is not None and is_checkpoint_url(driver.current_url or "")
    except Exception:
        return False


def _checkpoint_failure(driver: webdriver.Chrome, result: dict) -> dict:
    """Ghi lỗi checkpoint (có phân loại) vào result của luồng đăng nhập."""
    kind = checkpoint_kind(driver) or CHECKPOINT_HEAVY
    result["checkpoint"] = kind
    result["error"] = checkpoint_message(kind, driver.current_url or "")
    return result


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

        # Quét XPath màn chọn tài khoản tốn hơn đọc cookie nên để sau
        if _visible_login_element(driver, LOGIN["saved_account_switch"]):
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


def _visible_login_element(driver: webdriver.Chrome, locators: list):
    for locator in locators:
        try:
            for element in driver.find_elements(By.XPATH, locator):
                if element.is_displayed():
                    return element
        except WebDriverException:
            continue
    return None


def _visible_2fa_input(driver: webdriver.Chrome):
    """Chỉ nhận ô mã xác thực; loại ô email/mật khẩu dù locator trả nhầm."""
    for locator in LOGIN["two_fa_input"]:
        try:
            for element in driver.find_elements(By.XPATH, locator):
                if not element.is_displayed():
                    continue
                attrs = {}
                for name in ("id", "name", "type", "autocomplete", "placeholder", "aria-label"):
                    value = element.get_attribute(name)
                    attrs[name] = value.casefold() if isinstance(value, str) else ""
                if attrs["type"] in {"email", "password"}:
                    continue
                if attrs["id"] in {"email", "pass", "password"} or attrs["name"] in {"email", "pass", "password"}:
                    continue
                if attrs["autocomplete"] in {"email", "username", "current-password"}:
                    continue
                if any(word in attrs["placeholder"] or word in attrs["aria-label"]
                       for word in ("email or phone", "email address", "số điện thoại hoặc email")):
                    continue
                return element
        except WebDriverException:
            continue
    return None


def _wait_for_2fa_input(driver: webdriver.Chrome, timeout: float = 12):
    start = time.time()
    while time.time() - start < timeout:
        element = _visible_2fa_input(driver)
        if element:
            return element
        time.sleep(0.4)
    raise TimeoutException("Không tìm thấy ô nhập mã 2FA hợp lệ")


def _advance_saved_account_chooser(driver: webdriver.Chrome, uid: str, expected_name: str = "") -> bool:
    """Chỉ chọn tài khoản đã lưu khi tên hoặc c_user khớp nick cần đăng nhập."""
    if _visible_login_element(driver, LOGIN["password_input"]) or _is_2fa_required(driver):
        return False
    if not _visible_login_element(driver, LOGIN["saved_account_switch"]):
        return False

    body_text = driver.execute_script("return document.body ? document.body.innerText : '';")
    name_matches = bool(expected_name and isinstance(body_text, str)
                        and expected_name.strip().casefold() in body_text.casefold())
    user_cookie = driver.get_cookie("c_user")
    if isinstance(user_cookie, dict) and user_cookie.get("value") \
            and user_cookie["value"] != str(uid):
        raise RuntimeError("Cookie của tài khoản đã lưu không khớp UID cần đăng nhập")
    uid_matches = isinstance(user_cookie, dict) and user_cookie.get("value") == str(uid)
    if not (name_matches or uid_matches):
        raise RuntimeError("Không xác nhận được tài khoản đã lưu đúng với UID cần đăng nhập")

    button = _visible_login_element(driver, LOGIN["saved_account_continue"])
    if not button:
        raise RuntimeError("Không tìm thấy nút Tiếp tục của tài khoản đã lưu")
    logger.info("[%s] Đã nhận diện tài khoản lưu trên Facebook; chọn Tiếp tục", uid)
    try:
        button.click()
    except WebDriverException:
        driver.execute_script("arguments[0].click();", button)
    try:
        _wait_after_saved_account_continue(driver, timeout=5)
    except TimeoutException:
        logger.info("[%s] Nút Tiếp tục chưa chuyển trang; thử click trực tiếp vào vị trí nút", uid)
        point = driver.execute_script(
            "const r = arguments[0].getBoundingClientRect();"
            "return {x: r.left + r.width / 2, y: r.top + r.height / 2};", button
        )
        if not point:
            raise
        for event in ("mouseMoved", "mousePressed", "mouseReleased"):
            driver.execute_cdp_cmd("Input.dispatchMouseEvent", {
                "type": event, "x": point["x"], "y": point["y"],
                "button": "left", "clickCount": 1,
            })
        _wait_after_saved_account_continue(driver)
    return True


def _wait_after_saved_account_continue(driver: webdriver.Chrome, timeout: float = 15) -> None:
    """Đợi Facebook chuyển khỏi màn hình chọn nick trước khi quyết định bước đăng nhập."""
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        if is_checkpoint_url(driver.current_url or ""):
            return
        if _is_2fa_required(driver):
            return
        if _visible_login_element(driver, LOGIN["password_input"]):
            return
        if _visible_login_element(driver, LOGIN["email_input"][:-1]):
            return
        # Facebook có thể giữ nút đổi tài khoản trong DOM phía sau form mật khẩu.
        if _visible_login_element(driver, LOGIN["saved_account_switch"]):
            time.sleep(0.5)
            continue
        # c_user có thể xuất hiện tạm thời trước khi trang chuyển sang 2FA.
        if time.monotonic() - start >= 10 and _check_logged_in(driver):
            return
        time.sleep(0.5)
    raise TimeoutException("Facebook chưa chuyển khỏi màn hình chọn tài khoản")


def _submit_login_form(driver: webdriver.Chrome, uid: str, password: str,
                       expected_name: str = "") -> None:
    """Đi qua màn hình chọn tài khoản, rồi nhập form UID hoặc form chỉ có mật khẩu."""
    _advance_saved_account_chooser(driver, uid, expected_name)
    if _check_logged_in(driver) or _is_2fa_required(driver):
        return

    email_el = _visible_login_element(driver, LOGIN["email_input"][:-1])
    if email_el:
        human_type(email_el, uid)
        human_sleep(0.3, 0.8)
    elif not _visible_login_element(driver, LOGIN["password_input"]):
        email_el = wait_and_find(driver, LOGIN["email_input"], timeout=8)
        human_type(email_el, uid)
        human_sleep(0.3, 0.8)

    pass_el = wait_and_find(driver, LOGIN["password_input"], timeout=8)
    human_type(pass_el, password)
    human_sleep(0.5, 1.2)

    try:
        login_btn = wait_and_find(driver, LOGIN["login_button"], timeout=5)
        try:
            login_btn.click()
        except WebDriverException:
            driver.execute_script("arguments[0].click();", login_btn)
    except TimeoutException:
        from selenium.webdriver.common.keys import Keys
        pass_el.send_keys(Keys.ENTER)
    _wait_after_password_submit(driver)


def _wait_after_password_submit(driver: webdriver.Chrome, timeout: float = 15) -> None:
    """Đợi form mật khẩu chuyển sang 2FA hoặc phiên đăng nhập hoàn tất."""
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        if _is_2fa_required(driver) or is_checkpoint_url(driver.current_url or ""):
            return
        if _check_logged_in(driver) and not _visible_login_element(driver, LOGIN["password_input"]):
            return
        time.sleep(0.5)
    raise TimeoutException("Facebook chưa hoàn tất bước đăng nhập bằng mật khẩu")


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
    has_input = _visible_2fa_input(driver) is not None

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
    try:
        otp_input = _wait_for_2fa_input(driver, timeout=12)
        otp_code = generate_totp(two_fa_secret)
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

        if not clicked:
            from selenium.webdriver.common.keys import Keys
            otp_input.send_keys(Keys.ENTER)

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
        if _visible_2fa_input(driver):
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
    for line in lines:
        if line.lower() not in ignore_labels and len(line) >= 2 and not _is_composer_prompt(line):
            return line
    return ""


# Chữ gợi ý ô đăng bài dùng chung class span với tên profile, vd "What's on your mind, Erwin?"
_COMPOSER_PROMPTS = ("what's on your mind", "bạn đang nghĩ gì", "apa yang anda pikirkan")


def _is_composer_prompt(text: str) -> bool:
    normalized = text.casefold().replace("’", "'")
    return normalized.startswith(_COMPOSER_PROMPTS)


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


def ensure_logged_in(
    driver: webdriver.Chrome,
    uid: str,
    password: str = "",
    two_fa: str = None,
    cookie: str = None,
    expected_name: str = "",
) -> dict:
    """
    Đảm bảo driver hiện tại đang có phiên đăng nhập Facebook hợp lệ.
    Nếu phiên còn sống: Trả về success ngay trong 1-2 giây.
    Nếu phiên bị hết hạn / văng ra trang login: Tự động đăng nhập lại (Cookie hoặc Form + 2FA).
    Không đóng trình duyệt driver khi hoàn tất.
    Đang ở checkpoint thì dừng ngay (không bơm cookie, không điền form), result["checkpoint"] = "light" / "heavy".
    """
    result = {"success": False, "error": "", "reloaded": False, "checkpoint": None}

    try:
        current_url = (driver.current_url or "").lower()
        if "facebook.com" not in current_url or any(k in current_url for k in ["/login", "checkpoint", "two_step"]):
            driver.get(FB_HOME)
        # Chờ tối đa 6-8 giây cho phiên Facebook load xong cookie qua proxy, kể cả khi đã đứng sẵn ở facebook.com:
        # kết luận vội "mất phiên" sẽ bơm cookie / đăng nhập lại tạo phiên mới, dễ bị FB hạn chế "multiple sessions".
        for attempt in range(5):
            if attempt:
                human_sleep(1.0, 1.5)
            if _check_logged_in(driver):
                ensure_personal_profile(driver, uid)
                # Tự động đồng bộ cookie còn sống vào database
                try:
                    fresh_c = extract_cookies_as_string(driver)
                    if fresh_c and "c_user" in fresh_c:
                        from modules.module_03_acc_farm import adapters
                        adapters.save_cookie(uid, fresh_c)
                        adapters.set_login_status(uid, "logged_in")
                except Exception:
                    pass
                result["success"] = True
                return result
            if _on_checkpoint(driver):
                break
    except Exception as e:
        logger.debug(f"[{uid}] Quick session check exception: {e}")

    # Nick đã bị Facebook khóa: bơm cookie / đăng nhập lại chỉ thêm lượt bị chặn, không mở được checkpoint
    if _on_checkpoint(driver):
        _checkpoint_failure(driver, result)
        logger.warning(f"[{uid}] {result['error']}")
        return result

    logger.info(f"[{uid}] Phiên đăng nhập chưa active trên driver. Đang tiến hành đăng nhập lại...")
    result["reloaded"] = True

    # 1. Thử login bằng cookie nếu có
    if cookie and cookie.strip():
        if _try_cookie_login(driver, cookie):
            logger.info(f"[{uid}] Đăng nhập lại bằng Cookie THÀNH CÔNG trong ensure_logged_in")
            _handle_post_login_popups(driver)
            ensure_personal_profile(driver, uid)
            result["success"] = True
            return result
        if _on_checkpoint(driver):
            return _checkpoint_failure(driver, result)
        logger.info(f"[{uid}] Cookie hết hạn hoặc không hợp lệ, chuyển sang form login")

    # 2. Thử login bằng tài khoản mật khẩu
    if not password:
        result["error"] = "Tài khoản bị mất phiên đăng nhập và không có mật khẩu để tự động login"
        return result

    try:
        driver.get(FB_HOME)
        human_sleep(2.0, 3.5)
        if _on_checkpoint(driver):
            return _checkpoint_failure(driver, result)
        _submit_login_form(driver, uid, password, expected_name)

        # Xử lý 2FA nếu có
        if _is_2fa_required(driver):
            if two_fa:
                if not _handle_2fa(driver, two_fa):
                    # Qua 2FA xong Facebook mới chuyển sang checkpoint thì không phải lỗi mã 2FA
                    if _on_checkpoint(driver):
                        return _checkpoint_failure(driver, result)
                    result["error"] = "Xác thực mã 2FA thất bại"
                    return result
            else:
                result["error"] = "Facebook yêu cầu mã 2FA nhưng tài khoản chưa có Secret Key 2FA"
                return result
        elif _on_checkpoint(driver):
            return _checkpoint_failure(driver, result)

        human_sleep(2.0, 3.0)
        _handle_post_login_popups(driver)

        if _check_logged_in(driver):
            ensure_personal_profile(driver, uid)
            result["success"] = True
            logger.info(f"[{uid}] Tự động đăng nhập lại THÀNH CÔNG")
            return result
        else:
            _handle_post_login_popups(driver)
            if _check_logged_in(driver):
                ensure_personal_profile(driver, uid)
                result["success"] = True
                return result
            if _on_checkpoint(driver):
                return _checkpoint_failure(driver, result)
            current_url = driver.current_url
            result["error"] = f"Đăng nhập thất bại (URL: {current_url})"
            return result
    except Exception as e:
        logger.exception(f"[{uid}] Lỗi khi tự động đăng nhập trong ensure_logged_in: {e}")
        if _on_checkpoint(driver):
            return _checkpoint_failure(driver, result)
        result["error"] = str(e)
        return result
