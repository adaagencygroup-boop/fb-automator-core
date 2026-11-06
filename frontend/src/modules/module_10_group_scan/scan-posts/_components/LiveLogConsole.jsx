"use client";

import { Check, Copy } from "lucide-react";

export default function LiveLogConsole({
  logs,
  isExecuting,
  onCopyLogs,
  copiedLog,
  title = "Live Automation Log Console [Thread-01]",
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-[#1e293b] shadow-inner">
      <div className="flex items-center justify-between border-b border-slate-800 bg-[#0f172a] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-rose-500" />
            <span className="size-2.5 rounded-full bg-amber-500" />
            <span className="size-2.5 rounded-full bg-emerald-500" />
          </div>
          <span className="font-mono text-xs font-semibold text-slate-300">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-400">
            <span className={`size-1.5 rounded-full ${isExecuting ? "bg-emerald-400 animate-ping" : "bg-emerald-400"}`} />
            {isExecuting ? "RUNNING" : "IDLE"}
          </span>

          <button
            type="button"
            onClick={onCopyLogs}
            className="text-slate-400 hover:text-white transition-colors"
            title="Sao chép toàn bộ logs"
          >
            {copiedLog ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      </div>

      <div className="max-h-52 space-y-1.5 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
        {logs.map((log, index) => (
          <p key={index} className="flex flex-wrap items-start gap-2 text-slate-300">
            <span className="shrink-0 text-slate-500">[{log.time}]</span>
            <span className="shrink-0 text-sky-400">[{log.thread}]</span>
            <span className={`break-all ${log.color}`}>{log.message}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

