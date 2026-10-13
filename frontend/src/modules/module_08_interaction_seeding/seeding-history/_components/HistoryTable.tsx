"use client";

import React from "react";
import { Table as TableIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { SeedingCampaign } from "@/types/seeding";

interface HistoryTableProps {
  campaigns: SeedingCampaign[];
  onOpenDetail: (campaign: SeedingCampaign) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}

export default function HistoryTable({
  campaigns,
  onOpenDetail,
  currentPage,
  totalPages,
  onPageChange,
  pageSize,
  onPageSizeChange,
}: HistoryTableProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
      {/* Table Header */}
      <div className="p-6 pb-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <TableIcon className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="text-base font-bold text-slate-900">
            Danh sách lịch sử seeding
          </h3>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-gray-50/80 text-gray-500 font-semibold border-b border-gray-100 uppercase tracking-wider text-[11px]">
            <tr>
              <th className="py-3 px-4 w-12 text-center">#</th>
              <th className="py-3 px-4">THỜI GIAN</th>
              <th className="py-3 px-4">LOẠI</th>
              <th className="py-3 px-4">MỤC TIÊU</th>
              <th className="py-3 px-4 text-center">SỐ LƯỢNG</th>
              <th className="py-3 px-4 text-center text-emerald-600">THÀNH CÔNG</th>
              <th className="py-3 px-4 text-center text-rose-600">THẤT BẠI</th>
              <th className="py-3 px-4 text-center">TRẠNG THÁI</th>
              <th className="py-3 px-4 text-center">THAO TÁC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-700 font-medium">
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-gray-400 text-xs italic">
                  Không tìm thấy chiến dịch nào phù hợp.
                </td>
              </tr>
            ) : (
              campaigns.map((c, idx) => {
                const isCompleted = c.status === "COMPLETED";
                const isFailed = c.status === "FAILED";
                const isRunning = c.status === "RUNNING";

                return (
                  <tr key={c.id} className="hover:bg-blue-50/30 transition-colors">
                    <td className="py-3 px-4 text-center text-gray-400 font-mono text-[11px]">
                      {(currentPage - 1) * pageSize + idx + 1}
                    </td>

                    <td className="py-3 px-4 font-mono text-gray-600 text-[11px]">
                      {c.created_at_display || c.created_at}
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-semibold text-gray-900">
                        {c.campaign_type_display || c.campaign_type}
                      </span>
                    </td>

                    <td className="py-3 px-4 font-medium text-gray-900 max-w-xs">
                      <div className="truncate font-semibold">{c.target_summary || c.name}</div>
                      {c.campaign_type === "POST" && c.actions && c.actions.length > 0 && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {c.actions.map((act) => {
                            const a = act.toUpperCase();
                            if (a === "REACT")
                              return (
                                <span
                                  key={a}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-semibold border border-blue-200"
                                >
                                  Like bài viết
                                </span>
                              );
                            if (a === "COMMENT")
                              return (
                                <span
                                  key={a}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[10px] font-semibold border border-emerald-200"
                                >
                                  Bình luận
                                </span>
                              );
                            if (a === "SHARE")
                              return (
                                <span
                                  key={a}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] font-semibold border border-purple-200"
                                >
                                  Chia sẻ
                                </span>
                              );
                            return null;
                          })}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center font-bold text-gray-900">
                      {c.total_planned}
                    </td>

                    <td className="py-3 px-4 text-center font-bold text-emerald-600">
                      {c.total_success}
                    </td>

                    <td className="py-3 px-4 text-center font-bold text-rose-600">
                      {c.total_failed}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                          isCompleted
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                            : isFailed
                            ? "bg-amber-50 text-amber-700 border border-amber-200/60"
                            : isRunning
                            ? "bg-blue-50 text-blue-700 border border-blue-200/60 animate-pulse"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {c.status_display || c.status}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => onOpenDetail(c)}
                        className="px-3 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 text-xs font-semibold transition-all shadow-sm shadow-blue-500/10"
                      >
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <span>Hiển thị</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="py-1 px-2 rounded-lg border border-gray-200 bg-gray-50 text-gray-800 font-semibold focus:outline-none"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
          <span>dòng/trang</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                currentPage === p
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                  : "text-gray-600 hover:bg-gray-100 border border-gray-200"
              }`}
            >
              {p}
            </button>
          ))}

          {totalPages > 5 && (
            <>
              <span className="px-1 text-gray-400">...</span>
              <button
                type="button"
                onClick={() => onPageChange(totalPages)}
                className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                  currentPage === totalPages
                    ? "bg-blue-600 text-white shadow-sm shadow-blue-500/30"
                    : "text-gray-600 hover:bg-gray-100 border border-gray-200"
                }`}
              >
                {totalPages}
              </button>
            </>
          )}

          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
