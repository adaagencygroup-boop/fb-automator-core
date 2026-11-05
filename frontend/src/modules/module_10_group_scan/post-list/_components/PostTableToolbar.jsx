"use client";

import { Search, Trash2, FileSpreadsheet, FolderInput } from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";

const DATE_FILTER_OPTIONS = [
  { value: "all", label: "Ngày đăng: Tất cả" },
  { value: "today", label: "Hôm nay" },
  { value: "7days", label: "7 ngày qua" },
  { value: "30days", label: "30 ngày qua" },
];

const LIKE_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả like" },
  { value: "100", label: "> 100 like" },
  { value: "500", label: "> 500 like" },
  { value: "1000", label: "> 1,000 like" },
];

const SHARE_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả share" },
  { value: "10", label: "> 10 share" },
  { value: "50", label: "> 50 share" },
  { value: "100", label: "> 100 share" },
];

const COMMENT_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả comment" },
  { value: "20", label: "> 20 cmt" },
  { value: "100", label: "> 100 cmt" },
  { value: "500", label: "> 500 cmt" },
];

export default function PostTableToolbar({
  activeGroup,
  onExportExcel,
  postSearch,
  onPostSearchChange,
  dateFilter,
  onDateFilterChange,
  likeFilter,
  onLikeFilterChange,
  shareFilter,
  onShareFilterChange,
  commentFilter,
  onCommentFilterChange,
  selectedCount = 0,
  totalFilteredCount = 0,
  onMoveCategory,
  onBulkDelete,
}) {
  return (
    <div className="space-y-4">
      {/* Group Header Info */}
      <div className="flex flex-wrap justify-between items-center pb-3 border-b border-[#F1F5F9] gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-[#0F172A]">
              {activeGroup ? activeGroup.name : "Chưa chọn nhóm"}
            </h3>
            {activeGroup && (
              <span className="rounded-full bg-[#ECFDF5] border border-[#D1FAE5] px-2.5 py-0.5 text-[11px] font-semibold text-[#059669]">
                {activeGroup.statusLabel}
              </span>
            )}
          </div>
          <p className="text-xs text-[#64748B]">
            {activeGroup
              ? `${activeGroup.postCount} Bài viết • Danh mục: ${activeGroup.category} • ${activeGroup.updateTime}`
              : "Vui lòng chọn hoặc quét nhóm"}
          </p>
        </div>

        <button
          type="button"
          onClick={onExportExcel}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 text-xs font-semibold text-[#334155] hover:bg-slate-50 transition-colors shadow-xs"
        >
          <FileSpreadsheet className="size-3.5 text-[#059669]" />
          <span>Xuất Excel</span>
        </button>
      </div>

      {/* Filter Bar Row */}
      <div className="flex flex-wrap items-center gap-2.5 w-full">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="size-3.5 absolute left-3 top-2 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="Tìm theo tên bài viết, từ khóa, UID..."
            value={postSearch}
            onChange={(e) => onPostSearchChange(e.target.value)}
            className="w-full h-7 pl-8 pr-3 text-xs text-slate-800 border border-[#E2E8F0] rounded-lg outline-none focus:border-[#2563EB]"
          />
        </div>

        <div className="w-32 shrink-0">
          <CustomSelect
            value={dateFilter}
            onChange={onDateFilterChange}
            options={DATE_FILTER_OPTIONS}
            size="sm"
            buttonClassName="h-7 text-xs"
          />
        </div>

        <div className="w-32 shrink-0">
          <CustomSelect
            value={likeFilter}
            onChange={onLikeFilterChange}
            options={LIKE_FILTER_OPTIONS}
            size="sm"
            buttonClassName="h-7 text-xs"
          />
        </div>

        <div className="w-32 shrink-0">
          <CustomSelect
            value={shareFilter}
            onChange={onShareFilterChange}
            options={SHARE_FILTER_OPTIONS}
            size="sm"
            buttonClassName="h-7 text-xs"
          />
        </div>

        <div className="w-36 shrink-0">
          <CustomSelect
            value={commentFilter}
            onChange={onCommentFilterChange}
            options={COMMENT_FILTER_OPTIONS}
            size="sm"
            buttonClassName="h-7 text-xs"
          />
        </div>
      </div>

      {/* Action Toolbar Bar - Chỉ hiển thị khi có ít nhất 1 bài viết được tích chọn */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap justify-between items-center p-2.5 px-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg gap-2 animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span className="size-5 bg-[#2563EB] text-white rounded flex items-center justify-center font-bold text-[11px]">
              {selectedCount}
            </span>
            <span className="font-medium text-xs text-[#1E3A8A]">
              Đã chọn {selectedCount} / {totalFilteredCount} bài viết
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onMoveCategory}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-[#CBD5E1] rounded text-xs font-medium text-[#334155] hover:bg-slate-50 transition-colors"
            >
              <FolderInput className="size-3.5 text-[#64748B]" />
              <span>Chuyển mục</span>
            </button>

            <button
              type="button"
              onClick={onBulkDelete}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-rose-200 text-rose-600 rounded text-xs font-medium hover:bg-rose-50 transition-colors"
            >
              <Trash2 className="size-3.5" />
              <span>Xóa ({selectedCount})</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

