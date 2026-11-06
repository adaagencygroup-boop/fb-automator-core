"use client";

import { Download, Search, ExternalLink } from "lucide-react";
import Pagination from "@/components/ui/pagination";
import CustomSelect from "@/components/ui/custom-select";

const FRIEND_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả số bạn bè" },
  { value: "under500", label: "Dưới 500 bạn bè" },
  { value: "over500", label: "Trên 500 bạn bè" },
];

export default function LiveMemberResultSection({
  categories,
  selectedCategory,
  onSelectCategory,
  categorySearch,
  onCategorySearchChange,
  currentCategoryData,
  memberSearch,
  onMemberSearchChange,
  friendFilter,
  onFriendFilterChange,
  onExportAll,
  onExportGroup,
  members,
  allFilteredSelected,
  onToggleSelectAllMembers,
  selectedMembers,
  onToggleSelectMember,
  currentPage,
  pageSize,
  totalFilteredCount,
  totalPages,
  onPageChange,
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
      {/* Section Header with Export */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F5F9] pb-3">
        <h3 className="text-sm font-bold text-[#0B1C30]">
          Kết quả quét thành viên
        </h3>
        <button
          type="button"
          onClick={onExportAll}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 text-xs font-semibold text-[#64748B] hover:bg-slate-50 transition-colors"
        >
          <Download className="size-3.5 text-[#64748B]" />
          <span>Xuất toàn bộ file</span>
        </button>
      </div>

      {/* 2 Column Master-Detail Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 w-full">
        {/* Left: Danh mục nhóm */}
        <div className="lg:col-span-4 flex flex-col gap-3 w-full">
          <span className="text-xs font-bold text-[#334155]">
            Danh mục nhóm ({categories.length})
          </span>

          {/* Quick Search inside list */}
          <div className="relative w-full">
            <Search className="size-3.5 absolute left-3 top-2.5 text-[#94A3B8]" />
            <input
              type="text"
              placeholder="Tìm nhóm..."
              value={categorySearch}
              onChange={(e) => onCategorySearchChange(e.target.value)}
              className="w-full h-8 pl-8 pr-3 text-xs text-slate-800 border border-[#E2E8F0] rounded-lg outline-none focus:border-[#2563EB]"
            />
          </div>

          {/* Group Cards List */}
          <div className="flex flex-col gap-2 w-full">
            {categories.length === 0 ? (
              <div className="text-center py-8 text-xs text-[#94A3B8]">
                Chưa có danh mục nào từ cơ sở dữ liệu.
              </div>
            ) : (
              categories.map((cat) => {
                const isSelected = cat.id === selectedCategory;
                return (
                  <button
                    type="button"
                    key={cat.id}
                    onClick={() => onSelectCategory(cat.id)}
                    className={`flex flex-col items-start p-2.5 gap-0.5 w-full rounded-lg text-left transition-all ${
                      isSelected
                        ? "bg-[#EFF6FF]/60 border border-[#3B82F6] shadow-xs"
                        : "bg-white border border-[#E2E8F0] hover:border-slate-300"
                    }`}
                  >
                    <span className="font-semibold text-xs leading-4 text-[#0F172A] line-clamp-1">
                      {cat.name}
                    </span>
                    <span className="text-[11px] leading-4 text-[#64748B]">
                      {cat.stats}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Chi tiết thành viên đã quét */}
        <div className="lg:col-span-8 flex flex-col gap-3 w-full">
          {/* Header Toolbar */}
          <div className="flex flex-wrap justify-between items-center w-full gap-2 pb-1">
            <div className="flex flex-col">
              <h4 className="font-bold text-xs text-[#0F172A]">
                {currentCategoryData ? currentCategoryData.name : "Chưa chọn danh mục"}
              </h4>
              <span className="text-[11px] text-[#64748B]">
                Quy mô:{" "}
                <strong className="text-slate-800">
                  {currentCategoryData?.memberSizeStr || "0"}
                </strong>{" "}
                Thành viên
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search UID, Name */}
              <div className="relative">
                <Search className="size-3.5 absolute left-2.5 top-2 text-[#94A3B8]" />
                <input
                  type="text"
                  placeholder="Tìm UID, Tên..."
                  value={memberSearch}
                  onChange={(e) => onMemberSearchChange(e.target.value)}
                  className="w-44 h-7 pl-8 pr-2 text-xs text-slate-800 border border-[#E2E8F0] rounded-lg outline-none focus:border-[#2563EB]"
                />
              </div>

              {/* Filter Friends */}
              <div className="w-36 shrink-0">
                <CustomSelect
                  value={friendFilter}
                  onChange={onFriendFilterChange}
                  options={FRIEND_FILTER_OPTIONS}
                  size="sm"
                  buttonClassName="h-7 text-xs"
                />
              </div>

              {/* Button Xuất nhóm */}
              <button
                type="button"
                onClick={onExportGroup}
                className="inline-flex items-center gap-1 px-2.5 h-7 border border-[#E2E8F0] rounded-lg text-xs font-semibold text-[#475569] hover:bg-slate-50 transition-colors"
              >
                <Download className="size-3 text-[#475569]" />
                <span>Xuất nhóm</span>
              </button>
            </div>
          </div>

          {/* Scraped Member Result Table */}
          <div className="w-full border border-[#E2E8F0] rounded-lg overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="bg-[#F8FAFC] text-[10px] font-bold uppercase tracking-wide text-[#64748B] border-b border-[#E2E8F0]">
                <tr>
                  <th className="py-2.5 px-3 text-center w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={onToggleSelectAllMembers}
                      className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3 text-center w-12">STT</th>
                  <th className="py-2.5 px-3">Họ và tên</th>
                  <th className="py-2.5 px-3">Profile Link / UID</th>
                  <th className="py-2.5 px-3 w-28">Số bạn bè</th>
                  <th className="py-2.5 px-3 text-right w-24">Thời gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-xs text-slate-400">
                      Chưa có thành viên nào được quét trong danh mục này.
                    </td>
                  </tr>
                ) : (
                  members.map((member) => {
                    const isChecked = selectedMembers.has(member.id);
                    return (
                      <tr
                        key={member.id}
                        className={`hover:bg-slate-50 transition-colors ${
                          isChecked ? "bg-[#EFF6FF]/30" : ""
                        }`}
                      >
                        <td className="py-2 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => onToggleSelectMember(member.id)}
                            className="size-3.5 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-2 px-3 text-center font-medium text-xs text-[#94A3B8]">
                          {member.stt}
                        </td>
                        <td className="py-2 px-3 font-semibold text-xs text-[#0F172A]">
                          {member.name}
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
                        <td className="py-2 px-3 font-medium text-xs text-[#334155]">
                          {member.friends}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-[11px] text-[#94A3B8]">
                          {member.time}
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
              Hiển thị {totalFilteredCount > 0 ? `${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, totalFilteredCount)}` : "0"} của {currentCategoryData?.membersTotal?.toLocaleString("vi-VN") || totalFilteredCount} UID
            </span>

            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={onPageChange}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

