"use client";

import { Check, Copy } from "lucide-react";
import { IconProgress } from "../../components/icons";

export function logTone(tone) {
  if (tone === "success") return "text-emerald-400";
  if (tone === "warn") return "text-amber-400";
  if (tone === "error") return "text-rose-400";
  return "text-slate-300";
}

export default function LiveLogConsole({
  logs = [],
  isExecuting = false,
  runState,
  onCopyLogs,
  copiedLog,
  title = "Live Automation Log Console [Thread-01]",
}) {
  const currentStatus = isExecuting ? "RUNNING" : (runState || "IDLE").toUpperCase();

  return (
    <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {/* Header Theo dõi tiến trình chuẩn Figma giống scan-info */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#EFF6FF]">
            <IconProgress />
          </span>
          <h2 className="text-sm font-bold text-[#0F172A]">Theo dõi tiến trình</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-600">
          <span className={`size-1.5 rounded-full bg-emerald-500 ${isExecuting ? "animate-ping" : ""}`} />
          {currentStatus}
        </span>
      </div>

      {/* Khung Terminal tối màu */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#1e293b] shadow-inner">
        {/* Terminal Header */}
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

          {onCopyLogs && (
            <button
              type="button"
              onClick={onCopyLogs}
              className="text-slate-400 hover:text-white transition-colors"
              title="Sao chép toàn bộ logs"
            >
              {copiedLog ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
            </button>
          )}
        </div>

        {/* Terminal Logs Window */}
        <div className="max-h-52 space-y-1.5 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
          {logs.length === 0 ? (
            <p className="text-slate-400 italic">Chưa có nhật ký hoạt động nào.</p>
          ) : (
            logs.map((log, index) => {
              const text = log.message || log.text || "";
              const color = log.color || (log.tone ? logTone(log.tone) : "text-slate-300");
              const thread = log.thread || "Thread-01";
              return (
                <p key={`${log.time}-${index}`} className="flex flex-wrap items-start gap-2 text-slate-300">
                  <span className="shrink-0 text-slate-500">[{log.time}]</span>
                  <span className="shrink-0 text-teal-400">[{thread}]</span>
                  <span className={`break-all ${color}`}>{text}</span>
                </p>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
