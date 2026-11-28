"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart2, CheckCircle2, CircleStop, Clock, Download, ExternalLink, Eye, FileSpreadsheet, Loader2, Play, ScrollText, Search, X } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { refreshMiniProgress } from "@/components/MiniProgress";
import CustomSelect from "@/components/ui/custom-select";
import { toast } from "@/lib/toast";
import { LiveLogConsole, Pager, notifyExportResult } from "@/modules/module_11_page_scanner/_shared";
import { askConfirm } from "@/modules/module_11_page_scanner/shared/askConfirm";
import { useActionLock } from "@/modules/module_11_page_scanner/shared/useActionLock";
import { saveBlobFile } from "@/modules/module_11_page_scanner/shared/saveFile.mjs";
import DateRangeFilter, { rangeToParams } from "@/modules/module_11_page_scanner/history/DateRangeFilter";
import ProfileAvatar from "../shared/ProfileAvatar";
import { exportMessage, exportProfiles } from "../shared/exportProfiles";
import { SOURCE_TYPES, shortFbUrl } from "../utils.mjs";
import { controlScan, getScanProgress, getScanResults, getScanSessions, getSessionTargets } from "../service";

/* ─── Hằng số & tiện ích ─── */
const STATUS = {
  RUNNING: { label: "Đang chạy", cls: "bg-[#EFF6FF] border-[#BFDBFE] text-[#1D4ED8]", dot: "bg-[#3B82F6] animate-pulse" },
  PAUSED: { label: "Tạm dừng", cls: "bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]", dot: "bg-[#F59E0B]" },
  COMPLETED: { label: "Hoàn thành", cls: "bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]", dot: "bg-[#10B981]" },
  SUSPENDED: { label: "Gián đoạn", cls: "bg-[#FFF7ED] border-[#FED7AA] text-[#C2410C]", dot: "bg-[#F97316]" },
  STOPPED: { label: "Đã dừng", cls: "bg-[#F8FAFC] border-[#E2E8F0] text-[#475569]", dot: "bg-[#94A3B8]" },
  FAILED: { label: "Lỗi", cls: "bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]", dot: "bg-[#EF4444]" },
};
const TARGET_STATUS = {
  DONE: { label: "Thành công", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  SKIPPED: { label: "Bỏ qua", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  FAILED: { label: "Lỗi", cls: "bg-red-50 text-red-700 border-red-200" },
  PENDING: { label: "Chưa quét", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  RUNNING: { label: "Đang quét", cls: "bg-blue-50 text-blue-700 border-blue-200" },
};
const MODE_LABEL = { source: "Quét từ nguồn", link: "Quét từ link", file: "Quét từ tệp" };
const MODE_OPTIONS = [
  { value: "", label: "Tất cả loại quét" },
  ...Object.entries(MODE_LABEL).map(([value, label]) => ({ value, label })),
];
const STATUS_OPTIONS = [
  { value: "", label: "Tất cả trạng thái" },
  ...Object.entries(STATUS).map(([value, { label }]) => ({ value, label })),
];
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50].map((n) => ({ value: n, label: String(n) }));
const DETAIL_PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 500;
const POLL_MS = 5000;
const TH = "px-3 py-3 text-xs font-semibold uppercase tracking-[0.3px] text-[#64748B]";
const SELECT_BTN = "!h-[34px] !rounded-lg !border-[#E2E8F0] !bg-[#F8FAFC] !px-3.5 !text-xs !shadow-none";

const fmtNum = (n) => Number(n || 0).toLocaleString("vi-VN");
const isLive = (s) => s.status === "RUNNING" || s.status === "PAUSED";
const canResume = (s) => (s.status === "SUSPENDED" || s.status === "STOPPED") && s.pending > 0;
const threadLabel = (n) => (n ? `Thread-${String(n).padStart(2, "0")}` : "Phiên");

/** Mục tiêu quét: nguồn đầu tiên (+N nguồn) · danh sách link · tệp */
function targetOf(s) {
  if (s.mode === "source" && s.source_name) {
    const more = s.source_count > 1 ? ` (+${s.source_count - 1} nguồn)` : "";
    return { label: `${SOURCE_TYPES[s.source_type] || "Nguồn"}:`, value: `${s.source_name}${more}` };
  }
  return { label: s.mode === "file" ? "Tệp:" : "Link:", value: `${fmtNum(s.total)} profile` };
}
const targetText = (s) => {
  const t = targetOf(s);
  return `${t.label} ${t.value}`;
};

function formatDuration(seconds) {
  const t = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const two = (n) => String(n).padStart(2, "0");
  if (h) return `${h}h ${two(m)}m ${two(t % 60)}s`;
  return m ? `${two(m)}m ${two(t % 60)}s` : `${t}s`;
}

function formatDt(dt) {
  if (!dt) return "—";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "—";
  const two = (n) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())} - ${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function StatusBadge({ status }) {
  const info = STATUS[status] || { label: status, cls: "bg-slate-50 border-slate-200 text-slate-500", dot: "bg-slate-400" };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${info.cls}`}>
      <span className={`size-1.5 rounded-full ${info.dot}`} />
      {info.label}
    </span>
  );
}

function DurationLine({ s }) {
  const Icon = isLive(s) ? Clock : s.status === "COMPLETED" ? CheckCircle2 : CircleStop;
  const text = isLive(s) ? "Đang thực hiện" : s.status === "COMPLETED" ? `Thời gian: ${formatDuration(s.duration_seconds)}` : `Dừng lúc ${formatDuration(s.duration_seconds)}`;
  return (
    <span className="mt-0.5 flex items-center gap-1 whitespace-nowrap text-[11px] leading-4 text-[#94A3B8]">
      <Icon className="size-[11px] shrink-0" />
      {text}
    </span>
  );
}

/** "12 / 20 profile" + dòng phụ bỏ qua / lỗi */
function ResultCell({ s }) {
  const ok = s.status === "COMPLETED" || (s.total > 0 && s.done >= s.total);
  return (
    <>
      <span className={`whitespace-nowrap text-xs font-bold ${ok ? "text-[#059669]" : "text-[#1E293B]"}`}>
        {fmtNum(s.done)} / {fmtNum(s.total)} profile
      </span>
      {(s.skipped > 0 || s.failed > 0) && (
        <span className="mt-0.5 block whitespace-nowrap text-[11px] text-[#94A3B8]">
          {s.skipped > 0 && <span className="text-amber-600">{fmtNum(s.skipped)} bỏ qua</span>}
          {s.skipped > 0 && s.failed > 0 && " · "}
          {s.failed > 0 && <span className="text-red-600">{fmtNum(s.failed)} lỗi</span>}
        </span>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   LỊCH SỬ QUÉT PROFILE
   ════════════════════════════════════════════════════════════ */
export default function ProfileScanHistory() {
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [search, setSearch] = useState("");
  // Thanh bộ lọc dính khi cuộn; dải nền che khe p-6 phía trên chỉ hiện khi đã dính
  const filterBarRef = useRef(null);
  const [filterStuck, setFilterStuck] = useState(false);
  useEffect(() => {
    const el = filterBarRef.current;
    const scroller = el?.closest("main");
    if (!el || !scroller) return undefined;
    const check = () => {
      const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      setFilterStuck(scroller.scrollTop > 0 && offset <= padTop + 1);
    };
    check();
    scroller.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      scroller.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);
  const [keyword, setKeyword] = useState("");
  const [mode, setMode] = useState("");
  const [status, setStatus] = useState("");
  const [range, setRange] = useState("");

  const [selected, setSelected] = useState(() => new Map());
  const [exporting, guardExport, exportingApi] = useActionLock();
  const [acting, guardAction] = useActionLock();
  const [detail, setDetail] = useState(null);

  const requestSeq = useRef(0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const changeFilter = (setter) => (value) => {
    setter(value);
    setPage(1);
    setSelected(new Map());
  };

  useEffect(() => {
    const next = search.trim();
    if (next === keyword) return undefined;
    const t = setTimeout(() => {
      setKeyword(next);
      setPage(1);
      setSelected(new Map());
    }, 300);
    return () => clearTimeout(t);
  }, [search, keyword]);

  const filters = useMemo(
    () => ({ keyword: keyword || undefined, mode: mode || undefined, status: status || undefined, ...rangeToParams(range || {}) }),
    [keyword, mode, status, range],
  );

  const loadSessions = useCallback(
    async ({ silent = false } = {}) => {
      const seq = ++requestSeq.current;
      if (!silent) setLoading(true);
      try {
        const data = await getScanSessions({ page, page_size: pageSize, ...filters });
        if (seq !== requestSeq.current) return;
        const count = Number(data?.total || 0);
        const lastPage = Math.max(1, Math.ceil(count / pageSize));
        setTotal(count);
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        const items = data?.items || [];
        setSessions(items);
        // Cập nhật số liệu phiên đang mở chi tiết
        setDetail((cur) => (cur ? items.find((s) => s.id === cur.id) || cur : cur));
      } catch (err) {
        if (seq === requestSeq.current && !silent) toast.error(`Lỗi tải lịch sử: ${err.message}`);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [page, pageSize, filters],
  );

  useEffect(() => {
    loadSessions();
    return () => {
      requestSeq.current += 1;
    };
  }, [loadSessions]);

  const hasLive = sessions.some(isLive);
  useEffect(() => {
    if (!hasLive || loading) return undefined;
    const t = setInterval(() => loadSessions({ silent: true }), POLL_MS);
    return () => clearInterval(t);
  }, [hasLive, loading, loadSessions]);

  const allChecked = sessions.length > 0 && sessions.every((s) => selected.has(s.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Map(prev);
      sessions.forEach((s) => (allChecked ? next.delete(s.id) : next.set(s.id, s)));
      return next;
    });
  const toggleOne = (s) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (!next.delete(s.id)) next.set(s.id, s);
      return next;
    });

  /* Xuất Excel: dòng đã chọn, không chọn thì toàn bộ kết quả lọc */
  const handleExport = async () => {
    try {
      let rows = [...selected.values()];
      if (!rows.length) {
        for (let p = 1; ; p += 1) {
          const data = await getScanSessions({ ...filters, page: p, page_size: EXPORT_PAGE_SIZE });
          const items = data?.items || [];
          rows = rows.concat(items);
          if (items.length < EXPORT_PAGE_SIZE || rows.length >= Number(data?.total || 0)) break;
        }
      }
      if (!rows.length) {
        toast.warning("Không có phiên quét nào để xuất.", { key: "m13-history-export" });
        return;
      }
      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.json_to_sheet(
        rows.map((s, i) => ({
          STT: i + 1,
          "Mã phiên": s.id,
          "Loại quét": MODE_LABEL[s.mode] || s.mode,
          "Mục tiêu quét": targetText(s),
          "Tổng profile": Number(s.total || 0),
          "Thành công": Number(s.done || 0),
          "Bỏ qua": Number(s.skipped || 0),
          Lỗi: Number(s.failed || 0),
          "Chưa quét": Number(s.pending || 0),
          "Tài khoản": (s.account_uids || []).join(", "),
          "Số luồng": s.workers ?? "",
          "Bắt đầu": formatDt(s.started_at),
          "Kết thúc": formatDt(s.finished_at),
          "Thời lượng": isLive(s) ? "" : formatDuration(s.duration_seconds),
          "Trạng thái": STATUS[s.status]?.label || s.status,
          "Ghi chú": s.message || "",
        })),
      );
      sheet["!cols"] = [5, 9, 16, 40, 12, 12, 10, 8, 10, 34, 9, 20, 20, 14, 14, 50].map((wch) => ({ wch }));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Lịch sử quét profile");
      const suffix = range?.from || range?.to ? `${range.from || "dau"}_${range.to || "nay"}` : "tat_ca";
      const blob = new Blob([XLSX.write(book, { bookType: "xlsx", type: "array" })], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const res = await saveBlobFile(blob, {
        suggestedName: `Lich_su_quet_profile_${suffix}.xlsx`,
        types: [{ description: "Tệp Excel", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }],
      });
      notifyExportResult(res, { successMessage: `Đã xuất ${fmtNum(rows.length)} phiên quét ra file "${res.fileName}".`, key: "m13-history-export" });
    } catch (err) {
      toast.error(`Lỗi xuất Excel: ${err.message}`, { key: "m13-history-export" });
    }
  };

  const handleStop = async (s) => {
    const ok = await askConfirm({ title: "Dừng phiên quét", description: `Dừng phiên #${s.id} (${targetText(s)})?`, confirmText: "Dừng", variant: "warning" });
    if (!ok) return;
    try {
      await controlScan(s.id, "stop");
      toast.success("Đã gửi tín hiệu dừng phiên quét", { key: "m13-history-action" });
      loadSessions({ silent: true });
    } catch (err) {
      toast.error(`Không dừng được: ${err.message}`, { key: "m13-history-action" });
    }
  };

  const handleResume = async (s) => {
    const ok = await askConfirm({
      title: "Chạy tiếp phiên quét",
      description: `Quét tiếp ${fmtNum(s.pending)} profile còn lại của phiên #${s.id}?`,
      confirmText: "Chạy tiếp",
    });
    if (!ok) return;
    try {
      await controlScan(s.id, "resume");
      toast.success("Đã chạy tiếp phiên quét", { key: "m13-history-action" });
      loadSessions({ silent: true });
      refreshMiniProgress(); // thẻ tiến độ góc màn hình hiện ngay
    } catch (err) {
      toast.error(`Không chạy tiếp được: ${err.message}`, { key: "m13-history-action" });
    }
  };

  return (
    <div className="pb-8">
      <h1 className="font-heading text-xl font-bold text-[#0F172A]">Lịch sử quét profile</h1>
      <p className="mt-1 text-xs text-[#64748B]">Theo dõi tiến trình, kết quả và nhật ký các phiên quét thông tin profile.</p>

      {/* Bộ lọc */}
      <section
        ref={filterBarRef}
        className={`sticky top-0 z-30 mt-6 flex flex-wrap items-center gap-2.5 rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${
          filterStuck
            ? "shadow-md before:pointer-events-none before:absolute before:-inset-x-px before:-top-6 before:h-6 before:bg-background before:content-['']"
            : ""
        }`}
      >
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm mã phiên, tên nguồn, UID tài khoản..."
            className="h-[34px] w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] pl-9 pr-9 text-xs text-[#334155] outline-none transition-colors placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white"
          />
          {search && (
            <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569]">
              <X className="size-4" />
            </button>
          )}
        </div>
        <CustomSelect className="w-[180px]" buttonClassName={SELECT_BTN} value={mode} onChange={changeFilter(setMode)} options={MODE_OPTIONS} />
        <CustomSelect className="w-[170px]" buttonClassName={SELECT_BTN} value={status} onChange={changeFilter(setStatus)} options={STATUS_OPTIONS} />
        <DateRangeFilter value={range} onChange={changeFilter(setRange)} />
        <button
          type="button"
          onClick={() => guardExport(handleExport)}
          disabled={exporting}
          aria-busy={exportingApi}
          className="inline-flex h-[34px] shrink-0 items-center gap-2 rounded-lg bg-[#059669] px-3.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#047857] disabled:opacity-60"
        >
          {exportingApi ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Xuất báo cáo Excel{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
      </section>

      {/* Bảng phiên quét */}
      <section className="mt-6 rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
        <div className="overflow-x-auto rounded-t-xl">
          <table className="w-full min-w-[1120px] text-left">
            <thead className="bg-[#F8FAFC]">
              <tr className="border-b border-[#E2E8F0]">
                <th className="w-10 py-3 pl-4">
                  <Checkbox checked={allChecked} disabled={!sessions.length} onCheckedChange={toggleAll} aria-label="Chọn tất cả trong trang" />
                </th>
                <th className={`${TH} w-14 text-center`}>STT</th>
                <th className={TH}>Loại quét</th>
                <th className={TH}>Mục tiêu quét</th>
                <th className={TH}>Kết quả thu thập</th>
                <th className={TH}>Tài khoản</th>
                <th className={TH}>Thời gian</th>
                <th className={TH}>Trạng thái</th>
                <th className={`${TH} sticky right-0 z-[1] shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)] w-24 bg-[#F8FAFC] text-center`}>Thao tác</th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-[#F1F5F9] ${loading && sessions.length ? "opacity-60" : ""}`}>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400">
                    {loading ? (
                      <>
                        <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
                        <p className="text-xs">Đang tải lịch sử phiên...</p>
                      </>
                    ) : (
                      <>
                        <BarChart2 className="mx-auto mb-2 size-8 opacity-30" />
                        <p className="text-xs font-medium">Không có phiên quét nào phù hợp bộ lọc</p>
                        <p className="mt-1 text-xs">Thử đổi khoảng thời gian, loại quét hoặc trạng thái.</p>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                sessions.map((s, idx) => {
                  const target = targetOf(s);
                  const accounts = s.account_uids || [];
                  return (
                    <tr key={s.id} className={`group transition-colors hover:bg-slate-50 ${s.status === "FAILED" ? "bg-red-50/20" : ""}`}>
                      <td className="py-3 pl-4">
                        <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggleOne(s)} aria-label={`Chọn phiên #${s.id}`} />
                      </td>
                      <td className="px-3 py-3 text-center text-xs font-semibold text-[#94A3B8]">{String((page - 1) * pageSize + idx + 1).padStart(2, "0")}</td>
                      <td className="px-3 py-3">
                        <span className="inline-flex whitespace-nowrap rounded-full border border-[#DBEAFE] bg-[#EFF6FF] px-2.5 py-0.5 text-xs font-semibold text-[#1D4ED8]">{MODE_LABEL[s.mode] || s.mode}</span>
                      </td>
                      <td className="max-w-[280px] px-3 py-3 text-xs">
                        <div className="flex items-center gap-1.5" title={`Phiên #${s.id} · ${targetText(s)}`}>
                          <span className="shrink-0 font-medium text-[#0F172A]">{target.label}</span>
                          <span className="line-clamp-2 break-words font-semibold text-[#2563EB]">{target.value}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3"><ResultCell s={s} /></td>
                      <td className="px-3 py-3 text-xs" title={accounts.join("\n")}>
                        <span className="block whitespace-nowrap font-semibold text-[#1E293B]">{fmtNum(accounts.length)} tài khoản</span>
                        <span className="text-[11px] text-[#94A3B8]">{s.workers ? `${s.workers} luồng` : ""}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className="whitespace-nowrap text-xs font-medium text-[#1E293B]">{formatDt(s.started_at)}</span>
                        <DurationLine s={s} />
                      </td>
                      <td className="px-3 py-3" title={s.message || ""}>
                        <StatusBadge status={s.status} />
                      </td>
                      {/* Cột thao tác cố định bên phải khi bảng cuộn ngang */}
                      <td className="sticky right-0 z-[1] shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.15)] bg-white px-3 py-3 transition-colors group-hover:bg-slate-50">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" title="Xem chi tiết" aria-label="Xem chi tiết" onClick={() => setDetail(s)} className="rounded-lg p-1.5 text-[#64748B] hover:bg-slate-100 hover:text-[#2563EB]">
                            <Eye className="size-4" />
                          </button>
                          {isLive(s) && (
                            <button type="button" title="Dừng phiên" aria-label="Dừng phiên" onClick={() => guardAction(() => handleStop(s))} disabled={acting} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">
                              <CircleStop className="size-4" />
                            </button>
                          )}
                          {canResume(s) && (
                            <button type="button" title="Chạy tiếp" aria-label="Chạy tiếp" onClick={() => guardAction(() => handleResume(s))} disabled={acting} className="rounded-lg p-1.5 text-[#059669] hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40">
                              <Play className="size-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t border-[#E2E8F0] bg-[#F8FAFC]/80 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-[#64748B]">
            Hiển thị
            <CustomSelect
              className="w-16"
              size="sm"
              direction="up"
              value={pageSize}
              onChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              options={PAGE_SIZE_OPTIONS}
            />
            <span>
              trong tổng số <b className="text-[#0F172A]">{fmtNum(total)}</b> phiên
            </span>
          </div>
          <Pager page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </section>

      {detail && <SessionDetail session={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/* ══════ CHI TIẾT PHIÊN ══════ */
const TARGET_TABS = [
  { key: "", label: "Tất cả", count: (s) => s.total },
  { key: "DONE", label: "Thành công", count: (s) => s.done },
  { key: "SKIPPED", label: "Bỏ qua", count: (s) => s.skipped },
  { key: "FAILED", label: "Lỗi", count: (s) => s.failed },
  { key: "PENDING", label: "Chưa quét", count: (s) => s.pending },
];

function SessionDetail({ session: s, onClose }) {
  const [tab, setTab] = useState("data");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState({ key: null, items: [], total: 0 });
  const [logs, setLogs] = useState([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const lastLog = useRef(0);
  const live = isLive(s);

  // Danh sách profile của phiên (theo trạng thái) — tải lại theo nhịp khi phiên còn chạy
  const rowsKey = `${s.id}|${filter}|${page}`;
  const tick = live ? `${s.done}|${s.skipped}|${s.failed}|${s.pending}` : "";
  useEffect(() => {
    let ignore = false;
    getSessionTargets(s.id, { status: filter || undefined, page, page_size: DETAIL_PAGE_SIZE })
      .then((res) => !ignore && setRows({ key: rowsKey, items: res?.items || [], total: Number(res?.total || 0) }))
      .catch((err) => {
        if (ignore) return;
        toast.error(`Lỗi tải chi tiết: ${err.message}`);
        setRows({ key: rowsKey, items: [], total: 0 });
      });
    return () => {
      ignore = true;
    };
  }, [s.id, filter, page, rowsKey, tick]);

  // Nhật ký: tải 1 lần, phiên đang chạy thì nối thêm log mới
  useEffect(() => {
    let ignore = false;
    lastLog.current = 0;
    const pull = () =>
      getScanProgress(s.id, lastLog.current)
        .then((res) => {
          if (ignore) return;
          const fresh = res?.logs || [];
          if (fresh.length) lastLog.current = fresh[fresh.length - 1].id;
          setLogs((prev) => [...prev, ...fresh.map((l) => ({ id: `s${l.id}`, timestamp: l.time, thread: threadLabel(l.thread), message: l.message, type: l.level }))].slice(-1000));
          setLogsLoaded(true);
        })
        .catch(() => !ignore && setLogsLoaded(true));
    setLogs([]);
    setLogsLoaded(false);
    pull();
    const t = live ? setInterval(pull, POLL_MS) : null;
    return () => {
      ignore = true;
      if (t) clearInterval(t);
    };
  }, [s.id, live]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const exportResults = async () => {
    setExporting(true);
    try {
      // Chọn nơi lưu trước, tải kết quả phiên sau (giữ được hộp thoại "Lưu thành")
      const names = new Map();
      const result = await exportProfiles(
        async () => {
          const res = await getScanResults(s.id);
          (res?.sources || []).forEach((x) => names.set(x.key, x.name));
          return res?.items || [];
        },
        `profile_phien_${s.id}`,
        (r) => names.get(r.sourceKey) || "",
      );
      const msg = result.status === "empty" ? { type: "warning", text: "Phiên này chưa có profile quét thành công." } : exportMessage(result);
      toast[msg.type](msg.text);
    } catch (err) {
      toast.error(`Không xuất được: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const loadingRows = rows.key !== rowsKey;
  const pages = Math.max(1, Math.ceil(rows.total / DETAIL_PAGE_SIZE));
  const stats = [
    { label: "Tổng profile", value: s.total, color: "text-slate-700" },
    { label: "Thành công", value: s.done, color: "text-emerald-600" },
    { label: "Bỏ qua", value: s.skipped, color: "text-amber-600" },
    { label: "Lỗi", value: s.failed, color: "text-red-600" },
    { label: "Chưa quét", value: s.pending, color: "text-slate-500" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={`Chi tiết phiên #${s.id}`} className="relative z-10 flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-800" title={targetText(s)}>
              Chi tiết phiên #{s.id}: <span className="text-primary">{targetText(s)}</span>
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge status={s.status} />
              <span className="rounded-full border border-[#DBEAFE] bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]">{MODE_LABEL[s.mode] || s.mode}</span>
              <span className="text-[11px] text-slate-400">{formatDt(s.started_at)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={exportResults} disabled={exporting || !s.done} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
              {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <FileSpreadsheet className="size-3.5" />} Xuất profile
            </button>
            <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1.5 hover:bg-slate-100">
              <X className="size-4 text-slate-500" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-5 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50">
          {stats.map(({ label, value, color }) => (
            <div key={label} className="px-4 py-4 text-center">
              <p className={`text-xl font-bold ${color}`}>{fmtNum(value)}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1.5 border-b border-slate-100 px-6 py-3 text-[11px]">
          <span className="text-slate-400">
            Tài khoản: <span className="font-mono font-semibold text-slate-600">{(s.account_uids || []).join(", ") || "—"}</span>
          </span>
          <span className="text-slate-400">Số luồng: <span className="font-semibold text-slate-600">{s.workers ?? "—"}</span></span>
          <span className="text-slate-400">Khoảng cách: <span className="font-semibold text-slate-600">{s.delay_min != null ? `${s.delay_min} – ${s.delay_max} giây` : "—"}</span></span>
          {s.min_friends > 0 && <span className="text-slate-400">Lọc bạn bè: <span className="font-semibold text-slate-600">từ {fmtNum(s.min_friends)}</span></span>}
          <span className="text-slate-400">Thời lượng: <span className="font-semibold text-slate-600">{formatDuration(s.duration_seconds)}</span></span>
          {s.message && <span className={`basis-full ${s.status === "FAILED" ? "text-red-600" : "text-slate-500"}`}>Ghi chú: <span className="font-semibold">{s.message}</span></span>}
        </div>

        <div className="flex gap-1 border-b border-slate-100 px-6">
          {[
            { key: "data", label: "Profile trong phiên", Icon: BarChart2 },
            { key: "logs", label: `Nhật ký chạy${logs.length ? ` (${fmtNum(logs.length)})` : ""}`, Icon: ScrollText },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors ${tab === key ? "border-[#2563EB] text-[#2563EB]" : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        {tab === "logs" ? (
          <div className="flex-1 overflow-auto p-4">
            <LiveLogConsole title={`Nhật ký phiên #${s.id}`} logs={logs} phase={s.status === "RUNNING" ? "running" : s.status === "PAUSED" ? "paused" : "done"} />
            {logsLoaded && !live && !logs.length && <p className="mt-2 text-center text-[11px] text-slate-400">Phiên này không có nhật ký chạy.</p>}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-6 py-2.5">
              {TARGET_TABS.map((t) => (
                <button
                  key={t.key || "all"}
                  type="button"
                  onClick={() => {
                    setFilter(t.key);
                    setPage(1);
                  }}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${filter === t.key ? "border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                >
                  {t.label} ({fmtNum(t.count(s))})
                </button>
              ))}
            </div>
            <div className="min-h-[240px] flex-1 overflow-auto">
              {loadingRows ? (
                <div className="flex h-full min-h-[240px] items-center justify-center text-slate-400">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              ) : (
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200 [&_th]:px-4 [&_th]:py-2.5 [&_th]:font-semibold [&_th]:text-slate-500">
                      <th className="w-10">STT</th>
                      <th>PROFILE</th>
                      <th>LINK</th>
                      <th className="text-right">BẠN BÈ</th>
                      <th className="text-right">FOLLOWERS</th>
                      <th>TRẠNG THÁI</th>
                      <th>TÀI KHOẢN QUÉT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.items.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-14 text-center text-slate-400">Không có profile nào.</td>
                      </tr>
                    )}
                    {rows.items.map((r, idx) => {
                      const st = TARGET_STATUS[r.status] || TARGET_STATUS.PENDING;
                      return (
                        <tr key={r.id} className="hover:bg-slate-50 [&_td]:px-4 [&_td]:py-2">
                          <td className="font-mono text-slate-400">{(page - 1) * DETAIL_PAGE_SIZE + idx + 1}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <ProfileAvatar src={r.avatar} name={r.name || r.uid || "FB"} className="size-6 rounded-full" />
                              <div className="min-w-0">
                                <span className="block max-w-[180px] truncate font-semibold text-slate-700">{r.name || "—"}</span>
                                {r.uid && <span className="text-[10px] text-slate-400">UID: {r.uid}</span>}
                              </div>
                            </div>
                          </td>
                          <td>
                            <a href={r.url} target="_blank" rel="noreferrer" className="flex max-w-[200px] items-center gap-1 text-primary hover:underline">
                              <span className="truncate">{shortFbUrl(r.url)}</span>
                              <ExternalLink className="size-3 shrink-0" />
                            </a>
                          </td>
                          <td className="text-right font-mono text-slate-600">{r.friends != null ? fmtNum(r.friends) : "—"}</td>
                          <td className="text-right font-mono text-slate-600">{r.followers != null ? fmtNum(r.followers) : "—"}</td>
                          <td>
                            <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                            {r.reason && (
                              <span className="mt-0.5 block max-w-[240px] truncate text-[10px] text-slate-400" title={r.reason}>
                                {r.reason}
                              </span>
                            )}
                          </td>
                          <td className="font-mono text-slate-500">{r.account_uid || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-end gap-1 border-t border-slate-100 px-6 py-3">
                <Pager page={page} totalPages={pages} onChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
