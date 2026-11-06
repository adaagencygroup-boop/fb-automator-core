"use client";

import {
  Search,
  Users,
  FileText,
  RefreshCw,
  Clock,
  Eye,
  Trash2,
  Loader2,
  Layers,
} from "lucide-react";
import Pagination from "@/components/ui/pagination";
import CustomSelect from "@/components/ui/custom-select";

const PAGE_SIZE_OPTIONS = [
  { value: 10, label: "10" },
  { value: 20, label: "20" },
  { value: 50, label: "50" },
];

export function renderTypeBadge(type) {
  switch (type) {
    case "GROUP_INFO":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <Search className="size-3" />
          <span>Quét nhóm</span>
        </span>
      );
    case "MEMBERS":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
          <Users className="size-3" />
          <span>Quét thành viên</span>
        </span>
      );
    case "POSTS":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <FileText className="size-3" />
          <span>Quét bài viết</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-50 text-slate-700 border border-slate-200">
          <Search className="size-3" />
          <span>{type || "Quét nhóm"}</span>
        </span>
      );
  }
}

export function renderStatusBadge(status) {
  switch (status) {
    case "SUCCESS":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span>Hoàn thành</span>
        </span>
      );
    case "RUNNING":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
          <RefreshCw className="size-3 animate-spin text-blue-600" />
          <span>Đang quét</span>
        </span>
      );
    case "PAUSED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <span className="size-1.5 rounded-full bg-amber-500" />
          <span>Tạm dừng</span>
        </span>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          <span className="size-1.5 rounded-full bg-rose-500" />
          <span>Thất bại</span>
        </span>
      );
    default:
      return null;
  }
}

export default function HistoryDataTable({
  loading,
  paginatedList,
  totalFilteredCount,
  selectedIds,
  onSelectAll,
  onSelectOne,
  onViewDetail,
  onRerun,
  onDeleteOne,
  currentPage,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
}) {
  return (
    <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-xs overflow-hidden flex flex-col">
      {/* Table Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 bg-[#F8FAFC]/50 border-b border-[#F1F5F9]">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#1E293B]">
            NHẬT KÝ CÁC PHIÊN QUÉT NHÓM
          </h2>
          <span className="rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">
            {totalFilteredCount} phiên ghi nhận
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-[#64748B]">
          <span>
            Đã chọn: <b className="text-[#0F172A]">{selectedIds.size}</b> phiên
          </span>
        </div>
      </div>

      {/* Table View */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[11px] font-bold uppercase tracking-wider text-[#475569]">
            <tr>
              <th className="py-3 px-4 w-10 text-center">
                <input
                  type="checkbox"
                  checked={
                    paginatedList.length > 0 &&
                    paginatedList.every((item) => selectedIds.has(item.id))
                  }
                  onChange={(e) => onSelectAll(e.target.checked)}
                  className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </th>
              <th className="py-3 px-4 min-w-[170px]">Mã phiên & Loại quét</th>
              <th className="py-3 px-4 min-w-[220px]">Mục tiêu / Từ khóa</th>
              <th className="py-3 px-4 min-w-[180px]">Tài khoản thực thi</th>
              <th className="py-3 px-4 min-w-[170px]">Tiến độ & Kết quả</th>
              <th className="py-3 px-4 min-w-[150px]">Thời gian & Thời lượng</th>
              <th className="py-3 px-4 min-w-[120px]">Trạng thái</th>
              <th className="py-3 px-4 min-w-[120px] text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9] text-[#1E293B]">
            {loading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Đang tải lịch sử phiên quét từ Database...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedList.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-[#94A3B8]">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Layers className="size-8 text-slate-300 stroke-[1.5]" />
                    <p className="font-semibold text-slate-600">
                      Chưa có phiên quét nào được lưu trong Database
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Hãy chuyển qua tab Quét thông tin nhóm để bắt đầu quét các nhóm Facebook
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedList.map((item) => {
                const isChecked = selectedIds.has(item.id);
                return (
                  <tr
                    key={item.id}
                    className={`hover:bg-[#F8FAFC] transition-colors ${
                      isChecked ? "bg-blue-50/40" : ""
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="py-3 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => onSelectOne(item.id, e.target.checked)}
                        className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>

                    {/* Mã phiên & Loại quét */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-bold text-[#0F172A] tracking-tight">
                          #{item.id}
                        </span>
                        {renderTypeBadge(item.type)}
                      </div>
                    </td>

                    {/* Mục tiêu / Từ khóa */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1 max-w-[260px]">
                        <span
                          className="font-semibold text-[#0F172A] truncate"
                          title={item.target}
                        >
                          {item.target}
                        </span>
                        <span className="text-[11px] text-[#64748B]">
                          {item.title}
                        </span>
                      </div>
                    </td>

                    {/* Tài khoản thực thi */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`size-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0 ${
                            item.account?.avatarBg || "bg-blue-600"
                          }`}
                        >
                          {item.account?.avatarText || "FB"}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold text-[#0F172A] truncate text-[11px]">
                            {item.account?.name || item.account?.uid || "Tài khoản quét"}
                          </span>
                          <span className="text-[10px] text-[#64748B] font-mono">
                            {item.account?.uid}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Tiến độ & Kết quả */}
                    <td className="py-3 px-4">
                      <div className="space-y-1.5 w-36">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-[#0F172A]">
                            {item.progress?.collected || 0} /{" "}
                            {item.progress?.target || 0}
                          </span>
                          <span className="font-medium text-[#64748B]">
                            {item.progress?.percentage || 0}%
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="h-1.5 w-full rounded-full bg-[#E2E8F0] overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              item.status === "FAILED"
                                ? "bg-rose-500"
                                : item.status === "PAUSED"
                                ? "bg-amber-500"
                                : (item.progress?.percentage || 0) >= 100
                                ? "bg-emerald-500"
                                : "bg-[#2563EB]"
                            }`}
                            style={{
                              width: `${Math.min(
                                100,
                                item.progress?.percentage || 0
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-[#94A3B8]">
                          Đơn vị: {item.progress?.unit || "nhóm"}
                        </span>
                      </div>
                    </td>

                    {/* Thời gian & Thời lượng */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[#334155] font-medium text-[11px]">
                          {item.startTime}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-[#64748B]">
                          <Clock className="size-3 text-slate-400" />
                          <span>{item.duration || "—"}</span>
                        </span>
                      </div>
                    </td>

                    {/* Trạng thái */}
                    <td className="py-3 px-4">
                      {renderStatusBadge(item.status)}
                    </td>

                    {/* Thao tác */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Nút Xem chi tiết */}
                        <button
                          type="button"
                          onClick={() => onViewDetail(item)}
                          title="Xem chi tiết phiên quét"
                          className="size-7 rounded-lg border border-[#E2E8F0] hover:border-[#2563EB] hover:text-[#2563EB] flex items-center justify-center text-[#475569] transition-colors"
                        >
                          <Eye className="size-3.5" />
                        </button>

                        {/* Nút Quét lại */}
                        <button
                          type="button"
                          onClick={() => onRerun(item)}
                          title="Chạy lại phiên quét này"
                          className="size-7 rounded-lg border border-[#E2E8F0] hover:border-emerald-600 hover:text-emerald-600 flex items-center justify-center text-[#475569] transition-colors"
                        >
                          <RefreshCw className="size-3.5" />
                        </button>

                        {/* Nút Xóa */}
                        <button
                          type="button"
                          onClick={() => onDeleteOne(item.id)}
                          title="Xóa phiên khỏi Database"
                          className="size-7 rounded-lg border border-[#E2E8F0] hover:border-rose-500 hover:text-rose-500 flex items-center justify-center text-[#475569] transition-colors"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-[#F1F5F9] bg-[#F8FAFC]/40 text-xs text-[#64748B]">
        <div className="flex items-center gap-2">
          <span>Hiển thị</span>
          <CustomSelect
            value={pageSize}
            onChange={onPageSizeChange}
            options={PAGE_SIZE_OPTIONS}
            size="sm"
            direction="up"
            className="w-16"
            buttonClassName="h-7 px-2 text-xs"
          />
          <span>
            trên tổng số <b>{totalFilteredCount}</b> phiên
          </span>
        </div>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      </div>
    </div>
  );
}

