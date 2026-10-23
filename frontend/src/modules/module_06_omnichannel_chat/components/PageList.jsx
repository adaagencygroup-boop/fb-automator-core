"use client";

import { cn } from "@/lib/utils";
import { useIncrementalList } from "@/lib/use-incremental-list";

// Figma: Section - COLUMN 1: DANH SÁCH PAGE (1072:12082)

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

export function PageAvatar({ page, size = 32 }) {
  const style = { width: size, height: size };
  if (page.avatar) {
    return (
      <img
        src={page.avatar}
        alt=""
        style={style}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  if (page.initials) {
    return (
      <span
        style={{ ...style, background: page.initials.bg, color: page.initials.fg }}
        className={cn(
          "shrink-0 rounded-full flex items-center justify-center font-bold",
          page.initials.small ? "text-[10px] leading-5" : "text-xs leading-4",
        )}
      >
        {page.initials.text}
      </span>
    );
  }
  // Page chưa có ảnh & chữ viết tắt -> icon mặc định (Figma: "Giao Tiếp Tiếng Anh")
  return (
    <span style={style} className="shrink-0 rounded-full bg-slate-200 flex items-center justify-center">
      <img src="/icons/icon_page_placeholder.svg" alt="" width={15} height={12} className="block" />
    </span>
  );
}

function PageStatus({ page, active }) {
  if (page.unread > 0) {
    return (
      <span
        aria-label={`${page.unread} thông báo chưa đọc`}
        className={cn(
          "shrink-0 rounded-full px-1.5 text-[11px] leading-5 font-bold text-white text-center",
          active ? "min-w-5" : "min-w-[18px]",
          page.alert ? "bg-red-500" : active ? "bg-blue-600" : "bg-blue-500",
        )}
      >
        {page.unread}
      </span>
    );
  }
  return (
    <span className="shrink-0 w-4 h-2.5 pr-1.5" aria-label="Đang kết nối">
      <span className="block size-2.5 rounded-full bg-emerald-500" />
    </span>
  );
}

export default function PageList({
  pages,
  total,
  activePageId,
  onSelectPage,
  search,
  onSearchChange,
  onReset,
  resetting,
  loading = false,
  chatStatus = null,
  className,
}) {
  const { slice, sentinelRef, hasMore } = useIncrementalList(pages, 40);
  return (
    <section
      aria-label="Danh sách Page"
      className={cn("w-[317px] shrink-0 h-full flex flex-col bg-white border border-slate-200 rounded-xl drop-shadow-[0px_1px_1px_rgba(0,0,0,0.05)] overflow-hidden", className)}
    >
      {/* Action Buttons + tiêu đề + ô tìm kiếm */}
      <div className="flex flex-col gap-2.5 px-3 pt-3 pb-2 shrink-0">
        <button
          type="button"
          onClick={onReset}
          disabled={resetting || loading}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-[13px] py-[7px] rounded-md border border-blue-200 bg-blue-50 text-blue-600 text-xs leading-4 transition-colors hover:bg-blue-100 disabled:opacity-60",
            FOCUS,
          )}
        >
          <img
            src="/icons/icon_chat_reset.svg"
            alt=""
            width={11.25}
            height={10.5}
            className={cn("block", (resetting || loading) && "animate-spin")}
          />
          {resetting ? "Đang đồng bộ..." : "Reset dữ liệu"}
        </button>

        <button
          type="button"
          onClick={() => onSelectPage(null)}
          aria-pressed={activePageId === null}
          className={cn(
            "w-full flex items-center justify-center px-[13px] py-[7px] rounded-md border text-xs leading-4 transition-colors",
            activePageId === null
              ? "border-blue-600 bg-blue-600 text-white"
              : "border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100",
            FOCUS,
          )}
        >
          Tất cả các trang
        </button>

        <h3 className="font-sans text-xs leading-4 font-bold tracking-[0.6px] text-slate-800 uppercase flex items-center justify-between">
          <span>Danh sách Page {loading ? "" : `(${total})`}</span>
          {loading && <span className="text-[11px] font-normal lowercase text-slate-400">Đang tải...</span>}
        </h3>

        <label className="relative block">
          <span className="sr-only">Tìm Page</span>
          <img
            src="/icons/icon_search.svg"
            alt=""
            width={12}
            height={12}
            className="absolute left-3 top-[13px] block pointer-events-none"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm Page..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-[33px] pr-[13px] py-[9px] text-xs leading-4 text-slate-800 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
          />
        </label>
      </div>

      {/* Scrollable Page List Items */}
      <ul className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
        {loading ? (
          <li className="flex-1 py-12 flex flex-col items-center justify-center text-center gap-2">
            <div className="size-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-slate-500 font-medium">Đang tải dữ liệu...</span>
          </li>
        ) : pages.length === 0 ? (
          search.trim() ? (
            <li className="px-3 py-6 text-center text-xs text-slate-400">Không tìm thấy Page phù hợp.</li>
          ) : chatStatus && !chatStatus.has_accounts ? (
            <li className="px-3 py-8 text-center flex flex-col items-center gap-2">
              <span className="text-xs text-slate-600 font-semibold">Chưa có tài khoản Facebook ở Module 2</span>
              <span className="text-[11px] text-slate-400">Hãy thêm tài khoản tại Quản lý tài khoản để bắt đầu đồng bộ Page.</span>
              <a
                href="/accounts"
                className="mt-1.5 inline-flex items-center px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors"
              >
                Thêm tài khoản
              </a>
            </li>
          ) : chatStatus && chatStatus.has_accounts && !chatStatus.has_pages ? (
            <li className="px-3 py-8 text-center flex flex-col items-center gap-2">
              <span className="text-xs text-slate-600 font-semibold">Tài khoản chưa có Fanpage nào</span>
              <span className="text-[11px] text-slate-400">Tài khoản đã import nhưng chưa tạo hoặc chưa được cấp quyền quản lý Page.</span>
            </li>
          ) : (
            <li className="px-3 py-6 text-center text-xs text-slate-400">Không tìm thấy Page phù hợp.</li>
          )
        ) : null}
        {slice.map((page) => {
          const active = page.id === activePageId;
          return (
            <li key={page.id}>
              <button
                type="button"
                onClick={() => onSelectPage(page.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "w-full flex items-center justify-between gap-2 p-2 rounded-lg border text-left transition-colors",
                  active ? "bg-blue-50 border-blue-100" : "border-transparent hover:bg-slate-50",
                  FOCUS,
                )}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <PageAvatar page={page} />
                  <span
                    className={cn(
                      "truncate text-xs leading-4 font-bold",
                      active ? "text-slate-900" : "text-slate-700",
                    )}
                  >
                    {page.name}
                  </span>
                </span>
                <PageStatus page={page} active={active} />
              </button>
            </li>
          );
        })}
        {hasMore && <li ref={sentinelRef} aria-hidden="true" className="h-4 shrink-0" />}
      </ul>
    </section>
  );
}
