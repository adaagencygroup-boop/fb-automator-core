"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Download } from "lucide-react";

import { toast } from "@/lib/toast";
import { PageHeader } from "../shared/components";
import { getGroupHistoryRecords, openGroupHistoryRecord } from "../service";
import HistoryStatsSection from "./components/HistoryStatsSection";
import HistoryFilterSection from "./components/HistoryFilterSection";
import HistoryTableSection, { taskStatusLabel } from "./components/HistoryTableSection";
import HistoryDetailDialog from "./components/HistoryDetailDialog";

export default function GroupHistoryModule() {
  // Bộ lọc
  const [searchTerm, setSearchTerm] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("ALL");
  const [seedingType, setSeedingType] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [timeRange, setTimeRange] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [dateError, setDateError] = useState("");

  // Phân trang & dữ liệu
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);

  // Dữ liệu từ backend
  const [records, setRecords] = useState([]);
  const [campaignsList, setCampaignsList] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    success: 0,
    failed: 0,
    success_rate: "0%",
    failed_rate: "0%",
  });
  const [totalPages, setTotalPages] = useState(1);
  const [detailItem, setDetailItem] = useState(null);
  const [openingRecordId, setOpeningRecordId] = useState(null);

  // Tính ngày theo timeRange
  const resolveDateParams = useCallback(() => {
    const now = new Date();
    if (timeRange === "today") {
      const today = now.toISOString().slice(0, 10);
      return { from_date: today, to_date: today };
    }
    if (timeRange === "7days") {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      return { from_date: d.toISOString().slice(0, 10), to_date: now.toISOString().slice(0, 10) };
    }
    if (timeRange === "30days") {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return { from_date: d.toISOString().slice(0, 10), to_date: now.toISOString().slice(0, 10) };
    }
    if (timeRange === "custom") {
      return {
        from_date: startDate.trim() || undefined,
        to_date: endDate.trim() || undefined,
      };
    }
    return { from_date: undefined, to_date: undefined };
  }, [timeRange, startDate, endDate]);

  // Tải dữ liệu lịch sử từ Backend API
  const loadHistory = useCallback(async () => {
    if (timeRange === "custom" && startDate && endDate && startDate > endDate) {
      setDateError("Khoảng ngày không hợp lệ: Từ ngày không được lớn hơn Đến ngày.");
      toast.error("Khoảng ngày không hợp lệ: Từ ngày không được lớn hơn Đến ngày", "LỖI BỘ LỌC");
      return;
    }
    setDateError("");

    setLoading(true);
    try {
      const { from_date, to_date } = resolveDateParams();
      const params = {
        q: searchTerm.trim() || undefined,
        campaign_id: campaignFilter !== "ALL" ? campaignFilter : undefined,
        action_type: seedingType,
        status: statusFilter,
        from_date,
        to_date,
        page: currentPage,
        page_size: pageSize,
      };

      const res = await getGroupHistoryRecords(params);
      setRecords(res.records || []);
      setStats(res.stats || { total: 0, success: 0, failed: 0, success_rate: "0%", failed_rate: "0%" });
      setCampaignsList(res.campaigns || []);
      setTotalPages(res.pagination?.total_pages || 1);
    } catch (err) {
      toast.error(err.message || "Không thể tải dữ liệu lịch sử", "LỖI TẢI DỮ LIỆU");
    } finally {
      setLoading(false);
    }
  }, [timeRange, startDate, endDate, resolveDateParams, searchTerm, campaignFilter, seedingType, statusFilter, currentPage, pageSize]);

  useEffect(() => {
    Promise.resolve().then(loadHistory);
  }, [loadHistory]);

  // Nhấn Lọc
  const handleFilter = (e) => {
    if (e) e.preventDefault();
    setCurrentPage(1);
    loadHistory();
  };

  // Đặt lại bộ lọc về mặc định
  const handleResetFilter = () => {
    setSearchTerm("");
    setCampaignFilter("ALL");
    setSeedingType("ALL");
    setStatusFilter("ALL");
    setTimeRange("all");
    setStartDate("");
    setEndDate("");
    setDateError("");
    setCurrentPage(1);
    setTimeout(() => {
      loadHistory();
    }, 50);
  };

  // Xuất CSV
  const handleExportCSV = () => {
    if (!records.length) {
      toast.warning("Không có dữ liệu lịch sử để xuất file!", "THÔNG BÁO");
      return;
    }
    const headers = ["STT,Thời gian,Loại,Chiến dịch,UID người dùng,UID nhóm,Nhóm,Nội dung,Trạng thái,Kết quả,Link liên quan"];
    const rows = records.map((item) =>
      `"${item.stt}","${item.time}","${item.action_type === "POST" ? "Đăng bài" : "Bình luận"}","${(item.campaign_name || "").replace(/"/g, '""')}","${item.account_uid}","${item.group_uid || ""}","${(item.group_name || "").replace(/"/g, '""')}","${(item.content || "").replace(/"/g, '""')}","${taskStatusLabel(item.status)}","${(item.result || "").replace(/"/g, '""')}","${item.result_url || ""}"`
    );
    const csvContent = "\uFEFF" + [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lich_su_spam_group_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất file CSV lịch sử thành công!", "XUẤT DỮ LIỆU");
  };

  const handleOpenResult = async (item) => {
    if (!item?.id || openingRecordId) return;
    setOpeningRecordId(item.id);
    try {
      const response = await openGroupHistoryRecord(item.id);
      toast.success(response?.message || `Đang mở bài bằng tài khoản ${item.account_uid}`, "ĐANG MỞ CHROME PROFILE");
    } catch (error) {
      toast.error(error.message || "Không thể mở bài bằng Chrome profile của tài khoản", "LỖI MỞ BÀI");
    } finally {
      setOpeningRecordId(null);
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        heading="Lịch sử hoạt động Spam Group"
        desc="Tra cứu lịch sử đăng bài và bình luận trong các nhóm Facebook, theo dõi kết quả xác minh và liên kết bài viết liên quan."
        button={{
          label: "Xuất file CSV",
          icon: <Download className="mr-1.5 size-3.5" />,
          variant: "outline",
          disabled: !records.length,
          onClick: handleExportCSV,
          className: "border-slate-200 text-sm py-3 px-4 text-slate-700 hover:bg-slate-50",
        }}
      />

      <HistoryStatsSection stats={stats} />

      <HistoryFilterSection
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        campaignFilter={campaignFilter}
        onCampaignChange={setCampaignFilter}
        campaignsList={campaignsList}
        seedingType={seedingType}
        onSeedingTypeChange={setSeedingType}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        dateError={dateError}
        onSubmit={handleFilter}
        onReset={handleResetFilter}
      />

      <HistoryTableSection
        records={records}
        totalCount={stats.total}
        loading={loading}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setCurrentPage(1);
        }}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        openingRecordId={openingRecordId}
        onOpenResult={handleOpenResult}
        onSelectDetail={setDetailItem}
      />

      <HistoryDetailDialog item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}
