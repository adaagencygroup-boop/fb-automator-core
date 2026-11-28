"use client";

/**
 * "Lưu vào danh sách page chung" — cùng giao diện với SaveSharedGroupModal (module 10),
 * lưu page_key vào danh mục page trong DB (page_list_categories).
 */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, Search, PlusCircle, X, Save, Palette, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { savePagesToList } from "../service";
import { usePageLists } from "./usePageLists";
import { useActionLock } from "./useActionLock";
import { CATEGORY_COLORS } from "@/modules/module_10_group_scan/member-list/_components/CreateCategoryModal";
import { pageListColor } from "./pageListColor";

export default function SavePageListModal({ isOpen, onClose, pageKeys = [], onSaved }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { lists: categories, loading: loadingCats } = usePageLists({ enabled: isOpen });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [newCatName, setNewCatName] = useState("");
  const [showNew, setShowNew] = useState(false); // ô tạo danh mục mới: ẩn, bấm tiêu đề mới hiện
  const [newColor, setNewColor] = useState(CATEGORY_COLORS[0]);
  const [saving, guardSave, savingApi] = useActionLock();

  // Mỗi lần mở: làm sạch ô nhập
  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery("");
    setNewCatName("");
    setSelectedId(null);
    setShowNew(false);
  }, [isOpen]);

  // Mặc định chọn danh mục đầu tiên (mới dùng gần nhất)
  useEffect(() => {
    if (!isOpen || !categories.length) return;
    setSelectedId((cur) => (cur != null && categories.some((c) => c.id === cur) ? cur : categories[0].id));
  }, [isOpen, categories]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, saving, onClose]);

  const filteredCategories = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return categories;
    return categories.filter((c) => (c.name || "").toLowerCase().includes(q));
  }, [categories, searchQuery]);

  const newInputVisible = showNew; // chỉ hiện khi người dùng bấm "HOẶC TẠO DANH MỤC MỚI"
  const typedName = newCatName.trim();
  const canSave = !saving && pageKeys.length > 0 && (typedName || selectedId != null);

  const handleConfirmSave = () => {
    if (!pageKeys.length) {
      toast.warning("Không có page nào để lưu vào danh mục!", { key: "m11-save-list" });
      return;
    }
    if (!typedName && selectedId == null) {
      toast.warning("Vui lòng chọn hoặc nhập tên danh mục!", { key: "m11-save-list" });
      return;
    }
    return (async () => {
      try {
        const res = await savePagesToList(
          typedName
            ? { categoryName: typedName, pageKeys, color: newColor }
            : { categoryId: selectedId, pageKeys },
        );
        toast.success(res?.message || "Đã lưu page vào danh mục.", { key: "m11-save-list" });
        onSaved?.(res);
        onClose();
      } catch (err) {
        console.error(err);
        toast.error(err?.message || "Lỗi khi lưu danh sách page!", { key: "m11-save-list" });
      }
    })();
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-100 p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
              <Folder className="size-5 fill-slate-700" />
            </div>
            <div className="flex flex-col">
              <h3 className="text-base font-bold text-[#0F172A]">Lưu vào danh sách page chung</h3>
              <span className="text-[11px] text-slate-500">
                Sẽ lưu <b className="font-semibold text-slate-800">{pageKeys.length.toLocaleString("vi-VN")}</b> page
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="size-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full">
          <Search className="size-4 absolute left-3.5 top-3.5 text-[#94A3B8]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm kiếm danh mục page..."
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-300 bg-white text-xs text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-[#2563EB] transition-colors"
          />
        </div>

        {/* Danh mục có sẵn */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              DANH MỤC CÓ SẴN ({filteredCategories.length})
            </span>
            <span className="text-xs text-slate-400">Click vào danh mục để gán</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
            {loadingCats && !categories.length ? (
              <div className="col-span-2 py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
                <Loader2 className="size-4 animate-spin text-blue-600" />
                <span>Đang tải danh mục...</span>
              </div>
            ) : filteredCategories.length === 0 ? (
              <div className="col-span-2 py-6 text-center text-xs text-slate-400">
                {categories.length ? "Không tìm thấy danh mục nào phù hợp" : "Chưa có danh mục — tạo danh mục mới bên dưới"}
              </div>
            ) : (
              filteredCategories.map((cat) => {
                const isSelected = selectedId === cat.id && !typedName;
                return (
                  <div
                    key={cat.id}
                    onClick={() => {
                      setSelectedId(cat.id);
                      setNewCatName("");
                    }}
                    className={`p-3.5 rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
                      isSelected
                        ? "border-[#2563EB] bg-[#EFF6FF]/60 shadow-xs"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    {/* Custom Radio Button */}
                    <div className="pt-0.5 shrink-0">
                      <div
                        className={`size-4 rounded-full flex items-center justify-center transition-colors ${
                          isSelected ? "border-2 border-[#2563EB] bg-[#2563EB]" : "border border-slate-300 bg-white"
                        }`}
                      >
                        {isSelected && <div className="size-1.5 rounded-full bg-white" />}
                      </div>
                    </div>

                    <div className="flex flex-col min-w-0 pr-1">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A] leading-tight">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: pageListColor(cat) }} />
                        <span className="truncate">{cat.name}</span>
                      </span>
                      <span className="text-[11px] text-slate-500 mt-1">
                        Hiện có:{" "}
                        <b className="font-bold text-slate-800">{(cat.page_count ?? 0).toLocaleString("vi-VN")}</b> page
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Hoặc tạo danh mục mới */}
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={() => {
              if (newInputVisible) setNewCatName("");
              setShowNew(!newInputVisible);
            }}
            aria-expanded={newInputVisible}
            className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
              newInputVisible ? "text-[#2563EB]" : "text-slate-700 hover:text-[#2563EB]"
            }`}
          >
            <PlusCircle className="size-3.5" />
            <span>HOẶC TẠO DANH MỤC MỚI</span>
          </button>

          {newInputVisible && (
          <div className="relative">
            <input
              type="text"
              autoFocus
              value={newCatName}
              maxLength={255}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Nhập tên danh mục mới... (VD: Page Mỹ Phẩm Hà Nội 2026)"
              className="w-full h-10 px-3.5 pr-10 rounded-xl border border-slate-300 bg-white text-xs text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-[#2563EB] transition-colors"
              onKeyDown={(e) => e.key === "Enter" && canSave && guardSave(handleConfirmSave)}
            />
            <Palette className="size-4 absolute right-3.5 top-3 pointer-events-none" style={{ color: newColor }} />
          </div>
          )}
          {newInputVisible && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span className="text-[11px] text-slate-500">Màu:</span>
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Màu ${c}`}
                  aria-pressed={c === newColor}
                  onClick={() => setNewColor(c)}
                  className={`size-5 rounded-full ring-offset-2 transition ${c === newColor ? "ring-2 ring-slate-900" : "hover:scale-110"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-10 px-5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={() => guardSave(handleConfirmSave)}
            disabled={!canSave}
            aria-busy={savingApi}
            className="h-10 px-5 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-xs font-bold text-white shadow-sm flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {savingApi ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            <span>Xác nhận lưu</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
