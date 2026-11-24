"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { IconInfo } from "../../components/icons";
import DelayRangeInput from "../../components/DelayRangeInput";
import { INT_INPUT_PROPS, blockNonDigitKey, digitsOnly } from "../../utils/intInput";

/** Backend giới hạn cứng 200 nhóm / từ khóa (HARD_MAX_GROUPS). */
const QUOTA_MIN = 1;
const QUOTA_MAX = 200;

const arrowClass =
  "flex h-3.5 w-5 items-center justify-center rounded text-[#5B6478] hover:bg-[#DBE4FF] hover:text-[#1B45A3] disabled:opacity-30 disabled:hover:bg-transparent";

/** Ô số có mũi tên lên / xuống — cùng kiểu với SuffixInput của Module 04. */
function QuotaInput({ value, onChange, label }) {
  const current = Math.floor(Number(value));
  const clamp = (n) => Math.max(QUOTA_MIN, Math.min(QUOTA_MAX, n));
  const bump = (delta) => onChange(clamp((Number.isFinite(current) ? current : QUOTA_MIN) + delta));

  return (
    <div className="flex h-8 w-20 items-center rounded-lg border border-[#E2E8F0] bg-white pl-2 pr-0.5 focus-within:border-[#2563EB]">
      <input
        {...INT_INPUT_PROPS}
        value={Number.isFinite(current) ? current : value}
        aria-label={label}
        onKeyDown={blockNonDigitKey}
        onChange={(event) => onChange(clamp(Number(digitsOnly(event.target.value)) || QUOTA_MIN))}
        className="min-w-0 flex-1 bg-transparent text-center text-xs font-bold text-[#0F172A] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="flex shrink-0 flex-col">
        <button
          type="button"
          tabIndex={-1}
          disabled={current >= QUOTA_MAX}
          onClick={() => bump(1)}
          aria-label="Tăng số nhóm"
          className={arrowClass}
        >
          <ChevronUp className="size-3" strokeWidth={2.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={current <= QUOTA_MIN}
          onClick={() => bump(-1)}
          aria-label="Giảm số nhóm"
          className={arrowClass}
        >
          <ChevronDown className="size-3" strokeWidth={2.5} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

export default function ScanTargetConfigCard({
  method,
  keywords,
  quotas,
  onQuotaChange,
  parsedLinks,
  linkQuotas,
  onLinkQuotaChange,
  validFileRows,
  fileQuotas,
  onFileQuotaChange,
  fileData,
  delayMin,
  onDelayMinChange,
  delayMax,
  onDelayMaxChange,
  minMembersEnabled,
  onMinMembersEnabledChange,
  minMembers,
  onMinMembersChange,
}) {
  return (
    <section className="flex flex-col h-full rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2.5 pb-3 mb-4 border-b border-[#F1F5F9]">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#2563EB] text-[11px] font-bold text-white shrink-0">
          2
        </span>
        <h2 className="text-sm font-bold text-[#0B1C30]">Thiết lập cấu hình quét mục tiêu</h2>
      </div>

      {method === "keyword" && (
        <>
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-[#64748B]">
                Số nhóm cần quét / từ khóa {keywords.length > 0 && `(${keywords.length})`}
              </p>
              {keywords.length > 5 && (
                <span className="text-[10px] text-blue-600 font-medium">Cuộn để xem thêm ({keywords.length} mục)</span>
              )}
            </div>
            {keywords.length === 0 ? (
              <p className="text-xs text-[#94A3B8]">Thêm từ khóa ở cột trái để đặt hạn mức số nhóm.</p>
            ) : (
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {keywords.map((word) => (
                  <div
                    key={word}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC] px-3 py-2"
                  >
                    <span className="truncate text-xs font-medium text-[#0F172A]">{word}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <QuotaInput
                        value={quotas[word] ?? 30}
                        onChange={(val) => onQuotaChange(word, val)}
                        label={`Số nhóm cần quét cho từ khóa ${word}`}
                      />
                      <span className="text-[11px] text-[#94A3B8]">nhóm</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5">
            <IconInfo className="mt-0.5" />
            <p className="min-w-0 flex-1 text-[11px] leading-5 text-[#92400E]">
              Kết quả tìm kiếm nằm ở top đầu thường có chất lượng tương tác tốt hơn. Nên đặt hạn mức vừa phải
              theo từng từ khóa để ưu tiên nhóm chất lượng.
            </p>
          </div>
        </>
      )}

      <div className={`space-y-3.5 ${method === "keyword" ? "border-t border-[#F1F5F9] pt-4" : ""}`}>
        {/* Stepper 2: Delay interval */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-[#334155]">
            Khoảng cách giữa các lần quét:
          </span>
          <DelayRangeInput
            min={Number(delayMin) || 0}
            max={Number(delayMax) || 0}
            onChange={(lo, hi) => {
              onDelayMinChange(lo);
              onDelayMaxChange(hi);
            }}
          />
        </div>

        {/* Theo từ khóa: số nhóm quét được (bảng Kiểm tra) đã loại sẵn nhóm riêng tư → ghi chú này thừa.
            Nhập link / tải tệp vẫn cần: link nhóm riêng tư người dùng đưa vào sẽ bị bỏ qua. */}
        {method !== "keyword" && (
          <div className="flex items-start gap-2 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-[11px] leading-5 text-[#1E40AF]">
            <IconInfo className="mt-0.5" />
            <span>Chỉ quét nhóm <b>công khai</b>. Link nhóm riêng tư sẽ được bỏ qua và tài khoản không tham gia nhóm nào.</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
            <Checkbox
              checked={minMembersEnabled}
              onCheckedChange={onMinMembersEnabledChange}
            />
            <span>Chỉ quét nhóm có số lượng thành viên lớn hơn</span>
          </label>
          <div className="flex items-center gap-2">
            <div className={`flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7 ${!minMembersEnabled ? "opacity-50 pointer-events-none" : ""}`}>
              <button
                type="button"
                disabled={!minMembersEnabled}
                onClick={() => onMinMembersChange(Math.max(0, minMembers - 1000))}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
              >
                -
              </button>
              <input
                {...INT_INPUT_PROPS}
                disabled={!minMembersEnabled}
                value={minMembers}
                onKeyDown={blockNonDigitKey}
                onChange={(event) => onMinMembersChange(Math.max(0, Number(digitsOnly(event.target.value)) || 0))}
                className="w-16 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                disabled={!minMembersEnabled}
                onClick={() => onMinMembersChange(minMembers + 1000)}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
              >
                +
              </button>
            </div>
            <span className="text-xs text-[#64748B]">thành viên</span>
          </div>
        </div>
      </div>
    </section>
  );
}
