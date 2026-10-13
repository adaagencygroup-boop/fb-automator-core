"use client";

import React from "react";
import {
  MessageSquare,
  Send,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";


export function PendingSupportCards({
  zaloPhone,
  rawZaloPhone,
  telegramHandle,
  copiedPhone,
  copiedTele,
  onCopyPhone,
  onCopyTele,
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full mt-6 sm:mt-8">
      {/* Box 1: Hỗ trợ Zalo CSKH */}
      <div className="group/card p-5 sm:p-6 rounded-2xl bg-[#ffffff]/95 border border-[#dbe5fa] hover:border-[#245ff4]/50 transition-all duration-300 flex flex-col gap-4 text-left shadow-sm">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#245ff4] flex items-center justify-center text-white shadow-md flex-shrink-0 group-hover/card:scale-105 transition-transform duration-300">
            <MessageSquare className="w-5 h-5 fill-white text-white" />
          </div>
          <div className="flex flex-col">
            <h3 className="font-bold text-slate-900 text-sm sm:text-[15px] leading-tight">
              Hỗ trợ Zalo CSKH
            </h3>
            <p className="text-[#64748b] text-xs leading-normal mt-0.5">
              Kích hoạt giấy phép & Tư vấn bảng giá
            </p>
          </div>
        </div>

        {/* QR & Info Row */}
        <div className="flex items-center gap-4">
          {/* QR Box */}
          <div className="p-2.5 rounded-2xl bg-white flex flex-col items-center justify-center flex-shrink-0 shadow-md w-[112px]">
            <svg
              viewBox="0 0 100 100"
              className="w-20 h-20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Top Left Finder */}
              <rect x="5" y="5" width="28" height="28" rx="4" fill="#090E1C" />
              <rect x="10" y="10" width="18" height="18" rx="2" fill="#FFFFFF" />
              <rect x="14" y="14" width="10" height="10" rx="1.5" fill="#090E1C" />

              {/* Top Right Finder */}
              <rect x="67" y="5" width="28" height="28" rx="4" fill="#090E1C" />
              <rect x="72" y="10" width="18" height="18" rx="2" fill="#FFFFFF" />
              <rect x="76" y="14" width="10" height="10" rx="1.5" fill="#090E1C" />

              {/* Bottom Left Finder */}
              <rect x="5" y="67" width="28" height="28" rx="4" fill="#090E1C" />
              <rect x="10" y="72" width="18" height="18" rx="2" fill="#FFFFFF" />
              <rect x="14" y="76" width="10" height="10" rx="1.5" fill="#090E1C" />

              {/* QR Code Dots Matrix */}
              <rect x="38" y="8" width="6" height="6" rx="1" fill="#090E1C" />
              <rect x="50" y="8" width="8" height="6" rx="1" fill="#090E1C" />
              <rect x="38" y="20" width="8" height="6" rx="1" fill="#090E1C" />
              <rect x="52" y="20" width="6" height="6" rx="1" fill="#090E1C" />

              <rect x="8" y="38" width="6" height="8" rx="1" fill="#090E1C" />
              <rect x="20" y="38" width="8" height="6" rx="1" fill="#090E1C" />
              <rect x="70" y="38" width="8" height="6" rx="1" fill="#090E1C" />
              <rect x="84" y="38" width="8" height="6" rx="1" fill="#090E1C" />

              <rect x="38" y="72" width="8" height="6" rx="1" fill="#090E1C" />
              <rect x="52" y="72" width="6" height="8" rx="1" fill="#090E1C" />
              <rect x="72" y="70" width="6" height="6" rx="1" fill="#090E1C" />
              <rect x="84" y="70" width="8" height="8" rx="1" fill="#090E1C" />
              <rect x="70" y="84" width="8" height="8" rx="1" fill="#090E1C" />
              <rect x="84" y="84" width="8" height="8" rx="1" fill="#090E1C" />

              {/* Center Zalo Badge */}
              <circle cx="50" cy="50" r="14" fill="#1B72E8" />
              <text
                x="50"
                y="55"
                fill="#FFFFFF"
                fontSize="14"
                fontWeight="bold"
                textAnchor="middle"
                fontFamily="Arial, sans-serif"
              >
                Z
              </text>
            </svg>
            <span className="font-bold text-[9px] text-slate-800 tracking-wider uppercase mt-1">
              QUÉT MÃ ZALO
            </span>
          </div>

          {/* Right Text & Info */}
          <div className="flex-1 flex flex-col justify-between h-full">
            <p className="text-[#7c8599] text-[11.5px] leading-relaxed">
              Mở ứng dụng Zalo trên điện thoại, chọn biểu tượng{" "}
              <strong className="text-slate-900 font-semibold">Quét mã QR</strong> hoặc liên hệ hotline để gửi thông tin HWID nhận duyệt ngay.
            </p>

            <div className="bg-[#eff4ff] px-3 py-2 rounded-xl border border-[#dbe5fa] flex items-center justify-between mt-2.5">
              <span className="text-slate-500 text-[11px]">Zalo Hotline:</span>
              <span className="text-[#0284c7] font-mono font-bold text-xs sm:text-[13px]">
                {zaloPhone}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 pt-1">
          <a
            href={`https://zalo.me/${rawZaloPhone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group/btn flex-1 h-10 rounded-xl bg-[#245ff4] hover:bg-[#155fc7] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-[0.98] cursor-pointer"
          >
            <span>Mở Zalo Chat</span>
            <ExternalLink className="w-3.5 h-3.5 text-white/90 group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform duration-200" />
          </a>

          <button
            type="button"
            onClick={onCopyPhone}
            className="group/btn flex-1 h-10 rounded-xl bg-[#eff4ff] hover:bg-[#e5edff] border border-[#dbe5fa] hover:border-[#bfdbfe] text-[#475569] hover:text-slate-900 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer"
          >
            {copiedPhone ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 animate-bounce" />
                <span className="text-emerald-600">Đã sao chép</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-600 group-hover/btn:scale-[1.15] group-hover/btn:-rotate-12 transition-transform duration-200" />
                <span>Sao chép số</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Box 2: Kỹ thuật viên Telegram */}
      <div className="group/card p-5 sm:p-6 rounded-2xl bg-[#ffffff]/95 border border-[#dbe5fa] hover:border-[#00A3E0]/50 transition-all duration-300 flex flex-col gap-4 text-left shadow-sm">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#00A3E0] flex items-center justify-center text-white shadow-md flex-shrink-0 group-hover/card:scale-105 transition-transform duration-300">
            <Send className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <h3 className="font-bold text-slate-900 text-sm sm:text-[15px] leading-tight">
              Kỹ thuật viên Telegram
            </h3>
            <p className="text-[#64748b] text-xs leading-normal mt-0.5">
              Xử lý HWID, Proxy & Kích hoạt tự động
            </p>
          </div>
        </div>

        {/* QR & Info Row */}
        <div className="flex items-center gap-4">
          {/* QR Box */}
          <div className="p-2.5 rounded-2xl bg-white flex flex-col items-center justify-center flex-shrink-0 shadow-md w-[112px]">
            <svg
              viewBox="0 0 100 100"
              className="w-20 h-20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Top Left Finder */}
              <rect x="5" y="5" width="28" height="28" rx="4" fill="#090E1C" />
              <rect x="10" y="10" width="18" height="18" rx="2" fill="#FFFFFF" />
              <rect x="14" y="14" width="10" height="10" rx="1.5" fill="#090E1C" />

              {/* Top Right Finder */}
              <rect x="67" y="5" width="28" height="28" rx="4" fill="#090E1C" />
              <rect x="72" y="10" width="18" height="18" rx="2" fill="#FFFFFF" />
              <rect x="76" y="14" width="10" height="10" rx="1.5" fill="#090E1C" />

              {/* Bottom Left Finder */}
              <rect x="5" y="67" width="28" height="28" rx="4" fill="#090E1C" />
              <rect x="10" y="72" width="18" height="18" rx="2" fill="#FFFFFF" />
              <rect x="14" y="76" width="10" height="10" rx="1.5" fill="#090E1C" />

              {/* QR Code Dots Matrix */}
              <rect x="38" y="8" width="6" height="6" rx="1" fill="#090E1C" />
              <rect x="50" y="8" width="8" height="6" rx="1" fill="#090E1C" />
              <rect x="38" y="20" width="8" height="6" rx="1" fill="#090E1C" />
              <rect x="52" y="20" width="6" height="6" rx="1" fill="#090E1C" />

              <rect x="8" y="38" width="6" height="8" rx="1" fill="#090E1C" />
              <rect x="20" y="38" width="8" height="6" rx="1" fill="#090E1C" />
              <rect x="70" y="38" width="8" height="6" rx="1" fill="#090E1C" />
              <rect x="84" y="38" width="8" height="6" rx="1" fill="#090E1C" />

              <rect x="38" y="72" width="8" height="6" rx="1" fill="#090E1C" />
              <rect x="52" y="72" width="6" height="8" rx="1" fill="#090E1C" />
              <rect x="72" y="70" width="6" height="6" rx="1" fill="#090E1C" />
              <rect x="84" y="70" width="8" height="8" rx="1" fill="#090E1C" />
              <rect x="70" y="84" width="8" height="8" rx="1" fill="#090E1C" />
              <rect x="84" y="84" width="8" height="8" rx="1" fill="#090E1C" />

              {/* Center Telegram Badge */}
              <circle cx="50" cy="50" r="14" fill="#00A3E0" />
              <path
                d="M44 50L49 55L57 43"
                stroke="#FFFFFF"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-bold text-[9px] text-slate-800 tracking-wider uppercase mt-1">
              QUÉT TELEGRAM
            </span>
          </div>

          {/* Right Text & Info */}
          <div className="flex-1 flex flex-col justify-between h-full">
            <p className="text-[#7c8599] text-[11.5px] leading-relaxed">
              Nhắn tin trực tiếp với support qua Telegram để gửi mã HWID hoặc bill giao dịch. Bot sẽ duyệt tài khoản tự động trong vòng 60 giây.
            </p>

            <div className="bg-[#eff4ff] px-3 py-2 rounded-xl border border-[#dbe5fa] flex items-center justify-between mt-2.5">
              <span className="text-slate-500 text-[11px]">Telegram Handle:</span>
              <span className="text-[#0284c7] font-mono font-bold text-xs sm:text-[13px]">
                {telegramHandle}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 pt-1">
          <a
            href="https://t.me/admin_support"
            target="_blank"
            rel="noopener noreferrer"
            className="group/btn flex-1 h-10 rounded-xl bg-[#0099CC] hover:bg-[#0088B5] text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-[0.98] cursor-pointer"
          >
            <span>Nhắn Telegram</span>
            <Send className="w-3.5 h-3.5 text-white/90 group-hover/btn:translate-x-1 group-hover/btn:-translate-y-0.5 transition-transform duration-200" />
          </a>

          <button
            type="button"
            onClick={onCopyTele}
            className="group/btn flex-1 h-10 rounded-xl bg-[#eff4ff] hover:bg-[#e5edff] border border-[#dbe5fa] hover:border-[#bfdbfe] text-[#475569] hover:text-slate-900 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer"
          >
            {copiedTele ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 animate-bounce" />
                <span className="text-emerald-600">Đã sao chép</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-600 group-hover/btn:scale-[1.15] group-hover/btn:-rotate-12 transition-transform duration-200" />
                <span>Sao chép Tag</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
