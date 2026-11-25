"use client";

import React, { useCallback } from "react";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toast } from "@/lib/toast";
import { askConfirm } from "./shared/askConfirm";
import { pageWindow, parseJsonField } from "./utils.mjs";

export { pageWindow, parseJsonField };

export function SectionCard({ number, title, description, aside, children }) {
  return (
    <Card className="overflow-hidden border-slate-200 shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
        <div className="flex min-w-0 items-start gap-3">
          {number && (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {number}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-heading text-sm font-bold leading-5 text-slate-800">{title}</h3>
            {description && <p className="mt-0.5 text-[11px] leading-4 text-slate-400">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="px-6 py-5">{children}</div>
    </Card>
  );
}

export function formatLogsForCopy(logs = []) {
  return logs
    .map((log) => {
      const ts = log.timestamp || log.ts || log.time || "";
      const thread = log.thread != null && log.thread !== "" ? ` [${log.thread}]` : "";
      const msg = log.message || log.text || "";
      return ts ? `[${ts}]${thread} ${msg}` : `${thread} ${msg}`.trim();
    })
    .join("\n");
}

export function copyLogsToClipboard(logs = []) {
  if (!logs.length) {
    toast.warning("Chưa có log để sao chép.");
    return;
  }
  const text = formatLogsForCopy(logs);
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast.success(`Đã sao chép ${logs.length} dòng log`))
    .catch(() => toast.error("Không thể sao chép log"));
}

/**
 * Khung log theo thiết kế: "Live Automation Log Console [Thread-01 - <tác vụ>]", chip trạng thái,
 * nút copy dạng icon, nền tối, timestamp + [Thread-01] trước mỗi dòng.
 */
export function LiveLogConsole({ title, task, thread = "Thread-01", logs, phase }) {
  const label = phase === "paused" ? "PAUSED" : phase === "running" ? "RUNNING" : phase === "done" ? "DONE" : "IDLE";
  const color =
    phase === "paused"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
      : phase === "running"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
        : "border-slate-500/30 bg-slate-500/10 text-slate-400";
  const heading = title || `Live Automation Log Console [${thread}${task ? ` - ${task}` : ""}]`;

  const handleCopy = useCallback(() => copyLogsToClipboard(logs), [logs]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0B1220] shadow-md">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex shrink-0 gap-1.5">
            <span className="size-3 rounded-full bg-[#EF4444]" />
            <span className="size-3 rounded-full bg-[#F59E0B]" />
            <span className="size-3 rounded-full bg-[#10B981]" />
          </div>
          <span className="truncate font-mono text-xs font-semibold text-slate-300">{heading}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 font-mono text-[10px] font-bold ${color}`}>
            <span className={`size-1.5 rounded-full ${phase === "running" ? "animate-pulse bg-emerald-400" : phase === "paused" ? "bg-amber-400" : "bg-slate-400"}`} />
            {label}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!logs?.length}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            title="Sao chép toàn bộ log"
            aria-label="Sao chép toàn bộ log"
          >
            <Copy className="size-4" />
          </button>
        </div>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto px-4 py-4 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 ? (
          <p className="text-slate-500">Chờ log phiên…</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 text-slate-300">
              <span className="shrink-0 text-slate-500">[{log.timestamp}]</span>
              <span className="shrink-0 text-[#60A5FA]">[{log.thread || thread}]</span>
              <span
                className={
                  log.type === "success"
                    ? "text-emerald-400"
                    : log.type === "warn"
                      ? "text-amber-300"
                      : log.type === "error"
                        ? "text-rose-400"
                        : "text-slate-200"
                }
              >
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Thanh phân trang dùng chung.
 * variant "chevron": ‹ 1 2 3 … N ›  (ảnh chọn page / followers / bài viết)
 * variant "text":    Trước 1 2 3 Sau (ảnh chọn tài khoản / DS bài viết)
 */
export function Pager({ page, totalPages, onChange, variant = "chevron" }) {
  const total = Math.max(1, Number(totalPages) || 1);
  const current = Math.min(Math.max(1, page), total);
  const edge =
    "flex h-7 min-w-7 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white px-2 text-xs font-semibold text-[#64748B] hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={current <= 1}
        onClick={() => onChange(current - 1)}
        className={edge}
        aria-label="Trang trước"
      >
        {variant === "text" ? "Trước" : <ChevronLeft className="size-3.5" />}
      </button>
      {pageWindow(current, total).map((p, i) =>
        p === "…" ? (
          <span key={`gap_${i}`} className="px-1 text-xs text-[#94A3B8]">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`flex h-7 min-w-7 items-center justify-center rounded-lg px-2 text-xs font-bold ${
              p === current
                ? "bg-[#1877F2] text-white"
                : "border border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F8FAFC]"
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        disabled={current >= total}
        onClick={() => onChange(current + 1)}
        className={edge}
        aria-label="Trang sau"
      >
        {variant === "text" ? "Sau" : <ChevronRight className="size-3.5" />}
      </button>
    </div>
  );
}

/**
 * Xóa có xác nhận + báo đúng kết quả từ server (không nuốt lỗi, không báo thành công giả).
 * Trả về số dòng đã xóa, hoặc null nếu người dùng hủy / API lỗi.
 */
export async function runDelete({ count, noun, request, confirm = true }) {
  if (!count) return null;
  if (confirm) {
    const ok = await askConfirm({
      title: `Xóa ${count.toLocaleString("vi-VN")} ${noun}`,
      description: `Xóa vĩnh viễn ${count.toLocaleString("vi-VN")} ${noun}? Thao tác này không thể hoàn tác.`,
      confirmText: "Xóa",
    });
    if (!ok) return null;
  }
  try {
    const res = await request();
    const deleted = Number(res?.deleted ?? 0);
    if (deleted < count) {
      toast.warning(`Đã xóa ${deleted}/${count} ${noun} — số còn lại không còn trong kho.`);
    } else {
      toast.success(`Đã xóa ${deleted.toLocaleString("vi-VN")} ${noun}.`);
    }
    return deleted;
  } catch (err) {
    toast.error(`Lỗi xóa ${noun}: ${err.message}`);
    return null;
  }
}

export function nowStamp() {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

export const LIVE_STATUSES = new Set(["LIVE", "live", "Live"]);
