"""In-memory campaign runtime and Selenium group poster for Module 7."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
import logging
import re
from pathlib import Path
import random
import threading
import time
import unicodedata
import uuid
from typing import Any, Callable

from modules.module_02_account_manager.context import owner_scope
from ..core.constants import BLOCK_TAGS, TERMINAL_STATES, LogLevel
from .supabase_storage import download_or_cache_media, upload_local_file_to_supabase
from ..schemas.request import AccountDTO, GroupDTO
from ..schemas.response import GroupResponse

logger = logging.getLogger(__name__)

GroupItem = GroupDTO | GroupResponse | dict[str, Any]
AccountItem = AccountDTO | dict[str, Any]   


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

def _extract_group_field(group: GroupItem, *arg: str) -> str:
    for field in arg:
        if isinstance(group, dict):
            val = group.get(field)
        else:
            val = getattr(group, field, None)
        if val:
            return str(val).strip()
    return ""


def _group_key(group: GroupItem) -> str:
    return _extract_group_field(group, "key", "id", "url")


# xử lí URL nhóm
def _group_url(group: GroupItem) -> str:
    value = _extract_group_field(group, "url", "link", "key", "id")
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

    if "checkpoint" in lowered or "xác minh danh tính" in lowered:
        concise_cp = raw.split("Stacktrace:", 1)[0].strip()
        concise_cp = " ".join(concise_cp.split())
        fallback_msg = (
            "Tài khoản Facebook đang bị yêu cầu xác minh danh tính / bảo mật. "
            "Vui lòng đăng nhập trình duyệt để xác minh thủ công trước khi chạy lại."
        )
        return {
            "message": concise_cp or fallback_msg,
            "error_code": "CHECKPOINT",
            "error_detail": concise_cp or fallback_msg,
        }

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
    pending_actions: int = 0
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
                "pending_actions": self.pending_actions,
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

    def __init__(self, account: AccountItem, cancel: threading.Event, log: Callable[[str, str], None]):
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
        """Advance and dismiss Facebook welcome overlays left after joining a group."""
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
            dismissed = False
            welcome_flow_active = False
            for _ in range(6):
                dialogs = [
                    item for item in driver.find_elements(By.XPATH, "//*[@role='dialog']")
                    if self._is_displayed(item)
                ]
                matching = []
                for dialog in dialogs:
                    try:
                        dialog_text = (dialog.text or "").lower()
                    except Exception:
                        dialog_text = ""
                    if any(marker in dialog_text for marker in markers):
                        matching.append((dialog, dialog_text))
                if not matching:
                    if welcome_flow_active and dialogs:
                        matching = [(dialogs[-1], (dialogs[-1].text or "").lower())]
                    else:
                        return dismissed

                dismissed = True
                dialog, dialog_text = matching[0]
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
                    if self.cancel.wait(0.4):
                        self._raise_if_cancelled()
                    continue

                if "welcome to" in dialog_text or "chào mừng" in dialog_text:
                    welcome_flow_active = True
                if welcome_flow_active:
                    # Facebook's post-join welcome flow is a short wizard. Escape
                    # does not close it; advance its pages until Facebook removes it.
                    next_xpath = (
                        ".//*[@role='button' and (normalize-space(.)='Next' or "
                        "normalize-space(.)='Tiếp' or normalize-space(.)='Tiếp theo' or "
                        "normalize-space(.)='Continue' or normalize-space(.)='Hoàn tất' or "
                        "normalize-space(.)='Xong' or normalize-space(.)='Done' or "
                        "normalize-space(.)='Finish')]"
                    )
                    next_button = next(
                        (button for button in dialog.find_elements(By.XPATH, next_xpath) if self._is_visible(button)),
                        None,
                    )
                    if next_button is not None:
                        driver.execute_script("arguments[0].click()", next_button)
                        if self.cancel.wait(0.4):
                            self._raise_if_cancelled()
                        continue

                driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
                if self.cancel.wait(0.4):
                    self._raise_if_cancelled()

            # Do not let the poster continue behind a blocking welcome/questions modal.
            still_open = any(
                self._is_displayed(item)
                and any(marker in ((item.text or "").lower()) for marker in markers)
                for item in driver.find_elements(By.XPATH, "//*[@role='dialog']")
            )
            if still_open:
                raise RuntimeError("Facebook vẫn còn popup chào mừng/câu hỏi nhóm sau khi thử đóng")
            return dismissed
        except InterruptedError:
            raise
        except RuntimeError:
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



    def join_group(self, group: GroupItem) -> dict[str, Any]:
        """Open a group, request membership if needed, and wait for Facebook's confirmation."""
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

        already_joined_xpath = (
            "//*[@role='button' and (normalize-space(.)='Đã tham gia' or "
            "normalize-space(.)='Joined' or contains(@aria-label,'Đã tham gia') or "
            "contains(@aria-label,'Joined'))]"
        )
        pending_xpath = (
            "//*[@role='button' and (contains(@aria-label,'Hủy yêu cầu') or "
            "contains(@aria-label,'Cancel request') or contains(@aria-label,'Cancel Request') or "
            "contains(.,'Đang chờ') or contains(.,'Đã gửi yêu cầu') or contains(.,'Yêu cầu đã gửi') or "
            "contains(.,'Đã yêu cầu') or contains(.,'Request sent') or contains(.,'Request Sent') or "
            "contains(.,'Requested') or contains(.,'Pending'))]"
        )
        join_xpath = (
            "//*[@role='button' and (contains(@aria-label,'Tham gia nhóm') or "
            "contains(@aria-label,'Join group') or contains(@aria-label,'Join Group') or "
            "normalize-space(.)='Tham gia nhóm' or normalize-space(.)='Tham gia' or "
            "normalize-space(.)='Join group' or normalize-space(.)='Join Group' or "
            "normalize-space(.)='Join' or "
            "translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')='join group')]"
        )

        def visible(xpath: str) -> list[Any]:
            return [element for element in driver.find_elements(By.XPATH, xpath) if self._is_displayed(element)]

        composer_xpath = (
            "//*[@role='button' and (contains(.,'Bạn viết gì đi') or "
            "contains(.,'Tạo bài viết công khai') or contains(.,'Write something') or "
            "contains(.,'Create a public post'))]"
        )

        # Chờ tối đa 6s để React/SPA của Facebook render xong các nút trạng thái nhóm
        # sau khi document.readyState == 'complete'.
        render_deadline = time.monotonic() + 6
        buttons: list[Any] = []
        while True:
            if visible(already_joined_xpath):
                return {"status": "ALREADY_MEMBER", "message": "Tài khoản đã là thành viên nhóm"}
            if visible(pending_xpath):
                return {"status": "PENDING_APPROVAL", "message": "Đã gửi yêu cầu, đang chờ quản trị viên duyệt"}
            buttons = visible(join_xpath)
            if buttons:
                break
            if visible(composer_xpath):
                return {"status": "ALREADY_MEMBER", "message": "Tài khoản đã là thành viên nhóm"}
            if time.monotonic() >= render_deadline:
                return {"status": "FAILED", "message": "Facebook không hiển thị nút tham gia hoặc trạng thái đã là thành viên"}
            if self.cancel.wait(0.35):
                self._raise_if_cancelled()

        try:
            driver.execute_script("arguments[0].click()", buttons[0])
        except Exception as js_error:
            try:
                buttons[0].click()
            except Exception as click_error:
                raise RuntimeError(
                    f"Không bấm được nút tham gia (JavaScript: {js_error}; click trực tiếp: {click_error})"
                ) from click_error

        deadline = time.monotonic() + 12
        while True:
            self._raise_if_cancelled()
            dialogs = visible("//div[@role='dialog']")
            if dialogs:
                dialog_text = " ".join((dialog.text or "").lower() for dialog in dialogs)
                question_markers = (
                    "trả lời câu hỏi", "answer questions", "câu hỏi thành viên", "membership questions",
                )
                if any(marker in dialog_text for marker in question_markers):
                    try:
                        self._dismiss_group_join_overlays()
                    except RuntimeError:
                        pass
                    return {"status": "REQUIRES_ANSWERS", "message": "Nhóm yêu cầu trả lời câu hỏi tham gia"}

            if visible(pending_xpath):
                return {"status": "PENDING_APPROVAL", "message": "Đã gửi yêu cầu, đang chờ quản trị viên duyệt"}
            if visible(already_joined_xpath):
                return {"status": "JOINED", "message": "Facebook đã xác nhận tham gia nhóm thành công"}
            if time.monotonic() >= deadline:
                break
            if self.cancel.wait(0.25):
                self._raise_if_cancelled()

        if visible(join_xpath):
            raise RuntimeError(
                "Facebook vẫn hiển thị nút Tham gia nhóm sau 12 giây; yêu cầu chưa được xác nhận. "
                "Có thể thao tác bị chặn, nút bị che, hoặc Facebook từ chối yêu cầu."
            )
        raise RuntimeError(
            "Nút Tham gia nhóm đã biến mất nhưng Facebook chưa hiển thị trạng thái đã tham gia hoặc chờ duyệt."
        )

    def post(self, group: GroupItem, content: str, media: list[str]) -> dict[str, Any]:
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
            "//div[@role='dialog']//*[@contenteditable='true' and ("
            "@role='textbox' or @data-lexical-editor='true' or "
            "contains(@aria-label,'Tạo bài viết') or "
            "contains(@aria-label,'Tạo bài viết công khai') or "
            "contains(@aria-label,'Create a public post') or "
            "contains(@aria-label,'Create a post') or "
            "contains(@aria-label,'Bạn đang nghĩ gì') or "
            "contains(@aria-label,\"What's on your mind\")"
            ")]"
        )

        def insert_content():
            try:
                textbox = next((element for element in driver.find_elements(By.XPATH, textbox_xpath)
                                if self._is_visible(element)), None)
                if textbox is None:
                    return False
                current_text = driver.execute_script(
                    "return arguments[0].innerText || arguments[0].textContent || '';",
                    textbox,
                )
                normalize = lambda value: " ".join(str(value or "").split())
                if normalize(current_text) == normalize(content):
                    return True
                textbox.click()
                self._raise_if_cancelled()
                driver.execute_script(
                    """
                    arguments[0].focus();
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(arguments[0]);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    document.execCommand('delete', false, null);
                    range.selectNodeContents(arguments[0]);
                    range.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    document.execCommand('insertText', false, arguments[1]);
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

        post_xpath = (
            "//div[@role='dialog']//*[@role='button' and "
            "(@aria-label='Đăng' or @aria-label='Post' or normalize-space(.)='Đăng' or normalize-space(.)='Post') and "
            "not(@aria-disabled='true')]"
        )
        next_xpath = (
            "//div[@role='dialog']//*[@role='button' and "
            "(@aria-label='Next' or @aria-label='Tiếp' or @aria-label='Tiếp theo' or "
            "normalize-space(.)='Next' or normalize-space(.)='Tiếp' or normalize-space(.)='Tiếp theo') and "
            "not(@aria-disabled='true')]"
        )

        def click_submit():
            try:
                self._raise_if_cancelled()
                submit = next(
                    (element for element in driver.find_elements(By.XPATH, post_xpath)
                     if self._is_visible(element)),
                    None,
                )
                if submit is not None:
                    driver.execute_script("arguments[0].click()", submit)
                    return True
                nxt = next(
                    (element for element in driver.find_elements(By.XPATH, next_xpath)
                     if self._is_visible(element)),
                    None,
                )
                if nxt is not None:
                    driver.execute_script("arguments[0].click()", nxt)
                    return False
                return False
            except Exception:
                return False

        self._wait_until(click_submit, 45, "Nút Đăng/Post chưa sẵn sàng (sau bước Next)")

        dismiss_xpath = (
            "//*[@role='button' and (normalize-space(.)='Bỏ qua' or normalize-space(.)='Dismiss' or "
            "contains(@aria-label,'Bỏ qua') or contains(@aria-label,'Dismiss'))]"
        )

        def handle_video_processing_toast():
            try:
                for btn in driver.find_elements(By.XPATH, dismiss_xpath):
                    if self._is_displayed(btn):
                        driver.execute_script("arguments[0].click()", btn)
                        return True
            except Exception:
                pass
            return False

        def dialog_is_closed():
            handle_video_processing_toast()
            dialogs = driver.find_elements(By.XPATH, "//div[@role='dialog']")
            active_dialogs = []
            for d in dialogs:
                if not self._is_displayed(d):
                    continue
                d_text = (d.text or "").lower()
                if any(m in d_text for m in ("đang xử lý video", "video is processing", "video trong bài viết")):
                    handle_video_processing_toast()
                    continue
                active_dialogs.append(d)
            return len(active_dialogs) == 0

        self._wait_until(dialog_is_closed, 35, "Facebook chưa đóng popup sau khi gửi bài")
        handle_video_processing_toast()

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
                        ".//a[contains(@href,'/posts/') or contains(@href,'/permalink/') or contains(@href,'story_fbid=') or contains(@href,'multi_permalinks=') or contains(@href,'/photo')]",
                    )
                    hrefs = [str(href) for link in links if (href := link.get_attribute("href"))]
                    for href_str in hrefs:
                        if "/posts/" in href_str or "/permalink/" in href_str:
                            return href_str
                    for href_str in hrefs:
                        if "set=gm." in href_str:
                            m = re.search(r"set=gm\.(\d+)", href_str)
                            if m:
                                clean_group = url.split("?", 1)[0].rstrip("/")
                                return f"{clean_group}/posts/{m.group(1)}"
                        if "multi_permalinks=" in href_str:
                            m = re.search(r"multi_permalinks=(\d+)", href_str)
                            if m:
                                clean_group = url.split("?", 1)[0].rstrip("/")
                                return f"{clean_group}/posts/{m.group(1)}"
                        if "/photo" in href_str:
                            return href_str
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
        post_permalink = (
            result_url
            if re.search(r"/posts/|/permalink/|/photo/|story_fbid=|multi_permalinks=", result_url, re.I)
            else None
        )
        copied_link = self._extract_post_share_link(content, post_permalink)
        return {
            "status": "SUCCESS",
            "message": "Đăng bài thành công",
            "group_url": url,
            "result_url": copied_link or result_url,
            "share_link_copied": bool(copied_link),
        }

    def _extract_post_share_link(self, content: str, post_url: str | None = None) -> str | None:
        """Click Share -> Sao chép liên kết for the post just published."""
        from selenium.webdriver.common.by import By

        driver = self.driver
        def normalize_match_text(value: str) -> str:
            value = re.sub(r"[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]", "", str(value or ""))
            value = unicodedata.normalize("NFKD", value)
            value = "".join(char for char in value if not unicodedata.category(char).startswith("M"))
            value = re.sub(r"[^\w]+", " ", value, flags=re.UNICODE)
            return " ".join(value.split()).casefold()

        content_marker = normalize_match_text(content)[:48]
        article_xpath = "//div[@role='feed']//div[@role='article'] | //div[@role='article']"

        def find_post_article():
            try:
                for article in driver.find_elements(By.XPATH, article_xpath):
                    if not self._is_visible(article):
                        continue
                    article_text = normalize_match_text(article.text or "")
                    if content_marker and content_marker in article_text:
                        return article
            except Exception:
                pass
            return None

        try:
            # Ưu tiên nút Share trong bài có nội dung vừa đăng.
            article = find_post_article()
            share_xpath = (
                ".//*[@role='button' and (normalize-space(.)='Share' or "
                "normalize-space(.)='Chia sẻ' or "
                "contains(translate(@aria-label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'share') or "
                "contains(translate(@aria-label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'chia sẻ') or "
                "contains(translate(@aria-label,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'send this') or "
                "contains(@aria-label,'Gửi') or contains(@aria-label,'Chia sẻ'))]"
            )
            share_button = None
            if article is not None:
                try:
                    share_button = next(
                        (button for button in article.find_elements(By.XPATH, share_xpath) if self._is_visible(button)),
                        None,
                    )
                except Exception:
                    share_button = None
            if share_button is None and content_marker:
                try:
                    share_button = self._wait_until(
                        lambda: driver.execute_script(
                    """
                    const stripInvisible = value => String(value || '').replace(/[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF]/g, '');
                    const marker = stripInvisible(arguments[0]);
                    const postUrl = String(arguments[1] || '');
                    const accountUid = String(arguments[2] || '');
                    const normalize = value => stripInvisible(value).normalize('NFKD')
                      .replace(/\\p{M}/gu, '').replace(/[^\\p{L}\\p{N}_]+/gu, ' ')
                      .replace(/\\s+/g, ' ').trim().toLowerCase();
                    const normalizedMarker = normalize(marker);
                    const accountName = normalize(arguments[3] || '');
                    const pathOf = value => { try { return new URL(value, location.href).pathname.replace(/\\/+$/, ''); } catch (_) { return ''; } };
                    const postPath = pathOf(postUrl);
                    const visible = element => !!(
                      element.getClientRects().length &&
                      getComputedStyle(element).display !== 'none' &&
                      getComputedStyle(element).visibility !== 'hidden'
                    );
                    const isPostShareButton = element => {
                      const label = normalize(element.getAttribute('aria-label'));
                      const text = normalize(element.innerText || element.textContent);
                      const accessibleName = `${label} ${text}`;
                      if (accessibleName.normalize('NFKD').replace(/\\p{M}/gu, '').includes('chia se bai viet')) return true;
                      return /chia s[ẻ] bài viết|chia sẻ bài viết|share.{0,40}post|post.{0,40}share|send this to friends or post/i.test(accessibleName);
                    };
                    const permalinkCandidates = postPath
                      ? [...document.querySelectorAll('a[href]')].filter(anchor => pathOf(anchor.href) === postPath)
                      : [];
                    const contentCandidates = marker
                      ? [...document.querySelectorAll('div')]
                      .filter(element => visible(element) && normalize(element.innerText).includes(normalizedMarker))
                          .sort((left, right) => normalize(left.innerText).length - normalize(right.innerText).length)
                      : [];
                    const candidates = [...permalinkCandidates, ...contentCandidates];
                    for (const candidate of candidates) {
                      let container = candidate;
                      for (let depth = 0; container && depth < 12; depth += 1, container = container.parentElement) {
                        const button = [...container.querySelectorAll('button, [role="button"]')]
                          .find(control => visible(control) && isPostShareButton(control));
                        if (button) return button;
                        if (container.matches('main, body')) break;
                      }
                    }
                    if (accountUid) {
                      const accountPosts = new Set();
                      const authorLinks = [...document.querySelectorAll('a[href]')].filter(anchor => {
                        const href = anchor.href || '';
                        return href.includes(`/user/${accountUid}/`) || href.includes(`profile.php?id=${accountUid}`);
                      });
                      for (const authorLink of authorLinks) {
                        let container = authorLink;
                        for (let depth = 0; container && depth < 12; depth += 1, container = container.parentElement) {
                          const button = [...container.querySelectorAll('button, [role="button"]')]
                            .find(control => {
                              const label = normalize(control.getAttribute('aria-label'));
                              return visible(control) && isPostShareButton(control) &&
                                (!accountName || label.includes(accountName));
                            });
                          if (button) {
                            accountPosts.add(button);
                            break;
                          }
                          if (container.matches('main, body')) break;
                        }
                      }
                      if (accountPosts.size === 1) return [...accountPosts][0];
                    }
                    return null;
                    """,
                    content_marker,
                    post_url or "",
                    str(self.account.get("uid") or ""),
                    str(self.account.get("profile_name") or ""),
                        ),
                        8,
                        "Không tìm thấy nút chia sẻ gắn với bài vừa đăng",
                    )
                except RuntimeError:
                    share_button = None
            if share_button is None:
                self.log("WARNING", f"[{self.account['uid']}] Không tìm thấy nút Chia sẻ trong bài vừa đăng (đã đối chiếu nội dung bài)")
                return None

            # Capture the link passed to the browser clipboard when Facebook
            # handles the Copy link menu action.
            driver.execute_script(
                """
                window.__fbCopiedPostLink = null;
                if (navigator.clipboard && navigator.clipboard.writeText && !window.__fbPostCopyHooked) {
                  const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
                  navigator.clipboard.writeText = async function(text) {
                    window.__fbCopiedPostLink = String(text || '');
                    try { return await originalWriteText(text); } catch (e) { return; }
                  };
                  window.__fbPostCopyHooked = true;
                }
                if (document.execCommand && !window.__fbPostCopyExecHooked) {
                  const originalExecCommand = document.execCommand.bind(document);
                  document.execCommand = function(command, ...args) {
                    if (String(command).toLowerCase() === 'copy') {
                      const selection = (window.getSelection && window.getSelection().toString()) || '';
                      const active = document.activeElement;
                      const value = (active && typeof active.value === 'string') ? active.value : '';
                      window.__fbCopiedPostLink = selection || value || window.__fbCopiedPostLink;
                    }
                    return originalExecCommand(command, ...args);
                  };
                  window.__fbPostCopyExecHooked = true;
                }
                """
            )
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", share_button)
            driver.execute_script("arguments[0].click();", share_button)

            copy_labels = ("Sao ch\u00e9p li\u00ean k\u1ebft", "Copy link")
            copy_label_predicate = " or ".join(
                f"normalize-space(.)='{label}'" for label in copy_labels
            )
            copy_action_xpath = (
                ".//*[@role='button' or @role='menuitem' or self::button or self::a]"
                f"[{copy_label_predicate} or .//span[{copy_label_predicate}]]"
            )
            popup_xpath = "//*[@role='dialog' or @role='menu' or @aria-modal='true']"

            def find_share_popup():
                try:
                    for popup in reversed(driver.find_elements(By.XPATH, popup_xpath)):
                        if not self._is_visible(popup):
                            continue
                        copy_actions = popup.find_elements(By.XPATH, copy_action_xpath)
                        if any(self._is_visible(action) for action in copy_actions):
                            return popup
                except Exception:
                    pass
                return None

            share_popup = self._wait_until(
                find_share_popup,
                7,
                "Popup Chia sẻ không hiển thị mục Sao chép liên kết",
            )

            def find_copy_action():
                try:
                    return next(
                        (
                            action
                            for action in share_popup.find_elements(By.XPATH, copy_action_xpath)
                            if self._is_visible(action)
                        ),
                        None,
                    )
                except Exception:
                    return None

            copy_action = self._wait_until(
                find_copy_action,
                5,
                "Popup Chia sẻ không có mục Sao chép liên kết",
            )
            copy_action = driver.execute_script(
                "return arguments[0].closest('[role=menuitem], [role=button], button, a') || arguments[0];",
                copy_action,
            )
            driver.execute_script("arguments[0].click();", copy_action)

            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                self._raise_if_cancelled()
                copied = driver.execute_script("return window.__fbCopiedPostLink;")
                if isinstance(copied, str) and copied.strip().startswith(("http://", "https://")):
                    return copied.strip()
                if self.cancel.wait(0.15):
                    self._raise_if_cancelled()
        except InterruptedError:
            raise
        except Exception as exc:
            self.log("WARNING", f"[{self.account['uid']}] Không lấy được link đã sao chép của bài đăng: {exc}")
        return None


    def comment(
        self,
        group: GroupItem,
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
        public_comment_xpaths = (
            "//*[@aria-label='Write a public comment…']",
            "//*[starts-with(translate(normalize-space(@aria-label), "
            "'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "
            "'write a public comment')]",
        )

        def find_public_comment_editor():
            for xpath in public_comment_xpaths:
                try:
                    editor = next(
                        (
                            item
                            for item in driver.find_elements(By.XPATH, xpath)
                            if self._is_visible(item)
                        ),
                        None,
                    )
                    if editor is not None:
                        return editor
                except Exception:
                    continue
            return None

        def find_first_article():
            public_comment_editor = find_public_comment_editor()
            if public_comment_editor is not None:
                container = driver.execute_script(
                    "return arguments[0].closest('[role=article], article') || arguments[0];",
                    public_comment_editor,
                )
                if container is not None:
                    return container

            # Ưu tiên bài nằm trong feed. Facebook có thể bỏ permalink/nút
            # Bình luận khỏi DOM accessibility dù bài và ô comment vẫn hiển thị.
            feed_articles = [
                item
                for item in driver.find_elements(
                    By.XPATH, "//div[@role='feed']//div[@role='article']"
                )
                if self._is_displayed(item)
            ]
            for item in feed_articles:
                try:
                    if item.find_elements(By.XPATH, post_marker_xpath):
                        return item
                except Exception:
                    continue
            if feed_articles:
                return feed_articles[0]

            visible = [item for item in driver.find_elements(By.XPATH, article_xpath) if self._is_displayed(item)]
            # role=article còn được Facebook dùng cho thẻ giới thiệu và một số khối
            # phụ. Chỉ lấy article có permalink hoặc điều khiển bình luận để lấy
            # đúng bài viết đầu tiên trong feed.
            for item in visible:
                try:
                    if item.find_elements(By.XPATH, post_marker_xpath):
                        return item
                except Exception:
                    continue

            # Một số layout mới không gắn role=article/feed. Nếu ô public
            # comment đã render, dùng nó làm điểm neo để tiếp tục thao tác.
            try:
                editors = driver.find_elements(
                    By.XPATH,
                    "//*[@contenteditable='true' or @role='textbox' or self::textarea]",
                )
                for editor in editors:
                    if not self._is_visible(editor):
                        continue
                    labels = " ".join(
                        str(editor.get_attribute(attr) or "")
                        for attr in ("aria-label", "aria-placeholder", "placeholder", "data-placeholder")
                    ).lower()
                    if "comment" not in labels and "bình luận" not in labels:
                        continue
                    container = driver.execute_script(
                        "return arguments[0].closest('[role=article], article') || arguments[0];",
                        editor,
                    )
                    if container is not None:
                        return container
            except Exception:
                pass
            return None

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
            public_comment_editor = find_public_comment_editor()
            if public_comment_editor is not None:
                return public_comment_editor
            current_article = resolve_article()
            if current_article is None:
                return None
            try:
                is_editor = (
                    current_article.get_attribute("contenteditable") == "true"
                    or current_article.get_attribute("role") == "textbox"
                )
                if is_editor and self._is_visible(current_article):
                    labels = " ".join(
                        str(current_article.get_attribute(attr) or "")
                        for attr in ("aria-label", "aria-placeholder", "placeholder", "data-placeholder")
                    ).lower()
                    if "comment" in labels or "bình luận" in labels:
                        return current_article
            except Exception:
                pass
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
            "contains(@aria-label,'public comment') or contains(@aria-label,'Public comment') or "
                "contains(@aria-label,'Comment as') or contains(@aria-placeholder,'Bình luận') or "
            "contains(@aria-placeholder,'Comment') or contains(@aria-placeholder,'comment'))] | "
                "//div[@role='dialog']//*[@data-lexical-editor='true' and (@role='textbox' or @contenteditable='true')] | "
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

        current_article = resolve_article() or article
        if self._comment_is_pending(current_article, content):
            return {
                "status": "PENDING_APPROVAL",
                "message": "Bình luận đang chờ quản trị viên duyệt; chưa có link trực tiếp",
                "result_url": None,
            }
        comment_link = self._extract_comment_share_link(current_article, content)
        if not comment_link and self._comment_is_pending(resolve_article() or article, content):
            return {
                "status": "PENDING_APPROVAL",
                "message": "Bình luận đang chờ quản trị viên duyệt; chưa có link trực tiếp",
                "result_url": None,
            }
        if not comment_link:
            self.log("WARNING", f"[{self.account['uid']}] Đã gửi bình luận nhưng chưa lấy được link trực tiếp")
        return {
            "status": "SUCCESS",
            "message": "Bình luận bài viết đầu tiên thành công",
            "result_url": comment_link or str(permalink),
            "comment_link_captured": bool(comment_link),
        }

    def _comment_is_pending(self, root_article, content: str) -> bool:
        """Recognize a submitted comment awaiting group moderation."""
        try:
            return bool(self.driver.execute_script(
                """
                const root = arguments[0] || document;
                const expected = String(arguments[1] || '').replace(/\\s+/g, ' ').trim();
                if (!expected) return false;
                const pending = /\\bPending\\b|đang chờ|chờ phê duyệt|awaiting approval/i;
                for (const node of root.querySelectorAll('div, span, p')) {
                  if (!node.getClientRects().length) continue;
                  if (String(node.innerText || '').replace(/\\s+/g, ' ').trim() !== expected) continue;
                  let parent = node.parentElement;
                  for (let depth = 0; parent && depth < 7; depth++, parent = parent.parentElement) {
                    const text = String(parent.innerText || '').replace(/\\s+/g, ' ').trim();
                    if (text.length > 350) break;
                    if (pending.test(text)) return true;
                  }
                }
                return false;
                """,
                root_article,
                content,
            ))
        except Exception:
            return False

    def _extract_comment_share_link(self, root_article, content: str) -> str | None:
        """Get the new comment's link through Share, with its timestamp as fallback."""
        from selenium.webdriver.common.by import By
        from urllib.parse import parse_qs, urlsplit

        driver = self.driver
        content_marker = " ".join(content.split()).casefold()
        account_uid = str(self.account.get("uid") or "")
        share_xpath = (
            ".//*[@role='button' and ("
            "normalize-space(.)='Share' or normalize-space(.)='Chia sẻ' or "
            "@aria-label='Share' or @aria-label='Chia sẻ')]"
        )
        copy_link_xpath = (
            "//*[@role='menuitem' or @role='button']["
            "normalize-space(.)='Copy link' or normalize-space(.)='Sao chép liên kết' or "
            "normalize-space(.)='Chia sẻ liên kết' or "
            ".//*[normalize-space(.)='Copy link' or normalize-space(.)='Sao chép liên kết' or "
            "normalize-space(.)='Chia sẻ liên kết']]"
        )

        def comment_url(value):
            """Keep only a Facebook comment URL, without tracking parameters."""
            try:
                parsed = urlsplit(str(value or "").strip())
                comment_id = parse_qs(parsed.query).get("comment_id", [""])[0]
                if (parsed.hostname or "").lower() not in {"facebook.com", "www.facebook.com", "web.facebook.com"}:
                    return None
                if not comment_id.isdigit() or not re.search(r"/groups/[^/]+/(posts|permalink)/[^/]+", parsed.path):
                    return None
                return f"https://www.facebook.com{parsed.path}?comment_id={comment_id}"
            except Exception:
                return None

        def find_comment():
            for scope in (root_article, driver):
                try:
                    comment_nodes = scope.find_elements(By.XPATH, ".//div[@role='article']")
                except Exception:
                    continue
                # Prefer comments inside the target post before searching the page.
                for node in reversed(comment_nodes):
                    try:
                        if not self._is_displayed(node):
                            continue
                        node_text = " ".join((node.text or "").split()).casefold()
                        if content_marker and content_marker not in node_text:
                            continue
                        author_links = node.find_elements(By.XPATH, ".//a[@href]")
                        if account_uid and author_links and not any(
                            f"/user/{account_uid}/" in str(link.get_attribute("href") or "")
                            or f"profile.php?id={account_uid}" in str(link.get_attribute("href") or "")
                            for link in author_links
                        ):
                            continue
                        permalink = next(
                            (url for link in author_links if (url := comment_url(link.get_attribute("href")))),
                            None,
                        )
                        share_button = next(
                            (button for button in node.find_elements(By.XPATH, share_xpath) if self._is_displayed(button)),
                            None,
                        )
                        if share_button or permalink:
                            return share_button, permalink
                    except Exception:
                        continue
            return None

        try:
            found = None
            deadline = time.monotonic() + 6.0
            while time.monotonic() < deadline:
                self._raise_if_cancelled()
                found = find_comment()
                if found is not None:
                    break
                if self.cancel.wait(0.35):
                    self._raise_if_cancelled()

            if found is None:
                return None
            share_btn, timestamp_url = found
            if share_btn is None:
                return timestamp_url

            # Cài hook JS bắt dữ liệu clipboard ngay trước khi ấn Copy link (an toàn đa luồng)
            driver.execute_script(
                """
                window.__fbCopiedCommentLink = null;
                if (!window.__fbCopyHooked) {
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    const origWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
                    navigator.clipboard.writeText = async function(text) {
                      window.__fbCopiedCommentLink = String(text || '');
                      try { return await origWriteText(text); } catch (e) { return; }
                    };
                  }
                  if (document.execCommand) {
                    const origExec = document.execCommand.bind(document);
                    document.execCommand = function(cmd, ...args) {
                      if (String(cmd).toLowerCase() === 'copy') {
                        const active = document.activeElement;
                        const sel = (window.getSelection && window.getSelection().toString()) || '';
                        const val = (active && typeof active.value === 'string') ? active.value : '';
                        if (sel || val) window.__fbCopiedCommentLink = sel || val;
                      }
                      return origExec(cmd, ...args);
                    };
                  }
                  window.__fbCopyHooked = true;
                }
                """
            )

            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", share_btn)
            driver.execute_script("arguments[0].click();", share_btn)

            copy_btn = None
            menu_deadline = time.monotonic() + 4.0
            while time.monotonic() < menu_deadline:
                self._raise_if_cancelled()
                candidates = driver.find_elements(By.XPATH, copy_link_xpath)
                copy_btn = next((item for item in candidates if self._is_displayed(item)), None)
                if copy_btn is not None:
                    break
                if self.cancel.wait(0.25):
                    self._raise_if_cancelled()

            if copy_btn is None:
                return timestamp_url

            driver.execute_script("arguments[0].click();", copy_btn)

            copy_deadline = time.monotonic() + 2.0
            while time.monotonic() < copy_deadline:
                self._raise_if_cancelled()
                copied = driver.execute_script("return window.__fbCopiedCommentLink;")
                copied_url = comment_url(copied)
                if copied_url and (not timestamp_url or copied_url == timestamp_url):
                    return copied_url
                if self.cancel.wait(0.15):
                    self._raise_if_cancelled()
        except InterruptedError:
            raise
        except Exception:
            return locals().get("timestamp_url")
        return timestamp_url


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
            requested_threads = max(1, int(settings.get("threads") or 1))
            worker_count = min(requested_threads, len(per_account))

            def run_account(uid: str, items: list[dict[str, Any]]) -> None:
                if job.cancel.is_set():
                    return
                job.log("INFO", f"[{uid}] Bắt đầu xử lý {len(items)} nhóm")
                try:
                    self._run_account(job, accounts[uid], items)
                except InterruptedError:
                    return
                except Exception as exc:
                    job.log("ERROR", f"[{uid}] {_friendly_automation_error(exc)['message']}")
                finally:
                    if not job.cancel.is_set():
                        job.log("SUCCESS", f"[{uid}] Đã xử lý xong")

            job.log(
                "INFO",
                f"Bắt đầu {job.total} lượt với {worker_count} luồng Chrome song song; "
                f"mỗi tài khoản xử lý tuần tự các nhóm của mình rồi đăng bài ngay",
            )
            with ThreadPoolExecutor(
                max_workers=worker_count,
                thread_name_prefix=f"group-chrome-{job.id[:8]}",
            ) as executor:
                futures = [
                    executor.submit(run_account, uid, items)
                    for uid, items in per_account.items()
                ]
                for future in as_completed(futures):
                    future.result()

            if job.cancel.is_set():
                job.status = "STOPPED"
                job.message = "Chiến dịch đã dừng theo yêu cầu"
                job.log("WARNING", "Chiến dịch đã dừng theo yêu cầu")
            elif (job.failed or job.skipped) and job.success:
                job.status = "PARTIAL"
                job.message = f"Hoàn tất một phần: {job.success} thành công, {job.pending_actions} chờ duyệt, {job.failed} thất bại"
                job.log("WARNING", job.message)
            elif job.failed:
                job.status = "FAILED"
                job.message = f"Chiến dịch thất bại ({job.failed}/{job.total} lượt)"
                job.log("ERROR", f"Chiến dịch kết thúc: {job.message}")
            elif job.skipped:
                job.status = "PARTIAL"
                job.message = f"Đã xử lý: {job.pending_actions} lượt chờ duyệt, {job.skipped - job.pending_actions} lượt bỏ qua"
                job.log("WARNING", job.message)
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

    def _run_account(self, job: CampaignJob, account: AccountItem, groups: list[dict[str, Any]]) -> None:
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
                    group_name = _extract_group_field(group, "name") or _group_key(group)
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
                    self._record_group_membership(job, account, group, join_result)

                    # A failed or pending join remains informational. The requested
                    # action is attempted immediately before moving to the next group.
                    choices = [i for i in range(len(posts)) if i not in used]
                    if not choices:
                        used.clear()
                        choices = list(range(len(posts)))
                    if settings.get("shuffle_content", True):
                        post_index = random.choice(choices)
                    else:
                        # Keep content assignment in order and wrap around when
                        # there are more groups than generated post variants.
                        post_index = index % len(posts)
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

    def _record_group_membership(
        self,
        job: CampaignJob,
        account: AccountItem,
        group: GroupItem,
        result: dict[str, Any],
    ) -> None:
        status = str(result.get("status") or "").upper()
        if status in {"JOINED", "ALREADY_MEMBER"}:
            membership_status = "JOINED"
        elif status == "PENDING_APPROVAL":
            membership_status = status
        else:
            return

        group_url = _group_url(group)
        group_key = _group_key(group) or group_url
        if not group_key or not group_url:
            return
        record_membership = getattr(self.persistence, "record_group_membership", None)
        if not callable(record_membership):
            return
        try:
            record_membership(
                owner=job.owner,
                account_uid=str(account["uid"]),
                group_key=group_key,
                group_name=_extract_group_field(group, "name") or None,
                group_url=group_url,
                status=membership_status,
                search_keyword=str(job.payload.get("search_keyword") or "").strip() or None,
                campaign_id=job.campaign_id,
            )
        except Exception:
            logger.warning("Cannot record Module 7 group membership", exc_info=True)

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
            "group_name": _extract_group_field(group, "name") or None,
            "group_url": _group_url(group),
            "status": status,
            "message": result.get("message", ""),
            "join_status": result.get("join_status"),
            "content": result.get("content"),
            "error_code": result.get("error_code"),
            "error_detail": result.get("error_detail"),
            "result_url": (
                result.get("result_url") if status == "PENDING_APPROVAL"
                else result.get("result_url") or result.get("group_url") or _group_url(group)
            ),
            "finished_at": datetime.now().isoformat(timespec="seconds"),
        }
        with job.lock:
            job.results.append(item)
            job.completed += 1
            if item["status"] == "SUCCESS":
                job.success += 1
            elif item["status"] in {"SKIPPED", "PENDING_APPROVAL"}:
                job.skipped += 1
                if item["status"] == "PENDING_APPROVAL":
                    job.pending_actions += 1
            else:
                job.failed += 1
        persisted = self.persistence.record_task(job.id, item)
        self._sync_run(job)
        level = "SUCCESS" if item["status"] == "SUCCESS" else "WARNING" if item["status"] in {"SKIPPED", "PENDING_APPROVAL"} else "ERROR"
        target_url = item.get("result_url") or item.get("group_url") or _group_url(group)
        group_display = item["group_name"] or item["group_key"]
        url_part = f" ({target_url})" if target_url else ""
        job.log(level, f"[{uid}] {group_display}{url_part}: {item['message']}")
        if result.get("share_link_copied"):
            if persisted is False:
                job.log("WARNING", f"[{uid}] Đã lấy link bài đăng nhưng database chưa lưu được: {target_url}")
            else:
                job.log("SUCCESS", f"[{uid}] Đã lưu link bài đăng vào database: {target_url}")
        if result.get("comment_link_captured"):
            if persisted is False:
                job.log("WARNING", f"[{uid}] Đã lấy link bình luận nhưng database chưa lưu được: {target_url}")
            else:
                job.log("SUCCESS", f"[{uid}] Đã lưu link bình luận vào database: {target_url}")

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
