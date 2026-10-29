"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Folder,
  Search,
  PlusCircle,
  X,
  Save,
  Check,
  Palette,
  Loader2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { getScanCategories, saveGroupsToCategory } from "../service";

export default function SaveSharedGroupModal({
  isOpen,
  onClose,
  groups = [],
  onSaved,
}) {
  const [categories, setCategories] = useState([]);
  const [loadingCats, setLoadingCats] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCatName, setSelectedCatName] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [deduplicate, setDeduplicate] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load danh mục khi mở modal
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    async function fetchCats() {
      setLoadingCats(true);
      try {
        const data = await getScanCategories();
        if (isMounted) {
          setCategories(data || []);
          if (data && data.length > 0 && !selectedCatName) {
            setSelectedCatName(data[0].name);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setLoadingCats(false);
      }
    }
    fetchCats();
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Lọc danh mục theo tìm kiếm
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;
    const q = searchQuery.toLowerCase().trim();
    return categories.filter((c) => (c.name || "").toLowerCase().includes(q));
  }, [categories, searchQuery]);

  // Xử lý xác nhận lưu
  const handleConfirmSave = async () => {
    const targetName = newCatName.trim() || selectedCatName.trim();
    if (!targetName) {
      toast.warning("Vui lòng chọn hoặc nhập tên danh mục!");
      return;
    }
    if (!groups || groups.length === 0) {
      toast.warning("Không có nhóm nào để lưu vào danh mục!");
      return;
    }

    setSaving(true);
    try {
      const res = await saveGroupsToCategory({
        categoryName: targetName,
        groups: groups,
        deduplicate: deduplicate,
      });

      toast.success(
        res?.message ||
          `Đã lưu thành công ${res?.saved_count || groups.length} nhóm vào danh mục «${targetName}»!`
      );
      if (onSaved) onSaved(targetName, res);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err?.message || "Lỗi khi lưu danh sách nhóm vào CSDL!");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-100 p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
              <Folder className="size-5 fill-slate-700" />
            </div>
            <h3 className="text-base font-bold text-[#0F172A]">
              Lưu vào danh sách nhóm chung
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
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
            placeholder="Tìm kiếm danh mục nhóm..."
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-300 bg-white text-xs text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-[#2563EB] transition-colors"
          />
        </div>

        {/* Danh mục có sẵn */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              DANH MỤC CÓ SẴN ({filteredCategories.length})
            </span>
            <span className="text-xs text-slate-400">
              Click vào danh mục để gán
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
            {loadingCats ? (
              <div className="col-span-2 py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
                <Loader2 className="size-4 animate-spin text-blue-600" />
                <span>Đang tải danh mục...</span>
              </div>
            ) : filteredCategories.length === 0 ? (
              <div className="col-span-2 py-6 text-center text-xs text-slate-400">
                Không tìm thấy danh mục nào phù hợp
              </div>
            ) : (
              filteredCategories.map((cat) => {
                const isSelected = selectedCatName === cat.name && !newCatName.trim();
                return (
                  <div
                    key={cat.id || cat.name}
                    onClick={() => {
                      setSelectedCatName(cat.name);
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
                          isSelected
                            ? "border-2 border-[#2563EB] bg-[#2563EB]"
                            : "border border-slate-300 bg-white"
                        }`}
                      >
                        {isSelected && (
                          <div className="size-1.5 rounded-full bg-white" />
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col min-w-0 pr-1">
                      <span className="text-xs font-bold text-[#0F172A] leading-tight truncate">
                        {cat.name}
                      </span>
                      <span className="text-[11px] text-slate-500 mt-1">
                        Hiện có:{" "}
                        <b className="font-bold text-slate-800">
                          {cat.count ?? 0}
                        </b>{" "}
                        nhóm
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
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700">
            <PlusCircle className="size-3.5 text-slate-600" />
            <span>HOẶC TẠO DANH MỤC MỚI</span>
          </div>

          <div className="relative">
            <input
              type="text"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Nhập tên danh mục mới... (VD: Nhóm Bất Động Sản Hà Nội 2024)"
              className="w-full h-10 px-3.5 pr-10 rounded-xl border border-slate-300 bg-white text-xs text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-[#2563EB] transition-colors"
              onKeyDown={(e) => e.key === "Enter" && handleConfirmSave()}
            />
            <Palette className="size-4 absolute right-3.5 top-3 text-slate-400 pointer-events-none" />
          </div>

          {/* Checkbox lọc trùng */}
          <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={deduplicate}
              onChange={(e) => setDeduplicate(e.target.checked)}
              className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer accent-[#2563EB]"
            />
            <span className="text-xs text-slate-700">
              <b className="font-semibold text-slate-900">Tự động lọc trùng</b>{" "}
              các nhóm đã tồn tại trong danh mục này
            </span>
          </label>
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
            onClick={handleConfirmSave}
            disabled={saving || (!newCatName.trim() && !selectedCatName)}
            className="h-10 px-5 rounded-xl bg-[#2563EB] hover:bg-blue-700 text-xs font-bold text-white shadow-sm flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            <span>Xác nhận lưu</span>
          </button>
        </div>
      </div>
    </div>
  );
}

