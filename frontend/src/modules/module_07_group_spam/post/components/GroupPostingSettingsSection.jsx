"use client";

import React from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SectionCard, Field, CheckLabel } from "../../shared/components";

export default function GroupPostingSettingsSection({
  scheduleEnabled,
  setScheduleEnabled,
  avoidDuplicate,
  setAvoidDuplicate,
  shuffleContent,
  setShuffleContent,
  delayMin,
  setDelayMin,
  delayMax,
  setDelayMax,
  scheduleDate,
  setScheduleDate,
  scheduleTime,
  setScheduleTime,
  stepNumber = "7",
}) {
  return (
    <SectionCard number={stepNumber} title="Cài đặt đăng bài">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <CheckLabel checked={scheduleEnabled} onCheckedChange={setScheduleEnabled}>
          Bật hẹn giờ đăng bài
        </CheckLabel>
        <CheckLabel checked={avoidDuplicate} onCheckedChange={setAvoidDuplicate}>
          Không đăng trùng nội dung
        </CheckLabel>
        <CheckLabel checked={shuffleContent} onCheckedChange={setShuffleContent}>
          Đăng ngẫu nhiên nội dung (nếu có nhiều nội dung)
        </CheckLabel>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Thời gian nghỉ giữa các lần đăng (giây)">
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min="0"
              value={delayMin}
              onChange={(event) => setDelayMin(event.target.value)}
              className="text-center"
            />
            <span className="text-slate-400">–</span>
            <Input
              type="number"
              min="0"
              value={delayMax}
              onChange={(event) => setDelayMax(event.target.value)}
              className="text-center"
            />
            <span className="text-[10px] text-slate-400">giây</span>
          </div>
        </Field>

        <Field label="Thời gian bắt đầu (tùy chọn)">
          <div className={`grid grid-cols-2 gap-3 transition-opacity ${scheduleEnabled ? "opacity-100" : "pointer-events-none opacity-40"}`}>
            <div className="relative">
              <CalendarDays className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                type="date"
                disabled={!scheduleEnabled}
                value={scheduleDate}
                onChange={(event) => setScheduleDate(event.target.value)}
                className="pl-9"
              />
            </div>
            <div className="relative">
              <Clock3 className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                type="time"
                disabled={!scheduleEnabled}
                value={scheduleTime}
                onChange={(event) => setScheduleTime(event.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </Field>
      </div>
    </SectionCard>
  );
}
