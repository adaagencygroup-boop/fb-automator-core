"""
base.py
Lớp nền tảng điều khiển trình duyệt và xử lý phiên đăng nhập Facebook cho Module 08.
Cung cấp các cơ chế click chống che (multi-layer event injection), cuộn trang tự nhiên,
quản lý Cookie/Token và đăng nhập tự động qua Password + 2FA TOTP.
"""

import time
import random
import json
import logging
from typing import Optional, Callable, List, Dict, Any

import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver import ActionChains

from modules.module_02_account_manager.services.credentials import decrypt
from modules.module_02_account_manager.utils.otp_generator import generate_totp
from modules.module_08_interaction_seeding.automation.locators import LoginLocators

logger = logging.getLogger(__name__)


def parse_cookie_pairs(cookie_str: str) -> List[str]:
    """Tách cookie thành danh sách cặp name=value từ định dạng pipe (|) hoặc chấm phẩy (;)."""
    if not cookie_str:
        return []
    delimiter = '|' if '|' in cookie_str else ';'
    return [part.strip() for part in cookie_str.split(delimiter) if '=' in part]


def perform_robust_click(driver, elem) -> bool:
    """
    Helper click toàn diện kích hoạt mọi tầng DOM và React Synthetic Event của Facebook Comet.
    Bao gồm: scroll vào giữa màn hình, elementFromPoint, MouseEvent, PointerEvent, ActionChains, và native click.
    """
    if not elem:
        return False
    try:
        driver.execute_script("arguments[0].scrollIntoView({behavior: 'instant', block: 'center'});", elem)
        time.sleep(0.3)
    except Exception:
        pass

    try:
        driver.execute_script("""
            var el = arguments[0];
            var target = el.closest('div[role="button"]') || el.closest('a[role="button"]') || el.closest('.x1i10hfl') || el;
            target.focus();
            var rect = target.getBoundingClientRect();
            var x = rect.left + rect.width / 2;
            var y = rect.top + rect.height / 2;
            var hitEl = document.elementFromPoint(x, y) || target;
            hitEl.focus();
            
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function(type) {
                var isPointer = type.startsWith('pointer');
                var evt = isPointer
                    ? new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true })
                    : new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 });
                hitEl.dispatchEvent(evt);
                if (hitEl !== target) {
                    target.dispatchEvent(evt);
                }
            });
            try { hitEl.click(); } catch(e){}
            try { target.click(); } catch(e){}
        """, elem)
    except Exception as e:
        logger.debug(f"JS robust click error: {e}")

    try:
        ActionChains(driver).move_to_element(elem).click().perform()
    except Exception:
        pass

    try:
        elem.click()
    except Exception:
        pass

    return True


class BaseFacebookBot:
    """Lớp bot cơ sở cung cấp các tiện ích điều khiển trình duyệt và quản lý phiên."""

    def __init__(self, driver):
        self.driver = driver
        self.wait = WebDriverWait(self.driver, 10)

    def random_sleep(self, min_s: float = 2.0, max_s: float = 4.5):
        time.sleep(random.uniform(min_s, max_s))

    def safe_find_element(self, by, value, timeout: int = 5):
        """Tìm phần tử an toàn, không ném exception nếu không tìm thấy."""
        try:
            return WebDriverWait(self.driver, timeout).until(
                EC.presence_of_element_located((by, value))
            )
        except Exception:
            return None

    def safe_find_elements(self, by, value):
        """Tìm danh sách phần tử an toàn."""
        try:
            return self.driver.find_elements(by, value)
        except Exception:
            return []

    def safe_click(self, element) -> bool:
        """Thực hiện click đa tầng lên phần tử."""
        return perform_robust_click(self.driver, element)

    def is_browser_alive(self) -> bool:
        """Kiểm tra trình duyệt còn mở hay không."""
        try:
            _ = self.driver.title
            return True
        except Exception:
            return False

    def human_scroll(self, min_dist: int = 400, max_dist: int = 700):
        """Cuộn trang mượt mà như người dùng thật."""
        target_distance = random.randint(min_dist, max_dist)
        scrolled = 0
        while scrolled < target_distance:
            step = random.randint(15, 55)
            if scrolled + step > target_distance:
                step = target_distance - scrolled
            try:
                self.driver.execute_script(f"window.scrollBy(0, {step});")
            except Exception:
                break
            scrolled += step
            time.sleep(random.uniform(0.015, 0.04))
            if not self.is_browser_alive():
                break

    def is_facebook_session_alive(self, navigate: bool = False) -> bool:
        """Kiểm tra xem Chrome profile hiện tại đã đăng nhập Facebook hay chưa."""
        try:
            if navigate:
                self.driver.get("https://www.facebook.com/")
                time.sleep(3.5)

            curr_url = (self.driver.current_url or "").lower()
            if curr_url.startswith("about:blank") or curr_url.startswith("chrome://"):
                return False
            if "checkpoint" in curr_url:
                logger.warning("Trình duyệt đang ở checkpoint URL")
                return False

            # Kiểm tra xem có xuất hiện ô nhập mật khẩu / form login không
            for by, val in LoginLocators.LOGIN_FORM_MARKERS:
                try:
                    found = self.safe_find_element(by, val, timeout=1)
                    if found and found.is_displayed():
                        return False
                except Exception:
                    pass

            # Nếu đang ở màn hình lưu tài khoản / chọn nick (có nút "Dùng trang cá nhân khác")
            for xpath in getattr(LoginLocators, "SAVED_ACCOUNT_SWITCH_XPATHS", []):
                try:
                    found = self.safe_find_element(By.XPATH, xpath, timeout=1)
                    if found and found.is_displayed():
                        return False
                except Exception:
                    pass

            # Dấu hiệu đã đăng nhập thành công
            for by, val in LoginLocators.SESSION_ALIVE_INDICATORS:
                el = self.safe_find_element(by, val, timeout=2)
                if el:
                    return True

            # Kiểm tra cookie c_user có tồn tại
            cookies = self.driver.get_cookies()
            has_user = any(c.get("name") == "c_user" and c.get("value") for c in cookies)
            return has_user and "login" not in curr_url
        except Exception as e:
            logger.debug(f"is_facebook_session_alive error: {e}")
            return False

    def handle_saved_account_screen(self, callback: Optional[Callable[[str], None]] = None) -> bool:
        """
        Nếu xuất hiện màn hình tài khoản đã lưu (One-Click Login / có nút 'Dùng trang cá nhân khác'):
        Click vào nút 'Dùng trang cá nhân khác' để chuyển sang form đăng nhập chuẩn như ở Module 02.
        """
        try:
            # 1. Thử hàm chuẩn từ Module 02 nếu có
            try:
                from modules.module_02_account_manager.automation.login_flow import _handle_saved_account_screen
                if _handle_saved_account_screen(self.driver, sleep_before_click=1.0):
                    if callback:
                        callback("Phát hiện màn hình lưu nick; đã bấm 'Dùng trang cá nhân khác' về form đăng nhập chuẩn.")
                    logger.info("Module 02 _handle_saved_account_screen clicked successfully.")
                    return True
            except Exception as e:
                logger.debug(f"Module 02 _handle_saved_account_screen call note: {e}")

            # 2. Click bằng JavaScript tìm chính xác từ khóa trên DOM
            js_script = """
                var keywords = [
                    "dùng trang cá nhân khác",
                    "đăng nhập bằng tài khoản khác",
                    "dùng tài khoản khác",
                    "use another profile",
                    "log into another account"
                ];
                var all = document.querySelectorAll('button, div[role="button"], a, div[tabindex="0"], span');
                for (var i = 0; i < all.length; i++) {
                    var text = (all[i].innerText || all[i].textContent || '').trim().toLowerCase();
                    if (keywords.some(function(k) { return text.includes(k); })) {
                        var btn = all[i].closest('[role="button"]') || all[i].closest('button') || all[i].closest('a') || all[i];
                        btn.focus();
                        btn.click();
                        return true;
                    }
                }
                return false;
            """
            try:
                clicked_js = self.driver.execute_script(js_script)
                if clicked_js:
                    if callback:
                        callback("Phát hiện màn hình lưu nick; đã bấm 'Dùng trang cá nhân khác' qua JS.")
                    logger.info("JS clicked 'Dùng trang cá nhân khác'")
                    time.sleep(2.0)
                    return True
            except Exception:
                pass

            # 3. Quét các XPath định danh nút 'Dùng trang cá nhân khác'
            xpaths = getattr(LoginLocators, "SAVED_ACCOUNT_SWITCH_XPATHS", [])
            for xpath in xpaths:
                elems = self.safe_find_elements(By.XPATH, xpath)
                for el in elems:
                    try:
                        if el.is_displayed():
                            if callback:
                                callback("Phát hiện màn hình lưu nick; đang bấm 'Dùng trang cá nhân khác'...")
                            logger.info(f"Phát hiện nút chuyển tài khoản ({xpath}), đang click...")
                            time.sleep(1.0)
                            self.safe_click(el)
                            time.sleep(2.0)
                            return True
                    except Exception:
                        continue
        except Exception as e:
            logger.debug(f"handle_saved_account_screen error: {e}")
        return False

    def extract_2fa_code(self, twofa_seed: str) -> Optional[str]:
        """Tự động sinh mã 2FA qua TOTP hoặc gọi API 2fa.live."""
        if not twofa_seed:
            return None
        seed = str(twofa_seed).strip().replace(" ", "").upper()

        # Thử sinh mã cục bộ bằng pyotp
        try:
            code = generate_totp(seed)
            if code and len(code) == 6:
                return code
        except Exception:
            pass

        # Fallback gọi API 2fa.live
        try:
            r = requests.get(f"https://2fa.live/api/get-code/{seed}", timeout=8)
            if r.status_code == 200:
                data = r.json()
                code = data.get("code") or data.get("token")
                if code:
                    return str(code)
        except Exception:
            pass
        return None

    def login_with_credentials(
        self,
        uid: str,
        password: str,
        twofa_seed: Optional[str] = None,
        callback: Optional[Callable[[str], None]] = None,
    ) -> bool:
        """Đăng nhập bằng UID và Mật khẩu form login + Tự động điền 2FA nếu có như ở Module 02."""
        try:
            # 1. Thử tận dụng hàm ensure_logged_in của Module 02 đã được kiểm chứng hoạt động hoàn hảo
            try:
                from modules.module_02_account_manager.automation.login_flow import ensure_logged_in
                if callback:
                    callback(f"[{uid}] Đang kiểm tra và đăng nhập tài khoản theo chuẩn Module 02...")
                res = ensure_logged_in(
                    self.driver,
                    uid=uid,
                    password=password,
                    two_fa=twofa_seed,
                )
                if res.get("success"):
                    if callback:
                        callback(f"[{uid}] ✓ Đăng nhập Facebook thành công!")
                    return True
                else:
                    if callback and res.get("error"):
                        callback(f"[{uid}] Ghi chú login Module 02: {res.get('error')}")
            except Exception as e:
                logger.info(f"[{uid}] ensure_logged_in note: {e}, chuyển sang luồng đăng nhập trực tiếp...")

            # 2. Luồng đăng nhập trực tiếp (tự xử lý màn hình lưu nick + điền thông tin + 2FA)
            if callback:
                callback(f"[{uid}] Đang mở trang đăng nhập Facebook...")
            curr = (self.driver.current_url or "").lower()
            if "login.php" not in curr and "login" not in curr:
                self.driver.get("https://www.facebook.com/login.php")
                time.sleep(2.5)

            # Bấm "Dùng trang cá nhân khác" nếu màn hình lưu tài khoản xuất hiện
            self.handle_saved_account_screen(callback=callback)

            # Tìm ô email và mật khẩu với đa dạng locators
            email_el = None
            pass_el = None
            start_find = time.time()
            while time.time() - start_find < 8.0:
                for by, val in getattr(LoginLocators, "EMAIL_INPUT_SELECTORS", [(By.ID, "email"), (By.NAME, "email")]):
                    el = self.safe_find_element(by, val, timeout=1)
                    if el and el.is_displayed():
                        email_el = el
                        break
                for by, val in getattr(LoginLocators, "PASSWORD_INPUT_SELECTORS", [(By.ID, "pass"), (By.NAME, "pass")]):
                    el = self.safe_find_element(by, val, timeout=1)
                    if el and el.is_displayed():
                        pass_el = el
                        break
                if email_el and pass_el:
                    break
                # Nếu chưa thấy form, kiểm tra lại xem có nút "Dùng trang cá nhân khác" chưa bấm không
                if self.handle_saved_account_screen(callback=callback):
                    time.sleep(1.0)
                time.sleep(0.5)

            if not email_el or not pass_el:
                logger.warning(f"[{uid}] Không tìm thấy ô nhập email/pass sau khi xử lý trang login")
                return False

            if callback:
                callback(f"[{uid}] Đang điền tài khoản và mật khẩu...")
            try:
                email_el.clear()
            except Exception:
                pass
            email_el.send_keys(uid)
            time.sleep(random.uniform(0.3, 0.7))

            try:
                pass_el.clear()
            except Exception:
                pass
            pass_el.send_keys(password)
            time.sleep(random.uniform(0.4, 0.8))

            # Nhấn nút Đăng nhập
            clicked = False
            for by, val in getattr(LoginLocators, "LOGIN_BUTTON_SELECTORS", [(By.NAME, "login"), (By.XPATH, "//button[@type='submit']")]):
                btn = self.safe_find_element(by, val, timeout=1)
                if btn and btn.is_displayed():
                    try:
                        self.safe_click(btn)
                        clicked = True
                        break
                    except Exception:
                        pass
            if not clicked:
                pass_el.send_keys(Keys.ENTER)

            time.sleep(4.5)

            # Kiểm tra và xử lý 2FA nếu xuất hiện
            try:
                from modules.module_02_account_manager.automation.login_flow import _is_2fa_required, _handle_2fa
                if _is_2fa_required(self.driver) and twofa_seed:
                    if callback:
                        callback(f"[{uid}] Phát hiện xác thực 2FA, đang xử lý mã OTP...")
                    _handle_2fa(self.driver, twofa_seed)
            except Exception:
                pass

            curr_url = (self.driver.current_url or "").lower()
            if "checkpoint" in curr_url or "two_step" in curr_url:
                twofa_code = self.extract_2fa_code(twofa_seed) if twofa_seed else None
                if twofa_code:
                    if callback:
                        callback(f"[{uid}] Đang điền mã xác thực 2FA ({twofa_code})...")
                    code_box = self.safe_find_element(By.XPATH, LoginLocators.TWOFA_CODE_INPUT_XPATH, timeout=8)
                    if code_box:
                        try:
                            code_box.clear()
                        except Exception:
                            pass
                        code_box.send_keys(twofa_code)
                        time.sleep(1)
                        submit_btn = self.safe_find_element(By.XPATH, LoginLocators.TWOFA_SUBMIT_BUTTON_XPATH, timeout=4)
                        if submit_btn:
                            self.safe_click(submit_btn)
                        else:
                            code_box.send_keys(Keys.ENTER)
                        time.sleep(5)

            # Xử lý popups & chuyển về profile cá nhân nếu có
            try:
                from modules.module_02_account_manager.automation.login_flow import _handle_post_login_popups, ensure_personal_profile
                _handle_post_login_popups(self.driver)
                ensure_personal_profile(self.driver, uid)
            except Exception:
                pass

            # Đồng bộ cookie phiên mới vào DB nếu đã đăng nhập thành công
            if self.is_facebook_session_alive():
                try:
                    cookies = self.driver.get_cookies()
                    c_user = next((c["value"] for c in cookies if c.get("name") == "c_user"), None)
                    xs = next((c["value"] for c in cookies if c.get("name") == "xs"), None)
                    if c_user and xs:
                        fresh_cookie_str = "; ".join([f"{c['name']}={c['value']}" for c in cookies if c.get("name") and c.get("value")])
                        from modules.module_02_account_manager.database.connection import SessionLocal
                        from modules.module_02_account_manager.database.repository import AccountRepository as AccountRepo
                        with SessionLocal() as _db:
                            AccountRepo.update_cookies(_db, uid, fresh_cookie_str)
                            AccountRepo.update_login_status(_db, uid, "logged_in")
                        logger.info(f"[{uid}] Đã đồng bộ cookie phiên mới vào CSDL.")
                except Exception as sync_err:
                    logger.debug(f"[{uid}] Cookie sync note: {sync_err}")

            return self.is_facebook_session_alive()
        except Exception as e:
            logger.warning(f"login_with_credentials error for {uid}: {e}")
            return False

    def apply_facebook_support_data(self, account_record, hwid: str, callback: Optional[Callable[[str], None]] = None) -> bool:
        """
        Nạp toàn bộ dữ liệu hỗ trợ phiên của tài khoản Facebook:
          1. Nạp Cookie vào Chrome
          2. Nạp Token nếu có
          3. Đăng nhập Form bằng Password & 2FA giải mã từ HWID
        """
        uid = account_record.uid
        try:
            # 1. Thử nạp cookie trước
            cookie_str = account_record.cookie or ""
            if cookie_str:
                if callback:
                    callback(f"[{uid}] Đang nạp Cookie phiên Facebook...")
                self.driver.get("https://www.facebook.com/")
                time.sleep(2)

                cookies = parse_cookie_pairs(cookie_str)
                expiry = int(time.time()) + (90 * 24 * 60 * 60)
                for c in cookies:
                    try:
                        name, val = c.split("=", 1)
                        name = name.strip()
                        val = val.strip()
                        if not name or not val:
                            continue
                        self.driver.add_cookie({
                            "name": name,
                            "value": val,
                            "domain": ".facebook.com",
                            "path": "/",
                            "expiry": expiry,
                            "httpOnly": name in ("c_user", "xs"),
                            "secure": True,
                        })
                    except Exception:
                        pass

                self.driver.refresh()
                time.sleep(4)
                if self.is_facebook_session_alive():
                    if callback:
                        callback(f"[{uid}] ✓ Đăng nhập thành công bằng Cookie!")
                    return True

            # 2. Thử nạp token vào storage nếu có
            token = account_record.token or ""
            if token and len(token) > 20:
                if callback:
                    callback(f"[{uid}] Thử xác thực phiên qua Token...")
                js_inject = f"""
                try {{
                    localStorage.setItem('fbAccessToken', {json.dumps(token)});
                    sessionStorage.setItem('fbAccessToken', {json.dumps(token)});
                }} catch(e) {{}}
                """
                try:
                    self.driver.execute_script(js_inject)
                    self.driver.refresh()
                    time.sleep(3)
                    if self.is_facebook_session_alive():
                        if callback:
                            callback(f"[{uid}] ✓ Đăng nhập thành công qua Token!")
                        return True
                except Exception:
                    pass

            # 3. Thử đăng nhập bằng Mật khẩu + 2FA
            raw_password = account_record.password or ""
            plain_pwd = ""
            if raw_password:
                try:
                    plain_pwd = decrypt(raw_password, hwid)
                except Exception:
                    plain_pwd = raw_password

            plain_2fa = ""
            if account_record.two_fa:
                try:
                    plain_2fa = decrypt(account_record.two_fa, hwid)
                except Exception:
                    plain_2fa = account_record.two_fa

            if plain_pwd:
                if callback:
                    callback(f"[{uid}] Phiên cookie hết hạn, đăng nhập bằng Mật khẩu...")
                success = self.login_with_credentials(uid, plain_pwd, plain_2fa, callback=callback)
                if success:
                    if callback:
                        callback(f"[{uid}] ✓ Đăng nhập tài khoản thành công!")
                    return True

            return self.is_facebook_session_alive()
        except Exception as e:
            logger.error(f"apply_facebook_support_data error for {uid}: {e}")
            return False
