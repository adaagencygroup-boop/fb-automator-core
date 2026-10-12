"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Hourglass, LockKeyhole, RefreshCw, Send, UserX } from "lucide-react";
import { SUPPORT } from "@/config/support";
import { cn } from "@/lib/utils";

// Figma: "tài khoản chờ duyệt" / "tài khoản bị khóa" — thẻ 1024px: tiêu đề trạng thái + 2 kênh hỗ trợ (Zalo, Telegram) + chân trang

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50 focus-visible:ring-offset-2";

const VARIANTS = {
  pending: {
    icon: Hourglass,
    badge: "Trạng thái: Chờ phê duyệt",
    badgeClass: "border-[rgba(253,230,138,0.8)] bg-[#FFFBEB] text-[#B45309] font-bold tracking-[0.3px]",
    dot: "bg-[#F59E0B]",
    ping: null,
    title: "Tài khoản đang chờ duyệt",
    body: "Tài khoản của bạn đã được đăng ký thành công trên thiết bị này và đang chờ Quản trị viên kích hoạt giấy phép. Quý khách vui lòng quét mã QR hoặc bấm nút liên hệ hỗ trợ trực tiếp bên dưới để kích hoạt nhanh chóng.",
  },
  locked: {
    icon: LockKeyhole,
    badge: "Trạng thái: Khóa",
    badgeClass: "border-[rgba(254,205,211,0.7)] bg-[#FFF1F2] text-[#BE123C] font-semibold tracking-[0.6px]",
    dot: "bg-[#E11D48]",
    ping: "bg-[#FB7185]",
    title: "Tài khoản của bạn đang bị khóa",
    body: "Tài khoản của bạn đã bị tạm ngưng hoạt động do phát hiện vi phạm chính sách sử dụng, xung đột phần cứng (HWID Mismatch) hoặc chưa gia hạn gói bản quyền định kỳ. Vui lòng liên hệ trực tiếp Quản trị viên để được kiểm tra và kích hoạt lại.",
  },
  rejected: {
    icon: UserX,
    badge: "Trạng thái: Bị từ chối",
    badgeClass: "border-[rgba(254,205,211,0.7)] bg-[#FFF1F2] text-[#BE123C] font-semibold tracking-[0.6px]",
    dot: "bg-[#E11D48]",
    ping: null,
    title: "Đơn đăng ký đã bị từ chối",
    body: "Quản trị viên đã từ chối đơn đăng ký của tài khoản này. Vui lòng liên hệ hỗ trợ qua Zalo hoặc Telegram bên dưới để được kiểm tra và mở lại tài khoản.",
  },
};

/* ------------------------------------------------------------------ */
/* QR                                                                  */
/* ------------------------------------------------------------------ */

/** Ảnh mã QR (cấu hình trong src/config/support.js — mặc định là ảnh giữ chỗ placehold.co) */
function QrBox({ image, label }) {
  return (
    <div className="flex w-[138px] shrink-0 flex-col items-center rounded-xl border border-[#E2E8F0] bg-white p-3 shadow-[0px_1px_2px_rgba(0,0,0,0.05)]">
      <div className="size-28 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC] p-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh ngoài / ảnh tĩnh, app dùng static export */}
        <img src={image} alt={label} className="size-full rounded object-contain" />
      </div>
      <span className="pt-2 font-heading text-[10px] leading-[15px] font-bold uppercase tracking-[0.5px] text-[#64748B]">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Thẻ kênh hỗ trợ                                                      */
/* ------------------------------------------------------------------ */

function useCopy(text) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return [copied, copy];
}

function SupportCard({ theme, logo, title, subtitle, qr, instructions, infoLabel, infoValue, copyText, copyLabel, action }) {
  const [copied, copy] = useCopy(copyText);
  const zalo = theme === "zalo";
  const ActionIcon = action.icon;
  return (
    <article
      className={cn(
        "flex flex-col justify-between rounded-2xl border bg-white p-6 shadow-[0px_1px_2px_rgba(0,0,0,0.05)]",
        zalo ? "border-[rgba(219,234,254,0.8)]" : "border-[rgba(207,250,254,0.8)]",
      )}
    >
      <div className="flex flex-col gap-5 pb-5">
        {/* Card Header */}
        <header className="flex items-center gap-3.5 border-b border-[#F1F5F9] pb-4">
          <span
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-xl border shadow-[inset_0px_2px_4px_1px_rgba(0,0,0,0.05)]",
              zalo ? "border-[#DBEAFE] bg-[#EFF6FF]" : "border-[#CFFAFE] bg-[#ECFEFF]",
            )}
          >
            {logo}
          </span>
          <div className="min-w-0 font-heading">
            <h2 className="text-lg leading-7 font-bold text-[#0F172A]">{title}</h2>
            <p className="text-sm leading-5 text-[#64748B]">{subtitle}</p>
          </div>
        </header>

        {/* QR + hướng dẫn */}
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          {qr}
          <div className="flex min-w-0 flex-1 flex-col gap-3 self-stretch sm:justify-center">
            <p className="font-heading text-sm leading-5 text-[#475569]">{instructions}</p>
            <div
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 font-heading text-sm leading-5",
                zalo ? "border-[#DBEAFE] bg-[rgba(239,246,255,0.7)]" : "border-[#CFFAFE] bg-[rgba(236,254,255,0.7)]",
              )}
            >
              <span className="font-medium text-[#64748B]">{infoLabel}</span>
              <span className={cn("truncate font-bold tracking-[0.35px]", zalo ? "text-[#1D4ED8]" : "text-[#155E75]")}>{infoValue}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Nút hành động */}
      <div className="grid grid-cols-2 gap-3 pt-2 font-heading text-sm leading-5 font-semibold">
        <a
          href={action.href}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl px-4 text-white shadow-[0px_1px_2px_rgba(0,0,0,0.05)] transition-colors",
            zalo ? "bg-[#2563EB] hover:bg-[#1D4ED8]" : "bg-[#0891B2] hover:bg-[#0E7490]",
            FOCUS,
          )}
        >
          {action.label}
          <ActionIcon aria-hidden="true" className="size-4" strokeWidth={2} />
        </a>
        <button
          type="button"
          onClick={copy}
          className={cn(
            "inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-4 text-[#334155] transition-colors hover:bg-[#F8FAFC]",
            FOCUS,
          )}
        >
          {copied ? (
            <Check aria-hidden="true" className="size-4 text-[#10B981]" strokeWidth={2.5} />
          ) : (
            <Copy aria-hidden="true" className="size-4 text-[#64748B]" strokeWidth={2} />
          )}
          {copied ? "Đã sao chép" : copyLabel}
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Màn hình                                                             */
/* ------------------------------------------------------------------ */

/**
 * Màn trạng thái tài khoản chưa dùng được.
 *  - variant      : "pending" | "locked" | "rejected"
 *  - engineOnline : true / false / null — dòng trạng thái máy chủ xác thực ở chân trang
 *  - onBack       : "Quay lại đăng nhập"
 *  - onRefresh    : "Làm mới trạng thái" (bỏ trống -> ẩn nút); refreshing = đang kiểm tra lại
 */
export default function AccountStatusScreen({ variant = "pending", engineOnline, onBack, onRefresh, refreshing = false }) {
  const v = VARIANTS[variant] || VARIANTS.pending;
  const Icon = v.icon;
  const { zalo, telegram } = SUPPORT;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFD] bg-[radial-gradient(70.71%_70.71%_at_50%_50%,rgba(37,99,235,0.06)_0%,rgba(37,99,235,0)_60%)] p-4 font-heading sm:p-8">
      <main className="w-full max-w-[1024px] overflow-hidden rounded-3xl border border-[#DBEAFE] bg-white shadow-[0px_20px_60px_-15px_rgba(37,99,235,0.12)]">
        {/* HeaderSection */}
        <section className="flex flex-col items-center bg-gradient-to-b from-[rgba(239,246,255,0.5)] to-[rgba(239,246,255,0)] px-6 pt-10 text-center sm:px-12">
          <span className="mb-2.5 grid size-20 place-items-center rounded-full border border-[#E2E8F0] bg-[#F8FBFF] shadow-[0px_20px_25px_-5px_rgba(75,142,255,0.1),0px_8px_10px_-6px_rgba(75,142,255,0.1)]">
            <Icon aria-hidden="true" className="size-8 text-[#0F172A]" strokeWidth={2.25} />
          </span>

          <span
            className={cn(
              "mb-4 inline-flex h-[30px] items-center gap-2 rounded-full border px-3.5 text-xs leading-4 uppercase shadow-[0px_1px_2px_rgba(0,0,0,0.05)]",
              v.badgeClass,
            )}
          >
            <span className="relative flex size-2">
              {v.ping && (
                <span aria-hidden="true" className={cn("absolute inset-0 rounded-full opacity-75 animate-ping motion-reduce:animate-none", v.ping)} />
              )}
              <span aria-hidden="true" className={cn("relative size-2 rounded-full", v.dot)} />
            </span>
            {v.badge}
          </span>

          <h1 className="pb-3 text-[28px] leading-9 font-extrabold tracking-[-0.9px] text-[#0F172A] sm:text-4xl sm:leading-10">{v.title}</h1>
          <p className="max-w-[940px] text-base leading-6 text-[#475569]">{v.body}</p>
        </section>

        {/* SupportOptionsSection */}
        <section className="grid grid-cols-1 gap-6 p-6 sm:p-10 lg:grid-cols-2">
          <SupportCard
            theme="zalo"
            logo={<span className="text-xl leading-7 font-extrabold tracking-[-1px] text-[#2563EB]">Zalo</span>}
            title="Hỗ trợ Zalo CSKH"
            subtitle="Kích hoạt giấy phép & Tư vấn bảng giá"
            qr={<QrBox image={zalo.qrImage} label="Quét mã Zalo" />}
            instructions="Mở ứng dụng Zalo trên điện thoại, chọn biểu tượng Quét mã QR hoặc liên hệ hotline để gửi thông tin HWID nhận duyệt ngay."
            infoLabel="Zalo Hotline:"
            infoValue={zalo.display}
            copyText={zalo.phone}
            copyLabel="Sao chép số"
            action={{ href: zalo.url, label: "Mở Zalo Chat", icon: ExternalLink }}
          />
          <SupportCard
            theme="telegram"
            logo={<Send aria-hidden="true" className="size-6 -rotate-12 text-[#0891B2]" strokeWidth={2.25} />}
            title="Kỹ thuật viên Telegram"
            subtitle="Xử lý HWID, Proxy & Kích hoạt tự động"
            qr={<QrBox image={telegram.qrImage} label="Quét Telegram" />}
            instructions="Nhắn tin trực tiếp với support qua Telegram để gửi mã HWID hoặc bill giao dịch. Bot sẽ duyệt tài khoản tự động trong vòng 60 giây."
            infoLabel="Telegram:"
            infoValue={telegram.display}
            copyText={telegram.display}
            copyLabel="Sao chép Tag"
            action={{ href: telegram.url, label: "Nhắn Telegram", icon: ArrowRight }}
          />
        </section>

        {/* FooterStatusSection */}
        <footer className="flex flex-col gap-4 border-t border-[#F1F5F9] bg-white px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <span className="inline-flex items-center gap-2.5 text-sm leading-5 font-medium text-[#475569]">
            <span className="relative flex size-2.5">
              {engineOnline !== false && (
                <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[#34D399] opacity-75 animate-ping motion-reduce:animate-none" />
              )}
              <span
                aria-hidden="true"
                className={cn("relative size-2.5 rounded-full", engineOnline === false ? "bg-red-500" : "bg-[#10B981]")}
              />
            </span>
            {engineOnline === false ? "Không kết nối được máy chủ xác thực" : "Hệ thống máy chủ xác thực hoạt động bình thường"}
          </span>

          <div className="flex items-center justify-end gap-3 text-sm leading-5 font-semibold">
            <button
              type="button"
              onClick={onBack}
              className={cn("inline-flex h-9 items-center gap-2 rounded-xl bg-[#F1F5F9] px-4 text-[#475569] transition-colors hover:bg-[#E2E8F0]", FOCUS)}
            >
              <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={2} />
              Quay lại đăng nhập
            </button>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-xl bg-[#2563EB] px-4 text-white shadow-[0px_1px_2px_rgba(0,0,0,0.05)] transition-colors hover:bg-[#1D4ED8] disabled:cursor-wait disabled:opacity-80",
                  FOCUS,
                )}
              >
                <RefreshCw aria-hidden="true" className={cn("size-4", refreshing && "animate-spin")} strokeWidth={2} />
                {refreshing ? "Đang kiểm tra..." : "Làm mới trạng thái"}
              </button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
