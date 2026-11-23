"use client";

import React, { useRef, useEffect } from "react";
import { Activity, CheckCircle, AlertTriangle } from "lucide-react";

export default function PostProgressTerminal({
  logs,
  isRunning,
}) {
  const terminalContainerRef = useRef(null);

  useEffect(() => {
    // Chỉ cuộn riêng khung chứa terminal, tuyệt đối không cuộn toàn bộ trang web
    const container = terminalContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-white rounded-2xl border border-gray-200/90 shadow-sm p-6 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-gray-800">
          <Activity className="w-4 h-4 text-emerald-600" />
          <span>Theo dõi tiến trình</span>
          {isRunning && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-semibold border border-emerald-200 animate-pulse ml-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Đang chạy...
            </span>
          )}
        </div>
        <span className="text-[11px] text-gray-400 font-mono">
          {logs.length} dòng nhật ký
        </span>
      </div>

      <div
        ref={terminalContainerRef}
        className="h-44 bg-gray-950 text-gray-200 font-mono text-[11px] rounded-xl p-4 overflow-y-auto border border-gray-800 space-y-1.5 select-text shadow-inner scroll-smooth"
      >
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500 italic">
            Chưa có tiến trình nào đang chạy. Nhấn &quot;Bắt đầu Seeding&quot; để khởi chạy tự động.
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 leading-relaxed">
              <span className="text-gray-500 shrink-0 select-none">[{log.time}]</span>
              {log.type === "success" && (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              {log.type === "warn" && (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              )}
              {log.type === "error" && (
                <span className="text-rose-400 font-bold shrink-0">[ERR]</span>
              )}
              <span
                className={
                  log.type === "success"
                    ? "text-emerald-300"
                    : log.type === "warn"
                    ? "text-amber-300"
                    : log.type === "error"
                    ? "text-rose-300 font-semibold"
                    : "text-gray-300"
                }
              >
                {log.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
