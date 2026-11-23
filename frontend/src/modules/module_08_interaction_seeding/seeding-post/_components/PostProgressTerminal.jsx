"use client";

import React, { useEffect, useRef } from "react";
import { Activity, AlertTriangle, CheckCircle } from "lucide-react";
import { CARD } from "./StepCard";

const TEXT = {
  success: "text-emerald-700",
  warn: "text-amber-700",
  error: "font-semibold text-rose-700",
  info: "text-slate-600",
};

/** Thẻ "Theo dõi tiến trình" (theo Figma): tiến độ lô (children) + nhật ký chạy nền sáng, luôn hiện. */
export default function PostProgressTerminal({ logs, isRunning, children }) {
  const terminalContainerRef = useRef(null);

  useEffect(() => {
    // Chỉ cuộn riêng khung nhật ký, không cuộn cả trang
    const container = terminalContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [logs]);

  return (
    <section className={`${CARD} space-y-4 p-6`} aria-labelledby="seeding-progress-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-emerald-600" aria-hidden="true" />
          <h2 id="seeding-progress-title" className="text-sm font-bold text-slate-900">
            Theo dõi tiến trình
          </h2>
          {isRunning && (
            <span className="ml-1 flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
              Đang chạy...
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] text-slate-400">{logs.length} dòng nhật ký</span>
      </div>

      {children}

      <div
        ref={terminalContainerRef}
        role="log"
        aria-live="polite"
        className="h-56 select-text space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-4 font-mono text-[11px]"
      >
        {logs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center italic text-slate-400">
            Chưa có tiến trình nào đang chạy. Nhấn &quot;Bắt đầu seeding&quot; để khởi chạy tự động.
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 leading-relaxed">
              <span className="shrink-0 select-none text-slate-400">[{log.time}]</span>
              {log.type === "success" && <CheckCircle className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />}
              {log.type === "warn" && <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden="true" />}
              {log.type === "error" && <span className="shrink-0 font-bold text-rose-600">[ERR]</span>}
              <span className={TEXT[log.type] || TEXT.info}>{log.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
