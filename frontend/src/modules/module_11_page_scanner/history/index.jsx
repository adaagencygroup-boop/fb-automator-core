"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Search,
  Eye,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  StopCircle,
  Loader2,
  BarChart2,
  X,
  BadgeCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/lib/toast";
import { initialsOf } from "@/modules/module_07_group_spam/shared/components";
import { AVATAR_COLORS } from "@/modules/module_07_group_spam/shared/constants";
import { getScanSessions, getScanSessionDetail, stopScanSession, getScannedPages } from "../service";

/* ─── Helpers ─── */
function StopReasonBadge({ reason }) {
  const map = {
    TARGET_REACHED:  { label: "Đạt mục tiêu",        cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    NO_NEW_RESULTS:  { label: "Hết kết quả",           cls: "bg-blue-50 text-blue-700 border-blue-200" },
    CYCLE_DETECTED:  { label: "Phát hiện lặp vòng",   cls: "bg-violet-50 text-violet-700 border-violet-200" },
    END_MARKER:      { label: "Facebook hết danh sách", cls: "bg-slate-50 text-slate-600 border-slate-200" },
    TIMEOUT:         { label: "Hết thời gian",         cls: "bg-amber-50 text-amber-700 border-amber-200" },
    MAX_SCROLLS:     { label: "Đạt giới hạn cuộn",    cls: "bg-amber-50 text-amber-700 border-amber-200" },
    CHECKPOINT:      { label: "Bị checkpoint",         cls: "bg-red-50 text-red-700 border-red-200" },
    USER_STOPPED:    { label: "Người dùng dừng",       cls: "bg-slate-50 text-slate-600 border-slate-200" },
    ERROR:           { label: "Lỗi",                   cls: "bg-red-50 text-red-700 border-red-200" },
  };
  const info = map[reason] || { label: reason || "—", cls: "bg-slate-50 text-slate-500 border-slate-200" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${info.cls}`}>
      {info.label}
    </span>
  );
}

function StatusBadge({ status }) {
  const map = {
    RUNNING:   { label: "Đang chạy",   cls: "bg-blue-50 text-blue-700",    dot: "bg-blue-500 animate-pulse" },
    COMPLETED: { label: "Hoàn thành",  cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
    PARTIAL:   { label: "Một phần",    cls: "bg-amber-50 text-amber-700",   dot: "bg-amber-500" },
    STOPPED:   { label: "Đã dừng",     cls: "bg-slate-50 text-slate-600",   dot: "bg-slate-400" },
    FAILED:    { label: "Thất bại",    cls: "bg-red-50 text-red-700",       dot: "bg-red-500" },
  };
  const info = map[status] || { label: status, cls: "bg-slate-50 text-slate-500", dot: "bg-slate-400" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${info.cls}`}>
      <span className={`size-1.5 rounded-full ${info.dot}`} />
      {info.label}
    </span>
  );
}

function formatDuration(seconds) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDt(dt) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ════════════════════════════════════════════════════════════
   HISTORY MODULE
   ════════════════════════════════════════════════════════════ */
export default function PageScannerHistoryModule() {
  /* Sessions list */
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessLoading] = useState(false);
  const [sessPage, setSessPage] = useState(1);
  const [sessTotal, setSessTotal] = useState(0);
  const [sessSearch, setSessSearch] = useState("");
  const [sessStatus, setSessStatus] = useState("");

  /* Detail panel */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailPages, setDetailPages] = useState([]);
  const [detailPagesLoading, setDetailPagesLoading] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [detailTotal, setDetailTotal] = useState(0);

  const PAGE_SIZE = 20;
  const DETAIL_PAGE_SIZE = 50;

  /* Load sessions */
  const loadSessions = useCallback(async (p = 1) => {
    setSessLoading(true);
    try {
      const data = await getScanSessions({
        page: p,
        page_size: PAGE_SIZE,
        keyword: sessSearch || undefined,
        status: sessStatus || undefined,
      });
      setSessions(data.items || []);
      setSessTotal(Math.ceil((data.total || 0) / PAGE_SIZE));
    } catch (err) {
      toast.error(`Lỗi tải lịch sử: ${err.message}`);
    } finally {
      setSessLoading(false);
    }
  }, [sessSearch, sessStatus]);

  useEffect(() => {
    let ignore = false;
    getScanSessions({
      page: sessPage,
      page_size: PAGE_SIZE,
      keyword: sessSearch || undefined,
      status: sessStatus || undefined,
    })
      .then((data) => {
        if (!ignore) {
          setSessions(data?.items || []);
          setSessTotal(Math.ceil((data?.total || 0) / PAGE_SIZE));
        }
      })
      .catch((err) => {
        if (!ignore) toast.error(`Lỗi tải lịch sử: ${err.message}`);
      })
      .finally(() => {
        if (!ignore) setSessLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [sessPage, sessSearch, sessStatus]);

  /* Open session detail */
  const openDetail = async (session) => {
    setDetail(session);
    setDetailOpen(true);
    setDetailPages([]);
    setDetailPage(1);
    setDetailTotal(0);
    setDetailPagesLoading(true);
    try {
      const [detailRes, pagesRes] = await Promise.all([
        getScanSessionDetail(session.id),
        getScannedPages({ session_id: session.id, page: 1, page_size: DETAIL_PAGE_SIZE }),
      ]);
      setDetail(detailRes);
      setDetailPages(pagesRes.items || []);
      setDetailTotal(Math.ceil((pagesRes.total || 0) / DETAIL_PAGE_SIZE));
    } catch (err) {
      toast.error(`Lỗi tải chi tiết: ${err.message}`);
    } finally {
      setDetailPagesLoading(false);
    }
  };

  const loadDetailPages = async (p) => {
    if (!detail) return;
    setDetailPagesLoading(true);
    setDetailPage(p);
    try {
      const pagesRes = await getScannedPages({ session_id: detail.id, page: p, page_size: DETAIL_PAGE_SIZE });
      setDetailPages(pagesRes.items || []);
    } catch (err) {
      toast.error(`Lỗi tải trang: ${err.message}`);
    } finally {
      setDetailPagesLoading(false);
    }
  };

  const handleStop = async (sessionId) => {
    try {
      await stopScanSession(sessionId);
      toast.success("Đã gửi tín hiệu dừng phiên quét");
      loadSessions(sessPage);
    } catch (err) {
      toast.error(`Không dừng được: ${err.message}`);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Header card */}
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <h3 className="font-heading text-sm font-bold text-slate-800">Lịch sử phiên quét Fanpage</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Xem lại các phiên quét đã thực hiện, chi tiết từng batch và danh sách Page thu hoạch
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={sessionsLoading}
            onClick={() => loadSessions(sessPage)}
          >
            <RefreshCw className={`size-3.5 ${sessionsLoading ? "animate-spin" : ""}`} />
            Làm mới
          </Button>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
            <Input
              value={sessSearch}
              onChange={e => setSessSearch(e.target.value)}
              placeholder="Tìm theo từ khóa..."
              className="pl-9 h-8 text-[11px]"
            />
          </div>
          <select
            value={sessStatus}
            onChange={e => setSessStatus(e.target.value)}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-[11px] text-slate-600 outline-none focus:border-primary"
          >
            <option value="">Tất cả trạng thái</option>
            <option value="RUNNING">Đang chạy</option>
            <option value="COMPLETED">Hoàn thành</option>
            <option value="PARTIAL">Một phần</option>
            <option value="STOPPED">Đã dừng</option>
            <option value="FAILED">Thất bại</option>
          </select>
        </div>

        {/* Sessions table */}
        <div className="overflow-auto">
          <table className="w-full min-w-[900px] text-left text-[11px]">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 font-semibold text-slate-500">PHIÊN #</th>
                <th className="px-4 py-3 font-semibold text-slate-500">TỪ KHÓA / NGUỒN</th>
                <th className="px-4 py-3 font-semibold text-slate-500">TÀI KHOẢN</th>
                <th className="px-4 py-3 font-semibold text-slate-500">TRẠNG THÁI</th>
                <th className="px-4 py-3 font-semibold text-slate-500">PAGE TÌM THẤY</th>
                <th className="px-4 py-3 font-semibold text-slate-500">LÝ DO DỪNG</th>
                <th className="px-4 py-3 font-semibold text-slate-500">THỜI LƯỢNG</th>
                <th className="px-4 py-3 font-semibold text-slate-500">BẮT ĐẦU</th>
                <th className="px-4 py-3 font-semibold text-slate-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sessionsLoading ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400">
                    <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
                    <p>Đang tải lịch sử phiên...</p>
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400">
                    <BarChart2 className="mx-auto mb-2 size-8 opacity-30" />
                    <p className="text-sm font-medium">Chưa có phiên quét nào</p>
                    <p className="text-[11px]">Chuyển sang tab &quot;Quét thông tin page&quot; để bắt đầu</p>
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-600">#{s.id}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-700 truncate max-w-[180px]">
                        {s.keyword || "—"}
                      </div>
                      <span className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                        s.source_type === "SEARCH" ? "bg-blue-50 text-blue-600"
                          : s.source_type === "UPLOAD" ? "bg-violet-50 text-violet-600"
                          : "bg-slate-100 text-slate-500"
                      }`}>
                        {s.source_type === "SEARCH" ? "Từ khóa" : s.source_type === "UPLOAD" ? "Upload" : "Nhập link"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-400 text-[10px] truncate max-w-[120px]">
                      {s.account_uid || "—"}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-3 font-bold text-primary">{s.total_unique ?? 0}</td>
                    <td className="px-4 py-3"><StopReasonBadge reason={s.stop_reason} /></td>
                    <td className="px-4 py-3 text-slate-500">{formatDuration(s.duration_seconds)}</td>
                    <td className="px-4 py-3 text-slate-400">{formatDt(s.started_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-[10px]"
                          onClick={() => openDetail(s)}
                        >
                          <Eye className="size-3" /> Chi tiết
                        </Button>
                        {s.status === "RUNNING" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-[10px] border-red-200 text-red-600 hover:bg-red-50"
                            onClick={() => handleStop(s.id)}
                          >
                            <StopCircle className="size-3" /> Dừng
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Session pagination */}
        {sessTotal > 1 && (
          <div className="flex items-center justify-end gap-1 border-t border-slate-100 px-6 py-3">
            <Button
              type="button" variant="outline" size="icon" className="size-7"
              disabled={sessPage <= 1} onClick={() => { const p = sessPage - 1; setSessPage(p); loadSessions(p); }}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            {Array.from({ length: Math.min(5, sessTotal) }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => { setSessPage(p); loadSessions(p); }}
                className={`flex size-7 items-center justify-center rounded-md text-[11px] font-semibold ${
                  p === sessPage ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >{p}</button>
            ))}
            <Button
              type="button" variant="outline" size="icon" className="size-7"
              disabled={sessPage >= sessTotal} onClick={() => { const p = sessPage + 1; setSessPage(p); loadSessions(p); }}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
      </Card>

      {/* ══════ SESSION DETAIL SLIDE-OVER ══════ */}
      {detailOpen && detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetailOpen(false)} />
          <div className="relative z-10 flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="font-bold text-slate-800">
                  Chi tiết phiên #{detail.id}: <span className="text-primary">{detail.keyword || "Không có từ khóa"}</span>
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
                { label: "Page duy nhất", value: detail.total_unique ?? 0, color: "text-primary" },
                { label: "DOM đã xem", value: detail.total_seen ?? 0, color: "text-slate-700" },
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
              <span className="text-slate-400">Mục tiêu: <span className="font-semibold text-slate-600">{detail.max_results} Page</span></span>
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
                      <th className="px-4 py-2.5 text-slate-500 font-semibold">FOLLOWERS</th>
                      <th className="px-4 py-2.5 text-slate-500 font-semibold">BATCH</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
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
                                <span className="font-semibold text-slate-700 truncate max-w-[160px]">{p.page_name || "—"}</span>
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
                        <td className="px-4 py-2 text-slate-600">
                          {p.follower_count ? p.follower_count.toLocaleString("vi-VN") : "—"}
                        </td>
                        <td className="px-4 py-2 text-slate-400">
                          {p.batch_index ? `Batch ${p.batch_index}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Detail pages pagination */}
            {detailTotal > 1 && (
              <div className="flex items-center justify-end gap-1 border-t border-slate-100 px-6 py-3">
                {Array.from({ length: Math.min(5, detailTotal) }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => loadDetailPages(p)}
                    className={`flex size-7 items-center justify-center rounded-md text-[11px] font-semibold ${
                      p === detailPage ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >{p}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
