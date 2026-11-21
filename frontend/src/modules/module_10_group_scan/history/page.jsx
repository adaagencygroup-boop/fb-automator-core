"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { toast } from "@/lib/toast";
import {
  getScanHistory,
  deleteScanHistory,
  deleteScanHistoryBulk,
  resumeScanSession,
} from "../service";
import HistoryFilterToolbar from "./_components/HistoryFilterToolbar";
import HistoryDataTable from "./_components/HistoryDataTable";
import SessionDetailModal from "./_components/SessionDetailModal";
import { fileStamp } from "../utils/exportTable";
import ModulePageHeader from "../components/ModulePageHeader";

function parseSessionDate(startTime) {
  if (!startTime) return null;
  // Format DD/MM/YYYY
  const m = startTime.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }
  const d = new Date(startTime);
  return isNaN(d.getTime()) ? null : d;
}

export default function GroupScanHistoryPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [historyList, setHistoryList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);
  const [detailModalTab, setDetailModalTab] = useState("overview");

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterDateRange, setFilterDateRange] = useState("ALL");

  // Pagination (Default 5 to match mockup image)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

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
      if (filterType !== "ALL") {
        const t = (item.type || "").toUpperCase();
        if (filterType === "MEMBERS") {
          if (!t.includes("MEMBER") && !t.includes("FOLLOWER")) return false;
        } else if (filterType === "GROUP_INFO") {
          if (!t.includes("INFO") && t.includes("MEMBER")) return false;
        } else if (t !== filterType) {
          return false;
        }
      }

      // 3. Status Filter
      if (filterStatus !== "ALL") {
        const s = (item.status || "").toUpperCase();
        if (filterStatus === "SUCCESS") {
          if (s !== "SUCCESS" && s !== "COMPLETED" && s !== "DONE") return false;
        } else if (filterStatus === "FAILED") {
          if (s !== "FAILED" && s !== "ERROR") return false;
        } else if (filterStatus === "STOPPED") {
          if (s !== "ABORTED" && s !== "INTERRUPTED" && s !== "RESUMED") return false;
        } else if (s !== filterStatus) {
          return false;
        }
      }

      // 4. Date Range Filter
      if (filterDateRange !== "ALL") {
        const itemDate = parseSessionDate(item.startTime);
        if (itemDate) {
          const now = new Date();
          const itemDay = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate()).getTime();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          const oneDay = 24 * 60 * 60 * 1000;

          if (filterDateRange === "TODAY") {
            if (itemDay !== today) return false;
          } else if (filterDateRange === "YESTERDAY") {
            if (itemDay !== today - oneDay) return false;
          } else if (filterDateRange === "LAST_7_DAYS") {
            if (itemDay < today - 7 * oneDay) return false;
          } else if (filterDateRange === "LAST_30_DAYS") {
            if (itemDay < today - 30 * oneDay) return false;
          }
        }
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

  const router = useRouter();
  const [resumingId, setResumingId] = useState(null);

  // Chạy tiếp phiên bị gián đoạn: chỉ quét phần còn thiếu, rồi mở trang Quét tương ứng để theo dõi.
  const handleResume = async (session) => {
    if (!session?.id || resumingId) return;
    setResumingId(session.id);
    try {
      const res = await resumeScanSession(session.id);
      const unit = res?.scan_type === "GROUP_MEMBERS" ? "nhóm" : "từ khóa / link";
      toast.success(`Đang chạy tiếp ${res?.remaining || session.remainingItems} ${unit} còn thiếu.`);
      setSelectedSession(null);
      router.push(res?.scan_type === "GROUP_MEMBERS" ? "/scan/members" : "/scan/info");
    } catch (err) {
      toast.error(err?.message || "Không chạy tiếp được phiên này.");
      fetchHistory();
    } finally {
      setResumingId(null);
    }
  };

  // Export to Excel
  const handleExportExcel = () => {
    try {
      const dataToExport = filteredList.map((item, index) => {
        const type = (item.type || "").toUpperCase();
        let taskType = "Quét thông tin nhóm";
        let unit = "Nhóm";
        if (type.includes("MEMBER") || type.includes("FOLLOWER")) {
          taskType = "Quét thành viên nhóm";
          unit = "UID";
        }

        const status = (item.status || "").toUpperCase();
        const statusLabel =
          status === "SUCCESS" || status === "COMPLETED"
            ? "Hoàn thành"
            : status === "RUNNING"
            ? "Đang chạy"
            : status === "PAUSED"
            ? "Tạm dừng"
            : status === "ABORTED"
            ? "Đã dừng"
            : status === "INTERRUPTED"
            ? "Bị gián đoạn"
            : status === "RESUMED"
            ? "Đã chạy tiếp"
            : "Lỗi";

        return {
          "STT": String(index + 1).padStart(2, "0"),
          "Mã phiên": item.id,
          "Loại tác vụ": taskType,
          "Mục tiêu quét": item.target,
          "Kết quả thu thập": `${item.progress?.collected || 0} ${unit}`,
          "Thời gian bắt đầu": item.startTime || "",
          "Thời lượng": item.duration || "",
          "Trạng thái": statusLabel,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "LichSuQuetNhom");
      XLSX.writeFile(
        workbook,
        `Lich_su_quet_nhom_${fileStamp()}.xlsx`
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
      <ModulePageHeader navId="scan.history" />
      {/* 1. TOP FILTER BAR */}
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
        onExportExcel={handleExportExcel}
      />

      {/* 2. MAIN DATA TABLE */}
      <HistoryDataTable
        loading={loading}
        paginatedList={paginatedList}
        totalFilteredCount={filteredList.length}
        onViewDetail={(item) => {
          setSelectedSession(item);
          setDetailModalTab("overview");
        }}
        onResume={handleResume}
        resumingId={resumingId}
        currentPage={currentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        onPageSizeChange={(val) => {
          setPageSize(Number(val));
          setCurrentPage(1);
        }}
      />

      {/* 3. DETAIL MODAL */}
      <SessionDetailModal
        isOpen={Boolean(selectedSession)}
        onClose={() => setSelectedSession(null)}
        session={selectedSession}
        detailModalTab={detailModalTab}
        onTabChange={setDetailModalTab}
        onResume={handleResume}
        resumingId={resumingId}
        mounted={mounted}
      />
    </div>
  );
}
