"use client";

import { useEffect, useRef, useState } from "react";
import { INT_INPUT_PROPS, blockNonDigitKey, digitsOnly } from "../utils/intInput";

/**
 * Chuẩn hoá khoảng Delay: ép về [floor, ceil] và tự hoán đổi khi nhập ngược (Min > Max).
 * Trả về { min, max, swapped }.
 */
/** Delay tối thiểu giữa 2 lần quét (giây) — nhanh hơn dễ bị Facebook chặn / checkpoint. */
export const MIN_DELAY_SEC = 3;

export function normalizeDelayRange(min, max, { floor = MIN_DELAY_SEC, ceil = 3600 } = {}) {
  let raised = false;
  const clamp = (n, fallback) => {
    const v = Number.isFinite(Number(n)) && String(n).trim() !== "" ? Math.round(Number(n)) : fallback;
    if (v < floor) raised = true;
    return Math.min(ceil, Math.max(floor, v));
  };
  let lo = clamp(min, floor);
  let hi = clamp(max, lo);
  const swapped = lo > hi;
  if (swapped) [lo, hi] = [hi, lo];
  return { min: lo, max: hi, swapped, raised };
}

const stepBtn =
  "w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 font-medium";
const inputCls =
  "w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

/**
 * 2 ô Min – Max giây (có nút - / +). Đang gõ thì không ép giá trị; gõ xong (rời ô / Enter) hoặc bấm - / +
 * mới chuẩn hoá — Min > Max (gõ hoặc bấm + ở Min / - ở Max vượt qua nhau) thì tự đổi chỗ 2 giá trị,
 * ví dụ 13 - 13 bấm + ở Min → 13 - 14; gõ Min = 20 khi Max = 10 → 10 - 20.
 */
export default function DelayRangeInput({ min, max, onChange, floor = MIN_DELAY_SEC, ceil = 3600 }) {
  const [draftMin, setDraftMin] = useState(String(min));
  const [draftMax, setDraftMax] = useState(String(max));
  const [note, setNote] = useState("");
  const noteTimer = useRef(null);

  useEffect(() => setDraftMin(String(min)), [min]);
  useEffect(() => setDraftMax(String(max)), [max]);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  // Giá trị cũ (nháp / phiên trước) nhỏ hơn mức tối thiểu → nâng lên ngay khi mở trang.
  useEffect(() => {
    const r = normalizeDelayRange(min, max, { floor, ceil });
    if (r.min !== min || r.max !== max) onChange(r.min, r.max);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, floor, ceil]);

  const commit = (nextMin, nextMax) => {
    const r = normalizeDelayRange(nextMin, nextMax, { floor, ceil });
    setDraftMin(String(r.min));
    setDraftMax(String(r.max));
    if (r.min !== min || r.max !== max) onChange(r.min, r.max);
    const msg = [
      r.raised ? `Delay tối thiểu là ${floor} giây — đã tự nâng lên ${floor} giây.` : "",
      r.swapped ? `Min lớn hơn Max — đã tự đổi thành ${r.min} - ${r.max} giây.` : "",
    ].filter(Boolean).join(" ");
    if (msg) {
      setNote(msg);
      clearTimeout(noteTimer.current);
      noteTimer.current = setTimeout(() => setNote(""), 5000);
    }
  };

  const onKey = (event) => {
    blockNonDigitKey(event);
    if (event.key === "Enter") event.currentTarget.blur();
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
          <button type="button" aria-label="Giảm Min" onClick={() => commit(min - 1, max)} className={`${stepBtn} rounded-l-lg`}>
            -
          </button>
          <input
            {...INT_INPUT_PROPS}
            aria-label="Delay tối thiểu (giây)"
            value={draftMin}
            onChange={(e) => setDraftMin(digitsOnly(e.target.value))}
            onBlur={() => commit(draftMin, max)}
            onKeyDown={onKey}
            className={inputCls}
          />
          <button type="button" aria-label="Tăng Min" onClick={() => commit(min + 1, max)} className={`${stepBtn} rounded-r-lg`}>
            +
          </button>
        </div>

        <span className="text-xs text-[#94A3B8]">-</span>

        <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
          <button type="button" aria-label="Giảm Max" onClick={() => commit(min, max - 1)} className={`${stepBtn} rounded-l-lg`}>
            -
          </button>
          <input
            {...INT_INPUT_PROPS}
            aria-label="Delay tối đa (giây)"
            value={draftMax}
            onChange={(e) => setDraftMax(digitsOnly(e.target.value))}
            onBlur={() => commit(min, draftMax)}
            onKeyDown={onKey}
            className={inputCls}
          />
          <button type="button" aria-label="Tăng Max" onClick={() => commit(min, max + 1)} className={`${stepBtn} rounded-r-lg`}>
            +
          </button>
        </div>

        <span className="text-xs text-[#64748B]">giây</span>
        <span className="text-[11px] text-[#94A3B8]">(tối thiểu {floor} giây)</span>
      </div>
      {note && <p className="max-w-[360px] text-[11px] font-medium text-amber-600">{note}</p>}
    </div>
  );
}
