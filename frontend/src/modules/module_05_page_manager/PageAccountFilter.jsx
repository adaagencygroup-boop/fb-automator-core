"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Users } from "lucide-react";
import { ALL_ACCOUNTS } from "./pageAccountFilter.mjs";

export default function PageAccountFilter({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const container = useRef(null);
  const trigger = useRef(null);
  const search = useRef(null);
  const selected = options.find((option) => option.value === value);
  const label = selected?.name || "Tất cả tài khoản";
  const keyword = query.trim().toLocaleLowerCase("vi");
  const visible = options.filter((option) => `${option.name} ${option.detail}`.toLocaleLowerCase("vi").includes(keyword));

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event) => {
      if (!container.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const choose = (next) => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div ref={container} className="relative w-full min-w-0 sm:w-[240px] sm:shrink-0" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...container.current.querySelectorAll("[data-account-option]")];
      const index = buttons.indexOf(document.activeElement);
      const next = index < 0 ? (event.key === "ArrowDown" ? 0 : buttons.length - 1)
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
      <button ref={trigger} type="button" aria-label={`Lọc theo tài khoản: ${label}`} aria-expanded={open}
        title={selected ? `${label} · ${selected.detail}` : label}
        onClick={() => { setQuery(""); setOpen((current) => !current); }}
        className="flex h-[34px] w-full items-center gap-2 rounded-lg border border-[#CBD5E1] bg-white px-3 text-xs font-medium text-[#334155] hover:bg-slate-50">
        <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 min-w-0 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)}
            aria-label="Tìm tài khoản theo tên hoặc UID" placeholder="Tìm tên hoặc UID tài khoản…"
            className="mb-1 h-9 w-full min-w-0 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-blue-500" />
          <div className="max-h-64 overflow-y-auto" role="group" aria-label="Tài khoản quản lý Page">
            {[{ value: ALL_ACCOUNTS, name: "Tất cả tài khoản", detail: "" }, ...visible].map((option) => (
              <button key={option.value} data-account-option type="button" aria-pressed={value === option.value}
                onClick={() => choose(option.value)} title={`${option.name} ${option.detail}`}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${value === option.value ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className="block">{option.name}</span>
                  {option.detail && <span className="block text-[10px] text-slate-500">{option.detail}</span>}
                </span>
                {option.count !== undefined && <span className="shrink-0 text-[10px] text-slate-500">{option.count} Page</span>}
                {value === option.value && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
            {visible.length === 0 && <p role="status" className="px-2 py-3 text-xs text-slate-500">Không tìm thấy tài khoản.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export { PageAccountFilter };
