"use client";

import React, { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";

const two = (n) => String(n).padStart(2, "0");

/** Ngày địa phương dạng YYYY-MM-DD, lệch `offset` ngày so với hôm nay */
function localDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export const todayRange = () => ({ from: localDay(), to: localDay() });

/** 0h ngày địa phương (cộng thêm addDays) → ISO UTC */
function midnightIso(day, addDays = 0) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + addDays).toISOString();
}

/** Khoảng ngày → tham số API: [0h ngày đầu, 0h ngày sau ngày cuối) */
export function rangeToParams({ from, to }) {
  return {
    date_from: from ? midnightIso(from) : undefined,
    date_to: to ? midnightIso(to, 1) : undefined,
  };
}

const fmt = (day) => day.split("-").reverse().join("/");

export function formatRange({ from, to }) {
  if (from && to) return from === to ? fmt(from) : `${fmt(from)} - ${fmt(to)}`;
  if (from) return `Từ ${fmt(from)}`;
  if (to) return `Đến ${fmt(to)}`;
  return "Tất cả thời gian";
}

const PRESETS = [
  { label: "Hôm nay", get: todayRange },
  { label: "Hôm qua", get: () => ({ from: localDay(-1), to: localDay(-1) }) },
  { label: "7 ngày qua", get: () => ({ from: localDay(-6), to: localDay() }) },
  { label: "30 ngày qua", get: () => ({ from: localDay(-29), to: localDay() }) },
  { label: "Tất cả", get: () => ({ from: "", to: "" }) },
];

const same = (a, b) => a.from === b.from && a.to === b.to;

/** Lọc theo khoảng ngày (từ – đến) */
export default function DateRangeFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const invalid = Boolean(draft.from && draft.to && draft.from > draft.to);
  const apply = (next) => {
    setOpen(false);
    if (!same(next, value)) onChange(next);
  };
  const label = same(value, todayRange()) ? "Hôm nay" : formatRange(value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setDraft(value);
          setOpen((v) => !v);
        }}
        className={`flex h-[42px] min-w-[190px] items-center justify-between gap-3 rounded-xl border bg-[#F8FAFC] px-3.5 text-xs font-medium text-[#334155] transition-colors hover:border-slate-300 ${
          open ? "border-[#2563EB] ring-2 ring-[#2563EB]/10" : "border-[#E2E8F0]"
        }`}
      >
        <span className="whitespace-nowrap">{label}</span>
        <Calendar className="size-4 shrink-0 text-[#94A3B8]" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-[300px] max-w-[calc(100vw-32px)] rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-lg">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const r = p.get();
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => apply(r)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    same(r, value)
                      ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]"
                      : "border-[#E2E8F0] text-[#475569] hover:bg-[#F8FAFC]"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              ["from", "Từ ngày"],
              ["to", "Đến ngày"],
            ].map(([key, text]) => (
              <label key={key} className="text-[11px] font-medium text-[#64748B]">
                {text}
                <input
                  type="date"
                  value={draft[key]}
                  max={localDay()}
                  onChange={(e) => {
                    const day = e.target.value;
                    setDraft((d) => ({ ...d, [key]: day }));
                  }}
                  className="mt-1 h-9 w-full rounded-lg border border-[#E2E8F0] px-2 text-xs text-[#334155] outline-none focus:border-[#2563EB]"
                />
              </label>
            ))}
          </div>
          {invalid && <p className="mt-2 text-[11px] text-red-600">“Từ ngày” phải trước hoặc bằng “Đến ngày”.</p>}
          <button
            type="button"
            disabled={invalid}
            onClick={() => apply(draft)}
            className="mt-3 h-9 w-full rounded-lg bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            Áp dụng
          </button>
        </div>
      )}
    </div>
  );
}
