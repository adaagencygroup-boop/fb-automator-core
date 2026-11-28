"use client";

import React from "react";
import { createPortal } from "react-dom";
import { Folder, X } from "lucide-react";

/** Bảng màu danh mục (giống danh mục profile Module 13) */
export const CATEGORY_COLORS = ["#2563EB", "#059669", "#D97706", "#DC2626", "#7C3AED", "#DB2777", "#0891B2", "#475569"];

export default function CreateCategoryModal({
  open = false,
  onClose,
  categoryName = "",
  onCategoryNameChange,
  onSubmit,
  title = "Thêm mới danh mục nhóm",
  label = "Tên danh mục nhóm",
  placeholder = "Ví dụ: Hội Mẹ & Bé Hà Nội...",
  maxLength,
  busy = false,
  // Tùy chọn màu (truyền onColorChange mới hiện bảng màu)
  color,
  onColorChange,
  colors = CATEGORY_COLORS,
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4 animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between border-b pb-3 border-slate-100">
          <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
            <Folder className="size-5 text-blue-600" />
            {title}
          </h3>
          <button title="Đóng"
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-700">{label}</label>
          <input
            type="text"
            required
            autoFocus
            maxLength={maxLength}
            disabled={busy}
            placeholder={placeholder}
            value={categoryName}
            onChange={(e) => onCategoryNameChange(e.target.value)}
            className="w-full h-8 px-3 text-xs border border-slate-300 rounded-lg outline-none focus:border-blue-600"
          />
        </div>

        {onColorChange && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Màu danh mục</label>
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Màu ${c}`}
                  aria-pressed={c === color}
                  disabled={busy}
                  onClick={() => onColorChange(c)}
                  className={`size-6 rounded-full ring-offset-2 transition ${c === color ? "ring-2 ring-slate-900" : "hover:scale-110"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3.5 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-xs font-semibold"
          >
            Hủy bỏ
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold disabled:opacity-60"
          >
            {busy ? "Đang tạo…" : "Tạo danh mục"}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

