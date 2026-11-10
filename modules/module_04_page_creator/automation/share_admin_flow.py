"""
share_admin_flow.py
Kịch bản UC-06: Phân quyền Quản trị viên toàn quyền và đăng bài chào mừng.
"""
import os
import time
import logging
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

from modules.module_02_account_manager.automation.browser_manager import human_type, human_sleep, wait_and_find
from modules.module_04_page_creator.automation.locators import SHARE_ADMIN, PAGE_CREATION

logger = logging.getLogger(__name__)

PROFILE_ACCESS_URL = "https://web.facebook.com/settings/?tab=profile_access"

_RESULT_NOISE = {
    "bạn bè", "friend", "friends", "người dùng facebook", "facebook user",
    "trang cá nhân", "profile", "thêm", "add", "đã thêm", "added",
    "công khai", "public", "người lạ",
}


def clean_admin_display_name(text: str, uid: str = "") -> str:
    """Lấy dòng tên người từ kết quả tìm UID, bỏ nhãn vai trò và chính UID."""
    target = (uid or "").strip()
    for raw in (text or "").replace("\r", "\n").split("\n"):
        line = " ".join(raw.split()).strip().strip(",")
        if len(line) < 2 or len(line) > 150:
            continue
        if target and line == target:
            continue
        if line.isdigit():
            continue
        lowered = line.lower()
        if lowered in _RESULT_NOISE:
            continue
        if lowered.endswith(" bạn chung") or lowered.endswith(" mutual friends"):
            continue
        return line
    return ""


def read_admin_display_name(element, uid: str = "") -> str:
    """Đọc tên hiện trên thẻ kết quả tìm admin, trước khi click chọn."""
    chunks = []
    try:
        for attr in ("aria-label", "title"):
            value = element.get_attribute(attr) or ""
            if value:
                chunks.append(value)
    except Exception:
        pass
    try:
        for span in element.find_elements(By.XPATH, ".//span")[:8]:
            value = span.text or ""
            if value.strip():
                chunks.append(value)
    except Exception:
        pass
    try:
        chunks.append(element.text or "")
    except Exception:
        pass
    for chunk in chunks:
        name = clean_admin_display_name(chunk, uid)
        if name:
            return name
    return ""


def _post_welcome_content(driver: webdriver.Chrome, post_content: str, image_path: str = None) -> bool:
    """
    Đăng bài viết chào mừng (nội dung + hình ảnh) trên Page vừa tạo theo chuẩn HTML Facebook mới.
    """
    try:
        logger.info("Starting welcome post creation on Fanpage...")

        # Điều hướng về trang chủ/feed để tìm khung đăng bài
        driver.get("https://web.facebook.com")
        human_sleep(3.0, 5.0)

        # ── B1: Click nút mở khung tạo bài viết "Bạn đang nghĩ gì?" ──
        post_box = wait_and_find(driver, PAGE_CREATION["post_box"], timeout=15)
        try:
            post_box.click()
        except Exception:
            driver.execute_script("arguments[0].click();", post_box)
        human_sleep(2.0, 3.5)

        # ── B2: Nhập nội dung text bài viết ──
        text_area = wait_and_find(driver, PAGE_CREATION["post_text_area"], timeout=15)
        try:
            text_area.click()
        except Exception:
            pass
        human_type(text_area, post_content, min_delay=0.02, max_delay=0.05)
        human_sleep(1.5, 2.5)

        # ── B3: Thêm hình ảnh bài viết (nếu có) ──
        if image_path and os.path.exists(image_path):
            try:
                logger.info(f"Attaching image to post: {image_path}")
                file_inputs = driver.find_elements(By.XPATH, '//div[@role="dialog"]//input[@type="file"]')
                if not file_inputs:
                    file_inputs = driver.find_elements(By.XPATH, '//input[@type="file"]')

                if file_inputs:
                    file_input = file_inputs[0]
                    driver.execute_script("arguments[0].style.display='block';", file_input)
                    file_input.send_keys(os.path.abspath(image_path))
                    human_sleep(4.0, 6.0)
                    logger.info("Image attached to welcome post successfully!")
                else:
                    logger.warning("No file input found inside post dialog")
            except Exception as img_err:
                logger.warning(f"Could not attach image to post: {img_err}")

        # ── B4: Click nút "Tiếp" (Next) nếu có ──
        try:
            next_btn = wait_and_find(driver, PAGE_CREATION["post_next_button"], timeout=5)
            try:
                next_btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", next_btn)
            human_sleep(2.0, 3.0)
        except Exception:
            logger.info("No intermediate 'Next' button found, continuing to 'Post' button...")

        # ── B5: Click element duy nhất Post/Đăng bài viết ──
        submit_btn = wait_and_find(driver, PAGE_CREATION["post_submit_button"], timeout=15)
        try:
            submit_btn.click()
        except Exception:
            driver.execute_script("arguments[0].click();", submit_btn)
        human_sleep(5.0, 8.0)

        logger.info("Welcome post published successfully!")
        return True
    except Exception as e:
        logger.warning(f"Failed to post welcome content: {e}")
        return False


def run_share_admin(
    driver: webdriver.Chrome,
    target_admin_uid: str,
    creator_password: str,
    post_content: str = "",
    image_path: str = None,
    creator_uid: str = "",
) -> dict:
    """
    UC-06: phân quyền Admin rồi đăng bài chào mừng.
    Gán Admin thất bại vẫn tiếp tục bước đăng bài — không dừng luồng.
    Returns:
        dict: success, admin_success, posted, error, page_url, admin_name
    """
    from modules.module_04_page_creator.routes import (
        CreatorStopRequested,
        raise_if_creator_stopped,
        stop_task_requested,
        wait_if_paused,
    )
    from modules.module_04_page_creator.automation.page_flow import clean_facebook_page_url

    result = {
        "success": False,
        "admin_success": False,
        "posted": False,
        "error": "",
        "page_url": "",
        "admin_name": "",
    }
    clean_target = (target_admin_uid or "").strip()
    clean_creator = (creator_uid or "").strip()

    def _try_post_welcome():
        if not post_content:
            return False
        wait_if_paused()
        raise_if_creator_stopped()
        logger.info("Publishing welcome content on Fanpage...")
        ok = _post_welcome_content(driver, post_content, image_path)
        human_sleep(3.0, 5.0)
        return bool(ok)

    def _return_personal():
        try:
            from modules.module_02_account_manager.automation.login_flow import ensure_personal_profile
            ensure_personal_profile(driver, uid=clean_creator)
        except Exception as e:
            logger.warning(f"Failed to return to personal profile: {e}")

    try:
        wait_if_paused()
        raise_if_creator_stopped()

        # ── UID Admin trùng nick tạo → bỏ qua phân quyền, vẫn đăng bài ──
        if clean_target and clean_creator and clean_target == clean_creator:
            logger.info(
                f"Target admin UID ({clean_target}) matches creator UID. "
                "Account is already Page Owner/Full Control. Skipping admin delegation."
            )
            result["admin_success"] = True
            try:
                result["posted"] = _try_post_welcome()
            except CreatorStopRequested:
                raise
            except Exception as post_err:
                logger.warning(f"Welcome post after same-UID skip failed: {post_err}")
            result["page_url"] = clean_facebook_page_url(driver.current_url or "")
            _return_personal()
            result["success"] = True
            return result

        # ── Phân quyền Admin (lỗi → ghi nhận, không abort đăng bài) ──
        try:
            wait_if_paused()
            raise_if_creator_stopped()
            logger.info("Navigating to profile access settings...")
            driver.get(PROFILE_ACCESS_URL)
            human_sleep(4.0, 6.0)

            wait_if_paused()
            raise_if_creator_stopped()
            add_btn = wait_and_find(driver, SHARE_ADMIN["add_new_button"], timeout=25)
            try:
                add_btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", add_btn)
            human_sleep(2.0, 3.5)

            try:
                intro_next = wait_and_find(driver, SHARE_ADMIN["intro_next_button"], timeout=12)
                try:
                    intro_next.click()
                except Exception:
                    driver.execute_script("arguments[0].click();", intro_next)
                human_sleep(1.5, 2.5)
            except TimeoutException:
                logger.info("No intro popup found, continuing to search admin...")

            wait_if_paused()
            raise_if_creator_stopped()
            search_input = wait_and_find(driver, SHARE_ADMIN["search_admin_input"], timeout=20)
            search_input.clear()
            human_type(search_input, target_admin_uid)
            human_sleep(3.0, 4.5)

            wait_if_paused()
            raise_if_creator_stopped()
            first_result = wait_and_find(driver, SHARE_ADMIN["first_search_result"], timeout=20)
            admin_name = read_admin_display_name(first_result, clean_target)
            if admin_name:
                result["admin_name"] = admin_name
                logger.info(f"Admin display name for UID {clean_target}: {admin_name}")
            try:
                first_result.click()
            except Exception:
                driver.execute_script("arguments[0].click();", first_result)
            human_sleep(2.0, 3.5)

            logger.info("Locating full control switch in modal...")
            try:
                switch_el = wait_and_find(driver, SHARE_ADMIN["full_control_switch"], timeout=20)
                aria_checked = switch_el.get_attribute("aria-checked")
                logger.info(f"Full control switch found. Initial aria-checked={aria_checked}")

                if aria_checked == "false" or aria_checked is None:
                    try:
                        switch_el.click()
                    except Exception:
                        driver.execute_script("arguments[0].click();", switch_el)

                    human_sleep(1.0, 2.0)
                    aria_after = switch_el.get_attribute("aria-checked")
                    if aria_after == "false" or aria_after is None:
                        logger.info("Input click didn't toggle state, attempting container click...")
                        try:
                            container = wait_and_find(driver, SHARE_ADMIN["full_control_switch_container"], timeout=6)
                            container.click()
                            human_sleep(1.0, 2.0)
                        except Exception:
                            driver.execute_script(
                                "arguments[0].checked = true; "
                                "arguments[0].setAttribute('aria-checked', 'true'); "
                                "arguments[0].dispatchEvent(new Event('change', { bubbles: true })); "
                                "arguments[0].click();",
                                switch_el,
                            )
                            human_sleep(1.0, 2.0)

                logger.info(
                    f"Full control switch toggle complete. Final state: {switch_el.get_attribute('aria-checked')}"
                )
            except TimeoutException:
                logger.warning("Full control switch input not found via primary locators, trying container click...")
                try:
                    container = wait_and_find(driver, SHARE_ADMIN["full_control_switch_container"], timeout=10)
                    container.click()
                    human_sleep(1.0, 2.0)
                except Exception as e:
                    raise RuntimeError(f"Không bật được Full Control: {e}") from e

            human_sleep(2.0, 3.5)

            wait_if_paused()
            raise_if_creator_stopped()
            grant_btn = wait_and_find(driver, SHARE_ADMIN["grant_access_button"], timeout=20)
            try:
                grant_btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", grant_btn)
            human_sleep(3.0, 4.5)

            wait_if_paused()
            raise_if_creator_stopped()
            pass_input = wait_and_find(driver, SHARE_ADMIN["password_confirm_input"], timeout=20)
            pass_input.clear()
            human_type(pass_input, creator_password)
            human_sleep(1.0, 2.0)

            confirm_btn = wait_and_find(driver, SHARE_ADMIN["confirm_password_button"], timeout=20)
            try:
                confirm_btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", confirm_btn)

            logger.info(f"Admin access granted to UID: {target_admin_uid}. Waiting 15s for FB processing...")
            slept = 0.0
            target_wait = 15.0
            while slept < target_wait:
                wait_if_paused()
                raise_if_creator_stopped()
                step = min(0.5, target_wait - slept)
                time.sleep(step)
                slept += step

            result["admin_success"] = True
        except CreatorStopRequested:
            raise
        except Exception as admin_err:
            if stop_task_requested:
                raise CreatorStopRequested("stopped") from admin_err
            logger.exception(f"Share admin step failed (will still try welcome post): {admin_err}")
            result["admin_success"] = False
            result["error"] = str(admin_err)
            # Đóng modal/settings nếu còn kẹt để bước đăng bài không bị chặn
            try:
                driver.get("https://web.facebook.com")
                human_sleep(2.0, 3.5)
            except Exception:
                pass

        # ── Đăng bài chào mừng: luôn chạy dù Admin thất bại ──
        try:
            result["posted"] = _try_post_welcome()
        except CreatorStopRequested:
            raise
        except Exception as post_err:
            logger.warning(f"Welcome post step failed: {post_err}")
            if not result["error"]:
                result["error"] = f"Đăng bài thất bại: {post_err}"

        cur_url = clean_facebook_page_url(driver.current_url or "")
        if cur_url:
            result["page_url"] = cur_url

        _return_personal()
        # Luồng page coi là đi hết tiến trình nếu Admin OK hoặc đã cố đăng bài
        result["success"] = bool(result["admin_success"] or result["posted"] or not post_content)
        if not result["admin_success"] and not result["error"]:
            result["error"] = "Cấp quyền Admin thất bại"
        return result

    except CreatorStopRequested:
        result["error"] = "Đã dừng khẩn cấp"
        result["success"] = False
        return result
    except Exception as e:
        if stop_task_requested:
            result["error"] = "Đã dừng khẩn cấp"
            result["success"] = False
            return result
        logger.exception(f"Share admin flow failed: {e}")
        result["error"] = str(e)
        _return_personal()
        return result
