"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Layers, X, Copy, ExternalLink, Play, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { renderTypeBadge, renderStatusBadge } from "./HistoryDataTable";

export default function SessionDetailModal({
  isOpen,
  onClose,
  session,
  detailModalTab,
  onTabChange,
  onResume,
  resumingId = null,
  mounted = true,
}) {
  // ESC key listener to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!mounted || !isOpen || !session) return null;

  const currentTab = ["results", "logs"].includes(detailModalTab) ? detailModalTab : "overview";
  const sessionLogs = Array.isArray(session.logs) ? session.logs : [];
  const LOG_TONE = {
    SUCCESS: "text-emerald-400",
    WARNING: "text-amber-400",
    ERROR: "text-rose-400",
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-md animate-in fade-in duration-200 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200/90 overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[85vh] select-text">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-[#F8FAFC]">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#2563EB] shrink-0">
              <Layers className="size-4.5" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Chi tiết phiên #{session.id}
                </h3>
                {renderTypeBadge(session.type)}
                {renderStatusBadge(session.status)}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Khởi tạo lúc: {session.startTime} • Thời lượng: {session.duration || "—"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {session.resumable && onResume && (
              <button
                type="button"
                onClick={() => onResume(session)}
                disabled={Boolean(resumingId)}
                title="Quét nốt phần còn thiếu của phiên này (cùng nick & cấu hình)"
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {resumingId === session.id ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                Chạy tiếp ({session.remainingItems} còn thiếu)
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="size-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Đóng cửa sổ"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Modal Nav Tabs */}
        <div className="flex items-center gap-6 px-6 border-b border-slate-100 bg-white text-xs font-semibold">
          <button
            type="button"
            onClick={() => onTabChange("overview")}
            className={`py-3.5 border-b-2 transition-colors cursor-pointer ${
              currentTab === "overview"
                ? "border-[#2563EB] text-[#2563EB]"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            Tổng quan & Cấu hình
          </button>
          <button
            type="button"
            onClick={() => onTabChange("results")}
            className={`py-3.5 border-b-2 transition-colors cursor-pointer ${
              currentTab === "results"
                ? "border-[#2563EB] text-[#2563EB]"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            Dữ liệu mẫu ({session.sampleResults?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => onTabChange("logs")}
            className={`py-3.5 border-b-2 transition-colors cursor-pointer ${
              currentTab === "logs"
                ? "border-[#2563EB] text-[#2563EB]"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            Nhật ký ({sessionLogs.length})
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          {/* TAB 1: OVERVIEW */}
          {currentTab === "overview" && (
            <div className="space-y-4">
              {/* Account & Target Card */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-200/80 p-4 bg-[#F8FAFC]/50 space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Tài khoản thực thi
                  </span>
                  <div className="flex items-center gap-3 pt-1">
                    <div
                      className={`size-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                        session.account?.avatarBg || "bg-blue-600"
                      }`}
                    >
                      {session.account?.avatarText || "FB"}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-slate-900 truncate">
                        {session.account?.name || "Tài khoản quét"}
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        UID: {session.account?.uid || "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200/80 p-4 bg-[#F8FAFC]/50 space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Mục tiêu / Từ khóa quét
                  </span>
                  <div className="pt-1">
                    <p className="font-bold text-slate-900 text-sm truncate" title={session.target}>
                      {session.target}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate" title={session.title}>
                      {session.title}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress & Result Box */}
              <div className="rounded-xl border border-slate-200/80 p-4 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">
                    Kết quả thu thập: {session.progress?.collected || 0} /{" "}
                    {session.progress?.target || 0}{" "}
                    {session.progress?.unit || "nhóm"}
                  </span>
                  <span className="font-bold text-[#2563EB]">
                    {session.progress?.percentage || 0}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-[#2563EB] rounded-full transition-all"
                    style={{
                      width: `${session.progress?.percentage || 0}%`,
                    }}
                  />
                </div>
              </div>

              {/* Config Grid */}
              <div className="rounded-xl border border-slate-200/80 p-4 bg-white space-y-2.5">
                <h4 className="font-bold text-slate-900 pb-2 border-b border-slate-100">
                  Cấu hình tham số phiên quét
                </h4>
                <div className="grid grid-cols-2 gap-y-2 text-[11px]">
                  {Object.entries(session.config || {}).map(([key, val]) => (
                    <div key={key} className="flex flex-col">
                      <span className="text-slate-500 capitalize">{key}:</span>
                      <span className="font-semibold text-slate-800">
                        {String(val)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: LOGS */}
          {currentTab === "logs" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-500">
                  Nhật ký thực thi đã lưu của phiên ({sessionLogs.length} dòng cuối):
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      sessionLogs.map((l) => `[${l.time || ""}] [${l.level || ""}] ${l.message || ""}`).join("\n")
                    );
                    toast.success("Đã copy nhật ký vào Clipboard!");
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline cursor-pointer"
                >
                  <Copy className="size-3" />
                  <span>Copy nhật ký</span>
                </button>
              </div>
              <div className="max-h-[380px] overflow-y-auto rounded-xl bg-[#0F172A] p-3 font-mono text-[11px] leading-5">
                {sessionLogs.length === 0 ? (
                  <p className="text-slate-400">Chưa có nhật ký cho phiên này.</p>
                ) : (
                  sessionLogs.map((line, idx) => (
                    <div key={idx} className="flex gap-2">
                      <span className="shrink-0 text-slate-500">{line.time || "--:--:--"}</span>
                      <span className={`break-words ${LOG_TONE[String(line.level || "").toUpperCase()] || "text-slate-300"}`}>
                        {line.message}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 2: SAMPLE RESULTS */}
          {currentTab === "results" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-semibold text-slate-500">
                  Hiển thị mẫu {session.progress?.unit || "kết quả"} đã trích xuất được trong phiên:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      JSON.stringify(session.sampleResults || [], null, 2)
                    );
                    toast.success("Đã copy dữ liệu mẫu vào Clipboard!");
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline cursor-pointer"
                >
                  <Copy className="size-3" />
                  <span>Copy toàn bộ JSON</span>
                </button>
              </div>

              <div className="space-y-2 max-h-[380px] overflow-y-auto">
                {!session.sampleResults || session.sampleResults.length === 0 ? (
                  <div className="p-6 text-center text-slate-400">
                    Chưa có dữ liệu mẫu nào được lưu cho phiên này.
                  </div>
                ) : (
                  session.sampleResults.map((res, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-slate-200/80 bg-[#F8FAFC]/50 hover:bg-white transition-colors flex items-center justify-between"
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="font-bold text-slate-900 truncate">
                          {res.name || res.title || res.group_name}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {res.members ||
                            res.members_label ||
                            res.privacy ||
                            "—"}
                        </span>
                      </div>
                      {(res.url || res.href) && (
                        <a title="Mở trên Facebook"
                          href={res.url || res.href}
                          target="_blank"
                          rel="noreferrer"
                          className="size-7 rounded-md border border-slate-300 flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0 cursor-pointer"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
