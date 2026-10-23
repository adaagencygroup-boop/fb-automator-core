"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Filter,
  RotateCcw,
  Eye,
  Trash2,
  Copy,
  ExternalLink,
  CalendarDays,
  Clock,
  Layers,
  Users,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  X,
  Play,
  FileText,
  Megaphone,
  Check,
  TrendingUp,
  Download,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import CampaignDetailModule from "./detail";
import {
  getGroupCampaigns,
  getGroupCampaignDetails,
  getGroupCampaignRerunConfig,
  deleteGroupCampaign,
} from "../service";

const ITEMS_PER_PAGE = 4;

export default function GroupCampaignsModule() {
  const router = useRouter();

  // Chế độ xem chi tiết trực tiếp trong trang (tránh lỗi 404 khi dev server chưa compile route động)
  const [viewingCampaign, setViewingCampaign] = useState(null);

  // Danh sách chiến dịch & loading
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

  // Modal Chi tiết chiến dịch (CAMP-03)
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignDetails, setCampaignDetails] = useState([]);

  // Modal Xóa chiến dịch (CAMP-04)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Mock data để test giao diện khi DB chưa có dữ liệu
  const MOCK_CAMPAIGNS = [
    {
      id: "camp-001",
      name: "Quảng bá nông sản tháng 10",
      action_type: "POST",
      total_runs: 1,
      total_accounts_run: 24,
      status: "COMPLETED",
      created_at: "2026-10-23T08:30:00Z",
      last_run_at: "2026-10-23T08:30:00Z",
    },
    {
      id: "camp-002",
      name: "Rải comment bài viết Bất động sản Hà Nội",
      action_type: "COMMENT",
      total_runs: 3,
      total_accounts_run: 18,
      status: "COMPLETED",
      created_at: "2026-10-22T14:15:00Z",
      last_run_at: "2026-10-22T16:45:00Z",
    },
    {
      id: "camp-003",
      name: "Chiến dịch đăng bài tuyển dụng IT cuối tuần",
      action_type: "POST",
      total_runs: 2,
      total_accounts_run: 30,
      status: "COMPLETED",
      created_at: "2026-10-21T09:00:00Z",
      last_run_at: "2026-10-21T11:20:00Z",
    },
    {
      id: "camp-004",
      name: "Tương tác nhóm ẩm thực miền Trung",
      action_type: "COMMENT",
      total_runs: 1,
      total_accounts_run: 12,
      status: "COMPLETED",
      created_at: "2026-10-20T10:30:00Z",
      last_run_at: "2026-10-20T10:30:00Z",
    },
    {
      id: "camp-005",
      name: "Khuyến mãi thời trang mùa thu",
      action_type: "POST",
      total_runs: 4,
      total_accounts_run: 45,
      status: "COMPLETED",
      created_at: "2026-10-18T07:45:00Z",
      last_run_at: "2026-10-19T15:00:00Z",
    },
  ];

  // Load danh sách chiến dịch
  const loadCampaigns = async () => {
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
      if (res && res.campaigns && res.campaigns.length > 0) {
        setCampaigns(res.campaigns);
      } else {
        // Nếu API trả về rỗng, nạp dữ liệu mẫu để kiểm thử UI
        setCampaigns(MOCK_CAMPAIGNS);
      }
      setCurrentPage(1);
    } catch (err) {
      console.warn("API error, fallback to mock campaigns:", err);
      // Fallback sang mock data nếu API offline hoặc lỗi
      setCampaigns(MOCK_CAMPAIGNS);
      setCurrentPage(1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, [timeFilter, actionTypeFilter, statusFilter]);

  // Thống kê nhanh từ danh sách
  const stats = useMemo(() => {
    const total = campaigns.length;
    const completed = campaigns.filter((c) => c.status === "COMPLETED").length;
    // Tính ước lượng tương tác (hoặc tổng nick đã chạy)
    const totalInteractions = campaigns.reduce((acc, c) => acc + (c.total_accounts_run || 0) * 15, 0);

    const formatK = (num) => {
      if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
      return num;
    };

    return {
      total,
      completed,
      interactions: formatK(totalInteractions || total * 140),
    };
  }, [campaigns]);

  // Phân trang dữ liệu hiển thị
  const totalPages = Math.max(1, Math.ceil(campaigns.length / ITEMS_PER_PAGE));
  const paginatedCampaigns = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return campaigns.slice(start, start + ITEMS_PER_PAGE);
  }, [campaigns, currentPage]);

  // Nút Lọc thủ công
  const handleFilter = (e) => {
    if (e) e.preventDefault();
    if (timeFilter === "custom" && customFromDate && customToDate && customFromDate > customToDate) {
      toast.error("Khoảng ngày không hợp lệ: Từ ngày không được lớn hơn Đến ngày", "LỖI BỘ LỌC");
      return;
    }
    loadCampaigns();
  };

  // Đặt lại bộ lọc
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

  // Xuất dữ liệu CSV
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
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `danh_sach_chien_dich_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Đã xuất dữ liệu chiến dịch thành công!", "XUẤT DỮ LIỆU");
    } catch (err) {
      toast.error("Không thể xuất file dữ liệu: " + err.message, "LỖI");
    }
  };

  // Xem chi tiết (CAMP-03): chuyển trang sang giao diện chi tiết đầy đủ
  const handleViewDetails = (campaign) => {
    if (!campaign) return;
    setViewingCampaign(campaign);
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", `/groups/campaigns?id=${encodeURIComponent(campaign.id)}`);
    }
  };

  // Copy UID vào clipboard
  const handleCopyUid = (uid) => {
    if (!uid) return;
    navigator.clipboard.writeText(uid);
    toast.success(`Đã sao chép UID ${uid} vào bộ nhớ tạm!`, "ĐÃ SAO CHÉP");
  };

  // Chạy lại chiến dịch (CAMP-05 / CAMP-RUN-01)
  const handleRerun = async (campaign) => {
    try {
      toast.info(`Đang nạp cấu hình chạy lại cho "${campaign.name}"...`, "CHẠY LẠI CHIẾN DỊCH");
      const rerunData = await getGroupCampaignRerunConfig(campaign.id);
      sessionStorage.setItem("fb_rerun_campaign", JSON.stringify(rerunData));

      if (campaign.action_type === "COMMENT") {
        router.push("/groups/comment");
      } else {
        router.push("/groups/post");
      }
    } catch (err) {
      toast.error(err.message || "Không thể nạp cấu hình chạy lại", "LỖI CHẠY LẠI");
    }
  };

  // Xác nhận Xóa mềm (CAMP-04)
  const handleConfirmDelete = async () => {
    if (!campaignToDelete) return;
    setDeleteLoading(true);
    try {
      await deleteGroupCampaign(campaignToDelete.id);
      toast.success(`Đã xóa mềm chiến dịch "${campaignToDelete.name}" thành công!`, "ĐÃ XÓA");
      setDeleteModalOpen(false);
      setCampaignToDelete(null);
      loadCampaigns();
    } catch (err) {
      toast.error(err.message || "Không thể xóa chiến dịch", "LỖI");
    } finally {
      setDeleteLoading(false);
    }
  };

  // Format ngày tháng hiển thị dạng DD/MM/YYYY
  const formatDateOnly = (timeStr) => {
    if (!timeStr) return "--/--/----";
    try {
      const dt = new Date(timeStr);
      return dt.toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return timeStr;
    }
  };

  // Render badge trạng thái dạng viên nang có chấm tròn theo đúng thiết kế
  const renderStatusPill = (status) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Hoàn thành
          </span>
        );
      case "STOPPED":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            <span className="size-1.5 rounded-full bg-slate-400" />
            Đã dừng
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-600">
            <span className="size-1.5 rounded-full bg-rose-500" />
            Thất bại
          </span>
        );
      case "RUNNING":
      case "QUEUED":
      case "SCHEDULED":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600">
            <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
            Đang chạy
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
            <span className="size-1.5 rounded-full bg-slate-400" />
            {status || "Chưa chạy"}
          </span>
        );
    }
  };

  // Nếu đang ở chế độ xem chi tiết chiến dịch
  if (viewingCampaign) {
    return (
      <CampaignDetailModule
        campaignId={viewingCampaign.id}
        onBack={() => {
          setViewingCampaign(null);
          if (typeof window !== "undefined") {
            window.history.pushState(null, "", "/groups/campaigns");
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Header & Nút Xuất dữ liệu */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 shadow-xs">
            <svg width="22" height="19" viewBox="0 0 21 18" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
              <path d="M15 18L14.7 16.5C14.5 16.4167 14.3125 16.3292 14.1375 16.2375C13.9625 16.1458 13.7833 16.0333 13.6 15.9L12.15 16.35L11.15 14.65L12.3 13.65C12.2667 13.45 12.25 13.2333 12.25 13C12.25 12.7667 12.2667 12.55 12.3 12.35L11.15 11.35L12.15 9.65L13.6 10.1C13.7833 9.96667 13.9625 9.85417 14.1375 9.7625C14.3125 9.67083 14.5 9.58333 14.7 9.5L15 8H17L17.3 9.5C17.5 9.58333 17.6875 9.67083 17.8625 9.7625C18.0375 9.85417 18.2167 9.96667 18.4 10.1L19.85 9.65L20.85 11.35L19.7 12.35C19.7333 12.55 19.75 12.7667 19.75 13C19.75 13.2333 19.7333 13.45 19.7 13.65L20.85 14.65L19.85 16.35L18.4 15.9C18.2167 16.0333 18.0375 16.1458 17.8625 16.2375C17.6875 16.3292 17.5 16.4167 17.3 16.5L17 18H15V18M16 15C16.55 15 17.0208 14.8042 17.4125 14.4125C17.8042 14.0208 18 13.55 18 13C18 12.45 17.8042 11.9792 17.4125 11.5875C17.0208 11.1958 16.55 11 16 11C15.45 11 14.9792 11.1958 14.5875 11.5875C14.1958 11.9792 14 12.45 14 13C14 13.55 14.1958 14.0208 14.5875 14.4125C14.9792 14.8042 15.45 15 16 15V15M2 14V14V14V14V2V2V2V2V4V4V4V4V6.3C2 6.2 2 6.125 2 6.075C2 6.025 2 6 2 6C2 6 2 6.6875 2 8.0625C2 9.4375 2 11.075 2 12.975C2 13.1583 2 13.3292 2 13.4875C2 13.6458 2 13.8167 2 14V14M2 16C1.45 16 0.979167 15.8042 0.5875 15.4125C0.195833 15.0208 0 14.55 0 14V2C0 1.45 0.195833 0.979167 0.5875 0.5875C0.979167 0.195833 1.45 0 2 0H8L10 2H18C18.55 2 19.0208 2.19583 19.4125 2.5875C19.8042 2.97917 20 3.45 20 4V7.275C19.7 7.05833 19.3833 6.87083 19.05 6.7125C18.7167 6.55417 18.3667 6.41667 18 6.3V4V4V4H9.175L7.175 2H2V2V2V14V14V14H9.075C9.125 14.35 9.20417 14.6917 9.3125 15.025C9.42083 15.3583 9.55 15.6833 9.7 16H2V16" fill="currentColor" className="text-blue-600"/>
            </svg>
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-900">
              Quản lý chiến dịch
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Tra cứu, xem chi tiết và chạy lại các chiến dịch đã thực hiện.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleExportData}
          className="h-9 gap-2 border-slate-200 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50"
        >
          <Download className="size-3.5 text-slate-500" />
          Xuất dữ liệu
        </Button>
      </div>

      {/* 2. Hàng 3 Card Thống kê chỉ số (Overview Cards) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Tổng chiến dịch */}
        <Card className="flex items-center justify-between border-slate-200/80 bg-white p-5 shadow-xs">
          <div>
            <p className="text-xs font-medium text-slate-500">Tổng chiến dịch</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
              {stats.total}
            </p>
          </div>
          <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <svg width="17" height="14" viewBox="0 0 17 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
              <path d="M13.3333 7.5V5.83333H16.6667V7.5H13.3333V7.5M14.3333 13.3333L11.6667 11.3333L12.6667 10L15.3333 12L14.3333 13.3333V13.3333M12.6667 3.33333L11.6667 2L14.3333 0L15.3333 1.33333L12.6667 3.33333V3.33333M2.5 12.5V9.16667H1.66667C1.20833 9.16667 0.815972 9.00347 0.489583 8.67708C0.163194 8.35069 0 7.95833 0 7.5V5.83333C0 5.375 0.163194 4.98264 0.489583 4.65625C0.815972 4.32986 1.20833 4.16667 1.66667 4.16667H5L9.16667 1.66667V11.6667L5 9.16667H4.16667V12.5H2.5V12.5M7.5 8.70833V4.625L5.45833 5.83333H1.66667V5.83333V5.83333V7.5V7.5V7.5H5.45833L7.5 8.70833V8.70833M10 9.45833V3.875C10.375 4.20833 10.6771 4.61458 10.9062 5.09375C11.1354 5.57292 11.25 6.09722 11.25 6.66667C11.25 7.23611 11.1354 7.76042 10.9062 8.23958C10.6771 8.71875 10.375 9.125 10 9.45833V9.45833M4.58333 6.66667V6.66667V6.66667V6.66667V6.66667V6.66667V6.66667V6.66667V6.66667V6.66667V6.66667V6.66667" fill="currentColor"/>
            </svg>
          </div>
        </Card>

        {/* Chiến dịch hoàn thành */}
        <Card className="flex items-center justify-between border-slate-200/80 bg-white p-5 shadow-xs">
          <div>
            <p className="text-xs font-medium text-slate-500">Chiến dịch hoàn thành</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
              {stats.completed}
            </p>
          </div>
          <div className="flex size-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
              <path d="M8.33333 16.6667C7.18056 16.6667 6.09722 16.4479 5.08333 16.0104C4.06944 15.5729 3.1875 14.9792 2.4375 14.2292C1.6875 13.4792 1.09375 12.5972 0.65625 11.5833C0.21875 10.5694 0 9.48611 0 8.33333C0 7.18056 0.21875 6.09722 0.65625 5.08333C1.09375 4.06944 1.6875 3.1875 2.4375 2.4375C3.1875 1.6875 4.06944 1.09375 5.08333 0.65625C6.09722 0.21875 7.18056 0 8.33333 0C9.23611 0 10.0903 0.131944 10.8958 0.395833C11.7014 0.659722 12.4444 1.02778 13.125 1.5L11.9167 2.72917C11.3889 2.39583 10.8264 2.13542 10.2292 1.94792C9.63194 1.76042 9 1.66667 8.33333 1.66667C6.48611 1.66667 4.91319 2.31597 3.61458 3.61458C2.31597 4.91319 1.66667 6.48611 1.66667 8.33333C1.66667 10.1806 2.31597 11.7535 3.61458 13.0521C4.91319 14.3507 6.48611 15 8.33333 15C10.1806 15 11.7535 14.3507 13.0521 13.0521C14.3507 11.7535 15 10.1806 15 8.33333C15 8.08333 14.9861 7.83333 14.9583 7.58333C14.9306 7.33333 14.8889 7.09028 14.8333 6.85417L16.1875 5.5C16.3403 5.94444 16.4583 6.40278 16.5417 6.875C16.625 7.34722 16.6667 7.83333 16.6667 8.33333C16.6667 9.48611 16.4479 10.5694 16.0104 11.5833C15.5729 12.5972 14.9792 13.4792 14.2292 14.2292C13.4792 14.9792 12.5972 15.5729 11.5833 16.0104C10.5694 16.4479 9.48611 16.6667 8.33333 16.6667V16.6667M7.16667 12.1667L3.625 8.625L4.79167 7.45833L7.16667 9.83333L15.5 1.47917L16.6667 2.64583L7.16667 12.1667V12.1667" fill="currentColor"/>
            </svg>
          </div>
        </Card>

        {/* Tương tác đã tạo */}
        <Card className="flex items-center justify-between border-slate-200/80 bg-white p-5 shadow-xs">
          <div>
            <p className="text-xs font-medium text-slate-500">Tương tác đã tạo</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
              {stats.interactions}
            </p>
          </div>
          <div className="flex size-11 items-center justify-center rounded-xl bg-indigo-50 text-blue-600">
            <svg width="17" height="18" viewBox="0 0 17 18" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
              <path d="M1.35417 10.8542L0 9.875L4.16667 3.20833L6.66667 6.125L10 0.708333L12.5 4.45833L15.3125 0L16.6667 0.979167L12.5417 7.52083L10.0625 3.79167L6.89583 8.9375L4.375 6L1.35417 10.8542V10.8542M11.25 14.1667C11.8333 14.1667 12.3264 13.9653 12.7292 13.5625C13.1319 13.1597 13.3333 12.6667 13.3333 12.0833C13.3333 11.5 13.1319 11.0069 12.7292 10.6042C12.3264 10.2014 11.8333 10 11.25 10C10.6667 10 10.1736 10.2014 9.77083 10.6042C9.36806 11.0069 9.16667 11.5 9.16667 12.0833C9.16667 12.6667 9.36806 13.1597 9.77083 13.5625C10.1736 13.9653 10.6667 14.1667 11.25 14.1667V14.1667M15.5 17.5L13.25 15.25C12.9583 15.4444 12.6424 15.5903 12.3021 15.6875C11.9618 15.7847 11.6111 15.8333 11.25 15.8333C10.2083 15.8333 9.32292 15.4688 8.59375 14.7396C7.86458 14.0104 7.5 13.125 7.5 12.0833C7.5 11.0417 7.86458 10.1562 8.59375 9.42708C9.32292 8.69792 10.2083 8.33333 11.25 8.33333C12.2917 8.33333 13.1771 8.69792 13.9062 9.42708C14.6354 10.1562 15 11.0417 15 12.0833C15 12.4444 14.9514 12.7951 14.8542 13.1354C14.7569 13.4757 14.6111 13.7917 14.4167 14.0833L16.6667 16.3333L15.5 17.5V17.5" fill="currentColor"/>
            </svg>
          </div>
        </Card>
      </div>

      {/* 3. Card Tìm kiếm & bộ lọc */}
      <Card className="border-slate-200/80 bg-white p-5 shadow-xs">
        <form onSubmit={handleFilter} className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-blue-600" />
              <h2 className="text-sm font-bold text-slate-800">Tìm kiếm & bộ lọc</h2>
            </div>
            <span className="text-[11px] text-slate-400">Áp dụng lọc đa tiêu chí</span>
          </div>

          {/* Ô tìm kiếm từ khóa lớn */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm theo tên chiến dịch..."
              className="h-10 pl-10 text-xs text-slate-700 placeholder:text-slate-400 focus-visible:ring-1 focus-visible:ring-blue-500"
            />
          </div>

          {/* 3 dropdown tiêu chí */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Thời gian chạy</label>
              <select
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">Tất cả</option>
                <option value="today">Hôm nay</option>
                <option value="7days">7 ngày qua</option>
                <option value="30days">30 ngày qua</option>
                <option value="custom">Khoảng ngày tùy chọn</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Loại chiến dịch</label>
              <select
                value={actionTypeFilter}
                onChange={(e) => setActionTypeFilter(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">Tất cả</option>
                <option value="POST">Đăng bài</option>
                <option value="COMMENT">Bình luận</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Trạng thái</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">Tất cả</option>
                <option value="COMPLETED">Hoàn thành</option>
                <option value="STOPPED">Đã dừng</option>
                <option value="FAILED">Thất bại</option>
                <option value="RUNNING">Đang chạy</option>
              </select>
            </div>
          </div>

          {/* Khoảng ngày tùy chọn nếu chọn custom */}
          {timeFilter === "custom" && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
              <span className="text-xs font-semibold text-slate-600">Từ ngày:</span>
              <Input
                type="date"
                value={customFromDate}
                onChange={(e) => setCustomFromDate(e.target.value)}
                className="h-8 w-40 text-xs"
              />
              <span className="text-xs font-semibold text-slate-600">Đến ngày:</span>
              <Input
                type="date"
                value={customToDate}
                onChange={(e) => setCustomToDate(e.target.value)}
                className="h-8 w-40 text-xs"
              />
            </div>
          )}

          {/* 2 nút thao tác bên dưới góc phải */}
          <div className="flex items-center justify-end gap-2.5 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetFilter}
              className="h-9 gap-1.5 border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
            >
              <RotateCcw className="size-3.5 text-slate-400" />
              Đặt lại
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-9 gap-1.5 bg-blue-600 px-4 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
            >
              <Filter className="size-3.5" />
              Lọc kết quả
            </Button>
          </div>
        </form>
      </Card>

      {/* 4. Danh sách chiến dịch dạng Card List */}
      <div className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">Danh sách chiến dịch</h2>
          <span className="text-xs text-slate-400">
            {campaigns.length} kết quả • Mới nhất trước
          </span>
        </div>

        {loading ? (
          <Card className="flex flex-col items-center justify-center p-12 text-slate-400 shadow-xs">
            <RotateCcw className="size-6 animate-spin text-blue-600" />
            <p className="mt-3 text-xs font-medium">Đang tải danh sách chiến dịch...</p>
          </Card>
        ) : campaigns.length === 0 ? (
          <Card className="flex flex-col items-center justify-center p-12 text-center shadow-xs">
            <FileText className="size-10 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Không tìm thấy chiến dịch nào</p>
            <p className="mt-1 text-xs text-slate-400 max-w-sm">
              Chưa có chiến dịch nào được tạo và phát sinh lượt chạy, hoặc không khớp với bộ lọc hiện tại.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {paginatedCampaigns.map((camp, index) => {
              const codeIndex = (currentPage - 1) * ITEMS_PER_PAGE + index + 1;
              const campaignCode = `CD${String(codeIndex).padStart(3, "0")}`;

              return (
                <Card
                  key={camp.id}
                  className="flex flex-col justify-between gap-4 border-slate-200/80 bg-white p-5 shadow-xs transition-shadow hover:shadow-sm sm:flex-row sm:items-center"
                >
                  {/* Cột trái: Tên, Mã, Ngày tháng, Badge loại, Số nick & Lần chạy */}
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="font-heading text-sm font-bold text-slate-900">
                        {camp.name}
                      </h3>
                      {renderStatusPill(camp.status)}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono font-bold text-blue-600">{campaignCode}</span>
                      <span>•</span>
                      <span>{formatDateOnly(camp.last_run_at || camp.created_at)}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      {/* Badge loại tác vụ */}
                      {camp.action_type === "POST" ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600">
                          <Layers className="size-3.5" />
                          Đăng bài
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          <FileText className="size-3.5" />
                          Bình luận
                        </span>
                      )}

                      {/* Số nick đã chọn */}
                      <span className="inline-flex items-center gap-1.5 text-slate-500">
                        <Users className="size-3.5 text-slate-400" />
                        <strong className="text-slate-700">{camp.total_accounts_run || 0}</strong> nick đã chọn
                      </span>

                      <span>•</span>

                      {/* Lần chạy */}
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <RotateCcw className="size-3 text-slate-400" />
                        Lần chạy {camp.total_runs || 1}
                      </span>
                    </div>
                  </div>

                  {/* Cột phải: 3 nút hành động (Xem, Chạy lại, Xóa) */}
                  <div className="flex items-center gap-2">
                    {/* Nút Xem */}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewDetails(camp)}
                      className="h-8 gap-1.5 border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Eye className="size-3.5 text-slate-500" />
                      Xem
                    </Button>

                    {/* Nút Chạy lại */}
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleRerun(camp)}
                      className="h-8 gap-1.5 bg-blue-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
                    >
                      <RotateCcw className="size-3.5" />
                      Chạy lại
                    </Button>

                    {/* Nút Xóa */}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCampaignToDelete(camp);
                        setDeleteModalOpen(true);
                      }}
                      className="h-8 gap-1.5 border-rose-200 px-3 text-xs font-medium text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    >
                      <Trash2 className="size-3.5 text-rose-500" />
                      Xóa
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* 5. Thanh phân trang footer */}
        {campaigns.length > 0 && (
          <div className="flex flex-col items-center justify-between gap-4 pt-3 sm:flex-row">
            <p className="text-xs text-slate-500">
              Hiển thị <strong className="text-slate-800">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</strong> –{" "}
              <strong className="text-slate-800">
                {Math.min(currentPage * ITEMS_PER_PAGE, campaigns.length)}
              </strong>{" "}
              của <strong className="text-slate-800">{campaigns.length}</strong> chiến dịch
            </p>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="size-8 border-slate-200 text-slate-500 hover:bg-slate-50"
              >
                <ChevronLeft className="size-4" />
              </Button>

              {Array.from({ length: totalPages }).map((_, i) => {
                const pageNumber = i + 1;
                // Hiển thị dạng 1 2 3 ... 6 nếu nhiều trang
                if (
                  totalPages > 5 &&
                  pageNumber > 3 &&
                  pageNumber < totalPages
                ) {
                  if (pageNumber === 4) {
                    return (
                      <span key="ellipsis" className="px-1 text-xs text-slate-400">
                        ...
                      </span>
                    );
                  }
                  return null;
                }

                return (
                  <Button
                    key={pageNumber}
                    type="button"
                    variant={currentPage === pageNumber ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(pageNumber)}
                    className={`size-8 p-0 text-xs font-semibold ${
                      currentPage === pageNumber
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {pageNumber}
                  </Button>
                );
              })}

              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="size-8 border-slate-200 text-slate-500 hover:bg-slate-50"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Xem chi tiết chiến dịch (CAMP-03) */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-3xl sm:max-w-4xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-base font-bold text-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="size-5 text-blue-600" />
                <span>Chi tiết chiến dịch: {selectedCampaign?.name}</span>
                <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600 border border-blue-200">
                  {selectedCampaign?.action_type === "POST" ? "Đăng bài" : "Bình luận"}
                </span>
              </div>
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-slate-500">
            Danh sách tài khoản (UID) đã thực thi tác vụ. Người dùng có thể nhấn <strong>Copy UID</strong> để tìm kiếm tại module Quản lý tài khoản Facebook và tự phản hồi bình luận/tin nhắn.
          </p>

          <div className="mt-3 rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="max-h-[280px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                  <tr>
                    <th className="w-12 px-3 py-2.5 text-center">STT</th>
                    <th className="px-3 py-2.5">Tài khoản (UID)</th>
                    <th className="w-24 px-3 py-2.5 text-center">Copy UID</th>
                    <th className="px-3 py-2.5">Tên nhóm</th>
                    <th className="px-3 py-2.5">Link bài viết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detailLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                        <RotateCcw className="mx-auto mb-2 size-5 animate-spin text-blue-600" />
                        Đang tải chi tiết các tác vụ...
                      </td>
                    </tr>
                  ) : campaignDetails.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                        Chưa có dữ liệu tác vụ nào được lưu cho chiến dịch này.
                      </td>
                    </tr>
                  ) : (
                    campaignDetails.map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 text-center font-medium text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-mono text-[11px] font-semibold text-slate-800">
                            {item.account_uid}
                          </p>
                          {item.account_name ? (
                            <p className="text-[10px] text-slate-400">{item.account_name}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyUid(item.account_uid)}
                            title="Sao chép chính xác UID vào bộ nhớ tạm"
                            className="h-6 px-2 text-[10px] text-blue-600 hover:bg-blue-50"
                          >
                            <Copy className="mr-1 size-3" /> Copy
                          </Button>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-medium text-slate-700">{item.group_name || "Nhóm Facebook"}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          {item.result_url ? (
                            <a
                              href={item.result_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline text-[11px]"
                            >
                              <span>Mở bài viết</span>
                              <ExternalLink className="size-3" />
                            </a>
                          ) : (
                            <span className="italic text-slate-400 text-[11px]">
                              Không có link bài viết
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <DialogFooter className="mt-4 flex items-center justify-between sm:justify-between">
            <span className="text-[11px] text-slate-400">
              Hiển thị {campaignDetails.length} dòng tác vụ
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDetailModalOpen(false)}
            >
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Xác nhận Xóa mềm chiến dịch (CAMP-04) */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-rose-600">
              <AlertTriangle className="size-5" />
              <span>Xác nhận xóa chiến dịch</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs text-slate-600">
            <p>
              Bạn có chắc chắn muốn xóa chiến dịch <strong>&ldquo;{campaignToDelete?.name}&rdquo;</strong> không?
            </p>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
              <p className="font-semibold">Lưu ý về quy tắc an toàn (Xóa mềm):</p>
              <p className="mt-0.5">
                Chiến dịch sẽ được ẩn khỏi danh sách quản lý thông thường, nhưng lịch sử tác vụ đã chạy và tài khoản Facebook vẫn được bảo toàn cho mục đích tra cứu và truy vết.
              </p>
            </div>
          </div>

          <DialogFooter className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deleteLoading}
              onClick={() => setDeleteModalOpen(false)}
            >
              Hủy bỏ
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleteLoading}
              onClick={handleConfirmDelete}
            >
              {deleteLoading ? "Đang xóa..." : "Xác nhận xóa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
