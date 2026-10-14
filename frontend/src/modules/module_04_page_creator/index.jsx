"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Hourglass,
  Loader2,
  Pause,
  Play,
  Power,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Pagination from "@/components/ui/pagination";
import { formatVietnamDateTime, parseToVietnamDate } from "@/lib/date-utils";
import { toast } from "@/lib/toast";
import { getAccounts } from "@/modules/module_02_account_manager/service";
import { useLocalSSE } from "@/modules/module_02_account_manager/hooks/useLocalSSE";
import {
  getCreatedPageHistory,
  getCreatorSettings,
  getCreatorTaskStatus,
  pausePageCreation,
  resumePageCreation,
  saveCreatorSetting,
  startPageCreation,
  stopPageCreation,
} from "./service";

const TEMPLATE = [
  "Luna Coffee Premium | 0988888888 | abc@gmail.com | Hoàn Kiếm, Hà Nội",
  "Mộc Spa & Dưỡng Sinh | 0977777777 | mocspa.care@gmail.com | Hoàn Kiếm, Hà Nội",
].join("\n");

const COUNTRIES = [
  { value: "+84", label: "VN (+84) - Việt Nam" },
  { value: "+1", label: "US (+1) - Hoa Kỳ" },
  { value: "+66", label: "TH (+66) - Thái Lan" },
  { value: "+81", label: "JP (+81) - Nhật Bản" },
  { value: "+82", label: "KR (+82) - Hàn Quốc" },
];

const MODELS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Tốc độ cao — Khuyến nghị)" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (Tốc độ cao — Khuyến nghị)" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
];

const fieldClass =
  "h-10 w-full rounded-lg bg-[#EFF4FF] px-3 text-sm text-[#0B1C30] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-[#2563EB]/30";

function splitLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const delimiter = trimmed.includes("|") ? "|" : trimmed.includes(",") ? "," : null;
  const parts = delimiter ? trimmed.split(delimiter).map((part) => part.trim()) : [trimmed];
  return {
    page_name: parts[0] || "",
    phone: parts[1] || "",
    email: parts[2] || "",
    address: parts[3] || "",
  };
}

function parsePageLines(text) {
  return text
    .split(/\r?\n/)
    .map(splitLine)
    .filter((item) => item && item.page_name);
}

function rowIssues(page) {
  const issues = [];
  if (!page.phone) issues.push("Thiếu SĐT");
  if (page.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(page.email)) issues.push("Sai email");
  return issues;
}

function Pill({ tone = "green", children }) {
  const tones = {
    green: "bg-[#ECFDF5] text-[#047857]",
    red: "bg-[#FFF1F2] text-[#BE123C]",
    slate: "bg-[#F1F5F9] text-[#475569]",
    blue: "bg-[#DBE1FF] text-[#1D4ED8]",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone === "green" ? "bg-[#10B981]" : tone === "red" ? "bg-[#F43F5E]" : tone === "blue" ? "bg-[#2563EB]" : "bg-[#94A3B8]"}`} />
      {children}
    </span>
  );
}

function eventOf(log) {
  const extra = log?.extra && typeof log.extra === "object" ? log.extra : {};
  return {
    action: extra.action || "",
    pageName: extra.page_name || "",
    uid: String(extra.uid || log?.uid || ""),
    step: extra.step || "",
    subStage: extra.subStage || "",
    percent: Number(extra.percent) || 0,
    pageUrl: extra.page_url || "",
    time: extra.time || log?.timestamp || "",
  };
}

function splitRuns(events) {
  const runs = [];
  let current = [];
  events.forEach((event) => {
    if (event.action === "claim" && current.length) {
      runs.push(current);
      current = [event];
      return;
    }
    current.push(event);
  });
  if (current.length) runs.push(current);
  return runs;
}

function stateFromRun(run) {
  const latest = run[run.length - 1];
  if (!latest) return "queued";
  if (latest.action === "completed") return "done";
  if (latest.action === "failed") return "error";
  if (latest.action === "step") return "running";
  if (latest.action === "claim") return "claimed";
  return "queued";
}

function buildJobRows(pages, accounts, logs, startMs) {
  const buckets = new Map();
  logs.forEach((log) => {
    const event = eventOf(log);
    if (!["claim", "step", "completed", "failed"].includes(event.action)) return;
    const stamp = Date.parse(event.time);
    if (startMs && Number.isFinite(stamp) && stamp + 5000 < startMs) return;
    const key = `${event.uid}::${event.pageName}`;
    const list = buckets.get(key) || [];
    list.push(event);
    buckets.set(key, list);
  });

  const groups = new Map();
  pages.forEach((page, index) => {
    const key = `${page.uid}::${page.page_name}`;
    const list = groups.get(key) || [];
    list.push(index);
    groups.set(key, list);
  });
  const runByIndex = new Map();
  groups.forEach((indexes, key) => {
    const runs = splitRuns(buckets.get(key) || []);
    const start = Math.max(0, runs.length - indexes.length);
    indexes.forEach((index, offset) => {
      runByIndex.set(index, runs[start + offset] || []);
    });
  });

  return pages.map((page, index) => {
    const key = `${page.uid}::${page.page_name}`;
    const run = runByIndex.get(index) || [];
    const latest = run[run.length - 1];
    const state = stateFromRun(run);
    const account = accounts.find((item) => item.uid === page.uid);
    const percent = latest?.percent || (state === "done" || state === "error" ? 100 : 0);
    return {
      key: `${key}-${index}`,
      index,
      uid: page.uid,
      name: account?.profile_name || "Chưa cập nhật",
      pageName: page.page_name,
      state,
      step: latest?.step || "",
      subStage: latest?.subStage || "",
      percent: Math.max(0, Math.min(100, percent)),
      pageUrl: [...run].reverse().find((event) => event.pageUrl)?.pageUrl || "",
    };
  });
}

function clockLabel(value) {
  if (typeof value === "string" && /^\d{2}:\d{2}:\d{2}/.test(value)) return value.slice(0, 8);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("vi-VN", { hour12: false });
}

function logTone(log) {
  const type = String(log.type || log.extra?.level || "").toLowerCase();
  const message = log.message || "";
  if (type === "error" || type === "failed") return "text-[#BE123C]";
  if (type === "success" || /thành công|hoàn tất/i.test(message)) return "text-[#047857]";
  if (type === "warning") return "text-amber-700";
  if (/khởi tạo|bắt đầu|bốc page/i.test(message)) return "font-semibold text-[#2563EB]";
  return "text-slate-600";
}

function LogLine({ message }) {
  const parts = String(message || "").split(/(https?:\/\/\S+)/g);
  return parts.map((part, index) =>
    part.startsWith("http") ? (
      <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer" className="break-all text-[#047857] underline">
        {part}
      </a>
    ) : (
      <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>
    )
  );
}

const JOB_STATUS = {
  running: { label: "Đang chạy", className: "bg-[#DBE1FF] text-[#1D4ED8]" },
  claimed: { label: "Chờ luồng", className: "bg-[#F1F5F9] text-[#64748B]" },
  queued: { label: "Chờ chạy", className: "bg-[#F1F5F9] text-[#64748B]" },
  done: { label: "Đã chạy", className: "bg-[#ECFDF5] text-[#047857]" },
  error: { label: "Chạy lỗi", className: "bg-[#FFF1F2] text-[#BE123C]" },
  paused: { label: "Tạm dừng", className: "bg-amber-50 text-amber-700" },
};

function RunningScreen({ task, accounts, logs, paused, onPause, onStop }) {
  const logRef = useRef(null);
  const pages = Array.isArray(task?.pages) ? task.pages : [];
  const startMs = Number(task?.start_time) || 0;
  const rows = useMemo(() => buildJobRows(pages, accounts, logs, startMs), [pages, accounts, logs, startMs]);
  const success = rows.filter((row) => row.state === "done").length;
  const failed = rows.filter((row) => row.state === "error").length;
  const active = rows.filter((row) => row.state === "running");
  const waiting = rows.filter((row) => row.state === "claimed");
  const liveRows = active.length ? active : waiting;
  const queued = rows.filter((row) => row.state === "queued" || row.state === "claimed").length;
  const engineLogs = useMemo(
    () => logs.filter((log) => {
      if (!startMs) return true;
      const stamp = Date.parse(log?.extra?.time || log?.timestamp);
      return !Number.isFinite(stamp) || stamp >= startMs - 3000;
    }),
    [logs, startMs]
  );

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [engineLogs.length]);

  return (
    <div className="-m-6 min-h-full space-y-4 bg-[#F8F9FF] p-6">
      <section className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-3">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${paused ? "bg-amber-500" : "bg-[#004AC6]"}`} />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#0B1C30]">{paused ? "Đang tạm dừng" : "Đang tạo Fanpage"}</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-500">
              Quá trình tạo Fanpage đang diễn ra, vui lòng không đóng cửa sổ để tránh ngắt quãng luồng xử lý.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={onPause} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#F8F9FF] px-4 text-sm font-semibold text-[#0B1C30] ring-1 ring-slate-200">
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? "Chạy tiếp" : "Tạm dừng"}
          </button>
          <button type="button" onClick={onStop} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#E11D48] px-4 text-sm font-semibold text-white">
            <Power className="h-4 w-4" />
            Dừng khẩn cấp
          </button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Thành công" icon={<CheckCircle2 className="h-5 w-5 text-[#10B981]" />} iconClass="bg-[#ECFDF5]">
          <span>{success}</span>
          <span className="text-lg font-semibold text-slate-400"> / {rows.length}</span>
        </MetricCard>
        <MetricCard label="Thất bại / lỗi" value={failed} hint="page" icon={<ShieldAlert className="h-5 w-5 text-[#E11D48]" />} iconClass="bg-[#FFF1F2]" valueClass="text-[#BE123C]" />
        <MetricCard label="Đang chạy" value={active.length} hint={paused ? "đang tạm dừng" : "luồng song song"} icon={<RefreshCw className={`h-5 w-5 text-[#2563EB] ${active.length && !paused ? "animate-spin" : ""}`} />} iconClass="bg-[#EEF2FF]" valueClass="text-[#2563EB]" />
        <MetricCard label="Hàng đợi" value={queued} hint="chờ xử lý" icon={<Hourglass className="h-5 w-5 text-slate-500" />} iconClass="bg-[#F1F5F9]" />
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.7fr)]">
        <div className="space-y-4">
          <section className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
            <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
              <div className="flex gap-3">
                <SectionIcon>
                  <ClipboardList className="h-5 w-5" />
                </SectionIcon>
                <div>
                  <h2 className="text-sm font-bold text-[#0B1C30]">Danh sách luồng khởi tạo</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Giám sát phân bổ tài khoản và danh tính page đang chạy.</p>
                </div>
              </div>
              <span className="rounded-full bg-[#F1F5F9] px-3 py-1 text-xs font-semibold text-slate-600">Tổng: {rows.length} page</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-5 py-3">Tài khoản</th>
                    <th className="px-3 py-3">Fanpage mục tiêu</th>
                    <th className="px-3 py-3">Trạng thái</th>
                    <th className="px-5 py-3">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-sm text-slate-500">Chưa nhận được danh sách page của phiên này.</td>
                    </tr>
                  ) : rows.map((row) => {
                    const visual = paused && row.state === "running" ? "paused" : row.state;
                    const badge = JOB_STATUS[visual];
                    return (
                      <tr key={row.key} className="border-t border-slate-100">
                        <td className="px-5 py-3">
                          <p className="font-semibold text-[#0B1C30]">{row.name}</p>
                          <p className="font-mono text-xs text-slate-400">{row.uid}</p>
                        </td>
                        <td className="px-3 py-3 font-medium text-[#0B1C30]">{row.pageName}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {row.pageUrl ? (
                            <a href={row.pageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline">
                              <ExternalLink className="h-3.5 w-3.5" />
                              Mở
                            </a>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
            <div className="mb-4 flex gap-3">
              <SectionIcon>
                <RefreshCw className="h-5 w-5" />
              </SectionIcon>
              <div>
                <h2 className="text-sm font-bold text-[#0B1C30]">Giám sát các luồng thực thi</h2>
                <p className="mt-0.5 text-xs text-slate-500">Quản lý song song môi trường Chromium, proxy và hành vi người dùng.</p>
              </div>
            </div>
            {liveRows.length === 0 ? (
              <p className="rounded-xl bg-[#F8F9FF] px-4 py-6 text-sm text-slate-500">Chưa có luồng nào đang thực thi. Page trong hàng đợi sẽ hiện ở đây khi nick bắt đầu.</p>
            ) : (
              <div className="space-y-3">
                {liveRows.map((row) => {
                  const late = row.percent >= 90;
                  return (
                    <article key={row.key} className="rounded-2xl bg-[#F4F7FF] px-4 py-4">
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white ${row.index % 2 === 0 ? "bg-[#2563EB]" : "bg-[#10B981]"}`}>
                          #{String(row.index + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-bold text-[#0B1C30]">{row.pageName}</h3>
                          <p className="mt-0.5 text-xs text-slate-500">{row.name} (UID: {row.uid})</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                        <p className="min-w-0 truncate text-slate-600">
                          <span className={`mr-1.5 ${late ? "text-[#10B981]" : "text-[#2563EB]"}`}>●</span>
                          {row.step || "Đang khởi tạo luồng xử lý"}
                        </p>
                        {row.subStage ? (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${late ? "bg-[#ECFDF5] text-[#047857]" : "bg-white text-[#2563EB]"}`}>
                            {row.subStage}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                        <div className={`h-full rounded-full ${late ? "bg-[#10B981]" : "bg-[#2563EB]"}`} style={{ width: `${Math.max(row.percent, 8)}%` }} />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)] xl:sticky xl:top-0">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
            <p className="ml-2 text-xs font-semibold text-slate-500">Realtime Automation Engine Log</p>
          </div>
          <div ref={logRef} className="h-[640px] space-y-2 overflow-auto bg-[#F8FAFC] p-4 font-mono text-[11px] leading-5">
            {engineLogs.length === 0 ? (
              <p className="text-slate-400">Đang chờ log từ engine...</p>
            ) : engineLogs.map((log, index) => (
              <p key={`${log.timestamp}-${index}`} className={logTone(log)}>
                <span className="text-slate-400">[{clockLabel(log.extra?.time || log.timestamp)}] </span>
                <LogLine message={log.message} />
              </p>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function MetricCard({ label, value, hint, icon, iconClass, valueClass = "text-[#0B1C30]", children }) {
  return (
    <article className="flex items-center justify-between rounded-2xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <p className={`mt-1 text-3xl font-bold tracking-tight ${valueClass}`}>
          {children ?? value}
        </p>
        {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
      </div>
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconClass}`}>{icon}</span>
    </article>
  );
}

function SectionIcon({ children }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EFF4FF] text-[#2563EB]">
      {children}
    </span>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
        {hint}
      </span>
      {children}
    </label>
  );
}

const HISTORY_PAGE_SIZE = 10;

const HISTORY_STATUS = {
  SUCCESS: { label: "Thành công", className: "bg-[#ECFDF5] text-[#047857]", dot: "bg-[#10B981]" },
  PARTIAL: { label: "Một phần", className: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  FAILED: { label: "Thất bại", className: "bg-[#FFF1F2] text-[#BE123C]", dot: "bg-[#F43F5E]" },
};

const HISTORY_RANGES = [
  { value: "all", label: "Tất cả thời gian" },
  { value: "today", label: "Hôm nay" },
  { value: "7d", label: "7 ngày qua" },
  { value: "30d", label: "30 ngày qua" },
];

const HISTORY_STATUSES = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "SUCCESS", label: "Thành công" },
  { value: "PARTIAL", label: "Một phần" },
  { value: "FAILED", label: "Thất bại" },
];

function historyStatusMeta(status) {
  return HISTORY_STATUS[status] || {
    label: status || "Không rõ",
    className: "bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
  };
}

function vietnamDayKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function matchesHistoryRange(createdAt, range) {
  if (range === "all") return true;
  const date = parseToVietnamDate(createdAt);
  if (!date) return false;
  if (range === "today") return vietnamDayKey(date) === vietnamDayKey(new Date());
  const days = range === "30d" ? 30 : 7;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function exportHistoryCsv(rows) {
  const header = ["STT", "Thời gian", "Tên Fanpage", "Link", "UID tạo", "Admin nhận", "Hạng mục", "Trạng thái", "Chi tiết"];
  const lines = rows.map((row, index) => [
    index + 1,
    formatVietnamDateTime(row.created_at).full,
    row.page_name,
    row.page_url || "",
    row.creator_fb_uid,
    row.shared_admin_uid || "",
    row.page_category || "",
    historyStatusMeta(row.status).label,
    row.log_detail || "",
  ]);
  const csv = `\uFEFF${[header, ...lines].map((cols) => cols.map(csvCell).join(",")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lich_su_tao_fanpage_${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function HistoryView() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [range, setRange] = useState("all");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getCreatedPageHistory();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Không tải được lịch sử");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, range]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!matchesHistoryRange(row.created_at, range)) return false;
      if (!needle) return true;
      const blob = `${row.page_name || ""} ${row.creator_fb_uid || ""} ${row.shared_admin_uid || ""} ${row.page_url || ""}`.toLowerCase();
      return blob.includes(needle);
    });
  }, [rows, query, statusFilter, range]);

  const total = filtered.length;
  const success = filtered.filter((row) => row.status === "SUCCESS").length;
  const failed = filtered.filter((row) => row.status === "FAILED" || row.status === "PARTIAL").length;
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * HISTORY_PAGE_SIZE, safePage * HISTORY_PAGE_SIZE);
  const from = total === 0 ? 0 : (safePage - 1) * HISTORY_PAGE_SIZE + 1;
  const to = Math.min(safePage * HISTORY_PAGE_SIZE, total);

  const exportRows = () => {
    if (!filtered.length) {
      toast.warning("Không có dòng nào để xuất với bộ lọc hiện tại.", "XUẤT BÁO CÁO");
      return;
    }
    exportHistoryCsv(filtered);
    toast.success(`Đã xuất ${filtered.length} dòng.`, "XUẤT BÁO CÁO");
  };

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F8F9FF] p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F172A] sm:text-3xl">Lịch sử tạo Fanpage</h1>
          <p className="mt-1 text-sm text-slate-500">Theo dõi page đã tạo, UID tạo, admin nhận và kết quả từng lần chạy.</p>
        </div>
        <button
          type="button"
          onClick={exportRows}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#2563EB] px-4 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(37,99,235,0.3)] hover:bg-[#1D4ED8]"
        >
          <FileSpreadsheet className="h-4 w-4" />
          Xuất Excel / Báo cáo
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <HistoryMetric
          label="Tổng Fanpage"
          value={loading ? null : total}
          icon={<FileText className="h-5 w-5" />}
          iconClass="bg-[#F1F5F9] text-[#475569]"
        />
        <HistoryMetric
          label="Tạo thành công"
          value={loading ? null : success}
          hint={total ? `${Math.round((success / total) * 100)}%` : "—"}
          icon={<CheckCircle2 className="h-5 w-5" />}
          iconClass="bg-[#ECFDF5] text-[#059669]"
          labelClass="text-[#059669]"
        />
        <HistoryMetric
          label="Thất bại / lỗi"
          value={loading ? null : failed}
          hint={total ? `${Math.round((failed / total) * 100)}%` : "—"}
          icon={<AlertCircle className="h-5 w-5" />}
          iconClass="bg-[#FFF1F2] text-[#E11D48]"
          labelClass="text-[#F43F5E]"
          valueClass="text-[#BE123C]"
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm kiếm tên page, UID..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-[#F8F9FF] pl-9 pr-3 text-sm text-[#0B1C30] outline-none placeholder:text-slate-400 focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          </label>
          <CustomSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={HISTORY_STATUSES}
            size="lg"
            className="w-full lg:w-52"
            prefixIcon={<FilterIcon />}
          />
          <CustomSelect
            value={range}
            onChange={setRange}
            options={HISTORY_RANGES}
            size="lg"
            className="w-full lg:w-44"
          />
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-[#0B1C30] hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Làm mới
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-5 py-12 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải lịch sử...
          </div>
        ) : error ? (
          <div className="px-5 py-12 text-sm text-[#BE123C]">
            {error}
            <button type="button" onClick={load} className="ml-3 font-semibold text-[#2563EB]">
              Thử lại
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left text-sm">
              <thead className="bg-[#F8F9FF] text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-5 py-3">STT / Thời gian</th>
                  <th className="px-3 py-3">Tên Fanpage / Link</th>
                  <th className="px-3 py-3">UID tạo</th>
                  <th className="px-3 py-3">Admin nhận</th>
                  <th className="px-3 py-3">Hạng mục</th>
                  <th className="px-3 py-3">Trạng thái</th>
                  <th className="px-5 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">
                      {rows.length === 0 ? "Chưa có lịch sử tạo Fanpage." : "Không có dòng nào khớp bộ lọc."}
                    </td>
                  </tr>
                ) : pageRows.map((row, index) => {
                  const stamp = formatVietnamDateTime(row.created_at);
                  const meta = historyStatusMeta(row.status);
                  const order = (safePage - 1) * HISTORY_PAGE_SIZE + index + 1;
                  return (
                    <tr key={row.id ?? `${row.page_name}-${order}`} className="border-t border-slate-100 hover:bg-[#F8FAFF]">
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-[#0F172A]">{String(order).padStart(2, "0")}</p>
                        <p className="text-xs text-slate-400">{stamp.date}</p>
                        <p className="font-mono text-[11px] text-slate-400">{stamp.time}</p>
                      </td>
                      <td className="max-w-[240px] px-3 py-3.5">
                        <p className="truncate font-semibold text-[#0F172A]" title={row.page_name}>{row.page_name || "—"}</p>
                        <p className="truncate text-xs text-[#2563EB]" title={row.page_url || ""}>{row.page_url || "Chưa có link"}</p>
                      </td>
                      <td className="px-3 py-3.5 font-mono text-xs text-[#2563EB]">{row.creator_fb_uid || "—"}</td>
                      <td className="px-3 py-3.5 font-mono text-xs text-slate-600">{row.shared_admin_uid || "—"}</td>
                      <td className="px-3 py-3.5 text-slate-600">{row.page_category || "—"}</td>
                      <td className="px-3 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.className}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setDetail(row)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-[#EFF4FF] hover:text-[#2563EB]"
                            title="Xem log"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {row.page_url ? (
                            <a
                              href={row.page_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-[#EFF4FF] hover:text-[#2563EB]"
                              title="Mở Fanpage"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error ? (
          <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Hiển thị {from}–{to} / {total} fanpage
            </p>
            <Pagination currentPage={safePage} totalPages={total === 0 ? 0 : totalPages} onPageChange={setPage} />
          </div>
        ) : null}
      </section>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Chi tiết lần tạo page</DialogTitle>
          </DialogHeader>
          {detail ? <HistoryDetail row={detail} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryMetric({ label, value, hint, icon, iconClass, labelClass = "text-[#94A3B8]", valueClass = "text-[#0F172A]" }) {
  return (
    <article className="flex items-center justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div>
        <p className={`text-xs font-bold uppercase tracking-wider ${labelClass}`}>{label}</p>
        <p className={`mt-1 text-3xl font-extrabold tracking-tight ${valueClass}`}>
          {value == null ? <span className="block h-9 w-16 rounded bg-slate-200/70" /> : value.toLocaleString("vi-VN")}
        </p>
        {hint ? <p className="mt-0.5 text-xs font-semibold text-slate-400">{hint}</p> : null}
      </div>
      <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${iconClass}`}>{icon}</span>
    </article>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path d="M2 3.5h12M4.5 8h7M7 12.5h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function HistoryDetail({ row }) {
  const stamp = formatVietnamDateTime(row.created_at);
  const meta = historyStatusMeta(row.status);
  const fields = [
    ["Thời gian", stamp.full],
    ["Tên Fanpage", row.page_name || "—"],
    ["UID tạo", row.creator_fb_uid || "—"],
    ["Admin nhận", row.shared_admin_uid || "—"],
    ["Hạng mục", row.page_category || "—"],
  ];
  return (
    <div className="space-y-3 text-sm">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.className}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
        {meta.label}
      </span>
      <dl className="space-y-2">
        {fields.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
            <dd className="break-all text-[#0F172A]">{value}</dd>
          </div>
        ))}
      </dl>
      {row.page_url ? (
        <a href={row.page_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[#2563EB] hover:underline">
          <ExternalLink className="h-3.5 w-3.5" />
          Mở Fanpage
        </a>
      ) : null}
      <div className="rounded-xl bg-[#F8F9FF] p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Log</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">{row.log_detail || "Không có log."}</p>
      </div>
    </div>
  );
}

export default function PageCreatorModule({ subPage }) {
  if (subPage === "creator.history") return <HistoryView />;
  return <CreateView />;
}

function CreateView() {
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [pageText, setPageText] = useState("");
  const [inputMode, setInputMode] = useState("paste");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [targetAdminUid, setTargetAdminUid] = useState("");
  const [threads, setThreads] = useState(3);
  const [delayMin, setDelayMin] = useState(45);
  const [delayMax, setDelayMax] = useState(120);
  const [repeatCount, setRepeatCount] = useState(1);
  const [countryCode, setCountryCode] = useState("+84");
  const [geminiKey, setGeminiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [task, setTask] = useState(null);
  const [starting, setStarting] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const fileRef = useRef(null);
  const previewRef = useRef(null);
  const { logs } = useLocalSSE(true);

  const pages = useMemo(() => parsePageLines(pageText), [pageText]);
  const visibleAccounts = accounts.filter((account) => {
    const blob = `${account.uid} ${account.email || ""} ${account.profile_name || ""}`.toLowerCase();
    return blob.includes(search.trim().toLowerCase());
  });
  const allVisibleSelected = visibleAccounts.length > 0 && visibleAccounts.every((account) => selected.includes(account.uid));
  const preview = pages.map((page, index) => {
    const issues = rowIssues(page);
    return {
      ...page,
      stt: String(index + 1).padStart(2, "0"),
      uid: selected.length ? selected[index % selected.length] : "",
      issues,
      ok: issues.length === 0,
    };
  });

  const refreshStatus = useCallback(async () => {
    try {
      const status = await getCreatorTaskStatus();
      setTask(status);
      setRunning(Boolean(status?.running));
      setPaused(Boolean(status?.paused));
    } catch {
      /* engine có thể đang khởi động lại */
    }
  }, []);

  useEffect(() => {
    getAccounts()
      .then((data) => setAccounts(Array.isArray(data) ? data : []))
      .catch((err) => toast.error(err.message || "Không tải được tài khoản", "TẠO PAGE"));
    getCreatorSettings()
      .then((settings) => {
        if (settings?.gemini_api_key) setGeminiKey(settings.gemini_api_key);
        if (settings?.gemini_model) setGeminiModel(settings.gemini_model);
      })
      .catch(() => {});
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(refreshStatus, 2500);
    return () => clearInterval(timer);
  }, [running, refreshStatus]);

  const toggleUid = (uid) => {
    setSelected((current) => (current.includes(uid) ? current.filter((item) => item !== uid) : [...current, uid]));
  };

  const toggleAllVisible = () => {
    const uids = visibleAccounts.map((account) => account.uid);
    setSelected((current) => {
      if (allVisibleSelected) return current.filter((uid) => !uids.includes(uid));
      return [...new Set([...current, ...uids])];
    });
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mau_danh_sach_fanpage.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  const onPickFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const normalized = text
      .split(/\r?\n/)
      .map((line) => {
        const item = splitLine(line);
        if (!item) return "";
        return [item.page_name, item.phone, item.email, item.address].filter(Boolean).join(" | ");
      })
      .filter(Boolean)
      .join("\n");
    setPageText(normalized);
    setUploadedFile({ name: file.name, size: file.size });
    setInputMode("paste");
  };

  const handleTestKey = async () => {
    const key = geminiKey.trim();
    if (key.length < 20) {
      toast.warning("Gemini API key quá ngắn hoặc đang để trống.", "TẠO PAGE");
      return;
    }
    setTestingKey(true);
    try {
      await saveCreatorSetting("gemini_api_key", key);
      toast.success("Đã lưu Gemini API key cho lần tạo page tiếp theo.", "TẠO PAGE");
    } catch (err) {
      toast.error(err.message || "Không lưu được key", "TẠO PAGE");
    } finally {
      setTestingKey(false);
    }
  };

  const handleStart = async () => {
    if (!selected.length) {
      toast.warning("Chọn ít nhất một tài khoản đã import.", "TẠO PAGE");
      return;
    }
    if (!pages.length) {
      toast.warning("Nhập ít nhất một tên page.", "TẠO PAGE");
      return;
    }
    if (!targetAdminUid.trim()) {
      toast.warning("Nhập UID admin sẽ nhận quyền quản trị page.", "TẠO PAGE");
      return;
    }
    const invalid = preview.filter((row) => !row.ok).length;
    if (invalid) {
      toast.warning(`${invalid} dòng thiếu SĐT hoặc sai email. Job vẫn chạy với tên page đã có.`, "TẠO PAGE");
    }
    setStarting(true);
    try {
      if (geminiKey.trim()) await saveCreatorSetting("gemini_api_key", geminiKey.trim());
      if (geminiModel.trim()) await saveCreatorSetting("gemini_model", geminiModel.trim());
      const assigned = pages.map((page, index) => ({
        ...page,
        uid: selected[index % selected.length],
        loop_round: 1,
      }));
      await startPageCreation({
        pages: assigned,
        target_admin_uid: targetAdminUid.trim(),
        threads: Number(threads) || 2,
        delay_min: Number(delayMin) || 0,
        delay_max: Number(delayMax) || 0,
        repeat_count: Number(repeatCount) || 1,
        country_code: countryCode || "+84",
      });
      toast.info(`Đã bắt đầu tạo ${assigned.length} page.`, "TẠO PAGE");
      setTask({
        running: true,
        pages: assigned,
        total_pages: assigned.length,
        threads: Number(threads) || 2,
        start_time: Date.now(),
        paused: false,
      });
      setRunning(true);
      setPaused(false);
      refreshStatus();
    } catch (err) {
      toast.error(err.message || "Không bắt đầu được", "TẠO PAGE");
    } finally {
      setStarting(false);
    }
  };

  const handlePause = async () => {
    try {
      if (paused) {
        await resumePageCreation();
        setPaused(false);
      } else {
        await pausePageCreation();
        setPaused(true);
      }
    } catch (err) {
      toast.error(err.message || "Không đổi được trạng thái", "TẠO PAGE");
    }
  };

  const handleStop = async () => {
    if (!window.confirm("Dừng khẩn cấp sẽ đóng các Chrome đang tạo page. Tiếp tục?")) return;
    try {
      await stopPageCreation();
      setRunning(false);
      setPaused(false);
      toast.info("Đã gửi lệnh dừng.", "TẠO PAGE");
    } catch (err) {
      toast.error(err.message || "Không dừng được", "TẠO PAGE");
    }
  };

  const recentLogs = logs.slice(-30).reverse();

  if (running) {
    return (
      <RunningScreen
        task={task}
        accounts={accounts}
        logs={logs}
        paused={paused}
        onPause={handlePause}
        onStop={handleStop}
      />
    );
  }

  return (
    <div className="-m-6 min-h-full space-y-5 bg-[#F8F9FF] p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#0F172A]">Tạo Fanpage</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Hỗ trợ người dùng tự động hóa quy trình tạo và thiết lập thông tin cho nhiều Fanpage Facebook theo dữ liệu và cấu hình được chuẩn bị trước.
        </p>
      </div>

      <section className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <SectionIcon>
              <Users className="h-5 w-5" />
            </SectionIcon>
            <div>
              <h2 className="text-sm font-bold text-[#0B1C30]">Tài Khoản Facebook Tạo Page</h2>
              <p className="mt-0.5 text-xs text-slate-500">Chọn danh sách nick clone/via đủ trust để thực thi khởi tạo, không định checkpoint.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm UID, Tên nick..."
                className={`${fieldClass} w-full pl-9 sm:w-64`}
              />
            </div>
            <span className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#DBE1FF] px-3 text-xs font-semibold text-[#1D4ED8]">
              <span className="h-2 w-2 rounded-full bg-[#2563EB]" />
              {selected.length} tài khoản đã chọn
            </span>
          </div>
        </div>

        <div className="mt-4 max-h-[320px] overflow-auto rounded-xl border border-[#E7ECF8]">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#EFF4FF] text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Chọn tất cả nick đang hiện" className="accent-[#2563EB]" />
                </th>
                <th className="px-2 py-3">STT</th>
                <th className="px-2 py-3">UID Facebook</th>
                <th className="px-2 py-3">Họ & tên tài khoản</th>
                <th className="px-2 py-3">Trạng thái ĐN</th>
                <th className="px-2 py-3">Trạng thái TK</th>
                <th className="px-2 py-3">Proxy</th>
                <th className="px-2 py-3">Kết nối</th>
              </tr>
            </thead>
            <tbody>
              {visibleAccounts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    {accounts.length === 0 ? "Chưa có tài khoản. Import ở mục Quản lý tài khoản." : "Không tìm thấy nick khớp từ khóa."}
                  </td>
                </tr>
              ) : (
                visibleAccounts.map((account, index) => {
                  const checked = selected.includes(account.uid);
                  return (
                    <tr key={account.uid} className="border-t border-slate-100">
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={checked} onChange={() => toggleUid(account.uid)} aria-label={`Chọn ${account.uid}`} className="accent-[#2563EB]" />
                      </td>
                      <td className="px-2 py-3 text-slate-400">{String(index + 1).padStart(2, "0")}</td>
                      <td className="px-2 py-3 font-mono font-semibold text-[#2563EB]">{account.uid}</td>
                      <td className="px-2 py-3 font-medium text-[#0B1C30]">{account.profile_name || "Chưa cập nhật"}</td>
                      <td className="px-2 py-3">
                        {account.login_status === "logged_in" ? (
                          <Pill>Đã đăng nhập</Pill>
                        ) : account.login_status === "failed" ? (
                          <Pill tone="red">Đăng nhập lỗi</Pill>
                        ) : (
                          <Pill tone="slate">Chưa đăng nhập</Pill>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        {account.status === "live" ? <Pill>Live</Pill> : account.status === "die" ? <Pill tone="red">Die</Pill> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-2 py-3 font-mono text-[11px] text-slate-600">{account.proxy || "—"}</td>
                      <td className="px-2 py-3">{account.login_status === "logged_in" ? <Pill>Ổn</Pill> : <span className="text-slate-400">—</span>}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
        <section className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3">
              <SectionIcon>
                <FileText className="h-5 w-5" />
              </SectionIcon>
              <div>
                <h2 className="text-sm font-bold text-[#0B1C30]">Danh Sách Fanpage Cần Tạo</h2>
                <p className="mt-0.5 text-xs text-slate-500">Nạp danh sách tự định dạng .CSV hoặc .TXT, hoặc dán thủ công.</p>
              </div>
            </div>
            <button type="button" onClick={downloadTemplate} className="shrink-0 text-xs font-semibold text-[#2563EB] hover:underline">
              Tải template mẫu
            </button>
          </div>

          <div className="mt-4 inline-flex rounded-lg bg-[#EFF4FF] p-1 text-xs font-semibold">
            <button type="button" onClick={() => setInputMode("paste")} className={`rounded-md px-3 py-1.5 ${inputMode === "paste" ? "bg-white text-[#0B1C30] shadow-sm" : "text-slate-500"}`}>
              Dán thủ công
            </button>
            <button type="button" onClick={() => { setInputMode("file"); fileRef.current?.click(); }} className={`rounded-md px-3 py-1.5 ${inputMode === "file" ? "bg-white text-[#0B1C30] shadow-sm" : "text-slate-500"}`}>
              Tải tệp lên (.CSV/.TXT)
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/plain,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              onPickFile(file);
              event.target.value = "";
            }}
          />

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Định dạng: <span className="text-[#2563EB]">Tên page</span>
            <span className="mx-1 text-slate-300">|</span>
            <span className="text-[#2563EB]">SĐT</span>
            <span className="mx-1 text-slate-300">|</span>
            <span className="text-[#2563EB]">Email</span>
            <span className="mx-1 text-slate-300">|</span>
            <span className="text-[#2563EB]">Địa chỉ</span>
          </p>
          <textarea
            rows={8}
            value={pageText}
            onChange={(event) => setPageText(event.target.value)}
            placeholder={TEMPLATE}
            className="mt-2 w-full rounded-xl border border-[#C1C6D6] bg-white p-3 font-mono text-sm text-[#0B1C30] outline-none focus:border-[#2563EB]"
          />

          {uploadedFile && (
            <div className="mt-3 flex items-center justify-between rounded-xl bg-[#EFF4FF] px-3 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#DBE1FF] text-[#2563EB]">
                  <FileText className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-[#0B1C30]">{uploadedFile.name}</span>
                  <span className="text-xs text-slate-500">Dung lượng: {(uploadedFile.size / 1024).toFixed(1)} KB</span>
                </span>
              </div>
              <button type="button" onClick={() => setUploadedFile(null)} aria-label="Bỏ tệp đã tải" className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold uppercase tracking-wide text-slate-400">Ký tự phân cách:</span>
            <span className="rounded-lg bg-[#EFF4FF] px-2.5 py-1 font-medium text-[#0B1C30]">dấu gạch đứng — mặc định</span>
            <button
              type="button"
              onClick={() => {
                setPageText("");
                setUploadedFile(null);
              }}
              className="ml-auto font-semibold text-slate-500 hover:text-[#0B1C30]"
            >
              Xóa trắng
            </button>
            <button type="button" onClick={() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="rounded-lg bg-[#2563EB] px-3 py-1.5 font-semibold text-white">
              Xem chi tiết
            </button>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
          <div className="flex gap-3">
            <SectionIcon>
              <Settings2 className="h-5 w-5" />
            </SectionIcon>
            <div>
              <h2 className="text-sm font-bold text-[#0B1C30]">Thiết Lập Job Tự Động</h2>
              <p className="mt-0.5 text-xs text-slate-500">Cấu hình quyền quản trị, luồng xử lý và tham số chiến dịch.</p>
            </div>
          </div>

          <div className="mt-4">
            <Field
              label="Facebook UID nhận quyền Admin"
              hint={<span className="normal-case tracking-normal text-[#2563EB]">Quản trị viên</span>}
            >
              <input value={targetAdminUid} onChange={(event) => setTargetAdminUid(event.target.value)} placeholder="200019844129" className={`${fieldClass} font-mono`} />
            </Field>
            <p className="mt-2 rounded-lg bg-[#ECFDF5] px-3 py-2 text-xs text-[#047857]">
              Nick sẽ tự động nhận toàn quyền kiểm soát (Owner) ngay sau khi tạo xong.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Số luồng chạy">
              <SuffixInput value={threads} onChange={setThreads} min={1} max={10} suffix="Luồng" />
            </Field>
            <Field label="Số vòng lặp">
              <SuffixInput value={repeatCount} onChange={setRepeatCount} min={1} suffix="Vòng" />
            </Field>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <span>Độ trễ mỗi lần tạo page</span>
              <span className="normal-case tracking-normal text-slate-400">Thực thi tuần tự</span>
            </div>
            <p className="mb-2 text-[11px] text-slate-400">Khuyến nghị 3–5 luồng. Delay random giữa các page.</p>
            <div className="grid grid-cols-2 gap-3">
              <SuffixInput value={delayMin} onChange={setDelayMin} min={0} suffix="giây" prefix="Min" />
              <SuffixInput value={delayMax} onChange={setDelayMax} min={0} suffix="giây" prefix="Max" />
            </div>
          </div>

          <div className="mt-4">
            <Field label="Mã quốc gia (Location Code)">
              <select value={countryCode} onChange={(event) => setCountryCode(event.target.value)} className={fieldClass}>
                {COUNTRIES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-[#0B1C30]">
              <Sparkles className="h-4 w-4 text-[#2563EB]" />
              Cấu hình Gemini AI
            </div>
            <Field label="Mô hình sinh nội dung">
              <select value={geminiModel} onChange={(event) => setGeminiModel(event.target.value)} className={fieldClass}>
                {MODELS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </Field>
            <div className="mt-3">
              <Field label="Gemini API key">
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <input
                      type={showKey ? "text" : "password"}
                      value={geminiKey}
                      onChange={(event) => setGeminiKey(event.target.value)}
                      placeholder="Dán API key, hoặc dùng GEMINI_API_KEYS trong môi trường"
                      className={`${fieldClass} pr-10 font-mono`}
                    />
                    <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "Ẩn key" : "Hiện key"} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <button type="button" onClick={handleTestKey} disabled={testingKey} className="inline-flex h-10 shrink-0 items-center rounded-lg bg-[#2563EB] px-3 text-xs font-semibold text-white disabled:opacity-60">
                    {testingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : "Kiểm tra Key"}
                  </button>
                </div>
              </Field>
            </div>
          </div>
        </section>
      </div>

      <section ref={previewRef} className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
        <div className="flex items-center gap-2 bg-[#EFF4FF] px-5 py-3 text-sm font-bold text-[#0B1C30]">
          <ClipboardList className="h-4 w-4 text-[#2563EB]" />
          Đối soát dữ liệu trước khi chạy
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">STT</th>
                <th className="px-3 py-3">UID</th>
                <th className="px-3 py-3">Tên page</th>
                <th className="px-3 py-3">Số điện thoại</th>
                <th className="px-3 py-3">Email</th>
                <th className="px-3 py-3">Địa chỉ</th>
                <th className="px-3 py-3">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {preview.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-sm text-slate-500">Chưa có dòng page hợp lệ. Dán danh sách hoặc tải tệp .CSV/.TXT.</td>
                </tr>
              ) : (
                preview.map((row) => (
                  <tr key={`${row.stt}-${row.page_name}`} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-400">{row.stt}</td>
                    <td className="px-3 py-3 font-mono text-[#2563EB]">{row.uid || "Chưa gán"}</td>
                    <td className="px-3 py-3 font-medium text-[#0B1C30]">{row.page_name}</td>
                    <td className={`px-3 py-3 ${row.phone ? "text-slate-700" : "font-semibold text-[#BE123C]"}`}>{row.phone || "Thiếu SĐT"}</td>
                    <td className="px-3 py-3 text-slate-700">{row.email || "—"}</td>
                    <td className="px-3 py-3 text-slate-700">{row.address || "—"}</td>
                    <td className="px-3 py-3">
                      {row.ok ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-[#047857]"><CheckCircle2 className="h-3.5 w-3.5" /> Hợp lệ</span>
                      ) : (
                        <span className="font-semibold text-[#BE123C]">Lỗi · {row.issues.join(", ")}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            <span className="font-semibold text-[#0B1C30]">{selected.length} Account</span>
            <span className="mx-2">·</span>
            {pages.length} Fanpage
            <span className="mx-2">·</span>
            Đồng thời: {threads || 0} Luồng
            <span className="mx-2">·</span>
            Admin UID: {targetAdminUid.trim() || "—"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleStart}
              disabled={starting || running}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#2563EB] px-5 text-sm font-bold tracking-wide text-white shadow-[0_1px_2px_rgba(37,99,235,0.35)] disabled:opacity-60"
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              BẮT ĐẦU TẠO
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
        <h2 className="mb-3 text-sm font-bold text-[#0B1C30]">Nhật ký vận hành</h2>
        <div className="max-h-48 space-y-1 overflow-auto rounded-xl bg-[#F8F9FF] p-3 font-mono text-xs text-slate-700">
          {recentLogs.length === 0 ? <p>Chưa có log.</p> : recentLogs.map((log, index) => (
            <p key={`${log.timestamp}-${index}`}>
              <span className="text-slate-400">{log.timestamp} </span>
              {log.message}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}

function SuffixInput({ value, onChange, min = 0, max, suffix, prefix }) {
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">{prefix}</span>}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${fieldClass} ${prefix ? "pl-12" : ""} pr-14`}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{suffix}</span>
    </div>
  );
}
