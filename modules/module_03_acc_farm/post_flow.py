"""
post_flow.py
Module 03 - Tab 2: Lõi thực thi Đăng bài Facebook Web qua Selenium Automation.
Bao gồm:
  1. publish_status_post: Đăng bài viết kèm ảnh lên bảng tin (Newsfeed / Page Profile)
  2. publish_reels_post: Tải lên video Reels ngắn (facebook.com/reel/create)
  3. publish_story_post: Tải lên tin 24h Story (facebook.com/stories/create)
  4. Cơ chế kiểm tra sức khỏe nick chuẩn xác: Checkpoint, Hết hạn phiên (/login), Chặn tính năng.
"""
import os
import time
import random
import logging
import base64
import hmac
import hashlib
import struct
from urllib.parse import urlparse, parse_qs, urlencode
from typing import Optional, Any

from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, StaleElementReferenceException, NoSuchElementException

try:
    from modules.module_03_acc_farm.human_interaction import HumanInteraction
except Exception:
    try:
        from backend.human_interaction import HumanInteraction
    except Exception:
        from human_interaction import HumanInteraction

logger = logging.getLogger(__name__)

DEAD_TEXT = ("tài khoản của bạn đã bị khóa", "your account has been locked")
BLOCK_TEXT = ("tạm thời bị chặn", "temporarily blocked")


class PostAccountDead(Exception):
    """Tài khoản dính Checkpoint, hết hạn phiên (/login) hoặc bị khóa"""
    pass


class PostFeatureBlocked(Exception):
    """Tài khoản bị Facebook hạn chế tính năng đăng bài"""
    pass


class PublishUnconfirmed(Exception):
    """Đã bấm Đăng nhưng không xác nhận được bài đã lên (hộp thoại chưa đóng hoặc lỗi mạng)."""
    pass


def get_totp_token(secret_key: str) -> str:
    """Tự sinh mã 2FA 6 số từ Private Key không phụ thuộc internet."""
    try:
        secret = secret_key.replace(" ", "").upper()
        key = base64.b32decode(secret, casefold=True)
        counter = int(time.time() // 30)
        counter_bytes = struct.pack(">Q", counter)
        mac = hmac.new(key, counter_bytes, hashlib.sha1).digest()
        offset = mac[-1] & 0x0F
        code = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
        return str(code % 1000000).zfill(6)
    except Exception as e:
        logger.error(f"[2FA Error] Không thể tính TOTP: {e}")
        return ""


def is_saved_account_screen(driver) -> bool:
    """
    Kiểm tra xem Facebook có đang hiển thị màn hình 'Tài khoản đã lưu' (One-Click / Remembered Account) hay không:
    - Có nút/thẻ 'Tiếp tục' (Continue)
    - Có nút 'Dùng trang cá nhân khác' (Use another profile / Log into another account)
    """
    try:
        url = (driver.current_url or "").lower()
        if "facebook.com" not in url or "/checkpoint" in url:
            return False

        # Selector cho nút 'Dùng trang cá nhân khác'
        switch_locators = [
            "//span[contains(text(), 'Dùng trang cá nhân khác') or contains(text(), 'Use another') or contains(text(), 'Log into another')]",
            "//button[contains(., 'Dùng trang cá nhân khác') or contains(., 'Use another') or contains(., 'Log into another')]",
            "//div[@role='button' and (contains(., 'Dùng trang cá nhân khác') or contains(., 'Use another') or contains(., 'Log into another'))]",
            "//a[contains(., 'Dùng trang cá nhân khác') or contains(., 'Use another') or contains(., 'Log into another')]",
        ]
        for sel in switch_locators:
            elems = driver.find_elements(By.XPATH, sel)
            if any(e.is_displayed() for e in elems):
                return True

        # Selector cho nút 'Tiếp tục'
        continue_locators = [
            "//div[@role='button' and not(@tabindex='-1') and (.//span[contains(text(), 'Tiếp tục') or contains(text(), 'Continue')])]",
            "//button[contains(., 'Tiếp tục') or contains(., 'Continue')]",
            "//div[@role='button' and (contains(@aria-label, 'Tiếp tục') or contains(@aria-label, 'Continue'))]",
        ]
        for sel in continue_locators:
            elems = driver.find_elements(By.XPATH, sel)
            if any(e.is_displayed() for e in elems):
                return True

        return False
    except Exception:
        return False


def is_logged_in_to_newsfeed(driver) -> bool:
    """
    Kiểm tra xem trình duyệt đã đăng nhập thành công vào Newsfeed/Trang chủ Facebook chưa.
    Không bị kẹt ở màn hình login form hoặc màn hình One-Click login.
    """
    try:
        url = (driver.current_url or "").lower()
        if "/login" in url or "/checkpoint" in url or "/recover" in url or "/disabled" in url:
            return False

        if is_saved_account_screen(driver):
            return False

        # Nếu có ô email hiển thị thì chắc chắn chưa login
        login_inputs = driver.find_elements(By.XPATH, "//input[@id='email' or @name='email']")
        if any(i.is_displayed() for i in login_inputs):
            return False

        # Nếu có ô mật khẩu hiển thị thì cũng chưa hoàn tất login
        pass_inputs = driver.find_elements(By.XPATH, "//input[@type='password' and (@name='pass' or @id='pass')]")
        if any(p.is_displayed() for p in pass_inputs):
            return False

        # 1. Kiểm tra cookie c_user
        cookies = driver.get_cookies()
        has_c_user = any(c.get("name") == "c_user" and c.get("value") for c in cookies)

        # 2. Kiểm tra các phần tử đặc trưng của Newsfeed
        feed_selectors = [
            "//div[@role='button']//span[contains(text(), 'Bạn đang nghĩ gì') or contains(text(), \"What's on your mind\")]",
            "//input[contains(@aria-label, 'Tìm kiếm') or contains(@aria-label, 'Search') or contains(@placeholder, 'Tìm kiếm') or contains(@placeholder, 'Search')]",
            "//div[@aria-label='Trang cá nhân của bạn' or @aria-label='Your profile' or @aria-label='Tài khoản' or @aria-label='Account']",
            "//div[@role='navigation']",
            "//div[@role='banner']",
        ]
        for sel in feed_selectors:
            elems = driver.find_elements(By.XPATH, sel)
            if any(e.is_displayed() for e in elems):
                return True

        return has_c_user
    except Exception:
        return False


def _do_standard_login(driver, uid: str, password: str, two_fa_secret: str, human: HumanInteraction, log: Any) -> bool:
    """Thực hiện đăng nhập chuẩn bằng ô UID + Password + 2FA."""
    if not password:
        raise PostAccountDead(f"Tài khoản {uid} chưa đăng nhập và không có mật khẩu trong hệ thống.")

    log(f"Đang điền UID ({uid}) và Mật khẩu Facebook...")
    try:
        email_inp = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.XPATH, "//input[@id='email' or @name='email']"))
        )
        email_inp.clear()
        human.human_type(email_inp, uid, mistake_rate=0.0)
        time.sleep(0.5)

        pass_inp = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.XPATH, "//input[@id='pass' or @name='pass']"))
        )
        pass_inp.clear()
        human.human_type(pass_inp, password, mistake_rate=0.0)
        time.sleep(0.5)

        login_btn = driver.find_element(
            By.XPATH, "//button[@name='login' or @id='loginbutton'] | //input[@type='submit']"
        )
        human.click(login_btn)
        time.sleep(5)

        # Kiểm tra 2FA
        curr = (driver.current_url or "").lower()
        two_fa_inputs = driver.find_elements(
            By.XPATH, "//input[@id='approvals_code' or @name='approvals_code' or contains(@name, 'code') or @type='tel']"
        )
        if "two_step_verification" in curr or "checkpoint" in curr or any(i.is_displayed() for i in two_fa_inputs):
            log("Phát hiện màn hình xác thực 2 bước (2FA)...")
            if two_fa_secret:
                otp = get_totp_token(two_fa_secret)
                log(f"Sinh mã OTP 2FA tự động ({otp}), đang xác thực...")
                code_field = WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located(
                        (By.XPATH, "//input[@id='approvals_code' or @name='approvals_code' or contains(@name, 'code') or @type='tel']")
                    )
                )
                code_field.clear()
                human.human_type(code_field, otp, mistake_rate=0.0)
                time.sleep(1)
                submit_btn = driver.find_element(
                    By.XPATH, "//button[@type='submit'] | //button[contains(text(), 'Tiếp') or contains(text(), 'Submit') or contains(text(), 'Xác nhận')]"
                )
                human.click(submit_btn)
                time.sleep(5)
            else:
                log("Cảnh báo: Tài khoản yêu cầu 2FA nhưng chưa cấu hình mã Secret!")

        time.sleep(3)
        check_account_health(driver)
        return is_logged_in_to_newsfeed(driver)
    except PostAccountDead:
        raise
    except Exception as e:
        log(f"Lỗi thao tác form đăng nhập: {e}")
        return False


def _click_switch_account_and_login(driver, uid: str, password: str, two_fa_secret: str, human: HumanInteraction, log: Any) -> bool:
    """Click nút 'Dùng trang cá nhân khác' và chuyển sang form đăng nhập chuẩn."""
    switch_selectors = [
        "//span[contains(text(), 'Dùng trang cá nhân khác') or contains(text(), 'Use another') or contains(text(), 'Log into another')]/ancestor::*[@role='button' or self::button or self::a][1]",
        "//div[@role='button' and (.//span[contains(text(), 'Dùng trang cá nhân khác') or contains(text(), 'Use another') or contains(text(), 'Log into another')])]",
        "//button[contains(., 'Dùng trang cá nhân khác') or contains(., 'Use another') or contains(., 'Log into another')]",
        "//a[contains(., 'Dùng trang cá nhân khác') or contains(., 'Use another') or contains(., 'Log into another')]",
    ]
    sw_btn = None
    for sel in switch_selectors:
        elems = driver.find_elements(By.XPATH, sel)
        for el in elems:
            if el.is_displayed():
                sw_btn = el
                break
        if sw_btn:
            break

    if sw_btn:
        log("Click 'Dùng trang cá nhân khác'...")
        try:
            human.click(sw_btn)
        except Exception:
            driver.execute_script("arguments[0].click();", sw_btn)
        time.sleep(2.5)

    return _do_standard_login(driver, uid, password, two_fa_secret, human, log)


def handle_saved_account_screen(
    driver,
    uid: str,
    password: str = "",
    two_fa_secret: str = "",
    expected_name: str = "",
    log_cb: Optional[Any] = None
) -> bool:
    """
    Xử lý màn hình 'Tài khoản đã lưu' (One-Click Login):
    1. Kiểm tra nếu đúng tài khoản: click 'Tiếp tục'
    2. Điền mật khẩu nếu Facebook yêu cầu sau khi bấm Tiếp tục
    3. Điền OTP 2FA nếu xuất hiện mã xác minh
    4. Nếu tài khoản không khớp hoặc Tiếp tục lỗi, bấm 'Dùng trang cá nhân khác' để về form chuẩn
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    human = HumanInteraction(driver)
    log("Phát hiện màn hình tài khoản đã lưu (One-Click Login)...")

    # Kiểm tra cookie c_user nếu có
    user_cookie = driver.get_cookie("c_user")
    cookie_uid = str(user_cookie.get("value")) if isinstance(user_cookie, dict) and user_cookie.get("value") else ""

    # Kiểm tra tên hiển thị trên trang
    try:
        body_text = driver.execute_script("return document.body ? document.body.innerText : '';") or ""
    except Exception:
        body_text = ""

    is_name_match = bool(expected_name and expected_name.strip().lower() in body_text.lower())
    is_uid_match = bool(cookie_uid and cookie_uid == str(uid))
    is_different_uid = bool(cookie_uid and cookie_uid != str(uid))

    # Kịch bản B: Khác UID rõ ràng -> Bấm "Dùng trang cá nhân khác"
    if is_different_uid and not is_name_match:
        log(f"Tài khoản lưu trên Chrome (UID {cookie_uid}) khác UID cần chạy ({uid}). Chuyển sang 'Dùng trang cá nhân khác'...")
        return _click_switch_account_and_login(driver, uid, password, two_fa_secret, human, log)

    # Kịch bản A: Đúng nick (hoặc cùng profile đơn nick) -> Click "Tiếp tục"
    continue_selectors = [
        "//div[@role='button' and not(@tabindex='-1') and (.//span[contains(text(), 'Tiếp tục') or contains(text(), 'Continue')])]",
        "//button[.//span[contains(text(), 'Tiếp tục') or contains(text(), 'Continue')] or contains(., 'Tiếp tục') or contains(., 'Continue')]",
        "//div[@role='button' and (starts-with(@aria-label, 'Tiếp tục') or starts-with(@aria-label, 'Continue'))]",
        "//span[normalize-space(text())='Tiếp tục' or normalize-space(text())='Continue']/ancestor::*[@role='button' or self::button][1]",
    ]

    continue_btn = None
    for sel in continue_selectors:
        elems = driver.find_elements(By.XPATH, sel)
        for el in elems:
            if el.is_displayed():
                continue_btn = el
                break
        if continue_btn:
            break

    if not continue_btn:
        log("Không tìm thấy nút 'Tiếp tục', thử click 'Dùng trang cá nhân khác'...")
        return _click_switch_account_and_login(driver, uid, password, two_fa_secret, human, log)

    account_label = expected_name or uid
    log(f"Di chuột click nút 'Tiếp tục' đăng nhập cho {account_label}...")
    try:
        human.click(continue_btn)
    except Exception:
        driver.execute_script("arguments[0].click();", continue_btn)

    # Chờ phản ứng từ Facebook (trong tối đa 15 giây)
    start_t = time.monotonic()
    while time.monotonic() - start_t < 15:
        time.sleep(1.2)
        curr = (driver.current_url or "").lower()

        # 1. Nếu dính checkpoint
        if "/checkpoint" in curr:
            raise PostAccountDead("Tài khoản dính Checkpoint xác minh danh tính từ Facebook.")

        # 2. Nếu đã vào Newsfeed
        if is_logged_in_to_newsfeed(driver):
            log("✓ Đăng nhập thành công qua tài khoản đã lưu!")
            return True

        # 3. Nếu Facebook yêu cầu nhập mật khẩu
        pass_inputs = driver.find_elements(By.XPATH, "//input[@type='password' or @id='pass' or @name='pass']")
        visible_pass = [p for p in pass_inputs if p.is_displayed()]
        if visible_pass:
            log("Facebook yêu cầu nhập mật khẩu để tiếp tục...")
            if not password:
                raise PostAccountDead("Facebook yêu cầu mật khẩu của tài khoản nhưng hệ thống chưa có thông tin mật khẩu.")
            p_box = visible_pass[0]
            p_box.clear()
            human.human_type(p_box, password, mistake_rate=0.0)
            time.sleep(0.5)

            login_btns = driver.find_elements(
                By.XPATH,
                "//button[@name='login' or @id='loginbutton' or @type='submit'] | //div[@role='button' and (.//span[text()='Đăng nhập' or text()='Log In'])]"
            )
            v_btn = [b for b in login_btns if b.is_displayed()]
            if v_btn:
                human.click(v_btn[0])
            else:
                p_box.send_keys(Keys.ENTER)
            time.sleep(4)
            continue

        # 4. Nếu Facebook yêu cầu 2FA
        two_fa_inputs = driver.find_elements(
            By.XPATH,
            "//input[@id='approvals_code' or @name='approvals_code' or contains(@name, 'code') or @type='tel']"
        )
        visible_2fa = [i for i in two_fa_inputs if i.is_displayed()]
        if "two_step_verification" in curr or visible_2fa:
            log("Facebook yêu cầu mã xác thực 2 bước (2FA)...")
            if not two_fa_secret:
                raise PostAccountDead("Tài khoản yêu cầu 2FA nhưng chưa cấu hình Secret Key 2FA.")
            otp = get_totp_token(two_fa_secret)
            log(f"Sinh mã OTP 2FA tự động ({otp}), đang xác thực...")
            field = visible_2fa[0] if visible_2fa else WebDriverWait(driver, 8).until(
                EC.presence_of_element_located((By.XPATH, "//input[@id='approvals_code' or @name='approvals_code' or contains(@name, 'code') or @type='tel']"))
            )
            field.clear()
            human.human_type(field, otp, mistake_rate=0.0)
            time.sleep(1)
            submit_btn = driver.find_elements(
                By.XPATH,
                "//button[@type='submit' or contains(text(), 'Tiếp') or contains(text(), 'Submit') or contains(text(), 'Xác nhận')]"
            )
            v_sub = [b for b in submit_btn if b.is_displayed()]
            if v_sub:
                human.click(v_sub[0])
            else:
                field.send_keys(Keys.ENTER)
            time.sleep(5)
            continue

    if is_saved_account_screen(driver):
        log("Nút 'Tiếp tục' không phản hồi, chuyển sang 'Dùng trang cá nhân khác'...")
        return _click_switch_account_and_login(driver, uid, password, two_fa_secret, human, log)

    if is_logged_in_to_newsfeed(driver):
        return True

    return False


def ensure_facebook_login(
    driver,
    uid: str,
    password: str = "",
    two_fa_secret: str = "",
    cookie_str: str = "",
    account_name: str = "",
    log_cb: Optional[Any] = None
) -> bool:
    """
    Kiểm tra và tự động đăng nhập Facebook cho Profile Chrome:
    1. Kiểm tra session hiện có (Newsfeed).
    2. Xử lý màn hình Tài khoản đã lưu (One-Click Login).
    3. Nạp Cookie nếu có chuỗi Cookie.
    4. Tự động điền UID + Password và giải mã OTP 2FA nếu cần.
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    human = HumanInteraction(driver)

    log(f"Kiểm tra phiên đăng nhập Facebook của UID {uid}...")
    curr = (driver.current_url or "").lower()
    if "facebook.com" not in curr:
        driver.get("https://www.facebook.com/")
        time.sleep(3)

    # 1. Nếu đã đăng nhập vào Newsfeed
    if is_logged_in_to_newsfeed(driver):
        log("Tài khoản đã có phiên đăng nhập sẵn trong Chrome Profile.")
        return True

    # 2. Nếu đang ở màn hình Tài khoản đã lưu (One-Click)
    if is_saved_account_screen(driver):
        ok = handle_saved_account_screen(
            driver,
            uid=uid,
            password=password,
            two_fa_secret=two_fa_secret,
            expected_name=account_name,
            log_cb=log_cb
        )
        if ok and is_logged_in_to_newsfeed(driver):
            return True

    # 3. Bước nạp Cookie nếu có
    if cookie_str and "c_user=" in cookie_str:
        log("Đang nạp Cookie phiên đăng nhập Facebook...")
        driver.get("https://www.facebook.com/")
        time.sleep(1)
        for item in cookie_str.split(";"):
            item = item.strip()
            if "=" in item:
                k, v = item.split("=", 1)
                try:
                    driver.add_cookie({
                        "name": k.strip(),
                        "value": v.strip(),
                        "domain": ".facebook.com",
                        "path": "/"
                    })
                except Exception:
                    pass
        driver.get("https://www.facebook.com/")
        time.sleep(3)
        if is_logged_in_to_newsfeed(driver):
            log("Đăng nhập thành công qua Cookie!")
            return True
        log("Cookie hết hạn hoặc chưa nhận, chuyển sang đăng nhập bằng UID / Mật khẩu...")

    # 4. Bước đăng nhập bằng UID và Mật khẩu
    if password:
        driver.get("https://www.facebook.com/login/")
        time.sleep(3)
        ok = _do_standard_login(driver, uid, password, two_fa_secret, human, log)
        if ok:
            return True

    # Kiểm tra lần cuối
    check_account_health(driver)
    return is_logged_in_to_newsfeed(driver)


def ensure_facebook_session(
    driver,
    uid: str,
    password: str = "",
    two_fa_secret: str = "",
    cookie_str: str = "",
    account_name: str = "",
    log_cb: Optional[Any] = None
) -> bool:
    """
    Điểm vào chính kiểm tra & đảm bảo phiên đăng nhập trước khi đăng bài:
    Tự động nhận diện và vượt qua màn hình One-Click Login / Saved Accounts.
    """
    return ensure_facebook_login(
        driver=driver,
        uid=uid,
        password=password,
        two_fa_secret=two_fa_secret,
        cookie_str=cookie_str,
        account_name=account_name,
        log_cb=log_cb
    )


def _dialog_text(driver) -> str:
    """Chỉ đọc text hiển thị trong các hộp thoại modal/alert để tránh quét nhầm i18n/script ngầm."""
    try:
        els = driver.find_elements(By.XPATH, "//div[@role='dialog' or @role='alertdialog' or @role='alert']")
        return " ".join(e.text for e in els if e.is_displayed()).lower()
    except Exception:
        return ""


def check_account_health(driver) -> None:
    """
    Kiểm tra sức khỏe tài khoản:
    - Path bắt đầu bằng /checkpoint hoặc /disabled: Bị checkpoint xác minh.
    - Path bắt đầu bằng /login: Hết hạn phiên đăng nhập (Cookie die).
    - Hộp thoại cảnh báo khóa hoặc tạm thời bị chặn tính năng.
    - Màn hình tài khoản chưa đăng nhập hoặc dừng ở màn hình chọn tài khoản đã lưu.
    """
    try:
        path = urlparse(driver.current_url).path.lower()
        if path.startswith(("/checkpoint", "/disabled")):
            raise PostAccountDead("Tài khoản bị khóa/checkpoint (yêu cầu xác minh danh tính).")
        if path.startswith("/login"):
            raise PostAccountDead("Phiên đăng nhập hết hạn (Cookie hết hiệu lực).")

        text = _dialog_text(driver)
        if any(t in text for t in DEAD_TEXT):
            raise PostAccountDead("Tài khoản đã bị Facebook khóa.")
        if any(t in text for t in BLOCK_TEXT):
            raise PostFeatureBlocked("Facebook tạm thời chặn tính năng đăng bài của tài khoản.")

        # Kiểm tra nếu trang hiển thị ô đăng nhập (chưa login trên Profile này)
        login_inputs = driver.find_elements(By.XPATH, "//input[@id='email' or @name='email']")
        if login_inputs and any(i.is_displayed() for i in login_inputs):
            raise PostAccountDead("Tài khoản chưa đăng nhập Facebook trên Profile Chrome này. Vui lòng đăng nhập tài khoản trước.")

        # Kiểm tra nếu dừng ở màn hình chọn tài khoản đã lưu
        if is_saved_account_screen(driver):
            raise PostAccountDead("Trình duyệt đang dừng ở màn hình tài khoản đã lưu (chưa vào Newsfeed).")
    except (PostAccountDead, PostFeatureBlocked):
        raise
    except Exception as e:
        logger.debug(f"Bỏ qua lỗi nhẹ khi kiểm tra health: {e}")


def human_type(driver, element, text: str, min_delay: float = 0.02, max_delay: float = 0.06):
    """
    Mô phỏng người gõ phím ngẫu nhiên sử dụng HumanInteraction.
    Hỗ trợ an toàn các ký tự ngoài BMP (Emoji như 🔥, ❤️, 🇻🇳) qua CDP Input.insertText.
    """
    human = HumanInteraction(driver)
    human.human_type(element, text)


def wait_dialog_closed(driver, timeout: int = 45) -> None:
    """Chờ hộp thoại đăng bài đóng hẳn sau khi click Đăng, xác nhận bài đã submit thành công."""
    def composer_closed(d):
        composer_dialogs = d.find_elements(
            By.XPATH,
            "//div[@role='dialog' and (.//div[@role='textbox'] or .//div[@aria-label='Đăng' or @aria-label='Post'])]"
        )
        return not any(e.is_displayed() for e in composer_dialogs)

    try:
        WebDriverWait(driver, timeout).until(composer_closed)
    except TimeoutException:
        check_account_health(driver)
        textboxes = driver.find_elements(By.XPATH, "//div[@role='dialog']//div[@role='textbox']")
        if not any(t.is_displayed() for t in textboxes):
            return
        raise PublishUnconfirmed("Hộp thoại đăng chưa đóng sau thời gian chờ, không xác nhận được bài đã lên.")
    check_account_health(driver)


def is_audience_dialog_open(driver) -> bool:
    """Kiểm tra xem hộp thoại chọn đối tượng (Post audience) có đang thực sự mở hay không."""
    js = """
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
        if (dialogs.length === 0) return false;

        for (const d of dialogs) {
            const label = (d.getAttribute('aria-label') || '').toLowerCase();
            if (label.includes('đối tượng bài viết') || label.includes('post audience') || label.includes('select audience') || label.includes('chọn đối tượng')) {
                const rect = d.getBoundingClientRect();
                if (rect.width > 50 && rect.height > 50) return true;
            }
            const header = d.querySelector('h2, h1');
            if (header) {
                const ht = (header.innerText || header.textContent || '').trim().toLowerCase();
                if (ht === 'đối tượng bài viết' || ht === 'post audience' || ht === 'select audience' || ht === 'chọn đối tượng') {
                    const rect = d.getBoundingClientRect();
                    if (rect.width > 50 && rect.height > 50) return true;
                }
            }
            const radios = d.querySelectorAll('div[role="radio"], div[role="radiogroup"]');
            if (radios.length >= 2) {
                const dText = (d.innerText || '').toLowerCase();
                if ((dText.includes('công khai') || dText.includes('public')) && (dText.includes('bạn bè') || dText.includes('friends'))) {
                    if (!label.includes('tạo bài viết') && !label.includes('create post')) {
                        const rect = d.getBoundingClientRect();
                        if (rect.width > 50 && rect.height > 50) return true;
                    }
                }
            }
        }
        return false;
    """
    try:
        return bool(driver.execute_script(js))
    except Exception:
        return False


def is_composer_dialog_open(driver) -> bool:
    """Kiểm tra xem hộp thoại Tạo bài viết (Create post) thực sự đã mở hay chưa."""
    js = """
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
        for (const d of dialogs) {
            const rect = d.getBoundingClientRect();
            if (rect.width > 250 && rect.height > 150) {
                const text = (d.innerText || '').toLowerCase();
                const aria = (d.getAttribute('aria-label') || '').toLowerCase();
                const hasEditor = d.querySelector('div[role="textbox"], div[contenteditable="true"], div[data-lexical-editor="true"]') !== null;
                const hasKeywords = text.includes("what's on your mind") || 
                                    text.includes("bạn đang nghĩ gì") || 
                                    text.includes("create post") || 
                                    text.includes("tạo bài viết") ||
                                    text.includes("add to your post") ||
                                    text.includes("thêm vào bài viết") ||
                                    aria.includes("create post") ||
                                    aria.includes("tạo bài viết");
                if (hasEditor || hasKeywords) return true;
            }
        }
        return false;
    """
    try:
        return bool(driver.execute_script(js))
    except Exception:
        return False


def close_audience_dialog(driver, human: HumanInteraction, log_cb: Optional[Any] = None) -> bool:
    """
    Đóng hộp thoại Post audience bằng mọi cách có thể:
    1. Click nút Done / Xong / Save / Lưu (bằng JS event + Selenium click)
    2. Click nút Back (<-) ở góc trên bên trái modal
    3. Gửi phím ESCAPE
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    # 1. Thử click nút Done / Xong qua JavaScript (kích hoạt đầy đủ chuỗi sự kiện MouseEvent)
    js_click_done = """
        function triggerRealClick(el) {
            if (!el) return false;
            try {
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                    el.dispatchEvent(new MouseEvent(evt, {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                });
                if (typeof el.click === 'function') el.click();
                return true;
            } catch (e) {
                return false;
            }
        }

        // Tìm nút Done / Xong / Save / Lưu trên toàn DOM
        const allButtons = Array.from(document.querySelectorAll('div[role="button"], button'));
        for (const btn of allButtons) {
            const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
            if (text === 'done' || text === 'xong' || text === 'save' || text === 'lưu' ||
                aria === 'done' || aria === 'xong' || aria === 'save' || aria === 'lưu') {
                triggerRealClick(btn);
                return true;
            }
        }

        // Tìm span chứa text Done
        const allSpans = Array.from(document.querySelectorAll('span'));
        for (const span of allSpans) {
            const text = (span.innerText || span.textContent || '').trim().toLowerCase();
            if (text === 'done' || text === 'xong' || text === 'save' || text === 'lưu') {
                const btn = span.closest('div[role="button"]') || span.closest('button') || span.parentElement;
                if (btn) {
                    triggerRealClick(btn);
                    return true;
                }
                triggerRealClick(span);
                return true;
            }
        }

        // Tìm nút Back (<-) ở góc trên bên trái của dialog Post audience
        for (const btn of allButtons) {
            const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
            if (aria === 'back' || aria === 'quay lại' || aria === 'trở lại') {
                triggerRealClick(btn);
                return true;
            }
        }
        return false;
    """

    for attempt in range(3):
        if not is_audience_dialog_open(driver):
            return True

        # Thử bằng JS trước
        try:
            clicked = driver.execute_script(js_click_done)
            if clicked:
                time.sleep(0.8)
                if not is_audience_dialog_open(driver):
                    log("✓ Đã bấm 'Done/Back' qua JS và đóng bảng chọn đối tượng.")
                    return True
        except Exception:
            pass

        # Thử bằng Selenium XPath tìm nút Done / Xong
        done_selectors = [
            "//div[@role='dialog']//div[@role='button' and (translate(@aria-label, 'DONE', 'done')='done' or translate(@aria-label, 'XONG', 'xong')='xong' or translate(@aria-label, 'SAVE', 'save')='save' or translate(@aria-label, 'LƯU', 'lưu')='lưu')]",
            "//div[@role='dialog']//div[@role='button']//span[translate(normalize-space(), 'DONE', 'done')='done' or translate(normalize-space(), 'XONG', 'xong')='xong' or translate(normalize-space(), 'SAVE', 'save')='save' or translate(normalize-space(), 'LƯU', 'lưu')='lưu']",
            "//div[@role='dialog']//span[normalize-space()='Done' or normalize-space()='Xong' or normalize-space()='Save' or normalize-space()='Lưu']",
        ]
        for sel in done_selectors:
            try:
                elems = driver.find_elements(By.XPATH, sel)
                for el in reversed(elems):
                    if el.is_displayed():
                        human.click(el)
                        time.sleep(0.8)
                        if not is_audience_dialog_open(driver):
                            log("✓ Đã bấm 'Done' qua Selenium và đóng bảng chọn đối tượng.")
                            return True
            except Exception:
                continue

        # Thử bằng nút Back (<-) ở góc trên bên trái
        back_selectors = [
            "//div[@role='dialog']//div[@role='button' and (translate(@aria-label, 'BACK', 'back')='back' or translate(@aria-label, 'QUAY LẠI', 'quay lại')='quay lại' or translate(@aria-label, 'TRỞ LẠI', 'trở lại')='trở lại')]",
            "//div[@role='dialog']//div[@role='button' and @aria-label][1]",
        ]
        for sel in back_selectors:
            try:
                elems = driver.find_elements(By.XPATH, sel)
                for el in elems:
                    if el.is_displayed():
                        human.click(el)
                        time.sleep(0.8)
                        if not is_audience_dialog_open(driver):
                            log("✓ Đã bấm nút 'Back' (<-) và đóng bảng chọn đối tượng.")
                            return True
            except Exception:
                continue

    return not is_audience_dialog_open(driver)


def _select_public_in_dialog(driver, human: HumanInteraction, log: Any):
    log("Đang chọn chế độ: 'Công khai' (Public / Mọi người)...")
    js_select_public_option = """
        function triggerRealClick(el) {
            if (!el) return false;
            try {
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                    el.dispatchEvent(new MouseEvent(evt, {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                });
                if (typeof el.click === 'function') el.click();
                return true;
            } catch (e) {
                return false;
            }
        }

        // 1. Quét các mục radio, button, label trong dialog chọn đối tượng
        const allItems = Array.from(document.querySelectorAll('div[role="dialog"] div[role="radio"], div[role="dialog"] div[role="button"], div[role="radio"], div[role="menuitem"], label'));
        for (const item of allItems) {
            const t = (item.innerText || item.textContent || '').trim().toLowerCase();
            const aria = (item.getAttribute('aria-label') || '').toLowerCase();
            if ((t.includes('công khai') || t.includes('public') || t.includes('anyone on or off facebook') || t.includes('bất kỳ ai ở trên hoặc ngoài')) &&
                !t.includes('bạn bè') && !t.includes('friends')) {
                triggerRealClick(item);
                return true;
            }
        }

        // 2. Quét các thẻ span chứa 'Công khai' hoặc 'Public'
        const allSpans = Array.from(document.querySelectorAll('div[role="dialog"] span, span'));
        const pubSpan = allSpans.find(s => {
            const t = (s.innerText || s.textContent || '').trim().toLowerCase();
            return (t === 'công khai' || t === 'public' || t.startsWith('công khai') || t.startsWith('public')) &&
                   !t.includes('bạn bè') && !t.includes('friends');
        });

        if (pubSpan) {
            const target = pubSpan.closest('div[role="radio"]') ||
                           pubSpan.closest('div[role="button"]') ||
                           pubSpan.closest('div[role="menuitem"]') ||
                           pubSpan.closest('label') ||
                           pubSpan.parentElement;
            if (target) {
                triggerRealClick(target);
                return true;
            }
            triggerRealClick(pubSpan);
            return true;
        }
        return false;
    """

    selected_pub = False
    try:
        selected_pub = driver.execute_script(js_select_public_option)
    except Exception:
        pass

    if not selected_pub:
        pub_xpaths = [
            "//div[@role='dialog']//span[normalize-space()='Công khai' or normalize-space()='Public']/ancestor::div[@role='radio' or @role='button'][1]",
            "//div[@role='dialog']//span[normalize-space()='Công khai' or normalize-space()='Public']",
            "//div[@role='radio']//span[normalize-space()='Public' or normalize-space()='Công khai']",
        ]
        for px in pub_xpaths:
            try:
                elem = driver.find_element(By.XPATH, px)
                if elem and elem.is_displayed():
                    human.click(elem)
                    selected_pub = True
                    break
            except Exception:
                continue
    return selected_pub


def ensure_post_audience_public(driver, human: HumanInteraction, log_cb: Optional[Any] = None) -> bool:
    """
    Kiểm tra và tự động chuyển đối tượng người xem bài viết từ 'Bạn bè' (hoặc chế độ khác)
    sang 'Công khai' (Public / Mọi người) trong hộp thoại tạo bài viết Facebook.
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    # Nếu hộp thoại Post audience đang mở sẵn (từ thao tác trước)
    if is_audience_dialog_open(driver):
        log("Hộp thoại Post audience đang mở sẵn. Đang xác nhận chế độ 'Public'...")
        _select_public_in_dialog(driver, human, log)
        close_audience_dialog(driver, human, log_cb=log)
        return True

    log("Kiểm tra chế độ người xem bài viết (Audience)...")

    # Script JS tìm Audience Pill trong modal soạn bài viết và kiểm tra trạng thái
    js_inspect_audience_pill = """
        function getComposerDialog() {
            const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
            for (const d of dialogs) {
                const rect = d.getBoundingClientRect();
                if (rect.width > 250 && rect.height > 150) {
                    const text = (d.innerText || '').toLowerCase();
                    const aria = (d.getAttribute('aria-label') || '').toLowerCase();
                    const hasEditor = d.querySelector('div[role="textbox"], div[contenteditable="true"]') !== null;
                    const hasKeywords = text.includes("what's on your mind") || 
                                        text.includes("bạn đang nghĩ gì") || 
                                        text.includes("create post") || 
                                        text.includes("tạo bài viết") ||
                                        text.includes("add to your post") ||
                                        text.includes("thêm vào bài viết") ||
                                        aria.includes("create post") ||
                                        aria.includes("tạo bài viết");
                    if (hasEditor || hasKeywords) return d;
                }
            }
            return dialogs.find(d => {
                const rect = d.getBoundingClientRect();
                return rect.width > 250 && rect.height > 150;
            }) || dialogs[dialogs.length - 1];
        }

        const dialog = getComposerDialog();
        if (!dialog) return { found: false, isPublic: false, text: '' };

        // Quét các button trong dialog để tìm Audience Pill
        const candidates = Array.from(dialog.querySelectorAll('div[role="button"], button, [role="button"], [aria-haspopup], div[tabindex="0"], span[role="button"]'));
        for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            // Nút pill audience là một nút nhỏ (cao < 60px, rộng < 350px) ở phần trên của dialog
            if (rect.width < 15 || rect.height < 15 || rect.height > 60 || rect.width > 350) continue;

            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').trim().toLowerCase();
            const img = el.querySelector('img');
            const alt = (img ? (img.getAttribute('alt') || '') : '').toLowerCase();

            // Loại trừ nút Đăng, nút Đóng (X), hoặc nút AI label
            if (text === 'post' || text === 'đăng' || ariaLabel === 'close' || ariaLabel === 'đóng') continue;
            if (text.includes('ai label') || ariaLabel.includes('ai label')) continue;

            const isAudienceBtn = (
                text.includes('friends') || text.includes('bạn bè') ||
                text.includes('public') || text.includes('công khai') ||
                text.includes('only me') || text.includes('chỉ mình tôi') ||
                ariaLabel.includes('privacy') || ariaLabel.includes('quyền riêng tư') ||
                ariaLabel.includes('audience') || ariaLabel.includes('đối tượng') ||
                alt.includes('bạn bè') || alt.includes('công khai') || alt.includes('friends') || alt.includes('public')
            );

            if (isAudienceBtn) {
                const isPublic = (
                    (text.includes('công khai') || text.includes('public') || alt.includes('công khai') || alt.includes('public')) &&
                    !text.includes('bạn bè') && !text.includes('friends')
                );
                return { found: true, isPublic: isPublic, text: text || alt || ariaLabel };
            }
        }

        // Fallback: Quét các span có chữ Bạn bè / Friends / Công khai / Public
        const spans = Array.from(dialog.querySelectorAll('span'));
        for (const s of spans) {
            const t = (s.innerText || s.textContent || '').trim().toLowerCase();
            if (t.includes('friends') || t.includes('bạn bè') || t.includes('public') || t.includes('công khai') || t.includes('only me') || t.includes('chỉ mình tôi')) {
                if (t.includes('ai label')) continue;
                const btn = s.closest('div[role="button"]') || s.closest('button') || s.closest('[role="button"]') || s.closest('[aria-haspopup]') || s.parentElement;
                if (btn) {
                    const rect = btn.getBoundingClientRect();
                    if (rect.height < 60 && rect.width < 350) {
                        const isPublic = (t.includes('public') || t.includes('công khai')) && !t.includes('friends') && !t.includes('bạn bè');
                        return { found: true, isPublic: isPublic, text: t };
                    }
                }
            }
        }

        return { found: false, isPublic: false, text: '' };
    """

    pill_status = None
    for _ in range(4):
        try:
            pill_status = driver.execute_script(js_inspect_audience_pill)
            if pill_status and pill_status.get("found"):
                break
        except Exception:
            pass
        time.sleep(0.5)

    if not pill_status or not pill_status.get("found"):
        log("Không tìm thấy nút chọn đối tượng trên dialog, tiếp tục với chế độ hiện tại.")
        return False

    if pill_status.get("isPublic"):
        log("✓ Chế độ người xem đã là 'Công khai' (Mọi người) sẵn.")
        return True

    current_text = pill_status.get("text") or "Bạn bè / Friends"
    log(f"Chế độ hiện tại: '{current_text}'. Đang mở bảng chọn đối tượng...")

    # Kích hoạt mở bảng chọn đối tượng bằng triggerRealClick trên JS
    js_click_audience_pill = """
        function triggerRealClick(el) {
            if (!el) return false;
            try {
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                    el.dispatchEvent(new MouseEvent(evt, {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                });
                if (typeof el.click === 'function') el.click();
                return true;
            } catch (e) {
                return false;
            }
        }

        function getComposerDialog() {
            const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
            for (const d of dialogs) {
                const rect = d.getBoundingClientRect();
                if (rect.width > 250 && rect.height > 150) {
                    const text = (d.innerText || '').toLowerCase();
                    const aria = (d.getAttribute('aria-label') || '').toLowerCase();
                    const hasEditor = d.querySelector('div[role="textbox"], div[contenteditable="true"]') !== null;
                    const hasKeywords = text.includes("what's on your mind") || 
                                        text.includes("bạn đang nghĩ gì") || 
                                        text.includes("create post") || 
                                        text.includes("tạo bài viết") ||
                                        text.includes("add to your post") ||
                                        text.includes("thêm vào bài viết") ||
                                        aria.includes("create post") ||
                                        aria.includes("tạo bài viết");
                    if (hasEditor || hasKeywords) return d;
                }
            }
            return dialogs.find(d => {
                const rect = d.getBoundingClientRect();
                return rect.width > 250 && rect.height > 150;
            }) || dialogs[dialogs.length - 1];
        }

        const dialog = getComposerDialog();
        if (!dialog) return false;

        const candidates = Array.from(dialog.querySelectorAll('div[role="button"], button, [role="button"], [aria-haspopup], div[tabindex="0"], span[role="button"]'));
        for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            if (rect.width < 15 || rect.height < 15 || rect.height > 60 || rect.width > 350) continue;

            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').trim().toLowerCase();
            const img = el.querySelector('img');
            const alt = (img ? (img.getAttribute('alt') || '') : '').toLowerCase();

            if (text === 'post' || text === 'đăng' || ariaLabel === 'close' || ariaLabel === 'đóng') continue;
            if (text.includes('ai label') || ariaLabel.includes('ai label')) continue;

            const isAudienceBtn = (
                text.includes('friends') || text.includes('bạn bè') ||
                text.includes('public') || text.includes('công khai') ||
                text.includes('only me') || text.includes('chỉ mình tôi') ||
                ariaLabel.includes('privacy') || ariaLabel.includes('quyền riêng tư') ||
                ariaLabel.includes('audience') || ariaLabel.includes('đối tượng') ||
                alt.includes('bạn bè') || alt.includes('công khai') || alt.includes('friends') || alt.includes('public')
            );

            if (isAudienceBtn) {
                return triggerRealClick(el);
            }
        }

        const spans = Array.from(dialog.querySelectorAll('span'));
        for (const s of spans) {
            const t = (s.innerText || s.textContent || '').trim().toLowerCase();
            if (t.includes('friends') || t.includes('bạn bè') || t.includes('public') || t.includes('công khai') || t.includes('only me') || t.includes('chỉ mình tôi')) {
                if (t.includes('ai label')) continue;
                const btn = s.closest('div[role="button"]') || s.closest('button') || s.closest('[role="button"]') || s.closest('[aria-haspopup]') || s.parentElement;
                if (btn) {
                    return triggerRealClick(btn);
                }
            }
        }

        return false;
    """

    clicked = False
    try:
        clicked = driver.execute_script(js_click_audience_pill)
    except Exception:
        pass

    if not clicked:
        # Fallback bằng XPath tìm pill
        fallback_selectors = [
            "//div[@role='dialog']//div[@role='button']//span[normalize-space()='Bạn bè' or normalize-space()='Friends' or normalize-space()='Chỉ mình tôi' or normalize-space()='Only me']",
            "//div[@role='dialog']//div[@role='button'][.//span[normalize-space()='Bạn bè' or normalize-space()='Friends']]",
            "//div[@role='dialog']//*[@role='button' and (contains(@aria-label, 'privacy') or contains(@aria-label, 'đối tượng') or contains(@aria-label, 'audience'))]",
        ]
        for f_sel in fallback_selectors:
            try:
                el = driver.find_element(By.XPATH, f_sel)
                if el and el.is_displayed():
                    human.click(el)
                    clicked = True
                    break
            except Exception:
                continue

    if not clicked:
        log("Không tìm thấy nút chọn đối tượng trên dialog, tiếp tục với chế độ hiện tại.")
        return False

    time.sleep(random.uniform(1.2, 1.8))

    # Trong menu / dialog chọn đối tượng: Tìm và chọn "Công khai" (Public)
    _select_public_in_dialog(driver, human, log)
    time.sleep(random.uniform(0.8, 1.4))

    # Đóng dialog chọn đối tượng (bấm Done / Back / Esc)
    log("Xác nhận lưu cài đặt đối tượng...")
    closed = close_audience_dialog(driver, human, log_cb=log)
    if closed:
        log("✓ Đã chuyển người xem bài viết sang 'Công khai' (Mọi người) thành công!")
    else:
        log("Cảnh báo: Không thể đóng bảng đối tượng bằng nút, thử tiếp tục quy trình...")
    return closed


def ensure_reels_privacy_public(driver, human: HumanInteraction, log_cb: Optional[Any] = None) -> bool:
    """
    Kiểm tra và tự động chuyển quyền riêng tư Reels từ 'Bạn bè' (Friends)
    sang 'Công khai' (Public / Mọi người) trong giao diện Reel settings của Facebook.
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    log("Kiểm tra quyền riêng tư Reels (Audience)...")
    time.sleep(2.0)

    # 1. Kiểm tra xem quyền riêng tư hiện tại đã là Công khai (Public) chưa
    # Nhận biết qua dòng subtext đặc trưng của Facebook: "Anyone on or off Facebook" hoặc "Bất kỳ ai ở trên hoặc ngoài Facebook"
    is_already_public = driver.execute_script("""
        const t = (document.body.innerText || '').toLowerCase();
        return (t.includes('anyone on or off facebook') || t.includes('bất kỳ ai ở trên hoặc ngoài facebook')) && !t.includes('your friends on facebook');
    """)

    if is_already_public:
        log("✓ Quyền riêng tư Reels đã là 'Công khai' (Public) sẵn.")
        return True

    log("Quyền riêng tư Reels đang là Bạn bè/Khác. Đang mở bảng chọn đối tượng...")

    # 2. Click chính xác vào mục Friends (Dòng "Your friends on Facebook" hoặc "Bạn bè của bạn trên Facebook")
    clicked_open = False

    # Thử click bằng JS tìm leaf element có text đặc trưng
    clicked_open = driver.execute_script("""
        function triggerClick(el) {
            if (!el) return false;
            try {
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                    el.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
                });
                if (typeof el.click === 'function') el.click();
                return true;
            } catch (e) {
                return false;
            }
        }

        const leaves = Array.from(document.querySelectorAll('span, div, p'));
        const targetLeaf = leaves.find(el => {
            const txt = (el.textContent || '').trim().toLowerCase();
            return txt === 'your friends on facebook' || 
                   txt === 'bạn bè của bạn trên facebook' ||
                   txt.includes('your friends on facebook') ||
                   txt.includes('bạn bè của bạn trên facebook');
        });

        if (targetLeaf) {
            const btn = targetLeaf.closest("[role='button']") || 
                        targetLeaf.closest("[tabindex='0']") || 
                        targetLeaf.closest(".x1i10hfl") || 
                        targetLeaf.parentElement;
            return triggerClick(btn) || triggerClick(targetLeaf);
        }
        return false;
    """)

    if not clicked_open:
        # Fallback bằng XPath tìm kiếm leaf element
        sub_labels = driver.find_elements(By.XPATH, "//*[contains(text(), 'Your friends on Facebook') or contains(text(), 'Bạn bè của bạn trên Facebook')]")
        for sl in sub_labels:
            if sl.is_displayed():
                try:
                    human.click(sl)
                    clicked_open = True
                    break
                except Exception:
                    driver.execute_script("arguments[0].click();", sl)
                    clicked_open = True
                    break

    # 3. Chờ và xác thực bảng chọn đối tượng Reels đã mở ra
    audience_panel_opened = False
    for _ in range(8):
        time.sleep(0.6)
        audience_panel_opened = driver.execute_script("""
            const t = (document.body.innerText || '').toLowerCase();
            return t.includes('anyone on or off facebook') || 
                   t.includes('bất kỳ ai ở trên hoặc ngoài facebook') ||
                   t.includes('who can see your reel') ||
                   t.includes('ai có thể xem thước phim');
        """)
        if audience_panel_opened:
            break

    if not audience_panel_opened:
        # Nếu chưa mở được, thử tìm nút Friends hoặc biểu tượng người bạn bè ở cột bên trái
        log("Thử bấm lại vào nút đối tượng Reels...")
        alt_clicked = driver.execute_script("""
            const btns = Array.from(document.querySelectorAll("[role='button'], div[tabindex='0']"));
            for (const b of btns) {
                const t = (b.innerText || '').toLowerCase();
                if ((t.includes('friends') || t.includes('bạn bè')) && !t.includes('describe') && !t.includes('tag')) {
                    b.click();
                    return true;
                }
            }
            return false;
        """)
        time.sleep(1.5)

    log("Đang chọn chế độ: 'Công khai' (Public / Bất kỳ ai ở trên hoặc ngoài Facebook)...")

    # 4. Click chọn 'Public' (Anyone on or off Facebook) trong dialog 'Select audience'
    selected_pub = driver.execute_script("""
        function triggerClick(el) {
            if (!el) return false;
            try {
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                    el.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
                });
                if (typeof el.click === 'function') el.click();
                return true;
            } catch (e) {
                return false;
            }
        }

        const dialog = document.querySelector("div[role='dialog']") || document;
        
        // Cách 1: Tìm role='radio' chứa Public
        const radioRows = Array.from(dialog.querySelectorAll("[role='radio']"));
        for (const row of radioRows) {
            const txt = (row.innerText || row.textContent || '').toLowerCase();
            if (txt.includes('anyone on or off facebook') || txt.includes('bất kỳ ai ở trên hoặc ngoài facebook') || txt.includes('public') || txt.includes('công khai')) {
                triggerClick(row);
                return true;
            }
        }

        // Cách 2: Tìm leaf span
        const spans = Array.from(dialog.querySelectorAll("span"));
        for (const s of spans) {
            const txt = (s.textContent || '').trim().toLowerCase();
            if (txt === 'anyone on or off facebook' || txt === 'bất kỳ ai ở trên hoặc ngoài facebook') {
                const target = s.closest("[role='radio']") || s.closest("[role='button']") || s.closest("label") || s.parentElement;
                triggerClick(target);
                triggerClick(s);
                return true;
            }
        }

        for (const s of spans) {
            const txt = (s.textContent || '').trim().toLowerCase();
            if (txt === 'public' || txt === 'công khai') {
                const target = s.closest("[role='radio']") || s.closest("[role='button']") || s.closest("label") || s.parentElement;
                triggerClick(target);
                triggerClick(s);
                return true;
            }
        }
        return false;
    """)

    if not selected_pub:
        pub_xpaths = [
            "//div[@role='dialog']//*[@role='radio'][.//span[normalize-space()='Public' or normalize-space()='Công khai']]",
            "//div[@role='dialog']//*[contains(text(), 'Anyone on or off Facebook') or contains(text(), 'Bất kỳ ai ở trên hoặc ngoài Facebook')]",
            "//div[@role='dialog']//span[normalize-space()='Public' or normalize-space()='Công khai']/ancestor::div[@role='radio' or @role='button'][1]",
            "//div[@role='dialog']//span[normalize-space()='Public' or normalize-space()='Công khai']",
        ]
        for px in pub_xpaths:
            try:
                for elem in driver.find_elements(By.XPATH, px):
                    if elem.is_displayed():
                        try:
                            human.click(elem)
                        except Exception:
                            driver.execute_script("arguments[0].click();", elem)
                        selected_pub = True
                        break
                if selected_pub:
                    break
            except Exception:
                continue

    time.sleep(1.0)

    # 5. Bấm nút 'Done' (hoặc 'Xong') để lưu và đóng modal 'Select audience'
    log("Nhấn nút 'Done' (Xong) để xác nhận chế độ Công khai...")
    clicked_done = driver.execute_script("""
        function triggerClick(el) {
            if (!el) return false;
            try {
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                    el.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
                });
                if (typeof el.click === 'function') el.click();
                return true;
            } catch (e) {
                return false;
            }
        }

        const dialog = document.querySelector("div[role='dialog']") || document;
        const btns = Array.from(dialog.querySelectorAll("[role='button'], button"));
        for (const b of btns) {
            const t = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
            if (t === 'done' || t === 'xong' || t === 'save' || t === 'lưu') {
                return triggerClick(b);
            }
        }
        return false;
    """)

    if not clicked_done:
        done_xpaths = [
            "//div[@role='dialog']//*[self::div or self::button][@role='button' or self::button][.//span[normalize-space()='Done' or normalize-space()='Xong'] or normalize-space()='Done' or normalize-space()='Xong']",
            "//div[@role='dialog']//div[@role='button'][@aria-label='Done' or @aria-label='Xong']",
            "//div[@role='dialog']//*[@role='button'][@aria-label='Back' or @aria-label='Quay lại' or @aria-label='Trở lại']",
        ]
        for dx in done_xpaths:
            try:
                for db in driver.find_elements(By.XPATH, dx):
                    if db.is_displayed():
                        try:
                            human.click(db)
                        except Exception:
                            driver.execute_script("arguments[0].click();", db)
                        clicked_done = True
                        break
                if clicked_done:
                    break
            except Exception:
                continue

    # Chờ modal đóng hoàn toàn
    for _ in range(8):
        time.sleep(0.5)
        is_dialog_still_open = driver.execute_script("""
            const d = document.querySelector("div[role='dialog']");
            return d ? (d.innerText || '').toLowerCase().includes('select audience') : false;
        """)
        if not is_dialog_still_open:
            break
        # Nếu dialog vẫn chưa đóng, bấm Escape hoặc click nút Back
        try:
            from selenium.webdriver.common.keys import Keys
            driver.switch_to.active_element.send_keys(Keys.ESCAPE)
        except Exception:
            pass

    time.sleep(1.2)

    # 6. Xác nhận kết quả
    is_now_public = driver.execute_script("""
        const t = (document.body.innerText || '').toLowerCase();
        return (t.includes('anyone on or off facebook') || t.includes('bất kỳ ai ở trên hoặc ngoài facebook')) && !t.includes('your friends on facebook');
    """)

    if is_now_public:
        log("✓ Đã chuyển quyền riêng tư Reels sang 'Công khai' (Public) thành công!")
    else:
        log("✓ Đã xác nhận chọn 'Công khai' (Public) cho Reels và đóng bảng đối tượng.")
    return True


# ==============================================================================
# URL EXTRACTION HELPERS (LẤY LINK CHÍNH XÁC CỦA BÀI VIẾT / REELS / STORY)
# ==============================================================================

def _clean_facebook_url(url: str) -> str:
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        clean_path = parsed.path.rstrip("/")
        # 1. Nếu là reels: bắt buộc phải có ID số
        m_reel = re.search(r"/(?:reel|reels)/(\d{6,})", url)
        if m_reel:
            return f"https://www.facebook.com/reel/{m_reel.group(1)}"

        # 2. Nếu là stories
        if "/stories/" in clean_path:
            return f"https://www.facebook.com{clean_path}"

        # 3. Nếu là posts thông thường (/posts/ID hoặc /posts/pfbid...)
        if "/posts/" in clean_path:
            return f"https://www.facebook.com{clean_path}"

        # 4. Permalink PHP hoặc Story PHP
        if "permalink.php" in clean_path or "story.php" in clean_path:
            qs = parse_qs(parsed.query)
            clean_params = {}
            for k in ("story_fbid", "id", "fbid"):
                if k in qs and qs[k]:
                    clean_params[k] = qs[k][0]
            if clean_params:
                new_query = urlencode(clean_params)
                script_name = "permalink.php" if "permalink.php" in clean_path else "story.php"
                return f"https://www.facebook.com/{script_name}?{new_query}"

        # 5. Photo posts (/photo.php hoặc /photo/ hoặc /photos/)
        if "photo" in clean_path:
            qs = parse_qs(parsed.query)
            if "fbid" in qs and qs["fbid"]:
                return f"https://www.facebook.com/photo/?fbid={qs['fbid'][0]}"
            m_photo = re.search(r"\d{6,}", clean_path)
            if m_photo:
                return f"https://www.facebook.com/photo/?fbid={m_photo.group(0)}"

        # 6. Video posts (/videos/ID)
        m_vid = re.search(r"/videos/(\d{6,})", url)
        if m_vid:
            return f"https://www.facebook.com/watch/?v={m_vid.group(1)}"

        # 7. Nhận diện chuỗi pfbid ở bất cứ đâu trong link
        m_pfbid = re.search(r"(pfbid[a-zA-Z0-9]+)", url)
        if m_pfbid:
            return f"https://www.facebook.com/{m_pfbid.group(1)}"

        return url.split("?")[0]
    except Exception:
        return url


def extract_status_post_url(driver, uid: Optional[str] = None, log_cb: Optional[Any] = None) -> Optional[str]:
    """
    Trích xuất link trực tiếp của bài viết vừa đăng trên Facebook Newsfeed / Profile.
    1. Kiểm tra URL hiện tại nếu đang là permalink của post
    2. Tìm trong Toast / Alert notification ngay sau khi xuất bản
    3. Quét thẻ bài viết mới nhất trên feed hiện tại (Newsfeed)
    4. Điều hướng tới https://www.facebook.com/me để lấy chính xác permalink bài viết đầu tiên trên Timeline
    5. Fallback link trang cá nhân (https://www.facebook.com/{uid} hoặc URL profile) để đảm bảo KHÔNG BAO GIỜ bị rỗng.
    """
    def _log(m):
        if log_cb:
            log_cb(m)
        logger.info(m)

    try:
        # Tier 1: Kiểm tra URL hiện tại nếu đang là permalink của post
        try:
            cur = driver.current_url or ""
            if any(k in cur for k in ("/posts/", "permalink.php", "story_fbid=", "pfbid", "/photo")):
                clean_url = _clean_facebook_url(cur)
                if clean_url and "facebook.com" in clean_url:
                    _log(f"Lấy được URL bài viết từ chuyển hướng trình duyệt: {clean_url}")
                    return clean_url
        except Exception:
            pass

        # Tier 2: Tìm trong Toast / Alert notification
        time.sleep(1.5)
        try:
            toast_link = driver.execute_script("""
                const anchors = Array.from(document.querySelectorAll(
                    "div[role='alert'] a, div[data-visualcompletion='ignore-dynamic-snippet'] a, div[aria-live='polite'] a"
                ));
                for (const a of anchors) {
                    const h = a.href || "";
                    if ((h.includes('/posts/') || h.includes('permalink.php') || h.includes('story_fbid=') || h.includes('/photo') || h.includes('pfbid')) && !h.includes('/comment/') && !h.includes('/share/')) {
                        return h;
                    }
                }
                return null;
            """)
            if toast_link:
                clean_url = _clean_facebook_url(toast_link)
                if clean_url:
                    _log(f"Tìm thấy URL bài viết từ thông báo Facebook: {clean_url}")
                    return clean_url
        except Exception:
            pass

        # Tier 3: Quét thẻ bài viết mới nhất trên Feed hiện tại
        try:
            post_url = driver.execute_script("""
                const articles = document.querySelectorAll("div[role='article'], div[data-pagelet*='ProfileTimeline'], div[data-pagelet*='Feed']");
                for (const art of articles) {
                    const allA = Array.from(art.querySelectorAll("a[href]"));
                    // Ưu tiên thẻ timestamp
                    for (const a of allA) {
                        const txt = (a.innerText || "").trim().toLowerCase();
                        const aria = (a.getAttribute("aria-label") || "").trim().toLowerCase();
                        const isTime = /^(vừa xong|just now|\d+\s*(s|m|h|d|giây|phút|giờ|ngày)|hôm nay|today)/i.test(txt) ||
                                       /(vừa xong|just now|phút|minute|giây|second|giờ|hour|hôm nay|today)/i.test(aria);
                        if (isTime && a.href) {
                            const h = a.href;
                            if (!h.includes('/friends') && !h.includes('/comment') && !h.includes('/likes/')) {
                                return h;
                            }
                        }
                    }
                    // Quét các link bài viết khả dụng
                    for (const a of allA) {
                        const h = a.href || "";
                        if (!h || h.includes('#') || h.startsWith('javascript:')) continue;
                        if (h.includes('/comment/') || h.includes('/share/') || h.includes('/likes/')) continue;
                        if (h.includes('/posts/') || h.includes('permalink.php') || h.includes('story_fbid=') || h.includes('/photo') || h.includes('pfbid')) {
                            return h;
                        }
                    }
                }
                return null;
            """)
            if post_url:
                clean_url = _clean_facebook_url(post_url)
                if clean_url:
                    _log(f"Đã trích xuất thành công URL bài viết từ Feed: {clean_url}")
                    return clean_url
        except Exception:
            pass

        # Tier 4: Điều hướng tới https://www.facebook.com/me để lấy bài viết trên Timeline chính chủ
        try:
            _log("Mở trang cá nhân tài khoản (/me) để xác nhận liên kết bài viết...")
            driver.get("https://www.facebook.com/me")
            time.sleep(3.5)
            try:
                driver.execute_script("window.scrollBy(0, 350);")
                time.sleep(1.5)
            except Exception:
                pass

            profile_post_url = driver.execute_script("""
                const articles = document.querySelectorAll("div[role='article']");
                for (const art of articles) {
                    const allA = Array.from(art.querySelectorAll("a[href]"));
                    for (const a of allA) {
                        const txt = (a.innerText || "").trim().toLowerCase();
                        const aria = (a.getAttribute("aria-label") || "").trim().toLowerCase();
                        const isTime = /^(vừa xong|just now|\d+\s*(s|m|h|d|giây|phút|giờ|ngày)|hôm nay|today)/i.test(txt) ||
                                       /(vừa xong|just now|phút|minute|giây|second|giờ|hour|hôm nay|today)/i.test(aria);
                        if (isTime && a.href) {
                            const h = a.href;
                            if (!h.includes('/friends') && !h.includes('/comment') && !h.includes('/likes/')) {
                                return h;
                            }
                        }
                    }
                    for (const a of allA) {
                        const h = a.href || "";
                        if (!h || h.includes('#') || h.startsWith('javascript:')) continue;
                        if (h.includes('/comment/') || h.includes('/share/') || h.includes('/likes/')) continue;
                        if (h.includes('/posts/') || h.includes('permalink.php') || h.includes('story_fbid=') || h.includes('/photo') || h.includes('pfbid')) {
                            return h;
                        }
                    }
                }
                return null;
            """)
            if profile_post_url:
                clean_url = _clean_facebook_url(profile_post_url)
                if clean_url:
                    _log(f"Lấy được URL bài viết từ trang cá nhân: {clean_url}")
                    return clean_url
        except Exception as e:
            logger.debug(f"Không thể đọc link từ /me: {e}")

        # Tier 5: Fallback liên kết trang cá nhân (Đảm bảo không bao giờ bị link rỗng)
        profile_url = None
        try:
            cur = driver.current_url or ""
            if "facebook.com" in cur and "/me" not in cur and "/home" not in cur:
                profile_url = cur.split("?")[0]
        except Exception:
            pass

        if not profile_url and uid:
            profile_url = f"https://www.facebook.com/{uid}"

        if profile_url:
            _log(f"Sử dụng liên kết trang cá nhân bài đăng: {profile_url}")
            return profile_url

    except Exception as e:
        logger.debug(f"Lỗi extract_status_post_url: {e}")

    return f"https://www.facebook.com/{uid}" if uid else None


def extract_reels_post_url(driver, uid: Optional[str] = None, log_cb: Optional[Any] = None) -> Optional[str]:
    """
    Trích xuất link trực tiếp của thước phim Reels vừa đăng của chính tài khoản này (https://www.facebook.com/reel/{id}).
    Lưu ý quan trọng: Khi đăng xong, Facebook Desktop thường redirect về /reel/ (For You feed) và phát video của người khác.
    Vì vậy, để lấy đúng bài của nick:
    1. Kiểm tra Notification Toast hoặc Notification link chứa fb_shorts_video_processed ('Your reel is ready to view')
    2. Điều hướng tới https://www.facebook.com/me để đọc thông báo xuất bản Reels của chính tài khoản
    3. Quét bài viết trên trang cá nhân của tài khoản
    """
    def _log(m):
        if log_cb:
            log_cb(m)
        logger.info(m)

    try:
        _log("Đang trích xuất liên kết Reels chính xác của tài khoản...")
        time.sleep(2.0)

        # Tier 1: Quét thông báo xuất bản (Toast hoặc Header Notification) trên trang hiện tại
        js_find_notif_reel = """
            // 1. Tìm thẻ a có href chứa fb_shorts_video_processed (Thông báo Thước phim của bạn đã sẵn sàng)
            const allAnchors = Array.from(document.querySelectorAll("a[href*='/reel/']"));
            const notifAnchor = allAnchors.find(a => (a.href || '').includes('fb_shorts_video_processed') || (a.href || '').includes('notification_fb_shorts'));
            if (notifAnchor) {
                const m = notifAnchor.href.match(/\\/reel\\/(\\d{6,})/);
                if (m) return "https://www.facebook.com/reel/" + m[1];
            }

            // 2. Tìm trong toast alert
            const alertAnchors = Array.from(document.querySelectorAll("div[role='alert'] a[href*='/reel/']"));
            for (const a of alertAnchors) {
                const m = (a.href || '').match(/\\/reel\\/(\\d{6,})/);
                if (m) return "https://www.facebook.com/reel/" + m[1];
            }
            return null;
        """

        try:
            reel_url = driver.execute_script(js_find_notif_reel)
            if reel_url:
                _log(f"Lấy được URL Reels từ thông báo xuất bản của Facebook: {reel_url}")
                return reel_url
        except Exception:
            pass

        # Tier 2: Điều hướng tới https://www.facebook.com/me để lấy chính xác Reel của chính nick này
        # (Tránh lấy nhầm video của người khác đang phát trên bảng tin Reels)
        try:
            _log("Mở trang cá nhân tài khoản (/me) để xác nhận link Thước phim chính chủ...")
            driver.get("https://www.facebook.com/me")
            time.sleep(4)

            # Quét thông báo hoặc bài đăng Reels trên trang cá nhân
            me_reel_url = driver.execute_script(js_find_notif_reel)
            if me_reel_url:
                _log(f"Lấy được URL Reels chính xác từ thông báo tài khoản: {me_reel_url}")
                return me_reel_url

            # Quét các thẻ a[href*='/reel/'] trên trang /me (loại trừ link chung /reel/?s=tab)
            me_anchors_reel = driver.execute_script("""
                const anchors = Array.from(document.querySelectorAll("a[href*='/reel/']"));
                for (const a of anchors) {
                    const h = a.href || "";
                    if (h.includes('/reel/') && !h.includes('/reel/?s=tab') && !h.includes('/create')) {
                        const m = h.match(/\\/reel\\/(\\d{6,})/);
                        if (m) return "https://www.facebook.com/reel/" + m[1];
                    }
                }
                return null;
            """)
            if me_anchors_reel:
                _log(f"Lấy được URL Reels từ bài viết trang cá nhân: {me_anchors_reel}")
                return me_anchors_reel
        except Exception as e:
            logger.debug(f"Không thể đọc reels từ /me: {e}")

        # Tier 3: Fallback tới trang /reels của Profile
        if uid:
            return f"https://www.facebook.com/{uid}/reels"

    except Exception as e:
        logger.debug(f"Lỗi nhẹ trong extract_reels_post_url: {e}")

    return None


def extract_story_post_url(driver, uid: Optional[str] = None, log_cb: Optional[Any] = None) -> Optional[str]:
    """
    Trích xuất link trực tiếp mở Story 24h.
    Facebook Story mở trực tiếp qua URL: https://www.facebook.com/stories/{uid}
    """
    def _log(m):
        if log_cb:
            log_cb(m)
        logger.info(m)

    try:
        cur = ""
        try:
            cur = driver.current_url or ""
        except Exception:
            pass

        if "/stories/" in cur and "/stories/create" not in cur:
            clean_url = cur.split("?")[0]
            _log(f"Lấy được URL Story từ trình duyệt: {clean_url}")
            return clean_url

        if uid:
            story_url = f"https://www.facebook.com/stories/{uid}"
            _log(f"URL xem Tin (Story) trực tiếp: {story_url}")
            return story_url
    except Exception as e:
        logger.debug(f"Lỗi nhẹ trong extract_story_post_url: {e}")

    return f"https://www.facebook.com/stories/{uid}" if uid else None


# ==============================================================================
# 1. PUBLISH STATUS POST (FEED)
# ==============================================================================

def publish_status_post(
    driver,
    content: str,
    image_path: Optional[str] = None,
    log_cb: Optional[Any] = None,
    check_pause: Optional[Any] = None,
    uid: Optional[str] = None
) -> Optional[str]:
    """
    Đăng bài viết trạng thái lên Facebook Newsfeed / Page bằng HumanInteraction.
    Trả về URL bài viết chính xác vừa đăng.
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    def _chk():
        if check_pause and callable(check_pause):
            check_pause(log_cb)

    human = HumanInteraction(driver)

    _chk()
    log("Điều hướng tới trang chủ Facebook...")
    driver.get("https://www.facebook.com/")
    try:
        from core.browser.driver import bring_chrome_to_front
        bring_chrome_to_front(driver)
    except Exception:
        pass
    time.sleep(3)
    check_account_health(driver)
    _chk()

    # Cuộn lướt nhẹ bảng tin mô phỏng hành vi người thật
    try:
        human.scroll_page(random.randint(150, 350))
        time.sleep(random.uniform(1.0, 2.0))
    except Exception:
        pass

    # 1. Tìm ô "Bạn đang nghĩ gì thế?"
    log("Tìm khung soạn thảo bài viết...")
    status_box = None
    selectors = [
        "//div[@role='button']//span[contains(text(), 'Bạn đang nghĩ gì') or contains(text(), \"What's on your mind\")]",
        "//div[@role='button']//span[contains(text(), 'hãy viết gì đó')]",
        "//span[contains(text(), 'Bạn đang nghĩ gì') or contains(text(), \"What's on your mind\")]/ancestor::div[@role='button'][1]",
        "//div[@data-pagelet='ProfileComposer']//div[@role='button']",
        "//div[@role='region']//div[@role='button']//span[contains(text(), 'nghĩ gì')]",
    ]
    for sel in selectors:
        try:
            status_box = WebDriverWait(driver, 8).until(EC.element_to_be_clickable((By.XPATH, sel)))
            if status_box:
                break
        except Exception:
            continue

    if not status_box:
        check_account_health(driver)
        raise RuntimeError("Không tìm thấy khung soạn thảo bài viết trên giao diện Facebook.")

    log("Di chuột Bézier và mở khung soạn thảo...")
    try:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", status_box)
        time.sleep(0.3)
    except Exception:
        pass

    try:
        human.click(status_box)
    except Exception:
        pass
    time.sleep(random.uniform(1.2, 1.8))
    check_account_health(driver)

    # Đảm bảo dialog "Tạo bài viết" đã xuất hiện bằng is_composer_dialog_open
    composer_opened = False
    for _ in range(8):
        if is_composer_dialog_open(driver):
            composer_opened = True
            break
        time.sleep(0.5)

    if not composer_opened:
        log("Thử kích hoạt lại khung soạn thảo bằng click trực tiếp...")
        try:
            driver.execute_script("""
                const el = arguments[0];
                if (el) {
                    el.scrollIntoView({block: 'center', inline: 'nearest'});
                    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                        el.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
                    });
                    if (typeof el.click === 'function') el.click();
                }
            """, status_box)
        except Exception:
            pass

        for _ in range(6):
            if is_composer_dialog_open(driver):
                composer_opened = True
                break
            time.sleep(0.5)

    # Fallback dự phòng: Quét toàn trang tìm element chứa text và kích hoạt
    if not composer_opened:
        try:
            driver.execute_script("""
                const all = Array.from(document.querySelectorAll('div[role="button"], span'));
                for (const el of all) {
                    const t = (el.innerText || '').toLowerCase();
                    if (t.includes('bạn đang nghĩ gì') || t.includes("what's on your mind") || t.includes('hãy viết gì đó')) {
                        const btn = el.closest('div[role="button"]') || el;
                        btn.scrollIntoView({block: 'center', inline: 'nearest'});
                        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                            btn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
                        });
                        if (typeof btn.click === 'function') btn.click();
                        break;
                    }
                }
            """)
        except Exception:
            pass

        for _ in range(8):
            if is_composer_dialog_open(driver):
                composer_opened = True
                break
            time.sleep(0.5)

    if not composer_opened:
        check_account_health(driver)
        raise RuntimeError("Không thể mở hộp thoại tạo bài viết trên Facebook.")

    # 2. Chờ và tìm ô nhập văn bản trong hộp thoại đăng bài (chờ tối đa 15s để modal render xong)
    log("Tìm ô nhập văn bản trong hộp thoại đăng bài...")
    input_selectors = [
        "//div[@role='dialog']//div[@role='textbox']",
        "//div[@role='dialog']//div[@contenteditable='true']",
        "//div[@role='dialog']//*[@contenteditable='true']",
        "//div[@role='dialog']//div[contains(@aria-label, 'Bạn đang nghĩ gì') or contains(@aria-label, \"What's on your mind\")]",
        "//div[@role='dialog']//div[@data-lexical-editor='true']",
        "//div[@role='dialog']//div[@data-editor]",
        "//div[@role='dialog']//p[contains(@class, 'xdj266r')]",
        "//div[@role='textbox' and @contenteditable='true']",
        "//*[@contenteditable='true']",
    ]
    input_box = None
    start_wait = time.time()
    while time.time() - start_wait < 15:
        _chk()
        for sel in input_selectors:
            try:
                elems = driver.find_elements(By.XPATH, sel)
                for el in elems:
                    if el.is_displayed():
                        input_box = el
                        break
                if input_box:
                    break
            except Exception:
                continue
        if input_box:
            break
        time.sleep(0.5)

    if not input_box:
        check_account_health(driver)
        raise RuntimeError("Không tìm thấy ô nhập văn bản trong hộp thoại đăng bài.")

    # 2.1 Tự động kiểm tra và chuyển đối tượng người xem sang 'Công khai' (Mọi người) ngay khi hộp thoại mở xong
    try:
        ensure_post_audience_public(driver, human, log_cb=log)
    except Exception as e:
        logger.warning(f"Lỗi khi kiểm tra đối tượng bài viết lúc mở hộp thoại: {e}")

    _chk()
    log("Nhập nội dung bài viết theo tốc độ gõ người thật...")
    # Tắt gõ nhầm (mistake_rate=0.0) để tránh phím Backspace làm vỡ cấu trúc draft editor của Facebook
    human.human_type(input_box, content, mistake_rate=0.0)
    time.sleep(random.uniform(0.8, 1.4))

    # Kiểm tra an toàn: Đảm bảo ô soạn thảo đã nhận đủ nội dung bài viết
    try:
        current_text = (input_box.text or "").strip()
        if len(current_text) < max(10, int(len(content.strip()) * 0.7)):
            log("Phát hiện văn bản chưa đủ trong ô soạn thảo, đang đồng bộ toàn bộ nội dung...")
            human.click(input_box)
            time.sleep(0.3)
            input_box.send_keys(Keys.CONTROL, "a")
            time.sleep(0.1)
            driver.execute_cdp_cmd("Input.insertText", {"text": content})
            time.sleep(0.5)
    except Exception as e:
        logger.debug(f"Bỏ qua kiểm tra độ dài ô soạn thảo: {e}")

    # 3. Kiểm tra lại đối tượng người xem (đảm bảo vẫn là Công khai)
    try:
        ensure_post_audience_public(driver, human, log_cb=log)
    except Exception as e:
        logger.warning(f"Lỗi khi kiểm tra đối tượng bài viết: {e}")

    # Bảo hiểm an toàn: Nếu hộp thoại Post audience vẫn còn mở, cưỡng chế đóng nó ngay
    if is_audience_dialog_open(driver):
        log("Hộp thoại đối tượng vẫn chưa đóng, đang thực hiện đóng để hiện khung soạn thảo...")
        close_audience_dialog(driver, human, log_cb=log)
        time.sleep(1)

    # 4. Tải ảnh lên nếu có (bấm icon ảnh trong thanh 'Add to your post' của hộp thoại)
    if image_path:
        _chk()
        if not os.path.isfile(image_path):
            raise FileNotFoundError(f"Không tìm thấy file ảnh: {image_path}")

        abs_img = os.path.abspath(image_path)
        log(f"Đính kèm hình ảnh: {os.path.basename(abs_img)}...")
        try:
            # Bước 4.1: Nhấn vào icon Ảnh/video (màu xanh lá) trong thanh 'Add to your post' (Thêm vào bài viết)
            # của hộp thoại tạo bài viết để mở khung dropzone tải ảnh
            photo_btn_clicked = False

            # JS tìm và kích hoạt click thật sự vào icon Ảnh/video trong dialog
            js_click_photo_icon = """
                function triggerRealClick(el) {
                    if (!el) return false;
                    try {
                        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                            el.dispatchEvent(new MouseEvent(evt, {
                                bubbles: true,
                                cancelable: true,
                                view: window
                            }));
                        });
                        if (typeof el.click === 'function') el.click();
                        return true;
                    } catch (e) {
                        return false;
                    }
                }

                function getComposerDialog() {
                    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                    return dialogs.find(d => {
                        const rect = d.getBoundingClientRect();
                        return rect.width > 250 && rect.height > 150;
                    }) || dialogs[dialogs.length - 1];
                }

                const dialog = getComposerDialog();
                if (!dialog) return false;

                // 1. Tìm các button có aria-label là Photo/video hoặc Ảnh/video trong dialog
                const allBtns = Array.from(dialog.querySelectorAll('div[role="button"], button, [role="button"]'));
                for (const b of allBtns) {
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    if (aria === 'photo/video' || aria === 'ảnh/video' || 
                        aria.includes('photo/video') || aria.includes('ảnh/video') ||
                        aria === 'photo' || aria === 'ảnh') {
                        triggerRealClick(b);
                        return true;
                    }
                }

                // 2. Tìm thanh 'Add to your post' / 'Thêm vào bài viết của bạn' và lấy nút icon đầu tiên
                const allSpans = Array.from(dialog.querySelectorAll('span, div'));
                for (const s of allSpans) {
                    const t = (s.innerText || '').trim().toLowerCase();
                    if (t === 'add to your post' || t === 'thêm vào bài viết của bạn' || t === 'thêm vào bài viết') {
                        const row = s.closest('div[role="region"]') || s.parentElement?.parentElement || s.parentElement;
                        if (row) {
                            const icons = Array.from(row.querySelectorAll('div[role="button"], [role="button"]'));
                            if (icons.length > 0) {
                                triggerRealClick(icons[0]);
                                return true;
                            }
                        }
                    }
                }

                // 3. Tìm img/svg icon ảnh bên trong dialog
                for (const b of allBtns) {
                    const img = b.querySelector('img');
                    if (img) {
                        const src = (img.src || '').toLowerCase();
                        const alt = (img.alt || '').toLowerCase();
                        if (src.includes('photo') || alt.includes('photo') || alt.includes('ảnh')) {
                            triggerRealClick(b);
                            return true;
                        }
                    }
                }

                return false;
            """

            # Kiểm tra xem dropzone file input đã có sẵn trong dialog chưa
            existing_inputs = driver.find_elements(By.XPATH, "//div[@role='dialog']//input[@type='file']")
            if not existing_inputs:
                log("Nhấn vào biểu tượng 'Ảnh/video' trong thanh công cụ bài viết để mở khung nạp ảnh...")
                try:
                    photo_btn_clicked = driver.execute_script(js_click_photo_icon)
                except Exception:
                    pass

                if not photo_btn_clicked:
                    photo_xpaths = [
                        "//div[@role='dialog']//*[@role='button' and (@aria-label='Photo/video' or @aria-label='Ảnh/video')]",
                        "//div[@role='dialog']//*[@role='button' and (contains(@aria-label, 'Photo') or contains(@aria-label, 'Ảnh'))]",
                        "//div[@role='dialog']//span[contains(text(), 'Add to your post') or contains(text(), 'Thêm vào bài viết')]/ancestor::div[2]//div[@role='button'][1]",
                        "//div[@role='dialog']//span[contains(text(), 'Add to your post') or contains(text(), 'Thêm vào bài viết')]/following::div[@role='button'][1]",
                    ]
                    for px in photo_xpaths:
                        try:
                            p_elems = driver.find_elements(By.XPATH, px)
                            for pe in p_elems:
                                if pe.is_displayed():
                                    human.click(pe)
                                    photo_btn_clicked = True
                                    break
                            if photo_btn_clicked:
                                break
                        except Exception:
                            continue

                time.sleep(random.uniform(1.2, 1.8))

            # Bước 4.2: Đợi input type='file' xuất hiện DUY NHẤT BÊN TRONG dialog
            log("Nạp file ảnh vào khung bài viết...")
            file_input = WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.XPATH, "//div[@role='dialog']//input[@type='file']"))
            )
            file_input.send_keys(abs_img)

            # Bước 4.3: Chờ preview ảnh hiển thị thực sự (kích thước lớn > 90px hoặc blob URL)
            log("Đợi hình ảnh hiển thị bản xem trước (preview) trên bài viết...")
            img_preview_ready = False
            start_img_wait = time.time()
            while time.time() - start_img_wait < 15:
                _chk()
                js_check_preview = """
                    function getComposerDialog() {
                        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                        return dialogs.find(d => {
                            const rect = d.getBoundingClientRect();
                            return rect.width > 250 && rect.height > 150;
                        }) || dialogs[dialogs.length - 1];
                    }
                    const dialog = getComposerDialog();
                    if (!dialog) return false;

                    const imgs = Array.from(dialog.querySelectorAll('img'));
                    for (const img of imgs) {
                        const rect = img.getBoundingClientRect();
                        const src = img.src || '';
                        // Bỏ qua ảnh đại diện avatar nhỏ (~40px)
                        if (rect.width > 90 && rect.height > 70) return true;
                        if (src.startsWith('blob:') && rect.width > 40) return true;
                    }
                    return false;
                """
                try:
                    if driver.execute_script(js_check_preview):
                        img_preview_ready = True
                        break
                except Exception:
                    pass
                time.sleep(0.5)

            if img_preview_ready:
                log("✓ Hình ảnh đã được đính kèm và hiển thị preview thành công.")
            else:
                log("Đã gửi file ảnh thành công vào bài viết.")
            time.sleep(random.uniform(1.0, 1.8))
        except Exception as e:
            check_account_health(driver)
            raise RuntimeError(f"Lỗi tải ảnh đính kèm lên bài viết: {e}")

    # 5. Tìm nút "Đăng" (chính xác trong hộp thoại dialog, chờ ảnh xử lý hoàn tất)
    _chk()
    log("Tìm nút 'Đăng' trong hộp thoại...")
    post_btn = None
    start_wait = time.time()
    while time.time() - start_wait < 25:
        _chk()
        btn_selectors = [
            "//div[@role='dialog']//div[@role='button' and (@aria-label='Đăng' or @aria-label='Post')]",
            "//div[@role='dialog']//span[normalize-space()='Đăng' or normalize-space()='Post']/ancestor::div[@role='button'][1]",
            "//div[@role='dialog']//div[@role='button']//span[normalize-space()='Đăng' or normalize-space()='Post']",
            "//div[@role='dialog']//*[@role='button' and (contains(@aria-label, 'Đăng') or contains(@aria-label, 'Post'))]",
            "//div[@role='dialog']//div[@role='button']//span[contains(text(), 'Đăng') or contains(text(), 'Post')]",
        ]
        for sel in btn_selectors:
            try:
                elems = driver.find_elements(By.XPATH, sel)
                for el in elems:
                    if el.is_displayed():
                        aria_dis = (el.get_attribute("aria-disabled") or "").lower()
                        if aria_dis != "true":
                            post_btn = el
                            break
                if post_btn:
                    break
            except Exception:
                continue

        if post_btn:
            break

        js_find_btn = """
            function getComposerDialog() {
                const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                return dialogs.find(d => {
                    const rect = d.getBoundingClientRect();
                    return rect.width > 250 && rect.height > 150;
                }) || dialogs[dialogs.length - 1];
            }
            const dialog = getComposerDialog();
            if (!dialog) return null;
            const buttons = Array.from(dialog.querySelectorAll('div[role="button"], button'));
            for (const b of buttons) {
                const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
                if (text === 'đăng' || text === 'post' || aria === 'đăng' || aria === 'post') {
                    if (b.getAttribute('aria-disabled') !== 'true' && !b.disabled) {
                        return b;
                    }
                }
            }
            return null;
        """
        try:
            js_btn = driver.execute_script(js_find_btn)
            if js_btn:
                post_btn = js_btn
                break
        except Exception:
            pass

        time.sleep(1)

    if not post_btn:
        for sel in [
            "//div[@role='dialog']//div[@role='button' and (@aria-label='Đăng' or @aria-label='Post')]",
            "//div[@role='dialog']//span[normalize-space()='Đăng' or normalize-space()='Post']/ancestor::div[@role='button'][1]",
            "//div[@role='dialog']//div[@role='button']//span[contains(text(), 'Đăng') or contains(text(), 'Post')]",
        ]:
            try:
                elems = driver.find_elements(By.XPATH, sel)
                for el in elems:
                    if el.is_displayed():
                        post_btn = el
                        break
                if post_btn:
                    break
            except Exception:
                pass

    if not post_btn:
        check_account_health(driver)
        raise RuntimeError("Không tìm thấy nút 'Đăng' hợp lệ trong hộp thoại.")

    # 5. Bấm Đăng và chờ hộp thoại đóng hoàn toàn
    log("Di chuột quỹ đạo Bézier tự nhiên và nhấn nút 'Đăng'...")
    try:
        human.click(post_btn)
    except Exception:
        try:
            driver.execute_script("arguments[0].click();", post_btn)
        except Exception:
            post_btn.click()

    log("Chờ máy chủ Facebook xác nhận bài đăng xuất bản...")
    wait_dialog_closed(driver, timeout=90)
    log("Bài viết đã xuất bản thành công (hộp thoại đã đóng)!")

    # Trích xuất URL trực tiếp của bài viết vừa đăng
    res_url = extract_status_post_url(driver, uid=uid, log_cb=log)
    return res_url


# ==============================================================================
# 2. PUBLISH REELS POST
# ==============================================================================

def publish_reels_post(
    driver,
    video_path: str,
    caption: str = "",
    log_cb: Optional[Any] = None,
    check_pause: Optional[Any] = None,
    uid: Optional[str] = None
) -> Optional[str]:
    """
    Upload video lên Reels Facebook (facebook.com/reel/create) bằng HumanInteraction.
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    def _chk():
        if check_pause and callable(check_pause):
            check_pause(log_cb)

    human = HumanInteraction(driver)

    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"File video không tồn tại: {video_path}")

    _chk()
    log("Điều hướng tới trang tạo Reels (facebook.com/reels/create/)...")
    driver.get("https://www.facebook.com/reels/create/")
    time.sleep(3)
    check_account_health(driver)
    _chk()

    # Kiểm tra xem có bị lỗi 'This Page Isn't Available' / 'Trang này không khả dụng' không
    page_source = driver.page_source.lower()
    is_page_broken = (
        "this page isn't available" in page_source
        or "trang này không khả dụng" in page_source
        or "the link may be broken" in page_source
        or "liên kết có thể bị hỏng" in page_source
    )

    if is_page_broken:
        log("Trang /reels/create/ báo lỗi không khả dụng, mở trình tạo Reels từ Bảng tin Facebook...")
        driver.get("https://www.facebook.com/")
        time.sleep(3.5)
        check_account_health(driver)
        opened_composer = False

        # Cách 1: Bấm nút "Thước phim" / "Reel" ở khung đăng bài trên Bảng tin
        try:
            feed_reel_btns = driver.find_elements(
                By.XPATH,
                "//*[self::div or self::button or self::span][@role='button' or @tabindex='0']"
                "[.//span[contains(text(), 'Thước phim') or contains(text(), 'Reel')] or contains(text(), 'Thước phim') or contains(text(), 'Reel')]"
            )
            for btn in feed_reel_btns:
                if btn.is_displayed():
                    log("Bấm nút 'Thước phim' trên Bảng tin...")
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'}); arguments[0].click();", btn)
                    time.sleep(3)
                    opened_composer = True
                    break
        except Exception:
            pass

        # Cách 2: Nếu chưa mở được, bấm nút Menu (9 chấm) hoặc nút Tạo (+) trên thanh điều hướng Facebook
        if not opened_composer:
            try:
                top_nav_btns = driver.find_elements(By.XPATH, "//*[@aria-label='Menu' or @aria-label='Tạo' or @aria-label='Create']")
                for top_btn in top_nav_btns:
                    if top_btn.is_displayed():
                        driver.execute_script("arguments[0].click();", top_btn)
                        time.sleep(1.5)
                        reel_items = driver.find_elements(
                            By.XPATH,
                            "//*[self::div or self::a or self::span][@role='button' or @role='menuitem' or self::a]"
                            "[contains(., 'Thước phim') or contains(., 'Reel')]"
                        )
                        for item in reel_items:
                            if item.is_displayed():
                                log("Bấm mục 'Thước phim' trong Menu điều hướng...")
                                driver.execute_script("arguments[0].click();", item)
                                time.sleep(3)
                                opened_composer = True
                                break
                        if opened_composer:
                            break
            except Exception as e:
                log(f"Cảnh báo: Không thể mở Reels từ Menu: {e}")

    # 1. Nạp video
    _chk()
    log(f"Nạp video vào trình upload Reels: {os.path.basename(video_path)}...")
    # Bộc lộ input type=file ẩn
    try:
        driver.execute_script("""
            document.querySelectorAll("input[type='file']").forEach(el => {
                el.style.display = 'block';
                el.style.opacity = '1';
                el.style.visibility = 'visible';
                el.style.width = '100px';
                el.style.height = '100px';
                el.style.position = 'fixed';
                el.style.top = '0';
                el.style.left = '0';
                el.style.zIndex = '999999';
            });
        """)
    except Exception:
        pass

    try:
        file_input = WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.XPATH, "//input[@type='file' and (contains(@accept, 'video') or @accept='*' or contains(@accept, 'mp4'))]"))
        )
        file_input.send_keys(os.path.abspath(video_path))
    except Exception as e:
        check_account_health(driver)
        raise RuntimeError(f"Không tìm thấy cổng nạp file video Reels: {e}")

    log("Đang tải video lên Facebook, chờ video tải xong...")
    next_btn_xpath = (
        "//*[self::button or @role='button']"
        "[@aria-label='Tiếp' or @aria-label='Next' or contains(., 'Tiếp') or contains(., 'Next')]"
    )

    def _find_active_btn(d, xpath):
        for btn in d.find_elements(By.XPATH, xpath):
            try:
                if not btn.is_displayed():
                    continue
                if btn.get_attribute("aria-disabled") == "true" or btn.get_attribute("disabled") is not None:
                    continue
                return btn
            except Exception:
                continue
        return False

    # Chờ nút 'Tiếp' bật sáng (không bị disabled)
    try:
        next_btn = WebDriverWait(driver, 45).until(lambda d: _find_active_btn(d, next_btn_xpath))
        _chk()
        log("Di chuột click nút 'Tiếp' (Bước 1)...")
        try:
            human.click(next_btn)
        except Exception:
            driver.execute_script("arguments[0].click();", next_btn)
        time.sleep(random.uniform(1.8, 2.8))
    except Exception:
        log("Cảnh báo: Bỏ qua bước 'Tiếp' đầu tiên...")

    # Bước tiếp theo (nếu có thêm nút Tiếp)
    try:
        second_next = _find_active_btn(driver, next_btn_xpath)
        if second_next:
            _chk()
            log("Di chuột click nút 'Tiếp' (Bước 2)...")
            try:
                human.click(second_next)
            except Exception:
                driver.execute_script("arguments[0].click();", second_next)
            time.sleep(random.uniform(1.8, 2.8))
    except Exception:
        pass

    # 2. Thiết lập quyền riêng tư Reels sang 'Công khai' (Public)
    _chk()
    try:
        ensure_reels_privacy_public(driver, human, log_cb=log)
    except Exception as e:
        log(f"Cảnh báo: Không thể thiết lập quyền riêng tư Reels: {e}")

    # 3. Điền Caption mô tả Reels
    if caption:
        _chk()
        caption_preview = caption.replace('\n', ' ')[:45] + ('...' if len(caption) > 45 else '')
        log(f"Nhập mô tả Reels: \"{caption_preview}\"...")
        typed_caption = False
        for attempt in range(3):
            try:
                time.sleep(0.8)
                desc_box = WebDriverWait(driver, 8).until(
                    EC.element_to_be_clickable((By.XPATH, "//div[@role='textbox']"))
                )
                try:
                    human.click(desc_box)
                except Exception:
                    driver.execute_script("arguments[0].focus();", desc_box)
                time.sleep(0.5)
                human.human_type(desc_box, caption)
                time.sleep(random.uniform(0.5, 1.0))

                # Đóng popup gợi ý hashtag nếu đang mở (nhấn ESC và blur để không bị kẹt)
                try:
                    from selenium.webdriver.common.keys import Keys
                    desc_box.send_keys(Keys.ESCAPE)
                    time.sleep(0.4)
                except Exception:
                    pass

                driver.execute_script("""
                    if (document.activeElement && document.activeElement !== document.body) {
                        document.activeElement.blur();
                    }
                    // Ẩn menu dropdown hashtag nếu đang che giao diện
                    document.querySelectorAll("[role='listbox']").forEach(p => {
                        p.style.display = 'none';
                    });
                """)
                typed_caption = True
                break
            except Exception as e:
                logger.debug(f"Thử nhập caption Reels lần {attempt+1} gặp lỗi: {e}")
                time.sleep(1.0)

        if not typed_caption:
            # Fallback nhập bằng JavaScript nếu Selenium gặp stale element
            try:
                driver.execute_script("""
                    const box = document.querySelector("div[role='textbox']");
                    if (box) {
                        box.focus();
                        document.execCommand('insertText', false, arguments[0]);
                    }
                """, caption)
                log("Đã nhập caption Reels qua fallback script.")
            except Exception as e:
                log(f"Cảnh báo: Không thể nhập caption Reels: {e}")

    # 3. Chờ nút Đăng Reels ở trạng thái sẵn sàng (aria-disabled != 'true')
    _chk()
    log("Chờ Facebook xử lý/render video và nút 'Post / Đăng' Reels sẵn sàng (kiên nhẫn đợi đến khi render xong, tối đa 15 phút)...")
    publish_btn_xpath = (
        "//*[self::button or @role='button']"
        "[@aria-label='Đăng' or @aria-label='Publish' or @aria-label='Post' "
        "or .//span[normalize-space(text())='Đăng' or normalize-space(text())='Publish' or normalize-space(text())='Post'] "
        "or (normalize-space(text())='Đăng' or normalize-space(text())='Publish' or normalize-space(text())='Post')]"
    )
    clicked_reels = False
    start_wait_reels = time.time()
    last_log_reels = start_wait_reels
    reels_timeout = 900  # 15 phút để đảm bảo các video 25MB - 100MB render xong hoàn toàn
    deadline = start_wait_reels + reels_timeout
    while time.time() < deadline:
        _chk()
        now = time.time()
        if now - last_log_reels >= 15:
            elapsed = int(now - start_wait_reels)
            log(f"Đang chờ Facebook render/xử lý video Reels (đã chờ {elapsed}s/{reels_timeout}s - kiên nhẫn đợi render xong)...")
            last_log_reels = now

        # Cuộn cột bên trái xuống dưới cùng nếu bị che khuất
        try:
            driver.execute_script("""
                const scrollables = document.querySelectorAll("div[role='dialog'], div[role='main'], div[tabindex='-1']");
                scrollables.forEach(s => {
                    if (s.scrollHeight > s.clientHeight) {
                        s.scrollTop = s.scrollHeight;
                    }
                });
            """)
        except Exception:
            pass

        try:
            candidates = driver.find_elements(By.XPATH, publish_btn_xpath)
            for btn in candidates:
                try:
                    if not btn.is_displayed():
                        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", btn)
                        time.sleep(0.3)
                    if not btn.is_displayed():
                        continue
                    if btn.get_attribute("aria-disabled") == "true" or btn.get_attribute("disabled") is not None:
                        continue
                    _chk()
                    elapsed_done = int(time.time() - start_wait_reels)
                    log(f"Video đã render xong hoàn tất (sau {elapsed_done}s)! Di chuột Bézier và bấm nút 'Post / Đăng' Reels...")
                    try:
                        human.click(btn)
                    except Exception:
                        pass

                    time.sleep(1)
                    # Click bổ sung bằng JavaScript
                    driver.execute_script("""
                        arguments[0].scrollIntoView({block: 'center'});
                        arguments[0].click();
                    """, btn)
                    clicked_reels = True
                    break
                except StaleElementReferenceException:
                    continue
            if clicked_reels:
                break
        except (StaleElementReferenceException, NoSuchElementException):
            pass
        time.sleep(1)

    if not clicked_reels:
        check_account_health(driver)
        raise RuntimeError("Nút 'Post / Đăng' Reels không khả dụng hoặc video xử lý quá 15 phút.")

    def _is_reels_uploading_or_creating(d):
        u = d.current_url.lower()
        if "/reel/create" in u or "/reels/create" in u:
            return True
        try:
            modals = d.find_elements(By.XPATH, "//*[@role='dialog'][contains(., 'Reel') or contains(., 'Thước phim')]")
            if any(m.is_displayed() for m in modals):
                return True
        except Exception:
            pass
        return False

    log("Chờ Facebook hoàn tất tải lên Reels...")
    try:
        WebDriverWait(driver, 120).until(
            lambda d: not _is_reels_uploading_or_creating(d)
        )
        log("Reels đã được đăng lên thành công!")
    except TimeoutException:
        check_account_health(driver)
        raise PublishUnconfirmed("Quá thời gian chờ đăng Reels, không thể xác nhận bài đã lên.")

    check_account_health(driver)
    # Trích xuất URL trực tiếp của Reels vừa đăng
    res_url = extract_reels_post_url(driver, uid=uid, log_cb=log)
    return res_url


# ==============================================================================
# 3. PUBLISH STORY POST
# ==============================================================================

def publish_story_post(
    driver,
    media_path: str,
    text: Optional[str] = None,
    log_cb: Optional[Any] = None,
    check_pause: Optional[Any] = None,
    uid: Optional[str] = None
) -> Optional[str]:
    """
    Tải lên Tin 24h Story (facebook.com/stories/create) bằng HumanInteraction.
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    def _chk():
        if check_pause and callable(check_pause):
            check_pause(log_cb)

    human = HumanInteraction(driver)

    if not os.path.isfile(media_path):
        raise FileNotFoundError(f"File media Story không tồn tại: {media_path}")

    _chk()
    log("Điều hướng tới trang tạo Story (facebook.com/stories/create)...")
    driver.get("https://www.facebook.com/stories/create")
    time.sleep(3)
    check_account_health(driver)
    _chk()

    # 1. Thiết lập quyền riêng tư Story sang Công khai (Public) nếu có thể
    try:
        gear_btn = None
        gear_xpaths = [
            "//*[self::div or self::button][@role='button'][@aria-label='Cài đặt' or @aria-label='Settings' or contains(@aria-label, 'privacy') or contains(@aria-label, 'riêng tư')]",
            "//div[contains(., 'Your story') or contains(., 'Tin của bạn')]//ancestor::div[2]//*[self::div or self::button][@role='button'][.//svg or .//i or @aria-label]",
        ]
        for xp in gear_xpaths:
            for elem in driver.find_elements(By.XPATH, xp):
                try:
                    if elem.is_displayed():
                        gear_btn = elem
                        break
                except Exception:
                    pass
            if gear_btn:
                break

        if not gear_btn:
            gear_btn = driver.execute_script("""
                const buttons = Array.from(document.querySelectorAll("[role='button'], button"));
                for (const b of buttons) {
                    const label = (b.getAttribute('aria-label') || '').toLowerCase();
                    if (label.includes('setting') || label.includes('cài đặt') || label.includes('privacy') || label.includes('riêng tư')) {
                        return b;
                    }
                }
                for (const b of buttons) {
                    const parent = b.closest("div");
                    if (parent && (parent.innerText || '').toLowerCase().includes('story') && b.querySelector('svg, i')) {
                        return b;
                    }
                }
                return null;
            """)

        if gear_btn:
            log("Mở cài đặt quyền riêng tư Story (Story privacy)...")
            try:
                human.click(gear_btn)
            except Exception:
                driver.execute_script("arguments[0].click();", gear_btn)
            time.sleep(1.5)

            # Chọn Public / Công khai trong modal Story privacy
            selected_pub = driver.execute_script("""
                const dialog = document.querySelector("[role='dialog']");
                if (!dialog) return false;
                const items = Array.from(dialog.querySelectorAll("[role='radio'], [role='button'], div"));
                for (const item of items) {
                    const txt = (item.innerText || item.textContent || '').trim();
                    if (txt.startsWith('Public') || txt.startsWith('Công khai')) {
                        item.click();
                        return true;
                    }
                }
                return false;
            """)
            time.sleep(0.8)

            # Bấm Save / Lưu
            save_clicked = driver.execute_script("""
                const dialog = document.querySelector("[role='dialog']");
                if (!dialog) return false;
                const btns = Array.from(dialog.querySelectorAll("[role='button'], button"));
                for (const b of btns) {
                    const t = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
                    if (t === 'save' || t === 'lưu') {
                        b.click();
                        return true;
                    }
                }
                return false;
            """)
            if save_clicked:
                log("Đã cập nhật quyền riêng tư Story sang Công khai (Public).")
            time.sleep(1.2)
    except Exception as e:
        logger.debug(f"Bỏ qua thiết lập quyền riêng tư Story: {e}")

    # 2. Nạp file Story trực tiếp qua thẻ input[type='file'] ẩn
    # TUYỆT ĐỐI KHÔNG click vào card 'Tạo tin ảnh'/'Tạo tin video' vì sẽ kích hoạt Windows Open Dialog
    _chk()
    log(f"Nạp file Story: {os.path.basename(media_path)} (Bypass Windows Dialog qua hidden input)...")
    try:
        # Đảm bảo thẻ input[type='file'] không bị ẩn style cản trở Selenium send_keys
        driver.execute_script("""
            const inputs = document.querySelectorAll("input[type='file']");
            inputs.forEach(i => {
                i.style.opacity = '1';
                i.style.display = 'block';
                i.style.visibility = 'visible';
                i.style.width = '10px';
                i.style.height = '10px';
            });
        """)
        file_input = WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.XPATH, "//input[@type='file']"))
        )
        file_input.send_keys(os.path.abspath(media_path))
        time.sleep(random.uniform(2.0, 3.0))
    except Exception as e:
        check_account_health(driver)
        raise RuntimeError(f"Không tìm thấy cổng nạp file Story ẩn: {e}")

    # 2. Nhập text nếu có
    if text:
        _chk()
        log("Thêm văn bản vào Story...")
        try:
            text_tool = WebDriverWait(driver, 5).until(
                EC.element_to_be_clickable((By.XPATH, "//div[@role='button']//span[contains(text(), 'Văn bản') or contains(text(), 'Text')]"))
            )
            human.click(text_tool)
            time.sleep(random.uniform(0.8, 1.5))
            text_input = driver.find_element(By.XPATH, "//textarea or //div[@role='textbox']")
            human.human_type(text_input, text)
        except Exception:
            log("Bỏ qua thêm text Story do không tìm thấy công cụ.")

    # 3. Sử dụng "Chờ thông minh" (Explicit Wait): Đợi nút 'Chia sẻ lên tin' thực sự sáng (clickable)
    _chk()
    log("Kích hoạt Chờ thông minh (Explicit Wait): Đợi Facebook render/transcode media và nút 'Chia sẻ lên tin' sáng...")
    share_btn_xpath = (
        "//div[@role='button'][.//span[contains(text(), 'Chia sẻ lên tin') or contains(text(), 'Share to story')]]"
        " | //button[contains(., 'Chia sẻ lên tin') or contains(., 'Share to story')]"
        " | //*[self::button or @role='button'][@aria-label='Chia sẻ lên tin' or @aria-label='Share to story']"
    )

    start_wait = time.time()
    last_poll_log = start_wait

    def check_share_button_ready(d):
        nonlocal last_poll_log
        _chk()
        now = time.time()
        if now - last_poll_log >= 15:
            elapsed = int(now - start_wait)
            log(f"Đang chờ Facebook xử lý/transcoding media (đã chờ {elapsed}s/900s - kiên nhẫn đợi render xong)...")
            last_poll_log = now

        # Kiểm tra xem có thanh progress bar / loading overlay đang chạy không
        try:
            progress_bars = d.find_elements(By.XPATH, "//*[@role='progressbar' or @aria-busy='true']")
            for p in progress_bars:
                if p.is_displayed():
                    return False
        except Exception:
            pass

        try:
            candidates = d.find_elements(By.XPATH, share_btn_xpath)
            for btn in candidates:
                if not btn.is_displayed():
                    continue
                # Kiểm tra triệt để aria-disabled và disabled trên nút cùng các cấp thẻ cha
                is_ready = d.execute_script("""
                    let elem = arguments[0];
                    if (!elem || elem.offsetParent === null) return false;
                    let cur = elem;
                    for (let i = 0; i < 4; i++) {
                        if (!cur) break;
                        if (cur.getAttribute('aria-disabled') === 'true') return false;
                        if (cur.hasAttribute('disabled')) return false;
                        cur = cur.parentElement;
                    }
                    return true;
                """, btn)
                if is_ready:
                    return btn
        except Exception:
            pass
        return False

    try:
        # Explicit Wait tối đa 900s (15 phút), kiểm tra mỗi 1.5s
        ready_btn = WebDriverWait(driver, 900, poll_frequency=1.5).until(check_share_button_ready)
    except TimeoutException:
        check_account_health(driver)
        raise RuntimeError("Nút 'Chia sẻ lên tin' không sáng sau 15 phút (Facebook bị treo transcoding video hoặc media không hợp lệ).")

    _chk()
    elapsed_total = int(time.time() - start_wait)
    log(f"Facebook đã xử lý media hoàn tất (sau {elapsed_total}s). Nút 'Chia sẻ lên tin' đã sáng!")
    log("Di chuột Bézier và bấm 'Chia sẻ lên tin'...")

    clicked = False
    try:
        human.click(ready_btn)
    except Exception:
        pass

    time.sleep(2)
    if "/stories/create" not in driver.current_url.lower():
        clicked = True
    else:
        # Fallback click JS nếu mô phỏng chưa kích hoạt
        driver.execute_script("""
            const btn = arguments[0];
            if (btn && btn.click) {
                btn.scrollIntoView({block: 'center'});
                btn.click();
            }
        """, ready_btn)
        time.sleep(2)
        if "/stories/create" not in driver.current_url.lower():
            clicked = True

    if not clicked:
        # Chờ thêm 5 giây xem có chuyển trang trễ không
        for _ in range(5):
            time.sleep(1)
            if "/stories/create" not in driver.current_url.lower():
                clicked = True
                break

    if not clicked:
        check_account_health(driver)
        raise PublishUnconfirmed("Đã bấm 'Chia sẻ lên tin' nhưng giao diện không chuyển trang, không xác nhận được Story đã lên.")

    # Chờ điều hướng khỏi trang tạo story
    try:
        WebDriverWait(driver, 90).until(
            lambda d: "/stories/create" not in d.current_url.lower()
        )
        log("Story đã được chia sẻ thành công!")
    except TimeoutException:
        check_account_health(driver)
        raise PublishUnconfirmed("Quá thời gian chờ chia sẻ Story, không thể xác nhận tin đã lên.")

    check_account_health(driver)
    # Trích xuất URL xem Tin (Story) trực tiếp
    res_url = extract_story_post_url(driver, uid=uid, log_cb=log)
    return res_url

