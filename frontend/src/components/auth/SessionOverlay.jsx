"use client";

import { LoaderCircle } from "lucide-react";

/**
 * Lớp phủ toàn màn hình khi đang kiểm tra phiên đăng nhập (lúc mở app).
 * Không dùng khung Đăng nhập để tránh nháy form login rồi mới vào app khi phiên còn hạn.
 */
export default function SessionOverlay({ message = "Đang kiểm tra phiên đăng nhập..." }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[90] grid place-items-center bg-background"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="relative grid size-14 place-items-center">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-2xl bg-[#2563EB]/20 animate-ping motion-reduce:animate-none"
          />
          <span className="relative grid size-14 place-items-center rounded-2xl bg-[#2563EB] font-heading text-2xl font-bold text-white shadow-[0px_8px_20px_-6px_rgba(37,99,235,0.55)]">
            f
          </span>
        </span>
        <div className="flex items-center gap-2 text-sm font-medium text-[#0B1C30]">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-[#2563EB]" />
          {message}
        </div>
        <p className="text-xs text-[#565E74]">Vui lòng chờ trong giây lát</p>
      </div>
    </div>
  );
}
