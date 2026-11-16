"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Clock, Download, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "@/components/ui/toast";
import HistoryStatsCards from "./_components/HistoryStatsCards";
import HistoryFilters from "./_components/HistoryFilters";
import HistoryTable from "./_components/HistoryTable";
import CampaignDetailModal from "./_components/CampaignDetailModal";
import { seedingApi } from "@/modules/module_08_interaction_seeding/service";

export default function SeedingHistoryPage() {
  const [stats, setStats] = useState({
    total_campaigns: 0,
    total_interactions: 0,
    total_success: 0,
    total_failed: 0,
  });

  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Bộ lọc tìm kiếm
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [timePreset, setTimePreset] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);

  // Detail Modal
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  const todayStr = useMemo(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);

  // Debounce tìm kiếm 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Chỉ khi chọn đủ cả 2 ngày (Từ ngày và Đến ngày) và hợp lệ thì mới áp dụng lọc theo ngày
  const isDateRangeComplete = Boolean(
    fromDate &&
    toDate &&
    fromDate <= toDate &&
    fromDate <= todayStr &&
    toDate <= todayStr
  );

  const activeDateKey = isDateRangeComplete ? `${fromDate}_${toDate}` : "";

  // Reset trang về 1 khi bất kỳ tiêu chí lọc nào thay đổi
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, typeFilter, statusFilter, activeDateKey]);

  // Fetch real data from Local Engine Backend
  useEffect(() => {
    let ignore = false;
    seedingApi
      .getSeedingStats()
      .then((statsRes) => {
        if (!ignore && statsRes) {
          setStats(statsRes);
        }
      })
      .catch(() => {});

    const params = {
      page: currentPage,
      page_size: pageSize,
    };
    if (typeFilter !== "ALL") params.campaign_type = typeFilter;
    if (statusFilter !== "ALL") params.status = statusFilter;
    if (debouncedSearch) params.search = debouncedSearch;
    if (isDateRangeComplete) {
      params.from_date = fromDate;
      params.to_date = toDate;
    }

    seedingApi
      .getSeedingCampaigns(params)
      .then((res) => {
        if (!ignore) {
          if (res && Array.isArray(res.items)) {
            setCampaigns(res.items);
            setTotalCount(res.total || res.items.length);
          } else {
            setCampaigns([]);
            setTotalCount(0);
          }
        }
      })
      .catch((err) => {
        console.error("Lỗi tải dữ liệu lịch sử seeding:", err);
      });

    return () => {
      ignore = true;
    };
  }, [currentPage, pageSize, debouncedSearch, typeFilter, statusFilter, activeDateKey]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);

  // Nút đặt lại đưa về trạng thái mặc định
  const handleResetFilter = () => {
    setSearchTerm("");
    setDebouncedSearch("");
    setTypeFilter("ALL");
    setStatusFilter("ALL");
    setTimePreset("ALL");
    setFromDate("");
    setToDate("");
    setCurrentPage(1);
  };

  // Chuỗi tóm tắt bộ lọc đang thực sự áp dụng
  const getAppliedSummary = () => {
    const parts = [];
    if (typeFilter !== "ALL") {
      parts.push(
        typeFilter === "PAGE"
          ? "Page"
          : typeFilter === "PROFILE"
          ? "Trang cá nhân"
          : "Bài viết"
      );
    }
    if (statusFilter !== "ALL") {
      parts.push(
        statusFilter === "COMPLETED"
          ? "Hoàn thành"
          : statusFilter === "FAILED"
          ? "Không hoàn thành"
          : statusFilter === "RUNNING"
          ? "Đang chạy"
          : statusFilter
      );
    }
    if (debouncedSearch) {
      parts.push(`"${debouncedSearch}"`);
    }
    if (isDateRangeComplete) {
      parts.push(`${fromDate} đến ${toDate}`);
    }
    return parts.length > 0 ? parts.join(", ") : "Tất cả";
  };

  // Xuất file Excel đầy đủ tất cả chiến dịch: khi không lọc gì thì xuất tất cả từ trước đến nay, khi có lọc thì xuất đúng các bản ghi đã lọc
  const handleExportExcel = async () => {
    try {
      setIsExporting(true);

      const exportParams = {
        all_records: true,
        page: 1,
        page_size: 100000,
      };

      const isFiltered = Boolean(
        (typeFilter && typeFilter !== "ALL") ||
        (statusFilter && statusFilter !== "ALL") ||
        debouncedSearch ||
        isDateRangeComplete
      );

      if (typeFilter && typeFilter !== "ALL") exportParams.campaign_type = typeFilter;
      if (statusFilter && statusFilter !== "ALL") exportParams.status = statusFilter;
      if (debouncedSearch) exportParams.search = debouncedSearch;
      if (isDateRangeComplete) {
        exportParams.from_date = fromDate;
        exportParams.to_date = toDate;
      }

      const res = await seedingApi.getSeedingCampaigns(exportParams);
      const allCampaigns = res && Array.isArray(res.items) ? res.items : [];

      if (!allCampaigns || allCampaigns.length === 0) {
        toast.warning(
          isFiltered
            ? "Không tìm thấy chiến dịch nào phù hợp với bộ lọc đã chọn để xuất file!"
            : "Chưa có bất kỳ dữ liệu chiến dịch seeding nào trong hệ thống để xuất báo cáo!",
          "KHÔNG CÓ DỮ LIỆU"
        );
        return;
      }

      const headers = [
        "STT",
        "Mã chiến dịch",
        "Thời gian tạo",
        "Loại chiến dịch",
        "Mục tiêu seeding",
        "Hành động thực hiện",
        "Cảm xúc",
        "Số tài khoản tham gia",
        "Số lượng kế hoạch",
        "Thành công",
        "Thất bại",
        "Tỷ lệ thành công",
        "Trạng thái",
      ];

      const rows = allCampaigns.map((c, index) => {
        const successRate =
          c.total_planned > 0
            ? `${((c.total_success / c.total_planned) * 100).toFixed(1)}%`
            : "0%";

        const actionsStr =
          c.actions && c.actions.length > 0
            ? c.actions
                .map((a) => {
                  const up = a.toUpperCase();
                  if (up === "FOLLOW") return "Theo dõi";
                  if (up === "REACT") return "Like bài viết";
                  if (up === "COMMENT") return "Bình luận";
                  return a;
                })
                .join(", ")
            : "—";

        const typeStr =
          c.campaign_type === "PAGE"
            ? "Page"
            : c.campaign_type === "PROFILE"
            ? "Trang cá nhân"
            : "Bài viết";

        const statusStr =
          c.status === "COMPLETED"
            ? "Hoàn thành"
            : c.status === "FAILED"
            ? "Thất bại"
            : c.status === "RUNNING"
            ? "Đang chạy"
            : c.status || "—";

        return [
          index + 1,
          c.id || "—",
          c.created_at ? new Date(c.created_at).toLocaleString("vi-VN") : "—",
          typeStr,
          c.target_url || "—",
          actionsStr,
          c.reaction_type || "—",
          c.account_count || (c.account_ids ? c.account_ids.length : 0),
          c.total_planned || 0,
          c.total_success || 0,
          c.total_failed || 0,
          successRate,
          statusStr,
        ];
      });

      const worksheetData = [headers, ...rows];
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

      // Định dạng độ rộng cột (Column Widths)
      worksheet["!cols"] = [
        { wch: 6 },  // STT
        { wch: 18 }, // Mã chiến dịch
        { wch: 22 }, // Thời gian tạo
        { wch: 16 }, // Loại chiến dịch
        { wch: 45 }, // Mục tiêu seeding
        { wch: 30 }, // Hành động thực hiện
        { wch: 12 }, // Cảm xúc
        { wch: 22 }, // Số tài khoản tham gia
        { wch: 18 }, // Số lượng kế hoạch
        { wch: 14 }, // Thành công
        { wch: 14 }, // Thất bại
        { wch: 18 }, // Tỷ lệ thành công
        { wch: 18 }, // Trạng thái
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Lịch sử seeding");

      const now = new Date();
      const dateSuffix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
      const fileName = `Lich_su_seeding_${isFiltered ? "da_loc_" : "tat_ca_"}${dateSuffix}.xlsx`;

      XLSX.writeFile(workbook, fileName);

      toast.success(
        `Đã xuất thành công ${allCampaigns.length} chiến dịch (${isFiltered ? "theo bộ lọc" : "tất cả lịch sử"}) ra file Excel!`,
        "XUẤT EXCEL THÀNH CÔNG"
      );
    } catch (err) {
      console.error("Lỗi xuất file Excel:", err);
      toast.error(
        err?.message || "Đã xảy ra lỗi trong quá trình xuất Excel. Vui lòng thử lại!",
        "LỖI XUẤT FILE"
      );
    } finally {
      setIsExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="w-full space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20 shrink-0">
            <Clock className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Lịch sử seeding</h1>
            <p className="text-xs text-slate-500 mt-1 font-normal">
              Xem lại các chiến dịch seeding đã thực hiện. Theo dõi kết quả, xuất báo cáo và xem chi tiết.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isExporting}
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-blue-600 bg-white hover:bg-blue-50/70 text-blue-600 text-xs font-semibold shadow-sm transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
          >
            {isExporting ? (
              <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
            ) : (
              <Download className="w-4 h-4 text-blue-600" />
            )}
            {isExporting ? "Đang xuất..." : "Xuất Excel"}
          </button>
        </div>
      </div>

      {/* 4 Stats Cards */}
      <HistoryStatsCards stats={stats} />

      {/* Filter Panel */}
      <HistoryFilters
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        timePreset={timePreset}
        onTimePresetChange={setTimePreset}
        fromDate={fromDate}
        onFromDateChange={setFromDate}
        toDate={toDate}
        onToDateChange={setToDate}
        onReset={handleResetFilter}
        appliedSummary={getAppliedSummary()}
      />

      {/* History Table */}
      <HistoryTable
        campaigns={campaigns}
        onOpenDetail={(campaign) => setSelectedCampaign(campaign)}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onPageSizeChange={(newSize) => {
          setPageSize(newSize);
          setCurrentPage(1);
        }}
      />

      {/* Campaign Detail Modal */}
      <CampaignDetailModal
        campaign={selectedCampaign}
        isOpen={!!selectedCampaign}
        onClose={() => setSelectedCampaign(null)}
      />
    </div>
  );
}
