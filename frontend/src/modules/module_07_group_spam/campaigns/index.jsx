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
import {
  getGroupCampaigns,
  getGroupCampaignDetails,
  getGroupCampaignRerunConfig,
  deleteGroupCampaign,
} from "../service";

export default function GroupCampaignsModule() {
  const router = useRouter();

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

  // Modal Chi tiết chiến dịch (CAMP-03)
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignDetails, setCampaignDetails] = useState([]);

  // Modal Xóa chiến dịch (CAMP-04)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

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
      setCampaigns(res.campaigns || []);
    } catch (err) {
      toast.error(err.message || "Không thể tải danh sách chiến dịch", "LỖI TẢI DỮ LIỆU");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, [timeFilter, actionTypeFilter, statusFilter]);

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

  // Xem chi tiết (CAMP-03)
  const handleViewDetails = async (campaign) => {
    setSelectedCampaign(campaign);
    setDetailModalOpen(true);
    setDetailLoading(true);
    try {
      const res = await getGroupCampaignDetails(campaign.id);
      setCampaignDetails(res.details || []);
    } catch (err) {
      toast.error(err.message || "Không thể tải chi tiết chiến dịch", "LỖI TẢI DỮ LIỆU");
    } finally {
      setDetailLoading(false);
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
      // Lưu vào sessionStorage để trang Đăng bài/Bình luận đọc khi mở
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

  // Format thời gian
  const formatTime = (timeStr) => {
    if (!timeStr) return "Chưa chạy";
    try {
      const dt = new Date(timeStr);
      return dt.toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return timeStr;
    }
  };

  // Helper render badge trạng thái
  const renderStatusBadge = (status) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="size-3 text-emerald-600" /> Hoàn thành
          </span>
        );
      case "STOPPED":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 border border-slate-200">
            <Clock className="size-3 text-slate-500" /> Đã dừng
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-200">
            <XCircle className="size-3 text-rose-600" /> Thất bại
          </span>
        );
      case "RUNNING":
      case "QUEUED":
      case "SCHEDULED":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200">
            <RotateCcw className="size-3 animate-spin text-amber-600" /> Đang chạy
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-xl font-bold tracking-tight text-slate-900">
          Quản lý chiến dịch Spam Group
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Tra cứu các chiến dịch đã chạy, xem chi tiết danh sách tài khoản Facebook (UID), nhóm và link bài viết đã lưu để kiểm tra và phản hồi thủ công.
        </p>
      </div>

      {/* Bộ lọc (CAMP-02) */}
      <Card className="border-slate-200 bg-white p-4 shadow-xs">
        <form onSubmit={handleFilter} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {/* 1. Tìm kiếm tên chiến dịch */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên chiến dịch..."
                className="pl-9 text-xs"
              />
            </div>

            {/* 2. Thời gian chạy */}
            <div>
              <select
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="all">Thời gian: Tất cả</option>
                <option value="today">Hôm nay</option>
                <option value="7days">7 ngày qua</option>
                <option value="30days">30 ngày qua</option>
                <option value="custom">Khoảng ngày tùy chọn</option>
              </select>
            </div>

            {/* 3. Loại tác vụ */}
            <div>
              <select
                value={actionTypeFilter}
                onChange={(e) => setActionTypeFilter(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="ALL">Loại: Tất cả</option>
                <option value="POST">Đăng bài</option>
                <option value="COMMENT">Bình luận</option>
              </select>
            </div>

            {/* 4. Trạng thái */}
            <div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="ALL">Trạng thái: Tất cả</option>
                <option value="COMPLETED">Hoàn thành</option>
                <option value="STOPPED">Đã dừng</option>
                <option value="FAILED">Thất bại</option>
                <option value="RUNNING">Đang chạy / Chờ chạy</option>
              </select>
            </div>

            {/* Nút Lọc & Đặt lại */}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" className="flex-1 bg-primary text-white hover:bg-primary/90 text-xs">
                <Filter className="mr-1.5 size-3.5" /> Lọc
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetFilter}
                className="text-xs"
              >
                <RotateCcw className="mr-1.5 size-3" /> Đặt lại
              </Button>
            </div>
          </div>

          {/* Khoảng ngày tùy chọn nếu chọn custom */}
          {timeFilter === "custom" && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
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
        </form>
      </Card>

      {/* Bảng danh sách chiến dịch (CAMP-01) */}
      <Card className="overflow-hidden border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-primary" />
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Danh sách chiến dịch ({campaigns.length})
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">
            Sắp xếp: Thời gian chạy gần nhất giảm dần
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
              <tr>
                <th className="w-12 px-4 py-3 text-center">STT</th>
                <th className="px-4 py-3">Tên chiến dịch</th>
                <th className="px-4 py-3">Loại</th>
                <th className="px-4 py-3">Ngày chạy gần nhất</th>
                <th className="px-4 py-3 text-center">Tổng nick đã chạy</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    <RotateCcw className="mx-auto mb-2 size-5 animate-spin text-primary" />
                    Đang tải danh sách chiến dịch...
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <FileText className="size-8 text-slate-300" />
                      <p className="text-xs font-semibold text-slate-600">
                        Không tìm thấy chiến dịch nào
                      </p>
                      <p className="text-[11px] text-slate-400 max-w-sm">
                        Chưa có chiến dịch nào được tạo và phát sinh lượt chạy, hoặc không khớp với bộ lọc hiện tại.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                campaigns.map((camp, idx) => (
                  <tr key={camp.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 text-center font-medium text-slate-400">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-semibold text-slate-800">{camp.name}</p>
                        {camp.description ? (
                          <p className="line-clamp-1 text-[11px] text-slate-400">
                            {camp.description}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-[10px] font-bold ${
                          camp.action_type === "POST"
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-purple-50 text-purple-700 border border-purple-200"
                        }`}
                      >
                        {camp.action_type === "POST" ? "Đăng bài" : "Bình luận"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500 text-[11px]">
                      {formatTime(camp.last_run_at)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                        <Users className="size-3 text-slate-500" />
                        {camp.total_accounts_run}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {renderStatusBadge(camp.status)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* 1. Xem chi tiết (CAMP-03) */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewDetails(camp)}
                          title="Xem chi tiết các UID, nhóm và link bài"
                          className="h-7 px-2 text-[11px] text-slate-600"
                        >
                          <Eye className="mr-1 size-3 text-slate-500" /> Xem
                        </Button>

                        {/* 2. Chạy lại (CAMP-05 / CAMP-RUN-01) */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleRerun(camp)}
                          title="Nạp cấu hình và chạy lại chiến dịch"
                          className="h-7 px-2 text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        >
                          <RotateCcw className="mr-1 size-3 text-blue-600" /> Chạy lại
                        </Button>

                        {/* 3. Xóa mềm (CAMP-04) */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCampaignToDelete(camp);
                            setDeleteModalOpen(true);
                          }}
                          title="Xóa chiến dịch khỏi danh sách"
                          className="h-7 px-2 text-[11px] text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal Xem chi tiết chiến dịch (CAMP-03) */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-3xl sm:max-w-4xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-base font-bold text-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="size-5 text-primary" />
                <span>Chi tiết chiến dịch: {selectedCampaign?.name}</span>
                <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-primary border border-blue-200">
                  {selectedCampaign?.action_type === "POST" ? "Đăng bài" : "Bình luận"}
                </span>
              </div>
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-slate-500">
            Danh sách tài khoản (UID) đã thực thi tác vụ. Người dùng có thể nhấn <strong>Copy UID</strong> để tìm kiếm tại module Quản lý tài khoản Facebook và tự phản hồi bình luận/tin nhắn.
          </p>

          {/* Vùng cuộn khoảng 5 dòng (chiều cao ~260px) theo đúng SRS 4.4 */}
          <div className="mt-3 rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="max-h-[260px] overflow-y-auto">
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
                        <RotateCcw className="mx-auto mb-2 size-5 animate-spin text-primary" />
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
                            className="h-6 px-2 text-[10px] text-primary hover:bg-primary-subtle"
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
                              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline text-[11px]"
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
