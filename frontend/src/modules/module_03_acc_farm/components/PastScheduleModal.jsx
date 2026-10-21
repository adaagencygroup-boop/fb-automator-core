"use client";

import React from "react";
import { Clock, Play, X, ArrowLeft } from "lucide-react";

export function PastScheduleModal({ isOpen, onClose, onConfirm, scheduleTime, currentTime }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-amber-50/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0">
              <Clock size={17} />
            </div>
            <h3 className="text-sm font-bold text-slate-900">
              Giờ hẹn đã qua
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-3.5">
          <p className="text-xs text-slate-700 leading-relaxed font-medium">
            Giờ hẹn <span className="font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">{scheduleTime}</span> đã qua so với thời gian hiện tại {currentTime ? `(${currentTime})` : ""}.
          </p>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 space-y-1">
            <p className="font-bold text-slate-800">
              Bạn có muốn đăng bài ngay bây giờ không?
            </p>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              • Chọn <strong>"Đăng bài ngay"</strong>: Hệ thống sẽ chuyển sang chạy ngay lập tức.<br/>
              • Chọn <strong>"Không (Sửa giờ)"</strong>: Hệ thống hủy lệnh và quay lại để bạn chọn lại khung giờ.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ArrowLeft size={13} />
            <span>Không (Sửa giờ)</span>
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white text-xs font-bold shadow-xs shadow-blue-600/30 flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Play size={13} className="fill-white text-white" />
            <span>Đăng bài ngay</span>
          </button>
        </div>
      </div>
    </div>
  );
}
