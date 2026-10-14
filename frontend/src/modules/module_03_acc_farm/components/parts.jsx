"use client";

import { Copy } from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ACTION_LABELS, ACTION_STATUS, RUN_STATUS } from "../constants";

export function PageTitle({ title, description }) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}

export function SectionCard({ icon: Icon, title, subtitle, action, className, children }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-white p-5 shadow-subtle", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-subtle text-primary">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div>
            <h2 className="text-sm font-bold text-[#1E293B]">{title}</h2>
            {subtitle && <p className="text-[11px] font-medium text-primary">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Ô số nguyên; giữ chuỗi khi đang gõ, chuẩn hóa khi rời ô. */
export function NumberInput({ value, onChange, min = 0, max, disabled, className }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      disabled={disabled}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        let n = parseInt(e.target.value, 10);
        if (Number.isNaN(n)) n = min;
        if (max != null) n = Math.min(n, max);
        onChange(String(Math.max(min, n)));
      }}
      className={cn(
        "h-8 w-14 rounded-md border border-border bg-white px-2 text-center text-xs font-semibold text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50 disabled:text-slate-400",
        className
      )}
    />
  );
}

export function RangeInput({ label, unit, low, high, onLow, onHigh, min = 0, max, disabled }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      {label && <span className="whitespace-nowrap">{label}</span>}
      <NumberInput value={low} onChange={onLow} min={min} max={max} disabled={disabled} />
      <span>-</span>
      <NumberInput value={high} onChange={onHigh} min={min} max={max} disabled={disabled} />
      {unit && <span className="whitespace-nowrap">{unit}</span>}
    </div>
  );
}

export function UidCopy({ uid, className }) {
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(uid).then(() => toast.success(`Đã sao chép UID ${uid}`, "ĐÃ SAO CHÉP"));
      }}
      className={cn("inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-primary hover:underline", className)}
      title="Sao chép UID"
    >
      {uid}
      <Copy className="h-3 w-3" />
    </button>
  );
}

export function RunStatusBadge({ status, className }) {
  const meta = RUN_STATUS[status] || { label: status || "—", badge: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", meta.badge, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

export function ActionChip({ action, status, extra }) {
  const meta = ACTION_STATUS[status] || ACTION_STATUS.PENDING;
  return (
    <span
      title={`${ACTION_LABELS[action] || action}: ${meta.label}`}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", meta.badge)}
    >
      {ACTION_LABELS[action] || action}
      {extra != null && <span className="opacity-80">{extra}</span>}
    </span>
  );
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** host:port của proxy, không lộ user/pass */
export function proxyHost(proxy) {
  if (!proxy) return "";
  const raw = String(proxy).trim();
  const noScheme = raw.replace(/^[a-z]+:\/\//i, "");
  const afterAt = noScheme.includes("@") ? noScheme.split("@").pop() : noScheme;
  const parts = afterAt.split(":");
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : parts[0];
}

export function initials(name, fallback = "?") {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return fallback;
  return ((words[0][0] || "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}
