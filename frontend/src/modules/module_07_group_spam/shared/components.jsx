"use client";

import { motion } from "framer-motion";
import { Filter, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CustomSelect from "@/components/ui/custom-select";

export function PageHeader({
  heading,
  desc,
  description,
  button,
  action,
  uppercase = true,
  className = "",
}) {
  const finalDesc = desc ?? description;
  const finalAction = action ?? button;

  return (
    <div className={`flex flex-wrap items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0 flex-1">
        <h1
          className={`font-heading text-2xl font-bold tracking-tight text-slate-800 ${uppercase ? "uppercase" : ""
            }`}
        >
          {heading}
        </h1>
        {finalDesc && <p className="mt-1 text-sm text-slate-400">{finalDesc}</p>}
      </div>
      {finalAction && (
        <div className="shrink-0">
          {typeof finalAction === "object" && "label" in finalAction && !("$$typeof" in finalAction) ? (
            <Button
              type={finalAction.type || "button"}
              variant={finalAction.variant || "default"}
              size={finalAction.size || "sm"}
              disabled={finalAction.disabled}
              onClick={finalAction.onClick}
              className={finalAction.className || ""}
            >
              {finalAction.icon}
              {finalAction.label}
            </Button>
          ) : (
            finalAction
          )}
        </div>
      )}
    </div>
  );
}

const STAT_TONES = {
  primary: {
    title: "text-slate-400",
    iconBox: "bg-blue-50 text-primary",
    badge: "text-primary",
  },
  emerald: {
    title: "text-emerald-600",
    iconBox: "bg-emerald-50 text-emerald-600",
    badge: "text-emerald-600",
  },
  rose: {
    title: "text-rose-500",
    iconBox: "bg-rose-50 text-rose-500",
    badge: "text-rose-500",
  },
};

export function StatCard({
  title,
  value,
  badge,
  desc,
  description,
  icon,
  tone = "primary",
  className = "",
}) {
  const palette = STAT_TONES[tone] || STAT_TONES.primary;
  const finalDesc = desc ?? description;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className="h-full"
    >
      <Card
        className={`group h-full border-slate-200 bg-white p-5 shadow-xs transition-shadow duration-200 hover:border-slate-300 hover:shadow-md ${className} hover:cursor-pointer`}
      >
        <div className="flex items-center justify-between">
          <p className={`text-base font-semibold uppercase tracking-wider ${palette.title}`}>
            {title}
          </p>
          {icon && (
            <motion.span
              whileHover={{ scale: 1.12 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className={`flex size-12 items-center justify-center rounded-lg ${palette.iconBox}`}
            >
              {icon}
            </motion.span>
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-slate-800">{value}</span>
          {badge && <span className={`text-sm font-bold ${palette.badge}`}>{badge}</span>}
        </div>
        {finalDesc && <p className="mt-1 text-xs text-slate-400">{finalDesc}</p>}
      </Card>
    </motion.div>
  );
}

export function SearchFilterCard({
  title = "Tìm kiếm Và bộ lọc",
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Tìm kiếm...",
  fields = [],
  showCustomDate = false,
  fromDate = "",
  onFromDateChange,
  toDate = "",
  onToDateChange,
  onSubmit,
  onReset,
  resetLabel = "Đặt lại",
  className = "",
  children,
}) {
  return (
    <Card className={`border-slate-200/80 bg-white p-5 shadow-xs ${className}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (onSubmit) onSubmit(e);
        }}
        className="space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className=" text-blue-600" size={20} />
            <h2 className="text-base font-semibold text-slate-800 uppercase tracking-wider">{title}</h2>
          </div>
        </div>

        {(onSearchChange || onReset) && (
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            {onSearchChange && (
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchValue}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-10 pl-10 text-sm text-slate-700 placeholder:text-slate-400 focus-visible:ring-1 focus-visible:ring-blue-500"
                />
              </div>
            )}
            {onReset && (
              <Button
                type="button"
                onClick={onReset}
                className="h-10 shrink-0 gap-1.5 bg-blue-600 px-4 text-sm font-semibold text-white shadow-xs hover:bg-blue-700"
              >
                <RotateCcw size={16} />
                {resetLabel}
              </Button>
            )}
          </div>
        )}

        {fields.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {fields.map((field) => (
              <div key={field.key || field.label}>
                {field.label && (
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">
                    {field.label}
                  </label>
                )}
                <CustomSelect
                  value={field.value}
                  onChange={field.onChange}
                  options={field.options || []}
                  buttonClassName="h-10 border-slate-200 bg-white px-3 text-sm text-slate-700"
                  size="lg"
                />
              </div>
            ))}
          </div>
        )}

        {showCustomDate && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
            <span className="text-xs font-semibold text-slate-600">Từ ngày:</span>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => onFromDateChange?.(e.target.value)}
              className="h-8 w-40 text-xs"
            />
            <span className="text-xs font-semibold text-slate-600">Đến ngày:</span>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => onToDateChange?.(e.target.value)}
              className="h-8 w-40 text-xs"
            />
          </div>
        )}

        {children}
      </form>
    </Card>
  );
}

export function SectionCard({ number, title, description, aside, children, className = "" }) {
  return (
    <Card className={`overflow-hidden border-slate-200 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="flex min-w-0 items-start gap-3">
          {number && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {number}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-heading text-base font-bold leading-5 text-slate-800 uppercase">{title}</h3>
            {description && <p className="mt-0.5 text-xs leading-4 text-slate-400">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="px-6 py-5">{children}</div>
    </Card>
  );
}

export function Field({ label, required = false, children, className = "" }) {
  return (
    <div className={`block space-y-1.5 ${className}`}>
      <span className="block text-sm font-semibold text-slate-600">
        {label} {required && <span className="text-slate-400">(bắt buộc)</span>}
      </span>
      {children}
    </div>
  );
}

export function SelectField({ value, onChange, children, className = "", disabled = false, ...props }) {
  return (
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={`h-9 w-full rounded-md border border-input bg-white px-3 text-xs text-slate-700 shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 disabled:opacity-75 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function CheckLabel({ checked, onCheckedChange, children }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      {children}
    </label>
  );
}

export function initialsOf(name = "") {
  return (
    String(name)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "FB"
  );
}

export function normalizeAccount(account, index) {
  const name =
    account.profile_name ||
    account.name ||
    (account.uid ? `Nick FB (${account.uid})` : `Tài khoản ${index + 1}`);

  const rawStatus = account.status ? String(account.status).toUpperCase() : null;
  const status = rawStatus === "LIVE" ? "LIVE" : rawStatus === "DIE" ? "DIE" : rawStatus || "UNKNOWN";

  const subtitle = account.email || account.mail || "Chưa có email";

  return {
    ...account,
    id: account.id ?? index + 1,
    key: String(account.id ?? account.uid ?? index),
    name,
    uid: String(account.uid || "—"),
    status,
    email: subtitle,
  };
}
