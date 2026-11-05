"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { toast } from "@/lib/toast";
import {
  getScanHistory,
  deleteScanHistory,
  deleteScanHistoryBulk,
} from "../service";
import HistoryStatsOverview from "./_components/HistoryStatsOverview";
import HistoryFilterToolbar from "./_components/HistoryFilterToolbar";
import HistoryDataTable from "./_components/HistoryDataTable";
import SessionDetailModal from "./_components/SessionDetailModal";

export default function GroupScanHistoryPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

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

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F4F7FC] p-6">
      {/* 1. TOP STATS CARDS */}
      <HistoryStatsOverview stats={stats} />

      {/* 2. FILTER & TOOLBAR WORKSPACE CARD */}
      <HistoryFilterToolbar
        searchQuery={searchQuery}
        onSearchQueryChange={(val) => {
          setSearchQuery(val);
          setCurrentPage(1);
        }}
        filterType={filterType}
        onFilterTypeChange={(val) => {
          setFilterType(val);
          setCurrentPage(1);
        }}
        filterStatus={filterStatus}
        onFilterStatusChange={(val) => {
          setFilterStatus(val);
          setCurrentPage(1);
        }}
        filterDateRange={filterDateRange}
        onFilterDateRangeChange={(val) => {
          setFilterDateRange(val);
          setCurrentPage(1);
        }}
        onRefresh={handleRefresh}
        loading={loading}
        onExportExcel={handleExportExcel}
        selectedCount={selectedIds.size}
        onBulkDelete={handleBulkDelete}
      />

      {/* 3. MASTER DATA TABLE CARD */}
      <HistoryDataTable
        loading={loading}
        paginatedList={paginatedList}
        totalFilteredCount={filteredList.length}
        selectedIds={selectedIds}
        onSelectAll={handleSelectAll}
        onSelectOne={handleSelectOne}
        onViewDetail={(item) => {
          setSelectedSession(item);
          setDetailModalTab("overview");
        }}
        onRerun={handleRerun}
        onDeleteOne={handleDeleteOne}
        currentPage={currentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        onPageSizeChange={(val) => {
          setPageSize(Number(val));
          setCurrentPage(1);
        }}
      />

      {/* 4. DETAIL MODAL: XEM CHI TIẾT PHIÊN QUÉT */}
      <SessionDetailModal
        isOpen={Boolean(selectedSession)}
        onClose={() => setSelectedSession(null)}
        session={selectedSession}
        detailModalTab={detailModalTab}
        onTabChange={setDetailModalTab}
        onRerun={handleRerun}
        mounted={mounted}
      />
    </div>
  );
}
