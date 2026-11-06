"use client";

import { IconProgress } from "../../components/icons";

export function logTone(tone) {
  if (tone === "success") return "text-emerald-400";
  if (tone === "warn") return "text-amber-400";
  if (tone === "error") return "text-rose-400";
  return "text-slate-300";
}

export default function LiveLogConsole({
  runState = "idle",
  logs = [],
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#EFF6FF]">
            <IconProgress />
          </span>
          <h2 className="text-sm font-bold text-[#0F172A]">Theo dõi tiến trình</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-600">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {runState === "idle" ? "IDLE" : runState.toUpperCase()}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#1e293b] shadow-inner">
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#0f172a] px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-rose-500" />
              <span className="size-2.5 rounded-full bg-amber-500" />
              <span className="size-2.5 rounded-full bg-emerald-500" />
            </div>
            <span className="font-mono text-xs font-semibold text-slate-300">
              Live Automation Log Console [Thread-01]
            </span>
          </div>
        </div>
        <div className="max-h-52 space-y-1.5 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed">
          {logs.map((line, index) => (
            <p key={`${line.time}-${index}`} className="flex flex-wrap items-start gap-2 text-slate-300">
              <span className="shrink-0 text-slate-500">[{line.time}]</span>
              <span className="shrink-0 text-teal-400">[{line.thread}]</span>
              <span className={`break-all ${logTone(line.tone)}`}>{line.text}</span>
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

