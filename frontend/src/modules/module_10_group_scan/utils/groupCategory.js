// Danh sách nhóm quét: nhóm thuộc thư mục nào. Dùng chung cho bảng nhóm và số đếm ở cột thư mục.
// Engine trả `category_keys` = mọi thư mục chứa nhóm (đã lưu / chuyển vào + thư mục trùng từ khóa quét),
// chữ thường. 1 nhóm có thể nằm ở nhiều thư mục.

/** Tên thư mục so khớp không phân biệt hoa/thường, gộp khoảng trắng (giống Engine). */
export function categoryKey(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function groupInCategory(group, category) {
  if (!category || category.id === "cat-all") return true;
  const key = categoryKey(category.name);
  if (Array.isArray(group?.category_keys)) return Boolean(key) && group.category_keys.includes(key);
  // Engine cũ chưa trả category_keys
  if (key && (categoryKey(group?.category_name) === key || categoryKey(group?.keyword) === key)) return true;
  return group?.categoryId === category.id;
}

// ---------------------------------------------------------------------------
// Tìm kiếm & lọc số thành viên (Danh sách nhóm quét)
// ---------------------------------------------------------------------------

/** Bỏ dấu tiếng Việt + chữ thường: gõ "phu tho" vẫn tìm ra "Phú Thọ". */
export function foldText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Số thành viên của nhóm; thiếu số thì đọc từ nhãn ("12.5K", "1,2 N thành viên", "319 thành viên"). */
export function groupMembersCount(group) {
  const n = Number(group?.membersCount ?? group?.members_count);
  if (Number.isFinite(n) && n > 0) return n;
  const label = String(group?.members || group?.members_label || "").toLowerCase();
  const m = label.match(/([\d.,]+)\s*(k|n|nghìn|ngàn|m|tr|triệu)?/);
  if (!m) return 0;
  const unit = m[2];
  if (unit) {
    const v = parseFloat(m[1].replace(",", "."));
    if (!Number.isFinite(v)) return 0;
    return Math.round(v * (["m", "tr", "triệu"].includes(unit) ? 1_000_000 : 1000));
  }
  return Number(m[1].replace(/[.,]/g, "")) || 0;
}

export const MEMBERS_FILTER_OPTIONS = [
  { value: "all", label: "Thành viên: Tất cả" },
  { value: "under1k", label: "Dưới 1.000" },
  { value: "1k_10k", label: "1.000 - 10.000" },
  { value: "10k_50k", label: "10.000 - 50.000" },
  { value: "50k_200k", label: "50.000 - 200.000" },
  { value: "over200k", label: "Trên 200.000" },
];

const MEMBER_RANGES = {
  under1k: [0, 1000],
  "1k_10k": [1000, 10000],
  "10k_50k": [10000, 50000],
  under50k: [0, 50000], // giá trị cũ còn trong nháp
  "50k_200k": [50000, 200000],
  over200k: [200000, Infinity],
};

/** Khoảng [min, max): 1.000 thuộc "1.000 - 10.000", 50.000 thuộc "50.000 - 200.000". */
export function matchesMembersFilter(group, filter) {
  const range = MEMBER_RANGES[filter];
  if (!range) return true;
  const count = groupMembersCount(group);
  return count >= range[0] && count < range[1];
}

/** Ô tìm kiếm: khớp tên nhóm, UID, từ khóa, thư mục, URL — không phân biệt dấu & hoa/thường. */
export function matchesGroupSearch(group, query) {
  const q = foldText(query);
  if (!q) return true;
  const hay = foldText(
    [group?.name, group?.group_id, group?.keyword, group?.category_name, group?.url, group?.members].join(" | "),
  );
  return q.split(" ").every((word) => hay.includes(word));
}
