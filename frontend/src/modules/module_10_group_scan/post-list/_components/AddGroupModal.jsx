"use client";

import { createPortal } from "react-dom";
import { Folder, X } from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";

const NEW_GROUP_CATEGORY_OPTIONS = [
  { value: "Hội buôn", label: "Hội buôn" },
  { value: "Kinh doanh", label: "Kinh doanh" },
  { value: "Đầu tư", label: "Đầu tư" },
  { value: "Thương mại điện tử", label: "Thương mại điện tử" },
];

export default function AddGroupModal({
  isOpen,
  onClose,
  newGroupName,
  onNewGroupNameChange,
  newGroupCategory,
  onNewGroupCategoryChange,
  onSubmit,
  mounted = true,
}) {
  if (!mounted || !isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4 animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between border-b pb-3 border-slate-100">
          <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
            <Folder className="size-5 text-blue-600" />
            Thêm nhóm mới vào danh sách
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Tên nhóm Facebook</label>
            <input
              type="text"
              required
              placeholder="Ví dụ: Hội Bán Hàng Online..."
              value={newGroupName}
              onChange={(e) => onNewGroupNameChange(e.target.value)}
              className="w-full h-8 px-3 text-xs border border-slate-300 rounded-lg outline-none focus:border-blue-600"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Phân loại thư mục</label>
            <CustomSelect
              value={newGroupCategory}
              onChange={onNewGroupCategoryChange}
              options={NEW_GROUP_CATEGORY_OPTIONS}
              size="sm"
              buttonClassName="h-8"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg text-xs font-semibold"
          >
            Hủy bỏ
          </button>
          <button
            type="submit"
            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold"
          >
            Tạo nhóm
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

