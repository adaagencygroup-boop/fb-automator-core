"use client";

import { useMemo } from "react";

export default function AdvancedScanFilterCard({
  minDelay,
  setMinDelay,
  maxDelay,
  setMaxDelay,
  switchAccThreshold,
  setSwitchAccThreshold,
  postsPerGroupLimit,
  setPostsPerGroupLimit,
  filterDaysEnabled,
  setFilterDaysEnabled,
  filterDays,
  setFilterDays,
  skipPinnedPosts,
  setSkipPinnedPosts,
  autoDedupePosts,
  setAutoDedupePosts,
}) {
  const delayError = useMemo(() => {
    if (minDelay > maxDelay) {
      return "Thời gian tối đa luôn phải lớn hơn hoặc bằng thời gian tối thiểu.";
    }
    if (maxDelay > 3600) {
      return "Thời gian tối đa không được vượt quá 3600 giây.";
    }
    return "";
  }, [minDelay, maxDelay]);

  return (
    <section className="flex flex-col h-full rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
      <div className="flex items-center gap-2.5 pb-3 border-b border-[#F1F5F9]">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#1877F2] text-[11px] font-bold text-white shrink-0">
          2
        </span>
        <h2 className="text-sm font-bold text-[#0B1C30]">
          Cấu hình quét nâng cao & Giới hạn
        </h2>
      </div>

      <div className="space-y-3.5">
        {/* Cài đặt khoảng cách quét */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#334155]">
              Khoảng cách giữa các lần quét:
            </span>
            <div className="flex items-center gap-2">
              {/* Min delay stepper */}
              <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                <button
                  type="button"
                  onClick={() => setMinDelay((v) => Math.max(1, v - 1))}
                  className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                >
                  -
                </button>
                <input
                  type="number"
                  value={minDelay}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 1;
                    setMinDelay(Math.min(3600, Math.max(1, val)));
                  }}
                  className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => setMinDelay((v) => Math.min(3600, v + 1))}
                  className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                >
                  +
                </button>
              </div>

              <span className="text-xs text-[#94A3B8]">-</span>

              {/* Max delay stepper */}
              <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
                <button
                  type="button"
                  onClick={() => setMaxDelay((v) => Math.max(1, v - 1))}
                  className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                >
                  -
                </button>
                <input
                  type="number"
                  value={maxDelay}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 1;
                    setMaxDelay(Math.min(3600, Math.max(1, val)));
                  }}
                  className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => setMaxDelay((v) => Math.min(3600, v + 1))}
                  className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                >
                  +
                </button>
              </div>

              <span className="text-xs text-[#64748B]">giây</span>
            </div>
          </div>
          {delayError && (
            <p className="text-[11px] font-medium text-rose-500">
              * {delayError}
            </p>
          )}
        </div>

        {/* Giới hạn đổi tài khoản */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-[#334155]">
            Đổi tài khoản mới khi quét được:
          </span>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
              <button
                type="button"
                onClick={() => setSwitchAccThreshold((v) => Math.max(5, v - 5))}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
              >
                -
              </button>
              <input
                type="number"
                value={switchAccThreshold}
                onChange={(e) => {
                  const val = Number(e.target.value) || 1;
                  setSwitchAccThreshold(Math.min(100, Math.max(1, val)));
                }}
                className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => setSwitchAccThreshold((v) => Math.min(100, v + 5))}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
              >
                +
              </button>
            </div>
            <span className="text-xs text-[#64748B]">bài / nick</span>
          </div>
        </div>

        {/* Giới hạn bài mỗi nhóm */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-[#334155]">
            Mỗi nhóm quét tối đa:
          </span>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
              <button
                type="button"
                onClick={() => setPostsPerGroupLimit((v) => Math.max(10, v - 10))}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
              >
                -
              </button>
              <input
                type="number"
                value={postsPerGroupLimit}
                onChange={(e) => {
                  const val = Number(e.target.value) || 10;
                  setPostsPerGroupLimit(Math.min(100, Math.max(1, val)));
                }}
                className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => setPostsPerGroupLimit((v) => Math.min(100, v + 10))}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
              >
                +
              </button>
            </div>
            <span className="text-xs text-[#64748B]">bài mới nhất</span>
          </div>
        </div>

        {/* Checkboxes Group */}
        <div className="space-y-2 pt-1 border-t border-[#F1F5F9]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filterDaysEnabled}
                onChange={(e) => setFilterDaysEnabled(e.target.checked)}
                className="size-4 text-[#1877F2] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
              />
              <span className="text-xs font-medium text-[#334155]">
                Chỉ quét các bài viết đăng trong vòng
              </span>
            </label>
            <div className="flex items-center gap-2">
              <div className={`flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7 ${!filterDaysEnabled ? "opacity-50 pointer-events-none" : ""}`}>
                <button
                  type="button"
                  disabled={!filterDaysEnabled}
                  onClick={() => setFilterDays((v) => Math.max(1, v - 1))}
                  className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
                >
                  -
                </button>
                <input
                  type="number"
                  disabled={!filterDaysEnabled}
                  value={filterDays}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 1;
                    setFilterDays(Math.min(365, Math.max(1, val)));
                  }}
                  className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  disabled={!filterDaysEnabled}
                  onClick={() => setFilterDays((v) => Math.min(365, v + 1))}
                  className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
                >
                  +
                </button>
              </div>
              <span className="text-xs text-[#64748B]">ngày qua</span>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={skipPinnedPosts}
              onChange={(e) => setSkipPinnedPosts(e.target.checked)}
              className="size-4 text-[#1877F2] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
            />
            <span className="text-xs font-medium text-[#334155]">
              Bỏ qua bài viết ghim của Quản trị viên
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoDedupePosts}
              onChange={(e) => setAutoDedupePosts(e.target.checked)}
              className="size-4 text-[#1877F2] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
            />
            <span className="text-xs font-medium text-[#334155]">
              Tự động lọc trùng lặp bài viết giữa các nhóm
            </span>
          </label>
        </div>
      </div>
    </section>
  );
}
