"use client";

import { cn } from "@/lib/utils";

/**
 * Khung xương lúc đang tải cho module Chat.
 *
 * Trước đây khi tải xong mới có dữ liệu, còn trong lúc chờ thì danh sách rỗng
 * nên hiện "Không tìm thấy..." — dễ hiểu nhầm là không có gì. Skeleton cho thấy
 * đúng hình dáng nội dung sắp tới và giữ nguyên chiều cao, tránh giật layout.
 *
 * Bề rộng các vạch lấy từ mảng cố định (không dùng Math.random) để lần dựng ở
 * server và ở trình duyệt ra giống nhau.
 */

const PULSE = "motion-safe:animate-pulse";

/** Một vạch xám đại diện cho chữ/ảnh chưa tải */
function Bar({ className }) {
  return <span className={cn("block rounded bg-slate-200/70", className)} />;
}

export function PageListSkeleton({ rows = 8 }) {
  const widths = ["w-4/5", "w-3/5", "w-11/12", "w-2/3", "w-3/4", "w-1/2", "w-5/6", "w-7/12"];
  return (
    <ul aria-hidden="true" className={cn("flex-1 min-h-0 overflow-hidden px-2 pb-2 flex flex-col gap-0.5", PULSE)}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center justify-between gap-2 p-2">
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <Bar className="size-8 shrink-0 rounded-full" />
            <Bar className={cn("h-3", widths[i % widths.length])} />
          </span>
          <Bar className="size-2.5 shrink-0 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

export function ConversationSkeleton({ rows = 7 }) {
  const names = ["w-2/5", "w-1/2", "w-1/3", "w-5/12", "w-2/5", "w-1/2", "w-1/3"];
  const snippets = ["w-11/12", "w-3/4", "w-full", "w-2/3", "w-5/6", "w-3/5", "w-4/5"];
  return (
    <ul aria-hidden="true" className={cn("flex-1 min-h-0 overflow-hidden", PULSE)}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className={cn("flex flex-col gap-1.5 px-3 py-3", i > 0 && "border-t border-slate-100")}>
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <Bar className="size-3 shrink-0 rounded-full" />
              <Bar className={cn("h-3", names[i % names.length])} />
            </span>
            <Bar className="h-2.5 w-10 shrink-0" />
          </span>
          <Bar className={cn("h-3", snippets[i % snippets.length])} />
          <Bar className="h-4 w-24 rounded" />
        </li>
      ))}
    </ul>
  );
}

export function NotificationSkeleton({ rows = 5 }) {
  const lines = ["w-full", "w-10/12", "w-full", "w-9/12", "w-11/12"];
  return (
    <ul aria-hidden="true" className={cn("flex-1 min-h-0 overflow-hidden p-3.5 flex flex-col gap-3 bg-slate-50/50", PULSE)}>
      {Array.from({ length: rows }, (_, i) => (
        <li
          key={i}
          className="flex items-start gap-3.5 rounded-xl border border-gray-200/90 bg-white p-3.5 shadow-[0px_1px_2px_rgba(0,0,0,0.05)]"
        >
          <Bar className="size-12 shrink-0 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Bar className={cn("h-3.5", lines[i % lines.length])} />
            <Bar className="h-3.5 w-2/3" />
            <Bar className="mt-0.5 h-2.5 w-5/12" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Bong bóng tin nhắn xen kẽ khách / mình, giống dòng chảy hội thoại thật */
export function MessageSkeleton() {
  const bubbles = [
    { out: false, w: "w-40", h: "h-9" },
    { out: false, w: "w-56", h: "h-14" },
    { out: true, w: "w-44", h: "h-9" },
    { out: false, w: "w-32", h: "h-9" },
    { out: true, w: "w-60", h: "h-16" },
    { out: true, w: "w-36", h: "h-9" },
  ];
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-3 px-6 pt-6 pb-4", PULSE)}>
      {bubbles.map((b, i) => (
        <div key={i} className={cn("flex items-end gap-2", b.out ? "justify-end" : "justify-start")}>
          {!b.out && <Bar className="size-7 shrink-0 rounded-full" />}
          <Bar className={cn("max-w-[70%] rounded-2xl", b.w, b.h)} />
        </div>
      ))}
    </div>
  );
}
