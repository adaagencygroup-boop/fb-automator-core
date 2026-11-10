"use client";

import React, { useState, useMemo } from "react";
import { Search, Filter, RotateCcw, AlertCircle } from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";

const typeOptions = [
  { value: "ALL", label: "Tất cả" },
  { value: "PAGE", label: "Page" },
  { value: "PROFILE", label: "Trang cá nhân" },
  { value: "POST", label: "Bài viết" },
];

const statusOptions = [
  { value: "ALL", label: "Tất cả" },
  { value: "COMPLETED", label: "Hoàn thành" },
  { value: "FAILED", label: "Không hoàn thành" },
];

const timePresetOptions = [
  { value: "CUSTOM", label: "Tùy chọn" },
  { value: "TODAY", label: "Hôm nay" },
  { value: "LAST_7_DAYS", label: "7 ngày qua" },
  { value: "LAST_30_DAYS", label: "30 ngày qua" },
  { value: "THIS_MONTH", label: "Tháng này" },
];

export default function HistoryFilters({
  searchTerm,
  onSearchTermChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  fromDate,
  onFromDateChange,
  toDate,
  onToDateChange,
  onReset,
  onApply,
  appliedSummary,
}) {
  const [timePreset, setTimePreset] = useState("CUSTOM");

  const formatDate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const handlePresetChange = (val) => {
    setTimePreset(val);
    const now = new Date();

    if (val === "TODAY") {
      const todayStr = formatDate(now);
      onFromDateChange(todayStr);
      onToDateChange(todayStr);
    } else if (val === "LAST_7_DAYS") {
      const past = new Date();
      past.setDate(past.getDate() - 7);
      onFromDateChange(formatDate(past));
      onToDateChange(formatDate(now));
    } else if (val === "LAST_30_DAYS") {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      onFromDateChange(formatDate(past));
      onToDateChange(formatDate(now));
    } else if (val === "THIS_MONTH") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      onFromDateChange(formatDate(firstDay));
      onToDateChange(formatDate(now));
    }
  };

  const todayStr = useMemo(() => formatDate(new Date()), []);

  const dateErrorMessage = useMemo(() => {
    if (fromDate && fromDate > todayStr) {
      return "Khoảng thời gian không hợp lệ: 'Từ ngày' không thể chọn ngày trong tương lai.";
    }
    if (toDate && toDate > todayStr) {
      return "Khoảng thời gian không hợp lệ: 'Đến ngày' không thể chọn ngày trong tương lai.";
    }
    if (fromDate && toDate && fromDate > toDate) {
      return "Khoảng thời gian không hợp lệ: 'Từ ngày' không được lớn hơn 'Đến ngày'.";
    }
    return "";
  }, [fromDate, toDate, todayStr]);

  const getFilterSummary = () => {
    const parts = [];
    if (typeFilter !== "ALL") {
      parts.push(typeFilter === "PAGE" ? "Page" : typeFilter === "PROFILE" ? "Trang cá nhân" : "Bài viết");
    }
    if (statusFilter !== "ALL") {
      parts.push(
        statusFilter === "COMPLETED"
          ? "Hoàn thành"
          : statusFilter === "FAILED"
          ? "Thất bại"
          : statusFilter === "RUNNING"
          ? "Đang chạy"
          : statusFilter
      );
    }
    if (searchTerm.trim()) {
      parts.push(`"${searchTerm.trim()}"`);
    }
    return parts.length > 0 ? parts.join(", ") : "Tất cả";
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-4">
      {/* Filter Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Search className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="text-base font-bold text-slate-900">Bộ lọc tìm kiếm</h3>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-50 border border-slate-200/80 text-xs text-slate-600">
          <span className="w-2 h-2 rounded-full bg-blue-600 inline-block shrink-0"></span>
          <span>
            Đang lọc theo: <span className="font-semibold text-slate-800">{appliedSummary || getFilterSummary()}</span>
          </span>
        </div>
      </div>

      {/* Row 1: Tìm kiếm (50%), Loại Seeding (25%), Trạng thái (25%) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Search Input */}
        <div className="md:col-span-6 space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
            TÌM KIẾM
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => onSearchTermChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onApply();
                }
              }}
              placeholder="Tìm kiếm mục tiêu, link..."
              className="w-full h-10 pl-10 pr-3 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
            />
          </div>
        </div>

        {/* Campaign Type Filter */}
        <div className="md:col-span-3 space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
            LOẠI SEEDING
          </label>
          <CustomSelect
            value={typeFilter}
            onChange={onTypeFilterChange}
            options={typeOptions}
            className="w-full"
            buttonClassName="h-10 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-800"
            dropdownClassName="rounded-xl border-slate-200 shadow-lg"
          />
        </div>

        {/* Status Filter */}
        <div className="md:col-span-3 space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
            TRẠNG THÁI
          </label>
          <CustomSelect
            value={statusFilter}
            onChange={onStatusFilterChange}
            options={statusOptions}
            className="w-full"
            buttonClassName="h-10 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-800"
            dropdownClassName="rounded-xl border-slate-200 shadow-lg"
          />
        </div>
      </div>

      {/* Row 2: Thời gian (25%), Từ ngày (25%), Đến ngày (25%), Đặt lại + Lọc (25%) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-4 items-end">
        <div className="md:col-span-3 space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
            THỜI GIAN
          </label>
          <CustomSelect
            value={timePreset}
            onChange={handlePresetChange}
            options={timePresetOptions}
            className="w-full"
            buttonClassName="h-10 rounded-xl border-slate-200 bg-white text-xs font-medium text-slate-800"
            dropdownClassName="rounded-xl border-slate-200 shadow-lg"
          />
        </div>

        <div className="md:col-span-3 space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
            TỪ NGÀY
          </label>
          <div className="relative">
            <input
              type="date"
              value={fromDate}
              max={toDate && toDate < todayStr ? toDate : todayStr}
              onChange={(e) => {
                setTimePreset("CUSTOM");
                let val = e.target.value;
                if (val && val > todayStr) val = todayStr;
                onFromDateChange(val);
                if (toDate && val && val > toDate) {
                  onToDateChange(val);
                }
              }}
              className={`w-full h-10 px-3.5 text-xs rounded-xl border bg-white font-medium cursor-pointer transition-all ${
                dateErrorMessage
                  ? "border-rose-400 bg-rose-50/20 text-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                  : "border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              }`}
            />
          </div>
        </div>

        <div className="md:col-span-3 space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
            ĐẾN NGÀY
          </label>
          <div className="relative">
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              max={todayStr}
              onChange={(e) => {
                setTimePreset("CUSTOM");
                let val = e.target.value;
                if (val && val > todayStr) val = todayStr;
                onToDateChange(val);
                if (fromDate && val && fromDate > val) {
                  onFromDateChange(val);
                }
              }}
              className={`w-full h-10 px-3.5 text-xs rounded-xl border bg-white font-medium cursor-pointer transition-all ${
                dateErrorMessage
                  ? "border-rose-400 bg-rose-50/20 text-rose-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                  : "border-slate-200 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              }`}
            />
          </div>
        </div>

        <div className="md:col-span-3 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setTimePreset("CUSTOM");
              onReset();
            }}
            className="h-10 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            Đặt lại
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={Boolean(dateErrorMessage)}
            className={`h-10 px-7 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm flex-1 sm:flex-initial ${
              dateErrorMessage
                ? "bg-slate-200 text-slate-400 border border-slate-300/80 cursor-not-allowed select-none shadow-none"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20 cursor-pointer"
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Lọc
          </button>
        </div>
      </div>

      {/* Cảnh báo khoảng ngày không hợp lệ */}
      {dateErrorMessage && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold animate-in fade-in slide-in-from-top-1 shadow-sm">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{dateErrorMessage}</span>
        </div>
      )}
    </div>
  );
}
