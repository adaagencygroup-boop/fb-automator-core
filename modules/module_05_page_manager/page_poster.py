"""Đăng một bài lên Fanpage bằng composer Facebook.

Các bước bấm khung viết, nhập chữ, gắn ảnh và bấm Đăng được lấy từ
`_post_welcome_content` của Module 4. Khác một chỗ: mở đúng URL Page
thay vì news feed cá nhân.
"""
import logging
import os

from selenium import webdriver
from selenium.webdriver.common.by import By

from modules.module_02_account_manager.automation.browser_manager import human_sleep, human_type, wait_and_find
from modules.module_04_page_creator.automation.locators import PAGE_CREATION

logger = logging.getLogger(__name__)


def _click_mind_box(driver: webdriver.Chrome) -> bool:
    """Bấm ô What's on your mind? trên trang page để mở khung Create post."""
    try:
        return bool(driver.execute_script(
            """
            const labels = ["what's on your mind?", "bạn đang nghĩ gì?"];
            const span = Array.from(document.querySelectorAll("span")).find((el) => {
                const text = (el.textContent || "").trim().toLowerCase();
                return labels.includes(text);
            });
            if (!span) return false;
            span.click();
            return true;
            """
        ))
    except Exception:
        return False


def dismiss_not_now(driver: webdriver.Chrome) -> bool:
    """Bấm Not now nếu hộp thoại phụ đang che khung đăng."""
    try:
        return bool(driver.execute_script(
            """
            const button = document.querySelector('[aria-label="Not now"]');
            if (!button) return false;
            button.click();
            return true;
            """
        ))
    except Exception:
        return False


def confirm_use_page(driver: webdriver.Chrome) -> bool:
    """Bấm nút Use Page nếu hộp chào page đang hiện."""
    try:
        return bool(driver.execute_script(
            """
            const button = document.querySelector('[aria-label="Use Page"]');
            if (!button) return false;
            button.click();
            return true;
            """
        ))
    except Exception:
        return False


def use_page_session(driver: webdriver.Chrome, page_id: str) -> None:
    """Đứng đúng fanpage bằng cookie i_user của nick đã đăng nhập. Không tạo phiên riêng."""
    page_id = str(page_id or "").strip()
    if not page_id.isdigit():
        return
    current = driver.current_url or ""
    if "facebook.com" not in current:
        driver.get("https://www.facebook.com/")
        human_sleep(1.2, 1.8)
    try:
        driver.delete_cookie("i_user")
    except Exception:
        logger.info("Chưa có cookie i_user để xóa trước khi chuyển page")
    payload = {"name": "i_user", "value": page_id, "path": "/", "secure": True}
    try:
        driver.add_cookie({**payload, "domain": ".facebook.com"})
    except Exception:
        driver.add_cookie(payload)


def post_on_page(driver: webdriver.Chrome, page_url: str, post_content: str, image_path: str = None, page_id: str = "") -> bool:
    if not page_url or not post_content:
        return False
    use_page_session(driver, page_id)
    logger.info("Mở khung đăng bài: %s với page %s", page_url, page_id or "hiện tại")
    driver.get(page_url)
    human_sleep(2.0, 3.0)
    confirm_use_page(driver)
    human_sleep(1.0, 1.6)

    if not _click_mind_box(driver):
        post_box = wait_and_find(driver, PAGE_CREATION["post_box"], timeout=15)
        try:
            post_box.click()
        except Exception:
            driver.execute_script("arguments[0].click();", post_box)
    human_sleep(2.0, 3.5)

    text_area = wait_and_find(driver, PAGE_CREATION["post_text_area"], timeout=15)
    try:
        text_area.click()
    except Exception:
        pass
    human_type(text_area, post_content, min_delay=0.02, max_delay=0.05)
    human_sleep(1.5, 2.5)

    if image_path and os.path.exists(image_path):
        try:
            file_inputs = driver.find_elements(By.XPATH, '//div[@role="dialog"]//input[@type="file"]')
            if not file_inputs:
                file_inputs = driver.find_elements(By.XPATH, '//input[@type="file"]')
            if file_inputs:
                file_input = file_inputs[0]
                driver.execute_script("arguments[0].style.display='block';", file_input)
                file_input.send_keys(os.path.abspath(image_path))
                human_sleep(4.0, 6.0)
        except Exception as error:
            logger.warning("Không gắn được ảnh: %s", error)

    try:
        next_btn = wait_and_find(driver, PAGE_CREATION["post_next_button"], timeout=5)
        try:
            next_btn.click()
        except Exception:
            driver.execute_script("arguments[0].click();", next_btn)
        human_sleep(2.0, 3.0)
    except Exception:
        logger.info("Không có nút Tiếp trong khung đăng bài")

    if dismiss_not_now(driver):
        human_sleep(1.0, 1.6)

    submit_btn = wait_and_find(driver, PAGE_CREATION["post_submit_button"], timeout=15)
    try:
        submit_btn.click()
    except Exception:
        driver.execute_script("arguments[0].click();", submit_btn)
    human_sleep(2.0, 3.0)
    # Hộp Speak With People / Call Now đôi khi hiện sau khi bấm Đăng
    if dismiss_not_now(driver):
        human_sleep(1.0, 1.6)
    else:
        human_sleep(2.0, 3.0)
        dismiss_not_now(driver)
    human_sleep(2.0, 3.0)
    return True
