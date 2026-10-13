"use client";

import { cn } from "@/lib/utils";
import { CONVERSATION_FILTERS } from "../constants";

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500";

/**
 * Bộ lọc trạng thái (Tất cả / Chưa xem / Chưa trả lời) — dùng chung cho tab Hội thoại và tab Thông báo
 * để hai tab trông giống hệt nhau.
 *  - label    : aria-label của nhóm nút (vd. "Lọc hội thoại")
 *  - children : nội dung bên phải thanh lọc (vd. nút sắp xếp), có thể bỏ trống
 */
export default function StatusFilter({ filter, onFilterChange, label, children }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-slate-100 shrink-0">
      <div className="flex items-center gap-1.5" role="group" aria-label={label}>
        {CONVERSATION_FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              onClick={() => onFilterChange(f.id)}
              className={cn(
                "px-2.5 py-[5px] rounded-full border text-[11px] leading-4 text-center whitespace-nowrap transition-colors",
                active
                  ? "border-blue-200 bg-blue-50 text-blue-600 font-bold"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-800",
                FOCUS,
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
