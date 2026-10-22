"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";

export function categoryLabelStyle(category) {
  if (!category) return undefined;
  const color = category.color || "#2563EB";
  return { color, borderColor: `${color}40`, backgroundColor: `${color}0D` };
}

export function CategoryOptions({ anchor, categories, value, busy, onClose, onSelect, includeUnassigned = true, align = "start" }) {
  const popup = useRef(null);
  const search = useRef(null);
  const [query, setQuery] = useState("");
  const [position] = useState(() => {
    const rect = anchor.getBoundingClientRect();
    const gap = 8;
    const width = Math.min(240, window.innerWidth - gap * 2);
    const below = window.innerHeight - rect.bottom - gap * 2;
    const above = rect.top - gap * 2;
    const opensUp = below < 220 && above > below;
    return {
      left: Math.max(gap, Math.min(align === "end" ? rect.right - width : rect.left, window.innerWidth - width - gap)), width,
      maxHeight: Math.min(320, Math.max(80, opensUp ? above : below)),
      ...(opensUp ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
    };
  });
  useEffect(() => {
    search.current?.focus({ preventScroll: true });
    const outside = event => {
      if (!popup.current?.contains(event.target) && !anchor.contains(event.target)) onClose();
    };
    const scroll = event => { if (!popup.current?.contains(event.target)) onClose(); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [anchor, onClose]);
  const options = [{ id: null, name: "Chưa gán danh mục", color: null }, ...categories]
    .filter(category => category.name.toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi")));

  return createPortal(<div ref={popup} role="dialog" aria-label="Chọn danh mục tài khoản" aria-busy={busy}
    className="fixed z-[100000] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 font-sans text-xs text-slate-700 shadow-lg"
    style={position}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== anchor) onClose(); }}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); anchor.focus({ preventScroll: true }); }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || busy) return;
      const buttons = [...popup.current.querySelectorAll("[data-category-option]")];
      if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : current < 0 ? (event.key === "ArrowDown" ? 0 : buttons.length - 1)
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }}>
    <div className="relative mb-1 shrink-0">
      <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
      <input ref={search} aria-label="Tìm danh mục" placeholder="Tìm danh mục…" value={query} disabled={busy}
        onChange={event => setQuery(event.target.value)} className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-xs font-normal outline-none focus:border-blue-500" />
    </div>
    <div className="min-h-0 overflow-y-auto" role="group" aria-label="Danh mục">
      {options.map(category => <button key={category.id ?? "none"} data-category-option type="button"
        disabled={busy} aria-pressed={value === category.id} onClick={() => onSelect(category.id)}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-wait ${value === category.id ? "bg-blue-50" : ""}`}>
        <span title={category.name} style={category.id === null ? undefined : categoryLabelStyle(category)}
          className="min-w-0 flex-1 truncate rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-normal">{category.name}</span>
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {value === category.id && <Check className="h-3.5 w-3.5 text-blue-600" />}
        </span>
      </button>)}
      {!options.length && <p className="p-3 text-xs text-slate-400">Không tìm thấy danh mục.</p>}
    </div>
    {busy && <p role="status" className="flex shrink-0 items-center gap-1.5 px-2 py-2 text-xs text-blue-600"><Loader2 className="h-3.5 w-3.5 animate-spin" />Đang cập nhật…</p>}
  </div>, document.body);
}


export default function CategorySelect({ categories, value, onChange, disabled = false, placeholder = "Chọn danh mục", ariaLabel = "Danh mục tài khoản" }) {
  const [anchor, setAnchor] = useState(null);
  const close = useCallback(() => setAnchor(null), []);
  const selected = categories.find(category => category.id === value);
  return <>
    <button type="button" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={Boolean(anchor)} disabled={disabled}
      onClick={event => setAnchor(anchor ? null : event.currentTarget)}
      style={categoryLabelStyle(selected)}
      className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs font-normal text-slate-700 outline-none hover:brightness-95 focus-visible:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
      <span className="min-w-0 flex-1 truncate text-left">{selected?.name || placeholder}</span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
    </button>
    {anchor && !disabled && <CategoryOptions anchor={anchor} categories={categories} value={value} busy={false} includeUnassigned={false} align="end"
      onClose={close} onSelect={id => { onChange(id); close(); anchor.focus({ preventScroll: true }); }} />}
  </>;
}
