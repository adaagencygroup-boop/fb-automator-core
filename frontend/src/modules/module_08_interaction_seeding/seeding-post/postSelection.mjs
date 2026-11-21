/**
 * Chọn bài trong danh sách "Lấy bài viết từ page / trang cá nhân".
 * Danh sách có thể rất dài (phân trang phía server) nên không giữ id của mọi bài:
 *   - mode "ids": các bài được tích (ids)
 *   - mode "all": MỌI bài khớp bộ lọc hiện tại, trừ các bài bỏ tích (exclude)
 * Đổi bộ lọc / tìm kiếm thì xoá lựa chọn (mode "all" gắn với bộ lọc lúc chọn).
 * Hàm thuần (không React) để test bằng `node --test`.
 */

export function emptySelection() {
  return { mode: "ids", ids: [], exclude: [] };
}

export function selectAllMatching() {
  return { mode: "all", ids: [], exclude: [] };
}

export function selectIds(ids) {
  return { mode: "ids", ids: [...new Set(ids)], exclude: [] };
}

export function isSelected(sel, id) {
  return sel.mode === "all" ? !sel.exclude.includes(id) : sel.ids.includes(id);
}

export function toggleOne(sel, id) {
  if (sel.mode === "all") {
    const exclude = sel.exclude.includes(id) ? sel.exclude.filter((x) => x !== id) : [...sel.exclude, id];
    return { ...sel, exclude };
  }
  const ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
  return { ...sel, ids };
}

/** Tích / bỏ tích cả trang đang xem. */
export function setPageSelected(sel, pageIds, checked) {
  if (sel.mode === "all") {
    const exclude = checked
      ? sel.exclude.filter((x) => !pageIds.includes(x))
      : [...new Set([...sel.exclude, ...pageIds])];
    return { ...sel, exclude };
  }
  const ids = checked ? [...new Set([...sel.ids, ...pageIds])] : sel.ids.filter((x) => !pageIds.includes(x));
  return { ...sel, ids };
}

/** "all" | "some" | "none" — trạng thái checkbox "chọn cả trang". */
export function pageState(sel, pageIds) {
  if (!pageIds.length) return "none";
  const n = pageIds.filter((id) => isSelected(sel, id)).length;
  return n === 0 ? "none" : n === pageIds.length ? "all" : "some";
}

/** Số bài đang chọn. total = số bài khớp bộ lọc. */
export function selectedCount(sel, total) {
  if (sel.mode === "all") return Math.max(0, (Number(total) || 0) - sel.exclude.length);
  return sel.ids.length;
}

/** Payload cho POST /api/seeding/post-fetch/posts/add-to-targets. */
export function toAddPayload(sel, { sourceKey, q = "", type = "all" }) {
  if (sel.mode === "all") {
    return { source_key: sourceKey, mode: "all", exclude_ids: sel.exclude, q: q || null, type };
  }
  return { source_key: sourceKey, mode: "ids", ids: sel.ids };
}
