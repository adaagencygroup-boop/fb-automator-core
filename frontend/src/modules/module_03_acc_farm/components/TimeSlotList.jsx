"use client";

import React, { useState } from "react";
import { Clock, Plus, X } from "lucide-react";
import { MAX_TIME_SLOTS, minutesUntil, normalizeHHmm, sortSlots } from "../composeText";

const MIN_LEAD_MINUTES = 5;

/** Khung giờ chưa hợp lệ để tạo/sửa chiến dịch (đã qua hoặc chưa đủ 5 phút). `keep` = giờ cũ được giữ khi sửa. */
export function slotProblems(slots, keep = []) {
  const keepSet = new Set(keep);
  return slots
    .filter((s) => !keepSet.has(s))
    .filter((s) => {
      const mins = minutesUntil(s);
      return mins === null || mins < MIN_LEAD_MINUTES;
    });
}

/**
 * Các khung giờ trong hôm nay (HH:mm, sau bây giờ ít nhất 5 phút, không trùng, tối đa 24).
 */
export function TimeSlotList({ slots, onChange, keep = [], disabled = false }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const problems = new Set(slotProblems(slots, keep));

  const add = () => {
    const value = normalizeHHmm(draft);
    if (!value) {
      setError("Nhập giờ dạng HH:mm, ví dụ 08:30.");
      return;
    }
    if (slots.includes(value)) {
      setError(`Khung ${value} đã có.`);
      return;
    }
    if (slots.length >= MAX_TIME_SLOTS) {
      setError(`Tối đa ${MAX_TIME_SLOTS} khung giờ.`);
      return;
    }
    const mins = minutesUntil(value);
    if (mins < MIN_LEAD_MINUTES) {
      setError(`Khung ${value} phải sau bây giờ ít nhất ${MIN_LEAD_MINUTES} phút (chỉ đặt giờ trong hôm nay).`);
      return;
    }
    setError("");
    setDraft("");
    onChange(sortSlots([...slots, value]));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {slots.map((s) => (
          <span
            key={s}
            title={problems.has(s) ? "Khung này đã qua hoặc còn chưa tới 5 phút" : undefined}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-xs font-semibold ${
              problems.has(s) ? "border-red-300 bg-red-50 text-red-700" : "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]"
            }`}
          >
            <Clock size={12} />
            {s}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(slots.filter((x) => x !== s))}
                className="rounded p-0.5 hover:bg-black/10"
                aria-label={`Bỏ khung ${s}`}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!disabled && slots.length < MAX_TIME_SLOTS && (
          <span className="inline-flex items-center gap-1">
            <input
              type="time"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              className="h-8 rounded-lg border border-[#E2E8F0] bg-white px-2 font-mono text-xs focus:border-[#2563EB] focus:outline-none"
              aria-label="Giờ đăng"
            />
            <button
              type="button"
              onClick={add}
              className="flex h-8 items-center gap-1 rounded-lg border border-[#2563EB] px-2.5 text-xs font-bold text-[#2563EB] hover:bg-blue-50"
            >
              <Plus size={13} />
              Thêm khung
            </button>
          </span>
        )}
      </div>
      {error && <p className="text-[11px] font-medium text-red-500">{error}</p>}
      {!error && slots.length === 0 && (
        <p className="text-[11px] text-slate-400">Chưa có khung giờ nào. Thêm ít nhất 1 khung để tạo chiến dịch.</p>
      )}
      {problems.size > 0 && (
        <p className="text-[11px] font-medium text-red-500">
          Khung {[...problems].join(", ")} đã qua hoặc còn chưa tới 5 phút, hãy bỏ hoặc đổi giờ.
        </p>
      )}
    </div>
  );
}
