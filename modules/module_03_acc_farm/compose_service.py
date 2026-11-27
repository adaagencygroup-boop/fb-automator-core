"""
compose_service.py
Module 03 - Tab 2: Ô soạn bài chung + kho ảnh chung cho Đăng Status (đăng ngay / chiến dịch nhiều khung giờ).

Không đụng DB — chỉ xử lý dữ liệu, để test được:
  1. parse_compose_text : tách bài theo dòng "---", bỏ bài rỗng, gộp bài trùng, báo bài quá dài
  2. validate_plan      : kiểm tra kho bài / kho ảnh đủ cho số nick × số khung giờ (chặn / cảnh báo)
  3. allocate_round     : phân bài + ảnh cho từng nick trong 1 lượt (đăng ngay hoặc 1 khung giờ)

Luật không đăng trùng (chốt trong phong-van/2026-11-27-chien-dich-dang-bai-module-3.md):
  - Trong cùng một lượt, hai nick không dùng chung bài / ảnh.
  - Trong một chiến dịch, một nick không bao giờ đăng lại bài / ảnh nó đã đăng.
  - Ưu tiên bài / ảnh ít được dùng nhất, chọn ngẫu nhiên giữa các lựa chọn ngang nhau.
"""
from __future__ import annotations

import hashlib
import random
import re
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Set

CONTENT_SINGLE = "SINGLE"
CONTENT_MULTI = "MULTI"
CONTENT_MODES = (CONTENT_SINGLE, CONTENT_MULTI)

IMAGE_NONE = "NONE"
IMAGE_SINGLE = "SINGLE"
IMAGE_MULTI = "MULTI"
IMAGE_MODES = (IMAGE_NONE, IMAGE_SINGLE, IMAGE_MULTI)

MIN_IMAGES_PER_POST = 1
MAX_IMAGES_PER_POST = 3
# Khớp CHECK (char_length(content) <= 63206) của bảng posts
MAX_POST_CHARS = 63206
MAX_TIME_SLOTS = 24

# Dòng phân cách bài: chỉ gồm "---" (cho phép khoảng trắng hai bên)
_SEPARATOR_RE = re.compile(r"^[ \t]*---[ \t]*$", re.MULTILINE)


def text_key(content: str) -> str:
    """Khoá định danh 1 bài theo nội dung (sửa chữ → bài mới, không bị tính là đã đăng)."""
    return hashlib.sha1((content or "").strip().encode("utf-8")).hexdigest()


# ==============================================================================
# 1. TÁCH BÀI
# ==============================================================================

@dataclass
class ParsedCompose:
    posts: List[str] = field(default_factory=list)
    empty_dropped: int = 0
    duplicates_merged: int = 0
    # Số thứ tự (1-based, theo thứ tự đã nhận) các bài dài quá MAX_POST_CHARS
    too_long: List[int] = field(default_factory=list)

    def summary(self) -> str:
        parts = []
        if self.empty_dropped:
            parts.append(f"bỏ {self.empty_dropped} bài rỗng")
        if self.duplicates_merged:
            parts.append(f"gộp {self.duplicates_merged} bài trùng")
        extra = f" ({', '.join(parts)})" if parts else ""
        return f"Đã nhận {len(self.posts)} bài{extra}"

    def to_dict(self) -> Dict:
        return {
            "posts": list(self.posts),
            "count": len(self.posts),
            "empty_dropped": self.empty_dropped,
            "duplicates_merged": self.duplicates_merged,
            "too_long": list(self.too_long),
            "summary": self.summary(),
        }


def normalize_content_mode(mode: Optional[str]) -> str:
    value = str(mode or "").strip().upper()
    return value if value in CONTENT_MODES else CONTENT_MULTI


def normalize_image_mode(mode: Optional[str]) -> str:
    value = str(mode or "").strip().upper()
    return value if value in IMAGE_MODES else IMAGE_NONE


def parse_compose_text(text: Optional[str], content_mode: str = CONTENT_MULTI) -> ParsedCompose:
    """Tách nội dung ô soạn bài thành danh sách bài.

    - SINGLE: cả ô là 1 bài (không tách theo "---").
    - MULTI : tách theo dòng "---"; bỏ bài rỗng; bài giống hệt nhau (sau khi bỏ khoảng trắng đầu/cuối) gộp làm một.
    """
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    mode = normalize_content_mode(content_mode)
    chunks = [raw] if mode == CONTENT_SINGLE else _SEPARATOR_RE.split(raw)

    result = ParsedCompose()
    seen: Set[str] = set()
    for chunk in chunks:
        post = chunk.strip()
        if not post:
            # Ô trống hoàn toàn không tính là "bài rỗng bị bỏ"
            if mode == CONTENT_MULTI and raw.strip():
                result.empty_dropped += 1
            continue
        if post in seen:
            result.duplicates_merged += 1
            continue
        seen.add(post)
        result.posts.append(post)
        if len(post) > MAX_POST_CHARS:
            result.too_long.append(len(result.posts))
    return result


POST_SEPARATOR = "---"
# Các dòng "---" thừa ở cuối ô (người dùng gõ sẵn dấu tách) — bỏ để không sinh bài rỗng
_TRAILING_SEPARATORS_RE = re.compile(r"(?:(?:^|\n)[ \t]*---[ \t]*\s*)+$")


def sanitize_post(text: Optional[str]) -> str:
    """Làm sạch 1 bài trước khi đưa vào ô soạn: bỏ dòng "---" bên trong để bài không bị tách đôi."""
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    return _SEPARATOR_RE.sub("", raw).strip()


def append_posts(existing: Optional[str], posts: Iterable[str]) -> str:
    """Thêm bài vào cuối ô soạn, mỗi bài cách nhau bằng dòng "---"."""
    new_posts = [p for p in (sanitize_post(p) for p in posts) if p]
    if not new_posts:
        return existing or ""
    base = _TRAILING_SEPARATORS_RE.sub("", (existing or "").rstrip()).rstrip()
    joined = f"\n{POST_SEPARATOR}\n".join(new_posts)
    return f"{base}\n{POST_SEPARATOR}\n{joined}" if base else joined


def normalize_pool_images(paths: Optional[Iterable[str]]) -> List[str]:
    """Kho ảnh chung: bỏ trống / trùng, giữ thứ tự."""
    out: List[str] = []
    for p in paths or []:
        value = str(p or "").strip()
        if value and value not in out:
            out.append(value)
    return out


def clamp_image_range(min_images: Optional[int], max_images: Optional[int]) -> tuple[int, int]:
    def _clamp(v: Optional[int], default: int) -> int:
        try:
            n = int(v)
        except (TypeError, ValueError):
            n = default
        return max(MIN_IMAGES_PER_POST, min(MAX_IMAGES_PER_POST, n))

    lo = _clamp(min_images, 1)
    hi = _clamp(max_images, lo)
    return (lo, max(lo, hi))


# ==============================================================================
# 2. KIỂM TRA KHO
# ==============================================================================

@dataclass
class PlanCheck:
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> Dict:
        return {"ok": self.ok, "errors": list(self.errors), "warnings": list(self.warnings)}


def validate_plan(
    parsed: ParsedCompose,
    images: Sequence[str],
    *,
    account_count: int,
    slot_count: int,
    content_mode: str,
    image_mode: str,
    min_images: int = 1,
    max_images: int = 1,
) -> PlanCheck:
    """Kiểm tra trước khi đăng ngay (slot_count = 1) hoặc tạo chiến dịch (slot_count = số khung giờ).

    Chặn khi kho không thể xếp được (luật không trùng), cảnh báo khi phải dùng lại bài/ảnh giữa các nick.
    """
    check = PlanCheck()
    c_mode = normalize_content_mode(content_mode)
    i_mode = normalize_image_mode(image_mode)
    pool = normalize_pool_images(images)
    n = max(0, int(account_count or 0))
    s = max(1, int(slot_count or 1))
    lo, hi = clamp_image_range(min_images, max_images)

    if n == 0:
        check.errors.append("Chưa chọn tài khoản nào.")
    if s > MAX_TIME_SLOTS:
        check.errors.append(f"Tối đa {MAX_TIME_SLOTS} khung giờ cho một chiến dịch.")

    # ── Nội dung ──
    p = len(parsed.posts)
    if p == 0:
        check.errors.append("Chưa có nội dung bài viết.")
    if parsed.too_long:
        nums = ", ".join(f"#{i}" for i in parsed.too_long)
        limit = f"{MAX_POST_CHARS:,}".replace(",", ".")
        check.errors.append(f"Bài {nums} dài quá {limit} ký tự (giới hạn của Facebook).")

    if c_mode == CONTENT_SINGLE and s > 1:
        check.errors.append(
            "Chế độ \"1 nội dung\" không dùng được với nhiều khung giờ (mỗi nick sẽ đăng lại đúng bài đó). "
            "Chọn \"Nhiều nội dung\" hoặc chỉ để 1 khung giờ."
        )
    if c_mode == CONTENT_MULTI and p > 0 and n > 0:
        if p < n:
            check.errors.append(f"Cần ít nhất {n} bài cho {n} tài khoản (mỗi nick một bài khác nhau), hiện có {p} bài.")
        elif p < s:
            check.errors.append(
                f"Cần ít nhất {s} bài cho {s} khung giờ (mỗi nick không đăng lại bài cũ), hiện có {p} bài."
            )
        elif p < n * s:
            check.warnings.append(
                f"Có {p} bài cho {n} tài khoản × {s} khung giờ = {n * s} lượt đăng: "
                "một số bài sẽ được nick khác dùng lại ở khung sau."
            )

    # ── Ảnh ──
    m = len(pool)
    if i_mode == IMAGE_SINGLE:
        if m == 0:
            check.errors.append("Chế độ \"1 ảnh\" cần tải lên 1 ảnh.")
        if s > 1:
            check.errors.append(
                "Chế độ \"1 ảnh\" không dùng được với nhiều khung giờ (mỗi nick sẽ đăng lại đúng ảnh đó). "
                "Chọn \"Nhiều ảnh\" hoặc chỉ để 1 khung giờ."
            )
    elif i_mode == IMAGE_MULTI and n > 0:
        need_round = n * hi
        need_account = s * hi
        if m == 0:
            check.errors.append("Chế độ \"Nhiều ảnh\" cần tải ảnh vào kho.")
        elif m < need_round:
            check.errors.append(
                f"Cần ít nhất {need_round} ảnh ({n} tài khoản × tối đa {hi} ảnh/bài, không dùng chung ảnh trong cùng lượt), "
                f"hiện có {m} ảnh."
            )
        elif m < need_account:
            check.errors.append(
                f"Cần ít nhất {need_account} ảnh ({s} khung giờ × tối đa {hi} ảnh/bài, mỗi nick không đăng lại ảnh cũ), "
                f"hiện có {m} ảnh."
            )
        elif m < n * s * hi:
            check.warnings.append(
                f"Có {m} ảnh cho {n * s} lượt đăng × tối đa {hi} ảnh/bài: "
                "một số ảnh sẽ được nick khác dùng lại ở khung sau."
            )
    return check


# ==============================================================================
# 3. PHÂN BÀI CHO 1 LƯỢT
# ==============================================================================

@dataclass
class Assignment:
    account_uid: str
    content: str
    text_key: str
    images: List[str] = field(default_factory=list)


@dataclass
class RoundAllocation:
    assignments: List[Assignment] = field(default_factory=list)
    # account_uid -> lý do bỏ qua
    skipped: Dict[str, str] = field(default_factory=dict)


class _MaxFlow:
    """Dinic, DFS không đệ quy (tránh giới hạn độ sâu của Python với nhiều nick)."""

    def __init__(self, n: int):
        self.g: List[List[list]] = [[] for _ in range(n)]

    def add(self, u: int, v: int, cap: int) -> int:
        self.g[u].append([v, cap, len(self.g[v])])
        self.g[v].append([u, 0, len(self.g[u]) - 1])
        return len(self.g[u]) - 1

    def run(self, s: int, t: int) -> int:
        total = 0
        g = self.g
        while True:
            level = [-1] * len(g)
            level[s] = 0
            queue = deque([s])
            while queue:
                u = queue.popleft()
                for v, cap, _ in g[u]:
                    if cap > 0 and level[v] < 0:
                        level[v] = level[u] + 1
                        queue.append(v)
            if level[t] < 0:
                return total
            it = [0] * len(g)
            while True:
                pushed = self._augment(s, t, level, it)
                if not pushed:
                    break
                total += pushed

    def _augment(self, s: int, t: int, level: List[int], it: List[int]) -> int:
        g = self.g
        stack = [s]
        path: List[tuple] = []  # (u, index cạnh trong g[u])
        while stack:
            u = stack[-1]
            if u == t:
                pushed = min(g[x][i][1] for x, i in path)
                for x, i in path:
                    edge = g[x][i]
                    edge[1] -= pushed
                    g[edge[0]][edge[2]][1] += pushed
                return pushed
            advanced = False
            while it[u] < len(g[u]):
                v, cap, _ = g[u][it[u]]
                if cap > 0 and level[v] == level[u] + 1:
                    path.append((u, it[u]))
                    stack.append(v)
                    advanced = True
                    break
                it[u] += 1
            if not advanced:
                stack.pop()
                level[u] = -1  # ngõ cụt trong pha này
                if path:
                    parent, _ = path.pop()
                    it[parent] += 1
        return 0


def _plan_round(
    needs: Dict[str, int],
    allowed: Dict[str, List[str]],
    items: Sequence[str],
    remaining_rounds: int,
    *,
    fresh: Sequence[str] = (),
    partial: bool = False,
) -> Optional[Dict[str, List[str]]]:
    """Chọn item cho lượt hiện tại sao cho các lượt còn lại vẫn xếp được (luật không trùng).

    needs[x]      : số item x cần mỗi lượt (bài: 1, ảnh: số ảnh tối đa/bài)
    allowed[x]    : item x còn được dùng (chưa từng dùng), đã xếp theo ưu tiên
    fresh         : item chưa nick nào dùng (đã xếp theo ưu tiên) — đủ cho mọi lượt còn lại thì xếp thẳng
    partial       : chỉ với 1 lượt — không đủ thì vẫn trả về cách xếp được nhiều nhất
    Trả về None nếu không có cách xếp đủ cho `remaining_rounds` lượt.

    Cách làm: (1) luồng cực đại chọn đồ thị H — mỗi x lấy needs[x]·R item khác nhau, mỗi item dùng ≤ R lần;
    (2) tách x thành needs[x] bản sao, mỗi bản sao R cạnh; thêm đỉnh giả để đồ thị R-chính quy;
    (3) ghép cặp hoàn hảo = 1 lớp màu của phép tô cạnh R màu (König) → lượt này; phần còn lại vẫn tô được R−1 màu.
    """
    r = max(1, int(remaining_rounds))
    left = [x for x in needs if needs[x] > 0]
    total_need = sum(needs[x] * r for x in left)
    if not left:
        return {}
    # Đủ item chưa ai dùng cho tất cả lượt còn lại → không thể kẹt, khỏi chạy luồng (kho lớn sẽ rất nặng)
    if len(fresh) >= total_need:
        plan, pos = {}, 0
        for x in left:
            plan[x] = list(fresh[pos:pos + needs[x]])
            pos += needs[x]
        return plan
    item_index = {it: i for i, it in enumerate(items)}
    n_left, n_items = len(left), len(items)
    source, sink = n_left + n_items, n_left + n_items + 1
    flow = _MaxFlow(n_left + n_items + 2)
    edge_refs: Dict[str, List[tuple]] = {}
    for li, x in enumerate(left):
        flow.add(source, li, needs[x] * r)
        refs = []
        for it in allowed.get(x, []):
            if it in item_index:
                refs.append((it, flow.add(li, n_left + item_index[it], 1)))
        edge_refs[x] = refs
    for ii in range(n_items):
        flow.add(n_left + ii, sink, r)
    if flow.run(source, sink) < total_need and not (partial and r == 1):
        return None

    h_edges: Dict[str, List[str]] = {}
    degree: Dict[str, int] = {}
    for li, x in enumerate(left):
        chosen = [it for it, ei in edge_refs[x] if flow.g[li][ei][1] == 0]
        h_edges[x] = chosen
        for it in chosen:
            degree[it] = degree.get(it, 0) + 1

    if r == 1:
        return h_edges

    # Bản sao: mỗi bản sao giữ đúng R cạnh (giữ thứ tự ưu tiên)
    candidates: Dict[str, List[str]] = {}
    copy_owner: Dict[str, str] = {}
    for x in left:
        for k in range(needs[x]):
            key = f"{x}\x00{k}"
            candidates[key] = h_edges[x][k * r:(k + 1) * r]
            copy_owner[key] = x
    # Đỉnh giả lấp phần thiếu của từng item (R − bậc) → đồ thị R-chính quy (đa đồ thị)
    dummy_lists: List[List[str]] = [[]]
    for it in items:
        for _ in range(r - degree.get(it, 0)):
            if len(dummy_lists[-1]) == r:
                dummy_lists.append([])
            dummy_lists[-1].append(it)
    for d, lst in enumerate(dummy_lists):
        if lst:
            candidates[f"\x01dummy{d}"] = list(dict.fromkeys(lst))

    matched = _match(list(candidates), candidates)
    plan: Dict[str, List[str]] = {x: [] for x in left}
    for key, it in matched.items():
        if key in copy_owner:
            plan[copy_owner[key]].append(it)
    return plan


def _match(
    left: Sequence[str],
    candidates: Dict[str, List[str]],
) -> Dict[str, str]:
    """Ghép cặp lớn nhất giữa `left` và item (mỗi item dùng tối đa 1 lần), tìm đường tăng bằng BFS (không đệ quy).

    `candidates[x]` đã sắp theo thứ tự ưu tiên → x lấy item tự do đầu tiên trong danh sách của mình;
    chỉ khi hết item tự do mới bắt nick khác nhường chỗ.
    """
    owner: Dict[str, str] = {}  # item -> left
    assigned: Dict[str, str] = {}  # left -> item

    for x in left:
        reached_from: Dict[str, str] = {}  # item -> left đã đi tới item đó
        queue = deque([x])
        free_item: Optional[str] = None
        while queue and free_item is None:
            cur = queue.popleft()
            for item in candidates.get(cur, []):
                if item in reached_from:
                    continue
                reached_from[item] = cur
                if item not in owner:
                    free_item = item
                    break
                queue.append(owner[item])
        if free_item is None:
            continue
        item = free_item
        while True:
            cur = reached_from[item]
            previous = assigned.get(cur)
            owner[item] = cur
            assigned[cur] = item
            if cur == x or previous is None:
                break
            item = previous
    return dict(assigned)


def _ranked(items: Sequence[str], usage_counts: Dict[str, int], rng: random.Random) -> List[str]:
    """Ít được dùng nhất lên trước, ngẫu nhiên giữa các item ngang nhau."""
    shuffled = list(items)
    rng.shuffle(shuffled)
    return sorted(shuffled, key=lambda it: usage_counts.get(it, 0))


def allocate_round(
    account_uids: Sequence[str],
    posts: Sequence[str],
    images: Sequence[str],
    *,
    content_mode: str,
    image_mode: str,
    min_images: int = 1,
    max_images: int = 1,
    used_texts: Optional[Dict[str, Set[str]]] = None,
    used_images: Optional[Dict[str, Set[str]]] = None,
    text_usage: Optional[Dict[str, int]] = None,
    image_usage: Optional[Dict[str, int]] = None,
    remaining_rounds: int = 1,
    rng: Optional[random.Random] = None,
) -> RoundAllocation:
    """Phân bài + ảnh cho các nick trong 1 lượt.

    used_texts / used_images : account_uid -> các key nick đó đã đăng trong chiến dịch (bỏ trống với đăng ngay)
    text_usage / image_usage : key -> số lần đã dùng trong chiến dịch (ưu tiên dùng ít nhất)
    remaining_rounds         : số lượt còn lại tính cả lượt này (đăng ngay = 1). Lượt này được chọn sao cho các
                               lượt sau vẫn xếp được; nếu kho đã không đủ (vd. sửa nội dung giữa chừng) thì xếp tối đa
                               cho riêng lượt này.
    Nick không còn bài hợp lệ → bị bỏ qua kèm lý do (không làm hỏng cả lượt).
    """
    rng = rng or random.Random()
    c_mode = normalize_content_mode(content_mode)
    i_mode = normalize_image_mode(image_mode)
    lo, hi = clamp_image_range(min_images, max_images)
    used_texts = used_texts or {}
    used_images = used_images or {}
    text_usage = text_usage or {}
    image_usage = image_usage or {}
    uids = list(dict.fromkeys(str(u) for u in account_uids if str(u or "").strip()))
    post_list = list(dict.fromkeys(p.strip() for p in posts if (p or "").strip()))
    pool = normalize_pool_images(images)

    result = RoundAllocation()

    # ── Bài ──
    content_by_uid: Dict[str, str] = {}
    if not post_list:
        for uid in uids:
            result.skipped[uid] = "Không có nội dung bài viết."
        return result
    if c_mode == CONTENT_SINGLE:
        only = post_list[0]
        for uid in uids:
            if text_key(only) in used_texts.get(uid, set()):
                result.skipped[uid] = "Nick đã đăng nội dung này trong chiến dịch."
            else:
                content_by_uid[uid] = only
    else:
        by_key = {text_key(p): p for p in post_list}
        ranked = _ranked(list(by_key), text_usage, rng)
        order = list(uids)
        rng.shuffle(order)
        allowed = {uid: [k for k in ranked if k not in used_texts.get(uid, set())] for uid in order}
        used_any = set().union(*used_texts.values()) if used_texts else set()
        fresh = [k for k in ranked if not text_usage.get(k) and k not in used_any]
        needs = {uid: 1 for uid in order}
        plan = _plan_round(needs, allowed, ranked, remaining_rounds, fresh=fresh)
        if plan is None:
            plan = _plan_round(needs, allowed, ranked, 1, fresh=fresh, partial=True) or {}
        for uid in uids:
            if plan.get(uid):
                content_by_uid[uid] = by_key[plan[uid][0]]
            else:
                result.skipped[uid] = "Không còn bài chưa đăng cho nick này (kho bài không đủ)."

    # ── Ảnh ──
    images_by_uid: Dict[str, List[str]] = {uid: [] for uid in content_by_uid}
    if i_mode == IMAGE_SINGLE and pool:
        for uid in content_by_uid:
            if pool[0] in used_images.get(uid, set()):
                # Nick đã đăng ảnh này → vẫn đăng chữ, bỏ ảnh
                continue
            images_by_uid[uid] = [pool[0]]
    elif i_mode == IMAGE_MULTI and pool:
        ranked_imgs = _ranked(pool, image_usage, rng)
        order = list(content_by_uid)
        rng.shuffle(order)
        allowed_imgs = {uid: [img for img in ranked_imgs if img not in used_images.get(uid, set())] for uid in order}
        # Lên kế hoạch theo số ảnh tối đa (trường hợp xấu nhất); lượt này mỗi bài lấy ngẫu nhiên lo..hi ảnh
        used_any_img = set().union(*used_images.values()) if used_images else set()
        fresh_imgs = [img for img in ranked_imgs if not image_usage.get(img) and img not in used_any_img]
        img_needs = {uid: hi for uid in order}
        img_plan = _plan_round(img_needs, allowed_imgs, ranked_imgs, remaining_rounds, fresh=fresh_imgs)
        if img_plan is None:
            img_plan = _plan_round(img_needs, allowed_imgs, ranked_imgs, 1, fresh=fresh_imgs, partial=True) or {}
        for uid in order:
            got = img_plan.get(uid, [])
            want = min(len(got), rng.randint(lo, hi))
            images_by_uid[uid] = rng.sample(got, want) if want < len(got) else list(got)
        for uid in list(content_by_uid):
            if len(images_by_uid[uid]) < lo:
                result.skipped[uid] = f"Không còn đủ {lo} ảnh chưa đăng cho nick này (kho ảnh không đủ)."
                del content_by_uid[uid]

    for uid in uids:
        if uid in content_by_uid:
            content = content_by_uid[uid]
            result.assignments.append(
                Assignment(
                    account_uid=uid,
                    content=content,
                    text_key=text_key(content),
                    images=images_by_uid.get(uid, []),
                )
            )
    return result
