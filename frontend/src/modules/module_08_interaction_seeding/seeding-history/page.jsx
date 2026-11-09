"use client";

import React, { useState, useEffect } from "react";
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

  // Draft filters (chỉ thay đổi khi user nhập liệu, KHÔNG kích hoạt gọi API ngay)
  const [draftSearch, setDraftSearch] = useState("");
  const [draftType, setDraftType] = useState("ALL");
  const [draftStatus, setDraftStatus] = useState("ALL");
  const [draftFromDate, setDraftFromDate] = useState("");
  const [draftToDate, setDraftToDate] = useState("");

  // Applied filters (chỉ cập nhật khi user BẤM NÚT LỌC hoặc ĐẶT LẠI)
  const [appliedFilters, setAppliedFilters] = useState({
    search: "",
    type: "ALL",
    status: "ALL",
    fromDate: "",
    toDate: "",
  });

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);

  // Detail Modal
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  // Fetch real data from Local Engine Backend (chỉ phụ thuộc vào appliedFilters và phân trang)
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
    if (appliedFilters.type !== "ALL") params.campaign_type = appliedFilters.type;
    if (appliedFilters.status !== "ALL") params.status = appliedFilters.status;
    if (appliedFilters.search.trim()) params.search = appliedFilters.search.trim();
    if (appliedFilters.fromDate) params.from_date = appliedFilters.fromDate;
    if (appliedFilters.toDate) params.to_date = appliedFilters.toDate;

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
  }, [currentPage, pageSize, appliedFilters]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);

  // Chỉ khi bấm nút LỌC mới cập nhật appliedFilters
  const handleApplyFilter = () => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    if (draftFromDate && draftFromDate > todayStr) {
      toast.warning("Từ ngày không thể chọn ngày trong tương lai!", "KHOẢNG THỜI GIAN KHÔNG HỢP LỆ");
      return;
    }

    if (draftToDate && draftToDate > todayStr) {
      toast.warning("Đến ngày không thể chọn ngày trong tương lai!", "KHOẢNG THỜI GIAN KHÔNG HỢP LỆ");
      return;
    }

    if (draftFromDate && draftToDate && draftFromDate > draftToDate) {
      toast.warning("Từ ngày không được lớn hơn Đến ngày!", "KHOẢNG THỜI GIAN KHÔNG HỢP LỆ");
      return;
    }

    setAppliedFilters({
      search: draftSearch.trim(),
      type: draftType,
      status: draftStatus,
      fromDate: draftFromDate,
      toDate: draftToDate,
    });
    setCurrentPage(1);
  };

  // Nút đặt lại đưa về trạng thái mặc định
  const handleResetFilter = () => {
    setDraftSearch("");
    setDraftType("ALL");
    setDraftStatus("ALL");
    setDraftFromDate("");
    setDraftToDate("");
    setAppliedFilters({
      search: "",
      type: "ALL",
      status: "ALL",
      fromDate: "",
      toDate: "",
    });
    setCurrentPage(1);
  };

  // Chuỗi tóm tắt bộ lọc đang thực sự áp dụng
  const getAppliedSummary = () => {
    const parts = [];
    if (appliedFilters.type !== "ALL") {
      parts.push(
        appliedFilters.type === "PAGE"
          ? "Page"
          : appliedFilters.type === "PROFILE"
          ? "Trang cá nhân"
          : "Bài viết"
      );
    }
    if (appliedFilters.status !== "ALL") {
      parts.push(
        appliedFilters.status === "COMPLETED"
          ? "Hoàn thành"
          : appliedFilters.status === "FAILED"
          ? "Không hoàn thành"
          : appliedFilters.status === "RUNNING"
          ? "Đang chạy"
          : appliedFilters.status
      );
    }
    if (appliedFilters.search) {
      parts.push(`"${appliedFilters.search}"`);
    }
    if (appliedFilters.fromDate || appliedFilters.toDate) {
      parts.push(`${appliedFilters.fromDate || "..."} đến ${appliedFilters.toDate || "..."}`);
    }
    return parts.length > 0 ? parts.join(", ") : "Tất cả";
  };

  // Xuất file Excel đầy đủ tất cả chiến dịch: khi không lọc gì thì xuất tất cả từ trước đến nay, khi có lọc thì xuất đúng các bản ghi đã lọc
  const handleExportExcel = async () => {
    try {
      setIsExporting(true);

      // Lấy bộ lọc thực tế (đồng bộ với các giá trị đang chọn trên form bộ lọc)
      const activeSearch = draftSearch.trim();
      const activeType = draftType;
      const activeStatus = draftStatus;
      const activeFromDate = draftFromDate;
      const activeToDate = draftToDate;

      // Đồng bộ appliedFilters để giao diện bảng bên dưới khớp 100% với dữ liệu xuất
      setAppliedFilters({
        search: activeSearch,
        type: activeType,
        status: activeStatus,
        fromDate: activeFromDate,
        toDate: activeToDate,
      });

      // Tham số gửi Backend: all_records = true để lấy toàn bộ dữ liệu (không bị phân trang 10 dòng)
      const exportParams = {
        all_records: true,
        page: 1,
        page_size: 100000,
      };

      const isFiltered = Boolean(
        (activeType && activeType !== "ALL") ||
        (activeStatus && activeStatus !== "ALL") ||
        activeSearch ||
        activeFromDate ||
        activeToDate
      );

      if (activeType && activeType !== "ALL") exportParams.campaign_type = activeType;
      if (activeStatus && activeStatus !== "ALL") exportParams.status = activeStatus;
      if (activeSearch) exportParams.search = activeSearch;
      if (activeFromDate) exportParams.from_date = activeFromDate;
      if (activeToDate) exportParams.to_date = activeToDate;

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
                  if (up === "SHARE") return "Chia sẻ";
                  return a;
                })
                .join(", ")
            : "";

        const reactionsStr =
          c.reactions && c.reactions.length > 0 ? c.reactions.join(", ") : "";

        return [
          index + 1,
          `#${c.id}`,
          c.created_at_display || c.created_at || "",
          c.campaign_type_display || c.campaign_type || "",
          c.target_summary || c.name || "",
          actionsStr,
          reactionsStr,
          c.account_count || 0,
          c.total_planned || 0,
          c.total_success || 0,
          c.total_failed || 0,
          successRate,
          c.status_display || c.status || "",
        ];
      });

      const worksheetData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(worksheetData);

      // Thiết lập độ rộng cột chuẩn chỉ cho Excel
      ws["!cols"] = [
        { wch: 6 },  // STT
        { wch: 14 }, // Mã chiến dịch
        { wch: 24 }, // Thời gian tạo
        { wch: 16 }, // Loại chiến dịch
        { wch: 45 }, // Mục tiêu seeding
        { wch: 26 }, // Hành động thực hiện
        { wch: 16 }, // Cảm xúc
        { wch: 22 }, // Số tài khoản tham gia
        { wch: 18 }, // Số lượng kế hoạch
        { wch: 14 }, // Thành công
        { wch: 14 }, // Thất bại
        { wch: 18 }, // Tỷ lệ thành công
        { wch: 18 }, // Trạng thái
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Lich_Su_Seeding");

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const dateFormatted = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
        now.getDate()
      )}_${pad(now.getHours())}${pad(now.getMinutes())}`;

      const filePrefix = isFiltered ? "lich_su_seeding_da_loc" : "lich_su_seeding_tat_ca";
      XLSX.writeFile(wb, `${filePrefix}_${dateFormatted}.xlsx`);

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
        searchTerm={draftSearch}
        onSearchTermChange={setDraftSearch}
        typeFilter={draftType}
        onTypeFilterChange={setDraftType}
        statusFilter={draftStatus}
        onStatusFilterChange={setDraftStatus}
        fromDate={draftFromDate}
        onFromDateChange={setDraftFromDate}
        toDate={draftToDate}
        onToDateChange={setDraftToDate}
        onReset={handleResetFilter}
        onApply={handleApplyFilter}
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
