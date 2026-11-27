"""
compose_jobs.py
Module 03 - Tab 2: Job AI tạo bài chạy ngầm cho ô soạn bài chung.

- Mỗi người dùng chỉ có 1 job đang chạy cho mỗi loại bài.
- Tạo xong bài nào (kèm ảnh nếu có) thì thêm ngay vào cuối nháp trong DB → tải lại trang không mất bài.
- Trong lúc job chạy, nháp bị khoá (API lưu nháp trả 409) để không ghi đè lẫn nhau.
- Trạng thái job giữ trong bộ nhớ; tắt backend thì job dừng, các bài đã tạo vẫn nằm trong nháp.
"""
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

from modules.module_02_account_manager.context import owner_scope
from modules.module_03_acc_farm import compose_repository
from modules.module_03_acc_farm.compose_service import sanitize_post

logger = logging.getLogger(__name__)

MAX_GENERATE_COUNT = 200
MAX_PARALLEL_REQUESTS = 3
IMAGE_TIMEOUT_SECONDS = 25
FINISHED_JOB_TTL_SECONDS = 3600
MAX_ERRORS_KEPT = 5

RUNNING = "RUNNING"
DONE = "DONE"
CANCELLED = "CANCELLED"
FAILED = "FAILED"

# (prompt, api_key, fallback_keys, model) -> (nội dung, từ khoá ảnh)
TextGenerator = Callable[[str, str, List[str], str], Tuple[str, Optional[str]]]
# (từ khoá, pixabay_key, gemini_keys) -> đường dẫn ảnh
ImageFetcher = Callable[[str, Optional[str], List[str]], Optional[str]]


class JobConflict(Exception):
    def __init__(self, job: "GenerateJob"):
        super().__init__("Đang có lượt AI tạo bài chạy, đợi xong hoặc huỷ trước.")
        self.job = job


@dataclass
class GenerateJob:
    id: str
    owner_key: str
    post_type: str
    total: int
    with_images: bool
    status: str = RUNNING
    done: int = 0
    failed: int = 0
    images_added: int = 0
    images_missing: int = 0
    errors: List[str] = field(default_factory=list)
    message: str = ""
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)

    @property
    def active(self) -> bool:
        return self.status == RUNNING

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "post_type": self.post_type,
            "status": self.status,
            "total": self.total,
            "done": self.done,
            "failed": self.failed,
            "processed": self.done + self.failed,
            "with_images": self.with_images,
            "images_added": self.images_added,
            "images_missing": self.images_missing,
            "errors": list(self.errors),
            "message": self.message,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


_lock = threading.Lock()
_jobs: Dict[str, GenerateJob] = {}
_image_pool = ThreadPoolExecutor(max_workers=MAX_PARALLEL_REQUESTS, thread_name_prefix="compose-image")


def _prune_locked() -> None:
    now = time.time()
    for job_id in [
        j.id for j in _jobs.values()
        if not j.active and j.finished_at and now - j.finished_at > FINISHED_JOB_TTL_SECONDS
    ]:
        _jobs.pop(job_id, None)


def active_job(owner_key: str, post_type: str) -> Optional[GenerateJob]:
    with _lock:
        for job in _jobs.values():
            if job.active and job.owner_key == owner_key and job.post_type == post_type:
                return job
    return None


def latest_job(owner_key: str, post_type: str) -> Optional[GenerateJob]:
    with _lock:
        jobs = [j for j in _jobs.values() if j.owner_key == owner_key and j.post_type == post_type]
    return max(jobs, key=lambda j: j.started_at) if jobs else None


def get_job(job_id: str, owner_key: str) -> Optional[GenerateJob]:
    with _lock:
        job = _jobs.get(job_id)
    return job if job and job.owner_key == owner_key else None


def cancel_job(job_id: str, owner_key: str) -> Optional[GenerateJob]:
    job = get_job(job_id, owner_key)
    if job and job.active:
        job.cancel_event.set()
        job.message = "Đang huỷ, đợi các bài đang tạo dở xong..."
    return job


def start_generate_job(
    owner_key: str,
    post_type: str,
    *,
    prompt: str,
    count: int,
    keys: List[str],
    model: str,
    with_images: bool,
    pixabay_key: Optional[str],
    generate_text: TextGenerator,
    fetch_image: ImageFetcher,
) -> GenerateJob:
    if not keys:
        raise ValueError("Chưa có Gemini API Key hợp lệ.")
    total = max(1, min(MAX_GENERATE_COUNT, int(count)))
    with _lock:
        _prune_locked()
        for job in _jobs.values():
            if job.active and job.owner_key == owner_key and job.post_type == post_type:
                raise JobConflict(job)
        job = GenerateJob(
            id=str(uuid.uuid4()), owner_key=owner_key, post_type=post_type,
            total=total, with_images=with_images,
        )
        _jobs[job.id] = job

    threading.Thread(
        target=_run_job,
        args=(job, prompt, keys, model, pixabay_key, generate_text, fetch_image),
        name=f"compose-generate-{job.id[:8]}",
        daemon=True,
    ).start()
    return job


def _variant_prompt(prompt: str, index: int, total: int) -> str:
    if total <= 1:
        return prompt
    return (
        f"{prompt}\n\n(Đây là bài số {index + 1}/{total} trong loạt bài cho nhiều tài khoản khác nhau: "
        "hãy chọn góc nhìn, câu mở đầu và cách diễn đạt riêng, không lặp lại khuôn mẫu.)"
    )


def _record_error(job: GenerateJob, message: str) -> None:
    with _lock:
        if len(job.errors) < MAX_ERRORS_KEPT and message not in job.errors:
            job.errors.append(message)


def _fetch_image_with_timeout(fetch_image: ImageFetcher, keyword: str, pixabay_key, keys) -> Optional[str]:
    future = _image_pool.submit(fetch_image, keyword, pixabay_key, keys)
    try:
        return future.result(timeout=IMAGE_TIMEOUT_SECONDS)
    except FuturesTimeout:
        logger.warning("Tìm ảnh quá %ss (từ khoá '%s') — giữ bài, bỏ ảnh.", IMAGE_TIMEOUT_SECONDS, keyword)
    except Exception as exc:
        logger.warning("Tìm ảnh lỗi (từ khoá '%s'): %s", keyword, exc)
    return None


def _generate_one(job, index, prompt, keys, model, pixabay_key, generate_text, fetch_image) -> None:
    if job.cancel_event.is_set():
        return
    # Xoay key đầu tiên theo thứ tự bài để chia tải giữa các key
    primary = keys[index % len(keys)]
    fallback = [k for k in keys if k != primary]
    try:
        content, keyword = generate_text(_variant_prompt(prompt, index, job.total), primary, fallback, model)
        content = sanitize_post(content)
        if not content:
            raise ValueError("AI trả về nội dung rỗng.")
    except Exception as exc:
        with _lock:
            job.failed += 1
        _record_error(job, str(exc)[:300])
        logger.error("AI tạo bài %s/%s lỗi: %s", index + 1, job.total, exc)
        return

    image_path = None
    if job.with_images and keyword and not job.cancel_event.is_set():
        image_path = _fetch_image_with_timeout(fetch_image, keyword, pixabay_key, keys)

    try:
        with owner_scope(job.owner_key):
            compose_repository.append_to_compose_draft(job.post_type, [content], [image_path] if image_path else [])
    except Exception as exc:
        with _lock:
            job.failed += 1
        _record_error(job, f"Không lưu được bài vào nháp: {str(exc)[:250]}")
        logger.exception("Lưu bài AI vào nháp lỗi")
        return
    with _lock:
        job.done += 1
        if image_path:
            job.images_added += 1
        elif job.with_images:
            job.images_missing += 1


def _run_job(job, prompt, keys, model, pixabay_key, generate_text, fetch_image) -> None:
    try:
        workers = max(1, min(MAX_PARALLEL_REQUESTS, len(keys), job.total))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"compose-ai-{job.id[:8]}") as pool:
            futures = [
                pool.submit(_generate_one, job, i, prompt, keys, model, pixabay_key, generate_text, fetch_image)
                for i in range(job.total)
            ]
            for future in futures:
                future.result()
        if job.cancel_event.is_set():
            status = CANCELLED
            message = f"Đã huỷ. Đã thêm {job.done} bài vào ô soạn."
        elif job.done == 0:
            status = FAILED
            message = "Không tạo được bài nào."
        else:
            status = DONE
            message = f"Đã thêm {job.done}/{job.total} bài vào ô soạn."
        if job.failed:
            message += f" {job.failed} bài lỗi."
        if job.images_missing:
            message += f" {job.images_missing} bài không tìm được ảnh."
    except Exception as exc:
        logger.exception("Job AI tạo bài %s lỗi", job.id)
        status = FAILED
        message = f"Lỗi khi tạo bài: {exc}"
        _record_error(job, str(exc)[:300])
    with _lock:
        job.status = status
        job.message = message
        job.finished_at = time.time()
