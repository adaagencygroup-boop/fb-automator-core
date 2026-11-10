"use client";

import { Users, Globe } from "lucide-react";

export default function AccountGroupPickerCard({
  onOpenAccountsModal,
  selectedUidsCount = 0,
  totalAccountsCount = 0,
  selectedAccountNames = "",
  onOpenGroupPicker,
  selectedGroupsCount = 0,
}) {
  return (
    <section className="flex flex-col h-full rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
      <div className="flex items-center gap-2.5 pb-3 border-b border-[#F1F5F9]">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#1877F2] text-[11px] font-bold text-white shrink-0">
          1
        </span>
        <h2 className="text-sm font-bold text-[#0B1C30]">
          Chọn tài khoản & Nhóm quét
        </h2>
      </div>

      <div className="space-y-4">
        {/* Row 1: Tài khoản Facebook thực thi */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#475569]">
            Tài khoản Facebook thực thi:
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpenAccountsModal}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1877F2] px-3.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors shadow-sm"
            >
              <Users className="size-3.5" />
              <span>Chọn tài khoản</span>
            </button>

            <div
              title={selectedAccountNames}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 text-xs font-medium text-[#059669] cursor-help"
            >
              <span className="size-1.5 rounded-full bg-[#10B981] shrink-0" />
              <span>
                Đã chọn:{" "}
                <strong className="text-emerald-950 font-bold">
                  {selectedUidsCount} / {totalAccountsCount}
                </strong>{" "}
                tài khoản
              </span>
            </div>
          </div>
        </div>

        {/* Row 2: Danh sách nhóm mục tiêu */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#475569]">
            Danh sách nhóm mục tiêu:
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpenGroupPicker}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#1877F2] px-3.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors shadow-sm"
            >
              <Globe className="size-3.5" />
              <span>Chọn nhóm muốn quét</span>
            </button>

            <div className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 text-xs font-medium text-[#059669]">
              <span className="size-1.5 rounded-full bg-[#10B981] shrink-0" />
              <span>
                Đã chọn: <strong className="text-emerald-950 font-bold">{selectedGroupsCount} nhóm</strong>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

