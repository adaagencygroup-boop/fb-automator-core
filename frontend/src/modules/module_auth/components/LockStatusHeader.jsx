"use client";

import React from "react";
import { Lock } from "lucide-react";

export function LockStatusHeader() {
  return (
    <div className="w-full flex flex-col items-center text-center">
      {/* Circular Lock Badge */}
      <div className="w-[72px] h-[72px] sm:w-20 sm:h-20 rounded-full bg-[#eef2ff] border-2 border-[#cbd5e1] flex items-center justify-center shadow-sm relative flex-shrink-0">
        <div className="absolute inset-0 rounded-full border border-dashed border-[#bfdbfe]/40 animate-[spin_16s_linear_infinite]" />
        <Lock className="w-8 h-8 sm:w-9 sm:h-9 text-slate-900" />
      </div>

      {/* Status Badge Pill (Red Locked Theme) */}
      <div className="mt-4 sm:mt-5 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#fff1f2] border border-[#fecdd3] text-xs font-bold tracking-wider text-[#dc2626] shadow-inner">
        <span className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse" />
        <span className="font-heading tracking-wider uppercase text-[11px] sm:text-xs">
          TRẠNG THÁI: KHÓA
        </span>
      </div>

      {/* Header Title & Description */}
      <h1 className="font-heading font-bold text-2xl sm:text-3xl lg:text-[34px] text-slate-900 tracking-tight mt-3 sm:mt-4">
        Tài khoản của bạn đang bị khóa
      </h1>

      <p className="text-slate-600 text-xs sm:text-[13px] leading-relaxed max-w-2xl mt-2.5 sm:mt-3 font-normal px-2 font-sans">
        Tài khoản của bạn đã bị tạm ngưng hoạt động do phát hiện vi phạm chính sách sử dụng, xung đột phần cứng (HWID Mismatch) hoặc chưa gia hạn gói bản quyền định kỳ. Vui lòng liên hệ trực tiếp Quản trị viên để được kiểm tra và kích hoạt lại.
      </p>
    </div>
  );
}
