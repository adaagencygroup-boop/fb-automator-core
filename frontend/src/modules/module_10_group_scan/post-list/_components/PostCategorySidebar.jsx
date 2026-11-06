"use client";

import { Folder, Plus, Search, MoreVertical } from "lucide-react";
import { toast } from "@/lib/toast";

export default function PostCategorySidebar({
  groups,
  selectedGroupId,
  onSelectGroup,
  groupSearch,
  onGroupSearchChange,
  onOpenAddGroupModal,
  totalPostsCount = 0,
}) {
  return (
    <section className="w-full lg:w-[280px] shrink-0 bg-white border border-[#E2E8F0] shadow-[0_1px_2px_rgba(15,23,42,0.04)] rounded-xl flex flex-col overflow-hidden">
      {/* Panel Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC]/50 border-b border-[#F1F5F9]">
        <div className="flex items-center gap-2">
          <Folder className="size-4 text-[#2563EB] fill-[#2563EB]" />
          <span className="text-xs font-bold uppercase tracking-wide text-[#1E293B]">
            DANH SÁCH NHÓM
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenAddGroupModal}
          className="size-7 flex items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB] font-bold text-sm hover:bg-blue-100 transition-colors"
          title="Thêm nhóm mới"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {/* Counter info & Search */}
      <div className="px-4 py-3 border-b border-[#F1F5F9] flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-[#1E293B]">
            Đã quét {groups.length} nhóm
          </span>
          <span className="text-[11px] text-[#94A3B8]">
            {totalPostsCount} bài viết
          </span>
        </div>

        <div className="relative w-full">
          <Search className="size-3.5 absolute left-2.5 top-2 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="Lọc danh mục thư mục..."
            value={groupSearch}
            onChange={(e) => onGroupSearchChange(e.target.value)}
            className="w-full h-7 pl-8 pr-2.5 text-xs text-slate-800 border border-[#E2E8F0] bg-[#F8FAFC] rounded-lg outline-none focus:border-[#2563EB]"
          />
        </div>
      </div>

      {/* Group Items List */}
      <div className="p-2.5 flex flex-col gap-1.5 max-h-[500px] overflow-y-auto">
        {groups.length === 0 ? (
          <div className="text-center py-8 text-xs text-[#94A3B8]">
            Chưa có nhóm nào trong cơ sở dữ liệu.
          </div>
        ) : (
          groups.map((grp) => {
            const isActive = grp.id === selectedGroupId;
            return (
              <div
                key={grp.id}
                onClick={() => onSelectGroup(grp.id)}
                className={`p-2.5 rounded-lg flex items-center justify-between cursor-pointer transition-all ${
                  isActive
                    ? "bg-[#EFF6FF]/60 border border-[#3B82F6] shadow-xs"
                    : "bg-white border border-transparent hover:border-slate-200"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-1">
                  <span
                    className={`size-2 rounded-full shrink-0 ${
                      isActive ? "bg-[#2563EB]" : "bg-[#CBD5E1]"
                    }`}
                  />
                  <div className="flex flex-col min-w-0">
                    <span
                      className={`text-xs truncate ${
                        isActive ? "font-bold text-[#0F172A]" : "font-semibold text-[#1E293B]"
                      }`}
                    >
                      {grp.name}
                    </span>
                    <span className="text-[11px] text-[#64748B] truncate">
                      {grp.postCount} bài viết • {grp.category}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toast.info(`Tùy chọn cho nhóm: ${grp.name}`);
                  }}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded"
                >
                  <MoreVertical className="size-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

