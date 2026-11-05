"use client";

import { createPortal } from "react-dom";
import { Layers, X, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "@/lib/toast";
import { renderTypeBadge, renderStatusBadge } from "./HistoryDataTable";

export default function SessionDetailModal({
  isOpen,
  onClose,
  session,
  detailModalTab,
  onTabChange,
  onRerun,
  mounted = true,
}) {
  if (!mounted || !isOpen || !session) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#F1F5F9] px-6 py-4 bg-[#F8FAFC]">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#2563EB]">
              <Layers className="size-4.5" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#0F172A]">
                  Chi tiết phiên #{session.id}
                </h3>
                {renderTypeBadge(session.type)}
                {renderStatusBadge(session.status)}
              </div>
              <p className="text-[11px] text-[#64748B]">
                Khởi tạo lúc: {session.startTime} • Thời lượng:{" "}
                {session.duration || "—"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Modal Nav Tabs */}
        <div className="flex items-center gap-4 px-6 border-b border-[#F1F5F9] bg-white text-xs font-semibold">
          <button
            type="button"
            onClick={() => onTabChange("overview")}
            className={`py-3 border-b-2 transition-colors ${
              detailModalTab === "overview"
                ? "border-[#2563EB] text-[#2563EB]"
                : "border-transparent text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            Tổng quan & Cấu hình
          </button>
          <button
            type="button"
            onClick={() => onTabChange("results")}
            className={`py-3 border-b-2 transition-colors ${
              detailModalTab === "results"
                ? "border-[#2563EB] text-[#2563EB]"
                : "border-transparent text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            Dữ liệu mẫu ({session.sampleResults?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => onTabChange("logs")}
            className={`py-3 border-b-2 transition-colors ${
              detailModalTab === "logs"
                ? "border-[#2563EB] text-[#2563EB]"
                : "border-transparent text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            Nhật ký tiến trình ({session.logs?.length || 0})
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          {/* TAB 1: OVERVIEW */}
          {detailModalTab === "overview" && (
            <div className="space-y-4">
              {/* Account & Target Card */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-[#E2E8F0] p-4 bg-[#F8FAFC]/50 space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
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
                    <div className="flex flex-col">
                      <span className="font-bold text-[#0F172A]">
                        {session.account?.name || "Tài khoản quét"}
                      </span>
                      <span className="text-[11px] text-[#64748B] font-mono">
                        UID: {session.account?.uid || "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#E2E8F0] p-4 bg-[#F8FAFC]/50 space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    Mục tiêu / Từ khóa quét
                  </span>
                  <div className="pt-1">
                    <p className="font-bold text-[#0F172A] text-sm">
                      {session.target}
                    </p>
                    <p className="text-[11px] text-[#64748B] mt-0.5">
                      {session.title}
                    </p>
                  </div>
                </div>
              </div>

              {/* Progress & Result Box */}
              <div className="rounded-xl border border-[#E2E8F0] p-4 bg-white space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#0F172A]">
                    Kết quả thu thập: {session.progress?.collected || 0} /{" "}
                    {session.progress?.target || 0}{" "}
                    {session.progress?.unit || "nhóm"}
                  </span>
                  <span className="font-bold text-[#2563EB]">
                    {session.progress?.percentage || 0}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-[#E2E8F0] overflow-hidden">
                  <div
                    className="h-full bg-[#2563EB] rounded-full"
                    style={{
                      width: `${session.progress?.percentage || 0}%`,
                    }}
                  />
                </div>
              </div>

              {/* Config Grid */}
              <div className="rounded-xl border border-[#E2E8F0] p-4 bg-white space-y-2.5">
                <h4 className="font-bold text-[#0F172A] pb-2 border-b border-[#F1F5F9]">
                  Cấu hình tham số phiên chạy
                </h4>
                <div className="grid grid-cols-2 gap-y-2 text-[11px]">
                  {Object.entries(session.config || {}).map(([key, val]) => (
                    <div key={key} className="flex flex-col">
                      <span className="text-[#64748B] capitalize">{key}:</span>
                      <span className="font-semibold text-[#1E293B]">
                        {String(val)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SAMPLE RESULTS */}
          {detailModalTab === "results" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#F1F5F9]">
                <span className="text-xs font-semibold text-[#64748B]">
                  Hiển thị mẫu các nhóm đã trích xuất được trong phiên:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      JSON.stringify(session.sampleResults || [], null, 2)
                    );
                    toast.success("Đã copy dữ liệu mẫu vào Clipboard!");
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline"
                >
                  <Copy className="size-3" />
                  <span>Copy toàn bộ JSON</span>
                </button>
              </div>

              <div className="space-y-2">
                {!session.sampleResults || session.sampleResults.length === 0 ? (
                  <div className="p-4 text-center text-[#94A3B8]">
                    Chưa có dữ liệu mẫu nào được lưu cho phiên này.
                  </div>
                ) : (
                  session.sampleResults.map((res, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]/50 hover:bg-white transition-colors flex items-center justify-between"
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <span className="font-bold text-[#0F172A] truncate">
                          {res.name || res.title || res.group_name}
                        </span>
                        <span className="text-[11px] text-[#64748B]">
                          {res.members ||
                            res.members_label ||
                            res.privacy ||
                            "—"}
                        </span>
                      </div>
                      {(res.url || res.href) && (
                        <a
                          href={res.url || res.href}
                          target="_blank"
                          rel="noreferrer"
                          className="size-7 rounded-md border border-[#CBD5E1] flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0"
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

          {/* TAB 3: LOGS */}
          {detailModalTab === "logs" && (
            <div className="rounded-xl bg-[#0F172A] p-4 text-[#F8FAFC] font-mono text-[11px] space-y-2 max-h-[350px] overflow-y-auto">
              {!session.logs || session.logs.length === 0 ? (
                <div className="text-slate-400">Chưa có nhật ký ghi nhận cho phiên này.</div>
              ) : (
                session.logs.map((lg, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[#64748B] shrink-0">[{lg.time}]</span>
                    <span
                      className={`font-bold shrink-0 ${
                        lg.level === "ERROR" || lg.level === "FAILED"
                          ? "text-rose-400"
                          : lg.level === "SUCCESS"
                          ? "text-emerald-400"
                          : lg.level === "WARN"
                          ? "text-amber-400"
                          : "text-blue-400"
                      }`}
                    >
                      [{lg.level}]
                    </span>
                    <span className="text-slate-200 break-all">{lg.message}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#F1F5F9] bg-[#F8FAFC]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[#CBD5E1] bg-white text-xs font-semibold text-[#334155] hover:bg-slate-50 transition-colors"
          >
            Đóng
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onRerun(session);
                onClose();
              }}
              className="px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors inline-flex items-center gap-1.5"
            >
              <RefreshCw className="size-3.5" />
              <span>Quét lại phiên này</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

