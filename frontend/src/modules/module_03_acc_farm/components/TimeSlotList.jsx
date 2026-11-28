"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Clock, Plus, Trash2, X } from "lucide-react";
import { MAX_TIME_SLOTS, minutesUntil, sortSlots } from "../composeText";

const MIN_LEAD_MINUTES = 5;
const LAST_MINUTE = 23 * 60 + 59;

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

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || "")
    .split(":")
    .map(Number);
  return h * 60 + m;
};
const fromMinutes = (total) =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Phút sớm nhất đặt được hôm nay (sau bây giờ ≥ 5 phút). null nếu đã hết ngày. */
function earliestMinute(now) {
  const t = Math.ceil(
    now.getHours() * 60 +
      now.getMinutes() +
      now.getSeconds() / 60 +
      MIN_LEAD_MINUTES,
  );
  return t <= LAST_MINUTE ? t : null;
}

function relativeLabel(hhmm, now) {
  const mins = Math.round(
    toMinutes(hhmm) -
      (now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60),
  );
  if (mins <= 0) return "đã qua";
  if (mins < 60) return `còn ${mins} phút`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `còn ${h} giờ${m ? ` ${m} phút` : ""}`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0"),
);

/** 1 cột trong bảng chọn (Giờ / Phút); mục đã qua bị mờ, mục đang chọn tô xanh và cuộn tới giữa. */
function PickColumn({ title, items, selected, isOff, onPick }) {
  const listRef = useRef(null);
  // Cuộn riêng danh sách tới mục đang chọn (không dùng scrollIntoView: nó cuộn cả trang → giao diện bị nhảy)
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector("[data-selected='true']");
    if (list && item) list.scrollTop = item.offsetTop - list.clientHeight / 2 + item.offsetHeight / 2;
  }, [selected]);
  return (
    <div className="flex-1">
      <div className="border-b border-slate-100 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </div>
      <div
        ref={listRef}
        className="relative max-h-44 space-y-px overflow-y-auto p-1 [scrollbar-width:thin] [scrollbar-color:#E2E8F0_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-track]:bg-transparent"
      >
        {items.map((it) => {
          const active = it === selected;
          const off = isOff(it);
          return (
            <button
              key={it}
              type="button"
              tabIndex={-1}
              disabled={off}
              data-selected={active}
              onClick={() => onPick(it)}
              className={`block h-7 w-full rounded-md text-xs tabular-nums transition-colors ${
                active
                  ? "bg-[#EFF6FF] font-bold text-[#2563EB]"
                  : off
                    ? "cursor-not-allowed text-slate-300"
                    : "font-medium text-slate-600 hover:bg-slate-50 hover:text-[#2563EB]"
              }`}
            >
              {it}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Ô nhập giờ 24h: bấm vào để mở bảng chọn Giờ / Phút; hoặc gõ số (giờ đủ 2 số tự sang phút), ↑/↓ đổi giờ (ô giờ) hoặc 5 phút (ô phút),
 * ←/→ chuyển ô, Enter để thêm. Không bao giờ cho về trước `min` (phút trong ngày).
 */
function TimeField({ value, onChange, min, onEnter, invalid }) {
  const rootRef = useRef(null);
  const hourRef = useRef(null);
  const minuteRef = useRef(null);
  const [open, setOpen] = useState(false);

  // Bấm ra ngoài thì đóng bảng chọn
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const [h, m] = value.split(":");
  const [hText, setHText] = useState(h);
  const [mText, setMText] = useState(m);

  useEffect(() => {
    setHText(h);
    setMText(m);
  }, [h, m]);

  /** Ghép giờ + phút, kéo về `min` nếu đã qua; trả về giá trị cuối. */
  const commit = (hh = hText, mm = mText) => {
    const hours = clamp(parseInt(hh, 10) || 0, 0, 23);
    const minutes = clamp(parseInt(mm, 10) || 0, 0, 59);
    const next = fromMinutes(clamp(hours * 60 + minutes, min, LAST_MINUTE));
    setHText(next.slice(0, 2));
    setMText(next.slice(3));
    if (next !== value) onChange(next);
    return next;
  };

  const step = (delta, unit) => {
    const cur = toMinutes(commit());
    let next = cur + delta;
    if (unit === "minute")
      next =
        delta > 0 ? Math.floor(cur / 5) * 5 + 5 : Math.ceil(cur / 5) * 5 - 5;
    const v = fromMinutes(clamp(next, min, LAST_MINUTE));
    onChange(v);
    return v;
  };

  const handleKey = (e, unit) => {
    if (e.key === "Enter") {
      e.preventDefault();
      setOpen(false);
      onEnter(commit());
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? 1 : -1;
      step(unit === "hour" ? dir * 60 : dir * 5, unit);
    } else if (unit === "hour" && (e.key === "ArrowRight" || e.key === ":")) {
      e.preventDefault();
      minuteRef.current?.focus();
    } else if (
      unit === "minute" &&
      (e.key === "ArrowLeft" || (e.key === "Backspace" && !mText))
    ) {
      e.preventDefault();
      hourRef.current?.focus();
    }
  };

  const segmentCls =
    "w-7 rounded bg-transparent py-0.5 text-center text-sm font-semibold tabular-nums text-[#0F172A] caret-transparent outline-none selection:bg-transparent focus:bg-[#EFF6FF] focus:text-[#2563EB]";

  const minuteItems = MINUTE_STEPS.includes(m)
    ? MINUTE_STEPS
    : [...MINUTE_STEPS, m].sort();

  return (
    <div ref={rootRef} className="relative">
      <div
        onClick={() => setOpen(true)}
        className={`inline-flex h-9 cursor-pointer items-center gap-1 rounded-lg border bg-white pl-2.5 pr-1 shadow-2xs transition-colors focus-within:ring-2 ${
          invalid
            ? "border-red-300 focus-within:border-red-400 focus-within:ring-red-100"
            : "border-[#E2E8F0] focus-within:border-[#2563EB] focus-within:ring-blue-100"
        }`}
      >
        <Clock size={14} className="text-slate-400" />
        <input
          ref={hourRef}
          type="text"
          inputMode="numeric"
          aria-label="Giờ"
          value={hText}
          onFocus={(e) => {
            e.target.select();
            setOpen(true);
          }}
          onClick={(e) => e.target.select()}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(-2);
            setHText(digits);
            // Đủ 2 số, hoặc số đầu > 2 (không thể là giờ 2 chữ số) → sang ô phút
            if (digits.length === 2 || Number(digits) > 2) {
              commit(digits, mText);
              minuteRef.current?.focus();
            }
          }}
          onBlur={() => commit()}
          onKeyDown={(e) => handleKey(e, "hour")}
          className={segmentCls}
        />
        <span className="font-bold text-slate-400">:</span>
        <input
          ref={minuteRef}
          type="text"
          inputMode="numeric"
          aria-label="Phút"
          value={mText}
          onFocus={(e) => {
            e.target.select();
            setOpen(true);
          }}
          onClick={(e) => e.target.select()}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(-2);
            setMText(digits);
            if (digits.length === 2 || Number(digits) > 5)
              commit(hText, digits);
          }}
          onBlur={() => commit()}
          onKeyDown={(e) => handleKey(e, "minute")}
          className={segmentCls}
        />
        <span className="ml-0.5 flex flex-col">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Thêm 5 phút"
            onClick={() => step(5, "minute")}
            className="rounded px-0.5 text-slate-400 hover:bg-slate-100 hover:text-[#2563EB]"
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Bớt 5 phút"
            onClick={() => step(-5, "minute")}
            className="rounded px-0.5 text-slate-400 hover:bg-slate-100 hover:text-[#2563EB]"
          >
            <ChevronDown size={12} />
          </button>
        </span>
      </div>
      {open && (
        <div
          // Giữ focus trong ô nhập khi bấm vào bảng (không kích hoạt blur)
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 top-full z-30 mt-1 flex w-[120px] overflow-hidden rounded-lg border border-[#E2E8F0] bg-white shadow-md animate-in fade-in zoom-in-95 duration-100"
        >
          <PickColumn
            title="Giờ"
            items={HOURS}
            selected={h}
            isOff={(hh) => Number(hh) * 60 + 59 < min}
            onPick={(hh) => {
              commit(hh, m);
              minuteRef.current?.focus();
            }}
          />
          <div className="w-px bg-slate-100" />
          <PickColumn
            title="Phút"
            items={minuteItems}
            selected={m}
            isOff={(mm) => Number(h) * 60 + Number(mm) < min}
            onPick={(mm) => {
              commit(h, mm);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Các khung giờ trong hôm nay (HH:mm, sau bây giờ ít nhất 5 phút, không trùng, tối đa 24). */
export function TimeSlotList({ slots, onChange, keep = [], disabled = false }) {
  const [now, setNow] = useState(() => new Date());
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  // Cập nhật "bây giờ" mỗi 30s để giờ đã qua tự báo đỏ và ô nhập không lùi về quá khứ
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const earliest = earliestMinute(now);
  const keepSet = useMemo(() => new Set(keep), [keep]);
  const problems = new Set(slotProblems(slots, keep));
  const full = slots.length >= MAX_TIME_SLOTS;

  // Gợi ý mặc định: giờ sớm nhất làm tròn lên bội 5; thời gian trôi qua thì đẩy theo
  useEffect(() => {
    if (earliest === null) return;
    if (!draft || toMinutes(draft) < earliest)
      setDraft(fromMinutes(Math.min(Math.ceil(earliest / 5) * 5, LAST_MINUTE)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earliest]);

  const add = (value = draft) => {
    if (full) {
      setError(`Tối đa ${MAX_TIME_SLOTS} khung giờ.`);
      return;
    }
    if (slots.includes(value)) {
      setError(`Khung ${value} đã có.`);
      return;
    }
    if (
      !keepSet.has(value) &&
      (earliest === null || toMinutes(value) < earliest)
    ) {
      setError(
        `Khung ${value} phải sau bây giờ ít nhất ${MIN_LEAD_MINUTES} phút (chỉ đặt giờ trong hôm nay).`,
      );
      return;
    }
    setError("");
    onChange(sortSlots([...slots, value]));
    // Gợi ý luôn khung tiếp theo (+1 giờ) để thêm liên tục bằng Enter
    const next = toMinutes(value) + 60;
    if (next <= LAST_MINUTE) setDraft(fromMinutes(next));
  };

  const draftTaken = slots.includes(draft);

  return (
    <div className="space-y-2">
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          {earliest === null ? (
            <p className="text-[11px] font-medium text-amber-600">
              Đã quá 23:54, không còn giờ nào để đặt trong hôm nay.
            </p>
          ) : (
            <>
              <TimeField
                value={draft || fromMinutes(earliest)}
                onChange={(v) => {
                  setDraft(v);
                  setError("");
                }}
                min={earliest}
                onEnter={add}
                invalid={draftTaken}
              />
              <button
                type="button"
                disabled={full || draftTaken}
                onClick={() => add()}
                className="flex h-9 items-center gap-1 rounded-lg bg-[#2563EB] px-3 text-xs font-bold text-white shadow-2xs hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={14} />
                Thêm
              </button>
              <span className="text-[11px] text-slate-400">
                {draftTaken ? (
                  <span className="font-medium text-red-500">
                    Khung {draft} đã có
                  </span>
                ) : (
                  <>
                    {draft && (
                      <span className="font-medium text-slate-500">
                        {relativeLabel(draft, now)}
                      </span>
                    )}
                    <span className="hidden sm:inline">
                      {" "}
                      · Gõ giờ, ↑↓ để chỉnh, Enter để thêm
                    </span>
                  </>
                )}
              </span>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {slots.length === 0 && (
          <span className="text-[11px] text-slate-400">
            Chưa có khung giờ nào.
          </span>
        )}
        {slots.map((s) => {
          const bad = problems.has(s);
          return (
            <span
              key={s}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border pl-2.5 pr-1 text-xs ${
                bad
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]"
              }`}
            >
              <span className="font-mono font-bold">{s}</span>
              <span
                className={`text-[10px] ${bad ? "text-red-500" : "text-[#60A5FA]"}`}
              >
                {bad ? "đã qua" : relativeLabel(s, now)}
              </span>
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
          );
        })}
        {!disabled && slots.length > 1 && (
          <button
            type="button"
            onClick={() => {
              onChange([]);
              setError("");
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-red-600 hover:bg-red-50"
          >
            <Trash2 size={12} />
            Xoá hết
          </button>
        )}
      </div>

      {error && <p className="text-[11px] font-medium text-red-500">{error}</p>}
      {problems.size > 0 && (
        <p className="text-[11px] font-medium text-red-500">
          Khung {[...problems].join(", ")} đã qua hoặc còn chưa tới 5 phút, hãy
          bỏ hoặc đổi giờ.
        </p>
      )}
    </div>
  );
}
