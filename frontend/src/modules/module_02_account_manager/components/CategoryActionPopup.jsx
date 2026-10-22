"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Trash2 } from "lucide-react";

export default function CategoryActionPopup({ anchor, category, onClose, onEdit, onDelete }) {
  const popup = useRef(null);
  const [position] = useState(() => {
    const rect = anchor.getBoundingClientRect();
    const width = 76, height = 40, gap = 8;
    const left = rect.right + gap + width <= window.innerWidth - gap
      ? rect.right + gap : rect.left - width - gap;
    return {
      left: Math.max(gap, Math.min(left, window.innerWidth - width - gap)),
      top: Math.max(gap, Math.min(rect.top + (rect.height - height) / 2, window.innerHeight - height - gap)),
    };
  });

  useEffect(() => {
    popup.current?.querySelector("button")?.focus();
    const outside = event => {
      if (!popup.current?.contains(event.target) && !anchor.contains(event.target)) onClose();
    };
    const keydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        anchor.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);

  return createPortal(<div ref={popup} role="dialog" aria-label={`Thao tác danh mục ${category.name}`}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== anchor) onClose();
    }}
    className="fixed z-[100000] flex h-10 w-[76px] items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white p-1 font-sans shadow-lg"
    style={position}>
    <button type="button" title="Sửa danh mục" aria-label={`Sửa danh mục ${category.name}`} onClick={onEdit}
      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-blue-50 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"><Pencil className="h-3.5 w-3.5" /></button>
    <button type="button" title="Xóa danh mục" aria-label={`Xóa danh mục ${category.name}`} onClick={onDelete}
      className="flex h-7 w-7 items-center justify-center rounded-md text-red-500 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
  </div>, document.body);
}
