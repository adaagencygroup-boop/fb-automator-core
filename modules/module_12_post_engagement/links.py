"""
Nhận diện & chuẩn hoá link bài viết Facebook (ô Nhập link / tệp .txt .csv .xlsx của Module 12).

Hỗ trợ: bài trong nhóm (/groups/<nhóm>/posts|permalink/<id>), bài page / trang cá nhân (/<tên>/posts/<id|pfbid>),
permalink.php / story.php?story_fbid=, video (/videos/<id>, /watch?v=), reel (/reel/<id>), ảnh (/photo?fbid=),
link chia sẻ (/share/p/<mã>) — m.facebook.com, web.facebook.com, fb.com đều được.

post_key (khoá chống trùng): ID số của bài nếu link có, nếu không thì mã pfbid / mã link chia sẻ.
"""
from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import parse_qs, urlsplit

_HOST_RE = re.compile(r"^(?:https?://)?(?:(?:www|m|web|mbasic|touch|business)\.)?(?:facebook\.com|fb\.com|fb\.me)(?=/|$)", re.I)
_URL_IN_TEXT = re.compile(r"(?:https?://)?(?:(?:www|m|web|mbasic|touch)\.)?(?:facebook\.com|fb\.com)/[^\s,;\"'<>]+", re.I)
_PFBID = re.compile(r"^pfbid[0-9A-Za-z]{20,}$")
_DIGITS = re.compile(r"^\d{5,}$")


def _clean_segment(seg: str) -> str:
    return seg.strip().strip("/").split("?")[0].split("#")[0]


def parse_post_link(raw: Any) -> Optional[dict[str, str]]:
    """Trả {url, post_key, source_hint, group} cho link bài viết hợp lệ; None nếu không phải link bài viết."""
    text = str(raw or "").strip().strip("<>\"' ")
    if not text:
        return None
    if not _HOST_RE.match(text):
        return None
    if not re.match(r"^https?://", text, re.I):
        text = "https://" + text
    parts = urlsplit(text)
    path = re.sub(r"/{2,}", "/", parts.path or "/")
    segs = [s for s in path.split("/") if s]
    query = parse_qs(parts.query or "")

    def q(name: str) -> str:
        return (query.get(name) or [""])[0].strip()

    base = "https://www.facebook.com"
    low = [s.lower() for s in segs]

    # /groups/<nhóm>/posts/<id> | /groups/<nhóm>/permalink/<id>
    if len(segs) >= 4 and low[0] == "groups" and low[2] in ("posts", "permalink"):
        group, pid = _clean_segment(segs[1]), _clean_segment(segs[3])
        if _DIGITS.match(pid) or _PFBID.match(pid):
            return {"url": f"{base}/groups/{group}/posts/{pid}/", "post_key": pid, "source_hint": "group", "group": group}
        return None
    # /groups/<nhóm>/?multi_permalinks=<id>  | ?view=permalink&id=<id>
    if len(segs) >= 2 and low[0] == "groups":
        pid = q("multi_permalinks").split(",")[0] or (q("id") if q("view") == "permalink" else "")
        if _DIGITS.match(pid):
            group = _clean_segment(segs[1])
            return {"url": f"{base}/groups/{group}/posts/{pid}/", "post_key": pid, "source_hint": "group", "group": group}
        return None
    # permalink.php / story.php?story_fbid=<id|pfbid>&id=<page>
    if segs and low[0] in ("permalink.php", "story.php"):
        fbid, owner_id = q("story_fbid"), q("id")
        if fbid and (_DIGITS.match(fbid) or _PFBID.match(fbid)):
            url = f"{base}/permalink.php?story_fbid={fbid}" + (f"&id={owner_id}" if owner_id else "")
            return {"url": url, "post_key": fbid, "source_hint": "page", "group": ""}
        return None
    # /watch/?v=<id>
    if segs and low[0] == "watch":
        vid = q("v")
        if _DIGITS.match(vid):
            return {"url": f"{base}/watch/?v={vid}", "post_key": vid, "source_hint": "video", "group": ""}
        return None
    # /reel/<id>
    if len(segs) >= 2 and low[0] == "reel":
        rid = _clean_segment(segs[1])
        if _DIGITS.match(rid):
            return {"url": f"{base}/reel/{rid}/", "post_key": rid, "source_hint": "video", "group": ""}
        return None
    # /photo/?fbid=<id> | /photo.php?fbid=<id>
    if segs and low[0] in ("photo", "photo.php"):
        fbid = q("fbid")
        if _DIGITS.match(fbid):
            return {"url": f"{base}/photo/?fbid={fbid}", "post_key": fbid, "source_hint": "photo", "group": ""}
        return None
    # /share/p/<mã>/ | /share/v/<mã>/ | /share/r/<mã>/ — link chia sẻ, Facebook tự chuyển sang bài gốc khi mở
    if len(segs) >= 3 and low[0] == "share" and low[1] in ("p", "v", "r"):
        code = _clean_segment(segs[2])
        if re.match(r"^[0-9A-Za-z_-]{6,}$", code):
            return {"url": f"{base}/share/{low[1]}/{code}/", "post_key": f"share:{code}", "source_hint": "share", "group": ""}
        return None
    # /<tên|id>/posts/<id|pfbid> | /<tên>/videos/<id> | /<tên>/photos/<album>/<id>
    if len(segs) >= 3 and low[1] in ("posts", "videos", "photos"):
        who = _clean_segment(segs[0])
        pid = _clean_segment(segs[-1] if low[1] == "photos" else segs[2])
        if _DIGITS.match(pid) or (low[1] == "posts" and _PFBID.match(pid)):
            kind = {"posts": "posts", "videos": "videos", "photos": "photos"}[low[1]]
            url = f"{base}/{who}/{kind}/{pid}/" if kind != "photos" else f"{base}/photo/?fbid={pid}"
            return {"url": url, "post_key": pid, "source_hint": "page" if kind == "posts" else "video" if kind == "videos" else "photo",
                    "group": ""}
        return None
    return None


def find_links_in_text(text: Any) -> list[str]:
    """Các chuỗi giống link Facebook trong 1 dòng / ô (dòng dán có thể kèm chữ khác)."""
    return [m.group(0).rstrip(").,;]") for m in _URL_IN_TEXT.finditer(str(text or ""))]


def parse_link_rows(rows: list[Any], *, max_links: int = 200) -> dict[str, Any]:
    """Đọc danh sách dòng (mỗi dòng 1 ô / 1 dòng văn bản) → [{line, raw, url, post_key, status}].

    status: valid | duplicate | invalid. Dòng tiêu đề (không chứa link) bị bỏ qua, không tính là sai.
    """
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    truncated = False
    for line_no, row in enumerate(rows or [], start=1):
        cells = row if isinstance(row, (list, tuple)) else [row]
        cell_text = " ".join(str(c) for c in cells if c is not None and str(c).strip())
        if not cell_text.strip():
            continue
        found = find_links_in_text(cell_text)
        if not found:
            # Dòng tiêu đề ("Link bài viết", "STT"…) — không phải dữ liệu
            if line_no == 1 or re.search(r"(link|url|đường dẫn|bài viết|stt|ghi chú)", cell_text, re.I):
                continue
            out.append({"line": line_no, "raw": cell_text[:300], "url": "", "post_key": "", "status": "invalid",
                        "reason": "Không phải link bài viết Facebook"})
            continue
        for raw in found:
            info = parse_post_link(raw)
            if not info:
                out.append({"line": line_no, "raw": raw[:300], "url": "", "post_key": "", "status": "invalid",
                            "reason": "Link Facebook nhưng không phải link bài viết"})
                continue
            key = info["post_key"]
            if key in seen:
                out.append({"line": line_no, "raw": raw[:300], **info, "status": "duplicate"})
                continue
            if len(seen) >= max_links:
                truncated = True
                continue
            seen.add(key)
            out.append({"line": line_no, "raw": raw[:300], **info, "status": "valid"})
    return {"rows": out, "truncated": truncated}


def numeric_post_id(post_key: str, fb_post_id: Optional[str] = None) -> str:
    """ID số của bài (dùng cho trang 'Người đã bày tỏ cảm xúc'); rỗng nếu chưa biết."""
    for cand in (fb_post_id, post_key):
        if cand and _DIGITS.match(str(cand)):
            return str(cand)
    return ""
