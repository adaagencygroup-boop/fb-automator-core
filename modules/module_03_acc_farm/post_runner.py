"""
post_runner.py
Module 03 - Tab 2: Quản lý phiên và điều phối đa luồng chạy Đăng bài (Post Runner).
Hỗ trợ:
  - ThreadPoolExecutor theo đúng thread_count
  - Cờ Pause / Resume tức thời (freeze / unfreeze worker)
  - Cờ Emergency Stop (dừng khẩn cấp, dọn dẹp driver)
  - Bắn log theo định dạng chuẩn ra giao diện UI
"""
import os
import time
import random
import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, Any, List, Optional, Callable

from modules.module_03_acc_farm import post_repository
from modules.module_03_acc_farm.post_flow import (
    publish_status_post,
    publish_reels_post,
    publish_story_post,
    check_account_health,
    PostAccountDead,
    PostFeatureBlocked,
    PublishUnconfirmed
)

logger = logging.getLogger(__name__)


def classify_error(exc: Exception) -> tuple[str, str]:
    if isinstance(exc, PostAccountDead):
        return "DIE", str(exc)
    if isinstance(exc, PostFeatureBlocked):
        return "BLOCKED", str(exc)
    if isinstance(exc, PublishUnconfirmed):
        return "FAILED", str(exc)
    return "FAILED", f"{type(exc).__name__}: {exc}"


class PostRunner:
    def __init__(self):
        self._lock = threading.Lock()
        self._active_session_id: Optional[str] = None
        self._post_type: Optional[str] = "status"
        self._session_accounts: List[str] = []
        self._pause_event = threading.Event()
        self._pause_event.set() # Mặc định set = đang chạy, clear = tạm dừng
        self._stop_event = threading.Event()
        self._schedule_event = threading.Event()
        self._schedule_event.set() # Mặc định set = không hẹn giờ hoặc đã đến giờ
        self._scheduler_thread: Optional[threading.Thread] = None
        self._schedule_enabled: bool = False
        self._scheduled_time_str: Optional[str] = None
        self._executor: Optional[ThreadPoolExecutor] = None
        self._active_drivers: Dict[str, Any] = {} # thread_id -> driver
        self._active_threads: Dict[str, Dict[str, Any]] = {} # thread_id -> thread progress info
        self._finished_thread_count: int = 0
        self._total_thread_count: int = 1
        self._account_credentials: Dict[str, Dict[str, Any]] = {}
        self._metrics = {
            "running": 0,
            "paused": 0,
            "waiting": 0,
            "completed": 0,
            "systemError": 0,
            "deadAccount": 0,
            "stopped": 0,
        }
        self._logs: List[Dict[str, Any]] = []
        self._log_listeners: List[Callable[[Dict[str, Any]], None]] = []

    def get_account_credentials(self, uid: str) -> Dict[str, str]:
        """Lấy mật khẩu, 2FA, cookie từ cache hoặc từ Module 02 qua adapters."""
        uid_str = str(uid)
        cached = self._account_credentials.get(uid_str)
        if cached and (cached.get("cookie") or cached.get("password")):
            return cached

        try:
            from modules.module_03_acc_farm.adapters import get_account, get_credentials
            acc = get_account(uid_str)
            if acc:
                pwd, two_fa = get_credentials(uid_str)
                creds = {
                    "uid": uid_str,
                    "password": pwd or "",
                    "two_fa": two_fa or "",
                    "cookie": acc.get("cookie") or "",
                    "proxy": acc.get("proxy") or "",
                    "user_id": acc.get("user_id"),
                    "profile_path": acc.get("profile_path"),
                }
                self._account_credentials[uid_str] = creds
                return creds
        except Exception as e:
            logger.debug(f"Không thể đọc credentials qua adapter cho UID {uid_str}: {e}")

        try:
            from core.database.connection import db
            row = db.fetch_one("SELECT uid, password, two_fa, cookie, proxy, profile_path, user_id FROM accounts WHERE uid = %s LIMIT 1", (uid_str,))
            if row:
                creds = {
                    "uid": uid_str,
                    "password": row.get("password") or "",
                    "two_fa": row.get("two_fa") or "",
                    "cookie": row.get("cookie") or "",
                    "proxy": row.get("proxy") or "",
                    "user_id": str(row.get("user_id")) if row.get("user_id") is not None else None,
                    "profile_path": row.get("profile_path"),
                }
                self._account_credentials[uid_str] = creds
                return creds
        except Exception as e:
            logger.debug(f"Không thể đọc credentials từ db accounts cho UID {uid_str}: {e}")

        return {}

    def add_log_listener(self, listener: Callable[[Dict[str, Any]], None]):
        self._log_listeners.append(listener)

    def log(self, thread_name: str, level: str, message: str):
        entry = {
            "id": f"{time.time()}_{uuid.uuid4().hex[:6]}",
            "timestamp": time.strftime("%H:%M:%S"),
            "thread": thread_name,
            "type": level.lower(),
            "message": message
        }
        with self._lock:
            self._logs.append(entry)
            if len(self._logs) > 500:
                self._logs.pop(0)

        for listener in self._log_listeners:
            try:
                listener(entry)
            except Exception:
                pass
        try:
            print(f"[{entry['timestamp']}] [{thread_name}] [{level.upper()}] {message}")
        except Exception:
            pass

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            threads_list = []
            for t_name, t_info in self._active_threads.items():
                start_t = t_info.get("startTime", time.time())
                elapsed = int(time.time() - start_t)
                mins, secs = divmod(elapsed, 60)
                threads_list.append({
                    **t_info,
                    "elapsedTime": f"{mins}:{str(secs).zfill(2)}"
                })
            all_done = (self._finished_thread_count >= self._total_thread_count) if self._total_thread_count > 0 else False
            is_finished = all_done or (self._active_session_id is None) or self._stop_event.is_set()
            return {
                "session_id": self._active_session_id,
                "post_type": self._post_type or "status",
                "session_accounts": list(self._session_accounts),
                "is_running": (self._active_session_id is not None) and (not self._stop_event.is_set()) and (not all_done),
                "is_paused": not self._pause_event.is_set(),
                "is_stopped": self._stop_event.is_set(),
                "is_waiting_schedule": not self._schedule_event.is_set(),
                "schedule_time": self._scheduled_time_str if self._schedule_enabled else None,
                "session_finished": is_finished,
                "metrics": dict(self._metrics),
                "threads": threads_list,
                "recent_logs": list(self._logs[-50:])
            }

    def start_session(
        self,
        post_type: str,
        accounts: List[Dict[str, Any]],
        thread_count: int = 1,
        min_delay: int = 600,
        max_delay: int = 900
    ) -> str:
        """Bắt đầu một phiên đăng bài mới (tạo session + khởi chạy threads)."""
        with self._lock:
            if self._active_session_id and not self._stop_event.is_set():
                raise RuntimeError("Đang có một phiên đăng bài khác đang chạy. Hãy dừng trước khi bắt đầu mới.")

            session_id = post_repository.create_post_session(post_type)
            self._active_session_id = session_id
            self._post_type = post_type
            self._session_accounts = [str(a.get("uid", "")) for a in (accounts or []) if a.get("uid")]
            self._pause_event.set()
            self._stop_event.clear()
            self._active_threads.clear()
            self._finished_thread_count = 0
            self._total_thread_count = max(1, thread_count)
            self._metrics = {
                "running": 0,
                "paused": 0,
                "waiting": len(accounts),
                "completed": 0,
                "systemError": 0,
                "deadAccount": 0,
                "stopped": 0,
            }
            self._logs.clear()

        self.log("System", "info", f"Khởi chạy phiên đăng {post_type.upper()} ({session_id}) với {len(accounts)} tài khoản.")

        # Khởi chạy Executor
        self._executor = ThreadPoolExecutor(max_workers=self._total_thread_count, thread_name_prefix="PostWorker")
        for i in range(self._total_thread_count):
            self._executor.submit(self._worker_loop, session_id, f"Thread-{str(i+1).zfill(2)}", post_type, min_delay, max_delay)

        return session_id

    def start_session_with_existing(
        self,
        session_id: str,
        post_type: str,
        account_count: int,
        thread_count: int = 1,
        min_delay: int = 600,
        max_delay: int = 900,
        accounts: Optional[List[Dict[str, Any]]] = None,
        schedule_enabled: bool = False,
        schedule_time: Optional[str] = None
    ) -> str:
        """
        Kích hoạt runner threads cho một session_id đã có sẵn trong DB.
        Điều kiện tiên quyết: Toàn bộ bài viết PENDING đã được commit vào bảng posts.
        Nếu schedule_enabled = True và schedule_time hợp lệ (HH:mm),
        các luồng sẽ chuyển sang trạng thái "Chờ thực thi" và tự động đếm ngược đến giờ hẹn.
        """
        import datetime

        target_dt = None
        delay_seconds = 0
        is_scheduled = bool(schedule_enabled and schedule_time)

        if is_scheduled:
            try:
                now = datetime.datetime.now()
                parts = str(schedule_time).strip().split(":")
                sched_h = int(parts[0])
                sched_m = int(parts[1])
                target = now.replace(hour=sched_h, minute=sched_m, second=0, microsecond=0)
                diff = int((target - now).total_seconds())
                if diff <= 0:
                    # BR-M03-PUB-01: Giờ hẹn đã ở quá khứ -> Không tự động chuyển sang ngày mai làm treo session!
                    # Ghi log cảnh báo và kích nổ đăng ngay lập tức.
                    self.log("System", "warn", f"[CẢNH BÁO] Khung giờ hẹn {schedule_time} đã qua so với thời gian hiện tại ({now.strftime('%H:%M:%S')}) -> Tự động chuyển sang kích nổ đăng ngay!")
                    is_scheduled = False
                    delay_seconds = 0
                else:
                    delay_seconds = diff
                    target_dt = target
                    self.log("System", "info", f"Đã lên lịch thành công: Đang chờ đến {schedule_time} (còn {delay_seconds} giây) để kích nổ...")
            except Exception as e:
                logger.warning(f"Lỗi tính khung giờ hẹn {schedule_time}: {e}")

        with self._lock:
            # Kiểm tra xem có thread nào thực sự đang chạy không
            has_running_threads = any(
                t.get("status") in ("Đang chạy", "Đang chờ")
                for t in self._active_threads.values()
            )
            if self._active_session_id and has_running_threads and not self._stop_event.is_set():
                raise RuntimeError("Đang có một phiên đăng bài khác đang chạy. Hãy dừng trước khi bắt đầu mới.")

            self._active_session_id = session_id
            self._post_type = post_type
            self._session_accounts = [str(a.get("uid", "")) for a in (accounts or []) if a.get("uid")]
            self._pause_event.set()
            self._stop_event.clear()
            self._active_threads.clear()
            self._finished_thread_count = 0
            self._total_thread_count = max(1, thread_count)
            self._schedule_enabled = is_scheduled and (delay_seconds > 0)
            self._scheduled_time_str = schedule_time if self._schedule_enabled else None

            if self._schedule_enabled:
                self._schedule_event.clear()
                self._metrics = {
                    "running": 0,
                    "paused": 0,
                    "waiting": account_count,
                    "completed": 0,
                    "systemError": 0,
                    "deadAccount": 0,
                    "stopped": 0,
                }
            else:
                self._schedule_event.set()
                self._metrics = {
                    "running": self._total_thread_count,
                    "paused": 0,
                    "waiting": max(0, account_count - self._total_thread_count),
                    "completed": 0,
                    "systemError": 0,
                    "deadAccount": 0,
                    "stopped": 0,
                }
            self._logs.clear()

            # Cache thông tin credentials từ danh sách accounts nếu có
            if accounts:
                for acc in accounts:
                    u = str(acc.get("uid", "")).strip()
                    if u:
                        self._account_credentials[u] = {
                            "uid": u,
                            "password": acc.get("password", "") or "",
                            "two_fa": acc.get("twoFactorSecret", "") or acc.get("two_fa", "") or "",
                            "cookie": acc.get("cookie", "") or "",
                            "proxy": acc.get("proxy", "") or "",
                        }

            # Khởi tạo trước danh sách thread để UI cập nhật ngay lập tức
            for i in range(self._total_thread_count):
                t_name = f"Thread-{str(i+1).zfill(2)}"
                if self._schedule_enabled and target_dt:
                    self._active_threads[t_name] = {
                        "id": t_name,
                        "threadId": t_name,
                        "accountUid": "-",
                        "accountName": "Chờ đến giờ hẹn",
                        "status": "Chờ thực thi",
                        "contentPreview": f"Hẹn giờ đăng lúc {schedule_time}",
                        "currentActivity": f"Đang chờ đến khung giờ {schedule_time} để kích nổ...",
                        "startTime": time.time(),
                    }
                else:
                    self._active_threads[t_name] = {
                        "id": t_name,
                        "threadId": t_name,
                        "accountUid": "-",
                        "accountName": "Đang chuẩn bị...",
                        "status": "Đang chạy",
                        "contentPreview": f"Đang chuẩn bị {post_type.upper()}...",
                        "currentActivity": "Đang khởi tạo luồng worker & kết nối Chrome...",
                        "startTime": time.time(),
                    }

        if self._schedule_enabled and target_dt:
            self.log("System", "info", f"Đang chờ đến khung giờ {schedule_time} để kích nổ...")
            self.log("System", "info", f"Đã ghi nhận {account_count} bài viết PENDING trong CSDL sẵn sàng xuất bản khi đến giờ hẹn.")

            def _scheduler_loop():
                while not self._stop_event.is_set():
                    while not self._pause_event.is_set():
                        if self._stop_event.is_set():
                            return
                        time.sleep(1)

                    now_curr = datetime.datetime.now()
                    if now_curr >= target_dt:
                        self.log("System", "info", f"Đã đến khung giờ {schedule_time}, Engine kích nổ và bắt đầu mở Chrome Profile đăng bài...")
                        with self._lock:
                            self._metrics["running"] = self._total_thread_count
                            self._metrics["waiting"] = max(0, account_count - self._total_thread_count)
                            for t_info in self._active_threads.values():
                                if t_info.get("status") == "Chờ thực thi":
                                    t_info["status"] = "Đang chạy"
                                    t_info["accountName"] = "Đang chuẩn bị..."
                                    t_info["currentActivity"] = "Bắt đầu khởi tạo luồng worker & kết nối Chrome..."
                        self._schedule_event.set()
                        break

                    diff_now = int((target_dt - now_curr).total_seconds())
                    hrs = diff_now // 3600
                    mins = (diff_now % 3600) // 60
                    secs = diff_now % 60
                    if hrs > 0:
                        rem_text = f"{hrs}h {mins}m {secs}s"
                    elif mins > 0:
                        rem_text = f"{mins}m {secs}s"
                    else:
                        rem_text = f"{secs}s"

                    with self._lock:
                        for t_info in self._active_threads.values():
                            if t_info.get("status") == "Chờ thực thi":
                                t_info["currentActivity"] = f"Đang chờ đến khung giờ {schedule_time} để kích nổ (còn {rem_text})..."

                    time.sleep(1)

            self._scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True, name="PostScheduler")
            self._scheduler_thread.start()
        else:
            self.log("System", "info", f"Khởi chạy phiên đăng {post_type.upper()} ({session_id}) với {account_count} tài khoản, {self._total_thread_count} luồng.")
            self.log("System", "info", f"Đã xác nhận {account_count} bài PENDING trong CSDL. Bắt đầu chạy worker threads...")

        # Khởi chạy Executor
        self._executor = ThreadPoolExecutor(max_workers=self._total_thread_count, thread_name_prefix="PostWorker")
        for i in range(self._total_thread_count):
            self._executor.submit(self._worker_loop, session_id, f"Thread-{str(i+1).zfill(2)}", post_type, min_delay, max_delay)

        return session_id

    def pause_session(self):
        """Tạm dừng phiên chạy."""
        self._pause_event.clear()
        with self._lock:
            self._metrics["paused"] = self._metrics["running"]
            self._metrics["running"] = 0
            for t_info in self._active_threads.values():
                if t_info.get("status") == "Đang chạy":
                    t_info["status"] = "Tạm dừng"
                    t_info["currentActivity"] = "Đã tạm dừng theo yêu cầu"
        if self._active_session_id:
            post_repository.update_post_session(self._active_session_id, "PAUSED")
        self.log("System", "warn", "Tiến trình tạm ngưng bởi người dùng")

    def resume_session(self):
        """Tiếp tục phiên chạy sau khi tạm dừng."""
        self._pause_event.set()
        with self._lock:
            self._metrics["running"] = self._metrics["paused"]
            self._metrics["paused"] = 0
            for t_info in self._active_threads.values():
                if t_info.get("status") == "Tạm dừng":
                    t_info["status"] = "Đang chạy"
                    t_info["currentActivity"] = "Tiếp tục chạy..."
        if self._active_session_id:
            post_repository.update_post_session(self._active_session_id, "RUNNING")
        self.log("System", "info", "Tiếp tục chạy nối tiếp...")

    def stop_session(self):
        """Dừng khẩn cấp toàn bộ luồng và dọn dẹp trình duyệt."""
        self._stop_event.set()
        self._pause_event.set() # Tháo pause để worker thoát vòng lặp
        self._schedule_event.set() # Tháo schedule để worker thoát vòng lặp nếu đang chờ hẹn
        if self._active_session_id:
            post_repository.update_post_session(self._active_session_id, "STOPPED", finished=True)
            post_repository.stop_all_session_posts(self._active_session_id)

        with self._lock:
            self._metrics["stopped"] += self._metrics["running"] + self._metrics["waiting"]
            self._metrics["running"] = 0
            self._metrics["waiting"] = 0
            self._metrics["paused"] = 0
            for t_info in self._active_threads.values():
                t_info["status"] = "Đã dừng"
                t_info["currentActivity"] = "Đã dừng theo yêu cầu"

        self.log("System", "warn", "Đã nhận lệnh DỪNG KHẨN CẤP: Đang đóng toàn bộ Chrome profiles...")

        # Đóng toàn bộ drivers
        for t_name, driver in list(self._active_drivers.items()):
            try:
                from modules.module_03_acc_farm.browser.manager import safe_close_driver
                safe_close_driver(driver)
            except Exception:
                try:
                    driver.quit()
                except Exception:
                    pass
        self._active_drivers.clear()

        # Đánh dấu toàn bộ các bài PENDING/RUNNING trong session sang STOPPED
        if self._active_session_id:
            try:
                post_repository.stop_all_session_posts(self._active_session_id)
            except Exception as e:
                logger.error(f"Lỗi khi đánh dấu bài viết sang STOPPED: {e}")

    def reset_session(self):
        """Reset phiên đăng bài về trạng thái ban đầu để người dùng soạn bài mới."""
        with self._lock:
            self._active_session_id = None
            self._session_accounts = []
            self._active_threads.clear()
            self._finished_thread_count = 0
            self._total_thread_count = 1
            self._stop_event.clear()
            self._pause_event.set()
            self._schedule_event.set()
            self._schedule_enabled = False
            self._scheduled_time_str = None
            self._metrics = {
                "running": 0,
                "paused": 0,
                "waiting": 0,
                "completed": 0,
                "systemError": 0,
                "deadAccount": 0,
                "stopped": 0,
            }
            self._logs.clear()

    def _check_all_threads_finished(self, session_id: str):
        """Kiểm tra và đóng session khi toàn bộ threads đã kết thúc."""
        with self._lock:
            self._finished_thread_count += 1
            all_done = self._finished_thread_count >= getattr(self, '_total_thread_count', 1)
            if all_done:
                for t_name, t_info in self._active_threads.items():
                    if t_info.get("status") in ("Đang chạy", "Đang chờ"):
                        t_info["status"] = "Hoàn thành"
                        t_info["currentActivity"] = "Phiên đăng bài đã hoàn tất."
                self._metrics["running"] = 0
                self._metrics["waiting"] = 0
                self._active_session_id = None

        if all_done:
            self.log("System", "info", "═══ TẤT CẢ CÁC LUỒNG ĐÃ HOÀN TẤT. PHIÊN KẾT THÚC. ═══")
            try:
                post_repository.update_post_session(session_id, "DONE", finished=True)
            except Exception as e:
                logger.error(f"Lỗi khi cập nhật post_session hoàn tất: {e}")

    def _worker_loop(self, session_id: str, thread_name: str, post_type: str, min_delay: int, max_delay: int):
        """Vòng lặp lấy bài từ hàng đợi posts và thực thi.

        Reels/Story: giữ 1 Chrome / account — đăng hết clip của nick rồi mới đóng.
        """
        driver = None
        held_uid = None
        held_owner = None

        def _close_held_driver(reason: str = ""):
            nonlocal driver, held_uid, held_owner
            if not driver:
                held_uid = None
                held_owner = None
                return
            close_uid = held_uid
            close_owner = held_owner
            try:
                try:
                    driver.get("about:blank")
                    time.sleep(3)
                except Exception:
                    pass
                from modules.module_02_account_manager.context import owner_scope
                from modules.module_03_acc_farm.browser.manager import safe_close_driver
                with owner_scope(close_owner):
                    safe_close_driver(driver, uid=close_uid)
            except Exception:
                try:
                    driver.quit()
                except Exception:
                    pass
            self._active_drivers.pop(thread_name, None)
            if reason:
                self.log(
                    thread_name,
                    "info",
                    f"Đã đóng Chrome Profile UID {close_uid or '?'} ({reason}).",
                )
            driver = None
            held_uid = None
            held_owner = None

        try:
            # Chờ đến giờ hẹn (nếu phiên có thiết lập hẹn giờ)
            while not self._schedule_event.is_set():
                if self._stop_event.is_set():
                    return
                time.sleep(1)

            while not self._stop_event.is_set():
                # Kiểm tra cờ Pause
                while not self._pause_event.is_set():
                    if self._stop_event.is_set():
                        return
                    time.sleep(1)

                # Ưu tiên clip cùng nick đang giữ browser — không đóng Chrome giữa các vid
                post = post_repository.claim_next_pending_post(
                    session_id, prefer_uid=held_uid
                )
                if not post and held_uid:
                    pending_same = post_repository.count_pending_posts(
                        session_id, account_uid=held_uid
                    )
                    if pending_same > 0:
                        # Transient: vẫn còn clip cùng nick → giữ browser, thử lại
                        self.log(
                            thread_name,
                            "info",
                            f"Còn {pending_same} clip PENDING cho UID {held_uid} — giữ Chrome, thử claim lại...",
                        )
                        time.sleep(1)
                        continue
                    # Hết clip của nick đang giữ → đóng 1 lần rồi nhận nick khác
                    _close_held_driver("hết clip của nick hiện tại")
                    post = post_repository.claim_next_pending_post(session_id)

                if not post:
                    pending_cnt = post_repository.count_pending_posts(session_id)
                    if pending_cnt > 0:
                        _close_held_driver("chờ tài khoản khác sẵn sàng")
                        with self._lock:
                            if thread_name in self._active_threads:
                                self._active_threads[thread_name]["status"] = "Đang chờ"
                                self._active_threads[thread_name]["currentActivity"] = (
                                    "Đang chờ tài khoản sẵn sàng để nhận bài tiếp theo..."
                                )
                        time.sleep(3)
                        continue

                    self.log(thread_name, "info", "Hàng đợi bài viết đã hết. Luồng hoàn tất nhiệm vụ.")
                    with self._lock:
                        if thread_name in self._active_threads:
                            self._active_threads[thread_name]["status"] = "Hoàn thành"
                            self._active_threads[thread_name]["currentActivity"] = (
                                "Đã xử lý xong toàn bộ bài viết được giao."
                            )
                    break

                uid = post["account_uid"]
                name = post.get("account_name", uid)
                m_file = os.path.basename(post.get("media_path") or "")
                c_text = (post.get("content") or "").strip().replace("\n", " ")
                if m_file and c_text:
                    content_preview = f"[{m_file}] {c_text}"
                elif m_file:
                    content_preview = f"[{m_file}]"
                else:
                    content_preview = c_text or f"Đang chuẩn bị {post_type.upper()}..."
                if len(content_preview) > 45:
                    content_preview = content_preview[:45] + "..."

                reuse_browser = bool(driver and held_uid == uid)
                if driver and held_uid and held_uid != uid:
                    _close_held_driver(f"đổi nick {held_uid} → {uid}")

                activity = (
                    f"Tái sử dụng Chrome — đăng clip tiếp theo cho {name}..."
                    if reuse_browser
                    else f"Bắt đầu khởi tạo Chrome Profile cho {name}..."
                )
                with self._lock:
                    self._active_threads[thread_name] = {
                        "id": str(post["id"]),
                        "threadId": thread_name,
                        "accountUid": uid,
                        "accountName": name,
                        "status": "Đang chạy",
                        "contentPreview": content_preview or f"Đang chuẩn bị {post_type.upper()}...",
                        "currentActivity": activity,
                        "startTime": time.time(),
                    }
                    self._metrics["running"] = len(
                        [t for t in self._active_threads.values() if t.get("status") == "Đang chạy"]
                    )

                post_logs = []
                init_msg = (
                    f"Đăng clip tiếp theo cho {name} (UID: {uid}) — giữ nguyên Chrome Profile..."
                    if reuse_browser
                    else f"Bắt đầu xử lý bài đăng cho tài khoản {name} (UID: {uid})..."
                )
                self.log(thread_name, "info", init_msg)
                post_logs.append(
                    {
                        "timestamp": time.strftime("%H:%M:%S"),
                        "thread": thread_name,
                        "type": "info",
                        "message": init_msg,
                    }
                )

                def on_progress(msg: str):
                    self.log(thread_name, "info", msg)
                    post_logs.append(
                        {
                            "timestamp": time.strftime("%H:%M:%S"),
                            "thread": thread_name,
                            "type": "info",
                            "message": msg,
                        }
                    )
                    with self._lock:
                        if thread_name in self._active_threads:
                            self._active_threads[thread_name]["currentActivity"] = msg

                close_browser_after = False
                same_uid_continue = False
                owner = held_owner
                try:
                    # Validate media trước khi mở / reuse Chrome
                    if post_type == "story":
                        m_path = post.get("media_path")
                        if not m_path or not os.path.isfile(m_path):
                            raise FileNotFoundError(f"File media Story không tồn tại: {m_path}")
                        m_ext = os.path.splitext(m_path)[1].lower()
                        if m_ext not in {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov"}:
                            raise ValueError(
                                f"Chế độ Story chỉ hỗ trợ video (.mp4, .mov) hoặc ảnh (.jpg, .png, .webp). "
                                f"File '{os.path.basename(m_path)}' không đúng định dạng."
                            )
                    elif post_type == "reels":
                        m_path = post.get("media_path")
                        if not m_path or not os.path.isfile(m_path):
                            raise FileNotFoundError(f"File video Reels không tồn tại: {m_path}")
                        m_ext = os.path.splitext(m_path)[1].lower()
                        if m_ext not in {".mp4", ".mov"}:
                            raise ValueError(
                                f"Chế độ Reels chỉ hỗ trợ video (.mp4, .mov). "
                                f"File '{os.path.basename(m_path)}' không đúng định dạng video."
                            )

                    creds = self.get_account_credentials(uid)
                    proxy = creds.get("proxy") or None
                    owner = creds.get("user_id")

                    import importlib
                    import modules.module_03_acc_farm.post_flow as _post_flow_mod

                    try:
                        importlib.reload(_post_flow_mod)
                    except Exception:
                        pass

                    if not reuse_browser:
                        on_progress("Đang mở Chrome Profile (hiển thị trực tiếp)...")
                        from modules.module_02_account_manager.context import owner_scope

                        with owner_scope(owner):
                            try:
                                from modules.module_03_acc_farm.browser.manager import (
                                    create_driver as farm_create_driver,
                                )

                                driver = farm_create_driver(
                                    uid, headless=False, proxy=proxy, scope="post"
                                )
                            except Exception as b_err:
                                self.log(
                                    thread_name,
                                    "warn",
                                    f"Browser Manager ({b_err}) fallback sang Chrome trực tiếp...",
                                )
                                from selenium import webdriver
                                from modules.module_02_account_manager.automation.browser_manager import (
                                    get_profile_path,
                                )

                                opts = webdriver.ChromeOptions()
                                profile_dir = creds.get("profile_path") or get_profile_path(uid)
                                opts.add_argument(f"--user-data-dir={profile_dir}")
                                opts.add_argument("--disable-blink-features=AutomationControlled")
                                opts.add_argument("--start-maximized")
                                opts.add_argument("--disable-infobars")
                                opts.add_argument("--no-first-run")
                                driver = webdriver.Chrome(options=opts)

                        held_uid = uid
                        held_owner = owner
                        self._active_drivers[thread_name] = driver
                        try:
                            from core.browser.driver import bring_chrome_to_front

                            bring_chrome_to_front(driver)
                        except Exception:
                            pass

                        on_progress("Kiểm tra phiên đăng nhập Facebook từ Chrome Profile...")
                        try:
                            _post_flow_mod.ensure_facebook_session(
                                driver=driver,
                                uid=uid,
                                password=creds.get("password", ""),
                                two_fa_secret=creds.get("two_fa", ""),
                                cookie_str=creds.get("cookie", ""),
                                account_name=name,
                                log_cb=on_progress,
                            )
                        except _post_flow_mod.PostAccountDead as _dead:
                            raise PostAccountDead(
                                f"Chrome Profile chưa đăng nhập hoặc gặp sự cố: {_dead}"
                            )
                        on_progress("Phiên đăng nhập hợp lệ — bắt đầu đăng bài...")
                    else:
                        on_progress(
                            f"Giữ Chrome Profile UID {uid} — đăng clip tiếp theo không mở browser mới..."
                        )

                    def check_pause(step_log_cb=None):
                        """Đóng băng ngay lập tức các thao tác tự động nếu người dùng nhấn Tạm dừng."""
                        if not self._pause_event.is_set():
                            pause_msg = "Tiến trình tạm ngưng bởi người dùng"
                            if step_log_cb:
                                step_log_cb(pause_msg)
                            self.log(thread_name, "warn", pause_msg)
                            with self._lock:
                                if thread_name in self._active_threads:
                                    self._active_threads[thread_name]["status"] = "Tạm dừng"
                                    self._active_threads[thread_name]["currentActivity"] = pause_msg
                            while not self._pause_event.is_set():
                                if self._stop_event.is_set():
                                    return
                                time.sleep(0.5)
                            resume_msg = "Tiếp tục chạy nối tiếp..."
                            if step_log_cb:
                                step_log_cb(resume_msg)
                            self.log(thread_name, "info", resume_msg)
                            with self._lock:
                                if thread_name in self._active_threads:
                                    self._active_threads[thread_name]["status"] = "Đang chạy"
                                    self._active_threads[thread_name]["currentActivity"] = resume_msg

                    if post_type == "status":
                        res_url = _post_flow_mod.publish_status_post(
                            driver,
                            post["content"],
                            post.get("image_path"),
                            on_progress,
                            check_pause=check_pause,
                            uid=uid,
                            image_paths=post.get("image_paths"),
                        )
                    elif post_type == "reels":
                        res_url = _post_flow_mod.publish_reels_post(
                            driver,
                            post["media_path"],
                            post.get("content", ""),
                            on_progress,
                            check_pause=check_pause,
                            uid=uid,
                        )
                    elif post_type == "story":
                        res_url = _post_flow_mod.publish_story_post(
                            driver,
                            post["media_path"],
                            post.get("content"),
                            on_progress,
                            check_pause=check_pause,
                            uid=uid,
                        )
                    else:
                        res_url = None

                    if not res_url and uid:
                        if post_type == "reels":
                            res_url = f"https://www.facebook.com/{uid}/reels"
                        elif post_type == "story":
                            res_url = f"https://www.facebook.com/stories/{uid}"
                        else:
                            res_url = f"https://www.facebook.com/{uid}"

                    success_msg = f"XUẤT BẢN THÀNH CÔNG {post_type.upper()}! Link: {res_url or 'N/A'}"
                    post_logs.append(
                        {
                            "timestamp": time.strftime("%H:%M:%S"),
                            "thread": thread_name,
                            "type": "success",
                            "message": success_msg,
                        }
                    )
                    post_repository.finish_post(
                        post["id"], uid, "PUBLISHED", url=res_url, logs=post_logs
                    )
                    try:
                        from modules.module_02_account_manager.database.connection import SessionLocal
                        from modules.module_02_account_manager.database.repository import (
                            AccountRepository,
                        )
                        from modules.module_02_account_manager.context import owner_scope

                        with SessionLocal() as db_session:
                            with owner_scope(owner):
                                AccountRepository.update_profile_statuses(
                                    db_session, {uid: "live"}, owner_username=owner
                                )
                    except Exception:
                        pass
                    with self._lock:
                        self._metrics["completed"] += 1
                        if thread_name in self._active_threads:
                            self._active_threads[thread_name]["status"] = "Hoàn thành"
                            self._active_threads[thread_name]["currentActivity"] = success_msg
                        self._metrics["running"] = len(
                            [
                                t
                                for t in self._active_threads.values()
                                if t.get("status") == "Đang chạy"
                            ]
                        )
                    self.log(
                        thread_name,
                        "info",
                        f"XUẤT BẢN THÀNH CÔNG {post_type.upper()} cho UID {uid}. Link: {res_url or 'N/A'}",
                    )
                    self.log(
                        thread_name,
                        "info",
                        f"Đã cập nhật trạng thái bài viết ID {post['id']} sang SUCCESS trong CSDL.",
                    )
                    # Reels + Story: còn clip cùng nick → giữ Chrome, đăng tiếp
                    remaining_same = post_repository.count_pending_posts(
                        session_id, account_uid=uid
                    )
                    same_uid_continue = remaining_same > 0
                    clip_label = "Story" if post_type == "story" else "video"
                    if same_uid_continue:
                        self.log(
                            thread_name,
                            "info",
                            f"Còn {remaining_same} {clip_label} cho UID {uid} — giữ Chrome, đăng tiếp (không đóng browser)...",
                        )
                    else:
                        self.log(
                            thread_name,
                            "info",
                            f"Đã hết {clip_label} trong hàng đợi của UID {uid}.",
                        )

                except Exception as e:
                    if self._stop_event.is_set():
                        status = "STOPPED"
                        err_msg = "Tiến trình đã dừng theo yêu cầu của người dùng (Dừng khẩn cấp)."
                    else:
                        status, err_msg = classify_error(e)

                    post_logs.append(
                        {
                            "timestamp": time.strftime("%H:%M:%S"),
                            "thread": thread_name,
                            "type": "warn" if status == "STOPPED" else "error",
                            "message": f"[{status}] {err_msg}",
                        }
                    )
                    post_repository.finish_post(
                        post["id"], uid, status, message=err_msg, logs=post_logs
                    )
                    if status == "DIE":
                        try:
                            from modules.module_02_account_manager.database.connection import (
                                SessionLocal,
                            )
                            from modules.module_02_account_manager.database.repository import (
                                AccountRepository,
                            )
                            from modules.module_02_account_manager.context import owner_scope

                            with SessionLocal() as db_session:
                                with owner_scope(owner):
                                    AccountRepository.update_profile_statuses(
                                        db_session, {uid: "die"}, owner_username=owner
                                    )
                        except Exception as e_status:
                            logger.error(
                                f"Failed to persist dead status for UID {uid}: {e_status}"
                            )
                    with self._lock:
                        if status == "DIE":
                            self._metrics["deadAccount"] += 1
                        elif status == "STOPPED":
                            self._metrics["stopped"] += 1
                        else:
                            self._metrics["systemError"] += 1
                        if thread_name in self._active_threads:
                            self._active_threads[thread_name]["status"] = (
                                "Acc chết"
                                if status == "DIE"
                                else ("Đã dừng" if status == "STOPPED" else "Lỗi hệ thống")
                            )
                            self._active_threads[thread_name]["currentActivity"] = err_msg
                        self._metrics["running"] = len(
                            [
                                t
                                for t in self._active_threads.values()
                                if t.get("status") == "Đang chạy"
                            ]
                        )

                    if status == "DIE":
                        self.log(thread_name, "error", f"ACC CHẾT: {err_msg}")
                    elif status == "BLOCKED":
                        self.log(thread_name, "error", f"BỊ CHẶN ĐĂNG BÀI: {err_msg}")
                    elif status == "STOPPED":
                        self.log(thread_name, "warn", f"TIẾN TRÌNH ĐÃ DỪNG: {err_msg}")
                    else:
                        self.log(
                            thread_name,
                            "error",
                            f"LỖI HỆ THỐNG ({type(e).__name__}): {err_msg}",
                        )
                    self.log(
                        thread_name,
                        "info",
                        f"Đã cập nhật trạng thái bài viết ID {post['id']} sang {status} trong CSDL.",
                    )
                    # Chỉ đóng browser khi DIE/BLOCKED/STOPPED.
                    # Lỗi 1 clip (Reels/Story): giữ Chrome nếu còn PENDING cùng nick.
                    remaining_after_err = post_repository.count_pending_posts(
                        session_id, account_uid=uid
                    )
                    if status in ("DIE", "BLOCKED", "STOPPED"):
                        close_browser_after = True
                        same_uid_continue = False
                    elif remaining_after_err > 0 and driver and held_uid == uid:
                        close_browser_after = False
                        same_uid_continue = True
                        self.log(
                            thread_name,
                            "warn",
                            f"Clip lỗi nhưng còn {remaining_after_err} PENDING cùng UID {uid} — giữ Chrome đăng tiếp...",
                        )
                    else:
                        close_browser_after = True
                        same_uid_continue = False

                if close_browser_after:
                    _close_held_driver("lỗi nặng / dừng / acc chết / hết clip")
                elif (
                    not close_browser_after
                    and not same_uid_continue
                    and driver
                    and held_uid == uid
                ):
                    # Hết clip của nick này sau khi đăng xong → đóng trước khi nghỉ đổi nick
                    _close_held_driver("hết clip sau khi đăng xong")

                # Delay: ngắn giữa 2 clip cùng nick (Reels/Story giữ Chrome); đầy đủ khi đổi nick
                if not self._stop_event.is_set():
                    if same_uid_continue and driver and held_uid == uid:
                        delay = random.randint(2, min(5, max(2, max_delay)))
                        self.log(
                            thread_name,
                            "info",
                            f"Nghỉ {delay}s rồi đăng {post_type} tiếp theo (cùng Chrome UID {uid})...",
                        )
                        time.sleep(delay)
                    else:
                        delay = random.randint(
                            min(min_delay, max_delay), max(min_delay, max_delay)
                        )
                        self.log(
                            thread_name,
                            "info",
                            f"Nghỉ giãn cách {delay}s trước khi chuyển nick tiếp theo...",
                        )
                        time.sleep(min(delay, 5))

            _close_held_driver("hết hàng đợi")

        except Exception as ex:
            self.log(thread_name, "error", f"Worker loop crashed: {type(ex).__name__}: {ex}")
            with self._lock:
                if thread_name in self._active_threads:
                    self._active_threads[thread_name]["status"] = "Lỗi hệ thống"
                    self._active_threads[thread_name]["currentActivity"] = f"Lỗi luồng: {ex}"
        finally:
            _close_held_driver("worker exit")
            with self._lock:
                if thread_name in self._active_threads:
                    if self._active_threads[thread_name]["status"] in ("Đang chạy", "Đang chờ"):
                        if self._stop_event.is_set():
                            self._active_threads[thread_name]["status"] = "Đã dừng"
                            self._active_threads[thread_name]["currentActivity"] = (
                                "Luồng đã dừng theo yêu cầu."
                            )
                        else:
                            self._active_threads[thread_name]["status"] = "Hoàn thành"
                            self._active_threads[thread_name]["currentActivity"] = (
                                "Luồng đã kết thúc xử lý."
                            )
            self._check_all_threads_finished(session_id)

runner = PostRunner()
