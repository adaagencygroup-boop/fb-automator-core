"use client";

import React from "react";
import { Hourglass } from "lucide-react";

export function PendingStatusHeader() {
  return (
    <div className="w-full flex flex-col items-center text-center">
      {/* Circular Hourglass Badge */}
      <div className="w-[72px] h-[72px] sm:w-20 sm:h-20 rounded-full bg-[#eef2ff] border-2 border-[#cbd5e1] flex items-center justify-center shadow-sm relative flex-shrink-0">
        <div className="absolute inset-0 rounded-full border border-dashed border-[#bfdbfe]/40 animate-[spin_16s_linear_infinite]" />
        <Hourglass className="w-8 h-8 sm:w-9 sm:h-9 text-[#2563eb]" />
      </div>

      {/* Status Badge Pill */}
      <div className="mt-4 sm:mt-5 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#eaf2ff] border border-[#cddfff] text-xs font-bold tracking-wider text-[#2563eb] shadow-inner">
        <span className="w-2 h-2 rounded-full bg-[#0284c7] animate-pulse" />
        <span className="font-heading tracking-wider uppercase text-[11px] sm:text-xs">
          TRẠNG THÁI: CHỜ PHÊ DUYỆT
        </span>
      </div>

      {/* Header Title & Description */}
      <h1 className="font-heading font-bold text-2xl sm:text-3xl lg:text-[34px] text-slate-900 tracking-tight mt-3 sm:mt-4">
        Tài khoản đang chờ duyệt
      </h1>

      <p className="text-slate-600 text-xs sm:text-[13px] leading-relaxed max-w-2xl mt-2.5 sm:mt-3 font-normal px-2 font-sans">
        Tài khoản của bạn đã được đăng ký thành công trên thiết bị này và đang chờ Quản trị viên kích hoạt giấy phép. Quý khách vui lòng quét mã QR hoặc bấm nút liên hệ hỗ trợ trực tiếp bên dưới để kích hoạt nhanh chóng.
      </p>
    </div>
  );
}
