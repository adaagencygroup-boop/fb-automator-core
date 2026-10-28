"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Layers,
  RotateCcw,
  Search,
  CheckCircle2,
  XCircle,
  X,
  HelpCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { getGroupHistoryRecords, openGroupHistoryRecord } from "../service";

const taskStatusLabel = (status) => ({
  SUCCESS: "Thành công",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy",
  SKIPPED: "Bỏ qua",
  PENDING_APPROVAL: "Chờ duyệt",
  PENDING: "Đang chờ",
  RUNNING: "Đang chạy",
}[status] || status || "--");

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
    // Validate ngày: Từ ngày không được lớn hơn Đến ngày
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

  // Format thời gian hiển thị
  const formatTime = (timeStr) => {
    if (!timeStr) return "--:--";
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

  const handleOpenResult = async (item) => {
    if (!item?.id || openingRecordId) return;
    setOpeningRecordId(item.id);
    try {
      const response = await openGroupHistoryRecord(item.id);
      toast.success(
        response?.message || `Đang mở bài bằng tài khoản ${item.account_uid}`,
        "ĐANG MỞ CHROME PROFILE",
      );
    } catch (error) {
      toast.error(error.message || "Không thể mở bài bằng Chrome profile của tài khoản", "LỖI MỞ BÀI");
    } finally {
      setOpeningRecordId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-primary">
            <Clock className="size-6 text-primary" />
          </div>
          <div>
            <h1 className="font-heading text-xl font-bold tracking-tight text-slate-800">
              Lịch sử hoạt động Spam Group
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              Tra cứu lịch sử đăng bài và bình luận trong các nhóm Facebook, theo dõi kết quả xác minh và liên kết bài viết liên quan.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExportCSV}
          disabled={!records.length}
          className="border-slate-200 text-xs text-slate-700 hover:bg-slate-50"
        >
          <Download className="mr-1.5 size-3.5" /> Xuất file CSV
        </Button>
      </div>

      {/* 3 Thẻ thống kê (Chương 3 SRS - tính theo đúng bộ lọc) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Thẻ 1: Tổng tác vụ */}
        <Card className="border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Tổng tác vụ
            </p>
            <span className="flex size-7 items-center justify-center rounded-lg bg-blue-50 text-primary">
              <Layers className="size-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-800">{stats.total}</p>
          <p className="mt-1 text-[11px] text-slate-400">
            Khớp với bộ lọc hiện tại
          </p>
        </Card>

        {/* Thẻ 2: Thành công */}
        <Card className="border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
              Thành công
            </p>
            <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="size-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-800">{stats.success}</span>
            <span className="text-xs font-bold text-emerald-600">
              ({stats.success_rate})
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Tác vụ đã hoàn tất và xác nhận
          </p>
        </Card>

        {/* Thẻ 3: Thất bại */}
        <Card className="border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-rose-500">
              Thất bại
            </p>
            <span className="flex size-7 items-center justify-center rounded-lg bg-rose-50 text-rose-500">
              <XCircle className="size-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-800">{stats.failed}</span>
            <span className="text-xs font-bold text-rose-500">
              ({stats.failed_rate})
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Bị giới hạn hoặc phát sinh lỗi
          </p>
        </Card>
      </div>

      {/* Bộ lọc tìm kiếm (Chương 3 SRS 3.2.1) */}
      <Card className="border-slate-200 bg-white p-4 shadow-xs">
        <form onSubmit={handleFilter} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {/* 1. Tìm kiếm (tên chiến dịch, UID, link bài) */}
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Tìm chiến dịch, UID, link bài, nhóm..."
                className="pl-9 text-xs"
              />
            </div>

            {/* 2. Chiến dịch */}
            <div>
              <select
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="ALL">Chiến dịch: Tất cả</option>
                {campaignsList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Loại seeding */}
            <div>
              <select
                value={seedingType}
                onChange={(e) => setSeedingType(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="ALL">Trạng thái: Tất cả</option>
                <option value="SUCCESS">Thành công</option>
                <option value="FAILED">Thất bại</option>
              </select>
            </div>

            {/* 5. Nút Lọc & Đặt lại */}
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

          {/* Chọn thời gian */}
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-3.5 text-slate-400" />
              <span className="text-xs font-semibold text-slate-600">Thời gian:</span>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none"
              >
                <option value="all">Tất cả thời gian</option>
                <option value="today">Hôm nay</option>
                <option value="7days">7 ngày qua</option>
                <option value="30days">30 ngày qua</option>
                <option value="custom">Khoảng ngày tùy chọn</option>
              </select>
            </div>

            {timeRange === "custom" && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Từ:</span>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
                <span className="text-xs text-slate-500">Đến:</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 w-36 text-xs"
                />
              </div>
            )}

            {dateError && (
              <p className="flex items-center gap-1 text-[11px] font-medium text-rose-500">
                <AlertCircle className="size-3" /> {dateError}
              </p>
            )}
          </div>
        </form>
      </Card>

      {/* Danh sách lịch sử (Chương 3 SRS 3.2.3) */}
      <Card className="overflow-hidden border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Nhật ký tác vụ ({stats.total})
            </h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Hiển thị</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-7 rounded border border-slate-200 bg-white px-2 text-xs"
            >
              <option value="10">10 dòng</option>
              <option value="20">20 dòng</option>
              <option value="50">50 dòng</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
              <tr>
                <th className="w-12 px-3 py-3 text-center">STT</th>
                <th className="px-3 py-3">Thời gian</th>
                <th className="px-3 py-3">Loại</th>
                <th className="px-3 py-3">Chiến dịch</th>
                <th className="px-3 py-3">UID người dùng</th>
                <th className="px-3 py-3">UID nhóm</th>
                <th className="px-3 py-3">Nhóm Facebook</th>
                <th className="px-3 py-3">Nội dung</th>
                <th className="px-3 py-3">Trạng thái</th>
                <th className="px-3 py-3">Kết quả</th>
                <th className="px-3 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-400">
                    <RotateCcw className="mx-auto mb-2 size-5 animate-spin text-primary" />
                    Đang tải danh sách lịch sử...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <FileText className="size-8 text-slate-300" />
                      <p className="text-xs font-semibold text-slate-600">
                        Không tìm thấy lịch sử phù hợp
                      </p>
                      <p className="text-[11px] text-slate-400 max-w-sm">
                        Không có bản ghi tác vụ nào khớp với tiêu chí tìm kiếm và bộ lọc đang chọn.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                records.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-3 py-3 text-center font-medium text-slate-400 text-[11px]">
                      {item.stt}
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-slate-500">
                      {formatTime(item.time)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-[10px] font-bold ${
                          item.action_type === "POST"
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-purple-50 text-purple-700 border border-purple-200"
                        }`}
                      >
                        {item.action_type === "POST" ? "Đăng bài" : "Bình luận"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-semibold text-slate-800 line-clamp-1 max-w-[140px]" title={item.campaign_name}>
                        {item.campaign_name || "--"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-slate-600">
                      {item.account_uid}
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-slate-600">
                      {item.group_uid || "--"}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-medium text-slate-700 line-clamp-1 max-w-[150px]" title={item.group_name}>
                        {item.group_name || "Nhóm Facebook"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <p
                        onClick={() => setDetailItem(item)}
                        className="cursor-pointer text-slate-600 line-clamp-2 max-w-[200px] hover:text-primary transition-colors text-[11px]"
                        title="Bấm để xem nội dung đầy đủ"
                      >
                        {item.content || "--"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      {item.status === "SUCCESS" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="size-3 text-emerald-600" /> Thành công
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                          <XCircle className="size-3 text-rose-600" /> {taskStatusLabel(item.status)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-600 text-[11px]">
                      {item.result}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {item.result_url ? (
                        <button
                          type="button"
                          onClick={() => handleOpenResult(item)}
                          disabled={Boolean(openingRecordId)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-primary shadow-2xs hover:bg-slate-50"
                          title={`Mở bằng Chrome profile của UID ${item.account_uid}`}
                        >
                          {openingRecordId === item.id ? (
                            <RotateCcw className="size-3 animate-spin" />
                          ) : (
                            <ExternalLink className="size-3" />
                          )}
                          <span>{openingRecordId === item.id ? "Đang mở" : (item.has_permalink ? "Mở bài" : "Mở nhóm")}</span>
                        </button>
                      ) : (
                        <span className="text-[10px] italic text-slate-300" title="Không có liên kết được lưu">
                          Không có liên kết
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Phân trang */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs">
            <span className="text-slate-500">
              Trang {currentPage} / {totalPages} (Tổng số {stats.total} tác vụ)
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage <= 1 || loading}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="size-8 p-0"
              >
                <ChevronLeft className="size-3.5" />
              </Button>

              {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                const pageNum = idx + 1;
                return (
                  <Button
                    key={pageNum}
                    type="button"
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(pageNum)}
                    className="size-8 p-0 text-xs"
                  >
                    {pageNum}
                  </Button>
                );
              })}

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages || loading}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="size-8 p-0"
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Modal Xem chi tiết bài viết/bình luận khi click nội dung */}
      <Dialog open={Boolean(detailItem)} onOpenChange={(open) => !open && setDetailItem(null)}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <FileText className="size-4 text-primary" />
              <span>Nội dung chi tiết tác vụ</span>
            </DialogTitle>
          </DialogHeader>

          {detailItem && (
            <div className="space-y-3 py-2 text-xs">
              <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-2.5 text-[11px] text-slate-600">
                <div>
                  <span className="font-semibold text-slate-500">Tác vụ:</span>{" "}
                  {detailItem.action_type === "POST" ? "Đăng bài" : "Bình luận"}
                </div>
                <div>
                  <span className="font-semibold text-slate-500">Chiến dịch:</span>{" "}
                  {detailItem.campaign_name || "--"}
                </div>
                <div>
                  <span className="font-semibold text-slate-500">Tài khoản:</span>{" "}
                  {detailItem.account_uid}
                </div>
                <div>
                  <span className="font-semibold text-slate-500">Nhóm:</span>{" "}
                  {detailItem.group_name}
                </div>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-semibold text-slate-700">Nội dung đã gửi:</p>
                <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
                  {detailItem.content}
                </div>
              </div>

              {detailItem.result_url && (
                <div className="pt-1">
                  <a
                    href={detailItem.result_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
                  >
                    <span>Mở liên kết trên Facebook</span>
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDetailItem(null)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
