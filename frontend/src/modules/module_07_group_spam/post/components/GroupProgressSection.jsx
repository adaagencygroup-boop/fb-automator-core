"use client";

import React, { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { CheckCircle2, XCircle, ExternalLink, Maximize2, Minimize2 } from "lucide-react";

function renderLogContent(message, colorClass) {
  if (!message) return null;
  const urlRegex = /(https?:\/\/[^\s\)\],]+)/g;
  const parts = message.split(urlRegex);

  if (parts.length === 1) {
    return <span className={colorClass}>{message}</span>;
  }

  return (
    <span className={colorClass}>
      {parts.map((part, i) => {
        if (/^https?:\/\//i.test(part)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-sky-300 hover:text-sky-100 underline underline-offset-2 break-all transition-colors mx-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <span>{part}</span>
              <ExternalLink className="size-3 inline shrink-0" />
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

export default function GroupProgressSection({
  runState = "idle",
  campaignProgress = null,
  onClearLogs,
}) {
  const status = campaignProgress?.status || (runState === "starting" ? "STARTING" : runState === "running" ? "RUNNING" : "IDLE");
  const logs = campaignProgress?.logs || [];
  const logContainerRef = useRef(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!logs.length || !logContainerRef.current) return;
    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [logs]);

  return (
    <Card className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white p-0 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] bg-[#F8FAFC]/70 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className={`size-2.5 rounded-full ${status === "RUNNING" || runState === "running" ? "animate-pulse bg-[#10B981]" : "bg-slate-300"}`} />
          <h2 className="text-sm font-bold text-[#1E293B]">Nhật ký hoạt động (Live Logs)</h2>
          <span className="rounded bg-[#F1F5F9] px-2 py-0.5 font-mono text-xs font-medium text-[#94A3B8]">
            session#{String(campaignProgress?.session_id || String(logs.length).padStart(4, "0")).replace(/^session#/, "")}
          </span>
          {logs.length > 0 && <span className="text-xs text-slate-400">{logs.length} dòng</span>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClearLogs} disabled={!logs.length} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-[#64748B] transition-colors hover:bg-slate-200/50 hover:text-[#1E293B] disabled:opacity-40">
            Xóa logs
          </button>
          <button type="button" onClick={() => setExpanded((value) => !value)} title={expanded ? "Thu nhỏ nhật ký" : "Mở rộng nhật ký"} className="rounded-lg p-1 text-[#94A3B8] transition-colors hover:bg-slate-200/50 hover:text-[#1E293B]">
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
        </div>
      </div>

      <div ref={logContainerRef} className={`space-y-2 overflow-y-auto bg-[#0F172A] p-4 font-mono text-xs text-[#CBD5E1] select-text transition-[height] duration-200 ${expanded ? "min-h-[320px] max-h-[460px]" : "min-h-[160px] max-h-[240px]"}`}>
        {logs.length ? (
          logs.map((log, index) => {
            const isError = log.level === "ERROR";
            const isSuccess = log.level === "SUCCESS";
            const isWarning = log.level === "WARNING";
            return (
              <div key={`${log.time}-${index}`} className="flex items-start gap-2.5 leading-relaxed">
                <span className="mt-0.5 shrink-0 select-none">
                  {isSuccess ? <span className="font-bold text-[#34D399]">✓</span> : isError ? <span className="font-bold text-[#F43F5E]">×</span> : <span className="my-1 inline-block size-1.5 rounded-full bg-[#60A5FA]" />}
                </span>
                <time className="shrink-0 select-none text-[11px] tabular-nums text-[#94A3B8]">[{log.time?.split("T")[1] || log.time || "--:--:--"}]</time>
                <div className={`min-w-0 flex-1 break-words ${isError ? "font-semibold text-[#F43F5E]" : isSuccess ? "font-medium text-[#34D399]" : isWarning ? "font-medium text-amber-300" : "text-[#CBD5E1]"}`}>
                  {renderLogContent(log.message, "")}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex items-center gap-2 py-2 italic text-[#94A3B8]">
            <span className="inline-block size-1.5 rounded-full bg-[#60A5FA]" />
            <span>{runState === "idle" ? "Đang chờ sự kiện hoạt động từ hệ thống..." : "Chưa có nhật ký thực thi"}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[#E2E8F0] px-5 py-2.5">
        <div className="flex items-center gap-2">
          {status === "RUNNING" || runState === "running" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-primary">
              <span className="size-2 rounded-full bg-primary animate-pulse" />
              Đang thực thi
            </span>
          ) : status === "STARTING" || runState === "starting" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              <span className="size-2 rounded-full bg-amber-500 animate-ping" />
              Đang khởi tạo
            </span>
          ) : status === "COMPLETED" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="size-3.5 text-emerald-600" />
              Hoàn tất
            </span>
          ) : status === "STOPPED" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              Đã dừng
            </span>
          ) : status === "FAILED" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
              <XCircle className="size-3.5 text-rose-600" />
              Thất bại
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
