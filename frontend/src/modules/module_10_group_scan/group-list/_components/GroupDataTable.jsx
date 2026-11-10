"use client";

import { Copy, ExternalLink, Loader2, Trash2 } from "lucide-react";
import Pagination from "@/components/ui/pagination";
import CustomSelect from "@/components/ui/custom-select";

const PAGE_SIZE_OPTIONS = [
  { value: 8, label: "8" },
  { value: 15, label: "15" },
  { value: 30, label: "30" },
];

export default function GroupDataTable({
  loading = false,
  paginatedGroups,
  allCurrentPageSelected,
  onToggleSelectAll,
  selectedIds,
  onToggleSelectRow,
  startIndex,
  totalFilteredCount,
  pageSize,
  onPageSizeChange,
  currentPage,
  totalPages,
  onPageChange,
  onDeleteSingle,
  onCopyLink,
}) {
  return (
    <>
      {/* Data Table */}
      <div className="border border-[#E2E8F0] rounded-lg overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr className="bg-[#F8FAFC]/80 border-b border-[#E2E8F0] h-[48px]">
              <th className="w-10 px-3 py-2 text-center">
                <input
                  type="checkbox"
                  checked={allCurrentPageSelected}
                  onChange={onToggleSelectAll}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-[#2563EB]"
                />
              </th>
              <th className="w-12 px-2 py-2 text-center text-[11px] font-bold uppercase text-[#475569]">
                STT
              </th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                TỪ KHÓA
              </th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                TÊN NHÓM
              </th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                LOẠI NHÓM
              </th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569] text-right">
                THÀNH VIÊN
              </th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                LIÊN KẾT / URL NHÓM
              </th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase text-[#475569]">
                GHI CHÚ
              </th>
              <th className="w-20 px-3 py-2 text-center text-[11px] font-bold uppercase text-[#475569]">
                THAO TÁC
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-xs text-slate-500">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Đang tải danh sách nhóm từ Database...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedGroups.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="py-12 text-center text-xs text-slate-400"
                >
                  Không tìm thấy nhóm nào phù hợp trong danh mục này.
                </td>
              </tr>
            ) : (
              paginatedGroups.map((g, index) => {
                const isChecked = selectedIds.has(g.id);
                return (
                  <tr
                    key={g.id}
                    className={`hover:bg-slate-50/60 transition-colors ${
                      isChecked ? "bg-blue-50/20" : ""
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="w-10 px-3 py-4 text-center">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => onToggleSelectRow(g.id)}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-[#2563EB]"
                      />
                    </td>

                    {/* STT */}
                    <td className="w-12 px-2 py-4 text-center text-xs font-medium text-[#94A3B8]">
                      {startIndex + index + 1}
                    </td>

                    {/* TỪ KHÓA */}
                    <td className="px-3 py-4 text-xs font-medium text-[#1E293B]">
                      {g.keyword || "—"}
                    </td>

                    {/* TÊN NHÓM */}
                    <td className="px-3 py-4 text-xs font-medium text-[#0F172A] max-w-[200px] leading-5">
                      {g.name}
                    </td>

                    {/* LOẠI NHÓM */}
                    <td className="px-3 py-4">
                      {g.type === "public" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857]">
                          Công khai
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#EEF2FF] border border-[#C7D2FE] text-[#4338CA]">
                          Riêng tư
                        </span>
                      )}
                    </td>

                    {/* THÀNH VIÊN */}
                    <td className="px-3 py-4 text-xs font-medium text-[#0F172A] text-right">
                      {g.members || "—"}
                    </td>

                    {/* LIÊN KẾT / URL NHÓM */}
                    <td className="px-3 py-4">
                      <a
                        href={g.url || g.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:underline max-w-[190px] truncate"
                      >
                        <span className="truncate">{g.url || g.href}</span>
                        <ExternalLink className="w-3 h-3 shrink-0 text-[#94A3B8]" />
                      </a>
                    </td>

                    {/* GHI CHÚ */}
                    <td className="px-3 py-4 text-xs">
                      {g.note === "Đã tham gia" ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-[10px] text-[11px] font-medium bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8]">
                          Đã tham gia
                        </span>
                      ) : g.note === "Đang chờ QTV duyệt" ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-[10px] text-[11px] font-medium bg-[#FFFBEB] border border-[#FDE68A] text-[#B45309]">
                          Đang chờ QTV duyệt
                        </span>
                      ) : (
                        <span className="text-[#94A3B8]">—</span>
                      )}
                    </td>

                    {/* THAO TÁC ĐƠN LẺ (UC-GIS-10) */}
                    <td className="w-20 px-3 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => onCopyLink?.(g.url || g.href)}
                          title="Sao chép liên kết"
                          className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteSingle?.(g.id)}
                          title="Xóa nhóm này"
                          className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Table Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
        {/* Left stats info */}
        <div className="flex items-center gap-2 text-xs text-[#64748B]">
          <span>
            Hiển thị {totalFilteredCount === 0 ? 0 : startIndex + 1} -{" "}
            {Math.min(startIndex + pageSize, totalFilteredCount)} trong tổng số{" "}
            {totalFilteredCount} nhóm
          </span>
          <span>•</span>
          <div className="flex items-center gap-1.5">
            <span>Hàng mỗi trang:</span>
            <CustomSelect
              value={pageSize}
              onChange={onPageSizeChange}
              options={PAGE_SIZE_OPTIONS}
              size="sm"
              direction="up"
              className="w-16"
              buttonClassName="h-[28px] px-2 text-xs"
            />
          </div>
        </div>

        {/* Right pagination */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      </div>
    </>
  );
}
