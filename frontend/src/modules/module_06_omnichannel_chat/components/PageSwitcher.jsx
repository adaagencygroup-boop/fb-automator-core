"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useIncrementalList } from "@/lib/use-incremental-list";
import { PageAvatar } from "./PageList";

/**
 * Nút đổi Page cho bố cục hẹp (khi đang mở chi tiết, cột Danh sách Page bị ẩn).
 *
 * Thay cho sheet trượt: nút hiện luôn avatar + tên Page đang chọn, bấm vào mở
 * popover nhỏ ngay bên dưới. Không cần lớp phủ tối, không che nội dung đang xem.
 */

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

/** Chưa chọn Page cụ thể -> biểu tượng "tất cả các trang" thay cho avatar */
function AllPagesGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
      className="block text-slate-500"
    >
      <rect x="2.5" y="2.5" width="6.2" height="6.2" rx="1.6" />
      <rect x="11.3" y="2.5" width="6.2" height="6.2" rx="1.6" />
      <rect x="2.5" y="11.3" width="6.2" height="6.2" rx="1.6" />
      <rect x="11.3" y="11.3" width="6.2" height="6.2" rx="1.6" />
    </svg>
  );
}

export default function PageSwitcher({
  pages,
  total,
  activePageId,
  activePage,
  onSelectPage,
  search,
  onSearchChange,
  onReset,
  resetting,
}) {
  const [open, setOpen] = useState(false);
  const searchRef = useRef(null);
  const { slice, sentinelRef, hasMore } = useIncrementalList(pages, 40);

  // Mở popover -> con trỏ nhảy thẳng vào ô tìm kiếm để gõ ngay
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pick = (id) => {
    onSelectPage(id);
    setOpen(false);
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={activePage ? `Đổi Page — đang chọn ${activePage.name}` : "Chọn Page"}
        title={activePage ? `${activePage.name} — bấm để đổi Page` : "Tất cả các trang — bấm để chọn Page"}
        className={cn(
          // Chỉ to bằng avatar: cột này nằm cạnh khung chi tiết, rộng ra là thừa một dải trống
          "size-9 flex items-center justify-center rounded-lg border bg-white shadow-sm transition-colors",
          open ? "border-sky-400 bg-slate-50" : "border-slate-200 hover:bg-slate-50",
          FOCUS,
        )}
      >
        {activePage ? <PageAvatar page={activePage} size={26} /> : <AllPagesGlyph />}
      </button>

      {open && (
        <>
          {/* Bắt cú bấm ra ngoài để đóng — trong suốt, không làm tối nội dung */}
          <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setOpen(false)} />

          <div
            role="dialog"
            aria-label="Chọn Page"
            className="absolute left-0 top-full z-40 mt-1.5 w-[290px] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
          >
            <div className="shrink-0 p-2">
              <label className="relative block">
                <span className="sr-only">Tìm Page</span>
                <img
                  src="/icons/icon_search.svg"
                  alt=""
                  width={12}
                  height={12}
                  className="absolute left-3 top-[11px] block pointer-events-none"
                />
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Tìm Page..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-[33px] pr-3 py-[7px] text-xs leading-4 text-slate-800 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
                />
              </label>
            </div>

            <ul className="min-h-0 max-h-64 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
              {pages.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-slate-400">Không tìm thấy Page phù hợp.</li>
              )}
              {slice.map((page) => {
                const active = page.id === activePageId;
                return (
                  <li key={page.id}>
                    <button
                      type="button"
                      onClick={() => pick(page.id)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 rounded-lg border p-1.5 text-left transition-colors",
                        active ? "border-blue-100 bg-blue-50" : "border-transparent hover:bg-slate-50",
                        FOCUS,
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <PageAvatar page={page} size={26} />
                        <span
                          className={cn(
                            "truncate text-xs leading-4 font-bold",
                            active ? "text-slate-900" : "text-slate-700",
                          )}
                        >
                          {page.name}
                        </span>
                      </span>
                      {page.unread > 0 ? (
                        <span
                          aria-label={`${page.unread} tin chưa đọc`}
                          className={cn(
                            "shrink-0 min-w-[18px] rounded-full px-1.5 text-center text-[11px] leading-5 font-bold text-white",
                            page.alert ? "bg-red-500" : "bg-blue-500",
                          )}
                        >
                          {page.unread}
                        </span>
                      ) : (
                        <span className="block size-2.5 shrink-0 rounded-full bg-emerald-500" aria-label="Đang kết nối" />
                      )}
                    </button>
                  </li>
                );
              })}
              {hasMore && <li ref={sentinelRef} aria-hidden="true" className="h-4 shrink-0" />}
            </ul>

            {/* Hai việc ít dùng dồn xuống đáy, không chiếm chỗ đầu danh sách như sheet cũ */}
            <div className="shrink-0 flex items-center gap-1 border-t border-slate-100 p-1.5">
              <button
                type="button"
                onClick={() => pick(null)}
                aria-pressed={activePageId === null}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 text-xs leading-4 transition-colors",
                  activePageId === null ? "bg-blue-600 text-white" : "text-blue-600 hover:bg-blue-50",
                  FOCUS,
                )}
              >
                Tất cả các trang ({total})
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onReset();
                }}
                disabled={resetting}
                title="Reset dữ liệu"
                className={cn(
                  "shrink-0 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs leading-4 text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60",
                  FOCUS,
                )}
              >
                <img
                  src="/icons/icon_chat_reset.svg"
                  alt=""
                  width={11.25}
                  height={10.5}
                  className={cn("block", resetting && "animate-spin")}
                />
                {resetting ? "Đang đồng bộ..." : "Reset"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
