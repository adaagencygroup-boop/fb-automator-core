"""
fetched_posts_store.py
Kho TẠM cho "Lấy bài viết từ page / trang cá nhân" (Seeding Bài viết).

- Bài lấy về chỉ nằm trong RAM của engine + 1 file tạm trên máy (data/seeding_fetch_cache/<user>.json),
  nên tắt / mở lại app hay app bị crash vẫn còn danh sách để tích chọn tiếp.
- KHÔNG ghi lên DB chung cho tới khi người dùng bấm "Thêm bài viết đã chọn"
  (lúc đó post_fetch_routes mới chèn các bài đã chọn vào seeding_targets).
- Mỗi user chỉ giữ 1 nguồn (page / trang cá nhân) gần nhất: lấy page khác thì bỏ bài của page cũ.
- Quá TTL_SECONDS kể từ lần cập nhật cuối thì bỏ (xoá cả file).

Không dùng Selenium / DB — kiểm tra độc lập được.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

TTL_SECONDS = 24 * 3600
FLUSH_EVERY_S = 5.0
POST_TYPES = ("photo", "video", "text")
_FIELDS = (
    "post_key", "post_url", "target_url", "target_fb_id", "content", "post_type",
    "published_at", "published_text", "reaction_count", "comment_count", "share_count", "is_pinned",
)

_lock = threading.RLock()
_mem: Dict[int, Dict[str, Any]] = {}     # owner_id -> trạng thái kho của user
_cache_dir_override: Optional[Path] = None


def set_cache_dir(path: Optional[Path]) -> None:
    """Đổi thư mục file tạm (dùng khi kiểm tra). None = mặc định DATA_DIR/seeding_fetch_cache."""
    global _cache_dir_override
    with _lock:
        _cache_dir_override = Path(path) if path else None
        _mem.clear()


def _cache_dir() -> Path:
    if _cache_dir_override is not None:
        return _cache_dir_override
    from config.constants import DATA_DIR

    return DATA_DIR / "seeding_fetch_cache"


def _path(owner_id: int) -> Path:
    return _cache_dir() / f"{int(owner_id)}.json"


def _new_state(source_key: str, job_id: Optional[int]) -> Dict[str, Any]:
    return {
        "source_key": source_key,
        "job_id": job_id,
        "rows": {},          # post_key -> bài (giữ đúng thứ tự trên feed)
        "next_id": 1,
        "updated": time.time(),
        "dirty": True,
        "flushed": 0.0,
    }


def _drop(owner_id: int) -> None:
    _mem.pop(owner_id, None)
    try:
        _path(owner_id).unlink(missing_ok=True)
    except OSError as exc:
        logger.warning(f"[SeedingFetchCache] không xoá được file tạm của user {owner_id}: {exc}")


def _read_file(owner_id: int) -> Optional[Dict[str, Any]]:
    path = _path(owner_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = {r["post_key"]: r for r in data.get("rows") or [] if r.get("post_key")}
        return {
            "source_key": str(data["source_key"]),
            "job_id": data.get("job_id"),
            "rows": rows,
            "next_id": int(data.get("next_id") or (max((int(r.get("id") or 0) for r in rows.values()), default=0) + 1)),
            "updated": float(data.get("updated") or path.stat().st_mtime),
            "dirty": False,
            "flushed": time.time(),
        }
    except Exception as exc:
        logger.warning(f"[SeedingFetchCache] file tạm hỏng, bỏ qua ({path.name}): {exc}")
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return None


def _load(owner_id: int) -> Optional[Dict[str, Any]]:
    """Kho của user: lấy từ RAM, chưa có (vd vừa mở lại app) thì nạp từ file tạm. Hết hạn thì bỏ."""
    state = _mem.get(owner_id)
    if state is None:
        state = _read_file(owner_id)
        if state is not None:
            _mem[owner_id] = state
    if state is not None and time.time() - state["updated"] > TTL_SECONDS:
        _drop(owner_id)
        return None
    return state


def _flush(owner_id: int, state: Dict[str, Any], force: bool = False) -> None:
    """Ghi kho ra file tạm (ghi file .tmp rồi đổi tên — không bao giờ để file ghi dở)."""
    if not state["dirty"]:
        return
    now = time.time()
    if not force and now - state["flushed"] < FLUSH_EVERY_S:
        return
    path = _path(owner_id)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "source_key": state["source_key"],
            "job_id": state["job_id"],
            "next_id": state["next_id"],
            "updated": state["updated"],
            "rows": list(state["rows"].values()),
        }
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
        state["dirty"] = False
        state["flushed"] = now
    except OSError as exc:
        # Ghi file lỗi thì vẫn còn trong RAM — không làm hỏng lượt lấy bài
        logger.warning(f"[SeedingFetchCache] không ghi được file tạm của user {owner_id}: {exc}")


def _state_for(owner_id: int, source_key: str, job_id: Optional[int]) -> Dict[str, Any]:
    state = _load(owner_id)
    if state is None or state["source_key"] != source_key:
        _drop(owner_id)   # nguồn khác → bỏ bài của nguồn cũ (cả RAM lẫn file)
        state = _new_state(source_key, job_id)
        _mem[owner_id] = state
    return state


def _int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def begin(owner_id: int, source_key: str, job_id: Optional[int]) -> None:
    """Bắt đầu 1 lượt lấy bài: cùng nguồn thì gộp tiếp vào bài đã có, nguồn khác thì bắt đầu kho mới."""
    with _lock:
        state = _state_for(owner_id, source_key, job_id)
        state["job_id"] = job_id
        state["updated"] = time.time()
        state["dirty"] = True
        _flush(owner_id, state, force=True)


def upsert(owner_id: int, source_key: str, job_id: Optional[int], rows: Iterable[Dict[str, Any]]) -> int:
    """Thêm / cập nhật 1 nhóm bài. Trả về số bài MỚI. Gộp giống bản lưu DB trước đây:
    nội dung dài hơn thắng, số tương tác lấy lớn nhất, trường rỗng giữ giá trị cũ."""
    with _lock:
        state = _state_for(owner_id, source_key, job_id)
        new = 0
        for r in rows:
            key = str(r.get("post_key") or "").strip()
            if not key:
                continue
            old = state["rows"].get(key)
            if old is None:
                row = {f: r.get(f) for f in _FIELDS}
                row["post_key"] = key
                row["post_type"] = row.get("post_type") or None
                content = (row.get("content") or "").strip()
                row["content"] = content if content else "Bài viết không có nội dung"
                for f in ("reaction_count", "comment_count", "share_count"):
                    row[f] = _int(row.get(f))
                row["is_pinned"] = bool(row.get("is_pinned"))
                row["id"] = state["next_id"]
                row["created_at"] = datetime.now().isoformat(timespec="seconds")
                state["next_id"] += 1
                state["rows"][key] = row
                new += 1
                continue
            if r.get("post_url"):
                old["post_url"] = r["post_url"]
            content = (r.get("content") or "").strip()
            if content:
                old_content = (old.get("content") or "").strip()
                if old_content in ("", "Bài viết không có nội dung"):
                    old["content"] = content
                elif content != "Bài viết không có nội dung" and (r.get("content_cleaned") or len(content) > len(old_content)):
                    old["content"] = content
            for f in ("post_type", "published_at", "published_text", "target_url", "target_fb_id"):
                if r.get(f):
                    old[f] = r[f]
            for f in ("reaction_count", "comment_count", "share_count"):
                old[f] = max(_int(old.get(f)), _int(r.get(f)))
            old["is_pinned"] = bool(r.get("is_pinned"))
        state["job_id"] = job_id
        state["updated"] = time.time()
        state["dirty"] = True
        _flush(owner_id, state)
        return new


def finish(owner_id: int) -> None:
    """Lượt lấy bài kết thúc / dừng: ghi chốt ra file tạm."""
    with _lock:
        state = _mem.get(owner_id)
        if state is not None:
            _flush(owner_id, state, force=True)


def available(owner_id: int, source_key: str) -> bool:
    with _lock:
        state = _load(owner_id)
        return bool(state and state["source_key"] == source_key)


def clear(owner_id: int, source_key: str) -> bool:
    """Xóa kho bài quét tạm của đúng nguồn hiện tại."""
    with _lock:
        state = _load(owner_id)
        if state is None or state["source_key"] != source_key:
            return False
        _drop(owner_id)
        return True


def _matches(row: Dict[str, Any], needle: str, post_type: str) -> bool:
    if needle:
        haystack = f"{row.get('content') or ''}\n{row.get('post_url') or ''}".casefold()
        if needle not in haystack:
            return False
    kind = row.get("post_type") or "text"
    if post_type == "text":
        # Bài không rõ loại cũng tính là "Bài viết" (khớp số đếm)
        return kind not in ("photo", "video")
    if post_type in ("photo", "video"):
        return kind == post_type
    return True


def filtered(owner_id: int, source_key: str, q: Optional[str] = None, post_type: str = "all") -> List[Dict[str, Any]]:
    """Bài của nguồn theo đúng thứ tự trên feed, lọc theo từ khoá (nội dung / link) và loại bài. Trả bản sao."""
    needle = (q or "").strip().casefold()
    with _lock:
        state = _load(owner_id)
        if not state or state["source_key"] != source_key:
            return []
        return [dict(r) for r in state["rows"].values() if _matches(r, needle, post_type)]


def counts(owner_id: int, source_key: str, q: Optional[str] = None) -> Dict[str, int]:
    rows = filtered(owner_id, source_key, q)
    out = {"all": len(rows), "photo": 0, "video": 0, "text": 0}
    for r in rows:
        kind = r.get("post_type") or "text"
        out[kind if kind in ("photo", "video") else "text"] += 1
    return out


def by_ids(owner_id: int, source_key: str, ids: Iterable[int]) -> List[Dict[str, Any]]:
    wanted = {int(x) for x in ids}
    return [r for r in filtered(owner_id, source_key) if int(r["id"]) in wanted]
