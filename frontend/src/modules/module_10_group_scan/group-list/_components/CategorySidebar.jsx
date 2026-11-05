"use client";

import { Folder, RefreshCw, Search, MoreVertical } from "lucide-react";

export default function CategorySidebar({
  categories,
  groups,
  activeCategoryId,
  onSelectCategory,
  categorySearch,
  onCategorySearchChange,
  onRefresh,
  loading = false,
  onOpenAddCatModal,
  menuAnchor,
  onToggleMenu,
}) {
  return (
    <div className="w-full lg:w-[320px] shrink-0 bg-white border border-[#E2E8F0] shadow-sm rounded-xl p-4 flex flex-col justify-between min-h-[640px]">
      <div className="flex flex-col">
        {/* Header of Category Box */}
        <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9]">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-[#2563EB] fill-[#2563EB]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#334155]">
              DANH SÁCH DANH MỤC
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenAddCatModal}
            title="Tạo danh mục mới"
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 font-bold text-sm transition-colors"
          >
            +
          </button>
        </div>

        {/* Stats summary */}
        <div className="py-2.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-[#1E293B]">
            {categories.length} Thư mục ({groups.length} nhóm FB)
          </span>
          <button
            type="button"
            onClick={onRefresh}
            title="Đồng bộ lại từ DB"
            className="text-slate-400 hover:text-blue-600 transition-colors p-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-blue-600" : ""}`} />
          </button>
        </div>

        {/* Filter input */}
        <div className="relative w-full mb-3">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#94A3B8]" />
          <input
            type="text"
            value={categorySearch}
            onChange={(e) => onCategorySearchChange(e.target.value)}
            placeholder="Lọc danh mục thư mục..."
            className="w-full h-[30px] rounded-lg border border-[#E2E8F0] bg-white pl-8 pr-3 text-xs text-[#1E293B] placeholder:text-[#6B7280] focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Folder Item List */}
        <div className="flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-0.5">
          {categories.map((cat) => {
            const isActive = cat.id === activeCategoryId;
            const catGroupCount =
              cat.id === "cat-all"
                ? groups.length
                : groups.filter((g) => {
                    const cname = cat.name;
                    if (cname) {
                      if ((g.category_name || "").toLowerCase() === cname.toLowerCase()) return true;
                      if ((g.keyword || "").toLowerCase() === cname.toLowerCase()) return true;
                    }
                    if (g.categoryId === cat.id) return true;
                    return false;
                  }).length;

            return (
              <div
                key={cat.id}
                onClick={() => onSelectCategory(cat.id)}
                className={`h-16 p-3 rounded-lg flex items-center justify-between cursor-pointer transition-all relative ${
                  isActive
                    ? "bg-[#EFF6FF]/60 border border-[#3B82F6]"
                    : "bg-white border border-[#F1F5F9] hover:border-slate-300"
                }`}
              >
                <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className={`text-sm font-semibold truncate ${
                        isActive ? "text-[#0F172A]" : "text-[#1E293B]"
                      }`}
                    >
                      {cat.name}
                    </span>
                  </div>
                  <span
                    className={`text-xs truncate ${
                      isActive ? "text-[#64748B]" : "text-[#94A3B8]"
                    }`}
                  >
                    {catGroupCount} nhóm FB
                    {cat.sub && cat.sub.includes("•") ? ` • ${cat.sub.split("•")[1].trim()}` : ""}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isActive && (
                    <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
                  )}
                  {cat.id !== "cat-all" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleMenu(e, cat);
                      }}
                      className="p-1 rounded hover:bg-slate-100 text-[#94A3B8] hover:text-slate-600 transition-colors"
                      title="Tùy chọn danh mục"
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

