"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Search,
  Filter,
  RotateCcw,
  Download,
  Trash2,
  Eye,
  RefreshCw,
  Layers,
  CheckCircle2,
  Activity,
  Database,
  ExternalLink,
  Copy,
  Clock,
  Calendar,
  AlertCircle,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  X,
  Play,
  Users,
  FileText,
  Folder,
  Tag,
  ShieldCheck,
  Check,
  ChevronDown,
  Loader2,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "@/lib/toast";
import {
  getScanHistory,
  deleteScanHistory,
  deleteScanHistoryBulk,
} from "../service";

export default function GroupScanHistoryPage() {
  const [historyList, setHistoryList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedSession, setSelectedSession] = useState(null);
  const [detailModalTab, setDetailModalTab] = useState("overview"); // overview | results | logs

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterDateRange, setFilterDateRange] = useState("ALL");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Nạp dữ liệu lịch sử phiên quét từ Database
  const fetchHistory = useCallback(async (isRefresh = false) => {
    setLoading(true);
    try {
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem("fb_scanned_sessions_cache");
        } catch {}
      }

      const res = await getScanHistory();
      const sessions = Array.isArray(res) ? res : res?.sessions || [];

      setHistoryList(sessions);
      if (isRefresh) {
        toast.success("Đã làm mới danh sách lịch sử quét từ Database!");
      }
    } catch (err) {
      console.warn("[Scan History]", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Stats calculation
  const stats = useMemo(() => {
    const total = historyList.length;
    const success = historyList.filter((s) => s.status === "SUCCESS").length;
    const running = historyList.filter((s) => s.status === "RUNNING").length;
    const totalItemsCollected = historyList.reduce(
      (sum, s) => sum + (s.progress?.collected || 0),
      0
    );
    const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : "0.0";
    return {
      total,
      success,
      running,
      successRate,
      totalItemsCollected,
    };
  }, [historyList]);

  // Filtered List
  const filteredList = useMemo(() => {
    return historyList.filter((item) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchId = (item.id || "").toLowerCase().includes(q);
        const matchTitle = (item.title || "").toLowerCase().includes(q);
        const matchTarget = (item.target || "").toLowerCase().includes(q);
        const matchAcc =
          (item.account?.name || "").toLowerCase().includes(q) ||
          (item.account?.uid || "").includes(q);
        if (!matchId && !matchTitle && !matchTarget && !matchAcc) return false;
      }

      // 2. Type Filter
      if (filterType !== "ALL" && item.type !== filterType) return false;

      // 3. Status Filter
      if (filterStatus !== "ALL" && item.status !== filterStatus) return false;

      // 4. Date Range Filter
      if (filterDateRange === "TODAY") {
        const today = new Date();
        const day = String(today.getDate()).padStart(2, "0");
        const month = String(today.getMonth() + 1).padStart(2, "0");
        const year = today.getFullYear();
        const todayStr = `${day}/${month}/${year}`;
        if (!item.startTime?.includes(todayStr)) return false;
      }

      return true;
    });
  }, [
    historyList,
    searchQuery,
    filterType,
    filterStatus,
    filterDateRange,
  ]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(filteredList.length / pageSize));
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredList.slice(start, start + pageSize);
  }, [filteredList, currentPage, pageSize]);

  // Selection handlers
  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(new Set(paginatedList.map((item) => item.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // Actions
  const handleRefresh = () => {
    fetchHistory(true);
  };

  const handleDeleteOne = async (id) => {
    try {
      await deleteScanHistory(id);
      setHistoryList((prev) => prev.filter((item) => item.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (selectedSession?.id === id) {
        setSelectedSession(null);
      }
      toast.success(`Đã xóa phiên #${id} khỏi Database!`);
    } catch (err) {
      console.error(err);
      toast.error(`Lỗi khi xóa phiên #${id}`);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const ids = Array.from(selectedIds);
    try {
      await deleteScanHistoryBulk(ids);
      setHistoryList((prev) => prev.filter((item) => !selectedIds.has(item.id)));
      setSelectedIds(new Set());
      if (selectedSession && selectedIds.has(selectedSession.id)) {
        setSelectedSession(null);
      }
      toast.success(`Đã xóa ${count} bản ghi lịch sử khỏi Database!`);
    } catch (err) {
      console.error(err);
      toast.error("Lỗi khi xóa nhiều phiên lịch sử!");
    }
  };

  const handleRerun = (session) => {
    toast.info(
      `Phiên quét: ${session.title} (${session.target}). Hãy mở tab Quét thông tin nhóm để tiếp tục!`
    );
  };

  // Export to Excel
  const handleExportExcel = () => {
    try {
      const dataToExport = (
        selectedIds.size > 0
          ? historyList.filter((item) => selectedIds.has(item.id))
          : filteredList
      ).map((item) => ({
        "Mã phiên": item.id,
        "Loại quét":
          item.type === "GROUP_INFO"
            ? "Quét thông tin nhóm"
            : item.type === "MEMBERS"
            ? "Quét thành viên nhóm"
            : "Quét bài viết nhóm",
        "Mục tiêu / Từ khóa": item.target,
        "Tài khoản UID": item.account?.uid || "",
        "Tên tài khoản": item.account?.name || "",
        "Đã thu thập": `${item.progress?.collected || 0} ${item.progress?.unit || "nhóm"}`,
        "Mục tiêu đặt ra": `${item.progress?.target || 0} ${item.progress?.unit || "nhóm"}`,
        "Tiến độ %": `${item.progress?.percentage || 0}%`,
        "Bắt đầu": item.startTime || "",
        "Kết thúc": item.endTime || "",
        "Thời lượng": item.duration || "",
        "Trạng thái":
          item.status === "SUCCESS"
            ? "Hoàn thành"
            : item.status === "RUNNING"
            ? "Đang quét"
            : item.status === "PAUSED"
            ? "Tạm dừng"
            : "Thất bại",
      }));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "LichSuQuetNhom");
      XLSX.writeFile(
        workbook,
        `Lich_Su_Quet_Nhom_Module10_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      toast.success(
        `Xuất thành công ${dataToExport.length} phiên quét ra file Excel!`
      );
    } catch (err) {
      console.error(err);
      toast.error("Có lỗi xảy ra khi xuất file Excel!");
    }
  };

  // Helper render Type Badge
  const renderTypeBadge = (type) => {
    switch (type) {
      case "GROUP_INFO":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Search className="size-3" />
            <span>Quét nhóm</span>
          </span>
        );
      case "MEMBERS":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <Users className="size-3" />
            <span>Quét thành viên</span>
          </span>
        );
      case "POSTS":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <FileText className="size-3" />
            <span>Quét bài viết</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-50 text-slate-700 border border-slate-200">
            <Search className="size-3" />
            <span>{type || "Quét nhóm"}</span>
          </span>
        );
    }
  };

  // Helper render Status Badge
  const renderStatusBadge = (status) => {
    switch (status) {
      case "SUCCESS":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span>Hoàn thành</span>
          </span>
        );
      case "RUNNING":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <RefreshCw className="size-3 animate-spin text-blue-600" />
            <span>Đang quét</span>
          </span>
        );
      case "PAUSED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="size-1.5 rounded-full bg-amber-500" />
            <span>Tạm dừng</span>
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <span className="size-1.5 rounded-full bg-rose-500" />
            <span>Thất bại</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      {/* ======================================================== */}
      {/* 1. TOP STATS CARDS (4 Hàng Thẻ Thống Kê Nhanh)           */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Tổng phiên quét */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#64748B]">Tổng phiên quét</p>
            <p className="text-2xl font-bold text-[#0F172A]">{stats.total}</p>
            <p className="text-[11px] text-[#2563EB] font-medium flex items-center gap-1">
              <span>Đã lưu trong CSDL</span>
            </p>
          </div>
          <div className="size-11 rounded-xl bg-blue-50 flex items-center justify-center text-[#2563EB]">
            <Layers className="size-5.5" />
          </div>
        </div>

        {/* Card 2: Thành công */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#64748B]">Phiên thành công</p>
            <p className="text-2xl font-bold text-emerald-600">{stats.success}</p>
            <p className="text-[11px] text-[#059669] font-medium flex items-center gap-1">
              <span>Tỷ lệ hoàn thành</span>
              <span className="font-bold">{stats.successRate}%</span>
            </p>
          </div>
          <div className="size-11 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="size-5.5" />
          </div>
        </div>

        {/* Card 3: Đang thực thi */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#64748B]">Đang thực thi</p>
            <p className="text-2xl font-bold text-[#0284C7]">{stats.running}</p>
            <p className="text-[11px] text-[#64748B] font-medium flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-blue-500 animate-ping inline-block" />
              <span>Tiến trình nền ổn định</span>
            </p>
          </div>
          <div className="size-11 rounded-xl bg-sky-50 flex items-center justify-center text-[#0284C7]">
            <Activity className="size-5.5" />
          </div>
        </div>

        {/* Card 4: Tổng dữ liệu bóc tách */}
        <div className="bg-white rounded-xl border border-[#E2E8F0] p-4 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#64748B]">Dữ liệu đã thu thập</p>
            <p className="text-2xl font-bold text-violet-700">
              {stats.totalItemsCollected.toLocaleString("vi-VN")}
            </p>
            <p className="text-[11px] text-[#64748B] font-medium">
              Nhóm Facebook đã lưu
            </p>
          </div>
          <div className="size-11 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600">
            <Database className="size-5.5" />
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 2. FILTER & TOOLBAR WORKSPACE CARD                       */}
      {/* ======================================================== */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-xs p-4 space-y-3.5">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-lg">
            <Search className="size-4 absolute left-3 top-2.5 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Tìm theo mã phiên (#SCN), từ khóa, nhóm, UID tài khoản..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 pl-9 pr-3 text-xs text-[#0F172A] border border-[#E2E8F0] bg-[#F8FAFC] rounded-lg outline-none focus:border-[#2563EB] focus:bg-white transition-all placeholder:text-[#94A3B8]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {/* Quick Filters Group */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Loại quét */}
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 px-3 text-xs font-medium text-[#1E293B] border border-[#CBD5E1] bg-white rounded-lg outline-none focus:border-[#2563EB] cursor-pointer"
            >
              <option value="ALL">Tất cả loại quét</option>
              <option value="GROUP_INFO">🔍 Quét thông tin nhóm</option>
              <option value="MEMBERS">👥 Quét thành viên nhóm</option>
              <option value="POSTS">📝 Quét bài viết nhóm</option>
            </select>

            {/* Trạng thái */}
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 px-3 text-xs font-medium text-[#1E293B] border border-[#CBD5E1] bg-white rounded-lg outline-none focus:border-[#2563EB] cursor-pointer"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="SUCCESS">🟢 Hoàn thành</option>
              <option value="RUNNING">🔵 Đang quét</option>
              <option value="PAUSED">🟡 Tạm dừng</option>
              <option value="FAILED">🔴 Thất bại</option>
            </select>

            {/* Thời gian */}
            <select
              value={filterDateRange}
              onChange={(e) => {
                setFilterDateRange(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 px-3 text-xs font-medium text-[#1E293B] border border-[#CBD5E1] bg-white rounded-lg outline-none focus:border-[#2563EB] cursor-pointer"
            >
              <option value="ALL">Toàn bộ thời gian</option>
              <option value="TODAY">Hôm nay</option>
            </select>

            {/* Action Buttons */}
            <button
              type="button"
              onClick={handleRefresh}
              title="Làm mới dữ liệu từ Database"
              className="size-9 flex items-center justify-center rounded-lg border border-[#CBD5E1] bg-white text-[#475569] hover:bg-slate-50 transition-colors"
            >
              <RotateCcw className={`size-4 ${loading ? "animate-spin text-blue-600" : ""}`} />
            </button>

            {/* Nút Xuất Excel */}
            <button
              type="button"
              onClick={handleExportExcel}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors"
            >
              <FileSpreadsheet className="size-3.5" />
              <span>Xuất Excel</span>
            </button>

            {/* Nút Xóa nhiều */}
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={handleBulkDelete}
                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 text-xs font-semibold transition-colors"
              >
                <Trash2 className="size-3.5" />
                <span>Xóa ({selectedIds.size})</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 3. MASTER DATA TABLE CARD                                */}
      {/* ======================================================== */}
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-xs overflow-hidden flex flex-col">
        {/* Table Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-[#F8FAFC]/50 border-b border-[#F1F5F9]">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#1E293B]">
              NHẬT KÝ CÁC PHIÊN QUÉT NHÓM
            </h2>
            <span className="rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">
              {filteredList.length} phiên ghi nhận
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#64748B]">
            <span>
              Đã chọn: <b className="text-[#0F172A]">{selectedIds.size}</b> phiên
            </span>
          </div>
        </div>

        {/* Table View */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#475569]">
              <tr>
                <th className="py-3 px-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      paginatedList.length > 0 &&
                      paginatedList.every((item) => selectedIds.has(item.id))
                    }
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4 min-w-[170px]">Mã phiên & Loại quét</th>
                <th className="py-3 px-4 min-w-[220px]">Mục tiêu / Từ khóa</th>
                <th className="py-3 px-4 min-w-[180px]">Tài khoản thực thi</th>
                <th className="py-3 px-4 min-w-[170px]">Tiến độ & Kết quả</th>
                <th className="py-3 px-4 min-w-[150px]">Thời gian & Thời lượng</th>
                <th className="py-3 px-4 min-w-[120px]">Trạng thái</th>
                <th className="py-3 px-4 min-w-[120px] text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[#1E293B]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                      <span>Đang tải lịch sử phiên quét từ Database...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#94A3B8]">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Layers className="size-8 text-slate-300 stroke-[1.5]" />
                      <p className="font-semibold text-slate-600">
                        Chưa có phiên quét nào được lưu trong Database
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Hãy chuyển qua tab Quét thông tin nhóm để bắt đầu quét các nhóm Facebook
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedList.map((item) => {
                  const isChecked = selectedIds.has(item.id);
                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-[#F8FAFC] transition-colors ${
                        isChecked ? "bg-blue-50/40" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => handleSelectOne(item.id, e.target.checked)}
                          className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>

                      {/* Mã phiên & Loại quét */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-bold text-[#0F172A] tracking-tight">
                            #{item.id}
                          </span>
                          {renderTypeBadge(item.type)}
                        </div>
                      </td>

                      {/* Mục tiêu / Từ khóa */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1 max-w-[260px]">
                          <span
                            className="font-semibold text-[#0F172A] truncate"
                            title={item.target}
                          >
                            {item.target}
                          </span>
                          <span className="text-[11px] text-[#64748B]">
                            {item.title}
                          </span>
                        </div>
                      </td>

                      {/* Tài khoản thực thi */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`size-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0 ${
                              item.account?.avatarBg || "bg-blue-600"
                            }`}
                          >
                            {item.account?.avatarText || "FB"}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-[#0F172A] truncate text-[11px]">
                              {item.account?.name || item.account?.uid || "Tài khoản quét"}
                            </span>
                            <span className="text-[10px] text-[#64748B] font-mono">
                              {item.account?.uid}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Tiến độ & Kết quả */}
                      <td className="py-3 px-4">
                        <div className="space-y-1.5 w-36">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-[#0F172A]">
                              {item.progress?.collected || 0} /{" "}
                              {item.progress?.target || 0}
                            </span>
                            <span className="font-medium text-[#64748B]">
                              {item.progress?.percentage || 0}%
                            </span>
                          </div>
                          {/* Progress bar */}
                          <div className="h-1.5 w-full rounded-full bg-[#E2E8F0] overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${
                                item.status === "FAILED"
                                  ? "bg-rose-500"
                                  : item.status === "PAUSED"
                                  ? "bg-amber-500"
                                  : (item.progress?.percentage || 0) >= 100
                                  ? "bg-emerald-500"
                                  : "bg-[#2563EB]"
                              }`}
                              style={{
                                width: `${Math.min(
                                  100,
                                  item.progress?.percentage || 0
                                )}%`,
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-[#94A3B8]">
                            Đơn vị: {item.progress?.unit || "nhóm"}
                          </span>
                        </div>
                      </td>

                      {/* Thời gian & Thời lượng */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[#334155] font-medium text-[11px]">
                            {item.startTime}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#64748B]">
                            <Clock className="size-3 text-slate-400" />
                            <span>{item.duration || "—"}</span>
                          </span>
                        </div>
                      </td>

                      {/* Trạng thái */}
                      <td className="py-3 px-4">
                        {renderStatusBadge(item.status)}
                      </td>

                      {/* Thao tác */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Nút Xem chi tiết */}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSession(item);
                              setDetailModalTab("overview");
                            }}
                            title="Xem chi tiết phiên quét"
                            className="size-7 rounded-lg border border-[#E2E8F0] hover:border-[#2563EB] hover:text-[#2563EB] flex items-center justify-center text-[#475569] transition-colors"
                          >
                            <Eye className="size-3.5" />
                          </button>

                          {/* Nút Quét lại */}
                          <button
                            type="button"
                            onClick={() => handleRerun(item)}
                            title="Chạy lại phiên quét này"
                            className="size-7 rounded-lg border border-[#E2E8F0] hover:border-emerald-600 hover:text-emerald-600 flex items-center justify-center text-[#475569] transition-colors"
                          >
                            <RefreshCw className="size-3.5" />
                          </button>

                          {/* Nút Xóa */}
                          <button
                            type="button"
                            onClick={() => handleDeleteOne(item.id)}
                            title="Xóa phiên khỏi Database"
                            className="size-7 rounded-lg border border-[#E2E8F0] hover:border-rose-500 hover:text-rose-500 flex items-center justify-center text-[#475569] transition-colors"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-[#F1F5F9] bg-[#F8FAFC]/40 text-xs text-[#64748B]">
          <div className="flex items-center gap-2">
            <span>Hiển thị</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-7 px-2 border border-[#CBD5E1] rounded bg-white text-xs text-[#1E293B]"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <span>
              trên tổng số <b>{filteredList.length}</b> phiên
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="size-7 flex items-center justify-center rounded border border-[#CBD5E1] bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft className="size-3.5" />
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={`size-7 text-xs font-semibold rounded transition-colors ${
                  currentPage === page
                    ? "bg-[#2563EB] text-white"
                    : "border border-[#CBD5E1] bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {page}
              </button>
            ))}

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="size-7 flex items-center justify-center rounded border border-[#CBD5E1] bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 4. DETAIL MODAL: XEM CHI TIẾT PHIÊN QUÉT                */}
      {/* ======================================================== */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#F1F5F9] px-6 py-4 bg-[#F8FAFC]">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#2563EB]">
                  <Layers className="size-4.5" />
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-[#0F172A]">
                      Chi tiết phiên #{selectedSession.id}
                    </h3>
                    {renderTypeBadge(selectedSession.type)}
                    {renderStatusBadge(selectedSession.status)}
                  </div>
                  <p className="text-[11px] text-[#64748B]">
                    Khởi tạo lúc: {selectedSession.startTime} • Thời lượng:{" "}
                    {selectedSession.duration || "—"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedSession(null)}
                className="size-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Modal Nav Tabs */}
            <div className="flex items-center gap-4 px-6 border-b border-[#F1F5F9] bg-white text-xs font-semibold">
              <button
                type="button"
                onClick={() => setDetailModalTab("overview")}
                className={`py-3 border-b-2 transition-colors ${
                  detailModalTab === "overview"
                    ? "border-[#2563EB] text-[#2563EB]"
                    : "border-transparent text-[#64748B] hover:text-[#0F172A]"
                }`}
              >
                Tổng quan & Cấu hình
              </button>
              <button
                type="button"
                onClick={() => setDetailModalTab("results")}
                className={`py-3 border-b-2 transition-colors ${
                  detailModalTab === "results"
                    ? "border-[#2563EB] text-[#2563EB]"
                    : "border-transparent text-[#64748B] hover:text-[#0F172A]"
                }`}
              >
                Dữ liệu mẫu ({selectedSession.sampleResults?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setDetailModalTab("logs")}
                className={`py-3 border-b-2 transition-colors ${
                  detailModalTab === "logs"
                    ? "border-[#2563EB] text-[#2563EB]"
                    : "border-transparent text-[#64748B] hover:text-[#0F172A]"
                }`}
              >
                Nhật ký tiến trình ({selectedSession.logs?.length || 0})
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
              {/* TAB 1: OVERVIEW */}
              {detailModalTab === "overview" && (
                <div className="space-y-4">
                  {/* Account & Target Card */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-[#E2E8F0] p-4 bg-[#F8FAFC]/50 space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                        Tài khoản thực thi
                      </span>
                      <div className="flex items-center gap-3 pt-1">
                        <div
                          className={`size-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                            selectedSession.account?.avatarBg || "bg-blue-600"
                          }`}
                        >
                          {selectedSession.account?.avatarText || "FB"}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-[#0F172A]">
                            {selectedSession.account?.name || "Tài khoản quét"}
                          </span>
                          <span className="text-[11px] text-[#64748B] font-mono">
                            UID: {selectedSession.account?.uid || "—"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#E2E8F0] p-4 bg-[#F8FAFC]/50 space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                        Mục tiêu / Từ khóa quét
                      </span>
                      <div className="pt-1">
                        <p className="font-bold text-[#0F172A] text-sm">
                          {selectedSession.target}
                        </p>
                        <p className="text-[11px] text-[#64748B] mt-0.5">
                          {selectedSession.title}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Progress & Result Box */}
                  <div className="rounded-xl border border-[#E2E8F0] p-4 bg-white space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#0F172A]">
                        Kết quả thu thập: {selectedSession.progress?.collected || 0} /{" "}
                        {selectedSession.progress?.target || 0}{" "}
                        {selectedSession.progress?.unit || "nhóm"}
                      </span>
                      <span className="font-bold text-[#2563EB]">
                        {selectedSession.progress?.percentage || 0}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[#E2E8F0] overflow-hidden">
                      <div
                        className="h-full bg-[#2563EB] rounded-full"
                        style={{
                          width: `${selectedSession.progress?.percentage || 0}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Config Grid */}
                  <div className="rounded-xl border border-[#E2E8F0] p-4 bg-white space-y-2.5">
                    <h4 className="font-bold text-[#0F172A] pb-2 border-b border-[#F1F5F9]">
                      Cấu hình tham số phiên chạy
                    </h4>
                    <div className="grid grid-cols-2 gap-y-2 text-[11px]">
                      {Object.entries(selectedSession.config || {}).map(
                        ([key, val]) => (
                          <div key={key} className="flex flex-col">
                            <span className="text-[#64748B] capitalize">{key}:</span>
                            <span className="font-semibold text-[#1E293B]">
                              {String(val)}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: SAMPLE RESULTS */}
              {detailModalTab === "results" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#F1F5F9]">
                    <span className="text-xs font-semibold text-[#64748B]">
                      Hiển thị mẫu các nhóm đã trích xuất được trong phiên:
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          JSON.stringify(selectedSession.sampleResults || [], null, 2)
                        );
                        toast.success("Đã copy dữ liệu mẫu vào Clipboard!");
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline"
                    >
                      <Copy className="size-3" />
                      <span>Copy toàn bộ JSON</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    {!selectedSession.sampleResults ||
                    selectedSession.sampleResults.length === 0 ? (
                      <div className="p-4 text-center text-[#94A3B8]">
                        Chưa có dữ liệu mẫu nào được lưu cho phiên này.
                      </div>
                    ) : (
                      selectedSession.sampleResults.map((res, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]/50 hover:bg-white transition-colors flex items-center justify-between"
                        >
                          <div className="flex flex-col min-w-0 pr-2">
                            <span className="font-bold text-[#0F172A] truncate">
                              {res.name || res.title || res.group_name}
                            </span>
                            <span className="text-[11px] text-[#64748B]">
                              {res.members ||
                                res.members_label ||
                                res.privacy ||
                                "—"}
                            </span>
                          </div>
                          {(res.url || res.href) && (
                            <a
                              href={res.url || res.href}
                              target="_blank"
                              rel="noreferrer"
                              className="size-7 rounded-md border border-[#CBD5E1] flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0"
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: LOGS */}
              {detailModalTab === "logs" && (
                <div className="rounded-xl bg-[#0F172A] p-4 text-[#F8FAFC] font-mono text-[11px] space-y-2 max-h-[350px] overflow-y-auto">
                  {!selectedSession.logs || selectedSession.logs.length === 0 ? (
                    <div className="text-slate-400">Chưa có nhật ký ghi nhận cho phiên này.</div>
                  ) : (
                    selectedSession.logs.map((lg, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-[#64748B] shrink-0">[{lg.time}]</span>
                        <span
                          className={`font-bold shrink-0 ${
                            lg.level === "ERROR" || lg.level === "FAILED"
                              ? "text-rose-400"
                              : lg.level === "SUCCESS"
                              ? "text-emerald-400"
                              : lg.level === "WARN"
                              ? "text-amber-400"
                              : "text-blue-400"
                          }`}
                        >
                          [{lg.level}]
                        </span>
                        <span className="text-slate-200 break-all">{lg.message}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#F1F5F9] bg-[#F8FAFC]">
              <button
                type="button"
                onClick={() => setSelectedSession(null)}
                className="px-4 py-2 rounded-lg border border-[#CBD5E1] bg-white text-xs font-semibold text-[#334155] hover:bg-slate-50 transition-colors"
              >
                Đóng
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleRerun(selectedSession);
                    setSelectedSession(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="size-3.5" />
                  <span>Quét lại phiên này</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
