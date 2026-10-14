"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { clearFarmLogs, useFarmLogs } from "../hooks/useFarmLogs";

const LEVEL_COLORS = {
  SUCCESS: "text-emerald-400",
  WARNING: "text-amber-300",
  ERROR: "text-rose-400",
  INFO: "text-slate-200",
};

export default function LogConsole({ running }) {
  const { logs, connected } = useFarmLogs();
  const [thread, setThread] = useState("");
  const boxRef = useRef(null);

  const threads = useMemo(
    () => [...new Set(logs.map((l) => l.thread).filter((t) => t != null))].sort((a, b) => a - b),
    [logs]
  );
  const shown = thread === "" ? logs : logs.filter((l) => String(l.thread) === thread);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown.length]);

  const copy = () => {
    const text = shown.map((l) => `[${l.time}] ${l.message}`).join("\n");
    navigator.clipboard?.writeText(text).then(() => toast.success(`Đã sao chép ${shown.length} dòng log`, "ĐÃ SAO CHÉP"));
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#1E293B] shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-500" />
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            <span className="h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold text-slate-200">Live Automation Log Console</span>
          <select
            value={thread}
            onChange={(e) => setThread(e.target.value)}
            className="h-7 rounded-md border border-slate-600 bg-slate-800 px-2 text-[11px] text-slate-200 focus:outline-none"
          >
            <option value="">Tất cả luồng</option>
            {threads.map((t) => (
              <option key={t} value={String(t)}>
                Thread-{String(t).padStart(2, "0")}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-bold">
          <span className={`flex items-center gap-1.5 ${connected ? "text-emerald-400" : "text-rose-400"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
            {connected ? (running ? "RUNNING" : "IDLE") : "MẤT KẾT NỐI ENGINE"}
          </span>
          <span className="text-slate-400">{shown.length} dòng</span>
          <button type="button" onClick={copy} className="text-slate-400 hover:text-white" title="Sao chép log">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" onClick={clearFarmLogs} className="text-slate-400 hover:text-white" title="Xóa log trên màn hình">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={boxRef} className="h-72 space-y-1.5 overflow-y-auto px-5 py-3 font-mono text-[12px] leading-relaxed">
        {shown.length ? (
          shown.map((log, idx) => (
            <div key={idx} className="flex gap-2">
              <span className="shrink-0 text-slate-500">[{log.time}]</span>
              <span className={LEVEL_COLORS[log.level] || LEVEL_COLORS.INFO}>{log.message}</span>
            </div>
          ))
        ) : (
          <div className="italic text-slate-500">Chưa có log. Log của phiên Tương tác sẽ hiện ở đây khi Kích hoạt.</div>
        )}
      </div>
    </section>
  );
}
