"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronDown, Download, Eraser, FilterX, Info, Search } from "lucide-react";
import CustomSelect from "@/components/ui/custom-select";
import Pagination from "@/components/ui/pagination";
import { toast } from "@/lib/toast";
import { formatVietnamDateTime } from "@/lib/date-utils";
import { ACTION_FULL_LABELS, FINAL_STATUSES, FRIEND_SOURCE_LABELS, GROUP_SOURCE_LABELS, PROXY_MODE_LABELS, RUN_STATUS } from "../constants";
import {
  cleanupFarmHistory,
  downloadFarmHistoryCsv,
  downloadFarmHistoryXlsx,
  getFarmHistory,
  getFarmHistoryAccounts,
} from "../service";
import HistoryDetail from "./HistoryDetail";
import { HistoryView } from "./HistoryView";
import { ActionChip, NumberInput, PageTitle, RunStatusBadge, UidCopy, formatDuration } from "./parts";

const PAGE_SIZE = 10;
const ALL_ACCOUNTS = { value: "", label: "Tất cả tài khoản" };

// [{ uid, name }] -> lựa chọn của bộ lọc: hiện tên nick, chưa có tên thì UID, trùng tên thì thêm UID để phân biệt
export function accountFilterOptions(accounts) {
  const list = (Array.isArray(accounts) ? accounts : []).filter((a) => a?.uid);
  const counts = {};
  list.forEach((a) => {
    if (a.name) counts[a.name] = (counts[a.name] || 0) + 1;
  });
  return [
    ALL_ACCOUNTS,
    ...list.map((a) => ({
      value: a.uid,
      label: !a.name ? a.uid : counts[a.name] > 1 ? `${a.name} (${a.uid})` : a.name,
    })),
  ];
}
const EMPTY_FILTERS = { search: "", fb_uid: "", action: "", status: "", proxy: "", date_from: "", date_to: "" };

const ACTION_OPTIONS = [{ value: "", label: "Tất cả hành động" }, ...Object.entries(ACTION_FULL_LABELS).map(([value, label]) => ({ value, label }))];
// Không có "Acc chết": BE lọc "Lỗi hệ thống" ra cả lượt nick chết / mất phiên (repository.HISTORY_STATUS_FILTER)
const STATUS_OPTIONS = [
  { value: "", label: "Tất cả trạng thái" },
  ...FINAL_STATUSES.filter((value) => value !== "DIE").map((value) => ({ value, label: RUN_STATUS[value].label })),
];
const PROXY_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "with", label: "Có proxy" },
  { value: "without", label: "Không proxy (IP máy)" },
];

/** Các dòng mô tả kết quả từng kịch bản của 1 lượt */
function scenarioLines(h) {
  const actions = h.actions_summary || [];
  const has = (a) => actions.some((x) => x.action === a);
  const lines = [];
  if (has("CHECK_NOTIF")) lines.push(h.notif_checked ? (h.notif_opened ? "Đã xem & mở thông báo mới" : "Đã xem thông báo") : "Chưa xem được thông báo");
  const reacted = (n) => (n ? `, thả ${n} cảm xúc` : "");
  if (has("NEWSFEED")) lines.push(`Lướt Newsfeed ${formatDuration(h.newsfeed_seconds)}, ${h.newsfeed_scrolls} lần cuộn${reacted(h.newsfeed_reactions)}`);
  if (has("WATCH")) lines.push(`Xem ${h.watch_videos} video trong ${formatDuration(h.watch_seconds)}${reacted(h.watch_reactions)}`);
  if (has("STORY")) lines.push(`Xem ${h.story_frames || 0} story trong ${formatDuration(h.story_seconds)}${reacted(h.story_reactions)}`);
  if (has("ADD_FRIEND")) {
    lines.push(`Gửi ${h.friends_sent} lời mời kết bạn${h.friends_source ? ` (${FRIEND_SOURCE_LABELS[h.friends_source] || h.friends_source})` : ""}`);
  }
  if (has("LEAVE_GROUP")) lines.push(`Rời ${h.groups_left || 0} nhóm`);
  if (has("JOIN_GROUP")) {
    const source = h.groups_source === "list" ? ` (${GROUP_SOURCE_LABELS.list})` : h.groups_keyword ? `: "${h.groups_keyword}"` : " (đề xuất)";
    lines.push(`Tham gia ${h.groups_joined} nhóm${source}`);
  }
  return lines;
}

function CleanupDialog({ onClose, onDone }) {
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      const res = await cleanupFarmHistory(Math.max(1, parseInt(days, 10) || 1));
      toast.success(`Đã xóa ${res.history} lượt lịch sử, ${res.logs} log hành động`, "ĐÃ DỌN NHẬT KÝ");
      onDone();
      onClose();
    } catch (err) {
      toast.error(err.message, "KHÔNG DỌN ĐƯỢC NHẬT KÝ");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && !loading && onClose()}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-2xl">
        <h3 className="text-base font-bold text-slate-900">Dọn dẹp nhật ký Tương tác</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          Xóa lịch sử và log hành động của máy này cũ hơn số ngày bên dưới (tính cả hôm nay, giờ Việt Nam). Dữ liệu hôm nay luôn được giữ để
          tính giới hạn kết bạn / nhóm mỗi ngày; lượt đang chạy không bị xóa.
        </p>
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
          Giữ lại
          <NumberInput value={days} onChange={setDays} min={1} max={3650} className="w-20" />
          ngày gần nhất
        </div>
        <div className="mt-6 flex justify-end gap-2.5">
          <button type="button" onClick={onClose} disabled={loading} className="h-8 rounded-md border border-border bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Hủy bỏ
          </button>
          <button type="button" onClick={submit} disabled={loading} className="h-8 rounded-md bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {loading ? "Đang dọn..." : "Dọn dẹp"}
          </button>
        </div>
      </div>
    </div>
  );
}

const EXPORT_FORMATS = [
  { format: "xlsx", label: "Excel (.xlsx)", hint: "Giờ Việt Nam, mở thẳng bằng Excel", download: downloadFarmHistoryXlsx },
  { format: "csv", label: "CSV (.csv)", hint: "Dữ liệu thô, giờ UTC", download: downloadFarmHistoryCsv },
];

/** 1 nút xuất file, bấm ra menu chọn định dạng */
function ExportMenu({ exporting, onExport }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={exporting}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-xs sm:text-sm font-semibold text-emerald-700 shadow-2xs hover:bg-emerald-100 transition-all cursor-pointer disabled:opacity-60"
      >
        <Download className="h-4 w-4 text-emerald-600" />
        <span>{exporting ? "Đang xuất..." : "Xuất Excel / CSV"}</span>
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg animate-in fade-in zoom-in-95 duration-100">
          {EXPORT_FORMATS.map((item) => (
            <button
              key={item.format}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onExport(item);
              }}
              className="flex w-full flex-col px-3.5 py-2 text-left hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <span className="text-xs sm:text-sm font-semibold text-slate-800">{item.label}</span>
              <span className="text-[11px] text-slate-400">{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InteractionHistory() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ key: null, total: 0, items: [] });
  const [detailId, setDetailId] = useState(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [accountOptions, setAccountOptions] = useState([ALL_ACCOUNTS]);

  // Bộ lọc theo tài khoản: nick đã có lịch sử trên máy này (tải lại sau khi dọn lịch sử)
  useEffect(() => {
    let cancelled = false;
    getFarmHistoryAccounts()
      .then((accounts) => {
        if (!cancelled) setAccountOptions(accountFilterOptions(accounts));
      })
      .catch((err) => {
        if (!cancelled) toast.error({ key: "farm-history-accounts", title: "KHÔNG TẢI ĐƯỢC DANH SÁCH TÀI KHOẢN", message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Gõ tìm kiếm: chờ 400ms mới gọi API
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.search === search ? f : { ...f, search }));
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Mỗi tổ hợp bộ lọc / trang / lần tải lại có 1 key; kết quả chưa khớp key hiện tại nghĩa là đang tải
  const requestKey = JSON.stringify([filters, page, reloadKey]);
  const loading = result.key !== requestKey;
  const data = result;

  useEffect(() => {
    let cancelled = false;
    getFarmHistory(filters, page, PAGE_SIZE)
      .then((res) => !cancelled && setResult({ key: requestKey, total: res.total || 0, items: res.items || [] }))
      .catch((err) => {
        if (cancelled) return;
        toast.error({ key: "farm-history", title: "KHÔNG ĐỌC ĐƯỢC LỊCH SỬ", message: err.message });
        setResult((r) => ({ ...r, key: requestKey }));
      });
    return () => {
      cancelled = true;
    };
  }, [filters, page, requestKey]);

  const setFilter = (key) => (value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  // Nút "Xóa lọc" chỉ hiện khi đang lọc (kể cả ô tìm kiếm đang gõ dở)
  const filtering = Boolean(search) || Object.keys(EMPTY_FILTERS).some((key) => filters[key] !== EMPTY_FILTERS[key]);
  const clearFilters = () => {
    setSearch("");
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const exportFile = useCallback(async ({ download }) => {
    setExporting(true);
    try {
      const { fileName, rows } = (await download(filters)) || {};
      toast.success(
        rows != null ? `Đã xuất ${rows} lượt ra file ${fileName}` : `Đã xuất file ${fileName || ""}`.trim(),
        "XUẤT FILE THÀNH CÔNG"
      );
    } catch (err) {
      toast.error(err.message, "KHÔNG XUẤT ĐƯỢC FILE");
    } finally {
      setExporting(false);
    }
  }, [filters]);

  const exportCsv = useCallback(() => exportFile(EXPORT_FORMATS[1]), [exportFile]);

  useEffect(() => {
    const onCleanup = () => setCleanupOpen(true);
    const onExport = (e) => {
      const fmt = e?.detail?.format || "xlsx";
      if (fmt === "csv") {
        exportFile(EXPORT_FORMATS[1]);
      } else {
        exportFile(EXPORT_FORMATS[0]);
      }
    };
    window.addEventListener("trigger-farm-cleanup", onCleanup);
    window.addEventListener("trigger-farm-export", onExport);
    return () => {
      window.removeEventListener("trigger-farm-cleanup", onCleanup);
      window.removeEventListener("trigger-farm-export", onExport);
    };
  }, [exportFile]);

  const totalPages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));

  return (
    <>
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-white p-4 shadow-subtle lg:flex-row lg:items-center">
        <CustomSelect
          className="lg:w-56"
          value={filters.fb_uid}
          onChange={setFilter("fb_uid")}
          options={accountOptions}
          placeholder="Chọn tài khoản..."
        />
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo UID nick, tên nick..."
            className="h-10 w-full rounded-lg border border-blue-200 bg-white pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <CustomSelect className="lg:w-44" value={filters.action} onChange={setFilter("action")} options={ACTION_OPTIONS} />
        <CustomSelect className="lg:w-44" value={filters.status} onChange={setFilter("status")} options={STATUS_OPTIONS} />
        <CustomSelect className="lg:w-44" value={filters.proxy} onChange={setFilter("proxy")} options={PROXY_OPTIONS} />
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="date" value={filters.date_from} max={filters.date_to || undefined} onChange={(e) => setFilter("date_from")(e.target.value)} className="h-9 rounded-lg border border-border px-2 text-xs text-slate-700" title="Từ ngày" />
          <span>→</span>
          <input type="date" value={filters.date_to} min={filters.date_from || undefined} onChange={(e) => setFilter("date_to")(e.target.value)} className="h-9 rounded-lg border border-border px-2 text-xs text-slate-700" title="Đến ngày" />
        </div>
        {filtering && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100"
          >
            <FilterX className="h-3.5 w-3.5" />
            Xóa lọc
          </button>
        )}
      </div>

      <div className="overflow-auto rounded-2xl border border-border bg-white shadow-subtle">
        <table className="w-full text-xs">
          <thead className="bg-[#F1F5F9] text-[11px] font-bold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left">STT</th>
              <th className="px-4 py-3 text-left">Thời gian</th>
              <th className="px-4 py-3 text-left">Tài khoản / UID Facebook</th>
              <th className="px-4 py-3 text-left">Hành động tương tác</th>
              <th className="px-4 py-3 text-left">Chi tiết kịch bản</th>
              <th className="px-4 py-3 text-left">Proxy / IP</th>
              <th className="px-4 py-3 text-left">Trạng thái</th>
              <th className="px-4 py-3 text-center">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.items.map((h, idx) => {
              const finished = formatVietnamDateTime(h.finished_at);
              const lines = scenarioLines(h);
              return (
                <tr key={h.id} className="align-top hover:bg-slate-50/70">
                  <td className="px-4 py-3.5 text-sm text-slate-500">{String((page - 1) * PAGE_SIZE + idx + 1).padStart(2, "0")}</td>
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <div className="text-sm font-semibold text-slate-800">{finished.timeWithSeconds}</div>
                    <div className="text-[11px] text-slate-500">{finished.date}</div>
                    <div className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      Thời lượng {formatDuration(h.duration_seconds)}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="text-sm font-semibold text-slate-800">{h.fb_name || "—"}</div>
                    <UidCopy uid={h.fb_uid} />
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {(h.actions_summary || []).map((a, i) => (
                        <ActionChip key={`${a.action}-${i}`} action={a.action} status={a.status} />
                      ))}
                      {!h.actions_summary?.length && <span className="text-slate-400">—</span>}
                    </div>
                  </td>
                  <td className="max-w-[300px] px-4 py-3.5 text-slate-700">
                    {lines.length ? (
                      <ul className="space-y-0.5">
                        {lines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5">
                    <div className="font-mono text-[11px] text-slate-700">{h.proxy_host || "IP máy"}</div>
                    {h.proxy_host && (
                      <div className="text-[10px] text-slate-400">
                        {PROXY_MODE_LABELS[h.proxy_mode] || h.proxy_mode || ""}
                        {h.egress_ip ? ` · ${h.egress_ip}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <RunStatusBadge status={h.final_status} />
                    {h.error && (
                      <div className="mt-1 line-clamp-2 max-w-[200px] text-[10px] text-rose-600" title={h.error}>
                        {h.error}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <button type="button" onClick={() => setDetailId(h.id)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary" title="Xem chi tiết">
                      <Info className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!data.items.length && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">
                  {loading ? "Đang tải lịch sử..." : "Chưa có lượt tương tác nào khớp bộ lọc."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-slate-600">
          Hiển thị {data.items.length} / {(data.total || 0).toLocaleString("vi-VN")} phiên tương tác
        </span>
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
      </div>

      {detailId != null && <HistoryDetail id={detailId} onClose={() => setDetailId(null)} />}
      {cleanupOpen && (
        <CleanupDialog
          onClose={() => setCleanupOpen(false)}
          onDone={() => {
            setPage(1);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}

export default function FarmHistory() {
  const [tab, setTab] = useState("post");

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageTitle
        title="Lịch sử Đăng bài và tương tác tài khoản"
        description="Tự động tương tác Newsfeed, xem Watch, kết bạn, tham gia nhóm và đăng bài đa kênh giữ trust profile Facebook bền vững."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200/60 bg-slate-100 p-1 shadow-2xs">
          {[
            ["post", "Đăng Facebook"],
            ["interact", "Tương tác tài khoản"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded-lg px-5 py-2 text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                tab === value
                  ? "bg-[#1877F2] text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Nút hành động chuẩn dùng chung cho cả 2 tab */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              if (tab === "post") {
                window.dispatchEvent(new CustomEvent("trigger-post-cleanup"));
              } else {
                window.dispatchEvent(new CustomEvent("trigger-farm-cleanup"));
              }
            }}
            className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs sm:text-sm font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-all cursor-pointer"
          >
            <Eraser className="h-4 w-4 text-slate-600" />
            <span>Dọn dẹp nhật ký</span>
          </button>
          <ExportMenu
            onExport={(item) => {
              if (tab === "post") {
                window.dispatchEvent(new CustomEvent("trigger-post-export", { detail: { format: item.format } }));
              } else {
                window.dispatchEvent(new CustomEvent("trigger-farm-export", { detail: { format: item.format } }));
              }
            }}
          />
        </div>
      </div>

      {tab === "interact" ? (
        <InteractionHistory />
      ) : (
        <HistoryView />
      )}
    </div>
  );
}
