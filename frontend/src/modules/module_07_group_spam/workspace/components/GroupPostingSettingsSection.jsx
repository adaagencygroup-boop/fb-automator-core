"use client";

import React from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import CustomSelect from "@/components/ui/custom-select";
import { SectionCard, CheckLabel } from "../../shared/components";

export default function GroupPostingSettingsSection({
  scheduleEnabled,
  setScheduleEnabled,
  delayMin,
  setDelayMin,
  delayMax,
  setDelayMax,
  delayUnit,
  setDelayUnit,
  scheduleDate,
  setScheduleDate,
  scheduleTime,
  setScheduleTime,
  isLocked = false,
  stepNumber = "7",
  contentType = "post",
}) {
  const minDelay = delayUnit === "minutes" ? 1 : 10;
  const maxDelay = 60;
  const limitDelay = (value, setter) => {
    if (value === "") return setter("");
    const parsed = Number(value);
    setter(Number.isFinite(parsed) ? String(Math.min(maxDelay, parsed)) : "");
  };
  const normalizeDelay = (value, setter) => {
    const parsed = Number(value);
    setter(Number.isFinite(parsed) ? String(Math.min(maxDelay, Math.max(minDelay, parsed))) : String(minDelay));
  };
  const changeDelayUnit = (nextUnit) => {
    if (nextUnit === delayUnit) return;
    setDelayMin(nextUnit === "minutes" ? "1" : "10");
    setDelayMax("60");
    setDelayUnit(nextUnit);
  };
  const actionLabel = contentType === "comment" ? "bình luận" : "đăng bài";
  return (
    <SectionCard
      number={stepNumber}
      title={`Cài đặt ${actionLabel}`}
      description="Thiết lập khoảng nghỉ và thời điểm bắt đầu chiến dịch."
      aside={(
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium uppercase ${scheduleEnabled
          ? "border-blue-200 bg-blue-50 text-primary"
          : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
        >
          {scheduleEnabled ? "Đã bật hẹn giờ" : "Chạy ngay"}
        </span>
      )}
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary">
                <Clock3 size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold text-slate-700">Khoảng nghỉ giữa các lượt {actionLabel}</p>
                <p className="text-xs text-slate-400">Thời gian chờ ngẫu nhiên trước lượt {actionLabel} tiếp theo</p>
              </div>
            </div>
            <div className="w-[100px] shrink-0">
              <CustomSelect
                value={delayUnit}
                onChange={changeDelayUnit}
                options={[
                  { value: "seconds", label: "Giây" },
                  { value: "minutes", label: "Phút" },
                ]}
                disabled={isLocked}
                size="sm"
                buttonClassName="h-8 border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-500">Từ</span>
              <Input
                type="number"
                min={minDelay}
                max={maxDelay}
                step={delayUnit === "minutes" ? "0.1" : "1"}
                value={delayMin}
                onChange={(event) => limitDelay(event.target.value, setDelayMin)}
                onBlur={() => normalizeDelay(delayMin, setDelayMin)}
                disabled={isLocked}
                className="h-9 bg-white text-center text-xs"
              />
            </label>
            <span className="pb-2 text-sm text-slate-400">–</span>
            <label className="space-y-1.5">
              <span className="block text-xs   font-medium text-slate-500">
                Đến ({delayUnit === "minutes" ? "phút" : "giây"})
              </span>
              <Input
                type="number"
                min={minDelay}
                max={maxDelay}
                step={delayUnit === "minutes" ? "0.1" : "1"}
                value={delayMax}
                onChange={(event) => limitDelay(event.target.value, setDelayMax)}
                onBlur={() => normalizeDelay(delayMax, setDelayMax)}
                disabled={isLocked}
                className="h-9 bg-white text-center text-xs"
              />
            </label>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-primary">
                <CalendarDays className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-base font-semibold text-slate-700">Thời điểm bắt đầu</p>
                <p className="text-xs text-slate-400">Để trống nếu muốn chạy ngay</p>
              </div>
            </div>
            <div className={isLocked ? "pointer-events-none opacity-60" : ""}>
              <CheckLabel checked={scheduleEnabled} onCheckedChange={setScheduleEnabled}>
                Hẹn giờ
              </CheckLabel>
            </div>
          </div>

          <div className={`grid grid-cols-2 gap-2 transition-opacity ${scheduleEnabled ? "opacity-100" : "pointer-events-none opacity-40"}`}>
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-500">Ngày bắt đầu</span>
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="date"
                  disabled={isLocked || !scheduleEnabled}
                  value={scheduleDate}
                  onChange={(event) => setScheduleDate(event.target.value)}
                  className="h-9 bg-white pl-9 text-xs"
                />
              </div>
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-500">Giờ bắt đầu</span>
              <div className="relative">
                <Clock3 className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  type="time"
                  disabled={isLocked || !scheduleEnabled}
                  value={scheduleTime}
                  onChange={(event) => setScheduleTime(event.target.value)}
                  className="h-9 bg-white pl-9 text-xs"
                />
              </div>
            </label>
          </div>
        </div>
      </div>

    </SectionCard>
  );
}
