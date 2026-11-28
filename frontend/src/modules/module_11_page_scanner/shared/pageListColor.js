import { CATEGORY_COLORS } from "@/modules/module_10_group_scan/member-list/_components/CreateCategoryModal";

/**
 * Màu hiển thị của danh mục page đã lưu.
 * Danh mục tạo trước khi có cột màu (color = null) → màu cố định trong bảng màu theo id,
 * để mọi màn (DS page, modal chọn page, modal lưu) hiển thị cùng một màu.
 */
export function pageListColor(list) {
  if (list?.color) return list.color;
  const id = Number(list?.id) || 0;
  return CATEGORY_COLORS[Math.abs(id) % CATEGORY_COLORS.length];
}
