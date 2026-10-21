"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Play,
  Pause,
  Square,
  RotateCcw,
  Filter,
  Check,
  Copy,
  Trash2,
  Loader2,
  ArrowLeft,
  Terminal,
  Clock,
  Sparkles,
  Info
} from "lucide-react";
import { api } from "@/services/api";
import { useFarmLogs, clearFarmLogs } from "../hooks/useFarmLogs";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/lib/toast";
import { EmergencyStopModal } from "./EmergencyStopModal";

const LEVEL_COLORS = {
  SUCCESS: "text-emerald-400",
  WARNING: "text-amber-300",
  ERROR: "text-rose-400",
  INFO: "text-slate-200",
};

export function PostSessionDetailView({ sessionId }) {
  const router = useRouter();
  const pollingRef = useRef(null);
  const logBoxRef = useRef(null);

  const [sessionData, setSessionData] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [copiedUid, setCopiedUid] = useState(null);
  const [selectedThreadFilter, setSelectedThreadFilter] = useState("");

  const [metrics, setMetrics] = useState({
    running: 0,
    paused: 0,
    waiting: 0,
    completed: 0,
    systemError: 0,
    deadAccount: 0,
    stopped: 0,
  });

  const [threads, setThreads] = useState([]);
  const [serverLogs, setServerLogs] = useState([]);

  // Socket logs realtime
  const { logs: wsLogs, connected: wsConnected } = useFarmLogs();

  // Polling runner status
  const fetchStatus = async () => {
    try {
      const res = await api.get("/api/post/status");
      const d = res?.data ?? res;
      if (d) {
        setSessionData(d);
        if (d.metrics) setMetrics(d.metrics);
        if (Array.isArray(d.threads)) setThreads(d.threads);
        if (Array.isArray(d.recent_logs)) setServerLogs(d.recent_logs);
        if (d.is_paused !== undefined) setIsPaused(d.is_paused);
        if (d.is_stopped) setIsStopped(true);
        if (d.session_finished) {
          setIsFinished(true);
          if (pollingRef.current) clearInterval(pollingRef.current);
        }
      }
    } catch (e) {
      // quiet error
    }
  };

  useEffect(() => {
    fetchStatus();
    pollingRef.current = setInterval(fetchStatus, 1500);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [sessionId]);

  // Merge and deduplicate logs
  const combinedLogs = React.useMemo(() => {
    const list = [...wsLogs];
    serverLogs.forEach((sLog) => {
      if (!list.some((l) => l.message === sLog.message && l.time === sLog.timestamp)) {
        list.push({
          time: sLog.timestamp || "--:--:--",
          level: (sLog.type || "INFO").toUpperCase(),
          message: sLog.message,
          thread: sLog.thread,
        });
      }
    });
    return list;
  }, [wsLogs, serverLogs]);

  const filteredLogs = React.useMemo(() => {
    if (!selectedThreadFilter) return combinedLogs;
    return combinedLogs.filter((l) => String(l.thread || "").includes(selectedThreadFilter));
  }, [combinedLogs, selectedThreadFilter]);

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [filteredLogs.length]);

  const handleTogglePause = async () => {
    if (!isPaused) {
      setIsPaused(true);
      try {
        await api.post("/api/post/pause");
      } catch {}
    } else {
      setIsPaused(false);
      try {
        await api.post("/api/post/resume");
      } catch {}
    }
  };

  const handleConfirmEmergencyStop = async () => {
    setIsStopping(true);
    setIsStopped(true);
    setIsPaused(false);
    try {
      await api.post("/api/post/stop");
      toast.info("Đã gửi lệnh dừng khẩn cấp toàn bộ các luồng.", "DỪNG TIẾN TRÌNH");
    } catch (err) {
      console.error("Lỗi dừng khẩn cấp:", err);
    } finally {
      setIsStopping(false);
      setShowEmergencyModal(false);
    }
  };

  const handleCopyLogs = () => {
    const text = filteredLogs.map((l) => `[${l.time}] [${l.thread || "System"}] ${l.message}`).join("\n");
    navigator.clipboard?.writeText(text);
    toast.success(`Đã sao chép ${filteredLogs.length} dòng log vào bộ nhớ tạm!`, "ĐÃ SAO CHÉP");
  };

  // Filter threads by status badge
  const filteredThreads = threads.filter((t) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "running") return t.status === "Đang chạy";
    if (statusFilter === "paused") return t.status === "Tạm dừng";
    if (statusFilter === "waiting") return t.status === "Chờ thực thi";
    if (statusFilter === "completed") return t.status === "Hoàn thành";
    if (statusFilter === "systemError") return t.status === "Lỗi hệ thống";
    if (statusFilter === "deadAccount") return t.status === "Acc chết";
    if (statusFilter === "stopped") return t.status === "Đã dừng";
    return true;
  });

  return (
    <div className="space-y-6 container mx-auto pb-12">
      {/* ── Top Navigation & Session Info ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/interact/post")}
            className="h-9 px-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            <ArrowLeft size={14} />
            <span>Quay lại cấu hình</span>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Chi tiết phiên đăng bài</h1>
              <Badge
                variant={
                  isFinished
                    ? "secondary"
                    : isStopped
                    ? "destructive"
                    : isPaused
                    ? "warning"
                    : sessionData?.is_waiting_schedule
                    ? "outline"
                    : "success"
                }
                className={`rounded-full text-[11px] font-semibold py-0.5 ${
                  sessionData?.is_waiting_schedule && !isFinished && !isStopped && !isPaused
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : ""
                }`}
              >
                {isFinished
                  ? "Hoàn tất phiên"
                  : isStopped
                  ? "Đã dừng"
                  : isPaused
                  ? "Tạm dừng"
                  : sessionData?.is_waiting_schedule
                  ? `Chờ đến giờ hẹn: ${sessionData?.schedule_time || ""}`
                  : "Đang thực thi"}
              </Badge>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              ID Phiên: <span className="text-blue-600 font-semibold">{sessionId}</span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {!isFinished && !isStopped && !(metrics.running === 0 && metrics.waiting === 0 && (metrics.completed + metrics.systemError + metrics.deadAccount + metrics.stopped > 0)) && (
            <button
              type="button"
              onClick={handleTogglePause}
              className={`h-9 px-4 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer transition-all active:scale-95 ${
                isPaused
                  ? "bg-rose-700 text-white hover:bg-rose-800"
                  : "bg-[#f8f9ff] border border-[#be123c] text-[#881337] hover:bg-rose-50/60"
              }`}
            >
              {isPaused ? (
                <>
                  <Play size={13} className="fill-white" />
                  <span>TIẾP TỤC</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" />
                  </svg>
                  <span>TẠM DỪNG</span>
                </>
              )}
            </button>
          )}

          {!isFinished && !isStopped && !(metrics.running === 0 && metrics.waiting === 0 && (metrics.completed + metrics.systemError + metrics.deadAccount + metrics.stopped > 0)) && (
            <button
              type="button"
              onClick={() => setShowEmergencyModal(true)}
              className="h-9 px-4 rounded-xl bg-[#fcdcdc] hover:bg-rose-200 text-[#881337] text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer transition-all active:scale-95"
            >
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" />
              </svg>
              <span>DỪNG KHẨN CẤP</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => router.push("/interact/post")}
            className="h-9 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer transition-all active:scale-95"
          >
            <RotateCcw size={13} />
            <span>TẠO BÀI MỚI</span>
          </button>
        </div>
      </div>

      {/* ── 7 Thống kê Metrics (Figma node 1613:2258) ── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <Activity size={16} className="text-blue-600" />
            <span className="text-sm font-bold text-slate-900">Giám sát tiến trình đăng bài</span>
          </div>
          {statusFilter !== "all" && (
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className="text-xs text-blue-600 hover:underline font-semibold cursor-pointer"
            >
              Bỏ lọc (Xem tất cả)
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === "running" ? "all" : "running")}
            className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${
              statusFilter === "running"
                ? "border-blue-500 ring-2 ring-blue-500/20 shadow-sm bg-blue-50/20"
                : "border-slate-200/80 hover:border-blue-300 hover:shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ĐANG CHẠY</span>
              <span className="w-2 h-2 rounded-full bg-blue-600" />
            </div>
            <span className="text-2xl font-black text-blue-600 mt-1">{metrics.running}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === "paused" ? "all" : "paused")}
            className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${
              statusFilter === "paused"
                ? "border-amber-500 ring-2 ring-amber-500/20 shadow-sm bg-amber-50/20"
                : "border-slate-200/80 hover:border-amber-300 hover:shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">TẠM DỪNG</span>
              <span className="w-2 h-2 rounded-full bg-amber-500" />
            </div>
            <span className="text-2xl font-black text-amber-500 mt-1">{metrics.paused}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === "waiting" ? "all" : "waiting")}
            className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${
              statusFilter === "waiting"
                ? "border-slate-500 ring-2 ring-slate-500/20 shadow-sm bg-slate-50"
                : "border-slate-200/80 hover:border-slate-300 hover:shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">CHỜ THỰC THI</span>
              <span className="w-2 h-2 rounded-full bg-slate-400" />
            </div>
            <span className="text-2xl font-black text-slate-700 mt-1">{metrics.waiting}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === "completed" ? "all" : "completed")}
            className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${
              statusFilter === "completed"
                ? "border-emerald-500 ring-2 ring-emerald-500/20 shadow-sm bg-emerald-50/20"
                : "border-slate-200/80 hover:border-emerald-300 hover:shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">THÀNH CÔNG</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <span className="text-2xl font-black text-emerald-600 mt-1">{metrics.completed}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === "systemError" ? "all" : "systemError")}
            className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${
              statusFilter === "systemError"
                ? "border-rose-500 ring-2 ring-rose-500/20 shadow-sm bg-rose-50/20"
                : "border-slate-200/80 hover:border-rose-300 hover:shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">LỖI HỆ THỐNG</span>
              <span className="w-2 h-2 rounded-full bg-rose-500" />
            </div>
            <span className="text-2xl font-black text-rose-600 mt-1">{metrics.systemError}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === "deadAccount" ? "all" : "deadAccount")}
            className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${
              statusFilter === "deadAccount"
                ? "border-red-600 ring-2 ring-red-600/20 shadow-sm bg-red-50/20"
                : "border-slate-200/80 hover:border-red-400 hover:shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ACC CHẾT</span>
              <span className="w-2 h-2 rounded-full bg-red-700" />
            </div>
            <span className="text-2xl font-black text-red-700 mt-1">{metrics.deadAccount}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === "stopped" ? "all" : "stopped")}
            className={`p-3 rounded-2xl bg-white border transition-all text-left flex flex-col justify-between cursor-pointer ${
              statusFilter === "stopped"
                ? "border-slate-800 ring-2 ring-slate-800/20 shadow-sm bg-slate-100"
                : "border-slate-200/80 hover:border-slate-400 hover:shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ĐÃ DỪNG</span>
              <span className="w-2 h-2 rounded-full bg-slate-800" />
            </div>
            <span className="text-2xl font-black text-slate-800 mt-1">{metrics.stopped}</span>
          </button>
        </div>

        {/* Filter Indicator */}
        {statusFilter !== "all" && (
          <div className="p-2.5 bg-blue-50/60 border border-blue-200/60 rounded-xl flex items-center justify-between text-xs text-blue-700">
            <span className="flex items-center gap-1.5 font-medium">
              <Filter size={13} className="text-blue-600" />
              Đang lọc trạng thái: <strong className="uppercase">{statusFilter}</strong>
            </span>
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className="font-bold underline hover:text-blue-900 cursor-pointer"
            >
              Hiển thị tất cả luồng
            </button>
          </div>
        )}

        {/* Progress Monitoring Table */}
        <div className="overflow-x-auto pt-2">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-[#edf2f7] text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-2.5 px-4">LUỒNG</th>
                <th className="py-2.5 px-4">TÀI KHOẢN</th>
                <th className="py-2.5 px-4">TRẠNG THÁI</th>
                <th className="py-2.5 px-4">NỘI DUNG BÀI ĐĂNG</th>
                <th className="py-2.5 px-4">HOẠT ĐỘNG HIỆN TẠI</th>
                <th className="py-2.5 px-4">THỜI GIAN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredThreads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    {threads.length === 0
                      ? "Đang khởi tạo các luồng chạy..."
                      : "Không có luồng nào khớp với bộ lọc."}
                  </td>
                </tr>
              ) : (
                filteredThreads.map((row) => (
                  <tr key={row.id || row.threadId} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-bold text-blue-600">
                      {row.threadId}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="space-y-0.5">
                        <p className="font-bold text-slate-800 text-xs">{row.accountName}</p>
                        <p className="text-[10px] font-mono text-slate-400">{row.accountUid}</p>
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                        row.status === "Đang chạy"
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : row.status === "Tạm dừng"
                          ? "bg-amber-50 text-amber-700 border border-amber-200"
                          : row.status === "Hoàn thành"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : row.status === "Lỗi hệ thống"
                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                          : row.status === "Acc chết"
                          ? "bg-red-100 text-red-800 border border-red-300"
                          : "bg-slate-100 text-slate-700 border border-slate-200"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          row.status === "Đang chạy"
                            ? "bg-blue-600 animate-ping"
                            : row.status === "Tạm dừng"
                            ? "bg-amber-500"
                            : row.status === "Hoàn thành"
                            ? "bg-emerald-500"
                            : "bg-slate-600"
                        }`} />
                        {row.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 max-w-[200px] truncate text-slate-700 font-mono text-[11px]" title={row.contentPreview}>
                      {row.contentPreview || "--"}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="flex items-center gap-1.5 text-slate-700 text-xs font-medium">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          row.status === "Đang chạy" ? "bg-blue-500" : "bg-amber-500"
                        }`} />
                        {row.currentActivity || "Đang xử lý..."}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 text-xs">
                      {row.elapsedTime || "0:00"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Khung Live Automation Log Console (Có log realtime từ Socket) ── */}
      <div className="bg-[#1E293B] rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/80 px-5 py-3.5 bg-slate-900/60">
          <div className="flex items-center gap-3">
            <span className="flex gap-1.5">
              <span className="h-3 w-3 rounded-full bg-red-500 shadow-xs" />
              <span className="h-3 w-3 rounded-full bg-amber-400 shadow-xs" />
              <span className="h-3 w-3 rounded-full bg-emerald-500 shadow-xs" />
            </span>
            <div className="flex items-center gap-2">
              <Terminal size={14} className="text-slate-300" />
              <span className="text-xs font-bold text-slate-200 tracking-wide">
                Live Automation Log Console
              </span>
            </div>
            <select
              value={selectedThreadFilter}
              onChange={(e) => setSelectedThreadFilter(e.target.value)}
              className="h-7 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-[11px] text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="">Tất cả luồng</option>
              {Array.from(new Set(threads.map((t) => t.threadId))).map((thId) => (
                <option key={thId} value={thId}>
                  {thId}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 text-[11px] font-bold">
            <span className={`flex items-center gap-1.5 ${wsConnected ? "text-emerald-400" : "text-amber-400"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${wsConnected ? "bg-emerald-400" : "bg-amber-400"}`} />
              {wsConnected ? "WEBSOCKET KẾT NỐI (28129)" : "POLLING KẾT NỐI"}
            </span>
            <span className="text-slate-400 font-mono">{filteredLogs.length} dòng log</span>
            <button
              type="button"
              onClick={handleCopyLogs}
              className="p-1 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
              title="Sao chép toàn bộ log"
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              onClick={clearFarmLogs}
              className="p-1 text-slate-400 hover:text-white rounded transition-colors cursor-pointer"
              title="Xóa log trên màn hình"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Scrollable log area */}
        <div
          ref={logBoxRef}
          className="h-80 space-y-1.5 overflow-y-auto px-5 py-3.5 font-mono text-xs leading-relaxed selection:bg-blue-600/30"
        >
          {filteredLogs.length > 0 ? (
            filteredLogs.map((log, idx) => (
              <div key={idx} className="flex items-start gap-2.5 hover:bg-slate-800/40 px-1 rounded transition-colors">
                <span className="shrink-0 text-slate-500 select-none">[{log.time}]</span>
                {log.thread && (
                  <span className="shrink-0 text-blue-400 font-semibold select-none">
                    [{log.thread}]
                  </span>
                )}
                <span className={`break-all ${LEVEL_COLORS[log.level] || LEVEL_COLORS.INFO}`}>
                  {log.message}
                </span>
              </div>
            ))
          ) : (
            <div className="text-slate-500 italic py-6 text-center">
              Đang kết nối luồng sự kiện... Log của phiên đăng bài sẽ hiển thị trực tiếp tại đây.
            </div>
          )}
        </div>
      </div>

      {/* Modal xác nhận DỪNG KHẨN CẤP */}
      <EmergencyStopModal
        isOpen={showEmergencyModal}
        onClose={() => setShowEmergencyModal(false)}
        onConfirm={handleConfirmEmergencyStop}
        isStopping={isStopping}
      />
    </div>
  );
}
