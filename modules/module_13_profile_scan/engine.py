"""Chạy phiên quét profile: nhiều luồng, mỗi luồng một tài khoản + proxy riêng."""
from __future__ import annotations

import json
import logging
import random
import threading
import time
from typing import Any, Dict, List, Optional, Set

from core.browser.driver import close_driver_for_uid, load_cookies, open_browser
from core.browser.profile import get_profile_lock
from modules.module_03_acc_farm.browser.errors import is_browser_gone
from modules.module_11_page_scanner.browser_session import AccountRotation, get_active_job_for_account
from modules.module_11_page_scanner.scanner import resolve_scan_accounts

from . import models, reader

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 2
_RUNS: Dict[int, "Run"] = {}
_RUNS_LOCK = threading.Lock()


class BrowserClosed(RuntimeError):
    """Chrome bị tắt / treo: dừng luồng của tài khoản đó, không mở lại."""


def _closed(exc: BaseException) -> bool:
    # net::ERR_INTERNET_DISCONNECTED là mất mạng, không phải Chrome bị tắt
    return is_browser_gone(exc) and "net::err_" not in str(exc).lower()


def _ensure_open(driver) -> None:
    """Chrome hoặc tab đang quét đã bị tắt → BrowserClosed."""
    try:
        driver.execute_script("return 1")  # current_window_handle không chạm tới Chrome nên không biết đã tắt
    except Exception as exc:
        if _closed(exc):
            raise BrowserClosed("Trình duyệt bị đóng giữa chừng") from exc


class Run:
    def __init__(self, session_id: int, owner: str, settings: Dict[str, Any], accounts: List[Dict[str, Any]]):
        self.id = session_id
        self.owner = owner
        self.settings = settings
        self.accounts = accounts
        self.stop_event = threading.Event()
        self.pause_event = threading.Event()
        self._pool = threading.Lock()
        self._in_use: Set[str] = set()
        self._dead: Set[str] = set()
        self._scanning: Dict[str, int] = {}  # UID người đang được quét → mục tiêu
        self._closed: Set[str] = set()  # tài khoản bị tắt Chrome giữa chừng
        self._order: List[str] = [str(a["uid"]) for a in accounts]
        self._by_uid = {str(a["uid"]): a for a in accounts}
        self._open: Dict[str, Optional[str]] = {}

    def log(self, message: str, level: str = "info") -> None:
        models.log(self.id, message, level)

    # ---------- Kho tài khoản ----------

    def take_account(self) -> Optional[str]:
        """Tài khoản rảnh kế tiếp; lấy xong xếp xuống cuối hàng."""
        with self._pool:
            for uid in list(self._order):
                if uid in self._in_use or uid in self._dead or get_active_job_for_account(uid):
                    continue
                self._in_use.add(uid)
                self._order.remove(uid)
                self._order.append(uid)
                return uid
        return None

    def give_back(self, uid: str, dead: bool = False) -> None:
        with self._pool:
            self._in_use.discard(uid)
            if dead:
                self._dead.add(uid)

    # ---------- Chrome ----------

    def _acc_owner(self, uid: str) -> Optional[str]:
        return self._by_uid[uid].get("user_id")

    def open_chrome(self, uid: str):
        acc = self._by_uid[uid]
        owner = self._acc_owner(uid)
        lock = get_profile_lock(uid, owner=owner)
        if not lock.acquire(timeout=5):
            raise RuntimeError("tài khoản đang được chức năng khác sử dụng")
        try:
            with self._pool:
                self._open[uid] = owner
            driver = open_browser(
                uid=uid, owner=owner, proxy=acc.get("proxy"), scope="profile_scan", verify_egress=False,
                allow_direct_fallback=bool(self.settings.get("allow_direct_ip")),
                on_log=lambda level, message: self.log(message, "warn" if level == "warning" else level),
            )
            try:
                self._login(driver, acc)
            except Exception:
                _ensure_open(driver)  # đăng nhập hỏng vì Chrome bị tắt
                raise
            return driver, lock
        except BaseException:
            self.close_chrome(uid, lock)
            raise

    def _login(self, driver, acc: Dict[str, Any]) -> None:
        if acc.get("cookie"):
            load_cookies(driver, acc["cookie"])
        # Kiểm tra / đăng nhập lại bằng đúng cơ chế của module 11
        login = AccountRotation(self.id, "PROFILE_SCAN", [acc], self.owner, log=self.log)
        login.driver = driver
        login.ensure_login()

    def close_chrome(self, uid: str, lock) -> None:
        try:
            close_driver_for_uid(uid, self._acc_owner(uid))
        except Exception as exc:
            logger.warning(f"[Module 13] đóng Chrome {uid}: {exc}")
        finally:
            with self._pool:
                self._open.pop(uid, None)
            lock.release()

    def kill_browsers(self) -> None:
        """Dừng khẩn cấp: đóng Chrome của phiên này; khóa profile do luồng đang chạy tự nhả."""
        with self._pool:
            opened = dict(self._open)
        for uid, owner in opened.items():
            try:
                close_driver_for_uid(uid, owner)
            except Exception as exc:
                logger.warning(f"[Module 13] dừng khẩn cấp {uid}: {exc}")

    # ---------- Vòng chạy ----------

    def _stopped(self) -> bool:
        """Đứng chờ khi đang tạm dừng; True nếu đã bấm dừng."""
        while self.pause_event.is_set() and not self.stop_event.is_set():
            time.sleep(0.3)
        return self.stop_event.is_set()

    def _accept(self, data: Dict[str, Any]) -> Optional[str]:
        minimum = int(self.settings.get("min_friends") or 0)
        # Ẩn số bạn bè thì vẫn giữ
        if minimum and data.get("friends") is not None and data["friends"] < minimum:
            return f"Chỉ có {data['friends']} bạn bè (lọc từ {minimum})"
        return None

    def _check_duplicate(self, target: Dict[str, Any], uid: str) -> None:
        """Đã quét người này trong phiên → ProfileSkipped. Luồng khác đang quét thì đợi kết quả của luồng đó."""
        while True:
            with self._pool:
                if self._scanning.setdefault(uid, target["id"]) == target["id"]:
                    break
            if self._stopped():
                raise reader.Stopped()
            time.sleep(0.3)
        if models.done_in_session(self.id, uid, target["id"]):
            models.link_profile(self.owner, uid, list(target["source_keys"] or []))
            raise reader.ProfileSkipped(f"Trùng với UID {uid} đã quét trong phiên này")

    def _release_scanning(self, target_id: int) -> None:
        with self._pool:
            for uid in [u for u, t in self._scanning.items() if t == target_id]:
                del self._scanning[uid]

    def _reuse(self, target: Dict[str, Any]) -> bool:
        """Bộ lọc 'bỏ qua người đã quét': dùng lại dữ liệu trong kho, không mở trang."""
        if not self.settings.get("skip_scanned"):
            return False
        old = models.find_profile(self.owner, target["profile_key"])
        if not old:
            return False
        models.link_profile(self.owner, old["uid"], list(target["source_keys"] or []))
        if models.done_in_session(self.id, old["uid"], target["id"]):
            reason = f"Trùng với UID {old['uid']} đã quét trong phiên này"
            models.finish_target(target["id"], "SKIPPED", None, reason)
            self.log(f"{old['name'] or target['profile_key']}: bỏ qua — {reason}", "warn")
            return True
        models.finish_target(target["id"], "DONE", old["uid"], "Đã có trong kho")
        self.log(f"{old['name'] or target['profile_key']}: đã quét trước đó — dùng lại dữ liệu có sẵn")
        return True

    def _scan_one(self, driver, uid: str, target: Dict[str, Any]) -> None:
        try:
            self._read_and_save(driver, uid, target)
        finally:
            self._release_scanning(target["id"])

    def _read_and_save(self, driver, uid: str, target: Dict[str, Any]) -> None:
        label = target.get("name") or target["profile_key"]

        def accept(data: Dict[str, Any]) -> Optional[str]:
            self._check_duplicate(target, data["uid"])
            return self._accept(data)

        try:
            data = reader.read_profile(driver, target["profile_key"], uid, self._stopped, accept)
        except reader.ProfileSkipped as exc:
            models.finish_target(target["id"], "SKIPPED", None, str(exc))
            self.log(f"{label}: bỏ qua — {exc}", "warn")
            return
        data["avatar_url"] = data.get("avatar_url") or target.get("avatar_url")
        models.save_profile(self.owner, data["uid"], data, self.id, list(target["source_keys"] or []))
        models.finish_target(target["id"], "DONE", data["uid"])
        phone = f" · SĐT {data['phone']}" if data.get("phone") else ""
        self.log(f"[{uid}] Đã quét {data['name']} (UID {data['uid']}){phone}", "success")

    def _worker(self, number: int) -> None:
        uid: Optional[str] = None
        driver = lock = None
        used = 0
        rotate = int(self.settings["rotate_every"])
        target: Optional[Dict[str, Any]] = None
        dead = False
        try:
            while not self._stopped():
                # Đủ số profile → đổi sang tài khoản khác đang rảnh (không có thì dùng tiếp)
                if driver is not None and used >= rotate:
                    other = self.take_account()
                    used = 0
                    if other:
                        self.log(f"Luồng {number}: {uid} đã quét đủ {rotate} profile, đổi sang {other}", "warn")
                        self.close_chrome(uid, lock)
                        driver = lock = None
                        self.give_back(uid)
                        uid = other
                if uid is None:
                    uid = self.take_account()
                    if uid is None:
                        self.log(f"Luồng {number}: không còn tài khoản rảnh", "warn")
                        return
                target = models.claim_target(self.id, uid)
                if not target:
                    return
                if self._reuse(target):
                    target = None
                    continue
                if driver is None:
                    try:
                        self.log(f"Luồng {number}: mở Chrome tài khoản {uid}")
                        driver, lock = self.open_chrome(uid)
                        used = 0
                    except BrowserClosed:
                        raise
                    except Exception as exc:
                        if self.stop_event.is_set():
                            return
                        models.finish_target(target["id"], "PENDING", count_attempt=False)
                        target = None
                        self.log(f"Không dùng được tài khoản {uid}: {str(exc)[:300]}", "error")
                        self.give_back(uid, dead=True)
                        uid = None
                        continue
                try:
                    _ensure_open(driver)
                    self._scan_one(driver, uid, target)
                except reader.Stopped:
                    return
                except reader.AccountBlocked as exc:
                    if self.stop_event.is_set():
                        return
                    models.finish_target(target["id"], "PENDING", count_attempt=False)
                    target = None
                    self.log(f"Tài khoản {uid}: {exc} — đổi tài khoản khác", "error")
                    self.close_chrome(uid, lock)
                    driver = lock = None
                    self.give_back(uid, dead=True)
                    uid = None
                    continue
                except BrowserClosed:
                    raise
                except Exception as exc:
                    if self.stop_event.is_set():
                        return
                    if _closed(exc):
                        raise BrowserClosed("Trình duyệt bị đóng giữa chừng") from exc
                    logger.exception(f"[Module 13] phiên #{self.id} mục tiêu {target['profile_key']}")
                    last = int(target["attempts"]) + 1 >= MAX_ATTEMPTS
                    detail = (str(exc).splitlines() or [type(exc).__name__])[0][:200]
                    models.finish_target(target["id"], "FAILED" if last else "PENDING", None, detail)
                    self.log(
                        f"{target.get('name') or target['profile_key']}: lỗi {detail}{'' if last else ' — sẽ thử lại'}", "error"
                    )
                target = None
                used += 1
                if self.stop_event.wait(random.uniform(self.settings["delay_min"], self.settings["delay_max"])):
                    return
        except BrowserClosed as exc:
            if self.stop_event.is_set():
                return
            dead = True
            with self._pool:
                self._closed.add(uid)
            logger.warning(f"[Module 13] phiên #{self.id}: Chrome {uid} bị tắt ({exc.__cause__!r})")
            self.log(f"Tài khoản {uid}: {exc} — dừng luồng {number}. Phần đã quét vẫn được lưu", "error")
        finally:
            if target is not None:
                models.finish_target(target["id"], "PENDING", count_attempt=False)
            if driver is not None:
                self.close_chrome(uid, lock)
            if uid:
                self.give_back(uid, dead=dead)

    def _guarded_worker(self, number: int) -> None:
        try:
            self._worker(number)
        except Exception as exc:
            logger.exception(f"[Module 13] luồng {number} phiên #{self.id}")
            self.log(f"Luồng {number} dừng do lỗi: {exc}", "error")

    def _heartbeat(self, done: threading.Event) -> None:
        while not done.wait(20):
            try:
                models.heartbeat(self.id)
            except Exception as exc:
                logger.warning(f"[Module 13] heartbeat #{self.id}: {exc}")

    def run(self) -> None:
        done = threading.Event()
        threading.Thread(target=self._heartbeat, args=(done,), daemon=True).start()
        status, message = "FAILED", None
        try:
            count = min(int(self.settings["workers"]), len(self.accounts))
            self.log(
                f"Bắt đầu: {models.pending_count(self.id)} profile · {count} luồng · {len(self.accounts) - count} tài khoản dự phòng"
            )
            threads = [
                threading.Thread(target=self._guarded_worker, args=(i + 1,), daemon=True, name=f"profile_scan_{self.id}_{i + 1}")
                for i in range(count)
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            models.requeue_running(self.id)
            c = models.session_counts(self.id)
            if c["pending"] == 0:
                status, message = "COMPLETED", f"Hoàn tất: {c['done']} đã quét, {c['skipped']} bỏ qua, {c['failed']} lỗi"
            elif self.stop_event.is_set():
                status, message = "STOPPED", f"Đã dừng, còn {c['pending']} profile chưa quét"
            elif self._closed:
                closed = ", ".join(sorted(self._closed))
                status, message = "SUSPENDED", f"Trình duyệt bị đóng giữa chừng ({closed}), còn {c['pending']} profile chưa quét"
            else:
                status, message = "SUSPENDED", f"Không còn tài khoản dùng được, còn {c['pending']} profile chưa quét"
        except Exception as exc:
            logger.exception(f"[Module 13] phiên #{self.id}")
            message = str(exc)[:500]
        finally:
            done.set()
            with _RUNS_LOCK:
                _RUNS.pop(self.id, None)
            self.log(message or "Kết thúc", "success" if status == "COMPLETED" else "warn")
            models.set_status(self.id, status, message)


def local_ids() -> List[int]:
    with _RUNS_LOCK:
        return list(_RUNS)


def get_run(session_id: int) -> Optional[Run]:
    with _RUNS_LOCK:
        return _RUNS.get(session_id)


def _launch(session_id: int, owner: str, settings: Dict[str, Any], accounts: List[Dict[str, Any]]) -> None:
    run = Run(session_id, owner, settings, accounts)
    with _RUNS_LOCK:
        _RUNS[session_id] = run
    threading.Thread(target=run.run, daemon=True, name=f"profile_scan_{session_id}").start()


def start(owner: str, mode: str, settings: Dict[str, Any], targets: List[Dict[str, Any]], sources: List[Dict[str, Any]]) -> int:
    accounts = resolve_scan_accounts(settings["account_uids"], owner_key=owner)
    session_id = models.create_session(owner, mode, settings, targets, sources)
    _launch(session_id, owner, settings, accounts)
    return session_id


def resume(owner: str, session: Dict[str, Any], allow_direct_ip: Optional[bool] = None) -> None:
    settings = json.loads(session["settings"])
    if allow_direct_ip is not None:
        settings["allow_direct_ip"] = allow_direct_ip
    accounts = resolve_scan_accounts(settings["account_uids"], owner_key=owner)
    if not models.set_status(session["id"], "RUNNING", None, only_from=("SUSPENDED", "STOPPED", "FAILED")):
        raise ValueError("Phiên không ở trạng thái chạy tiếp được")
    models.save_settings(session["id"], settings)
    models.requeue_running(session["id"])
    _launch(session["id"], owner, settings, accounts)
