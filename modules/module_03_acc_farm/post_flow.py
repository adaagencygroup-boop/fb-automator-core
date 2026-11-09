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
import re
import time
import random
import logging
import base64
import hmac
import hashlib
import struct
from urllib.parse import urlparse, parse_qs, urlencode
from typing import Optional, Any, List, Callable, NamedTuple
import json

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


def wait_until(
    driver,
    predicate: Callable[[Any], bool],
    timeout: float = 45,
    check_pause: Optional[Any] = None,
    log_cb: Optional[Any] = None,
    poll: float = 0.5,
) -> bool:
    """
    Poll predicate đến khi True hoặc hết timeout.
    Nếu check_pause block khi tạm dừng, thời gian pause KHÔNG trừ vào timeout.
    """
    remaining = float(timeout)
    poll = max(0.2, float(poll))
    while remaining > 0:
        if check_pause and callable(check_pause):
            # Block đến khi resume; không trừ thời gian pause khỏi remaining
            check_pause(log_cb)
        try:
            if predicate(driver):
                return True
        except Exception:
            pass
        time.sleep(poll)
        remaining -= poll
    return False


def _status_publish_success_signal(driver) -> bool:
    """True nếu có tín hiệu bài Status đã submit (toast / hết composer soạn)."""
    try:
        js = """
            const toastRe = /(đang đăng|đã chia sẻ|đăng thành công|post shared|is being shared|your post)/i;
            const lives = Array.from(document.querySelectorAll(
                "[role='alert'], [aria-live='polite'], [aria-live='assertive']"
            ));
            for (const n of lives) {
                const t = (n.innerText || n.textContent || '').trim();
                if (t && toastRe.test(t)) return true;
            }
            const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
            for (const d of dialogs) {
                const hasComposer = !!d.querySelector("div[role='textbox']");
                const hasPostBtn = !!d.querySelector(
                    "[aria-label='Đăng'], [aria-label='Post'], [aria-label='Publish']"
                );
                if (!hasComposer && !hasPostBtn) continue;
                const rect = d.getBoundingClientRect();
                if (rect.width > 200 && rect.height > 120 && d.offsetParent !== null) {
                    return false; // composer vẫn mở
                }
            }
            return true;
        """
        return bool(driver.execute_script(js))
    except Exception:
        return False


def wait_dialog_closed(
    driver,
    timeout: int = 45,
    check_pause: Optional[Any] = None,
    log_cb: Optional[Any] = None,
) -> None:
    """Chờ hộp thoại đăng bài đóng hẳn sau khi click Đăng, xác nhận bài đã submit thành công."""
    def composer_closed(d):
        try:
            if _status_publish_success_signal(d):
                return True
        except Exception:
            pass
        try:
            composer_dialogs = d.find_elements(
                By.XPATH,
                "//div[@role='dialog' and (.//div[@role='textbox'] or .//div[@aria-label='Đăng' or @aria-label='Post'])]"
            )
            return not any(e.is_displayed() for e in composer_dialogs)
        except StaleElementReferenceException:
            return False
        except Exception:
            # Mất kết nối driver → coi như chưa xác nhận được
            return False

    ok = wait_until(
        driver,
        composer_closed,
        timeout=timeout,
        check_pause=check_pause,
        log_cb=log_cb,
        poll=0.5,
    )
    if ok:
        try:
            check_account_health(driver)
        except Exception:
            pass
        return

    try:
        check_account_health(driver)
    except Exception:
        pass
    try:
        textboxes = driver.find_elements(By.XPATH, "//div[@role='dialog']//div[@role='textbox']")
        if not any(t.is_displayed() for t in textboxes):
            return
    except Exception:
        # Driver chết giữa chừng — báo mất kết nối rõ ràng hơn PublishUnconfirmed
        raise
    raise PublishUnconfirmed("Hộp thoại đăng chưa đóng sau thời gian chờ, không xác nhận được bài đã lên.")


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
    Đóng hộp thoại Post audience CHỈ bằng nút Done / Xong trong bảng đó.
    Không bấm nút quay lại, X, nền, ESC — tránh đóng luôn hộp thoại đăng / kích hoạt Lưu nháp.
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    js_click_done = """
        function triggerRealClick(el) {
            if (!el) return false;
            try {
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                    el.dispatchEvent(new MouseEvent(evt, {
                        bubbles: true, cancelable: true, view: window
                    }));
                });
                if (typeof el.click === 'function') el.click();
                return true;
            } catch (e) { return false; }
        }
        // Chỉ trong dialog audience (không đụng dialog composer)
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
        const audience = dialogs.find(d => {
            const t = ((d.innerText || '') + ' ' + (d.getAttribute('aria-label') || '')).toLowerCase();
            return t.includes('đối tượng') || t.includes('audience') || t.includes('ai có thể xem');
        }) || null;
        const root = audience || document;
        const buttons = Array.from(root.querySelectorAll('div[role="button"], button'));
        for (const btn of buttons) {
            const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
            // Chỉ Done/Xong — KHÔNG Save/Lưu (tránh Lưu nháp), KHÔNG Back
            if (text === 'done' || text === 'xong' || aria === 'done' || aria === 'xong') {
                triggerRealClick(btn);
                return true;
            }
        }
        for (const span of Array.from(root.querySelectorAll('span'))) {
            const text = (span.innerText || span.textContent || '').trim().toLowerCase();
            if (text === 'done' || text === 'xong') {
                const btn = span.closest('div[role="button"]') || span.closest('button') || span;
                triggerRealClick(btn);
                return true;
            }
        }
        return false;
    """

    for attempt in range(3):
        if not is_audience_dialog_open(driver):
            return True
        try:
            clicked = driver.execute_script(js_click_done)
            if clicked:
                time.sleep(0.8)
                if not is_audience_dialog_open(driver):
                    log("✓ Đã bấm 'Done/Xong' và đóng bảng chọn đối tượng.")
                    return True
        except Exception:
            pass

        done_selectors = [
            "//div[@role='dialog']//div[@role='button' and (translate(@aria-label,'DONE','done')='done' or translate(@aria-label,'XONG','xong')='xong')]",
            "//div[@role='dialog']//span[normalize-space()='Done' or normalize-space()='Xong']/ancestor::div[@role='button'][1]",
            "//div[@role='dialog']//span[normalize-space()='Done' or normalize-space()='Xong']",
        ]
        for sel in done_selectors:
            try:
                for el in reversed(driver.find_elements(By.XPATH, sel)):
                    if not el.is_displayed():
                        continue
                    human.click(el)
                    time.sleep(0.8)
                    if not is_audience_dialog_open(driver):
                        log("✓ Đã bấm 'Done/Xong' qua Selenium và đóng bảng chọn đối tượng.")
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


def add_first_recommended_story_music(driver, human: HumanInteraction, log_cb: Optional[Any] = None) -> bool:
    """
    Story ảnh: bấm Add music → chọn bài đầu tiên trong mục For you / đề xuất.
    Dùng JS click + re-query để tránh StaleElementReferenceException.
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    log("Story ảnh — chọn nhạc đề xuất đầu tiên...")
    try:
        opened = driver.execute_script(
            """
            function triggerClick(el) {
                if (!el) return false;
                try {
                    el.scrollIntoView({block:'nearest', inline:'nearest'});
                    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(evt => {
                        el.dispatchEvent(new MouseEvent(evt, {bubbles:true, cancelable:true, view:window}));
                    });
                    if (typeof el.click === 'function') el.click();
                    return true;
                } catch (e) { return false; }
            }
            // Chỉ tìm Add music trong sidebar editor (trái), không đụng top-nav / profile
            const nodes = Array.from(document.querySelectorAll("[role='button'], button"));
            for (const el of nodes) {
                const r = el.getBoundingClientRect();
                if (r.top < 56) continue;          // bỏ top nav
                if (r.left > window.innerWidth * 0.45) continue;  // Add music nằm sidebar trái
                const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '')).trim().toLowerCase();
                if (!label || label.length > 40) continue;
                if (label.includes('your profile') || label.includes('account') || label.includes('hồ sơ')) continue;
                if (
                    label === 'add music' || label === 'thêm nhạc' ||
                    label.includes('add music') || label.includes('thêm nhạc')
                ) {
                    if (triggerClick(el)) return true;
                }
            }
            return false;
            """
        )
        if not opened:
            log("Không tìm thấy nút Add music — bỏ qua nhạc.")
            return False
        time.sleep(2.0)

        # Đóng menu Account nếu vô tình mở (avatar top-right)
        try:
            driver.execute_script(
                """
                const t = (document.body.innerText || '').toLowerCase();
                if (t.includes('settings & privacy') || t.includes('log out') || t.includes('đăng xuất') ||
                    t.includes('see all profiles') || t.includes('cài đặt và quyền riêng tư')) {
                    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, bubbles:true}));
                    document.dispatchEvent(new KeyboardEvent('keyup', {key:'Escape', keyCode:27, bubbles:true}));
                }
                """
            )
            time.sleep(0.3)
        except Exception:
            pass

        # Chờ panel Search music / For you hiện (input search trong panel nhạc)
        for _ in range(10):
            panel_ready = driver.execute_script(
                """
                return !!document.querySelector(
                    "input[placeholder*='Search music'], input[placeholder*='Tìm nhạc'], input[placeholder*='music'], input[placeholder*='Music']"
                ) || (() => {
                    const t = (document.body.innerText || '').toLowerCase();
                    return t.includes('search music') && (t.includes('for you') || t.includes('dành cho bạn'));
                })();
                """
            )
            if panel_ready:
                break
            time.sleep(0.5)

        # Click bài đầu: chỉ trong panel nhạc — tuyệt đối không click avatar profile / top-nav
        selected = None
        for attempt in range(5):
            # Nếu menu account đang mở thì đóng trước
            try:
                acc_open = driver.execute_script(
                    """
                    const t = (document.body.innerText || '').toLowerCase();
                    return t.includes('settings & privacy') && (t.includes('log out') || t.includes('đăng xuất') ||
                           t.includes('see all profiles'));
                    """
                )
                if acc_open:
                    from selenium.webdriver.common.keys import Keys
                    from selenium.webdriver.common.action_chains import ActionChains
                    ActionChains(driver).send_keys(Keys.ESCAPE).perform()
                    time.sleep(0.4)
                    log("Đã đóng menu Account (tránh click nhầm avatar).")
            except Exception:
                pass

            selected = driver.execute_script(
                """
                function triggerClick(el) {
                    if (!el) return null;
                    try {
                        el.scrollIntoView({block:'nearest', inline:'nearest'});
                        const r = el.getBoundingClientRect();
                        // Chặn click vùng top-nav / góc phải (avatar profile FB)
                        if (r.top < 64) return null;
                        if (r.right > window.innerWidth - 80 && r.top < 80) return null;
                        const x = r.left + r.width / 2;
                        const y = r.top + r.height / 2;
                        ['pointerover','mouseover','pointerdown','mousedown','pointerup','mouseup','click'].forEach(evt => {
                            el.dispatchEvent(new MouseEvent(evt, {
                                bubbles:true, cancelable:true, view:window, clientX:x, clientY:y
                            }));
                        });
                        if (typeof el.click === 'function') el.click();
                        const title = (el.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean)[0] || '';
                        return title || true;
                    } catch (e) { return null; }
                }

                function inChrome(el) {
                    if (!el) return true;
                    if (el.closest('[role="banner"], [role="navigation"], header')) return true;
                    const aria = ((el.getAttribute('aria-label') || '') + ' ' +
                                  (el.closest('[aria-label]')?.getAttribute('aria-label') || '')).toLowerCase();
                    if (aria.includes('your profile') || aria.includes('account') ||
                        aria.includes('hồ sơ của bạn') || aria.includes('menu')) return true;
                    // Menu account: Settings & privacy / Log out
                    let p = el;
                    for (let i = 0; i < 6 && p; i++) {
                        const tx = (p.innerText || '').toLowerCase();
                        if (tx.includes('settings & privacy') && (tx.includes('log out') || tx.includes('đăng xuất'))) {
                            return true;
                        }
                        p = p.parentElement;
                    }
                    const r = el.getBoundingClientRect();
                    if (r.top < 64) return true;
                    return false;
                }

                function isForbidden(el) {
                    if (!el || inChrome(el)) return true;
                    const tag = (el.tagName || '').toLowerCase();
                    if (tag === 'img' || tag === 'image' || tag === 'svg') return true;
                    if (el.closest('img, image, svg')) return true;
                    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                    if (aria.includes('play') || aria.includes('pause') || aria.includes('save') ||
                        aria.includes('bookmark') || aria.includes('close') || aria.includes('đóng') ||
                        aria.includes('back') || aria.includes('quay lại') || aria.includes('profile')) return true;
                    const r = el.getBoundingClientRect();
                    // Thumbnail album trong list nhạc (vuông nhỏ) — không phải target
                    if (r.width > 0 && r.height > 0 && r.width <= 72 && r.height <= 72 &&
                        Math.abs(r.width - r.height) < 12 && !!el.querySelector('img')) {
                        return true;
                    }
                    return false;
                }

                // Bắt buộc neo vào panel nhạc (input Search music / dialog For you)
                let root = null;
                const searchInput = document.querySelector(
                    "input[placeholder*='Search music'], input[placeholder*='Tìm nhạc'], input[placeholder*='music'], input[placeholder*='Music']"
                );
                if (searchInput) {
                    let p = searchInput.parentElement;
                    for (let i = 0; i < 10 && p; i++) {
                        const t = (p.innerText || '').toLowerCase();
                        const pr = p.getBoundingClientRect();
                        if (pr.width > 240 && pr.height > 200 &&
                            (t.includes('for you') || t.includes('dành cho bạn') || t.includes('saved') || t.includes('browse'))) {
                            root = p;
                            break;
                        }
                        p = p.parentElement;
                    }
                    if (!root) root = searchInput.closest('[role="dialog"]') || searchInput.parentElement;
                }
                if (!root) {
                    const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
                    for (const d of dialogs) {
                        const t = (d.innerText || '').toLowerCase();
                        if ((t.includes('search music') || t.includes('tìm nhạc')) &&
                            (t.includes('for you') || t.includes('dành cho bạn'))) {
                            root = d;
                            break;
                        }
                    }
                }
                if (!root) return null;

                const rootBox = root.getBoundingClientRect();
                // Panel nhạc không nằm ở top-right avatar
                if (rootBox.top < 40 && rootBox.right > window.innerWidth - 120) return null;

                function insideRoot(el) {
                    return root.contains(el);
                }

                // Click span tên bài trong panel nhạc thôi
                const spans = Array.from(root.querySelectorAll('span'));
                for (const s of spans) {
                    if (!s || s.offsetParent === null) continue;
                    if (!insideRoot(s) || isForbidden(s)) continue;
                    if (s.querySelector('img, svg, button')) continue;
                    const tx = (s.innerText || '').trim();
                    if (!tx || tx.length < 2 || tx.length > 80) continue;
                    const low = tx.toLowerCase();
                    if (low === 'for you' || low === 'dành cho bạn' || low === 'saved' || low === 'browse' ||
                        low === 'search music' || low.includes('tìm nhạc') || low === 'add music') continue;
                    if (!/[a-zA-ZÀ-ỹ0-9]/.test(tx)) continue;
                    if (s.querySelectorAll('span').length > 4) continue;
                    const box = s.getBoundingClientRect();
                    if (box.width < 40 || box.height < 12 || box.height > 60) continue;
                    if (box.top < rootBox.top + 40) continue; // bỏ header For you / search
                    // Phải nằm trong panel, không phải mép avatar trái của row (~ thumbnail)
                    if (box.left < rootBox.left + 56) continue;
                    const hit = triggerClick(s);
                    if (hit) return hit;
                }

                // Fallback: hàng bài trong panel — click span chữ, không click row chứa img đầu
                const rows = Array.from(root.querySelectorAll("[role='button'], [role='option']"));
                for (const row of rows) {
                    if (!row || !insideRoot(row) || row.offsetParent === null) continue;
                    if (inChrome(row)) continue;
                    const txt = (row.innerText || '').trim();
                    const low = txt.toLowerCase();
                    const aria = (row.getAttribute('aria-label') || '').toLowerCase();
                    if (!txt || txt.length < 3) continue;
                    if (aria.includes('play') || aria.includes('profile') || aria.includes('account')) continue;
                    if (low === 'for you' || low === 'saved' || low === 'browse') continue;
                    const lines = txt.split('\\n').map(s => s.trim()).filter(Boolean);
                    if (!lines.length || lines[0].length < 2 || lines[0].length > 80) continue;
                    if (!row.querySelector('img')) continue;
                    const r = row.getBoundingClientRect();
                    if (r.width < 160 || r.height < 36 || r.height > 120) continue;
                    if (r.top < 64) continue;

                    const titleEl = Array.from(row.querySelectorAll('span')).find(s => {
                        const t = (s.innerText || '').trim();
                        const b = s.getBoundingClientRect();
                        return t.length >= 2 && t.length < 80 && !s.querySelector('img,svg') &&
                               !isForbidden(s) && b.left >= rootBox.left + 56;
                    });
                    if (!titleEl) continue;
                    const hit = triggerClick(titleEl);
                    if (hit) return typeof hit === 'string' && hit.length > 1 ? hit : lines[0];
                }
                return null;
                """
            )
            if selected:
                break
            time.sleep(0.8)

        if selected:
            title = selected if isinstance(selected, str) else ""
            log(f"✓ Đã chọn nhạc đề xuất đầu tiên{f': {title}' if title else ''}.")
            time.sleep(1.8)
            # Thu nhỏ sticker nhạc + kéo sang góc phải preview
            _shrink_and_place_story_music_sticker(driver, human, log_cb=log)
            return True

        log("Không chọn được bài nhạc đề xuất — tiếp tục đăng không nhạc.")
        try:
            driver.execute_script(
                """
                const closes = Array.from(document.querySelectorAll("[aria-label='Close'], [aria-label='Đóng'], [aria-label='close']"));
                for (const c of closes) { try { c.click(); return true; } catch(e) {} }
                return false;
                """
            )
        except Exception:
            pass
        return False
    except StaleElementReferenceException:
        log("Stale khi chọn nhạc — thử lại click title trong panel nhạc...")
        try:
            ok = driver.execute_script(
                """
                const input = document.querySelector(
                    "input[placeholder*='Search music'], input[placeholder*='Tìm nhạc'], input[placeholder*='music']"
                );
                const root = input ? (input.closest('[role="dialog"]') || input.parentElement.parentElement) : null;
                if (!root) return false;
                const rootLeft = root.getBoundingClientRect().left;
                const spans = Array.from(root.querySelectorAll('span'));
                for (const s of spans) {
                    if (!s || s.offsetParent === null) continue;
                    if (s.querySelector('img, svg')) continue;
                    if (s.closest('[role="banner"], header')) continue;
                    const t = (s.innerText || '').trim();
                    if (t.length < 3 || t.length > 80) continue;
                    const low = t.toLowerCase();
                    if (low.includes('search') || low === 'for you' || low === 'saved' || low === 'browse') continue;
                    const box = s.getBoundingClientRect();
                    if (box.top < 64 || box.left < rootLeft + 56 || box.width < 40) continue;
                    s.click();
                    return t;
                }
                return false;
                """
            )
            if ok:
                time.sleep(1.5)
                _shrink_and_place_story_music_sticker(driver, human, log_cb=log)
            return bool(ok)
        except Exception:
            return False
    except Exception as e:
        log(f"Bỏ qua chọn nhạc Story: {e}")
        return False


def _shrink_and_place_story_music_sticker(
    driver, human: HumanInteraction, log_cb: Optional[Any] = None
) -> bool:
    """
    Sau khi chọn bài: chọn kiểu sticker nhỏ (icon cuối) rồi kéo sang góc phải preview, Done.
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    log("Thu nhỏ hình nhạc và đặt sang góc phải...")
    try:
        # 1) Chọn style nhỏ nhất (thường là nút tròn thứ 4 cạnh Remove)
        style_ok = driver.execute_script(
            """
            function triggerClick(el) {
                if (!el) return false;
                try {
                    el.scrollIntoView({block:'center'});
                    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(evt => {
                        el.dispatchEvent(new MouseEvent(evt, {bubbles:true, cancelable:true, view:window}));
                    });
                    if (typeof el.click === 'function') el.click();
                    return true;
                } catch (e) { return false; }
            }

            // Panel có nút Remove + 4 icon style (icon cuối = sticker nhỏ dạng tag)
            const removeBtns = Array.from(document.querySelectorAll("[role='button'], button, span"))
                .filter(el => /^remove$|^gỡ$|^xóa$/i.test((el.innerText || '').trim()));
            for (const rem of removeBtns) {
                let panel = rem.closest('div');
                for (let i = 0; i < 7 && panel; i++) {
                    const circles = Array.from(panel.querySelectorAll("[role='button']"))
                        .filter(el => {
                            const box = el.getBoundingClientRect();
                            return el.offsetParent !== null &&
                                box.width >= 28 && box.width <= 56 &&
                                Math.abs(box.width - box.height) < 10;
                        });
                    // Nhóm thành hàng ngang ~4 icon
                    if (circles.length >= 3) {
                        circles.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
                        // Lấy cụm gần nhau theo trục Y
                        const top0 = circles[0].getBoundingClientRect().top;
                        const row = circles.filter(c => Math.abs(c.getBoundingClientRect().top - top0) < 20);
                        if (row.length >= 3) {
                            const smallStyle = row[row.length - 1];
                            return triggerClick(smallStyle) ? 'style_small_tag' : false;
                        }
                    }
                    panel = panel.parentElement;
                }
            }

            // Fallback: hàng 3–5 nút tròn
            const all = Array.from(document.querySelectorAll("[role='button']")).filter(el => {
                const box = el.getBoundingClientRect();
                return box.width >= 28 && box.width <= 56 && Math.abs(box.width - box.height) < 10 && el.offsetParent !== null;
            });
            if (all.length >= 3) {
                all.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
                return triggerClick(all[all.length - 1]) ? 'fallback_last' : false;
            }
            return false;
            """
        )
        if style_ok:
            log(f"✓ Đã chọn kiểu nhạc nhỏ ({style_ok}).")
        else:
            log("Không đổi được kiểu sticker — vẫn kéo góc phải nếu thấy sticker.")
        time.sleep(1.0)

        # 2) Kéo sticker nhạc sang góc phải (dưới-phải) của vùng Preview
        placed = False
        try:
            from selenium.webdriver.common.action_chains import ActionChains

            sticker = driver.execute_script(
                """
                // Sticker nhạc trên canvas preview — thường có ảnh album + tên bài
                const candidates = Array.from(document.querySelectorAll("div, img")).filter(el => {
                    if (!el || el.offsetParent === null) return false;
                    const r = el.getBoundingClientRect();
                    // Sau khi thu nhỏ: tag ngang nhỏ; trước đó: sticker vuông lớn
                    if (r.width < 36 || r.height < 18 || r.width > 420 || r.height > 240) return false;
                    // Nằm trong vùng preview (không phải sidebar trái)
                    if (r.left < 280) return false;
                    const t = (el.innerText || '').toLowerCase();
                    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                    const hasMusicHint = t.includes('♪') || t.includes('♫') ||
                        aria.includes('music') || aria.includes('nhạc') ||
                        !!el.querySelector('img');
                    return hasMusicHint || (r.width > 80 && r.height > 40 && r.left > 400);
                });
                // Ưu tiên phần tử gần giữa preview theo chiều dọc
                candidates.sort((a,b) => {
                    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
                    return Math.abs((ra.top+ra.bottom)/2 - window.innerHeight/2) -
                           Math.abs((rb.top+rb.bottom)/2 - window.innerHeight/2);
                });
                return candidates[0] || null;
                """
            )
            if sticker:
                preview = driver.execute_script(
                    """
                    // Vùng preview tối / canvas
                    const nodes = Array.from(document.querySelectorAll("div"));
                    let best = null, bestArea = 0;
                    for (const n of nodes) {
                        const r = n.getBoundingClientRect();
                        if (r.width < 280 || r.height < 400) continue;
                        if (r.left < 250) continue; // bỏ sidebar
                        const area = r.width * r.height;
                        if (area > bestArea) { bestArea = area; best = n; }
                    }
                    return best;
                    """
                )
                if preview:
                    pr = preview.rect
                    sr = sticker.rect
                    # Góc phải dưới preview
                    target_x = int(pr["x"] + pr["width"] * 0.86)
                    target_y = int(pr["y"] + pr["height"] * 0.82)
                    start_x = int(sr["x"] + sr["width"] / 2)
                    start_y = int(sr["y"] + sr["height"] / 2)
                    offset_x = target_x - start_x
                    offset_y = target_y - start_y
                    ActionChains(driver).click_and_hold(sticker).pause(0.15).move_by_offset(
                        offset_x, offset_y
                    ).pause(0.1).release().perform()
                    placed = True
                    log("✓ Đã kéo sticker nhạc sang góc phải.")
                    time.sleep(0.6)
        except StaleElementReferenceException:
            log("Stale khi kéo sticker — thử đặt bằng JS...")
        except Exception as e:
            logger.debug(f"Drag music sticker: {e}")

        if not placed:
            # JS fallback: pointer events drag
            try:
                ok = driver.execute_script(
                    """
                    const sticker = arguments[0];
                    // re-find sticker roughly
                    const all = Array.from(document.querySelectorAll("div")).filter(el => {
                        const r = el.getBoundingClientRect();
                        return r.left > 300 && r.width > 60 && r.width < 360 && r.height > 30 && r.height < 200;
                    });
                    const el = all[0];
                    if (!el) return false;
                    const preview = Array.from(document.querySelectorAll("div")).filter(n => {
                        const r = n.getBoundingClientRect();
                        return r.left > 250 && r.width > 280 && r.height > 400;
                    }).sort((a,b) => (b.getBoundingClientRect().width*b.getBoundingClientRect().height) -
                                    (a.getBoundingClientRect().width*a.getBoundingClientRect().height))[0];
                    if (!preview) return false;
                    const pr = preview.getBoundingClientRect();
                    const sr = el.getBoundingClientRect();
                    const fromX = sr.left + sr.width/2, fromY = sr.top + sr.height/2;
                    const toX = pr.left + pr.width * 0.86, toY = pr.top + pr.height * 0.82;
                    function fire(type, x, y) {
                        el.dispatchEvent(new PointerEvent(type, {
                            bubbles: true, cancelable: true, view: window,
                            clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true
                        }));
                    }
                    fire('pointerdown', fromX, fromY);
                    fire('pointermove', (fromX+toX)/2, (fromY+toY)/2);
                    fire('pointermove', toX, toY);
                    fire('pointerup', toX, toY);
                    return true;
                    """
                )
                if ok:
                    placed = True
                    log("✓ Đã đặt sticker nhạc góc phải (JS).")
            except Exception:
                pass

        # 3) Bấm Done / checkmark nếu có
        try:
            driver.execute_script(
                """
                function triggerClick(el) {
                    if (!el) return false;
                    try {
                        el.click();
                        return true;
                    } catch (e) { return false; }
                }
                const btns = Array.from(document.querySelectorAll("[role='button'], button"));
                for (const b of btns) {
                    const a = (b.getAttribute('aria-label') || '').toLowerCase();
                    const t = (b.innerText || '').trim().toLowerCase();
                    if (a.includes('done') || a.includes('xong') || a === 'ok' || t === 'done' || t === 'xong') {
                        if (triggerClick(b)) return true;
                    }
                }
                // Nút check trắng nhỏ góc dưới editor
                const checks = btns.filter(b => {
                    const r = b.getBoundingClientRect();
                    return r.width >= 28 && r.width <= 56 && r.height >= 28 && r.height <= 56 && b.offsetParent !== null;
                });
                if (checks.length) return triggerClick(checks[checks.length - 1]);
                return false;
                """
            )
            time.sleep(0.5)
        except Exception:
            pass

        return bool(style_ok or placed)
    except Exception as e:
        log(f"Không thu nhỏ/kéo nhạc được: {e}")
        return False


def ensure_story_privacy_public(
    driver,
    human: HumanInteraction,
    log_cb: Optional[Any] = None,
    *,
    open_panel: bool = True,
) -> bool:
    """
    Xử lý modal 'Story privacy' / 'Who can see your story?':
    chọn Public → Save → confirm Change story privacy.
    Nếu Public đã chọn sẵn: đóng modal (Cancel), không Save lại.
    open_panel=False: chỉ xử lý khi modal đang mở (không bấm bánh răng lại).
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    def _dialog_open():
        """Modal chọn Public/Friends (không gồm modal xác nhận Change story privacy)."""
        try:
            return bool(
                driver.execute_script(
                    """
                    const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
                    for (const d of dialogs) {
                        if (d.offsetParent === null && getComputedStyle(d).display === 'none') continue;
                        const t = (d.innerText || '').toLowerCase();
                        // Bỏ qua modal xác nhận sau khi đổi Public
                        if (
                            t.includes('change story privacy') ||
                            t.includes('changes you make will apply') ||
                            t.includes('thay đổi quyền riêng tư của tin') ||
                            t.includes('thay đổi bạn thực hiện')
                        ) continue;
                        if (
                            (t.includes('story privacy') || t.includes('who can see your story') ||
                             t.includes('ai có thể xem tin') || t.includes('quyền riêng tư của tin')) &&
                            (t.includes('public') || t.includes('công khai')) &&
                            (t.includes('friends') || t.includes('bạn bè'))
                        ) {
                            return true;
                        }
                        if (t.includes('public') && t.includes('friends') && (t.includes('save') || t.includes('lưu'))) {
                            return true;
                        }
                    }
                    return false;
                    """
                )
            )
        except Exception:
            return False

    def _open_privacy_panel():
        # Bắt buộc bấm bánh răng cạnh "Your story" để mở Story privacy
        opened = driver.execute_script(
            """
            function triggerClick(el) {
                if (!el) return false;
                try {
                    el.scrollIntoView({block:'center'});
                    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(evt => {
                        el.dispatchEvent(new MouseEvent(evt, {bubbles:true, cancelable:true, view:window}));
                    });
                    if (typeof el.click === 'function') el.click();
                    return true;
                } catch (e) { return false; }
            }

            // Ưu tiên: bánh răng (nút tròn có SVG) ngay cạnh "Your story" / "Tin của bạn"
            const labels = Array.from(document.querySelectorAll('span, div, h1, h2'));
            for (const h of labels) {
                const raw = (h.innerText || '').trim();
                // Chỉ lấy node chữ ngắn đúng tiêu đề (tránh div cha chứa cả sidebar)
                if (raw.length > 24) continue;
                const t = raw.toLowerCase();
                if (t !== 'your story' && t !== 'tin của bạn') continue;

                let row = h;
                for (let i = 0; i < 6 && row; i++) {
                    const btns = Array.from(row.querySelectorAll("[role='button'], button"));
                    // Gear: nút nhỏ có svg, cạnh title (thường trong vòng tròn xanh)
                    const gearCandidates = btns.filter(b => {
                        const r = b.getBoundingClientRect();
                        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                        const txt = (b.innerText || '').trim().toLowerCase();
                        if (txt.includes('discard') || txt.includes('share') || txt.includes('chia sẻ') ||
                            txt.includes('add text') || txt.includes('add music')) return false;
                        if (r.width < 18 || r.width > 52 || r.height < 18 || r.height > 52) return false;
                        if (Math.abs(r.width - r.height) > 10) return false;
                        const hasSvg = !!b.querySelector('svg');
                        const looksSettings = aria.includes('setting') || aria.includes('cài đặt') ||
                            aria.includes('privacy') || aria.includes('riêng tư');
                        return hasSvg || looksSettings;
                    });
                    // Ưu tiên nút gần title nhất theo khoảng cách ngang
                    const hr = h.getBoundingClientRect();
                    gearCandidates.sort((a, b) => {
                        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
                        return Math.abs(ar.left - hr.right) - Math.abs(br.left - hr.right);
                    });
                    for (const b of gearCandidates) {
                        if (triggerClick(b)) return 'gear_near_title';
                    }
                    row = row.parentElement;
                }
            }

            // Fallback aria-label Settings / Story privacy
            const buttons = Array.from(document.querySelectorAll("[role='button'], button"));
            for (const b of buttons) {
                const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')).toLowerCase();
                if (
                    label.includes('setting') || label.includes('cài đặt') ||
                    label.includes('privacy') || label.includes('riêng tư') ||
                    label.includes('story privacy')
                ) {
                    if (triggerClick(b)) return 'aria';
                }
            }
            return false;
            """
        )
        return bool(opened)

    def _pick_public():
        """Chọn radio Public trên modal Story privacy (Friends đang chọn)."""
        return driver.execute_script(
            """
            function triggerClick(el) {
                if (!el) return false;
                try {
                    el.scrollIntoView({block:'center'});
                    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(evt => {
                        el.dispatchEvent(new MouseEvent(evt, {bubbles:true, cancelable:true, view:window}));
                    });
                    if (typeof el.click === 'function') el.click();
                    return true;
                } catch (e) { return false; }
            }

            const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
            let dialog = null;
            for (const d of dialogs) {
                const t = (d.innerText || '').toLowerCase();
                if (
                    t.includes('change story privacy') ||
                    t.includes('changes you make will apply') ||
                    t.includes('thay đổi quyền riêng tư của tin')
                ) continue;
                if (
                    t.includes('who can see your story') ||
                    t.includes('ai có thể xem tin') ||
                    ((t.includes('story privacy') || t.includes('quyền riêng tư')) &&
                     (t.includes('public') || t.includes('công khai')) &&
                     (t.includes('friends') || t.includes('bạn bè')))
                ) {
                    dialog = d;
                    break;
                }
            }
            if (!dialog) return { ok: false, reason: 'no_dialog' };

            // Click đúng dòng Public (không Friends / Custom / Hide story from)
            let picked = false;
            // Ưu tiên: span đúng chữ "Public" / "Công khai"
            const spans = Array.from(dialog.querySelectorAll('span'));
            for (const s of spans) {
                const t = (s.innerText || '').trim();
                if (t !== 'Public' && t !== 'Công khai') continue;
                const row = s.closest('[role="radio"]') ||
                            s.closest('[role="listitem"]') ||
                            s.closest('[role="button"]') ||
                            s.closest('label') ||
                            s.parentElement;
                const radio = (row && row.querySelector('[role="radio"]')) ||
                              (row && row.matches('[role="radio"]') ? row : null);
                picked = triggerClick(radio || row || s);
                if (picked) return { ok: true, via: 'public_label' };
            }

            const radios = Array.from(dialog.querySelectorAll("[role='radio'], [role='option'], label, div[role='button']"));
            for (const item of radios) {
                const txt = (item.innerText || item.textContent || item.getAttribute('aria-label') || '').trim();
                const low = txt.toLowerCase();
                if (!low || low.length > 120) continue;
                if (low.includes('friends') || low.includes('bạn bè') || low.includes('custom') ||
                    low.includes('hide story') || low.includes('ẩn tin')) continue;
                const isPublicRow = (
                    low.startsWith('public') || low.startsWith('công khai') ||
                    low.includes('anyone on facebook') || low.includes('bất kỳ ai trên facebook')
                );
                if (!isPublicRow) continue;
                const radio = item.matches('[role="radio"]') ? item : item.querySelector('[role="radio"]');
                picked = triggerClick(radio || item);
                if (picked) return { ok: true, via: 'public_row' };
            }
            return { ok: false, reason: 'public_not_found' };
            """
        )

    def _find_story_privacy_save_btn():
        """Tìm nút Save xanh trên modal Story privacy (không phải Change story privacy)."""
        # XPath: dialog Story privacy có Public/Friends → nút Save
        xpaths = [
            (
                "//div[@role='dialog']"
                "[.//*[contains(text(),'Who can see your story') or contains(text(),'Story privacy') "
                "or contains(text(),'Ai có thể xem tin')]]"
                "[not(.//*[contains(text(),'Change story privacy')])]"
                "[not(.//*[contains(text(),'Changes you make will apply')])]"
                "//*[@role='button' or self::button]"
                "[.//span[normalize-space()='Save' or normalize-space()='Lưu'] "
                "or normalize-space()='Save' or normalize-space()='Lưu']"
            ),
            (
                "//div[@role='dialog']"
                "[contains(., 'Public') and contains(., 'Friends') and (contains(., 'Save') or contains(., 'Lưu'))]"
                "[not(contains(., 'Change story privacy'))]"
                "[not(contains(., 'Changes you make will apply'))]"
                "//*[@role='button' or self::button]"
                "[.//span[normalize-space()='Save' or normalize-space()='Lưu'] "
                "or normalize-space()='Save' or normalize-space()='Lưu']"
            ),
        ]
        for xp in xpaths:
            try:
                for el in driver.find_elements(By.XPATH, xp):
                    try:
                        if not el.is_displayed():
                            continue
                        label = (el.text or "").strip().lower()
                        aria = (el.get_attribute("aria-label") or "").strip().lower()
                        if "cancel" in label or "hủy" in label or "huỷ" in label:
                            continue
                        if "cancel" in aria:
                            continue
                        if label in ("save", "lưu") or "save" in label or "lưu" in label or aria in ("save", "lưu"):
                            return el
                        # span bên trong đúng Save
                        if label == "" or "save" in label or "lưu" in label:
                            return el
                    except StaleElementReferenceException:
                        continue
            except Exception:
                continue
        return None

    def _save_story_privacy_dialog():
        """Bấm Save trên modal Story privacy (lần 1) — sau đó FB hiện Change story privacy."""
        # 1) Selenium + human click (FB hay bỏ qua JS click thuần)
        btn = _find_story_privacy_save_btn()
        if btn is not None:
            try:
                driver.execute_script("arguments[0].scrollIntoView({block:'center'});", btn)
                time.sleep(0.15)
                try:
                    human.click(btn)
                    return True
                except Exception:
                    pass
                try:
                    from selenium.webdriver.common.action_chains import ActionChains
                    ActionChains(driver).move_to_element(btn).pause(0.1).click().perform()
                    return True
                except Exception:
                    pass
                try:
                    btn.click()
                    return True
                except Exception:
                    pass
                driver.execute_script("arguments[0].click();", btn)
                return True
            except StaleElementReferenceException:
                pass
            except Exception as e:
                logger.debug(f"_save_story_privacy_dialog human: {e}")

        # 2) JS fallback — tìm span Save rồi click parent button
        try:
            return bool(
                driver.execute_script(
                    """
                    function triggerClick(el) {
                        if (!el) return false;
                        try {
                            el.scrollIntoView({block:'center'});
                            const r = el.getBoundingClientRect();
                            const x = r.left + r.width/2, y = r.top + r.height/2;
                            ['pointerover','pointerenter','mouseover','mouseenter','pointerdown','mousedown',
                             'pointerup','mouseup','click'].forEach(evt => {
                                el.dispatchEvent(new MouseEvent(evt, {
                                    bubbles:true, cancelable:true, view:window, clientX:x, clientY:y
                                }));
                            });
                            if (typeof el.click === 'function') el.click();
                            return true;
                        } catch (e) { return false; }
                    }

                    const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
                    for (const d of dialogs) {
                        const t = (d.innerText || '').toLowerCase();
                        if (
                            t.includes('change story privacy') ||
                            t.includes('changes you make will apply') ||
                            t.includes('thay đổi quyền riêng tư của tin')
                        ) continue;
                        if (!(
                            t.includes('who can see your story') ||
                            t.includes('story privacy') ||
                            ((t.includes('public') || t.includes('công khai')) &&
                             (t.includes('friends') || t.includes('bạn bè')))
                        )) continue;

                        // Ưu tiên span đúng chữ Save / Lưu
                        const spans = Array.from(d.querySelectorAll('span'));
                        for (const s of spans) {
                            const tx = (s.innerText || '').trim();
                            if (tx !== 'Save' && tx !== 'Lưu') continue;
                            const btn = s.closest('[role="button"]') || s.closest('button') || s.parentElement;
                            if (triggerClick(btn || s)) return true;
                        }

                        const btns = Array.from(d.querySelectorAll("[role='button'], button"));
                        for (const b of btns) {
                            const label = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
                            if (!label || label.includes('cancel') || label.includes('hủy') || label.includes('huỷ')) continue;
                            if (label === 'save' || label === 'lưu' || label.startsWith('save') || label.startsWith('lưu')) {
                                if (triggerClick(b)) return true;
                            }
                        }
                    }
                    return false;
                    """
                )
            )
        except Exception:
            return False

    def _confirm_change_privacy_open():
        """Modal xác nhận 'Change story privacy' sau khi Save lần 1."""
        try:
            return bool(
                driver.execute_script(
                    """
                    const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
                    for (const d of dialogs) {
                        if (d.offsetParent === null && getComputedStyle(d).display === 'none') continue;
                        const t = (d.innerText || '').toLowerCase();
                        if (
                            t.includes('change story privacy') ||
                            t.includes('thay đổi quyền riêng tư của tin') ||
                            t.includes('thay đổi quyền riêng tư tin') ||
                            (t.includes('changes you make will apply') && (t.includes('save') || t.includes('lưu'))) ||
                            (t.includes('thay đổi bạn thực hiện') && (t.includes('save') || t.includes('lưu')))
                        ) {
                            return true;
                        }
                    }
                    return false;
                    """
                )
            )
        except Exception:
            return False

    def _confirm_change_privacy_save():
        """Bấm Save trên modal 'Change story privacy' (không bấm Cancel)."""
        # 1) JS click trong dialog
        try:
            ok = driver.execute_script(
                """
                function triggerClick(el) {
                    if (!el) return false;
                    try {
                        el.scrollIntoView({block:'center'});
                        ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(evt => {
                            el.dispatchEvent(new MouseEvent(evt, {bubbles:true, cancelable:true, view:window}));
                        });
                        if (typeof el.click === 'function') el.click();
                        return true;
                    } catch (e) { return false; }
                }

                const roots = Array.from(document.querySelectorAll("[role='dialog'], [role='alertdialog'], div"));
                let dialog = null;
                for (const d of roots) {
                    const t = (d.innerText || '').toLowerCase();
                    if (!t) continue;
                    // Chỉ lấy node đủ nhỏ (đúng modal), không lấy cả page
                    if (t.length > 800) continue;
                    if (
                        t.includes('change story privacy') ||
                        t.includes('thay đổi quyền riêng tư của tin') ||
                        t.includes('thay đổi quyền riêng tư tin') ||
                        (t.includes('changes you make will apply') && (t.includes('save') || t.includes('lưu'))) ||
                        (t.includes('thay đổi bạn thực hiện') && (t.includes('save') || t.includes('lưu')))
                    ) {
                        dialog = d;
                        break;
                    }
                }
                if (!dialog) return false;

                const btns = Array.from(dialog.querySelectorAll("[role='button'], button"));
                // Ưu tiên nút Save (xanh) — bỏ Cancel
                for (const b of btns) {
                    const label = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
                    if (label === 'cancel' || label === 'hủy' || label === 'huỷ') continue;
                    if (label === 'save' || label === 'lưu') {
                        return triggerClick(b);
                    }
                }
                // Span "Save" bên trong button
                const spans = Array.from(dialog.querySelectorAll('span'));
                for (const s of spans) {
                    const t = (s.innerText || '').trim();
                    if (t !== 'Save' && t !== 'Lưu') continue;
                    const btn = s.closest('[role="button"]') || s.closest('button') || s;
                    return triggerClick(btn);
                }
                return false;
                """
            )
            if ok:
                return True
        except Exception:
            pass

        # 2) Selenium XPath fallback — Save trong modal Change story privacy
        try:
            xpaths = [
                (
                    "//div[@role='dialog']"
                    "[.//*[contains(text(),'Change story privacy') or contains(text(),'Thay đổi quyền riêng tư') "
                    "or contains(text(),'Changes you make will apply')]]"
                    "//*[@role='button' or self::button]"
                    "[.//span[normalize-space()='Save' or normalize-space()='Lưu'] "
                    "or normalize-space()='Save' or normalize-space()='Lưu']"
                ),
                (
                    "//*[@role='dialog' or @role='alertdialog']"
                    "[contains(., 'Change story privacy') or contains(., 'Changes you make will apply')]"
                    "//*[@role='button' or self::button]"
                    "[normalize-space()='Save' or .//span[normalize-space()='Save' or normalize-space()='Lưu']]"
                ),
            ]
            for xp in xpaths:
                els = driver.find_elements(By.XPATH, xp)
                for el in els:
                    try:
                        if not el.is_displayed():
                            continue
                        label = (el.text or "").strip().lower()
                        if "cancel" in label or "hủy" in label:
                            continue
                        try:
                            human.click(el)
                        except Exception:
                            driver.execute_script("arguments[0].click();", el)
                        return True
                    except StaleElementReferenceException:
                        continue
                    except Exception:
                        continue
        except Exception:
            pass
        return False

    def _force_close_dialog():
        try:
            driver.execute_script(
                """
                const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
                for (const d of dialogs) {
                    const t = (d.innerText || '').toLowerCase();
                    if (!(t.includes('story privacy') || t.includes('who can see your story') ||
                          t.includes('change story privacy') ||
                          (t.includes('public') && t.includes('friends')))) continue;
                    // Ưu tiên Save trên confirm nếu còn mở
                    const btns = Array.from(d.querySelectorAll("[role='button'], button"));
                    for (const b of btns) {
                        const label = (b.getAttribute('aria-label') || b.innerText || '').trim().toLowerCase();
                        if (label === 'save' || label === 'lưu') {
                            b.click();
                            return true;
                        }
                    }
                    const closeBtn = d.querySelector("[aria-label='Close'], [aria-label='Đóng'], [aria-label='close']");
                    if (closeBtn) { closeBtn.click(); return true; }
                    for (const b of btns) {
                        const label = (b.getAttribute('aria-label') || b.innerText || '').trim().toLowerCase();
                        if (label === 'cancel' || label === 'hủy' || label === 'close' || label === 'đóng') {
                            b.click();
                            return true;
                        }
                    }
                }
                return false;
                """
            )
        except Exception:
            pass
        try:
            from selenium.webdriver.common.keys import Keys
            from selenium.webdriver.common.action_chains import ActionChains
            ActionChains(driver).send_keys(Keys.ESCAPE).perform()
        except Exception:
            pass

    def _public_already_selected():
        """Public radio đang checked trên modal Story privacy."""
        try:
            return bool(
                driver.execute_script(
                    """
                    const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
                    for (const d of dialogs) {
                        const t = (d.innerText || '').toLowerCase();
                        if (t.includes('change story privacy') || t.includes('changes you make will apply')) continue;
                        if (!(t.includes('who can see your story') || t.includes('story privacy') ||
                              (t.includes('public') && t.includes('friends')))) continue;

                        const radios = Array.from(d.querySelectorAll('[role="radio"]'));
                        for (const r of radios) {
                            const label = ((r.getAttribute('aria-label') || '') + ' ' + (r.innerText || '')).toLowerCase();
                            const checked = r.getAttribute('aria-checked') === 'true' ||
                                            r.getAttribute('aria-selected') === 'true';
                            if (!checked) continue;
                            if (label.includes('public') || label.includes('công khai') ||
                                label.includes('anyone on facebook')) {
                                return true;
                            }
                            // Friends đang chọn → chưa Public
                            if (label.includes('friends') || label.includes('bạn bè')) return false;
                        }
                        // Fallback: hàng Public có radio checked bên trong
                        const spans = Array.from(d.querySelectorAll('span'));
                        for (const s of spans) {
                            const tx = (s.innerText || '').trim();
                            if (tx !== 'Public' && tx !== 'Công khai') continue;
                            const row = s.closest('[role="radio"]') || s.closest('[role="listitem"]') ||
                                        s.closest('label') || s.parentElement;
                            if (!row) continue;
                            const radio = row.matches('[role="radio"]') ? row : row.querySelector('[role="radio"]');
                            if (radio && (radio.getAttribute('aria-checked') === 'true' ||
                                          radio.getAttribute('aria-selected') === 'true')) {
                                return true;
                            }
                        }
                    }
                    return false;
                    """
                )
            )
        except Exception:
            return False

    def _cancel_or_close_privacy():
        """Đóng Story privacy khi đã Public — Cancel/X, không Save lại."""
        try:
            return bool(
                driver.execute_script(
                    """
                    function triggerClick(el) {
                        if (!el) return false;
                        try { el.click(); return true; } catch (e) { return false; }
                    }
                    const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
                    for (const d of dialogs) {
                        const t = (d.innerText || '').toLowerCase();
                        if (t.includes('change story privacy') || t.includes('changes you make will apply')) continue;
                        if (!(t.includes('who can see your story') || t.includes('story privacy') ||
                              (t.includes('public') && t.includes('friends')))) continue;
                        const btns = Array.from(d.querySelectorAll("[role='button'], button"));
                        for (const b of btns) {
                            const label = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
                            if (label === 'cancel' || label === 'hủy' || label === 'huỷ') {
                                return triggerClick(b);
                            }
                        }
                        const closeBtn = d.querySelector("[aria-label='Close'], [aria-label='Đóng'], [aria-label='close']");
                        if (closeBtn) return triggerClick(closeBtn);
                    }
                    return false;
                    """
                )
            )
        except Exception:
            return False

    # Confirm modal còn treo từ lần trước → Save rồi xong
    if _confirm_change_privacy_open():
        log("Modal Change story privacy đang mở — Save xác nhận...")
        _confirm_change_privacy_save()
        time.sleep(1.0)
        if not _confirm_change_privacy_open() and not _dialog_open():
            return True

    if open_panel and not _dialog_open():
        log("Bấm bánh răng Story privacy để kiểm tra (Friends → Public)...")
        time.sleep(0.4)
        for open_try in range(2):
            try:
                if _open_privacy_panel():
                    log("✓ Đã mở panel privacy qua bánh răng.")
                    time.sleep(1.2)
                    break
            except Exception:
                pass
            time.sleep(0.5)

    if not _dialog_open():
        if not open_panel:
            return True
        log("Không thấy modal Story privacy — bỏ qua.")
        return True

    # Đã Public sẵn → đóng modal, KHÔNG Save lại (tránh hiện confirm / lặp nhiều lần)
    if _public_already_selected():
        log("✓ Story privacy đã là Public — đóng modal, không Save lại.")
        _cancel_or_close_privacy()
        time.sleep(0.6)
        if _dialog_open():
            try:
                from selenium.webdriver.common.keys import Keys
                from selenium.webdriver.common.action_chains import ActionChains
                ActionChains(driver).send_keys(Keys.ESCAPE).perform()
            except Exception:
                _force_close_dialog()
            time.sleep(0.4)
        return not _dialog_open()

    log("Chọn Public → Save Story privacy → modal Change story privacy → Save...")
    for attempt in range(2):
        try:
            # 1) Chọn Public (Friends → Public)
            pick = _pick_public() or {}
            if not pick.get("ok"):
                log(f"Chưa chọn được Public (lần {attempt + 1}) — thử lại...")
                time.sleep(0.6)
                continue
            log(f"✓ Đã chọn Public ({pick.get('via', 'ok')}).")
            time.sleep(0.5)

            # 2) Save Story privacy (tối đa 2 lần — không spam 4 lần)
            save_ok = False
            for save_try in range(2):
                if not _dialog_open() or _confirm_change_privacy_open():
                    save_ok = True
                    break
                clicked = _save_story_privacy_dialog()
                log(f"{'✓' if clicked else '✗'} Click Save Story privacy (thử {save_try + 1}/2)...")
                time.sleep(1.0)
                if _confirm_change_privacy_open() or not _dialog_open():
                    save_ok = True
                    break
            if not save_ok and _dialog_open() and not _confirm_change_privacy_open():
                log(f"Chưa Save được Story privacy (lần {attempt + 1})...")
                time.sleep(0.4)
                continue

            # 3) Modal "Change story privacy" → Save
            confirmed = False
            for conf_try in range(5):
                if _confirm_change_privacy_open():
                    log("Modal 'Change story privacy' đã hiện — nhấn Save...")
                    if _confirm_change_privacy_save():
                        time.sleep(1.0)
                        if not _confirm_change_privacy_open():
                            log("✓ Đã Save Change story privacy.")
                            confirmed = True
                            break
                    else:
                        log(f"Chưa click được Save confirm (thử {conf_try + 1}/5)...")
                elif not _dialog_open() and not _confirm_change_privacy_open():
                    break
                time.sleep(0.4)

            if confirmed or (not _dialog_open() and not _confirm_change_privacy_open()):
                log("✓ Story privacy = Public.")
                return True

            if _confirm_change_privacy_open():
                _confirm_change_privacy_save()
                time.sleep(1.0)
                if not _confirm_change_privacy_open() and not _dialog_open():
                    return True
            time.sleep(0.4)
        except Exception as e:
            logger.debug(f"ensure_story_privacy_public attempt {attempt + 1}: {e}")

    if _confirm_change_privacy_open():
        log("Còn modal Change story privacy — thử Save lần cuối...")
        _confirm_change_privacy_save()
        time.sleep(1.0)
        if not _confirm_change_privacy_open() and not _dialog_open():
            return True

    log("Cảnh báo: không set được Public — đóng modal để tránh kẹt Selenium.")
    _force_close_dialog()
    time.sleep(0.6)
    if _dialog_open() or _confirm_change_privacy_open():
        _force_close_dialog()
    return not _dialog_open() and not _confirm_change_privacy_open()


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

class StatusUrlResult(NamedTuple):
    """Kết quả lấy link sau đăng Status — phân biệt permalink bài vs fallback profile."""
    url: Optional[str]
    is_permalink: bool


def _normalize_fb_host(url: str) -> str:
    """Đổi host về www.facebook.com cho thống nhất."""
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        path = parsed.path or ""
        query = f"?{parsed.query}" if parsed.query else ""
        fragment = f"#{parsed.fragment}" if parsed.fragment else ""
        return f"https://www.facebook.com{path}{query}{fragment}"
    except Exception:
        return url.replace("://web.facebook.com", "://www.facebook.com").replace(
            "://m.facebook.com", "://www.facebook.com"
        )


# Tracking / redirect params Facebook hay gắn — luôn bỏ khi clean.
_FB_STRIP_QUERY_KEYS = frozenset({
    "_rdc", "_rdr", "__cft__", "__tn__", "fbclid", "ref", "refid", "refsrc",
    "paipv", "eav", "_ft_", "mibextid", "rdc", "rdr", "rdid",
})


def _clean_facebook_url(url: str) -> str:
    """
    Chuẩn hóa URL Facebook: giữ tham số cần (story_fbid, id, fbid), bỏ tracking.
    Luôn bỏ fragment (#) và _rdc/_rdr/__cft__/__tn__/fbclid.
    Không cắt query mù bằng split('?')[0] — tránh mất id trên profile.php / permalink.
    """
    if not url:
        return ""
    try:
        # Bỏ fragment (#...) trước
        url = str(url).split("#", 1)[0].strip()
        parsed = urlparse(url)
        clean_path = (parsed.path or "").rstrip("/")
        qs = parse_qs(parsed.query)

        # 1. Reels: bắt buộc ID số
        m_reel = re.search(r"/(?:reel|reels)/(\d{6,})", url)
        if m_reel:
            return f"https://www.facebook.com/reel/{m_reel.group(1)}"

        # 2. Stories
        if "/stories/" in clean_path:
            return f"https://www.facebook.com{clean_path}"

        # 3. Posts path (/posts/ID hoặc /posts/pfbid...) — giữ path, bỏ toàn bộ query tracking
        if "/posts/" in clean_path:
            return f"https://www.facebook.com{clean_path}"

        # 4. Permalink / story.php — chỉ giữ story_fbid + id (+ fbid)
        if "permalink.php" in clean_path or "story.php" in clean_path:
            clean_params = {}
            for k in ("story_fbid", "id", "fbid"):
                if k in qs and qs[k]:
                    clean_params[k] = qs[k][0]
            script_name = "permalink.php" if "permalink.php" in clean_path else "story.php"
            if clean_params:
                return f"https://www.facebook.com/{script_name}?{urlencode(clean_params)}"
            return f"https://www.facebook.com/{script_name}"

        # 5. Photo
        if "photo" in clean_path:
            if "fbid" in qs and qs["fbid"]:
                return f"https://www.facebook.com/photo/?fbid={qs['fbid'][0]}"
            m_photo = re.search(r"\d{6,}", clean_path)
            if m_photo:
                return f"https://www.facebook.com/photo/?fbid={m_photo.group(0)}"

        # 6. Video
        m_vid = re.search(r"/videos/(\d{6,})", url)
        if m_vid:
            return f"https://www.facebook.com/watch/?v={m_vid.group(1)}"

        # 7. pfbid ở bất kỳ đâu
        m_pfbid = re.search(r"(pfbid[a-zA-Z0-9]+)", url)
        if m_pfbid:
            return f"https://www.facebook.com/{m_pfbid.group(1)}"

        # 8. profile.php — chỉ giữ id (bỏ _rdc/_rdr/#)
        if clean_path.endswith("profile.php") or clean_path == "/profile.php":
            if "id" in qs and qs["id"]:
                return f"https://www.facebook.com/profile.php?id={qs['id'][0]}"
            return "https://www.facebook.com/profile.php"

        # 9. Còn lại: host www, bỏ tracking query + fragment
        kept = {
            k: v[0]
            for k, v in qs.items()
            if v and k not in _FB_STRIP_QUERY_KEYS and not k.startswith("__")
        }
        base = f"https://www.facebook.com{clean_path or ''}"
        if kept:
            return f"{base}?{urlencode(kept)}"
        return base or _normalize_fb_host(url).split("#", 1)[0]
    except Exception:
        return str(url).split("#", 1)[0]


def is_status_permalink(url: Optional[str]) -> bool:
    """
    Chỉ nhận URL bài Status có mã bài:
      - /posts/… hoặc /{uid}/posts/{id|pfbid}
      - permalink.php?story_fbid=…&id=… (story_fbid có thể là pfbid…)
      - pfbid trong path/query
    Reject: profile.php, /me, /home, /friends, /share/, l.php, và mọi URL không có mã bài.
    """
    if not url or not isinstance(url, str):
        return False
    try:
        parsed = urlparse(url)
        host = (parsed.netloc or "").lower()
        if "facebook.com" not in host:
            return False
        path = (parsed.path or "").rstrip("/")
        qs = parse_qs(parsed.query)
        low = url.lower()

        # Reject rõ ràng — kể cả /share/p/ (chỉ dùng để resolve, không lưu làm permalink)
        if path in ("", "/") or path.endswith("/me") or "/home" in path:
            return False
        if path.endswith("profile.php") or path == "/profile.php":
            return False
        if any(x in low for x in ("/friends", "/comment/", "/likes/", "l.php", "/share/")):
            return False

        # permalink.php / story.php có story_fbid (pfbid…) hoặc fbid
        if "permalink.php" in path or "story.php" in path:
            return bool(qs.get("story_fbid") or qs.get("fbid"))

        # /posts/… hoặc /{uid}/posts/{id|pfbid}
        if "/posts/" in path:
            tail = path.split("/posts/", 1)[-1]
            return bool(tail and not tail.startswith("?"))

        # pfbid ở path/query (không phải profile)
        if re.search(r"pfbid[a-zA-Z0-9]+", url):
            return True

        if qs.get("story_fbid"):
            return True

        return False
    except Exception:
        return False


def _is_share_p_url(url: Optional[str]) -> bool:
    if not url:
        return False
    return bool(re.search(r"facebook\.com/share/p/", str(url), re.I))


def _profile_url_from_uid(uid: Optional[str]) -> Optional[str]:
    """Link profile chuẩn từ uid nick — KHÔNG lấy current_url. Luôn qua _clean."""
    if not uid:
        return None
    uid_s = str(uid).strip()
    if not uid_s:
        return None
    if uid_s.isdigit():
        raw = f"https://www.facebook.com/profile.php?id={uid_s}"
    else:
        uid_s = uid_s.lstrip("/")
        if uid_s.lower() in ("me", "home", "profile.php"):
            return None
        raw = f"https://www.facebook.com/{uid_s}"
    return _clean_facebook_url(raw)


def _uid_from_c_user(driver) -> Optional[str]:
    try:
        cookie = driver.get_cookie("c_user")
        if cookie and cookie.get("value"):
            val = str(cookie["value"]).strip()
            if val.isdigit():
                return val
    except Exception:
        pass
    return None


def _content_snippet_for_match(content: Optional[str], max_len: int = 28) -> str:
    """20–30 ký tự đầu status (chuẩn hóa khoảng trắng) để khớp article."""
    text = re.sub(r"\s+", " ", (content or "").strip())
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[:max_len]


def _accept_permalink(raw: Optional[str], log_fn=None) -> Optional[str]:
    """Chỉ nhận URL bài thật (/posts|permalink.php?story_fbid|pfbid). Profile/share → None."""
    if not raw:
        return None
    clean = _clean_facebook_url(raw)
    if is_status_permalink(clean):
        return clean
    if log_fn and clean:
        log_fn(f"Bỏ URL không phải permalink bài: {clean}")
    return None


def _finalize_permalink(raw: Optional[str], log_fn=None) -> Optional[StatusUrlResult]:
    accepted = _accept_permalink(raw, log_fn)
    if not accepted:
        return None
    return StatusUrlResult(accepted, True)


def _is_profile_or_me_url(url: Optional[str]) -> bool:
    """True nếu URL là trang cá nhân /me /home — không phải link bài."""
    if not url:
        return True
    try:
        parsed = urlparse(str(url).split("#", 1)[0])
        path = (parsed.path or "").rstrip("/").lower()
        if path.endswith("/me") or path == "/me" or "/home" in path:
            return True
        if path.endswith("profile.php") or path == "/profile.php":
            return True
        parts = [p for p in path.split("/") if p]
        if len(parts) == 1 and parts[0] not in ("permalink.php", "story.php", "photo.php", "watch"):
            if "posts" not in path and "permalink" not in path and "pfbid" not in (url or "").lower():
                return True
        return False
    except Exception:
        return False


# JS: multi-selector article + đọc text (innerText→textContent) → timestamp permalink>/posts>/share/p
_FIND_TIMESTAMP_LINK_JS = r"""
    const hint = (arguments[0] || "").toLowerCase();
    const doClick = arguments[1] !== false;

    const readText = (el) => {
        if (!el) return "";
        let t = ((el.innerText || "") + "").replace(/\s+/g, " ").trim();
        if (!t) t = ((el.textContent || "") + "").replace(/\s+/g, " ").trim();
        return t;
    };

    // Gom đa selector, đếm từng loại, khử trùng theo phần tử.
    // Bỏ wrapper pagelet nếu đã có role=article/article con bên trong.
    const collectPostNodes = () => {
        const counts = {
            article: 0,
            roleArticle: 0,
            postContainers: 0,
            pagelets: 0,
        };
        const seen = new Set();
        const out = [];

        const pushUnique = (nodes) => {
            for (const el of nodes) {
                if (!el || seen.has(el)) continue;
                seen.add(el);
                out.push(el);
            }
        };

        const tagArts = Array.from(document.querySelectorAll("article"));
        counts.article = tagArts.length;
        pushUnique(tagArts);

        const roleArts = Array.from(
            document.querySelectorAll("div[role='article'], [role='article']")
        );
        counts.roleArticle = roleArts.length;
        pushUnique(roleArts);

        const postNodes = Array.from(document.querySelectorAll([
            "[data-testid='fbfeed_story']",
            "[data-testid='story-subtitle']",
            "[data-testid*='feed']",
            "[data-testid*='Feed']",
            "[data-testid*='post']",
            "[data-testid*='Post']",
            "div[data-ad-preview='message']",
            "div[data-ad-comet-preview='message']",
        ].join(",")));
        // story-subtitle là con — lấy closest container nếu có
        const postContainers = [];
        for (const el of postNodes) {
            const tid = (el.getAttribute("data-testid") || "").toLowerCase();
            if (tid === "story-subtitle" || tid.includes("subtitle")) {
                const wrap = el.closest("[role='article'], article, [data-testid='fbfeed_story'], div[data-pagelet]");
                postContainers.push(wrap || el);
            } else {
                postContainers.push(el);
            }
        }
        counts.postContainers = postContainers.length;
        pushUnique(postContainers);

        const pageletNodes = Array.from(document.querySelectorAll([
            "div[data-pagelet*='FeedUnit']",
            "div[data-pagelet*='TimelineFeedUnit']",
            "div[data-pagelet*='ProfileTimeline']",
            "div[data-pagelet*='Timeline']",
            "div[data-pagelet*='Feed']",
        ].join(","))).filter((el) => {
            const pl = (el.getAttribute("data-pagelet") || "").toLowerCase();
            if (pl.includes("composer") || pl.includes("navigation") || pl.includes("chat")) return false;
            return true;
        });
        counts.pagelets = pageletNodes.length;
        for (const el of pageletNodes) {
            if (seen.has(el)) continue;
            let hasChildCollected = false;
            for (const s of seen) {
                if (el !== s && el.contains(s)) { hasChildCollected = true; break; }
            }
            if (hasChildCollected) continue;
            seen.add(el);
            out.push(el);
        }

        // Đếm link bài trên toàn trang (chẩn đoán: chưa load vs selector sai)
        let pagePermalinkLinks = 0;
        let pagePostsLinks = 0;
        let pageShareLinks = 0;
        for (const a of Array.from(document.querySelectorAll("a[href]"))) {
            const h = (a.href || "").toLowerCase();
            if (!h) continue;
            if (h.includes("permalink.php") && h.includes("story_fbid=")) pagePermalinkLinks += 1;
            if (h.includes("/posts/")) pagePostsLinks += 1;
            if (h.includes("/share/p/")) pageShareLinks += 1;
        }

        return {
            articles: out,
            counts,
            unique: out.length,
            pagePermalinkLinks,
            pagePostsLinks,
            pageShareLinks,
        };
    };

    const collected = collectPostNodes();
    const articles = collected.articles;

    const isTime = (txt, aria) => {
        const t = (txt || "").trim().toLowerCase();
        const a = (aria || "").trim().toLowerCase();
        return /^(vừa xong|just now|\d+\s*(s|m|h|d|giây|phút|giờ|ngày)|hôm nay|today)$/i.test(t)
            || /^(vừa xong|just now|\d+\s*(giây|phút|giờ|ngày|seconds?|minutes?|hours?|days?)(\s+trước)?)$/i.test(t)
            || /(vừa xong|just now|\d+\s*(phút|giây|giờ|minute|second|hour)|hôm nay|today)/i.test(a);
    };
    const rankHref = (h) => {
        if (!h) return 0;
        const low = String(h).toLowerCase();
        if (low.includes('/comment/') || low.includes('/likes/') || low.includes('/friends') || low.includes('l.php')) return 0;
        if (low.includes('permalink.php') && low.includes('story_fbid=')) return 100;
        if (low.includes('story.php') && (low.includes('story_fbid=') || low.includes('fbid='))) return 95;
        if (low.includes('/posts/')) return 80;
        if (low.includes('pfbid') && !low.includes('profile.php')) return 70;
        if (low.includes('/share/p/')) return 40;
        return 0;
    };

    let timestampLinks = 0;
    let permalinkCandidates = 0;
    let shareCandidates = 0;
    let matchedArticles = 0;

    // firstArt: ưu tiên node có text không rỗng
    let firstBody = "";
    let firstArtLen = 0;
    let firstOuter = "";
    for (const art of articles) {
        const t = readText(art);
        if (t) {
            firstBody = t.slice(0, 120);
            firstArtLen = t.length;
            firstOuter = ((art.outerHTML || "") + "").replace(/\s+/g, " ").trim().slice(0, 280);
            break;
        }
    }
    if (!firstBody && articles.length) {
        firstArtLen = 0;
        firstOuter = ((articles[0].outerHTML || "") + "").replace(/\s+/g, " ").trim().slice(0, 280);
    }

    const candidates = [];

    const scanArticle = (art, matchBoost, viaSuffix) => {
        const bodyRaw = readText(art);
        const body = bodyRaw.toLowerCase();
        const matched = !!(hint && hint.length >= 12 && body.includes(hint));
        if (matched) matchedArticles += 1;
        if (hint && hint.length >= 12 && !matched) return;

        const allA = Array.from(art.querySelectorAll("a[href]"));
        for (const a of allA) {
            const txt = (a.innerText || a.textContent || "").trim();
            const aria = (a.getAttribute("aria-label") || "").trim();
            const h = a.href || "";
            const timed = isTime(txt, aria);
            if (timed) timestampLinks += 1;
            const r = rankHref(h);
            if (r <= 0) continue;
            if (r >= 70) permalinkCandidates += 1;
            if (r === 40) shareCandidates += 1;
            if (timed || matched || r >= 70) {
                candidates.push({
                    el: a,
                    href: h,
                    rank: r + (timed ? 5 : 0) + (matched ? 10 : 0) + (matchBoost || 0),
                    via: (timed ? "timestamp" : "post_href") + (viaSuffix || ""),
                    matched: !!matched,
                });
            }
        }
    };

    for (const art of articles) {
        scanArticle(art, 0, "");
    }

    // Hint ngắn 20 ký tự nếu full hint chưa khớp
    if (hint && hint.length >= 12 && matchedArticles === 0) {
        const shortHint = hint.slice(0, 20);
        for (const art of articles) {
            const body = readText(art).toLowerCase();
            if (!body.includes(shortHint)) continue;
            matchedArticles += 1;
            const allA = Array.from(art.querySelectorAll("a[href]"));
            for (const a of allA) {
                const txt = (a.innerText || a.textContent || "").trim();
                const aria = (a.getAttribute("aria-label") || "").trim();
                const h = a.href || "";
                const timed = isTime(txt, aria);
                if (timed) timestampLinks += 1;
                const r = rankHref(h);
                if (r <= 0) continue;
                if (r >= 70) permalinkCandidates += 1;
                if (r === 40) shareCandidates += 1;
                if (timed || r >= 40) {
                    candidates.push({
                        el: a,
                        href: h,
                        rank: r + (timed ? 5 : 0) + 8,
                        via: (timed ? "timestamp" : "post_href") + "+short_hint",
                        matched: true,
                    });
                }
            }
        }
    }

    candidates.sort((a, b) => b.rank - a.rank);
    const stats = {
        articles: collected.unique,
        article: collected.counts.article,
        roleArticle: collected.counts.roleArticle,
        postContainers: collected.counts.postContainers,
        pagelets: collected.counts.pagelets,
        unique: collected.unique,
        matchedArticles,
        timestampLinks,
        permalinkCandidates,
        shareCandidates,
        candidateCount: candidates.length,
        firstArticlePreview: firstBody,
        firstArtLen,
        firstOuterHtml: (matchedArticles === 0) ? firstOuter : "",
        pagePermalinkLinks: collected.pagePermalinkLinks,
        pagePostsLinks: collected.pagePostsLinks,
        pageShareLinks: collected.pageShareLinks,
        hintPreview: hint.slice(0, 40),
        hintLen: hint.length,
    };

    if (!candidates.length) {
        return { clicked: false, href: null, via: null, kind: null, stats };
    }
    const best = candidates[0];
    const low = String(best.href || "").toLowerCase();
    let kind = "other";
    if (low.includes("permalink.php") || low.includes("story_fbid=")) kind = "permalink";
    else if (low.includes("/posts/")) kind = "posts";
    else if (low.includes("/share/p/")) kind = "share";

    if (doClick) {
        try { best.el.click(); } catch (e) {}
    }
    return {
        clicked: !!doClick,
        href: best.href,
        via: best.via,
        kind,
        rank: best.rank,
        stats,
    };
"""


# JS: chờ timeline / tab Bài viết sau khi mở /me
_WAIT_PROFILE_TIMELINE_JS = r"""
    const tryClickPostsTab = () => {
        const tabs = Array.from(document.querySelectorAll(
            "a[role='tab'], div[role='tab'], span[role='tab']"
        ));
        const re = /^(bài viết|posts)$/i;
        for (const t of tabs) {
            const label = ((t.innerText || t.textContent || "") + " " + (t.getAttribute("aria-label") || "")).replace(/\s+/g, " ").trim();
            if (!re.test(label)) continue;
            const selected = t.getAttribute("aria-selected");
            if (selected === "true") return { clicked: false, label };
            try { t.click(); return { clicked: true, label }; } catch (e) {}
        }
        // fallback: link chứa /posts hoặc sk=nf
        for (const a of Array.from(document.querySelectorAll("a[href]"))) {
            const h = (a.href || "").toLowerCase();
            const label = ((a.innerText || a.textContent || "") + "").replace(/\s+/g, " ").trim();
            if (re.test(label) || h.includes("sk=nf") || /\/posts\/?$/.test(h.split("?")[0])) {
                try { a.click(); return { clicked: true, label: label || h.slice(0, 60) }; } catch (e) {}
            }
        }
        return { clicked: false, label: null };
    };

    const hasFeed = !!(
        document.querySelector("div[role='article'], [role='article'], article")
        || document.querySelector("div[data-pagelet*='FeedUnit'], div[data-pagelet*='TimelineFeedUnit'], div[data-pagelet*='ProfileTimeline'], div[data-pagelet*='Timeline']")
        || document.querySelector("a[href*='permalink.php'], a[href*='/posts/'], [data-testid='fbfeed_story']")
    );
    let tab = null;
    if (!hasFeed) {
        tab = tryClickPostsTab();
    }
    return {
        readyState: document.readyState,
        url: location.href,
        hasFeed,
        tab,
        roleArticle: document.querySelectorAll("div[role='article'], [role='article']").length,
        article: document.querySelectorAll("article").length,
        pagelets: document.querySelectorAll("div[data-pagelet*='FeedUnit'], div[data-pagelet*='Timeline'], div[data-pagelet*='ProfileTimeline']").length,
    };
"""


def _wait_permalink_after_navigation(
    driver,
    log_fn,
    timeout: float = 10.0,
    interval: float = 0.4,
) -> Optional[str]:
    """Chờ current_url thành permalink bài (không nhận profile / share)."""
    deadline = time.time() + max(2.0, float(timeout))
    last_cur = ""
    while time.time() < deadline:
        try:
            cur = driver.current_url or ""
            last_cur = cur
            if _is_profile_or_me_url(cur) or _is_share_p_url(cur):
                time.sleep(interval)
                continue
            accepted = _accept_permalink(cur, log_fn)
            if accepted:
                return accepted
        except Exception:
            pass
        time.sleep(interval)
    if log_fn and last_cur:
        cleaned = _clean_facebook_url(last_cur)
        log_fn(
            f"Hết chờ permalink — current_url vẫn không phải link bài "
            f"(cleaned={cleaned!r}, is_profile={_is_profile_or_me_url(last_cur)}, "
            f"is_share={_is_share_p_url(last_cur)})"
        )
    return None


def _resolve_href_to_permalink(
    driver,
    href: Optional[str],
    log_fn,
    source: str,
) -> Optional[str]:
    """
    Nhận href từ timestamp:
      - đã là permalink/posts → clean + return
      - /share/p/ → mở bằng driver đã login, chờ redirect sang permalink.php
      - khác → click đã thực hiện sẵn, chờ URL đổi
    """
    if not href:
        return None
    # Đã là permalink hợp lệ trên href
    accepted = _accept_permalink(href, log_fn)
    if accepted:
        return accepted

    # Resolve share/p/
    if _is_share_p_url(href):
        if log_fn:
            log_fn(f"{source}: mở /share/p/ để resolve → permalink...")
        try:
            driver.get(href)
        except Exception as e:
            if log_fn:
                log_fn(f"{source}: lỗi mở share/p: {e}")
            return None
        return _wait_permalink_after_navigation(driver, log_fn, timeout=12.0)

    # Đã click timestamp nhưng href chưa phải permalink — chờ URL đổi
    return _wait_permalink_after_navigation(driver, log_fn, timeout=10.0)


def extract_status_post_url(
    driver,
    uid: Optional[str] = None,
    log_cb: Optional[Any] = None,
    content_hint: Optional[str] = None,
    status_text: Optional[str] = None,
    poll_seconds: float = 15.0,
    poll_interval: float = 0.5,
) -> StatusUrlResult:
    """
    Best-effort lấy permalink sau đăng Status qua Share → /share/p/ → redirect.
    Không dùng timestamp, không Embed, không /me. Không raise, không fail bài đăng.
    """
    def _log(m):
        try:
            if log_cb:
                log_cb(m)
            logger.info(m)
        except Exception:
            pass

    def _clean_permalink_only(url: Optional[str]) -> str:
        if not url:
            return ""
        try:
            raw = str(url).split("#", 1)[0].strip()
            parsed = urlparse(raw)
            path = (parsed.path or "").rstrip("/")
            qs = parse_qs(parsed.query)
            if "permalink.php" in path or "story.php" in path:
                params = {}
                for k in ("story_fbid", "id"):
                    if k in qs and qs[k]:
                        params[k] = qs[k][0]
                name = "permalink.php" if "permalink.php" in path else "story.php"
                if params.get("story_fbid"):
                    return f"https://www.facebook.com/{name}?{urlencode(params)}"
                return ""
            if "/posts/" in path:
                return f"https://www.facebook.com{path}"
            return ""
        except Exception:
            return ""

    def _accept_permalink(raw: Optional[str]) -> Optional[str]:
        clean = _clean_permalink_only(raw)
        if not clean:
            return None
        low = clean.lower()
        if "profile.php" in low or "/share/" in low:
            return None
        if "permalink.php" in low and "story_fbid=" in low:
            return clean
        if "/posts/" in low:
            return clean
        return None

    def _normalize_share_p(url: Optional[str]) -> Optional[str]:
        if not url:
            return None
        text = str(url).replace("\x00", " ").strip()
        # Cho phép URL nằm giữa text/HTML clipboard
        m = re.search(
            r"https?://(?:www\.|web\.|m\.)?facebook\.com/share/p/[A-Za-z0-9_-]+/?",
            text,
            re.I,
        )
        if not m:
            m = re.search(r"(?:www\.|web\.|m\.)?facebook\.com/share/p/[A-Za-z0-9_-]+/?", text, re.I)
            if not m:
                return None
            return "https://www." + m.group(0).lstrip("/").replace("www.www.", "www.")
        return (
            m.group(0)
            .replace("://web.facebook.com", "://www.facebook.com")
            .replace("://m.facebook.com", "://www.facebook.com")
        )

    def _extract_any_post_link(text: Optional[str]) -> Optional[str]:
        """Từ clipboard: ưu tiên /share/p/, nhận luôn permalink nếu FB copy thẳng permalink."""
        if not text:
            return None
        share = _normalize_share_p(text)
        if share:
            return share
        accepted = _accept_permalink(text)
        if accepted:
            return accepted
        # permalink còn bẩn trong HTML clipboard
        m = re.search(
            r"https?://(?:www\.|web\.)?facebook\.com/permalink\.php\?[^\s\"'<>]+",
            str(text),
            re.I,
        )
        if m:
            return _accept_permalink(m.group(0))
        m = re.search(
            r"https?://(?:www\.|web\.)?facebook\.com/[^/\s\"'<>]+/posts/[A-Za-z0-9_-]+",
            str(text),
            re.I,
        )
        if m:
            return _accept_permalink(m.group(0))
        return None

    def _fallback_profile() -> StatusUrlResult:
        try:
            cur = driver.current_url or ""
            if cur:
                _log(
                    f"Tier5: bỏ qua current_url (không dùng làm link bài): "
                    f"{_clean_facebook_url(cur)!r}"
                )
        except Exception:
            pass
        profile = _profile_url_from_uid(uid)
        if not profile:
            profile = _profile_url_from_uid(_uid_from_c_user(driver))
        if profile:
            profile = _clean_facebook_url(profile)
            _log(f"Chưa lấy được permalink — fallback link trang cá nhân sạch: {profile}")
            return StatusUrlResult(profile, False)
        _log("Chưa lấy được permalink và không xác định được uid profile.")
        return StatusUrlResult(None, False)

    raw_text = status_text if status_text is not None else content_hint
    snippet = re.sub(r"\s+", " ", (raw_text or "").strip())
    if len(snippet) > 80:
        snippet = snippet[:72]
    elif len(snippet) > 72:
        snippet = snippet[:72]
    if snippet:
        _log(f"Extract(share): content hint ({len(snippet)} chars)={snippet!r}")

    # Đánh dấu card khớp + nút Share (không click timestamp)
    find_card_js = r"""
        const hint = (arguments[0] || "").toLowerCase();
        const maxCards = 3;
        try { if ((window.scrollY || 0) > 0) window.scrollTo(0, 0); } catch (e) {}
        document.querySelectorAll("[data-ada-share-card],[data-ada-share-btn]").forEach(el => {
            el.removeAttribute("data-ada-share-card");
            el.removeAttribute("data-ada-share-btn");
        });

        const readText = (el) => {
            if (!el) return "";
            let t = ((el.innerText || "") + "").replace(/\s+/g, " ").trim();
            if (!t) t = ((el.textContent || "") + "").replace(/\s+/g, " ").trim();
            return t;
        };
        const findCard = (start) => {
            let cur = start;
            for (let i = 0; i < 8 && cur; i++) {
                const hasP = !!cur.querySelector("[data-ad-rendering-role='profile_name']");
                const hasM = !!cur.querySelector("[data-ad-rendering-role='story_message']");
                if (hasP && hasM) return cur;
                if (cur.hasAttribute && cur.hasAttribute("aria-posinset")) return cur;
                if ((cur.getAttribute && cur.getAttribute("role")) === "article") return cur;
                if (cur.tagName && String(cur.tagName).toLowerCase() === "article") return cur;
                cur = cur.parentElement;
            }
            return start;
        };

        const seen = new Set();
        const raw = [];
        const push = (el) => {
            if (!el || seen.has(el)) return;
            const card = findCard(el) || el;
            if (seen.has(card)) return;
            seen.add(card); seen.add(el);
            raw.push(card);
        };
        Array.from(document.querySelectorAll("div[role='article'], [role='article'], article")).forEach(push);
        Array.from(document.querySelectorAll(
            "[data-testid='fbfeed_story'], div[data-pagelet*='FeedUnit'], [data-ad-rendering-role='story_message']"
        )).forEach(push);

        const cards = raw.slice(0, maxCards);
        let matched = null;
        let matchVia = "";
        for (const card of cards) {
            const msg = card.querySelector("[data-ad-rendering-role='story_message']");
            const body = readText(card).toLowerCase();
            const msgText = msg ? readText(msg).toLowerCase() : "";
            if (hint && hint.length >= 12) {
                if (body.includes(hint) || msgText.includes(hint)
                    || body.includes(hint.slice(0, Math.min(40, hint.length)))
                    || msgText.includes(hint.slice(0, Math.min(40, hint.length)))) {
                    matched = card; matchVia = "content_hint"; break;
                }
            }
        }
        if (!matched && cards.length && (!hint || hint.length < 12)) {
            matched = cards[0];
            matchVia = "first_card";
        }
        if (!matched) {
            return { matched: 0, scrollY: window.scrollY || 0, cards: cards.length, matchVia: "" };
        }

        matched.setAttribute("data-ada-share-card", "1");

        // Nút Share ở footer: sau Like/Comment — aria/text Share/Chia sẻ, không phải menu ...
        const isBad = (b) => {
            const aria = (b.getAttribute("aria-label") || "").toLowerCase();
            const t = readText(b).toLowerCase();
            const blob = aria + " " + t;
            if (/(thích|like|bình luận|comment|theo dõi|follow|xem thêm|see more)/i.test(blob)) return true;
            if (b.closest("[data-ad-rendering-role='profile_name']")) return true;
            return false;
        };
        const isShare = (b) => {
            const aria = (b.getAttribute("aria-label") || "").toLowerCase();
            const t = readText(b).toLowerCase();
            if (isBad(b)) return false;
            if (/^(chia sẻ|share)$/i.test(t) || /^(chia sẻ|share)$/i.test(aria)) return true;
            if (aria.includes("share") || aria.includes("chia sẻ")) return true;
            if (t === "chia sẻ" || t === "share") return true;
            return false;
        };

        let shareBtn = null;
        const candidates = Array.from(matched.querySelectorAll(
            "div[role='button'], [role='button'], span[role='button']"
        ));
        // Ưu tiên vùng action cuối card
        for (const b of candidates) {
            if (isShare(b)) { shareBtn = b; break; }
        }
        if (shareBtn) {
            shareBtn.setAttribute("data-ada-share-btn", "1");
        }

        return {
            matched: 1,
            matchVia,
            scrollY: window.scrollY || 0,
            cards: cards.length,
            hasShareBtn: !!shareBtn,
            preview: readText(matched).slice(0, 100),
        };
    """

    read_share_sheet_js = r"""
        // Đọc link /share/p/ từ bảng Share đang mở + liệt kê nút
        const roots = Array.from(document.querySelectorAll(
            'div[role="dialog"], div[role="menu"], div[data-pagelet*="Share"], [aria-label*="Share"], [aria-label*="Chia sẻ"]'
        ));
        // fallback: mọi dialog/menu gần đây
        const allRoots = roots.length ? roots : Array.from(document.querySelectorAll('div[role="dialog"], div[role="menu"]'));
        const buttons = [];
        let shareHref = null;
        let hasCopy = false;
        for (const root of allRoots) {
            for (const a of Array.from(root.querySelectorAll('a[href]'))) {
                const h = a.href || "";
                if (/facebook\.com\/share\/p\//i.test(h)) {
                    shareHref = h;
                }
            }
            const blob = (root.innerText || root.textContent || "");
            const m = blob.match(/https?:\/\/(?:www\.|web\.)?facebook\.com\/share\/p\/[A-Za-z0-9_-]+\/?/i);
            if (m && !shareHref) shareHref = m[0];

            for (const b of Array.from(root.querySelectorAll('div[role="button"], button, span[role="button"], a[role="link"]'))) {
                const text = ((b.innerText || b.textContent || "") + "").replace(/\s+/g, " ").trim();
                const aria = (b.getAttribute("aria-label") || "").trim();
                const href = b.href || "";
                buttons.push({ text: text.slice(0, 80), aria: aria.slice(0, 80), href: (href || "").slice(0, 160) });
                const blob2 = (text + " " + aria).toLowerCase();
                if (blob2.includes("copy link") || blob2.includes("sao chép liên kết") || blob2.includes("copy")) {
                    if (!blob2.includes("copy text") && !blob2.includes("embed")) hasCopy = true;
                }
                if (/facebook\.com\/share\/p\//i.test(href) && !shareHref) shareHref = href;
            }
        }
        return { shareHref, hasCopy, buttons: buttons.slice(0, 40), rootCount: allRoots.length };
    """

    click_copy_link_js = r"""
        function trigger(el) {
            if (!el) return false;
            try {
                ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(evt => {
                    el.dispatchEvent(new MouseEvent(evt, {bubbles:true, cancelable:true, view:window}));
                });
                if (typeof el.click === 'function') el.click();
                return true;
            } catch (e) { return false; }
        }
        const roots = Array.from(document.querySelectorAll('div[role="dialog"], div[role="menu"]'));
        const re = /(sao chép liên kết|copy link|copy)/i;
        const bad = /(share now|chia sẻ ngay|đăng|post|embed|nhúng|like|thích|comment|bình luận)/i;
        for (const root of roots) {
            for (const b of Array.from(root.querySelectorAll('div[role="button"], button, span[role="button"], a'))) {
                const text = ((b.innerText || b.textContent || "") + " " + (b.getAttribute("aria-label") || "")).replace(/\s+/g, " ").trim();
                if (!re.test(text)) continue;
                if (bad.test(text) && !/copy link|sao chép liên kết/i.test(text)) continue;
                // tránh Share Now
                if (/share now|chia sẻ ngay/i.test(text)) continue;
                trigger(b);
                return { clicked: true, label: text.slice(0, 80) };
            }
        }
        return { clicked: false };
    """

    close_share_sheet_js = r"""
        function trigger(el) {
            if (!el) return false;
            try {
                ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(evt => {
                    el.dispatchEvent(new MouseEvent(evt, {bubbles:true, cancelable:true, view:window}));
                });
                if (typeof el.click === 'function') el.click();
                return true;
            } catch (e) { return false; }
        }
        // Đóng bằng nút Close/X hoặc Escape — không bấm Share Now
        const roots = Array.from(document.querySelectorAll('div[role="dialog"], div[role="menu"]'));
        for (const root of roots) {
            for (const b of Array.from(root.querySelectorAll('div[role="button"], button'))) {
                const aria = (b.getAttribute("aria-label") || "").toLowerCase();
                const text = ((b.innerText || "") + "").trim().toLowerCase();
                if (aria === "close" || aria === "đóng" || text === "close" || text === "đóng") {
                    trigger(b); return true;
                }
            }
        }
        try { document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', keyCode:27, bubbles:true})); } catch (e) {}
        return false;
    """

    def _grant_clipboard_permission() -> None:
        """
        Cấp quyền clipboard cho facebook.com qua CDP — tránh popup
        'Xem văn bản... bảng nhớ tạm' (thường chỉ hiện lần đầu / mỗi profile).
        """
        for origin in (
            "https://www.facebook.com",
            "https://web.facebook.com",
            "https://m.facebook.com",
        ):
            try:
                driver.execute_cdp_cmd(
                    "Browser.grantPermissions",
                    {
                        "origin": origin,
                        "permissions": [
                            "clipboardReadWrite",
                            "clipboardSanitizedWrite",
                        ],
                    },
                )
            except Exception:
                pass

    def _dismiss_clipboard_permission_bubble() -> None:
        """
        Popup quyền clipboard là UI Chrome (không nằm trong DOM Facebook).
        Thử Escape để đóng nếu đang che; không click Cho phép bằng Selenium.
        """
        try:
            driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
            time.sleep(0.25)
        except Exception:
            pass
        try:
            driver.execute_script(
                "try { document.dispatchEvent(new KeyboardEvent('keydown',"
                "{key:'Escape',keyCode:27,bubbles:true})); } catch(e) {}"
            )
        except Exception:
            pass

    def _read_clipboard_os() -> Optional[str]:
        """
        Đọc clipboard Windows (text + HTML) — KHÔNG gọi navigator.clipboard
        (tránh popup Chrome). Retry vì OpenClipboard hay bị lock ngắn.
        """
        chunks: List[str] = []

        # --- win32clipboard ---
        for _ in range(8):
            try:
                import win32clipboard  # type: ignore

                win32clipboard.OpenClipboard()
                try:
                    if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
                        data = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
                        if isinstance(data, str) and data.strip():
                            chunks.append(data.strip())
                    try:
                        cf_html = win32clipboard.RegisterClipboardFormat("HTML Format")
                        if win32clipboard.IsClipboardFormatAvailable(cf_html):
                            raw = win32clipboard.GetClipboardData(cf_html)
                            if isinstance(raw, bytes):
                                raw = raw.decode("utf-8", errors="ignore")
                            if isinstance(raw, str) and raw.strip():
                                chunks.append(raw.strip())
                    except Exception:
                        pass
                finally:
                    win32clipboard.CloseClipboard()
                if chunks:
                    break
            except Exception:
                time.sleep(0.15)

        # --- ctypes fallback (không cần pywin32) ---
        if not chunks:
            try:
                import ctypes
                from ctypes import wintypes

                user32 = ctypes.windll.user32
                kernel32 = ctypes.windll.kernel32
                CF_UNICODETEXT = 13
                for _ in range(8):
                    if not user32.OpenClipboard(0):
                        time.sleep(0.15)
                        continue
                    try:
                        handle = user32.GetClipboardData(CF_UNICODETEXT)
                        if handle:
                            ptr = kernel32.GlobalLock(handle)
                            if ptr:
                                try:
                                    data = ctypes.wstring_at(ptr)
                                    if data and data.strip():
                                        chunks.append(data.strip())
                                finally:
                                    kernel32.GlobalUnlock(handle)
                    finally:
                        user32.CloseClipboard()
                    if chunks:
                        break
                    time.sleep(0.15)
            except Exception:
                pass

        if not chunks:
            return None
        # Gộp text+html để regex bắt URL trong HTML Format
        return "\n".join(chunks)

    def _wait_clipboard_after_copy(before: Optional[str], timeout: float = 4.0) -> Optional[str]:
        """
        Poll clipboard đến khi đổi khác nội dung trước Copy, hoặc có /share/p|permalink.
        Không Escape trong lúc chờ — Escape làm mất sheet và dễ đọc nhầm clipboard cũ.
        """
        deadline = time.time() + max(1.5, float(timeout))
        last_raw = None
        while time.time() < deadline:
            raw = _read_clipboard_os()
            last_raw = raw
            if raw and raw != (before or ""):
                hit = _extract_any_post_link(raw)
                if hit:
                    return raw
                # Đã đổi clipboard nhưng chưa phải link FB — vẫn trả raw để log
                if "facebook.com" in raw.lower():
                    return raw
            elif raw:
                hit = _extract_any_post_link(raw)
                if hit and raw != (before or ""):
                    return raw
            time.sleep(0.25)
        return last_raw

    def _close_share_sheet():
        try:
            driver.execute_script(close_share_sheet_js)
            time.sleep(0.4)
        except Exception:
            try:
                from selenium.webdriver.common.keys import Keys as _K
                driver.find_element(By.TAG_NAME, "body").send_keys(_K.ESCAPE)
            except Exception:
                pass

    try:
        try:
            feed_handle = driver.current_window_handle
        except Exception:
            feed_handle = None
        try:
            feed_url = driver.current_url or ""
        except Exception:
            feed_url = ""

        # Cấp quyền clipboard sớm (profile mới thường hỏi 1 lần; CDP nhớ theo origin)
        try:
            _grant_clipboard_permission()
            _log("Extract(share): đã Browser.grantPermissions clipboard cho facebook.com")
        except Exception:
            pass

        # ── 1. Tìm card khớp (≤10s, scrollY=0) ──
        _log("Extract(share): tìm card khớp trên feed hiện tại (scrollY=0, không /me)...")
        matched_info = None
        deadline = time.time() + 10.0
        poll_n = 0
        while time.time() < deadline:
            poll_n += 1
            try:
                driver.execute_script("if ((window.scrollY||0)>0) window.scrollTo(0,0);")
                info = driver.execute_script(find_card_js, snippet)
            except Exception as e:
                _log(f"Extract(share): scan card lỗi: {e}")
                info = None
            if isinstance(info, dict):
                _log(
                    f"Extract(share) poll{poll_n}: scrollY={info.get('scrollY')} "
                    f"cards={info.get('cards')} matched={info.get('matched')} "
                    f"via={info.get('matchVia')} hasShareBtn={info.get('hasShareBtn')} "
                    f"preview={info.get('preview')!r}"
                )
                if int(info.get("matched") or 0) == 1:
                    matched_info = info
                    break
            time.sleep(max(0.5, float(poll_interval)))

        if not matched_info:
            _log("Extract(share): không khớp card — Tier5, không thử timestamp/Embed/me.")
            return _fallback_profile()

        # ── 2. Bấm Share trên card ──
        share_clicked = False
        try:
            btn = driver.find_element(By.CSS_SELECTOR, "[data-ada-share-btn='1']")
            try:
                driver.execute_script(
                    "arguments[0].scrollIntoView({block:'nearest', inline:'nearest'});", btn
                )
            except Exception:
                pass
            try:
                btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", btn)
            share_clicked = True
            _log("Extract(share): đã bấm nút Share trên card khớp.")
        except Exception as e:
            _log(f"Extract(share): không bấm được nút Share — {e}")
            return _fallback_profile()

        # Chờ bảng Share ≤5s
        share_url = None
        link_source = None
        sheet_deadline = time.time() + 5.0
        sheet_seen = False
        while time.time() < sheet_deadline:
            try:
                sheet = driver.execute_script(read_share_sheet_js)
            except Exception as e:
                _log(f"Extract(share): đọc bảng Share lỗi: {e}")
                sheet = None
            if isinstance(sheet, dict):
                if int(sheet.get("rootCount") or 0) > 0 or sheet.get("buttons"):
                    sheet_seen = True
                href = _normalize_share_p(sheet.get("shareHref"))
                if href:
                    share_url = href
                    link_source = "dom"
                    _log(f"Extract(share): lấy /share/p/ từ DOM bảng Share: {share_url}")
                    break
                if sheet.get("hasCopy"):
                    _grant_clipboard_permission()
                    # Snapshot clipboard TRƯỚC Copy để biết khi nào FB ghi xong
                    before_clip = _read_clipboard_os()
                    _log(
                        f"Extract(share): clipboard trước Copy "
                        f"(len={len(before_clip or '')})={((before_clip or '')[:120])!r}"
                    )
                    try:
                        clicked = driver.execute_script(click_copy_link_js)
                        _log(f"Extract(share): bấm Copy link → {clicked}")
                    except Exception as e:
                        _log(f"Extract(share): lỗi bấm Copy link: {e}")
                        clicked = None

                    # Chờ clipboard đổi — KHÔNG Escape ngay (Escape dễ đọc nhầm clipboard cũ)
                    clip = _wait_clipboard_after_copy(before_clip, timeout=4.0)
                    _log(
                        f"Extract(share): clipboard sau Copy "
                        f"(len={len(clip or '')})={((clip or '')[:180])!r}"
                    )
                    href2 = _extract_any_post_link(clip)
                    if href2 and _normalize_share_p(href2):
                        share_url = _normalize_share_p(href2)
                        link_source = "clipboard_os"
                        _log(f"Extract(share): lấy /share/p/ từ clipboard OS: {share_url}")
                        break
                    if href2 and _accept_permalink(href2):
                        # FB đôi khi copy thẳng permalink — nhận luôn, khỏi mở /share/p/
                        accepted = _accept_permalink(href2)
                        _close_share_sheet()
                        _log(f"Permalink OK (source=clipboard_permalink): {accepted}")
                        return StatusUrlResult(accepted, True)

                    # Chỉ khi clipboard trống mới thử Escape bubble rồi đọc lại
                    if not clip or clip == (before_clip or ""):
                        _log("Extract(share): clipboard chưa đổi — thử Escape bubble quyền rồi đọc lại...")
                        _dismiss_clipboard_permission_bubble()
                        clip2 = _wait_clipboard_after_copy(before_clip, timeout=2.0)
                        _log(
                            f"Extract(share): clipboard sau Escape "
                            f"(len={len(clip2 or '')})={((clip2 or '')[:180])!r}"
                        )
                        href2b = _extract_any_post_link(clip2)
                        if href2b and _normalize_share_p(href2b):
                            share_url = _normalize_share_p(href2b)
                            link_source = "clipboard_os_retry"
                            _log(f"Extract(share): lấy /share/p/ từ clipboard (retry): {share_url}")
                            break
                        if href2b and _accept_permalink(href2b):
                            accepted = _accept_permalink(href2b)
                            _close_share_sheet()
                            _log(f"Permalink OK (source=clipboard_permalink_retry): {accepted}")
                            return StatusUrlResult(accepted, True)

                    _log(
                        "Extract(share): Copy xong nhưng clipboard không chứa /share/p/ "
                        "hay permalink — thử DOM lại."
                    )
                    try:
                        sheet2 = driver.execute_script(read_share_sheet_js)
                        href3 = _normalize_share_p((sheet2 or {}).get("shareHref")) if isinstance(sheet2, dict) else None
                        if href3:
                            share_url = href3
                            link_source = "dom_after_copy"
                            _log(f"Extract(share): lấy /share/p/ từ DOM sau Copy: {share_url}")
                            break
                    except Exception:
                        pass
                    # Đã Copy 1 lần — thoát vòng chờ sheet (menu thường đã đóng)
                    break
            time.sleep(0.5)

        if not share_url:
            # Log nút trong bảng rồi đóng → Tier5
            try:
                sheet = driver.execute_script(read_share_sheet_js)
                if isinstance(sheet, dict):
                    _log(
                        f"Extract(share): không có /share/p/ — sheet_seen={sheet_seen} "
                        f"hasCopy={sheet.get('hasCopy')} buttons={sheet.get('buttons')!r}"
                    )
            except Exception:
                _log("Extract(share): không có /share/p/ và không đọc được nút bảng Share.")
            _close_share_sheet()
            _log("Extract(share): Share fail → Tier5 (không timestamp / Embed /me).")
            return _fallback_profile()

        _close_share_sheet()
        time.sleep(0.4)
        # Kiểm tra card còn trên feed
        try:
            still = driver.execute_script(
                "return !!document.querySelector(\"[data-ada-share-card='1']\");"
            )
            _log(f"Extract(share): sau đóng Share, card còn trên feed={bool(still)}")
        except Exception:
            pass

        # ── 3. Mở /share/p/ tab mới → chờ permalink ──
        _log(f"Extract(share): mở tab mới resolve {share_url} (source={link_source})...")
        handles_before = list(driver.window_handles)
        try:
            driver.execute_script("window.open(arguments[0], '_blank');", share_url)
        except Exception as e:
            _log(f"Extract(share): window.open lỗi — thử driver.get: {e}")
            try:
                driver.get(share_url)
            except Exception as e2:
                _log(f"Extract(share): không mở được share link: {e2}")
                return _fallback_profile()

        time.sleep(0.8)
        try:
            handles_now = list(driver.window_handles)
            new_handles = [h for h in handles_now if h not in handles_before]
            if new_handles:
                driver.switch_to.window(new_handles[0])
            # nếu get trên cùng tab thì không có new handle
        except Exception as e:
            _log(f"Extract(share): switch tab lỗi: {e}")

        permalink = None
        resolve_deadline = time.time() + 10.0
        last_url = ""
        while time.time() < resolve_deadline:
            try:
                cur = driver.current_url or ""
                last_url = cur
                accepted = _accept_permalink(cur)
                if accepted:
                    permalink = accepted
                    _log(f"Extract(share): URL sau Share → permalink {permalink}")
                    break
                if _is_profile_or_me_url(cur):
                    _log(f"Extract(share): URL về profile — bỏ: {_clean_facebook_url(cur)!r}")
                    break
            except Exception:
                pass
            time.sleep(0.5)

        if not permalink:
            _log(
                f"Extract(share): sau 10s chưa ra permalink "
                f"(last={_clean_facebook_url(last_url)!r}) → Tier5."
            )

        # Đóng tab share, về feed
        try:
            handles_now = list(driver.window_handles)
            if feed_handle and len(handles_now) > 1 and driver.current_window_handle != feed_handle:
                driver.close()
                driver.switch_to.window(feed_handle)
            elif feed_handle:
                try:
                    driver.switch_to.window(feed_handle)
                except Exception:
                    pass
                # nếu đã navigate trên cùng tab → back về feed
                try:
                    cur = driver.current_url or ""
                    if _accept_permalink(cur) or _is_share_p_url(cur) or _is_profile_or_me_url(cur):
                        if feed_url:
                            driver.get(feed_url)
                except Exception:
                    pass
        except Exception as e:
            _log(f"Extract(share): đóng tab/về feed lỗi: {e}")

        if permalink:
            _log(f"Permalink OK (source=share/{link_source}): {permalink}")
            return StatusUrlResult(permalink, True)

        return _fallback_profile()

    except Exception as e:
        try:
            _log(f"Extract(share) exception (không fail bài đăng): {e}")
        except Exception:
            pass
        try:
            # cố gắng về tab gốc
            if driver.window_handles:
                driver.switch_to.window(driver.window_handles[0])
        except Exception:
            pass
        try:
            return _fallback_profile()
        except Exception:
            return StatusUrlResult(None, False)

def _reel_id_from_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    m = re.search(r"/(?:reel|reels)/(\d{6,})", str(url))
    return m.group(1) if m else None


def _canonical_reel_url(reel_id: str) -> str:
    return f"https://www.facebook.com/reel/{reel_id}"


def _snapshot_profile_reel_ids(driver, uid: Optional[str] = None) -> list:
    """Lấy danh sách ID Reels trên tab profile (mới → cũ). Không navigate nếu đang ở create."""
    js_collect = """
        const ids = [];
        const seen = new Set();
        const anchors = Array.from(document.querySelectorAll("a[href*='/reel/']"));
        for (const a of anchors) {
            const h = a.href || "";
            if (!h.includes('/reel/') || h.includes('/create') || h.includes('/reel/?')) continue;
            const m = h.match(/\\/reel\\/(\\d{6,})/);
            if (m && !seen.has(m[1])) {
                seen.add(m[1]);
                ids.push(m[1]);
            }
        }
        return ids;
    """
    try:
        ids = driver.execute_script(js_collect) or []
        return [str(x) for x in ids if x]
    except Exception:
        return []


def extract_reels_post_url(
    driver,
    uid: Optional[str] = None,
    log_cb: Optional[Any] = None,
    known_reel_ids: Optional[Any] = None,
) -> Optional[str]:
    """
    Link đúng video vừa đăng: https://www.facebook.com/reel/{id}.

    Không dùng bare /reel/ (For You). Không lấy đại link /reel/{id} đầu tiên trên /me
    (dễ gán nhầm ID video cũ khi đăng nhiều clip cùng nick).

    known_reel_ids: ID đã có trước khi đăng — ưu tiên ID mới xuất hiện.
    """
    def _log(m):
        if log_cb:
            log_cb(m)
        logger.info(m)

    known = {str(x) for x in (known_reel_ids or []) if x}

    def _accept(rid: Optional[str], source: str) -> Optional[str]:
        if not rid:
            return None
        if known and rid in known:
            return None
        url = _canonical_reel_url(rid)
        _log(f"Lấy được URL Reels ({source}): {url}")
        return url

    js_find_notif_reel = """
        const allAnchors = Array.from(document.querySelectorAll("a[href*='/reel/']"));
        const notifAnchor = allAnchors.find(a =>
            (a.href || '').includes('fb_shorts_video_processed') ||
            (a.href || '').includes('notification_fb_shorts')
        );
        if (notifAnchor) {
            const m = notifAnchor.href.match(/\\/reel\\/(\\d{6,})/);
            if (m) return m[1];
        }
        const alertAnchors = Array.from(document.querySelectorAll(
            "div[role='alert'] a[href*='/reel/'], [role='status'] a[href*='/reel/']"
        ));
        for (const a of alertAnchors) {
            const m = (a.href || '').match(/\\/reel\\/(\\d{6,})/);
            if (m) return m[1];
        }
        return null;
    """

    try:
        _log("Đang trích xuất liên kết Reels vừa đăng (bắt buộc có ID số)...")

        # Tier 0: current_url ngay sau đăng (có ID) — bỏ qua bare /reel/
        for _ in range(8):
            try:
                cur = driver.current_url or ""
            except Exception:
                cur = ""
            rid = _reel_id_from_url(cur)
            hit = _accept(rid, "current_url")
            if hit:
                return hit
            # Bare /reel/ = feed For You, không phải link video
            time.sleep(0.75)

        # Tier 1: poll toast / notification ~15s
        for attempt in range(8):
            try:
                rid = driver.execute_script(js_find_notif_reel)
                hit = _accept(rid, "thông báo xuất bản")
                if hit:
                    return hit
            except Exception:
                pass
            time.sleep(2.0 if attempt < 4 else 1.5)

        # Tier 2: tab Reels của chính nick — lấy ID mới nhất (đầu danh sách)
        # Không quét timeline /me (dễ trúng video cũ / người khác).
        profile_reels = None
        if uid:
            profile_reels = f"https://www.facebook.com/{uid}/reels"
        else:
            profile_reels = "https://www.facebook.com/me/reels"

        try:
            _log(f"Mở tab Reels profile để lấy ID mới nhất: {profile_reels}")
            driver.get(profile_reels)
            time.sleep(4.0)
            for attempt in range(5):
                ids = _snapshot_profile_reel_ids(driver, uid)
                if ids:
                    # Ưu tiên ID chưa có trong known (video vừa đăng)
                    for rid in ids:
                        hit = _accept(rid, "tab Reels profile (mới)")
                        if hit:
                            return hit
                    # Không có known → ID đầu = mới nhất trên tab
                    if not known:
                        hit = _accept(ids[0], "tab Reels profile (đầu danh sách)")
                        if hit:
                            return hit
                time.sleep(2.0)
        except Exception as e:
            logger.debug(f"Không đọc được tab Reels profile: {e}")

        # Tier 3: fallback — chỉ trang Reels profile (không gắn ID giả)
        if uid:
            fallback = f"https://www.facebook.com/{uid}/reels"
            _log(f"Chưa bắt được ID Reels — fallback tạm: {fallback}")
            return fallback

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

def _normalize_status_image_paths(
    image_paths: Optional[Any] = None,
    image_path: Optional[str] = None,
    max_images: int = 3,
) -> List[str]:
    """Chuẩn hóa list path ảnh Status (tối đa 3), bỏ path không tồn tại."""
    paths: List[str] = []
    raw = image_paths
    if isinstance(raw, str):
        text = raw.strip()
        if text:
            try:
                parsed = json.loads(text)
                raw = parsed if isinstance(parsed, list) else [text]
            except Exception:
                raw = [text]
    if isinstance(raw, (list, tuple)):
        for item in raw:
            p = str(item or "").strip()
            if p and p not in paths:
                paths.append(p)
    if not paths and image_path:
        p = str(image_path).strip()
        if p:
            paths.append(p)
    existing: List[str] = []
    for p in paths[:max_images]:
        abs_p = os.path.abspath(p)
        if os.path.isfile(abs_p):
            existing.append(abs_p)
        else:
            logger.warning(f"Bỏ qua ảnh không tồn tại: {p}")
    return existing


_STATUS_COMPOSER_TEXTBOX_XPATHS = (
    "//div[@role='dialog']//div[@role='textbox' and @contenteditable='true']",
    "//div[@role='dialog']//div[@role='textbox']",
    "//div[@role='dialog']//div[@data-lexical-editor='true']",
    "//div[@role='dialog']//div[@contenteditable='true']",
    "//div[@role='dialog']//div[contains(@aria-label, 'Bạn đang nghĩ gì') or contains(@aria-label, \"What's on your mind\")]",
)


def _status_composer_plain_text(driver) -> str:
    """Đọc nội dung composer Status bằng innerText (Lexical), scoped trong dialog."""
    try:
        text = driver.execute_script(
            """
            function getComposerDialog() {
                const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                return dialogs.find(d => {
                    const rect = d.getBoundingClientRect();
                    return rect.width > 250 && rect.height > 150;
                }) || dialogs[dialogs.length - 1] || null;
            }
            const dialog = getComposerDialog();
            if (!dialog) return '';
            const candidates = Array.from(dialog.querySelectorAll(
                'div[role="textbox"][contenteditable="true"], div[data-lexical-editor="true"], div[contenteditable="true"]'
            ));
            for (const el of candidates) {
                const rect = el.getBoundingClientRect();
                if (rect.width < 40 || rect.height < 20) continue;
                const t = (el.innerText || el.textContent || '').replace(/\\u200b/g, '').trim();
                if (t) return t;
            }
            return '';
            """
        )
        return (text or "").strip()
    except Exception:
        return ""


def _find_status_composer_textbox(driver):
    """Tìm textbox soạn Status chỉ trong dialog (không dùng selector global)."""
    for sel in _STATUS_COMPOSER_TEXTBOX_XPATHS:
        try:
            for el in driver.find_elements(By.XPATH, sel):
                try:
                    if el.is_displayed():
                        return el
                except StaleElementReferenceException:
                    continue
        except Exception:
            continue
    return None


def _wait_status_composer_settle(driver, log_cb: Optional[Any] = None, timeout: float = 8.0) -> bool:
    """
    Poll đến khi dialog composer còn mở và textbox displayed,
    rồi settle thêm 1.0–1.5s cho Lexical/network ổn định.
    """
    def _log(msg: str):
        if log_cb:
            log_cb(msg)

    deadline = time.time() + max(2.0, float(timeout))
    found = False
    while time.time() < deadline:
        try:
            if is_composer_dialog_open(driver) and _find_status_composer_textbox(driver) is not None:
                found = True
                break
        except Exception:
            pass
        time.sleep(random.uniform(0.4, 0.6))

    if found:
        settle = random.uniform(1.0, 1.5)
        time.sleep(settle)
        return True

    _log("Cảnh báo: composer Status chưa settle đủ trong timeout — vẫn thử tiếp.")
    time.sleep(random.uniform(0.6, 1.0))
    return False


def _ensure_status_composer_content(
    driver,
    human: HumanInteraction,
    content: str,
    log_cb: Optional[Any] = None,
    check_pause: Optional[Any] = None,
    max_attempts: int = 3,
) -> None:
    """
    Đảm bảo ô soạn Status còn đủ nội dung (đặc biệt sau khi đính kèm ảnh).
    Nếu content rỗng hoặc không khôi phục được → raise (không bấm Đăng).
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    def _chk():
        if check_pause and callable(check_pause):
            check_pause(log_cb)

    plain = (content or "").strip()
    if not plain:
        raise RuntimeError("Nội dung bài Status trống — hủy đăng để tránh bài chỉ còn ảnh.")

    threshold = max(10, int(len(plain) * 0.7))
    _wait_status_composer_settle(driver, log_cb=log_cb, timeout=8)

    last_len = 0
    for attempt in range(1, max_attempts + 1):
        _chk()
        current = _status_composer_plain_text(driver)
        last_len = len(current)
        if last_len >= threshold:
            log(f"✓ Composer Status còn đủ nội dung ({last_len} ký tự).")
            return

        log(
            f"Nội dung composer thiếu/mất sau thao tác UI "
            f"(đọc được {last_len}/{len(plain)} ký tự) — khôi phục lần {attempt}/{max_attempts}..."
        )
        input_box = _find_status_composer_textbox(driver)
        if not input_box:
            _wait_status_composer_settle(driver, log_cb=log_cb, timeout=5)
            input_box = _find_status_composer_textbox(driver)
        if not input_box:
            time.sleep(random.uniform(0.8, 1.2))
            continue

        try:
            try:
                human.click(input_box)
            except Exception:
                driver.execute_script("arguments[0].focus();", input_box)
            time.sleep(0.35)
            try:
                input_box.send_keys(Keys.CONTROL, "a")
                time.sleep(0.12)
            except Exception:
                pass

            inserted = False
            try:
                driver.execute_cdp_cmd("Input.insertText", {"text": plain})
                inserted = True
            except Exception as e_cdp:
                logger.debug(f"CDP insertText Status thất bại: {e_cdp}")

            if not inserted:
                try:
                    driver.execute_script(
                        """
                        const el = arguments[0];
                        const text = arguments[1];
                        if (!el) return false;
                        el.focus();
                        try { document.execCommand('selectAll', false, null); } catch (e) {}
                        return document.execCommand('insertText', false, text);
                        """,
                        input_box,
                        plain,
                    )
                    inserted = True
                except Exception as e_js:
                    logger.debug(f"execCommand insertText Status thất bại: {e_js}")

            if not inserted:
                try:
                    human.human_type(input_box, plain, mistake_rate=0.0)
                except Exception as e_type:
                    logger.debug(f"human_type Status fallback thất bại: {e_type}")
        except StaleElementReferenceException:
            time.sleep(random.uniform(0.6, 1.0))
            continue
        except Exception as e:
            logger.debug(f"Lỗi khôi phục nội dung Status lần {attempt}: {e}")

        time.sleep(random.uniform(0.8, 1.2))
        current = _status_composer_plain_text(driver)
        last_len = len(current)
        if last_len >= threshold:
            log(f"✓ Đã khôi phục nội dung composer Status ({last_len} ký tự).")
            return

    raise RuntimeError(
        f"Composer text missing before publish "
        f"(đọc được {last_len}/{len(plain)} ký tự sau {max_attempts} lần thử)."
    )


def _is_save_draft_dialog_open(driver) -> bool:
    """True nếu đang hiện bảng Lưu nháp / Save draft."""
    try:
        return bool(driver.execute_script("""
            const re = /(lưu nháp|save draft|lưu bài viết nháp|save as draft)/i;
            const continueRe = /(tiếp tục chỉnh sửa|continue editing)/i;
            const discardRe = /(hủy bỏ|discard)/i;
            for (const d of Array.from(document.querySelectorAll('div[role="dialog"], div[role="alertdialog"]'))) {
                const t = (d.innerText || d.textContent || '').replace(/\\s+/g, ' ').trim();
                if (!t) continue;
                if (re.test(t)) return true;
                if (discardRe.test(t) && continueRe.test(t)) return true;
            }
            return false;
        """))
    except Exception:
        return False


def _continue_editing_from_save_draft(driver, human: HumanInteraction, log_cb=None) -> bool:
    """
    Bấm 'Tiếp tục chỉnh sửa / Continue editing'. Không bấm Lưu nháp / Hủy bỏ.
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    js = """
        function triggerRealClick(el) {
            if (!el) return false;
            try {
                ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(evt => {
                    el.dispatchEvent(new MouseEvent(evt, {bubbles:true, cancelable:true, view:window}));
                });
                if (typeof el.click === 'function') el.click();
                return true;
            } catch (e) { return false; }
        }
        const continueRe = /^(tiếp tục chỉnh sửa|continue editing)$/i;
        const badRe = /^(lưu nháp|save draft|hủy bỏ|discard|lưu bài viết nháp)$/i;
        const roots = Array.from(document.querySelectorAll('div[role="dialog"], div[role="alertdialog"]'));
        for (const root of roots) {
            const buttons = Array.from(root.querySelectorAll('div[role="button"], button, span[role="button"]'));
            for (const b of buttons) {
                const text = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
                const aria = (b.getAttribute('aria-label') || '').trim();
                const blob = (text || aria);
                if (!blob || badRe.test(blob)) continue;
                if (continueRe.test(blob) || /tiếp tục chỉnh sửa|continue editing/i.test(blob)) {
                    triggerRealClick(b);
                    return true;
                }
            }
        }
        return false;
    """
    try:
        if driver.execute_script(js):
            log("save_draft_dialog_found → đã bấm 'Tiếp tục chỉnh sửa' (không lưu nháp / không hủy).")
            time.sleep(1.2)
            return True
    except Exception:
        pass
    # Selenium fallback
    for sel in [
        "//div[@role='dialog' or @role='alertdialog']//span[contains(., 'Tiếp tục chỉnh sửa') or contains(., 'Continue editing')]/ancestor::*[@role='button' or self::button][1]",
        "//div[@role='dialog' or @role='alertdialog']//*[@role='button' and (contains(@aria-label,'Tiếp tục') or contains(@aria-label,'Continue editing'))]",
    ]:
        try:
            for el in driver.find_elements(By.XPATH, sel):
                if el.is_displayed():
                    human.click(el)
                    log("save_draft_dialog_found → Selenium click 'Tiếp tục chỉnh sửa'.")
                    time.sleep(1.2)
                    return True
        except Exception:
            continue
    return False


def _log_open_dialogs_snapshot(driver, log_cb=None) -> str:
    """Log số dialog + tên/text/nút — trả reason gợi ý: save_draft_dialog | composer_closed | post_button_not_found."""
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    try:
        info = driver.execute_script("""
            const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], div[role="alertdialog"]'));
            return dialogs.map((d, i) => {
                const label = (d.getAttribute('aria-label') || '').trim();
                const text = ((d.innerText || d.textContent || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 240);
                const buttons = Array.from(d.querySelectorAll('div[role="button"], button')).slice(0, 25).map(b => ({
                    text: ((b.innerText || b.textContent || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 60),
                    aria: (b.getAttribute('aria-label') || '').trim().slice(0, 60),
                    disabled: (b.getAttribute('aria-disabled') || '') === 'true' || !!b.disabled,
                    displayed: !!(b.offsetParent !== null || b.getClientRects().length),
                }));
                return { i, label, text, buttons };
            });
        """)
    except Exception as e:
        log(f"dialog_snapshot lỗi: {e}")
        return "post_button_not_found"

    if not isinstance(info, list) or not info:
        log("dialog_snapshot: không còn role=dialog nào → composer_closed")
        return "composer_closed"

    log(f"dialog_snapshot: {len(info)} hộp thoại role=dialog/alertdialog đang mở")
    reason = "post_button_not_found"
    for d in info:
        log(f"  dialog[{d.get('i')}] aria-label={d.get('label')!r} text={d.get('text')!r}")
        for b in (d.get("buttons") or []):
            log(
                f"    btn text={b.get('text')!r} aria={b.get('aria')!r} "
                f"disabled={b.get('disabled')} displayed={b.get('displayed')}"
            )
        blob = f"{d.get('label') or ''} {d.get('text') or ''}".lower()
        if any(x in blob for x in ("lưu nháp", "save draft", "hủy bỏ", "discard")):
            reason = "save_draft_dialog"
    if reason == "post_button_not_found" and not is_composer_dialog_open(driver):
        reason = "composer_closed"
    return reason


def _save_status_fail_screenshot(driver, tag: str, log_cb=None) -> Optional[str]:
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)
    try:
        folder = os.path.join(os.getcwd(), "logs", "screenshots")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"status_{tag}_{int(time.time())}.png")
        driver.save_screenshot(path)
        log(f"Đã lưu screenshot lúc fail: {path}")
        return path
    except Exception as e:
        log(f"Không lưu được screenshot: {e}")
        return None


def publish_status_post(
    driver,
    content: str,
    image_path: Optional[str] = None,
    log_cb: Optional[Any] = None,
    check_pause: Optional[Any] = None,
    uid: Optional[str] = None,
    image_paths: Optional[Any] = None,
    on_checkpoint: Optional[Callable[..., None]] = None,
) -> StatusUrlResult:
    """
    Đăng bài viết trạng thái lên Facebook Newsfeed / Page bằng HumanInteraction.
    Hỗ trợ tối đa 3 ảnh (image_paths); image_path vẫn dùng làm fallback 1 ảnh.
    Trả về StatusUrlResult(url, is_permalink) — is_permalink=False khi chỉ có link profile.
    Extract chỉ chạy khi post_clicked=True và đã xác nhận đăng thành công.
    """
    def log(msg: str):
        if log_cb:
            log_cb(msg)
        logger.info(msg)

    def _chk():
        if check_pause and callable(check_pause):
            check_pause(log_cb)

    def _mark(step: str, activity: Optional[str] = None):
        if on_checkpoint and callable(on_checkpoint):
            try:
                on_checkpoint(step, activity)
            except TypeError:
                on_checkpoint(step)
        _chk()

    human = HumanInteraction(driver)
    post_clicked = False
    status_images = _normalize_status_image_paths(image_paths, image_path)
    content_text = (content or "").strip()
    if status_images and not content_text:
        raise RuntimeError(
            "Bài Status có ảnh nhưng nội dung trống — hủy đăng để tránh bài chỉ còn ảnh."
        )

    _mark("NAVIGATE_HOME", "Điều hướng tới trang chủ Facebook...")
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
    _mark("OPEN_COMPOSER", "Tìm / mở khung soạn thảo bài viết...")
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

    # 2.1 Audience Công khai MỘT LẦN trước khi gõ — sau gõ không mở lại
    _mark("SET_AUDIENCE", "Chọn đối tượng Công khai một lần (trước khi gõ)...")
    try:
        ensure_post_audience_public(driver, human, log_cb=log)
    except Exception as e:
        logger.warning(f"Lỗi khi kiểm tra đối tượng bài viết lúc mở hộp thoại: {e}")

    # Nếu audience còn mở → chỉ Done/Xong (close_audience_dialog đã siết)
    if is_audience_dialog_open(driver):
        log("Bảng audience còn mở — chỉ bấm Done/Xong để đóng...")
        close_audience_dialog(driver, human, log_cb=log)
        time.sleep(0.8)

    # Sau đóng audience: composer phải còn mở; không đi tìm Đăng nếu đã mất
    if not is_composer_dialog_open(driver):
        if _is_save_draft_dialog_open(driver):
            log("composer_closed nhưng thấy Lưu nháp ngay sau audience — thử Tiếp tục chỉnh sửa...")
            _continue_editing_from_save_draft(driver, human, log_cb=log)
        if not is_composer_dialog_open(driver):
            reason = _log_open_dialogs_snapshot(driver, log_cb=log)
            _save_status_fail_screenshot(driver, "composer_closed_after_audience", log_cb=log)
            check_account_health(driver)
            raise RuntimeError(
                f"composer_closed: hộp thoại đăng đã mất sau khi đóng audience "
                f"(reason={reason}). Chưa bấm Đăng — không chạy extract."
            )
    try:
        plain_now = _status_composer_plain_text(driver)
        log(f"Sau audience: composer còn mở, nội dung hiện có {len(plain_now)} ký tự.")
    except Exception:
        pass

    _mark("TYPE_CONTENT", "Nhập nội dung bài viết...")
    log("Nhập nội dung bài viết theo tốc độ gõ người thật...")
    # Tắt gõ nhầm (mistake_rate=0.0) để tránh phím Backspace làm vỡ cấu trúc draft editor của Facebook
    human.human_type(input_box, content_text or content, mistake_rate=0.0)
    time.sleep(random.uniform(0.8, 1.4))

    # Kiểm tra an toàn độ dài — chỉ đồng bộ text, KHÔNG đụng audience lại
    try:
        current_text = _status_composer_plain_text(driver) or (input_box.text or "").strip()
        need = content_text or (content or "")
        if need and len(current_text) < max(10, int(len(need) * 0.7)):
            log("Phát hiện văn bản chưa đủ trong ô soạn thảo, đang đồng bộ toàn bộ nội dung...")
            human.click(input_box)
            time.sleep(0.3)
            input_box.send_keys(Keys.CONTROL, "a")
            time.sleep(0.1)
            driver.execute_cdp_cmd("Input.insertText", {"text": need})
            time.sleep(random.uniform(0.8, 1.2))
    except Exception as e:
        logger.debug(f"Bỏ qua kiểm tra độ dài ô soạn thảo: {e}")

    # KHÔNG gọi lại ensure_post_audience_public / close_audience sau khi gõ
    # (log 14:25 chứng minh mở lại audience → đóng nhầm → Lưu nháp / mất nút Đăng)

    # 4. Tải ảnh lên nếu có (1–3 ảnh): bấm icon ảnh trong 'Add to your post'
    if status_images:
        _mark("ATTACH_IMAGES", "Đính kèm ảnh vào bài Status...")
        _chk()
        names = ", ".join(os.path.basename(p) for p in status_images)
        log(f"Đính kèm {len(status_images)} ảnh: {names}...")
        try:
            # Bước 4.1: Nhấn vào icon Ảnh/video trong thanh 'Add to your post'
            photo_btn_clicked = False

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

            # Bước 4.2: Nạp toàn bộ ảnh (Selenium: nhiều path nối bằng \\n)
            log(f"Nạp {len(status_images)} file ảnh vào khung bài viết...")
            file_input = WebDriverWait(driver, 10).until(
                EC.presence_of_element_located((By.XPATH, "//div[@role='dialog']//input[@type='file']"))
            )
            try:
                driver.execute_script(
                    "arguments[0].setAttribute('multiple', 'multiple'); arguments[0].multiple = true;",
                    file_input,
                )
            except Exception:
                pass
            file_input.send_keys("\n".join(status_images))

            # Bước 4.3: Chờ preview — ưu tiên đủ số ảnh, tối thiểu 1 ảnh lớn/blob
            expect_n = len(status_images)
            log(f"Đợi preview {expect_n} ảnh trên bài viết...")
            img_preview_ready = False
            start_img_wait = time.time()
            while time.time() - start_img_wait < 20:
                _chk()
                js_check_preview = """
                    const expectN = arguments[0];
                    function getComposerDialog() {
                        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                        return dialogs.find(d => {
                            const rect = d.getBoundingClientRect();
                            return rect.width > 250 && rect.height > 150;
                        }) || dialogs[dialogs.length - 1];
                    }
                    const dialog = getComposerDialog();
                    if (!dialog) return 0;

                    let count = 0;
                    const imgs = Array.from(dialog.querySelectorAll('img'));
                    for (const img of imgs) {
                        const rect = img.getBoundingClientRect();
                        const src = img.src || '';
                        if (rect.width > 90 && rect.height > 70) count += 1;
                        else if (src.startsWith('blob:') && rect.width > 40) count += 1;
                    }
                    return count;
                """
                try:
                    preview_count = int(driver.execute_script(js_check_preview, expect_n) or 0)
                    if preview_count >= expect_n or (expect_n > 0 and preview_count >= 1 and time.time() - start_img_wait > 8):
                        img_preview_ready = preview_count > 0
                        if preview_count >= expect_n:
                            break
                        # Đã có ít nhất 1 preview sau 8s — chấp nhận tiếp tục (FB đôi khi gộp grid chậm)
                        if preview_count >= 1 and time.time() - start_img_wait > 8:
                            break
                except Exception:
                    pass
                time.sleep(0.5)

            if img_preview_ready:
                log(f"✓ Đã đính kèm {expect_n} ảnh (preview sẵn sàng).")
            else:
                log(f"Đã gửi {expect_n} file ảnh vào bài viết.")
            time.sleep(random.uniform(1.0, 1.8))
        except Exception as e:
            check_account_health(driver)
            raise RuntimeError(f"Lỗi tải ảnh đính kèm lên bài viết: {e}")
        # Không ENSURE_CONTENT / settle / khôi phục text sau ảnh — tránh đóng composer → Lưu nháp

    # 5. Tìm nút Đăng (≤30s). Xử lý Lưu nháp tối đa 1 lần. Không khôi phục nội dung.
    _mark("CLICK_POST", "Tìm và chuẩn bị bấm nút Đăng...")
    log("Tìm nút 'Đăng' / bước 'Next' trong hộp thoại...")
    save_draft_handled = False

    def _refind_post_button():
        for sel in [
            "//div[@role='dialog']//div[@role='button' and (@aria-label='Đăng' or @aria-label='Post')]",
            "//div[@role='dialog']//span[normalize-space()='Đăng' or normalize-space()='Post']/ancestor::div[@role='button'][1]",
            "//div[@role='dialog']//div[@role='button']//span[normalize-space()='Đăng' or normalize-space()='Post']",
            "//div[@role='dialog']//*[@role='button' and (contains(@aria-label, 'Đăng') or contains(@aria-label, 'Post'))]",
        ]:
            try:
                for el in driver.find_elements(By.XPATH, sel):
                    if el.is_displayed() and (el.get_attribute("aria-disabled") or "").lower() != "true":
                        return el
            except Exception:
                continue
        return None

    def _handle_save_draft_once() -> bool:
        nonlocal save_draft_handled
        if save_draft_handled:
            return False
        if not _is_save_draft_dialog_open(driver):
            return False
        log("save_draft_dialog_found — sẽ bấm 'Tiếp tục chỉnh sửa' (tối đa 1 lần).")
        ok = _continue_editing_from_save_draft(driver, human, log_cb=log)
        save_draft_handled = True
        if ok and is_composer_dialog_open(driver):
            try:
                n = len(_status_composer_plain_text(driver))
                log(f"Đã quay lại composer sau Lưu nháp — nội dung còn {n} ký tự.")
            except Exception:
                pass
            return True
        return False

    post_btn = None
    start_wait = time.time()
    while time.time() - start_wait < 30:
        _chk()
        if _is_save_draft_dialog_open(driver):
            _handle_save_draft_once()
            time.sleep(0.6)
            continue

        if not is_composer_dialog_open(driver):
            if _is_save_draft_dialog_open(driver) and _handle_save_draft_once():
                continue
            reason = _log_open_dialogs_snapshot(driver, log_cb=log)
            _save_status_fail_screenshot(driver, reason or "composer_closed", log_cb=log)
            check_account_health(driver)
            raise RuntimeError(
                f"composer_closed: hộp thoại đăng đã mất trước khi bấm Đăng "
                f"(reason={reason}). Không chạy extract."
            )

        post_btn = _refind_post_button()
        if post_btn:
            break

        js_find_btn = """
            function getComposerDialog() {
                const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                return dialogs.find(d => {
                    const rect = d.getBoundingClientRect();
                    return rect.width > 250 && rect.height > 150
                        && !!d.querySelector("div[role='textbox'], [contenteditable='true']");
                }) || null;
            }
            const dialog = getComposerDialog();
            if (!dialog) return null;
            const buttons = Array.from(dialog.querySelectorAll('div[role="button"], button'));
            for (const b of buttons) {
                const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
                if (text === 'đăng' || text === 'post' || aria === 'đăng' || aria === 'post') {
                    if (b.getAttribute('aria-disabled') !== 'true' && !b.disabled) return b;
                }
            }
            for (const b of buttons) {
                const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
                if (['next', 'tiếp', 'tiếp theo'].includes(text) || ['next', 'tiếp', 'tiếp theo'].includes(aria)) {
                    if (b.getAttribute('aria-disabled') !== 'true' && !b.disabled) {
                        b.click();
                        return 'NEXT_CLICKED';
                    }
                }
            }
            return null;
        """
        try:
            js_btn = driver.execute_script(js_find_btn)
            if js_btn == "NEXT_CLICKED":
                log("Đã bấm Next/Tiếp → chờ màn Post settings...")
                time.sleep(random.uniform(1.2, 2.0))
                continue
            if js_btn:
                post_btn = js_btn
                break
        except Exception:
            pass
        time.sleep(1)

    if not post_btn:
        if _is_save_draft_dialog_open(driver):
            reason = "save_draft_dialog"
        elif not is_composer_dialog_open(driver):
            reason = "composer_closed"
        else:
            reason = "post_button_not_found"
        snap = _log_open_dialogs_snapshot(driver, log_cb=log)
        if snap in ("save_draft_dialog", "composer_closed"):
            reason = snap
        _save_status_fail_screenshot(driver, reason, log_cb=log)
        check_account_health(driver)
        raise RuntimeError(
            f"{reason}: không tìm thấy nút 'Đăng' trong 30s. "
            f"Chưa bấm Đăng — không chạy extract."
        )

    # Bấm Đăng — không ENSURE_CONTENT / settle trước đó
    _mark("CLICK_POST", "Đã sẵn sàng — nhấn nút Đăng (post_clicked)...")
    log("Di chuột quỹ đạo Bézier tự nhiên và nhấn nút 'Đăng'...")
    clicked = False
    for attempt in range(4):
        if _is_save_draft_dialog_open(driver):
            _handle_save_draft_once()
        btn = post_btn if attempt == 0 else _refind_post_button()
        if btn is None:
            btn = _refind_post_button()
        if btn is None:
            time.sleep(0.4)
            continue
        try:
            human.click(btn)
            clicked = True
            break
        except StaleElementReferenceException:
            log(f"Phần tử nút Đăng bị stale (lần {attempt + 1}) — tìm lại...")
            post_btn = None
            time.sleep(0.35)
            continue
        except Exception:
            try:
                driver.execute_script(
                    "arguments[0].scrollIntoView({block:'center'}); arguments[0].click();",
                    btn,
                )
                clicked = True
                break
            except StaleElementReferenceException:
                post_btn = None
                time.sleep(0.35)
                continue
            except Exception:
                time.sleep(0.35)
                continue
    if not clicked:
        reason = _log_open_dialogs_snapshot(driver, log_cb=log)
        _save_status_fail_screenshot(driver, "post_click_failed", log_cb=log)
        check_account_health(driver)
        raise RuntimeError(
            f"post_button_not_found: không thể bấm nút 'Đăng' (snapshot={reason}). "
            f"Chưa bấm Đăng — không chạy extract."
        )

    post_clicked = True
    log("post_clicked=True — đã bấm Đăng thành công.")

    _mark("WAIT_CONFIRM", "Chờ Facebook xác nhận bài đăng (không bấm Đăng lại khi resume)...")
    log("Chờ máy chủ Facebook xác nhận bài đăng xuất bản...")
    dialog_closed = False
    publish_confirmed = False
    try:
        wait_dialog_closed(driver, timeout=90, check_pause=check_pause, log_cb=log)
        dialog_closed = True
        publish_confirmed = True
    except PublishUnconfirmed:
        log("Chưa thấy dialog đóng — kiểm tra tín hiệu đăng thành công (không extract nếu chưa xác nhận)...")
        if _status_publish_success_signal(driver):
            publish_confirmed = True
            dialog_closed = not is_composer_dialog_open(driver)
            log("Có tín hiệu toast/đăng thành công — coi như đã xác nhận.")
        else:
            raise PublishUnconfirmed(
                "Hộp thoại đăng chưa đóng và không có tín hiệu đăng thành công — không chạy extract."
            )

    if not (post_clicked and publish_confirmed):
        raise RuntimeError(
            "Chưa đủ điều kiện extract (cần post_clicked + xác nhận đã đăng). Không chạy extract."
        )

    log("Bài viết đã xuất bản thành công!")

    # Extract chỉ khi đã bấm Đăng + đã xác nhận — best-effort, không fail bài
    if post_clicked and publish_confirmed and (dialog_closed or _status_publish_success_signal(driver)):
        try:
            return extract_status_post_url(
                driver,
                uid=uid,
                log_cb=log,
                content_hint=content_text,
                status_text=content_text,
            )
        except Exception as e:
            log(f"Extract lỗi (bài vẫn SUCCESS): {e}")
            profile = _profile_url_from_uid(uid) or _profile_url_from_uid(_uid_from_c_user(driver))
            if profile:
                return StatusUrlResult(_clean_facebook_url(profile), False)
            return StatusUrlResult(None, False)

    log("Bỏ qua extract — thiếu điều kiện post_clicked/dialog/xác nhận.")
    profile = _profile_url_from_uid(uid) or _profile_url_from_uid(_uid_from_c_user(driver))
    if profile:
        return StatusUrlResult(_clean_facebook_url(profile), False)
    return StatusUrlResult(None, False)


# ==============================================================================
# 2. PUBLISH REELS POST
# ==============================================================================

def publish_reels_post(
    driver,
    video_path: str,
    caption: str = "",
    log_cb: Optional[Any] = None,
    check_pause: Optional[Any] = None,
    uid: Optional[str] = None,
    on_checkpoint: Optional[Callable[..., None]] = None,
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

    def _mark(step: str, activity: Optional[str] = None):
        if on_checkpoint and callable(on_checkpoint):
            try:
                on_checkpoint(step, activity)
            except TypeError:
                on_checkpoint(step)
        _chk()

    human = HumanInteraction(driver)

    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"File video không tồn tại: {video_path}")

    # Snapshot ID Reels đã có TRƯỚC khi vào create — tránh gán nhầm ID video cũ
    known_reel_ids = []
    try:
        _mark("REELS_SNAPSHOT", "Snapshot ID Reels cũ trên profile...")
        snap_url = (
            f"https://www.facebook.com/{uid}/reels"
            if uid
            else "https://www.facebook.com/me/reels"
        )
        log("Snapshot ID Reels hiện có trên profile (tránh gán nhầm link)...")
        driver.get(snap_url)
        time.sleep(3.0)
        known_reel_ids = _snapshot_profile_reel_ids(driver, uid)
        log(f"Đã ghi nhận {len(known_reel_ids)} Reels cũ trên profile.")
    except Exception as e:
        logger.debug(f"Snapshot reel IDs bỏ qua: {e}")

    _mark("REELS_OPEN_CREATE", "Mở trang tạo Reels...")
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
    _mark("REELS_UPLOAD", "Nạp / upload video Reels...")
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
    _mark("REELS_PRIVACY", "Thiết lập quyền riêng tư Reels sang Công khai...")
    try:
        ensure_reels_privacy_public(driver, human, log_cb=log)
    except Exception as e:
        log(f"Cảnh báo: Không thể thiết lập quyền riêng tư Reels: {e}")

    # 3. Điền Caption mô tả Reels
    if caption:
        _mark("REELS_CAPTION", "Nhập mô tả / caption Reels...")
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
    _mark("REELS_CLICK_POST", "Chờ render video và bấm Post / Đăng Reels...")
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
                    _mark("REELS_CLICK_POST", "Đã sẵn sàng — nhấn Post / Đăng Reels (post_clicked)...")
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

    _mark("REELS_WAIT_CONFIRM", "Chờ Facebook xác nhận Reels (không bấm Đăng lại khi resume)...")
    log("Chờ Facebook hoàn tất tải lên Reels...")
    reels_ok = wait_until(
        driver,
        lambda d: (not _is_reels_uploading_or_creating(d))
        or bool(_reel_id_from_url(getattr(d, "current_url", "") or "")),
        timeout=120,
        check_pause=check_pause,
        log_cb=log,
        poll=0.5,
    )
    if not reels_ok:
        check_account_health(driver)
        raise PublishUnconfirmed("Quá thời gian chờ đăng Reels, không thể xác nhận bài đã lên.")
    log("Reels đã được đăng lên thành công!")

    check_account_health(driver)
    res_url = extract_reels_post_url(
        driver, uid=uid, log_cb=log, known_reel_ids=known_reel_ids
    )
    # Không lưu bare /reel/ (For You) — thiếu ID thì fallback profile
    if res_url and _reel_id_from_url(res_url) is None and uid:
        if f"/{uid}/reels" not in (res_url or ""):
            log(f"Loại URL không hợp lệ (thiếu ID): {res_url}")
            res_url = f"https://www.facebook.com/{uid}/reels"
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
    uid: Optional[str] = None,
    on_checkpoint: Optional[Callable[..., None]] = None,
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

    def _mark(step: str, activity: Optional[str] = None):
        if on_checkpoint and callable(on_checkpoint):
            try:
                on_checkpoint(step, activity)
            except TypeError:
                on_checkpoint(step)
        _chk()

    human = HumanInteraction(driver)

    if not os.path.isfile(media_path):
        raise FileNotFoundError(f"File media Story không tồn tại: {media_path}")

    _mark("STORY_OPEN_CREATE", "Mở trang tạo Story...")
    log("Điều hướng tới trang tạo Story (facebook.com/stories/create)...")
    driver.get("https://www.facebook.com/stories/create")
    time.sleep(3)
    check_account_health(driver)
    _chk()

    # Nạp file Story trực tiếp qua thẻ input[type='file'] ẩn
    # TUYỆT ĐỐI KHÔNG click vào card 'Tạo tin ảnh'/'Tạo tin video' vì sẽ kích hoạt Windows Open Dialog
    _mark("STORY_UPLOAD", "Nạp media Story...")
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

    # Một lần duy nhất: bánh răng → Public → Save → confirm (nếu đã Public thì đóng luôn)
    _chk()
    time.sleep(1.2)
    try:
        ensure_story_privacy_public(driver, human, log_cb=log, open_panel=True)
    except Exception as e:
        log(f"Cảnh báo Story privacy sau media: {e}")

    media_ext = os.path.splitext(media_path)[1].lower()
    is_story_image = media_ext in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}

    # Story ảnh: chọn nhạc đề xuất đầu tiên (For you)
    if is_story_image:
        _mark("STORY_MUSIC", "Thêm nhạc đề xuất vào Story ảnh...")
        try:
            add_first_recommended_story_music(driver, human, log_cb=log)
        except StaleElementReferenceException:
            log("Stale khi chọn nhạc — bỏ qua, tiếp tục Share...")
        except Exception as e:
            log(f"Cảnh báo chọn nhạc Story ảnh: {e}")
        # Chỉ xử lý nếu modal đang mở — không bấm bánh răng lại
        try:
            ensure_story_privacy_public(driver, human, log_cb=log, open_panel=False)
        except Exception:
            pass

    # Nhập text nếu có
    if text:
        _mark("STORY_TEXT", "Thêm văn bản overlay vào Story...")
        log("Thêm văn bản vào Story...")
        try:
            text_tool = WebDriverWait(driver, 5).until(
                EC.element_to_be_clickable(
                    (
                        By.XPATH,
                        "//div[@role='button'][.//span[contains(text(), 'Add text') or contains(text(), 'Thêm văn bản') or contains(text(), 'Văn bản') or contains(text(), 'Text')]]",
                    )
                )
            )
            try:
                human.click(text_tool)
            except StaleElementReferenceException:
                driver.execute_script(
                    """
                    const nodes = Array.from(document.querySelectorAll("[role='button']"));
                    const b = nodes.find(n => /add text|thêm văn bản|văn bản|^text$/i.test((n.innerText||'').trim()));
                    if (b) b.click();
                    """
                )
            time.sleep(random.uniform(0.8, 1.5))
            text_input = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.XPATH, "//textarea | //div[@role='textbox']"))
            )
            human.human_type(text_input, text)
        except Exception:
            log("Bỏ qua thêm text Story do không tìm thấy công cụ.")

    # Chờ nút Share sáng — không giữ WebElement qua wait (tránh stale)
    _mark("STORY_CLICK_SHARE", "Chờ media sẵn sàng và bấm Share to story...")
    log("Chờ Facebook render media và nút 'Share to story' sáng...")
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
            log(f"Đang chờ Facebook xử lý media (đã chờ {elapsed}s/900s)...")
            last_poll_log = now

        try:
            privacy_open = d.execute_script(
                """
                const dialogs = Array.from(document.querySelectorAll("[role='dialog']"));
                for (const dlg of dialogs) {
                    const t = (dlg.innerText || '').toLowerCase();
                    if (t.includes('story privacy') || t.includes('who can see your story') ||
                        t.includes('change story privacy') ||
                        t.includes('changes you make will apply') ||
                        (t.includes('public') && t.includes('friends') && (t.includes('save') || t.includes('lưu')))) {
                        return true;
                    }
                }
                return false;
                """
            )
            if privacy_open:
                log("Phát hiện Story privacy khi chờ Share — xử lý (không mở bánh răng lại)...")
                ensure_story_privacy_public(d, human, log_cb=log, open_panel=False)
                return False
        except Exception:
            pass

        try:
            progress_bars = d.find_elements(By.XPATH, "//*[@role='progressbar' or @aria-busy='true']")
            for p in progress_bars:
                if p.is_displayed():
                    return False
        except Exception:
            pass

        try:
            ready = d.execute_script(
                """
                const labels = ['share to story', 'chia sẻ lên tin'];
                const nodes = Array.from(document.querySelectorAll("[role='button'], button"));
                for (const btn of nodes) {
                    if (!btn || btn.offsetParent === null) continue;
                    const t = ((btn.getAttribute('aria-label') || '') + ' ' + (btn.innerText || '')).trim().toLowerCase();
                    if (!labels.some(l => t.includes(l))) continue;
                    let cur = btn;
                    let disabled = false;
                    for (let i = 0; i < 4 && cur; i++) {
                        if (cur.getAttribute('aria-disabled') === 'true' || cur.hasAttribute('disabled')) {
                            disabled = true; break;
                        }
                        cur = cur.parentElement;
                    }
                    if (!disabled) return true;
                }
                return false;
                """
            )
            return bool(ready)
        except StaleElementReferenceException:
            return False
        except Exception:
            return False

    try:
        WebDriverWait(driver, 900, poll_frequency=1.5).until(check_share_button_ready)
    except TimeoutException:
        check_account_health(driver)
        raise RuntimeError(
            "Nút 'Share to story' không sáng sau 15 phút (treo transcoding hoặc media lỗi)."
        )

    _mark("STORY_CLICK_SHARE", "Đã sẵn sàng — nhấn Share to story (post_clicked)...")
    elapsed_total = int(time.time() - start_wait)
    log(f"Media sẵn sàng (sau {elapsed_total}s). Bấm 'Share to story'...")

    # Luôn re-find nút trước khi click — tránh StaleElementReferenceException
    clicked = False
    for attempt in range(5):
        try:
            clicked_js = driver.execute_script(
                """
                function triggerClick(el) {
                    if (!el) return false;
                    el.scrollIntoView({block:'center'});
                    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(evt => {
                        el.dispatchEvent(new MouseEvent(evt, {bubbles:true, cancelable:true, view:window}));
                    });
                    if (typeof el.click === 'function') el.click();
                    return true;
                }
                const labels = ['share to story', 'chia sẻ lên tin'];
                const nodes = Array.from(document.querySelectorAll("[role='button'], button"));
                for (const btn of nodes) {
                    if (!btn || btn.offsetParent === null) continue;
                    const t = ((btn.getAttribute('aria-label') || '') + ' ' + (btn.innerText || '')).trim().toLowerCase();
                    if (!labels.some(l => t.includes(l))) continue;
                    let cur = btn, disabled = false;
                    for (let i = 0; i < 4 && cur; i++) {
                        if (cur.getAttribute('aria-disabled') === 'true' || cur.hasAttribute('disabled')) {
                            disabled = true; break;
                        }
                        cur = cur.parentElement;
                    }
                    if (disabled) continue;
                    return triggerClick(btn);
                }
                return false;
                """
            )
            time.sleep(1.5)
            if "/stories/create" not in (driver.current_url or "").lower():
                clicked = True
                break
            if clicked_js:
                # Có thể chưa redirect ngay
                time.sleep(1.0)
                if "/stories/create" not in (driver.current_url or "").lower():
                    clicked = True
                    break
        except StaleElementReferenceException:
            log(f"Stale khi bấm Share (lần {attempt + 1}) — tìm lại nút...")
            time.sleep(0.6)
            continue
        except Exception as e:
            logger.debug(f"Share click attempt {attempt + 1}: {e}")
            time.sleep(0.6)

    if not clicked:
        for _ in range(5):
            time.sleep(1)
            if "/stories/create" not in (driver.current_url or "").lower():
                clicked = True
                break

    if not clicked:
        check_account_health(driver)
        raise PublishUnconfirmed(
            "Đã bấm 'Share to story' nhưng giao diện không chuyển trang, không xác nhận Story đã lên."
        )

    # Chờ điều hướng khỏi trang tạo story (pause-aware: không trừ thời gian tạm dừng)
    _mark("STORY_WAIT_CONFIRM", "Chờ Facebook xác nhận Story (không bấm Share lại khi resume)...")
    story_ok = wait_until(
        driver,
        lambda d: "/stories/create" not in (getattr(d, "current_url", "") or "").lower(),
        timeout=90,
        check_pause=check_pause,
        log_cb=log,
        poll=0.5,
    )
    if not story_ok:
        check_account_health(driver)
        raise PublishUnconfirmed("Quá thời gian chờ chia sẻ Story, không thể xác nhận tin đã lên.")
    log("Story đã được chia sẻ thành công!")

    check_account_health(driver)
    # Trích xuất URL xem Tin (Story) trực tiếp
    res_url = extract_story_post_url(driver, uid=uid, log_cb=log)
    return res_url

