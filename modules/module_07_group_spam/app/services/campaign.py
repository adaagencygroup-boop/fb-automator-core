"""In-memory campaign runtime and Selenium group poster for Module 7."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from html.parser import HTMLParser
import random
import threading
import time
import uuid
from typing import Any, Callable

from modules.module_02_account_manager.context import owner_scope
from ..core.constants import BLOCK_TAGS, TERMINAL_STATES, LogLevel


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
            def upload_media():
                try:
                    inputs = driver.find_elements(By.XPATH, "//div[@role='dialog']//input[@type='file']")
                    if not inputs:
                        return False
                    inputs[-1].send_keys("\n".join(media))
                    return True
                except Exception:
                    return False

            self._wait_until(upload_media, 15, "Không tìm thấy vùng tải media của Facebook")
            if self.cancel.wait(2 + min(len(media) * 2, 8)):
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

        try:
            page_text = (driver.find_element(By.TAG_NAME, "body").text or "").lower()
            blocked = ("tạm thời bị chặn", "temporarily blocked", "giới hạn tần suất", "try again later")
            if any(message in page_text for message in blocked):
                raise RuntimeError("Facebook đang giới hạn thao tác đăng bài của tài khoản")
        except Exception:
            pass
        return {"status": "SUCCESS", "message": "Đăng bài thành công", "group_url": url}


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
                raise RuntimeError("Đang có một chiến dịch đăng bài chạy cho tài khoản này")
            job = CampaignJob(id=str(uuid.uuid4()), owner=owner, payload=payload)
            self.jobs[job.id] = job
            self.active_by_owner[owner] = job.id
        job.log(
            "INFO",
            f"Đã tiếp nhận chiến dịch: {len(payload.get('account_uids') or [])} tài khoản, "
            f"{len(payload.get('groups') or [])} nhóm.",
        )
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

    def _sync_run(self, job: CampaignJob) -> None:
        self.persistence.update_run(
            job.id,
            status=job.status,
            total_planned=job.total,
            total_success=job.success,
            total_failed=job.failed,
            total_skipped=job.skipped,
            started_at=job.started_at,
            finished_at=job.finished_at,
        )

    def _run(self, job: CampaignJob) -> None:
        payload = job.payload
        settings = payload.get("settings") or {}
        try:
            self._initialize_persistence(job)
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

            tasks = [(uid, group) for group in groups for uid in uids]
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
            job.log("INFO", f"Bắt đầu {job.total} nhóm với hai luồng độc lập: tham gia nhóm và đăng bài")
            workers = min(max(1, int(settings.get("threads") or 1)), len(per_account))
            with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="group-post") as pool:
                futures = [pool.submit(self._run_account, job, accounts[uid], items) for uid, items in per_account.items()]
                for future in as_completed(futures):
                    try:
                        future.result()
                    except InterruptedError:
                        pass
                    except Exception as exc:
                        job.log("ERROR", str(exc))

            if job.cancel.is_set():
                job.status = "STOPPED"
                job.message = "Chiến dịch đã dừng theo yêu cầu"
                job.log("WARNING", "Chiến dịch đã dừng theo yêu cầu")
            elif (job.failed or job.skipped) and job.success:
                job.status = "PARTIAL"
                job.message = f"Hoàn tất một phần: {job.success} đã đăng, {job.failed} thất bại"
                job.log("SUCCESS", f"Chiến dịch đã hoàn thành! Đã đăng thành công {job.success}/{job.total} lượt (Thất bại: {job.failed})")
            elif job.failed:
                job.status = "FAILED"
                job.message = f"Chiến dịch thất bại ({job.failed}/{job.total} lượt)"
                job.log("ERROR", f"Chiến dịch kết thúc: {job.message}")
            elif job.skipped:
                job.status = "PARTIAL"
                job.message = f"Đã xử lý: {job.success} đã đăng, {job.skipped} nhóm bỏ qua"
                job.log("SUCCESS", f"Chiến dịch đã hoàn thành! Đã đăng thành công {job.success}/{job.total} lượt ({job.skipped} nhóm bỏ qua)")
            else:
                job.status = "COMPLETED"
                job.message = f"Đã đăng thành công {job.success}/{job.total} lượt"
                job.log("SUCCESS", f"Chiến dịch đã hoàn thành thành công! Tổng cộng {job.success}/{job.total} lượt đăng bài.")
        except InterruptedError:
            job.status = "STOPPED"
            job.message = "Chiến dịch đã dừng theo yêu cầu"
        except Exception as exc:
            job.status = "FAILED"
            job.log("ERROR", str(exc))
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

        try:
            with owner_scope(job.owner), self.poster_factory(account, job.cancel, job.log) as poster:
                for index, group in enumerate(groups):
                    if job.cancel.is_set():
                        raise InterruptedError()
                    choices = [i for i in range(len(posts)) if i not in used]
                    if not choices:
                        used.clear()
                        choices = list(range(len(posts)))
                    post_index = random.choice(choices) if settings.get("shuffle_content", True) else choices[0]
                    if settings.get("avoid_duplicate"):
                        used.append(post_index)
                    media_count = min(len(media_pool), random.randint(min_media, max_media)) if media_pool else 0
                    media = random.sample(media_pool, media_count) if media_count else []
                    group_name = group.get("name") or _group_key(group)
                    group_url = _group_url(group)
                    url_display = f" ({group_url})" if group_url else ""
                    join_result = None
                    try:
                        job.log("INFO", f"[{uid}] Luồng tham gia: kiểm tra {group_name}{url_display}")
                        try:
                            join_result = poster.join_group(group)
                            self._record_join_step(job, uid, group_name, join_result, group_url)
                        except InterruptedError:
                            raise
                        except Exception as join_error:
                            join_result = {"status": "FAILED", "message": str(join_error)}
                            self._record_join_step(job, uid, group_name, join_result, group_url)
                            job.log("WARNING", f"[{uid}] Luồng tham gia lỗi nhưng luồng đăng vẫn tiếp tục")

                        # Hai luồng độc lập: không chờ Facebook duyệt yêu cầu tham gia mới thử đăng.
                        action_type = str(job.payload.get("action_type") or "POST").upper()
                        if action_type == "COMMENT":
                            job.log("INFO", f"[{uid}] Luồng bình luận: đang bình luận vào {group_name}{url_display}")
                            if hasattr(poster, "comment"):
                                result = poster.comment(group, posts[post_index])
                            else:
                                result = poster.post(group, posts[post_index], media)
                                result["message"] = "Đã bình luận thành công"
                        else:
                            job.log("INFO", f"[{uid}] Luồng đăng: đang đăng bài vào {group_name}{url_display}")
                            result = poster.post(group, posts[post_index], media)
                        result["join_status"] = join_result["status"]
                        result["content"] = posts[post_index]
                        self._advance_step(job)
                        self._record_result(job, account, group, result)
                    except InterruptedError:
                        raise
                    except Exception as exc:
                        if join_result is None:
                            self._advance_step(job, 2)
                        else:
                            self._advance_step(job)
                        self._record_result(job, account, group, {
                            "status": "FAILED", "message": str(exc),
                            "join_status": join_result.get("status") if join_result else "FAILED",
                            "content": posts[post_index],
                        })
                    if index < len(groups) - 1 and not job.cancel.is_set():
                        delay = random.randint(delay_min, delay_max)
                        job.log("INFO", f"[{uid}] Nghỉ {delay} giây trước nhóm tiếp theo")
                        if self._wait(job.cancel, delay):
                            raise InterruptedError()
        except InterruptedError:
            raise
        except Exception as exc:
            completed_keys = {
                result["group_key"] for result in job.results
                if result["account_uid"] == uid
            }
            remaining = [
                group for group in groups if _group_key(group) not in completed_keys
            ] if not job.cancel.is_set() else []
            job.log("ERROR", f"[{uid}] {exc}")
            for group in remaining:
                self._advance_step(job, 2)
                self._record_result(job, account, group, {"status": "FAILED", "message": str(exc)})

    @staticmethod
    def _advance_step(job: CampaignJob, count: int = 1) -> None:
        with job.lock:
            job.completed_steps = min(job.total_steps, job.completed_steps + count)

    @staticmethod
    def _record_join_step(
        job: CampaignJob, uid: str, group_name: str, result: dict[str, Any], group_url: str = ""
    ) -> None:
        status = result.get("status")
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
        """Finalize the PostgreSQL run summary."""
        if job.status not in {"COMPLETED", "PARTIAL", "STOPPED", "CANCELLED", "FAILED"}:
            job.status = "FAILED"
        self._sync_run(job)


campaign_manager = CampaignManager()
