"use client";

/**
 * Popup "Lấy bài viết từ page/ trang cá nhân".
 * Luôn được mount (chỉ mở / đóng <dialog>) để lượt lấy bài đang chạy nền vẫn được theo dõi khi đóng popup
 * và cờ "đang lấy bài" (chặn nút Bắt đầu seeding) luôn đúng.
 */
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import Toaster from "@/components/Toaster";

export default function PostFetchModal({ open, onClose, title = "Lấy bài viết từ page/ trang cá nhân", children }) {
  const dialog = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[90vh] w-[95vw] max-w-4xl overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-0 text-gray-800 shadow-2xl backdrop:bg-slate-900/60"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-100 bg-white px-5 py-3 sm:px-6">
        <h2 id={titleId} className="text-base font-bold text-gray-900">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="rounded-md p-1.5 text-gray-500 hover:bg-slate-100 hover:text-gray-900"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </header>
      <Toaster />
      {children}
    </dialog>
  );
}
