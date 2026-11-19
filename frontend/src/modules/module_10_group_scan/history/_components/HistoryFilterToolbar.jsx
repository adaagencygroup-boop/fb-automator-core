"use client";

import React, { useState, useRef, useEffect } from "react";
import { Search, Calendar, Download, Trash2, X } from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";

export const FILTER_TYPE_OPTIONS = [
  { value: "ALL", label: "Tất cả loại quét" },
  { value: "GROUP_INFO", label: "Quét thông tin nhóm" },
  { value: "MEMBERS", label: "Quét thành viên nhóm" },
];

export const FILTER_STATUS_OPTIONS = [
  { value: "ALL", label: "Tất cả trạng thái" },
  { value: "SUCCESS", label: "Hoàn thành" },
  { value: "FAILED", label: "Lỗi" },
];

export const FILTER_DATE_RANGE_OPTIONS = [
  { value: "ALL", label: "Thời gian" },
  { value: "TODAY", label: "Hôm nay" },
  { value: "YESTERDAY", label: "Hôm qua" },
  { value: "LAST_7_DAYS", label: "7 ngày qua" },
  { value: "LAST_30_DAYS", label: "30 ngày qua" },
];

function DateRangeSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleOutside);
    }
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const selectedOpt = options.find((o) => o.value === value);
  const label = selectedOpt && selectedOpt.value !== "ALL" ? selectedOpt.label : "Thời gian";

  return (
    <div ref={containerRef} className="relative select-none">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`h-10 px-4 min-w-[140px] flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-700 shadow-xs hover:border-slate-300 transition-all cursor-pointer ${
          open ? "border-blue-500 ring-2 ring-blue-500/10" : ""
        }`}
      >
        <span className={value !== "ALL" ? "text-slate-900 font-semibold" : "text-slate-700"}>
          {label}
        </span>
        <Calendar className="size-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 min-w-[160px] bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-30 animate-in fade-in zoom-in-95 duration-100">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3.5 py-2 text-xs transition-colors flex items-center justify-between cursor-pointer ${
                  isSelected
                    ? "bg-blue-50 font-semibold text-blue-600"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HistoryFilterToolbar({
  searchQuery,
  onSearchQueryChange,
  filterType,
  onFilterTypeChange,
  filterStatus,
  onFilterStatusChange,
  filterDateRange,
  onFilterDateRangeChange,
  onExportExcel,
  selectedCount = 0,
  onBulkDelete,
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-4 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3.5">
      {/* 1. Left Search Input */}
      <div className="relative flex-1 min-w-[220px] max-w-sm">
        <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Tìm theo từ khóa, nhóm, mã phiên..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          className="w-full h-10 pl-10 pr-8 text-xs text-slate-800 bg-[#F8FAFC] border border-slate-200 rounded-xl outline-none focus:bg-white focus:border-blue-500 transition-all placeholder:text-slate-400 font-normal"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchQueryChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* 2. Middle & Right Controls */}
      <div className="flex flex-wrap items-center justify-start xl:justify-end gap-3">
        {/* Dropdown: Tất cả loại quét */}
        <div className="min-w-[175px]">
          <CustomSelect
            value={filterType}
            onChange={onFilterTypeChange}
            options={FILTER_TYPE_OPTIONS}
            size="md"
            buttonClassName="h-10 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-700 px-4 shadow-none hover:border-slate-300"
          />
        </div>

        {/* Dropdown: Tất cả trạng thái */}
        <div className="min-w-[165px]">
          <CustomSelect
            value={filterStatus}
            onChange={onFilterStatusChange}
            options={FILTER_STATUS_OPTIONS}
            size="md"
            buttonClassName="h-10 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-700 px-4 shadow-none hover:border-slate-300"
          />
        </div>

        {/* Dropdown: Thời gian (Calendar Icon) */}
        <DateRangeSelect
          value={filterDateRange}
          onChange={onFilterDateRangeChange}
          options={FILTER_DATE_RANGE_OPTIONS}
        />

        {/* Bulk Delete button (shows when rows selected) */}
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={onBulkDelete}
            className="h-10 px-3.5 inline-flex items-center gap-1.5 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 text-xs font-medium transition-colors cursor-pointer"
          >
            <Trash2 className="size-3.5" />
            <span>Xóa ({selectedCount})</span>
          </button>
        )}

        {/* Nút Xuất báo cáo Excel */}
        <button
          type="button"
          onClick={onExportExcel}
          className="h-10 px-5 inline-flex items-center gap-2 rounded-xl bg-[#00875A] hover:bg-[#007048] text-white text-xs font-semibold shadow-xs transition-colors shrink-0 cursor-pointer"
        >
          <Download className="size-4 stroke-[2.2]" />
          <span>Xuất báo cáo Excel</span>
        </button>
      </div>
    </div>
  );
}
