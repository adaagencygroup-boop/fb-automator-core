"""
campaign_scheduler.py
Module 03 - Tab 2: Luồng ngầm chạy các khung giờ của chiến dịch đăng bài.

Mỗi ~15 giây:
  1. Chốt khung đang chạy khi phiên của nó đã kết thúc (đếm bài thành công / lỗi).
  2. Khung đến giờ: runner rảnh thì chạy khung sớm nhất; runner bận (đang "Đăng ngay" hoặc khung khác)
     thì để khung xếp hàng và ghi "trễ do đang có phiên đăng khác".
  3. Chiến dịch không còn khung chờ / đang chạy → COMPLETED.
  0. Chiến dịch tạm dừng: khung chưa chạy mà đã qua giờ hẹn → MISSED (bị lỡ, có nút Chạy lại).
Lúc khởi động: khung đang chạy dở → FAILED, khung chờ quá giờ hơn 5 phút → MISSED (có nút Chạy lại).
Chỉ chạy chiến dịch của máy này (profile Chrome của nick nằm trên máy tạo chiến dịch).
"""
import logging
import os
import random
import threading
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, Optional

from modules.module_02_account_manager.context import owner_scope
from modules.module_03_acc_farm import campaign_repository as repo
from modules.module_03_acc_farm import post_now_service, post_repository
from modules.module_03_acc_farm.compose_service import (
    IMAGE_NONE,
    LAYOUT_ACCOUNTS,
    allocate_account_round,
    allocate_round,
    normalize_layout,
    clamp_image_range,
    normalize_pool_images,
    parse_compose_text,
)

logger = logging.getLogger(__name__)

TICK_SECONDS = 15
MISSED_GRACE = timedelta(minutes=5)
QUEUED_MESSAGE = "Đang xếp hàng: trễ do đang có phiên đăng khác chạy (Đăng ngay hoặc chiến dịch khác)."
_SUCCESS = "PUBLISHED"
_UNFINISHED = ("PENDING", "RUNNING")


def _hhmm(dt: datetime) -> str:
    return dt.astimezone().strftime("%H:%M")


class CampaignScheduler:
    def __init__(
        self,
        runner,
        machine_id: Callable[[], str],
        *,
        clock: Callable[[], datetime] = lambda: datetime.now().astimezone(),
        file_exists: Callable[[str], bool] = os.path.isfile,
        rng: Optional[random.Random] = None,
    ):
        self.runner = runner
        self._machine_id_fn = machine_id
        self._machine_id: Optional[str] = None
        self.clock = clock
        self.file_exists = file_exists
        self.rng = rng or random.Random()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    @property
    def machine_id(self) -> str:
        if self._machine_id is None:
            self._machine_id = self._machine_id_fn()
        return self._machine_id

    # ------------------------------------------------------------------ vòng đời
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="post-campaign-scheduler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        try:
            self.recover()
        except Exception:
            logger.exception("Không khôi phục được khung giờ chiến dịch lúc khởi động")
        while not self._stop.wait(TICK_SECONDS):
            try:
                self.tick()
            except Exception:
                logger.exception("Lượt quét chiến dịch đăng bài lỗi")

    # ------------------------------------------------------------------ khởi động
    def recover(self) -> None:
        failed, missed = repo.recover_after_restart(self.machine_id, self.clock() - MISSED_GRACE)
        for slot in failed:
            if slot.get("session_id"):
                post_repository.stop_all_session_posts(slot["session_id"])
                post_repository.update_post_session(slot["session_id"], "STOPPED", finished=True)
        if failed or missed:
            logger.info("Chiến dịch đăng bài: %s khung chạy dở → FAILED, %s khung bị lỡ → MISSED", len(failed), missed)

    # ------------------------------------------------------------------ mỗi lượt
    def tick(self) -> None:
        repo.mark_paused_slots_missed(self.clock(), machine_id=self.machine_id)
        self._finalize_running()
        self._start_due()
        repo.complete_finished_campaigns(self.machine_id)

    def _runner_on(self, session_id: Optional[str]) -> bool:
        return bool(session_id) and self.runner.is_busy() and self.runner.active_session_id() == session_id

    def _finalize_running(self) -> None:
        for slot in repo.running_slots(self.machine_id):
            sid = slot.get("session_id")
            if self._runner_on(sid):
                self._sync_pause(slot)
                continue
            self._finish_slot(slot)

    def _sync_pause(self, slot: Dict[str, Any]) -> None:
        """Khung đang chạy dở theo trạng thái chiến dịch (tạm dừng / chạy tiếp từ máy khác hoặc API):
        chiến dịch tạm dừng → pause phiên (giữ chỗ đang làm); chạy tiếp → resume phiên đã pause do chiến dịch."""
        paused_by_campaign = slot.get("message") == repo.PAUSED_MID_RUN_MESSAGE
        if slot.get("campaign_status") == repo.STOPPED:
            if not self.runner.is_paused():
                self.runner.pause_session()
            if not paused_by_campaign:
                repo.set_slot_message(slot["id"], repo.PAUSED_MID_RUN_MESSAGE)
        elif paused_by_campaign:
            if self.runner.is_paused():
                self.runner.resume_session()
            repo.set_slot_message(slot["id"], repo.RESUMED_MID_RUN_MESSAGE)

    def _finish_slot(self, slot: Dict[str, Any]) -> None:
        sid = slot.get("session_id")
        counts = repo.session_post_counts(sid) if sid else {}
        if sid and any(counts.get(s) for s in _UNFINISHED):
            # Phiên không còn chạy mà vẫn có bài chờ → coi như đã dừng
            post_repository.stop_all_session_posts(sid)
            counts = repo.session_post_counts(sid)
        published = counts.get(_SUCCESS, 0)
        failed = sum(n for s, n in counts.items() if s != _SUCCESS)
        stopped_by_user = (sid and repo.session_status(sid) == "STOPPED") or slot.get("campaign_status") == repo.STOPPED
        if stopped_by_user:
            status = repo.STOPPED
        elif published == 0 and failed > 0:
            status = repo.FAILED
        else:
            status = repo.DONE
        message = f"Đăng thành công {published}/{published + failed} bài"
        if failed:
            message += f", {failed} bài lỗi hoặc bị dừng (bấm Chạy lại để đăng lại cho các nick này)"
        message += "."
        success_total = len(repo.slot_published_uids(slot["id"]))
        repo.finish_slot(slot["id"], status, success_total, failed, message)

    def _start_due(self) -> None:
        now = self.clock()
        due = repo.due_slots(self.machine_id, now)
        if not due:
            return
        # Dùng chung khoá với "Đăng ngay" để 2 bên không cùng chiếm runner
        if not post_now_service.start_lock.acquire(timeout=5):
            return
        try:
            if self.runner.is_busy():
                for slot in due:
                    if slot.get("message") != QUEUED_MESSAGE:
                        repo.set_slot_message(slot["id"], QUEUED_MESSAGE)
                return
            self._run_slot(due[0], now)
        finally:
            post_now_service.start_lock.release()

    # ------------------------------------------------------------------ chạy 1 khung
    def _run_slot(self, slot: Dict[str, Any], now: datetime) -> None:
        campaign = repo.get_campaign(slot["campaign_id"])
        if not campaign:
            return
        with owner_scope(campaign.get("owner_key") or None):
            try:
                self._start_slot(campaign, slot, now)
            except Exception as exc:
                logger.exception("Không chạy được khung %s của chiến dịch %s", slot["id"], campaign["id"])
                repo.finish_slot(slot["id"], repo.FAILED, 0, 0, f"Lỗi khi bắt đầu khung: {str(exc)[:300]}")

    def _start_slot(self, campaign: Dict[str, Any], slot: Dict[str, Any], now: datetime) -> Optional[str]:
        accounts = campaign.get("accounts") or []
        already = repo.slot_published_uids(slot["id"])
        targets = [a for a in accounts if str(a.get("uid")) not in already]
        if not targets:
            repo.finish_slot(slot["id"], repo.DONE, len(already), 0, "Tất cả nick đã đăng thành công ở lần chạy trước.")
            return None
        target_uids = [str(a["uid"]) for a in targets]
        if normalize_layout(campaign.get("layout")) == LAYOUT_ACCOUNTS:
            alloc, notes = self._allocate_account_posts(slot, target_uids)
        else:
            alloc, notes = self._allocate_from_pool(campaign, slot, target_uids)
        if alloc.skipped:
            reasons = sorted(set(alloc.skipped.values()))
            notes.append(f"{len(alloc.skipped)} nick bị bỏ qua: {' '.join(reasons)}")
        if not alloc.assignments:
            repo.finish_slot(slot["id"], repo.FAILED, len(already), len(targets), "Không chia được bài. " + " ".join(notes))
            return None

        late = (now - slot["run_at"]).total_seconds() / 60
        if late >= 1:
            notes.insert(0, f"Bắt đầu trễ {int(late)} phút so với giờ hẹn {_hhmm(slot['run_at'])}.")
        message = " ".join(notes) or None

        session_id = post_repository.create_post_session("status")
        if not repo.claim_slot(slot["id"], session_id, len(alloc.assignments), message):
            # Khung vừa bị sửa / dừng / xoá trong lúc chuẩn bị
            post_repository.update_post_session(session_id, "STOPPED", finished=True)
            return None

        try:
            self._launch(campaign, slot, session_id, targets, alloc)
        except Exception:
            post_repository.stop_all_session_posts(session_id)
            post_repository.update_post_session(session_id, "STOPPED", finished=True)
            raise
        return session_id

    def _allocate_account_posts(self, slot: Dict[str, Any], target_uids):
        """Dạng "Từng bài": mỗi nick đăng đúng bài đã soạn cho nó ở khung này (ảnh mất trên máy thì bỏ ảnh đó)."""
        repo.delete_slot_usage(slot["id"], target_uids)  # lần chạy lại: không ghi trùng lượt dùng
        entries = repo.slot_account_posts(slot["id"])
        notes, dropped = [], 0
        for uid in target_uids:
            entry = entries.get(uid)
            if isinstance(entry, dict) and entry.get("images"):
                kept = [p for p in entry["images"] if self.file_exists(p)]
                dropped += len(entry["images"]) - len(kept)
                entries[uid] = {**entry, "images": kept}
        if dropped:
            notes.append(f"{dropped} ảnh không còn trên máy nên bị bỏ qua.")
        return allocate_account_round(target_uids, entries), notes

    def _allocate_from_pool(self, campaign: Dict[str, Any], slot: Dict[str, Any], target_uids):
        # Lần chạy lại: bỏ lượt dùng bài / ảnh cũ của các nick chưa đăng được để chia lại
        repo.delete_slot_usage(slot["id"], target_uids)
        used_texts, used_images = defaultdict(set), defaultdict(set)
        text_usage, image_usage = Counter(), Counter()
        for row in repo.load_usage(campaign["id"]):
            if row["kind"] == "TEXT":
                used_texts[row["account_uid"]].add(row["item_key"])
                text_usage[row["item_key"]] += 1
            else:
                used_images[row["account_uid"]].add(row["item_key"])
                image_usage[row["item_key"]] += 1

        image_mode = campaign.get("image_mode") or IMAGE_NONE
        lo, hi = clamp_image_range(campaign.get("min_images"), campaign.get("max_images"))
        parsed = parse_compose_text(campaign.get("content_text"), campaign.get("content_mode"))
        pool = normalize_pool_images(campaign.get("image_paths")) if image_mode != IMAGE_NONE else []
        images = [p for p in pool if self.file_exists(p)]
        notes = []
        if len(images) < len(pool):
            notes.append(f"{len(pool) - len(images)} ảnh trong kho không còn trên máy nên bị bỏ qua.")

        alloc = allocate_round(
            target_uids, parsed.posts, images,
            content_mode=campaign.get("content_mode"), image_mode=image_mode, min_images=lo, max_images=hi,
            used_texts=used_texts, used_images=used_images, text_usage=text_usage, image_usage=image_usage,
            remaining_rounds=max(1, repo.count_waiting_slots(campaign["id"])), rng=self.rng,
        )
        return alloc, notes

    def _launch(self, campaign, slot, session_id, targets, alloc) -> None:
        by_uid = {str(a["uid"]): a for a in targets}
        usage_rows = []
        for item in alloc.assignments:
            post_repository.create_post(
                session_id=session_id,
                post_type="status",
                account_uid=item.account_uid,
                account_name=str(by_uid[item.account_uid].get("name") or ""),
                content=item.content,
                image_path=post_repository.primary_image_path(item.images),
                image_paths=item.images,
                status="PENDING",
                campaign_id=campaign["id"],
                slot_id=slot["id"],
            )
            usage_rows.append((item.account_uid, "TEXT", item.text_key))
            usage_rows.extend((item.account_uid, "IMAGE", img) for img in item.images)
        repo.add_usage(campaign["id"], slot["id"], usage_rows)

        settings = campaign.get("settings") or {}
        self.runner.start_session_with_existing(
            session_id=session_id,
            post_type="status",
            account_count=len(alloc.assignments),
            thread_count=max(1, int(settings.get("thread_count") or 1)),
            min_delay=int(settings.get("min_delay", 600)),
            max_delay=int(settings.get("max_delay", 900)),
            accounts=[by_uid[item.account_uid] for item in alloc.assignments],
        )
        logger.info(
            "Chiến dịch \"%s\": bắt đầu khung %s với %s nick (phiên %s)",
            campaign.get("name"), _hhmm(slot["run_at"]), len(alloc.assignments), session_id,
        )


_scheduler: Optional[CampaignScheduler] = None


def start_scheduler() -> CampaignScheduler:
    """Gọi 1 lần lúc backend khởi động (routes.on_startup)."""
    global _scheduler
    if _scheduler is None:
        from modules.module_03_acc_farm.adapters import get_machine_id
        from modules.module_03_acc_farm.post_runner import runner
        _scheduler = CampaignScheduler(runner, get_machine_id)
    _scheduler.start()
    return _scheduler


def stop_scheduler() -> None:
    if _scheduler is not None:
        _scheduler.stop()
