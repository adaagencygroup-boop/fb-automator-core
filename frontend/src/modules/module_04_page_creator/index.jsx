"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  CircleCheck,
  FileSpreadsheet,
  Info,
  RefreshCw,
  Search,
  Star,
  TriangleAlert,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Play,
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
import { getAccountsPage } from "@/modules/module_02_account_manager/service";
import { useLocalSSE } from "@/modules/module_02_account_manager/hooks/useLocalSSE";
import { attachDragSelection } from "@/modules/module_02_account_manager/utils/drag-selection.mjs";
import {
  getCreatedPageHistory,
  getCreatorSettings,
  getCreatorTaskStatus,
  pausePageCreation,
  resumePageCreation,
  saveCreatorSetting,
  startPageCreation,
  stopPageCreation,
  testCreatorGeminiKey,
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
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash (Tốc độ cao — Khuyến nghị)" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
];

const DELIMITERS = [
  { value: "|", symbol: "|", label: "(Gạch đứng - Mặc định)" },
  { value: ",", symbol: ",", label: "(Dấu phẩy)" },
  { value: "	", symbol: "Tab", label: "(Ký tự Tab)" },
  { value: ";", symbol: ";", label: "(Chấm phẩy)" },
];

/** Đoán ký tự phân cách của 1 dòng (dùng khi nạp tệp). Dấu phẩy xét cuối vì địa chỉ hay chứa dấu phẩy */
function guessDelimiter(line) {
  return ["|", "	", ";", ","].find((item) => line.includes(item)) || null;
}

/** forced: ký tự phân cách người dùng chọn; bỏ trống thì tự đoán (dùng khi nạp tệp) */
function splitLine(line, forced) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const delimiter = forced || guessDelimiter(trimmed);
  const parts = delimiter ? trimmed.split(delimiter).map((part) => part.trim()) : [trimmed];
  return {
    page_name: parts[0] || "",
    phone: parts[1] || "",
    email: parts[2] || "",
    address: parts[3] || "",
  };
}

function parsePageLines(text, delimiter) {
  return text
    .split(/\r?\n/)
    .map((line) => splitLine(line, delimiter))
    .filter((item) => item && item.page_name);
}

function rowIssues(page) {
  const issues = [];
  if (!page.phone) issues.push("Thiếu SĐT");
  if (page.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(page.email)) issues.push("Sai email");
  return issues;
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
  if (type === "error" || type === "failed") return "font-medium text-[#BA1A1A]";
  if (type === "success" || /thành công|hoàn tất/i.test(message)) return "font-semibold text-[#4EDEA3]";
  if (type === "warning") return "font-medium text-amber-700";
  if (/khởi tạo|bắt đầu|bốc page/i.test(message)) return "font-medium text-[#1B45A3]";
  if (/bypass|captcha|token/i.test(message)) return "font-medium text-[#456E89]";
  return "font-medium text-[#33353D]";
}

function LogLine({ message }) {
  const parts = String(message || "").split(/(https?:\/\/\S+)/g);
  return parts.map((part, index) =>
    part.startsWith("http") ? (
      <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer" className="break-all underline">
        {part}
      </a>
    ) : (
      <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>
    )
  );
}

const JOB_STATUS = {
  running: { label: "Đang chạy", className: "bg-[#DBE1FF] text-[#004AC6]", icon: "status_running" },
  claimed: { label: "Chờ luồng", className: "bg-[#E5EEFF] text-[#565E74]", dot: true },
  queued: { label: "Chờ chạy", className: "bg-[#E5EEFF] text-[#565E74]", dot: true },
  done: { label: "Đã chạy", className: "bg-[#D1FAE5] text-[#065F46]", icon: "status_done" },
  error: { label: "Chạy lỗi", className: "bg-[#FFDAD6] text-[#93000A]", icon: "status_error" },
  paused: { label: "Tạm dừng", className: "bg-amber-50 text-amber-700", dot: true },
};

const RUN_CARD = "rounded-xl bg-white shadow-[0_1px_4px_rgba(15,23,42,0.04)]";

/** Màn "Đang tạo Fanpage" — theo Figma node 1020:11714 */
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
    <div className={`${PAGE_FONT} -m-6 flex min-h-full flex-col gap-6 bg-[#F8F9FF] p-4 sm:p-6`}>
      <section className={`${RUN_CARD} flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between`}>
        <div className="flex max-w-[581px] flex-col gap-1">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${paused ? "bg-amber-500" : "bg-[#004AC6]"}`} />
            <h1 className="text-2xl leading-8 font-bold tracking-[-0.6px] text-[#0B1C30]">{paused ? "Đang tạm dừng" : "Đang tạo Fanpage"}</h1>
          </div>
          <p className="text-sm leading-[22px] text-[#6B5D5D]">
            Quá trình tạo Fanpage đang diễn ra, vui lòng không đóng cửa sổ để tránh ngắt quãng luồng xử lý.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPause}
            className="flex h-9 items-center gap-2 rounded-lg bg-[#EFF4FF] px-4 text-sm leading-5 font-medium text-[#0B1C30] shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-[#E5EEFF]"
          >
            {paused ? <Play aria-hidden="true" className="size-3.5" /> : <CreatorIcon name="run_pause" />}
            {paused ? "Chạy tiếp" : "Tạm dừng"}
          </button>
          <button
            type="button"
            onClick={onStop}
            className="flex h-9 items-center gap-2 rounded-lg bg-[#BA1A1A] px-4 text-sm leading-5 font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-[#A11616]"
          >
            <CreatorIcon name="run_stop" />
            Dừng khẩn cấp
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Thành công" value={success} suffix={`/ ${rows.length}`} suffixClass="text-base leading-6" icon="kpi_success" iconClass="bg-[#EFF4FF] text-[#059669]" />
        <MetricCard label="Thất bại / lỗi" value={failed} suffix="tài khoản" icon="kpi_failed" iconClass="bg-[#FFDAD6] text-[#BA1A1A]" valueClass="text-[#BA1A1A]" />
        <MetricCard
          label="Đang chạy"
          value={active.length}
          suffix={paused ? "đang tạm dừng" : "luồng song song"}
          icon="kpi_running"
          iconClass={`bg-[#DBE1FF] text-[#004AC6] ${active.length && !paused ? "[&>span]:animate-spin" : ""}`}
          valueClass="text-[#2563EB]"
        />
        <MetricCard label="Hàng đợi" value={queued} suffix="chờ xử lý" icon="kpi_queue" iconClass="bg-[#DAE2FD] text-[#565E74]" />
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,573fr)_minmax(320px,352fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className={`${RUN_CARD} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-3 p-6">
              <RunHeading icon="run_list" title="Danh sách luồng khởi tạo" subtitle="Giám sát phân bổ tài khoản & danh tính" />
              <span className="rounded-md bg-[#E5EEFF] px-2.5 py-1 text-[11px] leading-[14px] font-medium tracking-[0.33px] text-[#434655]">
                Tổng: {rows.length} tài khoản
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] border-collapse text-left">
                <thead className="bg-[#EFF4FF] text-[11px] leading-[14px] font-bold tracking-[0.55px] whitespace-nowrap text-[#565E74] uppercase">
                  <tr className="h-[52px]">
                    <th className="pr-4 pl-6">Tài khoản</th>
                    <th className="px-4">Fanpage mục tiêu</th>
                    <th className="w-[1%] px-4 text-center">Trạng thái</th>
                    <th className="w-[1%] pr-6 pl-4 text-right">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-sm text-[#434655]">Chưa nhận được danh sách page của phiên này.</td>
                    </tr>
                  ) : rows.map((row) => {
                    const visual = paused && row.state === "running" ? "paused" : row.state;
                    const badge = JOB_STATUS[visual];
                    return (
                      <tr key={row.key} className="even:bg-[rgba(248,249,255,0.5)]">
                        <td className="py-3.5 pr-4 pl-6">
                          <p className="text-base leading-6 font-semibold text-[#0B1C30]">{row.name}</p>
                          <p className="text-[11px] leading-[14px] font-bold tracking-[0.33px] text-[#434655]">{row.uid}</p>
                        </td>
                        <td className="px-4 py-3.5 text-[13px] leading-5 font-medium text-[#0B1C30]">{row.pageName}</td>
                        <td className="px-4 py-3.5 text-center">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] leading-[14px] font-semibold tracking-[0.33px] whitespace-nowrap ${badge.className}`}>
                            {badge.icon ? <CreatorIcon name={badge.icon} /> : <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-3.5 pr-6 pl-4 text-right">
                          {row.pageUrl ? (
                            <a
                              href={row.pageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md bg-[#EFF4FF] px-2.5 py-1 text-[11px] leading-[14px] font-semibold tracking-[0.33px] text-[#004AC6] shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-[#E5EEFF]"
                            >
                              <CreatorIcon name="open_link" />
                              Mở
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${RUN_CARD} flex flex-col gap-4 border border-[rgba(193,198,214,0.21)] p-6`}>
            <RunHeading icon="run_monitor" title="Giám sát các luồng thực thi" subtitle="Quản lý song song môi trường Chromium Headless, Proxy và hành vi người dùng" />
            {liveRows.length === 0 ? (
              <p className="rounded-xl bg-[#EFF4FF] px-4 py-6 text-sm text-[#434655]">
                Chưa có luồng nào đang thực thi. Page trong hàng đợi sẽ hiện ở đây khi nick bắt đầu.
              </p>
            ) : (
              <div className="flex flex-col gap-4 pt-1">
                {liveRows.map((row) => {
                  const late = row.percent >= 90;
                  return (
                    <article key={row.key} className="flex flex-col gap-3 rounded-xl bg-[#EFF4FF] p-4">
                      <div className="flex items-center gap-3">
                        <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] leading-[14px] font-bold tracking-[0.33px] text-white ${late ? "bg-[#059669]" : "bg-[#2563EB]"}`}>
                          #{String(row.index + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-base leading-6 font-bold text-[#0B1C30]">{row.pageName}</h3>
                          <p className="flex items-center gap-1 text-[11px] leading-[14px] font-semibold tracking-[0.33px] text-[#434655]">
                            <CreatorIcon name="user" />
                            <span className="truncate">{row.name} (UID: {row.uid})</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 pt-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className={`flex min-w-0 items-center gap-1.5 text-[11px] leading-[14px] font-medium tracking-[0.33px] ${late ? "text-[#047857]" : "text-[#2563EB]"}`}>
                            <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${late ? "bg-[#059669]" : "bg-[#2563EB]"}`} />
                            <span className="truncate">{row.step || "Đang khởi tạo luồng xử lý"}</span>
                          </p>
                          {row.subStage ? (
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-[14px] font-bold tracking-[0.33px] text-[#565E74] ${late ? "bg-[#D1FAE5]" : "bg-[#E5EEFF]"}`}>
                              {row.subStage}
                            </span>
                          ) : null}
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-[#DCE9FF]">
                          <div className={`h-full rounded-full ${late ? "bg-[#10B981]" : "bg-[#2563EB]"}`} style={{ width: `${Math.max(row.percent, 8)}%` }} />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-[rgba(65,71,84,0.2)] bg-[#F8F9FF] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] xl:sticky xl:top-0 xl:h-[calc(100vh-140px)] xl:max-h-[951px]">
          <div className="flex items-center gap-2 border-b border-[rgba(65,71,84,0.2)] bg-[#EFF4FF] p-2">
            <span className="flex items-center gap-1.5" aria-hidden="true">
              <span className="size-2.5 rounded-full bg-[#FFB4AB]" />
              <span className="size-2.5 rounded-full bg-[#FEBC2E]" />
              <span className="size-2.5 rounded-full bg-[#4EDEA3]" />
            </span>
            <p className="flex items-center gap-1 pl-1 text-xs leading-4 font-semibold tracking-[0.3px] text-[#33353D]">
              <CreatorIcon name="terminal" className="text-[#7BD0FF]" />
              Realtime Automation Engine Log
            </p>
          </div>
          <div ref={logRef} className={`flex-1 space-y-1.5 overflow-auto p-4 text-xs leading-[19.5px] tracking-[0.24px] text-[#32343D] ${SCROLLBAR}`}>
            {engineLogs.length === 0 ? (
              <p className="text-[#737686]">Đang chờ log từ engine...</p>
            ) : engineLogs.map((log, index) => (
              <p key={`${log.timestamp}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
                <span className="text-[#32343D]">[{clockLabel(log.extra?.time || log.timestamp)}]</span>
                <span className={logTone(log)}>
                  <LogLine message={log.message} />
                </span>
              </p>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function MetricCard({ label, value, suffix, suffixClass = "text-xs leading-4", icon, iconClass, valueClass = "text-[#0B1C30]" }) {
  return (
    <article className="flex items-start justify-between gap-3 rounded-xl bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-[7px] pt-[7px]">
        <p className="text-[11px] leading-[14px] font-semibold tracking-[0.55px] text-[#565E74] uppercase">{label}</p>
        <p className="flex items-baseline gap-1.5">
          <span className={`text-[32px] leading-10 font-bold tracking-[-0.48px] ${valueClass}`}>{value}</span>
          {suffix ? <span className={`font-medium text-[#434655] ${suffixClass}`}>{suffix}</span> : null}
        </p>
      </div>
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${iconClass}`}>
        <CreatorIcon name={icon} />
      </span>
    </article>
  );
}

/** Tiêu đề card ở màn đang chạy: icon 32px + tiêu đề 16px đậm + mô tả */
function RunHeading({ icon, title, subtitle }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#EFF4FF] text-[#004AC6]">
        <CreatorIcon name={icon} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-base leading-6 font-bold text-[#0B1C30]">{title}</h2>
        <p className="max-w-[344px] text-xs leading-4 text-[#434655]">{subtitle}</p>
      </div>
    </div>
  );
}

const HISTORY_PAGE_SIZE = 10;

const HISTORY_STATUS = {
  SUCCESS: { label: "Thành công", className: "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]", dot: "bg-[#10B981]" },
  PARTIAL: { label: "Một phần", className: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  FAILED: { label: "Thất bại", className: "border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C]", dot: "bg-[#F43F5E]" },
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
    className: "border-slate-200 bg-slate-100 text-slate-600",
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

  const exportRows = () => {
    if (!filtered.length) {
      toast.warning("Không có dòng nào để xuất với bộ lọc hiện tại.", "XUẤT BÁO CÁO");
      return;
    }
    exportHistoryCsv(filtered);
    toast.success(`Đã xuất ${filtered.length} dòng.`, "XUẤT BÁO CÁO");
  };

  return (
    <div className={`${PAGE_FONT} -m-6 flex min-h-full flex-col gap-5 bg-[#F8F9FF] p-4 sm:p-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="pt-1 text-2xl leading-8 font-bold tracking-[-0.6px] text-[#0F172A]">Lịch sử tạo Fanpage</h1>
          <p className="text-sm leading-5 text-[#475569]">
            Danh sách và trạng thái chi tiết các Fanpage đã được khởi tạo tự động qua hệ thống phân tán.
          </p>
        </div>
        <button
          type="button"
          onClick={exportRows}
          className="flex h-8 shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-[#2563EB] px-4 text-xs leading-4 font-semibold text-white shadow-[0_1px_2px_rgba(59,130,246,0.2)] hover:bg-[#1D4ED8] sm:self-auto"
        >
          <FileSpreadsheet aria-hidden="true" className="size-4" />
          Xuất Excel (.csv)
        </button>
          </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <HistoryMetric label="Tổng Fanpage" value={loading ? null : total} icon={Star} iconClass="border-[#DBEAFE] bg-[#EFF6FF] text-[#2563EB]" />
        <HistoryMetric label="Tạo thành công" value={loading ? null : success} icon={CircleCheck} iconClass="border-[#D1FAE5] bg-[#ECFDF5] text-[#059669]" valueClass="text-[#059669]" />
        <HistoryMetric label="Thất bại / lỗi" value={loading ? null : failed} icon={TriangleAlert} iconClass="border-[#FFE4E6] bg-[#FFF1F2] text-[#E11D48]" valueClass="text-[#E11D48]" />
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-[#E2E8F0] bg-white p-4 lg:flex-row lg:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Tìm kiếm lịch sử</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#475569]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm theo tên Page, Creator UID, Admin UID..."
            className="h-[34px] w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pr-3 pl-9 text-xs text-[#0F172A] outline-none placeholder:text-[#475569] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
          />
            </label>
        <div className="flex gap-3">
          <CustomSelect
            value={statusFilter}
            onChange={setStatusFilter}
            options={HISTORY_STATUSES}
            className="min-w-0 flex-1 lg:w-[143px] lg:flex-none"
            buttonClassName={FILTER_SELECT}
          />
          <CustomSelect
            value={range}
            onChange={setRange}
            options={HISTORY_RANGES}
            className="min-w-0 flex-1 lg:w-[143px] lg:flex-none"
            buttonClassName={FILTER_SELECT}
          />
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            aria-label="Làm mới"
            title="Làm mới"
            className="grid h-[34px] w-[65px] shrink-0 place-items-center rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] text-[#475569] hover:bg-white disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-12 text-sm text-[#475569]">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải lịch sử...
          </div>
        ) : error ? (
          <div className="px-5 py-12 text-sm text-[#BE123C]">
            {error}
            <button type="button" onClick={() => load()} className="ml-3 font-semibold text-[#2563EB]">
              Thử lại
            </button>
          </div>
        ) : (
          <div className={`overflow-x-auto ${SCROLLBAR}`}>
            <table className="w-full min-w-[760px] border-collapse text-left text-xs leading-4">
              <thead className="border-b border-[#E2E8F0] bg-[rgba(248,250,252,0.8)] text-[11px] leading-4 font-bold tracking-[0.55px] whitespace-nowrap text-[#475569] uppercase">
                <tr className="h-[46px]">
                  <th className="pr-4 pl-6">Tên Fanpage</th>
                  <th className="w-[140px] px-4">Creator UID</th>
                  <th className="w-[140px] px-4">Admin UID</th>
                  <th className="w-[1%] px-4">Trạng thái</th>
                  <th className="w-[1%] pr-6 pl-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-sm text-[#475569]">
                      {rows.length === 0 ? "Chưa có lịch sử tạo Fanpage." : "Không có dòng nào khớp bộ lọc."}
                    </td>
                  </tr>
                ) : pageRows.map((row, index) => {
                  const meta = historyStatusMeta(row.status);
                  const failedRow = row.status === "FAILED";
                  const order = (safePage - 1) * HISTORY_PAGE_SIZE + index + 1;
                  return (
                    <tr
                      key={row.id ?? `${row.page_name}-${order}`}
                      className={`border-t border-[#F1F5F9] first:border-t-0 ${failedRow ? "bg-[rgba(255,241,242,0.2)]" : "hover:bg-[#F8FAFF]"}`}
                    >
                      <td className="py-3.5 pr-4 pl-6">
                        <div className="flex items-center gap-3">
                          <PageAvatar name={row.page_name} failed={failedRow} />
                          <div className="min-w-0">
                            <p className="truncate font-bold text-[#0F172A]" title={row.page_name}>{row.page_name || "—"}</p>
                            {failedRow ? (
                              <p className="line-clamp-2 max-w-[260px] text-[11px] font-medium text-[#E11D48]" title={row.log_detail || ""}>
                                Lỗi: {row.log_detail || "Không rõ nguyên nhân"}
                              </p>
                            ) : row.page_url ? (
                              <a href={row.page_url} target="_blank" rel="noreferrer" className="block max-w-[260px] truncate text-[11px] font-medium text-[#2563EB] hover:underline" title={row.page_url}>
                                {shortUrl(row.page_url)}
                              </a>
                            ) : (
                              <p className="text-[11px] font-medium text-[#94A3B8]">Chưa có link</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-[#475569]">{row.creator_fb_uid || "—"}</td>
                      <td className="px-4 py-3.5 text-[#475569]">{row.shared_admin_uid || "—"}</td>
                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-4 font-bold whitespace-nowrap ${meta.className}`}>
                          <span aria-hidden="true" className={`size-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="py-3.5 pr-6 pl-4">
                        <div className="flex items-center justify-end gap-1">
                          {row.page_url ? (
                            <a
                              href={row.page_url}
                              target="_blank"
                              rel="noreferrer"
                              className="grid size-6 place-items-center rounded text-[#475569] hover:bg-[#EFF4FF] hover:text-[#2563EB]"
                              title="Mở Fanpage"
                              aria-label={`Mở Fanpage ${row.page_name || ""}`}
                            >
                              <ExternalLink aria-hidden="true" className="size-4" />
                            </a>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setDetail(row)}
                            className="grid size-6 place-items-center rounded text-[#475569] hover:bg-[#EFF4FF] hover:text-[#2563EB]"
                            title="Xem log"
                            aria-label={`Xem log ${row.page_name || ""}`}
                          >
                            <Info aria-hidden="true" className="size-4" />
                          </button>
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
          <div className="flex flex-col gap-3 border-t border-[#E2E8F0] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-3 text-xs leading-4 font-medium text-[#475569]">
              <span>
                Đang hiển thị <b className="font-bold text-[#0F172A]">{pageRows.length}/</b> <b className="font-bold text-[#0F172A]">{total}</b> kết quả
              </span>
              <span aria-hidden="true" className="text-[#CBD5E1]">|</span>
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

const FILTER_SELECT = "!h-[34px] !rounded-lg !border-[#E2E8F0] !bg-[#F8FAFC] !px-3 !text-xs !font-medium !text-[#334155] !shadow-none";

/** "https://www.facebook.com/abc" -> "facebook.com/abc" */
function shortUrl(url) {
  return String(url).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

const AVATAR_TONES = [
  "border-[#BFDBFE] bg-[#DBEAFE] text-[#2563EB]",
  "border-[#FBCFE8] bg-[#FCE7F3] text-[#DB2777]",
  "border-[#FDE68A] bg-[#FEF3C7] text-[#B45309]",
  "border-[#99F6E4] bg-[#CCFBF1] text-[#0F766E]",
  "border-[#E9D5FF] bg-[#F3E8FF] text-[#7C3AED]",
];

/** Ô vuông đầu dòng: chữ cái đầu tên page, màu cố định theo tên (dòng lỗi luôn màu đỏ) */
function PageAvatar({ name, failed }) {
  const text = String(name || "?").trim();
  const tone = failed
    ? "border-[#FECDD3] bg-[#FFE4E6] text-[#E11D48]"
    : AVATAR_TONES[[...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-lg border text-xs font-bold uppercase ${tone}`}>
      {[...text][0] || "?"}
    </span>
  );
}

function HistoryMetric({ label, value, icon: Icon, iconClass, valueClass = "text-[#0F172A]" }) {
  return (
    <article className="flex items-start justify-between gap-3 rounded-xl border border-[rgba(226,232,240,0.9)] bg-white p-5">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] leading-[16.5px] font-bold tracking-[0.55px] text-[#475569] uppercase">{label}</p>
        <p className={`text-[30px] leading-9 font-extrabold tracking-[-0.75px] ${valueClass}`}>
          {value == null ? <span className="block h-9 w-16 rounded bg-slate-200/70" /> : value.toLocaleString("en-US")}
        </p>
      </div>
      <span className={`grid size-10 shrink-0 place-items-center rounded-lg border ${iconClass}`}>
        <Icon aria-hidden="true" className="size-5" />
      </span>
    </article>
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
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  // Tải tài khoản theo trang khi cuộn (API /api/accounts/page, 10 dòng/lần, tìm kiếm phía server)
  const [pageInfo, setPageInfo] = useState({ nextCursor: null, hasMore: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  // Mọi tài khoản đã tải (kể cả trang trước / kết quả tìm kiếm cũ) để màn đang chạy vẫn biết tên nick đã chọn
  const [knownAccounts, setKnownAccounts] = useState({});
  const accountRequestId = useRef(0);
  const sentinelRef = useRef(null);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debouncedSearchRef = useRef("");
  const [pageText, setPageText] = useState("");
  const [inputMode, setInputMode] = useState("paste");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [delimiter, setDelimiter] = useState("|");
  const [targetAdminUid, setTargetAdminUid] = useState("");
  const [threads, setThreads] = useState(3);
  const [delayMin, setDelayMin] = useState(45);
  const [delayMax, setDelayMax] = useState(120);
  const [repeatCount, setRepeatCount] = useState(1);
  const [countryCode, setCountryCode] = useState("+84");
  const [geminiKey, setGeminiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [geminiModel, setGeminiModel] = useState("gemini-3.8-flash");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [task, setTask] = useState(null);
  const [starting, setStarting] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const fileRef = useRef(null);
  const previewRef = useRef(null);
  const { logs } = useLocalSSE(true);

  const pages = useMemo(() => parsePageLines(pageText, delimiter), [pageText, delimiter]);
  const visibleAccounts = accounts;
  // Kéo chuột chọn nhiều dòng (dùng chung logic với bảng Quản lý tài khoản)
  const accountScrollRef = useRef(null);
  const visibleAccountsRef = useRef(visibleAccounts);
  const selectedRef = useRef(selected);
  useLayoutEffect(() => {
    visibleAccountsRef.current = visibleAccounts;
    selectedRef.current = selected;
  });
  useEffect(() => {
    if (!accountScrollRef.current) return undefined;
    return attachDragSelection(accountScrollRef.current, {
      getVisibleUids: () => visibleAccountsRef.current.map((account) => account.uid),
      getAvailableUids: () => [...new Set([...selectedRef.current, ...visibleAccountsRef.current.map((account) => account.uid)])],
      getSelectedUids: () => selectedRef.current,
      onSelectionChange: (uids) => {
        selectedRef.current = uids;
        setSelected(uids);
      },
      disabled: accountsLoading || Boolean(accountsError),
    });
  }, [accountsLoading, accountsError]);
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

  // cursor = null: tải lại từ đầu (lần đầu / đổi từ khóa); có cursor: tải thêm khi cuộn
  const fetchAccountsPage = useCallback(async (cursor, query) => {
    const id = ++accountRequestId.current;
    const first = cursor == null;
    // Trang đầu: trạng thái "đang tải" do nơi gọi bật (bộ hẹn giờ tìm kiếm / nút Thử lại)
    if (!first) {
      setLoadingMore(true);
      setMoreError("");
    }
    try {
      const result = await getAccountsPage({ cursor: cursor ?? undefined, search: query });
      if (id !== accountRequestId.current) return; // đã có yêu cầu mới hơn (vd. gõ từ khóa khác)
      const rows = Array.isArray(result?.accounts) ? result.accounts : [];
      setAccounts((current) => (first ? rows : [...current, ...rows.filter((row) => !current.some((item) => item.uid === row.uid))]));
      setKnownAccounts((current) => ({ ...current, ...Object.fromEntries(rows.map((row) => [row.uid, row])) }));
      setPageInfo({ nextCursor: result?.next_cursor ?? null, hasMore: Boolean(result?.has_more) });
      if (first) {
        setAccountsError("");
        setMoreError("");
      }
    } catch (err) {
      if (id !== accountRequestId.current) return;
      if (first) setAccountsError(err.message || "Không tải được tài khoản");
      else setMoreError(err.message || "Không tải thêm được tài khoản");
    } finally {
      if (id === accountRequestId.current) {
        setAccountsLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const loadAccounts = () => {
    setAccountsLoading(true);
    setAccountsError("");
    fetchAccountsPage(null, debouncedSearch);
  };

  // Chờ 300ms sau khi gõ rồi mới tìm trên server
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.trim();
      if (next === debouncedSearchRef.current) return;
      debouncedSearchRef.current = next;
      // Đổi từ khóa: hiện skeleton trong lúc tìm
      setAccountsLoading(true);
      setAccountsError("");
      setDebouncedSearch(next);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Tải trang đầu khi vào trang / đổi từ khóa
  useEffect(() => {
    fetchAccountsPage(null, debouncedSearch);
  }, [debouncedSearch, fetchAccountsPage]);

  // Cuộn gần đáy bảng thì tải thêm
  useEffect(() => {
    const node = sentinelRef.current;
    const root = accountScrollRef.current;
    if (!node || !root || !pageInfo.hasMore || accountsLoading || loadingMore || moreError) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) fetchAccountsPage(pageInfo.nextCursor, debouncedSearch);
    }, { root, rootMargin: "160px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [pageInfo, accountsLoading, loadingMore, moreError, debouncedSearch, fetchAccountsPage]);

  useEffect(() => {
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
    // Tệp đã được chuẩn hóa về " | " nên đặt lại ký tự phân cách tương ứng
    setDelimiter("|");
    setPageText(normalized);
    setUploadedFile({ name: file.name, size: file.size });
  };

  const copyUid = (uid) => {
    navigator.clipboard?.writeText(uid).then(
      () => toast.success(`Đã sao chép UID ${uid}`, "TẠO PAGE"),
      () => toast.error("Trình duyệt chặn quyền sao chép.", "TẠO PAGE")
    );
  };

  const handleTestKey = async () => {
    const key = geminiKey.trim();
    if (key.length < 20) {
      toast.warning("Gemini API key quá ngắn hoặc đang để trống.", "TẠO PAGE");
      return;
    }
    setTestingKey(true);
    try {
      const result = await testCreatorGeminiKey({
        api_key: key,
        model_name: geminiModel,
      });
      toast.success(result.message || "Gemini key dùng được.", "TẠO PAGE");
    } catch (err) {
      toast.error(err.message || "Key không dùng được.", "TẠO PAGE");
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

  if (running) {
    return (
      <RunningScreen
        task={task}
        accounts={Object.values(knownAccounts)}
        logs={logs}
        paused={paused}
        onPause={handlePause}
        onStop={handleStop}
      />
    );
  }

  const validCount = preview.filter((row) => row.ok).length;

  return (
    <div className={`${PAGE_FONT} -m-6 flex min-h-full flex-col gap-4 bg-[#F8F9FF] px-4 pt-4 sm:gap-6 sm:px-6 sm:pt-6`}>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl leading-7 font-bold sm:text-2xl sm:leading-8 tracking-[-0.6px] text-[#0B1C30]">Tạo Fanpage</h1>
        <p className="max-w-[835px] text-sm leading-5 text-[#434655]">
          Hỗ trợ người dùng tự động hóa quy trình tạo và thiết lập thông tin cho nhiều Fanpage Facebook theo dữ liệu và cấu hình được chuẩn bị trước
        </p>
      </div>

      {/* SECTION 1: Tài khoản Facebook tạo page */}
      <section className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5">
          <SectionHeading
            className="flex-1 basis-[300px]"
            icon="accounts"
            title="Tài Khoản Facebook Tạo Page"
            subtitle="Chọn danh sách nick clone/via đủ độ trust để thực thi khởi tạo không dính checkpoint"
          />
          {/* Không dùng breakpoint: tự xuống dòng theo độ rộng khối (sidebar mở/đóng làm vùng nội dung đổi rộng) */}
          <div className="flex max-w-full min-w-0 items-center gap-3">
            <label className="relative block w-72 min-w-0 shrink">
              <span className="sr-only">Tìm tài khoản</span>
              <CreatorIcon name="search" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[#434655]" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm UID, Tên nick..."
                className="h-10 w-full rounded-lg bg-[#EFF4FF] pr-3 pl-9 text-sm text-[#0B1C30] outline-none placeholder:text-[#737686] focus:ring-2 focus:ring-[#2563EB]/30"
              />
            </label>
            <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#DBE1FF] px-3.5 text-sm leading-5 font-semibold text-[#00174B]">
              <span aria-hidden="true" className="size-2 rounded-full bg-[#2563EB]" />
              {selected.length} tài khoản đã chọn
            </span>
          </div>
        </div>

        <div ref={accountScrollRef} className={`max-h-[319px] overflow-auto rounded-xl pr-1 select-none ${SCROLLBAR}`}>
          <table aria-busy={accountsLoading} className="w-full min-w-[860px] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-[#EFF4FF]">
              <tr className="h-[52px]">
                <th className="w-12 px-4">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    disabled={accountsLoading || !visibleAccounts.length}
                    aria-label="Chọn tất cả nick đang hiện"
                    className={CHECKBOX}
                  />
                </th>
                <th className={`${TABLE_HEAD} w-16 px-3`}>STT</th>
                <th className={`${TABLE_HEAD} px-4`}>UID Facebook</th>
                <th className={`${TABLE_HEAD} px-4`}>Họ &amp; tên tài khoản</th>
                <th className={`${TABLE_HEAD} px-4`}>Trạng thái ĐN</th>
                <th className={`${TABLE_HEAD} px-4`}>Trạng thái TK</th>
                <th className={`${TABLE_HEAD} px-4`}>Proxy gắn kèm</th>
              </tr>
            </thead>
            <tbody>
              {accountsLoading ? (
                // Skeleton trong lúc tải tài khoản (logic giống bảng Quản lý tài khoản)
                Array.from({ length: 4 }, (_, index) => (
                  <tr key={`skeleton-${index}`} aria-hidden="true" className="h-[62px] border-t border-[#E5EEFF] first:border-t-0 motion-safe:animate-pulse">
                    <td className="px-4"><div className="size-4 rounded-[2.5px] bg-slate-200/70" /></td>
                    <td className="px-3"><div className="h-3 w-5 rounded bg-slate-200/70" /></td>
                    <td className="px-4"><div className="h-3.5 w-28 rounded bg-slate-200/70" /></td>
                    <td className="px-4"><div className="h-4 w-32 rounded bg-slate-200/70" /></td>
                    <td className="px-4"><div className="h-[22px] w-[104px] rounded-md bg-slate-200/70" /></td>
                    <td className="px-4"><div className="h-[18px] w-10 rounded-full bg-slate-200/70" /></td>
                    <td className="px-4"><div className="h-3 w-28 rounded bg-slate-200/70" /></td>
                  </tr>
                ))
              ) : accountsError ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center">
                    <p role="alert" className="text-sm text-[#BE123C]">Không thể tải tài khoản: {accountsError}</p>
                    <button type="button" onClick={() => loadAccounts()} className="mt-3 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8]">
                      Thử lại
                    </button>
                  </td>
                </tr>
              ) : visibleAccounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-[#434655]">
                    {debouncedSearch ? "Không tìm thấy nick khớp từ khóa." : "Chưa có tài khoản. Import ở mục Quản lý tài khoản."}
                  </td>
                </tr>
              ) : (
                visibleAccounts.map((account, index) => {
                  const checked = selected.includes(account.uid);
                  return (
                    <tr
                      key={account.uid}
                      data-account-uid={account.uid}
                      aria-selected={checked}
                      onClick={() => toggleUid(account.uid)}
                      className={`h-[62px] cursor-pointer border-t border-[#E5EEFF] first:border-t-0 hover:bg-[#F8F9FF] ${checked ? "bg-[#F8FAFF]" : ""}`}
                    >
                      <td className="px-4" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleUid(account.uid)}
                          aria-label={`Chọn ${account.uid}`}
                          className={CHECKBOX}
                        />
                      </td>
                      <td className="px-3 text-sm text-[#434655]">{String(index + 1).padStart(2, "0")}</td>
                      <td className="px-4">
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm leading-5 font-bold text-[#2563EB]">{account.uid}</span>
                          <button
                            type="button"
                            aria-label={`Sao chép UID ${account.uid}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              copyUid(account.uid);
                            }}
                            className="rounded p-0.5 text-[#434655] hover:text-[#2563EB]"
                          >
                            <CreatorIcon name="copy" />
                          </button>
                        </span>
                      </td>
                      <td className="max-w-[220px] truncate px-4 text-base leading-6 font-semibold text-[#0B1C30]">
                        {account.profile_name || "Chưa cập nhật"}
                      </td>
                      <td className="px-4">
                        <LoginBadge status={account.login_status} />
                      </td>
                      <td className="px-4">
                        <LiveBadge status={account.status} />
                      </td>
                      <td className="px-4 text-xs text-[#434655]">{account.proxy || "—"}</td>
                    </tr>
                  );
                })
              )}
              {!accountsLoading && !accountsError && pageInfo.hasMore && !loadingMore && !moreError && (
                <tr ref={sentinelRef} aria-hidden="true">
                  <td colSpan={7} className="h-px p-0" />
                </tr>
              )}
              {loadingMore && (
                <tr aria-hidden="true" className="h-[62px] border-t border-[#E5EEFF] motion-safe:animate-pulse">
                  <td className="px-4"><div className="size-4 rounded-[2.5px] bg-slate-200/70" /></td>
                  <td className="px-3"><div className="h-3 w-5 rounded bg-slate-200/70" /></td>
                  <td className="px-4"><div className="h-3.5 w-28 rounded bg-slate-200/70" /></td>
                  <td className="px-4"><div className="h-4 w-32 rounded bg-slate-200/70" /></td>
                  <td className="px-4"><div className="h-[22px] w-[104px] rounded-md bg-slate-200/70" /></td>
                  <td className="px-4"><div className="h-[18px] w-10 rounded-full bg-slate-200/70" /></td>
                  <td className="px-4"><div className="h-3 w-28 rounded bg-slate-200/70" /></td>
                </tr>
              )}
              {moreError && (
                <tr className="border-t border-[#E5EEFF]">
                  <td colSpan={7} className="px-4 py-3 text-center text-xs text-[#BE123C]">
                    {moreError}
                    <button
                      type="button"
                      onClick={() => fetchAccountsPage(pageInfo.nextCursor, debouncedSearch)}
                      className="ml-3 font-semibold text-[#2563EB] hover:underline"
                    >
                      Thử lại
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* SECTION 2: danh sách page (7 cột) + thiết lập job (5 cột) */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:items-stretch">
        <section className={`${PANEL} flex flex-col gap-5`}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <SectionHeading
              className="flex-1 basis-[300px]"
              icon="page_list"
              title="Danh Sách Fanpage Cần Tạo"
              subtitle="Nạp danh sách từ tệp định dạng .CSV hoặc .TXT hoặc dán thủ công"
            />
            <button
              type="button"
              onClick={downloadTemplate}
              className="flex shrink-0 items-center gap-1 text-sm leading-4 font-semibold text-[#004AC6] hover:underline"
            >
              <CreatorIcon name="download" />
              Tải template mẫu
            </button>
          </div>

          <div role="tablist" aria-label="Cách nhập danh sách" className="flex w-full items-center rounded-xl bg-[#EFF4FF] p-1 sm:w-fit">
            {[
              { id: "paste", label: "Dán thủ công", icon: "paste" },
              { id: "file", label: "Tải tệp lên (.CSV/.TXT)", icon: "upload" },
            ].map(({ id, label, icon }) => {
              const active = inputMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setInputMode(id)}
                  className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs leading-4 whitespace-nowrap sm:flex-none sm:px-4 ${
                    active ? "bg-white font-semibold text-[#004AC6] shadow-[0_1px_2px_rgba(0,0,0,0.05)]" : "font-medium text-[#434655] hover:text-[#0B1C30]"
                  }`}
                >
                  <CreatorIcon name={icon} />
                  {label}
                </button>
              );
            })}
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

          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] leading-4 font-semibold tracking-[0.55px] uppercase">
            <span className="w-[75px] text-[#1E2430]">Định dạng:</span>
            <span className="text-[#2563EB]">Tên page | SĐT | Email | Địa chỉ</span>
          </p>

          {inputMode === "paste" && (
            <textarea
              value={pageText}
              onChange={(event) => setPageText(event.target.value)}
              aria-label="Danh sách Fanpage cần tạo"
              spellCheck={false}
              placeholder={TEMPLATE}
              className="min-h-64 w-full flex-1 resize-none sm:min-h-[356px] rounded-xl border border-[#C1C6D6] bg-white px-2 pt-2 pb-3.5 text-xs leading-[19.5px] font-medium tracking-[0.24px] text-[#161C27] shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] outline-none placeholder:text-[#737686] focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
            />
          )}

          {inputMode === "file" && !uploadedFile && (
            <UploadDropzone onPick={() => fileRef.current?.click()} onDropFile={onPickFile} />
          )}

          {uploadedFile && (
            <div className="flex items-center justify-between gap-4 rounded-xl bg-[#EFF4FF] py-4 pr-1 pl-4">
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="grid h-12 w-[29px] shrink-0 place-items-center rounded-xl bg-[#DBE1FF] text-[#004AC6] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                  <CreatorIcon name="file" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-base leading-6 font-semibold tracking-[-0.4px] text-[#0B1C30]">{uploadedFile.name}</p>
                  <p className="pt-0.5 text-xs leading-4 text-[#434655]">
                    Dung lượng: <span className="font-bold text-[#0B1C30]">{(uploadedFile.size / 1024).toFixed(1)} KB</span>
                  </p>
          </div>
              </div>
              <button
                type="button"
                onClick={() => setUploadedFile(null)}
                aria-label="Bỏ tệp đã tải"
                className="rounded-lg p-1.5 text-[#434655] hover:bg-white hover:text-[#0B1C30]"
              >
                <CreatorIcon name="close" />
              </button>
            </div>
          )}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex w-full items-center gap-2.5 sm:w-auto">
              <span className="shrink-0 text-[11px] leading-[14px] font-semibold tracking-[0.55px] whitespace-nowrap text-[#434655] uppercase">Ký tự phân cách:</span>
              <DelimiterSelect value={delimiter} onChange={setDelimiter} />
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto [&>button]:flex-1 [&>button]:justify-center sm:[&>button]:flex-none">
              <button
                type="button"
                onClick={() => {
                  setPageText("");
                  setUploadedFile(null);
                }}
                disabled={!pageText && !uploadedFile}
                className="flex h-9 items-center gap-1 rounded-lg bg-[#EFF4FF] px-3 text-[11px] leading-[14px] font-medium tracking-[0.33px] text-[#434655] hover:text-[#0B1C30] disabled:opacity-50"
              >
                <CreatorIcon name="clear" />
                Xóa trắng
              </button>
              <button
                type="button"
                onClick={() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="flex h-9 items-center gap-1 rounded-lg bg-[#DBE1FF] px-3.5 text-[11px] leading-[14px] font-semibold tracking-[0.33px] text-[#004AC6] hover:bg-[#CCD6FF]"
              >
                <CreatorIcon name="eye" />
                Xem chi tiết
              </button>
            </div>
          </div>
        </section>

        <section className={`${PANEL} flex flex-col gap-5`}>
          <SectionHeading
            icon="job_settings"
            title="Thiết Lập Job Tự Động"
            subtitle="Cấu hình quyền quản trị, luồng xử lý và tham số chống quét"
          />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="creator-admin-uid" className="text-sm leading-5 font-semibold text-[#0B1C30]">Facebook UID Nhận Quyền Admin</label>
              <span className="text-[11px] leading-[14px] tracking-[0.33px] text-[#004AC6]">Quản trị viên</span>
            </div>
            <label htmlFor="creator-admin-uid" className={SOFT_INPUT}>
              <CreatorIcon name="admin_uid" className="mr-1 text-[#004AC6]" />
              <input
                id="creator-admin-uid"
                name="creator-admin-uid"
                inputMode="numeric"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={targetAdminUid}
                onChange={(event) => setTargetAdminUid(event.target.value)}
                placeholder="Nhập UID Facebook"
                className="w-full min-w-0 bg-transparent text-base font-semibold text-[#0B1C30] outline-none placeholder:font-normal placeholder:text-[#737686]"
              />
            </label>
            <p className="flex items-center gap-1.5 rounded-lg bg-[#ECFDF5] px-2.5 py-1.5 text-xs leading-[18px] text-[#047857]">
              <CreatorIcon name="shield_check" />
              Nick sẽ tự động nhận toàn quyền kiểm soát (Owner) ngay sau khi tạo xong.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="creator-threads" className={FIELD_LABEL}>Số Luồng Chạy</label>
              <SuffixInput id="creator-threads" value={threads} onChange={setThreads} min={1} max={10} suffix="Luồng" bold />
              <p className={FIELD_HINT}>Khuyên dùng 3-5 luồng</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="creator-loops" className={FIELD_LABEL}>Số Vòng Lặp</label>
              <SuffixInput id="creator-loops" value={repeatCount} onChange={setRepeatCount} min={1} suffix="Vòng" bold />
              <p className={FIELD_HINT}>Thực thi tuần tự</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <span className={FIELD_LABEL}>Độ Trễ Mỗi Lần Tạo Page (Delay Random)</span>
              <span className="shrink-0 text-[11px] leading-[14px] font-bold tracking-[0.33px] whitespace-nowrap text-[#004AC6]">
                {delayMin || 0}s - {delayMax || 0}s
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <SuffixInput id="creator-delay-min" value={delayMin} onChange={setDelayMin} min={0} prefix="Min:" suffix="giây" />
              <SuffixInput id="creator-delay-max" value={delayMax} onChange={setDelayMax} min={0} prefix="Max:" suffix="giây" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>Mã Quốc Gia (Location Code)</span>
            <CustomSelect
              value={countryCode}
              onChange={setCountryCode}
              options={COUNTRIES}
              size="lg"
              buttonClassName="!h-10 !rounded-lg !border-transparent !bg-[#EFF4FF] !text-sm !font-medium !shadow-none"
            />
          </div>

          <div className="flex flex-col gap-3 rounded-xl bg-[#EFF4FF] p-4">
            <h3 className="flex items-center gap-2 text-base leading-6 font-semibold text-[#0B1C30]">
              <CreatorIcon name="gemini" className="text-[#2563EB]" />
              Cấu hình Gemini AI
            </h3>
            <div className="flex flex-col gap-1">
              <span className={GEMINI_LABEL}>Mô hình sinh nội dung</span>
              <CustomSelect
                value={geminiModel}
                onChange={setGeminiModel}
                options={MODELS}
                buttonClassName="!h-9 !rounded-lg !border-transparent !bg-white !pl-4 !text-xs !font-semibold !shadow-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="creator-gemini-key" className={GEMINI_LABEL}>Gemini API Key</label>
              <div className="flex gap-2">
                <label htmlFor="creator-gemini-key" className={`${SOFT_INPUT} !h-9 min-w-0 flex-1 !bg-white`}>
                  <CreatorIcon name="key" className="text-[#434655]" />
                  <input
                    id="creator-gemini-key"
                    type={showKey ? "text" : "password"}
                    value={geminiKey}
                    onChange={(event) => setGeminiKey(event.target.value)}
                    placeholder="Dán API key hoặc dùng GEMINI_API_KEYS"
                    autoComplete="new-password"
                    spellCheck={false}
                    className="w-full min-w-0 bg-transparent text-xs tracking-[1.2px] text-[#0B1C30] outline-none placeholder:tracking-normal placeholder:text-[#737686]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((value) => !value)}
                    aria-label={showKey ? "Ẩn key" : "Hiện key"}
                    className="shrink-0 text-[#737686] hover:text-[#0B1C30]"
                  >
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </label>
                <button
                  type="button"
                  onClick={handleTestKey}
                  disabled={testingKey}
                  className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-[#2563EB] px-3 text-[11px] leading-[14px] font-semibold tracking-[0.33px] text-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-[#1D4ED8] disabled:opacity-60"
                >
                  {testingKey ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : <CreatorIcon name="check_key" />}
                  Kiểm tra Key
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Đối soát dữ liệu trước khi chạy */}
      <section
        ref={previewRef}
        aria-label="Đối soát dữ liệu trước khi chạy"
        className="scroll-mt-6 overflow-hidden rounded-lg bg-white"
      >
        <div className={`max-h-[420px] overflow-auto ${SCROLLBAR}`}>
          <table className="w-full min-w-[860px] border-collapse text-left text-xs leading-[18px] text-[#252629]">
            <thead className="sticky top-0 z-10 bg-[#EFF4FF]">
              <tr className="h-[52px]">
                <th className={`${PREVIEW_HEAD} w-[31px] pl-16 text-center`}>STT</th>
                <th className={`${PREVIEW_HEAD} w-[104px]`}>UID</th>
                <th className={`${PREVIEW_HEAD} w-[115px]`}>Tên page</th>
                <th className={`${PREVIEW_HEAD} w-[98px]`}>Số điện thoại</th>
                <th className={`${PREVIEW_HEAD} w-[144px]`}>Email</th>
                <th className={`${PREVIEW_HEAD} text-center`}>Địa chỉ</th>
                <th className={`${PREVIEW_HEAD} pr-16 text-right`}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {preview.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm">
                    Chưa có dòng page hợp lệ. Dán danh sách hoặc tải tệp .CSV/.TXT.
                  </td>
                </tr>
              ) : (
                preview.map((row) => (
                  <tr key={`${row.stt}-${row.page_name}`} className="h-[92px]">
                    <td className="py-3 pr-3 pl-16 text-center text-[#8B90A0]">{row.stt}</td>
                    <td className="px-3 py-3 font-medium tracking-[0.3px] text-[#2563EB]">{row.uid || <span className="font-normal tracking-normal text-[#8B90A0]">Chưa gán</span>}</td>
                    <td className="max-w-[115px] px-3 py-3 font-medium text-[#5E616B]">{row.page_name}</td>
                    <td className="px-3 py-3">
                      {row.phone || <ErrorChip>Thiếu SĐT</ErrorChip>}
                    </td>
                    <td className="max-w-[170px] truncate px-3 py-3 text-[11px]">
                      {row.issues.includes("Sai email") ? <ErrorChip>Sai email</ErrorChip> : row.email || "—"}
                    </td>
                    <td className="px-3 py-3 text-center">{row.address || "—"}</td>
                    <td className="py-3 pr-16 pl-3 text-right">
                      {row.ok ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(78,222,163,0.1)] px-2 py-0.5 text-[11px] text-[#0F965F]">
                          <CreatorIcon name="valid" />
                          Hợp lệ
                        </span>
                      ) : (
                        <span title={row.issues.join(", ")} className="inline-flex items-center gap-1 rounded-full bg-[rgba(255,180,171,0.15)] px-2 py-0.5 text-[11px] text-[#B01705]">
                          <CreatorIcon name="error" />
                          Lỗi
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Thanh tổng kết dính đáy + nút bắt đầu */}
      <div className="sticky -bottom-6 z-20 -mx-4 mt-auto flex flex-wrap items-center justify-between gap-3 bg-[#F8F9FF]/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:gap-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm leading-5 text-[#434655]">
          <SummaryStat icon="stat_accounts"><b className="font-normal text-[#0B1C30]">{selected.length}</b> Account</SummaryStat>
          <span aria-hidden="true">•</span>
          <SummaryStat icon="stat_pages">
            <b className="font-normal text-[#0B1C30]">{pages.length}</b> Fanpage
            {pages.length !== validCount ? <span className="text-[#BE123C]"> ({pages.length - validCount} lỗi)</span> : null}
          </SummaryStat>
          <span aria-hidden="true">•</span>
          <SummaryStat icon="stat_threads">Đồng thời: {threads || 0} Luồng</SummaryStat>
          <span aria-hidden="true">•</span>
          <SummaryStat icon="stat_admin">
            Admin UID: <span className="font-bold text-[#2563EB]">{targetAdminUid.trim() || "Chưa nhập"}</span>
          </SummaryStat>
        </div>
        <button
          type="button"
          onClick={handleStart}
          disabled={starting || running}
          className="flex h-12 w-full items-center justify-center sm:w-[219px] gap-2 rounded-xl bg-[#2563EB] px-3 text-xl leading-7 font-bold tracking-[-0.1px] text-white shadow-[0_10px_15px_-3px_rgba(37,99,235,0.25),0_4px_6px_-4px_rgba(37,99,235,0.25)] hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-70"
        >
          {starting ? <Loader2 aria-hidden="true" className="size-5 animate-spin" /> : <CreatorIcon name="rocket" />}
          BẮT ĐẦU TẠO
        </button>
      </div>
    </div>
  );
}

/** Toàn trang Tạo Fanpage dùng Inter, kể cả tiêu đề (globals.css mặc định đặt h1-h6 sang font heading) */
const PAGE_FONT = "font-sans [&_h1]:font-sans [&_h2]:font-sans [&_h3]:font-sans";
const PANEL = "rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)] sm:p-6";
const TABLE_HEAD = "text-[11px] leading-[14px] font-bold tracking-[0.55px] whitespace-nowrap uppercase text-[#434655]";
const PREVIEW_HEAD = "px-3 text-[11px] leading-4 font-bold tracking-[0.55px] uppercase text-[#161C27]";
const FIELD_LABEL = "text-xs leading-4 font-semibold text-[#0B1C30]";
const FIELD_HINT = "text-[11px] leading-[16.5px] text-[#434655]";
const GEMINI_LABEL = "text-[11px] leading-[16.5px] text-[#434655] uppercase";
const CHECKBOX = "size-4 cursor-pointer rounded-[2.5px] accent-[#2563EB]";
const SOFT_INPUT = "flex h-10 items-center gap-2 rounded-lg bg-[#EFF4FF] px-3 focus-within:ring-2 focus-within:ring-[#2563EB]/30";
const SCROLLBAR =
  "supports-[-moz-appearance:none]:[scrollbar-width:thin] supports-[-moz-appearance:none]:[scrollbar-color:#4B8EFF_transparent] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar]:h-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-corner]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-[20px] [&::-webkit-scrollbar-thumb]:bg-[#4B8EFF]";

/** Icon xuất từ Figma (public/icons/creator) — [rộng, cao] đúng thuộc tính width/height gốc của từng SVG */
const CREATOR_ICONS = {
  accounts: [20, 17],
  admin_uid: [15, 17],
  kpi_failed: [16, 20],
  kpi_queue: [16, 20],
  kpi_running: [16, 22],
  kpi_success: [20, 20],
  open_link: [11, 11],
  run_list: [15, 15],
  run_monitor: [17, 17],
  run_pause: [11, 11],
  run_stop: [15, 15],
  status_done: [13, 8],
  status_error: [12, 12],
  status_running: [10, 10],
  terminal: [14, 11],
  user: [10, 10],
  check: [11, 9],
  cloud_upload: [24, 18],
  check_key: [14, 14],
  clear: [14, 10],
  close: [12, 12],
  copy: [11, 13],
  download: [12, 12],
  error: [11, 11],
  eye: [15, 10],
  file: [19, 24],
  gemini: [19, 19],
  job_settings: [18, 18],
  key: [16, 8],
  page_list: [18, 18],
  paste: [12, 14],
  rocket: [19, 19],
  search: [14, 14],
  shield_check: [11, 14],
  stat_accounts: [18, 9],
  stat_admin: [12, 15],
  stat_pages: [14, 14],
  stat_threads: [15, 12],
  upload: [11, 14],
  valid: [11, 11],
  warning: [11, 9],
};

/** Vẽ SVG gốc bằng CSS mask để màu đi theo class text-* (vd. tab đang chọn đổi xanh) */
function CreatorIcon({ name, className = "" }) {
  const [width, height] = CREATOR_ICONS[name];
  const url = `url(/icons/creator/icon_${name}.svg)`;
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{ width, height, maskImage: url, WebkitMaskImage: url, maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat", maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }}
    />
  );
}

/** Icon vuông nền xanh nhạt + tiêu đề + mô tả ở đầu mỗi section */
function SectionHeading({ icon, title, subtitle, className = "" }) {
  return (
    <div className={`flex min-w-0 items-start gap-3 ${className}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#EFF4FF] text-[#2563EB] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        <CreatorIcon name={icon} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-lg leading-[26px] font-semibold text-[#0B1C30]">{title}</h2>
        <p className="max-w-[352px] text-xs leading-4 text-[#434655]">{subtitle}</p>
      </div>
    </div>
  );
}

const LOGIN_BADGE = {
  logged_in: { label: "Đã đăng nhập", box: "bg-[#ECFDF5] text-[#047857]", dot: "bg-[#10B981]" },
  failed: { label: "Đăng nhập lỗi", box: "bg-[#FFF1F2] text-[#BE123C]", dot: "bg-[#F43F5E]" },
};

function LoginBadge({ status }) {
  const meta = LOGIN_BADGE[status] || { label: "Chưa đăng nhập", box: "bg-[#F1F5F9] text-[#475569]", dot: "bg-[#94A3B8]" };
  return (
    <span className={`inline-flex h-[22px] items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium tracking-[0.33px] whitespace-nowrap ${meta.box}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function LiveBadge({ status }) {
  if (status === "live") {
    return <span className="inline-flex h-[18px] items-center rounded-full bg-[#D1FAE5] px-2 text-[11px] font-semibold tracking-[0.33px] text-[#065F46]">Live</span>;
  }
  if (status === "die") {
    return <span className="inline-flex h-[18px] items-center rounded-full bg-[#FFE4E6] px-2 text-[11px] font-semibold tracking-[0.33px] text-[#BE123C]">Die</span>;
  }
  return <span className="text-xs text-[#737686]">—</span>;
}

function ErrorChip({ children }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-[rgba(255,180,171,0.5)] px-2 py-0.5 text-[10px] leading-[18px] whitespace-nowrap text-[#BA4A3C]">
      <CreatorIcon name="warning" className="text-[#D57063]" />
      {children}
    </span>
  );
}

function SummaryStat({ icon, children }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <CreatorIcon name={icon} className="text-[#004AC6]" />
      <span>{children}</span>
    </span>
  );
}

/** Chọn ký tự phân cách — menu theo Figma node 1017:9541 */
function DelimiterSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = DELIMITERS.find((item) => item.value === value) || DELIMITERS[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 sm:w-[211px] sm:flex-none">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg bg-[#EFF4FF] pr-3 pl-4 text-xs leading-[14px] font-medium text-[#0B1C30] outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
      >
        <span className="truncate">
          {current.symbol} {current.label}
        </span>
        <ChevronDown aria-hidden="true" className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Ký tự phân cách"
          className="absolute bottom-[calc(100%+4px)] left-0 z-30 w-[220px] overflow-hidden rounded-xl border border-[rgba(65,71,84,0.4)] bg-white shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]"
        >
          {DELIMITERS.map((item) => {
            const selected = item.value === value;
            return (
              <li key={item.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs leading-4 font-medium tracking-[0.24px] ${
                    selected ? "h-[37px] rounded-[5px] bg-[#2563EB] text-white" : "text-[#161C27] hover:bg-[#EFF4FF]"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={selected ? "font-bold" : ""}>{item.symbol}</span>
                    {item.label}
                  </span>
                  {selected && <CreatorIcon name="check" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Vùng tải tệp khi chưa chọn tệp — theo Figma node 1017:9526 */
function UploadDropzone({ onPick, onDropFile }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        onDropFile(event.dataTransfer.files?.[0]);
      }}
      className={`flex flex-1 flex-col items-center justify-center rounded-xl border bg-white p-6 transition-colors ${
        dragging ? "border-[#2563EB] bg-[#F8FAFF]" : "border-[#C1C6D6]"
      }`}
    >
      <span className="mb-2 grid size-12 place-items-center rounded-xl bg-[rgba(0,46,105,0.5)] text-[#7BD0FF] shadow-[0_0_20px_-3px_rgba(123,208,255,0.25)]">
        <CreatorIcon name="cloud_upload" />
      </span>
      <p className="mb-3 text-xs leading-4 text-[#8B90A0]">{dragging ? "Thả tệp vào đây" : "Tải tệp lên"}</p>
      <button
        type="button"
        onClick={onPick}
        className="rounded-lg border border-[#C1C6D6] bg-white px-4 py-1.5 text-xs leading-4 font-semibold text-[#161C27] shadow-[0_1px_3px_rgba(0,0,0,0.1),0_1px_2px_-1px_rgba(0,0,0,0.1)] hover:bg-[#F8F9FF]"
      >
        Chọn file từ máy tính
      </button>
    </div>
  );
}

/** Ô số có tiền tố / hậu tố đơn vị (Luồng, Vòng, giây) */
function SuffixInput({ id, value, onChange, min = 0, max, suffix, prefix, bold = false }) {
  const unit = "text-[11px] leading-[14px] tracking-[0.33px] text-[#434655]";
  return (
    <label htmlFor={id} className={SOFT_INPUT}>
      {prefix && <span className={`${unit} font-semibold`}>{prefix}</span>}
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full min-w-0 bg-transparent text-base ${bold ? "font-bold" : "font-semibold"} text-[#0B1C30] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
      />
      <span className={`${unit} shrink-0 ${bold ? "font-medium" : "font-semibold"}`}>{suffix}</span>
    </label>
  );
}
