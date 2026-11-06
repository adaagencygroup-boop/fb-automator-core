"use client";

import React from "react";
import { Sparkles, Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SectionCard, Field } from "../../shared/components";
import SavedApiSelector from "../../shared/SavedApiSelector";

export default function GroupSettingsSection({
  apiSource,
  threads,
  setThreads,
  selectedAccountCount = 0,
  settingsLoading,
  settingsFeedback,
  stepNumber = "3",
}) {
  const busy = settingsLoading;
  const maxThreads = Math.max(1, selectedAccountCount);

  return (
    <SectionCard
      number={stepNumber}
      title="Cấu hình API & thông số chung"
      description="Chọn API đã cấu hình trong Hồ sơ cá nhân để tạo nội dung và số luồng xử lý song song."
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Cột 1: Cấu hình Mô hình & API AI */}
        <div className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700">Mô hình & API AI</p>
                <p className="text-[10px] text-slate-400">Chọn API để tự động sinh nội dung bài viết và bình luận</p>
              </div>
            </div>
            <SavedApiSelector source={apiSource} disabled={busy} showActions={false} />
          </div>
        </div>

        {/* Cột 2: Luồng chạy song song */}
        <div className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary">
                <Layers className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700">Luồng chạy song song</p>
                <p className="text-[10px] text-slate-400">Số tài khoản Chrome vận hành đồng thời</p>
              </div>
            </div>

            <div className="space-y-3">
              <Field label={`Số luồng (1 - ${maxThreads})`}>
                <Input
                  type="number"
                  min="1"
                  max={maxThreads}
                  value={threads}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    if (nextValue === "") {
                      setThreads("");
                      return;
                    }
                    const nextThreads = Number(nextValue);
                    setThreads(String(Math.min(Math.max(1, nextThreads), maxThreads)));
                  }}
                  disabled={busy}
                  placeholder={`1 - ${maxThreads}`}
                  className="h-9 bg-white text-xs font-medium"
                />
              </Field>

            </div>
          </div>
        </div>
      </div>

      {settingsFeedback && (
        <p
          role={settingsFeedback.type === "error" ? "alert" : "status"}
          className={`mt-3 text-xs ${settingsFeedback.type === "error" ? "text-red-600" : "text-emerald-600"}`}
        >
          {settingsFeedback.message}
        </p>
      )}

    </SectionCard>
  );
}
