import { findNavItem } from "@/config/navigation";

// Tiêu đề trang Module 10 (theo Figma): tên trang + mô tả ngắn, lấy từ cấu hình menu
// để tên trên menu, tab trình duyệt và tiêu đề trang luôn khớp nhau.
export default function ModulePageHeader({ navId, title, description, action }) {
  const { item } = findNavItem(navId);
  const heading = title || item.title || item.label;
  const desc = description ?? item.description;

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-heading text-xl font-bold text-[#0F172A]">{heading}</h1>
        {desc && <p className="mt-1 text-xs text-[#64748B]">{desc}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
