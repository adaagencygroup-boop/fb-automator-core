"""
Đánh dấu follower "nghi nick ảo" — tính khi đọc, không lưu cột, không xóa dữ liệu.

Dấu hiệu: nhiều UID đời mới (61xxxxxxxxxxxx) của CÙNG Page dồn trong một dải hẹp → lập gần cùng đợt.
Chỉ là nghi ngờ: nick thật mới lập cũng có thể nằm trong dải.
"""
from __future__ import annotations

import math
import re
from typing import Any, Dict, Iterable, List, Optional, Set

from core.database.connection import db

_NEW_UID_RE = re.compile(r"^id:(61\d{12})$")
CLUSTER_SPAN = 1_000_000_000  # độ rộng dải UID
CLUSTER_MIN = 10              # số UID tối thiểu trong dải
CLUSTER_MIN_SHARE = 0.15      # và tối thiểu 15% follower đã quét của Page (tránh báo nhầm Page lớn)


def find_suspect_keys(keys: Iterable[str], total: Optional[int] = None) -> Set[str]:
    """Trả follower_key nghi ảo trong danh sách follower của MỘT Page."""
    keys = set(keys)
    uids = sorted(int(m.group(1)) for m in map(_NEW_UID_RE.match, keys) if m)
    need = max(CLUSTER_MIN, math.ceil((total if total is not None else len(keys)) * CLUSTER_MIN_SHARE))
    out: Set[str] = set()
    marked_to = 0
    for i in range(len(uids) - need + 1):
        j = i + need
        if uids[j - 1] - uids[i] <= CLUSTER_SPAN:
            out.update(f"id:{u}" for u in uids[max(i, marked_to):j])
            marked_to = j
    return out


def suspect_by_page(owner_key: str, page_keys: Optional[List[str]] = None) -> Dict[str, Dict[str, Any]]:
    """{page_key: {"total", "keys"}} — page_keys=None → mọi Page của owner."""
    if page_keys is not None and not page_keys:
        return {}
    cond, params = "owner_key = %s", [owner_key]
    if page_keys is not None:
        cond += " AND page_key = ANY(%s)"
        params.append(list(page_keys))
    rows = db.fetch_all(
        f"""
        SELECT page_key, COUNT(*)::int AS total,
               array_agg(follower_key) FILTER (WHERE follower_key ~ '^id:61[0-9]{{12}}$') AS new_keys
        FROM scanned_page_followers WHERE {cond} GROUP BY page_key
        """,
        tuple(params),
    ) or []
    return {
        r["page_key"]: {
            "total": int(r["total"]),
            "keys": find_suspect_keys(r.get("new_keys") or [], int(r["total"])),
        }
        for r in rows
    }
