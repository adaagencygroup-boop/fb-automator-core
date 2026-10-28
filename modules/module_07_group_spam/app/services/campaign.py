"""In-memory campaign runtime and Selenium group poster for Module 7."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
import random
import threading
import time
import uuid
from typing import Any, Callable

from modules.module_02_account_manager.context import owner_scope
from ..core.constants import BLOCK_TAGS, TERMINAL_STATES, LogLevel
from .supabase_storage import download_or_cache_media, upload_local_file_to_supabase


class _TextExtractor(HTMLParser):
    """
    Helper class to extract text from HTML, preserving line breaks between block-level elements.
    """
    block_tags = BLOCK_TAGS

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs):
        if tag.lower() in self.block_tags and self.parts and not self.parts[-1].endswith("\n"):
            self.parts.append("\n")

    def handle_data(self, data: str):
        self.parts.append(data)

    def text(self) -> str:
        return "".join(self.parts).replace("\xa0", " ").strip()


def html_to_facebook_text(value: str) -> str:
    parser = _TextExtractor()
    parser.feed(value or "")
    return "\n".join(line.rstrip() for line in parser.text().splitlines()).strip()


def _group_key(group: dict[str, Any]) -> str:
    return str(group.get("key") or group.get("id") or group.get("url") or "").strip()


def _group_url(group: dict[str, Any]) -> str:
    value = str(group.get("url") or group.get("link") or _group_key(group)).strip()
    if value.startswith("http://") or value.startswith("https://"):
        return value.split("?", 1)[0].rstrip("/")
    if value.startswith("facebook.com/") or value.startswith("www.facebook.com/"):
        return f"https://{value.split('?', 1)[0].rstrip('/')}"
    if value:
        return f"https://www.facebook.com/groups/{value.strip('/')}"
    return ""


def _friendly_automation_error(error: Exception | str) -> dict[str, str]:
    """Convert verbose Selenium errors into stable messages for logs/history."""
    raw = str(error or "").strip()
    lowered = raw.lower()
    mappings = (
        (
            ("element click intercepted", "not clickable at point", "other element would receive the click"),
            "ELEMENT_CLICK_INTERCEPTED",
            "Popup hoặc lớp phủ Facebook đang che ô thao tác; hệ thống đã thử đóng popup nhưng chưa thể tiếp tục.",
        ),
        (
            ("không tìm thấy ô bình luận", "không tìm thấy khung nhập bình luận"),
            "COMMENT_BOX_NOT_FOUND",
            "Không tìm thấy ô bình luận của bài viết đầu tiên; bài viết có thể đã tắt hoặc giới hạn bình luận.",
        ),
        (
            ("stale element reference",),
            "STALE_ELEMENT",
            "Giao diện Facebook vừa thay đổi trong lúc thao tác; vui lòng chạy lại nhóm này.",
        ),
        (
            ("invalid session id", "session deleted", "disconnected"),
            "BROWSER_SESSION_LOST",
            "Phiên Chrome đã mất kết nối trong lúc thực hiện tác vụ.",
        ),
    )
    for needles, code, message in mappings:
        if any(needle in lowered for needle in needles):
            return {"message": message, "error_code": code, "error_detail": message}

    # Selenium thường nối hàng trăm dòng Stacktrace vào message. Chỉ giữ phần
    # mô tả đầu tiên để lịch sử tác vụ không bị vỡ giao diện.
    concise = raw.split("Stacktrace:", 1)[0].strip()
    concise = concise.removeprefix("Message:").strip()
    concise = " ".join(concise.split())
    if len(concise) > 500:
        concise = f"{concise[:497]}..."
    concise = concise or "Không thể hoàn thành thao tác Facebook"
    return {"message": concise, "error_code": "AUTOMATION_ERROR", "error_detail": concise}


_SENSITIVE_CONFIG_KEYS = {
    "api_key",
    "access_token",
    "token",
    "cookie",
    "password",
    "pass_mail",
    "two_fa",
    "two_factor_secret",
}


def _safe_config(value: Any) -> Any:
    """Copy campaign configuration without authentication secrets."""
    if isinstance(value, dict):
        return {
            str(key): _safe_config(item)
            for key, item in value.items()
            if str(key).lower() not in _SENSITIVE_CONFIG_KEYS
        }
    if isinstance(value, list):
        return [_safe_config(item) for item in value]
    if isinstance(value, tuple):
        return [_safe_config(item) for item in value]
    return value


@dataclass
class CampaignJob:
    id: str
    owner: str | None
    payload: dict[str, Any]
    status: str = "QUEUED"
    message: str = "Đang chờ khởi tạo chiến dịch"
    total: int = 0
    completed: int = 0
    total_steps: int = 0
    completed_steps: int = 0
    success: int = 0
    failed: int = 0
    skipped: int = 0
    joined: int = 0
    already_member: int = 0
    pending_approval: int = 0
    started_at: str | None = None
    finished_at: str | None = None
    logs: list[dict[str, str]] = field(default_factory=list)
    results: list[dict[str, Any]] = field(default_factory=list)
    campaign_id: str | None = None
    run_number: int = 1
    cancel: threading.Event = field(default_factory=threading.Event, repr=False)
    lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

    def log(self, level: LogLevel | str, message: str) -> None:
        try:
            lvl = level.value if isinstance(level, LogLevel) else LogLevel(str(level).upper()).value
        except (ValueError, AttributeError):
            return  # Chỉ ghi nhận các log level đã định nghĩa trong LogLevel
        with self.lock:
            entry = {
                "time": datetime.now().isoformat(timespec="seconds"),
                "level": lvl,
                "message": message,
            }
            self.logs.append(entry)
            self.message = message

    def public(self) -> dict[str, Any]:
        with self.lock:
            percent = round(self.completed_steps * 100 / self.total_steps) if self.total_steps else 0
            return {
                "campaign_id": self.campaign_id,
                "run_number": self.run_number,
                "action_type": str(self.payload.get("action_type") or "POST").upper(),
                "job_id": self.id,
                "status": self.status,
                "message": self.message,
                "total": self.total,
                "completed": self.completed,
                "total_steps": self.total_steps,
                "completed_steps": self.completed_steps,
                "success": self.success,
                "failed": self.failed,
                "skipped": self.skipped,
                "joined": self.joined,
                "already_member": self.already_member,
                "pending_approval": self.pending_approval,
                "progress": percent,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "logs": list(self.logs),
                "results": list(self.results[-50:]),
            }


class FacebookGroupPoster:
    """One account browser session; each instance is used by one worker thread."""

    def __init__(self, account: dict[str, Any], cancel: threading.Event, log: Callable[[str, str], None]):
        self.account = account
        self.cancel = cancel
        self.log = log
        self.driver = None
        self.profile_lock = None

    def __enter__(self):
        from modules.module_02_account_manager.automation import create_driver, ensure_logged_in, get_profile_lock
        from modules.module_02_account_manager.security.encryption import decrypt_data

        uid = self.account["uid"]
        self.profile_lock = get_profile_lock(uid)
        if not self.profile_lock.acquire(blocking=False):
            raise RuntimeError("Profile đang được một tác vụ khác sử dụng")
        try:
            self.driver = create_driver(
                uid=uid, proxy=self.account.get("proxy"), scope="group-spam",
                on_log=lambda level, message: self.log(level, f"[{uid}] {message}"),
            )
            password = decrypt_data(self.account.get("password") or "")
            two_fa = decrypt_data(self.account.get("two_fa") or "")
            login = ensure_logged_in(
                self.driver, uid=uid, password=password, two_fa=two_fa,
                cookie=self.account.get("cookie") or "",
            )
            if not login.get("success"):
                raise RuntimeError(login.get("error") or "Không thể đăng nhập Facebook")
            return self
        except Exception:
            self.close()
            raise

    def __exit__(self, *_):
        self.close()

    def close(self):
        if self.driver is not None:
            try:
                from modules.module_02_account_manager.automation import close_driver_for_uid
                close_driver_for_uid(self.account["uid"])
            except Exception:
                try:
                    self.driver.quit()
                except Exception:
                    pass
            self.driver = None
        if self.profile_lock is not None:
            try:
                self.profile_lock.release()
            except RuntimeError:
                pass
            self.profile_lock = None

    def _dismiss_open_dialog(self) -> None:
        """Close a Facebook composer/dialog when a stop is requested mid-action."""
        if self.driver is None:
            return
        try:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.common.keys import Keys

            body = self.driver.find_element(By.TAG_NAME, "body")
            body.send_keys(Keys.ESCAPE)
            time.sleep(0.2)
            # Facebook may show a second confirmation asking to discard the draft.
            discard_xpath = (
                "//*[@role='button' and (normalize-space(.)='Bỏ' or "
                "normalize-space(.)='Bỏ bài viết' or normalize-space(.)='Discard' or "
                "contains(@aria-label,'Bỏ bài viết') or contains(@aria-label,'Discard'))]"
            )
            buttons = [button for button in self.driver.find_elements(By.XPATH, discard_xpath) if button.is_displayed()]
            if buttons:
                self.driver.execute_script("arguments[0].click()", buttons[0])
            else:
                body.send_keys(Keys.ESCAPE)
        except Exception:
            pass

    def _dismiss_group_join_overlays(self) -> bool:
        """Close Facebook welcome/questions overlays left after joining a group."""
        if self.driver is None:
            return False
        try:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.common.keys import Keys

            driver = self.driver
            markers = (
                "welcome to", "chào mừng", "group rules", "quy tắc nhóm",
                "answer questions", "membership questions", "câu hỏi thành viên",
            )
            dialogs = [
                item for item in driver.find_elements(By.XPATH, "//*[@role='dialog']")
                if self._is_displayed(item)
            ]
            dismissed = False
            for dialog in dialogs:
                try:
                    dialog_text = (dialog.text or "").lower()
                except Exception:
                    dialog_text = ""
                if not any(marker in dialog_text for marker in markers):
                    continue

                close_xpath = (
                    ".//*[@role='button' and (contains(@aria-label,'Đóng') or "
                    "contains(@aria-label,'Close') or contains(@aria-label,'Dismiss'))] | "
                    ".//button[contains(@aria-label,'Đóng') or contains(@aria-label,'Close')]"
                )
                close_button = next(
                    (button for button in dialog.find_elements(By.XPATH, close_xpath) if self._is_visible(button)),
                    None,
                )
                if close_button is not None:
                    driver.execute_script("arguments[0].click()", close_button)
                else:
                    driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
                dismissed = True

            if dismissed:
                self._wait_until(
                    lambda: not any(
                        self._is_displayed(item)
                        and any(marker in ((item.text or "").lower()) for marker in markers)
                        for item in driver.find_elements(By.XPATH, "//*[@role='dialog']")
                    ),
                    5,
                    "Không thể đóng popup chào mừng của nhóm",
                )
            return dismissed
        except InterruptedError:
            raise
        except Exception:
            return False

    def _raise_if_cancelled(self) -> None:
        if self.cancel.is_set():
            self._dismiss_open_dialog()
            self.log("WARNING", f"[{self.account['uid']}] Đã đóng popup và dừng thao tác hiện tại")
            raise InterruptedError("Chiến dịch đã được yêu cầu dừng")

    def _wait_until(self, condition: Callable[[], Any], timeout: float, error: str):
        """A cancellable replacement for long Selenium waits."""
        deadline = time.monotonic() + timeout
        last_error = None
        while time.monotonic() < deadline:
            self._raise_if_cancelled()
            try:
                value = condition()
                if value:
                    return value
            except Exception as exc:
                last_error = exc
            if self.cancel.wait(0.25):
                self._raise_if_cancelled()
        if last_error:
            raise RuntimeError(f"{error} ({last_error.__class__.__name__})") from last_error
        raise RuntimeError(error)

    @staticmethod
    def _is_visible(element) -> bool:
        try:
            return bool(element.is_displayed() and element.is_enabled())
        except Exception:
            return False

    @staticmethod
    def _is_displayed(element) -> bool:
        try:
            return bool(element.is_displayed())
        except Exception:
            return False

    @staticmethod
    def _element_is_hidden(element) -> bool:
        try:
            return not element.is_displayed()
        except Exception:
            # A stale dialog means Facebook removed it from the DOM.
            return True

    def join_group(self, group: dict[str, Any]) -> dict[str, Any]:
        """Open a group and join it when needed before the posting stage."""
        from selenium.webdriver.common.by import By

        self._raise_if_cancelled()
        url = _group_url(group)
        if not url:
            raise ValueError("Link nhóm không hợp lệ")
        driver = self.driver
        driver.get(url)
        self._wait_until(
            lambda: driver.execute_script("return document.readyState") == "complete",
            25,
            "Facebook tải trang nhóm quá lâu",
        )
        if any(part in (driver.current_url or "").lower() for part in ("checkpoint", "/login", "two_step")):
            raise RuntimeError("Tài khoản bị đăng xuất hoặc checkpoint")

        join_xpath = (
            "//*[@role='button' and (contains(@aria-label,'Tham gia nhóm') or "
            "contains(@aria-label,'Join group') or normalize-space(.)='Tham gia nhóm' or "
            "normalize-space(.)='Join group' or normalize-space(.)='Tham gia')]"
        )
        buttons = [b for b in driver.find_elements(By.XPATH, join_xpath) if self._is_displayed(b)]
        if not buttons:
            return {"status": "ALREADY_MEMBER", "message": "Tài khoản đã là thành viên nhóm"}

        try:
            driver.execute_script("arguments[0].click()", buttons[0])
        except Exception:
            pass
        if self.cancel.wait(2):
            self._raise_if_cancelled()

        dialogs = [d for d in driver.find_elements(By.XPATH, "//div[@role='dialog']") if self._is_displayed(d)]
        if dialogs:
            try:
                dialog_text = " ".join((d.text or "").lower() for d in dialogs)
                question_markers = ("trả lời câu hỏi", "answer questions", "câu hỏi thành viên", "membership questions")
                if any(marker in dialog_text for marker in question_markers):
                    self._dismiss_group_join_overlays()
                    return {"status": "REQUIRES_ANSWERS", "message": "Nhóm yêu cầu trả lời câu hỏi tham gia"}
            except Exception:
                pass

        pending_xpath = (
            "//*[@role='button' and (contains(@aria-label,'Hủy yêu cầu') or "
            "contains(@aria-label,'Cancel request') or contains(.,'Đang chờ') or "
            "contains(.,'Pending'))]"
        )
        if any(self._is_displayed(b) for b in driver.find_elements(By.XPATH, pending_xpath)):
            return {"status": "PENDING_APPROVAL", "message": "Đã gửi yêu cầu, đang chờ quản trị viên duyệt"}

        remaining = [b for b in driver.find_elements(By.XPATH, join_xpath) if self._is_displayed(b)]
        if remaining:
            raise RuntimeError("Facebook chưa xác nhận thao tác tham gia nhóm")
        self._dismiss_group_join_overlays()
        return {"status": "JOINED", "message": "Tham gia nhóm thành công"}

    def post(self, group: dict[str, Any], content: str, media: list[str]) -> dict[str, Any]:
        from selenium.webdriver.common.by import By

        self._raise_if_cancelled()
        url = _group_url(group)
        if not url:
            raise ValueError("Link nhóm không hợp lệ")
        driver = self.driver
        driver.get(url)
        self._wait_until(
            lambda: driver.execute_script("return document.readyState") == "complete",
            25,
            "Facebook tải trang nhóm quá lâu",
        )
        if any(part in (driver.current_url or "").lower() for part in ("checkpoint", "/login", "two_step")):
            raise RuntimeError("Tài khoản bị đăng xuất hoặc checkpoint")
        self._dismiss_group_join_overlays()

        opener_xpath = (
            "//div[@role='button'][contains(@aria-label,'Bạn viết gì') or "
            "contains(@aria-label,'Write something') or contains(@aria-label,'Tạo bài viết') or "
            "contains(.,'Bạn viết gì') or contains(.,'Write something')]"
        )

        def open_dialog():
            try:
                elements = driver.find_elements(By.XPATH, opener_xpath)
                for el in elements:
                    if self._is_visible(el):
                        driver.execute_script("arguments[0].click()", el)
                        return True
            except Exception:
                pass
            return False

        self._wait_until(open_dialog, 25, "Không tìm thấy nút mở popup đăng bài")

        self._wait_until(
            lambda: next((element for element in driver.find_elements(By.XPATH, "//div[@role='dialog']")
                          if self._is_displayed(element)), None),
            15,
            "Popup đăng bài không xuất hiện",
        )

        # Facebook thường thay toàn bộ node dialog sau animation. Mỗi lần retry phải
        # query lại từ driver, không giữ WebElement dialog/textbox cũ.
        textbox_xpath = (
            "//div[@role='dialog']//*[@contenteditable='true' and "
            "(@role='textbox' or @data-lexical-editor='true' or "
            """contains(@aria-label,'Bạn đang nghĩ gì') or contains(@aria-label,"What's on your mind"))]"""
        )

        def insert_content():
            try:
                textbox = next((element for element in driver.find_elements(By.XPATH, textbox_xpath)
                                if self._is_visible(element)), None)
                if textbox is None:
                    return False
                textbox.click()
                self._raise_if_cancelled()
                driver.execute_script(
                    """
                    arguments[0].focus();
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(arguments[0]);
                    range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    document.execCommand('insertText', false, arguments[1]);
                    arguments[0].dispatchEvent(new InputEvent('input', {
                        bubbles: true, inputType: 'insertText', data: arguments[1]
                    }));
                    """,
                    textbox, content,
                )
                return True
            except Exception:
                return False

        self._wait_until(insert_content, 20, "Không tìm thấy hoặc không thể nhập nội dung trong popup")

        if media:
            resolved_media = []
            for item in media:
                try:
                    resolved_media.append(str(download_or_cache_media(item)))
                except Exception:
                    resolved_media.append(str(item))

            def upload_media():
                try:
                    inputs = driver.find_elements(By.XPATH, "//div[@role='dialog']//input[@type='file']")
                    if not inputs:
                        return False
                    inputs[-1].send_keys("\n".join(resolved_media))
                    return True
                except Exception:
                    return False

            self._wait_until(upload_media, 15, "Không tìm thấy vùng tải media của Facebook")
            if self.cancel.wait(2 + min(len(resolved_media) * 2, 8)):
                self._raise_if_cancelled()

        submit_xpath = (
            "//div[@role='dialog']//*[@role='button' and "
            "(@aria-label='Đăng' or @aria-label='Post' or normalize-space(.)='Đăng' or normalize-space(.)='Post') and "
            "not(@aria-disabled='true')]"
        )

        def click_submit():
            try:
                submit = next((element for element in driver.find_elements(By.XPATH, submit_xpath)
                               if self._is_visible(element)), None)
                if submit is None:
                    return False
                self._raise_if_cancelled()
                driver.execute_script("arguments[0].click()", submit)
                return True
            except Exception:
                return False

        self._wait_until(click_submit, 25, "Nút Đăng chưa sẵn sàng")

        def dialog_is_closed():
            dialogs = driver.find_elements(By.XPATH, "//div[@role='dialog']")
            return not any(self._is_displayed(d) for d in dialogs)

        self._wait_until(dialog_is_closed, 35, "Facebook chưa đóng popup sau khi gửi bài")

        result_url = url
        content_marker = " ".join(content.split())[:80].lower()

        def find_post_permalink():
            try:
                articles = driver.find_elements(By.XPATH, "//div[@role='feed']//div[@role='article'] | //div[@role='article']")
                for article in articles:
                    if not self._is_displayed(article):
                        continue
                    article_text = " ".join((article.text or "").split()).lower()
                    if content_marker and content_marker not in article_text:
                        continue
                    links = article.find_elements(
                        By.XPATH,
                        ".//a[contains(@href,'/posts/') or contains(@href,'/permalink/') or contains(@href,'story_fbid=')]",
                    )
                    for link in links:
                        href = link.get_attribute("href")
                        if href:
                            return str(href).split("?", 1)[0]
            except Exception:
                return None
            return None

        try:
            result_url = self._wait_until(find_post_permalink, 5, "Chưa lấy được liên kết bài vừa đăng")
        except RuntimeError:
            pass

        try:
            page_text = (driver.find_element(By.TAG_NAME, "body").text or "").lower()
            blocked = ("tạm thời bị chặn", "temporarily blocked", "giới hạn tần suất", "try again later")
            if any(message in page_text for message in blocked):
                raise RuntimeError("Facebook đang giới hạn thao tác đăng bài của tài khoản")
        except Exception:
            pass
        return {
            "status": "SUCCESS",
            "message": "Đăng bài thành công",
            "group_url": url,
            "result_url": result_url,
        }


    def comment(
        self,
        group: dict[str, Any],
        content: str,
        media: list[str],
        *,
        auto_like: bool = False,
    ) -> dict[str, Any]:
        """Comment on the first visible post of a Facebook group."""
        from selenium.webdriver.common.by import By
        from selenium.webdriver.common.keys import Keys

        self._raise_if_cancelled()
        url = _group_url(group)
        if not url:
            raise ValueError("Link nhóm không hợp lệ")
        driver = self.driver
        driver.get(url)
        self._wait_until(
            lambda: driver.execute_script("return document.readyState") == "complete",
            25,
            "Facebook tải trang nhóm quá lâu",
        )
        if any(part in (driver.current_url or "").lower() for part in ("checkpoint", "/login", "two_step")):
            raise RuntimeError("Tài khoản bị đăng xuất hoặc checkpoint")
        self._dismiss_group_join_overlays()

        article_xpath = "//div[@role='feed']//div[@role='article'] | //div[@role='article']"
        post_marker_xpath = (
            ".//a[contains(@href,'/posts/') or contains(@href,'/permalink/') or "
            "contains(@href,'story_fbid=')] | "
            ".//*[@role='button' and (contains(@aria-label,'Bình luận') or "
            "contains(@aria-label,'Comment') or normalize-space(.)='Bình luận' or "
            "normalize-space(.)='Comment')]"
        )

        def find_first_article():
            visible = [item for item in driver.find_elements(By.XPATH, article_xpath) if self._is_displayed(item)]
            # role=article còn được Facebook dùng cho thẻ giới thiệu và một số khối
            # phụ. Ưu tiên article có permalink hoặc điều khiển bình luận để lấy
            # đúng bài viết đầu tiên trong feed.
            for item in visible:
                try:
                    if item.find_elements(By.XPATH, post_marker_xpath):
                        return item
                except Exception:
                    continue
            return visible[0] if visible else None

        article = self._wait_until(
            find_first_article,
            30,
            "Không tìm thấy bài viết đầu tiên trong nhóm",
        )
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", article)
        self._raise_if_cancelled()

        permalink = driver.current_url or url
        try:
            post_links = article.find_elements(
                By.XPATH,
                ".//a[contains(@href,'/posts/') or contains(@href,'/permalink/') or "
                "contains(@href,'story_fbid=')]",
            )
            permalink = next(
                (link.get_attribute("href") for link in post_links if link.get_attribute("href")),
                permalink,
            )
        except Exception:
            pass

        if auto_like:
            try:
                article = find_first_article() or article
                like_xpath = (
                    ".//*[@role='button' and @aria-pressed='false' and "
                    "(@aria-label='Thích' or @aria-label='Like' or "
                    "starts-with(@aria-label,'Thích ') or starts-with(@aria-label,'Like '))]"
                )
                like_button = next(
                    (item for item in article.find_elements(By.XPATH, like_xpath) if item.is_displayed()),
                    None,
                )
                if like_button:
                    driver.execute_script("arguments[0].click()", like_button)
                    if self.cancel.wait(0.5):
                        self._raise_if_cancelled()
            except InterruptedError:
                raise
            except Exception:
                self.log("WARNING", f"[{self.account['uid']}] Không thể tự động thích bài đầu tiên")

        textbox_xpaths = (
            ".//*[@data-lexical-editor='true' and @role='textbox']",
            ".//*[@role='textbox' and (contains(@aria-label,'Viết bình luận') or "
            "contains(@aria-label,'Bình luận dưới tên') or contains(@aria-label,'Bình luận') or "
            "contains(@aria-label,'Write a comment') or contains(@aria-label,'Comment as') or "
            "contains(@aria-placeholder,'Bình luận') or contains(@aria-placeholder,'Comment'))]",
            ".//*[@role='textbox' and @contenteditable='true']",
            ".//*[@contenteditable='true' and @data-lexical-editor='true']",
            ".//form[contains(@action,'comment')]//*[@contenteditable='true']",
            ".//textarea[contains(@placeholder,'Bình luận') or contains(@placeholder,'comment') or "
            "contains(@aria-label,'Bình luận') or contains(@aria-label,'Comment')]",
        )

        def resolve_article():
            try:
                if self._is_displayed(article):
                    return article
            except Exception:
                pass
            return find_first_article()

        def find_textbox():
            current_article = resolve_article()
            if current_article is None:
                return None
            for textbox_xpath in textbox_xpaths:
                try:
                    textbox = next(
                        (item for item in current_article.find_elements(By.XPATH, textbox_xpath)
                         if self._is_visible(item)),
                        None,
                    )
                    if textbox is not None:
                        return textbox
                except Exception:
                    continue
            # Một số phiên bản Facebook render editor bình luận qua portal nên
            # textbox không còn là con trực tiếp của role=article.
            global_comment_xpath = (
                "//*[@role='textbox' and (contains(@aria-label,'Viết bình luận') or "
                "contains(@aria-label,'Bình luận dưới tên') or contains(@aria-label,'Write a comment') or "
                "contains(@aria-label,'Comment as') or contains(@aria-placeholder,'Bình luận') or "
                "contains(@aria-placeholder,'Comment'))] | "
                "//textarea[contains(@placeholder,'Bình luận') or contains(@placeholder,'comment')]"
            )
            try:
                global_textbox = next(
                    (item for item in driver.find_elements(By.XPATH, global_comment_xpath) if self._is_visible(item)),
                    None,
                )
                if global_textbox is not None:
                    return global_textbox
            except Exception:
                pass
            # Fallback cho các biến thể DOM mới của Lexical Editor không còn
            # role=textbox hoặc aria-label như trước.
            try:
                return driver.execute_script(
                    """
                    const root = arguments[0];
                    const selectors = [
                      '[data-lexical-editor="true"][contenteditable="true"]',
                      '[role="textbox"][contenteditable="true"]',
                      '[role="textbox"][aria-placeholder]',
                      'form[action*="comment"] [contenteditable="true"]',
                      'textarea[placeholder]'
                    ];
                    for (const selector of selectors) {
                      const element = root.querySelector(selector);
                      if (element && element.getClientRects().length) return element;
                    }
                    return null;
                    """,
                    current_article,
                )
            except Exception:
                return None

        textbox = find_textbox()
        if textbox is None:
            article = resolve_article() or article
            comment_button_xpath = (
                ".//*[@role='button' and "
                "(contains(@aria-label,'Bình luận') or contains(@aria-label,'Comment') or "
                "contains(@aria-label,'Viết bình luận') or contains(@aria-label,'Write a comment') or "
                "contains(@aria-label,'Để lại bình luận') or normalize-space(.)='Bình luận' or "
                "normalize-space(.)='Comment')] | "
                ".//span[normalize-space(.)='Bình luận' or normalize-space(.)='Comment']"
                "/ancestor::*[@role='button'][1]"
            )
            button = next(
                (item for item in article.find_elements(By.XPATH, comment_button_xpath)
                 if item.is_displayed() and item.is_enabled()),
                None,
            )
            if button:
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", button)
                driver.execute_script("arguments[0].click()", button)
            textbox = self._wait_until(
                find_textbox,
                20,
                "Không tìm thấy ô bình luận của bài viết đầu tiên",
            )

        try:
            textbox.click()
        except Exception:
            # Popup chào mừng sau khi vừa tham gia nhóm có thể phủ lên editor
            # dù Selenium vẫn tìm thấy textbox phía sau lớp overlay.
            if not self._dismiss_group_join_overlays():
                self._dismiss_open_dialog()
            try:
                textbox = self._wait_until(
                    find_textbox,
                    5,
                    "Ô bình luận không còn khả dụng sau khi đóng popup",
                )
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", textbox)
                try:
                    textbox.click()
                except Exception:
                    driver.execute_script("arguments[0].click(); arguments[0].focus();", textbox)
            except Exception as exc:
                raise RuntimeError(
                    "Popup hoặc lớp phủ Facebook đang che ô bình luận, không thể thao tác"
                ) from exc
        def textbox_value(element) -> str:
            try:
                return str(
                    element.text
                    or element.get_attribute("textContent")
                    or element.get_attribute("value")
                    or ""
                ).strip()
            except Exception:
                return ""

        def replace_textbox_content(element) -> None:
            """Replace editor content once using keyboard events understood by Lexical."""
            try:
                element.click()
            except Exception:
                driver.execute_script("arguments[0].focus();", element)
            try:
                element.send_keys(Keys.CONTROL + "a")
                element.send_keys(Keys.BACKSPACE)
                element.send_keys(content)
            except Exception as exc:
                raise RuntimeError("Không thể nhập nội dung vào ô bình luận") from exc

        self._raise_if_cancelled()
        replace_textbox_content(textbox)
        if textbox_value(textbox) != content.strip():
            raise RuntimeError("Facebook không nhận nội dung bình luận")

        if media:
            media_paths: list[str] = []
            for item in media:
                try:
                    media_path = download_or_cache_media(item)
                except Exception:
                    media_path = Path(str(item)).expanduser().resolve()
                if not media_path.is_file():
                    raise RuntimeError(f"Tệp media không còn tồn tại: {media_path.name}")
                media_paths.append(str(media_path))

            media_button_xpath = (
                ".//*[@role='button' and ("
                "contains(translate(@aria-label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'photo') or "
                "contains(translate(@aria-label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'image') or "
                "contains(@aria-label,'ảnh') or contains(@aria-label,'Ảnh') or "
                "contains(translate(@aria-label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'video'))]"
            )

            def find_comment_media_input(current_textbox, current_article):
                # Facebook thường đặt input ẩn cạnh editor, không phải lúc nào
                # cũng là con trực tiếp của role=article.
                try:
                    nearby_input = driver.execute_script(
                        """
                        let node = arguments[0];
                        for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
                          const input = node.querySelector(
                            'input[type="file"][accept*="image"], input[type="file"][accept*="video"], input[type="file"]'
                          );
                          if (input) return input;
                        }
                        return null;
                        """,
                        current_textbox,
                    )
                    if nearby_input is not None:
                        return nearby_input
                except Exception:
                    pass
                try:
                    article_inputs = current_article.find_elements(By.XPATH, ".//input[@type='file']")
                    if article_inputs:
                        return article_inputs[-1]
                except Exception:
                    pass
                return None

            def upload_comment_media():
                current_article = resolve_article()
                if current_article is None:
                    return False
                current_textbox = find_textbox()
                if current_textbox is None:
                    return False
                media_input = find_comment_media_input(current_textbox, current_article)
                if media_input is None:
                    try:
                        media_button = next(
                            (
                                item
                                for item in current_article.find_elements(By.XPATH, media_button_xpath)
                                if self._is_visible(item)
                            ),
                            None,
                        )
                        if media_button is not None:
                            driver.execute_script("arguments[0].click();", media_button)
                            media_input = find_comment_media_input(current_textbox, current_article)
                    except Exception:
                        media_input = None
                if media_input is None:
                    return False
                try:
                    supports_multiple = media_input.get_attribute("multiple") is not None
                except Exception:
                    supports_multiple = False
                selected_paths = media_paths if supports_multiple else media_paths[:1]
                media_input.send_keys("\n".join(selected_paths))
                if len(selected_paths) < len(media_paths):
                    self.log(
                        "WARNING",
                        f"[{self.account['uid']}] Ô ảnh bình luận chỉ nhận một tệp; đã dùng {Path(selected_paths[0]).name}",
                    )
                return True

            self._wait_until(
                upload_comment_media,
                15,
                "Không tìm thấy vùng tải media của bình luận",
            )
            if self.cancel.wait(2 + min(len(media_paths) * 2, 8)):
                self._raise_if_cancelled()

        self._raise_if_cancelled()
        textbox = self._wait_until(
            find_textbox,
            10,
            "Ô bình luận không còn khả dụng trước khi gửi",
        )
        if textbox_value(textbox) != content.strip():
            replace_textbox_content(textbox)
        textbox.send_keys(Keys.ENTER)

        def comment_submitted():
            try:
                value = textbox_value(textbox)
                if not value:
                    return True
            except Exception:
                return True
            try:
                current_article = resolve_article()
                return bool(current_article and content.strip() in (current_article.text or ""))
            except Exception:
                return False

        self._wait_until(comment_submitted, 25, "Facebook chưa xác nhận bình luận")
        page_text = (driver.find_element(By.TAG_NAME, "body").text or "").lower()
        blocked = ("tạm thời bị chặn", "temporarily blocked", "giới hạn tần suất", "try again later")
        if any(message in page_text for message in blocked):
            raise RuntimeError("Facebook đang giới hạn thao tác bình luận của tài khoản")
        return {
            "status": "SUCCESS",
            "message": "Bình luận bài viết đầu tiên thành công",
            "result_url": str(permalink).split("?", 1)[0],
        }


class CampaignManager:
    def __init__(self, poster_factory=FacebookGroupPoster, persistence=None):
        if persistence is None:
            from .cloud_history import cloud_history

            persistence = cloud_history
        self.poster_factory = poster_factory
        self.persistence = persistence
        self.jobs: dict[str, CampaignJob] = {}
        self.active_by_owner: dict[str | None, str] = {}
        self.lock = threading.RLock()

    def start(self, payload: dict[str, Any], owner: str | None) -> dict[str, Any]:
        with self.lock:
            terminal_ids = [job_id for job_id, item in self.jobs.items() if item.status in TERMINAL_STATES]
            for stale_id in terminal_ids[:-100]:
                self.jobs.pop(stale_id, None)
            active_id = self.active_by_owner.get(owner)
            active = self.jobs.get(active_id) if active_id else None
            if active and active.status not in TERMINAL_STATES:
                raise RuntimeError("Đang có một chiến dịch nhóm chạy cho tài khoản này")
            job = CampaignJob(id=str(uuid.uuid4()), owner=owner, payload=payload)
            self.jobs[job.id] = job
            self.active_by_owner[owner] = job.id
        job.log(
            "INFO",
            f"Đã tiếp nhận chiến dịch: {len(payload.get('account_uids') or [])} tài khoản, "
            f"{len(payload.get('groups') or [])} nhóm.",
        )
        try:
            self._initialize_persistence(job)
        except Exception:
            with self.lock:
                self.jobs.pop(job.id, None)
                if self.active_by_owner.get(owner) == job.id:
                    self.active_by_owner.pop(owner, None)
            raise
        accepted = job.public()
        threading.Thread(target=self._run, args=(job,), name=f"group-campaign-{job.id[:8]}", daemon=True).start()
        return accepted

    def get(self, job_id: str, owner: str | None) -> dict[str, Any] | None:
        with self.lock:
            job = self.jobs.get(job_id)
        return job.public() if job and job.owner == owner else None

    def current(self, owner: str | None) -> dict[str, Any] | None:
        with self.lock:
            job_id = self.active_by_owner.get(owner)
        return self.get(job_id, owner) if job_id else None

    def stop(self, job_id: str, owner: str | None) -> dict[str, Any] | None:
        with self.lock:
            job = self.jobs.get(job_id)
        if not job or job.owner != owner:
            return None
        if job.status not in TERMINAL_STATES:
            job.cancel.set()
            with job.lock:
                job.status = "STOPPING"
            self._sync_run(job)
            job.log("WARNING", "Đang dừng chiến dịch sau thao tác hiện tại")
        return job.public()

    @staticmethod
    def _load_accounts(uids: list[str], owner: str | None) -> dict[str, dict[str, Any]]:
        from modules.module_02_account_manager.database.connection import SessionLocal
        from modules.module_02_account_manager.database.repository import AccountRepository
        with owner_scope(owner), SessionLocal() as session:
            result = {}
            for uid in uids:
                account = AccountRepository.get_by_uid(session, uid)
                if account:
                    result[uid] = {
                        "id": account.id, "uid": account.uid, "profile_name": account.profile_name,
                        "password": account.password,
                        "two_fa": account.two_fa, "cookie": account.cookie, "proxy": account.proxy,
                    }
            return result

    @staticmethod
    def _wait(cancel: threading.Event, seconds: float) -> bool:
        return cancel.wait(max(0, seconds))

    def _initialize_persistence(self, job: CampaignJob) -> None:
        action_type = str(job.payload.get("action_type") or "POST").upper()
        campaign_name = str(
            job.payload.get("name")
            or job.payload.get("campaign_name")
            or f"{action_type} {job.id}"
        )[:200]
        campaign_id, run_number = self.persistence.initialize_run(
            run_id=job.id,
            requested_campaign_id=job.payload.get("campaign_id"),
            owner=job.owner,
            campaign_name=campaign_name,
            description=job.payload.get("description"),
            action_type=action_type,
            config=_safe_config(job.payload),
        )
        job.campaign_id = campaign_id
        job.run_number = run_number

    def _sync_run(self, job: CampaignJob, config: dict[str, Any] | None = None) -> None:
        self.persistence.update_run(
            job.id,
            status=job.status,
            total_planned=job.total,
            total_success=job.success,
            total_failed=job.failed,
            total_skipped=job.skipped,
            started_at=job.started_at,
            finished_at=job.finished_at,
            config=config,
        )

    def _run(self, job: CampaignJob) -> None:
        payload = job.payload
        settings = payload.get("settings") or {}
        try:
            job.log("INFO", "Đang kiểm tra tài khoản và chuẩn bị các phiên Chrome...")
            uids = list(dict.fromkeys(str(uid) for uid in payload.get("account_uids") or [] if uid))
            accounts = self._load_accounts(uids, job.owner)
            missing = [uid for uid in uids if uid not in accounts]
            if missing:
                raise ValueError(f"Không tìm thấy hoặc không có quyền với tài khoản: {', '.join(missing)}")
            groups = [g for g in payload.get("groups") or [] if _group_url(g)]
            posts = [html_to_facebook_text(p) for p in payload.get("posts") or []]
            posts = [p for p in posts if p]
            if not accounts or not groups or not posts:
                raise ValueError("Chiến dịch cần ít nhất một tài khoản, một nhóm và một nội dung")

            # Keep each account's work together so its browser completes every
            # selected group before the next account is opened.
            tasks = [(uid, group) for uid in uids for group in groups]
            max_posts = max(1, int(settings.get("max_posts") or len(tasks)))
            tasks = tasks[:max_posts]
            per_account: dict[str, list[dict[str, Any]]] = {uid: [] for uid in uids}
            for uid, group in tasks:
                per_account[uid].append(group)
            per_account = {uid: items for uid, items in per_account.items() if items}
            job.total = len(tasks)
            job.total_steps = len(tasks) * 2
            self._sync_run(job)

            schedule_at = settings.get("schedule_at")
            if schedule_at:
                target = datetime.fromisoformat(schedule_at)
                seconds = (target - datetime.now(target.tzinfo)).total_seconds()
                if seconds > 0:
                    job.status = "SCHEDULED"
                    self._sync_run(job)
                    job.log("INFO", f"Đã lên lịch chạy lúc {target.strftime('%d/%m/%Y %H:%M')}")
                    while seconds > 0:
                        wait_chunk = min(seconds, 60)
                        if self._wait(job.cancel, wait_chunk):
                            raise InterruptedError()
                        seconds = (target - datetime.now(target.tzinfo)).total_seconds()

            job.status = "RUNNING"
            job.started_at = datetime.now().isoformat(timespec="seconds")
            self._sync_run(job)
            action_type = str(payload.get("action_type") or "POST").upper()
            action_label = "bình luận" if action_type == "COMMENT" else "đăng bài"
            job.log(
                "INFO",
                f"Bắt đầu {job.total} lượt tuần tự theo tài khoản: tham gia từng nhóm rồi {action_label} ngay",
            )
            for uid, items in per_account.items():
                if job.cancel.is_set():
                    break
                job.log("INFO", f"[{uid}] Bắt đầu xử lý {len(items)} nhóm")
                try:
                    self._run_account(job, accounts[uid], items)
                except InterruptedError:
                    break
                except Exception as exc:
                    job.log("ERROR", _friendly_automation_error(exc)["message"])
                if not job.cancel.is_set():
                    job.log("SUCCESS", f"[{uid}] Đã xử lý xong, chuẩn bị chuyển tài khoản tiếp theo")

            if job.cancel.is_set():
                job.status = "STOPPED"
                job.message = "Chiến dịch đã dừng theo yêu cầu"
                job.log("WARNING", "Chiến dịch đã dừng theo yêu cầu")
            elif (job.failed or job.skipped) and job.success:
                job.status = "PARTIAL"
                job.message = f"Hoàn tất một phần: {job.success} lượt {action_label} thành công, {job.failed} thất bại"
                job.log("SUCCESS", f"Chiến dịch đã hoàn thành! {job.success}/{job.total} lượt {action_label} thành công (Thất bại: {job.failed})")
            elif job.failed:
                job.status = "FAILED"
                job.message = f"Chiến dịch thất bại ({job.failed}/{job.total} lượt)"
                job.log("ERROR", f"Chiến dịch kết thúc: {job.message}")
            elif job.skipped:
                job.status = "PARTIAL"
                job.message = f"Đã xử lý: {job.success} lượt {action_label} thành công, {job.skipped} nhóm bỏ qua"
                job.log("SUCCESS", f"Chiến dịch đã hoàn thành! {job.success}/{job.total} lượt {action_label} thành công ({job.skipped} nhóm bỏ qua)")
            else:
                job.status = "COMPLETED"
                job.message = f"Đã {action_label} thành công {job.success}/{job.total} lượt"
                job.log("SUCCESS", f"Chiến dịch đã hoàn thành thành công! Tổng cộng {job.success}/{job.total} lượt {action_label}.")
        except InterruptedError:
            job.status = "STOPPED"
            job.message = "Chiến dịch đã dừng theo yêu cầu"
        except Exception as exc:
            job.status = "FAILED"
            job.log("ERROR", _friendly_automation_error(exc)["message"])
        finally:
            job.finished_at = datetime.now().isoformat(timespec="seconds")
            self._persist_final_results(job)

    def _run_account(self, job: CampaignJob, account: dict[str, Any], groups: list[dict[str, Any]]) -> None:
        settings = job.payload.get("settings") or {}
        posts = [html_to_facebook_text(p) for p in job.payload.get("posts") or [] if html_to_facebook_text(p)]
        media_pool = list(job.payload.get("media") or [])
        delay_min = max(0, int(settings.get("delay_min") or 0))
        delay_max = max(delay_min, int(settings.get("delay_max") or delay_min))
        min_media = max(0, int(settings.get("min_media") or 0))
        max_media = max(min_media, int(settings.get("max_media") or min_media))
        used: list[int] = []
        uid = account["uid"]
        join_results: list[dict[str, Any] | None] = [None] * len(groups)
        completed_actions: set[int] = set()

        try:
            with owner_scope(job.owner), self.poster_factory(account, job.cancel, job.log) as poster:
                for index, group in enumerate(groups):
                    if job.cancel.is_set():
                        raise InterruptedError()
                    group_name = group.get("name") or _group_key(group)
                    group_url = _group_url(group)
                    url_display = f" ({group_url})" if group_url else ""
                    job.log("INFO", f"[{uid}] Luồng tham gia: kiểm tra {group_name}{url_display}")
                    try:
                        join_result = poster.join_group(group)
                    except InterruptedError:
                        raise
                    except Exception as join_error:
                        join_result = {"status": "FAILED", **_friendly_automation_error(join_error)}
                        job.log("WARNING", f"[{uid}] Luồng tham gia lỗi nhưng luồng đăng vẫn tiếp tục")
                    join_results[index] = join_result
                    self._record_join_step(job, uid, group_name, join_result, group_url)

                    # A failed or pending join remains informational. The requested
                    # action is attempted immediately before moving to the next group.
                    choices = [i for i in range(len(posts)) if i not in used]
                    if not choices:
                        used.clear()
                        choices = list(range(len(posts)))
                    post_index = random.choice(choices) if settings.get("shuffle_content", True) else choices[0]
                    if settings.get("avoid_duplicate"):
                        used.append(post_index)
                    media_count = min(len(media_pool), random.randint(min_media, max_media)) if media_pool else 0
                    media = random.sample(media_pool, media_count) if media_count else []
                    local_media: list[str] = []
                    for item in media:
                        try:
                            loc = download_or_cache_media(item, job.campaign_id)
                            local_media.append(str(loc))
                        except Exception as m_exc:
                            job.log("WARNING", f"Không thể tải media {item}: {m_exc}")
                    try:
                        action_type = str(job.payload.get("action_type") or "POST").upper()
                        if action_type == "COMMENT":
                            job.log("INFO", f"[{uid}] Luồng bình luận: đang bình luận vào {group_name}{url_display}")
                            result = poster.comment(
                                group,
                                posts[post_index],
                                local_media,
                                auto_like=bool(settings.get("auto_like")),
                            )
                        else:
                            job.log("INFO", f"[{uid}] Luồng đăng: đang đăng bài vào {group_name}{url_display}")
                            result = poster.post(group, posts[post_index], local_media)
                        result["join_status"] = join_result["status"]
                        result["content"] = posts[post_index]
                        self._advance_step(job)
                        self._record_result(job, account, group, result)
                        completed_actions.add(index)

                        # Chạy xong luồng của 1 task vụ thì đồng bộ media của task đó lên Supabase Storage
                        if result.get("status") == "SUCCESS" and local_media:
                            for m_path in local_media:
                                try:
                                    upload_local_file_to_supabase(m_path, job.campaign_id or job.id)
                                except Exception as up_err:
                                    job.log("WARNING", f"Không thể lưu media sau task: {up_err}")
                    except InterruptedError:
                        raise
                    except Exception as exc:
                        error_info = _friendly_automation_error(exc)
                        self._advance_step(job)
                        self._record_result(job, account, group, {
                            "status": "FAILED", **error_info,
                            "join_status": join_result.get("status", "FAILED"),
                            "content": posts[post_index],
                        })
                        completed_actions.add(index)
                    if index < len(groups) - 1 and not job.cancel.is_set():
                        delay = random.randint(delay_min, delay_max)
                        job.log("INFO", f"[{uid}] Nghỉ {delay} giây trước nhóm tiếp theo")
                        if self._wait(job.cancel, delay):
                            raise InterruptedError()
        except InterruptedError:
            raise
        except Exception as exc:
            error_info = _friendly_automation_error(exc)
            job.log("ERROR", f"[{uid}] {error_info['message']}")
            if not job.cancel.is_set():
                for index, group in enumerate(groups):
                    if index in completed_actions:
                        continue
                    join_result = join_results[index]
                    self._advance_step(job, 1 if join_result is not None else 2)
                    self._record_result(job, account, group, {
                        "status": "FAILED",
                        **error_info,
                        "join_status": join_result.get("status") if join_result else "FAILED",
                    })

    @staticmethod
    def _advance_step(job: CampaignJob, count: int = 1) -> None:
        with job.lock:
            job.completed_steps = min(job.total_steps, job.completed_steps + count)

    @staticmethod
    def _record_join_step(
        job: CampaignJob, uid: str, group_name: str, result: dict[str, Any], group_url: str = ""
    ) -> None:
        status = result.get("status")
        if status == "FAILED" and not result.get("error_code"):
            normalized = _friendly_automation_error(result.get("message", ""))
            result = {**result, **normalized}
        with job.lock:
            job.completed_steps = min(job.total_steps, job.completed_steps + 1)
            if status == "JOINED":
                job.joined += 1
            elif status == "ALREADY_MEMBER":
                job.already_member += 1
            elif status == "PENDING_APPROVAL":
                job.pending_approval += 1
        level = "WARNING" if status in {"PENDING_APPROVAL", "REQUIRES_ANSWERS", "FAILED"} else "SUCCESS"
        url_part = f" ({group_url})" if group_url else ""
        job.log(level, f"[{uid}] {group_name}{url_part}: {result.get('message', '')}")

    def _record_result(
        self, job: CampaignJob, account: dict[str, Any], group: dict[str, Any], result: dict[str, Any]
    ) -> None:
        uid = account["uid"]
        status = str(result.get("status") or "FAILED").upper()
        if status not in {"SUCCESS", "PENDING_APPROVAL", "FAILED", "SKIPPED", "CANCELLED"}:
            status = "FAILED"
        if status == "FAILED" and not result.get("error_code"):
            result = {**result, **_friendly_automation_error(result.get("message", ""))}
        item = {
            "id": str(uuid.uuid4()),
            "account_uid": uid,
            "account_id": account.get("id"),
            "account_name": account.get("profile_name"),
            "group_key": _group_key(group),
            "group_name": group.get("name"),
            "group_url": _group_url(group),
            "status": status,
            "message": result.get("message", ""),
            "join_status": result.get("join_status"),
            "content": result.get("content"),
            "error_code": result.get("error_code"),
            "error_detail": result.get("error_detail"),
            "result_url": result.get("result_url") or result.get("group_url") or _group_url(group),
            "finished_at": datetime.now().isoformat(timespec="seconds"),
        }
        with job.lock:
            job.results.append(item)
            job.completed += 1
            if item["status"] == "SUCCESS":
                job.success += 1
            elif item["status"] == "SKIPPED":
                job.skipped += 1
            else:
                job.failed += 1
        self.persistence.record_task(job.id, item)
        self._sync_run(job)
        level = "SUCCESS" if item["status"] == "SUCCESS" else "WARNING" if item["status"] in {"SKIPPED", "PENDING_APPROVAL"} else "ERROR"
        target_url = item.get("result_url") or item.get("group_url") or _group_url(group)
        group_display = item["group_name"] or item["group_key"]
        url_part = f" ({target_url})" if target_url else ""
        job.log(level, f"[{uid}] {group_display}{url_part}: {item['message']}")

    def _persist_final_results(self, job: CampaignJob) -> None:
        """Finalize the PostgreSQL run summary and ensure campaign media is stored in Supabase Storage."""
        if job.status not in {"COMPLETED", "PARTIAL", "STOPPED", "CANCELLED", "FAILED"}:
            job.status = "FAILED"

        try:
            raw_media = list(job.payload.get("media") or [])
            if raw_media:
                cloud_media: list[str] = []
                for item in raw_media:
                    try:
                        res = upload_local_file_to_supabase(item, job.campaign_id or job.id)
                        cloud_url = res.get("url") or res.get("path") or str(item)
                        cloud_media.append(cloud_url)
                    except Exception as exc:
                        cloud_media.append(str(item))
                job.payload["media"] = cloud_media
        except Exception:
            pass

        self._sync_run(job, config=_safe_config(job.payload))


campaign_manager = CampaignManager()
