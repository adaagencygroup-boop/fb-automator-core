"use client";

import { useRef, useEffect } from "react";

export default function ConsoleTerminal({ logs, engineOnline }) {
  const terminalRef = useRef(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="h-40 bg-black border-t border-slate-800 flex flex-col shrink-0 font-mono">
      <div className="h-7 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between text-[11px] font-bold text-cyan-400">
        <span>💻 NHẬT KÝ HỆ THỐNG REALTIME (WEBSOCKET PORT 28129)</span>
        <span className="flex items-center gap-3 text-[10px]">
          <span className={`flex items-center gap-1.5 ${engineOnline ? "text-emerald-400" : "text-red-400"}`}>
            <span
              className={`w-1.5 h-1.5 rounded-full ${engineOnline ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`}
            />
            {engineOnline ? "Engine Online" : "Engine Offline"}
          </span>
          <span className="text-slate-500">{logs.length} sự kiện</span>
        </span>
      </div>

      <div ref={terminalRef} className="flex-1 p-3 overflow-y-auto text-[11px] space-y-1 text-slate-300">
        {logs.length > 0 ? (
          logs.map((log, idx) => {
            let color = "text-sky-400";
            if (log.level === "SUCCESS") color = "text-emerald-400";
            if (log.level === "WARNING") color = "text-amber-400";
            if (log.level === "ERROR") color = "text-red-400";

            return (
              <div key={idx} className="leading-tight">
                <span className="text-slate-600">[{log.time}]</span>{" "}
                <span className={`font-bold ${color}`}>[{log.level}]</span>{" "}
                <span className="text-purple-400">[{log.module}]</span>{" "}
                <span>{log.message}</span>
              </div>
            );
          })
        ) : (
          <div className="text-slate-600 italic">Đang chờ tín hiệu từ Local Engine...</div>
        )}
      </div>
    </div>
  );
}
