"use client";

import DelayRangeInput from "../../components/DelayRangeInput";
import { INT_INPUT_PROPS, blockNonDigitKey, digitsOnly } from "../../utils/intInput";

export default function AdvancedScanFilterCard({
  minDelay,
  setMinDelay,
  maxDelay,
  setMaxDelay,
  membersLimit,
  setMembersLimit,
  skipAdmin,
  setSkipAdmin,
  autoDedupe,
  setAutoDedupe,
  newMembersOnly,
  setNewMembersOnly,
}) {
  return (
    <section className="flex flex-col h-full rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2.5 pb-3 border-b border-[#F1F5F9]">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-xs font-bold text-white shrink-0">
          2
        </span>
        <h2 className="font-heading text-base font-semibold text-[#0F172A]">
          Cấu hình quét nâng cao & Bộ lọc
        </h2>
      </div>

      {/* Stepper Delay */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-[#334155]">
            Khoảng cách giữa các lần quét:
          </span>
          <DelayRangeInput
            min={Number(minDelay) || 1}
            max={Number(maxDelay) || 1}
            onChange={(lo, hi) => {
              setMinDelay(lo);
              setMaxDelay(hi);
            }}
          />
        </div>
      </div>

      {/* Stepper 2: Members Limit per Group */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-[#334155]">
          Mỗi nhóm quét tối đa:
        </span>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
            <button
              type="button"
              onClick={() => setMembersLimit((v) => Math.max(5, v - 10))}
              className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
            >
              -
            </button>
            <input
              {...INT_INPUT_PROPS}
              value={membersLimit}
              onKeyDown={blockNonDigitKey}
              onChange={(e) => setMembersLimit(Math.min(1000, Math.max(1, Number(digitsOnly(e.target.value)) || 10)))}
              className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              type="button"
              onClick={() => setMembersLimit((v) => Math.min(1000, v + 10))}
              className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
            >
              +
            </button>
          </div>
          <span className="text-xs text-[#64748B]">thành viên / nhóm</span>
        </div>
      </div>

      {/* Checkbox Filters */}
      <div className="space-y-2 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC]/80 p-3">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={skipAdmin}
            onChange={(e) => setSkipAdmin(e.target.checked)}
            className="size-4 text-[#2563EB] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
          />
          <span className="text-xs font-medium text-[#334155]">
            Không quét ban quản trị (Admin / Kiểm duyệt viên)
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoDedupe}
            onChange={(e) => setAutoDedupe(e.target.checked)}
            className="size-4 text-[#2563EB] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
          />
          <span className="text-xs font-medium text-[#334155]">
            Bỏ qua thành viên đã quét trước đó (kể cả đã quét ở nhóm khác)
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={newMembersOnly}
            onChange={(e) => setNewMembersOnly(e.target.checked)}
            className="size-4 text-[#2563EB] rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
          />
          <span className="text-xs font-medium text-[#334155]">
            Chỉ quét thành viên mới tham gia trong 30 ngày gần đây
          </span>
        </label>
      </div>
    </section>
  );
}
