"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CONVERSATION_FILTERS, CONVERSATION_TAGS } from "../constants";
import { Star, Tag, Check, X } from "lucide-react";

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500";

/**
 * Bộ lọc trạng thái (Tất cả / Chưa xem / Chưa trả lời / Gắn sao ⭐ / Nhãn 🏷️)
 * - Dùng chung cho tab Hội thoại và tab Thông báo.
 * - Hỗ trợ lọc theo Đánh dấu sao và Thẻ phân loại (tags).
 */
export default function StatusFilter({
  filter,
  onFilterChange,
  starOnly = false,
  onToggleStar,
  selectedTag = null,
  onSelectTag,
  label,
  children,
}) {
  const [tagOpen, setTagOpen] = useState(false);
  const tagDropdownRef = useRef(null);

  useEffect(() => {
    if (!tagOpen) return undefined;
    const handlePointerDown = (e) => {
      if (!tagDropdownRef.current?.contains(e.target)) {
        setTagOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setTagOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [tagOpen]);

  const activeTagObj = CONVERSATION_TAGS.find((t) => t.id === selectedTag);

  return (
    <div className="flex flex-col border-b border-slate-100 shrink-0">
      <div className="flex items-center justify-between gap-1.5 px-3 py-2.5">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0" role="group" aria-label={label}>
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

          {/* Nút lọc cuộc trò chuyện có gắn sao ⭐ */}
          {onToggleStar && (
            <button
              type="button"
              aria-pressed={Boolean(starOnly)}
              onClick={onToggleStar}
              title={starOnly ? "Đang lọc: Gắn sao ⭐ (Bấm để bỏ lọc)" : "Lọc cuộc hội thoại có gắn sao ⭐"}
              className={cn(
                "size-7 rounded-full border transition-all flex items-center justify-center shrink-0",
                starOnly
                  ? "border-amber-300 bg-amber-50 text-amber-500 shadow-xs"
                  : "border-slate-200 bg-white text-slate-400 hover:text-amber-500 hover:bg-slate-50",
                FOCUS,
              )}
            >
              <Star size={13} fill={starOnly ? "currentColor" : "none"} strokeWidth={1.8} />
            </button>
          )}

          {/* Nút mở danh sách lọc theo nhãn 🏷️ */}
          {onSelectTag && (
            <div className="relative shrink-0" ref={tagDropdownRef}>
              <button
                type="button"
                aria-expanded={tagOpen}
                onClick={() => setTagOpen((o) => !o)}
                title={selectedTag ? `Đang lọc nhãn: ${activeTagObj?.label || selectedTag}` : "Lọc theo nhãn 🏷️"}
                className={cn(
                  "size-7 rounded-full border transition-all flex items-center justify-center shrink-0",
                  selectedTag
                    ? "border-blue-300 bg-blue-50 text-blue-600 shadow-xs"
                    : "border-slate-200 bg-white text-slate-400 hover:text-blue-500 hover:bg-slate-50",
                  FOCUS,
                )}
              >
                <Tag size={13} strokeWidth={1.8} />
              </button>

              {tagOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full mt-1.5 z-40 w-48 bg-white border border-slate-200 rounded-xl shadow-lg shadow-slate-900/10 p-1.5 text-xs animate-in fade-in zoom-in-95 duration-100"
                >
                  <p className="px-2.5 py-1 text-[10px] font-bold uppercase text-slate-400">
                    Lọc theo nhãn
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectTag(null);
                      setTagOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors",
                      !selectedTag ? "bg-blue-50 text-blue-600 font-bold" : "text-slate-600 hover:bg-slate-50",
                      FOCUS,
                    )}
                  >
                    <span>Tất cả nhãn</span>
                    {!selectedTag && <Check size={13} className="text-blue-600" />}
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  {CONVERSATION_TAGS.map((t) => {
                    const active = selectedTag === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          onSelectTag(active ? null : t.id);
                          setTagOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors",
                          active ? "bg-blue-50 text-blue-600 font-bold" : "text-slate-700 hover:bg-slate-50",
                          FOCUS,
                        )}
                      >
                        <span className={cn("px-2 py-0.5 rounded-full border text-[10px] font-semibold", t.className)}>
                          {t.label}
                        </span>
                        {active && <Check size={13} className="text-blue-600" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {children}
      </div>

      {/* Dải chip thông báo nhãn đang lọc */}
      {activeTagObj && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-50/80 border-t border-slate-100 text-[11px] text-slate-500">
          <span>Lọc nhãn:</span>
          <span className={cn("px-2 py-0.5 rounded-full border text-[10px] font-semibold", activeTagObj.className)}>
            {activeTagObj.label}
          </span>
          <button
            type="button"
            onClick={() => onSelectTag(null)}
            className="ml-auto text-slate-400 hover:text-slate-700 p-0.5 rounded transition-colors"
            title="Bỏ lọc nhãn"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
