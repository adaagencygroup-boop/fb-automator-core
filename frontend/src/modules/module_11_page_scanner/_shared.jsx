"use client";

import React from "react";
import { Card } from "@/components/ui/card";

export function SectionCard({ number, title, description, aside, children }) {
  return (
    <Card className="overflow-hidden border-slate-200 shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="flex min-w-0 items-start gap-3">
          {number && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {number}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-heading text-sm font-bold leading-5 text-slate-800">{title}</h3>
            {description && <p className="mt-0.5 text-[11px] leading-4 text-slate-400">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="px-6 py-5">{children}</div>
    </Card>
  );
}

export function LiveLogConsole({ title, logs, phase }) {
  const label = phase === "paused" ? "PAUSED" : phase === "running" ? "RUNNING" : phase === "done" ? "DONE" : "IDLE";
  const color =
    phase === "paused"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-400"
      : phase === "running"
        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
        : "border-slate-500/20 bg-slate-500/10 text-slate-400";
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#1e293b] shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800 bg-[#0f172a] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-rose-500" />
            <span className="size-2.5 rounded-full bg-amber-500" />
            <span className="size-2.5 rounded-full bg-emerald-500" />
          </div>
          <span className="font-mono text-xs font-semibold text-slate-300">{title}</span>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded px-2.5 py-0.5 font-mono text-[10px] font-semibold ${color}`}>
          <span className={`size-1.5 rounded-full ${phase === "running" ? "bg-emerald-400 animate-pulse" : "bg-slate-400"}`} />
          {label}
        </span>
      </div>
      <div className="max-h-56 space-y-1.5 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 ? (
          <p className="text-slate-500">Chờ log phiên…</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 text-slate-300">
              <span className="shrink-0 text-slate-500">[{log.timestamp}]</span>
              <span
                className={
                  log.type === "success"
                    ? "text-emerald-400"
                    : log.type === "warn"
                      ? "text-amber-400"
                      : log.type === "error"
                        ? "text-rose-400"
                        : "text-slate-200"
                }
              >
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function nowStamp() {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

export const LIVE_STATUSES = new Set(["LIVE", "live", "Live"]);
