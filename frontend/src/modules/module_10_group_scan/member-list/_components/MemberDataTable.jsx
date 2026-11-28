"use client";

import React, { useCallback } from "react";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import Pagination from "@/components/ui/pagination";
import useRowMultiSelect from "../../components/useRowMultiSelect";

export default function MemberDataTable({
  members = [],
  loading = false,
  selectedMemberIds,
  onToggleSelectRow,
  onToggleSelectAll,
  allFilteredSelected = false,
  onRemoveMember,
  totalFilteredCount = 0,
  totalUidCount,
  currentPage = 1,
  totalPages = 1,
  pageSize = 10,
  onPageChange,
  onSelectRows,
  // Tiêu đề cột dính ngay dưới phần đầu khung (useStickyListHead) khi bảng vừa khung — giống Danh sách page
  stickyTop = 0,
  tableFits = false,
  tableBoxRef,
}) {
  // Giữ chuột kéo = chọn nhiều thành viên liên tiếp · Ctrl + click = chọn riêng lẻ · Shift + click = cả khoảng.
  const { setContainer, rowProps } = useRowMultiSelect({
    rows: members,
    selected: selectedMemberIds,
    onChange: onSelectRows || (() => {}),
  });
  const setBox = useCallback(
    (el) => {
      if (onSelectRows) setContainer(el);
      tableBoxRef?.(el);
    },
    [onSelectRows, setContainer, tableBoxRef],
  );

  return (
    <>
      {!loading && members.length > 0 && onSelectRows && (
        <p className="mb-2 text-[11px] text-[#94A3B8]">
          Mẹo: giữ chuột trái và kéo để chọn nhiều thành viên liên tiếp · Ctrl + click chọn từng người riêng lẻ ·
          Shift + click chọn cả khoảng.
        </p>
      )}
      {/* Member Data Table */}
      <div ref={setBox} className={`w-full border border-[#E2E8F0] rounded-lg ${tableFits ? "overflow-visible" : "overflow-x-auto"}`}>
        <table className="w-full min-w-[650px] text-left text-xs">
          <thead
            style={tableFits ? { top: stickyTop } : undefined}
            className={`${tableFits ? "sticky z-20 " : ""}bg-[#F8FAFC] shadow-[0_1px_0_0_#E2E8F0] text-xs font-semibold uppercase tracking-[0.3px] [&_th]:font-semibold text-[#475569] border-b border-[#E2E8F0]`}>
            <tr>
              <th className="py-2.5 px-3 text-center w-10">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={onToggleSelectAll}
                  className="size-4 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer accent-[#2563EB]"
                />
              </th>
              <th className="py-2.5 px-2 text-center w-12">STT</th>
              <th className="py-2.5 px-3">TÊN THÀNH VIÊN</th>
              <th className="py-2.5 px-3">UID</th>
              <th className="py-2.5 px-3 whitespace-nowrap">THỜI GIAN QUÉT</th>
              <th className="py-2.5 px-3 text-right w-14">THAO TÁC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-xs text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Loader2 className="size-5 animate-spin text-blue-600" />
                    <span>Đang nạp thành viên từ CSDL...</span>
                  </div>
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-xs text-slate-400">
                  Chưa có thành viên nào phù hợp tiêu chí lọc.
                </td>
              </tr>
            ) : (
              members.map((member, idx) => {
                const isSelected = selectedMemberIds.has(member.id);
                return (
                  <tr
                    key={member.id}
                    {...(onSelectRows ? rowProps(member, idx) : {})}
                    className={`transition-colors ${onSelectRows ? "cursor-pointer select-none" : ""} ${
                      isSelected ? "bg-[#EFF6FF] hover:bg-[#DBEAFE]" : "hover:bg-[#F8FAFC]/80"
                    }`}
                  >
                    <td className="py-3.5 px-3 text-center" data-no-row-selection>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelectRow(member.id)}
                        className="size-4 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer accent-[#2563EB]"
                      />
                    </td>
                    <td className="py-3.5 px-2 text-center text-[#94A3B8] font-medium text-xs">
                      {(currentPage - 1) * pageSize + idx + 1}
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="size-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-[11px] text-slate-600 uppercase shrink-0">
                          {member.name.charAt(0)}
                        </div>
                        <span className="font-semibold text-sm text-[#0F172A] line-clamp-1">
                          {member.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <a
                        href={`https://facebook.com/${member.uid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-[#2563EB] hover:underline"
                      >
                        <span title={member.uid || undefined}>{member.shortUid}</span>
                        <ExternalLink className="size-3 text-[#2563EB]" />
                      </a>
                    </td>
                    <td className="py-3.5 px-3 font-mono text-xs text-[#64748B] whitespace-nowrap">
                      {member.time}
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => onRemoveMember(member.id)}
                        className="rounded p-1 text-[#94A3B8] hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        title="Xóa thành viên"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Table Pagination */}
      <div className="flex flex-row justify-between items-center w-full pt-1">
        <span className="text-xs text-[#64748B]">
          Hiển thị {totalFilteredCount > 0 ? `${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, totalFilteredCount)}` : "0"} của{" "}
          {totalUidCount ? totalUidCount.toLocaleString("vi-VN") : totalFilteredCount} UID
        </span>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      </div>
    </>
  );
}

