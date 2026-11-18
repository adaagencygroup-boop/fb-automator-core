"use client";

import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Layers,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatDateTime(timeStr) {
  if (!timeStr) return "--/--/---- --:--";
  try {
    const dt = new Date(timeStr);
    if (Number.isNaN(dt.getTime())) return timeStr;
    return dt.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return timeStr;
  }
}

const STATUS_STYLES = {
  COMPLETED: {
    pill: "bg-emerald-50 text-emerald-600",
    dot: "bg-emerald-500",
    label: "Thành công",
  },
  FAILED: {
    pill: "bg-rose-50 text-rose-600",
    dot: "bg-rose-500",
    label: "Thất bại",
  },
};

function StatusPill({ status }) {
  const normalized = String(status || "").toUpperCase() === "COMPLETED" ? "COMPLETED" : "FAILED";
  const style = STATUS_STYLES[normalized];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${style.pill}`}>
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

export default function CampaignTableSection({
  campaigns,
  paginatedCampaigns,
  loading,
  currentPage,
  totalPages,
  itemsPerPage,
  onPageChange,
  onView,
  onRerun,
  onDelete,
}) {
  return (
    <div className="space-y-3.5">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[88px]">Mã</TableHead>
            <TableHead className="min-w-[200px]">Tên chiến dịch</TableHead>
            <TableHead>Loại</TableHead>
            <TableHead>Số Tài khoản</TableHead>
            <TableHead>Lần chạy</TableHead>
            <TableHead>Ngày chạy</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead className="text-right">Thao tác</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 5 }, (_, idx) => (
              <TableRow key={`camp-skeleton-${idx}`}>
                <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                <TableCell><Skeleton className="h-4 w-44" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center justify-end gap-3">
                    <Skeleton className="size-5 rounded" />
                    <Skeleton className="size-5 rounded" />
                    <Skeleton className="size-5 rounded" />
                  </div>
                </TableCell>
              </TableRow>
            ))
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
              const codeIndex = (currentPage - 1) * itemsPerPage + index + 1;
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
                  <TableCell className="capitalize">
                    {camp.action_type === "POST" ? "Đăng bài" : "Bình luận"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600 ">
                    <strong className="text-slate-700 ">{camp.total_accounts_run}</strong>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <b>    {camp.total_runs}</b>
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600">
                    {formatDateTime(camp.last_run_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <StatusPill status={camp.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center justify-end gap-4">
                      <Eye
                        className="size-5 cursor-pointer text-slate-500 transition-colors hover:text-slate-900"
                        title="Xem chi tiết"
                        aria-label="Xem chi tiết"
                        onClick={() => onView(camp)}
                      />
                      <RotateCcw
                        className="size-5 cursor-pointer text-blue-600 transition-colors hover:text-blue-700"
                        title="Chạy lại chiến dịch"
                        aria-label="Chạy lại chiến dịch"
                        onClick={() => onRerun(camp)}
                      />
                      <Trash2
                        className="size-5 cursor-pointer text-rose-500 transition-colors hover:text-rose-700"
                        title="Xóa chiến dịch"
                        aria-label="Xóa chiến dịch"
                        onClick={() => onDelete(camp)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {campaigns.length > 0 && (
        <div className="flex flex-col items-center justify-between gap-4 pt-3 sm:flex-row">
          <p className="text-xs text-slate-500">
            Hiển thị <strong className="text-slate-800">{(currentPage - 1) * itemsPerPage + 1}</strong> –{" "}
            <strong className="text-slate-800">
              {Math.min(currentPage * itemsPerPage, campaigns.length)}
            </strong>{" "}
            của <strong className="text-slate-800">{campaigns.length}</strong> chiến dịch
          </p>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={currentPage === 1}
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              className="size-8 border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              <ChevronLeft className="size-4" />
            </Button>

            {Array.from({ length: totalPages }).map((_, i) => {
              const pageNumber = i + 1;
              if (totalPages > 5 && pageNumber > 3 && pageNumber < totalPages) {
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
                  onClick={() => onPageChange(pageNumber)}
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
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              className="size-8 border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
