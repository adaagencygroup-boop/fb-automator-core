"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  FolderPlus,
  Pencil,
  Trash2,
  FolderInput,
  X,
} from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";

export default function GroupListModals({
  groups = [],
  mounted = true,
  showAddCatModal,
  onCloseAddCatModal,
  newCatName,
  onNewCatNameChange,
  onAddCategory,
  showEditCatModal,
  onCloseEditCatModal,
  editCatName,
  onEditCatNameChange,
  onEditCategory,
  onDeleteCategory,
  activeCategoryId,
  showMoveModal,
  onCloseMoveModal,
  selectedCount = 0,
  targetCatId,
  onTargetCatIdChange,
  categories,
  onMoveGroups,
  menuAnchor,
  onCloseMenu,
  onOpenEditFromMenu,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Modal Thêm danh mục */}
      {showAddCatModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCloseAddCatModal();
          }}
        >
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-blue-600" />
                <span>Thêm danh mục mới</span>
              </h3>
              <button
                type="button"
                onClick={onCloseAddCatModal}
                className="p-1 rounded hover:bg-slate-100 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Tên danh mục thư mục <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                autoFocus
                value={newCatName}
                onChange={(e) => onNewCatNameChange(e.target.value)}
                placeholder="Ví dụ: Hội Săn Hàng Sale, Bất Động Sản..."
                className="h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
                onKeyDown={(e) => e.key === "Enter" && onAddCategory()}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onCloseAddCatModal}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={onAddCategory}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
              >
                Tạo danh mục
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Sửa danh mục */}
      {showEditCatModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCloseEditCatModal();
          }}
        >
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Pencil className="w-4 h-4 text-blue-600" />
                <span>Chỉnh sửa danh mục</span>
              </h3>
              <button
                type="button"
                onClick={onCloseEditCatModal}
                className="p-1 rounded hover:bg-slate-100 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Tên danh mục thư mục <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                autoFocus
                value={editCatName}
                onChange={(e) => onEditCatNameChange(e.target.value)}
                className="h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                onKeyDown={(e) => e.key === "Enter" && onEditCategory()}
              />
            </div>
            {confirmDelete ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 space-y-1 animate-in fade-in">
                <p className="font-semibold flex items-center gap-1">
                  <span>⚠️ Cảnh báo an toàn (BR-GIS-09.1)</span>
                </p>
                <p className="text-[11px] leading-relaxed">
                  Xóa danh mục sẽ chuyển các nhóm con về mục "Tất cả nhóm đã quét". Bấm xác nhận để xóa vĩnh viễn danh mục này.
                </p>
              </div>
            ) : null}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!confirmDelete) {
                    setConfirmDelete(true);
                  } else {
                    onDeleteCategory(activeCategoryId);
                    setConfirmDelete(false);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                  confirmDelete
                    ? "bg-red-600 text-white hover:bg-red-700 shadow-sm"
                    : "border border-red-200 text-red-600 hover:bg-red-50"
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{confirmDelete ? "Xác nhận xóa vĩnh viễn" : "Xóa danh mục"}</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    onCloseEditCatModal();
                  }}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={onEditCategory}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
                >
                  Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Chuyển mục */}
      {showMoveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCloseMoveModal();
          }}
        >
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <FolderInput className="w-4 h-4 text-blue-600" />
                <span>Chuyển {selectedCount} nhóm sang danh mục khác</span>
              </h3>
              <button
                type="button"
                onClick={onCloseMoveModal}
                className="p-1 rounded hover:bg-slate-100 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Chọn danh mục đích:
              </label>
              <CustomSelect
                value={targetCatId}
                onChange={onTargetCatIdChange}
                options={categories
                  .filter((c) => c.id !== activeCategoryId)
                  .map((c) => ({ value: c.id, label: c.name }))}
                placeholder="-- Chọn danh mục đích --"
                size="md"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onCloseMoveModal}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={onMoveGroups}
                className="px-4 py-1.5 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm"
              >
                Xác nhận chuyển
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3-dots Dropdown Menu (Portalled so it is never clipped by overflow-y-auto) */}
      {menuAnchor && (
        <div
          style={{
            position: "fixed",
            top: `${menuAnchor.top}px`,
            right: `${menuAnchor.right}px`,
            zIndex: 9999,
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-36 bg-white rounded-xl border border-slate-200 shadow-xl py-1 text-xs animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            type="button"
            onClick={onOpenEditFromMenu}
            className="w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium transition-colors"
          >
            <Pencil className="w-3.5 h-3.5 text-slate-500" />
            <span>Đổi tên</span>
          </button>
          <button
            type="button"
            onClick={() => onDeleteCategory(menuAnchor.cat.id)}
            className="w-full px-3 py-2 text-left text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
            <span>Xóa danh mục</span>
          </button>
        </div>
      )}
    </>,
    document.body
  );
}

