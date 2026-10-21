"use client";

import { CalendarX2, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { toast, useToasts } from "@/lib/toast";
import { cn } from "@/lib/utils";

// Toast thông báo thống nhất toàn app (theo Figma)
// Hỗ trợ 4 trạng thái: error, success, warning, info
// Nền sạch, viền + vạch màu chỉ định trạng thái bên trái, icon bo góc, tiêu đề in hoa.

const ICONS = {
  check: {
    Icon: CheckCircle2,
    box: "size-10 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5]",
    icon: "size-5 text-[#059669]",
  },
  alert: {
    Icon: TriangleAlert,
    box: "size-10 rounded-xl border border-[#EFA3A3] bg-[#F6D6D6]",
    icon: "size-5 text-[#E05252]",
  },
  calendar: {
    Icon: CalendarX2,
    box: "size-8 rounded-lg border border-[#F5A9B6] bg-[#FBCDD5]",
    icon: "size-4 text-[#E8536B]",
  },
  info: {
    Icon: Info,
    box: "size-10 rounded-xl border border-[#BFDBFE] bg-[#DBEAFE]",
    icon: "size-5 text-[#2563EB]",
  },
};

// Màu sắc theo biến thể
const VARIANTS = {
  success: {
    card: "border-[#A7F3D0] shadow-[0px_14px_28px_-10px_rgba(5,150,105,0.22),0px_2px_6px_rgba(5,150,105,0.06)]",
    bar: "from-[#10B981] to-[#34D399]",
    title: "text-[#065F46]",
    message: "text-[#374151]",
    close: "text-[#6EE7B7] hover:bg-[#D1FAE5] hover:text-[#065F46] focus-visible:ring-[#10B981]",
  },
  error: {
    card: "border-[#F2A3A3] shadow-[0px_14px_28px_-10px_rgba(127,29,29,0.28),0px_2px_6px_rgba(127,29,29,0.08)]",
    bar: "from-[#F28B8B] to-[#F6AFAF]",
    title: "text-[#C9473F]",
    message: "text-[#6E6262]",
    close: "text-[#B98585] hover:bg-[#F2DADA] hover:text-[#C9473F] focus-visible:ring-[#F28B8B]",
  },
  warning: {
    card: "border-[#FDE68A] shadow-[0px_14px_28px_-10px_rgba(217,119,6,0.22),0px_2px_6px_rgba(217,119,6,0.06)]",
    bar: "from-[#F59E0B] to-[#FBBF24]",
    title: "text-[#92400E]",
    message: "text-[#374151]",
    close: "text-[#FCD34D] hover:bg-[#FEF3C7] hover:text-[#92400E] focus-visible:ring-[#F59E0B]",
  },
  info: {
    card: "border-[#BFDBFE] shadow-[0px_14px_28px_-10px_rgba(30,64,175,0.22),0px_2px_6px_rgba(30,64,175,0.06)]",
    bar: "from-[#60A5FA] to-[#93C5FD]",
    title: "text-[#1D4ED8]",
    message: "text-[#475569]",
    close: "text-[#94A3B8] hover:bg-[#E2E8F0] hover:text-[#1D4ED8] focus-visible:ring-[#60A5FA]",
  },
};

function ToastCard({ item }) {
  const { Icon, box, icon } = ICONS[item.icon] || (item.variant === "success" ? ICONS.check : ICONS.alert);
  const tone = VARIANTS[item.variant] || VARIANTS.error;
  return (
    <li
      role="alert"
      onMouseEnter={() => toast.pause(item.id)}
      onMouseLeave={() => toast.resume(item.id)}
      className={cn(
        "group pointer-events-auto relative flex items-start gap-4 overflow-hidden rounded-2xl border bg-[#F5F5F5] py-4 pl-6 pr-10",
        tone.card,
        "animate-[toast-in_220ms_ease-out] motion-reduce:animate-none",
      )}
    >
      {/* Vạch màu bên trái */}
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-[5px] bg-gradient-to-r", tone.bar)} />

      <span className={cn("grid shrink-0 place-items-center", box)}>
        <Icon aria-hidden="true" className={icon} strokeWidth={2.5} />
      </span>

      <span className="flex min-w-0 flex-col gap-1">
        <span className={cn("font-display text-[15px] leading-6 font-bold uppercase tracking-[0.2px]", tone.title)}>{item.title}</span>
        {item.message && <span className={cn("text-[13px] leading-6", tone.message)}>{item.message}</span>}
      </span>

      <button
        type="button"
        onClick={() => toast.dismiss(item.id)}
        aria-label="Đóng thông báo"
        className={cn(
          "absolute right-3 top-3 grid size-6 place-items-center rounded-md opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 group-hover:opacity-100",
          tone.close,
        )}
      >
        <X className="size-3.5" strokeWidth={2.5} />
      </button>
    </li>
  );
}

/** Vùng hiển thị toast (góc dưới bên phải, z-[999999] để không bao giờ bị modal che). Đặt trong src/app/layout.js */
export default function Toaster() {
  const items = useToasts();
  return (
    <ol
      aria-live="assertive"
      className="pointer-events-none fixed right-4 bottom-4 z-[999999] flex w-[min(520px,calc(100vw-2rem))] flex-col-reverse gap-3"
    >
      {items.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </ol>
  );
}
