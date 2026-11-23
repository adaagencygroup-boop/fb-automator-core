"""
seeding_plan.py
Hàm thuần (không DB, không Selenium) dùng chung cho tạo chiến dịch và "Xem trước kế hoạch" của Seeding Bài viết:
- Spintax cho bình luận: "{Hay quá|Tuyệt vời} nha" → nhiều câu khác nhau.
- Chọn nick làm từng loại tương tác trên 1 bài (ưu tiên nick chưa làm hành động đó trên bài).
"""
from __future__ import annotations

import random
import re
from typing import Iterable, List, Sequence, Set, Tuple

MAX_VARIANTS = 1_000_000
_INNER_GROUP = re.compile(r"\{([^{}]*)\}")


# ─────────────────────────────────────────────────────────────
# Spintax
# ─────────────────────────────────────────────────────────────
def spin(text: str, rng: random.Random | None = None) -> str:
    """Thay mọi nhóm {a|b|c} (kể cả lồng nhau, xử lý từ trong ra) bằng 1 lựa chọn ngẫu nhiên."""
    rng = rng or random
    out = text or ""
    for _ in range(200):
        m = _INNER_GROUP.search(out)
        if not m:
            break
        out = out[: m.start()] + rng.choice(m.group(1).split("|")) + out[m.end():]
    return re.sub(r"[ \t]{2,}", " ", out).strip()


def _parse(text: str, i: int = 0, stop: str = "") -> Tuple[int, int]:
    """Đếm số câu khác nhau của đoạn text bắt đầu từ i, dừng ở ký tự trong `stop`. Trả về (số câu, vị trí kết thúc)."""
    total = 1
    while i < len(text) and text[i] not in stop:
        if text[i] == "{":
            options_sum = 0
            i += 1
            while True:
                n, i = _parse(text, i, "|}")
                options_sum += n
                if i >= len(text):          # thiếu "}" → coi như chữ thường
                    break
                if text[i] == "}":
                    i += 1
                    break
                i += 1                      # bỏ qua "|"
            total = min(MAX_VARIANTS, total * max(1, options_sum))
        else:
            i += 1
    return total, i


def count_variants(text: str) -> int:
    """Số câu khác nhau một mẫu spintax tạo ra (tối đa MAX_VARIANTS)."""
    return _parse(text or "")[0] if (text or "").strip() else 0


def unique_comment_texts(templates: Sequence[str], k: int, rng: random.Random | None = None) -> List[str]:
    """k câu bình luận cho 1 bài, không lặp nếu đủ biến thể; thiếu biến thể thì đành lặp lại."""
    rng = rng or random
    pool = [t for t in templates if t and t.strip()]
    if not pool or k <= 0:
        return []
    possible = min(MAX_VARIANTS, sum(count_variants(t) for t in pool))
    chosen: List[str] = []
    seen: Set[str] = set()
    attempts = 0
    while len(chosen) < min(k, possible) and attempts < k * 60 + 200:
        attempts += 1
        s = spin(rng.choice(pool), rng)
        if s and s not in seen:
            seen.add(s)
            chosen.append(s)
    while len(chosen) < k:
        chosen.append(spin(rng.choice(pool), rng))
    rng.shuffle(chosen)
    return chosen


# ─────────────────────────────────────────────────────────────
# Chọn nick cho 1 hành động trên 1 bài
# ─────────────────────────────────────────────────────────────
def pick_action_uids(
    used_uids: Sequence[str],
    done: Iterable[Tuple[str, str]],
    action: str,
    quota: int,
    rng: random.Random | None = None,
) -> Set[str]:
    """`quota` nick làm `action` trên bài này, ưu tiên nick CHƯA làm hành động này trên bài;
    nếu nick nào cũng làm rồi thì đưa cả vào để ghi thất bại "đã … rồi" (như trước)."""
    rng = rng or random
    done_set = {u for (u, a) in done if a == action}
    eligible = [u for u in used_uids if u not in done_set]
    if not eligible:
        return set(used_uids)
    return set(rng.sample(eligible, min(max(0, int(quota)), len(eligible))))
