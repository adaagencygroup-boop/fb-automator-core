"use client";

import React from "react";
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FolderInput,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

/** Header trang DS theo Figma */
export function ListPageHeader({ title, subtitle, actionHref, actionLabel }) {
  return (
    <div className="mb-4">
      <h1 className="font-heading text-xl font-bold text-slate-900">{title}</h1>
      <p className="mt-1 text-xs text-slate-500">
        {subtitle}
        {actionHref && actionLabel ? (
          <>
            {" "}
            <Link href={actionHref} className="text-primary hover:underline">
              {actionLabel}
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}

/** Cột trái: danh mục / page */
export function ListSidePanel({
  title,
  totalLabel,
  search,
  onSearchChange,
  searchPlaceholder = "Tìm tên hoặc ID…",
  headerRight,
  children,
}) {
  return (
    <Card className="flex h-full min-h-[520px] w-full flex-col overflow-hidden border-slate-200 shadow-sm lg:w-[280px] lg:shrink-0">
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">{title}</h3>
            {totalLabel ? <p className="mt-0.5 text-[10px] text-slate-400">{totalLabel}</p> : null}
          </div>
          {headerRight}
        </div>
        <div className="relative mt-2.5">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 pl-8 text-[11px]"
          />
        </div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">{children}</div>
    </Card>
  );
}

export function SideListItem({
  active,
  onClick,
  title,
  subtitle,
  badge,
  avatar,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
        active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-slate-50"
      }`}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-semibold text-slate-800">{title}</div>
        {subtitle ? <div className="mt-0.5 truncate text-[10px] text-slate-400">{subtitle}</div> : null}
      </div>
      {badge != null ? (
        <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/** Thanh chọn hàng (Figma: N đang tick · Chuyển danh mục · Xuất) */
export function SelectionBar({ count, onExport, onMoveCategory, moveLabel = "Chuyển danh mục" }) {
  if (!count) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
      <span className="text-[11px] font-semibold text-blue-700">
        {count.toLocaleString("vi-VN")} đang được tick chọn
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {onMoveCategory ? (
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 border-blue-200 bg-white text-[11px]" onClick={onMoveCategory}>
            <FolderInput className="size-3.5" /> {moveLabel}
          </Button>
        ) : null}
        {onExport ? (
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700" onClick={onExport}>
            <Download className="size-3.5" /> Xuất
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ListPagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
      <span className="text-[11px] text-slate-400">
        Hiển thị {total === 0 ? 0 : (page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} của{" "}
        {total.toLocaleString("vi-VN")}
      </span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="icon" className="size-7" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="px-2 text-[11px] font-semibold text-slate-600">
          {page}/{totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function TableLoading({ colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-14 text-center text-slate-400">
        <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
        Đang tải…
      </td>
    </tr>
  );
}

export function TableEmpty({ colSpan, message }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-14 text-center text-slate-400">
        {message}
      </td>
    </tr>
  );
}

export function MasterDetail({ side, children }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      {side}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export { Checkbox };
