"use client";

import React from "react";
import { Plus, Search } from "lucide-react";

export default function MemberCategorySidebar({
  categories = [],
  selectedCatId,
  onSelectCat,
  categorySearch,
  onSearchChange,
  onOpenCreateModal,
}) {
  return (
    <div className="lg:col-span-4 p-5 bg-[#F8FAFC]/40 border-r border-[#E2E8F0] flex flex-col gap-3.5">
      {/* Header & Search */}
      <div className="flex flex-col gap-2 w-full">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#1E293B]">
            Danh mục nhóm ({categories.length})
          </span>
          <button
            type="button"
            onClick={onOpenCreateModal}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline"
          >
            <Plus className="size-3.5" />
            <span>Thêm mới</span>
          </button>
        </div>

        {/* Search Category Input */}
        <div className="relative w-full">
          <Search className="size-3.5 absolute left-3 top-2 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="Tìm nhóm..."
            value={categorySearch}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full h-7 pl-8 pr-3 text-xs text-slate-800 border border-[#E2E8F0] bg-white rounded-lg outline-none focus:border-[#2563EB]"
          />
        </div>
      </div>

      {/* Category Group Cards List */}
      <div className="flex flex-col gap-2 w-full max-h-[480px] overflow-y-auto pr-0.5">
        {categories.length === 0 ? (
          <div className="text-center py-8 text-xs text-[#94A3B8]">
            Chưa có danh mục nào từ cơ sở dữ liệu.
          </div>
        ) : (
          categories.map((cat) => {
            const isSelected = cat.id === selectedCatId;
            return (
              <button
                type="button"
                key={cat.id}
                onClick={() => onSelectCat(cat.id)}
                className={`flex flex-col items-start p-3 gap-0.5 w-full rounded-xl text-left transition-all ${
                  isSelected
                    ? "bg-[#EFF6FF]/60 border border-[#3B82F6] shadow-xs"
                    : "bg-white border border-[#E2E8F0] hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span
                    className={`text-xs leading-4 ${
                      isSelected ? "font-bold text-[#1E3A8A]" : "font-semibold text-[#1E293B]"
                    } line-clamp-1`}
                  >
                    {cat.name}
                  </span>
                  {isSelected && (
                    <span className="size-2 rounded-full bg-[#2563EB] shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${
                      isSelected ? "bg-[#3B82F6]" : "bg-[#CBD5E1]"
                    }`}
                  />
                  <span
                    className={`text-[11px] leading-4 ${
                      isSelected ? "text-[#2563EB]/90 font-medium" : "text-[#94A3B8]"
                    }`}
                  >
                    {cat.membersSummary}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

