"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { IconInfo } from "../../components/icons";

const inputClass =
  "h-8 rounded-lg border border-[#E2E8F0] bg-white px-2 text-center text-xs font-bold text-[#0F172A] outline-none focus:border-[#2563EB] disabled:bg-slate-100";

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
  rotateAfter,
  onRotateAfterChange,
  delayMin,
  onDelayMinChange,
  delayMax,
  onDelayMaxChange,
  publicOnly,
  onPublicOnlyChange,
  privateOnly,
  onPrivateOnlyChange,
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

      <div className="mb-4 space-y-2">
        {/* Phương thức 1: Theo từ khóa */}
        {method === "keyword" && (
          <>
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
                      <input
                        type="number"
                        min={1}
                        max={5000}
                        value={quotas[word] ?? 30}
                        onChange={(event) =>
                          onQuotaChange(word, Math.max(1, Math.min(5000, Number(event.target.value) || 1)))
                        }
                        className={`${inputClass} w-16`}
                      />
                      <span className="text-[11px] text-[#94A3B8]">nhóm</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Phương thức 2: Nhập Link */}
        {method === "link" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-[#64748B]">
                Số nhóm cần quét / liên kết {parsedLinks.length > 0 && `(${parsedLinks.length})`}
              </p>
              {parsedLinks.length > 5 && (
                <span className="text-[10px] text-blue-600 font-medium">Cuộn để xem thêm ({parsedLinks.length} mục)</span>
              )}
            </div>
            {parsedLinks.length === 0 ? (
              <p className="text-xs text-[#94A3B8]">Dán danh sách link và bấm Kiểm tra & Lọc trùng lặp ở cột trái để đặt hạn mức.</p>
            ) : (
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {parsedLinks.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC] px-3 py-2"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-xs font-bold text-[#2563EB]">#{item.stt}</span>
                      <span className="truncate text-xs font-medium text-[#0F172A]" title={item.url}>
                        {item.url}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        min={1}
                        max={5000}
                        value={linkQuotas[item.url] ?? 30}
                        onChange={(event) =>
                          onLinkQuotaChange(item.url, Math.max(1, Math.min(5000, Number(event.target.value) || 1)))
                        }
                        className={`${inputClass} w-16`}
                      />
                      <span className="text-[11px] text-[#94A3B8]">nhóm</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Phương thức 3: Tải tệp */}
        {method === "file" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-[#64748B]">
                Số nhóm cần quét / mục tiêu tệp {validFileRows.length > 0 && `(${validFileRows.length})`}
              </p>
              {validFileRows.length > 5 && (
                <span className="text-[10px] text-blue-600 font-medium">Cuộn để xem thêm ({validFileRows.length} mục)</span>
              )}
            </div>
            {!fileData || validFileRows.length === 0 ? (
              <p className="text-xs text-[#94A3B8]">Tải file .txt hoặc .csv ở cột trái để đặt hạn mức số nhóm.</p>
            ) : (
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {validFileRows.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#F1F5F9] bg-[#F8FAFC] px-3 py-2"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-xs font-bold text-[#2563EB]">Dòng {item.line}</span>
                      <span className="truncate text-xs font-medium text-[#0F172A]" title={item.raw}>
                        {item.raw}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="number"
                        min={1}
                        max={5000}
                        value={fileQuotas[item.raw] ?? 30}
                        onChange={(event) =>
                          onFileQuotaChange(item.raw, Math.max(1, Math.min(5000, Number(event.target.value) || 1)))
                        }
                        className={`${inputClass} w-16`}
                      />
                      <span className="text-[11px] text-[#94A3B8]">nhóm</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5">
        <IconInfo className="mt-0.5" />
        <p className="min-w-0 flex-1 text-[11px] leading-5 text-[#92400E]">
          Kết quả tìm kiếm nằm ở top đầu thường có chất lượng tương tác tốt hơn. Nên đặt hạn mức vừa phải
          theo từng từ khóa để ưu tiên nhóm chất lượng.
        </p>
      </div>

      <div className="space-y-3.5 border-t border-[#F1F5F9] pt-4">
        {/* Stepper 1: Switch Account Threshold */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-[#334155]">
            Đổi tài khoản mới khi quét được:
          </span>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
              <button
                type="button"
                onClick={() => onRotateAfterChange(Math.max(5, rotateAfter - 5))}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
              >
                -
              </button>
              <input
                type="number"
                value={rotateAfter}
                onChange={(event) => onRotateAfterChange(Math.max(1, Number(event.target.value) || 1))}
                className="w-10 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                title="Chỉ giao diện — chưa đổi nick tự động"
              />
              <button
                type="button"
                onClick={() => onRotateAfterChange(rotateAfter + 5)}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
              >
                +
              </button>
            </div>
            <span className="text-xs text-[#64748B]">nhóm / tài khoản</span>
          </div>
        </div>

        {/* Stepper 2: Delay interval */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-[#334155]">
            Khoảng cách giữa các lần quét:
          </span>
          <div className="flex items-center gap-2">
            {/* Min delay stepper */}
            <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
              <button
                type="button"
                onClick={() => onDelayMinChange(Math.max(0, delayMin - 1))}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
              >
                -
              </button>
              <input
                type="number"
                value={delayMin}
                onChange={(event) => onDelayMinChange(Math.max(0, Number(event.target.value) || 0))}
                className="w-8 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => onDelayMinChange(delayMin + 1)}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
              >
                +
              </button>
            </div>

            <span className="text-xs text-[#94A3B8]">-</span>

            {/* Max delay stepper */}
            <div className="flex items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] h-7">
              <button
                type="button"
                onClick={() => onDelayMaxChange(Math.max(delayMin, delayMax - 1))}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-l-lg font-medium"
              >
                -
              </button>
              <input
                type="number"
                value={delayMax}
                onChange={(event) => onDelayMaxChange(Math.max(delayMin, Number(event.target.value) || delayMin))}
                className="w-8 text-center text-xs font-bold text-[#1E293B] bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => onDelayMaxChange(delayMax + 1)}
                className="w-6 h-full flex items-center justify-center text-xs text-[#64748B] hover:bg-slate-200 rounded-r-lg font-medium"
              >
                +
              </button>
            </div>

            <span className="text-xs text-[#64748B]">giây</span>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
          <Checkbox
            checked={publicOnly}
            onCheckedChange={onPublicOnlyChange}
          />
          Chỉ quét nhóm đang ở chế độ công khai
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-[#0F172A]">
          <Checkbox
            checked={privateOnly}
            onCheckedChange={onPrivateOnlyChange}
          />
          Chỉ quét nhóm đang ở chế độ riêng tư
        </label>

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
                type="number"
                disabled={!minMembersEnabled}
                value={minMembers}
                onChange={(event) => onMinMembersChange(Math.max(0, Number(event.target.value) || 0))}
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

