"""
tiktok_download.py
Module 03 - Tải video từ TikTok theo từ khóa cho tài khoản Facebook.
Cách tìm và tải giống hệt Module 05 (xem modules/module_05_page_manager/tiktok.md), chỉ giao tiếp với tiktok.com:
  - Cả phiên dùng MỘT Chrome ẩn đã đăng nhập TikTok (TikTokBrowserSession), tìm + tải tuần tự trên Chrome đó.
  - Tìm: trang tìm kiếm tiktok.com, đọc card trên trang + bắt XHR nội bộ qua CDP (có sẵn link CDN, caption đầy đủ).
  - Tải 3 lớp: link CDN bắt sẵn kèm cookie phiên -> mở trang video lấy link mới -> yt-dlp kèm cookie.
  - Caption (đã bỏ hashtag) ghi ra file .txt cùng tên, mỗi video một thư mục đánh số.
Khác Module 05: video tìm được chia lần lượt cho các tài khoản đã chọn (không tài khoản nào trùng video),
lưu tại <thư mục gốc>/<tên tài khoản>/<số>/<id>.mp4 để trang Đăng Reels tự nhận đúng thư mục theo tên.

  GET  /api/post/tiktok/auth-status   Trạng thái đăng nhập TikTok
  POST /api/post/tiktok/open-login    Mở trình duyệt đăng nhập
  POST /api/post/tiktok/logout        Đăng xuất (xoá phiên + cookie TikTok)
  GET  /api/post/tiktok/config        Thư mục lưu + số video / từ khóa đã lưu của người đang đăng nhập
  PUT  /api/post/tiktok/config        Lưu thư mục lưu + số video / từ khóa
  POST /api/post/tiktok/start         Bắt đầu quét và tải
  POST /api/post/tiktok/stop          Dừng
  GET  /api/post/tiktok/status        Tiến độ, bảng video (phân trang) và log
  GET  /api/post/tiktok/history       Video đã tải của người đang đăng nhập (lọc + phân trang)
  POST /api/post/tiktok/history/{id}/open  Mở thư mục chứa video trên máy
  POST /api/post/tiktok/videos/{video_id}/open?target=folder|caption  Mở thư mục lưu / file caption trong bảng kết quả quét
"""
import glob
import json
import logging
import os
import re
import subprocess
import sys
import threading
from collections import Counter, deque
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.media.tiktok_browser import (
    TikTokBrowserSession,
    disconnect_tiktok,
    get_tiktok_auth_status,
    open_tiktok_login_browser,
)
from core.media.tiktok_scraper import download_tiktok_video, search_tiktok_videos
from config.constants import DATA_DIR
from core.database.connection import db
from modules.module_02_account_manager.api.router import scoped_owner
from modules.module_02_account_manager.context import owner_context
from modules.module_03_acc_farm import adapters

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/post/tiktok",
    tags=["Module 03 - Tải video từ TikTok"],
    dependencies=[Depends(scoped_owner)],
)

MAX_KEYWORDS = 50
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}
# Một máy chỉ một phiên tải tại một thời điểm; phiên cuối của mỗi người được giữ để mở lại trang vẫn thấy kết quả
_lock = threading.Lock()
_folder_lock = threading.Lock()
_jobs: Dict[str, "Job"] = {}
_running: Optional["Job"] = None


# Cấu hình form (thư mục lưu, số video / từ khóa) lưu theo từng người dùng, giữ qua lần khởi động lại
_CONFIG_PATH = DATA_DIR / "tiktok_m03_config.json"
_config_lock = threading.Lock()


def _read_configs() -> Dict[str, Dict[str, Any]]:
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def load_config(owner: str) -> Dict[str, Any]:
    saved = _read_configs().get(owner) or {}
    count = saved.get("per_keyword")
    return {
        "folder": str(saved.get("folder") or ""),
        "per_keyword": count if isinstance(count, int) and 1 <= count <= 500 else 5,
    }


def save_config(owner: str, folder: Optional[str] = None, per_keyword: Optional[int] = None) -> Dict[str, Any]:
    with _config_lock:
        data = _read_configs()
        entry = dict(data.get(owner) or {})
        if folder is not None:
            entry["folder"] = folder
        if per_keyword is not None:
            entry["per_keyword"] = per_keyword
        data[owner] = entry
        tmp = f"{_CONFIG_PATH}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _CONFIG_PATH)
    return load_config(owner)


class Stopped(Exception):
    pass


def safe_folder_name(name: str, fallback: str) -> str:
    clean = re.sub(r'[\\/*?:"<>|\x00-\x1f]', "", name or "").strip(" .")[:80].rstrip(" .")
    return fallback if not clean or clean.lower() in _RESERVED else clean


def strip_hashtags(text: Optional[str]) -> str:
    """Bỏ mọi hashtag, giữ phần chữ và xuống dòng; "#1" kiểu thứ hạng không phải hashtag nên giữ lại."""
    text = re.sub(r"[#＃](?!\d+(?:[\s.,!?;:]|$))[^\s#＃.,!?;:…()\[\]\"“”]+", " ", text or "")
    text = re.sub(r"([,;])(?:[^\S\n]*[,;])+", r"\1", text)  # "a, #x, b" -> "a, b"
    lines = (re.sub(r"[^\S\n]+", " ", line).strip() for line in text.splitlines())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def account_folders(accounts: List[Dict[str, str]]) -> Dict[str, str]:
    """uid -> tên thư mục: theo tên tài khoản; các nick trùng tên thì dùng UID để không lẫn video."""
    names = {a["uid"]: safe_folder_name(a["name"], a["uid"]) for a in accounts}
    count = Counter(n.casefold() for n in names.values())
    return {uid: (uid if count[n.casefold()] > 1 else n) for uid, n in names.items()}


def downloaded_ids(root: str) -> set:
    """Id video đã nằm trong thư mục gốc (mọi tài khoản) — chạy lại không tải trùng."""
    found = set()
    for path in glob.iglob(os.path.join(glob.escape(root), "*", "*", "*.mp4")):
        m = re.fullmatch(r"(\d{15,22})\.mp4", os.path.basename(path))
        if m:
            found.add(m.group(1))
    return found


def allocate_subfolder(folder: str) -> str:
    with _folder_lock:
        os.makedirs(folder, exist_ok=True)
        used = [int(d) for d in os.listdir(folder) if d.isdigit()]
        path = os.path.join(folder, str(max(used, default=0) + 1))
        os.makedirs(path)
        return path


class Job:
    def __init__(self, owner: str, accounts, keywords, folder, per_keyword, threads):
        self.owner = owner
        self.accounts = accounts
        self.folders = account_folders(accounts)
        self.keywords = keywords
        self.folder = folder
        self.per_keyword = per_keyword
        self.threads = 1  # một Chrome đăng nhập dùng chung → tìm và tải tuần tự
        self.phase = "running"
        self.videos: List[Dict[str, Any]] = []
        self.logs = deque(maxlen=500)
        self.stop = threading.Event()
        self._log_id = 0
        self._log_lock = threading.Lock()

    def log(self, message: str, type_: str = "info", thread: Optional[str] = None):
        with self._log_lock:
            self._log_id += 1
            self.logs.append({
                "id": self._log_id,
                "timestamp": datetime.now().strftime("%H:%M:%S"),
                "thread": thread or _thread_name(),
                "message": message,
                "type": type_,
            })

    def check(self):
        if self.stop.is_set():
            raise Stopped()

    def run(self):
        global _running
        try:
            self._run()
            done = sum(v["status"] == "done" for v in self.videos)
            failed = sum(v["status"] == "failed" for v in self.videos)
            text = f"Đã tải {done}/{len(self.videos)} video" + (f", lỗi {failed}" if failed else "")
            if self.stop.is_set():
                self.log(f"Đã dừng. {text}.", "warn")
            else:
                self.log(f"Hoàn tất. {text}.", "success" if done else "warn")
        except Exception as e:
            logger.exception("[TikTok M03] Lỗi phiên tải")
            self.log(f"Phiên tải gặp lỗi: {e}", "error")
        finally:
            self.phase = "done"
            with _lock:
                if _running is self:
                    _running = None

    def _run(self):
        os.makedirs(self.folder, exist_ok=True)
        seen = downloaded_ids(self.folder)
        if seen:
            self.log(f"Thư mục đã có {len(seen)} video, sẽ bỏ qua video trùng.")
        self.log("Mở Chrome TikTok đã đăng nhập…")
        try:
            session = TikTokBrowserSession().__enter__()
        except Exception as e:
            logger.exception("[TikTok M03] Không mở được Chrome TikTok")
            raise RuntimeError(
                "Không mở được Chrome TikTok. Đóng các cửa sổ Chrome TikTok còn mở (kể cả cửa sổ đăng nhập) rồi thử lại."
            ) from e
        try:
            for keyword in self.keywords:
                if self.stop.is_set():
                    break
                self.log(f'Quét từ khóa: "{keyword}"…')
                found = self._search(session.driver, keyword, seen)
                if self.stop.is_set():
                    break
                if not found:
                    self.log(
                        f'Từ khóa "{keyword}": không có video mới. Nếu nghi phiên TikTok hết hạn, hãy đăng nhập lại.', "warn")
                    continue
                self.log(f'Từ khóa "{keyword}": tìm thấy {len(found)} video mới.')
                videos = [(self._add(item), item) for item in found]
                for video, item in videos:
                    if self.stop.is_set():
                        break
                    self._download(session.driver, video, item)
        finally:
            session.close()

    def _search(self, driver, keyword: str, seen: set) -> List[Dict[str, Any]]:
        """Video mới (chưa có trong thư mục) của 1 từ khóa; bộ cuộn chỉ tính video chưa tải vào số cần lấy."""
        data = search_tiktok_videos(
            keyword, count=self.per_keyword, driver=driver, exclude_ids=seen, stop_check=self.stop.is_set,
        ) or {}
        found = []
        for row in (data.get("data") or {}).get("videos") or []:
            vid = str(row.get("video_id") or row.get("id") or "")
            if not re.fullmatch(r"\d{15,22}", vid) or vid in seen:
                continue
            seen.add(vid)
            found.append({**row, "_id": vid, "_keyword": keyword})
            if len(found) >= self.per_keyword:
                break
        return found

    def _add(self, item) -> Dict[str, Any]:
        account = self.accounts[len(self.videos) % len(self.accounts)]
        author = item.get("author")
        author = author.get("unique_id") if isinstance(author, dict) else None
        video = {
            "id": item["_id"],
            "accountUid": account["uid"],
            "accountName": account["name"] or account["uid"],
            "folder": os.path.join(self.folder, self.folders[account["uid"]]),
            "url": item.get("source_url") or f"https://www.tiktok.com/@{author or 'user'}/video/{item['_id']}",
            "caption": "",
            "captionFile": "",
            "status": "waiting",
            "percent": None,
            "error": "",
        }
        self.videos.append(video)
        return video

    def _download(self, driver, video, item):
        sub = None
        thread = "Thread-01"
        try:
            video.update(status="downloading", percent=0)
            sub = allocate_subfolder(video["folder"])
            path = os.path.join(sub, f"{video['id']}.mp4")

            def progress(got: int, total: int):
                if total:
                    video["percent"] = min(99, got * 100 // total)

            def stage(name: str):
                if name == "page":
                    self.log(f"Video {video['id']}: mở trang video lấy link tải mới…", thread=thread)
                else:
                    self.log(f"Video {video['id']}: thử tải bằng yt-dlp…", "warn", thread)

            ok, meta = download_tiktok_video(
                video["url"], path, driver=driver, stop_check=self.stop.is_set,
                prefetched_meta=item if item.get("play_urls") else None,
                on_progress=progress, on_stage=stage,
            )
            if self.stop.is_set():
                raise Stopped()
            if not ok:
                raise RuntimeError("Không tải được file video")
            title = (meta or {}).get("title") or item.get("title") or ""
            if title.endswith(f"Video {video['id']}"):  # tiêu đề tạm khi không đọc được caption
                title = ""
            # Caption trống thì Đăng Reels lấy tên file (dãy số id) làm nội dung: dùng từ khóa thay thế
            video["caption"] = strip_hashtags(title) or item["_keyword"]
            name = f"{video['id']}.txt"
            with open(os.path.join(sub, name), "w", encoding="utf-8") as f:
                f.write(video["caption"])
            video.update(status="done", percent=100, folder=sub, captionFile=name)
            self._save_history(video, item, path)
            self.log(f"Tải thành công: {path} ({os.path.getsize(path) / 1048576:.1f} MB)", "success", thread)
        except Stopped:
            _remove(sub)
            video.update(status="waiting", percent=None)
        except Exception as e:
            _remove(sub)
            video.update(status="failed", percent=None, error=str(e))
            self.log(f"Video {video['id']}: {e}", "error", thread)

    def _save_history(self, video, item, path: str):
        """Lỗi ghi lịch sử không làm hỏng video đã tải."""
        try:
            db.execute(
                """INSERT INTO account_tiktok_videos
                   (owner_key, account_uid, account_name, video_id, video_url, keyword, caption, file_path)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (self.owner, video["accountUid"], video["accountName"], video["id"], video["url"],
                 item["_keyword"], video["caption"], path),
            )
        except Exception as e:
            logger.warning("[TikTok M03] Không ghi được lịch sử %s: %s", video["id"], e)
            self.log(f"Video {video['id']}: đã tải nhưng không ghi được vào lịch sử.", "warn")

    def snapshot(self, page: int, size: int) -> Dict[str, Any]:
        videos = list(self.videos)
        with self._log_lock:
            logs = list(self.logs)[-300:]
        start = (page - 1) * size
        return {
            "phase": "stopping" if self.phase == "running" and self.stop.is_set() else self.phase,
            "threads": self.threads,
            "total": len(videos),
            "done": sum(v["status"] == "done" for v in videos),
            "failed": sum(v["status"] == "failed" for v in videos),
            "videos": [dict(v) for v in videos[start:start + size]],
            "logs": logs,
            "config": {
                "keywords": self.keywords, "folder": self.folder, "per_keyword": self.per_keyword,
                "threads": self.threads, "uids": [a["uid"] for a in self.accounts],
            },
        }


def _thread_name() -> str:
    m = re.fullmatch(r"tiktok_(\d+)", threading.current_thread().name)
    return f"Thread-{int(m.group(1)) + 1:02d}" if m else "Scan"


def _remove(folder: Optional[str]):
    """Dọn thư mục con vừa tạo cho video tải hỏng."""
    if not folder or not os.path.isdir(folder):
        return
    for name in os.listdir(folder):
        try:
            os.remove(os.path.join(folder, name))
        except OSError:
            pass
    try:
        os.rmdir(folder)
    except OSError:
        pass


class StartPayload(BaseModel):
    uids: List[str] = Field(min_length=1)
    keywords: List[str] = Field(min_length=1)
    folder: str
    per_keyword: int = Field(5, ge=1, le=500)
    threads: int = Field(3, ge=1, le=10)


class ConfigPayload(BaseModel):
    folder: Optional[str] = None
    per_keyword: Optional[int] = Field(None, ge=1, le=500)


def _owner() -> str:
    owner = owner_context.get()
    if not owner:
        raise HTTPException(401, "Chưa đăng nhập")
    return owner


@router.get("/auth-status")
def auth_status():
    return get_tiktok_auth_status()


@router.post("/open-login")
def open_login():
    if _running is not None:
        raise HTTPException(409, "Đang có phiên tải TikTok chạy, hãy dừng trước khi đăng nhập lại.")
    try:
        return open_tiktok_login_browser()
    except Exception as e:
        # Hàm dùng chung bật cờ "đang mở" trước khi tạo Chrome: lỗi thì hạ cờ lại
        from core.media import tiktok_browser
        tiktok_browser._is_opening = False
        logger.exception("[TikTok M03] Không mở được trình duyệt đăng nhập")
        raise HTTPException(500, "Không mở được trình duyệt đăng nhập TikTok. Hãy đóng cửa sổ TikTok cũ rồi thử lại.") from e


@router.post("/logout")
def logout():
    if _running is not None:
        raise HTTPException(409, "Đang có phiên tải TikTok chạy, hãy dừng trước khi đăng xuất.")
    try:
        disconnect_tiktok()
    except Exception as e:
        logger.exception("[TikTok M03] Không đăng xuất được")
        raise HTTPException(500, f"Không đăng xuất được TikTok: {e}") from e
    return {"ok": True}


@router.get("/config")
def get_config():
    return load_config(_owner())


@router.put("/config")
def put_config(payload: ConfigPayload):
    folder = payload.folder
    if folder is not None:
        folder = folder.strip().strip('"')
        if folder:
            if not os.path.isabs(folder):
                raise HTTPException(400, "Thư mục lưu trữ video không hợp lệ.")
            folder = os.path.normpath(folder)
    try:
        return save_config(_owner(), folder, payload.per_keyword)
    except OSError as e:
        logger.exception("[TikTok M03] Không lưu được cấu hình")
        raise HTTPException(500, f"Không lưu được cấu hình: {e}") from e


@router.post("/start")
def start(payload: StartPayload):
    global _running
    owner = _owner()
    keywords = list(dict.fromkeys(k.strip() for k in payload.keywords if k.strip()))
    if not keywords:
        raise HTTPException(400, "Vui lòng nhập ít nhất một từ khóa.")
    if len(keywords) > MAX_KEYWORDS:
        raise HTTPException(400, f"Tối đa {MAX_KEYWORDS} từ khóa mỗi lần quét.")
    folder = payload.folder.strip().strip('"')
    if not os.path.isabs(folder):
        raise HTTPException(400, "Thư mục lưu trữ video không hợp lệ.")
    folder = os.path.normpath(folder)
    auth = get_tiktok_auth_status()
    if not auth.get("connected"):
        raise HTTPException(400, "Vui lòng đăng nhập TikTok trước.")
    uids = list(dict.fromkeys(str(u).strip() for u in payload.uids if str(u).strip()))
    own = adapters.list_owner_accounts(owner)
    if not uids or any(uid not in own for uid in uids):
        raise HTTPException(400, "Danh sách tài khoản Facebook không hợp lệ, vui lòng tải lại trang.")
    names = adapters.get_profile_names(uids, owner)
    try:
        os.makedirs(folder, exist_ok=True)
    except OSError as e:
        raise HTTPException(400, f"Không tạo được thư mục lưu: {e}") from e
    # Cả Module 05 lẫn phiên này dùng chung hồ sơ Chrome TikTok, không chạy cùng lúc được
    from modules.module_05_page_manager.runner import is_job_running
    if is_job_running("TIKTOK"):
        raise HTTPException(409, "Quản lý Fanpage đang tải video TikTok, vui lòng chờ xong.")
    with _lock:
        if _running is not None:
            raise HTTPException(409, "Đang có phiên tải TikTok chạy trên máy này.")
        job = Job(owner, [{"uid": u, "name": names.get(u, "")} for u in uids],
                  keywords, folder, payload.per_keyword, payload.threads)
        _running = _jobs[owner] = job
    try:
        save_config(owner, folder, payload.per_keyword)
    except OSError:
        logger.warning("[TikTok M03] Không lưu được cấu hình", exc_info=True)
    threading.Thread(target=job.run, daemon=True, name="tiktok-m03").start()
    return {"success": True}


@router.post("/stop")
def stop():
    job = _jobs.get(_owner())
    if job and job.phase == "running":
        job.stop.set()
        job.log("Đang dừng…", "warn", "Scan")
    return {"success": True}


@router.get("/status")
def status(page: int = Query(1, ge=1), size: int = Query(10, ge=1, le=100)):
    job = _jobs.get(_owner())
    if not job:
        return {"phase": "idle", "threads": 0, "total": 0, "done": 0, "failed": 0, "videos": [], "logs": [], "config": None}
    return job.snapshot(page, size)


@router.get("/history")
def history(
    account_uid: str = "",
    search: str = "",
    date: str = Query("", pattern=r"^(\d{4}-\d{2}-\d{2})?$"),
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
):
    owner = _owner()
    where, params = ["owner_key = %s"], [owner]
    if account_uid.strip():
        where.append("account_uid = %s")
        params.append(account_uid.strip())
    if search.strip():
        term = "%" + search.strip().lower() + "%"
        where.append("(LOWER(caption) LIKE %s OR LOWER(keyword) LIKE %s OR video_id LIKE %s)")
        params += [term] * 3
    if date:
        day = "DATE(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')" if db._is_postgres else "DATE(created_at, '+7 hours')"
        where.append(f"{day} = %s")
        params.append(date)
    clause = " AND ".join(where)
    total = db.fetch_one(f"SELECT COUNT(*) AS total FROM account_tiktok_videos WHERE {clause}", tuple(params))
    rows = db.fetch_all(
        f"SELECT * FROM account_tiktok_videos WHERE {clause} ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s",
        tuple(params + [size, (page - 1) * size]),
    ) or []
    accounts = db.fetch_all(
        """SELECT account_uid AS uid, MAX(account_name) AS name FROM account_tiktok_videos
           WHERE owner_key = %s GROUP BY account_uid ORDER BY 2""", (owner,),
    ) or []
    return {
        "total": int(total["total"]) if total else 0,
        # exists: file còn trên máy này (tải ở máy khác hoặc đã xóa thì không mở được)
        "rows": [{**dict(r), "owner_key": None, "exists": os.path.isfile(r["file_path"])} for r in rows],
        "accounts": [dict(a) for a in accounts],
    }


def _reveal_in_os(path: str) -> None:
    """Mở thư mục chứa file và chọn sẵn file đó (Explorer / Finder / trình quản lý file)."""
    if sys.platform == "win32":
        subprocess.Popen(f'explorer /select,"{path}"')
    else:
        subprocess.Popen(["open", "-R", path] if sys.platform == "darwin" else ["xdg-open", os.path.dirname(path)])


def _open_in_os(path: str) -> None:
    """Mở thư mục, hoặc mở file bằng ứng dụng mặc định (file .txt → Notepad...)."""
    if sys.platform == "win32":
        os.startfile(path)  # noqa: S606 — chỉ đường dẫn do engine tự tra, không nhận từ client
    else:
        subprocess.Popen(["open", path] if sys.platform == "darwin" else ["xdg-open", path])


@router.post("/history/{record_id}/open")
def open_history_folder(record_id: int):
    row = db.fetch_one(
        "SELECT file_path FROM account_tiktok_videos WHERE id = %s AND owner_key = %s", (record_id, _owner()))
    if not row:
        raise HTTPException(404, "Không tìm thấy video trong lịch sử.")
    path = os.path.normpath(row["file_path"])
    if not os.path.isfile(path):
        raise HTTPException(404, "Video không còn trên máy này (đã xóa, di chuyển hoặc tải ở máy khác).")
    _reveal_in_os(path)
    return {"success": True}


@router.post("/videos/{video_id}/open")
def open_scanned_video_item(video_id: str, target: str = Query("folder", pattern="^(folder|caption)$")):
    """Mở thư mục lưu / file caption .txt của một video trong bảng kết quả quét hiện tại.

    Chỉ nhận id video; đường dẫn do engine tự tra trong phiên quét của chính người dùng (không mở đường dẫn tùy ý).
    """
    job = _jobs.get(_owner())
    video = next((v for v in (job.videos if job else []) if str(v.get("id")) == video_id), None)
    if not video:
        raise HTTPException(404, "Không tìm thấy video trong phiên quét hiện tại.")
    folder = os.path.normpath(str(video.get("folder") or ""))
    if target == "caption":
        name = str(video.get("captionFile") or "")
        if not name:
            raise HTTPException(409, "File caption chưa được tạo.")
        path = os.path.join(folder, name)
        if not os.path.isfile(path):
            raise HTTPException(404, "File caption không còn trên máy này (đã xóa hoặc di chuyển).")
        _open_in_os(path)
        return {"success": True, "path": path}
    if not folder or not os.path.isdir(folder):
        raise HTTPException(404, "Thư mục chưa được tạo hoặc không còn trên máy này.")
    _open_in_os(folder)
    return {"success": True, "path": folder}
