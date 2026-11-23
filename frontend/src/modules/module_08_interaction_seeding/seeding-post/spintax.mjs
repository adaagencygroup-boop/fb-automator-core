/**
 * Spintax cho bình luận: "{Hay quá|Tuyệt vời} {ạ|nha}" → 4 câu khác nhau.
 * Cùng cách đếm với backend (modules/module_08_interaction_seeding/seeding_plan.py: count_variants).
 */
export const MAX_VARIANTS = 1_000_000;

function parse(text, start, stop) {
  let total = 1;
  let i = start;
  while (i < text.length && !stop.includes(text[i])) {
    if (text[i] === "{") {
      let optionsSum = 0;
      i += 1;
      for (;;) {
        const [n, next] = parse(text, i, "|}");
        optionsSum += n;
        i = next;
        if (i >= text.length) break; // thiếu "}" → coi như chữ thường
        if (text[i] === "}") {
          i += 1;
          break;
        }
        i += 1; // bỏ qua "|"
      }
      total = Math.min(MAX_VARIANTS, total * Math.max(1, optionsSum));
    } else {
      i += 1;
    }
  }
  return [total, i];
}

/** Số câu khác nhau 1 mẫu tạo ra (câu thường = 1, trống = 0). */
export function countVariants(text) {
  const t = String(text || "");
  return t.trim() ? parse(t, 0, "")[0] : 0;
}

/** Tổng số câu khác nhau của cả danh sách mẫu. */
export function totalVariants(templates) {
  return Math.min(MAX_VARIANTS, (templates || []).reduce((s, t) => s + countVariants(t), 0));
}

/** Có dùng spintax không (có nhóm {…|…}). */
export function hasSpintax(text) {
  return /\{[^{}]*\|[^{}]*\}/.test(String(text || ""));
}
