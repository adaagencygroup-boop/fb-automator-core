"use client";

import React, { useState } from "react";
import { Search, Filter, RotateCcw, ChevronDown } from "lucide-react";

interface HistoryFiltersProps {
  searchTerm: string;
  onSearchTermChange: (val: string) => void;
  typeFilter: string;
  onTypeFilterChange: (val: string) => void;
  statusFilter: string;
  onStatusFilterChange: (val: string) => void;
  fromDate: string;
  onFromDateChange: (val: string) => void;
  toDate: string;
  onToDateChange: (val: string) => void;
  onReset: () => void;
  onApply: () => void;
  appliedSummary?: string;
}

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
}: HistoryFiltersProps) {
  const [timePreset, setTimePreset] = useState("CUSTOM");

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setTimePreset(val);
    const now = new Date();
    const formatDate = (d: Date) => d.toISOString().split("T")[0];

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

  const getFilterSummary = () => {
    const parts: string[] = [];
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
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => onTypeFilterChange(e.target.value)}
              className="w-full h-10 px-3.5 pr-8 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none font-medium cursor-pointer"
            >
              <option value="ALL">Tất cả</option>
              <option value="PAGE">Page</option>
              <option value="PROFILE">Trang cá nhân</option>
              <option value="POST">Bài viết</option>
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Status Filter */}
        <div className="md:col-span-3 space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
            TRẠNG THÁI
          </label>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className="w-full h-10 px-3.5 pr-8 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none font-medium cursor-pointer"
            >
              <option value="ALL">Tất cả</option>
              <option value="COMPLETED">Hoàn thành</option>
              <option value="FAILED">Không hoàn thành</option>
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Row 2: Thời gian (25%), Từ ngày (25%), Đến ngày (25%), Đặt lại + Lọc (25%) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-4 items-end">
        <div className="md:col-span-3 space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
            THỜI GIAN
          </label>
          <div className="relative">
            <select
              value={timePreset}
              onChange={handlePresetChange}
              className="w-full h-10 px-3.5 pr-8 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none font-medium cursor-pointer"
            >
              <option value="CUSTOM">Tùy chọn</option>
              <option value="TODAY">Hôm nay</option>
              <option value="LAST_7_DAYS">7 ngày qua</option>
              <option value="LAST_30_DAYS">30 ngày qua</option>
              <option value="THIS_MONTH">Tháng này</option>
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        <div className="md:col-span-3 space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
            TỪ NGÀY
          </label>
          <div className="relative">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setTimePreset("CUSTOM");
                onFromDateChange(e.target.value);
              }}
              className="w-full h-10 px-3.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium cursor-pointer"
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
              onChange={(e) => {
                setTimePreset("CUSTOM");
                onToDateChange(e.target.value);
              }}
              className="w-full h-10 px-3.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium cursor-pointer"
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
            className="h-10 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            Đặt lại
          </button>
          <button
            type="button"
            onClick={onApply}
            className="h-10 px-7 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm shadow-blue-500/20 flex-1 sm:flex-initial"
          >
            <Filter className="w-3.5 h-3.5 text-white" />
            Lọc
          </button>
        </div>
      </div>
    </div>
  );
}
