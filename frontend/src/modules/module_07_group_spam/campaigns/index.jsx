"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { PageHeader, SearchFilterCard, StatCard } from "../shared/components";
import {
  getGroupCampaigns,
  getGroupCampaignDetails,
  getGroupCampaignRerunConfig,
  deleteGroupCampaign,
} from "../service";

import CampaignDetailModule from "./detail";

const ITEMS_PER_PAGE = 4;

export default function GroupCampaignsModule() {
  const router = useRouter();

  // Xem chi tiết dạng Full Page giống Figma
  const [activeDetailCampaign, setActiveDetailCampaign] = useState(null);

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

  // Thống kê nhanh từ danh sách
  const stats = useMemo(() => {
    const total = campaigns.length;
    const completed = campaigns.filter((c) => c.status === "COMPLETED").length;
    const totalInteractions = campaigns.reduce((acc, c) => acc + (c.total_interactions || 0), 0);

    const formatK = (num) => {
      if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
      return num;
    };

    return {
      total,
      completed,
      interactions: formatK(totalInteractions),
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

  // Xem chi tiết (CAMP-03): Hiển thị giao diện trang chi tiết đầy đủ giống thiết kế Figma
  const handleViewDetails = (campaign) => {
    if (!campaign) return;
    setActiveDetailCampaign(campaign);
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

      if (String(campaign.action_type || "").toUpperCase() === "COMMENT") {
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

  if (activeDetailCampaign) {
    return (
      <CampaignDetailModule
        campaignId={activeDetailCampaign.id}
        onBack={() => {
          setActiveDetailCampaign(null);
          loadCampaigns();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* 1. Header & Nút Xuất dữ liệu */}
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

      {/* 2. Hàng 3 Card Thống kê chỉ số (Overview Cards) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Tổng chiến dịch"
          value={stats.total}
          description="Khớp với bộ lọc hiện tại"
          tone="primary"
          icon={<Megaphone className="size-4" />}
        />
        <StatCard
          title="Chiến dịch hoàn thành"
          value={stats.completed}
          description="Chiến dịch đã chạy xong toàn bộ"
          tone="emerald"
          icon={<CheckCircle2 className="size-4" />}
        />
        <StatCard
          title="Tương tác đã tạo"
          value={stats.interactions}
          description="Tổng lượt đăng bài & bình luận thành công"
          tone="primary"
          icon={<TrendingUp className="size-4" />}
        />
      </div>

      {/* 3. Card Tìm kiếm & bộ lọc */}
      <SearchFilterCard
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Tìm kiếm theo tên chiến dịch..."
        fields={[
          {
            key: "time",
            label: "Thời gian chạy",
            value: timeFilter,
            onChange: setTimeFilter,
            options: [
              { value: "all", label: "Tất cả" },
              { value: "today", label: "Hôm nay" },
              { value: "7days", label: "7 ngày qua" },
              { value: "30days", label: "30 ngày qua" },
              { value: "custom", label: "Khoảng ngày tùy chọn" },
            ],
          },
          {
            key: "action_type",
            label: "Loại chiến dịch",
            value: actionTypeFilter,
            onChange: setActionTypeFilter,
            options: [
              { value: "ALL", label: "Tất cả" },
              { value: "POST", label: "Đăng bài" },
              { value: "COMMENT", label: "Bình luận" },
            ],
          },
          {
            key: "status",
            label: "Trạng thái",
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
              { value: "ALL", label: "Tất cả" },
              { value: "COMPLETED", label: "Hoàn thành" },
              { value: "STOPPED", label: "Đã dừng" },
              { value: "FAILED", label: "Thất bại" },
              { value: "RUNNING", label: "Đang chạy" },
            ],
          },
        ]}
        showCustomDate={timeFilter === "custom"}
        fromDate={customFromDate}
        onFromDateChange={setCustomFromDate}
        toDate={customToDate}
        onToDateChange={setCustomToDate}
        onReset={handleResetFilter}
        onSubmit={handleFilter}
        submitLabel="Lọc kết quả"
      />

      {/* 4. Danh sách chiến dịch (shadcn Table) */}
      <div className="space-y-3.5">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[88px]">Mã</TableHead>
              <TableHead className="min-w-[220px]">Tên chiến dịch</TableHead>
              <TableHead>Loại</TableHead>
              <TableHead>Số nick</TableHead>
              <TableHead>Lần chạy</TableHead>
              <TableHead>Ngày chạy</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center">
                    <RotateCcw className="size-6 animate-spin text-blue-600" />
                    <p className="mt-3 text-xs font-medium">Đang tải danh sách chiến dịch...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : campaigns.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <FileText className="size-10 text-slate-300" />
                    <p className="mt-3 text-sm font-semibold text-slate-700">
                      Không tìm thấy chiến dịch nào
                    </p>
                    <p className="mt-1 max-w-sm text-xs text-slate-400">
                      Chưa có chiến dịch nào được tạo và phát sinh lượt chạy, hoặc không khớp với bộ lọc hiện tại.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedCampaigns.map((camp, index) => {
                const codeIndex = (currentPage - 1) * ITEMS_PER_PAGE + index + 1;
                const campaignCode = `CD${String(codeIndex).padStart(3, "0")}`;

                return (
                  <TableRow key={camp.id}>
                    <TableCell className="font-mono font-bold text-blue-600">
                      {campaignCode}
                    </TableCell>
                    <TableCell>
                      <span className="font-heading text-sm font-bold text-slate-900">
                        {camp.name}
                      </span>
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="size-3.5 text-slate-400" />
                        <strong className="text-slate-700">{camp.total_accounts_run || 0}</strong> tài khoản
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <RotateCcw className="size-3 text-slate-400" />
                        Lần chạy {camp.total_runs || 1}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-500">
                      {formatDateOnly(camp.last_run_at || camp.created_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {renderStatusPill(camp.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center justify-end gap-2">
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
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleRerun(camp)}
                          className="h-8 gap-1.5 bg-blue-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
                        >
                          <RotateCcw className="size-3.5" />
                          Chạy lại
                        </Button>
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
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

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
                    className={`size-8 p-0 text-xs font-semibold ${currentPage === pageNumber
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
