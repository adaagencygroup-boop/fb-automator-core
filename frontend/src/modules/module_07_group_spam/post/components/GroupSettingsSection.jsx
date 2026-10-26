"use client";

import React from "react";
import { Sparkles, Layers, Check, Edit3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard, Field } from "../../shared/components";
import SavedApiSelector from "../../shared/SavedApiSelector";

export default function GroupSettingsSection({
  apiSource,
  threads,
  setThreads,
  settingsLoading,
  settingsAction,
  settingsFeedback,
  onSaveSettings,
  isLocked,
  setIsLocked,
  stepNumber = "3",
}) {
  const busy = settingsLoading || Boolean(settingsAction);

  return (
    <SectionCard
      number={stepNumber}
      title="Cấu hình API & thông số chung"
      description="Chọn API đã cấu hình trong Hồ sơ cá nhân để tạo nội dung và số luồng xử lý song song."
      aside={
        isLocked ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
            <Check className="size-3 text-emerald-600" />
            Đã lưu cấu hình
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/60 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
            <Edit3 className="size-3 text-amber-600" />
            Đang chỉnh sửa
          </span>
        )
      }
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
            <SavedApiSelector source={apiSource} disabled={busy || isLocked} onChange={() => setIsLocked(false)} />
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
              <Field label="Số luồng (1 - 10)">
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={threads}
                  onChange={(event) => setThreads(event.target.value)}
                  disabled={busy || isLocked}
                  placeholder="1 - 10"
                  className="h-9 bg-white text-xs font-medium"
                />
              </Field>

              <div className="rounded-md border border-slate-100 bg-white p-2.5 text-[11px] text-slate-500">
                <p className="leading-relaxed">
                  <span className="font-semibold text-slate-700">💡 Gợi ý:</span> Nên chạy từ <strong>1 – 3 luồng</strong> để tiết kiệm CPU/RAM máy tính và giảm thiểu nguy cơ bị Facebook quét checkpoint.
                </p>
              </div>
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

      <div className="mt-4 flex items-center justify-end border-t border-slate-100 pt-3">
        {isLocked ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setIsLocked(false)}>
            <Edit3 className="mr-1.5 size-3.5" /> Chỉnh sửa
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={busy || apiSource.loading || !apiSource.selected}
            onClick={() => onSaveSettings()}
            className="bg-primary text-white hover:bg-primary/90"
          >
            {settingsAction === "saving" ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Đang lưu...
              </>
            ) : (
              <>
                <Check className="mr-1.5 size-3.5" /> Lưu cấu hình
              </>
            )}
          </Button>
        )}
      </div>
    </SectionCard>
  );
}
