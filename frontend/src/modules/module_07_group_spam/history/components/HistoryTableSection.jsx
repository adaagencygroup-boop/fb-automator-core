"use client";

import React from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function taskStatusLabel(status) {
  return status === "SUCCESS" ? "Thành công" : "Thất bại";
}

function formatTime(timeStr) {
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
}

export default function HistoryTableSection({
  records,
  totalCount,
  loading,
  currentPage,
  totalPages,
  onPageChange,
  openingRecordId,
  onOpenResult,
  onSelectDetail,
}) {
  return (
    <Card className="overflow-hidden border-slate-200 bg-white shadow-xs">
      <div className="overflow-x-auto">
        <Table className="text-sm">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-14 text-center">STT</TableHead>
              <TableHead className="w-[145px]">Thời gian</TableHead>
              <TableHead className="w-[100px]">Loại</TableHead>
              <TableHead className="min-w-[150px] max-w-[200px]">Chiến dịch</TableHead>
              <TableHead className="min-w-[180px] max-w-[260px]">Nhóm Facebook</TableHead>
              <TableHead className="min-w-[200px] max-w-[260px]">Nội dung</TableHead>
              <TableHead className="w-[130px]">Trạng thái</TableHead>
              <TableHead className="min-w-[150px] max-w-[220px]">Kết quả</TableHead>
              <TableHead className="w-[120px] text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }, (_, idx) => (
                <TableRow key={`hist-skeleton-${idx}`}>
                  <TableCell className="text-center"><Skeleton className="mx-auto h-4 w-6" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-44" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="ml-auto h-7 w-24 rounded-md" /></TableCell>
                </TableRow>
              ))
            ) : records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <FileText className="size-9 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-700">
                      Không tìm thấy lịch sử phù hợp
                    </p>
                    <p className="max-w-sm text-xs text-slate-500">
                      Không có bản ghi tác vụ nào khớp với tiêu chí tìm kiếm và bộ lọc đang chọn.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              records.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-center font-medium text-slate-500">
                    {item.stt}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600">
                    {formatTime(item.time)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-700">
                    {item.action_type === "POST" ? "Đăng bài" : "Bình luận"}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span
                      className="line-clamp-2 font-semibold text-slate-800"
                      title={item.campaign_name}
                    >
                      {item.campaign_name || "--"}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span
                      className="line-clamp-2 font-medium text-slate-700"
                      title={item.group_name}
                    >
                      {item.group_name || "--"}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <p
                      onClick={() => onSelectDetail(item)}
                      className="line-clamp-2 cursor-pointer text-slate-600 transition-colors hover:text-primary"
                      title="Bấm để xem nội dung đầy đủ"
                    >
                      {item.content || "--"}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {item.status === "SUCCESS" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="size-3.5 text-emerald-600" /> Thành công
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                        <XCircle className="size-3.5 text-rose-600" /> {taskStatusLabel(item.status)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs text-slate-600">
                    <span className="line-clamp-2" title={item.result}>
                      {item.result || "--"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {item.status !== "FAILED" && item.result_url ? (
                      <button
                        type="button"
                        onClick={() => onOpenResult(item)}
                        disabled={Boolean(openingRecordId)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-primary shadow-2xs transition-colors hover:bg-slate-50"
                        title={`Mở bằng Chrome profile của UID ${item.account_uid}`}
                      >
                        {openingRecordId === item.id ? (
                          <RotateCcw className="size-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="size-3.5" />
                        )}
                        <span>{openingRecordId === item.id ? "Đang mở" : "Mở bài viết"}</span>
                      </button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Phân trang */}
      {
        totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs">
            <span className="text-slate-500">
              Trang {currentPage} / {totalPages} (Tổng số {totalCount} tác vụ)
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={currentPage <= 1 || loading}
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
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
                    onClick={() => onPageChange(pageNum)}
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
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                className="size-8 p-0"
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )
      }
    </Card >
  );
}
