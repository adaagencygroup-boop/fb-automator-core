"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Play,
  Pause,
  Square,
  RotateCcw,
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
import { PostProgressPreview } from "./PostProgressPreview";

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
  const [previewPostId, setPreviewPostId] = useState(null);
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
        if (Array.isArray(d.threads) && d.threads.length > 0) {
          setThreads((prev) => {
            if (!prev?.length || d.threads.length >= prev.length) return d.threads;
            const used = new Set();
            const updated = prev.map((row) => {
              const byId = d.threads.find((t) => String(t.id) === String(row.id));
              if (byId) {
                used.add(String(byId.id));
                return { ...row, ...byId };
              }
              return row;
            });
            for (const t of d.threads) {
              const tid = String(t.id || t.threadId || "");
              if (tid && !used.has(tid) && !updated.some((r) => String(r.id) === tid)) {
                updated.push(t);
              }
            }
            return updated;
          });
        }
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
    if (pollingRef.current) clearInterval(pollingRef.current);

    // Giữ màn giám sát giống khi chạy xong — ẩn Pause/Stop, hiện nút tạo bài mới
    setThreads((prev) =>
      prev.map((r) =>
        r.status === "Hoàn thành" || r.status === "Lỗi hệ thống" || r.status === "Acc chết"
          ? r
          : { ...r, status: "Đã dừng", currentActivity: "Đã dừng theo yêu cầu (khẩn cấp)" }
      )
    );
    setMetrics((prev) => {
      const stoppedNow = Math.max(
        1,
        (prev.running || 0) + (prev.paused || 0) + (prev.waiting || 0) + (prev.stopped || 0)
      );
      return {
        ...prev,
        running: 0,
        paused: 0,
        waiting: 0,
        stopped: stoppedNow,
      };
    });

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

      {/* ── 7 Thống kê Metrics — chỉ hiển thị tổng quan, không lọc ── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
          <Activity size={16} className="text-blue-600" />
          <span className="text-sm font-bold text-slate-900">Giám sát tiến trình đăng bài</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 md:grid-cols-7">
          <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
            <div className="flex w-full items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">ĐANG CHẠY</span>
              <span className="h-2 w-2 rounded-full bg-blue-600" />
            </div>
            <span className="mt-1 text-2xl font-black text-blue-600">{metrics.running}</span>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
            <div className="flex w-full items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">TẠM DỪNG</span>
              <span className="h-2 w-2 rounded-full bg-amber-500" />
            </div>
            <span className="mt-1 text-2xl font-black text-amber-500">{metrics.paused}</span>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
            <div className="flex w-full items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">CHỜ THỰC THI</span>
              <span className="h-2 w-2 rounded-full bg-slate-400" />
            </div>
            <span className="mt-1 text-2xl font-black text-slate-700">{metrics.waiting}</span>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
            <div className="flex w-full items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">THÀNH CÔNG</span>
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
            <span className="mt-1 text-2xl font-black text-emerald-600">{metrics.completed}</span>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
            <div className="flex w-full items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">LỖI HỆ THỐNG</span>
              <span className="h-2 w-2 rounded-full bg-rose-500" />
            </div>
            <span className="mt-1 text-2xl font-black text-rose-600">{metrics.systemError}</span>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
            <div className="flex w-full items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">ACC CHẾT</span>
              <span className="h-2 w-2 rounded-full bg-red-700" />
            </div>
            <span className="mt-1 text-2xl font-black text-red-700">{metrics.deadAccount}</span>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-3 text-left">
            <div className="flex w-full items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">ĐÃ DỪNG</span>
              <span className="h-2 w-2 rounded-full bg-slate-800" />
            </div>
            <span className="mt-1 text-2xl font-black text-slate-800">{metrics.stopped}</span>
          </div>
        </div>

        <PostProgressPreview
          rows={threads}
          postType={sessionData?.post_type || "status"}
          selectedId={previewPostId}
          onSelectId={setPreviewPostId}
        />

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
              {threads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    {threads.length === 0
                      ? "Đang khởi tạo các luồng chạy..."
                      : "Không có luồng nào khớp với bộ lọc."}
                  </td>
                </tr>
              ) : (
                threads.map((row) => (
                  <tr
                    key={row.id || row.threadId}
                    className={`hover:bg-slate-50/70 transition-colors cursor-pointer ${
                      String(previewPostId) === String(row.id || row.threadId) ? "bg-blue-50/50" : ""
                    }`}
                    onClick={() => setPreviewPostId(String(row.id || row.threadId))}
                  >
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
                    <td className="py-2.5 px-4 max-w-[200px] truncate text-slate-700 font-mono text-[11px]" title={row.content || row.contentPreview}>
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
