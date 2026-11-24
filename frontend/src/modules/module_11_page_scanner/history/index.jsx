"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Search,
  Eye,
  Clock,
  CheckCircle2,
  CircleStop,
  Download,
  ExternalLink,
  Loader2,
  BarChart2,
  X,
  BadgeCheck,
} from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import CustomSelect from "@/components/ui/custom-select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import { Pager } from "../_shared";
import { askConfirm } from "../shared/askConfirm";
import {
  getScanSessions,
  getScanSessionDetail,
  stopScanSession,
  getScannedPages,
  getSessionFollowerPages,
  getSessionPostPages,
} from "../service";
import DateRangeFilter, { todayRange, rangeToParams } from "./DateRangeFilter";

/* ─── Helpers ─── */
const STOP_REASONS = {
  TARGET_REACHED:  { label: "Đạt mục tiêu",        cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  NO_NEW_RESULTS:  { label: "Hết kết quả",           cls: "bg-blue-50 text-blue-700 border-blue-200" },
  CYCLE_DETECTED:  { label: "Phát hiện lặp vòng",   cls: "bg-violet-50 text-violet-700 border-violet-200" },
  END_MARKER:      { label: "Facebook hết danh sách", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  TIMEOUT:         { label: "Hết thời gian",         cls: "bg-amber-50 text-amber-700 border-amber-200" },
  MAX_SCROLLS:     { label: "Đạt giới hạn cuộn",    cls: "bg-amber-50 text-amber-700 border-amber-200" },
  CHECKPOINT:      { label: "Bị checkpoint",         cls: "bg-red-50 text-red-700 border-red-200" },
  USER_STOPPED:    { label: "Người dùng dừng",       cls: "bg-slate-50 text-slate-600 border-slate-200" },
  ERROR:           { label: "Lỗi",                   cls: "bg-red-50 text-red-700 border-red-200" },
  COMPLETED:       { label: "Hoàn thành",            cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  BUSY_LOCKED:     { label: "Nick đang bận",         cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

function StopReasonBadge({ reason }) {
  const info = STOP_REASONS[reason] || { label: reason || "—", cls: "bg-slate-50 text-slate-500 border-slate-200" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${info.cls}`}>
      {info.label}
    </span>
  );
}

const STATUS = {
  RUNNING:   { label: "Đang chạy",  cls: "bg-[#EFF6FF] border-[#BFDBFE] text-[#1D4ED8]", dot: "bg-[#3B82F6] animate-pulse" },
  PAUSED:    { label: "Tạm dừng",   cls: "bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]", dot: "bg-[#F59E0B]" },
  COMPLETED: { label: "Hoàn thành", cls: "bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]", dot: "bg-[#10B981]" },
  PARTIAL:   { label: "Một phần",   cls: "bg-[#FFFBEB] border-[#FDE68A] text-[#B45309]", dot: "bg-[#F59E0B]" },
  STOPPED:   { label: "Đã dừng",    cls: "bg-[#F8FAFC] border-[#E2E8F0] text-[#475569]", dot: "bg-[#94A3B8]" },
  FAILED:    { label: "Lỗi",        cls: "bg-[#FEF2F2] border-[#FECACA] text-[#DC2626]", dot: "bg-[#EF4444]" },
};

const TYPE_OPTIONS = [
  { value: "", label: "Tất cả loại quét" },
  { value: "DISCOVERY,DETAIL", label: "Quét thông tin page" },
  { value: "FOLLOW", label: "Quét followers page" },
  { value: "POST_SCAN", label: "Quét bài viết page" },
];
const STATUS_OPTIONS = [
  { value: "", label: "Tất cả trạng thái" },
  ...Object.entries(STATUS).map(([value, { label }]) => ({ value, label })),
];
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50].map((n) => ({ value: n, label: String(n) }));
const DETAIL_PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 500;
const POLL_MS = 5000;

function StatusBadge({ status }) {
  const info = STATUS[status] || { label: status, cls: "bg-slate-50 border-slate-200 text-slate-500", dot: "bg-slate-400" };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${info.cls}`}>
      <span className={`size-2 rounded-full ${info.dot}`} />
      {info.label}
    </span>
  );
}

const fmtNum = (n) => Number(n || 0).toLocaleString("vi-VN");
/** page_key "id:123" / "user:abc" → "123" / "abc" */
const bareKey = (key) => String(key || "").replace(/^(id|user):/, "");
const isLive = (s) => s.status === "RUNNING" || s.status === "PAUSED";
const isPageJob = (s) => s.job_type !== "FOLLOW" && s.job_type !== "POST_SCAN";
const unitOf = (s) => (s.job_type === "FOLLOW" ? "UID" : s.job_type === "POST_SCAN" ? "bài viết" : "Page");
const typeLabel = (s) =>
  s.job_type === "FOLLOW" ? "Quét followers page" : s.job_type === "POST_SCAN" ? "Quét bài viết page" : "Quét thông tin page";

/** Nhãn + giá trị cột "Mục tiêu quét" */
function targetOf(s) {
  if (!isPageJob(s)) {
    const count = s.target_pages_count || 0;
    const name = s.target_name || bareKey(s.target_page_key);
    if (name) return { label: "Fanpage:", value: count > 1 ? `${name} (+${count - 1} page)` : name };
    return { label: "", value: s.keyword || "—" };
  }
  if (s.source_type === "HASHTAG") {
    const kw = s.keyword || "—";
    return { label: "Hashtag:", value: kw === "—" || kw.startsWith("#") ? kw : `#${kw}`, link: true };
  }
  if (s.source_type === "SEARCH") return { label: "Từ khóa:", value: s.keyword || "—", link: true };
  return { label: "", value: s.keyword || "—" };
}
const targetText = (s) => {
  const t = targetOf(s);
  return t.label ? `${t.label} ${t.value}` : t.value;
};

/** "100 Page" khi đạt/hoàn thành, "45 / 150 Page" khi còn dở */
function resultOf(s) {
  const done = Number(s.total_unique || 0);
  const goal = Number(s.max_results || 0);
  const ok = s.status === "COMPLETED" || (goal > 0 && done >= goal);
  return { ok, text: ok || !goal ? `${fmtNum(done)} ${unitOf(s)}` : `${fmtNum(done)} / ${fmtNum(goal)} ${unitOf(s)}` };
}

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

function DurationLine({ s }) {
  const Icon = isLive(s) ? Clock : s.status === "COMPLETED" ? CheckCircle2 : CircleStop;
  const text = isLive(s)
    ? "Đang thực hiện"
    : s.status === "COMPLETED"
      ? `Thời gian: ${formatDuration(s.duration_seconds)}`
      : `Dừng lúc ${formatDuration(s.duration_seconds)}`;
  return (
    <span className="mt-0.5 flex items-center gap-1 whitespace-nowrap text-[11px] leading-5 text-[#94A3B8]">
      <Icon className="size-[11px] shrink-0" />
      {text}
    </span>
  );
}

const TH = "px-4 py-5 text-xs font-bold uppercase tracking-[0.6px] text-[#64748B]";
const SELECT_BTN = "!h-[42px] !rounded-xl !border-[#E2E8F0] !bg-[#F8FAFC] !px-3.5 !text-xs !shadow-none";

/* ════════════════════════════════════════════════════════════
   HISTORY MODULE
   ════════════════════════════════════════════════════════════ */
export default function PageScannerHistoryModule() {
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  /* Bộ lọc — mặc định: hôm nay */
  const [search, setSearch] = useState("");
  const [keyword, setKeyword] = useState("");
  const [jobType, setJobType] = useState("");
  const [status, setStatus] = useState("");
  const [range, setRange] = useState("");

  const [selected, setSelected] = useState(() => new Map());
  const [exporting, setExporting] = useState(false);

  /* Detail panel */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailPages, setDetailPages] = useState([]);
  const [detailPagesLoading, setDetailPagesLoading] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [detailTotal, setDetailTotal] = useState(0);

  const requestSeq = useRef(0);
  const detailSeq = useRef(0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /* Đổi bộ lọc → về trang 1, bỏ chọn */
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
    () => ({
      keyword: keyword || undefined,
      job_type: jobType || undefined,
      status: status || undefined,
      ...rangeToParams(range),
    }),
    [keyword, jobType, status, range],
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
        setSessions(data?.items || []);
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

  /* Còn phiên đang chạy → tự cập nhật tiến trình */
  const hasLive = sessions.some(isLive);
  useEffect(() => {
    if (!hasLive || loading) return undefined;
    const t = setInterval(() => loadSessions({ silent: true }), POLL_MS);
    return () => clearInterval(t);
  }, [hasLive, loading, loadSessions]);

  /* Chọn dòng */
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

  /* Xuất Excel: các dòng đã chọn, nếu không chọn thì toàn bộ kết quả lọc */
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
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
        toast.warning("Không có phiên quét nào để xuất.");
        return;
      }
      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.json_to_sheet(
        rows.map((s, i) => ({
          STT: i + 1,
          "Mã phiên": s.id,
          "Loại tác vụ": typeLabel(s),
          "Mục tiêu quét": targetText(s),
          "Kết quả thu thập": Number(s.total_unique || 0),
          "Mục tiêu số lượng": Number(s.max_results || 0),
          "Đơn vị": unitOf(s),
          "Tài khoản": s.account_uid ? String(s.account_uid) : "",
          "Bắt đầu": formatDt(s.started_at),
          "Kết thúc": formatDt(s.finished_at),
          "Thời lượng": isLive(s) ? "" : formatDuration(s.duration_seconds),
          "Trạng thái": STATUS[s.status]?.label || s.status,
          "Lý do dừng": STOP_REASONS[s.stop_reason]?.label || s.stop_reason || "",
          "Lỗi": s.error_message || "",
        })),
      );
      sheet["!cols"] = [5, 9, 22, 34, 16, 18, 10, 18, 20, 20, 14, 14, 22, 40].map((wch) => ({ wch }));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Lịch sử quét page");
      const suffix = range.from || range.to ? `${range.from || "dau"}_${range.to || "nay"}` : "tat_ca";
      XLSX.writeFile(book, `Lich_su_quet_page_${suffix}.xlsx`);
      toast.success(`Đã xuất ${fmtNum(rows.length)} phiên quét.`);
    } catch (err) {
      toast.error(`Lỗi xuất Excel: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  /* Chi tiết phiên */
  const fetchDetailPages = async (session, p) => {
    if (isPageJob(session)) {
      const res = await getScannedPages({ session_id: session.id, page: p, page_size: DETAIL_PAGE_SIZE });
      return { items: res.items || [], pages: Math.ceil((res.total || 0) / DETAIL_PAGE_SIZE) };
    }
    const res = await (session.job_type === "FOLLOW" ? getSessionFollowerPages : getSessionPostPages)(session.id);
    const all = (res.items || []).map((r) => ({
      ...r,
      item_count: r.uid_count ?? r.post_count ?? 0,
      page_url: /^(id|user):/.test(r.page_key) ? `https://www.facebook.com/${bareKey(r.page_key)}` : null,
    }));
    return {
      items: all.slice((p - 1) * DETAIL_PAGE_SIZE, p * DETAIL_PAGE_SIZE),
      pages: Math.ceil(all.length / DETAIL_PAGE_SIZE),
    };
  };

  const loadDetailPages = async (p, session = detail) => {
    if (!session) return;
    const seq = ++detailSeq.current;
    setDetailPagesLoading(true);
    setDetailPage(p);
    try {
      const res = await fetchDetailPages(session, p);
      if (seq !== detailSeq.current) return;
      setDetailPages(res.items);
      setDetailTotal(res.pages);
    } catch (err) {
      if (seq === detailSeq.current) toast.error(`Lỗi tải chi tiết: ${err.message}`);
    } finally {
      if (seq === detailSeq.current) setDetailPagesLoading(false);
    }
  };

  const openDetail = (session) => {
    setDetail(session);
    setDetailOpen(true);
    setDetailPages([]);
    setDetailTotal(0);
    loadDetailPages(1, session);
    getScanSessionDetail(session.id)
      .then((res) =>
        // Giữ mốc thời gian của danh sách (có múi giờ) — API chi tiết trả giờ không kèm múi giờ
        setDetail((cur) =>
          cur?.id === session.id
            ? { ...session, ...res, started_at: session.started_at, finished_at: session.finished_at }
            : cur,
        ),
      )
      .catch((err) => toast.error(`Lỗi tải chi tiết: ${err.message}`));
  };

  const handleStop = async (session) => {
    const ok = await askConfirm({
      title: "Dừng phiên quét",
      description: `Dừng phiên #${session.id} (${targetText(session)})?`,
      confirmText: "Dừng",
      variant: "warning",
    });
    if (!ok) return;
    try {
      await stopScanSession(session.id);
      toast.success("Đã gửi tín hiệu dừng phiên quét");
      loadSessions({ silent: true });
    } catch (err) {
      toast.error(`Không dừng được: ${err.message}`);
    }
  };

  return (
    <div className="pb-8">
      <h1 className="font-heading text-2xl font-bold tracking-[-0.6px] text-[#0F172A]">Lịch sử quét page</h1>
      <p className="mt-1 text-sm text-[#64748B]">
        Theo dõi, quản lý tiến trình và phân tích kết quả dữ liệu Fanpage thu thập theo thời gian thực.
      </p>

      {/* Bộ lọc */}
      <section className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#94A3B8]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm kiếm"
            className="h-[42px] w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] pl-10 pr-9 text-sm text-[#334155] outline-none transition-colors placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white"
          />
          {search && (
            <button
              type="button"
              aria-label="Xóa tìm kiếm"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#475569]"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <CustomSelect className="w-[190px]" buttonClassName={SELECT_BTN} value={jobType} onChange={changeFilter(setJobType)} options={TYPE_OPTIONS} />
        <CustomSelect className="w-[170px]" buttonClassName={SELECT_BTN} value={status} onChange={changeFilter(setStatus)} options={STATUS_OPTIONS} />
        <DateRangeFilter value={range} onChange={changeFilter(setRange)} />
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#059669] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#047857] disabled:opacity-60"
        >
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Xuất báo cáo Excel{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
      </section>

      {/* Bảng phiên quét */}
      <section className="mt-6 rounded-2xl border border-[#E2E8F0] bg-white shadow-sm">
        <div className="overflow-x-auto rounded-t-2xl">
          <table className="w-full min-w-[1080px] text-left">
            <thead className="bg-[#F8FAFC]">
              <tr className="border-b border-[#E2E8F0]">
                <th className="w-12 py-5 pl-4">
                  <Checkbox checked={allChecked} disabled={!sessions.length} onCheckedChange={toggleAll} aria-label="Chọn tất cả trong trang" />
                </th>
                <th className={`${TH} w-14 text-center`}>STT</th>
                <th className={TH}>Loại tác vụ</th>
                <th className={TH}>Mục tiêu quét</th>
                <th className={TH}>Kết quả thu thập</th>
                <th className={TH}>Thời gian</th>
                <th className={TH}>Trạng thái</th>
                <th className={`${TH} w-24 text-center`}>Thao tác</th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-[#F1F5F9] ${loading && sessions.length ? "opacity-60" : ""}`}>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-slate-400">
                    {loading ? (
                      <>
                        <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
                        <p className="text-sm">Đang tải lịch sử phiên...</p>
                      </>
                    ) : (
                      <>
                        <BarChart2 className="mx-auto mb-2 size-8 opacity-30" />
                        <p className="text-sm font-medium">Không có phiên quét nào phù hợp bộ lọc</p>
                        <p className="mt-1 text-xs">Thử đổi khoảng thời gian, loại quét hoặc trạng thái.</p>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                sessions.map((s, idx) => {
                  const target = targetOf(s);
                  const result = resultOf(s);
                  return (
                    <tr key={s.id} className={`transition-colors hover:bg-slate-50 ${s.status === "FAILED" ? "bg-red-50/20" : ""}`}>
                      <td className="py-4 pl-4">
                        <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggleOne(s)} aria-label={`Chọn phiên #${s.id}`} />
                      </td>
                      <td className="px-4 py-4 text-center text-xs font-semibold text-[#94A3B8]">
                        {String((page - 1) * pageSize + idx + 1).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex whitespace-nowrap rounded-full border border-[#DBEAFE] bg-[#EFF6FF] px-2.5 py-1 text-xs font-semibold text-[#1D4ED8]">
                          {typeLabel(s)}
                        </span>
                      </td>
                      <td className="max-w-[260px] px-4 py-4 text-sm">
                        <div className="flex items-center gap-1.5" title={`Phiên #${s.id} · ${targetText(s)}`}>
                          {target.label && <span className="shrink-0 font-medium text-[#0F172A]">{target.label}</span>}
                          <span className={`line-clamp-2 break-words font-semibold ${target.link ? "text-[#2563EB]" : "text-[#0F172A]"}`}>
                            {target.value}
                          </span>
                        </div>
                      </td>
                      <td className={`whitespace-nowrap px-4 py-4 text-xs font-bold ${result.ok ? "text-[#059669]" : "text-[#1E293B]"}`}>
                        {result.text}
                      </td>
                      <td className="px-4 py-4">
                        <span className="whitespace-nowrap text-xs font-medium text-[#1E293B]">{formatDt(s.started_at)}</span>
                        <DurationLine s={s} />
                      </td>
                      <td className="px-4 py-4" title={s.error_message || STOP_REASONS[s.stop_reason]?.label || ""}>
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            title="Xem chi tiết"
                            aria-label="Xem chi tiết"
                            onClick={() => openDetail(s)}
                            className="rounded-lg p-1.5 text-[#64748B] hover:bg-slate-100 hover:text-[#2563EB]"
                          >
                            <Eye className="size-4" />
                          </button>
                          {isLive(s) && (
                            <button
                              type="button"
                              title="Dừng phiên"
                              aria-label="Dừng phiên"
                              onClick={() => handleStop(s)}
                              className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                            >
                              <CircleStop className="size-4" />
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

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-[#E2E8F0] bg-[#F8FAFC]/80 px-6 py-4">
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

      {/* ══════ SESSION DETAIL SLIDE-OVER ══════ */}
      {detailOpen && detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailOpen(false)} />
          <div className="relative z-10 flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="font-bold text-slate-800">
                  Chi tiết phiên #{detail.id}: <span className="text-primary">{targetText(detail)}</span>
                </h2>
                <div className="mt-1 flex items-center gap-2">
                  <StatusBadge status={detail.status} />
                  <StopReasonBadge reason={detail.stop_reason} />
                  <span className="text-[11px] text-slate-400">{formatDt(detail.started_at)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                className="rounded-lg p-1.5 hover:bg-slate-100"
              >
                <X className="size-4 text-slate-500" />
              </button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50">
              {[
                { label: `${unitOf(detail)} duy nhất`, value: detail.total_unique ?? 0, color: "text-primary" },
                { label: "Đã xem", value: detail.total_seen ?? 0, color: "text-slate-700" },
                { label: "Trùng đã loại", value: detail.total_duplicates ?? 0, color: "text-amber-600" },
                { label: "Batch đã cuộn", value: detail.batches_count ?? 0, color: "text-slate-600" },
              ].map(({ label, value, color }) => (
                <div key={label} className="px-5 py-4 text-center">
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Meta info */}
            <div className="flex flex-wrap gap-x-6 gap-y-1.5 border-b border-slate-100 px-6 py-3 text-[11px]">
              <span className="text-slate-400">Tài khoản: <span className="font-semibold text-slate-600 font-mono">{detail.account_uid || "—"}</span></span>
              <span className="text-slate-400">Nguồn: <span className="font-semibold text-slate-600">{detail.source_type}</span></span>
              <span className="text-slate-400">Thời lượng: <span className="font-semibold text-slate-600">{formatDuration(detail.duration_seconds)}</span></span>
              <span className="text-slate-400">Mục tiêu: <span className="font-semibold text-slate-600">{detail.max_results} {unitOf(detail)}</span></span>
            </div>

            {/* Pages list */}
            <div className="flex-1 overflow-auto">
              {detailPagesLoading ? (
                <div className="flex h-full items-center justify-center text-slate-400">
                  <div className="text-center">
                    <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
                    <p className="text-sm">Đang tải danh sách Page...</p>
                  </div>
                </div>
              ) : (
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="w-10 px-4 py-2.5 text-slate-500 font-semibold">STT</th>
                      <th className="px-4 py-2.5 text-slate-500 font-semibold">TÊN PAGE</th>
                      <th className="px-4 py-2.5 text-slate-500 font-semibold">LINK</th>
                      {isPageJob(detail) ? (
                        <>
                          <th className="px-4 py-2.5 text-slate-500 font-semibold">FOLLOWERS</th>
                          <th className="px-4 py-2.5 text-slate-500 font-semibold">BATCH</th>
                        </>
                      ) : (
                        <th className="px-4 py-2.5 text-slate-500 font-semibold uppercase">Số {unitOf(detail)}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detailPages.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-14 text-center text-slate-400">Phiên này chưa thu được dữ liệu.</td>
                      </tr>
                    )}
                    {detailPages.map((p, idx) => (
                      <tr key={p.page_key} className="hover:bg-slate-50">
                        <td className="px-4 py-2 text-slate-400 font-mono">
                          {(detailPage - 1) * DETAIL_PAGE_SIZE + idx + 1}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <Avatar className="size-6 shrink-0">
                              {p.avatar_url && <AvatarImage src={p.avatar_url} />}
                              <AvatarFallback className={AVATAR_COLORS[idx % AVATAR_COLORS.length]}>
                                {initialsOf(p.page_name || "FB")}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="flex items-center gap-1">
                                <span className="font-semibold text-slate-700 truncate max-w-[160px]">{p.page_name || bareKey(p.page_key) || "—"}</span>
                                {p.is_verified === true && <BadgeCheck className="size-3 text-blue-500" />}
                              </div>
                              <span className="text-[10px] text-slate-400 truncate block max-w-[160px]">{p.category}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          {p.page_url ? (
                            <a href={p.page_url} target="_blank" rel="noreferrer"
                               className="flex items-center gap-1 text-primary hover:underline truncate max-w-[180px]">
                              <span className="truncate">
                                {p.page_url.replace("https://www.facebook.com/", "fb.com/")}
                              </span>
                              <ExternalLink className="size-3 shrink-0" />
                            </a>
                          ) : "—"}
                        </td>
                        {isPageJob(detail) ? (
                          <>
                            <td className="px-4 py-2 text-slate-600">
                              {p.follower_count ? p.follower_count.toLocaleString("vi-VN") : "—"}
                            </td>
                            <td className="px-4 py-2 text-slate-400">
                              {p.batch_index ? `Batch ${p.batch_index}` : "—"}
                            </td>
                          </>
                        ) : (
                          <td className="px-4 py-2 font-bold text-[#059669]">{fmtNum(p.item_count)}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Detail pages pagination */}
            {detailTotal > 1 && (
              <div className="flex items-center justify-end gap-1 border-t border-slate-100 px-6 py-3">
                <Pager page={detailPage} totalPages={detailTotal} onChange={(p) => loadDetailPages(p)} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
