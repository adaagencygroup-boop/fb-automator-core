"use client";

import React from "react";
import { Card } from "@/components/ui/card";

export default function GroupProgressSection({
  runState = "idle",
  campaignProgress = null,
  stepNumber = "9",
}) {
  return (
    <Card className="min-h-64 border-slate-200 p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
        <span className="flex size-5 items-center justify-center rounded bg-primary/10 font-bold text-[11px] text-primary">
          {stepNumber}
        </span>
        Theo dõi tiến trình
      </div>
      {runState !== "idle" || campaignProgress ? (
        <div className="mt-4 max-h-72 min-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2">
          {campaignProgress?.logs?.length ? (
            campaignProgress.logs.slice().reverse().map((log, index) => (
              <div key={`${log.time}-${index}`} className="flex gap-2 rounded px-2 py-1.5 text-[10px] hover:bg-white">
                <span className="shrink-0 text-slate-400">{log.time?.split("T")[1] || "--:--:--"}</span>
                <span
                  className={
                    log.level === "ERROR"
                      ? "text-rose-600"
                      : log.level === "SUCCESS"
                      ? "text-emerald-600"
                      : log.level === "WARNING"
                      ? "text-amber-600"
                      : "text-slate-600"
                  }
                >
                  {log.message}
                </span>
              </div>
            ))
          ) : (
            <div className="flex min-h-44 items-center justify-center text-[10px] text-slate-300">
              {runState === "starting" ? "Đang khởi tạo tác vụ..." : "Chưa có nhật ký thực thi"}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-48 items-center justify-center text-xs text-slate-300">
          Tiến trình sẽ hiển thị sau khi bắt đầu đăng bài.
        </div>
      )}
    </Card>
  );
}
