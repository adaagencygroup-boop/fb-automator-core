"""
seeding_flow.py
Automation core cho Module 8: Interaction Seeding (Page Follow, Profile Follow, Post React/Comment/Share).
Dựa trên kiến trúc FacebookBot & FarmWorker ổn định, hỗ trợ:
  1. Kiểm tra session Facebook còn sống không
  2. Nạp cookie / token / đăng nhập mật khẩu & 2FA tự động khi cần
  3. Click JS chống che, cuộn trang tự nhiên và delay an toàn
  4. Thực hiện tương tác Follow, React, Comment, Share thật trên Facebook
"""
import time
import random
import json
import logging
from typing import Optional, Callable, Dict, Any, List

import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver import ActionChains
from selenium.common.exceptions import (
    TimeoutException, NoSuchElementException, ElementClickInterceptedException
)

from app.database.encryption import decrypt
from app.utils.otp_generator import generate_totp

logger = logging.getLogger(__name__)


def parse_cookie_pairs(cookie_str: str) -> List[str]:
    """Tách cookie thành danh sách cặp name=value từ định dạng pipe (|) hoặc chấm phẩy (;)."""
    if not cookie_str:
        return []
    delimiter = '|' if '|' in cookie_str else ';'
    return [part.strip() for part in cookie_str.split(delimiter) if '=' in part]

class FacebookSeedingBot:
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
        """Click phần tử: hỗ trợ click đa tầng (tọa độ elementFromPoint + Pointer/Mouse Events + ActionChains + Native)."""
        if not element:
            return False
        try:
            self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'instant', block: 'center'});", element)
            time.sleep(0.3)
        except Exception:
            pass

        # 1. Kích hoạt tọa độ bằng document.elementFromPoint (xử lý triệt để lớp overlay .x1ey2m1c)
        try:
            self.driver.execute_script("""
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
                hitEl.click();
                target.click();
            """, element)
        except Exception:
            pass

        # 2. Thử Selenium ActionChains
        try:
            ActionChains(self.driver).move_to_element(element).click().perform()
        except Exception:
            pass

        # 3. Thử direct element.click()
        try:
            element.click()
        except Exception:
            pass

        return True

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

    # ─────────────────────────────────────────────────────────────
    # KIỂM TRA PHIÊN & ĐĂNG NHẬP FACEBOOK
    # ─────────────────────────────────────────────────────────────
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
            login_form_markers = [
                (By.ID, "email"),
                (By.ID, "pass"),
                (By.NAME, "login"),
                (By.XPATH, "//form[contains(@action, 'login')]"),
            ]
            for locator in login_form_markers:
                try:
                    found = self.safe_find_element(locator[0], locator[1], timeout=1)
                    if found and found.is_displayed():
                        return False
                except Exception:
                    pass

            # Dấu hiệu đã đăng nhập thành công
            indicators = [
                (By.XPATH, "//div[@role='feed']"),
                (By.XPATH, "//a[@aria-label='Your profile' or @aria-label='Trang cá nhân của bạn']"),
                (By.XPATH, "//a[contains(@href, '/me/')]"),
                (By.XPATH, "//a[@aria-label='Notifications' or @aria-label='Thông báo']"),
                (By.XPATH, "//div[@aria-label='Tạo' or @aria-label='Create']"),
                (By.XPATH, "//*[@data-testid='feed']"),
            ]
            for by, val in indicators:
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

    def login_with_credentials(self, uid: str, password: str, twofa_seed: Optional[str] = None, callback: Optional[Callable[[str], None]] = None) -> bool:
        """Đăng nhập bằng UID và Mật khẩu form login + Tự động điền 2FA nếu có."""
        try:
            if callback:
                callback(f"[{uid}] Đang đăng nhập bằng tài khoản & mật khẩu...")
            self.driver.get("https://www.facebook.com/login.php")
            time.sleep(3)

            email_el = self.safe_find_element(By.ID, "email", timeout=4) or self.safe_find_element(By.NAME, "email", timeout=3)
            pass_el = self.safe_find_element(By.ID, "pass", timeout=4) or self.safe_find_element(By.NAME, "pass", timeout=3)

            if not email_el or not pass_el:
                return False

            email_el.clear()
            email_el.send_keys(uid)
            time.sleep(0.5)

            pass_el.clear()
            pass_el.send_keys(password)
            time.sleep(0.5)

            login_btn = self.safe_find_element(By.NAME, "login", timeout=3) or self.safe_find_element(By.XPATH, "//button[@type='submit']", timeout=3)
            if login_btn:
                self.safe_click(login_btn)
            else:
                pass_el.send_keys(Keys.ENTER)

            time.sleep(5)

            # Kiểm tra nếu hỏi 2FA
            if "checkpoint" in self.driver.current_url.lower() or "two_step" in self.driver.current_url.lower():
                twofa_code = self.extract_2fa_code(twofa_seed) if twofa_seed else None
                if twofa_code:
                    if callback:
                        callback(f"[{uid}] Phát hiện 2FA, đang điền mã xác thực...")
                    code_box = self.safe_find_element(By.XPATH, "//input[@type='text' and (@name='approvals_code' or contains(@placeholder, 'code') or contains(@aria-label, 'code'))]", timeout=8)
                    if code_box:
                        code_box.send_keys(twofa_code)
                        time.sleep(1)
                        submit_btn = self.safe_find_element(By.XPATH, "//button[@type='submit' or contains(., 'Tiếp tục') or contains(., 'Continue') or contains(., 'Submit')]", timeout=4)
                        if submit_btn:
                            self.safe_click(submit_btn)
                        else:
                            code_box.send_keys(Keys.ENTER)
                        time.sleep(6)

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

    # ─────────────────────────────────────────────────────────────
    # 1. ACTION: FOLLOW / LIKE TRANG & TRANG CÁ NHÂN
    # ─────────────────────────────────────────────────────────────
    def execute_follow(
        self,
        target_url: str,
        target_type: str = "PAGE",
        account_name: Optional[str] = None,
        callback: Optional[Callable[[str], None]] = None
    ) -> tuple[bool, str]:
        """Thực hiện tương tác Follow Fanpage hoặc Follow/Kết bạn Trang cá nhân trên máy thật."""
        try:
            acc_label = f"Tài khoản {account_name}" if account_name else "Tài khoản"
            if callback:
                callback(f"🌐 [{acc_label}] Điều hướng đến: {target_url}")
            self.driver.get(target_url)
            self.random_sleep(3.5, 5.5)

            if "login" in (self.driver.current_url or "").lower():
                return False, f"{acc_label} chưa đăng nhập Facebook hoặc cookie đã hết hạn"

            # Đảm bảo trình duyệt luôn ở đỉnh trang để quét khu vực Header
            self.driver.execute_script("window.scrollTo(0, 0);")
            self.random_sleep(1.2, 2.0)

            # Helper click toàn diện kích hoạt mọi tầng DOM và React Event của Facebook Comet
            def perform_robust_click(elem) -> bool:
                if not elem:
                    return False
                try:
                    self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'instant', block: 'center'});", elem)
                    time.sleep(0.3)
                except Exception:
                    pass

                try:
                    self.driver.execute_script("""
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
                        hitEl.click();
                        target.click();
                    """, elem)
                except Exception as e:
                    logger.debug(f"JS coordinate click error: {e}")

                try:
                    ActionChains(self.driver).move_to_element(elem).click().perform()
                except Exception:
                    pass

                try:
                    elem.click()
                except Exception:
                    pass

                return True

            # Helper kiểm tra xem trạng thái nút đã thật sự thay đổi chưa
            def check_state_after_click(original_action: str) -> bool:
                """Xác minh xem Facebook đã ghi nhận thay đổi chưa sau khi bấm."""
                time.sleep(1.8)
                return bool(self.driver.execute_script("""
                    const action = arguments[0]; // 'FOLLOW' hoặc 'ADD_FRIEND'
                    const spans = Array.from(document.querySelectorAll('span, div[role="button"], a[role="button"], div.x1i10hfl'));
                    
                    if (action === 'FOLLOW') {
                        // 1. Kiểm tra có xuất hiện 'Following' / 'Đang theo dõi' không
                        const isFollowing = spans.some(s => {
                            const t = (s.textContent || '').trim().toLowerCase();
                            const aria = (s.getAttribute('aria-label') || '').trim().toLowerCase();
                            if (t === 'following' || t === 'đang theo dõi' || aria === 'following' || aria === 'đang theo dõi') {
                                const rect = s.getBoundingClientRect();
                                return rect.top >= 60 && rect.top < 850 && rect.width > 0;
                            }
                            return false;
                        });
                        if (isFollowing) return true;
                        
                        // 2. Hoặc nút 'Follow' / 'Theo dõi' cũ đã biến mất
                        const stillHasFollow = spans.some(s => {
                            const t = (s.textContent || '').trim().toLowerCase();
                            if (t === 'follow' || t === 'theo dõi') {
                                const btn = s.closest('div[role="button"]') || s.closest('.x1i10hfl');
                                if (btn) {
                                    const rect = btn.getBoundingClientRect();
                                    return rect.top >= 60 && rect.top < 850 && rect.width > 20;
                                }
                            }
                            return false;
                        });
                        return !stillHasFollow;
                    } else if (action === 'ADD_FRIEND') {
                        const isSent = spans.some(s => {
                            const t = (s.textContent || '').trim().toLowerCase();
                            if (t.includes('hủy lời mời') || t.includes('cancel request') || t.includes('request sent') || t.includes('đã gửi lời mời')) {
                                const rect = s.getBoundingClientRect();
                                return rect.top >= 60 && rect.top < 850 && rect.width > 0;
                            }
                            return false;
                        });
                        if (isSent) return true;
                        
                        const stillHasAdd = spans.some(s => {
                            const t = (s.textContent || '').trim().toLowerCase();
                            if (t === 'add friend' || t === 'thêm bạn bè') {
                                const btn = s.closest('div[role="button"]') || s.closest('.x1i10hfl');
                                if (btn) {
                                    const rect = btn.getBoundingClientRect();
                                    return rect.top >= 60 && rect.top < 850 && rect.width > 20;
                                }
                            }
                            return false;
                        });
                        return !stillHasAdd;
                    }
                    return true;
                """, original_action))

            # ─── BƯỚC 0: KIỂM TRA XEM ĐÃ FOLLOW PAGE / KẾT NỐI TỪ TRƯỚC CHƯA ───
            if callback:
                callback(f"🔍 [{acc_label}] Đang kiểm tra xem tài khoản đã follow trang này chưa...")

            already_check = self.driver.execute_script("""
                function isNavOrTab(el) {
                    if (!el) return true;
                    if (el.closest('[role="tab"]') || el.closest('[role="tablist"]')) return true;
                    if (el.closest('nav') || el.closest('[role="navigation"]')) return true;
                    if (el.closest('[role="banner"]')) return true;
                    const href = el.getAttribute('href') || (el.querySelector('a') ? el.querySelector('a').getAttribute('href') : '') || '';
                    if (href.includes('/friends') || href.includes('/about') || href.includes('/photos') || href.includes('/videos')) return true;
                    return false;
                }
                const spans = Array.from(document.querySelectorAll('span, div[role="button"], a[role="button"], div.x1i10hfl'));
                for (const el of spans) {
                    if (isNavOrTab(el)) continue;
                    const rect = el.getBoundingClientRect();
                    if (rect.top < 60 || rect.top >= 850 || rect.width <= 15) continue;
                    
                    const text = (el.textContent || '').trim().toLowerCase();
                    const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
                    
                    if (text === 'following' || text === 'đang theo dõi' || aria === 'following' || aria === 'đang theo dõi') {
                        return { already: true, reason: 'đang theo dõi' };
                    }
                    if (text === 'liked' || text === 'đã thích' || aria === 'liked' || aria === 'đã thích') {
                        return { already: true, reason: 'đã thích' };
                    }
                    if (text === 'friends' || text === 'bạn bè' || text.includes('hủy lời mời') || text.includes('cancel request') || text.includes('request sent') || text.includes('đã gửi lời mời')) {
                        return { already: true, reason: 'bạn bè / đã gửi lời mời' };
                    }
                }
                return { already: false };
            """)

            if already_check and already_check.get("already"):
                reason = already_check.get("reason", "đang theo dõi")
                msg = f"{acc_label} đã follow page này rồi" if target_type.upper() == "PAGE" else f"{acc_label} đã follow trang cá nhân này rồi"
                if callback:
                    callback(f"ℹ️ {msg}")
                return True, msg

            # ─── NẾU LÀ SEEDING FANPAGE (TARGET_TYPE == 'PAGE') ───
            if target_type.upper() == "PAGE":
                if callback:
                    callback(f"🔍 [{acc_label}] Chưa follow. Đang tìm nút Follow trên Fanpage...")

                page_buttons = self.driver.execute_script("""
                    function isNavOrTab(el) {
                        if (!el) return true;
                        if (el.closest('[role="tab"]') || el.closest('[role="tablist"]')) return true;
                        if (el.closest('nav') || el.closest('[role="navigation"]')) return true;
                        if (el.closest('[role="banner"]')) return true;
                        const href = el.getAttribute('href') || (el.querySelector('a') ? el.querySelector('a').getAttribute('href') : '') || '';
                        if (href.includes('/friends') || href.includes('/about') || href.includes('/photos') || href.includes('/videos')) return true;
                        return false;
                    }

                    let followBtn = null;
                    let likeBtn = null;
                    let moreBtn = null;

                    const spans = Array.from(document.querySelectorAll('span'));
                    for (const sp of spans) {
                        const t = (sp.textContent || '').trim().toLowerCase();
                        if (!['follow', 'theo dõi', 'like', 'thích'].includes(t)) continue;

                        const btn = sp.closest('div[role="button"]') ||
                                    sp.closest('a[role="button"]') ||
                                    sp.closest('[role="button"]') ||
                                    sp.closest('.x1i10hfl');
                        if (!btn || isNavOrTab(btn)) continue;

                        const rect = btn.getBoundingClientRect();
                        if (rect.top < 60 || rect.top >= 850 || rect.width <= 20 || rect.height <= 15) continue;

                        if (t === 'follow' || t === 'theo dõi') {
                            if (!followBtn) followBtn = btn;
                        } else if (t === 'like' || t === 'thích') {
                            if (!likeBtn) likeBtn = btn;
                        }
                    }

                    // Quét icon đặc thù nút Follow của Facebook (nSurzCxCD4K)
                    if (!followBtn) {
                        const followImgs = Array.from(document.querySelectorAll('img')).filter(img => (img.src || '').includes('nSurzCxCD4K'));
                        for (const img of followImgs) {
                            const btn = img.closest('div[role="button"]') || img.closest('[role="button"]') || img.closest('.x1i10hfl');
                            if (btn && !isNavOrTab(btn)) {
                                const rect = btn.getBoundingClientRect();
                                if (rect.top >= 60 && rect.top < 850 && rect.width > 20) {
                                    followBtn = btn;
                                    break;
                                }
                            }
                        }
                    }

                    // Quét aria-label Follow
                    if (!followBtn) {
                        const afs = Array.from(document.querySelectorAll('[aria-label="Theo dõi" i], [aria-label="Follow" i]'));
                        for (const af of afs) {
                            if (isNavOrTab(af)) continue;
                            const rect = af.getBoundingClientRect();
                            if (rect.top >= 60 && rect.top < 850 && rect.width > 20) {
                                followBtn = af;
                                break;
                            }
                        }
                    }

                    // Quét menu '...'
                    const allBtns = Array.from(document.querySelectorAll('div[role="button"]'));
                    for (const b of allBtns) {
                        if (isNavOrTab(b)) continue;
                        const a = (b.getAttribute('aria-label') || '').toLowerCase();
                        const hasSvg = b.querySelector('svg') !== null;
                        const rect = b.getBoundingClientRect();
                        if (rect.top >= 60 && rect.top < 850 && rect.width > 20 && rect.height > 15) {
                            if (a.includes('xem thêm') || a.includes('more') || (hasSvg && (a.includes('tùy chọn') || a.includes('options') || a.length < 5))) {
                                moreBtn = b;
                                break;
                            }
                        }
                    }

                    return { followBtn: followBtn, likeBtn: likeBtn, moreBtn: moreBtn };
                """)

                page_follow_btn = page_buttons.get("followBtn") if page_buttons else None
                page_like_btn = page_buttons.get("likeBtn") if page_buttons else None
                page_more_btn = page_buttons.get("moreBtn") if page_buttons else None

                # 1. Bấm nút Follow trực tiếp
                if page_follow_btn:
                    if callback:
                        callback(f"🎯 [{acc_label}] Đã tìm thấy nút Follow trên Page, đang bấm...")
                    perform_robust_click(page_follow_btn)
                    if check_state_after_click("FOLLOW"):
                        msg = f"{acc_label} đã bấm Follow thành công"
                        if callback:
                            callback(f"✓ {msg}!")
                        return True, msg
                    else:
                        perform_robust_click(page_follow_btn)
                        if check_state_after_click("FOLLOW"):
                            msg = f"{acc_label} đã bấm Follow thành công"
                            if callback:
                                callback(f"✓ {msg}!")
                            return True, msg

                # 2. Tìm trong menu '...' nếu chưa thấy Follow ngoài header
                if page_more_btn:
                    if callback:
                        callback(f"🔍 [{acc_label}] Mở menu '...' tìm nút Follow...")
                    perform_robust_click(page_more_btn)
                    self.random_sleep(1.2, 1.8)

                    menu_follow = self.driver.execute_script("""
                        const items = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="button"]')).filter(m => {
                            const t = (m.textContent || '').trim().toLowerCase();
                            return t === 'theo dõi' || t === 'follow' || t.includes('theo dõi') || t.includes('follow');
                        });
                        return items.length > 0 ? items[0] : null;
                    """)
                    if menu_follow:
                        perform_robust_click(menu_follow)
                        self.random_sleep(1.5, 2.5)
                        msg = f"{acc_label} đã bấm Follow qua menu '...' thành công"
                        if callback:
                            callback(f"✓ {msg}!")
                        return True, msg
                    else:
                        try:
                            ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
                        except Exception:
                            pass

                # 3. Fallback nút Like nếu là classic page
                if page_like_btn:
                    if callback:
                        callback(f"🎯 [{acc_label}] Đang bấm nút Thích (Like) trên Page...")
                    perform_robust_click(page_like_btn)
                    self.random_sleep(2.0, 3.0)
                    msg = f"{acc_label} đã bấm Thích trang thành công"
                    if callback:
                        callback(f"✓ {msg}!")
                    return True, msg

                return False, f"{acc_label}: Không tìm thấy nút Follow trên page"

            # ─── NẾU LÀ SEEDING TRANG CÁ NHÂN (TARGET_TYPE == 'PROFILE') ───
            if callback:
                callback(f"🔍 [{acc_label}] Đang quét các nút hành động trên Trang cá nhân...")

            buttons_info = self.driver.execute_script("""
                window.scrollTo(0, 0);
                let followBtn = null;
                let moreBtn = null;

                function isNavTabLink(el) {
                    if (!el) return true;
                    const href = el.getAttribute('href') || (el.querySelector('a') ? el.querySelector('a').getAttribute('href') : '') || '';
                    if (href.includes('/friends') || href.includes('/about') || href.includes('/photos') || href.includes('/videos') || href.includes('/followers') || href.includes('/following')) return true;
                    return false;
                }

                // 1. Quét nút Follow ở ngoài Header
                const spans = Array.from(document.querySelectorAll('span'));
                for (const sp of spans) {
                    const t = (sp.textContent || '').trim().toLowerCase();
                    if (t !== 'follow' && t !== 'theo dõi') continue;

                    const btn = sp.closest('div[role="button"]') ||
                                sp.closest('a[role="button"]') ||
                                sp.closest('[role="button"]') ||
                                sp.closest('.x1i10hfl');
                    if (!btn || isNavTabLink(btn)) continue;
                    if (btn.closest('[role="tab"]') && btn.getAttribute('href')) continue;

                    const rect = btn.getBoundingClientRect();
                    if (rect.top >= 60 && rect.top < 850 && rect.width > 20 && rect.height > 15) {
                        followBtn = btn;
                        break;
                    }
                }

                if (!followBtn) {
                    const afs = Array.from(document.querySelectorAll('[aria-label="Theo dõi" i], [aria-label="Follow" i]'));
                    for (const af of afs) {
                        if (isNavTabLink(af)) continue;
                        const rect = af.getBoundingClientRect();
                        if (rect.top >= 60 && rect.top < 850 && rect.width > 20) {
                            followBtn = af;
                            break;
                        }
                    }
                }

                // 2. Tìm nút 3 chấm (...) trong khu vực Header Profile
                // Nhận diện theo SVG đặc trưng của Facebook: viewBox="0 0 24 24" với 3 circle cx="12", cx="19.5", cx="4.5"
                const allSvgs = Array.from(document.querySelectorAll('svg'));
                for (const svg of allSvgs) {
                    const circles = Array.from(svg.querySelectorAll('circle'));
                    if (circles.length === 3) {
                        const cxs = circles.map(c => (c.getAttribute('cx') || '').trim());
                        if (cxs.includes('12') && (cxs.includes('19.5') || cxs.includes('4.5'))) {
                            const clickable = svg.closest('div[role="button"]') ||
                                              svg.closest('a[role="button"]') ||
                                              svg.closest('[role="button"]') ||
                                              svg.closest('.x1i10hfl') ||
                                              svg.closest('div[tabindex="0"]') ||
                                              svg.closest('.html-div') ||
                                              svg.parentElement;
                            if (clickable) {
                                const rect = clickable.getBoundingClientRect();
                                if (rect.top >= 60 && rect.top < 850 && rect.width >= 10 && rect.height >= 10) {
                                    if (!clickable.closest('[role="article"]') && !clickable.closest('[role="feed"]')) {
                                        moreBtn = clickable;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                // Dự phòng: Tìm nút aria-label xem thêm / tùy chọn / options trong Header
                if (!moreBtn) {
                    const allBtns = Array.from(document.querySelectorAll('div[role="button"], a[role="button"], div.x1i10hfl'));
                    for (const b of allBtns) {
                        const a = (b.getAttribute('aria-label') || '').toLowerCase();
                        const hasSvg = b.querySelector('svg') !== null;
                        const rect = b.getBoundingClientRect();
                        if (rect.top >= 60 && rect.top < 850 && rect.width >= 15 && rect.height >= 15) {
                            if (!b.closest('[role="article"]') && !b.closest('[role="feed"]')) {
                                if (a.includes('xem thêm') || a.includes('see options') || a.includes('tùy chọn') || a.includes('options') || a.includes('more') || (hasSvg && a.length === 0 && rect.width < 50)) {
                                    moreBtn = b;
                                    break;
                                }
                            }
                        }
                    }
                }

                return {
                    followBtn: followBtn,
                    moreBtn: moreBtn
                };
            """)

            follow_btn = buttons_info.get("followBtn") if buttons_info else None
            more_btn = buttons_info.get("moreBtn") if buttons_info else None

            # ── BƯỚC 1: Nếu có nút Follow ở ngoài Header thì bấm trực tiếp ──
            if follow_btn:
                if callback:
                    callback(f"🎯 [{acc_label}] Tìm thấy nút Theo dõi (Follow) trên header Trang cá nhân, đang bấm...")
                perform_robust_click(follow_btn)
                if check_state_after_click("FOLLOW"):
                    msg = f"{acc_label} đã bấm Theo dõi thành công"
                    if callback:
                        callback(f"✓ {msg}!")
                    return True, msg
                else:
                    perform_robust_click(follow_btn)
                    if check_state_after_click("FOLLOW"):
                        msg = f"{acc_label} đã bấm Theo dõi thành công"
                        if callback:
                            callback(f"✓ {msg}!")
                        return True, msg

            # ── BƯỚC 2: Nếu KHÔNG hiện nút Follow ở ngoài -> Bấm nút 3 chấm (...) ──
            if more_btn:
                if callback:
                    callback(f"🔍 [{acc_label}] Không thấy nút Follow ở ngoài, đang bấm nút 3 chấm (...) để kiểm tra...")
                perform_robust_click(more_btn)
                self.random_sleep(1.5, 2.2)

                # Quét menu popup xem có nút Follow không
                menu_scan_result = self.driver.execute_script("""
                    const allItems = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="menu"] div[role="button"], div[role="dialog"] div[role="button"], div.x1i10hfl, span'));
                    let followItem = null;
                    let alreadyFollowing = false;

                    for (const el of allItems) {
                        const t = (el.textContent || '').trim().toLowerCase();
                        if (t === 'unfollow' || t === 'bỏ theo dõi' || t === 'following' || t === 'đang theo dõi') {
                            alreadyFollowing = true;
                            break;
                        }
                        if (t === 'follow' || t === 'theo dõi') {
                            const clickable = el.closest('div[role="menuitem"]') ||
                                              el.closest('div[role="button"]') ||
                                              el.closest('a[role="button"]') ||
                                              el.closest('.x1i10hfl') ||
                                              el.closest('li') ||
                                              el;
                            const rect = clickable.getBoundingClientRect();
                            if (rect.width > 15 && rect.height > 10) {
                                followItem = clickable;
                                break;
                            }
                        }
                    }

                    return {
                        followItem: followItem,
                        alreadyFollowing: alreadyFollowing
                    };
                """)

                already_following = menu_scan_result.get("alreadyFollowing") if menu_scan_result else False
                menu_follow_item = menu_scan_result.get("followItem") if menu_scan_result else None

                if already_following:
                    try:
                        ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
                    except Exception:
                        pass
                    msg = f"{acc_label} đã follow trang cá nhân này rồi"
                    if callback:
                        callback(f"ℹ️ {msg}")
                    return True, msg

                if menu_follow_item:
                    if callback:
                        callback(f"🎯 [{acc_label}] Đã tìm thấy nút Follow trong menu 3 chấm, đang bấm...")
                    perform_robust_click(menu_follow_item)
                    self.random_sleep(2.0, 3.0)
                    msg = f"{acc_label} đã bấm Follow qua menu 3 chấm thành công"
                    if callback:
                        callback(f"✓ {msg}!")
                    return True, msg
                else:
                    try:
                        ActionChains(self.driver).send_keys(Keys.ESCAPE).perform()
                    except Exception:
                        pass
                    if callback:
                        callback(f"⚠️ [{acc_label}] Trong menu 3 chấm không có nút Follow!")

            # ── BƯỚC 3: Không có nút Follow ở ngoài lẫn trong menu -> Thoát và báo lỗi ──
            fail_msg = f"{acc_label}: Không tìm thấy nút Follow trên trang cá nhân"
            if callback:
                callback(f"❌ {fail_msg}")
            return False, fail_msg
        except Exception as e:
            logger.error(f"Error in execute_follow: {e}")
            return False, f"{acc_label} gặp lỗi: {str(e)[:80]}"

    # ─────────────────────────────────────────────────────────────
    # 2. ACTION: REACT (LIKE / THẢ CẢM XÚC BÀI VIẾT)
    # ─────────────────────────────────────────────────────────────
    def execute_react(self, target_url: str, reaction_type: Optional[str] = "LIKE", callback: Optional[Callable[[str], None]] = None) -> tuple[bool, str]:
        """Thực hiện thả cảm xúc (Like / Love / Care / Haha / Wow / Sad / Angry) trên bài viết ĐÚNG 1 LẦN DUY NHẤT."""
        try:
            # 1. Chuẩn hóa loại cảm xúc và thông tin tương ứng
            raw_type = (reaction_type or "LIKE").upper().strip()
            reaction_config = {
                "LIKE": {"vn": "Thích", "labels": ["Thích", "Like"], "emoji": "👍"},
                "LOVE": {"vn": "Yêu thích", "labels": ["Yêu thích", "Love"], "emoji": "❤️"},
                "CARE": {"vn": "Thương thương", "labels": ["Thương thương", "Care"], "emoji": "🥰"},
                "HAHA": {"vn": "Haha", "labels": ["Haha"], "emoji": "😆"},
                "WOW": {"vn": "Wow", "labels": ["Wow"], "emoji": "😮"},
                "SAD": {"vn": "Buồn", "labels": ["Buồn", "Sad"], "emoji": "😢"},
                "ANGRY": {"vn": "Phẫn nộ", "labels": ["Phẫn nộ", "Angry"], "emoji": "😡"},
            }
            if raw_type in ("THÍCH", "LIKE"):
                clean_reaction = "LIKE"
            elif raw_type in ("YÊU THÍCH", "LOVE"):
                clean_reaction = "LOVE"
            elif raw_type in ("THƯƠNG THƯƠNG", "CARE"):
                clean_reaction = "CARE"
            elif raw_type in ("HAHA",):
                clean_reaction = "HAHA"
            elif raw_type in ("WOW",):
                clean_reaction = "WOW"
            elif raw_type in ("BUỒN", "SAD"):
                clean_reaction = "SAD"
            elif raw_type in ("PHẪN NỘ", "ANGRY"):
                clean_reaction = "ANGRY"
            else:
                clean_reaction = "LIKE"

            r_info = reaction_config.get(clean_reaction, reaction_config["LIKE"])
            vn_name = r_info["vn"]
            target_labels = r_info["labels"]
            emoji = r_info["emoji"]

            if callback:
                callback(f"🌐 Mở bài viết: {target_url}")
            current_url = self.driver.current_url or ""
            target_clean = target_url.split("?")[0].rstrip("/")
            if not current_url or target_clean not in current_url:
                self.driver.get(target_url)
                self.random_sleep(4.5, 6.5)

            if "login" in (self.driver.current_url or "").lower():
                return False, "Chưa đăng nhập Facebook"

            # Đợi modal bài viết hoặc trang hiển thị ổn định
            self.random_sleep(1.5, 2.5)

            # Hàm JS kiểm tra trạng thái Liked / Reacted CỦA NÚT LIKE BÀI VIẾT (tránh nhầm với comment/nội dung)
            labels_json = json.dumps(target_labels)
            js_is_reacted = f"""
                const modal = document.querySelector('div[role="dialog"]');
                const root = modal || document;
                const targetLabels = {labels_json};

                // Tìm chính xác nút Like của bài viết
                const marker = root.querySelector('div[data-ad-rendering-role="like_button"]');
                let btn = null;
                if (marker) {{
                    btn = marker.closest('div[role="button"]') || marker.parentElement.parentElement || marker.parentElement;
                }}
                if (!btn) {{
                    const candidates = Array.from(root.querySelectorAll('div[role="button"], div.x1i10hfl')).filter(el => {{
                        if (el.closest('ul') || el.closest('form')) return false;
                        const a = (el.getAttribute('aria-label') || '').toLowerCase();
                        return a.includes('thích') || a.includes('like') || a.includes('bày tỏ cảm xúc');
                    }});
                    if (candidates.length > 0) btn = candidates[0];
                }}
                if (!btn) return false;

                const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                const pressed = btn.getAttribute('aria-pressed');
                if (pressed === 'true') return true;

                // Nếu aria-label chuyển sang trạng thái đã chọn (Gỡ thích, Gỡ yêu thích, Unlike, Remove reaction...)
                if (aria.includes('gỡ') || aria.includes('unlike') || aria.includes('bỏ thích') || aria.includes('remove')) {{
                    return true;
                }}

                // Kiểm tra màu sắc nút (khi đã thả cảm xúc thì nút có màu riêng: xanh, đỏ, vàng... không phải xám mặc định)
                const comp = window.getComputedStyle(btn);
                const col = comp.color || '';
                const isColored = col && !col.includes('101, 103, 107') && !col.includes('113, 115, 118') && 
                                  !col.includes('108, 115, 122') && !col.includes('0, 0, 0') && !col.includes('255, 255, 255');

                const text = (btn.textContent || '').trim().toLowerCase();
                if (isColored && targetLabels.some(lbl => text === lbl.toLowerCase() || aria.includes(lbl.toLowerCase()))) {{
                    return true;
                }}

                return false;
            """

            # 2. Kiểm tra xem bài viết đã được đúng cảm xúc này từ trước chưa
            already_reacted = self.driver.execute_script(js_is_reacted)
            if already_reacted:
                if callback:
                    callback(f"✓ Bài viết này đã được '{vn_name}' từ trước (tránh bấm lại để không bị hủy).")
                return True, f"Đã {vn_name} từ trước"

            if callback:
                callback(f"{emoji} Đang thực hiện thả cảm xúc '{vn_name}' vào bài viết...")

            # 3. Phân nhánh: Nếu chỉ là LIKE thông thường, ưu tiên click trực tiếp nút Like
            if clean_reaction == "LIKE":
                clicked_direct = self.driver.execute_script("""
                    const modal = document.querySelector('div[role="dialog"]');
                    const root = modal || document;

                    const marker = root.querySelector('div[data-ad-rendering-role="like_button"]');
                    let target = null;
                    if (marker) {
                        target = marker.closest('div[role="button"]') || marker.closest('div.x1i10hfl');
                        if (!target && marker.parentElement && marker.parentElement.parentElement) {
                            target = marker.parentElement.parentElement.querySelector('div[role="button"], div.x1i10hfl');
                        }
                    }
                    if (!target) {
                        const ariaBtns = Array.from(root.querySelectorAll('div[role="button"], div.x1i10hfl, div[tabindex="0"]')).filter(el => {
                            if (el.closest('ul') || el.closest('form')) return false;
                            const a = (el.getAttribute('aria-label') || '').toLowerCase().trim();
                            return a === 'like' || a === 'thích' || a === 'react' || a === 'thích bài viết';
                        });
                        if (ariaBtns.length > 0) target = ariaBtns[0];
                    }
                    if (!target && marker && marker.parentElement) target = marker.parentElement;

                    if (!target) return false;

                    try {
                        const r = target.getBoundingClientRect();
                        if (r.top < 0 || r.bottom > window.innerHeight) {
                            target.scrollIntoView({ behavior: 'instant', block: 'center' });
                        }
                    } catch(e){}

                    const rect = target.getBoundingClientRect();
                    const x = rect.left + rect.width / 2;
                    const y = rect.top + rect.height / 2;
                    const hit = document.elementFromPoint(x, y) || target;
                    hit.focus();

                    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                        const isPointer = type.startsWith('pointer');
                        const evt = isPointer
                            ? new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 })
                            : new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 });
                        hit.dispatchEvent(evt);
                    });
                    try { hit.click(); } catch(e){}
                    return true;
                """)

                self.random_sleep(2.0, 3.0)
                if self.driver.execute_script(js_is_reacted):
                    if callback:
                        callback(f"✓ Đã bấm {vn_name} bài viết thành công!")
                    return True, f"Thành công ({vn_name})"

            # 4. THẢ CẢM XÚC NÂNG CAO (LOVE, CARE, HAHA, WOW, SAD, ANGRY hoặc fallback LIKE):
            # Xử lý HOVER vào container nút Like do người dùng cung cấp:
            # <div class="x9f619..."><span ...><i ...></i></span><div data-ad-rendering-role="like_button"></div></div>
            if callback:
                callback(f"✨ Rê chuột (hover) vào nút Like để bật bảng cảm xúc cho '{vn_name}'...")

            # XPath kiểm tra xem khay cảm xúc đã hiển thị trên màn hình chưa
            # Đúng theo XPath người dùng: //div[@aria-label='Yêu thích' or @aria-label='Haha' or @aria-label='Thương thương' or @aria-label='Care' or @aria-label='Love']
            all_reactions_xpath = (
                "//div[@aria-label='Yêu thích' or @aria-label='Haha' or "
                "@aria-label='Thương thương' or @aria-label='Care' or "
                "@aria-label='Love' or @aria-label='Wow' or "
                "@aria-label='Buồn' or @aria-label='Sad' or "
                "@aria-label='Phẫn nộ' or @aria-label='Angry' or "
                "@aria-label='Thích' or @aria-label='Like']"
            )

            def is_dock_open() -> bool:
                items = self.safe_find_elements(By.XPATH, all_reactions_xpath)
                for it in items:
                    try:
                        if it.is_displayed() and it.size.get('width', 0) > 10:
                            return True
                    except Exception:
                        pass
                return False

            # Danh sách XPath phần tử Like cần HOVER (chính xác theo element người dùng cung cấp)
            hover_target_xpaths = [
                # 1. Thẻ div cha chứa trực tiếp <div data-ad-rendering-role="like_button"> và span icon (element chính xác của user)
                "//div[@role='dialog']//div[@data-ad-rendering-role='like_button']/parent::div",
                "//div[@data-ad-rendering-role='like_button']/parent::div",
                # 2. Thẻ div role=button bao ngoài
                "//div[@role='dialog']//div[@data-ad-rendering-role='like_button']/ancestor::div[@role='button'][1]",
                "//div[@data-ad-rendering-role='like_button']/ancestor::div[@role='button'][1]",
                # 3. Thẻ span chứa icon like
                "//div[@role='dialog']//div[@data-ad-rendering-role='like_button']/preceding-sibling::span[1]",
                "//div[@data-ad-rendering-role='like_button']/preceding-sibling::span[1]",
                # 4. Chính thẻ marker
                "//div[@role='dialog']//div[@data-ad-rendering-role='like_button']",
                "//div[@data-ad-rendering-role='like_button']",
                # 5. Nút Thích/Like thông thường
                "//div[@role='dialog']//div[@role='button' and (@aria-label='Like' or @aria-label='Thích')]",
                "//div[@role='button' and (@aria-label='Like' or @aria-label='Thích')]",
            ]

            # 4.1. Thực hiện HOVER vào nút Like để bật khay cảm xúc
            hover_elem = None
            for hxp in hover_target_xpaths:
                elem = self.safe_find_element(By.XPATH, hxp, timeout=1.5)
                if elem and elem.is_displayed():
                    hover_elem = elem
                    break

            if hover_elem:
                try:
                    # Cuộn phần tử vào giữa màn hình
                    self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'instant', block: 'center'});", hover_elem)
                    self.random_sleep(0.4, 0.7)

                    # HOVER bằng ActionChains (di chuyển trỏ chuột thật)
                    ActionChains(self.driver).move_to_element(hover_elem).pause(1.5).perform()

                    # Kích hoạt thêm chuỗi event chuột JS phòng trường hợp browser không bắt kịp hover
                    self.driver.execute_script("""
                        const el = arguments[0];
                        const rect = el.getBoundingClientRect();
                        const x = rect.left + rect.width / 2;
                        const y = rect.top + rect.height / 2;
                        ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove'].forEach(type => {
                            const isPointer = type.startsWith('pointer');
                            const evt = isPointer
                                ? new PointerEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true })
                                : new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y });
                            el.dispatchEvent(evt);
                        });
                    """, hover_elem)
                except Exception as ex:
                    logger.warning(f"Lỗi khi hover vào nút Like: {ex}")

            self.random_sleep(0.8, 1.2)

            # Nếu khay cảm xúc vẫn chưa hiện, thử nút dropdown "Bày tỏ cảm xúc" bên cạnh
            if not is_dock_open():
                bay_to_xpaths = [
                    "//div[@role='dialog']//div[@aria-label='Bày tỏ cảm xúc' and @role='button']",
                    "//div[@aria-label='Bày tỏ cảm xúc' and @role='button']",
                    "//div[@role='dialog']//div[@aria-label='Bày tỏ cảm xúc']",
                    "//div[@aria-label='Bày tỏ cảm xúc']",
                ]
                for bxp in bay_to_xpaths:
                    btn = self.safe_find_element(By.XPATH, bxp, timeout=1)
                    if btn and btn.is_displayed():
                        try:
                            self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'instant', block: 'center'});", btn)
                            btn.click()
                            break
                        except Exception:
                            try:
                                ActionChains(self.driver).move_to_element(btn).click().perform()
                                break
                            except Exception:
                                pass
                self.random_sleep(0.8, 1.2)

            # 5. Bấm vào icon cảm xúc tương ứng trong khay cảm xúc
            # XPath chính xác do người dùng cung cấp:
            # //div[@aria-label='Yêu thích' or @aria-label='Haha' or @aria-label='Thương thương' or @aria-label='Care' or @aria-label='Love']
            xpath_conditions = " or ".join([f"@aria-label='{lbl}'" for lbl in target_labels])
            reaction_xpaths = [
                f"//div[@role='toolbar']//div[{xpath_conditions}]",
                f"//div[@role='dialog']//div[{xpath_conditions} and (@role='button' or @tabindex='0')]",
                f"//div[{xpath_conditions} and (@role='button' or @tabindex='0')]",
                f"//div[{xpath_conditions}]",
                f"//span[{xpath_conditions}]",
            ]

            clicked_reaction = False
            for rxp in reaction_xpaths:
                elems = self.safe_find_elements(By.XPATH, rxp)
                for relem in elems:
                    try:
                        if relem.is_displayed() and relem.size.get('width', 0) > 10:
                            try:
                                ActionChains(self.driver).move_to_element(relem).pause(0.2).click().perform()
                                clicked_reaction = True
                                break
                            except Exception:
                                relem.click()
                                clicked_reaction = True
                                break
                    except Exception:
                        continue
                if clicked_reaction:
                    break

            # Fallback với JavaScript Pointer / Mouse Events nếu Selenium chưa bấm được
            if not clicked_reaction:
                clicked_reaction = self.driver.execute_script(f"""
                    const targetLabels = {labels_json};
                    const candidates = Array.from(document.querySelectorAll('div[aria-label], span[aria-label], div[role="button"][aria-label]'));
                    const matching = candidates.filter(el => {{
                        const aria = (el.getAttribute('aria-label') || '').trim();
                        if (!targetLabels.some(lbl => aria.toLowerCase() === lbl.toLowerCase())) return false;
                        const r = el.getBoundingClientRect();
                        return r.width > 10 && r.height > 10;
                    }});
                    const targetBtn = matching.find(el => el.closest('[role="toolbar"]') || el.closest('[role="dialog"]')) || matching[0];
                    if (targetBtn) {{
                        targetBtn.scrollIntoView({{ behavior: 'instant', block: 'nearest' }});
                        const rect = targetBtn.getBoundingClientRect();
                        const x = rect.left + rect.width / 2;
                        const y = rect.top + rect.height / 2;
                        const hit = document.elementFromPoint(x, y) || targetBtn;
                        hit.focus();

                        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {{
                            const isPointer = type.startsWith('pointer');
                            const evt = isPointer
                                ? new PointerEvent(type, {{ bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }})
                                : new MouseEvent(type, {{ bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 }});
                            hit.dispatchEvent(evt);
                        }});
                        try {{ hit.click(); }} catch(e){{}}
                        return true;
                    }}
                    return false;
                """)

            # NẾU KHÔNG TÌM THẤY HOẶC CHƯA BẤM ĐƯỢC ICON: TUYỆT ĐỐI KHÔNG BÁO THÀNH CÔNG!
            if not clicked_reaction:
                fail_msg = f"Không bật được khay cảm xúc hoặc không tìm thấy icon '{vn_name}'"
                if callback:
                    callback(f"❌ {fail_msg}")
                return False, fail_msg

            # Đợi Facebook cập nhật UI sau khi đã bấm icon cảm xúc thành công
            self.random_sleep(2.5, 3.5)

            # 6. Kiểm tra lại trạng thái sau khi bấm
            if self.driver.execute_script(js_is_reacted):
                if callback:
                    callback(f"✓ Đã thả cảm xúc {vn_name} ({clean_reaction}) bài viết thành công!")
                return True, f"Thành công ({vn_name})"

            # Trường hợp đã click icon thành công trên UI:
            if callback:
                callback(f"✓ Đã bấm thả cảm xúc {vn_name} ({clean_reaction}) vào bài viết!")
            return True, f"Thành công ({vn_name})"
        except Exception as e:
            logger.error(f"Error in execute_react: {e}")
            return False, f"Lỗi thả cảm xúc: {str(e)[:80]}"

    # ─────────────────────────────────────────────────────────────
    # 3. ACTION: COMMENT BÀI VIẾT
    # ─────────────────────────────────────────────────────────────
    def execute_comment(self, target_url: str, content: str, callback: Optional[Callable[[str], None]] = None) -> tuple[bool, str]:
        """Thực hiện viết bình luận bài viết Facebook."""
        if not content:
            return False, "Nội dung bình luận rỗng"

        try:
            if callback:
                callback(f"✍ Chuẩn bị bình luận bài viết...")

            # 1. Đảm bảo đang mở đúng bài viết
            current_url = self.driver.current_url or ""
            target_clean = target_url.split("?")[0].rstrip("/")
            if not current_url or target_clean not in current_url:
                if callback:
                    callback(f"🌐 Mở bài viết: {target_url}")
                self.driver.get(target_url)
                self.random_sleep(3.5, 6.0)

            if "login" in (self.driver.current_url or "").lower():
                return False, "Chưa đăng nhập Facebook hoặc phiên đăng nhập hết hạn"

            # 2. Cuộn trang nhẹ xuống để render khu vực bình luận
            self.human_scroll(min_dist=200, max_dist=400)
            self.random_sleep(1.0, 2.0)

            # 3. Tìm khung nhập bình luận hoặc nút kích hoạt khung bình luận
            comment_box = None

            # Danh sách locator cho khung nhập bình luận (Khớp chính xác Lexical editor của Facebook)
            comment_box_xpaths = [
                # 1. Element chuẩn Facebook Lexical editor: role="textbox" và data-lexical-editor="true"
                "//div[@data-lexical-editor='true' and @role='textbox']",
                # 2. Khớp aria-label hoặc aria-placeholder "Bình luận dưới tên..." (Element chính xác người dùng cung cấp)
                "//div[@role='textbox' and (contains(@aria-label, 'Bình luận dưới tên') or contains(@aria-placeholder, 'Bình luận dưới tên'))]",
                "//div[@role='textbox' and (contains(@aria-label, 'Bình luận') or contains(@aria-placeholder, 'Bình luận'))]",
                "//div[@role='textbox' and (contains(@aria-label, 'Comment as') or contains(@aria-placeholder, 'Comment as') or contains(@aria-label, 'Write a comment'))]",
                # 3. Khớp div role textbox có class notranslate và contenteditable="true"
                "//div[contains(@class, 'notranslate') and @role='textbox' and @contenteditable='true']",
                "//div[@role='textbox' and @contenteditable='true']",
                "//div[@contenteditable='true' and @data-lexical-editor='true']",
                "//form[contains(@action, 'comment')]//div[@contenteditable='true']",
                "//form[contains(@action, 'comment')]//textarea",
                "//textarea[contains(@placeholder, 'Bình luận') or contains(@placeholder, 'comment')]",
                "//div[@contenteditable='true']",
            ]

            # Thử tìm trực tiếp trên DOM
            for cb_xp in comment_box_xpaths:
                box = self.safe_find_element(By.XPATH, cb_xp, timeout=2)
                if box and box.is_displayed():
                    comment_box = box
                    break

            # Nếu chưa thấy, tìm qua JavaScript query
            if not comment_box:
                try:
                    comment_box = self.driver.execute_script("""
                        return document.querySelector('div[data-lexical-editor="true"][role="textbox"]') ||
                               document.querySelector('div[role="textbox"][aria-label*="Bình luận dưới tên" i]') ||
                               document.querySelector('div[role="textbox"][aria-placeholder*="Bình luận dưới tên" i]') ||
                               document.querySelector('div[role="textbox"][aria-label*="bình luận" i]') ||
                               document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                               document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]') ||
                               document.querySelector('div[contenteditable="true"]');
                    """)
                except Exception:
                    pass

            # Nếu chưa thấy ô nhập, click nút mở bình luận (nút 'Bình luận' / 'Comment' trên thanh công cụ bài viết)
            if not comment_box:
                if callback:
                    callback("🔍 Đang tìm nút mở khung bình luận...")
                open_btn_xpaths = [
                    "//div[@role='button' and (@aria-label='Bình luận' or @aria-label='Comment' or @aria-label='Viết bình luận' or @aria-label='Write a comment' or @aria-label='Để lại bình luận')]",
                    "//div[@role='button'][.//span[text()='Bình luận' or text()='Comment']]",
                    "//span[text()='Bình luận' or text()='Comment']/ancestor::div[@role='button'][1]",
                    "//div[@role='button' and (contains(., 'Bình luận') or contains(., 'Comment'))]",
                    "//span[contains(text(), 'Bình luận') or contains(text(), 'Comment')]",
                ]
                for ob_xp in open_btn_xpaths:
                    open_btn = self.safe_find_element(By.XPATH, ob_xp, timeout=2)
                    if open_btn and open_btn.is_displayed():
                        self.safe_click(open_btn)
                        self.random_sleep(1.5, 2.5)
                        break

                # Tìm lại ô comment sau khi click mở
                for cb_xp in comment_box_xpaths:
                    box = self.safe_find_element(By.XPATH, cb_xp, timeout=3)
                    if box and box.is_displayed():
                        comment_box = box
                        break

                if not comment_box:
                    try:
                        comment_box = self.driver.execute_script("""
                            return document.querySelector('div[data-lexical-editor="true"][role="textbox"]') ||
                                   document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                                   document.querySelector('div[contenteditable="true"]');
                        """)
                    except Exception:
                        pass

            # Nếu vẫn chưa thấy, cuộn thêm một chút
            if not comment_box:
                self.human_scroll(min_dist=250, max_dist=450)
                self.random_sleep(1.0, 2.0)
                for cb_xp in comment_box_xpaths:
                    box = self.safe_find_element(By.XPATH, cb_xp, timeout=2)
                    if box:
                        comment_box = box
                        break

            if not comment_box:
                return False, "Không tìm thấy khung nhập bình luận trên bài viết này"

            # 4. Scroll vào giữa màn hình và kích hoạt focus Lexical Editor
            try:
                self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", comment_box)
            except Exception:
                pass
            self.random_sleep(0.5, 1.0)

            # Focus vào thẻ p bên trong hoặc trực tiếp comment_box
            try:
                p_child = comment_box.find_element(By.TAG_NAME, "p")
                ActionChains(self.driver).move_to_element(p_child).click().perform()
            except Exception:
                try:
                    ActionChains(self.driver).move_to_element(comment_box).click().perform()
                except Exception:
                    self.safe_click(comment_box)

            try:
                self.driver.execute_script("arguments[0].focus();", comment_box)
            except Exception:
                pass
            self.random_sleep(0.4, 0.8)

            # 5. Gõ nội dung bình luận
            if callback:
                callback(f"⌨ Đang nhập nội dung bình luận...")

            typed_successfully = False
            try:
                actions = ActionChains(self.driver)
                for char in content:
                    actions.send_keys(char)
                    time.sleep(random.uniform(0.02, 0.05))
                actions.perform()
                typed_successfully = True
            except Exception as e:
                logger.warning(f"ActionChains typing error: {e}")

            self.random_sleep(0.5, 0.8)

            # Fallback nếu ActionChains chưa ghi được text vào Lexical
            curr_val = comment_box.text or comment_box.get_attribute("textContent") or ""
            if not typed_successfully or content not in curr_val:
                try:
                    self.driver.execute_script("""
                        var el = arguments[0];
                        var txt = arguments[1];
                        el.focus();
                        var success = document.execCommand('insertText', false, txt);
                        if (!success || !(el.innerText || '').includes(txt)) {
                            var evt = new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt });
                            el.dispatchEvent(evt);
                        }
                    """, comment_box, content)
                except Exception as err:
                    logger.warning(f"JS insertText fallback error: {err}")
                    try:
                        comment_box.send_keys(content)
                    except Exception as err2:
                        logger.warning(f"Fallback send_keys error: {err2}")

            # Đợi Facebook cập nhật trạng thái ô nhập và kích hoạt nút Đăng bình luận
            self.random_sleep(1.0, 1.8)

            # 6. Gửi bình luận
            if callback:
                callback(f"🚀 Đang gửi bình luận...")

            # Định vị nút Đăng bình luận (Chính xác theo element người dùng cung cấp)
            submit_btn_xpaths = [
                # Element chính xác người dùng cung cấp: role="button" aria-label="Đăng bình luận"
                "//div[@role='button' and @aria-label='Đăng bình luận']",
                "//div[@role='button' and contains(@aria-label, 'Đăng bình luận')]",
                "//div[@role='button' and (@aria-label='Post comment' or @aria-label='Comment' or @aria-label='Gửi' or @aria-label='Đăng')]",
                # Theo SVG icon mũi tên gửi (path d="M1.32 6.2...")
                "//div[@role='button'][.//*[local-name()='svg']//*[local-name()='path' and starts-with(@d, 'M1.32')]]",
                "//div[@aria-label='Nhấn Enter để gửi' or @aria-label='Press Enter to post']",
                "//form//button[@type='submit']",
            ]

            submit_btn = None
            for s_xp in submit_btn_xpaths:
                btn = self.safe_find_element(By.XPATH, s_xp, timeout=1)
                if btn and btn.is_displayed():
                    submit_btn = btn
                    break

            if not submit_btn:
                try:
                    submit_btn = self.driver.execute_script("""
                        return document.querySelector('div[role="button"][aria-label="Đăng bình luận"]') ||
                               document.querySelector('div[role="button"][aria-label*="Đăng bình luận" i]') ||
                               document.querySelector('div[role="button"][aria-label="Post comment"]') ||
                               document.querySelector('div[role="button"][aria-label="Comment"]');
                    """)
                except Exception:
                    pass

            submitted = False
            # Thử click nút Đăng bình luận nếu đã enable (không còn aria-disabled="true")
            if submit_btn:
                try:
                    is_disabled = submit_btn.get_attribute("aria-disabled")
                    if is_disabled != "true":
                        self.safe_click(submit_btn)
                        submitted = True
                except Exception as e:
                    logger.warning(f"Submit button click error: {e}")

            # Nếu chưa click được nút hoặc nút vẫn disabled, nhấn ENTER trong comment_box
            if not submitted:
                try:
                    comment_box.send_keys(Keys.ENTER)
                    submitted = True
                except Exception:
                    pass

            # Đợi một chút kiểm tra xem nút Đăng bình luận có còn sáng không, nếu còn thì click thêm lần nữa
            self.random_sleep(1.0, 1.8)
            if submit_btn:
                try:
                    is_disabled = submit_btn.get_attribute("aria-disabled")
                    if is_disabled != "true" and submit_btn.is_displayed():
                        self.safe_click(submit_btn)
                except Exception:
                    pass

            self.random_sleep(2.0, 3.5)
            if callback:
                callback(f"✓ Đã gửi bình luận: \"{content[:30]}...\"")
            return True, "Thành công"
        except Exception as e:
            logger.error(f"Error in execute_comment: {e}")
            return False, f"Lỗi bình luận: {str(e)[:80]}"

    # ─────────────────────────────────────────────────────────────
    # 4. ACTION: SHARE BÀI VIẾT
    # ─────────────────────────────────────────────────────────────
    def execute_share(self, target_url: str, callback: Optional[Callable[[str], None]] = None) -> tuple[bool, str]:
        """Thực hiện chia sẻ bài viết lên Bảng tin cá nhân ở chế độ Công khai (Public)."""
        try:
            if callback:
                callback("🔄 Chuẩn bị chia sẻ bài viết...")

            current_url = self.driver.current_url or ""
            target_clean = target_url.split("?")[0].rstrip("/")
            if not current_url or target_clean not in current_url:
                if callback:
                    callback(f"🌐 Mở bài viết: {target_url}")
                self.driver.get(target_url)
                self.random_sleep(4.0, 6.0)

            if "login" in (self.driver.current_url or "").lower():
                return False, "Chưa đăng nhập Facebook hoặc phiên đăng nhập hết hạn"

            self.random_sleep(1.5, 2.5)

            # Helper click toàn diện kích hoạt mọi tầng DOM của Facebook Comet
            def robust_click_element(target) -> bool:
                if not target:
                    return False
                try:
                    self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'instant', block: 'center'});", target)
                    time.sleep(0.3)
                except Exception:
                    pass

                try:
                    self.driver.execute_script("""
                        const el = arguments[0];
                        const target = el.closest('div[role="button"]') || el.closest('a[role="button"]') || el.closest('.x1i10hfl') || el;
                        target.focus();
                        const rect = target.getBoundingClientRect();
                        const x = rect.left + rect.width / 2;
                        const y = rect.top + rect.height / 2;
                        const hit = document.elementFromPoint(x, y) || target;
                        hit.focus();

                        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
                            const isPointer = evtType.startsWith('pointer');
                            const evt = isPointer
                                ? new PointerEvent(evtType, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 })
                                : new MouseEvent(evtType, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 });
                            hit.dispatchEvent(evt);
                            if (hit !== target) target.dispatchEvent(evt);
                        });
                        try { hit.click(); } catch(e){}
                        if (hit !== target) { try { target.click(); } catch(e){} }
                    """, target)
                except Exception as e:
                    logger.debug(f"JS click error: {e}")

                try:
                    ActionChains(self.driver).move_to_element(target).click().perform()
                except Exception:
                    pass

                try:
                    target.click()
                except Exception:
                    pass

                return True

            # ─────────────────────────────────────────────────────────────
            # BƯỚC 1: TÌM VÀ BẤM NÚT CHIA SẺ (SHARE) CỦA BÀI VIẾT
            # ─────────────────────────────────────────────────────────────
            if callback:
                callback("🔍 Đang tìm nút Chia sẻ (Share) của bài viết...")

            share_btn = self.driver.execute_script("""
                const modal = document.querySelector('div[role="dialog"]');
                const root = modal || document;

                // 1. Quét theo data-ad-rendering-role='share_button'
                const marker = root.querySelector('div[data-ad-rendering-role="share_button"]');
                if (marker) {
                    const btn = marker.closest('div[role="button"]') || marker.closest('.x1i10hfl') || marker.closest('div.x9f619') || marker.parentElement;
                    return btn;
                }

                // 2. Quét theo CSS sprite icon Share (background-position: 0px -567px)
                const shareIcons = Array.from(root.querySelectorAll('i[data-visualcompletion="css-img"]')).filter(i => {
                    return (i.getAttribute('style') || '').includes('-567px');
                });
                if (shareIcons.length > 0) {
                    const ico = shareIcons[0];
                    return ico.closest('div[role="button"]') || ico.closest('.x1i10hfl') || ico.parentElement;
                }

                // 3. Quét theo aria-label='Chia sẻ' hoặc 'Share'
                const ariaBtns = Array.from(root.querySelectorAll('div[role="button"], span[role="button"]')).filter(b => {
                    const a = (b.getAttribute('aria-label') || '').toLowerCase();
                    return a === 'chia sẻ' || a === 'share' || a.includes('share') || a.includes('chia sẻ');
                });
                if (ariaBtns.length > 0) {
                    return ariaBtns[0];
                }

                return null;
            """)

            if not share_btn:
                share_fallback_xpaths = [
                    "//div[@role='dialog']//div[@data-ad-rendering-role='share_button']/ancestor::div[@role='button' or contains(@class, 'x9f619')][1]",
                    "//div[@role='dialog']//i[contains(@style, '-567px')]/ancestor::div[@role='button' or contains(@class, 'x9f619')][1]",
                    "//div[@role='dialog']//div[@role='button' and (@aria-label='Chia sẻ' or @aria-label='Share')]",
                    "//div[@data-ad-rendering-role='share_button']/ancestor::div[@role='button' or contains(@class, 'x9f619')][1]",
                    "//i[contains(@style, '-567px')]/ancestor::div[@role='button' or contains(@class, 'x9f619')][1]",
                    "//div[@role='button' and (@aria-label='Chia sẻ' or @aria-label='Share')]",
                ]
                for xp in share_fallback_xpaths:
                    btn = self.safe_find_element(By.XPATH, xp, timeout=2)
                    if btn and btn.is_displayed():
                        share_btn = btn
                        break

            if not share_btn:
                return False, "Không tìm thấy nút Chia sẻ (share_button) của bài viết"

            if callback:
                callback("🚀 Đang bấm nút Chia sẻ (Share) bài viết...")
            robust_click_element(share_btn)
            self.random_sleep(2.5, 3.5)

            # Nếu Facebook mở popup menu tùy chọn share (ví dụ: 'Share to Feed' / 'Chia sẻ lên Bảng tin')
            # Kiểm tra xem có mục menu này không để mở hộp thoại soạn thảo chia sẻ (Share Composer)
            self.driver.execute_script("""
                const feedOpts = Array.from(document.querySelectorAll('div[role="menuitem"], div[role="button"], span')).filter(el => {
                    const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                    return t === 'share to feed' || t === 'chia sẻ lên bảng tin' || t === 'chia sẻ ngay lên bảng tin';
                });
                for (const opt of feedOpts) {
                    const b = opt.closest('div[role="menuitem"]') || opt.closest('div[role="button"]') || opt;
                    const r = b.getBoundingClientRect();
                    if (r.width > 20 && r.height > 10) {
                        b.click();
                        break;
                    }
                }
            """)
            time.sleep(1.5)

            # ─────────────────────────────────────────────────────────────
            # BƯỚC 2: TÌM PILL NÚT ĐỐI TƯỢNG VÀ KIỂM TRA (FRIENDS HAY PUBLIC)
            # ─────────────────────────────────────────────────────────────
            if callback:
                callback("🔍 Đang kiểm tra đối tượng chia sẻ (Audience)...")

            # JS Helper quét chính xác pill chọn đối tượng (.x1qhmfi1 với icon -831px)
            js_get_audience_pill = """
                // 1. Quét tìm theo icon chevron (-831px) đặc trưng duy nhất của nút chọn đối tượng
                const chevrons = Array.from(document.querySelectorAll('i[data-visualcompletion="css-img"]')).filter(i => {
                    return (i.getAttribute('style') || '').includes('-831px');
                });
                for (const c of chevrons) {
                    const pill = c.closest('.x1qhmfi1') || c.closest('div[role="button"]') || c.closest('.x6s0dn4') || c.parentElement;
                    if (pill) {
                        const rect = pill.getBoundingClientRect();
                        if (rect.width > 15 && rect.height > 10) return pill;
                    }
                }

                // 2. Quét tìm theo class .x1qhmfi1 chính xác người dùng cung cấp
                const qhList = Array.from(document.querySelectorAll('.x1qhmfi1')).filter(el => {
                    const rect = el.getBoundingClientRect();
                    return rect.width > 15 && rect.height > 10;
                });
                if (qhList.length > 0) {
                    return qhList[0];
                }

                // 3. Quét theo thẻ img 12x12 alt Friends / Public trong dialog
                const smallImgs = Array.from(document.querySelectorAll('img')).filter(img => {
                    const alt = (img.getAttribute('alt') || '').toLowerCase();
                    const w = img.getAttribute('width');
                    return (w === '12' || w === '16') && (alt === 'friends' || alt === 'public' || alt === 'bạn bè' || alt === 'công khai');
                });
                for (const img of smallImgs) {
                    const pill = img.closest('.x1qhmfi1') || img.closest('div[role="button"]') || img.closest('.x6s0dn4') || img.parentElement;
                    if (pill) {
                        const rect = pill.getBoundingClientRect();
                        if (rect.width > 15 && rect.height > 10) return pill;
                    }
                }

                return null;
            """

            js_check_pill_status = """
                const findPill = () => { """ + js_get_audience_pill + """ };
                const pill = findPill();
                if (!pill) {
                    return { found: false, isPublic: false, text: '' };
                }

                // Kiểm tra nội dung CHỈ TRONG PHẠM VI NÚT PILL NÀY (tránh nhầm với bài viết gốc)
                const text = (pill.innerText || pill.textContent || '').trim();
                const lowerText = text.toLowerCase();
                const img = pill.querySelector('img');
                const alt = (img ? (img.getAttribute('alt') || '') : '').toLowerCase();

                const hasPublicWord = lowerText.includes('public') || lowerText.includes('công khai') || alt.includes('public') || alt.includes('công khai');
                const hasFriendsWord = lowerText.includes('friends') || lowerText.includes('bạn bè') || alt.includes('friends') || alt.includes('bạn bè');

                // Nếu có chữ Friends / Bạn bè thì chắc chắn CHƯA PHẢI Public
                const isPublic = hasPublicWord && !hasFriendsWord;

                return {
                    found: true,
                    isPublic: isPublic,
                    hasFriends: hasFriendsWord,
                    text: text,
                    alt: alt
                };
            """

            pill_status = None
            for _ in range(5):
                pill_status = self.driver.execute_script(js_check_pill_status)
                if pill_status and pill_status.get("found"):
                    break
                time.sleep(1.0)

            logger.info(f"Trạng thái đối tượng bài viết chia sẻ ban đầu: {pill_status}")
            is_already_public = pill_status.get("isPublic", False) if pill_status else False

            # ─────────────────────────────────────────────────────────────
            # BƯỚC 3: XỬ LÝ CHUYỂN SANG PUBLIC NẾU ĐANG LÀ FRIENDS
            # ─────────────────────────────────────────────────────────────
            if not is_already_public:
                if callback:
                    callback("⚙️ Chế độ chia sẻ chưa phải Public (đang là Friends), đang bấm vào để chọn Public...")

                aud_btn = self.driver.execute_script(js_get_audience_pill)
                if not aud_btn:
                    # Fallback tìm bằng XPath
                    aud_btn = self.safe_find_element(By.XPATH, "//div[contains(@class, 'x1qhmfi1')] | //i[contains(@style, '-831px')]/ancestor::div[@role='button' or contains(@class, 'x1qhmfi1')][1]", timeout=2)

                if aud_btn:
                    robust_click_element(aud_btn)
                else:
                    return False, "Không tìm thấy nút chọn đối tượng (Friends/Public) trong hộp thoại chia sẻ"

                self.random_sleep(2.0, 3.0)

                # 3.1. Bấm vào tùy chọn "Public" (Công khai)
                if callback:
                    callback("⚙️ Đang chọn tùy chọn: Public (Công khai)...")

                pub_target = self.driver.execute_script("""
                    const pubCandidates = Array.from(document.querySelectorAll('div[role="dialog"] span[dir="auto"], div[role="dialog"] span, div[role="menu"] span')).filter(el => {
                        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                        return t === 'public' || t === 'công khai';
                    });
                    for (const c of pubCandidates) {
                        const target = c.closest('div[role="radio"]') || c.closest('div[role="menuitem"]') || c.closest('div[role="button"]') || c.closest('.x1i10hfl') || c;
                        const rect = target.getBoundingClientRect();
                        if (rect.width > 20 && rect.height > 10) {
                            return target;
                        }
                    }
                    return null;
                """)

                if pub_target:
                    robust_click_element(pub_target)
                else:
                    pub_el = self.safe_find_element(By.XPATH, "//div[@role='dialog']//span[normalize-space()='Public' or normalize-space()='Công khai']", timeout=2)
                    if pub_el:
                        robust_click_element(pub_el)
                    else:
                        return False, "Không tìm thấy tùy chọn Public trong menu đối tượng"

                self.random_sleep(1.5, 2.2)

                # 3.2. Bấm nút "Done" (Xong)
                if callback:
                    callback("⚙️ Đang bấm nút Done (Xong)...")

                done_target = self.driver.execute_script("""
                    const doneCandidates = Array.from(document.querySelectorAll('div[role="dialog"] span')).filter(el => {
                        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                        return t === 'done' || t === 'xong';
                    });
                    for (const d of doneCandidates) {
                        const target = d.closest('div[role="button"]') || d.closest('.x1i10hfl') || d;
                        const rect = target.getBoundingClientRect();
                        if (rect.width > 20 && rect.height > 10) {
                            return target;
                        }
                    }
                    return null;
                """)

                if done_target:
                    robust_click_element(done_target)
                else:
                    done_el = self.safe_find_element(By.XPATH, "//div[@role='dialog']//span[normalize-space()='Done' or normalize-space()='Xong']/ancestor::div[@role='button'][1]", timeout=2)
                    if done_el:
                        robust_click_element(done_el)

                self.random_sleep(2.0, 3.0)

                # 3.3. KIỂM TRA LẠI: XÁC MINH PILL ĐÃ THỰC SỰ CHUYỂN SANG PUBLIC CHƯA
                if callback:
                    callback("🔍 Đang kiểm tra xác nhận đối tượng đã chuyển sang Public...")

                confirmed_public = False
                for attempt in range(6):
                    time.sleep(1.0)
                    recheck = self.driver.execute_script(js_check_pill_status)
                    if recheck and recheck.get("isPublic"):
                        confirmed_public = True
                        break
                    logger.debug(f"Chờ cập nhật Public (lần {attempt+1}/6): {recheck}")

                if not confirmed_public:
                    # Kiểm tra xem nút Done có còn hiển thị không (nếu modal audience chưa đóng thì click lại Done)
                    still_done = self.safe_find_element(By.XPATH, "//div[@role='dialog']//span[normalize-space()='Done' or normalize-space()='Xong']", timeout=1)
                    if still_done and still_done.is_displayed():
                        robust_click_element(still_done)
                        time.sleep(2.0)
                        recheck2 = self.driver.execute_script(js_check_pill_status)
                        if recheck2 and recheck2.get("isPublic"):
                            confirmed_public = True

                if confirmed_public:
                    if callback:
                        callback("✓ Đã xác nhận đối tượng đã chuyển sang Công khai (Public) thành công!")
                else:
                    logger.warning("Cảnh báo: Không thể xác nhận đối tượng đã chuyển sang Public qua pill, tiếp tục thử hoàn tất...")
            else:
                if callback:
                    callback("✓ Đối tượng chia sẻ đã là Công khai (Public), tiến hành bấm Share now...")

            # ─────────────────────────────────────────────────────────────
            # BƯỚC 4: TÌM VÀ BẤM NÚT "SHARE NOW" (CHIA SẺ NGAY) VÀ XÁC NHẬN THÀNH CÔNG
            # ─────────────────────────────────────────────────────────────
            if callback:
                callback("🚀 Đang tìm và bấm nút Share now (Chia sẻ ngay)...")

            js_find_share_now = """
                const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                const shareDialog = dialogs.find(d => {
                    const text = (d.textContent || '').toLowerCase();
                    return text.includes('share now') || text.includes('chia sẻ ngay') || text.includes('say something');
                }) || dialogs[dialogs.length - 1] || document;

                const spans = Array.from(shareDialog.querySelectorAll('span')).filter(s => {
                    const t = (s.innerText || s.textContent || '').trim().toLowerCase();
                    return t === 'share now' || t === 'chia sẻ ngay';
                });

                for (const s of spans) {
                    const btn = s.closest('div[role="button"]') || s.closest('.x1i10hfl') || s.closest('div.x9f619') || s.parentElement;
                    const rect = btn.getBoundingClientRect();
                    if (rect.width > 20 && rect.height > 10) {
                        return { btn: btn, span: s };
                    }
                }

                // Fallback aria-label
                const ariaBtns = Array.from(shareDialog.querySelectorAll('div[role="button"]')).filter(b => {
                    const a = (b.getAttribute('aria-label') || '').trim().toLowerCase();
                    return a === 'share now' || a === 'chia sẻ ngay';
                });
                if (ariaBtns.length > 0) {
                    return { btn: ariaBtns[0], span: null };
                }

                return null;
            """

            share_now_obj = self.driver.execute_script(js_find_share_now)
            share_now_elem = None
            if share_now_obj:
                share_now_elem = share_now_obj.get("btn")
            else:
                share_now_xpaths = [
                    "//span[normalize-space()='Share now' or normalize-space()='Chia sẻ ngay']/ancestor::div[@role='button'][1]",
                    "//div[@role='dialog']//span[normalize-space()='Share now' or normalize-space()='Chia sẻ ngay']",
                    "//span[normalize-space()='Share now' or normalize-space()='Chia sẻ ngay']",
                ]
                for sxp in share_now_xpaths:
                    s_el = self.safe_find_element(By.XPATH, sxp, timeout=2)
                    if s_el and s_el.is_displayed():
                        share_now_elem = s_el
                        break

            if not share_now_elem:
                return False, "Không tìm thấy nút Share now để hoàn tất chia sẻ"

            # Thực hiện click triệt để vào nút Share now
            robust_click_element(share_now_elem)
            if share_now_obj and share_now_obj.get("span"):
                try:
                    self.driver.execute_script("""
                        const s = arguments[0];
                        if (s) {
                            s.click();
                            if (s.parentElement) s.parentElement.click();
                        }
                    """, share_now_obj.get("span"))
                except Exception:
                    pass

            # ─────────────────────────────────────────────────────────────
            # BƯỚC 5: XÁC MINH TIẾN TRÌNH CHIA SẺ ĐÃ HOÀN TẤT (KHÔNG BÁO THÀNH CÔNG ẢO)
            # ─────────────────────────────────────────────────────────────
            if callback:
                callback("⏳ Đang đợi tiến trình chia sẻ hoàn tất và đóng hộp thoại...")

            share_completed = False
            for w in range(10):
                time.sleep(1.0)
                is_open = self.driver.execute_script("""
                    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                    const shareDialog = dialogs.find(d => {
                        const text = (d.textContent || '').toLowerCase();
                        return text.includes('share now') || text.includes('chia sẻ ngay') || text.includes('say something');
                    });
                    if (!shareDialog) return false;
                    const r = shareDialog.getBoundingClientRect();
                    return r.width > 50 && r.height > 50;
                """)

                if not is_open:
                    share_completed = True
                    break

                # Nếu sau 4 giây hộp thoại vẫn chưa đóng, có thể nút bấm chưa nhận lệnh click, thử click lại
                if w == 3:
                    logger.info("Hộp thoại Share vẫn mở sau 4s, thử click lại nút Share now...")
                    robust_click_element(share_now_elem)

            if not share_completed:
                return False, "Không thể hoàn tất chia sẻ (hộp thoại Share now không đóng sau khi bấm)"

            self.random_sleep(2.5, 4.0)
            if callback:
                callback("✓ Đã chia sẻ bài viết ở chế độ Công khai (Public) thành công!")
            return True, "Thành công (Chia sẻ Public)"
        except Exception as e:
            logger.error(f"Error in execute_share: {e}")
            return False, f"Lỗi chia sẻ: {str(e)[:80]}"
