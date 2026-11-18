"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "@/lib/toast";
import { PageHeader } from "../shared/components";
import {
  getGroupCampaigns,
  getGroupCampaignRerunConfig,
  deleteGroupCampaign,
} from "../service";
import { CampaignDetailDialog } from "./detail";
import CampaignStatsSection from "./components/CampaignStatsSection";
import CampaignFilterSection from "./components/CampaignFilterSection";
import CampaignTableSection from "./components/CampaignTableSection";
import CampaignDeleteDialog from "./components/CampaignDeleteDialog";

const ITEMS_PER_PAGE = 10;

export default function GroupCampaignsModule() {
  const router = useRouter();

  const [activeDetailCampaign, setActiveDetailCampaign] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);

  // Bộ lọc
  const [searchQuery, setSearchQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState("all");
  const [customFromDate, setCustomFromDate] = useState("");
  const [customToDate, setCustomToDate] = useState("");
  const [actionTypeFilter, setActionTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Phân trang
  const [currentPage, setCurrentPage] = useState(1);

  // Modal Xóa chiến dịch (CAMP-04)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        q: searchQuery.trim() || undefined,
        time_filter: timeFilter,
        from_date: timeFilter === "custom" ? customFromDate || undefined : undefined,
        to_date: timeFilter === "custom" ? customToDate || undefined : undefined,
        action_type: actionTypeFilter,
        status: statusFilter,
      };
      const res = await getGroupCampaigns(params);
      setCampaigns(res?.campaigns || []);
      setCurrentPage(1);
    } catch (err) {
      setCampaigns([]);
      toast.error(err.message || "Không thể tải danh sách chiến dịch");
      setCurrentPage(1);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, timeFilter, customFromDate, customToDate, actionTypeFilter, statusFilter]);

  useEffect(() => {
    Promise.resolve().then(loadCampaigns);
  }, [loadCampaigns]);

  const stats = useMemo(() => {
    const total = campaigns.length;
    const completed = campaigns.filter((c) => c.status === "COMPLETED").length;
    const totalInteractions = campaigns.reduce((acc, c) => acc + (c.total_interactions || 0), 0);
    const interactions = totalInteractions >= 1000 ? `${(totalInteractions / 1000).toFixed(1)}k` : totalInteractions;
    return { total, completed, interactions };
  }, [campaigns]);

  const totalPages = Math.max(1, Math.ceil(campaigns.length / ITEMS_PER_PAGE));
  const paginatedCampaigns = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return campaigns.slice(start, start + ITEMS_PER_PAGE);
  }, [campaigns, currentPage]);

  const handleFilter = (e) => {
    if (e) e.preventDefault();
    if (timeFilter === "custom" && customFromDate && customToDate && customFromDate > customToDate) {
      toast.error("Khoảng ngày không hợp lệ: Từ ngày không được lớn hơn Đến ngày", "LỖI BỘ LỌC");
      return;
    }
    loadCampaigns();
  };

  const handleResetFilter = () => {
    setSearchQuery("");
    setTimeFilter("all");
    setCustomFromDate("");
    setCustomToDate("");
    setActionTypeFilter("ALL");
    setStatusFilter("ALL");
    setTimeout(() => {
      loadCampaigns();
    }, 50);
  };

  const handleExportData = () => {
    if (!campaigns.length) {
      toast.info("Không có dữ liệu chiến dịch để xuất", "THÔNG BÁO");
      return;
    }

    try {
      const headers = ["Mã CD", "Tên chiến dịch", "Loại", "Ngày chạy", "Nick đã chạy", "Lần chạy", "Trạng thái"];
      const rows = campaigns.map((c, i) => [
        `CD${String(i + 1).padStart(3, "0")}`,
        `"${c.name?.replace(/"/g, '""') || ""}"`,
        c.action_type === "POST" ? "Đăng bài" : "Bình luận",
        c.last_run_at || c.created_at || "",
        c.total_accounts_run || 0,
        c.total_runs || 1,
        c.status || "",
      ]);

      const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
      const link = document.createElement("a");
      link.setAttribute("href", encodeURI(csvContent));
      link.setAttribute("download", `danh_sach_chien_dich_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Đã xuất dữ liệu chiến dịch thành công!", "XUẤT DỮ LIỆU");
    } catch (err) {
      toast.error("Không thể xuất file dữ liệu: " + err.message, "LỖI");
    }
  };

  const handleRerun = async (campaign) => {
    try {
      toast.info(`Đang nạp cấu hình chạy lại cho "${campaign.name}"...`, "CHẠY LẠI CHIẾN DỊCH");
      const rerunData = await getGroupCampaignRerunConfig(campaign.id);
      sessionStorage.setItem("fb_rerun_campaign", JSON.stringify(rerunData));

      if (String(campaign.action_type || "").toUpperCase() === "COMMENT") {
        router.push("/groups/comment");
      } else {
        router.push("/groups/post");
      }
    } catch (err) {
      toast.error(err.message || "Không thể nạp cấu hình chạy lại", "LỖI CHẠY LẠI");
    }
  };

  const handleConfirmDelete = async () => {
    if (!campaignToDelete) return;
    setDeleteLoading(true);
    try {
      await deleteGroupCampaign(campaignToDelete.id);
      toast.success(`Đã xóa vĩnh viễn chiến dịch "${campaignToDelete.name}" thành công!`, "ĐÃ XÓA");
      setDeleteModalOpen(false);
      setCampaignToDelete(null);
      loadCampaigns();
    } catch (err) {
      toast.error(err.message || "Không thể xóa chiến dịch", "LỖI");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <CampaignDetailDialog
        open={Boolean(activeDetailCampaign)}
        onOpenChange={(open) => {
          if (!open) setActiveDetailCampaign(null);
        }}
        campaignId={activeDetailCampaign?.id}
      />

      <PageHeader
        heading="Quản lý chiến dịch"
        desc="Tra cứu, xem chi tiết và chạy lại các chiến dịch đã thực hiện."
        button={{
          label: "Xuất dữ liệu",
          icon: <Download className="size-3.5 text-slate-500" />,
          variant: "outline",
          onClick: handleExportData,
          className: "h-9 gap-2 border-slate-200 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50",
        }}
      />

      <CampaignStatsSection stats={stats} />

      <CampaignFilterSection
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        timeFilter={timeFilter}
        setTimeFilter={setTimeFilter}
        actionTypeFilter={actionTypeFilter}
        setActionTypeFilter={setActionTypeFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        customFromDate={customFromDate}
        setCustomFromDate={setCustomFromDate}
        customToDate={customToDate}
        setCustomToDate={setCustomToDate}
        onReset={handleResetFilter}
        onSubmit={handleFilter}
      />

      <CampaignTableSection
        campaigns={campaigns}
        paginatedCampaigns={paginatedCampaigns}
        loading={loading}
        currentPage={currentPage}
        totalPages={totalPages}
        itemsPerPage={ITEMS_PER_PAGE}
        onPageChange={setCurrentPage}
        onView={(camp) => camp && setActiveDetailCampaign(camp)}
        onRerun={handleRerun}
        onDelete={(camp) => {
          setCampaignToDelete(camp);
          setDeleteModalOpen(true);
        }}
      />

      <CampaignDeleteDialog
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        campaign={campaignToDelete}
        loading={deleteLoading}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
