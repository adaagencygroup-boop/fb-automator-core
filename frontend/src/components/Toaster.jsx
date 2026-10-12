"use client";

import { CalendarX2, Info, TriangleAlert, X } from "lucide-react";
import { toast, useToasts } from "@/lib/toast";
import { cn } from "@/lib/utils";

// Toast lỗi (Figma: "Đăng nhập thất bại", "Bản quyền license đã hết hạn", "Lỗi xác thực phần cứng HWID")
// Nền xám nhạt, viền + vạch trái màu đỏ hồng, icon trong ô bo góc, tiêu đề in hoa đỏ.

const ICONS = {
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

// Màu theo loại toast: error (mặc định, theo Figma) | info (thông báo trung tính)
const VARIANTS = {
  error: {
    card: "border-[#F2A3A3] shadow-[0px_14px_28px_-10px_rgba(127,29,29,0.28),0px_2px_6px_rgba(127,29,29,0.08)]",
    bar: "from-[#F28B8B] to-[#F6AFAF]",
    title: "text-[#C9473F]",
    message: "text-[#6E6262]",
    close: "text-[#B98585] hover:bg-[#F2DADA] hover:text-[#C9473F] focus-visible:ring-[#F28B8B]",
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
  const { Icon, box, icon } = ICONS[item.icon] || ICONS.alert;
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

/** Vùng hiển thị toast (góc trên bên phải). Đặt một lần trong src/app/layout.js */
export default function Toaster() {
  const items = useToasts();
  return (
    <ol
      aria-live="assertive"
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(520px,calc(100vw-2rem))] flex-col gap-3"
    >
      {items.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </ol>
  );
}
