"use client";

import { useCallback, useState } from "react";
import { ChevronDown, Tags, X } from "lucide-react";
import { CategoryOptions, categoryLabelStyle } from "@/modules/module_02_account_manager/components/CategorySelect";

// value: "all" | "uncategorized" | String(category.id), giống bộ lọc danh mục của Module 02
export default function CategoryFilter({ categories, value, onChange, loading, error }) {
  const [anchor, setAnchor] = useState(null);
  const close = useCallback(() => setAnchor(null), []);
  const category = categories.find((item) => String(item.id) === value);
  const label = value === "all"
    ? "Tất cả danh mục"
    : value === "uncategorized" ? "Chưa gán danh mục" : category?.name || `Danh mục #${value}`;
  const disabled = loading || Boolean(error);
  const filtered = value !== "all";

  return (
    <div className="relative sm:w-56">
      <button
        type="button"
        aria-label={`Lọc theo danh mục: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        disabled={disabled}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        title={error ? `Không tải được danh mục: ${error}` : undefined}
        style={categoryLabelStyle(category)}
        className={`flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-slate-50 pl-3 text-xs text-slate-700 hover:brightness-95 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:text-slate-400 ${filtered ? "pr-8" : "pr-3"}`}
      >
        <Tags className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className="min-w-0 flex-1 truncate text-left">
          {error ? "Không tải được danh mục" : loading ? "Đang tải danh mục..." : label}
        </span>
        {!filtered && <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />}
      </button>
      {filtered && (
        <button
          type="button"
          onClick={() => onChange("all")}
          aria-label="Bỏ lọc danh mục"
          title="Bỏ lọc danh mục"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {anchor && !disabled && (
        <CategoryOptions
          anchor={anchor}
          categories={categories}
          value={value === "all" ? undefined : value === "uncategorized" ? null : Number(value)}
          busy={false}
          align="end"
          onClose={close}
          onSelect={(id) => {
            onChange(id === null ? "uncategorized" : String(id));
            close();
            anchor.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}
