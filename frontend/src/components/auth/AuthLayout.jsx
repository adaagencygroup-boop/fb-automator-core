"use client";

import { ShieldCheck, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING, GLOW_BUTTON } from "./AuthFields";

// Figma: "Đăng nhập" / "Đăng ký" — khung 1140×720: thanh tiêu đề + cột trái giới thiệu + cột phải là form
// Màu: theme sáng "Background+Shadow" (nền trắng, panel #EFF4FF, chữ #0B1C30, nhấn #2563EB)

export const APP_NAME = "FB Page Creator";
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "3.1.0";
export const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL || "";

const FEATURES = [
  { icon: Zap, title: "Tiết kiệm thời gian", desc: "Tối ưu hiệu suất" },
  { icon: ShieldCheck, title: "Bảo mật & Riêng tư", desc: "An toàn dữ liệu" },
];

const SECONDARY_PILL =
  "inline-flex h-[38px] items-center justify-center rounded-full border border-[#DCE3F1] bg-white px-5 font-heading text-xs leading-4 font-medium text-[#0B1C30] shadow-[0px_1px_2px_rgba(0,0,0,0.05)] transition-colors hover:border-[#C3CCDD] hover:bg-[#F8FAFF]";

function TitleBar() {
  return (
    <div className="relative z-10 flex h-14 shrink-0 items-center border-b border-[#E2E8F0] bg-white/90 px-6 backdrop-blur-[6px]">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-xl bg-[#2563EB] font-heading text-sm leading-5 font-bold text-white shadow-[0px_4px_6px_-1px_rgba(37,99,235,0.25),0px_2px_4px_-2px_rgba(37,99,235,0.25)]">
          f
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-display text-sm leading-5 font-bold tracking-[-0.35px] text-[#0B1C30]">{APP_NAME}</span>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-[#2563EB]" />
        </span>
      </div>
    </div>
  );
}

function Hero({ engineOnline, onExplore, onDocs }) {
  return (
    <aside className="relative isolate hidden lg:flex w-[523px] shrink-0 flex-col justify-between overflow-hidden border-r border-[#E2E8F0] bg-[#EFF4FF] p-10">
      {/* Ambient glow */}
      <span aria-hidden="true" className="pointer-events-none absolute -left-12 -top-12 -z-10 size-64 rounded-full bg-[rgba(0,74,198,0.1)] blur-[32px]" />
      <span aria-hidden="true" className="pointer-events-none absolute bottom-10 left-10 -z-10 size-72 rounded-full bg-[rgba(37,99,235,0.08)] blur-[32px]" />

      <div className="flex flex-1 flex-col justify-center">
        <div className="flex flex-col gap-[13px]">
          <span className="inline-flex h-[26px] w-fit items-center gap-2 rounded-full bg-[#DCE9FF] pl-3 pr-3.5 shadow-[0px_1px_2px_rgba(0,0,0,0.05)]">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[#004AC6]" />
            <span className="font-heading text-[11px] leading-4 font-semibold uppercase tracking-[0.55px] text-[#004AC6]">
              Tự động hóa chuyên nghiệp
            </span>
          </span>

          <h2 className="pt-1 font-display text-[38px] leading-[44px] font-bold tracking-[-0.95px] text-[#0B1C30]">
            Tự động hóa tạo
            <br />
            <span className="text-[#2563EB]">Fanpage Facebook</span>
          </h2>

          <p className="max-w-96 font-heading text-sm leading-[23px] text-[#565E74]">
            Nhanh chóng - An toàn - Hiệu quả. Tối ưu hóa quy trình quản trị, tiết kiệm hàng giờ vận hành thủ công mỗi ngày.
          </p>

          <div className="flex items-center gap-3 pt-3.5">
            <button
              type="button"
              onClick={onExplore}
              className={cn("inline-flex h-9 items-center rounded-full px-5 font-heading text-xs leading-4 font-semibold", GLOW_BUTTON, FOCUS_RING)}
            >
              Khám phá ngay
            </button>
            {DOCS_URL ? (
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className={cn(SECONDARY_PILL, FOCUS_RING)}>
                Tài liệu hướng dẫn
              </a>
            ) : (
              <button type="button" onClick={onDocs} className={cn(SECONDARY_PILL, FOCUS_RING)}>
                Tài liệu hướng dẫn
              </button>
            )}
          </div>

          <ul className="flex gap-3 pt-[22px]">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <li
                key={title}
                className="flex h-[62px] flex-1 items-center gap-3 rounded-2xl bg-white p-3 shadow-[0px_1px_2px_rgba(0,0,0,0.05)]"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#DCE9FF]">
                  <Icon aria-hidden="true" className="size-[15px] text-[#004AC6]" strokeWidth={2.25} />
                </span>
                <span className="flex flex-col font-heading">
                  <span className="text-xs leading-4 font-semibold text-[#0B1C30]">{title}</span>
                  <span className="text-[11px] leading-4 text-[#565E74]">{desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Software Version Info */}
      <div className="flex items-center justify-between border-t border-[#D5E0F5] pt-4 text-[11px] leading-4 text-[#737686]">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 font-heading font-semibold",
            engineOnline === false ? "text-red-600" : engineOnline ? "text-[#00759F]" : "text-[#737686]",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-2 rounded-full",
              engineOnline === false ? "bg-red-500" : engineOnline ? "bg-[#00759F]" : "bg-[#737686]",
            )}
          />
          {engineOnline === false ? "Không kết nối được hệ thống" : engineOnline ? "Hệ thống đang trực tuyến" : "Đang kết nối hệ thống..."}
        </span>
        <span>Phiên bản {APP_VERSION}</span>
      </div>
    </aside>
  );
}

/**
 * Khung chung của màn Đăng nhập / Đăng ký / trạng thái tài khoản.
 *  - engineOnline : true / false / null (đang kiểm tra)
 *  - onExplore    : nút "Khám phá ngay"
 *  - onDocs       : nút "Tài liệu hướng dẫn" khi chưa cấu hình NEXT_PUBLIC_DOCS_URL
 */
export default function AuthLayout({ engineOnline, onExplore, onDocs, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 font-sans">
      <div
        className={cn(
          "relative isolate flex w-full max-w-[1140px] flex-col overflow-hidden rounded-[28px] border border-[#E2E8F0] bg-white",
          "shadow-[0px_4px_24px_rgba(15,23,42,0.06),0px_1px_4px_rgba(15,23,42,0.04)] lg:h-[720px]",
        )}
      >
        <TitleBar />
        <div className="flex min-h-0 flex-1 bg-[radial-gradient(101.32%_174.17%_at_90%_80%,rgba(37,99,235,0.05)_0%,rgba(37,99,235,0)_60%)]">
          <Hero engineOnline={engineOnline} onExplore={onExplore} onDocs={onDocs} />
          <main className="flex min-w-0 flex-1 flex-col justify-center overflow-y-auto px-6 py-10 sm:px-10 lg:pb-4">{children}</main>
        </div>
      </div>
    </div>
  );
}

/** Tiêu đề ở đầu cột phải */
export function AuthHeading({ title, subtitle, compact = false }) {
  return (
    <header className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}>
      <h1 className="font-display text-[30px] leading-9 font-bold tracking-[-0.75px] text-[#0B1C30]">{title}</h1>
      {subtitle && (
        <p className={cn(compact ? "font-heading text-xs leading-4 text-[#565E74]" : "text-sm leading-5 text-[#565E74]")}>{subtitle}</p>
      )}
    </header>
  );
}
