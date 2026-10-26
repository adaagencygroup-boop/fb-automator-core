"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { Terminal, Activity, CheckCircle2, XCircle, ExternalLink } from "lucide-react";

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
              className="inline-flex items-center gap-0.5 font-medium text-sky-600 hover:text-sky-800 underline underline-offset-2 break-all transition-colors mx-0.5"
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
  stepNumber = "9",
}) {
  const status = campaignProgress?.status || (runState === "starting" ? "STARTING" : runState === "running" ? "RUNNING" : "IDLE");
  const logs = campaignProgress?.logs || [];

  return (
    <Card className="min-h-72 border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5 text-sm font-bold text-slate-800">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-white shadow-xs">
            {stepNumber}
          </span>
          <span className="flex items-center gap-1.5">
            <Terminal className="size-4 text-primary" />
            Theo dõi tiến trình & Nhật ký hoạt động
          </span>
        </div>

        {/* Trạng thái tiến trình */}
        <div className="flex items-center gap-2">
          {logs.length > 0 && (
            <span className="text-xs text-slate-400">
              {logs.length} dòng nhật ký
            </span>
          )}
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

      {runState !== "idle" || campaignProgress ? (
        <div className="mt-4 min-h-64 max-h-[460px] space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
          {logs.length ? (
            logs.slice().reverse().map((log, index) => {
              const isError = log.level === "ERROR";
              const isSuccess = log.level === "SUCCESS";
              const isWarning = log.level === "WARNING";

              return (
                <div
                  key={`${log.time}-${index}`}
                  className="flex items-start gap-3 rounded-md border-b border-slate-100/80 px-3 py-2 text-xs sm:text-[13px] leading-relaxed transition-colors hover:bg-white last:border-b-0"
                >
                  <span className="shrink-0 font-mono text-[11px] sm:text-xs font-semibold text-slate-400 pt-0.5">
                    {log.time?.split("T")[1] || "--:--:--"}
                  </span>
                  <div className="flex-1">
                    {renderLogContent(
                      log.message,
                      isError
                        ? "font-semibold text-rose-600"
                        : isSuccess
                        ? "font-medium text-emerald-700"
                        : isWarning
                        ? "font-medium text-amber-700"
                        : "text-slate-700"
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex min-h-60 flex-col items-center justify-center gap-2 text-xs sm:text-sm text-slate-400">
              <Activity className="size-5 animate-spin text-primary" />
              <span>{runState === "starting" ? "Đang khởi tạo tác vụ và kết nối Chrome..." : "Chưa có nhật ký thực thi"}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-60 flex-col items-center justify-center gap-2 text-xs sm:text-sm text-slate-400">
          <Terminal className="size-6 text-slate-300" />
          <span>Tiến trình và nhật ký sẽ hiển thị tại đây sau khi bắt đầu chiến dịch.</span>
        </div>
      )}
    </Card>
  );
}
