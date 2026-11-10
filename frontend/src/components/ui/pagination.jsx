"use client";
import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
export default function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  className = "",
  siblingCount = 1,
}) {
  if (totalPages <= 0) return null;
  const getPageItems = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
    const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPages);
    // "..." chỉ khi che từ 2 trang trở lên (giống bên phải); che đúng 1 trang thì hiện luôn số trang đó
    const shouldShowLeftDots = leftSiblingIndex > 3;
    const shouldShowRightDots = rightSiblingIndex < totalPages - 2;
    if (!shouldShowLeftDots && shouldShowRightDots) {
      const leftRangeLength = Math.max(3, rightSiblingIndex);
      const leftRange = Array.from({ length: leftRangeLength }, (_, i) => i + 1);
      return [...leftRange, "...", totalPages];
    }
    if (shouldShowLeftDots && !shouldShowRightDots) {
      const rightRangeLength = Math.max(3, totalPages - leftSiblingIndex + 1);
      const rightRange = Array.from(
        { length: rightRangeLength },
        (_, i) => totalPages - rightRangeLength + i + 1
      );
      return [1, "...", ...rightRange];
    }
    if (shouldShowLeftDots && shouldShowRightDots) {
      const middleRange = Array.from(
        { length: rightSiblingIndex - leftSiblingIndex + 1 },
        (_, i) => leftSiblingIndex + i
      );
      return [1, "...", ...middleRange, "...", totalPages];
    }
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  };
  const pageItems = getPageItems();
  return (
    <div className={`flex flex-row items-center gap-1.5 select-none ${className}`}>
      <button
        type="button"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        className="w-8 h-8 rounded-lg border border-border bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed flex items-center justify-center transition-colors cursor-pointer shrink-0 shadow-sm"
        title="Trang trước"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      {pageItems.map((item, idx) => {
        if (item === "...") {
          return (
            <span
              key={`ellipsis-${idx}`}
              className="w-8 h-8 flex items-center justify-center text-slate-400 font-normal text-xs"
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
            onClick={() => onPageChange(pageNum)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center font-normal text-xs transition-all cursor-pointer ${
              isActive
                ? "border border-blue-600 bg-blue-50/80 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-500 shadow-none"
                : "border border-border bg-white hover:bg-slate-50 text-slate-700 shadow-sm"
            }`}
          >
            {pageNum}
          </button>
        );
      })}
      <button
        type="button"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        className="w-8 h-8 rounded-lg border border-border bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed flex items-center justify-center transition-colors cursor-pointer shrink-0 shadow-sm"
        title="Trang kế tiếp"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
