"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CategoryEditorPopup from "./CategoryEditorPopup";

const categoryColors = ["#2563EB", "#06B6D4", "#10B981", "#84CC16", "#F59E0B", "#F97316", "#EF4444", "#A855F7"];

const categoryInputClass = "h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

export function CategoryDialog({ title, busy, onClose, children, onSubmit }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      className="w-[calc(100%_-_2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-0 font-sans text-xs font-normal text-slate-800 shadow-2xl backdrop:bg-slate-900/50">
      <form onSubmit={onSubmit} className="space-y-5 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button type="button" aria-label="Đóng" disabled={busy} onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        {children}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Hủy bỏ</Button>
          <Button type="submit" disabled={busy} className="gap-2">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {busy ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export function CategoryEditor({ anchor, category, onSave, onClose }) {
  const [name, setName] = useState(category?.name || "");
  const [color, setColor] = useState(category?.color || "#2563EB");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const saving = useRef(false);
  const submit = async event => {
    event.preventDefault();
    if (saving.current) return;
    if (!name.trim()) { setError("Vui lòng nhập tên danh mục."); return; }
    saving.current = true;
    setBusy(true);
    setError(null);
    try { await onSave({ name: name.trim(), color }, category?.id ?? null); }
    catch (err) { setError(err.message); }
    finally { saving.current = false; setBusy(false); }
  };
  return <CategoryEditorPopup anchor={anchor} title={category ? "Sửa danh mục" : "Thêm danh mục"} editing={Boolean(category)} busy={busy} onClose={onClose} onSubmit={submit}>
    <label className="block space-y-1.5 text-xs font-medium">Tên danh mục
      <Input required maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Nhập tên danh mục" className="h-8 rounded-lg px-2.5 text-xs font-normal" />
    </label>
    <fieldset disabled={busy} className="space-y-1.5">
      <legend className="mb-1.5 text-xs font-medium">Màu danh mục</legend>
      <div className="flex items-center justify-between gap-1">
        {categoryColors.map(option => <button key={option} type="button" aria-label={`Màu ${option}`} aria-pressed={color.toUpperCase() === option}
          onClick={() => setColor(option)} style={{ backgroundColor: option }}
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-black/5 text-white outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50">
          {color.toUpperCase() === option && <Check className="h-3.5 w-3.5" />}
        </button>)}
        <label title="Màu tùy chỉnh" className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200" style={!categoryColors.includes(color.toUpperCase()) ? { backgroundColor: color, color: "white" } : undefined}>
          {categoryColors.includes(color.toUpperCase()) ? <Palette className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          <input type="color" aria-label="Màu tùy chỉnh" value={color} onChange={e => setColor(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
        </label>
      </div>
    </fieldset>
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </CategoryEditorPopup>;
}

export function MoveCategoryDialog({ categories, count, busy, onClose, onMove, accountUid, initialCategoryId = null }) {
  const [target, setTarget] = useState(initialCategoryId === null ? "" : String(initialCategoryId));
  return <CategoryDialog title="Chuyển danh mục" busy={busy} onClose={onClose} onSubmit={event => { event.preventDefault(); onMove(target === "" ? null : Number(target)); }}>
    <p className="text-xs font-normal text-slate-500">{accountUid
      ? <>Đổi hoặc gán danh mục cho tài khoản <strong className="font-semibold text-slate-800">{accountUid}</strong>.</>
      : <>Chuyển <strong className="font-semibold text-slate-800">{count}</strong> tài khoản đã chọn vào:</>}</p>
    <label className="block space-y-2 text-xs font-semibold">Danh mục đích
      <select autoFocus value={target} disabled={busy} onChange={e => setTarget(e.target.value)} className={categoryInputClass}>
        <option value="">Chưa gán danh mục</option>
        {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
    </label>
  </CategoryDialog>;
}
