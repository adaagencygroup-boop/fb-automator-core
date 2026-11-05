"use client";

import { Eye, Trash2 } from "lucide-react";

export default function GroupPreviewSection({
  selectedGroups,
  onRemoveGroup,
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {/* Table Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB] shrink-0">
            <Eye className="size-4" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[#0B1C30]">
                Xem trước danh sách nhóm muốn quét
              </h3>
              <span className="rounded-full bg-[#DBEAFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#1D4ED8]">
                {selectedGroups.length} nhóm đã chọn
              </span>
            </div>
            <p className="text-xs text-[#94A3B8]">
              Kiểm tra thông tin quyền riêng tư và quy mô thành viên trước khi tiến hành quét
            </p>
          </div>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-xs">
          <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B] border-b border-[#E2E8F0]">
            <tr>
              <th className="w-14 px-4 py-3 text-center">STT</th>
              <th className="px-4 py-3">TÊN NHÓM FACEBOOK</th>
              <th className="w-36 px-4 py-3">LOẠI NHÓM</th>
              <th className="w-48 px-4 py-3">QUY MÔ / THÀNH VIÊN</th>
              <th className="w-20 px-4 py-3 text-center">THAO TÁC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {selectedGroups.map((group, idx) => (
              <tr key={group.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 text-center font-bold text-[#94A3B8]">
                  {group.stt || (idx < 9 ? `0${idx + 1}` : `${idx + 1}`)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${group.tagBg} ${group.tagText}`}
                    >
                      {group.tag}
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold text-xs text-[#0F172A] line-clamp-1">
                        {group.name}
                      </span>
                      <span className="font-mono text-[11px] text-[#94A3B8]">
                        ID: {group.uid}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {group.type === "public" ? (
                    <span className="inline-flex rounded border border-[#D1FAE5] bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-semibold text-[#047857]">
                      Công khai
                    </span>
                  ) : (
                    <span className="inline-flex rounded bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-semibold text-[#475569]">
                      Riêng tư
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-semibold text-[#0F172A]">
                  {group.members}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    type="button"
                    onClick={() => onRemoveGroup(group.id)}
                    className="rounded p-1 text-[#94A3B8] hover:bg-rose-50 hover:text-rose-600 transition-colors"
                    title="Xóa nhóm"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
            {selectedGroups.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-[#94A3B8]">
                  Chưa có nhóm nào được chọn. Vui lòng bấm &quot;Chọn nhóm muốn quét&quot;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

