"use client";

import React from "react";
import { Download, Search, Trash2 } from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";

export default function MemberTableToolbar({
  currentCategory,
  memberSearch,
  onMemberSearchChange,
  friendFilter,
  onFriendFilterChange,
  friendFilterOptions = [],
  selectedMemberIds,
  onExportGroup,
  onExportSelected,
  onBulkDelete,
}) {
  return (
    <>
      {/* Group Meta Info */}
      <div className="flex flex-wrap justify-between items-center pb-3 border-b border-[#F1F5F9] gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#10B981] shrink-0" />
            <h3 className="text-sm font-bold text-[#0F172A]">
              {currentCategory ? (currentCategory.fullName || currentCategory.name) : "Chưa chọn danh mục"}
            </h3>
          </div>
          <p className="text-xs text-[#64748B]">
            {currentCategory ? (currentCategory.fullMeta || currentCategory.description || "—") : "Vui lòng chọn hoặc thêm danh mục"}
          </p>
        </div>

        <button
          type="button"
          onClick={onExportGroup}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 text-xs font-semibold text-[#1D4ED8] hover:bg-blue-100 transition-colors"
        >
          <Download className="size-3 text-[#1D4ED8]" />
          <span>Xuất nhóm</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2.5 w-full">
        {/* Keyword Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-3.5 absolute left-2.5 top-2 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="Tìm UID, Tên thành viên..."
            value={memberSearch}
            onChange={(e) => onMemberSearchChange(e.target.value)}
            className="w-full h-7 pl-8 pr-3 text-xs text-slate-800 border border-[#E2E8F0] bg-white rounded-lg outline-none focus:border-[#2563EB]"
          />
        </div>

        {/* Friend Count Filter */}
        <div className="w-full sm:w-auto shrink-0 min-w-[170px]">
          <CustomSelect
            value={friendFilter}
            onChange={onFriendFilterChange}
            options={friendFilterOptions}
            size="sm"
            buttonClassName="h-7 text-xs"
          />
        </div>
      </div>

      {/* Tick chọn / Bulk Actions Toolbar - Chỉ hiển thị khi có ít nhất 1 thành viên được tích chọn */}
      {selectedMemberIds.size > 0 && (
        <div className="flex flex-wrap justify-between items-center p-2.5 px-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg gap-2 animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span className="size-5 bg-[#2563EB] text-white rounded flex items-center justify-center font-bold text-[11px]">
              {selectedMemberIds.size}
            </span>
            <span className="font-medium text-xs text-[#1E3A8A]">
              thành viên đang được tick chọn
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExportSelected}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#BFDBFE] rounded text-xs font-semibold text-[#1E40AF] hover:bg-blue-50 transition-colors"
            >
              <Download className="size-3 text-[#2563EB]" />
              <span>Xuất file chọn</span>
            </button>

            <button
              type="button"
              onClick={onBulkDelete}
              className="size-7 flex items-center justify-center text-[#DC2626] hover:bg-red-50 rounded transition-colors"
              title="Xóa các mục đã chọn"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

