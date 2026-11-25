"use client";

import { Play, RotateCcw } from "lucide-react";

const BASE =
  "flex cursor-pointer items-center justify-center gap-2 text-xs font-bold tracking-wider transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60";

function StopIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Nút điều khiển phiên quét (Module 11, 13), cùng kiểu với trang đăng bài Module 3. */
export function ScanActionButtons({
  live, paused, stopping = false, showNewScan = false, startDisabled = false, controlDisabled = false,
  onStart, onPauseResume, onStop, onNewScan,
}) {
  if (live) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={controlDisabled || stopping}
          onClick={onPauseResume}
          className={`${BASE} flex-1 rounded-2xl border px-6 py-3 shadow-2xs ${
            paused ? "border-rose-700 bg-rose-700 text-white hover:bg-rose-800" : "border-[#be123c] bg-[#f8f9ff] text-[#881337] hover:bg-rose-50/60"
          }`}
        >
          {paused ? <Play size={14} className="fill-white text-white" /> : <StopIcon />}
          <span>{paused ? "TIẾP TỤC CHẠY" : "TẠM DỪNG"}</span>
        </button>
        <button
          type="button"
          disabled={controlDisabled || stopping}
          onClick={onStop}
          className={`${BASE} rounded-2xl bg-[#fcdcdc] px-7 py-3 text-[#881337] shadow-2xs hover:bg-rose-200`}
        >
          <StopIcon />
          <span>{stopping ? "ĐANG DỪNG..." : "DỪNG KHẨN CẤP"}</span>
        </button>
      </div>
    );
  }
  // Còn kết quả đang xem: nút Quét mới thay chỗ nút Bắt đầu (giống Module 3)
  if (showNewScan) {
    return (
      <button
        type="button"
        disabled={startDisabled || controlDisabled}
        onClick={onNewScan}
        className={`${BASE} w-full rounded-2xl bg-blue-600 px-6 py-3 text-white shadow-sm hover:bg-blue-700`}
      >
        <RotateCcw size={14} />
        <span>QUÉT MỚI (XÓA KẾT QUẢ ĐANG XEM)</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={startDisabled}
      onClick={onStart}
      className={`${BASE} w-full rounded-xl bg-blue-600 py-3.5 text-white shadow-sm shadow-blue-500/20 hover:bg-blue-700`}
    >
      <Play size={14} className="fill-white" />
      <span>BẮT ĐẦU THỰC THI</span>
    </button>
  );
}
