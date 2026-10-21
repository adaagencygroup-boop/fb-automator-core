"""Đăng một bài lên Fanpage bằng composer Facebook.

Các bước bấm khung viết, nhập chữ, gắn ảnh và bấm Đăng được lấy từ
`_post_welcome_content` của Module 4. Khác một chỗ: mở đúng URL Page
thay vì news feed cá nhân.
"""
import io
import logging
import os
import time

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

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


def _copy_image_to_clipboard(image_path: str) -> bool:
    """Copy ảnh vào clipboard Windows (CF_DIB) để Ctrl+V vào composer."""
    try:
        from PIL import Image
        import win32clipboard

        image = Image.open(image_path).convert("RGB")
        buffer = io.BytesIO()
        image.save(buffer, "BMP")
        dib = buffer.getvalue()[14:]
        buffer.close()
        win32clipboard.OpenClipboard()
        try:
            win32clipboard.EmptyClipboard()
            win32clipboard.SetClipboardData(win32clipboard.CF_DIB, dib)
        finally:
            win32clipboard.CloseClipboard()
        return True
    except Exception as error:
        logger.warning("Không copy được ảnh vào clipboard: %s", error)
        return False


def _paste_image(driver: webdriver.Chrome) -> bool:
    """Dán ảnh từ clipboard vào ô soạn thảo (Ctrl+V)."""
    try:
        text_area = wait_and_find(driver, PAGE_CREATION["post_text_area"], timeout=5)
        try:
            text_area.click()
        except Exception:
            driver.execute_script("arguments[0].click();", text_area)
        human_sleep(0.3, 0.5)
        ActionChains(driver).key_down(Keys.CONTROL).send_keys("v").key_up(Keys.CONTROL).perform()
        human_sleep(3.5, 5.0)
        return True
    except Exception as error:
        logger.warning("Ctrl+V ảnh thất bại: %s", error)
        return False


def _composer_file_inputs(driver: webdriver.Chrome):
    """Input file trong Create post / gần Add to your post — không lấy input ảnh bìa trang."""
    xpaths = [
        '//div[@role="dialog"]//*[@aria-label="Add to your post" or @aria-label="Thêm vào bài viết của bạn"]'
        '//ancestor::div[@role="dialog"][1]//input[@type="file"]',
        '//div[@role="dialog"][.//div[@role="textbox"] or .//div[@contenteditable="true"]]'
        '//input[@type="file" and contains(@accept,"image")]',
        '//div[@role="dialog"][.//div[@role="textbox"] or .//div[@contenteditable="true"]]'
        '//input[@type="file"]',
        '//div[@role="dialog"]//input[@type="file" and contains(@accept,"image")]',
        '//div[@role="dialog"]//input[@type="file"]',
    ]
    found = []
    seen = set()
    for xpath in xpaths:
        for item in driver.find_elements(By.XPATH, xpath):
            try:
                key = item.id
            except Exception:
                key = id(item)
            if key in seen:
                continue
            seen.add(key)
            accept = (item.get_attribute("accept") or "").lower()
            if "video" in accept and "image" not in accept:
                continue
            found.append(item)
        if found:
            break
    return found


def _click_add_to_your_post(driver: webdriver.Chrome) -> bool:
    """Bấm vùng Add to your post để FB lộ input file (không bấm riêng Photo/video)."""
    try:
        return bool(driver.execute_script(
            """
            const root = document.querySelector('[role="dialog"]') || document;
            const el = root.querySelector(
              '[aria-label="Add to your post"], [aria-label="Thêm vào bài viết của bạn"]'
            );
            if (!el) return false;
            el.click();
            return true;
            """
        ))
    except Exception:
        return False


def _attach_via_file_input(driver: webdriver.Chrome, abs_path: str) -> bool:
    """Gắn file qua input ẩn trong composer. Có ảnh thì dùng; không được thì trả False."""
    inputs = _composer_file_inputs(driver)
    if not inputs:
        if _click_add_to_your_post(driver):
            human_sleep(0.8, 1.2)
            inputs = _composer_file_inputs(driver)
    if not inputs:
        return False
    file_input = inputs[0]
    driver.execute_script("arguments[0].style.display='block';", file_input)
    file_input.send_keys(abs_path)
    human_sleep(4.0, 6.0)
    return True


def _attach_local_image(driver: webdriver.Chrome, image_path: str) -> bool:
    """Gắn ảnh Pixabay đã tải về máy. Ưu tiên Ctrl+V; fallback Add to your post + input file.

    Không có / gắn thất bại → trả False để caller đăng bài chỉ chữ.
    """
    abs_path = os.path.abspath(image_path)
    if not os.path.exists(abs_path):
        return False

    # 1) Ctrl+V — đúng cách bạn mô tả khi đã có ảnh trên máy.
    if _copy_image_to_clipboard(abs_path) and _paste_image(driver):
        logger.info("Đã dán ảnh vào bài bằng Ctrl+V: %s", abs_path)
        return True

    # 2) Add to your post → input[type=file] trong dialog Create post.
    try:
        if _attach_via_file_input(driver, abs_path):
            logger.info("Đã gắn ảnh qua input file (Add to your post): %s", abs_path)
            return True
    except Exception as error:
        logger.warning("Gắn ảnh qua input file thất bại: %s", error)

    logger.warning("Không gắn được ảnh — tiếp tục đăng bài không kèm ảnh")
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

    # Có ảnh Pixabay thì gắn; không có / gắn lỗi thì đăng chữ thôi.
    if image_path and os.path.exists(image_path):
        _attach_local_image(driver, image_path)

    if dismiss_not_now(driver):
        human_sleep(1.0, 1.6)

    # Composer 1 bước: có Post ngay. Composer 2 bước: Next → Post settings → Post.
    # Nút vẫn aria-label="Post" như trước; lỗi hay do chưa sang Post settings / is_displayed=false.
    if not _click_final_post(driver):
        raise TimeoutError("Không bấm được nút Post/Đăng (aria-label=Post).")
    human_sleep(2.0, 3.0)
    if dismiss_not_now(driver):
        human_sleep(1.0, 1.6)
    else:
        human_sleep(2.0, 3.0)
        dismiss_not_now(driver)
    human_sleep(2.0, 3.0)
    return True


def _js_click_aria(driver: webdriver.Chrome, *labels: str) -> bool:
    """Click nút theo aria-label exact — không phụ thuộc is_displayed() của Selenium."""
    try:
        return bool(
            driver.execute_script(
                """
                const want = arguments[0].map((s) => String(s).toLowerCase());
                const nodes = Array.from(document.querySelectorAll('[aria-label][role="button"], [role="button"][aria-label]'));
                for (const el of nodes) {
                  const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
                  if (!want.includes(aria)) continue;
                  el.click();
                  return true;
                }
                return false;
                """,
                list(labels),
            )
        )
    except Exception:
        return False


def _click_final_post(driver: webdriver.Chrome) -> bool:
    """Bấm đúng aria-label=Post/Đăng. Nếu đang ở bước Next thì bấm Next trước rồi đợi Post."""
    deadline = time.time() + 25
    tried_next = False
    while time.time() < deadline:
        if _js_click_aria(driver, "Post", "Đăng"):
            logger.info("Đã bấm [aria-label=Post/Đăng]")
            return True

        # Composer 2 bước: chưa có Post thì bấm Next một lần để mở Post settings.
        if not tried_next and _js_click_aria(driver, "Next", "Tiếp"):
            logger.info("Đã bấm Next/Tiếp → chờ Post settings hiện aria-label=Post")
            tried_next = True
            human_sleep(1.5, 2.5)
            continue

        time.sleep(0.5)

    logger.warning("Hết thời gian chờ [aria-label=Post]")
    return False

