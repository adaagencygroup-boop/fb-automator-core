"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import StatusFilter from "./StatusFilter";
import { NotificationSkeleton } from "./Skeletons";

// Figma: "Thông báo" (CSS all layers, 1593:2028) — sub-tab Bình luận / Tương tác bài viết + thẻ thông báo

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500";

export const NOTIFICATION_TYPES = [
  { id: "comment", label: "Bình luận" },
  { id: "interaction", label: "Tương tác bài viết" },
];

// Màu avatar chữ cái theo Figma (nền / chữ)
const AVATAR_COLORS = [
  ["#E1EFFF", "#1877F2"],
  ["#E5EDF9", "#295BAC"],
  ["#E1F7EB", "#00875A"],
  ["#FCE6E8", "#D83A52"],
  ["#FAECE0", "#B85718"],
];

function avatarColor(name = "") {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const initialOf = (name = "") => (name.trim()[0] || "?").toUpperCase();

/** Định dạng thời gian theo múi giờ Việt Nam (UTC+7) chuẩn xác */
const formatDateTime = (iso) => {
  if (!iso) return "";
  let dateStr = String(iso).trim();
  if (!dateStr.endsWith("Z") && !dateStr.includes("+") && !dateStr.includes("-", 11)) {
    dateStr += "Z";
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour12: false
  });
};

function SubTabs({ type, onTypeChange, counts }) {
  return (
    <div role="tablist" aria-label="Loại thông báo" className="flex border-t border-gray-100 shrink-0">
      {NOTIFICATION_TYPES.map((t) => {
        const active = type === t.id;
        const count = counts[t.id] || 0;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTypeChange(t.id)}
            className={cn(
              "flex-1 min-w-0 flex items-center justify-center gap-1.5 px-3 pt-2.5 pb-[11px] -mb-px border-b-2 text-[13px] leading-5 whitespace-nowrap transition-colors",
              active ? "border-primary text-primary font-semibold" : "border-transparent text-gray-600 font-medium hover:text-gray-800",
              FOCUS,
            )}
          >
            <span>{t.label}</span>
            {count > 0 && <span className="text-xs">({count})</span>}
          </button>
        );
      })}
    </div>
  );
}

function NotificationCard({ notification, pageName, onOpen }) {
  const [bg, fg] =
    notification.actorColor != null
      ? AVATAR_COLORS[notification.actorColor % AVATAR_COLORS.length]
      : avatarColor(notification.actor);
  const unread = notification.unread;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "relative w-full flex items-start gap-3.5 p-3.5 rounded-xl bg-white text-left border border-gray-200/90 shadow-[0px_1px_2px_rgba(0,0,0,0.05)] transition-colors hover:border-gray-300",
          FOCUS,
        )}
      >
        <span
          style={{ background: bg, color: fg }}
          className="size-12 shrink-0 rounded-full flex items-center justify-center text-lg leading-7 font-bold"
          aria-hidden="true"
        >
          {initialOf(notification.actor)}
        </span>

        <span className={cn("flex-1 min-w-0 flex flex-col gap-1.5", unread ? "pr-4" : "pr-1")}>
          <span className="text-sm leading-[19px] text-gray-800 [overflow-wrap:anywhere]">
            {notification.replied && (
              <span className="font-bold text-emerald-500 mr-1.5" aria-label="Đã xử lý">
                ✓
              </span>
            )}
            <strong className="font-bold text-gray-900">{notification.actor}</strong>{" "}
            {" "}
            {notification.text}
          </span>
          <span className="text-xs leading-[15px] text-gray-500 [overflow-wrap:anywhere]">
            {formatDateTime(notification.createdAt)}
            {pageName && ` · ${pageName}`}
          </span>
        </span>

        {unread && (
          <span
            aria-label="Chưa xem"
            className="absolute right-[17px] top-[17px] size-2.5 rounded-full bg-emerald-500 shadow-[0px_0px_0px_2px_#FFFFFF]"
          />
        )}
      </button>
    </li>
  );
}

/**
 * Danh sách thông báo.
 *
 * Lọc theo Page / tab / trạng thái và sắp xếp đều do Backend làm — `notifications`
 * đến đây là những trang đã tải của đúng bộ lọc đang xem, không lọc thêm gì nữa.
 * Badge `counts` cũng từ Backend, vì ở đây không còn cả danh sách để tự đếm.
 */
export default function NotificationList({
  notifications,
  counts,
  onLoadMore,
  hasMore,
  loadingMore,
  pagesById,
  type,
  onTypeChange,
  filter,
  onFilterChange,
  onOpenNotification,
  loading,
}) {
  const list = notifications;

  // Cuộn tới gần đáy thì xin trang kế. `rootMargin` cho nạp sớm 200px để người
  // dùng không phải đợi ở đáy. Đang tải thì không gắn observer, tránh xin chồng.
  const moreRef = useRef(null);
  useEffect(() => {
    const el = moreRef.current;
    if (!el || !hasMore || loadingMore || !onLoadMore) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore();
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, onLoadMore, list.length]);

  return (
    <>
      <SubTabs type={type} onTypeChange={onTypeChange} counts={counts || {}} />
      <StatusFilter filter={filter} onFilterChange={onFilterChange} label="Lọc thông báo" />
      {loading ? (
        <NotificationSkeleton />
      ) : (
      <ul className="flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-3 bg-slate-50/50">
        {list.length === 0 && <li className="py-10 text-center text-xs text-slate-400">Chưa có thông báo.</li>}
        {list.map((n) => (
          <NotificationCard
            key={n.id}
            notification={n}
            pageName={pagesById[n.pageId]?.name}
            onOpen={() => onOpenNotification(n.id)}
          />
        ))}
        {hasMore && (
          <li ref={moreRef} className="py-2 text-center text-xs text-slate-400">
            {loadingMore ? "Đang tải thêm…" : "Cuộn để xem thêm"}
          </li>
        )}
      </ul>
      )}
    </>
  );
}
