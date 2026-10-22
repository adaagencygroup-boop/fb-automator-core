"use client";
import { useCallback, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { CategoryOptions, categoryLabelStyle } from "./CategorySelect";

export default function AccountCategoryDropdown({ account, categories, disabled, onChange }) {
  const [anchor, setAnchor] = useState(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const close = useCallback(() => { if (!lock.current) setAnchor(null); }, []);
  const category = categories.find(item => item.id === account.category_id);
  const value = account.category_id ?? null;
  const name = category?.name || (value === null ? "Chưa gán" : `Danh mục #${value}`);
  const choose = async id => {
    if (lock.current) return;
    if (id === value) { close(); return; }
    lock.current = true;
    setSaving(true);
    try {
      const success = await onChange(account, id);
      if (success !== false) {
        setAnchor(null);
        anchor?.focus({ preventScroll: true });
      }
    } finally { lock.current = false; setSaving(false); }
  };
  return <>
    <button type="button" title={`${name} — Bấm để đổi danh mục`}
      aria-label={`Đổi danh mục tài khoản ${account.uid}: ${name}`} aria-haspopup="dialog" aria-expanded={Boolean(anchor)}
      disabled={disabled || saving || !onChange} onClick={event => setAnchor(anchor ? null : event.currentTarget)}
      style={categoryLabelStyle(category)}
      className="group/category flex h-6 w-full cursor-pointer items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1 font-sans text-xs font-semibold transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
      <span className="min-w-0 flex-1 truncate text-center">{name}</span>
      {saving ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <ChevronDown className="h-3 w-3 shrink-0 opacity-50 group-hover/category:opacity-100" />}
    </button>
    {anchor && <CategoryOptions anchor={anchor} categories={categories} value={value} busy={saving} onClose={close} onSelect={choose} />}
  </>;
}
