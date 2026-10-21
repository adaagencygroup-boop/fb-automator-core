"""Đăng một bài lên Fanpage bằng composer Facebook.

Các bước bấm khung viết, nhập chữ, gắn ảnh và bấm Đăng được lấy từ
`_post_welcome_content` của Module 4. Khác một chỗ: mở đúng URL Page
thay vì news feed cá nhân.
"""
import io
import logging
import os
import random
import threading
import time

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

from modules.module_02_account_manager.automation.browser_manager import human_sleep, wait_and_find
from modules.module_04_page_creator.automation.locators import PAGE_CREATION

logger = logging.getLogger(__name__)

PAGE_LOAD_TIMEOUT = 45
POST_LIMIT_SECONDS = 180


class PostInterrupted(Exception):
    """Bài đang soạn bị dừng, hoặc quá hạn một lần đăng."""

    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


def _close_composer(driver) -> None:
    """Đóng khung soạn. Không bấm Đăng."""
    try:
        driver.switch_to.active_element.send_keys(Keys.ESCAPE)
        time.sleep(0.2)
        driver.switch_to.active_element.send_keys(Keys.ESCAPE)
    except Exception:
        pass


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


def _guard(should_stop, deadline):
    if should_stop():
        raise PostInterrupted("stopped")
    if time.monotonic() >= deadline:
        raise PostInterrupted("timeout")


def _pause(seconds_min, seconds_max, should_stop, deadline):
    end = time.monotonic() + random.uniform(seconds_min, seconds_max)
    while True:
        _guard(should_stop, deadline)
        left = end - time.monotonic()
        if left <= 0:
            return
        time.sleep(min(0.5, left))


def _type_text(element, text, should_stop, deadline):
    for char in text or "":
        _guard(should_stop, deadline)
        element.send_keys(char)
        time.sleep(random.uniform(0.02, 0.05))


def _wait_visible(driver, locators, timeout, should_stop, deadline):
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        _guard(should_stop, deadline)
        for locator in locators:
            try:
                for element in driver.find_elements(By.XPATH, locator):
                    if element.is_displayed():
                        return element
            except Exception:
                pass
        time.sleep(0.4)
    from selenium.common.exceptions import TimeoutException
    raise TimeoutException(f"Không thấy ô soạn bài sau {timeout} giây")


def post_on_page(driver: webdriver.Chrome, page_url: str, post_content: str, image_path: str = None, page_id: str = "", should_stop=None) -> bool:
    if not page_url or not post_content:
        return False
    should_stop = should_stop or (lambda: False)
    deadline = time.monotonic() + POST_LIMIT_SECONDS
    finished = threading.Event()

    def watch():
        while not finished.wait(0.5):
            if should_stop() or time.monotonic() >= deadline:
                try:
                    driver.quit()
                except Exception:
                    pass
                return

    threading.Thread(target=watch, name="ai-post-watch", daemon=True).start()
    try:
        try:
            driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT)
        except Exception:
            pass
        _guard(should_stop, deadline)
        use_page_session(driver, page_id)
        logger.info("Mở khung đăng bài: %s với page %s", page_url, page_id or "hiện tại")
        try:
            driver.get(page_url)
        except PostInterrupted:
            raise
        except Exception as exc:
            from selenium.common.exceptions import TimeoutException
            _guard(should_stop, deadline)
            if not isinstance(exc, TimeoutException):
                raise
            try:
                driver.execute_script("window.stop();")
            except Exception:
                pass
            raise TimeoutError("Trang page tải quá 45 giây") from exc
        _pause(2.0, 3.0, should_stop, deadline)
        confirm_use_page(driver)
        _pause(1.0, 1.6, should_stop, deadline)

        if not _click_mind_box(driver):
            post_box = _wait_visible(driver, PAGE_CREATION["post_box"], 15, should_stop, deadline)
            try:
                post_box.click()
            except Exception:
                driver.execute_script("arguments[0].click();", post_box)
        _pause(2.0, 3.5, should_stop, deadline)

        text_area = _wait_visible(driver, PAGE_CREATION["post_text_area"], 15, should_stop, deadline)
        try:
            text_area.click()
        except Exception:
            pass
        _type_text(text_area, post_content, should_stop, deadline)
        _pause(1.5, 2.5, should_stop, deadline)

        if image_path and os.path.exists(image_path):
            _guard(should_stop, deadline)
            _attach_local_image(driver, image_path)

        if dismiss_not_now(driver):
            _pause(1.0, 1.6, should_stop, deadline)

        if not _click_final_post(driver, should_stop, deadline):
            _guard(should_stop, deadline)
            raise TimeoutError("Không bấm được nút Post/Đăng (aria-label=Post).")
        _pause(2.0, 3.0, should_stop, deadline)
        if dismiss_not_now(driver):
            _pause(1.0, 1.6, should_stop, deadline)
        else:
            _pause(2.0, 3.0, should_stop, deadline)
            dismiss_not_now(driver)
        _pause(2.0, 3.0, should_stop, deadline)
        return True
    except PostInterrupted as exc:
        if exc.kind == "stopped":
            _close_composer(driver)
        raise
    except Exception:
        if should_stop():
            raise PostInterrupted("stopped")
        if time.monotonic() >= deadline:
            raise PostInterrupted("timeout")
        raise
    finally:
        finished.set()


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


def _click_final_post(driver: webdriver.Chrome, should_stop=None, deadline=None) -> bool:
    """Bấm đúng aria-label=Post/Đăng. Nếu đang ở bước Next thì bấm Next trước rồi đợi Post."""
    should_stop = should_stop or (lambda: False)
    post_deadline = time.monotonic() + 25
    limit = deadline if deadline is not None else post_deadline
    tried_next = False
    while time.monotonic() < post_deadline:
        _guard(should_stop, limit)
        if _js_click_aria(driver, "Post", "Đăng"):
            logger.info("Đã bấm [aria-label=Post/Đăng]")
            return True

        if not tried_next and _js_click_aria(driver, "Next", "Tiếp"):
            logger.info("Đã bấm Next/Tiếp → chờ Post settings hiện aria-label=Post")
            tried_next = True
            _pause(1.5, 2.5, should_stop, limit)
            continue

        time.sleep(0.5)

    logger.warning("Hết thời gian chờ [aria-label=Post]")
    return False

