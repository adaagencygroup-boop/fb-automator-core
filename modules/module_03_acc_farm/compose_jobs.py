"""
compose_jobs.py
Module 03 - Tab 2: Job AI tạo bài chạy ngầm cho ô soạn bài chung.

- Mỗi người dùng chỉ có 1 job đang chạy cho mỗi loại bài.
- Tạo xong bài nào (kèm ảnh nếu có) thì ghi ngay vào nháp trong DB → tải lại trang không mất bài:
  dạng ô soạn chung thì thêm vào cuối ô; dạng "Từng bài" thì điền vào đúng ô (nick, khung) được giao.
- Viết bài và lấy ảnh là 2 luồng TÁCH RIÊNG, chạy song song ngay từ đầu:
  * Luồng chữ: chỉ gọi Gemini viết bài (mỗi key 1 luồng), bài xong được lưu ngay (hiện lên trang).
  * Luồng ảnh: AI tạo trước danh sách từ khoá ảnh (1 lượt gọi) → Pixabay tìm/tải ảnh cho từng bài
    (không gọi Gemini nữa). Ảnh về trước bài thì giữ lại, bài lưu xong mới gắn vào đúng ô.
- Trong lúc job chạy, nháp bị khoá (API lưu nháp trả 409) để không ghi đè lẫn nhau.
- Trạng thái job giữ trong bộ nhớ; tắt backend thì job dừng, các bài đã tạo vẫn nằm trong nháp.
"""
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

from modules.module_02_account_manager.context import owner_scope
from modules.module_03_acc_farm import compose_repository
from modules.module_03_acc_farm.compose_service import sanitize_post

logger = logging.getLogger(__name__)

MAX_GENERATE_COUNT = 200
MAX_PARALLEL_REQUESTS = 10  # luồng viết chữ (không vượt quá số key)
IMAGE_WORKERS = 6  # luồng tải ảnh Pixabay
IMAGE_TIMEOUT_SECONDS = 60  # viết xong chữ thì chờ ảnh thêm tối đa chừng này giây
FINISHED_JOB_TTL_SECONDS = 3600
MAX_ERRORS_KEPT = 5

RUNNING = "RUNNING"
DONE = "DONE"
CANCELLED = "CANCELLED"
FAILED = "FAILED"

# (prompt, api_key, fallback_keys, model) -> (nội dung, từ khoá ảnh)
TextGenerator = Callable[[str, str, List[str], str], Tuple[str, Optional[str]]]
# (prompt, số từ khoá cần, gemini_keys, model) -> danh sách từ khoá ảnh tiếng Anh
KeywordMaker = Callable[[str, int, List[str], str], List[str]]
# (từ khoá, pixabay_key, id ảnh đã dùng trong job) -> đường dẫn ảnh
ImageFetcher = Callable[[str, Optional[str], set], Optional[str]]


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
    # Đồng bộ 2 luồng (giữ bằng _lock): ảnh về trước khi bài được lưu thì nằm chờ ở _image_ready
    _text_saved: set = field(default_factory=set, repr=False)
    _image_ready: Dict[int, str] = field(default_factory=dict, repr=False)
    _images_closed: bool = field(default=False, repr=False)

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
    make_keywords: Optional[KeywordMaker] = None,
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
        args=(job, prompt, keys, model, pixabay_key, generate_text, fetch_image, make_keywords),
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


# ---------------------------------------------------------------- luồng ảnh

def _attach_image(job, index: int, image_path: str) -> None:
    """Gắn ảnh vào bài `index` (đã lưu) và đếm kết quả."""
    try:
        with owner_scope(job.owner_key):
            if job.targets is not None:
                uid, slot_index = job.targets[index]
                ok = compose_repository.attach_account_post_images(job.post_type, uid, slot_index, [image_path])
            else:
                compose_repository.append_to_compose_draft(job.post_type, [], [image_path])
                ok = True
    except Exception as exc:
        ok = False
        logger.warning("Gắn ảnh vào bài %s lỗi: %s", index + 1, exc)
    with _lock:
        if ok is False:
            job.images_missing += 1
        else:
            job.images_added += 1


def _image_done(job, index: int, image_path: Optional[str]) -> None:
    """1 ảnh tải xong (hoặc không tìm được). Bài chưa lưu thì giữ ảnh lại, bài lưu xong sẽ tự gắn."""
    with _lock:
        job.images_pending -= 1
        if job._images_closed or job.cancel_event.is_set() or not image_path:
            job.images_missing += 1
            return
        if job.targets is not None and index not in job._text_saved:
            job._image_ready[index] = image_path
            return
    _attach_image(job, index, image_path)


def _text_saved(job, index: int) -> None:
    """Luồng chữ báo bài `index` đã lưu → gắn ảnh nếu ảnh đã về trước."""
    with _lock:
        job._text_saved.add(index)
        image_path = None if job._images_closed else job._image_ready.pop(index, None)
    if image_path:
        _attach_image(job, index, image_path)


def _make_keywords(job, prompt, keys, model, make_keywords: Optional[KeywordMaker]) -> List[str]:
    keywords: List[str] = []
    if make_keywords is not None:
        try:
            keywords = [k.strip() for k in (make_keywords(prompt, job.total, keys, model) or []) if k and k.strip()]
        except Exception as exc:
            logger.warning("AI tạo từ khoá ảnh lỗi, tìm ảnh theo prompt: %s", exc)
    return keywords or [prompt]


def _run_images(job, prompt, keys, model, pixabay_key, fetch_image: ImageFetcher, make_keywords) -> None:
    """Luồng ảnh: tạo từ khoá trước (1 lượt AI) rồi Pixabay tải ảnh cho từng bài, song song với luồng chữ."""
    keywords = _make_keywords(job, prompt, keys, model, make_keywords)
    used_ids: set = set()  # chung cả job → các bài không bị trùng ảnh

    def one(index: int) -> None:
        path = None
        if not job.cancel_event.is_set() and not job._images_closed:
            try:
                path = fetch_image(keywords[index % len(keywords)], pixabay_key, used_ids)
            except Exception as exc:
                logger.warning("Tải ảnh bài %s lỗi: %s", index + 1, exc)
        _image_done(job, index, path)

    with ThreadPoolExecutor(
        max_workers=max(1, min(IMAGE_WORKERS, job.total)), thread_name_prefix=f"compose-img-{job.id[:8]}"
    ) as pool:
        list(pool.map(one, range(job.total)))


# ---------------------------------------------------------------- luồng chữ


def _generate_one(job, index, prompt, keys, model, generate_text) -> None:
    if job.cancel_event.is_set():
        return
    # Xoay key đầu tiên theo thứ tự bài để chia tải giữa các key
    primary = keys[index % len(keys)]
    fallback = [k for k in keys if k != primary]
    try:
        content, _ = generate_text(_variant_prompt(prompt, index, job.total), primary, fallback, model)
        content = sanitize_post(content)
        if not content:
            raise ValueError("AI trả về nội dung rỗng.")
    except Exception as exc:
        with _lock:
            job.failed += 1
        _record_error(job, str(exc)[:300])
        logger.error("AI tạo bài %s/%s lỗi: %s", index + 1, job.total, exc)
        return

    # Lưu bài ngay (chưa có ảnh) để trang hiện bài sớm; ảnh do luồng ảnh gắn vào
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
    if job.with_images:
        _text_saved(job, index)


def _close_images(job, image_thread: Optional[threading.Thread]) -> None:
    """Viết xong chữ: chờ luồng ảnh thêm tối đa IMAGE_TIMEOUT_SECONDS, quá thì bỏ các ảnh còn lại."""
    if image_thread is None:
        return
    with _lock:
        if job.images_pending:
            job.message = "Đã viết xong bài, đang tải nốt ảnh..."
    image_thread.join(timeout=IMAGE_TIMEOUT_SECONDS)
    with _lock:
        job._images_closed = True
        late = job.images_pending
        # Ảnh đã về nhưng bài không lưu được (AI lỗi) → không có chỗ gắn
        job.images_missing += late + len(job._image_ready)
        job.images_pending = 0
        job._image_ready.clear()
    if late:
        logger.warning("Tải ảnh quá %ss — %s bài giữ nguyên, không kèm ảnh.", IMAGE_TIMEOUT_SECONDS, late)


def _run_job(job, prompt, keys, model, pixabay_key, generate_text, fetch_image, make_keywords=None) -> None:
    image_thread: Optional[threading.Thread] = None
    try:
        if job.with_images:
            with _lock:
                job.images_pending = job.total
            image_thread = threading.Thread(
                target=_run_images,
                args=(job, prompt, keys, model, pixabay_key, fetch_image, make_keywords),
                name=f"compose-images-{job.id[:8]}",
                daemon=True,
            )
            image_thread.start()
        workers = max(1, min(MAX_PARALLEL_REQUESTS, len(keys), job.total))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix=f"compose-ai-{job.id[:8]}") as pool:
            futures = [
                pool.submit(_generate_one, job, i, prompt, keys, model, generate_text)
                for i in range(job.total)
            ]
            for future in futures:
                future.result()
        _close_images(job, image_thread)
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
            message += f" Lấy được {job.images_added} ảnh"
            message += f", {job.images_missing} bài không tìm được ảnh." if job.images_missing else "."
    except Exception as exc:
        logger.exception("Job AI tạo bài %s lỗi", job.id)
        status = FAILED
        message = f"Lỗi khi tạo bài: {exc}"
        _record_error(job, str(exc)[:300])
        with _lock:
            job._images_closed = True
    with _lock:
        job.status = status
        job.message = message
        job.finished_at = time.time()
