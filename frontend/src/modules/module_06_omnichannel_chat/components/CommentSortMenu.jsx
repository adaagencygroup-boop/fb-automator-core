"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { COMMENT_SORTS } from "../service";

/** Chọn thứ tự bình luận — gửi tham số `order` lên Graph rồi tải lại */

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

export default function CommentSortMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Bắt cú bấm ra ngoài bằng listener trên document, KHÔNG dùng lớp phủ
    // `fixed inset-0`: lớp phủ nằm ngay dưới con trỏ nên nuốt luôn cú lăn
    // chuột, khiến không cuộn được trang trong lúc menu đang mở.
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  const current = COMMENT_SORTS.find((o) => o.value === value) || COMMENT_SORTS[0];

  return (
    <div ref={rootRef} className="relative self-start">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "-ml-1.5 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100",
          FOCUS,
        )}
      >
        {current.label}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Sắp xếp bình luận"
          className="absolute left-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10"
        >
          {COMMENT_SORTS.map((opt) => {
            const active = opt.value === current.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-slate-50",
                  active ? "font-bold text-slate-900" : "text-slate-700",
                  FOCUS,
                )}
              >
                <Check className={cn("size-3.5 shrink-0", active ? "text-blue-600" : "text-transparent")} />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
