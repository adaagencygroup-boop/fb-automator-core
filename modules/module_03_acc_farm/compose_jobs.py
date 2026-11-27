"""
compose_jobs.py
Module 03 - Tab 2: Job AI tạo bài chạy ngầm cho ô soạn bài chung.

- Mỗi người dùng chỉ có 1 job đang chạy cho mỗi loại bài.
- Tạo xong bài nào (kèm ảnh nếu có) thì ghi ngay vào nháp trong DB → tải lại trang không mất bài:
  dạng ô soạn chung thì thêm vào cuối ô; dạng "Từng bài" thì điền vào đúng ô (nick, khung) được giao.
- Viết bài và cào ảnh chạy song song: bài viết xong được lưu ngay (hiện lên trang), ảnh cào ở luồng riêng
  rồi tự gắn vào đúng bài đó, trong lúc AI viết tiếp các bài sau.
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
IMAGE_TIMEOUT_SECONDS = 60
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
    # Dạng "Từng bài": bài thứ i ghi vào ô targets[i] = (uid, chỉ số khung); None = thêm vào cuối ô soạn chung
    targets: Optional[List[Tuple[str, int]]] = None
    overwrite: bool = False
    status: str = RUNNING
    done: int = 0
    failed: int = 0
    images_added: int = 0
    images_missing: int = 0
    images_pending: int = 0
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
            "images_pending": self.images_pending,
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
    targets: Optional[List[Tuple[str, int]]] = None,
    overwrite: bool = False,
) -> GenerateJob:
    if not keys:
        raise ValueError("Chưa có Gemini API Key hợp lệ.")
    if targets is not None:
        targets = list(dict.fromkeys((str(uid), int(idx)) for uid, idx in targets))[:MAX_GENERATE_COUNT]
        if not targets:
            raise ValueError("Không có ô nào cần AI tạo bài.")
        count = len(targets)
    total = max(1, min(MAX_GENERATE_COUNT, int(count)))
    with _lock:
        _prune_locked()
        for job in _jobs.values():
            if job.active and job.owner_key == owner_key and job.post_type == post_type:
                raise JobConflict(job)
        job = GenerateJob(
            id=str(uuid.uuid4()), owner_key=owner_key, post_type=post_type,
            total=total, with_images=with_images, targets=targets, overwrite=overwrite,
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


@dataclass
class _ImageTask:
    index: int
    keyword: str
    future: object = None
    deadline: float = 0.0
    expired: bool = False  # quá giờ chờ → ảnh về muộn cũng không gắn


def _image_keyword(keyword: Optional[str], content: str) -> str:
    """AI không trả từ khoá ảnh → tìm ảnh theo chính nội dung bài (Gemini dịch / rút gọn sang tiếng Anh)."""
    kw = (keyword or "").strip()
    if kw and kw.upper() != "NONE":
        return kw
    return " ".join(content.split())[:300]


def _attach_image(job, index: int, image_path: str) -> None:
    with owner_scope(job.owner_key):
        if job.targets is not None:
            uid, slot_index = job.targets[index]
            compose_repository.attach_account_post_images(job.post_type, uid, slot_index, [image_path])
        else:
            compose_repository.append_to_compose_draft(job.post_type, [], [image_path])


def _fetch_and_attach(job, task: _ImageTask, fetch_image: ImageFetcher, pixabay_key, keys) -> bool:
    """Chạy trong _image_pool: cào 1 ảnh rồi gắn vào bài `task.index`. Trả về True nếu đã gắn ảnh."""
    if job.cancel_event.is_set():
        return False
    image_path = fetch_image(task.keyword, pixabay_key, keys)
    if not image_path or task.expired:
        return False
    _attach_image(job, task.index, image_path)
    return True


def _generate_one(job, index, prompt, keys, model, pixabay_key, generate_text, fetch_image, image_tasks) -> None:
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

    # 1. Lưu bài ngay (chưa có ảnh) để trang hiện bài sớm
    try:
        with owner_scope(job.owner_key):
            if job.targets is not None:
                uid, slot_index = job.targets[index]
                compose_repository.fill_account_posts(
                    job.post_type, [(uid, slot_index, content, [])],
                    overwrite=job.overwrite, reset_images=job.with_images,
                )
            else:
                compose_repository.append_to_compose_draft(job.post_type, [content], [])
    except Exception as exc:
        with _lock:
            job.failed += 1
        _record_error(job, f"Không lưu được bài vào nháp: {str(exc)[:250]}")
        logger.exception("Lưu bài AI vào nháp lỗi")
        return
    with _lock:
        job.done += 1

    # 2. Cào ảnh song song (không chặn AI viết bài tiếp theo)
    if job.with_images and not job.cancel_event.is_set():
        task = _ImageTask(index=index, keyword=_image_keyword(keyword, content))
        task.deadline = time.time() + IMAGE_TIMEOUT_SECONDS
        task.future = _image_pool.submit(_fetch_and_attach, job, task, fetch_image, pixabay_key, keys)
        with _lock:
            job.images_pending += 1
            image_tasks.append(task)


def _wait_images(job, image_tasks: List[_ImageTask]) -> None:
    for task in list(image_tasks):
        try:
            attached = task.future.result(timeout=max(0.1, task.deadline - time.time()))
        except FuturesTimeout:
            task.expired = True
            attached = False
            logger.warning("Cào ảnh quá %ss (từ khoá '%s') — giữ bài, bỏ ảnh.", IMAGE_TIMEOUT_SECONDS, task.keyword[:60])
        except Exception as exc:
            attached = False
            logger.warning("Cào ảnh lỗi (từ khoá '%s'): %s", task.keyword[:60], exc)
        with _lock:
            job.images_pending -= 1
            if attached:
                job.images_added += 1
            else:
                job.images_missing += 1


def _run_job(job, prompt, keys, model, pixabay_key, generate_text, fetch_image) -> None:
    image_tasks: List[_ImageTask] = []
    try:
        workers = max(1, min(MAX_PARALLEL_REQUESTS, len(keys), job.total))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"compose-ai-{job.id[:8]}") as pool:
            futures = [
                pool.submit(
                    _generate_one, job, i, prompt, keys, model, pixabay_key, generate_text, fetch_image, image_tasks
                )
                for i in range(job.total)
            ]
            for future in futures:
                future.result()
        with _lock:
            job.message = "Đã viết xong bài, đang cào nốt ảnh..." if job.images_pending else job.message
        _wait_images(job, image_tasks)
        if job.cancel_event.is_set():
            status = CANCELLED
            message = f"Đã huỷ. Đã thêm {job.done} bài."
        elif job.done == 0:
            status = FAILED
            message = "Không tạo được bài nào."
        else:
            status = DONE
            message = f"Đã tạo {job.done}/{job.total} bài."
        if job.failed:
            message += f" {job.failed} bài lỗi."
        if job.with_images:
            message += f" Cào được {job.images_added} ảnh"
            message += f", {job.images_missing} bài không tìm được ảnh." if job.images_missing else "."
    except Exception as exc:
        logger.exception("Job AI tạo bài %s lỗi", job.id)
        status = FAILED
        message = f"Lỗi khi tạo bài: {exc}"
        _record_error(job, str(exc)[:300])
    with _lock:
        job.status = status
        job.message = message
        job.finished_at = time.time()
