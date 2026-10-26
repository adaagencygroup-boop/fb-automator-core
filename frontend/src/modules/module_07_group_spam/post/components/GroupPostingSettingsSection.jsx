"use client";

import React from "react";
import { CalendarDays, Check, Clock3, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  setIsLocked,
  onContinue,
  stepNumber = "7",
}) {
  const handleSave = () => {
    setIsLocked?.(true);
    onContinue?.();
  };

  const handleEdit = () => {
    setIsLocked?.(false);
  };

  return (
    <SectionCard
      number={stepNumber}
      title="Cài đặt đăng bài"
      description="Thiết lập khoảng nghỉ và thời điểm bắt đầu chiến dịch."
      aside={(
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
          scheduleEnabled
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
                <Clock3 className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-700">Khoảng nghỉ giữa các bài</p>
                <p className="text-[10px] text-slate-400">Thời gian chờ ngẫu nhiên trước lần đăng tiếp theo</p>
              </div>
            </div>
            <select
              value={delayUnit}
              onChange={(event) => setDelayUnit(event.target.value)}
              disabled={isLocked}
              aria-label="Đơn vị khoảng nghỉ"
              className="h-8 shrink-0 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-600 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="seconds">Giây</option>
              <option value="minutes">Phút</option>
            </select>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <label className="space-y-1.5">
              <span className="block text-[10px] font-medium text-slate-500">Từ</span>
              <Input
                type="number"
                min="0"
                step={delayUnit === "minutes" ? "0.1" : "1"}
                value={delayMin}
                onChange={(event) => setDelayMin(event.target.value)}
                disabled={isLocked}
                className="h-9 bg-white text-center text-xs"
              />
            </label>
            <span className="pb-2 text-xs text-slate-400">–</span>
            <label className="space-y-1.5">
              <span className="block text-[10px] font-medium text-slate-500">
                Đến ({delayUnit === "minutes" ? "phút" : "giây"})
              </span>
              <Input
                type="number"
                min="0"
                step={delayUnit === "minutes" ? "0.1" : "1"}
                value={delayMax}
                onChange={(event) => setDelayMax(event.target.value)}
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
                <p className="text-xs font-semibold text-slate-700">Thời điểm bắt đầu</p>
                <p className="text-[10px] text-slate-400">Để trống nếu muốn chạy ngay</p>
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
              <span className="block text-[10px] font-medium text-slate-500">Ngày bắt đầu</span>
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
              <span className="block text-[10px] font-medium text-slate-500">Giờ bắt đầu</span>
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

      <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
        {isLocked ? (
          <Button type="button" variant="outline" size="sm" onClick={handleEdit}>
            <Edit3 className="mr-1.5 size-3.5" />
            Chỉnh sửa
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={handleSave}>
            <Check className="mr-1.5 size-3.5" />
            Lưu cấu hình
          </Button>
        )}
      </div>
    </SectionCard>
  );
}
