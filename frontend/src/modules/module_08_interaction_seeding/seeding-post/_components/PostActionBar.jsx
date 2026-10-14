"use client";

import React from "react";
import { Play, Square, Loader2 } from "lucide-react";

export default function PostActionBar({
  isRunning,
  onStart,
  onStop,
  disabled = false,
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
      <button
        type="button"
        onClick={onStart}
        disabled={isRunning || disabled}
        className={`w-full py-3.5 px-6 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md ${
          isRunning || disabled
            ? "bg-emerald-600/50 text-white/70 cursor-not-allowed shadow-none"
            : "bg-[#059669] hover:bg-[#047857] text-white shadow-emerald-700/20 active:scale-[0.99]"
        }`}
      >
        {isRunning ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            ĐANG CHẠY SEEDING...
          </>
        ) : (
          <>
            <Play className="w-4 h-4 fill-current" />
            BẮT ĐẦU SEEDING
          </>
        )}
      </button>

      <button
        type="button"
        onClick={onStop}
        disabled={!isRunning}
        className={`w-full py-3.5 px-6 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md ${
          !isRunning
            ? "bg-rose-600/40 text-white/50 cursor-not-allowed shadow-none"
            : "bg-[#DC2626] hover:bg-[#B91C1C] text-white shadow-rose-700/20 active:scale-[0.99]"
        }`}
      >
        <Square className="w-4 h-4 fill-current" />
        DỪNG SEEDING
      </button>
    </div>
  );
}
