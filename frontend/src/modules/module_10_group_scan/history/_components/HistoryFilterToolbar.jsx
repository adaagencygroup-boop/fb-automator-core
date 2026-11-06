"use client";

import { Search, RotateCcw, FileSpreadsheet, Trash2, X } from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";

const FILTER_TYPE_OPTIONS = [
  { value: "ALL", label: "Tất cả loại quét" },
  { value: "GROUP_INFO", label: "Quét thông tin nhóm" },
  { value: "MEMBERS", label: "Quét thành viên nhóm" },
  { value: "POSTS", label: "Quét bài viết nhóm" },
];

const FILTER_STATUS_OPTIONS = [
  { value: "ALL", label: "Tất cả trạng thái" },
  { value: "SUCCESS", label: "Hoàn thành" },
  { value: "RUNNING", label: "Đang quét" },
  { value: "PAUSED", label: "Tạm dừng" },
  { value: "FAILED", label: "Thất bại" },
];

const FILTER_DATE_RANGE_OPTIONS = [
  { value: "ALL", label: "Toàn bộ thời gian" },
  { value: "TODAY", label: "Hôm nay" },
];

export default function HistoryFilterToolbar({
  searchQuery,
  onSearchQueryChange,
  filterType,
  onFilterTypeChange,
  filterStatus,
  onFilterStatusChange,
  filterDateRange,
  onFilterDateRangeChange,
  onRefresh,
  loading = false,
  onExportExcel,
  selectedCount = 0,
  onBulkDelete,
}) {
  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-xs p-4 space-y-3.5">
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 max-w-lg">
          <Search className="size-4 absolute left-3 top-2.5 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="Tìm theo mã phiên (#SCN), từ khóa, nhóm, UID tài khoản..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-xs text-[#0F172A] border border-[#E2E8F0] bg-[#F8FAFC] rounded-lg outline-none focus:border-[#2563EB] focus:bg-white transition-all placeholder:text-[#94A3B8]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQueryChange("")}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Quick Filters Group */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Loại quét */}
          <div className="min-w-[170px]">
            <CustomSelect
              value={filterType}
              onChange={onFilterTypeChange}
              options={FILTER_TYPE_OPTIONS}
              size="md"
            />
          </div>

          {/* Trạng thái */}
          <div className="min-w-[160px]">
            <CustomSelect
              value={filterStatus}
              onChange={onFilterStatusChange}
              options={FILTER_STATUS_OPTIONS}
              size="md"
            />
          </div>

          {/* Thời gian */}
          <div className="min-w-[160px]">
            <CustomSelect
              value={filterDateRange}
              onChange={onFilterDateRangeChange}
              options={FILTER_DATE_RANGE_OPTIONS}
              size="md"
            />
          </div>

          {/* Action Buttons */}
          <button
            type="button"
            onClick={onRefresh}
            title="Làm mới dữ liệu từ Database"
            className="size-9 flex items-center justify-center rounded-lg border border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50 transition-colors"
          >
            <RotateCcw className={`size-4 ${loading ? "animate-spin text-blue-600" : ""}`} />
          </button>

          {/* Nút Xuất Excel */}
          <button
            type="button"
            onClick={onExportExcel}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <FileSpreadsheet className="size-3.5" />
            <span>Xuất Excel</span>
          </button>

          {/* Nút Xóa nhiều */}
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={onBulkDelete}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 text-xs font-semibold transition-colors"
            >
              <Trash2 className="size-3.5" />
              <span>Xóa ({selectedCount})</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

