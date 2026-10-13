"use client";

import React from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";


export function PendingFooter({ refreshing, onRefresh, onBack }) {
  return (
    <footer className="min-h-[56px] sm:h-16 py-3 sm:py-0 bg-[#ffffff] px-4 sm:px-8 border-t border-[#e2e8f0] flex flex-col sm:flex-row items-center justify-between gap-3 flex-shrink-0 z-20 sticky bottom-0 w-full shadow-sm">
      {/* System Status Indicator */}
      <div className="flex items-center gap-2.5 text-xs text-[#64748b]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] shadow-sm flex-shrink-0" />
        <span className="text-[#64748b] font-medium text-xs">
          Hệ thống máy chủ xác thực hoạt động bình thường
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        {/* Back to Login Pill Button */}
        <button
          type="button"
          onClick={onBack}
          className="group/footer-btn h-10 px-5 rounded-full bg-[#ffffff] hover:bg-[#eff4ff] text-slate-900 border border-[#e2e8f0] hover:border-[#bfdbfe] text-xs font-semibold tracking-wide transition-all flex items-center gap-2 active:scale-[0.98] shadow-sm cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-slate-600 group-hover/footer-btn:-translate-x-1 transition-transform duration-200" />
          <span>Quay lại đăng nhập</span>
        </button>

        {/* Refresh Status Pill Button with Vibrant Cyan/Blue Gradient */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="group/footer-btn h-10 px-5 rounded-full bg-gradient-to-r from-[#245ff4] to-[#245ff4] hover:brightness-110 active:scale-[0.98] text-white font-bold text-xs tracking-wide transition-all shadow-sm flex items-center gap-2 disabled:opacity-60 cursor-pointer"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-white transition-transform duration-500 ease-in-out group-hover/footer-btn:rotate-180 ${
              refreshing ? "animate-spin" : ""
            }`}
          />
          <span>Làm mới trạng thái</span>
        </button>
      </div>
    </footer>
  );
}
