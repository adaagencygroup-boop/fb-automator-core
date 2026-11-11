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
    <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className={`size-2.5 rounded-full ${status === "RUNNING" || runState === "running" ? "animate-pulse bg-emerald-500" : "bg-slate-300"}`} />
          <h2 className="text-base font-bold text-slate-800 uppercase">Nhật ký hoạt động</h2>
          {logs.length > 0 && <span className="text-xs text-slate-400">{logs.length} dòng</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClearLogs}
            disabled={!logs.length}
            className="rounded-lg px-2.5 py-1 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-200/50 hover:text-slate-800 disabled:opacity-40"
          >
            Xóa logs
          </button>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            title={expanded ? "Thu nhỏ nhật ký" : "Mở rộng nhật ký"}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-200/50 hover:text-slate-800"
          >
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
        </div>
      </div>

      <div
        ref={logContainerRef}
        className={`space-y-2 overflow-y-auto bg-slate-900 p-4 font-mono text-xs text-slate-300 select-text transition-[height] duration-200 ${expanded ? "min-h-[320px] max-h-[460px]" : "min-h-[160px] max-h-[240px]"
          }`}
      >
        {logs.length ? (
          logs.map((log, index) => {
            const isError = log.level === "ERROR";
            const isSuccess = log.level === "SUCCESS";
            const isWarning = log.level === "WARNING";
            return (
              <div key={`${log.time}-${index}`} className="flex items-start gap-2.5 leading-relaxed">
                <span className="mt-0.5 shrink-0 select-none">
                  {isSuccess ? (
                    <span className="font-bold text-emerald-400">✓</span>
                  ) : isError ? (
                    <span className="font-bold text-rose-500">×</span>
                  ) : (
                    <span className="my-1 inline-block size-1.5 rounded-full bg-blue-400" />
                  )}
                </span>
                <time className="shrink-0 select-none text-[11px] tabular-nums text-slate-400">
                  [{log.time?.split("T")[1] || log.time || "--:--:--"}]
                </time>
                <div
                  className={`min-w-0 flex-1 break-words ${isError
                    ? "font-semibold text-rose-500"
                    : isSuccess
                      ? "font-medium text-emerald-400"
                      : isWarning
                        ? "font-medium text-amber-300"
                        : "text-slate-300"
                    }`}
                >
                  {renderLogContent(log.message, "")}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex items-center gap-2 py-2 italic text-slate-400">
            <span className="inline-block size-1.5 rounded-full bg-blue-400" />
            <span>{runState === "idle" ? "Đang chờ sự kiện hoạt động từ hệ thống..." : "Chưa có nhật ký thực thi"}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-5 py-2.5">
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
