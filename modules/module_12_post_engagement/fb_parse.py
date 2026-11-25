"""
Đọc dữ liệu bài viết Facebook từ JSON mà chính trang Facebook đã tải (HTML ban đầu + các phản hồi GraphQL
trang tự gửi khi cuộn / mở trả lời). Không gọi API — chỉ đọc dữ liệu trang đã nhận để lấy đúng UID số,
tên, link cá nhân, nội dung bình luận (đầy đủ, không bị "Xem thêm"), thời gian và loại cảm xúc.

Hàm thuần (không cần trình duyệt) → test được bằng JSON mẫu.
"""
from __future__ import annotations

import base64
import json
import re
from collections import Counter, deque
from typing import Any, Iterable, Optional

_SCRIPT_JSON_RE = re.compile(r'<script type="application/json"[^>]*>(.*?)</script>', re.S)

# Mã loại cảm xúc của Facebook (feedback_reaction_info.id) → loại
REACTION_TYPES = {
    "1635855486666999": "LIKE",
    "1678524932434102": "LOVE",
    "613557422527858": "CARE",
    "115940658764963": "HAHA",
    "478547315650144": "WOW",
    "908563459236466": "SAD",
    "444813342392137": "ANGRY",
}
# aria-label dòng trong hộp thoại cảm xúc: "Tên Liked" / "Tên đã thích"…
_ARIA_REACTION = [
    (re.compile(r"\s(liked|đã thích|thích)\b", re.I), "LIKE"),
    (re.compile(r"\s(loved|yêu thích)\b", re.I), "LOVE"),
    (re.compile(r"\s(cared|thương thương)\b", re.I), "CARE"),
    (re.compile(r"\s(haha)\b", re.I), "HAHA"),
    (re.compile(r"\s(wow)\b", re.I), "WOW"),
    (re.compile(r"\s(sad|buồn)\b", re.I), "SAD"),
    (re.compile(r"\s(angry|phẫn nộ)\b", re.I), "ANGRY"),
]
FRIENDS_ONLY_MARK = "USE_REACTION_SHEET_STRING_ONLY"


# ---------------------------------------------------------------------------
# Đọc JSON
# ---------------------------------------------------------------------------


def json_blobs_from_html(html: str) -> list[Any]:
    """Các khối <script type="application/json"> có dữ liệu Relay trong HTML trang."""
    out = []
    for m in _SCRIPT_JSON_RE.finditer(html or ""):
        raw = m.group(1)
        if '"__typename"' not in raw:
            continue
        try:
            out.append(json.loads(raw))
        except Exception:
            continue
    return out


def json_objects_from_responses(texts: Iterable[str]) -> list[Any]:
    """Phản hồi GraphQL (mỗi phản hồi có thể nhiều dòng JSON, có thể có tiền tố `for (;;);`)."""
    out = []
    for text in texts or []:
        if not isinstance(text, str):
            continue
        body = text[9:] if text.startswith("for (;;);") else text
        for line in body.split("\n"):
            line = line.strip()
            if not line or line[0] not in "{[":
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                continue
    return out


def walk(obj: Any) -> Iterable[dict[str, Any]]:
    """Duyệt theo chiều rộng mọi dict trong cây JSON (gần gốc trước — số đếm của bài trước số của bình luận)."""
    queue = deque([obj])
    while queue:
        cur = queue.popleft()
        if isinstance(cur, dict):
            yield cur
            queue.extend(v for v in cur.values() if isinstance(v, (dict, list)))
        elif isinstance(cur, list):
            queue.extend(v for v in cur if isinstance(v, (dict, list)))


def _b64_id(value: Any) -> str:
    """'ZmVlZGJhY2s6MTIzXzQ1Ng==' → 'feedback:123_456' (rỗng nếu không giải mã được)."""
    s = str(value or "")
    if not s or len(s) > 400:
        return ""
    try:
        return base64.b64decode(s + "=" * (-len(s) % 4)).decode("utf-8", "ignore")
    except Exception:
        return ""


def _int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _str(value: Any) -> str:
    return str(value).strip() if value is not None else ""


# ---------------------------------------------------------------------------
# Thông tin bài viết
# ---------------------------------------------------------------------------


def post_meta(objs: list[Any], *, post_key: str = "", page_url: str = "") -> dict[str, Any]:
    """Thông tin bài đang mở: post_id, nội dung, người đăng, nhóm / page, thời gian, số like / share / bình luận.

    Trang có thể chứa nhiều bài (gợi ý bên cạnh) → chọn bài theo ID trong link; link pfbid / chia sẻ thì chọn bài
    có URL trùng link đang mở, cuối cùng là bài xuất hiện nhiều nhất.
    """
    stories: dict[str, list[dict[str, Any]]] = {}
    for root in objs:
        for o in walk(root):
            pid = o.get("post_id")
            if pid and isinstance(pid, (str, int)) and str(pid).isdigit():
                stories.setdefault(str(pid), []).append(o)
    if not stories:
        return {}

    target = ""
    if post_key and str(post_key).isdigit() and str(post_key) in stories:
        target = str(post_key)
    if not target:
        needles = [n for n in (post_key.replace("share:", "") if post_key else "", _url_path(page_url)) if n and len(n) > 6]
        for pid, dicts in stories.items():
            blob_urls = [str(v) for d in dicts for k, v in d.items() if isinstance(v, str) and ("facebook.com" in v or v.startswith("/"))]
            if any(n in u for n in needles for u in blob_urls):
                target = pid
                break
    if not target:
        target = max(stories, key=lambda p: len(stories[p]))

    meta: dict[str, Any] = {"post_id": target}
    for d in stories[target]:
        for o in walk(d):
            if "message" not in meta and isinstance(o.get("message"), dict) and isinstance(o["message"].get("text"), str):
                if o["message"]["text"].strip():
                    meta["message"] = o["message"]["text"].strip()
            if "creation_time" not in meta and _int(o.get("creation_time")):
                meta["creation_time"] = _int(o.get("creation_time"))
            acts = o.get("actors")
            if "author" not in meta and isinstance(acts, list) and acts and isinstance(acts[0], dict) and acts[0].get("name"):
                a = acts[0]
                meta["author"] = {"id": _str(a.get("id")), "name": _str(a.get("name")), "type": _str(a.get("__typename")),
                                  "url": _str(a.get("url") or a.get("profile_url"))}
            to = o.get("to")
            if "to" not in meta and isinstance(to, dict) and to.get("name"):
                meta["to"] = {"id": _str(to.get("id")), "name": _str(to.get("name")), "type": _str(to.get("__typename")),
                              "url": _str(to.get("url"))}
            if "reactions" not in meta and _reaction_total(o) is not None:
                meta["reactions"] = _reaction_total(o)
            if "shares" not in meta and _share_total(o) is not None:
                meta["shares"] = _share_total(o)
            if "comments" not in meta and _comment_total(o) is not None:
                meta["comments"] = _comment_total(o)
            if "url" not in meta:
                for key in ("url", "wwwURL", "permalink_url"):
                    u = o.get(key)
                    if isinstance(u, str) and ("/posts/" in u or "permalink" in u or "story_fbid" in u or "/videos/" in u or "/reel/" in u):
                        meta["url"] = u
                        break
    # Trang ảnh / video: số đếm không nằm trong khối bài (hoặc chỉ có dạng chữ "27", "3,6K") → tìm trên toàn trang.
    if any(k not in meta for k in ("reactions", "comments", "shares")):
        for root in objs:
            for o in walk(root):
                if "reactions" not in meta and _reaction_total(o) is not None:
                    meta["reactions"] = _reaction_total(o)
                if "shares" not in meta and _share_total(o) is not None:
                    meta["shares"] = _share_total(o)
                if "comments" not in meta and _comment_total(o) is not None:
                    meta["comments"] = _comment_total(o)
    # Fanpage kiểu mới (New Pages Experience) có __typename "User" → nhận qua cờ is_additional_profile_plus của tác giả
    author = meta.get("author") or {}
    if author.get("id") and author.get("type") != "Page" and _is_new_page(objs, author["id"]):
        author["type"] = "Page"
    # Nguồn: nhóm (to: Group) / page / trang cá nhân
    to, author = meta.get("to") or {}, meta.get("author") or {}
    if to.get("type") == "Group":
        meta["source_type"], meta["source_name"], meta["source_id"] = "group", to.get("name"), to.get("id")
    elif author.get("type") == "Page":
        meta["source_type"], meta["source_name"], meta["source_id"] = "page", author.get("name"), author.get("id")
    elif author:
        meta["source_type"], meta["source_name"], meta["source_id"] = "profile", author.get("name"), author.get("id")
    return meta


def _reaction_total(o: dict[str, Any]) -> Optional[int]:
    """Tổng cảm xúc của 1 khối feedback: reaction_count → reactors.count → tổng top_reactions (từng loại) →
    chữ i18n của chính khối (KHÔNG lấy số của 1 loại cảm xúc trong top_reactions)."""
    rc = o.get("reaction_count")
    if isinstance(rc, dict) and _int(rc.get("count")) is not None:
        return _int(rc.get("count"))
    for key in ("reactors", "unified_reactors"):  # unified_reactors: trang reel
        reactors = o.get(key)
        if isinstance(reactors, dict) and _int(reactors.get("count")) is not None:
            return _int(reactors.get("count"))
    top = o.get("top_reactions")
    if isinstance(top, dict) and isinstance(top.get("edges"), list) and top["edges"]:
        vals = [_int(e.get("reaction_count")) for e in top["edges"] if isinstance(e, dict)]
        if vals and all(v is not None for v in vals):
            return sum(vals)
    if isinstance(o.get("i18n_reaction_count"), str) and "node" not in o:
        return parse_count_text(o["i18n_reaction_count"])
    return None


def _is_new_page(objs: list[Any], author_id: str) -> bool:
    """Tác giả là fanpage kiểu mới: khối có id = tác giả mang is_additional_profile_plus = true."""
    for root in objs:
        for o in walk(root):
            if o.get("is_additional_profile_plus") is True and _str(o.get("id")) == str(author_id):
                return True
    return False


def _comment_total(o: dict[str, Any]) -> Optional[int]:
    """Số bình luận: comments / comment_count {total_count} (bài thường) hoặc total_comment_count số nguyên (reel)."""
    for key in ("comments", "comment_count", "total_comment_count"):
        val = o.get(key)
        if isinstance(val, dict) and _int(val.get("total_count")) is not None:
            return _int(val.get("total_count"))
    if isinstance(o.get("total_comment_count"), int):
        return o["total_comment_count"]
    return None


def _share_total(o: dict[str, Any]) -> Optional[int]:
    """Số chia sẻ: share_count {count} (bài thường) hoặc share_count_reduced "5" / "1,2K" (reel)."""
    if isinstance(o.get("share_count"), dict) and _int(o["share_count"].get("count")) is not None:
        return _int(o["share_count"].get("count"))
    for key in ("share_count_reduced", "i18n_share_count"):
        if isinstance(o.get(key), str) and parse_count_text(o[key]) is not None:
            return parse_count_text(o[key])
    return None


def parse_count_text(text: Any) -> Optional[int]:
    """'27' → 27 · '3.6K' / '3,6K' → 3600 · '1,2 N' → 1200 · '2 Tr' / '2M' → 2000000 · '1.234' → 1234."""
    s = str(text or "").strip().lower().replace("\xa0", " ")
    m = re.match(r"^([\d.,]+)\s*(k|n|nghìn|m|tr|triệu)?$", s)
    if not m:
        return None
    num, unit = m.group(1), m.group(2)
    if unit:
        try:
            v = float(num.replace(",", "."))
        except ValueError:
            return None
        return int(round(v * (1_000_000 if unit in ("m", "tr", "triệu") else 1000)))
    digits = re.sub(r"[.,]", "", num)
    return int(digits) if digits.isdigit() else None


def _url_path(url: str) -> str:
    m = re.match(r"https?://[^/]+(/[^?#]*)", url or "")
    path = (m.group(1) if m else "").rstrip("/")
    return path if path.count("/") >= 2 else ""


# ---------------------------------------------------------------------------
# Bình luận (gốc + trả lời)
# ---------------------------------------------------------------------------


def _find_created_time(comment: dict[str, Any]) -> Optional[int]:
    if _int(comment.get("created_time")):
        return _int(comment.get("created_time"))
    for o in walk(comment):
        if o is comment:
            continue
        ts = _int(o.get("created_time"))
        if ts and ts > 1_000_000_000:
            return ts
    return None


def _avatar(author: dict[str, Any]) -> str:
    for key in ("profile_picture_depth_0", "profile_picture_depth_1", "profile_picture", "profilePicture"):
        pic = author.get(key)
        if isinstance(pic, dict) and pic.get("uri"):
            return str(pic["uri"])
    return ""


def extract_comments(objs: list[Any], ctx: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    """Mọi bình luận trong dữ liệu: {comment_id, parent_id, depth, uid, name, profile_url, avatar, is_page, text, created_time}.

    `ctx` (dict, giữ qua nhiều lần gọi): nhớ feedback.id của bình luận đã thấy — phản hồi "Xem N câu trả lời"
    chỉ mang feedback.id của bình luận cha (cha nằm ở phản hồi trước đó).
    """
    found: dict[str, dict[str, Any]] = {}
    # Khối chứa danh sách trả lời mang id = feedback của bình luận cha ("feedback:pfbid…" hoặc "feedback:<bài>_<bl>");
    # bình luận cha có feedback.id trùng chuỗi đó → ghép lại để biết cha của từng trả lời.
    child_container: dict[str, str] = {}     # legacy_fbid của trả lời → id khối chứa
    feedback_owner: dict[str, str] = ctx.setdefault("feedback_owner", {}) if ctx is not None else {}  # feedback.id → legacy_fbid
    for root in objs:
        for o in walk(root):
            rc = o.get("replies_connection")
            if isinstance(rc, dict) and isinstance(rc.get("edges"), list):
                container = _str(o.get("id"))
                if o.get("legacy_fbid"):  # khối chứa chính là bình luận cha
                    feedback_owner.setdefault(container, _str(o.get("legacy_fbid")))
                for e in rc["edges"]:
                    node = e.get("node") if isinstance(e, dict) else None
                    if isinstance(node, dict) and node.get("legacy_fbid") and container:
                        child_container[_str(node["legacy_fbid"])] = container
            fb = o.get("feedback")
            if o.get("legacy_fbid") and isinstance(fb, dict) and fb.get("id"):
                feedback_owner[_str(fb.get("id"))] = _str(o.get("legacy_fbid"))
            # Nút bình luận: trả lời (depth 1) trong phản hồi "Xem phản hồi" không có __typename → nhận theo cấu trúc
            if not o.get("legacy_fbid") or not isinstance(o.get("author"), dict):
                continue
            if o.get("__typename") not in (None, "Comment") or not ("depth" in o or "body" in o):
                continue
            author = o.get("author") if isinstance(o.get("author"), dict) else {}
            uid = _str(author.get("id"))
            if not uid or not uid.isdigit():
                continue
            cid = _str(o.get("legacy_fbid"))
            body = o.get("body") if isinstance(o.get("body"), dict) else {}
            text = _str(body.get("text"))
            if not text and o.get("attachments"):
                text = "[Ảnh / sticker]"
            decoded_id = _b64_id(o.get("id")) if o.get("id") else ""
            row = {
                "comment_id": cid,
                # id bình luận "comment:<bài>_<bl>" → bài chứa bình luận (lọc bình luận của ảnh kế bên Facebook tải sẵn)
                "post_id": decoded_id.split(":", 1)[1].split("_", 1)[0] if decoded_id.startswith("comment:") and "_" in decoded_id else "",
                "parent_id": "",
                "depth": _int(o.get("depth")) or 0,
                "uid": uid,
                "name": _str(author.get("name")),
                "profile_url": _str(author.get("url")) or f"https://www.facebook.com/{uid}",
                "avatar": _avatar(author),
                "is_page": author.get("__typename") == "Page",
                "text": text,
                "created_time": _find_created_time(o),
            }
            old = found.get(cid)
            # Cùng bình luận xuất hiện nhiều lần (bản rút gọn / đầy đủ) → giữ bản nhiều thông tin hơn
            if old is None or (not old["text"] and row["text"]) or (not old["created_time"] and row["created_time"]):
                found[cid] = {**(old or {}), **{k: v for k, v in row.items() if v or k not in (old or {})}}
    for cid, row in found.items():
        container = child_container.get(cid)
        if not row.get("parent_id") and container:
            parent = feedback_owner.get(container, "")
            if not parent:  # dự phòng: "feedback:<bài>_<bình luận cha>"
                decoded = _b64_id(container)
                tail = decoded.rsplit("_", 1)[-1] if decoded.startswith("feedback:") and "_" in decoded else ""
                parent = tail if tail.isdigit() else ""
            if parent and parent != cid:
                row["parent_id"] = parent
        if row.get("parent_id") and not row.get("depth"):
            row["depth"] = 1
    return list(found.values())


# ---------------------------------------------------------------------------
# Người đã bày tỏ cảm xúc
# ---------------------------------------------------------------------------


def extract_reactors(objs: list[Any]) -> dict[str, Any]:
    """{rows: [{uid, name, profile_url, avatar, reaction, is_page}], has_next: bool|None, friends_only: bool}."""
    rows: dict[str, dict[str, Any]] = {}
    has_next: Optional[bool] = None
    friends_only = False
    for root in objs:
        for o in walk(root):
            if o.get("reaction_display_strategy") == FRIENDS_ONLY_MARK:
                friends_only = True
            cfg = o.get("reaction_display_config")
            if isinstance(cfg, dict) and cfg.get("reaction_display_strategy") == FRIENDS_ONLY_MARK:
                friends_only = True
            edges = o.get("edges")
            if not isinstance(edges, list) or not edges:
                continue
            got = False
            for e in edges:
                if not isinstance(e, dict) or "feedback_reaction_info" not in e or not isinstance(e.get("node"), dict):
                    continue
                n = e["node"]
                uid = _str(n.get("id"))
                if not uid.isdigit():
                    continue
                got = True
                info = e.get("feedback_reaction_info") if isinstance(e.get("feedback_reaction_info"), dict) else {}
                rows[uid] = {
                    "uid": uid,
                    "name": _str(n.get("name")),
                    "profile_url": _str(n.get("url") or n.get("profile_url")) or f"https://www.facebook.com/{uid}",
                    "avatar": _avatar(n),
                    "reaction": REACTION_TYPES.get(_str(info.get("id")), "LIKE"),
                    "is_page": n.get("__typename") == "Page",
                }
            if got and isinstance(o.get("page_info"), dict) and "has_next_page" in o["page_info"]:
                has_next = bool(o["page_info"]["has_next_page"])
    return {"rows": list(rows.values()), "has_next": has_next, "friends_only": friends_only}


def reaction_from_aria(label: str) -> tuple[str, str]:
    """'Nguyễn Văn A Liked' → ('Nguyễn Văn A', 'LIKE'). Dùng cho dòng đọc từ giao diện (dự phòng JSON)."""
    text = re.sub(r",\s*(unseen story|đã xem tin|tin chưa xem).*$", "", _str(label), flags=re.I)
    for pattern, kind in _ARIA_REACTION:
        m = pattern.search(text)
        if m and m.end() >= len(text) - 1:
            return text[: m.start()].strip(), kind
    return text, ""


def merge_reactors(json_rows: list[dict[str, Any]], dom_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Gộp người bày tỏ cảm xúc từ JSON (đủ thông tin) và giao diện (dự phòng), bỏ trùng theo UID."""
    out: dict[str, dict[str, Any]] = {}
    for r in dom_rows or []:
        uid = _str(r.get("uid"))
        if not uid.isdigit():
            continue
        name, kind = reaction_from_aria(r.get("aria") or "") if r.get("aria") else (_str(r.get("name")), "")
        out[uid] = {"uid": uid, "name": name or _str(r.get("name")), "profile_url": f"https://www.facebook.com/{uid}",
                    "avatar": _str(r.get("avatar")), "reaction": kind or "LIKE", "is_page": False}
    for r in json_rows or []:
        out[_str(r.get("uid"))] = {**out.get(_str(r.get("uid")), {}), **{k: v for k, v in r.items() if v not in ("", None)}}
    return list(out.values())


def tier_of(has_like: bool, has_comment: bool) -> Optional[int]:
    """Mức tiềm năng: vừa Like vừa bình luận → 1 (Cao), 1 trong 2 → 2 (Cơ bản), không có → None (không lưu).

    Không tính Share: Facebook chỉ cho xem tổng số lượt chia sẻ, không cho xem ai đã chia sẻ.
    """
    total = int(bool(has_like)) + int(bool(has_comment))
    return {2: 1, 1: 2}.get(total)


def most_common_post_id(objs: list[Any]) -> str:
    counter: Counter = Counter()
    for root in objs:
        for o in walk(root):
            pid = o.get("post_id")
            if pid and str(pid).isdigit():
                counter[str(pid)] += 1
    return counter.most_common(1)[0][0] if counter else ""
