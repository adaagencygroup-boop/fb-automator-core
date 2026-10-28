"""
page_flow.py
Kịch bản tự động điền form tạo Fanpage Facebook (UC-05):
  B1 → B10: Truy cập URL → Nhập info → Tải ảnh Avatar/Cover
"""
import logging
import os
import re
import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

from modules.module_02_account_manager.automation.browser_manager import (
    human_type, human_sleep, wait_and_find
)
from modules.module_04_page_creator.automation.locators import PAGE_CREATION

logger = logging.getLogger(__name__)

PAGE_CREATION_URL = "https://web.facebook.com/pages/creation/?ref_type=launch_point"


def _select_category(driver, category: str):
    """Điền hạng mục và chọn suggestion đầu tiên."""
    cat_input = wait_and_find(driver, PAGE_CREATION["category_input"])
    cat_input.clear()
    human_type(cat_input, category)
    human_sleep(1.5, 2.5)

    # Chờ dropdown xuất hiện và click item đầu tiên
    try:
        first_suggestion = wait_and_find(
            driver, PAGE_CREATION["category_first_suggestion"], timeout=8
        )
        first_suggestion.click()
        human_sleep(0.5, 1.0)
        logger.info(f"Category selected: {category}")
    except TimeoutException:
        # Fallback: gửi ArrowDown + Enter
        cat_input.send_keys(Keys.ARROW_DOWN)
        time.sleep(0.3)
        cat_input.send_keys(Keys.ENTER)
        logger.warning(f"Category fallback key press used for: {category}")


def _fill_address(driver, address: str):
    """
    Phân tách chuỗi địa chỉ và điền vào 3 trường: Đường, Thành phố, ZIP.
    Định dạng đề xuất: "123 Đường X, Hà Nội, 100000"
    """
    parts = [p.strip() for p in address.split(",")]
    street = parts[0] if len(parts) > 0 else ""
    city = parts[1] if len(parts) > 1 else ""
    zipcode = parts[2] if len(parts) > 2 else ""

    if street:
        try:
            el = wait_and_find(driver, PAGE_CREATION["street_input"], timeout=5)
            human_type(el, street)
        except TimeoutException:
            logger.warning("Street input not found")

    if city:
        try:
            el = wait_and_find(driver, PAGE_CREATION["city_input"], timeout=5)
            human_type(el, city)
            human_sleep(1.0, 2.0)
            # Click suggestion nếu có
            try:
                suggestion = wait_and_find(
                    driver, PAGE_CREATION["category_first_suggestion"], timeout=4
                )
                suggestion.click()
            except TimeoutException:
                el.send_keys(Keys.ESCAPE)
        except TimeoutException:
            logger.warning("City input not found")

    if zipcode:
        try:
            el = wait_and_find(driver, PAGE_CREATION["zip_input"], timeout=5)
            human_type(el, zipcode)
        except TimeoutException:
            logger.warning("ZIP input not found")


def _upload_file(driver, locators: list, file_path: str):
    """Upload file ảnh bằng cách send_keys vào input[type=file]."""
    if not os.path.exists(file_path):
        logger.error(f"Image file not found: {file_path}")
        return False

    try:
        # File inputs có thể ẩn, dùng JS để tắt display:none nếu cần
        for locator in locators:
            try:
                el = WebDriverWait(driver, 8).until(
                    EC.presence_of_element_located((By.XPATH, locator))
                )
                driver.execute_script("arguments[0].style.display='block';", el)
                el.send_keys(os.path.abspath(file_path))
                human_sleep(2.0, 3.5)
                logger.info(f"File uploaded: {file_path}")
                return True
            except Exception:
                continue
    except Exception as e:
        logger.error(f"File upload failed: {e}")

    return False


# Tên tìm trong menu Country code (FB EN/VI). Ưu tiên tên nước vì "+1" khớp cả nhiều quốc gia.
_COUNTRY_SEARCH_TERMS = {
    "+84": ["Vietnam", "Việt Nam", "Viet Nam", "+84"],
    "+1": ["United States", "Hoa Kỳ", "US +1", "+1"],
    "+63": ["Philippines", "Philippine", "+63"],
    "+62": ["Indonesia", "+62"],
    "+66": ["Thailand", "Thái Lan", "+66"],
    "+855": ["Cambodia", "Campuchia", "+855"],
    "+856": ["Laos", "Lào", "+856"],
    "+60": ["Malaysia", "+60"],
    "+65": ["Singapore", "+65"],
    "+81": ["Japan", "Nhật Bản", "+81"],
    "+82": ["South Korea", "Korea", "Hàn Quốc", "+82"],
    "+86": ["China", "Trung Quốc", "+86"],
    "+44": ["United Kingdom", "UK", "+44"],
    "+61": ["Australia", "Úc", "+61"],
}


def _country_code_label(driver) -> str:
    """Đọc aria-label nút Country code hiện tại (vd: 'Country code, US +1')."""
    try:
        return driver.execute_script(
            """
            const nodes = Array.from(document.querySelectorAll(
              '[role="button"][aria-label], [role="combobox"][aria-label]'
            ));
            for (const el of nodes) {
              const a = (el.getAttribute('aria-label') || '').trim();
              if (/country code|mã quốc gia/i.test(a)) return a;
            }
            return '';
            """
        ) or ""
    except Exception:
        return ""


def _country_code_matches(label: str, clean_cc: str) -> bool:
    """Khớp mã trong phần sau dấu phẩy của aria-label (tránh +1 khớp nhầm)."""
    if not label or not clean_cc:
        return False
    digits = clean_cc.lstrip("+")
    tail = label.split(",")[-1].strip() if "," in label else label
    found = re.findall(r"\+(\d+)", tail)
    if found:
        return found[-1] == digits
    return clean_cc in tail


def _select_country_code(driver, country_code: str):
    """Chọn mã quốc gia trên form pages/creation. FB hay mặc định US +1 theo locale nick."""
    if not country_code:
        return
    clean_cc = country_code.strip()
    if not clean_cc.startswith("+"):
        clean_cc = "+" + clean_cc
    search_terms = list(_COUNTRY_SEARCH_TERMS.get(clean_cc, [clean_cc]))
    if clean_cc not in search_terms:
        search_terms.append(clean_cc)

    def _already_ok() -> bool:
        return _country_code_matches(_country_code_label(driver), clean_cc)

    if _already_ok():
        logger.info("Country code already %s (%s)", clean_cc, _country_code_label(driver))
        return

    last_err = None
    for attempt in range(1, 4):
        try:
            cc_btn = wait_and_find(driver, PAGE_CREATION["country_code_selector"], timeout=8)
            try:
                cc_btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", cc_btn)
            human_sleep(0.8, 1.4)

            # Menu FB: thường có ô search — gõ tên nước (Vietnam) tin cậy hơn "+84" lệch scroll.
            search_inputs = driver.find_elements(
                By.XPATH,
                "//*[@role='menu' or @role='listbox' or @role='dialog']"
                "//input[not(@type='hidden')]",
            )
            typed = False
            # EN UI: "Vietnam"; VI UI: "Việt Nam" — thử lần lượt
            for term in search_terms:
                for inp in search_inputs:
                    try:
                        if not inp.is_displayed():
                            continue
                        inp.click()
                        inp.send_keys(Keys.CONTROL, "a")
                        inp.send_keys(Keys.BACKSPACE)
                        human_type(inp, term)
                        human_sleep(0.9, 1.4)
                        typed = True
                        break
                    except Exception:
                        continue
                if typed:
                    break

            clicked = driver.execute_script(
                """
                const wantCode = arguments[0];
                const terms = (arguments[1] || []).map((t) => String(t).toLowerCase());
                const digits = String(wantCode).replace('+', '');
                const roles = new Set(['option', 'menuitem', 'menuitemradio', 'button', 'row']);
                const nodes = Array.from(document.querySelectorAll(
                  '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="button"], [role="row"], li'
                ));
                const visible = (el) => {
                  const r = el.getBoundingClientRect();
                  return r.width > 8 && r.height > 8;
                };
                const scored = [];
                for (const el of nodes) {
                  if (!visible(el)) continue;
                  const role = (el.getAttribute('role') || '').toLowerCase();
                  if (role && !roles.has(role) && el.tagName !== 'LI') continue;
                  const aria = (el.getAttribute('aria-label') || '');
                  if (/country code|mã quốc gia/i.test(aria) && /\\+\\d+/.test(aria)) continue;
                  const text = ((el.innerText || el.textContent || '') + ' ' + aria)
                    .replace(/\\s+/g, ' ').trim();
                  if (!text || text.length > 120) continue;
                  const lower = text.toLowerCase();
                  const hasCode = text.includes(wantCode)
                    || new RegExp('\\\\+' + digits + '(?!\\\\d)').test(text);
                  const hasName = terms.some((t) => t && lower.includes(t));
                  if (!hasCode && !hasName) continue;
                  scored.push({ el, score: (hasCode ? 10 : 0) + (hasName ? 5 : 0) });
                }
                scored.sort((a, b) => b.score - a.score);
                if (!scored.length) return false;
                scored[0].el.click();
                return true;
                """,
                clean_cc,
                search_terms,
            )

            if not clicked:
                # Fallback XPath cũ + locator Việt Nam
                fallback_xpaths = [
                    f'//div[@role="option" or @role="menuitem" or @role="menuitemradio"][contains(., "{clean_cc}")]',
                    f'//span[contains(., "{clean_cc}")]/ancestor::*[@role="option" or @role="menuitem" or @role="button"][1]',
                ]
                if clean_cc == "+84":
                    fallback_xpaths[1:1] = list(PAGE_CREATION.get("country_vietnam_option") or [])
                for xp in fallback_xpaths:
                    for opt in driver.find_elements(By.XPATH, xp):
                        try:
                            if opt.is_displayed():
                                driver.execute_script("arguments[0].click();", opt)
                                clicked = True
                                break
                        except Exception:
                            continue
                    if clicked:
                        break

            human_sleep(0.7, 1.2)
            # Đóng menu nếu vẫn mở (Esc)
            try:
                driver.switch_to.active_element.send_keys(Keys.ESCAPE)
            except Exception:
                pass

            if _already_ok():
                logger.info(
                    "Country code selected: %s (attempt %s) → %s",
                    clean_cc,
                    attempt,
                    _country_code_label(driver),
                )
                return

            last_err = f"sau lần {attempt} vẫn là: {_country_code_label(driver) or '(không đọc được)'}"
            logger.warning("Chưa chọn được %s — %s", clean_cc, last_err)
            human_sleep(0.5, 0.9)
        except Exception as cc_err:
            last_err = str(cc_err)
            logger.warning("Country code attempt %s failed: %s", attempt, cc_err)

    # Không nuốt lỗi im lặng — để B6 biết và log rõ (tránh kẹt Next vì US +1 + SĐT VN)
    logger.error(
        "Không chọn được mã quốc gia %s (FB mặc định US +1). Chi tiết: %s",
        clean_cc,
        last_err,
    )
    raise RuntimeError(
        f"Không đổi được Country code sang {clean_cc} (đang: {_country_code_label(driver) or 'US +1'}). "
        "Nút Next sẽ bị khóa nếu SĐT Việt Nam gắn mã Mỹ."
    )


def run_page_creation(
    driver: webdriver.Chrome,
    page_name: str,
    category: str,
    bio: str,
    phone: str = "",
    email: str = "",
    address: str = "",
    avatar_path: str = None,
    cover_path: str = None,
    country_code: str = "+84",
) -> dict:
    """
    Thực thi toàn bộ luồng tạo Page Facebook (B1 → B10).
    """
    result = {"success": False, "page_url": "", "error": ""}

    try:
        # ── Đảm bảo trình duyệt đang ở Profile cá nhân gốc, không kẹt trong Fanpage vòng trước ──
        try:
            from modules.module_02_account_manager.automation.login_flow import ensure_personal_profile
            ensure_personal_profile(driver)
        except Exception as pe:
            logger.debug(f"Pre-creation ensure_personal_profile note: {pe}")

        # ── B1: Truy cập trang tạo Page ──
        logger.info(f"Opening page creation form for '{page_name}'")
        driver.get(PAGE_CREATION_URL)
        human_sleep(3.0, 5.0)

        # ── B2: Nhập tên trang (kèm fallback nếu phiên FB bị kẹt hoặc chưa load) ──
        name_input = None
        try:
            name_input = wait_and_find(driver, PAGE_CREATION["page_name_input"], timeout=10)
        except TimeoutException:
            logger.warning(f"Chưa thấy form tạo trang cho '{page_name}', kích hoạt fallback reset profile cá nhân...")
            try:
                from modules.module_02_account_manager.automation.login_flow import ensure_personal_profile
                ensure_personal_profile(driver)
            except Exception:
                pass
            driver.get(PAGE_CREATION_URL)
            human_sleep(3.5, 5.5)
            name_input = wait_and_find(driver, PAGE_CREATION["page_name_input"], timeout=15)

        human_type(name_input, page_name)
        human_sleep(0.5, 1.0)

        # ── B3: Nhập hạng mục ──
        _select_category(driver, category)

        # ── B4: Nhập bio ──
        try:
            bio_el = wait_and_find(driver, PAGE_CREATION["bio_textarea"], timeout=8)
            human_type(bio_el, bio)
            human_sleep(0.5, 1.0)
        except TimeoutException:
            logger.warning("Bio textarea not found, skipping")

        # ── B5: Click "Tạo Trang" ──
        create_btn = wait_and_find(driver, PAGE_CREATION["create_page_button"])
        create_btn.click()
        logger.info("Clicked 'Tạo Trang' button, waiting for page to be created...")
        human_sleep(6.0, 9.0)

        # ── B6: Điền thông tin liên hệ ──
        if phone:
            try:
                phone_el = wait_and_find(driver, PAGE_CREATION["phone_input"], timeout=12)
            except TimeoutException:
                phone_el = None
                logger.warning("Phone input not found")

            if phone_el is not None:
                # Bắt buộc đổi Country code trước (FB mặc định US +1 theo locale nick → SĐT VN bị đỏ, Next khóa)
                try:
                    _select_country_code(driver, country_code or "+84")
                except Exception as cc_fail:
                    logger.error("Country code: %s", cc_fail)
                    raise

                try:
                    phone_el.clear()
                except Exception:
                    driver.execute_script("arguments[0].value='';", phone_el)
                clean_phone = phone.strip()
                prefix = (country_code or "+84").replace("+", "").strip()
                if prefix and clean_phone.startswith(f"+{prefix}"):
                    clean_phone = clean_phone[len(prefix) + 1 :]
                elif prefix and clean_phone.startswith(prefix) and len(clean_phone) > 9:
                    clean_phone = clean_phone[len(prefix) :]
                if (country_code or "+84") == "+84" and not clean_phone.startswith("0") and len(clean_phone) == 9:
                    clean_phone = "0" + clean_phone

                human_type(phone_el, clean_phone)
                human_sleep(0.8, 1.5)
                # Xác nhận lần cuối — nếu vẫn US +1 thì không tiếp tục để tránh kẹt Step 1/5
                if not _country_code_matches(_country_code_label(driver), country_code or "+84"):
                    raise RuntimeError(
                        f"Sau khi điền SĐT, Country code vẫn là '{_country_code_label(driver)}' "
                        f"(cần {country_code or '+84'})."
                    )

        if email:
            try:
                email_el = wait_and_find(driver, PAGE_CREATION["email_input"], timeout=12)
                email_el.clear()
                human_type(email_el, email)
                human_sleep(0.8, 1.5)
            except TimeoutException:
                logger.warning("Email input not found")

        # ── B7: Điền địa chỉ ──
        if address:
            _fill_address(driver, address)

        human_sleep(1.0, 2.0)

        # ── B8: Chọn "Luôn mở cửa" ──
        try:
            radio = wait_and_find(driver, PAGE_CREATION["always_open_radio"], timeout=10)
            if not radio.is_selected():
                try:
                    radio.click()
                except Exception:
                    driver.execute_script("arguments[0].click();", radio)
        except TimeoutException:
            logger.warning("Always open radio not found")

        # ── B9: Bấm "Tiếp" để chuyển sang trang media ──
        next_btn = wait_and_find(driver, PAGE_CREATION["next_button"], timeout=20)
        try:
            next_btn.click()
        except Exception:
            driver.execute_script("arguments[0].click();", next_btn)
        human_sleep(4.0, 6.0)

        # ── B10: Tải Avatar ──
        if avatar_path:
            logger.info(f"Uploading avatar from: {avatar_path}")
            _upload_file(driver, PAGE_CREATION["avatar_file_input"], avatar_path)
            human_sleep(2.0, 3.5)

        # ── B10: Tải Cover ──
        if cover_path:
            logger.info(f"Uploading cover from: {cover_path}")
            # 1. Thử click nút "Thêm ảnh bìa" / "Add cover photo" để kích hoạt input
            try:
                cover_btn_locs = [
                    '//div[contains(@aria-label, "ảnh bìa") or contains(@aria-label, "Cover photo") or contains(@aria-label, "cover photo") or contains(@aria-label, "Cover")]',
                    '//span[contains(text(), "ảnh bìa") or contains(text(), "cover photo") or contains(text(), "Cover photo") or contains(text(), "Cover")]/ancestor::div[@role="button"]',
                    '//div[@role="button" and (contains(., "ảnh bìa") or contains(., "Cover photo") or contains(., "cover photo"))]',
                ]
                for btn_xpath in cover_btn_locs:
                    btns = driver.find_elements(By.XPATH, btn_xpath)
                    # for b in btns:
                    #     if b.is_displayed():
                    #         try:
                    #             b.click()
                    #         except Exception:
                    #             driver.execute_script("arguments[0].click();", b)
                    #         human_sleep(1.5, 2.5)
                    #         break
            except Exception as cover_btn_err:
                logger.warning(f"Cover photo button click note: {cover_btn_err}")

            # 2. Upload file ảnh bìa
            uploaded_cover = False
            try:
                inputs = driver.find_elements(By.XPATH, '//input[@type="file"]')
                if len(inputs) >= 2:
                    target_input = inputs[1]
                    driver.execute_script("arguments[0].style.display='block';", target_input)
                    target_input.send_keys(os.path.abspath(cover_path))
                    human_sleep(3.0, 4.5)
                    uploaded_cover = True
                    logger.info(f"Cover uploaded via inputs[1]: {cover_path}")
                elif len(inputs) == 1:
                    target_input = inputs[0]
                    driver.execute_script("arguments[0].style.display='block';", target_input)
                    target_input.send_keys(os.path.abspath(cover_path))
                    human_sleep(3.0, 4.5)
                    uploaded_cover = True
                    logger.info(f"Cover uploaded via inputs[0]: {cover_path}")
            except Exception as e:
                logger.warning(f"Direct cover upload note: {e}")

            if not uploaded_cover:
                _upload_file(driver, PAGE_CREATION["cover_file_input"], cover_path)

            human_sleep(2.0, 3.5)

        human_sleep(2.5, 4.0)

        # Trả về thành công ở bước điền form và upload media. URL chính thức sẽ được lấy ở finalize_page sau khi bấm Xong.
        result["page_url"] = ""
        result["success"] = True
        logger.info(f"Page '{page_name}' wizard inputs & media completed. Ready for finalization.")

    except Exception as e:
        logger.exception(f"Page creation failed for '{page_name}': {e}")
        result["error"] = str(e)

    return result


def clean_facebook_page_url(url: str) -> str:
    """
    Chuẩn hóa URL Fanpage Facebook:
    - Loại bỏ các URL wizard/tạo trang: pages/creation
    - Chuẩn hóa web.facebook.com -> www.facebook.com
    - Giữ lại query id nếu là profile.php?id=...
    - Loại bỏ query params rác (?modal=..., ?ref=..., ?notif_id=...)
    - Loại bỏ các đường dẫn hệ thống chung (/settings, /login, /messages...)
    """
    if not url:
        return ""
    clean = url.strip()
    if "pages/creation" in clean:
        return ""

    import urllib.parse
    clean = clean.replace("web.facebook.com", "www.facebook.com")
    parsed = urllib.parse.urlparse(clean)
    if "facebook.com" not in parsed.netloc:
        return ""

    path = parsed.path.strip("/")
    if not path:
        return ""

    raw_first_segment = path.split("/")[0]
    first_segment = raw_first_segment.lower()
    system_paths = {
        "login", "checkpoint", "two_step", "recover", "help", "watch", "marketplace",
        "groups", "gaming", "bookmarks", "settings", "messages", "notifications",
        "friends", "events", "saved", "memories", "stories", "reels", "ads", "fundraisers",
        "me", "allactivity", "privacy", "policies", "terms", "support", "biz_web"
    }
    if first_segment in system_paths:
        return ""

    netloc = "www.facebook.com"
    if "profile.php" in path:
        qs = urllib.parse.parse_qs(parsed.query)
        page_id = qs.get("id", [""])[0]
        if page_id:
            return f"https://{netloc}/profile.php?id={page_id}"
        return ""

    if first_segment == "pages":
        return f"https://{netloc}/{path}"

    return f"https://{netloc}/{raw_first_segment}"


def finalize_page(driver: webdriver.Chrome) -> str:
    """
    Hoàn tất flow sau upload ảnh:
    - Bấm Tiếp (Invite Friends / Additional steps)
    - Bỏ qua WhatsApp nếu xuất hiện
    - Bấm Tiếp
    - Bấm Xong (Done)
    - Chờ Facebook redirect từ pages/creation sang URL Fanpage thực tế
    - Tự động đóng popup khảo sát / Welcome tour nếu có
    - Trả về: URL thực tế của Fanpage vừa tạo (str) hoặc "" nếu không lấy được
    """
    real_page_url = ""
    try:
        # Bước 1: Click Tiếp sau khi upload media
        try:
            next_btn = wait_and_find(driver, PAGE_CREATION["next_button"], timeout=8)
            try:
                next_btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", next_btn)
            human_sleep(2.0, 3.5)
        except TimeoutException:
            logger.info("First next button not found or already progressed")

        # Bước 2: Bỏ qua WhatsApp nếu có
        try:
            skip_btn = wait_and_find(driver, PAGE_CREATION["skip_whatsapp_button"], timeout=5)
            try:
                skip_btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", skip_btn)
            human_sleep(1.5, 2.5)
        except TimeoutException:
            logger.info("WhatsApp skip not needed")

        # Bước 3: Tiếp (Invite friends / Page notifications)
        try:
            next_btn2 = wait_and_find(driver, PAGE_CREATION["next_button"], timeout=6)
            try:
                next_btn2.click()
            except Exception:
                driver.execute_script("arguments[0].click();", next_btn2)
            human_sleep(1.5, 2.5)
        except TimeoutException:
            pass

        # Bước 4: Xong (Done / Hoàn tất)
        try:
            done_btn = wait_and_find(driver, PAGE_CREATION["done_button"], timeout=10)
            try:
                done_btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", done_btn)
            logger.info("Clicked 'Done' button. Waiting for page redirect...")
            human_sleep(3.0, 5.0)
        except TimeoutException:
            logger.warning("Done button not found, checking if page already redirected...")

        # Bước 5: Chờ Facebook redirect ra khỏi trang pages/creation (tối đa 20s)
        start_wait = time.time()
        while time.time() - start_wait < 20:
            cur = (driver.current_url or "").strip()
            if cur and "pages/creation" not in cur and ("facebook.com" in cur):
                real_page_url = cur
                logger.info(f"Detected redirect away from pages/creation: {real_page_url}")
                break
            # Thử click lại Xong hoặc Tiếp nếu nút vẫn hiển thị
            for btn_key in ["done_button", "next_button", "skip_whatsapp_button"]:
                try:
                    retry_btn = wait_and_find(driver, PAGE_CREATION[btn_key], timeout=1)
                    try:
                        retry_btn.click()
                    except Exception:
                        driver.execute_script("arguments[0].click();", retry_btn)
                    human_sleep(2.0, 3.0)
                    break
                except Exception:
                    pass
            human_sleep(1.0, 1.5)

        # Bước 6: Nếu redirect về feed trang chủ facebook.com, truy cập /me để lấy URL Page thực tế
        cleaned = clean_facebook_page_url(real_page_url)
        if not cleaned:
            cur = (driver.current_url or "").strip()
            if cur and ("pages/creation" not in cur) and (cur.rstrip("/") in ["https://www.facebook.com", "https://web.facebook.com"]):
                try:
                    logger.info("On root Facebook feed after creation. Resolving /me for Page profile URL...")
                    driver.get("https://web.facebook.com/me")
                    for _ in range(5):
                        human_sleep(1.0, 1.5)
                        cur_me = (driver.current_url or "").strip()
                        c = clean_facebook_page_url(cur_me)
                        if c:
                            cleaned = c
                            break
                except Exception as me_err:
                    logger.warning(f"Failed to navigate /me: {me_err}")

        # Bước 7: Đóng popup giới thiệu tour nếu có
        try:
            tour_selectors = [
                '//div[@aria-label="Đóng" or @aria-label="Close" or @aria-label="dismiss"][@role="button"]',
                '//span[text()="Không phải bây giờ" or text()="Not now" or text()="Lúc khác"]/ancestor::div[@role="button"]',
                '//div[@role="button" and (contains(., "Không phải bây giờ") or contains(., "Not now") or contains(., "Lúc khác"))]',
                '//button[contains(., "Không phải bây giờ") or contains(., "Not now")]',
            ]
            for xp in tour_selectors:
                elems = driver.find_elements(By.XPATH, xp)
                for el in elems:
                    if el.is_displayed():
                        try:
                            el.click()
                        except Exception:
                            driver.execute_script("arguments[0].click();", el)
                        human_sleep(1.0, 1.5)
                        break
        except Exception:
            pass

        # Bước 8: Kiểm tra lại driver.current_url sau khi đóng tour
        if not cleaned:
            try:
                cur_after_tour = (driver.current_url or "").strip()
                cleaned = clean_facebook_page_url(cur_after_tour)
            except Exception:
                pass

        # Bước 9: Thử lấy từ thẻ meta og:url hoặc link canonical trong DOM
        if not cleaned:
            try:
                meta_elems = driver.find_elements(By.XPATH, '//meta[@property="og:url"] | //link[@rel="canonical"]')
                for el in meta_elems:
                    href = el.get_attribute("content") or el.get_attribute("href") or ""
                    c = clean_facebook_page_url(href)
                    if c:
                        cleaned = c
                        break
            except Exception:
                pass

        # Bước 10: Nếu vẫn chưa có URL, thử lấy từ avatar link hoặc link profile trong DOM
        if not cleaned:
            try:
                page_links = driver.find_elements(By.XPATH, '//a[contains(@href, "/profile.php?id=") or contains(@href, "facebook.com/")]')
                for pl in page_links:
                    href = pl.get_attribute("href") or ""
                    c = clean_facebook_page_url(href)
                    if c:
                        cleaned = c
                        break
            except Exception:
                pass

        logger.info(f"Page finalization completed. Real Page URL: '{cleaned}'")
        return cleaned

    except Exception as e:
        logger.error(f"Page finalization failed: {e}")
        return clean_facebook_page_url(driver.current_url or "")
