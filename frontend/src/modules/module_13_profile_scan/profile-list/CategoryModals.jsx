"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, FolderInput, Loader2, X } from "lucide-react";
import { toast } from "@/lib/toast";

const COLORS = ["#2563EB", "#059669", "#D97706", "#DC2626", "#7C3AED", "#DB2777", "#0891B2", "#475569"];
const MAX_NAME = 255;

function Shell({ icon: Icon, title, busy, onClose, onSubmit, submitLabel, disabled, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled && !busy) onSubmit();
        }}
        className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#F1F5F9] pb-3">
          <h3 className="flex items-center gap-2 text-base font-bold text-[#0F172A]"><Icon className="size-5 text-[#2563EB]" /> {title}</h3>
          <button type="button" aria-label="Đóng" disabled={busy} onClick={onClose} className="text-[#94A3B8] hover:text-[#334155]"><X className="size-5" /></button>
        </div>
        {children}
        <div className="flex justify-end gap-2 border-t border-[#F1F5F9] pt-3">
          <button type="button" disabled={busy} onClick={onClose} className="h-8 rounded-lg border border-[#E2E8F0] px-4 text-xs font-semibold text-[#475569] hover:bg-slate-50">Hủy bỏ</button>
          <button type="submit" disabled={disabled || busy} className="inline-flex h-8 items-center gap-2 rounded-lg bg-[#2563EB] px-4 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
            {busy && <Loader2 className="size-3.5 animate-spin" />} {submitLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function useSubmit(action, onClose) {
  const [busy, setBusy] = useState(false);
  const submit = async (...args) => {
    setBusy(true);
    try {
      await action(...args);
      onClose();
    } catch (err) {
      toast.error(err.message);
      setBusy(false);
    }
  };
  return [busy, submit];
}

/** Tạo mới (category rỗng) hoặc sửa danh mục */
export function CategoryFormModal({ category, takenNames, onSave, onClose }) {
  const [name, setName] = useState(category?.name || "");
  const [color, setColor] = useState(category?.color || COLORS[0]);
  const [busy, submit] = useSubmit(onSave, onClose);
  const clean = name.trim();
  const taken = takenNames.some((n) => n.toLowerCase() === clean.toLowerCase() && n !== category?.name);

  return (
    <Shell icon={Folder} title={category ? "Sửa danh mục profile" : "Thêm danh mục profile"} busy={busy} onClose={onClose} disabled={!clean || taken} submitLabel={category ? "Lưu thay đổi" : "Tạo danh mục"} onSubmit={() => submit({ name: clean, color })}>
      <div className="space-y-1.5">
        <label htmlFor="profile-category-name" className="text-xs font-semibold text-[#334155]">Tên danh mục</label>
        <input
          id="profile-category-name"
          autoFocus
          maxLength={MAX_NAME}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="VD: Danh mục KOL KOC"
          className="h-9 w-full rounded-lg border border-[#CBD5E1] px-3 text-xs outline-none focus:border-[#2563EB]"
        />
        {taken && <p className="text-[11px] text-[#DC2626]">Tên danh mục đã tồn tại.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {COLORS.map((c) => (
          <button key={c} type="button" aria-label={`Màu ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} className={`size-6 rounded-full ring-offset-2 ${c === color ? "ring-2 ring-[#0F172A]" : ""}`} style={{ backgroundColor: c }} />
        ))}
      </div>
    </Shell>
  );
}

/** Chuyển profile đã chọn sang danh mục khác */
export function MoveProfilesModal({ count, categories, onMove, onClose }) {
  const [target, setTarget] = useState(null);
  const [busy, submit] = useSubmit(onMove, onClose);
  return (
    <Shell icon={FolderInput} title={`Chuyển ${count} profile sang danh mục`} busy={busy} onClose={onClose} disabled={!target} submitLabel="Chuyển" onSubmit={() => submit(target)}>
      <div role="radiogroup" className="max-h-72 space-y-1 overflow-y-auto">
        {categories.length === 0 && <p className="py-6 text-center text-xs text-[#94A3B8]">Chưa có danh mục khác — hãy tạo danh mục trước.</p>}
        {categories.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={c.key === target}
            onClick={() => setTarget(c.key)}
            className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-xs ${c.key === target ? "border-[#2563EB] bg-[#EFF6FF]" : "border-transparent hover:bg-slate-50"}`}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color || "#94A3B8" }} />
            <span className="min-w-0 flex-1 truncate font-semibold text-[#334155]">{c.name}</span>
            <span className="shrink-0 text-[#94A3B8]">{c.profile_count} profile</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}
