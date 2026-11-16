"use client";

import React from "react";
import {
  Clock,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  Layers,
  Search,
  Users,
  FileText,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Helpers for backwards compatibility with SessionDetailModal                */
/* -------------------------------------------------------------------------- */
export function renderTypeBadge(type) {
  switch (type) {
    case "GROUP_INFO":
    case "PAGE_INFO":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          <Search className="size-3" />
          <span>Quét thông tin nhóm</span>
        </span>
      );
    case "MEMBERS":
    case "GROUP_MEMBERS":
    case "PAGE_FOLLOWERS":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
          <Users className="size-3" />
          <span>Quét thành viên nhóm</span>
        </span>
      );
    case "POSTS":
    case "GROUP_POSTS":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <FileText className="size-3" />
          <span>Quét bài viết nhóm</span>
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
  return renderStatusPill(status);
}

/* -------------------------------------------------------------------------- */
/* Cell Renderers Matching Module 10: Quét nhóm                               */
/* -------------------------------------------------------------------------- */

export function renderTaskTypePill(item) {
  const type = (item?.type || "").toUpperCase();
  const title = (item?.title || "").toLowerCase();

  let label = "Quét thông tin nhóm";
  if (type.includes("MEMBER") || type.includes("FOLLOWER") || title.includes("thành viên")) {
    label = "Quét thành viên nhóm";
  } else if (type.includes("POST") || title.includes("bài viết")) {
    label = "Quét bài viết nhóm";
  } else {
    label = "Quét thông tin nhóm";
  }

  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-[#EEF4FF] text-[#2563EB] border border-[#DBEAFE] whitespace-nowrap shadow-2xs">
      {label}
    </span>
  );
}

export function renderTarget(item) {
  const target = (item?.target || "—").trim();
  const type = (item?.type || "").toUpperCase();
  const targetType = (item?.targetType || "").toLowerCase();
  const title = (item?.title || "").toLowerCase();

  // 1. Direct Link / Facebook Group URL
  const isUrl =
    target.includes("fb.com") ||
    target.includes("facebook.com") ||
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("fb.com/") ||
    target.startsWith("facebook.com/");

  if (isUrl) {
    const cleanUrl = target.replace(/^https?:\/\/(www\.)?/, "");
    const href = target.startsWith("http") ? target : `https://${cleanUrl}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#2563EB] font-bold text-xs hover:underline inline-block truncate max-w-[280px]"
        title={target}
      >
        {cleanUrl}
      </a>
    );
  }

  // 2. Hashtag
  if (target.startsWith("#") || title.includes("hashtag")) {
    const tagVal = target.startsWith("#") ? target : `#${target}`;
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-slate-500 font-medium shrink-0">Hashtag:</span>
        <span className="text-[#2563EB] font-semibold">{tagVal}</span>
      </div>
    );
  }

  // 3. Keyword scan (Quét nhóm theo từ khóa)
  if (targetType === "keywords" || type === "GROUP_INFO" || title.includes("từ khóa")) {
    return (
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-slate-500 font-medium shrink-0">Từ khóa:</span>
        <span className="text-[#2563EB] font-semibold truncate max-w-[280px]" title={target}>
          {target}
        </span>
      </div>
    );
  }

  // 4. Target is Group name (Quét thành viên hoặc bài viết của nhóm)
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-slate-500 font-medium shrink-0">Nhóm:</span>
      <span className="text-slate-900 font-semibold truncate max-w-[280px]" title={target}>
        {target}
      </span>
    </div>
  );
}

export function renderCollectedResult(item) {
  const collected = Number(item?.progress?.collected || 0);
  const target = Number(item?.progress?.target || 0);
  const status = (item?.status || "").toUpperCase();
  const type = (item?.type || "").toUpperCase();

  const isFailed = status === "FAILED" || status === "ERROR";

  // Members scan -> UID
  if (type.includes("MEMBER") || type.includes("FOLLOWER")) {
    return (
      <span className="text-[#00875A] font-bold text-xs whitespace-nowrap">
        {collected.toLocaleString("vi-VN")} UID
      </span>
    );
  }

  // Posts scan -> bài viết
  if (type.includes("POST")) {
    return (
      <span className="text-[#00875A] font-bold text-xs whitespace-nowrap">
        {collected.toLocaleString("vi-VN")} bài viết
      </span>
    );
  }

  // Group Info scan -> Nhóm
  if (isFailed && target > 0) {
    return (
      <span className="text-slate-800 font-bold text-xs whitespace-nowrap">
        {collected} / {target} Nhóm
      </span>
    );
  }

  return (
    <span className="text-[#00875A] font-bold text-xs whitespace-nowrap">
      {collected.toLocaleString("vi-VN")} Nhóm
    </span>
  );
}

export function renderTimeAndDuration(item) {
  const startTime = item?.startTime || "";
  let dateFormatted = "10:00 - 24/10/2026";

  if (startTime) {
    const m = startTime.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})/);
    if (m) {
      dateFormatted = `${m[4].padStart(2, "0")}:${m[5].padStart(2, "0")} - ${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
    } else if (startTime.includes(" - ")) {
      dateFormatted = startTime;
    } else {
      try {
        const d = new Date(startTime);
        if (!isNaN(d.getTime())) {
          const hh = String(d.getHours()).padStart(2, "0");
          const mm = String(d.getMinutes()).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          const mo = String(d.getMonth() + 1).padStart(2, "0");
          const yy = d.getFullYear();
          dateFormatted = `${hh}:${mm} - ${dd}/${mo}/${yy}`;
        }
      } catch {}
    }
  }

  const duration = item?.duration && item.duration !== "—" ? item.duration : "34m 10s";
  const status = (item?.status || "").toUpperCase();
  const isFailed = status === "FAILED" || status === "ERROR";

  return (
    <div className="space-y-0.5">
      <div className="text-xs font-semibold text-slate-800 whitespace-nowrap">
        {dateFormatted}
      </div>
      <div className="text-[11px] text-slate-400 flex items-center gap-1 whitespace-nowrap">
        <Clock className="size-3 text-slate-400 shrink-0" />
        <span>
          {isFailed ? `Dừng lúc ${duration}` : `Thời gian: ${duration}`}
        </span>
      </div>
    </div>
  );
}

export function renderStatusPill(status) {
  const s = (status || "").toUpperCase();
  if (s === "SUCCESS" || s === "COMPLETED" || s === "DONE") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#E6F4EA] text-[#00875A] border border-[#A7F3D0] whitespace-nowrap">
        <span className="size-1.5 rounded-full bg-[#00875A]" />
        <span>Hoàn thành</span>
      </span>
    );
  }
  if (s === "FAILED" || s === "ERROR" || s === "ABORTED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[#FEE2E2] text-[#DC2626] border border-[#FECDD3] whitespace-nowrap">
        <span className="size-1.5 rounded-full bg-[#DC2626]" />
        <span>Lỗi</span>
      </span>
    );
  }
  if (s === "RUNNING") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200 whitespace-nowrap">
        <span className="size-1.5 rounded-full bg-blue-600 animate-pulse" />
        <span>Đang chạy</span>
      </span>
    );
  }
  if (s === "PAUSED") {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200 whitespace-nowrap">
        <span className="size-1.5 rounded-full bg-amber-500" />
        <span>Tạm dừng</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
      <span className="size-1.5 rounded-full bg-slate-400" />
      <span>{status || "Khác"}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Main Table Component with Harmonious Layout                                */
/* -------------------------------------------------------------------------- */
export default function HistoryDataTable({
  loading,
  paginatedList = [],
  totalFilteredCount = 0,
  onViewDetail,
  currentPage = 1,
  pageSize = 5,
  totalPages = 1,
  onPageChange,
  onPageSizeChange,
}) {
  // Build page numbers with ellipsis
  const getPageItems = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const siblingCount = 1;
    const leftSibling = Math.max(currentPage - siblingCount, 1);
    const rightSibling = Math.min(currentPage + siblingCount, totalPages);

    const showLeftDots = leftSibling > 2;
    const showRightDots = rightSibling < totalPages - 1;

    if (!showLeftDots && showRightDots) {
      const leftRange = [1, 2, 3];
      return [...leftRange, "...", totalPages];
    }
    if (showLeftDots && !showRightDots) {
      const rightRange = [totalPages - 2, totalPages - 1, totalPages];
      return [1, "...", ...rightRange];
    }
    if (showLeftDots && showRightDots) {
      return [1, "...", leftSibling, currentPage, rightSibling, "...", totalPages];
    }
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  };

  const pageItems = getPageItems();

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden flex flex-col justify-between min-h-[340px]">
      {/* Table Content */}
      <div className="overflow-x-auto flex-1 flex flex-col">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="border-b border-slate-200/80 text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-[#F8FAFC]">
            <tr className="h-11">
              <th className="pl-6 pr-3 py-3 w-16 text-center">STT</th>
              <th className="px-4 py-3 w-[18%] min-w-[160px]">LOẠI TÁC VỤ</th>
              <th className="px-4 py-3 w-[26%] min-w-[200px]">MỤC TIÊU QUÉT</th>
              <th className="px-4 py-3 w-[16%] min-w-[150px]">KẾT QUẢ THU THẬP</th>
              <th className="px-4 py-3 w-[18%] min-w-[170px]">THỜI GIAN</th>
              <th className="px-4 py-3 w-[14%] min-w-[130px]">TRẠNG THÁI</th>
              <th className="pl-3 pr-6 py-3 w-[8%] min-w-[80px] text-center">THAO TÁC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700 bg-white">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-20 text-center text-slate-500">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="size-5 animate-spin text-blue-600" />
                    <span className="text-xs">Đang tải lịch sử phiên quét từ Database...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedList.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-20 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Layers className="size-8 text-slate-300 stroke-[1.5]" />
                    <p className="font-semibold text-slate-600 text-sm">
                      Chưa có phiên quét nào được ghi nhận
                    </p>
                    <p className="text-xs text-slate-400">
                      Các phiên quét nhóm, thành viên và bài viết sẽ hiển thị tại đây sau khi thực thi.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedList.map((item, index) => {
                const stt = String((currentPage - 1) * pageSize + index + 1).padStart(2, "0");

                return (
                  <tr
                    key={item.id || index}
                    className="hover:bg-slate-50/70 transition-colors"
                  >
                    {/* 1. STT */}
                    <td className="pl-6 pr-3 py-4 text-center text-xs font-semibold text-slate-400 font-mono">
                      {stt}
                    </td>

                    {/* 2. LOẠI TÁC VỤ */}
                    <td className="px-4 py-4 align-middle">
                      {renderTaskTypePill(item)}
                    </td>

                    {/* 3. MỤC TIÊU QUÉT */}
                    <td className="px-4 py-4 align-middle">
                      {renderTarget(item)}
                    </td>

                    {/* 4. KẾT QUẢ THU THẬP */}
                    <td className="px-4 py-4 align-middle">
                      {renderCollectedResult(item)}
                    </td>

                    {/* 5. THỜI GIAN */}
                    <td className="px-4 py-4 align-middle">
                      {renderTimeAndDuration(item)}
                    </td>

                    {/* 6. TRẠNG THÁI */}
                    <td className="px-4 py-4 align-middle">
                      {renderStatusPill(item.status)}
                    </td>

                    {/* 7. THAO TÁC */}
                    <td className="pl-3 pr-6 py-4 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => onViewDetail?.(item)}
                        title="Xem chi tiết phiên quét"
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center"
                      >
                        <Eye className="size-4 stroke-[1.75]" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Pagination Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-3.5 border-t border-slate-100 bg-white mt-auto">
        {/* Left: Page size dropdown & Total info */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Hiển thị</span>
          <div className="relative inline-block">
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
              className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-7 py-1 text-xs font-semibold text-slate-700 shadow-2xs focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <ChevronDown className="size-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <span>
            trong tổng số <b className="font-bold text-slate-900">{totalFilteredCount}</b> phiên
          </span>
        </div>

        {/* Right: Page Navigation Numbers */}
        <div className="flex items-center gap-1.5 select-none">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => onPageChange?.(currentPage - 1)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 disabled:cursor-not-allowed transition-colors cursor-pointer"
            title="Trang trước"
          >
            <ChevronLeft className="size-4" />
          </button>

          {pageItems.map((item, idx) => {
            if (item === "...") {
              return (
                <span
                  key={`dots-${idx}`}
                  className="w-8 h-8 flex items-center justify-center text-slate-400 text-xs"
                >
                  ...
                </span>
              );
            }
            const pageNum = Number(item);
            const isActive = pageNum === currentPage;
            return (
              <button
                key={`page-${pageNum}`}
                type="button"
                onClick={() => onPageChange?.(pageNum)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-all cursor-pointer ${
                  isActive
                    ? "bg-[#1677FF] text-white shadow-2xs font-semibold"
                    : "text-slate-600 hover:bg-slate-100 font-medium"
                }`}
              >
                {pageNum}
              </button>
            );
          })}

          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange?.(currentPage + 1)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 disabled:cursor-not-allowed transition-colors cursor-pointer"
            title="Trang sau"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
