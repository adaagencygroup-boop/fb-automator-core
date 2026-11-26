"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toast } from "@/lib/toast";
import { askConfirm } from "./shared/askConfirm";
import { pageWindow, parseJsonField } from "./utils.mjs";
import { useActionLock } from "./shared/useActionLock";

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
      const msg = log.message || log.text || "";
      return ts ? `[${ts}] ${msg}` : msg.trim();
    })
    .join("\n");
}

/** Sao chép log; trả về promise để nút chờ sao chép xong (cùng key: bấm nhiều lần không xếp chồng thông báo). */
export async function copyLogsToClipboard(logs = []) {
  if (!logs.length) {
    toast.warning("Chưa có log để sao chép.", { key: "m11-copy-log" });
    return;
  }
  const text = formatLogsForCopy(logs);
  try {
    await navigator.clipboard?.writeText(text);
    toast.success(`Đã sao chép ${logs.length} dòng log`, { key: "m11-copy-log" });
  } catch {
    toast.error("Không thể sao chép log", { key: "m11-copy-log" });
  }
}

const AUTO_SCROLL_THRESHOLD_PX = 28;

function isNearBottom(el) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= AUTO_SCROLL_THRESHOLD_PX;
}

/**
 * Khung log theo thiết kế: "Live Automation Log Console [Thread-01 - <tác vụ>]", chip trạng thái,
 * nút copy dạng icon, nền tối, timestamp + [Thread-01] trước mỗi dòng.
 * Smart auto-scroll: mặc định tự cuộn tới dòng mới nhất; khi người dùng kéo lên đọc log cũ
 * sẽ tạm dừng auto-scroll và hiện nút "Mới nhất" để nhảy về cuối.
 */
// Màu nhãn luồng trên nền tối: Thread-01 giữ màu xanh cũ, mỗi luồng sau một màu; nhãn không có số (vd "Phiên") màu xám
const THREAD_COLORS = ["#60A5FA", "#F472B6", "#34D399", "#FBBF24", "#A78BFA", "#22D3EE", "#FB923C", "#A3E635"];
export function threadColor(label) {
  const n = Number(String(label || "").match(/(\d+)/)?.[1]);
  return Number.isFinite(n) && n > 0 ? THREAD_COLORS[(n - 1) % THREAD_COLORS.length] : "#94A3B8";
}

export function LiveLogConsole({ title, task, thread = "Thread-01", logs, phase }) {
  const list = Array.isArray(logs) ? logs : [];
  const lastLogId = list.length ? list[list.length - 1]?.id ?? list[list.length - 1]?.message : null;
  const label =
    phase === "paused"
      ? "TẠM DỪNG"
      : phase === "running"
        ? "ĐANG CHẠY"
        : phase === "done"
          ? "HOÀN TẤT"
          : "CHỜ CHẠY";
  const color =
    phase === "paused"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
      : phase === "running"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
        : "border-slate-500/30 bg-slate-500/10 text-slate-400";
  const heading = title || (task ? `Nhật ký quét — ${task}` : "Nhật ký quét");

  const [isCopying, guardCopy] = useActionLock();
  const handleCopy = useCallback(() => guardCopy(() => copyLogsToClipboard(list)), [guardCopy, list]);

  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const [showJumpLatest, setShowJumpLatest] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = isNearBottom(el);
    stickToBottomRef.current = atBottom;
    setShowJumpLatest(!atBottom && list.length > 0);
  }, [list.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (list.length === 0) {
      stickToBottomRef.current = true;
      setShowJumpLatest(false);
      return;
    }
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJumpLatest(false);
    }
  }, [list.length, lastLogId]);

  const handleJumpLatest = useCallback(() => {
    const el = scrollRef.current;
    stickToBottomRef.current = true;
    setShowJumpLatest(false);
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

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
            disabled={!list.length || isCopying}
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            title="Sao chép toàn bộ log"
            aria-label="Sao chép toàn bộ log"
          >
            <Copy className="size-4" />
          </button>
        </div>
      </div>
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-64 space-y-2 overflow-y-auto px-4 py-4 font-mono text-[11px] leading-relaxed"
        >
          {list.length === 0 ? (
            <p className="text-slate-500">Chờ tiến trình quét…</p>
          ) : (
            list.map((log) => (
              <div key={log.id} className="flex items-start gap-2 text-slate-300">
                <span className="shrink-0 text-slate-500">[{log.timestamp}]</span>
                <span className="shrink-0" style={{ color: threadColor(log.thread || thread) }}>
                  [{log.thread || thread}]
                </span>
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
        {showJumpLatest && (
          <button
            type="button"
            onClick={handleJumpLatest}
            className="absolute bottom-3 right-4 inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/95 px-2.5 py-1 font-mono text-[10px] font-semibold text-sky-300 shadow-lg backdrop-blur transition hover:border-sky-500/60 hover:bg-slate-800 hover:text-white"
            aria-label="Cuộn tới log mới nhất"
          >
            <ArrowDown className="size-3" />
            Mới nhất
          </button>
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

/**
 * Báo kết quả xuất file CSV/Excel thống nhất toàn Module 11:
 * - "saved"      → chỉ báo thành công sau khi người dùng đã chọn nơi lưu và bấm Save.
 * - "cancelled"  → báo đã huỷ (không báo thành công giả).
 * - "downloaded" → trình duyệt không hỗ trợ hộp thoại lưu → báo dạng thông tin.
 */
export function notifyExportResult(result, { successMessage, key } = {}) {
  if (!result) return;
  if (result.status === "saved") {
    toast.success(successMessage || `Đã xuất file "${result.fileName}" thành công.`, {
      title: "XUẤT FILE THÀNH CÔNG",
      key,
    });
  } else if (result.status === "cancelled") {
    toast.info("Đã huỷ xuất file.", { title: "XUẤT FILE", key });
  } else {
    toast.info(`Đã gửi file "${result.fileName}" cho trình duyệt — kiểm tra thư mục Tải xuống.`, {
      title: "XUẤT FILE",
      key,
    });
  }
}

export const LIVE_STATUSES = new Set(["LIVE", "live", "Live"]);
