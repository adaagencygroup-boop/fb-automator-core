"use client";

import React from "react";
import { AlertTriangle, Square, X } from "lucide-react";

export function EmergencyStopModal({ isOpen, onClose, onConfirm, isStopping = false }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center shrink-0">
              <AlertTriangle size={17} />
            </div>
            <h3 className="text-sm font-bold text-slate-900">
              Xác nhận dừng khẩn cấp
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isStopping}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-3.5">
          <p className="text-xs text-slate-700 leading-relaxed">
            Bạn có chắc chắn muốn <span className="font-bold text-rose-600">DỪNG KHẨN CẤP</span> toàn bộ các luồng đăng bài không?
          </p>

          <div className="p-3 bg-rose-50/70 border border-rose-200/60 rounded-xl text-xs text-rose-700 space-y-1">
            <p className="font-semibold text-rose-800 flex items-center gap-1.5">
              <Square size={12} className="fill-rose-700 text-rose-700 shrink-0" />
              <span>Hành động này sẽ:</span>
            </p>
            <ul className="list-disc list-inside text-[11px] text-rose-700/90 space-y-0.5 pl-1 leading-relaxed">
              <li>Lập tức đóng toàn bộ các profile trình duyệt Chrome đang chạy ngầm.</li>
              <li>Hủy các bài viết đang chờ trong hàng đợi của phiên này.</li>
              <li>Cập nhật trạng thái tiến trình thành <strong>Đã dừng</strong>.</li>
            </ul>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isStopping}
            className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isStopping}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-xs font-bold shadow-xs shadow-rose-600/30 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
          >
            <Square size={13} className="fill-white text-white" />
            <span>{isStopping ? "Đang dừng..." : "Dừng khẩn cấp"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
