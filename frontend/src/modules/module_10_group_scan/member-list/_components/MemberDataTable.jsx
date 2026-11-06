"use client";

import React from "react";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import Pagination from "@/components/ui/pagination";

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
}) {
  return (
    <>
      {/* Member Data Table */}
      <div className="w-full border border-[#E2E8F0] rounded-lg overflow-x-auto">
        <table className="w-full min-w-[650px] text-left text-xs">
          <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B] border-b border-[#E2E8F0]">
            <tr>
              <th className="py-2.5 px-3 text-center w-10">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={onToggleSelectAll}
                  className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                />
              </th>
              <th className="py-2.5 px-2 text-center w-12">STT</th>
              <th className="py-2.5 px-3">TÊN THÀNH VIÊN</th>
              <th className="py-2.5 px-3">UID</th>
              <th className="py-2.5 px-3">BẠN BÈ</th>
              <th className="py-2.5 px-3">THỜI GIAN QUÉT</th>
              <th className="py-2.5 px-3 text-right w-14">THAO TÁC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-slate-400">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Loader2 className="size-5 animate-spin text-blue-600" />
                    <span>Đang nạp thành viên từ CSDL...</span>
                  </div>
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-slate-400">
                  Chưa có thành viên nào phù hợp tiêu chí lọc.
                </td>
              </tr>
            ) : (
              members.map((member, idx) => {
                const isSelected = selectedMemberIds.has(member.id);
                return (
                  <tr
                    key={member.id}
                    className={`hover:bg-[#F8FAFC]/80 transition-colors ${
                      isSelected ? "bg-[#EFF6FF]/40" : ""
                    }`}
                  >
                    <td className="py-2 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelectRow(member.id)}
                        className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                      />
                    </td>
                    <td className="py-2 px-2 text-center text-[#64748B] font-medium text-[11px]">
                      {(currentPage - 1) * pageSize + idx + 1}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="size-6 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-[10px] text-slate-600 uppercase shrink-0">
                          {member.name.charAt(0)}
                        </div>
                        <span className="font-semibold text-xs text-[#0F172A] line-clamp-1">
                          {member.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <a
                        href={`https://facebook.com/${member.uid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-[#2563EB] hover:underline"
                      >
                        <span>{member.shortUid}</span>
                        <ExternalLink className="size-3 text-[#2563EB]" />
                      </a>
                    </td>
                    <td className="py-2 px-3 font-semibold text-xs text-[#334155]">
                      {member.friends}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-[#64748B]">
                      {member.time}
                    </td>
                    <td className="py-2 px-3 text-right">
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

