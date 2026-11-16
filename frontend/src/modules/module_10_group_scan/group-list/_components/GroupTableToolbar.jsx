"use client";

import { useEffect, useRef, useState } from "react";
import {
  RefreshCw,
  Pencil,
  Search,
  FolderInput,
  Trash2,
  Loader2,
  Download,
  ChevronDown,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "Loại nhóm: Tất cả" },
  { value: "public", label: "Công khai" },
  { value: "private", label: "Riêng tư" },
];

const MEMBERS_FILTER_OPTIONS = [
  { value: "all", label: "Thành viên: Tất cả" },
  { value: "under50k", label: "Dưới 50.000" },
  { value: "50k_200k", label: "50.000 - 200.000" },
  { value: "over200k", label: "Trên 200.000" },
];

const NOTE_FILTER_OPTIONS = [
  { value: "all", label: "Ghi chú: Tất cả" },
  { value: "joined", label: "Đã tham gia" },
  { value: "pending", label: "Đang chờ QTV duyệt" },
  { value: "not_joined", label: "Chưa vào nhóm" },
  { value: "none", label: "Chưa có ghi chú" },
];

export default function GroupTableToolbar({
  activeCategory,
  loading = false,
  onRefresh,
  onOpenEditModal,
  tableSearch,
  onTableSearchChange,
  typeFilter,
  onTypeFilterChange,
  membersFilter,
  onMembersFilterChange,
  noteFilter,
  onNoteFilterChange,
  selectedCount = 0,
  totalFilteredCount = 0,
  onToggleSelectAll,
  onOpenMoveModal,
  onDeleteSelected,
  onExport,
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setExportOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="space-y-4">
      {/* Detail Title & Action */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold tracking-tight text-[#0F172A]">
            {activeCategory.name}
          </h2>
          {loading && (
            <span className="flex items-center gap-1 text-xs text-blue-600">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Menu Xuất file (UC-GIS-08) */}
          <div className="relative" ref={exportRef}>
            <button
              type="button"
              onClick={() => setExportOpen(!exportOpen)}
              className="h-[30px] px-3 bg-white border border-[#CBD5E1] shadow-sm rounded-lg text-xs font-medium text-[#334155] flex items-center gap-1.5 hover:bg-slate-50 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-[#64748B]" />
              <span>Xuất file {selectedCount > 0 ? `(${selectedCount})` : ""}</span>
              <ChevronDown className="w-3 h-3 text-[#94A3B8]" />
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-8 z-30 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg animate-in fade-in duration-150">
                <button
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    onExport?.("xlsx");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-800">Xuất Excel (.xlsx)</p>
                    <p className="text-[10px] text-slate-400">Khuyến nghị, chuẩn format</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    onExport?.("csv");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                  <div>
                    <p className="font-semibold text-slate-800">Xuất CSV (.csv)</p>
                    <p className="text-[10px] text-slate-400">UTF-8 with BOM</p>
                  </div>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            title="Tải lại từ DB"
            className="h-[30px] px-3 bg-white border border-[#CBD5E1] shadow-sm rounded-lg text-xs font-medium text-[#334155] flex items-center gap-1.5 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className="w-3 h-3 text-[#64748B]" />
            <span>Làm mới</span>
          </button>
          {activeCategory.id !== "cat-all" && (
            <button
              type="button"
              onClick={onOpenEditModal}
              className="h-[30px] px-3.5 py-1.5 bg-white border border-[#CBD5E1] shadow-sm rounded-lg text-xs font-medium text-[#334155] flex items-center gap-1.5 hover:bg-slate-50 transition-colors"
            >
              <Pencil className="w-3 h-3 text-[#64748B]" />
              <span>Sửa danh mục</span>
            </button>
          )}
        </div>
      </div>

      {/* Search & Filters Toolbar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1 w-full">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#94A3B8]" />
          <input
            type="text"
            value={tableSearch}
            onChange={(e) => onTableSearchChange(e.target.value)}
            placeholder="Tìm theo tên nhóm, UID, từ khóa hoặc URL..."
            className="w-full h-[34px] rounded-lg border border-[#E2E8F0] bg-white pl-8 pr-3 text-xs text-[#1E293B] placeholder:text-[#6B7280] focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Filter: Loại nhóm */}
        <div className="w-full sm:w-auto shrink-0 min-w-[140px]">
          <CustomSelect
            value={typeFilter}
            onChange={onTypeFilterChange}
            options={TYPE_FILTER_OPTIONS}
            size="sm"
            buttonClassName="h-[34px]"
          />
        </div>

        {/* Filter: Thành viên */}
        <div className="w-full sm:w-auto shrink-0 min-w-[150px]">
          <CustomSelect
            value={membersFilter}
            onChange={onMembersFilterChange}
            options={MEMBERS_FILTER_OPTIONS}
            size="sm"
            buttonClassName="h-[34px]"
          />
        </div>

        {/* Filter: Ghi chú */}
        <div className="w-full sm:w-auto shrink-0 min-w-[150px]">
          <CustomSelect
            value={noteFilter}
            onChange={onNoteFilterChange}
            options={NOTE_FILTER_OPTIONS}
            size="sm"
            buttonClassName="h-[34px]"
          />
        </div>
      </div>

      {/* Batch Action Bar - Chỉ hiển thị khi có ít nhất 1 nhóm được tích chọn */}
      {selectedCount > 0 && (
        <div className="h-11 px-4 rounded-lg bg-[#EFF6FF]/70 border border-[#BFDBFE] flex items-center justify-between animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedCount > 0}
              onChange={onToggleSelectAll}
              className="w-4 h-4 rounded border-blue-500 text-blue-600 focus:ring-blue-500 cursor-pointer accent-[#2563EB]"
            />
            <span className="text-xs font-semibold text-[#1E3A8A]">
              Đã chọn {selectedCount} / {totalFilteredCount} nhóm
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenMoveModal}
              className="h-[28px] px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs font-medium text-[#334155] flex items-center gap-1.5 hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <FolderInput className="w-3.5 h-3.5 text-[#64748B]" />
              <span>Chuyển mục</span>
            </button>

            <button
              type="button"
              onClick={onDeleteSelected}
              className="h-[28px] px-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] text-xs font-medium text-[#93000A] flex items-center gap-1 hover:bg-red-100 transition-colors shadow-2xs"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#93000A]" />
              <span>Xóa</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
